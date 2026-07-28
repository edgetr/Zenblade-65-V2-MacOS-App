import { CODE_TO_MATRIX_INDEX, ROWS } from "./layout.js";

export const DESKTOP_TRIGGER_CODES = Object.freeze(
  Array.from({ length: 12 }, (_, index) => 104 + index),
);

export const CONTROL_KEYS = Object.freeze([
  { code: "HOME", label: "Home", accelerator: "Home", triggerCode: 104 },
  { code: "PGUP", label: "Page Up", accelerator: "PageUp", triggerCode: 105 },
  { code: "PGDN", label: "Page Down", accelerator: "PageDown", triggerCode: 106 },
  { code: "END", label: "End", accelerator: "End", triggerCode: 107 },
]);

export const SYSTEM_MODIFIERS = Object.freeze([
  { id: "Command", label: "⌘ Command" },
  { id: "Control", label: "⌃ Control" },
  { id: "Alt", label: "⌥ Option" },
  { id: "Shift", label: "⇧ Shift" },
]);

export const DEFAULT_KEYCODES = Object.freeze({
  HOME: 74,
  PGUP: 75,
  PGDN: 78,
  END: 77,
});

export const SYSTEM_ACTIONS = Object.freeze([
  // These are the firmware's macOS-aware/QMK media keycodes, not desktop
  // shortcuts. The keyboard emits them directly after a verified keymap write.
  {
    id: "media-previous",
    label: "Previous track",
    detail: "Runs directly on the keyboard",
    onboardCode: 188,
  },
  {
    id: "media-next",
    label: "Next track",
    detail: "Runs directly on the keyboard",
    onboardCode: 187,
  },
  {
    id: "media-play-pause",
    label: "Play / pause",
    detail: "Runs directly on the keyboard",
    onboardCode: 174,
  },
  {
    id: "volume-down",
    label: "Volume down",
    detail: "Runs directly on the keyboard",
    onboardCode: 170,
  },
  {
    id: "volume-up",
    label: "Volume up",
    detail: "Runs directly on the keyboard",
    onboardCode: 169,
  },
  {
    id: "volume-mute",
    label: "Mute output",
    detail: "Runs directly on the keyboard",
    onboardCode: 168,
  },
  {
    id: "microphone-toggle",
    label: "Mute / unmute microphone",
    detail: "Uses Zenblade while the app is running",
    hostAction: true,
  },
  {
    id: "meeting-mode",
    label: "Apply meeting setup",
    detail: "Selects this profile’s audio devices and unmutes",
    hostAction: true,
  },
  {
    id: "set-output",
    label: "Select audio output",
    detail: "Uses the selected output below",
    hostAction: true,
    needsOutput: true,
  },
  {
    id: "set-input",
    label: "Select microphone",
    detail: "Uses the selected microphone below",
    hostAction: true,
    needsInput: true,
  },
]);

export const SYSTEM_ACTION_BY_ID = new Map(
  SYSTEM_ACTIONS.map((action) => [action.id, action]),
);

const clamp = (value, min, max) =>
  Math.max(min, Math.min(max, Number(value) || 0));
const text = (value, limit = 100) =>
  String(value || "").trim().slice(0, limit);
const color = (value, fallback = "#7c5cff") =>
  /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value).toLowerCase() : fallback;
