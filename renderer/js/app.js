import { CODE_TO_MATRIX_INDEX, LAYOUT_KEY_COUNT } from "./layout.js";
import { KEY_COUNT, ZenbladeDevice } from "./protocol.js";
import { createModel } from "./state.js";
import { createBoard } from "./board.js";
import { createLightingUi } from "./lighting-ui.js";
import { createKeyEditor } from "./key-editor.js";
import { createProfilesUi } from "./profiles-ui.js";
import { buildActuationMatrix, DeviceOperationGate } from "./device-ops.js";
import { createProfileController } from "./profile-controller.js";
import { applyTheme } from "./theme.js";
import { initHelpTips } from "./help-tips.js";
import { installBootstrapUi } from "./bootstrap-ui.js";

const $ = (id) => document.getElementById(id);
const kb = new ZenbladeDevice();
const model = createModel({ validCodes: CODE_TO_MATRIX_INDEX });
const { state } = model;
if (LAYOUT_KEY_COUNT !== KEY_COUNT) {
  console.warn("Zenblade layout and firmware key counts differ");
}

function toast(message, kind = "") {
  const el = $("toast");
  el.textContent = message;
  el.className = `toast is-show${kind ? ` is-${kind}` : ""}`;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove("is-show"), 2800);
}
function deviceControls() {
  return [
    "btnRefresh",
    "btnApplyLighting",
    "btnApplyActuation",
    "btnApplyKey",
    "btnResetKey",
    ...document.querySelectorAll(".profile-card"),
  ].map((x) => typeof x === "string" ? $(x) : x);
}
const gate = new DeviceOperationGate({ toast, controls: deviceControls });
function setConnected(on, info) {
  if (!on) gate.preserveCurrentState();
  state.connected = on;
  $("btnConnect").disabled = on;
  $("btnDisconnect").disabled = !on;
  $("btnRefresh").disabled = !on;
  document.querySelectorAll(".nav__btn[data-panel]").forEach((b) => {
    if (b.dataset.panel !== "keyboard") b.disabled = !on;
  });
  document.querySelectorAll(
    "#btnApplyLighting, #btnApplyActuation, .profile-card",
  ).forEach((control) => control.disabled = !on || gate.running);
  $("statName").textContent = info?.productName || "—";
  $("statPid").textContent = info
    ? `0x${info.productId.toString(16).padStart(4, "0")}`
    : "—";
  profiles.sync();
}
let lighting;
const board = createBoard({
  state,
  onSelect: (code) => editor.open(code),
  onPaint: () => {
    lighting?.sync();
    applyTheme(state.lighting);
  },
});
lighting = createLightingUi({ model, paint: board.paint, toast });
async function writeFeel() {
  const values = buildActuationMatrix(
    state,
    KEY_COUNT,
    (code) => CODE_TO_MATRIX_INDEX[code],
  );
  return kb.writeActuationMatrix({
    profileIndex: state.profile,
    rapidTrigger: state.actuation.rapidTrigger,
    ...values,
  });
}
const editor = createKeyEditor({
  model,
  paint: board.paint,
  toast,
  onApply: async () => {
    if (!kb.connected) throw new Error("Connect to apply this to the keyboard");
    return gate.run("Key update", writeFeel);
  },
});
let profiles;
function syncAll() {
  lighting.sync();
  editor.syncFeel();
  profiles.sync();
  board.paint();
}
const profileController = createProfileController({ kb, model, state, gate, writeFeel, sync: syncAll, toast });
profiles = createProfilesUi({ model, connected: () => state.connected, onSelect: profileController.select });
const refresh = profileController.refresh;
async function connect(existing) {
  return gate.run("Connection", async () => {
    const info = await kb.connect(existing);
    setConnected(true, info);
    toast("Connected", "ok");
    return refresh({ restoreFeel: true });
  }).catch((error) => {
    if (error.message?.includes("waiting for the current device operation")) return;
    setConnected(false, null);
    toast(error.message || String(error), "error");
  });
}
async function disconnect() {
  model.flush();
  await kb.disconnect();
  setConnected(false, null);
  toast("Disconnected");
}
initHelpTips();
syncAll();
setConnected(false, null);
installBootstrapUi({
  kb,
  model,
  state,
  board,
  lighting,
  gate,
  toast,
  refresh,
  connect,
  disconnect,
  writeFeel,
  setConnected,
});
