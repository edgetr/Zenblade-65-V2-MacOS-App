import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createModel } from "../renderer/js/state.js";
import {
  automationHasTargets,
  defaultAutomation,
  normalizeActuation,
  normalizeAutomation,
  normalizeStore,
} from "../renderer/js/store.js";
import {
  resolveAutomationProfile,
  runRecoverySequence,
} from "../renderer/js/desktop-controller.js";
import { createProfileController } from "../renderer/js/profile-controller.js";
import { baseWireColor, keyDisplayColor } from "../renderer/js/preview.js";
import { uiAccentFromLighting } from "../renderer/js/theme.js";
import {
  lightingIsDirty,
  lightingMatches,
  lightingColorUpdate,
} from "../renderer/js/lighting-ui.js";
import { DeviceOperationGate } from "../renderer/js/device-ops.js";
import {
  colorFromWire,
  colorToWire,
  lightingWirePreview,
  decodeMacros,
  encodeMacros,
  logicalIndexToMatrix,
  logicalValuesToMatrix,
  matrixIndexToLogical,
  matrixValuesToLogical,
  normalizeLighting,
  normalizeSocdConfig,
  pctFromWire,
  pctToWire,
  pickZenbladeDevice,
  resolveLightingMode,
  responseMatchesCommand,
  VID,
  PIDS,
  ZenbladeDevice,
} from "../renderer/js/protocol.js";
import { hexToRgb, rgbToHex, rgbToHsv } from "../renderer/js/color.js";
import {
  categorySelectionState,
  LIGHT_MODES,
  modesForCategory,
  UNSUPPORTED_LIGHT_MODES,
} from "../renderer/js/lighting-modes.js";
import {
  colorSwatchPlan,
  effectEndpointColors,
  effectPreviewKeys,
  effectPreviewKind,
  effectPreviewSamples,
} from "../renderer/js/lighting-preview.js";
import { LAYOUT_KEY_COUNT, ROWS } from "../renderer/js/layout.js";
import deviceIds from "../shared/device-ids.json" with { type: "json" };

const codes = { KeyA: 0 };
const require = createRequire(import.meta.url);
const {
  assertSupportedProfileFile,
  parseFrontApplication,
} = require("../electron/desktop.js");
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

test("automatic app rules are empty by default and fully user-defined", () => {
  assert.deepEqual(defaultAutomation(), {
    enabled: false,
    restoreDefault: false,
    defaultProfile: 0,
    rules: [],
  });
  const automation = normalizeAutomation({
    enabled: true,
    restoreDefault: true,
    defaultProfile: 99,
    rules: [
      { bundleId: "com.example.editor", name: "Editor", profile: 2 },
      { bundleId: "com.example.editor", name: "Duplicate", profile: 0 },
      { bundleId: "com.example.game", name: "Game", profile: -1 },
      { bundleId: "", name: "Invalid", profile: 1 },
    ],
  });
  assert.deepEqual(automation, {
    enabled: true,
    restoreDefault: true,
    defaultProfile: 2,
    rules: [
      { bundleId: "com.example.editor", name: "Editor", profile: 2 },
      { bundleId: "com.example.game", name: "Game", profile: 0 },
    ],
  });
});

test("automatic switching cannot remain enabled without a rule or fallback", () => {
  assert.equal(automationHasTargets(defaultAutomation()), false);
  assert.equal(
    normalizeAutomation({ enabled: true, rules: [] }).enabled,
    false,
  );
  assert.equal(
    normalizeAutomation({ enabled: true, restoreDefault: true }).enabled,
    true,
  );

  const model = createModel({ storage: memory(), validCodes: codes });
  model.setAutomation({ enabled: true });
  assert.equal(model.state.automation.enabled, false);
  model.setAutomation({
    rules: [{ bundleId: "com.example.app", name: "App", profile: 1 }],
    enabled: true,
  });
  assert.equal(model.state.automation.enabled, true);
  model.setAutomation({ rules: [] });
  assert.equal(model.state.automation.enabled, false);
});

