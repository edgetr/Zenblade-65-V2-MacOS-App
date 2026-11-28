import test from "node:test";
import assert from "node:assert/strict";
import { CODE_TO_MATRIX_INDEX, ROWS, keyName } from "../renderer/js/layout.js";
import { createMacroRecorder } from "../renderer/js/macro-recorder.js";
import {
  EVENT_CODE_TO_HID,
  HID_ASSIGNMENTS,
  HID_GROUP_ORDER,
  hidGroup,
} from "../renderer/js/advanced-data.js";
import {
  KEY_COUNT,
  MACRO_STORAGE_BYTES,
  ZenbladeDevice,
  decodeMacros,
  encodeMacros,
  macroByteLength,
  macroSlotsComplete,
  pctToWire,
  reconcileLighting,
} from "../renderer/js/protocol.js";
import { buildActuationMatrix } from "../renderer/js/device-ops.js";
import { createModel } from "../renderer/js/state.js";
import { normalizeStore } from "../renderer/js/store.js";
import { createTypingStats, CHATTER_MS } from "../renderer/js/typing-test.js";
import {
  parseHexColor,
  previewCyclesPerSecond,
} from "../renderer/js/lighting-ui.js";
import { keyDisplayColor, lightingModeAnimates } from "../renderer/js/preview.js";
import { profileSummary } from "../renderer/js/profiles-ui.js";
import { formatMm } from "../renderer/js/units.js";

const memory = () => {
  let value = null;
  return {
    getItem: () => value,
    setItem: (_, next) => {
      value = next;
    },
  };
};

test("every keyboard row is 16 units wide", () => {
  for (const row of ROWS) {
    assert.equal(row.reduce((sum, key) => sum + key.w, 0), 16);
  }
});

test("every key has a readable name", () => {
  for (const code of Object.keys(CODE_TO_MATRIX_INDEX)) {
    const name = keyName(code);
    assert.ok(name.length >= 1);
    if (code.length > 1 && !/^\d$/.test(code)) assert.notEqual(name, code, code);
  }
  assert.equal(keyName("PGUP"), "Page Up");
});

test("macro recorder keeps modifiers held for chords", () => {
  let now = 0;
  const actions = [];
  const recorder = createMacroRecorder(actions, () => now);
  recorder.down(227); // Left Command
  now = 100;
  // macOS sends no keyup for C while Command is held.
  recorder.down(6, { command: true });
  now = 200;
  recorder.up(227);
  assert.deepEqual(actions, [
    { type: "press", keycode: 227 },
    { type: "delay", duration: 100 },
    { type: "tap", keycode: 6 },
    { type: "delay", duration: 100 },
    { type: "release", keycode: 227 },
  ]);
});

test("macro recorder collapses a plain press and release into a tap", () => {
  let now = 0;
  const actions = [];
  const recorder = createMacroRecorder(actions, () => now);
  recorder.down(4);
  now = 80;
  recorder.up(4);
  now = 300;
  recorder.down(5);
  now = 310;
  recorder.up(5);
  assert.deepEqual(actions, [
    { type: "tap", keycode: 4 },
    { type: "delay", duration: 220 },
    { type: "tap", keycode: 5 },
  ]);
});

test("stopping a recording releases held keys", () => {
  let now = 0;
  const actions = [];
  const recorder = createMacroRecorder(actions, () => now);
  recorder.down(225);
  now = 50;
  recorder.down(4);
  recorder.finish();
  assert.deepEqual(actions.filter((action) => action.type === "release"), [
    { type: "release", keycode: 225 },
    { type: "release", keycode: 4 },
  ]);
});

test("recorder understands function and navigation keys", () => {
  assert.equal(EVENT_CODE_TO_HID.F1, 58);
  assert.equal(EVENT_CODE_TO_HID.F12, 69);
  assert.equal(EVENT_CODE_TO_HID.Delete, 76);
  assert.equal(EVENT_CODE_TO_HID.PageDown, 78);
});

test("macro storage is measured without throwing", () => {
  const big = Array.from({ length: 16 }, () => [{ type: "text", text: "x".repeat(300) }]);
  assert.ok(macroByteLength(big) > MACRO_STORAGE_BYTES);
  assert.throws(() => encodeMacros(big), /exceed/);
  assert.equal(macroByteLength([]), 16);
});

