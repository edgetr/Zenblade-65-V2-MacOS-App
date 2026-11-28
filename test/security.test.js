import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeStore } from '../renderer/js/store.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const config = JSON.parse(read('src-tauri/tauri.conf.json'));
const capability = JSON.parse(read('src-tauri/capabilities/main.json'));
const lib = read('src-tauri/src/lib.rs');
const commands = read('src-tauri/src/commands.rs');
const hid = read('src-tauri/src/hid.rs');

test('native commands are limited to the bundled page in the main window', () => {
  assert.deepEqual(capability.windows, ['main']);
  assert.equal(capability.remote, undefined, 'no remote origin may call native commands');
  assert.equal(capability.local, true);
  // No plugin JS APIs (fs, shell, dialog, …) are exposed to the page.
  const plugins = capability.permissions.filter((p) => p.includes(':'));
  assert.deepEqual(plugins.sort(), [
    'core:event:allow-listen',
    'core:event:allow-unlisten',
    'core:window:allow-set-title',
  ]);
  // Commands also re-check the caller, like Electron's trustedSender.
  const sources = [commands, hid];
  const handlers = sources.flatMap((source) =>
    [...source.matchAll(/#\[tauri::command\]\npub (?:async )?fn (\w+)\(/g)].map((m) => [source, m[1]]));
  assert.equal(handlers.length, 15);
  for (const [source, name] of handlers) {
    const body = source.slice(source.indexOf(`fn ${name}(`));
    assert.match(body.slice(0, 500), /trusted(?:_webview)?\(&webview\)/, `${name} checks its caller`);
  }
});

test('window policy blocks navigation away from the app and new windows', () => {
  assert.match(lib, /\.on_navigation\(trusted_url\)/);
  assert.match(lib, /\.on_new_window\(\|_, _\| NewWindowResponse::Deny\)/);
  assert.match(lib, /url\.scheme\(\) == "tauri" && url\.host_str\(\) == Some\("localhost"\) && url\.path\(\) == APP_PAGE/);
  assert.match(lib, /pub const APP_PAGE: &str = "\/renderer\/index\.html";/);
});

test('the content security policy keeps scripts local and only allows IPC connections', () => {
  const csp = config.app.security.csp;
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-src 'none'/);
  assert.match(csp, /connect-src 'self' ipc: http:\/\/ipc\.localhost(;|$)/);
});

test('updates are only accepted from signed GitHub release builds', () => {
  const updater = config.plugins.updater;
  assert.match(updater.pubkey, /^[A-Za-z0-9+/=]{100,}$/);
  assert.deepEqual(updater.endpoints, [
    'https://github.com/edgetr/Zenblade-65-V2-MacOS-App/releases/latest/download/latest.json',
  ]);
});

test('profile normalization excludes prototype keys while retaining actual keyboard overrides', () => {
  const raw = JSON.parse('{"profiles":[{"keyOverrides":{"__proto__":{"press":1},"constructor":{"press":1},"A":{"press":12}},"appNotes":{"__proto__":{"macro":"bad"},"toString":{"macro":"bad"},"A":{"macro":"ok"}}}]}');
  const profile = normalizeStore(raw, { A: 1 }).profiles[0];
  assert.deepEqual(Object.keys(profile.keyOverrides), ['A']);
  assert.deepEqual(Object.keys(profile.appNotes), ['A']);
  assert.equal(Object.getPrototypeOf(profile.keyOverrides), Object.prototype);
  assert.equal(profile.keyOverrides.A.press, 12);
});
