//! Desktop integration helpers: foreground app, app bundle metadata, profile
//! file validation and process detection for status indicators.

use std::collections::{BTreeMap, HashSet};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const PS_TIMEOUT: Duration = Duration::from_millis(3000);

use objc2_app_kit::NSWorkspace;
use serde::Serialize;
use serde_json::Value;

pub const APP_BUNDLE_ID: &str = "com.local.zenblade";

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationInfo {
    pub bundle_id: String,
    pub name: String,
}

/// The frontmost application, read from NSWorkspace (no subprocesses).
pub fn front_application() -> Option<ApplicationInfo> {
    let workspace = NSWorkspace::sharedWorkspace();
    let app = workspace.frontmostApplication()?;
    let bundle_id = app.bundleIdentifier()?.to_string();
    if bundle_id.is_empty() {
        return None;
    }
    let name = app
        .localizedName()
        .map(|n| n.to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| bundle_id.clone());
    Some(ApplicationInfo { bundle_id, name })
}

pub fn read_application_metadata(app_path: &Path) -> Option<ApplicationInfo> {
    let is_app = app_path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("app"));
    if !is_app {
        return None;
    }
    let plist = plist::Value::from_file(app_path.join("Contents").join("Info.plist")).ok()?;
    let dict = plist.as_dictionary()?;
    let text = |key: &str| {
        dict.get(key)
            .and_then(|v| v.as_string())
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(str::to_string)
    };
    let bundle_id = text("CFBundleIdentifier")?;
    let name = text("CFBundleDisplayName")
        .or_else(|| text("CFBundleName"))
        .unwrap_or_else(|| {
            app_path
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default()
        });
    Some(ApplicationInfo { bundle_id, name })
}

/// Keeps the first entry per bundle id, preserving order.
pub fn dedupe_applications(values: Vec<Option<ApplicationInfo>>) -> Vec<ApplicationInfo> {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .flatten()
        .filter(|app| seen.insert(app.bundle_id.clone()))
        .collect()
}

pub fn assert_supported_profile_file(value: &Value) -> Result<(), String> {
    let record = |v: Option<&Value>| v.is_some_and(Value::is_object);
    let profile = value.get("profile");
    let ok = value.is_object()
        && value.get("format").and_then(Value::as_str) == Some("zenblade-profile")
        && value.get("version").and_then(Value::as_f64) == Some(1.0)
        && record(profile)
        && ["lighting", "actuation", "keyOverrides", "appNotes"]
            .iter()
            .all(|key| record(profile.and_then(|p| p.get(*key))));
    if ok {
        Ok(())
    } else {
        Err("This is not a supported Zenblade profile".into())
    }
}

/// Clamps an arbitrary renderer value to a profile index 0–2, like `Number(x) | 0`.
pub fn profile_index(value: &Value) -> usize {
    let number = match value {
        Value::Number(n) => n.as_f64().unwrap_or(0.0),
        Value::String(s) => s.trim().parse::<f64>().unwrap_or(0.0),
        Value::Bool(true) => 1.0,
        _ => 0.0,
    };
    let truncated = if number.is_finite() { number.trunc() } else { 0.0 };
    truncated.clamp(0.0, 2.0) as usize
}

#[derive(Clone, Debug, PartialEq)]
pub struct Detector {
    pub id: String,
    pub matcher: String,
}

fn clip(value: &str, max: usize) -> String {
    value.chars().take(max).collect()
}

pub fn normalize_detectors(values: &Value) -> Vec<Detector> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for value in values.as_array().map(Vec::as_slice).unwrap_or_default() {
        let text = |key: &str| match value.get(key) {
            Some(Value::String(s)) => s.clone(),
            Some(Value::Number(n)) => n.to_string(),
            Some(Value::Bool(b)) => b.to_string(),
            _ => String::new(),
        };
        let id = clip(text("id").trim(), 80);
        let matcher = clip(&text("match").trim().to_lowercase(), 80);
        if id.is_empty() || matcher.is_empty() || !seen.insert(id.clone()) {
            continue;
        }
        result.push(Detector { id, matcher });
    }
    result
}

pub fn match_processes(detectors: &[Detector], process_text: &str) -> BTreeMap<String, bool> {
    let haystack = process_text.to_lowercase();
    detectors
        .iter()
        .map(|detector| {
            let found = detector
                .matcher
                .split(',')
                .map(str::trim)
                .filter(|term| !term.is_empty())
                .any(|term| haystack.contains(term));
            (detector.id.clone(), found)
        })
        .collect()
}