test("macro reads can stop once all slots are present", () => {
  const macros = Array.from({ length: 16 }, () => []);
  macros[0] = [{ type: "tap", keycode: 0 }, { type: "delay", duration: 120 }];
  const bytes = [...encodeMacros(macros)];
  assert.equal(macroSlotsComplete(bytes), true);
  // A keycode of 0 is data, not a slot terminator.
  assert.equal(macroSlotsComplete(bytes.slice(0, bytes.length - 1)), false);
  assert.deepEqual(decodeMacros(bytes)[0], macros[0]);
  // Reads arrive in 60-byte chunks; an action split across one is incomplete.
  for (let cut = 1; cut < bytes.length; cut++) {
    assert.equal(macroSlotsComplete(bytes.slice(0, cut)), false, `cut ${cut}`);
  }
});

test("firmware rounding does not walk lighting values down", () => {
  const stored = { isOn: true, mode: 1, brightness: 99, speed: 50, hue: 200, saturation: 80 };
  const read = { ...stored, brightness: 98, hue: 199, saturation: 79 };
  assert.deepEqual(reconcileLighting(read, stored), stored);
  const changed = { ...stored, brightness: 60, mode: 5 };
  assert.deepEqual(reconcileLighting(changed, stored), changed);
  // Hue wraps around red.
  assert.equal(reconcileLighting({ ...stored, hue: 359 }, { ...stored, hue: 0 }).hue, 0);
  assert.ok(Math.abs(pctToWire(99) - pctToWire(98)) <= 3);
});

test("a device error reply fails the command in flight immediately", async () => {
  const device = new ZenbladeDevice();
  const sent = [];
  device.device = {
    opened: true,
    sendReport: async (_, data) => {
      sent.push(data);
    },
  };
  const started = Date.now();
  const pending = device.execute([8, 3, 2], 3);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const error = new Uint8Array(64);
  error[0] = 255;
  device._onInput({ data: new DataView(error.buffer) });
  await assert.rejects(pending, /rejected/);
  assert.ok(Date.now() - started < 1000);
  assert.equal(device._busy, false);
  assert.equal(device._queue.length, 0);
});

test("per-key Rapid Trigger overrides reach the actuation matrix", async () => {
  const state = {
    actuation: { press: 15, release: 15, rapidTrigger: true, continuousRapidTrigger: false },
    keyOverrides: {
      ESC: { press: 20, release: 20, rapidTrigger: false },
      W: { press: 8, release: 8, continuousRapidTrigger: true },
    },
  };
  const values = buildActuationMatrix(state, KEY_COUNT, (code) => CODE_TO_MATRIX_INDEX[code]);
  assert.equal(values.rapidTriggerValues[CODE_TO_MATRIX_INDEX.ESC], false);
  assert.equal(values.rapidTriggerValues[CODE_TO_MATRIX_INDEX.W], true);
  assert.equal(values.continuousValues[CODE_TO_MATRIX_INDEX.W], true);
  assert.equal(values.continuousValues[CODE_TO_MATRIX_INDEX.A], false);

  const device = new ZenbladeDevice();
  const matrices = [];
  device._matrix = async (head, list) => {
    matrices.push([head[1], list]);
  };
  device.execute = async () => new Uint8Array(0);
  await device.writeActuationMatrix({ profileIndex: 0, ...values, rapidTrigger: true });
  const rapid = matrices.find(([kind]) => kind === 9)[1];
  const continuous = matrices.find(([kind]) => kind === 16)[1];
  assert.equal(rapid[CODE_TO_MATRIX_INDEX.ESC], 0);
  assert.equal(rapid[CODE_TO_MATRIX_INDEX.A], 1);
  assert.equal(continuous[CODE_TO_MATRIX_INDEX.W], 5);
  assert.equal(continuous[CODE_TO_MATRIX_INDEX.A], 4);

  // Continuous mode never reaches a key whose Rapid Trigger is off.
  const masked = buildActuationMatrix({
    actuation: { ...state.actuation, continuousRapidTrigger: true },
    keyOverrides: { ESC: { press: 20, release: 20, rapidTrigger: false } },
  }, KEY_COUNT, (code) => CODE_TO_MATRIX_INDEX[code]);
  assert.equal(masked.continuousValues[CODE_TO_MATRIX_INDEX.ESC], false);
  assert.equal(masked.continuousValues[CODE_TO_MATRIX_INDEX.A], true);
  matrices.length = 0;
  await device.writeActuationMatrix({
    profileIndex: 0,
    pressValues: values.pressValues,
    releaseValues: values.releaseValues,
    rapidTrigger: false,
    continuousRapidTrigger: true,
  });
  assert.ok(matrices.find(([kind]) => kind === 16)[1].every((value) => value === 4));
});

