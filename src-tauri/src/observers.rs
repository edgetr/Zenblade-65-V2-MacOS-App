//! Event-driven macOS notifications: sleep, wake, screen unlock and the
//! foreground application. Replaces Electron's powerMonitor and the former
//! one-second `lsappinfo` polling loop.

use std::ptr::NonNull;

use block2::RcBlock;
use objc2_app_kit::{
    NSWorkspace, NSWorkspaceDidActivateApplicationNotification, NSWorkspaceDidWakeNotification,
    NSWorkspaceWillSleepNotification,
};
use objc2_foundation::{
    NSDistributedNotificationCenter, NSNotification, NSNotificationCenter, NSProcessInfo, NSString,
};
use tauri::{AppHandle, Manager};

use crate::desktop::{front_application, APP_BUNDLE_ID};
use crate::{send_to_renderer, AppState};

fn observe(
    center: &NSNotificationCenter,
    name: &NSString,
    app: &AppHandle,
    handler: fn(&AppHandle),
) {
    let app = app.clone();
    let block = RcBlock::new(move |_notification: NonNull<NSNotification>| handler(&app));
    let token = unsafe {
        center.addObserverForName_object_queue_usingBlock(Some(name), None, None, &block)
    };
    // Observers live for the whole process.
    std::mem::forget(token);
}

/// The menu-bar utility must keep running with no visible window, so opt out
/// of AppKit automatic and sudden termination explicitly.
fn keep_running_when_hidden() {
    let info = NSProcessInfo::processInfo();
    let reason = NSString::from_str("Zenblade keeps running in the menu bar");
    info.disableAutomaticTermination(&reason);
    info.disableSuddenTermination();
}

/// Must run on the main thread (Tauri `setup`).
pub fn install(app: &AppHandle) {
    keep_running_when_hidden();
    let workspace_center = NSWorkspace::sharedWorkspace().notificationCenter();
    unsafe {
        observe(&workspace_center, NSWorkspaceWillSleepNotification, app, |app| {
            send_to_renderer(app, "app:suspend", ())
        });
        observe(&workspace_center, NSWorkspaceDidWakeNotification, app, |app| {
            send_to_renderer(app, "app:wake", ())
        });
        observe(&workspace_center, NSWorkspaceDidActivateApplicationNotification, app, |app| {
            report_foreground(app)
        });
    }
    let distributed = NSDistributedNotificationCenter::defaultCenter();
    observe(&distributed, &NSString::from_str("com.apple.screenIsUnlocked"), app, |app| {
        send_to_renderer(app, "app:wake", ())
    });
}

fn automation_enabled(app: &AppHandle) -> bool {
    app.state::<AppState>().desktop.lock().unwrap_or_else(|e| e.into_inner()).automation_enabled
}

/// Emits `app:activeApplication` when another app becomes frontmost while
/// automatic profiles are enabled.
fn report_foreground(app: &AppHandle) {
    if !automation_enabled(app) {
        return;
    }
    let Some(current) = front_application() else { return };
    if current.bundle_id == APP_BUNDLE_ID {
        return;
    }
    let state = app.state::<AppState>();
    let mut active = state.active_application.lock().unwrap_or_else(|e| e.into_inner());
    if active.as_ref().map(|a| &a.bundle_id) == Some(&current.bundle_id) {
        return;
    }
    *active = Some(current.clone());
    drop(active);
    send_to_renderer(app, "app:activeApplication", current);
}

pub fn start_foreground_monitor(app: &AppHandle) {
    report_foreground(app);
}

pub fn stop_foreground_monitor(app: &AppHandle) {
    *app.state::<AppState>().active_application.lock().unwrap_or_else(|e| e.into_inner()) = None;
}
