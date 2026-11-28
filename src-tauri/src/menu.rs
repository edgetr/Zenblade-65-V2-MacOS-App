//! Application menu bar and the menu-bar (tray) utility.

use tauri::image::Image;
use tauri::menu::{
    AboutMetadataBuilder, CheckMenuItemBuilder, Menu, MenuBuilder, MenuEvent, MenuItemBuilder,
    PredefinedMenuItem, SubmenuBuilder,
};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, Wry};

use crate::audio::AudioAction;
use crate::{main_window, send_to_renderer, show_main_window, AppState};

const TRAY_ID: &str = "zenblade";
const TRAY_ICON: &[u8] = include_bytes!("../icons/tray-template.png");

/// (menu id, label, accelerator, renderer panel) for the View menu.
pub const PANELS: [(&str, &str, &str, &str); 6] = [
    ("view-keyboard", "Keyboard", "CmdOrCtrl+1", "keyboard"),
    ("view-lighting", "Lighting", "CmdOrCtrl+2", "lighting"),
    ("view-actuation", "Feel", "CmdOrCtrl+3", "actuation"),
    ("view-profiles", "Profiles", "CmdOrCtrl+4", "profiles"),
    ("view-advanced", "Advanced", "CmdOrCtrl+5", "advanced"),
    ("view-system", "System", "CmdOrCtrl+6", "system"),
];

pub fn install_app_menu(app: &AppHandle) -> tauri::Result<()> {
    let about = AboutMetadataBuilder::new()
        .name(Some("Zenblade"))
        .version(Some(app.package_info().version.to_string()))
        .copyright(Some("Your personal Zenblade 65 V2 companion"))
        .build();
    let app_menu = SubmenuBuilder::new(app, "Zenblade")
        .item(&PredefinedMenuItem::about(app, Some("About Zenblade"), Some(about))?)
        .item(&MenuItemBuilder::with_id("check-updates", "Check for Updates…").build(app)?)
        .separator()
        .services()
        .separator()
        .item(&PredefinedMenuItem::hide(app, Some("Hide Zenblade"))?)
        .hide_others()
        .show_all()
        .separator()
        .item(&PredefinedMenuItem::quit(app, Some("Quit Zenblade"))?)
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let mut view = SubmenuBuilder::new(app, "View");
    for (id, label, accelerator, _) in PANELS {
        view = view.item(&MenuItemBuilder::with_id(id, label).accelerator(accelerator).build(app)?);
    }
    let view = view
        .separator()
        .item(&MenuItemBuilder::with_id("reload", "Reload").accelerator("CmdOrCtrl+R").build(app)?)
        .item(
            &MenuItemBuilder::with_id("devtools", "Toggle Developer Tools")
                .accelerator("Alt+CmdOrCtrl+I")
                .build(app)?,
        )
        .separator()
        .item(&MenuItemBuilder::with_id("zoom-reset", "Actual Size").accelerator("CmdOrCtrl+0").build(app)?)
        .item(&MenuItemBuilder::with_id("zoom-in", "Zoom In").accelerator("CmdOrCtrl+=").build(app)?)
        .item(&MenuItemBuilder::with_id("zoom-out", "Zoom Out").accelerator("CmdOrCtrl+-").build(app)?)
        .separator()
        .fullscreen()
        .build()?;
    let device = SubmenuBuilder::new(app, "Device")
        .item(&MenuItemBuilder::with_id("reconnect", "Reconnect").accelerator("CmdOrCtrl+Shift+R").build(app)?)
        .build()?;
    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .close_window()
        .build()?;
    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &edit, &view, &device, &window])
        .build()?;
    app.set_menu(menu)?;
    app.on_menu_event(handle_menu_event);
    Ok(())
}

fn set_zoom(app: &AppHandle, change: Option<f64>) {
    let state = app.state::<AppState>();
    let mut level = state.zoom_level.lock().unwrap_or_else(|e| e.into_inner());
    // Chromium zoom levels: each step of 0.5 scales by 1.2^0.5.
    *level = match change {
        Some(step) => (*level + step).clamp(-8.0, 9.0),
        None => 0.0,
    };
    if let Some(window) = main_window(app) {
        let _ = window.set_zoom(1.2f64.powf(*level));
    }
}

