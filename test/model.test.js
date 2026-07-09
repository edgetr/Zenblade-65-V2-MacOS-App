import test from "node:test";
import assert from "node:assert/strict";
import { createModel } from "../renderer/js/state.js";
import { normalizeStore } from "../renderer/js/store.js";
import { keyDisplayColor } from "../renderer/js/preview.js";
import { uiAccentFromLighting } from "../renderer/js/theme.js";
import { colorUiForMode } from "../renderer/js/lighting-ui.js";
import { DeviceOperationGate } from "../renderer/js/device-ops.js";
import { pickZenbladeDevice } from "../renderer/js/protocol.js";
import { rgbToHsv } from "../renderer/js/color.js";

const codes = { KeyA: 0 };
const memory = () => { let value = null; return { getItem: () => value, setItem: (_, next) => { value = next; } }; };
test("migrates v2 macro and combo values into app-only notes", () => {
  const store = normalizeStore({ profiles:[{ keyOverrides:{KeyA:{press:8,release:9,macro:"hello",combo:"cmd+k"}} }] }, codes);
  assert.deepEqual(store.profiles[0].keyOverrides.KeyA, { press:8, release:9 });
  assert.deepEqual(store.profiles[0].appNotes.KeyA, { macro:"hello", combo:"cmd+k" });
});
test("central model writes snapshot once and keeps notes out of HID overrides", () => {
  const storage=memory(), model=createModel({storage,validCodes:codes,debounceMs:99999});
  model.setLighting({ hue: 120 }); model.setOverride("KeyA", {press:7,release:8}, {macro:"note",combo:""}); model.flush();
  assert.equal(model.store.profiles[0].lighting.hue,120);assert.deepEqual(model.store.profiles[0].keyOverrides.KeyA,{press:7,release:8});assert.equal(JSON.parse(storage.getItem()).profiles[0].appNotes.KeyA.macro,"note");
});
test("preview and chrome retain distinct legibility policy", () => {
  assert.deepEqual(keyDisplayColor({isOn:false,mode:1,hue:0,saturation:0,brightness:0},{col:0,row:0,colCount:1,rowCount:1}),{r:42,g:40,b:52});
  assert.deepEqual(uiAccentFromLighting({isOn:true,hue:0,saturation:5,brightness:5}),{r:184,g:245,b:200});
});
test("returns to simple color controls after a colorless mode", () => {
  assert.equal(colorUiForMode(true, "hidden"), "simple");
  assert.equal(colorUiForMode(false, "hidden"), "hidden");
});
test("device gate preserves a disconnect-driven disabled state", async () => {
  const control = { disabled: false, textContent: "Apply", dataset: {} };
  const gate = new DeviceOperationGate({ controls: () => [control] });
  await gate.run("Apply", async () => {
    control.disabled = true;
    gate.preserveCurrentState();
  });
  assert.equal(control.disabled, true);
  assert.equal(control.textContent, "Apply");
});
test("only auto-selects supported Zenblade HID devices", () => {
  assert.equal(pickZenbladeDevice([{ vendorId: 1, productId: 2 }]), null);
  assert.equal(
    pickZenbladeDevice([{ vendorId: 0x3662, productId: 0x1002 }]).productId,
    0x1002,
  );
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
    assert.ok(rgbToHsv(rgb.r, rgb.g, rgb.b).s >= minimum - 1, `mode ${mode}`);
  }
});
