//! Native HID transport for the renderer's WebHID-compatible shim.
//!
//! Only vendor-defined interfaces of supported Zenblade boards are exposed, so
//! the app never opens the keyboard's typing interface (which would need Input
//! Monitoring) and cannot be used to talk to unrelated devices.

use std::collections::{BTreeMap, HashMap};
use std::ffi::CString;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Mutex;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use hidapi::{HidApi, HidDevice};
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, Manager, Webview};
use tokio::sync::oneshot;

const REPORT_BUFFER: usize = 1024;
/// Fallback polling interval if IOKit notifications cannot be registered.
const MONITOR_INTERVAL: Duration = Duration::from_millis(1000);
/// Re-check interval while notifications work (covers missed edges cheaply).
const SAFETY_RECHECK: Duration = Duration::from_secs(30);
/// Delay after a notification so all interfaces of a board are published.
const SETTLE: Duration = Duration::from_millis(250);
/// Poll interval right after traffic (protocol replies arrive within ~1 ms).
const ACTIVE_POLL: Duration = Duration::from_millis(1);
/// Poll interval when the board is idle. Writes wake the thread at once and
/// hidapi queues unsolicited reports, so this only bounds their delivery.
const IDLE_POLL: Duration = Duration::from_millis(100);
const ACTIVE_WINDOW: Duration = Duration::from_millis(1500);
/// How long to block for a reply right after a write (replies take ~1 ms).
const REPLY_WAIT_MS: i32 = 10;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceIds {
    vendor_id: u16,
    product_ids: Vec<u16>,
}

fn device_ids() -> &'static DeviceIds {
    static IDS: std::sync::OnceLock<DeviceIds> = std::sync::OnceLock::new();
    IDS.get_or_init(|| {
        serde_json::from_str(include_str!("../../shared/device-ids.json"))
            .expect("shared/device-ids.json is valid")
    })
}

pub fn supported_vendor_id() -> u16 {
    device_ids().vendor_id
}

