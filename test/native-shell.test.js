import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../renderer/js/native-shell.js", import.meta.url), "utf8");

// The preload API the renderer was written against under Electron.
const ELECTRON_PRELOAD_API = [
  "getInfo",
  "getActiveApplication",
  "chooseApplications",
  "exportProfile",
  "importProfile",
  "getSystemContext",
  "configureSystemShortcuts",
  "setDesktopState",
  "onReconnect",
  "onNavigate",
  "onSelectProfile",
  "onToggleLights",
  "onToggleAutomation",
  "onActiveApplication",
  "onWake",
  "onSuspend",
  "onSystemContext",
  "onSystemActionError",
];

function boot({ devices = [], fail = {} } = {}) {
  const calls = [];
  const listeners = new Map();
  const titles = [];
  class Channel {
    constructor() {
      this.onmessage = null;
    }
  }
  const tauri = {
    core: {
      Channel,
      invoke: async (command, args) => {
        calls.push({ command, args });
        if (fail[command]) throw fail[command];
        if (command === "hid_get_devices") return structuredClone(devices);
        return { ok: true };
      },
    },
    event: {
      listen: async (name, handler) => {
        listeners.set(name, handler);
        return () => listeners.delete(name);
      },
    },
    window: {
      getCurrentWindow: () => ({ setTitle: async (title) => titles.push(title) }),
    },
  };
  class Navigator {}
  const sandbox = {
    __TAURI__: tauri,
    navigator: new Navigator(),
    Navigator,
    document: { title: "Keyboard — Zenblade", head: {} },
    MutationObserver: class {
      observe() {}
    },
    EventTarget,
    Event,
    DOMException,
    DataView,
    Uint8Array,
    ArrayBuffer,
    TypeError,
    Error,
    Promise,
    structuredClone,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  const emit = (name, payload) => listeners.get(name)?.({ payload });
  return { sandbox, calls, listeners, emit, titles };
}

// Values created inside the vm realm have foreign prototypes; compare as data.
const plain = (value) => JSON.parse(JSON.stringify(value));
const flush = () => new Promise((resolve) => setImmediate(resolve));
const zenblade = {
  id: "DevSrvsID:42",
  vendorId: 13922,
  productId: 4098,
  productName: "Zenblade v2 8K",
  collections: [{ usagePage: 0xff60, usage: 0x61, outputReports: [{ reportId: 0 }] }],
};

test("zenShell keeps the exact Electron preload API and is immutable", () => {
  const { sandbox } = boot();
  assert.deepEqual(plain(Object.keys(sandbox.zenShell).sort()), [...ELECTRON_PRELOAD_API].sort());
  assert.equal(Object.isFrozen(sandbox.zenShell), true);
  assert.throws(() => {
    "use strict";
    sandbox.zenShell = {};
  });
});

test("zenShell maps calls onto Rust commands with named arguments", async () => {
  const { sandbox, calls } = boot();
  await sandbox.zenShell.importProfile(2);
  await sandbox.zenShell.exportProfile({ profile: 1, data: { format: "zenblade-profile" } });
  await sandbox.zenShell.getSystemContext();
  sandbox.zenShell.setDesktopState({ connected: true, profile: 1 });
  await flush();
  assert.deepEqual(plain(calls.map((c) => [c.command, c.args])), [
    ["app_import_profile", { targetProfile: 2 }],
    ["app_export_profile", { payload: { profile: 1, data: { format: "zenblade-profile" } } }],
    ["app_get_system_context", { detectors: null }],
    ["app_set_desktop_state", { next: { connected: true, profile: 1 } }],
  ]);
});

test("command failures surface as Error objects with the native message", async () => {
  const { sandbox } = boot({ fail: { app_import_profile: "Profile file is too large" } });
  await assert.rejects(sandbox.zenShell.importProfile(0), (error) => {
    assert.equal(error instanceof Error, true);
    assert.equal(error.message, "Profile file is too large");
    return true;
  });
});

test("event subscriptions pass payloads and unsubscribe synchronously", async () => {
  const { sandbox, emit, listeners } = boot();
  const panels = [];
  const off = sandbox.zenShell.onNavigate((panel) => panels.push(panel));
  let reconnects = 0;
  sandbox.zenShell.onReconnect((...args) => {
    reconnects++;
    assert.equal(args.length, 0);
  });
  await flush();
  emit("app:navigate", "lighting");
  emit("app:reconnect", null);
  off();
  assert.equal(listeners.has("app:navigate"), false);
  emit("app:navigate", "system");
  assert.deepEqual(panels, ["lighting"]);
  assert.equal(reconnects, 1);
});

test("the document title is mirrored onto the native window", () => {
  const { titles } = boot();
  assert.deepEqual(plain(titles), ["Keyboard — Zenblade"]);
});

test("navigator.hid keeps device identity across discovery and events", async () => {
  const { sandbox, emit } = boot({ devices: [zenblade] });
  const hid = sandbox.navigator.hid;
  const [first] = await hid.getDevices();
  const [again] = await hid.getDevices();
  assert.equal(first, again);
  assert.equal(first.productId, 4098);
  assert.equal(Object.isFrozen(first.collections[0]), true);
  await flush();
  let disconnected = null;
  hid.addEventListener("disconnect", (event) => {
    disconnected = event.device;
  });
  emit("zen-hid", { type: "disconnect", device: zenblade });
  assert.equal(disconnected, first);
  let connected = null;
  hid.onconnect = (event) => {
    connected = event.device;
  };
  emit("zen-hid", { type: "connect", device: zenblade });
  assert.notEqual(connected, first, "a re-attached board is a new HIDDevice, like WebHID");
  assert.equal(connected.productName, "Zenblade v2 8K");
});

test("HID reports flow through the Rust channel as WebHID events", async () => {
  const { sandbox, calls } = boot({ devices: [zenblade] });
  const [device] = await sandbox.navigator.hid.getDevices();
  await assert.rejects(device.sendReport(0, new Uint8Array([1])), /opened first/);
  await device.open();
  assert.equal(device.opened, true);
  const open = calls.find((c) => c.command === "hid_open");
  assert.equal(open.args.id, zenblade.id);
  const received = [];
  device.addEventListener("inputreport", (event) => {
    received.push([event.reportId, event.data.byteLength, event.data.getUint8(0), event.device === device]);
  });
  open.args.onReport.onmessage({ reportId: 0, data: [8, 3, 2, 1] });
  assert.deepEqual(received, [[0, 4, 8, true]]);

  const wire = new Uint8Array(64);
  wire.set([8, 3, 2]);
  await device.sendReport(0, wire);
  const send = calls.find((c) => c.command === "hid_send");
  assert.deepEqual(plain(send.args.data.slice(0, 4)), [8, 3, 2, 0]);
  assert.equal(send.args.data.length, 64);
  assert.equal(send.args.reportId, 0);

  await device.close();
  assert.equal(device.opened, false);
  open.args.onReport.onmessage({ reportId: 0, data: [9] });
  assert.equal(received.length, 1, "reports after close are dropped");
});

test("requestDevice never opens a picker and honours filters", async () => {
  const { sandbox } = boot({ devices: [zenblade] });
  const hid = sandbox.navigator.hid;
  assert.equal((await hid.requestDevice({ filters: [{ vendorId: 13922, usagePage: 0xff60 }] })).length, 1);
  assert.equal((await hid.requestDevice({ filters: [{ vendorId: 1 }] })).length, 0);
  assert.equal((await hid.requestDevice({ filters: [{ vendorId: 13922, usagePage: 0x01 }] })).length, 0);
});