test("automatic switching resolves exact bundle rules and optional fallback", () => {
  const automation = {
    enabled: true,
    restoreDefault: false,
    defaultProfile: 0,
    rules: [{ bundleId: "com.example.editor", name: "Editor", profile: 2 }],
  };
  assert.equal(
    resolveAutomationProfile(automation, {
      bundleId: "com.example.editor",
    }),
    2,
  );
  assert.equal(
    resolveAutomationProfile(automation, { bundleId: "com.example.other" }),
    null,
  );
  assert.equal(
    resolveAutomationProfile(
      { ...automation, restoreDefault: true, defaultProfile: 1 },
      { bundleId: "com.example.other" },
    ),
    1,
  );
  assert.equal(
    resolveAutomationProfile(
      { ...automation, enabled: false },
      { bundleId: "com.example.editor" },
    ),
    null,
  );
});

test("quiet automatic profile selection returns HID failure without a toast", async () => {
  const model = createModel({ storage: memory(), validCodes: codes });
  const toasts = [];
  const controller = createProfileController({
    kb: {
      connected: true,
      writeProfile: async () => {
        throw new Error("offline");
      },
    },
    model,
    state: model.state,
    gate: { run: async (_label, task) => task() },
    writeFeel: async () => {},
    sync: () => {},
    toast: (...args) => toasts.push(args),
  });
  const result = await controller.select(1, { quiet: true });
  assert.equal(result.ok, false);
  assert.equal(model.state.profile, 0);
  assert.deepEqual(toasts, []);
});

test("profile export and import round-trip through model validation", () => {
  const model = createModel({ storage: memory(), validCodes: codes });
  model.setLighting({ hue: 123, brightness: 64 });
  model.setOverride("KeyA", { press: 6, release: 7 });
  const exported = model.exportProfile();
  assert.equal(exported.format, "zenblade-profile");
  assert.equal(exported.version, 1);

  const target = createModel({ storage: memory(), validCodes: codes });
  target.replaceProfile(0, {
    ...exported.profile,
    lighting: { ...exported.profile.lighting, brightness: 999 },
    keyOverrides: {
      ...exported.profile.keyOverrides,
      Unknown: { press: 1, release: 1 },
    },
  });
  assert.equal(target.state.lighting.hue, 123);
  assert.equal(target.state.lighting.brightness, 100);
  assert.deepEqual(target.state.keyOverrides.KeyA, {
    press: 6,
    release: 7,
  });
  assert.equal(target.state.keyOverrides.Unknown, undefined);
});

test("profile replace keeps other profiles and automation rules intact", () => {
  const model = createModel({ storage: memory(), validCodes: codes });
  model.selectProfile(1);
  model.setLighting({ hue: 40 });
  model.selectProfile(0);
  model.setAutomation({
    enabled: true,
    rules: [{ bundleId: "com.example.app", name: "App", profile: 1 }],
  });
  model.replaceProfile(0, {
    lighting: { hue: 200, brightness: 55, isOn: true, mode: 1, speed: 50, saturation: 100 },
    actuation: { press: 10, release: 11, rapidTrigger: false },
    keyOverrides: { KeyA: { press: 5, release: 6 } },
    appNotes: {},
  });
  assert.equal(model.state.lighting.hue, 200);
  assert.equal(model.store.profiles[1].lighting.hue, 40);
  assert.equal(model.state.automation.enabled, true);
  assert.equal(model.state.automation.rules[0].bundleId, "com.example.app");
});

test("profile file envelopes are rejected before import confirmation or export", () => {
  const supported = {
    format: "zenblade-profile",
    version: 1,
    profile: {
      lighting: {},
      actuation: {},
      keyOverrides: {},
      appNotes: {},
    },
  };
  assert.equal(assertSupportedProfileFile(supported), supported);
  assert.throws(
    () => assertSupportedProfileFile({ ...supported, version: 2 }),
    /not a supported Zenblade profile/,
  );
  assert.throws(
    () =>
      assertSupportedProfileFile({
        ...supported,
        profile: { ...supported.profile, keyOverrides: [] },
      }),
    /not a supported Zenblade profile/,
  );
});

test("wake recovery attempts run sequentially and stop after success", async () => {
  const events = [];
  let attempts = 0;
  const recovered = await runRecoverySequence({
    delays: [0, 10, 20],
    wait: async (delay) => events.push(`wait:${delay}`),
    attempt: async () => {
      attempts++;
      events.push(`attempt:${attempts}`);
      return attempts === 2;
    },
  });
  assert.equal(recovered, true);
  assert.deepEqual(events, ["attempt:1", "wait:10", "attempt:2"]);
});

