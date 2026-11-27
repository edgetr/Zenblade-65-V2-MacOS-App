//! One-time import of profiles saved by the Electron build.
//!
//! Electron kept `localStorage` in Chromium's LevelDB under
//! `~/Library/Application Support/Zenblade/Local Storage/leveldb`. WebKit uses
//! its own store, so on first launch the saved profile JSON is copied into the
//! new page's `localStorage` (only when that key is still empty, so the page's
//! own store always wins). After the installed app has loaded once with the
//! seed, a marker stops further LevelDB reads.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager};

pub const STORAGE_KEY: &str = "zenblade.profiles.v2";

const MARKER: &str = "electron-profiles-imported";

/// Only the installed bundle marks the import done: development binaries use a
/// different WebKit store and must not stop the real app from importing.
fn marker_path(app: &AppHandle) -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let bundled = exe.to_string_lossy().contains(".app/Contents/MacOS/");
    if !bundled {
        return None;
    }
    app.path().app_data_dir().ok().map(|dir| dir.join(MARKER))
}

pub fn mark_imported(app: &AppHandle) {
    let Some(marker) = marker_path(app) else { return };
    if let Some(parent) = marker.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(marker, b"1\n");
}

fn legacy_dir() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(Path::new(&home).join("Library/Application Support/Zenblade/Local Storage/leveldb"))
}

/// Chromium stores values with a one-byte encoding prefix: 0 = UTF-16LE,
/// 1 = Latin-1.
pub fn decode_value(raw: &[u8]) -> Option<String> {
    let (kind, body) = raw.split_first()?;
    match kind {
        0 => {
            if body.len() % 2 != 0 {
                return None;
            }
            let units: Vec<u16> = body.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
            String::from_utf16(&units).ok()
        }
        1 => Some(body.iter().map(|&b| b as char).collect()),
        _ => None,
    }
}

pub fn storage_key(origin: &str, key: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(origin.len() + key.len() + 3);
    out.push(b'_');
    out.extend_from_slice(origin.as_bytes());
    out.push(0);
    out.push(1);
    out.extend_from_slice(key.as_bytes());
    out
}

/// Reads the saved profile JSON from a copy of the LevelDB directory, so the
/// original is never locked or compacted.
pub fn read_legacy_value(dir: &Path) -> Option<String> {
    if !dir.join("CURRENT").is_file() {
        return None;
    }
    let nonce = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let scratch = std::env::temp_dir().join(format!("zenblade-legacy-{}-{nonce}", std::process::id()));
    // `create_dir` (not `_all`) fails if anything already sits at this path.
    std::fs::create_dir(&scratch).ok()?;
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let name = entry.file_name();
        if name == "LOCK" || !entry.path().is_file() {
            continue;
        }
        std::fs::copy(entry.path(), scratch.join(&name)).ok()?;
    }
    let value = (|| {
        let options = rusty_leveldb::Options { create_if_missing: false, ..Default::default() };
        let mut db = rusty_leveldb::DB::open(&scratch, options).ok()?;
        let raw = db.get(&storage_key("file://", STORAGE_KEY))?;
        let text = decode_value(&raw)?;
        serde_json::from_str::<serde_json::Value>(&text).ok()?;
        Some(text)
    })();
    let _ = std::fs::remove_dir_all(&scratch);
    value
}

/// A document-start script that seeds `localStorage` with the legacy profiles
/// when the new store is still empty.
pub fn initialization_script(app: &AppHandle) -> Option<String> {
    if marker_path(app).is_some_and(|marker| marker.exists()) {
        return None;
    }
    let value = read_legacy_value(&legacy_dir()?)?;
    let key = serde_json::to_string(STORAGE_KEY).ok()?;
    let value = serde_json::to_string(&value).ok()?;
    Some(format!(
        "(function(){{try{{if(location.protocol==='tauri:'&&localStorage.getItem({key})===null){{localStorage.setItem({key},{value});}}}}catch(_){{}}}})();"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_both_chromium_encodings() {
        assert_eq!(decode_value(&[1, b'{', b'}']), Some("{}".into()));
        assert_eq!(decode_value(&[0, b'{', 0, b'}', 0]), Some("{}".into()));
        assert_eq!(decode_value(&[0, b'{']), None);
        assert_eq!(decode_value(&[]), None);
    }

    #[test]
    fn builds_chromium_local_storage_keys() {
        assert_eq!(storage_key("file://", "k"), b"_file://\x00\x01k".to_vec());
    }

    #[test]
    fn imports_from_a_leveldb_written_like_chromium() {
        let dir = std::env::temp_dir().join(format!("zenblade-migrate-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        {
            let mut db = rusty_leveldb::DB::open(&dir, rusty_leveldb::Options::default()).unwrap();
            let mut value = vec![1u8];
            value.extend_from_slice(br#"{"version":2}"#);
            db.put(&storage_key("file://", STORAGE_KEY), &value).unwrap();
            db.flush().unwrap();
        }
        assert_eq!(read_legacy_value(&dir), Some(r#"{"version":2}"#.into()));
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(read_legacy_value(&dir), None);
    }
}
