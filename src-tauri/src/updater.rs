//! In-app updates from GitHub Releases.
//!
//! Each release publishes `latest.json` plus a minisign-signed
//! `Zenblade.app.tar.gz`; the app only installs bundles signed with the key
//! whose public half is in `tauri.conf.json`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult};
use tauri_plugin_updater::{Update, UpdaterExt};

const FIRST_CHECK_DELAY: Duration = Duration::from_secs(10);
const CHECK_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);
const INSTALL: &str = "Install and Relaunch";
const LATER: &str = "Later";

#[derive(Default)]
pub struct UpdateState {
    busy: AtomicBool,
    /// A version the user postponed; automatic checks stay quiet about it.
    postponed: Mutex<Option<String>>,
    /// Found by a background check while the window was hidden in the menu
    /// bar; offered the next time the window is opened.
    pending: Mutex<Option<Update>>,
}

fn window_visible(app: &AppHandle) -> bool {
    crate::main_window(app)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
}

/// Offers an update found while the window was hidden. Called whenever the
/// main window is shown.
pub fn offer_pending(app: &AppHandle) {
    let pending = app.state::<UpdateState>().pending.lock().unwrap_or_else(|e| e.into_inner()).take();
    if let Some(update) = pending {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let state = app.state::<UpdateState>();
            if state.busy.swap(true, Ordering::SeqCst) {
                return;
            }
            if let Err(error) = offer(&app, update).await {
                message(&app, "Update failed", &error, MessageDialogKind::Error).await;
            }
            state.busy.store(false, Ordering::SeqCst);
        });
    }
}

async fn message(app: &AppHandle, title: &str, text: &str, kind: MessageDialogKind) {
    let mut dialog = app.dialog().message(text).title(title).kind(kind);
    if let Some(window) = crate::main_window(app) {
        dialog = dialog.parent(&window);
    }
    // Dialogs block until dismissed; keep them off the async workers.
    let _ = tauri::async_runtime::spawn_blocking(move || dialog.blocking_show()).await;
}

fn release_notes(update: &Update) -> String {
    let notes = update.body.as_deref().unwrap_or("").trim();
    let mut short: String = notes.chars().take(600).collect();
    if notes.chars().count() > 600 {
        short.push('…');
    }
    short
}

async fn offer(app: &AppHandle, update: Update) -> Result<(), String> {
    let current = app.package_info().version.to_string();
    let notes = release_notes(&update);
    let text = if notes.is_empty() {
        format!("Zenblade {} is available. You have {current}.", update.version)
    } else {
        format!("Zenblade {} is available. You have {current}.\n\n{notes}", update.version)
    };
    let mut dialog = app
        .dialog()
        .message(text)
        .title("Update available")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(INSTALL.into(), LATER.into()));
    if let Some(window) = crate::main_window(app) {
        dialog = dialog.parent(&window);
    }
    let choice = tauri::async_runtime::spawn_blocking(move || dialog.blocking_show_with_result())
        .await
        .map_err(|e| e.to_string())?;
    let install = matches!(choice, MessageDialogResult::Custom(ref l) if l == INSTALL);
    if !install {
        *app.state::<UpdateState>().postponed.lock().unwrap_or_else(|e| e.into_inner()) = Some(update.version.clone());
        return Ok(());
    }
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| format!("The update could not be installed: {e}"))?;
    app.restart();
}

/// Checks GitHub for a newer release. `interactive` checks (from the menu)
/// also report "up to date" and errors; background checks stay silent.
pub async fn check(app: AppHandle, interactive: bool) {
    let state = app.state::<UpdateState>();
    if state.busy.swap(true, Ordering::SeqCst) {
        return;
    }
    let result = async {
        let update = app
            .updater()
            .map_err(|e| e.to_string())?
            .check()
            .await
            .map_err(|e| format!("Could not check for updates: {e}"))?;
        match update {
            Some(update) => {
                let postponed = state.postponed.lock().unwrap_or_else(|e| e.into_inner()).clone();
                if !interactive && postponed.as_deref() == Some(update.version.as_str()) {
                    return Ok(());
                }
                if !interactive && !window_visible(&app) {
                    *state.pending.lock().unwrap_or_else(|e| e.into_inner()) = Some(update);
                    return Ok(());
                }
                if interactive {
                    crate::show_main_window(&app, None);
                }
                offer(&app, update).await
            }
            None if interactive => {
                crate::show_main_window(&app, None);
                let version = app.package_info().version.to_string();
                message(&app, "You're up to date", &format!("Zenblade {version} is the latest version."), MessageDialogKind::Info).await;
                Ok(())
            }
            None => Ok(()),
        }
    }
    .await;
    if let Err(error) = result {
        if interactive {
            crate::show_main_window(&app, None);
            message(&app, "Update failed", &error, MessageDialogKind::Error).await;
        } else {
            eprintln!("update check: {error}");
        }
    }
    state.busy.store(false, Ordering::SeqCst);
}

/// Background checks shortly after launch and then daily, since the app
/// usually keeps running in the menu bar.
pub fn schedule(app: AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK_DELAY).await;
        loop {
            check(app.clone(), false).await;
            tokio::time::sleep(CHECK_INTERVAL).await;
        }
    });
}