test("superseded wake recovery stops before another device attempt", async () => {
  let current = true;
  let attempts = 0;
  const recovered = await runRecoverySequence({
    delays: [0, 10],
    wait: async () => {
      current = false;
    },
    isCurrent: () => current,
    attempt: async () => {
      attempts++;
      return false;
    },
  });
  assert.equal(recovered, false);
  assert.equal(attempts, 1);
});

test("permission-free macOS foreground metadata is parsed defensively", () => {
  assert.deepEqual(
    parseFrontApplication(`
"Example App" ASN:0x0-0x123:
    bundleID="com.example.app"
  `),
    { bundleId: "com.example.app", name: "Example App" },
  );
  assert.equal(parseFrontApplication("bundleID is unavailable"), null);
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

test("Alpha Mods (firmware mode 2) is unsupported and falls back to Solid", () => {
  assert.equal(UNSUPPORTED_LIGHT_MODES.has(2), true);
  assert.equal(resolveLightingMode(2), 1);
  assert.equal(normalizeLighting({ mode: 2 }).mode, 1);
  assert.equal(
    normalizeLighting({ mode: 2 }, { mode: 5, brightness: 40 }).mode,
    1,
  );
  assert.equal(
    LIGHT_MODES.some((mode) => mode.id === 2 || mode.name === "Alpha Mods"),
    false,
  );
  assert.equal(LIGHT_MODES.find((mode) => mode.id === 1).name, "Solid");
  assert.equal(LIGHT_MODES.find((mode) => mode.id === 3).name, "Gradient V");
  assert.equal(LIGHT_MODES.find((mode) => mode.id === 44).name, "Solid Multi Splash");
  // IDs 3–44 must not be renumbered after removing mode 2 from the list.
  for (const id of [3, 4, 12, 22, 33, 44]) {
    assert.equal(LIGHT_MODES.find((mode) => mode.id === id)?.id, id);
  }
  const store = normalizeStore({
    profiles: [{ lighting: { mode: 2, hue: 90, brightness: 70 } }],
  }, codes);
  assert.equal(store.profiles[0].lighting.mode, 1);
  const model = createModel({ storage: memory(), validCodes: codes });
  model.setLighting({ mode: 2 });
  assert.equal(model.state.lighting.mode, 1);
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

test("lightingWirePreview matches the 8-bit values written to firmware", () => {
  const lighting = {
    isOn: true,
    mode: 1,
    brightness: 33,
    speed: 67,
    hue: 17,
    saturation: 41,
  };
  const wire = lightingWirePreview(lighting);
  assert.equal(wire.brightness, pctFromWire(pctToWire(33)));
  assert.equal(wire.speed, pctFromWire(pctToWire(67)));
  const packed = colorToWire(17, 41);
  const unpacked = colorFromWire(packed.hue, packed.saturation);
  assert.equal(wire.hue, unpacked.hue % 360);
  assert.equal(wire.saturation, unpacked.saturation);
  // Preview colour uses the same quantized HSV (no brightness floor / lift).
  assert.deepEqual(
    baseWireColor(lighting),
    keyDisplayColor(lighting, { col: 0, row: 0, colCount: 1, rowCount: 1 }),
  );
  // Mode 2 is normalized before wire preview.
  assert.equal(lightingWirePreview({ ...lighting, mode: 2 }).mode, 1);
});

test("key preview does not lift zero brightness above the wire value", () => {
  const rgb = keyDisplayColor({
    isOn: true,
    mode: 1,
    hue: 0,
    saturation: 100,
    brightness: 0,
  }, { col: 0, row: 0, colCount: 1, rowCount: 1 });
  assert.deepEqual(rgb, { r: 0, g: 0, b: 0 });
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

test("effect categories retain every selectable firmware effect and filter without duplicates", () => {
  const ids = modesForCategory("All").map((mode) => mode.id);
  assert.equal(new Set(ids).size, LIGHT_MODES.length);
  assert.equal(ids.includes(2), false);
  assert.deepEqual(
    modesForCategory("Reactive").map((mode) => mode.id),
    LIGHT_MODES.filter((mode) => mode.category === "Reactive").map((mode) =>
      mode.id
    ),
  );
});

test("only firmware effects that animate expose a speed control", () => {
  for (const id of [1, 3, 4, 23, 24, 32]) {
    const mode = LIGHT_MODES.find((entry) => entry.id === id);
    assert.equal(mode.usesSpeed, false, `mode ${id}`);
    assert.equal(mode.params.includes("speed"), false, `mode ${id}`);
  }
  assert.equal(LIGHT_MODES.find((entry) => entry.id === 5).usesSpeed, true);
});

test("lighting apply stays available without a verified baseline and locks once matched", () => {
  const baseline = normalizeLighting({ mode: 3, hue: 20, brightness: 80 });
  assert.equal(lightingIsDirty(baseline, null), true);
  assert.equal(lightingMatches(baseline, { ...baseline }), true);
  assert.equal(lightingIsDirty(baseline, baseline), false);
  assert.equal(
    lightingIsDirty({ ...baseline, brightness: 81 }, baseline),
    true,
  );
});

test("bootstrap-ui wires writeFeel from app bootstrap", () => {
  const bootstrap = readFileSync(
    new URL("../renderer/js/bootstrap-ui.js", import.meta.url),
    "utf8",
  );
  const app = readFileSync(
    new URL("../renderer/js/app.js", import.meta.url),
    "utf8",
  );
  assert.match(bootstrap, /writeFeel/);
  assert.match(app, /installBootstrapUi\(\{[\s\S]*writeFeel/);
  assert.match(bootstrap, /Lighting applied"/);
  assert.doesNotMatch(bootstrap, /Refresh verifies it/);
  assert.match(bootstrap, /quiet:\s*true/);
  assert.match(app, /refresh\(\{ restoreFeel: true, quiet \}/);
  // Selection/override paints must not re-sync lighting UI.
  assert.doesNotMatch(app, /onPaint:[\s\S]*lighting\?\.sync/);
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
    effectPreviewKind(LIGHT_MODES.find((mode) => mode.id === 3)),
    "Effect preview",
  );
  assert.equal(
    effectPreviewKind(LIGHT_MODES.find((mode) => mode.id === 13)),
    "Effect preview",
  );
});

test("effect preview retains Zenblade's 68-key rows and differentiated keyboard pattern", () => {
  const lighting = {
    isOn: true,
    mode: 3,
    brightness: 100,
    hue: 12,
    saturation: 100,
  };
  const keys = effectPreviewKeys(lighting);
  assert.equal(keys.length, LAYOUT_KEY_COUNT);
  assert.equal(keys.length, 68);
  assert.deepEqual(ROWS.map((row) => row.length), [15, 15, 14, 14, 10]);
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

test("color UI: picker only for single-color, two endpoint swatches for gradients, none for palettes", () => {
  const solid = {
    isOn: true,
    mode: 1,
    brightness: 100,
    hue: 0,
    saturation: 100,
  };
  const solidPlan = colorSwatchPlan(solid);
  assert.equal(solidPlan.kind, "single");
  assert.equal(solidPlan.swatches.length, 0);
  assert.equal(solidPlan.showPicker, true);

  const gradient = { ...solid, mode: 3 };
  const gradientPlan = colorSwatchPlan(gradient);
  assert.equal(gradientPlan.kind, "endpoints");
  assert.equal(gradientPlan.swatches.length, 2);
  const ends = effectEndpointColors(gradient);
  assert.equal(gradientPlan.swatches[0].hex, rgbToHex(ends.start).toUpperCase());
  assert.equal(gradientPlan.swatches[1].hex, rgbToHex(ends.end).toUpperCase());
  // Endpoints match first/last keyboard preview keys.
  const keys = effectPreviewKeys(gradient);
  assert.deepEqual(ends.start, keys[0].rgb);
  assert.deepEqual(ends.end, keys[keys.length - 1].rgb);

  const gradientH = colorSwatchPlan({ ...solid, mode: 4 });
  assert.equal(gradientH.kind, "endpoints");
  assert.equal(gradientH.swatches.length, 2);

  const multi = colorSwatchPlan({ ...solid, mode: 13 });
  assert.equal(multi.kind, "none");
  assert.equal(multi.swatches.length, 0);
  assert.equal(multi.showPicker, false);

  const pinwheel = colorSwatchPlan({ ...solid, mode: 8 });
  assert.equal(pinwheel.kind, "none");
  assert.equal(pinwheel.showPicker, true);
});

test("HEX color helper accepts only the documented six-digit format", () => {
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

test("advanced color UI is fully removed from the renderer shell", () => {
  const html = readFileSync(
    new URL("../renderer/index.html", import.meta.url),
    "utf8",
  );
  const lightingUi = readFileSync(
    new URL("../renderer/js/lighting-ui.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(html, /btnToggleAdvancedColor|advancedColor|colorWheel|inputHex/);
  assert.doesNotMatch(lightingUi, /drawWheel|wheelMarkerPosition|isWheelHitArea|advanced/);
  assert.doesNotMatch(lightingUi, /textContent\s*=\s*swatch\.hex/);
  assert.match(html, /lightColorPicker/);
  assert.match(html, /colorSwatches/);
});

test("feel presets update sliders without a selection toast", () => {
  const keyEditor = readFileSync(
    new URL("../renderer/js/key-editor.js", import.meta.url),
    "utf8",
  );
  assert.match(keyEditor, /data-preset/);
  assert.doesNotMatch(keyEditor, /toast\(p/);
});

test("startup discovery waits for an explicit user choice", () => {
  const source = readFileSync(
    new URL("../renderer/js/bootstrap-ui.js", import.meta.url),
    "utf8",
  );
  const startup = source.slice(source.indexOf("(async () => {"));
  assert.match(startup, /if \(known\) \{\s*const result = await connect\(known/);
  assert.doesNotMatch(startup, /connect\(undefined/);
  assert.match(startup, /setDiscoveryVisible\(true\)/);
});

test("keyboard-first navigation uses one board tab stop and app shortcuts", () => {
  const boardSource = readFileSync(
    new URL("../renderer/js/board.js", import.meta.url),
    "utf8",
  );
  const bootstrapSource = readFileSync(
    new URL("../renderer/js/bootstrap-ui.js", import.meta.url),
    "utf8",
  );
  const mainSource = readFileSync(
    new URL("../electron/main.js", import.meta.url),
    "utf8",
  );
  const preloadSource = readFileSync(
    new URL("../electron/preload.js", import.meta.url),
    "utf8",
  );
  assert.match(
    boardSource,
    /interactive && rowIndex === 0 && col === 0 \? 0 : -1/,
  );
  assert.match(boardSource, /"ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"/);
  assert.match(bootstrapSource, /\^\[1-5\]\$/);
  assert.match(bootstrapSource, /command && event\.key === "Enter"/);
  assert.match(mainSource, /accelerator: "CmdOrCtrl\+1"/);
  assert.match(mainSource, /accelerator: "CmdOrCtrl\+4"/);
  assert.match(mainSource, /accelerator: "CmdOrCtrl\+5"/);
  assert.match(preloadSource, /onNavigate/);
  assert.match(bootstrapSource, /onNavigate\?\.\(\(panel\) => navigate\(panel\)\)/);
});

test("logical keys round-trip through the Zenblade 8 by 9 matrix", () => {
  const values = Array.from({ length: 68 }, (_, index) => index + 100);
  const matrix = logicalValuesToMatrix(values);
  assert.equal(matrix.length, 72);
  assert.deepEqual(matrixValuesToLogical(matrix), values);
  assert.deepEqual(logicalIndexToMatrix(0), { row: 0, col: 0 });
  assert.deepEqual(logicalIndexToMatrix(67), { row: 6, col: 8 });
  assert.equal(matrixIndexToLogical(60), 63);
  assert.equal(matrixIndexToLogical(999), -1);
});

test("macro codec preserves all supported onboard action types", () => {
  const macros = Array.from({ length: 16 }, () => []);
  macros[0] = [
    { type: "tap", keycode: 4 },
    { type: "delay", duration: 125 },
    { type: "press", keycode: 225 },
    { type: "release", keycode: 225 },
    { type: "text", text: "Hi!" },
  ];
  macros[15] = [{ type: "tap", keycode: 40 }];
  assert.deepEqual(decodeMacros(encodeMacros(macros)), macros);
});

test("SOCD config clamps profiles to ten safe hardware slots", () => {
  const config = normalizeSocdConfig({
    enabled: true,
    slots: [{
      mode: 99,
      key1: 31,
      key2: null,
      bottomOut: true,
    }],
  });
  assert.equal(config.enabled, true);
  assert.equal(config.slots.length, 10);
  assert.deepEqual(config.slots[0], {
    mode: 4,
    key1: 31,
    key2: null,
    bottomOut: true,
  });
  assert.equal(normalizeSocdConfig({ slots: [{ mode: 0 }] }).slots[0].mode, 0);
});
