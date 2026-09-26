# Security and privacy

Zenblade is an independent, open-source keyboard utility. The source is available for inspection and building your own copy; this document describes its access and safeguards, not a guarantee that the software has no vulnerabilities.

## What the app accesses

- **Keyboard:** WebHID connects to Pwnage vendor ID `0x3662` and the supported product IDs `0x1001` / `0x1002`. The app can read and change supported keyboard settings. A USB hub does not change this device matching.
- **Local settings:** profiles and app rules live in Electron's local user-data directory. They are not encrypted. Imports and exports use macOS file dialogs; exports can include application names, audio-device identifiers, and process-matching rules, so inspect them before sharing.
- **Desktop integration:** optional automatic switching reads the foreground application's name and bundle identifier. Configured status rules can match local process names/arguments; the renderer receives match booleans, not the process listing.
- **Audio controls:** the bundled `zenbridge` helper reads CoreAudio device information and can change the default input/output device or microphone mute/volume when a configured action runs. It does not record audio.
- **Networking:** the application has no accounts, analytics, cloud sync, or remote app content. Its renderer loads bundled files under a local-only Content Security Policy. There is no automatic updater; download updates from this repository's releases.

## Application boundaries

The renderer uses Electron's sandbox and context isolation with Node integration disabled. IPC handlers accept only the main window's bundled app document. Navigation, extra windows, webviews, and unrelated browser permissions are blocked. HID permission checks restrict access to the supported device IDs and the app's main frame.

Profile imports are limited to 1 MiB, checked for the supported format, normalized to supported values, and confirmed before replacing local settings. Imported key maps discard inherited object-property names. Native helpers run fixed executables with argument arrays, without shell interpolation or a general-purpose command runner.

Review the implementation in [`electron/security.js`](electron/security.js), [`electron/preload.js`](electron/preload.js), [`electron/desktop.js`](electron/desktop.js), [`electron/system-bridge.js`](electron/system-bridge.js), [`native/zenbridge.m`](native/zenbridge.m), and [`renderer/js/store.js`](renderer/js/store.js). The host remains a normal user-level macOS process; Electron's renderer sandbox is not macOS App Sandbox or Apple notarization.

## Downloads and first launch

The V0.1 DMG is **ad-hoc signed**, without an Apple Developer ID certificate or Apple notarization. macOS may block first launch. If you trust the download, try opening the app, then use **System Settings → Privacy & Security → Open Anyway**, and confirm **Open**. On macOS 12, use System Preferences → Security & Privacy. See [Apple's instructions](https://support.apple.com/en-us/102445).

The release includes a SHA-256 checksum. Save it next to the DMG and run:

```bash
shasum -a 256 -c Zenblade-0.1.0-arm64.dmg.sha256
```

A matching checksum verifies that your file matches the release asset; it does not independently establish that the app is safe. You can instead [build from source](README.md#build-from-source).

## Review scope

V0.1 received a source review focused on renderer isolation, IPC, HID permissions, profile imports, native subprocesses, and dependency advisories. Automated tests cover these boundaries and the existing model/protocol behavior. Dependency results are a point-in-time check, not a continuing assurance; `npm audit` can change as new advisories are published.

This is not an independent security audit. Older macOS versions and every firmware/hub combination have not been tested. Do not use a general security override or disable Gatekeeper to run this app.

## Reporting a problem

For a suspected vulnerability, [open a minimal issue](https://github.com/edgetr/Zenblade-65-V2-MacOS-App/issues) requesting a private follow-up before posting sensitive data or exploit details. For ordinary bugs, include the app version, macOS version, keyboard model, and steps to reproduce. Never include passwords, tokens, private profile exports, or full process listings.
