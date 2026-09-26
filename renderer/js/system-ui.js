import {
  CONTROL_KEYS,
  SYSTEM_ACTIONS,
  SYSTEM_ACTION_BY_ID,
  buildIndicatorOverlay,
  buildKeyActionPlan,
  createIndicatorPreset,
  hostShortcutMappings,
  keyActionTriggerLabel,
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
    const mappings = state.connected ? hostShortcutMappings(state.system) : [];
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
      node.textContent = "";
    } else if (shortcutFailures.length) {
      node.textContent = `macOS reserved ${shortcutFailures.join(", ")}. Choose another control.`;
    } else if (!state.system.enabled) {
      node.textContent = "";
    } else {
      node.textContent = "";
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
      key.textContent = keyActionTriggerLabel(item);
      const body = document.createElement("div");
      body.className = "system-row__body";
      const title = document.createElement("strong");
      title.textContent = action?.label || item.action;
      const detail = document.createElement("span");
      detail.textContent = item.triggerType === "shortcut"
        ? `${action?.detail || ""} · keeps ${keyLabel(item.keyCode)} unchanged`
        : action?.detail || "";
      body.append(title, detail);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn btn--ghost btn--sm";
      remove.textContent = "Remove";
      remove.setAttribute(
        "aria-label",
        `Remove ${keyActionTriggerLabel(item)} binding`,
      );
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
    $("systemActionTrigger").value = "replace";
    document.querySelectorAll("[data-system-modifier]").forEach((input) => {
      input.checked = false;
    });
    syncActionEditor();
    $("systemActionEditor").hidden = false;
    $("systemActionTrigger").focus();
  }

  function closeActionEditor() {
    $("systemActionEditor").hidden = true;
    actionEditorReturn?.focus?.();
  }

  function saveAction() {
    const keyCode = $("systemActionKey").value;
    const action = $("systemActionType").value;
    const triggerType = $("systemActionTrigger").value === "shortcut"
      ? "shortcut"
      : "replace";
    const modifiers = [...document.querySelectorAll(
      "[data-system-modifier]:checked",
    )].map((input) => input.value);
    const actionDefinition = SYSTEM_ACTION_BY_ID.get(action);
    if (!keyCode || !actionDefinition) return;
    if (triggerType === "shortcut" && !modifiers.length) {
      toast("Choose at least one modifier", "error");
      document.querySelector("[data-system-modifier]")?.focus();
      return;
    }
    if (triggerType === "shortcut" && !actionDefinition.hostAction) return;
    const next = systemDraft();
    next.keyActions.push({
      id: crypto.randomUUID(),
      keyCode,
      action,
      triggerType,
      modifiers,
      originalValue: null,
    });
    setSystem({ keyActions: next.keyActions });
    closeActionEditor();
  }

  function syncActionEditor() {
    const shortcut = $("systemActionTrigger").value === "shortcut";
    $("systemModifierField").hidden = !shortcut;
    const selectedAction = $("systemActionType").value;
    const actions = SYSTEM_ACTIONS.filter((action) =>
      !shortcut || action.hostAction
    );
    $("systemActionType").innerHTML = "";
    actions.forEach((action) =>
      $("systemActionType").append(option(action.id, action.label))
    );
    $("systemActionType").value = actions.some(
      (action) => action.id === selectedAction,
    )
      ? selectedAction
      : shortcut
      ? "microphone-toggle"
      : actions[0]?.id || "";
    const action = SYSTEM_ACTION_BY_ID.get($("systemActionType").value);
    if (shortcut) {
      const modifiers = [...document.querySelectorAll(
        "[data-system-modifier]:checked",
      )].map((input) => input.value);
      const trigger = keyActionTriggerLabel({
        triggerType: "shortcut",
        keyCode: $("systemActionKey").value,
        modifiers,
      });
      $("systemActionHint").textContent = modifiers.length
        ? `${trigger} runs ${action?.label || "this action"} while the keyboard is connected and Zenblade is in the background. The key keeps its normal function.`
        : "Choose one or more modifiers. The key keeps its normal function.";
    } else {
      $("systemActionHint").textContent = action?.hostAction
        ? `${keyLabel($("systemActionKey").value)} sends a private desktop trigger while Zenblade is running. Removing it restores the factory key.`
        : `${keyLabel($("systemActionKey").value)} is replaced on the keyboard and works without the app window. Removing it restores the factory key.`;
    }
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
        triggerType: "replace",
        modifiers: [],
        originalValue: null,
      },
      {
        id: crypto.randomUUID(),
        keyCode: "PGDN",
        action: "media-next",
        triggerType: "replace",
        modifiers: [],
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
  $("systemActionTrigger").addEventListener("change", syncActionEditor);
  $("systemActionKey").addEventListener("change", syncActionEditor);
  $("systemActionType").addEventListener("change", syncActionEditor);
  document.querySelectorAll("[data-system-modifier]").forEach((input) =>
    input.addEventListener("change", syncActionEditor)
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
  };
}
