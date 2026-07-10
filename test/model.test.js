import test from "node:test";
import assert from "node:assert/strict";
import { createModel } from "../renderer/js/state.js";
import { normalizeActuation, normalizeStore } from "../renderer/js/store.js";
import { keyDisplayColor } from "../renderer/js/preview.js";
import { uiAccentFromLighting } from "../renderer/js/theme.js";
import {
  colorUiForMode,
  isWheelHitArea,
  lightingIsDirty,
  lightingMatches,
  lightingColorUpdate,
  wheelMarkerPosition,
} from "../renderer/js/lighting-ui.js";
import { DeviceOperationGate } from "../renderer/js/device-ops.js";
import {
  normalizeLighting,
  pctFromWire,
  pctToWire,
  pickZenbladeDevice,
  responseMatchesCommand,
  VID,
  PIDS,
  ZenbladeDevice,
} from "../renderer/js/protocol.js";
import { hexToRgb, rgbToHsv } from "../renderer/js/color.js";
import {
  categorySelectionState,
  LIGHT_MODES,
  modesForCategory,
} from "../renderer/js/lighting-modes.js";
import {
  effectPreviewKeys,
  effectPreviewKind,
  effectPreviewSamples,
} from "../renderer/js/lighting-preview.js";
import { LAYOUT_KEY_COUNT, ROWS } from "../renderer/js/layout.js";
import deviceIds from "../shared/device-ids.json" with { type: "json" };

const codes = { KeyA: 0 };
const memory = () => {
  let value = null;
  return {
    getItem: () => value,
    setItem: (_, next) => {
      value = next;
    },
  };
};

test("migrates v2 macro and combo values into app-only notes", () => {
  const store = normalizeStore({
    profiles: [{
      keyOverrides: {
        KeyA: { press: 8, release: 9, macro: "hello", combo: "cmd+k" },
      },
    }],
  }, codes);
  assert.deepEqual(store.profiles[0].keyOverrides.KeyA, {
    press: 8,
    release: 9,
  });
  assert.deepEqual(store.profiles[0].appNotes.KeyA, {
    macro: "hello",
    combo: "cmd+k",
  });
});

test("central model writes snapshot once and keeps notes out of HID overrides", () => {
  const storage = memory();
  const model = createModel({
    storage,
    validCodes: codes,
    debounceMs: 99999,
  });
  model.setLighting({ hue: 120 });
  model.setOverride("KeyA", { press: 7, release: 8 }, {
    macro: "note",
    combo: "",
  });
  model.flush();
  assert.equal(model.store.profiles[0].lighting.hue, 120);
  assert.deepEqual(model.store.profiles[0].keyOverrides.KeyA, {
    press: 7,
    release: 8,
  });
  assert.equal(
    JSON.parse(storage.getItem()).profiles[0].appNotes.KeyA.macro,
    "note",
  );
});

test("preview and chrome retain distinct legibility policy", () => {
  assert.deepEqual(
    keyDisplayColor({
      isOn: false,
      mode: 1,
      hue: 0,
      saturation: 0,
      brightness: 0,
    }, { col: 0, row: 0, colCount: 1, rowCount: 1 }),
    { r: 42, g: 40, b: 52 },
  );
  assert.deepEqual(
    uiAccentFromLighting({
      isOn: true,
      hue: 0,
      saturation: 5,
      brightness: 5,
    }),
    { r: 184, g: 245, b: 200 },
  );
});

test("returns to simple color controls after a colorless mode", () => {
  assert.equal(colorUiForMode(true, "hidden"), "simple");
  assert.equal(colorUiForMode(false, "hidden"), "hidden");
});

test("device gate serializes work and notifies chrome on busy transitions", async () => {
  const events = [];
  const gate = new DeviceOperationGate({
    onStateChange: () => events.push(gate.running),
  });
  assert.equal(gate.running, false);
  await gate.run("Apply", async () => {
    assert.equal(gate.running, true);
    assert.deepEqual(events, [true]);
  });
  assert.equal(gate.running, false);
  assert.deepEqual(events, [true, false]);
});

test("device gate rejects overlapping operations without mutating control labels", async () => {
  const toasts = [];
  const gate = new DeviceOperationGate({
    toast: (message, kind) => toasts.push([message, kind]),
  });
  const first = gate.run("Apply", () => new Promise((resolve) => {
    setTimeout(resolve, 20);
  }));
  await assert.rejects(
    () => gate.run("Other", async () => {}),
    /waiting for the current device operation/,
  );
  await first;
  assert.equal(toasts[0][1], "error");
});

test("only auto-selects supported Zenblade HID devices", () => {
  assert.equal(pickZenbladeDevice([{ vendorId: 1, productId: 2 }]), null);
  assert.equal(
    pickZenbladeDevice([{ vendorId: 0x3662, productId: 0x1002 }]).productId,
    0x1002,
  );
});