test("profiles keep names, SOCD and per-key Rapid Trigger through storage", () => {
  const store = normalizeStore({
    profiles: [{
      name: "  Gaming   setup ",
      socd: { enabled: true, slots: [{ mode: 1, key1: 17, key2: 31 }] },
      keyOverrides: { W: { press: 8, release: 8, rapidTrigger: false, bogus: 1 } },
    }],
  }, CODE_TO_MATRIX_INDEX);
  assert.equal(store.profiles[0].name, "Gaming setup");
  assert.equal(store.profiles[0].socd.enabled, true);
  assert.deepEqual(store.profiles[0].keyOverrides.W, { press: 8, release: 8, rapidTrigger: false });
  assert.equal(store.profiles[1].socd, null);
});

test("profiles can be renamed, copied and reset", () => {
  const model = createModel({ storage: memory(), validCodes: CODE_TO_MATRIX_INDEX });
  assert.equal(model.labelFor(1), "Profile 2");
  model.renameProfile(0, "Gaming");
  model.renameProfile(1, "Work");
  model.setActuation({ press: 8 });
  model.setOverride("W", { press: 5, release: 5, rapidTrigger: true });
  model.duplicateProfile(0, 1);
  const copy = model.profileAt(1);
  assert.equal(copy.name, "Work", "copy keeps the target's name");
  assert.equal(copy.actuation.press, 8);
  assert.deepEqual(copy.keyOverrides.W, { press: 5, release: 5, rapidTrigger: true });
  model.resetProfile(0);
  assert.equal(model.state.name, "Gaming");
  assert.equal(model.state.actuation.press, 15);
  assert.deepEqual(model.state.keyOverrides, {});
  assert.equal(model.labelFor(0), "Gaming");
});

test("typing stats count words per minute and key bounce", () => {
  let now = 0;
  const stats = createTypingStats(() => now);
  stats.down("KeyA");
  now = 80;
  stats.up("KeyA");
  now = 80 + CHATTER_MS - 5;
  stats.down("KeyA");
  now = 6000;
  stats.up("KeyA");
  stats.typedCharacters(50);
  const value = stats.snapshot();
  assert.equal(value.chatter, 1);
  assert.equal(value.keys, 2);
  assert.ok(value.wpm > 0);
  stats.reset();
  assert.deepEqual(stats.snapshot(), { wpm: null, holdMs: null, chatter: 0, keys: 0 });
});

test("hex colour input accepts short and long forms", () => {
  assert.equal(parseHexColor("#0af"), "#00AAFF");
  assert.equal(parseHexColor("7a00ff"), "#7A00FF");
  assert.equal(parseHexColor("#12345"), null);
  assert.ok(previewCyclesPerSecond(100) > previewCyclesPerSecond(0));
});

test("animated previews move while still frames stay unchanged", () => {
  const pos = { col: 3.5, row: 1, colCount: 16, rowCount: 5 };
  const cycle = { isOn: true, mode: 12, brightness: 80, speed: 50, hue: 0, saturation: 100 };
  assert.equal(lightingModeAnimates(12), true);
  assert.equal(lightingModeAnimates(1), false);
  assert.equal(lightingModeAnimates(33), false);
  assert.deepEqual(keyDisplayColor(cycle, pos), keyDisplayColor(cycle, pos, null));
  assert.notDeepEqual(keyDisplayColor(cycle, pos, 0.25), keyDisplayColor(cycle, pos, 0.5));
  const solid = { ...cycle, mode: 1 };
  assert.deepEqual(keyDisplayColor(solid, pos, 0.4), keyDisplayColor(solid, pos));
});

test("profile cards summarise lighting, feel and extras", () => {
  const summary = profileSummary({
    lighting: { isOn: true, mode: 1 },
    actuation: { press: 8, rapidTrigger: true },
    keyOverrides: { W: {}, A: {} },
  }, 1);
  assert.deepEqual(summary, {
    light: "Solid",
    feel: "0.8 mm · Rapid Trigger",
    extras: "2 key overrides · 1 app",
  });
  assert.equal(formatMm(15), "1.5 mm");
});

test("every remap assignment belongs to a listed group", () => {
  for (const item of HID_ASSIGNMENTS) {
    assert.ok(HID_GROUP_ORDER.includes(hidGroup(item.value)), item.label);
  }
});
