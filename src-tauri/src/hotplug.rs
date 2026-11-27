//! Event-driven USB hot-plug notifications for the Zenblade vendor ID.
//!
//! IOKit calls back on attach/detach, so the app spends no CPU while nothing
//! changes (polling `hid_enumerate` re-runs IOKit matching every time).
//! Matching only observes registry entries; it never opens a device.

use std::ffi::{c_char, c_void, CString};
use std::sync::mpsc::Sender;
use std::sync::OnceLock;

use core_foundation::base::TCFType;
use core_foundation::dictionary::CFMutableDictionaryRef;
use core_foundation::number::CFNumber;
use core_foundation::runloop::{kCFRunLoopDefaultMode, CFRunLoop, CFRunLoopSourceRef};
use core_foundation::string::CFString;

type IoObject = u32;
type IoIterator = u32;
type KernReturn = i32;
type IoNotificationPortRef = *mut c_void;
type IoServiceMatchingCallback = extern "C" fn(refcon: *mut c_void, iterator: IoIterator);

#[link(name = "IOKit", kind = "framework")]
extern "C" {
    fn IONotificationPortCreate(main_port: u32) -> IoNotificationPortRef;
    fn IONotificationPortGetRunLoopSource(port: IoNotificationPortRef) -> CFRunLoopSourceRef;
    fn IOServiceMatching(name: *const c_char) -> CFMutableDictionaryRef;
    fn IOServiceAddMatchingNotification(
        port: IoNotificationPortRef,
        notification_type: *const c_char,
        matching: CFMutableDictionaryRef,
        callback: IoServiceMatchingCallback,
        refcon: *mut c_void,
        iterator: *mut IoIterator,
    ) -> KernReturn;
    fn IOIteratorNext(iterator: IoIterator) -> IoObject;
    fn IOObjectRelease(object: IoObject) -> KernReturn;
}

static CHANGES: OnceLock<Sender<()>> = OnceLock::new();

/// Empties (and thereby re-arms) a notification iterator.
fn drain(iterator: IoIterator) -> bool {
    let mut any = false;
    loop {
        let object = unsafe { IOIteratorNext(iterator) };
        if object == 0 {
            return any;
        }
        any = true;
        unsafe { IOObjectRelease(object) };
    }
}

extern "C" fn on_change(_refcon: *mut c_void, iterator: IoIterator) {
    if drain(iterator) {
        if let Some(changes) = CHANGES.get() {
            let _ = changes.send(());
        }
    }
}

fn matching(vendor_id: u16) -> Option<CFMutableDictionaryRef> {
    let class = CString::new("IOHIDDevice").ok()?;
    let dict = unsafe { IOServiceMatching(class.as_ptr()) };
    if dict.is_null() {
        return None;
    }
    let key = CFString::from_static_string("VendorID");
    let value = CFNumber::from(vendor_id as i32);
    unsafe {
        core_foundation::dictionary::CFDictionarySetValue(
            dict,
            key.as_CFTypeRef(),
            value.as_CFTypeRef(),
        );
    }
    Some(dict)
}

/// Runs a CFRunLoop on its own thread and sends `()` on every attach or
/// detach of a HID device with `vendor_id`.
pub fn watch(vendor_id: u16, changes: Sender<()>) -> Result<(), String> {
    CHANGES.set(changes).map_err(|_| "hot-plug watcher already running".to_string())?;
    std::thread::Builder::new()
        .name("zen-hid-hotplug".into())
        .spawn(move || unsafe {
            let port = IONotificationPortCreate(0);
            if port.is_null() {
                return;
            }
            let source = IONotificationPortGetRunLoopSource(port);
            let run_loop = CFRunLoop::get_current();
            CFRunLoop::add_source(
                &run_loop,
                &core_foundation::runloop::CFRunLoopSource::wrap_under_get_rule(source),
                kCFRunLoopDefaultMode,
            );
            for kind in ["IOServiceFirstMatch", "IOServiceTerminate"] {
                let Some(dict) = matching(vendor_id) else { return };
                let Ok(kind) = CString::new(kind) else { return };
                let mut iterator: IoIterator = 0;
                // The matching dictionary is consumed by this call.
                let result = IOServiceAddMatchingNotification(
                    port,
                    kind.as_ptr(),
                    dict,
                    on_change,
                    std::ptr::null_mut(),
                    &mut iterator,
                );
                if result != 0 {
                    return;
                }
                drain(iterator);
            }
            CFRunLoop::run_current();
        })
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    extern "C" {
        fn IOServiceGetMatchingServices(main_port: u32, matching: CFMutableDictionaryRef, existing: *mut IoIterator) -> KernReturn;
    }

    /// Hardware check (`cargo test -- --ignored` with a Zenblade attached): the
    /// matching dictionary used for notifications finds the board's interfaces.
    #[test]
    #[ignore]
    fn matching_finds_attached_board() {
        let vendor = crate::hid::supported_vendor_id();
        let dict = matching(vendor).expect("matching dictionary");
        let mut iterator: IoIterator = 0;
        assert_eq!(unsafe { IOServiceGetMatchingServices(0, dict, &mut iterator) }, 0);
        let mut count = 0;
        loop {
            let object = unsafe { IOIteratorNext(iterator) };
            if object == 0 {
                break;
            }
            count += 1;
            unsafe { IOObjectRelease(object) };
        }
        unsafe { IOObjectRelease(iterator) };
        assert!(count >= 1, "no IOHIDDevice with VendorID {vendor}");
    }
}