test("renderer and main share the same device identity constants", () => {
  assert.equal(VID, deviceIds.vendorId);
  assert.deepEqual(PIDS, deviceIds.productIds);
  assert.equal(VID, 0x3662);
  assert.deepEqual(PIDS, [0x1001, 0x1002]);
});

test("selectProfile clamps the persisted profile identity", () => {
  const storage = memory();
  const model = createModel({ storage, validCodes: codes });
  model.selectProfile(99);
  assert.equal(model.state.profile, 2);
  assert.equal(model.store.activeProfile, 2);
  model.selectProfile(-3);
  assert.equal(model.state.profile, 0);
  assert.equal(model.store.activeProfile, 0);
});

test("preview recipes retain mode-specific saturation floors", () => {
  const base = { isOn: true, hue: 0, saturation: 1, brightness: 100 };
  const pos = { col: 1, row: 1, colCount: 4, rowCount: 4 };
  for (const [mode, minimum] of [[9, 70], [11, 70], [12, 85], [18, 85], [22, 85]]) {
    const rgb = keyDisplayColor({ ...base, mode }, pos);
    assert.ok(
      rgbToHsv(rgb.r, rgb.g, rgb.b).s >= minimum - 1,
      `mode ${mode}`,
    );
  }
});

test("lighting is normalized at the model boundary before persistence", () => {
  const model = createModel({ storage: memory(), validCodes: codes });
  model.setLighting({
    isOn: "not a boolean",
    mode: 99,
    brightness: -1,
    speed: 101,
    hue: 360,
    saturation: -5,
  });
  assert.deepEqual(model.state.lighting, {
    isOn: true,
    mode: 44,
    brightness: 0,
    speed: 100,
    hue: 359,
    saturation: 0,
  });
  assert.deepEqual(
    normalizeLighting({ isOn: false, mode: -3 }, model.state.lighting),
    { ...model.state.lighting, isOn: false, mode: 1 },
  );
  assert.deepEqual(
    normalizeLighting({ isOn: true, mode: 0 }, model.state.lighting),
    { ...model.state.lighting, isOn: true, mode: 1 },
  );
});

test("actuation is normalized at the model boundary before persistence", () => {
  const model = createModel({ storage: memory(), validCodes: codes });
  model.setActuation({ press: 0, release: 99, rapidTrigger: "yes" });
  assert.deepEqual(model.state.actuation, {
    press: 1,
    release: 40,
    rapidTrigger: true,
  });
  assert.deepEqual(
    normalizeActuation({ press: "x", release: 12, rapidTrigger: false }),
    { press: 15, release: 12, rapidTrigger: false },
  );
  model.setOverride("KeyA", { press: -4, release: 80 });
  assert.deepEqual(model.state.keyOverrides.KeyA, { press: 1, release: 40 });
});

test("colorUi changes go through the model API", () => {
  const model = createModel({ storage: memory(), validCodes: codes });
  assert.equal(model.setColorUi("advanced"), "advanced");
  assert.equal(model.state.colorUi, "advanced");
  assert.equal(model.setColorUi("nope"), "simple");
});

test("brightness wire packing and read conversion preserve edge percentages", async () => {
  const device = new ZenbladeDevice();
  const packets = [];
  device.execute = async (command) => {
    packets.push([...command]);
  };
  for (const brightness of [0, 1, 50, 99, 100]) {
    packets.length = 0;
    await device.writeLighting({
      isOn: true,
      mode: 1,
      brightness,
      speed: 50,
      hue: 0,
      saturation: 100,
    });
    const brightnessPackets = packets.filter((packet) =>
      packet[1] === 3 && packet[2] === 1
    );
    assert.deepEqual(brightnessPackets.map((packet) => packet[3]), [
      pctToWire(brightness),
      pctToWire(brightness),
    ]);
    assert.equal(pctFromWire(pctToWire(brightness)), brightness);
  }
});

test("HID response matching never accepts a rich command by its first byte", () => {
  assert.equal(
    responseMatchesCommand(
      Uint8Array.from([8, 3, 2, 99]),
      Uint8Array.from([8, 3, 2]),
    ),
    true,
  );
  assert.equal(
    responseMatchesCommand(
      Uint8Array.from([8, 3, 1, 99]),
      Uint8Array.from([8, 3, 2]),
    ),
    false,
  );
  assert.equal(
    responseMatchesCommand(
      Uint8Array.from([8]),
      Uint8Array.from([8, 3, 2]),
      1,
    ),
    false,
  );
  assert.equal(
    responseMatchesCommand(Uint8Array.from([34]), Uint8Array.from([34]), 1),
    true,
  );
});

test("effect categories retain every firmware effect and filter without duplicates", () => {
  const ids = modesForCategory("All").map((mode) => mode.id);
  assert.equal(new Set(ids).size, LIGHT_MODES.length);
  assert.deepEqual(
    modesForCategory("Reactive").map((mode) => mode.id),
    LIGHT_MODES.filter((mode) => mode.category === "Reactive").map((mode) =>
      mode.id
    ),
  );
});

