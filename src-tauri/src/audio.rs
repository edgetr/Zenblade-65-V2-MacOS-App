//! In-process CoreAudio control. A direct port of the former `zenbridge`
//! helper: device listing, default input/output selection and microphone mute.

use std::ffi::c_void;
use std::sync::Mutex;

use core_foundation::base::TCFType;
use core_foundation::string::{CFString, CFStringRef};
use serde::Serialize;

type AudioObjectId = u32;
type OsStatus = i32;

#[repr(C)]
struct PropertyAddress {
    selector: u32,
    scope: u32,
    element: u32,
}

#[link(name = "CoreAudio", kind = "framework")]
extern "C" {
    fn AudioObjectGetPropertyDataSize(
        object: AudioObjectId,
        address: *const PropertyAddress,
        qualifier_size: u32,
        qualifier: *const c_void,
        size: *mut u32,
    ) -> OsStatus;
    fn AudioObjectGetPropertyData(
        object: AudioObjectId,
        address: *const PropertyAddress,
        qualifier_size: u32,
        qualifier: *const c_void,
        size: *mut u32,
        data: *mut c_void,
    ) -> OsStatus;
    fn AudioObjectSetPropertyData(
        object: AudioObjectId,
        address: *const PropertyAddress,
        qualifier_size: u32,
        qualifier: *const c_void,
        size: u32,
        data: *const c_void,
    ) -> OsStatus;
    fn AudioObjectHasProperty(object: AudioObjectId, address: *const PropertyAddress) -> u8;
    fn AudioObjectIsPropertySettable(
        object: AudioObjectId,
        address: *const PropertyAddress,
        settable: *mut u8,
    ) -> OsStatus;
}

const fn fourcc(code: &[u8; 4]) -> u32 {
    ((code[0] as u32) << 24) | ((code[1] as u32) << 16) | ((code[2] as u32) << 8) | code[3] as u32
}

const SYSTEM_OBJECT: AudioObjectId = 1;
const UNKNOWN: AudioObjectId = 0;
const SCOPE_GLOBAL: u32 = fourcc(b"glob");
const SCOPE_INPUT: u32 = fourcc(b"inpt");
const SCOPE_OUTPUT: u32 = fourcc(b"outp");
const ELEMENT_MAIN: u32 = 0;
const HW_DEVICES: u32 = fourcc(b"dev#");
const HW_DEFAULT_INPUT: u32 = fourcc(b"dIn ");
const HW_DEFAULT_OUTPUT: u32 = fourcc(b"dOut");
const HW_DEFAULT_SYSTEM_OUTPUT: u32 = fourcc(b"sOut");
const DEVICE_UID: u32 = fourcc(b"uid ");
const OBJECT_NAME: u32 = fourcc(b"lnam");
const DEVICE_STREAMS: u32 = fourcc(b"stm#");
const DEVICE_MUTE: u32 = fourcc(b"mute");
const DEVICE_VOLUME_SCALAR: u32 = fourcc(b"volm");

fn address(selector: u32, scope: u32) -> PropertyAddress {
    PropertyAddress { selector, scope, element: ELEMENT_MAIN }
}

fn string_property(object: AudioObjectId, selector: u32) -> String {
    let addr = address(selector, SCOPE_GLOBAL);
    let mut value: CFStringRef = std::ptr::null();
    let mut size = std::mem::size_of::<CFStringRef>() as u32;
    let status = unsafe {
        AudioObjectGetPropertyData(
            object,
            &addr,
            0,
            std::ptr::null(),
            &mut size,
            &mut value as *mut CFStringRef as *mut c_void,
        )
    };
    if status != 0 || value.is_null() {
        return String::new();
    }
    // The property getter follows the Create rule.
    unsafe { CFString::wrap_under_create_rule(value) }.to_string()
}

fn has_streams(device: AudioObjectId, scope: u32) -> bool {
    let addr = address(DEVICE_STREAMS, scope);
    let mut size = 0u32;
    let status =
        unsafe { AudioObjectGetPropertyDataSize(device, &addr, 0, std::ptr::null(), &mut size) };
    status == 0 && size as usize >= std::mem::size_of::<u32>()
}

fn default_device(selector: u32) -> AudioObjectId {
    let addr = address(selector, SCOPE_GLOBAL);
    let mut value: AudioObjectId = UNKNOWN;
    let mut size = std::mem::size_of::<AudioObjectId>() as u32;
    unsafe {
        AudioObjectGetPropertyData(
            SYSTEM_OBJECT,
            &addr,
            0,
            std::ptr::null(),
            &mut size,
            &mut value as *mut AudioObjectId as *mut c_void,
        );
    }
    value
}