fn handle_menu_event(app: &AppHandle, event: MenuEvent) {
    let id = event.id().as_ref();
    if let Some((_, _, _, panel)) = PANELS.iter().find(|(menu_id, ..)| *menu_id == id) {
        send_to_renderer(app, "app:navigate", *panel);
        return;
    }
    if let Some(profile) = id.strip_prefix("tray-profile-").and_then(|n| n.parse::<usize>().ok()) {
        send_to_renderer(app, "app:selectProfile", profile);
        return;
    }
    match id {
        "reload" => {
            if let Some(window) = main_window(app) {
                let _ = window.reload();
            }
        }
        "devtools" => {
            if let Some(window) = main_window(app) {
                if window.is_devtools_open() {
                    window.close_devtools();
                } else {
                    window.open_devtools();
                }
            }
        }
        "zoom-reset" => set_zoom(app, None),
        "zoom-in" => set_zoom(app, Some(0.5)),
        "zoom-out" => set_zoom(app, Some(-0.5)),
        "reconnect" | "tray-reconnect" => send_to_renderer(app, "app:reconnect", ()),
        "tray-lights" => send_to_renderer(app, "app:toggleLights", ()),
        "tray-automation" => send_to_renderer(app, "app:toggleAutomation", ()),
        "tray-open" => show_main_window(app, None),
        "tray-mic" => crate::commands::run_audio_action(app, AudioAction {
            action: "microphone-toggle".into(),
            input_uid: String::new(),
            output_uid: String::new(),
        }),
        "tray-meeting" => {
            let meeting = app.state::<AppState>().desktop.lock().unwrap_or_else(|e| e.into_inner()).meeting.clone();
            if let Some((input_uid, output_uid)) = meeting {
                crate::commands::run_audio_action(app, AudioAction {
                    action: "meeting-mode".into(),
                    input_uid,
                    output_uid,
                });
            }
        }
        "tray-login" => {
            let result = crate::login_item::set(!crate::login_item::enabled());
            match result {
                Ok(enabled) => send_to_renderer(app, "app:loginItem", enabled),
                Err(message) => send_to_renderer(app, "app:systemActionError", message),
            }
            refresh_tray(app);
        }
        "check-updates" | "tray-check-updates" => {
            tauri::async_runtime::spawn(crate::updater::check(app.clone(), true));
        }
        _ => {}
    }
}

fn tray_menu(app: &AppHandle) -> tauri::Result<(Menu<Wry>, String)> {
    let state = app.state::<AppState>().desktop.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let status = if state.connected { "Zenblade connected" } else { "Keyboard not connected" };
    let mut builder = MenuBuilder::new(app)
        .item(&MenuItemBuilder::with_id("tray-status", status).enabled(false).build(app)?)
        .separator();
    for profile in 0..3 {
        let name = state.profile_names.get(profile).cloned().unwrap_or_else(|| format!("Profile {}", profile + 1));
        builder = builder.item(
            &CheckMenuItemBuilder::with_id(format!("tray-profile-{profile}"), name)
                .checked(state.profile == profile)
                .build(app)?,
        );
    }
    let menu = builder
        .separator()
        .item(&CheckMenuItemBuilder::with_id("tray-lights", "Lights").checked(state.lighting_on).build(app)?)
        .item(
            &CheckMenuItemBuilder::with_id("tray-automation", "Automatic profiles")
                .checked(state.automation_enabled)
                .build(app)?,
        )
        .separator()
        .item(&MenuItemBuilder::with_id("tray-mic", "Mute or Unmute Microphone").build(app)?)
        .item(
            &MenuItemBuilder::with_id("tray-meeting", "Start Meeting Setup")
                .enabled(state.meeting.is_some())
                .build(app)?,
        )
        .separator()
        .item(&MenuItemBuilder::with_id("tray-reconnect", "Reconnect").build(app)?)
        .item(&MenuItemBuilder::with_id("tray-open", "Open Zenblade").build(app)?)
        .item(&MenuItemBuilder::with_id("tray-check-updates", "Check for Updates…").build(app)?)
        .item(
            &CheckMenuItemBuilder::with_id("tray-login", "Open at Login")
                .checked(crate::login_item::enabled())
                .build(app)?,
        )
        .separator()
        .item(&PredefinedMenuItem::quit(app, Some("Quit Zenblade"))?)
        .build()?;
    let tooltip = if state.connected {
        let name = state.profile_names.get(state.profile).cloned().unwrap_or_default();
        format!("Zenblade · {name}")
    } else {
        "Zenblade · Not connected".to_string()
    };
    Ok((menu, tooltip))
}

pub fn install_tray(app: &AppHandle) -> tauri::Result<()> {
    let (menu, tooltip) = tray_menu(app)?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(Image::from_bytes(TRAY_ICON)?)
        .icon_as_template(true)
        .tooltip(tooltip)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .build(app)?;
    Ok(())
}

pub fn refresh_tray(app: &AppHandle) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else { return };
    if let Ok((menu, tooltip)) = tray_menu(app) {
        let _ = tray.set_menu(Some(menu));
        let _ = tray.set_tooltip(Some(tooltip));
    }
}