test("only firmware effects that animate expose a speed control", () => {
  for (const id of [1, 2, 3, 4, 23, 24, 32]) {
    const mode = LIGHT_MODES.find((entry) => entry.id === id);
    assert.equal(mode.usesSpeed, false, `mode ${id}`);
    assert.equal(mode.params.includes("speed"), false, `mode ${id}`);
  }
  assert.equal(LIGHT_MODES.find((entry) => entry.id === 5).usesSpeed, true);
});

test("lighting apply becomes dirty only against a known normalized baseline", () => {
  const baseline = normalizeLighting({ mode: 3, hue: 20, brightness: 80 });
  assert.equal(lightingIsDirty(baseline, null), false);
  assert.equal(lightingMatches(baseline, { ...baseline }), true);
  assert.equal(
    lightingIsDirty({ ...baseline, brightness: 81 }, baseline),
    true,
  );
});

test("category filters preserve an off-filter selection with a usable tab stop", () => {
  const state = categorySelectionState("Static", 3);
  assert.equal(state.selectedVisible, false);
  assert.equal(state.tabStopId, 1);
  assert.equal(state.modes.some((mode) => mode.id === 3), false);
  assert.equal(categorySelectionState("Gradient", 3).tabStopId, 3);
});

test("effect preview samples the selected pattern instead of a single solid swatch", () => {
  const gradient = {
    isOn: true,
    mode: 3,
    brightness: 100,
    hue: 12,
    saturation: 100,
  };
  const samples = effectPreviewSamples(gradient);
  assert.notDeepEqual(samples[0], samples[samples.length - 1]);
  assert.notDeepEqual(
    samples,
    effectPreviewSamples({ ...gradient, hue: 180 }),
  );
  assert.equal(
    effectPreviewKind(LIGHT_MODES.find((mode) => mode.id === 1)),
    "Base RGB",
  );
  assert.equal(
    effectPreviewKind(LIGHT_MODES.find((mode) => mode.id === 2)),
    "Effect preview",
  );
  assert.equal(
    effectPreviewKind(LIGHT_MODES.find((mode) => mode.id === 3)),
    "Effect preview",
  );
  assert.equal(
    effectPreviewKind(LIGHT_MODES.find((mode) => mode.id === 13)),
    "Effect preview",
  );
});

test("effect preview retains Zenblade's 67-key rows and differentiated keyboard pattern", () => {
  const lighting = {
    isOn: true,
    mode: 3,
    brightness: 100,
    hue: 12,
    saturation: 100,
  };
  const keys = effectPreviewKeys(lighting);
  assert.equal(keys.length, LAYOUT_KEY_COUNT);
  assert.equal(keys.length, 67);
  assert.deepEqual(ROWS.map((row) => row.length), [15, 15, 14, 14, 9]);
  assert.equal(keys.find((key) => key.code === "BSPC").width, 2);
  assert.notDeepEqual(
    keys.find((key) => key.code === "ESC").rgb,
    keys.find((key) => key.code === "SPC").rgb,
  );
  assert.notDeepEqual(
    keys.map((key) => key.rgb),
    effectPreviewKeys({ ...lighting, hue: 180 }).map((key) => key.rgb),
  );
});

test("advanced HEX color input accepts only the documented six-digit format", () => {
  assert.deepEqual(hexToRgb("#FF00AA"), { r: 255, g: 0, b: 170 });
  assert.equal(hexToRgb("#FF00AA80"), null);
});

test("color picker mappings preserve HSV value through lighting brightness", () => {
  assert.deepEqual(lightingColorUpdate({ r: 0, g: 0, b: 0 }), {
    hue: 0,
    saturation: 0,
    brightness: 0,
  });
  assert.deepEqual(lightingColorUpdate({ r: 128, g: 128, b: 128 }), {
    hue: 0,
    saturation: 0,
    brightness: 50,
  });
  assert.deepEqual(lightingColorUpdate({ r: 64, g: 32, b: 16 }), {
    hue: 20,
    saturation: 75,
    brightness: 25,
  });
});

test("color-wheel marker maps hue around the wheel and saturation from the center", () => {
  assert.deepEqual(
    wheelMarkerPosition({ hue: 0, saturation: 0 }, 200),
    { x: 100, y: 100 },
  );
  const right = wheelMarkerPosition({ hue: 0, saturation: 100 }, 200);
  const down = wheelMarkerPosition({ hue: 90, saturation: 100 }, 200);
  assert.equal(right.y, 100);
  assert.ok(right.x > 180);
  assert.equal(down.x, 100);
  assert.ok(down.y > 180);
});

test("color wheel rejects transparent-corner starts while preserving its visible edge", () => {
  assert.equal(isWheelHitArea(0, 0, 200), true);
  assert.equal(isWheelHitArea(95, 0, 200), true);
  assert.equal(isWheelHitArea(96, 0, 200), false);
  assert.equal(isWheelHitArea(90, 90, 200), false);
});