const uid = () =>
  globalThis.crypto?.randomUUID?.() ||
  `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const defaultSystemProfile = () => ({
  enabled: false,
  keyActions: [],
  audio: {
    inputUid: "",
    outputUid: "",
  },
  indicators: {
    enabled: false,
    rules: [],
  },
});

export function normalizeSystemProfile(raw = {}) {
  const result = defaultSystemProfile();
  result.enabled = raw.enabled === true;
  result.audio.inputUid = text(raw.audio?.inputUid, 240);
  result.audio.outputUid = text(raw.audio?.outputUid, 240);

  const usedKeys = new Set();
  for (const value of Array.isArray(raw.keyActions) ? raw.keyActions : []) {
    const keyCode = text(value?.keyCode, 12).toUpperCase();
    const action = SYSTEM_ACTION_BY_ID.get(text(value?.action, 40));
    const triggerType = value?.triggerType === "shortcut"
      ? "shortcut"
      : "replace";
    const modifiers = SYSTEM_MODIFIERS
      .map(({ id }) => id)
      .filter((id) => Array.isArray(value?.modifiers) &&
        value.modifiers.includes(id));
    if (
      !CONTROL_KEYS.some((key) => key.code === keyCode) ||
      !action ||
      (triggerType === "shortcut" && (!action.hostAction || !modifiers.length)) ||
      usedKeys.has(keyCode)
    ) continue;
    usedKeys.add(keyCode);
    result.keyActions.push({
      id: text(value.id, 80) || uid(),
      keyCode,
      action: action.id,
      triggerType,
      modifiers,
      originalValue: Number.isFinite(Number(value.originalValue))
        ? clamp(Math.round(Number(value.originalValue)), 0, 0xffff)
        : null,
    });
  }

  const usedRuleIds = new Set();
  for (const value of Array.isArray(raw.indicators?.rules)
    ? raw.indicators.rules
    : []) {
    const source = ["mic-muted", "mic-live", "process"].includes(value?.source)
      ? value.source
      : "process";
    const targetType = value?.targetType === "row" ? "row" : "key";
    const keyCode = text(value?.keyCode, 12).toUpperCase();
    const row = clamp(Math.round(Number(value?.row)), 0, ROWS.length - 1);
    const match = text(value?.match, 80).toLowerCase();
    if (targetType === "key" && CODE_TO_MATRIX_INDEX[keyCode] == null) continue;
    if (source === "process" && !match) continue;
    let id = text(value?.id, 80) || uid();
    if (usedRuleIds.has(id)) id = uid();
    usedRuleIds.add(id);
    result.indicators.rules.push({
      id,
      enabled: value?.enabled !== false,
      name: text(value?.name, 60) ||
        (source === "mic-muted" ? "Microphone muted" : match || "Status"),
      source,
      match,
      targetType,
      keyCode: targetType === "key" ? keyCode : "",
      row: targetType === "row" ? row : 0,
      color: color(value?.color),
      priority: clamp(Math.round(Number(value?.priority) || 50), 0, 100),
    });
  }
  result.indicators.enabled =
    raw.indicators?.enabled === true && result.indicators.rules.length > 0;
  return result;
}

export function actionKeycode(actionId, hostIndex = 0) {
  const action = SYSTEM_ACTION_BY_ID.get(actionId);
  if (!action) return null;
  if (action.onboardCode != null) return action.onboardCode;
  return DESKTOP_TRIGGER_CODES[hostIndex] ?? null;
}

export function buildKeyActionPlan(_previous = {}, next = {}) {
  const after = normalizeSystemProfile(next);
  const current = new Map(after.keyActions
    .filter((item) => item.triggerType === "replace")
    .map((item) => [item.keyCode, item]));
  return CONTROL_KEYS.map(({ code: keyCode }) => {
    const item = current.get(keyCode);
    return item && after.enabled
      ? {
        keyCode,
        value: actionKeycode(
          item.action,
          CONTROL_KEYS.findIndex((key) => key.code === keyCode),
        ),
        kind: "action",
      }
      : {
        keyCode,
        value: DEFAULT_KEYCODES[keyCode],
        kind: "restore",
      };
  }).filter((item) => item.value != null);
}

export function hostShortcutMappings(profile = {}) {
  const normalized = normalizeSystemProfile(profile);
  if (!normalized.enabled) return [];
  return normalized.keyActions.flatMap((item) => {
    const action = SYSTEM_ACTION_BY_ID.get(item.action);
    const key = CONTROL_KEYS.find((candidate) => candidate.code === item.keyCode);
    if (!action?.hostAction || !key) return [];
    const accelerator = item.triggerType === "shortcut"
      ? [...item.modifiers, key.accelerator].join("+")
      : `F${13 + CONTROL_KEYS.findIndex(
        (candidate) => candidate.code === item.keyCode,
      )}`;
    return [{
      accelerator,
      action: item.action,
      inputUid: normalized.audio.inputUid,
      outputUid: normalized.audio.outputUid,
    }];
  });
}

export function keyActionTriggerLabel(item = {}) {
  const key = CONTROL_KEYS.find((candidate) => candidate.code === item.keyCode);
  if (!key) return item.keyCode || "Key";
  if (item.triggerType !== "shortcut") return key.label;
  const modifierLabels = SYSTEM_MODIFIERS
    .filter(({ id }) => item.modifiers?.includes(id))
    .map(({ label }) => label.split(" ")[0]);
  return `${modifierLabels.join("")}${key.label}`;
}

function ruleActive(rule, context) {
  if (!rule.enabled) return false;
  if (rule.source === "mic-muted") return context?.audio?.micMuted === true;
  if (rule.source === "mic-live") return context?.audio?.micMuted === false;
  return context?.processes?.[rule.id] === true;
}

export function buildIndicatorOverlay(profile = {}, context = {}, phase = 0) {
  const normalized = normalizeSystemProfile(profile);
  if (!normalized.indicators.enabled) return {};
  const overlay = {};
  const active = normalized.indicators.rules
    .filter((rule) => ruleActive(rule, context))
    .sort((a, b) => a.priority - b.priority);

  const put = (code, rule, intensity = 1, activity = null) => {
    const existing = overlay[code];
    if (existing && existing.priority > rule.priority) return;
    overlay[code] = {
      color: rule.color,
      intensity,
      label: rule.name,
      priority: rule.priority,
      ...(activity || {}),
    };
  };

  active.forEach((rule) => {
    if (rule.targetType === "key") {
      put(rule.keyCode, rule);
      return;
    }
    const keys = ROWS[rule.row] || [];
    if (!keys.length) return;
    const head = Math.abs(Math.round(phase)) % keys.length;
    keys.forEach((key, index) => {
      const distance = (head - index + keys.length) % keys.length;
      put(
        key.code,
        rule,
        distance < 4 ? 1 - distance * 0.22 : 0.14,
        {
          activityIndex: index,
          activityCount: keys.length,
        },
      );
    });
  });
  return overlay;
}

export function createIndicatorPreset(kind, keyCode = "M") {
  const values = {
    mic: {
      name: "Microphone muted",
      source: "mic-muted",
      match: "",
      color: "#ef4444",
    },
    codex: {
      name: "Codex running",
      source: "process",
      match: "codex",
      color: "#3b82f6",
    },
    claude: {
      name: "Claude Code running",
      source: "process",
      match: "claude",
      color: "#f59e0b",
    },
    grok: {
      name: "Grok running",
      source: "process",
      match: "grok",
      color: "#9ca3af",
    },
    activity: {
      name: "Coding agent activity",
      source: "process",
      match: "codex, claude, grok",
      color: "#7c5cff",
      targetType: "row",
      row: 0,
    },
  };
  const preset = values[kind] || values.codex;
  return {
    id: uid(),
    enabled: true,
    ...preset,
    targetType: preset.targetType || "key",
    keyCode: preset.targetType === "row" ? "" : keyCode,
    row: preset.row || 0,
    priority: kind === "mic" ? 80 : 50,
  };
}
