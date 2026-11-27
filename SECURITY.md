# Security and privacy

Zenblade is an independent, open-source keyboard utility. The source is available for inspection and building your own copy; this document describes its access and safeguards, not a guarantee that the software has no vulnerabilities.

## What the app accesses

- **Keyboard:** the Rust HID layer (hidapi) only lists and opens vendor-defined interfaces of Pwnage vendor ID `0x3662` with product IDs `0x1001` / `0x1002`, in shared (non-exclusive) mode. It never opens the typing interface, so no Input Monitoring permission is needed. The app can read and change supported keyboard settings. A USB hub does not change this device matching.
- **Local settings:** profiles and app rules live in the app's WebKit local storage (`~/Library/WebKit/com.local.zenblade`). On first launch after upgrading from V0.1, saved profiles are copied from the Electron build's storage; the old files are left untouched. They are not encrypted. Imports and exports use macOS file dialogs; exports can include application names, audio-device identifiers, and process-matching rules, so inspect them before sharing.
- **Desktop integration:** optional automatic switching reads the foreground application's name and bundle identifier. Configured status rules can match local process names/arguments; the renderer receives match booleans, not the process listing.
- **Audio controls:** the app reads CoreAudio device information in-process and can change the default input/output device or microphone mute/volume when a configured action runs. It does not record audio.
- **Networking:** the application has no accounts, analytics, cloud sync, or remote app content. Its page loads bundled files under a local-only Content Security Policy. The only network request is the update check: the app downloads `latest.json` from this repository's GitHub releases at launch, daily, and on request, and installs an update only after you confirm it and its signature matches the key built into the app.

## Application boundaries

The interface runs in the system WebKit with no Node.js or general file/shell APIs. Tauri capabilities grant the native commands only to the main window's bundled page, and each command re-checks the caller's URL. Navigation away from the bundled page and new windows are blocked. No Tauri plugin JavaScript API (file system, shell, dialogs) is exposed to the page; dialogs and file access happen in Rust.

Profile imports are limited to 1 MiB, checked for the supported format, normalized to supported values, and confirmed before replacing local settings. Imported key maps discard inherited object-property names. The only subprocess is a fixed `/bin/ps` invocation with an argument array (for configured status rules), without shell interpolation or a general-purpose command runner.

Review the implementation in [`src-tauri/capabilities/main.json`](src-tauri/capabilities/main.json), [`src-tauri/src/commands.rs`](src-tauri/src/commands.rs), [`src-tauri/src/hid.rs`](src-tauri/src/hid.rs), [`src-tauri/src/audio.rs`](src-tauri/src/audio.rs), [`src-tauri/src/updater.rs`](src-tauri/src/updater.rs), [`renderer/js/native-shell.js`](renderer/js/native-shell.js), and [`renderer/js/store.js`](renderer/js/store.js). The app is a normal user-level macOS process; this is not macOS App Sandbox or Apple notarization.

## Downloads and first launch

Release DMGs are **ad-hoc signed**, without an Apple Developer ID certificate or Apple notarization. macOS may block first launch. If you trust the download, try opening the app, then use **System Settings → Privacy & Security → Open Anyway**, and confirm **Open**. On macOS 12, use System Preferences → Security & Privacy. See [Apple's instructions](https://support.apple.com/en-us/102445).

The release includes a SHA-256 checksum. Save it next to the DMG and run:

```bash
shasum -a 256 -c Zenblade-0.2.0-arm64.dmg.sha256
```

A matching checksum verifies that your file matches the release asset; it does not independently establish that the app is safe. You can instead [build from source](README.md#build-from-source).

In-app updates are verified with a minisign signature before installation instead of a checksum; the private signing key is held by the maintainer and is not in this repository.

## Review scope

V0.1 received a source review focused on renderer isolation, IPC, HID permissions, profile imports, native subprocesses, and dependency advisories. Automated tests cover these boundaries and the existing model/protocol behavior. V0.2 replaced the Electron host with Rust/Tauri; its IPC boundary, HID filtering and updater configuration are covered by `test/security.test.js`, `test/native-shell.test.js` and the Rust unit tests. Dependency results are a point-in-time check, not a continuing assurance.

This is not an independent security audit. Older macOS versions and every firmware/hub combination have not been tested. Do not use a general security override or disable Gatekeeper to run this app.

## Reporting a problem

For a suspected vulnerability, [open a minimal issue](https://github.com/edgetr/Zenblade-65-V2-MacOS-App/issues) requesting a private follow-up before posting sensitive data or exploit details. For ordinary bugs, include the app version, macOS version, keyboard model, and steps to reproduce. Never include passwords, tokens, private profile exports, or full process listings.
