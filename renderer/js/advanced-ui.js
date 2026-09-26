import {
  EVENT_CODE_TO_HID,
  HID_ASSIGNMENTS,
  LAYER_NAMES,
  PHYSICAL_KEYS,
  describeHid,
} from "./advanced-data.js";
import {
  MACRO_COUNT,
  decodeMacros,
  encodeMacros,
  normalizeSocdConfig,
} from "./protocol.js";
import { $ } from "./dom.js";

const option = (value, label) => {
  const node = document.createElement("option");
  node.value = String(value);
  node.textContent = label;
  return node;
};

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function createAdvancedUi({ kb, state, gate, toast, onChromeChange }) {
  let keymaps = null;
  let socd = null;
  let socdProfile = null;
  let macros = null;
  let recording = false;
  let lastRecordedAt = 0;

  const selectedLayer = () => Number($("remapLayer").value);
  const selectedKey = () => Number($("remapKey").value);
  const selectedMacro = () => Number($("macroSlot").value);
  const selectedSocdSlot = () => Number($("socdSlot").value);

  function setStatus(message, kind = "") {
    const node = $("advancedStatus");
    node.textContent = message;
    node.className = `advanced-status${kind ? ` is-${kind}` : ""}`;
  }

  function populate() {
    LAYER_NAMES.forEach((label, index) =>
      $("remapLayer").append(option(index, label))
    );
    PHYSICAL_KEYS.forEach((key) => {
      $("remapKey").append(option(key.index, key.label));
      $("socdKey1").append(option(key.index, key.label));
      $("socdKey2").append(option(key.index, key.label));
    });
    $("socdKey1").prepend(option("", "Not assigned"));
    $("socdKey2").prepend(option("", "Not assigned"));
    HID_ASSIGNMENTS.forEach((item) =>
      $("remapAssignment").append(option(item.value, item.label))
    );
    Array.from({ length: 10 }, (_, index) => {
      $("socdSlot").append(option(index, `Pair ${index + 1}`));
    });
    Array.from({ length: MACRO_COUNT }, (_, index) => {
      $("macroSlot").append(option(index, `Macro ${index + 1}`));
    });
  }

  function syncRemap() {
    const loaded = !!keymaps;
    const layer = selectedLayer();
    const key = selectedKey();
    const physical = PHYSICAL_KEYS.find((item) => item.index === key);
    const systemManaged = layer === 0 && state.system?.enabled &&
      state.system.keyActions?.some((item) =>
        item.triggerType !== "shortcut" && item.keyCode === physical?.code
      );
    const current = keymaps?.[layer]?.[key];
    $("remapAssignment").disabled = !loaded || key === 0;
    $("btnSaveRemap").disabled = !state.connected || gate.running ||
      !loaded || key === 0;
    $("remapEscNote").hidden = !loaded || key !== 0;
    if (current != null) {
      if (![...$("remapAssignment").options].some((item) =>
        Number(item.value) === current
      )) {
        $("remapAssignment").append(option(current, describeHid(current)));
      }
      $("remapAssignment").value = String(current);
    }
    $("remapCurrent").textContent = current == null
      ? ""
      : systemManaged
      ? `Onboard: ${describeHid(current)} · managed by System on this profile`
      : `Onboard: ${describeHid(current)}`;
  }

  function syncSocd() {
    const loaded = !!socd;
    const slot = socd?.slots?.[selectedSocdSlot()];
    $("socdEnabled").disabled = !loaded;
    for (const id of ["socdMode", "socdKey1", "socdKey2", "socdBottomOut"]) {
      $(id).disabled = !loaded;
    }
    $("btnSaveSocd").disabled = !state.connected || gate.running || !loaded;
    if (!slot) return;
    $("socdEnabled").checked = socd.enabled;
    $("socdMode").value = String(slot.mode);
    $("socdKey1").value = slot.key1 == null ? "" : String(slot.key1);
    $("socdKey2").value = slot.key2 == null ? "" : String(slot.key2);
    $("socdBottomOut").checked = slot.bottomOut;
  }

  function syncMacros() {
    const loaded = !!macros;
    const actions = macros?.[selectedMacro()] || [];
    $("btnRecordMacro").disabled = !loaded || !state.connected || gate.running;
    $("btnClearMacro").disabled = !loaded || actions.length === 0;
    $("btnSaveMacro").disabled = !loaded || !state.connected || gate.running;
    $("btnAddMacroDelay").disabled = !loaded;
    $("btnAddMacroText").disabled = !loaded;
    $("btnRecordMacro").textContent = recording ? "Stop recording" : "Record";
    $("macroCapture").hidden = !recording;
    const list = $("macroActions");
    list.innerHTML = "";
    actions.forEach((action, index) => {
      const row = document.createElement("li");
      const text = document.createElement("span");
      text.textContent = action.type === "delay"
        ? `Wait ${action.duration} ms`
        : action.type === "text"
        ? `Type “${action.text}”`
        : `${action.type[0].toUpperCase()}${action.type.slice(1)} ${
          describeHid(action.keycode)
        }`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn btn--ghost btn--sm";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove action ${index + 1}`);
      remove.addEventListener("click", () => {
        actions.splice(index, 1);
        syncMacros();
      });
      row.append(text, remove);
      list.append(row);
    });
    $("macroEmpty").hidden = actions.length > 0;
    $("macroStorage").textContent = loaded
      ? `${actions.length} action${actions.length === 1 ? "" : "s"}`
      : "Not loaded";
  }

  function sync() {
    if (socd && socdProfile !== state.profile) {
      socd = null;
      setStatus("Profile changed — load its onboard SOCD settings");
    }
    const connected = state.connected;
    $("btnLoadAdvanced").disabled = !connected || gate.running;
    $("btnLoadMacros").disabled = !connected || gate.running;
    const verified8k = connected && kb.info?.productId === 0x1002;
    $("pollingValue").textContent = verified8k
      ? "8,000 Hz"
      : connected
      ? "Firmware managed"
      : "—";
    $("pollingInterval").textContent = verified8k
      ? "125 μs USB report interval"
      : connected
      ? "No adjustable rate exposed"
      : "Connect the keyboard to verify";
    syncRemap();
    syncSocd();
    syncMacros();
  }

  async function loadCore() {
    await gate.run("Advanced read", async () => {
      setStatus("Reading onboard mappings and SOCD…");
      keymaps = await kb.readKeymap();
      socd = await kb.readSocd(state.profile);
      socdProfile = state.profile;
      setStatus("Onboard controls loaded", "ok");
    });
    sync();
  }

  async function loadMacros() {
    await gate.run("Macro read", async () => {
      setStatus("Reading 16 onboard macro slots…");
      macros = await kb.readMacros();
      setStatus("Macros loaded", "ok");
    });
    sync();
  }

  function updateSocdDraft() {
    if (!socd) return;
    socd.enabled = $("socdEnabled").checked;
    const slot = socd.slots[selectedSocdSlot()];
    slot.mode = Number($("socdMode").value);
    slot.key1 = $("socdKey1").value === ""
      ? null
      : Number($("socdKey1").value);
    slot.key2 = $("socdKey2").value === ""
      ? null
      : Number($("socdKey2").value);
    slot.bottomOut = $("socdBottomOut").checked;
  }

  function stopRecording() {
    recording = false;
    lastRecordedAt = 0;
    syncMacros();
    $("btnRecordMacro").focus();
  }

  function recordKey(event) {
    if (!recording || event.repeat) return;
    if (!$("macroCapture").checkVisibility()) {
      stopRecording();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.code === "Escape") {
      stopRecording();
      return;
    }
    const keycode = EVENT_CODE_TO_HID[event.code];
    if (!keycode) return;
    const now = performance.now();
    const actions = macros[selectedMacro()];
    if (lastRecordedAt) {
      const duration = Math.round(now - lastRecordedAt);
      if (duration >= 30) actions.push({ type: "delay", duration });
    }
    actions.push({ type: "tap", keycode });
    lastRecordedAt = now;
    syncMacros();
  }

  populate();
  $("btnLoadAdvanced").addEventListener("click", () =>
    loadCore().catch((error) => {
      setStatus(error?.message || String(error), "error");
      toast(error?.message || String(error), "error");
      sync();
    })
  );
  $("btnLoadMacros").addEventListener("click", () =>
    loadMacros().catch((error) => {
      setStatus(error?.message || String(error), "error");
      toast(error?.message || String(error), "error");
      sync();
    })
  );
  $("remapLayer").addEventListener("change", syncRemap);
  $("remapKey").addEventListener("change", syncRemap);
  $("btnSaveRemap").addEventListener("click", () => {
    const layer = selectedLayer();
    const key = selectedKey();
    const value = Number($("remapAssignment").value);
    gate.run("Key remap", async () => {
      await kb.writeKeymapKey(layer, key, value);
      const verified = await kb.readKeymap();
      if (verified[layer][key] !== value) throw new Error("Remap verification failed");
      keymaps = verified;
      setStatus("Key mapping saved and verified", "ok");
      toast("Key mapping saved", "ok");
    }).catch((error) => toast(error?.message || String(error), "error"))
      .finally(sync);
  });
  $("socdSlot").addEventListener("change", syncSocd);
  for (const id of [
    "socdEnabled",
    "socdMode",
    "socdKey1",
    "socdKey2",
    "socdBottomOut",
  ]) $(id).addEventListener("change", updateSocdDraft);
  $("btnSaveSocd").addEventListener("click", () => {
    updateSocdDraft();
    const expected = normalizeSocdConfig(socd);
    gate.run("SOCD save", async () => {
      await kb.writeSocd(state.profile, expected);
      const verified = await kb.readSocd(state.profile);
      if (!same(expected, verified)) throw new Error("SOCD verification failed");
      socd = verified;
      socdProfile = state.profile;
      setStatus("SOCD saved and verified", "ok");
      toast("SOCD saved", "ok");
    }).catch((error) => toast(error?.message || String(error), "error"))
      .finally(sync);
  });
  $("macroSlot").addEventListener("change", () => {
    if (recording) stopRecording();
    syncMacros();
  });
  $("btnRecordMacro").addEventListener("click", () => {
    recording = !recording;
    lastRecordedAt = 0;
    syncMacros();
    if (recording) $("macroCapture").focus();
  });
  $("btnClearMacro").addEventListener("click", () => {
    macros[selectedMacro()] = [];
    syncMacros();
  });
  $("btnAddMacroDelay").addEventListener("click", () => {
    macros[selectedMacro()].push({
      type: "delay",
      duration: Number($("macroDelay").value),
    });
    syncMacros();
  });
  $("btnAddMacroText").addEventListener("click", () => {
    const text = $("macroText").value;
    if (!text) return;
    macros[selectedMacro()].push({ type: "text", text });
    $("macroText").value = "";
    syncMacros();
  });
  $("btnSaveMacro").addEventListener("click", () => {
    const expected = decodeMacros(encodeMacros(structuredClone(macros)));
    gate.run("Macro save", async () => {
      await kb.writeMacros(expected);
      const verified = await kb.readMacros();
      if (!same(expected, verified)) throw new Error("Macro verification failed");
      macros = verified;
      setStatus("Macros saved and verified", "ok");
      toast("Macros saved", "ok");
    }).catch((error) => toast(error?.message || String(error), "error"))
      .finally(sync);
  });
  document.addEventListener("keydown", recordKey, true);
  const macroSection = $("macroCapture").closest("details");
  macroSection?.addEventListener("toggle", () => {
    if (!macroSection.open && recording) stopRecording();
  });

  function connectionChanged() {
    if (!state.connected) {
      keymaps = null;
      socd = null;
      socdProfile = null;
      macros = null;
      recording = false;
      setStatus("");
    }
    sync();
    onChromeChange?.();
  }

  sync();
  return { sync, connectionChanged, loadCore, loadMacros };
}
