mod audio;
mod commands;
mod desktop;
#[cfg(feature = "e2e")]
mod e2e;
mod hid;
mod hotplug;
mod login_item;
mod menu;
mod migrate;
mod observers;
mod updater;
mod webkit;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::utils::config::BackgroundThrottlingPolicy;
use tauri::webview::NewWindowResponse;
use tauri::{
    AppHandle, Emitter, LogicalPosition, Manager, RunEvent, Theme, TitleBarStyle, Url,
    WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

use crate::audio::AudioBridge;
use crate::desktop::ApplicationInfo;
use crate::hid::HidState;

pub const MAIN_WINDOW: &str = "main";

#[derive(Clone, Debug, PartialEq)]
pub struct DesktopState {
    pub connected: bool,
    pub profile: usize,
    pub lighting_on: bool,
    pub automation_enabled: bool,
    /// Display names for the three onboard profiles.
    pub profile_names: Vec<String>,
    /// The active profile's Meeting setup devices, when any are chosen.
    pub meeting: Option<(String, String)>,
}

impl Default for DesktopState {
    fn default() -> Self {
        Self {
            connected: false,
            profile: 0,
            lighting_on: true,
            automation_enabled: false,
            profile_names: (1..=3).map(|n| format!("Profile {n}")).collect(),
            meeting: None,
        }
    }
}

pub struct AppState {
    pub desktop: Mutex<DesktopState>,
    pub active_application: Mutex<Option<ApplicationInfo>>,
    pub shortcuts: Mutex<Vec<String>>,
    pub zoom_level: Mutex<f64>,
    pub quitting: AtomicBool,
}

pub const APP_PAGE: &str = "/renderer/index.html";

/// Only the bundled app page may be shown or drive native features.
pub fn trusted_url(url: &Url) -> bool {
    url.scheme() == "tauri" && url.host_str() == Some("localhost") && url.path() == APP_PAGE
}

/// Port of Electron's `trustedSender`: the main window showing the bundled
/// page. Capabilities already scope commands to it; this is defence in depth.
pub fn trusted_webview(webview: &tauri::Webview) -> Result<(), String> {
    let url = webview.url().map_err(|_| "Untrusted renderer".to_string())?;
    if webview.label() == MAIN_WINDOW && trusted_url(&url) {
        Ok(())
    } else {
        Err("Untrusted renderer".into())
    }
}

/// Runs blocking native work (IOKit, dialogs, file I/O) off the async workers.
pub async fn run_blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work).await.map_err(|e| e.to_string())?
}

pub fn send_to_renderer<S: serde::Serialize + Clone>(app: &AppHandle, event: &str, payload: S) {
    let _ = app.emit_to(MAIN_WINDOW, event, payload);
}

pub fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(MAIN_WINDOW)
}

pub fn show_main_window(app: &AppHandle, panel: Option<&str>) {
    if let Some(window) = main_window(app) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    if let Some(panel) = panel {
        send_to_renderer(app, "app:navigate", panel);
    }
    updater::offer_pending(app);
}