pub fn supported(vendor_id: u16, product_id: u16) -> bool {
    let ids = device_ids();
    vendor_id == ids.vendor_id && ids.product_ids.contains(&product_id)
}

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ReportInfo {
    report_id: u8,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CollectionInfo {
    usage_page: u16,
    usage: u16,
    #[serde(rename = "type")]
    kind: u8,
    children: Vec<CollectionInfo>,
    input_reports: Vec<ReportInfo>,
    output_reports: Vec<ReportInfo>,
    feature_reports: Vec<ReportInfo>,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DeviceDescriptor {
    pub id: String,
    pub vendor_id: u16,
    pub product_id: u16,
    pub product_name: String,
    pub collections: Vec<CollectionInfo>,
}

/// One enumerated HID interface entry (a top-level collection of an interface).
pub struct InterfaceEntry {
    pub path: String,
    pub vendor_id: u16,
    pub product_id: u16,
    pub product_name: String,
    pub usage_page: u16,
    pub usage: u16,
}

/// Groups enumeration entries into WebHID-style devices: one per interface
/// path, keeping only supported boards that expose a vendor-defined page.
pub fn group_devices(entries: &[InterfaceEntry]) -> Vec<DeviceDescriptor> {
    let mut grouped: BTreeMap<String, DeviceDescriptor> = BTreeMap::new();
    for entry in entries {
        if !supported(entry.vendor_id, entry.product_id) {
            continue;
        }
        let device = grouped
            .entry(entry.path.clone())
            .or_insert_with(|| DeviceDescriptor {
                id: entry.path.clone(),
                vendor_id: entry.vendor_id,
                product_id: entry.product_id,
                product_name: entry.product_name.clone(),
                collections: Vec::new(),
            });
        let duplicate = device
            .collections
            .iter()
            .any(|c| c.usage_page == entry.usage_page && c.usage == entry.usage);
        if !duplicate {
            let report = vec![ReportInfo { report_id: 0 }];
            device.collections.push(CollectionInfo {
                usage_page: entry.usage_page,
                usage: entry.usage,
                kind: 1,
                children: Vec::new(),
                input_reports: report.clone(),
                output_reports: report,
                feature_reports: Vec::new(),
            });
        }
    }
    grouped
        .into_values()
        .filter(|d| d.collections.iter().any(|c| c.usage_page >= 0xff00))
        .collect()
}

/// True when the report descriptor declares Report ID items, in which case
/// reads carry the report ID as their first byte.
pub fn uses_report_ids(descriptor: &[u8]) -> bool {
    let mut i = 0;
    while i < descriptor.len() {
        let prefix = descriptor[i];
        if prefix == 0xfe {
            // Long item: bDataSize, bLongItemTag, data.
            let size = descriptor.get(i + 1).copied().unwrap_or(0) as usize;
            i += 3 + size;
            continue;
        }
        let size = [0usize, 1, 2, 4][(prefix & 0x03) as usize];
        if prefix & 0xfc == 0x84 {
            return true;
        }
        i += 1 + size;
    }
    false
}

/// Commands for a device's I/O thread.
enum Command {
    Write(Vec<u8>, oneshot::Sender<Result<(), String>>),
    Close,
}

/// An open device. Its `HidDevice` lives only on its own I/O thread: hidapi's
/// macOS backend is not safe for concurrent read/write on one handle (both
/// paths rewrite the device's error string, one without a lock).
struct OpenDevice {
    generation: u64,
    descriptor: DeviceDescriptor,
    commands: mpsc::Sender<Command>,
    thread: Option<JoinHandle<()>>,
}

pub struct HidState {
    api: Mutex<HidApi>,
    open: Mutex<HashMap<String, OpenDevice>>,
    /// Serialises open/close so a device is never opened twice.
    open_lock: Mutex<()>,
    /// Devices the hot-plug monitor has announced.
    known: Mutex<Vec<DeviceDescriptor>>,
    generation: AtomicU64,
}

impl HidState {
    pub fn new() -> Result<Self, String> {
        let api = HidApi::new().map_err(|e| e.to_string())?;
        // Match Chromium's WebHID: never seize the device from other software.
        api.set_open_exclusive(false);
        Ok(Self {
            api: Mutex::new(api),
            open: Mutex::new(HashMap::new()),
            open_lock: Mutex::new(()),
            known: Mutex::new(Vec::new()),
            generation: AtomicU64::new(1),
        })
    }

    pub fn enumerate(&self) -> Vec<DeviceDescriptor> {
        #[cfg(feature = "e2e")]
        if crate::e2e::offline() {
            return Vec::new();
        }
        let mut api = self.api.lock().unwrap_or_else(|e| e.into_inner());
        if api.reset_devices().is_err() {
            return Vec::new();
        }
        let ids = device_ids();
        for pid in &ids.product_ids {
            let _ = api.add_devices(ids.vendor_id, *pid);
        }
        let entries: Vec<InterfaceEntry> = api
            .device_list()
            .map(|info| InterfaceEntry {
                path: info.path().to_string_lossy().into_owned(),
                vendor_id: info.vendor_id(),
                product_id: info.product_id(),
                product_name: info.product_string().unwrap_or("").to_string(),
                usage_page: info.usage_page(),
                usage: info.usage(),
            })
            .collect();
        group_devices(&entries)
    }

    /// Closes a device and waits until its I/O thread has released it.
    /// Must not be called from that I/O thread.
    fn close_device(&self, id: &str) {
        let removed = self.open.lock().unwrap_or_else(|e| e.into_inner()).remove(id);
        if let Some(mut device) = removed {
            let _ = device.commands.send(Command::Close);
            if let Some(thread) = device.thread.take() {
                let _ = thread.join();
            }
        }
    }

    fn forget_known(&self, id: &str) {
        self.known.lock().unwrap_or_else(|e| e.into_inner()).retain(|d| d.id != id);
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct HidEvent {
    #[serde(rename = "type")]
    kind: &'static str,
    device: DeviceDescriptor,
}

fn emit(app: &AppHandle, kind: &'static str, device: DeviceDescriptor) {
    let _ = app.emit_to(crate::MAIN_WINDOW, "zen-hid", HidEvent { kind, device });
}

/// Watches for supported boards being attached or removed. IOKit notifies
/// on any change for the vendor ID; the list is then re-read and diffed.
/// A slow safety re-check covers anything a notification could miss.
pub fn start_monitor(app: AppHandle) {
    let (changes, events) = mpsc::channel::<()>();
    if let Err(error) = crate::hotplug::watch(supported_vendor_id(), changes) {
        eprintln!("hot-plug notifications unavailable ({error}); polling instead");
    }
    thread::Builder::new()
        .name("zen-hid-monitor".into())
        .spawn(move || {
            let state = app.state::<HidState>();
            *state.known.lock().unwrap_or_else(|e| e.into_inner()) = state.enumerate();
            loop {
                match events.recv_timeout(SAFETY_RECHECK) {
                    // Let IOKit finish publishing every interface of the board.
                    Ok(()) => {
                        thread::sleep(SETTLE);
                        while events.try_recv().is_ok() {}
                    }
                    Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => thread::sleep(MONITOR_INTERVAL),
                }
                let current = state.enumerate();
                let (gone, added) = {
                    let mut known = state.known.lock().unwrap_or_else(|e| e.into_inner());
                    let gone: Vec<_> =
                        known.iter().filter(|d| !current.iter().any(|c| c.id == d.id)).cloned().collect();
                    let added: Vec<_> =
                        current.iter().filter(|c| !known.iter().any(|d| d.id == c.id)).cloned().collect();
                    *known = current;
                    (gone, added)
                };
                for device in gone {
                    state.close_device(&device.id);
                    emit(&app, "disconnect", device);
                }
                for device in added {
                    emit(&app, "connect", device);
                }
            }
        })
        .expect("spawn HID monitor");
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InputReport {
    report_id: u8,
    data: Vec<u8>,
}

/// Owns one open device: performs queued writes and forwards input reports.
/// hidapi queues input reports on its own run-loop thread, so polling between
/// writes loses nothing; the short poll while active keeps responses prompt.
fn io_loop(
    app: AppHandle,
    id: String,
    generation: u64,
    device: HidDevice,
    numbered: bool,
    commands: mpsc::Receiver<Command>,
    on_report: Channel<InputReport>,
) {
    let mut buffer = vec![0u8; REPORT_BUFFER];
    let mut active_until = Instant::now();
    let mut reply_wait_ms = 0;
    let lost = 'io: loop {
        let poll = if Instant::now() < active_until { ACTIVE_POLL } else { IDLE_POLL };
        match commands.recv_timeout(poll) {
            Ok(Command::Write(wire, reply)) => {
                let result = device.write(&wire).map(|_| ()).map_err(|e| e.to_string());
                if result.is_ok() {
                    reply_wait_ms = REPLY_WAIT_MS;
                }
                let _ = reply.send(result);
                active_until = Instant::now() + ACTIVE_WINDOW;
            }
            Ok(Command::Close) | Err(RecvTimeoutError::Disconnected) => break 'io false,
            Err(RecvTimeoutError::Timeout) => {}
        }
        // Right after a write, wait briefly for the reply so it is forwarded
        // the moment it arrives; otherwise just drain what hidapi has queued.
        let mut wait_ms = std::mem::take(&mut reply_wait_ms);
        loop {
            match device.read_timeout(&mut buffer, wait_ms) {
                Ok(0) => break,
                Ok(len) => {
                    let (report_id, data) = if numbered && len > 0 {
                        (buffer[0], buffer[1..len].to_vec())
                    } else {
                        (0, buffer[..len].to_vec())
                    };
                    let _ = on_report.send(InputReport { report_id, data });
                    active_until = Instant::now() + ACTIVE_WINDOW;
                    wait_ms = 0;
                }
                // macOS hidapi only fails reads once the device is gone.
                Err(_) => break 'io true,
            }
        }
    };
    drop(device);
    let state = app.state::<HidState>();
    let mine = {
        let mut open = state.open.lock().unwrap_or_else(|e| e.into_inner());
        match open.get(&id) {
            Some(entry) if entry.generation == generation => open.remove(&id),
            _ => None,
        }
    };
    if lost {
        if let Some(entry) = mine {
            // Let the renderer recover, and let the monitor announce the board
            // again if it re-enumerates under the same path.
            state.forget_known(&id);
            emit(&app, "disconnect", entry.descriptor.clone());
        }
    }
}

fn open_device(app: &AppHandle, id: String, on_report: Channel<InputReport>) -> Result<(), String> {
    let state = app.state::<HidState>();
    let _serial = state.open_lock.lock().unwrap_or_else(|e| e.into_inner());
    // A reloaded page reopens devices it never closed: replace the old handle.
    state.close_device(&id);
    // Only a currently enumerated, supported vendor interface may be opened.
    let descriptor = state
        .enumerate()
        .into_iter()
        .find(|d| d.id == id)
        .ok_or_else(|| "Device is not available".to_string())?;
    let path = CString::new(id.clone()).map_err(|_| "Invalid device path".to_string())?;
    let device = {
        let api = state.api.lock().unwrap_or_else(|e| e.into_inner());
        api.open_path(&path).map_err(|e| e.to_string())?
    };
    let mut report_descriptor = vec![0u8; 4096];
    let numbered = device
        .get_report_descriptor(&mut report_descriptor)
        .map(|len| uses_report_ids(&report_descriptor[..len]))
        .unwrap_or(false);
    let generation = state.generation.fetch_add(1, Ordering::SeqCst);
    let (commands, receiver) = mpsc::channel();
    let thread_app = app.clone();
    let thread_id = id.clone();
    let thread = thread::Builder::new()
        .name("zen-hid-io".into())
        .spawn(move || io_loop(thread_app, thread_id, generation, device, numbered, receiver, on_report))
        .map_err(|e| e.to_string())?;
    state.open.lock().unwrap_or_else(|e| e.into_inner()).insert(
        id,
        OpenDevice { generation, descriptor, commands, thread: Some(thread) },
    );
    Ok(())
}

#[tauri::command]
pub async fn hid_get_devices(webview: Webview, app: AppHandle) -> Result<Vec<DeviceDescriptor>, String> {
    crate::trusted_webview(&webview)?;
    crate::run_blocking(move || Ok(app.state::<HidState>().enumerate())).await
}

#[tauri::command]
pub async fn hid_open(
    webview: Webview,
    app: AppHandle,
    id: String,
    on_report: Channel<InputReport>,
) -> Result<(), String> {
    crate::trusted_webview(&webview)?;
    crate::run_blocking(move || open_device(&app, id, on_report)).await
}

#[tauri::command]
pub async fn hid_close(webview: Webview, app: AppHandle, id: String) -> Result<(), String> {
    crate::trusted_webview(&webview)?;
    crate::run_blocking(move || {
        let state = app.state::<HidState>();
        let _serial = state.open_lock.lock().unwrap_or_else(|e| e.into_inner());
        state.close_device(&id);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn hid_send(
    webview: Webview,
    id: String,
    report_id: u8,
    data: Vec<u8>,
    state: tauri::State<'_, HidState>,
) -> Result<(), String> {
    crate::trusted_webview(&webview)?;
    let commands = state
        .open
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&id)
        .map(|d| d.commands.clone())
        .ok_or_else(|| "Device is not open".to_string())?;
    let mut wire = Vec::with_capacity(data.len() + 1);
    wire.push(report_id);
    wire.extend_from_slice(&data);
    let (reply, result) = oneshot::channel();
    commands
        .send(Command::Write(wire, reply))
        .map_err(|_| "Device is not open".to_string())?;
    result.await.map_err(|_| "Device is not open".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(path: &str, pid: u16, page: u16, usage: u16) -> InterfaceEntry {
        InterfaceEntry {
            path: path.into(),
            vendor_id: device_ids().vendor_id,
            product_id: pid,
            product_name: "Zenblade v2 8K".into(),
            usage_page: page,
            usage,
        }
    }

    #[test]
    fn groups_vendor_interfaces_and_hides_typing_interfaces() {
        let pid = device_ids().product_ids[1];
        let devices = group_devices(&[
            entry("A", pid, 0x01, 6),
            entry("B", pid, 0xff60, 0x61),
            entry("C", pid, 0x01, 2),
            entry("C", pid, 0x0c, 1),
        ]);
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].id, "B");
        assert_eq!(devices[0].collections[0].usage_page, 0xff60);
        assert_eq!(devices[0].collections[0].output_reports.len(), 1);
    }

    #[test]
    fn rejects_unsupported_vendor_and_product_ids() {
        let mut foreign = entry("X", device_ids().product_ids[0], 0xff60, 0x61);
        foreign.vendor_id = 0x1234;
        let unknown_pid = entry("Y", 0x0001, 0xff60, 0x61);
        assert!(group_devices(&[foreign, unknown_pid]).is_empty());
    }

    #[test]
    fn detects_report_id_items() {
        // Usage Page (vendor), Usage, Collection, Report Size, Report Count, Output, End.
        let plain = [0x06, 0x60, 0xff, 0x09, 0x61, 0xa1, 0x01, 0x75, 0x08, 0x95, 0x40, 0x91, 0x02, 0xc0];
        assert!(!uses_report_ids(&plain));
        let numbered = [0x06, 0x01, 0xff, 0xa1, 0x01, 0x85, 0x02, 0x75, 0x08, 0xc0];
        assert!(uses_report_ids(&numbered));
    }
}