fn scalar_property(device: AudioObjectId, selector: u32, scope: u32) -> Option<f32> {
    let addr = address(selector, scope);
    let mut value = 0f32;
    let mut size = std::mem::size_of::<f32>() as u32;
    let status = unsafe {
        AudioObjectGetPropertyData(
            device,
            &addr,
            0,
            std::ptr::null(),
            &mut size,
            &mut value as *mut f32 as *mut c_void,
        )
    };
    (status == 0).then_some(value)
}

fn mute_property(device: AudioObjectId, scope: u32) -> Option<bool> {
    let addr = address(DEVICE_MUTE, scope);
    let mut value = 0u32;
    let mut size = std::mem::size_of::<u32>() as u32;
    let status = unsafe {
        AudioObjectGetPropertyData(
            device,
            &addr,
            0,
            std::ptr::null(),
            &mut size,
            &mut value as *mut u32 as *mut c_void,
        )
    };
    (status == 0).then_some(value != 0)
}

fn settable(device: AudioObjectId, addr: &PropertyAddress) -> bool {
    let mut settable = 0u8;
    unsafe {
        AudioObjectHasProperty(device, addr) != 0
            && AudioObjectIsPropertySettable(device, addr, &mut settable) == 0
            && settable != 0
    }
}

/// `kAudioDevicePropertyMute` is a UInt32 (0 or 1), not a Float32.
fn set_mute_property(device: AudioObjectId, scope: u32, muted: bool) -> bool {
    let addr = address(DEVICE_MUTE, scope);
    if !settable(device, &addr) {
        return false;
    }
    let value = muted as u32;
    unsafe {
        AudioObjectSetPropertyData(
            device,
            &addr,
            0,
            std::ptr::null(),
            std::mem::size_of::<u32>() as u32,
            &value as *const u32 as *const c_void,
        ) == 0
    }
}

fn set_scalar_property(device: AudioObjectId, selector: u32, scope: u32, value: f32) -> bool {
    let addr = address(selector, scope);
    if !settable(device, &addr) {
        return false;
    }
    unsafe {
        AudioObjectSetPropertyData(
            device,
            &addr,
            0,
            std::ptr::null(),
            std::mem::size_of::<f32>() as u32,
            &value as *const f32 as *const c_void,
        ) == 0
    }
}