fn create_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let page = if cfg!(feature = "e2e") && std::env::var_os("ZEN_E2E_TEST_MODE").is_some() {
        "renderer/index.html?test"
    } else {
        "renderer/index.html"
    };
    #[cfg(feature = "e2e")]
    let legacy = if e2e::offline() { None } else { migrate::initialization_script(app) };
    #[cfg(not(feature = "e2e"))]
    let legacy = migrate::initialization_script(app);
    let seeded_legacy = legacy.is_some();
    let mut builder = WebviewWindowBuilder::new(app, MAIN_WINDOW, WebviewUrl::App(page.into()))
        .title("Zenblade")
        .inner_size(1200.0, 820.0)
        .min_inner_size(900.0, 600.0)
        .background_color(tauri::window::Color(0x10, 0x0e, 0x18, 0xff))
        .title_bar_style(TitleBarStyle::Overlay)
        .hidden_title(true)
        // Electron's trafficLightPosition {x: 16, y: 16} placed the button tops at
        // y = 16; tao sizes the title-bar container instead, so the equivalent
        // inset is 9pt larger.
        .traffic_light_position(LogicalPosition::new(16.0, 25.0))
        .theme(Some(Theme::Dark))
        .visible(false)
        // The hidden menu-bar utility still needs to handle active-app and
        // reconnect events promptly.
        .background_throttling(BackgroundThrottlingPolicy::Disabled)
        // This utility has no external links, embedded pages, or extra windows.
        .on_navigation(trusted_url)
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .on_page_load(move |window, payload| {
            if payload.event() != tauri::webview::PageLoadEvent::Finished {
                return;
            }
            // Like Electron's `once("ready-to-show")`: a reload while the
            // window is hidden in the menu bar must not pop it open.
            // A login launch (`--hidden`) starts quietly in the menu bar.
            static SHOWN: AtomicBool = AtomicBool::new(false);
            if !SHOWN.swap(true, Ordering::SeqCst) && !login_item::launched_hidden() {
                let _ = window.show();
            }
            if seeded_legacy {
                migrate::mark_imported(window.app_handle());
            }
        });
    if let Some(script) = legacy {
        builder = builder.initialization_script(script);
    }
    #[cfg(feature = "e2e")]
    {
        builder = builder.initialization_script(e2e::initialization_script());
        if e2e::offline() {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(1);
            builder = builder.data_store_identifier(nonce.to_le_bytes());
        }
    }
    let window = builder.build()?;
    webkit::keep_active_when_hidden(&window);
    Ok(window)
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app, None);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(AppState {
            desktop: Mutex::new(DesktopState::default()),
            active_application: Mutex::new(None),
            shortcuts: Mutex::new(Vec::new()),
            zoom_level: Mutex::new(0.0),
            quitting: AtomicBool::new(false),
        })
        .manage(AudioBridge::new())
        .manage(updater::UpdateState::default())
        .invoke_handler(tauri::generate_handler![
            #[cfg(feature = "e2e")]
            e2e::e2e_log,
            #[cfg(feature = "e2e")]
            e2e::e2e_window,
            #[cfg(feature = "e2e")]
            e2e::e2e_snapshot,
            commands::app_get_info,
            commands::app_get_active_application,
            commands::app_set_desktop_state,
            commands::app_get_system_context,
            commands::app_configure_system_shortcuts,
            commands::app_choose_applications,
            commands::app_export_profile,
            commands::app_import_profile,
            commands::app_running_applications,
            commands::app_get_login_item,
            commands::app_set_login_item,
            hid::hid_get_devices,
            hid::hid_open,
            hid::hid_close,
            hid::hid_send,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            app.set_theme(Some(Theme::Dark));
            #[cfg(feature = "e2e")]
            app.add_capability(e2e::CAPABILITY)?;
            app.manage(HidState::new().map_err(|e| format!("HID unavailable: {e}"))?);
            menu::install_app_menu(&handle)?;
            create_window(&handle)?;
            login_item::refresh();
            menu::install_tray(&handle)?;
            observers::install(&handle);
            hid::start_monitor(handle.clone());
            updater::schedule(handle);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.app_handle().state::<AppState>();
                if !state.quitting.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Zenblade");

    app.run(|app, event| match event {
        RunEvent::Reopen { .. } => show_main_window(app, None),
        RunEvent::ExitRequested { .. } => {
            app.state::<AppState>().quitting.store(true, Ordering::SeqCst);
            use tauri_plugin_global_shortcut::GlobalShortcutExt;
            let _ = app.global_shortcut().unregister_all();
        }
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::trusted_url;

    #[test]
    fn only_the_bundled_page_is_trusted() {
        for ok in ["tauri://localhost/renderer/index.html", "tauri://localhost/renderer/index.html?test#x"] {
            assert!(trusted_url(&ok.parse().unwrap()), "{ok}");
        }
        for bad in [
            "https://example.com/",
            "file:///etc/passwd",
            "about:blank",
            "tauri://evil/renderer/index.html",
            "tauri://localhost/shared/device-ids.json",
            "tauri://localhost/index.html",
            "http://localhost/renderer/index.html",
            "some-app://action",
        ] {
            assert!(!trusted_url(&bad.parse().unwrap()), "{bad}");
        }
    }
}
