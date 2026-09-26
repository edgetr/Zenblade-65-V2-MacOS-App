import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { normalizeStore } from '../renderer/js/store.js';

const require = createRequire(import.meta.url);
const { createRendererSecurity } = require('../electron/security.js');
const { vendorId, productIds } = require('../shared/device-ids.json');

function setup() {
  const url = pathToFileURL('/Applications/Zenblade.app/Contents/Resources/app.asar/renderer/index.html').href;
  const frame = { url };
  const contents = { getURL: () => frame.url, mainFrame: frame, isDestroyed: () => false };
  const security = createRendererSecurity('/Applications/Zenblade.app/Contents/Resources/app.asar/renderer/index.html', () => contents);
  return { url, frame, contents, security };
}

test('registered IPC handlers reject foreign windows, subframes and navigated documents', () => {
  const { contents, frame, security } = setup();
  let invoke;
  let calls = 0;
  security.handle({ handle: (_name, handler) => { invoke = handler; } }, 'test:action', (_event, value) => { calls++; return value; });
  assert.equal(invoke({ sender: contents, senderFrame: frame }, 'allowed'), 'allowed');
  for (const event of [
    { sender: { ...contents }, senderFrame: frame },
    { sender: contents, senderFrame: { ...frame } },
    { sender: contents, senderFrame: null },
  ]) assert.throws(() => invoke(event), /Untrusted renderer/);
  for (const url of ['https://example.com/', 'file:///etc/passwd', 'about:blank', `${frame.url}?foreign=1`]) {
    frame.url = url;
    assert.throws(() => invoke({ sender: contents, senderFrame: frame }), /Untrusted renderer/);
  }
  assert.equal(calls, 1);
});

test('registered permission handlers limit HID to the app frame and supported keyboard IDs', () => {
  const { url, frame, contents, security } = setup();
  const handlers = {};
  security.configureSession({
    setPermissionRequestHandler: handler => { handlers.request = handler; },
    setPermissionCheckHandler: handler => { handlers.check = handler; },
    setDevicePermissionHandler: handler => { handlers.device = handler; },
    on: (name, handler) => { handlers[name] = handler; },
  });
  const details = { isMainFrame: true, requestingUrl: url };
  assert.equal(handlers.check(contents, 'hid', 'file://', details), true);
  assert.equal(handlers.check(contents, 'media', 'file://', details), false);
  assert.equal(handlers.check(contents, 'hid', 'file://', { ...details, isMainFrame: false }), false);
  assert.equal(handlers.check(contents, 'hid', 'file://', { ...details, requestingUrl: 'https://example.com/' }), false);
  let requested;
  handlers.request(contents, 'media', value => { requested = value; });
  assert.equal(requested, false);
  const supported = { deviceId: 'keyboard', vendorId, productId: productIds[0] };
  const permission = { deviceType: 'hid', origin: 'file://', device: supported };
  assert.equal(handlers.device(permission), true);
  assert.equal(handlers.device({ ...permission, deviceType: 'usb' }), false);
  assert.equal(handlers.device({ ...permission, origin: 'https://example.com' }), false);
  assert.equal(handlers.device({ ...permission, device: { ...supported, vendorId: 1 } }), false);
  assert.equal(handlers.device({ ...permission, device: { ...supported, productId: 1 } }), false);
  let picked;
  const event = { preventDefault() {} };
  handlers['select-hid-device'](event, { frame, deviceList: [{ ...supported, vendorId: 1, deviceId: 'other' }, supported] }, value => { picked = value; });
  assert.equal(picked, 'keyboard');
  handlers['select-hid-device'](event, { frame: { ...frame }, deviceList: [supported] }, value => { picked = value; });
  assert.equal(picked, '');
});

test('window policy blocks OS URL schemes, navigation, and embedded webviews', () => {
  const { security } = setup();
  const handlers = {};
  security.protectWindow({
    setWindowOpenHandler: handler => { handlers.open = handler; },
    on: (name, handler) => { handlers[name] = handler; },
  });
  for (const url of ['https://example.com', 'file:///Applications/Other.app', 'some-app://action']) {
    assert.deepEqual(handlers.open({ url }), { action: 'deny' });
  }
  for (const name of ['will-navigate', 'will-frame-navigate', 'will-attach-webview']) {
    let blocked = false;
    handlers[name]({ preventDefault() { blocked = true; } });
    assert.equal(blocked, true);
  }
});

test('profile normalization excludes prototype keys while retaining actual keyboard overrides', () => {
  const raw = JSON.parse('{"profiles":[{"keyOverrides":{"__proto__":{"press":1},"constructor":{"press":1},"A":{"press":12}},"appNotes":{"__proto__":{"macro":"bad"},"toString":{"macro":"bad"},"A":{"macro":"ok"}}}]}');
  const profile = normalizeStore(raw, { A: 1 }).profiles[0];
  assert.deepEqual(Object.keys(profile.keyOverrides), ['A']);
  assert.deepEqual(Object.keys(profile.appNotes), ['A']);
  assert.equal(Object.getPrototypeOf(profile.keyOverrides), Object.prototype);
  assert.equal(profile.keyOverrides.A.press, 12);
});
