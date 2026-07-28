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
import { createDesktopController } from "./desktop-controller.js";
import { createAdvancedUi } from "./advanced-ui.js";
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

const ui = { lighting: null, profiles: null, desktop: null, advanced: null };

function syncChrome() {
  const connected = state.connected;
  const running = gate.running;
  const deviceBusy = !connected || running;
  const lightingDirty = ui.lighting?.isDirty() ?? false;
  const hasKeySelected = !!state.selectedKey;

  $("btnRefresh").disabled = deviceBusy;
  $("btnApplyLighting").disabled = deviceBusy || !lightingDirty;
  $("btnApplyActuation").disabled = deviceBusy;
  $("btnApplyKey").disabled = running || !hasKeySelected;
  $("btnResetKey").disabled = running || !hasKeySelected;
  $("btnImportProfile").disabled = running;
  document.querySelectorAll(".profile-card").forEach((card) => {
    card.disabled = running;
  });
  $("btnApplyKey").textContent = connected ? "Apply key" : "Save key";
  $("btnResetKey").textContent = "Use global feel";
  document.documentElement.toggleAttribute("data-device-busy", running);
  ui.desktop?.report();
  ui.advanced?.sync();
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
  ui.advanced?.connectionChanged();
  ui.desktop?.connectionChanged();
}

const board = createBoard({
  state,
  onSelect: (code) => {
    editor.open(code);
    syncChrome();
  },
  // Intentionally no onPaint → lighting.sync(): selection/override paints must
  // not rewrite the 67-key Lights preview. Theme is applied from lighting.sync.
});

ui.lighting = createLightingUi({
  model,
  paint: board.paint,
  onChromeChange: syncChrome,
  onLightingPaint: () => applyTheme(state.lighting),
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
  connected: () => state.connected,
  onApply: async () => {
    if (!kb.connected) return;
    return gate.run("Key update", writeFeel);
  },
});

function syncAll() {
  lighting.sync();
  editor.syncFeel();
  if (!state.selectedKey) editor.clear();
  ui.profiles?.sync();
  board.paint();
  syncChrome();
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
  onAutomationChange: () => ui.desktop?.automationChanged(),
  onChooseApplications: () => window.zenShell?.chooseApplications?.(),
  onExport: async () => {
    const result = await window.zenShell?.exportProfile?.({
      profile: state.profile,
      data: model.exportProfile(),
    });
    if (result && !result.canceled) toast("Profile exported", "ok");
  },
  onImport: async () => {
    const targetProfile = state.profile;
    const result = await window.zenShell?.importProfile?.(targetProfile);
    if (!result || result.canceled) return;
    if (
      result.data?.format !== "zenblade-profile" ||
      result.data?.version !== 1 ||
      !result.data?.profile
    ) {
      throw new Error("This is not a supported Zenblade profile");
    }
    // Replace only after the file is confirmed, and only while holding the
    // device gate so a concurrent apply cannot interleave with import writes.
    const applied = await gate.run("Profile import", async () => {
      const targetIsActive = state.profile === targetProfile;
      model.replaceProfile(targetProfile, result.data.profile);
      syncAll();
      if (!kb.connected || !targetIsActive) return { localOnly: true };
      return profileController.applyCurrentWithinGate({ quiet: true });
    });
    if (
      applied.localOnly ||
      (applied.deviceProfileOk && applied.lightingOk && applied.feelOk)
    ) {
      toast(
        applied.localOnly
          ? `Profile ${targetProfile + 1} imported locally`
          : `Profile ${targetProfile + 1} imported and applied`,
        "ok",
      );
    }
  },
  onError: (error) => toast(error?.message || String(error), "error"),
});

ui.advanced = createAdvancedUi({
  kb,
  state,
  gate,
  toast,
  onChromeChange: syncChrome,
});

const refresh = profileController.refresh;

async function connect(
  existing,
  { quiet = false, restoreLocal = false, silent = false } = {},
) {
  return gate.run("Connection", async () => {
    const info = await kb.connect(existing);
    setConnected(true, info);
    // quiet: suppress automatic startup Connected/Synced success toasts.
    // Errors and user-initiated Refresh still announce normally.
    if (!quiet) toast("Connected", "ok");
    if (restoreLocal) {
      return profileController.applyCurrentWithinGate({ quiet, silent });
    }
    return refresh({ restoreFeel: true, quiet });
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
const bootstrap = installBootstrapUi({
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
  writeFeel,
  applyCurrent: profileController.applyCurrent,
});

ui.desktop = createDesktopController({
  kb,
  model,
  state,
  gate,
  lighting,
  profileController,
  sync: syncAll,
  toast,
  recoverConnection: bootstrap.recoverWithRetry,
  cancelRecovery: bootstrap.cancelRecovery,
});
syncAll();
