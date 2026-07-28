import {
  CONTROL_KEYS,
  SYSTEM_ACTIONS,
  SYSTEM_ACTION_BY_ID,
  buildIndicatorOverlay,
  buildKeyActionPlan,
  createIndicatorPreset,
  hostShortcutMappings,
} from "./system-data.js";
import { CODE_TO_MATRIX_INDEX, ROWS } from "./layout.js";
import { $ } from "./dom.js";

const option = (value, label) => {
  const node = document.createElement("option");
  node.value = String(value);
  node.textContent = label;
  return node;
};

const keyLabel = (code) =>
  CONTROL_KEYS.find((key) => key.code === code)?.label || code;
const statusTarget = (rule) =>
  rule.targetType === "row"
    ? `Row ${Number(rule.row) + 1}`
    : rule.keyCode;

export function createSystemUi({
  kb,
  model,
  state,
  gate,
  board,
  toast,
}) {
  let context = {
    audio: { devices: [], micMuted: false, canMuteInput: false },
    processes: {},
  };
  let contextTimer = 0;
  let contextGeneration = 0;
  let overlayStamp = "";
  let actionEditorReturn = null;
  let indicatorEditorReturn = null;
  let editingIndicatorId = null;
  let shortcutStamp = "";
  let shortcutFailures = [];
  let mappingStatus = "";
  let renderedProfile = state.profile;

  const systemDraft = () => structuredClone(state.system);
  const processDetectors = () =>
    state.system.indicators.rules
      .filter((rule) => rule.source === "process" && rule.match)
      .map((rule) => ({ id: rule.id, match: rule.match }));

  function setSystem(partial) {
    model.setSystem(partial);
    configureShortcuts();
    sync();
    refreshContext();
  }

  async function configureShortcuts() {
    const mappings = hostShortcutMappings(state.system);
    const stamp = JSON.stringify(mappings);
    if (stamp === shortcutStamp) return;
    shortcutStamp = stamp;
    try {
      const result = await window.zenShell?.configureSystemShortcuts?.(mappings);
      shortcutFailures = result?.failures || [];
    } catch {
      shortcutFailures = mappings.map((item) => item.accelerator);
    }
    syncMappingStatus();
  }

  function syncMappingStatus() {
    const node = $("systemMappingStatus");
    if (!node) return;
    if (mappingStatus) {
      node.textContent = mappingStatus;
    } else if (!state.connected) {
      node.textContent = "Connect the keyboard to sync controls.";
    } else if (shortcutFailures.length) {
      node.textContent = `macOS reserved ${shortcutFailures.join(", ")}. Choose another control.`;
    } else if (!state.system.enabled) {
      node.textContent = "Paused · sync restores the four keys to factory functions.";
    } else {
      node.textContent = "Ready to sync this profile to the keyboard.";
    }
  }

  async function applyMappingsWithinGate() {
    if (!kb.connected) {
      await configureShortcuts();
      return { localOnly: true, systemOk: true };
    }
    const plan = buildKeyActionPlan({}, state.system);
    for (const write of plan) {
      await kb.writeKeymapKey(0, CODE_TO_MATRIX_INDEX[write.keyCode], write.value);
    }
    const verified = await kb.readKeymapLayer(0);
    for (const write of plan) {
      const stored = verified[CODE_TO_MATRIX_INDEX[write.keyCode]];
      if (stored !== write.value) {
        throw new Error(`${keyLabel(write.keyCode)} control did not verify`);
      }
    }
    await configureShortcuts();
    mappingStatus = state.system.enabled
      ? `Profile ${state.profile + 1} controls are synced.`
      : "Factory key functions restored.";
    syncMappingStatus();
    return { systemOk: true };
  }

  async function syncMappings() {
    try {
      await gate.run("System controls", applyMappingsWithinGate);
      toast(
        state.system.enabled ? "System controls synced" : "Factory keys restored",
        "ok",
      );
    } catch (error) {
      mappingStatus = error?.message || String(error);
      toast(mappingStatus, "error");
    } finally {
      sync();
    }
  }

  function audioDevices(direction) {
    return (context.audio?.devices || []).filter((device) => device[direction]);
  }

  function fillDeviceSelect(id, direction, selected) {
    const select = $(id);
    const devices = audioDevices(direction);
    const signature = JSON.stringify(devices.map((device) => [
      device.uid,
      device.name,
      device[`default${direction[0].toUpperCase()}${direction.slice(1)}`],
    ]));
    if (select.dataset.signature !== signature) {
      select.innerHTML = "";
      select.append(option("", `Use current ${direction}`));
      devices.forEach((device) => {
        const suffix = device[
          `default${direction[0].toUpperCase()}${direction.slice(1)}`
        ] ? " · current" : "";
        select.append(option(device.uid, `${device.name}${suffix}`));
      });
      select.dataset.signature = signature;
    }
    select.value = [...select.options].some((item) => item.value === selected)
      ? selected
      : "";
  }

  function renderActions() {
    const list = $("systemActionList");
    list.innerHTML = "";
    state.system.keyActions.forEach((item) => {
      const action = SYSTEM_ACTION_BY_ID.get(item.action);
      const row = document.createElement("div");
      row.className = "system-row";
      const key = document.createElement("span");
      key.className = "system-row__key";
      key.textContent = keyLabel(item.keyCode);
      const body = document.createElement("div");
      body.className = "system-row__body";
      const title = document.createElement("strong");
      title.textContent = action?.label || item.action;
      const detail = document.createElement("span");
      detail.textContent = action?.detail || "";
      body.append(title, detail);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn btn--ghost btn--sm";
      remove.textContent = "Restore";
      remove.setAttribute("aria-label", `Restore ${keyLabel(item.keyCode)}`);
      remove.addEventListener("click", () => {
        const next = systemDraft();
        next.keyActions = next.keyActions.filter((value) => value.id !== item.id);
        setSystem({ keyActions: next.keyActions });
        if (state.connected) syncMappings();
      });
      row.append(key, body, remove);
      list.append(row);
    });
    $("systemActionEmpty").hidden = state.system.keyActions.length > 0;
  }

  function ruleIsActive(rule) {
    if (rule.source === "mic-muted") return context.audio?.micMuted === true;
    if (rule.source === "mic-live") return context.audio?.micMuted === false;
    return context.processes?.[rule.id] === true;
  }

  function renderIndicators() {
    const list = $("indicatorRuleList");
    list.innerHTML = "";
    state.system.indicators.rules.forEach((rule) => {
      const row = document.createElement("div");
      row.className = "indicator-row";
      row.dataset.ruleId = rule.id;
      const swatch = document.createElement("span");
      swatch.className = "indicator-row__swatch";
      swatch.style.setProperty("--indicator-color", rule.color);
      const body = document.createElement("div");
      body.className = "indicator-row__body";
      const title = document.createElement("strong");
      title.textContent = rule.name;
      const detail = document.createElement("span");
      detail.textContent = rule.source === "process"
        ? `“${rule.match}” · ${statusTarget(rule)}`
        : `${rule.source === "mic-muted" ? "Muted" : "Live"} · ${statusTarget(rule)}`;
      body.append(title, detail);
      const active = document.createElement("span");
      active.className = `indicator-row__state${ruleIsActive(rule) ? " is-active" : ""}`;
      active.textContent = ruleIsActive(rule) ? "Active" : "Waiting";
      const actions = document.createElement("div");
      actions.className = "btn-row";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "btn btn--ghost btn--sm";
      edit.textContent = "Edit";
      edit.addEventListener("click", () => openIndicatorEditor(rule));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn btn--ghost btn--sm";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        const rules = state.system.indicators.rules.filter(
          (value) => value.id !== rule.id,
        );
        setSystem({
          indicators: {
            ...state.system.indicators,
            enabled: rules.length ? state.system.indicators.enabled : false,
            rules,
          },
        });
      });
      actions.append(edit, remove);
      row.append(swatch, body, active, actions);
      list.append(row);
    });
    $("indicatorEmpty").hidden = state.system.indicators.rules.length > 0;
  }

  function updateIndicatorStates() {
    state.system.indicators.rules.forEach((rule) => {
      const row = [...$("indicatorRuleList").querySelectorAll(".indicator-row")]
        .find((item) => item.dataset.ruleId === rule.id);
      const status = row?.querySelector(".indicator-row__state");
      if (!status) return;
      const active = ruleIsActive(rule);
      status.classList.toggle("is-active", active);
      const label = active ? "Active" : "Waiting";
      if (status.textContent !== label) status.textContent = label;
    });
  }

  function paintIndicators() {
    const overlay = buildIndicatorOverlay(state.system, context, 0);
    const stamp = JSON.stringify(overlay);
    if (stamp === overlayStamp) return;
    overlayStamp = stamp;
    state.statusOverlay = overlay;
    board.paint();
  }

  function syncContext() {
    const muted = context.audio?.micMuted === true;
    const mic = $("systemMicState");
    const micLabel = context.audio?.canMuteInput === false
      ? "Mic control unavailable"
      : muted
      ? "Microphone muted"
      : "Microphone live";
    const micClass = `mic-pill${muted ? " is-muted" : " is-live"}`;
    if (mic.textContent !== micLabel) mic.textContent = micLabel;
    if (mic.className !== micClass) mic.className = micClass;
    updateIndicatorStates();
    paintIndicators();
  }

  function scheduleContextRefresh() {
    clearTimeout(contextTimer);
    contextTimer = setTimeout(refreshContext, 1500);
  }

  async function refreshContext() {
    clearTimeout(contextTimer);
    const generation = ++contextGeneration;
    try {
      const next = await window.zenShell?.getSystemContext?.(processDetectors());
      if (generation !== contextGeneration) return;
      if (next) {
        context = next;
        fillDeviceSelect("systemInputDevice", "input", state.system.audio.inputUid);
        fillDeviceSelect("systemOutputDevice", "output", state.system.audio.outputUid);
        syncContext();
      }
    } catch {
      if (generation !== contextGeneration) return;
      $("systemMicState").textContent = "System bridge unavailable";
      $("systemMicState").className = "mic-pill";
    } finally {
      if (generation === contextGeneration) scheduleContextRefresh();
    }
  }

  function sync() {
    if (renderedProfile !== state.profile) {
      renderedProfile = state.profile;
      mappingStatus = "";
    }
    $("systemEnabled").checked = state.system.enabled;
    $("indicatorEnabled").checked = state.system.indicators.enabled;
    $("btnSyncSystemMappings").disabled = !state.connected || gate.running;
    $("btnAddSystemAction").disabled = state.system.keyActions.length >=
      CONTROL_KEYS.length;
    $("btnApplyMeeting").disabled =
      !state.system.audio.inputUid && !state.system.audio.outputUid;
    $("btnToggleSystemMic").disabled = context.audio?.canMuteInput === false;
    const livebar = $("systemLivebar");
    livebar.classList.toggle("is-live", state.system.enabled);
    $("systemLiveTitle").textContent = state.system.enabled
      ? `Profile ${state.profile + 1} system controls are live`
      : `Profile ${state.profile + 1} system controls are paused`;
    $("systemLiveDetail").textContent = state.system.enabled
      ? `${state.system.keyActions.length} key control${
        state.system.keyActions.length === 1 ? "" : "s"
      } · ${state.system.indicators.rules.length} status rule${
        state.system.indicators.rules.length === 1 ? "" : "s"
      }`
      : "Settings stay saved until you enable them.";
    fillDeviceSelect("systemInputDevice", "input", state.system.audio.inputUid);
    fillDeviceSelect("systemOutputDevice", "output", state.system.audio.outputUid);
    renderActions();
    renderIndicators();
    paintIndicators();
    syncMappingStatus();
    configureShortcuts();
  }

  function openActionEditor() {
    if (state.system.keyActions.length >= CONTROL_KEYS.length) return;
    actionEditorReturn = document.activeElement;
    const used = new Set(state.system.keyActions.map((item) => item.keyCode));
    $("systemActionKey").innerHTML = "";
    CONTROL_KEYS.filter((key) => !used.has(key.code)).forEach((key) =>
      $("systemActionKey").append(option(key.code, key.label))
    );
    $("systemActionType").innerHTML = "";
    SYSTEM_ACTIONS.forEach((action) =>
      $("systemActionType").append(option(action.id, action.label))
    );
    $("systemActionEditor").hidden = false;
    $("systemActionKey").focus();
  }

  function closeActionEditor() {
    $("systemActionEditor").hidden = true;
    actionEditorReturn?.focus?.();
  }

  function saveAction() {
    const keyCode = $("systemActionKey").value;
    const action = $("systemActionType").value;
    if (!keyCode || !SYSTEM_ACTION_BY_ID.has(action)) return;
    const next = systemDraft();
    next.keyActions.push({
      id: crypto.randomUUID(),
      keyCode,
      action,
      originalValue: null,
    });
    setSystem({ keyActions: next.keyActions });
    closeActionEditor();
  }

  function syncIndicatorEditorVisibility() {
    const process = $("indicatorSource").value === "process";
    const row = $("indicatorTargetType").value === "row";
    $("indicatorMatchField").hidden = !process;
    $("indicatorKeyField").hidden = row;
    $("indicatorRowField").hidden = !row;
  }

  function openIndicatorEditor(rule = null) {
    indicatorEditorReturn = document.activeElement;
    editingIndicatorId = rule?.id || null;
    $("indicatorEditorTitle").textContent = rule ? "Edit indicator" : "Add indicator";
    $("indicatorSource").value = rule?.source || "process";
    $("indicatorName").value = rule?.name || "";
    $("indicatorMatch").value = rule?.match || "";
    $("indicatorTargetType").value = rule?.targetType || "key";
    $("indicatorKey").value = rule?.keyCode || "M";
    $("indicatorRow").value = String(rule?.row || 0);
    $("indicatorColor").value = rule?.color || "#7c5cff";
    $("indicatorPriority").value = String(rule?.priority ?? 50);
    $("indicatorPriorityOut").textContent = String(rule?.priority ?? 50);
    syncIndicatorEditorVisibility();
    $("indicatorEditor").hidden = false;
    $("indicatorSource").focus();
  }

  function closeIndicatorEditor() {
    $("indicatorEditor").hidden = true;
    editingIndicatorId = null;
    indicatorEditorReturn?.focus?.();
  }

  function saveIndicator() {
    const source = $("indicatorSource").value;
    const match = $("indicatorMatch").value.trim().toLowerCase();
    if (source === "process" && !match) {
      $("indicatorMatch").focus();
      toast("Enter part of the process name", "error");
      return;
    }
    const rule = {
      id: editingIndicatorId || crypto.randomUUID(),
      enabled: true,
      source,
      name: $("indicatorName").value.trim() ||
        (source === "mic-muted"
          ? "Microphone muted"
          : source === "mic-live"
          ? "Microphone live"
          : match),
      match: source === "process" ? match : "",
      targetType: $("indicatorTargetType").value,
      keyCode: $("indicatorKey").value,
      row: Number($("indicatorRow").value),
      color: $("indicatorColor").value,
      priority: Number($("indicatorPriority").value),
    };
    const rules = state.system.indicators.rules.filter(
      (value) => value.id !== editingIndicatorId,
    );
    rules.push(rule);
    setSystem({
      indicators: {
        enabled: true,
        rules,
      },
    });
    closeIndicatorEditor();
  }

  async function perform(action) {
    contextGeneration++;
    clearTimeout(contextTimer);
    try {
      const audio = await window.zenShell?.performSystemAction?.({
        action,
        inputUid: state.system.audio.inputUid,
        outputUid: state.system.audio.outputUid,
      });
      if (audio) {
        context = { ...context, audio };
        syncContext();
      }
      toast(
        action === "microphone-toggle"
          ? context.audio?.micMuted ? "Microphone muted" : "Microphone live"
          : "Meeting setup applied",
        "ok",
      );
    } catch (error) {
      toast(error?.message || String(error), "error");
    } finally {
      scheduleContextRefresh();
    }
  }

  ROWS.flat().forEach((key) => $("indicatorKey").append(option(key.code, key.label || key.code)));

  $("systemEnabled").addEventListener("change", () => {
    setSystem({ enabled: $("systemEnabled").checked });
    if (state.connected) syncMappings();
  });
  $("indicatorEnabled").addEventListener("change", () => {
    setSystem({
      indicators: {
        ...state.system.indicators,
        enabled: $("indicatorEnabled").checked,
      },
    });
  });
  $("btnAddSystemAction").addEventListener("click", openActionEditor);
  $("btnCancelSystemAction").addEventListener("click", closeActionEditor);
  $("btnSaveSystemAction").addEventListener("click", saveAction);
  $("btnMediaPair").addEventListener("click", () => {
    const next = systemDraft();
    next.enabled = true;
    next.keyActions = next.keyActions.filter(
      (item) => !["PGUP", "PGDN"].includes(item.keyCode),
    );
    next.keyActions.push(
      {
        id: crypto.randomUUID(),
        keyCode: "PGUP",
        action: "media-previous",
        originalValue: null,
      },
      {
        id: crypto.randomUUID(),
        keyCode: "PGDN",
        action: "media-next",
        originalValue: null,
      },
    );
    model.setSystem(next);
    sync();
    if (state.connected) syncMappings();
  });
  $("btnSyncSystemMappings").addEventListener("click", syncMappings);
  $("systemInputDevice").addEventListener("change", () =>
    setSystem({ audio: { inputUid: $("systemInputDevice").value } })
  );
  $("systemOutputDevice").addEventListener("change", () =>
    setSystem({ audio: { outputUid: $("systemOutputDevice").value } })
  );
  $("btnApplyMeeting").addEventListener("click", () => perform("meeting-mode"));
  $("btnToggleSystemMic").addEventListener("click", () =>
    perform("microphone-toggle")
  );
  $("btnAddIndicator").addEventListener("click", () => openIndicatorEditor());
  $("btnCancelIndicator").addEventListener("click", closeIndicatorEditor);
  $("btnSaveIndicator").addEventListener("click", saveIndicator);
  $("indicatorSource").addEventListener("change", syncIndicatorEditorVisibility);
  $("indicatorTargetType").addEventListener("change", syncIndicatorEditorVisibility);
  $("indicatorPriority").addEventListener("input", () => {
    $("indicatorPriorityOut").textContent = $("indicatorPriority").value;
  });
  document.querySelectorAll("[data-indicator-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      const kind = button.dataset.indicatorPreset;
      const key = { mic: "M", codex: "C", claude: "L", grok: "G" }[kind] || "M";
      const rules = [
        ...state.system.indicators.rules,
        createIndicatorPreset(kind, key),
      ];
      setSystem({ indicators: { enabled: true, rules } });
    });
  });
  for (const id of ["systemActionEditor", "indicatorEditor"]) {
    $(id).addEventListener("click", (event) => {
      if (event.target !== $(id)) return;
      if (id === "systemActionEditor") closeActionEditor();
      else closeIndicatorEditor();
    });
  }
  document.addEventListener("keydown", (event) => {
    const openEditor = !$("indicatorEditor").hidden
      ? $("indicatorEditor")
      : !$("systemActionEditor").hidden
      ? $("systemActionEditor")
      : null;
    if (!openEditor) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (openEditor === $("indicatorEditor")) closeIndicatorEditor();
      else closeActionEditor();
      return;
    }
    if (event.key === "Tab") {
      const controls = [...openEditor.querySelectorAll(
        "button:not(:disabled), input:not(:disabled), select:not(:disabled)",
      )].filter((control) => !control.closest("[hidden]"));
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  window.zenShell?.onSystemContext?.((partial) => {
    context = {
      ...context,
      ...partial,
      audio: partial.audio || context.audio,
      processes: partial.processes || context.processes,
    };
    syncContext();
  });
  window.zenShell?.onSystemActionError?.((message) => toast(message, "error"));

  refreshContext();
  sync();

  return {
    sync,
    refreshContext,
    applyMappingsWithinGate,
    connectionChanged: () => {
      mappingStatus = "";
      sync();
    },
    report: () => ({
      systemEnabled: state.system.enabled,
      micMuted: context.audio?.micMuted === true,
    }),
  };
}
