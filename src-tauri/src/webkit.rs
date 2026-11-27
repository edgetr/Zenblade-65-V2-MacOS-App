//! Keeps the page fully active while the window is hidden in the menu bar.
//!
//! Electron ran with `backgroundThrottling: false`; automatic profiles,
//! tray actions and wake recovery all run timers while the window is hidden.
//! WebKit's public `inactiveSchedulingPolicy = none` (set by Tauri) stops
//! process suspension but not hidden-page DOM timer throttling, which can stall
//! timers for many seconds. These WKPreferences selectors are checked with
//! `respondsToSelector:` and skipped if WebKit ever removes them.

use objc2::runtime::AnyObject;
use objc2::{msg_send, sel};
use tauri::WebviewWindow;

/// Sends `[target selector:NO]` only when the selector exists.
macro_rules! disable {
    ($target:expr, $selector:ident) => {{
        let target: &AnyObject = $target;
        let responds: bool = msg_send![target, respondsToSelector: sel!($selector:)];
        if responds {
            let _: () = msg_send![target, $selector: false];
        }
    }};
}

pub fn keep_active_when_hidden(window: &WebviewWindow) {
    let _ = window.with_webview(|webview| unsafe {
        let view = &*(webview.inner() as *const AnyObject);
        let configuration: *mut AnyObject = msg_send![view, configuration];
        let Some(configuration) = configuration.as_ref() else { return };
        let preferences: *mut AnyObject = msg_send![configuration, preferences];
        let Some(preferences) = preferences.as_ref() else { return };
        disable!(preferences, _setHiddenPageDOMTimerThrottlingEnabled);
        disable!(preferences, _setHiddenPageDOMTimerThrottlingAutoIncreases);
        disable!(preferences, _setPageVisibilityBasedProcessSuspensionEnabled);
        disable!(view, _setWindowOcclusionDetectionEnabled);
    });
}
