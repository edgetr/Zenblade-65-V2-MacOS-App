//! Commands behind the renderer's `window.zenShell` API.

use std::io::Read;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State, Webview};
use tauri_plugin_dialog::{DialogExt, FilePath, MessageDialogButtons, MessageDialogKind, MessageDialogResult};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::audio::{AudioAction, AudioBridge};
use crate::desktop::{self, ApplicationInfo, APP_BUNDLE_ID};
use crate::{menu, observers, AppState, DesktopState};

const MAX_PROFILE_FILE: u64 = 1024 * 1024;

use crate::trusted_webview as trusted;

fn to_path(file: FilePath) -> Option<PathBuf> {
    file.into_path().ok()
}

/// Dialogs attach to the main window as sheets; show it first so a sheet is
/// never buried behind a hidden window.
fn dialog_parent(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    let window = crate::main_window(app)?;
    if !window.is_visible().unwrap_or(true) {
        let _ = window.show();
    }
    Some(window)
}

#[derive(Serialize)]
pub struct AppInfo {
    version: String,
    platform: &'static str,
    name: String,
}

#[tauri::command]
pub async fn app_get_info(webview: Webview, app: AppHandle) -> Result<AppInfo, String> {
    trusted(&webview)?;
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        platform: "darwin",
        name: app.package_info().name.clone(),
    })
}

#[tauri::command]
pub async fn app_get_active_application(
    webview: Webview,
    state: State<'_, AppState>,
) -> Result<Option<ApplicationInfo>, String> {
    trusted(&webview)?;
    let current = desktop::front_application();
    let mut active = state.active_application.lock().unwrap_or_else(|e| e.into_inner());
    if current.as_ref().map(|a| a.bundle_id.as_str()) != Some(APP_BUNDLE_ID) {
        *active = current;
    }
    Ok(active.clone())
}

#[tauri::command]
pub fn app_set_desktop_state(webview: Webview, app: AppHandle, next: Value) -> Result<(), String> {
    if trusted(&webview).is_err() {
        // Mirrors ipcMain.on: silently ignore untrusted senders.
        return Ok(());
    }
    let state = app.state::<AppState>();
    let (was_enabled, now_enabled) = {
        let mut desktop_state = state.desktop.lock().unwrap_or_else(|e| e.into_inner());
        let was = desktop_state.automation_enabled;
        *desktop_state = DesktopState {
            connected: next.get("connected") == Some(&Value::Bool(true)),
            profile: desktop::profile_index(next.get("profile").unwrap_or(&Value::Null)),
            lighting_on: next.get("lightingOn") != Some(&Value::Bool(false)),
            automation_enabled: next.get("automationEnabled") == Some(&Value::Bool(true)),
        };
        (was, desktop_state.automation_enabled)
    };
    if now_enabled && !was_enabled {
        observers::start_foreground_monitor(&app);
    } else if !now_enabled && was_enabled {
        observers::stop_foreground_monitor(&app);
    }
    menu::refresh_tray(&app);
    Ok(())
}

#[tauri::command]
pub async fn app_get_system_context(
    webview: Webview,
    app: AppHandle,
    detectors: Value,
) -> Result<Value, String> {
    trusted(&webview)?;
    let detectors = desktop::normalize_detectors(&detectors);
    let audio_app = app.clone();
    let audio = tauri::async_runtime::spawn_blocking(move || audio_app.state::<AudioBridge>().status());
    let processes = tauri::async_runtime::spawn_blocking(move || desktop::scan_processes(&detectors));
    let audio = audio.await.map_err(|e| e.to_string())?;
    let processes = processes.await.map_err(|e| e.to_string())??;
    let observed_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Ok(json!({ "audio": audio, "processes": processes, "observedAt": observed_at }))
}

#[derive(Serialize)]
pub struct ShortcutResult {
    registered: Vec<String>,
    failures: Vec<String>,
}

fn text(value: &Value, key: &str) -> String {
    match value.get(key) {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::Bool(true)) => "true".into(),
        _ => String::new(),
    }
}

#[tauri::command]
pub async fn app_configure_system_shortcuts(
    webview: Webview,
    app: AppHandle,
    mappings: Value,
) -> Result<ShortcutResult, String> {
    trusted(&webview)?;
    let state = app.state::<AppState>();
    let shortcuts = app.global_shortcut();
    // Registration round-trips to the main thread; never hold the lock across it.
    let previous = std::mem::take(&mut *state.shortcuts.lock().unwrap_or_else(|e| e.into_inner()));
    for accelerator in previous {
        let _ = shortcuts.unregister(accelerator.as_str());
    }
    let mut registered: Vec<String> = Vec::new();
    let mut failures = Vec::new();
    for value in mappings.as_array().map(Vec::as_slice).unwrap_or_default() {
        let accelerator = text(value, "accelerator");
        if !desktop::allowed_system_accelerator(&accelerator) || registered.contains(&accelerator) {
            continue;
        }
        let action = AudioAction {
            action: text(value, "action"),
            input_uid: text(value, "inputUid"),
            output_uid: text(value, "outputUid"),
        };
        let result = shortcuts.on_shortcut(accelerator.as_str(), move |app, _shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            let app = app.clone();
            let action = action.clone();
            tauri::async_runtime::spawn_blocking(move || {
                match app.state::<AudioBridge>().perform(&action) {
                    Ok(audio) => crate::send_to_renderer(&app, "app:systemContext", json!({ "audio": audio })),
                    Err(message) => crate::send_to_renderer(&app, "app:systemActionError", message),
                }
            });
        });
        match result {
            Ok(()) => registered.push(accelerator),
            Err(_) => failures.push(accelerator),
        }
    }
    state.shortcuts.lock().unwrap_or_else(|e| e.into_inner()).clone_from(&registered);
    Ok(ShortcutResult { registered, failures })
}

