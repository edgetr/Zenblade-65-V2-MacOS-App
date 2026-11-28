import {
  EVENT_CODE_TO_HID,
  HID_ASSIGNMENTS,
  HID_GROUP_ORDER,
  hidGroup,
  LAYER_NAMES,
  PHYSICAL_KEYS,
  describeHid,
} from "./advanced-data.js";
import {
  MACRO_COUNT,
  MACRO_STORAGE_BYTES,
  decodeMacros,
  encodeMacros,
  macroByteLength,
  normalizeSocdConfig,
} from "./protocol.js";
import { createMacroRecorder } from "./macro-recorder.js";
import { createKeyPicker } from "./key-picker.js";
import { $ } from "./dom.js";

const option = (value, label) => {
  const node = document.createElement("option");
  node.value = String(value);
  node.textContent = label;
  return node;
};

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function createAdvancedUi({ kb, model, state, gate, toast, onChromeChange }) {
  let keymaps = null;
  let socd = null;
  let socdProfile = null;
  // The profile's stored SOCD when it was last loaded or saved here; drafts
  // edit `socd` without touching it.
  let socdSource = "";
  let macros = null;
  let recorder = null;
  let macroListStamp = "";

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
    const groups = new Map(HID_GROUP_ORDER.map((label) => {
      const group = document.createElement("optgroup");
      group.label = label;
      return [label, group];
    }));
    HID_ASSIGNMENTS.forEach((item) =>
      groups.get(hidGroup(item.value)).append(option(item.value, item.label))
    );
    $("remapAssignment").append(...[...groups.values()].filter((group) =>
      group.children.length
    ));
    Array.from({ length: 10 }, (_, index) => {
      $("socdSlot").append(option(index, `Pair ${index + 1}`));
    });
    Array.from({ length: MACRO_COUNT }, (_, index) => {
      $("macroSlot").append(option(index, `Macro ${index + 1}`));
    });
  }

  const physicalByCode = new Map(PHYSICAL_KEYS.map((item) => [item.code, item]));
  const remapPicker = createKeyPicker($("remapBoard"), {
    onPick: (code) => {
      const physical = physicalByCode.get(code);
      if (!physical) return;
      $("remapKey").value = String(physical.index);
      syncRemap();
    },
    describe: (code) => {
      const physical = physicalByCode.get(code);
      const value = keymaps?.[selectedLayer()]?.[physical?.index];
      return value == null ? physical?.label || code : `${physical.label} → ${describeHid(value)}`;
    },
  });

  function syncRemap() {
    const loaded = !!keymaps;
    const layer = selectedLayer();
    const key = selectedKey();
    const physical = PHYSICAL_KEYS.find((item) => item.index === key);
    remapPicker.paint({ selected: physical?.code });
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
    const bytes = loaded ? macroByteLength(macros) : 0;
    const overBudget = bytes > MACRO_STORAGE_BYTES;
    $("btnRecordMacro").disabled = !loaded || !state.connected || gate.running;
    $("btnClearMacro").disabled = !loaded || actions.length === 0;
    $("btnSaveMacro").disabled = !loaded || !state.connected || gate.running ||
      overBudget;
    $("btnAddMacroDelay").disabled = !loaded;
    $("btnAddMacroText").disabled = !loaded;
    $("btnRecordMacro").textContent = recorder ? "Stop recording" : "Record";
    $("macroCapture").hidden = !recorder;
    $("macroStorage").textContent = loaded
      ? `${actions.length} action${actions.length === 1 ? "" : "s"} · ${
        bytes.toLocaleString()
      } / ${MACRO_STORAGE_BYTES.toLocaleString()} bytes`
      : "Not loaded";
    $("macroStorage").classList.toggle("is-error", overBudget);
    // syncMacros runs on every chrome update; rebuild the list only when the
    // actions changed.
    const stamp = loaded ? `${selectedMacro()}:${JSON.stringify(actions)}` : "";
    if (stamp === macroListStamp) return;
    macroListStamp = stamp;
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
  }

  function sync() {
    if (socd && socdProfile !== state.profile) {
      socd = null;
      setStatus("Profile changed — load its onboard SOCD settings");
    } else if (socd && JSON.stringify(state.socd) !== socdSource) {
      // An import or reset replaced this profile's SOCD settings.
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
      model?.setSocd(socd);
      socdSource = JSON.stringify(state.socd);
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

  function startRecording() {
    recorder = createMacroRecorder(macros[selectedMacro()]);
    syncMacros();
    $("macroCapture").focus();
  }

  function stopRecording({ focus = true } = {}) {
    recorder?.finish();
    recorder = null;
    syncMacros();
    if (focus) $("btnRecordMacro").focus();
  }

  function recordKey(event) {
    if (!recorder) return;
    // checkVisibility() needs macOS 14.4; offsetParent is null for anything
    // hidden, including content of a closed <details> or a hidden panel.
    if ($("macroCapture").offsetParent === null) {
      stopRecording();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    if (event.type === "keydown" && event.code === "Escape") {
      stopRecording();
      return;
    }
    const keycode = EVENT_CODE_TO_HID[event.code];
    if (!keycode) return;
    if (event.type === "keydown") recorder.down(keycode, { command: event.metaKey });
    else recorder.up(keycode);
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
      const verified = await kb.readKeymapLayer(layer);
      if (verified[key] !== value) throw new Error("Remap verification failed");
      keymaps[layer] = verified;
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
      model?.setSocd(verified);
      socdSource = JSON.stringify(state.socd);
      setStatus("SOCD saved and verified", "ok");
      toast("SOCD saved", "ok");
    }).catch((error) => toast(error?.message || String(error), "error"))
      .finally(sync);
  });
  $("macroSlot").addEventListener("change", () => {
    if (recorder) stopRecording({ focus: false });
    syncMacros();
  });
  $("btnRecordMacro").addEventListener("click", () => {
    if (recorder) stopRecording();
    else startRecording();
  });
  $("btnClearMacro").addEventListener("click", () => {
    if (recorder) stopRecording({ focus: false });
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
    if (recorder) stopRecording({ focus: false });
    gate.run("Macro save", async () => {
      const expected = decodeMacros(encodeMacros(structuredClone(macros)));
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
  document.addEventListener("keyup", recordKey, true);
  const macroSection = $("macroCapture").closest("details");
  macroSection?.addEventListener("toggle", () => {
    if (!macroSection.open && recorder) stopRecording({ focus: false });
  });

  function connectionChanged() {
    if (!state.connected) {
      keymaps = null;
      socd = null;
      socdProfile = null;
      macros = null;
      recorder = null;
      setStatus("");
    }
    sync();
    onChromeChange?.();
  }

  sync();
  return { sync, connectionChanged, loadCore, loadMacros };
}