pub fn scan_processes(detectors: &[Detector]) -> Result<BTreeMap<String, bool>, String> {
    if detectors.is_empty() {
        return Ok(BTreeMap::new());
    }
    let mut child = Command::new("/bin/ps")
        .args(["-axo", "pid=,comm=,args="])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    let mut stdout = child.stdout.take().ok_or("Process scan failed")?;
    // Read on a helper thread so a hung `ps` can be killed after the timeout.
    let reader = std::thread::spawn(move || {
        let mut text = Vec::new();
        let _ = std::io::Read::read_to_end(&mut stdout, &mut text);
        text
    });
    let deadline = Instant::now() + PS_TIMEOUT;
    loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(status) if status.success() => break,
            Some(_) => return Err("Process scan failed".into()),
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Process scan timed out".into());
            }
            None => std::thread::sleep(Duration::from_millis(10)),
        }
    }
    let text = reader.join().map_err(|_| "Process scan failed".to_string())?;
    Ok(match_processes(detectors, &String::from_utf8_lossy(&text)))
}

/// Accepts only the global shortcuts the System panel can configure.
pub fn allowed_system_accelerator(value: &str) -> bool {
    if let Some(n) = value.strip_prefix("F1") {
        if matches!(n, "3" | "4" | "5" | "6") {
            return true;
        }
    }
    let parts: Vec<&str> = value.split('+').collect();
    let Some((key, modifiers)) = parts.split_last() else {
        return false;
    };
    !modifiers.is_empty()
        && modifiers
            .iter()
            .all(|m| matches!(*m, "Command" | "Control" | "Alt" | "Shift"))
        && matches!(*key, "Home" | "PageUp" | "PageDown" | "End")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn profile_files_require_the_supported_shape() {
        let supported = json!({
            "format": "zenblade-profile",
            "version": 1,
            "profile": { "lighting": {}, "actuation": {}, "keyOverrides": {}, "appNotes": {} }
        });
        assert!(assert_supported_profile_file(&supported).is_ok());
        let mut wrong_version = supported.clone();
        wrong_version["version"] = json!(2);
        assert!(assert_supported_profile_file(&wrong_version).is_err());
        let mut array_overrides = supported.clone();
        array_overrides["profile"]["keyOverrides"] = json!([]);
        assert!(assert_supported_profile_file(&array_overrides).is_err());
        assert!(assert_supported_profile_file(&json!([])).is_err());
    }

    #[test]
    fn profile_index_clamps_like_the_renderer() {
        assert_eq!(profile_index(&json!(1)), 1);
        assert_eq!(profile_index(&json!(9)), 2);
        assert_eq!(profile_index(&json!(-3)), 0);
        assert_eq!(profile_index(&json!("2")), 2);
        assert_eq!(profile_index(&json!(null)), 0);
        assert_eq!(profile_index(&json!(1.9)), 1);
    }

    #[test]
    fn detectors_are_trimmed_lowercased_and_unique() {
        let detectors = normalize_detectors(&json!([
            { "id": " agent ", "match": " Codex, Claude " },
            { "id": "agent", "match": "duplicate" },
            { "id": "", "match": "x" },
            { "id": "y" }
        ]));
        assert_eq!(detectors, vec![Detector { id: "agent".into(), matcher: "codex, claude".into() }]);
        let found = match_processes(&detectors, "123 /usr/bin/Claude --serve");
        assert_eq!(found.get("agent"), Some(&true));
        let missing = match_processes(&detectors, "1 launchd");
        assert_eq!(missing.get("agent"), Some(&false));
        assert!(normalize_detectors(&json!("nope")).is_empty());
    }

    #[test]
    fn accelerators_are_limited_to_system_keys() {
        for ok in ["F13", "F16", "Command+Home", "Control+Alt+PageDown", "Shift+End"] {
            assert!(allowed_system_accelerator(ok), "{ok}");
        }
        for bad in ["F12", "F17", "Home", "Command+A", "Super+Home", "Command+", "+Home"] {
            assert!(!allowed_system_accelerator(bad), "{bad}");
        }
    }

    #[test]
    fn reads_bundle_metadata() {
        let finder = read_application_metadata(Path::new("/System/Library/CoreServices/Finder.app"));
        assert_eq!(finder.map(|a| a.bundle_id), Some("com.apple.finder".into()));
        assert!(read_application_metadata(Path::new("/bin/ls")).is_none());
    }
}