fn device_ids() -> Vec<AudioObjectId> {
    let addr = address(HW_DEVICES, SCOPE_GLOBAL);
    let mut size = 0u32;
    if unsafe { AudioObjectGetPropertyDataSize(SYSTEM_OBJECT, &addr, 0, std::ptr::null(), &mut size) }
        != 0
    {
        return Vec::new();
    }
    let count = size as usize / std::mem::size_of::<AudioObjectId>();
    let mut ids = vec![UNKNOWN; count];
    let status = unsafe {
        AudioObjectGetPropertyData(
            SYSTEM_OBJECT,
            &addr,
            0,
            std::ptr::null(),
            &mut size,
            ids.as_mut_ptr() as *mut c_void,
        )
    };
    if status != 0 {
        return Vec::new();
    }
    ids.truncate(size as usize / std::mem::size_of::<AudioObjectId>());
    ids
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevice {
    pub uid: String,
    pub name: String,
    pub input: bool,
    pub output: bool,
    pub default_input: bool,
    pub default_output: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AudioStatus {
    pub devices: Vec<AudioDevice>,
    pub mic_muted: bool,
    pub input_volume: f32,
    pub can_mute_input: bool,
}

fn audio_devices() -> Vec<AudioDevice> {
    let default_input = default_device(HW_DEFAULT_INPUT);
    let default_output = default_device(HW_DEFAULT_OUTPUT);
    device_ids()
        .into_iter()
        .filter_map(|device| {
            let uid = string_property(device, DEVICE_UID);
            let name = string_property(device, OBJECT_NAME);
            if uid.is_empty() || name.is_empty() {
                return None;
            }
            let input = has_streams(device, SCOPE_INPUT);
            let output = has_streams(device, SCOPE_OUTPUT);
            if !input && !output {
                return None;
            }
            Some(AudioDevice {
                uid,
                name,
                input,
                output,
                default_input: device == default_input,
                default_output: device == default_output,
            })
        })
        .collect()
}

fn read_status() -> AudioStatus {
    let input = default_device(HW_DEFAULT_INPUT);
    let mute = mute_property(input, SCOPE_INPUT);
    let volume = scalar_property(input, DEVICE_VOLUME_SCALAR, SCOPE_INPUT);
    AudioStatus {
        devices: audio_devices(),
        mic_muted: mute == Some(true) || volume.is_some_and(|v| v <= 0.001),
        input_volume: volume.unwrap_or(1.0),
        can_mute_input: mute.is_some() || volume.is_some(),
    }
}

fn device_for_uid(uid: &str) -> AudioObjectId {
    device_ids()
        .into_iter()
        .find(|id| string_property(*id, DEVICE_UID) == uid)
        .unwrap_or(UNKNOWN)
}

fn set_default_device(uid: &str, selector: u32) -> bool {
    let device = device_for_uid(uid);
    if device == UNKNOWN {
        return false;
    }
    let addr = address(selector, SCOPE_GLOBAL);
    unsafe {
        AudioObjectSetPropertyData(
            SYSTEM_OBJECT,
            &addr,
            0,
            std::ptr::null(),
            std::mem::size_of::<AudioObjectId>() as u32,
            &device as *const AudioObjectId as *const c_void,
        ) == 0
    }
}

fn set_input_muted(muted: bool, restore_volume: f32) -> bool {
    let input = default_device(HW_DEFAULT_INPUT);
    let wrote_mute = set_mute_property(input, SCOPE_INPUT, muted);
    let mute_matches = wrote_mute && mute_property(input, SCOPE_INPUT) == Some(muted);
    let volume = scalar_property(input, DEVICE_VOLUME_SCALAR, SCOPE_INPUT);
    if mute_matches && (muted || volume.is_none_or(|v| v > 0.001)) {
        return true;
    }
    let target = if muted { 0.0 } else { restore_volume.clamp(0.05, 1.0) };
    if !set_scalar_property(input, DEVICE_VOLUME_SCALAR, SCOPE_INPUT, target) {
        return false;
    }
    match scalar_property(input, DEVICE_VOLUME_SCALAR, SCOPE_INPUT) {
        Some(observed) if muted => observed <= 0.001,
        Some(observed) => observed > 0.001,
        None => false,
    }
}

/// Serialises audio actions and remembers the last audible input volume so an
/// unmute through the volume fallback restores a sensible level.
pub struct AudioBridge {
    last_input_volume: Mutex<f32>,
    actions: Mutex<()>,
}

#[derive(Default, Clone, Debug)]
pub struct AudioAction {
    pub action: String,
    pub input_uid: String,
    pub output_uid: String,
}

impl AudioBridge {
    pub fn new() -> Self {
        Self { last_input_volume: Mutex::new(0.75), actions: Mutex::new(()) }
    }

    pub fn status(&self) -> AudioStatus {
        let status = read_status();
        if status.input_volume.is_finite() && status.input_volume > 0.01 {
            *self.last_input_volume.lock().unwrap_or_else(|e| e.into_inner()) = status.input_volume;
        }
        status
    }

    fn set_input(&self, uid: &str) -> Result<(), String> {
        if uid.is_empty() {
            return Err("Choose a microphone first".into());
        }
        set_default_device(uid, HW_DEFAULT_INPUT)
            .then_some(())
            .ok_or_else(|| "Native operation failed".into())
    }

    fn set_output(&self, uid: &str) -> Result<(), String> {
        if uid.is_empty() {
            return Err("Choose an audio output first".into());
        }
        let ok = set_default_device(uid, HW_DEFAULT_OUTPUT);
        // Alert sounds follow the main output, matching the old helper.
        let _ = set_default_device(uid, HW_DEFAULT_SYSTEM_OUTPUT);
        ok.then_some(()).ok_or_else(|| "Native operation failed".into())
    }

    fn set_mic_muted(&self, muted: bool) -> Result<(), String> {
        let restore = *self.last_input_volume.lock().unwrap_or_else(|e| e.into_inner());
        set_input_muted(muted, restore)
            .then_some(())
            .ok_or_else(|| "Native operation failed".into())
    }

    pub fn perform(&self, action: &AudioAction) -> Result<AudioStatus, String> {
        let _serial = self.actions.lock().unwrap_or_else(|e| e.into_inner());
        match action.action.as_str() {
            "microphone-toggle" => {
                let current = self.status();
                self.set_mic_muted(!current.mic_muted)?;
            }
            "set-input" => self.set_input(&action.input_uid)?,
            "set-output" => self.set_output(&action.output_uid)?,
            "meeting-mode" => {
                if !action.output_uid.is_empty() {
                    self.set_output(&action.output_uid)?;
                }
                if !action.input_uid.is_empty() {
                    self.set_input(&action.input_uid)?;
                }
                self.set_mic_muted(false)?;
            }
            _ => return Err("Unsupported desktop action".into()),
        }
        Ok(self.status())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fourcc_matches_core_audio_constants() {
        assert_eq!(SCOPE_GLOBAL, 0x676c_6f62);
        assert_eq!(HW_DEFAULT_INPUT, 0x6449_6e20);
    }

    #[test]
    fn rejects_unknown_actions_without_touching_devices() {
        let bridge = AudioBridge::new();
        let result = bridge.perform(&AudioAction { action: "format-disk".into(), ..Default::default() });
        assert_eq!(result.unwrap_err(), "Unsupported desktop action");
        let missing = bridge.perform(&AudioAction { action: "set-input".into(), ..Default::default() });
        assert_eq!(missing.unwrap_err(), "Choose a microphone first");
    }

    #[test]
    fn status_reads_without_error() {
        let status = AudioBridge::new().status();
        assert!(status.input_volume.is_finite());
    }
}
