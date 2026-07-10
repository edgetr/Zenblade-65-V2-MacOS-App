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
import { $ } from "./dom.js";

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

const ui = { lighting: null, profiles: null };

function syncChrome() {
  const connected = state.connected;
  const running = gate.running;
  const deviceBusy = !connected || running;
  const lightingDirty = ui.lighting?.isDirty() ?? false;

  $("btnRefresh").disabled = deviceBusy;
  document.querySelectorAll(".nav__btn[data-panel]").forEach((button) => {
    if (button.dataset.panel !== "keyboard") button.disabled = !connected;
  });
  $("btnApplyLighting").disabled = deviceBusy || !lightingDirty;
  $("btnApplyActuation").disabled = deviceBusy;
  $("btnApplyKey").disabled = deviceBusy;
  $("btnResetKey").disabled = deviceBusy;
  document.querySelectorAll(".profile-card").forEach((card) => {
    card.disabled = deviceBusy;
  });
  document.documentElement.toggleAttribute("data-device-busy", running);
}

const gate = new DeviceOperationGate({
  toast,
  onStateChange: syncChrome,
});

function setConnected(on, info) {
  state.connected = on;
  $("statName").textContent = info?.productName || "—";
  $("statPid").textContent = info
    ? `0x${info.productId.toString(16).padStart(4, "0")}`
    : "—";
  if (!on) ui.lighting?.clearAppliedBaseline();
  syncChrome();
  ui.profiles?.sync();
}

const board = createBoard({
  state,
  onSelect: (code) => editor.open(code),
  onPaint: () => {
    ui.lighting?.sync();
    applyTheme(state.lighting);
  },
});

ui.lighting = createLightingUi({
  model,
  paint: board.paint,
  toast,
  onChromeChange: syncChrome,
});
const lighting = ui.lighting;

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

function syncAll() {
  lighting.sync();
  editor.syncFeel();
  ui.profiles?.sync();
  board.paint();
}

const profileController = createProfileController({
  kb,
  model,
  state,
  gate,
  writeFeel,
  sync: syncAll,
  toast,
  onLightingRead: lighting.markApplied,
  onLightingApplied: lighting.markApplied,
  onSyncChange: () => ui.profiles?.sync(),
});

ui.profiles = createProfilesUi({
  model,
  connected: () => state.connected,
  onSelect: profileController.select,
  onRetry: profileController.retry,
});

const refresh = profileController.refresh;

async function connect(existing, { quiet = false } = {}) {
  return gate.run("Connection", async () => {
    const info = await kb.connect(existing);
    setConnected(true, info);
    toast("Connected", "ok");
    return refresh({ restoreFeel: true });
  }).catch((error) => {
    if (error.message?.includes("waiting for the current device operation")) {
      return;
    }
    setConnected(false, null);
    if (!quiet) toast(error.message || String(error), "error");
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
  setConnected,
  syncChrome,
});
