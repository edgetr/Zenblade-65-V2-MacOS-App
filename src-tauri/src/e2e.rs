//! Test-only harness (`--features e2e`): forwards the page console to stdout
//! and can inject a scripted UI test from `ZEN_E2E_SCRIPT`.

/// Grants the test commands to the main window; only compiled into e2e builds.
pub const CAPABILITY: &str = r#"{
  "identifier": "e2e-harness",
  "windows": ["main"],
  "local": true,
  "permissions": ["allow-e2e-log", "allow-e2e-window", "allow-e2e-snapshot"]
}"#;

#[tauri::command]
pub fn e2e_log(level: String, message: String) {
    println!("[page:{level}] {message}");
}

/// Lets a scripted test hide/show the main window like the tray would.
#[tauri::command]
pub fn e2e_window(app: tauri::AppHandle, action: String) {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window(crate::MAIN_WINDOW) {
        match action.as_str() {
            "hide" => {
                let _ = window.hide();
            }
            "show" => crate::show_main_window(&app, None),
            "close" => {
                let _ = window.close();
            }
            "docs-size" => {
                let _ = window.set_size(tauri::LogicalSize::new(1200.0, 720.0));
            }
            _ => {}
        }
    }
}

/// Captures the main window (with its frame) to `$ZEN_E2E_OUT/<name>.png`.
#[tauri::command]
pub async fn e2e_snapshot(app: tauri::AppHandle, name: String) -> Result<(), String> {
    use tauri::Manager;
    let window = app.get_webview_window(crate::MAIN_WINDOW).ok_or("no window")?;
    let ns_window = window.ns_window().map_err(|e| e.to_string())? as *const objc2::runtime::AnyObject;
    let number: isize = unsafe { objc2::msg_send![&*ns_window, windowNumber] };
    let dir = std::env::var("ZEN_E2E_OUT").map_err(|_| "ZEN_E2E_OUT unset")?;
    let safe: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
    // Documentation shots hide the traffic lights, like a page capture.
    let docs = safe.starts_with("docs-");
    let set_buttons_hidden = |hidden: bool| {
        let ns_window = ns_window as usize;
        let _ = window.run_on_main_thread(move || unsafe {
            let ns_window = &*(ns_window as *const objc2::runtime::AnyObject);
            for kind in 0isize..3 {
                let button: *mut objc2::runtime::AnyObject = objc2::msg_send![ns_window, standardWindowButton: kind];
                if let Some(button) = button.as_ref() {
                    let _: () = objc2::msg_send![button, setHidden: hidden];
                }
            }
        });
        std::thread::sleep(std::time::Duration::from_millis(150));
    };
    if docs {
        set_buttons_hidden(true);
    }
    let status = std::process::Command::new("/usr/sbin/screencapture")
        .args(["-x", "-o", &format!("-l{number}"), &format!("{dir}/{safe}.png")])
        .status()
        .map_err(|e| e.to_string());
    if docs {
        set_buttons_hidden(false);
    }
    status?.success().then_some(()).ok_or_else(|| "screencapture failed".into())
}

/// `ZEN_E2E_OFFLINE=1`: fresh, isolated WebKit storage and no keyboard, for
/// documentation screenshots that must not contain personal settings.
pub fn offline() -> bool {
    std::env::var_os("ZEN_E2E_OFFLINE").is_some()
}

pub fn initialization_script() -> String {
    let mut script = String::from(
        r#"(function(){
  window.__e2eMarks=[];const mark=(m)=>{window.__e2eMarks.push(m);try{let el=document.getElementById('__e2e');if(!el&&document.body){el=document.createElement('pre');el.id='__e2e';el.style.cssText='position:fixed;left:240px;bottom:0;right:0;max-height:50%;overflow:auto;z-index:99999;background:#000c;color:#0f0;font:11px monospace;margin:0;padding:6px;white-space:pre-wrap';document.body.appendChild(el)}if(el)el.textContent=window.__e2eMarks.join('\n')}catch(_){}};mark('init:'+typeof window.__TAURI__);addEventListener('DOMContentLoaded',()=>mark('dom:'+typeof window.zenShell+':'+typeof navigator.hid));addEventListener('load',()=>mark('load'));
  const send=(level,args)=>{if(level!=='log')mark(level+': '+args.map(String).join(' ').slice(0,300));const message=args.map(a=>{try{return typeof a==='string'?a:(a instanceof Error?a.stack||a.message:JSON.stringify(a))}catch(_){return String(a)}}).join(' ');try{window.__TAURI__.core.invoke('e2e_log',{level,message}).catch(e=>{mark('LOGFAIL '+e)})}catch(e){mark('NOTAURI '+e)}};
  for(const level of ['log','warn','error']){const orig=console[level].bind(console);console[level]=(...a)=>{orig(...a);send(level,a)}}
  addEventListener('error',e=>send('error',['uncaught',e.message,e.filename+':'+e.lineno]));
  addEventListener('unhandledrejection',e=>send('error',['unhandled',e.reason&&(e.reason.stack||e.reason.message)||String(e.reason)]));
})();"#,
    );
    if let Ok(path) = std::env::var("ZEN_E2E_SCRIPT") {
        if let Ok(test) = std::fs::read_to_string(path) {
            script.push_str("\naddEventListener('load',()=>setTimeout(async()=>{try{\n");
            script.push_str(&test);
            script.push_str("\n}catch(e){console.error('E2E FAILED',e&&(e.stack||e.message)||String(e))}},300));");
        }
    }
    script
}
