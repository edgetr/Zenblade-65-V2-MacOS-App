//! "Open at login" through a per-user LaunchAgent. A LaunchAgent (rather than
//! SMAppService, which needs macOS 13) works on every supported macOS and can
//! pass `--hidden`, so a login launch starts quietly in the menu bar.

use std::path::{Path, PathBuf};

const LABEL: &str = "com.local.zenblade.login";
pub const HIDDEN_ARG: &str = "--hidden";

fn agent_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(PathBuf::from(home).join("Library/LaunchAgents").join(format!("{LABEL}.plist")))
}

/// The enclosing `.app` bundle; `None` for development builds.
fn bundle_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    exe.ancestors()
        .find(|path| path.extension().is_some_and(|ext| ext == "app"))
        .map(Path::to_path_buf)
}

fn agent_plist(bundle: &Path) -> plist::Value {
    let mut dict = plist::Dictionary::new();
    dict.insert("Label".into(), LABEL.into());
    dict.insert(
        "ProgramArguments".into(),
        plist::Value::Array(
            ["/usr/bin/open", "-g", "-a", &bundle.to_string_lossy(), "--args", HIDDEN_ARG]
                .into_iter()
                .map(plist::Value::from)
                .collect(),
        ),
    );
    dict.insert("RunAtLoad".into(), true.into());
    dict.insert("ProcessType".into(), "Interactive".into());
    plist::Value::Dictionary(dict)
}

pub fn enabled() -> bool {
    agent_path().is_some_and(|path| path.exists())
}

pub fn set(enabled: bool) -> Result<bool, String> {
    let path = agent_path().ok_or("Home folder not found")?;
    if !enabled {
        match std::fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
        return Ok(false);
    }
    let bundle = bundle_path().ok_or("Open at login needs the installed Zenblade app")?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    agent_plist(&bundle).to_file_xml(&path).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Keeps an existing agent pointing at this copy of the app after a move.
pub fn refresh() {
    if enabled() && bundle_path().is_some() {
        let _ = set(true);
    }
}

pub fn launched_hidden() -> bool {
    std::env::args().any(|arg| arg == HIDDEN_ARG)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_opens_the_bundle_hidden() {
        let value = agent_plist(Path::new("/Applications/Zenblade.app"));
        let dict = value.as_dictionary().unwrap();
        assert_eq!(dict.get("Label").and_then(plist::Value::as_string), Some(LABEL));
        let args: Vec<_> = dict
            .get("ProgramArguments")
            .and_then(plist::Value::as_array)
            .unwrap()
            .iter()
            .filter_map(plist::Value::as_string)
            .collect();
        assert_eq!(
            args,
            ["/usr/bin/open", "-g", "-a", "/Applications/Zenblade.app", "--args", "--hidden"]
        );
        assert_eq!(dict.get("RunAtLoad").and_then(plist::Value::as_boolean), Some(true));
    }
}