#[tauri::command]
pub async fn app_choose_applications(webview: Webview, app: AppHandle) -> Result<Vec<ApplicationInfo>, String> {
    trusted(&webview)?;
    crate::run_blocking(move || choose_applications(&app)).await
}

fn choose_applications(app: &AppHandle) -> Result<Vec<ApplicationInfo>, String> {
    let mut dialog = app
        .dialog()
        .file()
        .set_title("Choose applications")
        .set_directory("/Applications")
        .set_can_create_directories(false)
        .add_filter("Applications", &["app"]);
    if let Some(parent) = dialog_parent(app) {
        dialog = dialog.set_parent(&parent);
    }
    let Some(files) = dialog.blocking_pick_files() else {
        return Ok(Vec::new());
    };
    let values = files
        .into_iter()
        .filter_map(to_path)
        .map(|path| desktop::read_application_metadata(&path))
        .collect();
    Ok(desktop::dedupe_applications(values))
}

#[tauri::command]
pub async fn app_export_profile(webview: Webview, app: AppHandle, payload: Value) -> Result<Value, String> {
    trusted(&webview)?;
    crate::run_blocking(move || export_profile(&app, &payload)).await
}

fn export_profile(app: &AppHandle, payload: &Value) -> Result<Value, String> {
    let profile = desktop::profile_index(payload.get("profile").unwrap_or(&Value::Null));
    let data = payload.get("data").cloned().unwrap_or(Value::Null);
    desktop::assert_supported_profile_file(&data)?;
    let mut dialog = app
        .dialog()
        .file()
        .set_title(format!("Export Profile {}", profile + 1))
        .set_file_name(format!("Zenblade Profile {}.zenbladeprofile", profile + 1))
        .add_filter("Zenblade Profile", &["zenbladeprofile"]);
    if let Some(parent) = dialog_parent(app) {
        dialog = dialog.set_parent(&parent);
    }
    let Some(path) = dialog.blocking_save_file().and_then(to_path) else {
        return Ok(json!({ "canceled": true }));
    };
    let text = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    std::fs::write(&path, format!("{text}\n")).map_err(|e| e.to_string())?;
    Ok(json!({ "canceled": false }))
}

#[tauri::command]
pub async fn app_import_profile(webview: Webview, app: AppHandle, target_profile: Value) -> Result<Value, String> {
    trusted(&webview)?;
    crate::run_blocking(move || import_profile(&app, &target_profile)).await
}

fn import_profile(app: &AppHandle, target_profile: &Value) -> Result<Value, String> {
    let profile = desktop::profile_index(target_profile);
    let mut dialog = app
        .dialog()
        .file()
        .set_title("Import Zenblade Profile")
        .add_filter("Zenblade Profile", &["zenbladeprofile", "json"]);
    if let Some(parent) = dialog_parent(app) {
        dialog = dialog.set_parent(&parent);
    }
    let Some(path) = dialog.blocking_pick_file().and_then(to_path) else {
        return Ok(json!({ "canceled": true }));
    };
    let mut bytes = Vec::new();
    std::fs::File::open(&path)
        .and_then(|file| file.take(MAX_PROFILE_FILE + 1).read_to_end(&mut bytes))
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_PROFILE_FILE {
        return Err("Profile file is too large".into());
    }
    let parsed: Value =
        serde_json::from_slice(&bytes).map_err(|_| "Profile file is not valid JSON".to_string())?;
    desktop::assert_supported_profile_file(&parsed)?;
    let mut confirm = app
        .dialog()
        .message(format!("Importing will replace the local settings in Profile {}.", profile + 1))
        .title(format!("Replace Profile {}?", profile + 1))
        .kind(MessageDialogKind::Warning)
        // Same layout as the Electron alert: "Cancel" is the rightmost default
        // button (Return and Escape both cancel); "Replace Profile" sits beside it.
        .buttons(MessageDialogButtons::OkCancelCustom("Cancel".into(), "Replace Profile".into()));
    if let Some(parent) = dialog_parent(app) {
        confirm = confirm.parent(&parent);
    }
    let replace = matches!(
        confirm.blocking_show_with_result(),
        MessageDialogResult::Custom(ref label) if label == "Replace Profile"
    );
    if !replace {
        return Ok(json!({ "canceled": true }));
    }
    Ok(json!({ "canceled": false, "data": parsed }))
}

