import { ROWS, CODE_TO_MATRIX_INDEX, LAYOUT_KEY_COUNT } from "./layout.js";
import {
  ZenbladeDevice,
  LIGHT_MODES,
  PROFILE_COUNT,
  KEY_COUNT,
  keyDisplayColor,
  keyOverrideDisplayColor,
  lightingSwatchCss,
  lightingAccentRgb,
  rgbToCss,
  rgbToHex,
  rgbToHsl,
  rgbToHsv,
  hexToRgb,
  hsvToRgb,
  hslToRgb,
  pickZenbladeDevice,
} from "./protocol.js";

const kb = new ZenbladeDevice();
const STORAGE_KEY = "zenblade.profiles.v2";

if (LAYOUT_KEY_COUNT !== KEY_COUNT) {
  console.warn(
    `[zenblade] layout key count (${LAYOUT_KEY_COUNT}) != protocol KEY_COUNT (${KEY_COUNT})`
  );
}

function defaultLighting() {
  return {
    isOn: true,
    mode: 1,
    brightness: 80,
    speed: 50,
    hue: 0,
    saturation: 100,
  };
}

function defaultActuation() {
  return {
    press: 15,
    release: 15,
    rapidTrigger: true,
  };
}

function defaultProfile() {
  return {
    lighting: defaultLighting(),
    actuation: defaultActuation(),
    keyOverrides: {},
  };
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function defaultStore() {
  return {
    activeProfile: 0,
    profiles: Array.from({ length: PROFILE_COUNT }, () => defaultProfile()),
  };
}

function numOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultStore();
    const parsed = JSON.parse(raw);
    const store = defaultStore();
    if (typeof parsed.activeProfile === "number") {
      store.activeProfile = Math.max(
        0,
        Math.min(PROFILE_COUNT - 1, parsed.activeProfile | 0)
      );
    }
    if (Array.isArray(parsed.profiles)) {
      for (let i = 0; i < PROFILE_COUNT; i++) {
        const src = parsed.profiles[i];
        if (!src || typeof src !== "object") continue;
        const dst = store.profiles[i];
        if (src.lighting && typeof src.lighting === "object") {
          const modeRaw = numOr(src.lighting.mode, 1);
          dst.lighting = {
            isOn: !!src.lighting.isOn,
            mode: modeRaw === 0 ? 1 : modeRaw,
            brightness: clamp(numOr(src.lighting.brightness, 80), 0, 100),
            speed: clamp(numOr(src.lighting.speed, 50), 0, 100),
            hue: clamp(numOr(src.lighting.hue, 0), 0, 359),
            saturation: clamp(numOr(src.lighting.saturation, 100), 0, 100),
          };
        }
        if (src.actuation && typeof src.actuation === "object") {
          dst.actuation = {
            press: clamp(numOr(src.actuation.press, 15), 1, 40),
            release: clamp(numOr(src.actuation.release, 15), 1, 40),
            rapidTrigger: src.actuation.rapidTrigger !== false,
          };
        }
        if (src.keyOverrides && typeof src.keyOverrides === "object") {
          dst.keyOverrides = {};
          for (const [code, ov] of Object.entries(src.keyOverrides)) {
            if (!ov || typeof ov !== "object") continue;
            if (CODE_TO_MATRIX_INDEX[code] == null) continue;
            dst.keyOverrides[code] = {
              press: clamp(numOr(ov.press, 15), 1, 40),
              release: clamp(numOr(ov.release, 15), 1, 40),
              macro: String(ov.macro || ""),
              combo: String(ov.combo || ""),
            };
          }
        }
      }
    }
    return store;
  } catch (err) {
    console.warn("profile store load failed", err);
    return defaultStore();
  }
}

function saveStore() {
  try {
    snapshotCurrentToStore();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profileStore));
  } catch (err) {
    console.warn("profile store save failed", err);
  }
}

let lightingSaveTimer = 0;
let actSaveTimer = 0;

function flushStore() {
  clearTimeout(lightingSaveTimer);
  clearTimeout(actSaveTimer);
  lightingSaveTimer = 0;
  actSaveTimer = 0;
  saveStore();
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function snapshotCurrentToStore() {
  const idx = state.profile;
  if (idx < 0 || idx >= PROFILE_COUNT) return;
  profileStore.profiles[idx] = {
    lighting: deepClone(state.lighting),
    actuation: deepClone(state.actuation),
    keyOverrides: deepClone(state.keyOverrides),
  };
  profileStore.activeProfile = idx;
}

function applyProfileFromStore(index) {
  const p = deepClone(profileStore.profiles[index] || defaultProfile());
  state.profile = index;
  state.lighting = p.lighting;
  state.actuation = p.actuation;
  state.keyOverrides = p.keyOverrides || {};
  state.selectedKey = null;
  applyLightingToForm(state.lighting);
  applyActuationToForm(state.actuation);
  setProfileUI(index);
  clearKeySelection();
  paintBoardsFromLighting();
  updateAccentFromLighting();
}

const profileStore = loadStore();

const state = {
  connected: false,
  profile: profileStore.activeProfile,
  lighting: deepClone(
    profileStore.profiles[profileStore.activeProfile]?.lighting || defaultLighting()
  ),
  actuation: deepClone(
    profileStore.profiles[profileStore.activeProfile]?.actuation || defaultActuation()
  ),
  keyOverrides: deepClone(
    profileStore.profiles[profileStore.activeProfile]?.keyOverrides || {}
  ),
  selectedKey: null,
  busy: false,
  advancedColorOpen: false,
};

function matrixIndexForCode(code) {
  const idx = CODE_TO_MATRIX_INDEX[code];
  return idx == null ? null : idx;
}

const $ = (id) => document.getElementById(id);
const toastEl = $("toast");

function toast(msg, kind = "") {
  toastEl.textContent = msg;
  toastEl.className = `toast is-show${kind ? ` is-${kind}` : ""}`;
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => {
    toastEl.classList.remove("is-show");
  }, 2800);
}

function setFieldInvalid(el, invalid) {
  if (!el) return;
  el.classList.toggle("is-invalid", !!invalid);
  el.setAttribute("aria-invalid", invalid ? "true" : "false");
}

function setConnectedUI(on, info) {
  state.connected = on;

  $("btnConnect").disabled = on;
  $("btnDisconnect").disabled = !on;
  $("btnRefresh").disabled = !on;

  document.querySelectorAll(".nav__btn[data-panel]").forEach((btn) => {
    if (btn.dataset.panel === "keyboard") return;
    btn.disabled = !on;
  });

  $("statName").textContent = info?.productName || "—";
  $("statPid").textContent = info
    ? `0x${info.productId.toString(16).padStart(4, "0")}`
    : "—";
  $("statProfile").textContent = on ? `P${state.profile + 1}` : "—";
}

function updateAccentFromLighting() {
  const rgb = lightingAccentRgb(state.lighting);
  const { r, g, b } = rgb;
  const root = document.documentElement;
  root.style.setProperty("--accent-rgb", `${r}, ${g}, ${b}`);
  root.style.setProperty("--accent", rgbToCss(rgb));
  const hot = {
    r: Math.min(255, r + 40),
    g: Math.min(255, g + 40),
    b: Math.min(255, b + 40),
  };
  root.style.setProperty("--accent-hot", rgbToCss(hot));
  root.style.setProperty("--accent-dim", `rgba(${r}, ${g}, ${b}, 0.16)`);
  root.style.setProperty("--accent-glow", `rgba(${r}, ${g}, ${b}, 0.35)`);
  const ov = hsvToRgb((rgbToHsv(r, g, b).h + 168) % 360, 70, 90);
  root.style.setProperty("--override-rgb", `${ov.r}, ${ov.g}, ${ov.b}`);
}

document.getElementById("nav").addEventListener("click", (e) => {
  const btn = e.target.closest(".nav__btn");
  if (!btn || btn.disabled) return;
  const panel = btn.dataset.panel;
  document.querySelectorAll(".nav__btn").forEach((b) => b.classList.remove("is-active"));
  btn.classList.add("is-active");
  document.querySelectorAll(".panel").forEach((p) => p.classList.remove("is-active"));
  $(`panel-${panel}`).classList.add("is-active");
  scheduleScaleBoards();
  paintBoardsFromLighting();
  updateParamVisibility();
});

function renderBoard(el, interactive = false) {
  el.innerHTML = "";
  ROWS.forEach((row, rowIndex) => {
    const rowEl = document.createElement("div");
    rowEl.className = "board__row";
    const colCount = row.length;
    row.forEach((key, colIndex) => {
      const k = document.createElement("button");
      k.type = "button";
      k.className = "key";
      k.style.setProperty("--w", String(key.w));
      k.textContent = key.label;
      k.dataset.code = key.code;
      k.dataset.row = String(rowIndex);
      k.dataset.col = String(colIndex);
      k.dataset.cols = String(colCount);
      k.dataset.rows = String(ROWS.length);
      k.tabIndex = interactive ? 0 : -1;
      if (!interactive) k.setAttribute("aria-hidden", "true");
      else k.setAttribute("aria-label", key.code);
      rowEl.appendChild(k);
    });
    el.appendChild(rowEl);
  });
}

let paintRaf = 0;

function paintBoardKeys(root, L) {
  if (!root) return;
  const keys = root.querySelectorAll(".key");
  const solid = L.mode === 1 || L.mode === 0 || !L.isOn;
  const lit = L.isOn && L.mode !== 0;
  let solidCss = null;
  let solidGlow = "transparent";
  let solidTop = "#2a3038";
  let solidBot = "#1c2128";
  if (solid) {
    const rgb = keyDisplayColor(L, { col: 0, row: 0, colCount: 1, rowCount: 1 });
    solidCss = rgbToCss(rgb);
    solidGlow = lit ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.65)` : "transparent";
    solidTop = lit
      ? rgbToCss({
          r: Math.min(255, Math.round(rgb.r * 0.55 + 115)),
          g: Math.min(255, Math.round(rgb.g * 0.55 + 115)),
          b: Math.min(255, Math.round(rgb.b * 0.55 + 115)),
        })
      : "#2a3038";
    solidBot = lit ? solidCss : "#1c2128";
  }

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const code = key.dataset.code;
    const isOverride = !!(code && state.keyOverrides[code]);
    key.classList.toggle("is-override", isOverride);
    key.classList.toggle("is-selected", state.selectedKey === code);

    let rgb;
    if (isOverride) {
      const pos = {
        col: Number(key.dataset.col || 0),
        row: Number(key.dataset.row || 0),
        colCount: Number(key.dataset.cols || 1),
        rowCount: Number(key.dataset.rows || 1),
      };
      rgb = keyOverrideDisplayColor(L, pos);
    } else if (solid) {
      key.classList.toggle("is-lit", lit);
      key.style.setProperty("--key-rgb", solidCss);
      key.style.setProperty("--key-glow", solidGlow);
      key.style.setProperty("--key-top", solidTop);
      key.style.setProperty("--key-bot", solidBot);
      continue;
    } else {
      rgb = keyDisplayColor(L, {
        col: Number(key.dataset.col || 0),
        row: Number(key.dataset.row || 0),
        colCount: Number(key.dataset.cols || 1),
        rowCount: Number(key.dataset.rows || 1),
      });
    }

    const css = rgbToCss(rgb);
    const keyLit = lit || isOverride;
    key.classList.toggle("is-lit", keyLit);
    key.style.setProperty("--key-rgb", css);
    key.style.setProperty(
      "--key-glow",
      keyLit ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.65)` : "transparent"
    );
    key.style.setProperty(
      "--key-top",
      keyLit
        ? rgbToCss({
            r: Math.min(255, Math.round(rgb.r * 0.55 + 115)),
            g: Math.min(255, Math.round(rgb.g * 0.55 + 115)),
            b: Math.min(255, Math.round(rgb.b * 0.55 + 115)),
          })
        : "#2a3038"
    );
    key.style.setProperty("--key-bot", keyLit ? css : "#1c2128");
  }
}

function paintBoardsFromLightingNow() {
  const L = state.lighting;
  const swatchEl = $("colorSwatch");
  if (swatchEl) {
    swatchEl.style.background = lightingSwatchCss(L);
  }
  const rgbReadout = $("rgbReadout");
  if (rgbReadout) {
    const base = keyDisplayColor(L, {
      col: 0,
      row: 0,
      colCount: 1,
      rowCount: 1,
    });
    rgbReadout.textContent = L.isOn
      ? `${base.r}, ${base.g}, ${base.b}`
      : "—";
  }

  paintBoardKeys($("keyboardBoard"), L);
  paintBoardKeys($("lightingBoard"), L);
  syncColorPicker();
  syncAdvancedColorFields();
  updateAccentFromLighting();
}

function updateParamVisibility() {
  const mode = LIGHT_MODES.find((m) => m.id === state.lighting.mode);
  const params = mode?.params || ["brightness", "speed", "color"];
  const showSpeed = params.includes("speed");
  const showColor = params.includes("color");
  const showBright = params.includes("brightness");
  const setVis = (id, on) => {
    const el = $(id);
    if (el) el.style.display = on ? "" : "none";
  };
  setVis("fieldBright", showBright);
  setVis("fieldSpeed", showSpeed);
  setVis("fieldHue", showColor);
  setVis("fieldSat", showColor);
  setVis("fieldColor", showColor);
  setVis("simpleColorControls", showColor);
  const adv = $("advancedColor");
  if (!showColor) {
    if (adv) adv.hidden = true;
    state.advancedColorOpen = false;
  }
  syncAdvancedColorMode();
}

function syncAdvancedColorMode() {
  const adv = $("advancedColor");
  const simple = $("simpleColorControls");
  const open = !!state.advancedColorOpen;
  if (adv) adv.hidden = !open;
  if (simple) {
    const mode = LIGHT_MODES.find((m) => m.id === state.lighting.mode);
    const showColor = (mode?.params || []).includes("color");
    simple.hidden = open || !showColor;
  }
  const btn = $("btnToggleAdvancedColor");
  if (btn) btn.textContent = open ? "Simple" : "Advanced";
}

function paintBoardsFromLighting() {
  if (paintRaf) return;
  paintRaf = requestAnimationFrame(() => {
    paintRaf = 0;
    paintBoardsFromLightingNow();
  });
}

renderBoard($("keyboardBoard"), true);
renderBoard($("lightingBoard"), false);

const BOARD_UNITS = 16;
let scaleRaf = 0;
const lastScale = new WeakMap();

function scaleBoard(board) {
  if (!board) return;
  const wrap = board.closest(".board-wrap") || board.parentElement;
  if (!wrap) return;
  const style = getComputedStyle(wrap);
  const padX =
    (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
  const inner = Math.max(0, wrap.clientWidth - padX);
  if (inner < 40) return;
  const gap = Math.max(2, Math.min(6, inner * 0.004));
  const u = Math.max(14, Math.min(56, (inner - (BOARD_UNITS - 1) * gap) / BOARD_UNITS));
  const key = `${u.toFixed(2)}|${gap.toFixed(2)}`;
  if (lastScale.get(board) === key) return;
  lastScale.set(board, key);
  board.style.setProperty("--u", `${u}px`);
  board.style.setProperty("--key-gap", `${gap}px`);
}

function scaleAllBoards() {
  document.querySelectorAll(".board").forEach(scaleBoard);
}

function scheduleScaleBoards() {
  if (scaleRaf) return;
  scaleRaf = requestAnimationFrame(() => {
    scaleRaf = 0;
    scaleAllBoards();
  });
}

const boardResizeObserver =
  typeof ResizeObserver !== "undefined"
    ? new ResizeObserver(() => scheduleScaleBoards())
    : null;

function observeBoards() {
  document.querySelectorAll(".board-wrap").forEach((el) => {
    boardResizeObserver?.observe(el);
  });
  scaleAllBoards();
}

observeBoards();

function clearKeySelection() {
  state.selectedKey = null;
  const empty = $("keyEditorEmpty");
  const body = $("keyEditorBody");
  if (empty) empty.hidden = false;
  if (body) body.hidden = true;
  paintBoardsFromLighting();
}

function openKeyEditor(code) {
  state.selectedKey = code;
  const empty = $("keyEditorEmpty");
  const body = $("keyEditorBody");
  if (empty) empty.hidden = true;
  if (body) body.hidden = false;

  const ov = state.keyOverrides[code];
  const press = ov?.press ?? state.actuation.press;
  const release = ov?.release ?? state.actuation.release;
  $("keyEditorTitle").textContent = code;
  $("keyPress").value = press;
  $("keyOutPress").textContent = String(press);
  $("keyRelease").value = release;
  $("keyOutRelease").textContent = String(release);
  $("keyMacro").value = ov?.macro || "";
  $("keyCombo").value = ov?.combo || "";
  paintBoardsFromLighting();
}

$("keyboardBoard").addEventListener("click", (e) => {
  const key = e.target.closest(".key");
  if (!key) return;
  openKeyEditor(key.dataset.code);
});

$("keyPress").addEventListener("input", (e) => {
  $("keyOutPress").textContent = e.target.value;
});
$("keyRelease").addEventListener("input", (e) => {
  $("keyOutRelease").textContent = e.target.value;
});

function buildPressReleaseArrays() {
  const presses = new Array(KEY_COUNT).fill(state.actuation.press);
  const releases = new Array(KEY_COUNT).fill(state.actuation.release);
  for (const [code, ov] of Object.entries(state.keyOverrides)) {
    const idx = matrixIndexForCode(code);
    if (idx == null || idx < 0 || idx >= KEY_COUNT) continue;
    presses[idx] = ov.press;
    releases[idx] = ov.release;
  }
  return { presses, releases };
}

async function writeCurrentActuationToDevice() {
  const { presses, releases } = buildPressReleaseArrays();
  return kb.writeActuationMatrix({
    profileIndex: state.profile,
    pressValues: presses,
    releaseValues: releases,
    rapidTrigger: state.actuation.rapidTrigger,
  });
}

$("btnApplyKey").addEventListener("click", async () => {
  if (!state.selectedKey) return;
  const code = state.selectedKey;
  const press = clamp(Number($("keyPress").value) || 15, 1, 40);
  const release = clamp(Number($("keyRelease").value) || 15, 1, 40);
  const macro = String($("keyMacro").value || "").trim();
  const combo = String($("keyCombo").value || "").trim();

  state.keyOverrides[code] = { press, release, macro, combo };
  saveStore();
  paintBoardsFromLighting();
  openKeyEditor(code);

  if (!kb.connected || state.busy) {
    toast("Key saved", "ok");
    return;
  }
  try {
    state.busy = true;
    await writeCurrentActuationToDevice();
    toast("Key applied", "ok");
  } catch (err) {
    toast(err.message || String(err), "error");
  } finally {
    state.busy = false;
  }
});

$("btnResetKey").addEventListener("click", async () => {
  if (!state.selectedKey) return;
  const code = state.selectedKey;
  delete state.keyOverrides[code];
  saveStore();
  openKeyEditor(code);
  paintBoardsFromLighting();

  if (!kb.connected || state.busy) {
    toast("Reset to Feel default", "ok");
    return;
  }
  try {
    state.busy = true;
    await writeCurrentActuationToDevice();
    toast("Reset applied", "ok");
  } catch (err) {
    toast(err.message || String(err), "error");
  } finally {
    state.busy = false;
  }
});

const modeGrid = $("modeGrid");
LIGHT_MODES.forEach((m) => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "mode-chip";
  b.dataset.mode = String(m.id);
  b.textContent = m.name;
  b.title = m.name;
  if (m.id === state.lighting.mode) b.classList.add("is-active");
  modeGrid.appendChild(b);
});

modeGrid.addEventListener("click", (e) => {
  const chip = e.target.closest(".mode-chip");
  if (!chip) return;
  state.lighting.mode = Number(chip.dataset.mode);
  modeGrid.querySelectorAll(".mode-chip").forEach((c) => c.classList.remove("is-active"));
  chip.classList.add("is-active");
  updateParamVisibility();
  paintBoardsFromLighting();
  saveStore();
});

function bindRange(id, outId, key) {
  const el = $(id);
  const out = $(outId);
  const sync = () => {
    const v = Number(el.value);
    state.lighting[key] = v;
    out.textContent = String(v);
    paintBoardsFromLighting();
  };
  el.addEventListener("input", sync);
  out.textContent = String(el.value);
}

bindRange("lightBright", "outBright", "brightness");
bindRange("lightSpeed", "outSpeed", "speed");
bindRange("lightHue", "outHue", "hue");
bindRange("lightSat", "outSat", "saturation");

function scheduleLightingSave() {
  clearTimeout(lightingSaveTimer);
  lightingSaveTimer = setTimeout(() => saveStore(), 250);
}
["lightBright", "lightSpeed", "lightHue", "lightSat"].forEach((id) => {
  $(id).addEventListener("change", scheduleLightingSave);
  $(id).addEventListener("input", scheduleLightingSave);
});

$("lightOn").addEventListener("change", (e) => {
  state.lighting.isOn = e.target.checked;
  paintBoardsFromLighting();
  saveStore();
});

function syncColorPicker() {
  const picker = $("lightColorPicker");
  if (!picker) return;
  const rgb = keyDisplayColor(
    { ...state.lighting, mode: 1, isOn: true, brightness: 100 },
    { col: 0, row: 0, colCount: 1, rowCount: 1 }
  );
  const hex = rgbToHex(rgb);
  if (picker.value.toLowerCase() !== hex) picker.value = hex;
}

function hexToHueSat(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  return { hue: hsv.h, saturation: hsv.s, value: hsv.v };
}

const colorPicker = $("lightColorPicker");
if (colorPicker) {
  colorPicker.addEventListener("input", (e) => {
    const hs = hexToHueSat(e.target.value);
    if (!hs) return;
    applyHueSat(hs.hue, hs.saturation);
  });
}

const wheelCanvas = $("colorWheel");
const wheelCtx = wheelCanvas?.getContext("2d");
let wheelDragging = false;

function drawColorWheel() {
  if (!wheelCanvas || !wheelCtx) return;
  const size = wheelCanvas.width;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 2;
  const img = wheelCtx.createImageData(size, size);
  const data = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const i = (y * size + x) * 4;
      if (dist > radius) {
        data[i + 3] = 0;
        continue;
      }
      let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (angle < 0) angle += 360;
      const sat = Math.min(100, (dist / radius) * 100);
      const rgb = hsvToRgb(angle, sat, 100);
      data[i] = rgb.r;
      data[i + 1] = rgb.g;
      data[i + 2] = rgb.b;
      data[i + 3] = 255;
    }
  }
  wheelCtx.putImageData(img, 0, 0);

  const h = state.lighting.hue;
  const s = state.lighting.saturation / 100;
  const rad = (h * Math.PI) / 180;
  const mx = cx + Math.cos(rad) * s * radius;
  const my = cy + Math.sin(rad) * s * radius;
  wheelCtx.beginPath();
  wheelCtx.arc(mx, my, 7, 0, Math.PI * 2);
  wheelCtx.strokeStyle = "#fff";
  wheelCtx.lineWidth = 2.5;
  wheelCtx.stroke();
  wheelCtx.beginPath();
  wheelCtx.arc(mx, my, 7, 0, Math.PI * 2);
  wheelCtx.strokeStyle = "rgba(0,0,0,0.55)";
  wheelCtx.lineWidth = 1;
  wheelCtx.stroke();
}

function setHueSatFromWheelEvent(e) {
  if (!wheelCanvas) return;
  const rect = wheelCanvas.getBoundingClientRect();
  const scaleX = wheelCanvas.width / rect.width;
  const scaleY = wheelCanvas.height / rect.height;
  const x = (e.clientX - rect.left) * scaleX;
  const y = (e.clientY - rect.top) * scaleY;
  const cx = wheelCanvas.width / 2;
  const cy = wheelCanvas.height / 2;
  const dx = x - cx;
  const dy = y - cy;
  const radius = wheelCanvas.width / 2 - 2;
  let dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > radius) {
    dist = radius;
  }
  let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (angle < 0) angle += 360;
  const sat = Math.round((dist / radius) * 100);
  state.lighting.hue = Math.round(angle) % 360;
  state.lighting.saturation = sat;
  $("lightHue").value = state.lighting.hue;
  $("outHue").textContent = String(state.lighting.hue);
  $("lightSat").value = sat;
  $("outSat").textContent = String(sat);
  paintBoardsFromLighting();
  drawColorWheel();
  scheduleLightingSave();
}

if (wheelCanvas) {
  wheelCanvas.addEventListener("pointerdown", (e) => {
    wheelDragging = true;
    wheelCanvas.setPointerCapture(e.pointerId);
    setHueSatFromWheelEvent(e);
  });
  wheelCanvas.addEventListener("pointermove", (e) => {
    if (!wheelDragging) return;
    setHueSatFromWheelEvent(e);
  });
  wheelCanvas.addEventListener("pointerup", () => {
    wheelDragging = false;
  });
  wheelCanvas.addEventListener("pointercancel", () => {
    wheelDragging = false;
  });
}

function setAdvancedColorOpen(open) {
  state.advancedColorOpen = !!open;
  syncAdvancedColorMode();
  if (state.advancedColorOpen) {
    drawColorWheel();
    syncAdvancedColorFields();
  }
}

$("btnToggleAdvancedColor")?.addEventListener("click", () => {
  setAdvancedColorOpen(!state.advancedColorOpen);
});
$("btnToggleAdvancedColorClose")?.addEventListener("click", () => {
  setAdvancedColorOpen(false);
});

function syncAdvancedColorFields() {
  const rgb = keyDisplayColor(
    { ...state.lighting, mode: 1, isOn: true, brightness: 100 },
    { col: 0, row: 0, colCount: 1, rowCount: 1 }
  );
  const hex = rgbToHex(rgb);
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const hexEl = $("inputHex");
  const rgbEl = $("inputRgb");
  const hslEl = $("inputHsl");
  if (hexEl && document.activeElement !== hexEl) {
    hexEl.value = hex;
    setFieldInvalid(hexEl, false);
  }
  if (rgbEl && document.activeElement !== rgbEl) {
    rgbEl.value = `${rgb.r}, ${rgb.g}, ${rgb.b}`;
    setFieldInvalid(rgbEl, false);
  }
  if (hslEl && document.activeElement !== hslEl) {
    hslEl.value = `${hsl.h}, ${hsl.s}%, ${hsl.l}%`;
    setFieldInvalid(hslEl, false);
  }

  if (state.advancedColorOpen) drawColorWheel();
}

function parseRgbText(raw) {
  const cleaned = String(raw || "")
    .replace(/^rgba?\(/i, "")
    .replace(/\)$/, "")
    .trim();
  const parts = cleaned
    .split(/[,\s/]+/)
    .map((x) => parseInt(x, 10))
    .filter((n) => Number.isFinite(n));
  if (parts.length < 3) return null;
  return {
    r: clamp(parts[0], 0, 255),
    g: clamp(parts[1], 0, 255),
    b: clamp(parts[2], 0, 255),
  };
}

function parseHslText(raw) {
  const cleaned = String(raw || "")
    .replace(/^hsla?\(/i, "")
    .replace(/\)$/, "")
    .replace(/%/g, "")
    .trim();
  const parts = cleaned
    .split(/[,\s/]+/)
    .map((x) => parseFloat(x))
    .filter((n) => Number.isFinite(n));
  if (parts.length < 3) return null;
  return {
    h: clamp(parts[0], 0, 360),
    s: clamp(parts[1], 0, 100),
    l: clamp(parts[2], 0, 100),
  };
}

function applyHexInput() {
  const el = $("inputHex");
  if (!el) return;
  let raw = el.value.trim();
  if (raw && !raw.startsWith("#")) raw = `#${raw}`;
  if (/^#[0-9a-fA-F]{8}$/.test(raw)) raw = raw.slice(0, 7);
  const hs = hexToHueSat(raw);
  if (!hs) {
    setFieldInvalid(el, true);
    toast("Invalid HEX", "error");
    return;
  }
  setFieldInvalid(el, false);
  applyHueSat(hs.hue, hs.saturation);
}

function applyRgbInput() {
  const el = $("inputRgb");
  if (!el) return;
  const rgb = parseRgbText(el.value);
  if (!rgb) {
    setFieldInvalid(el, true);
    toast("Invalid RGB", "error");
    return;
  }
  setFieldInvalid(el, false);
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  applyHueSat(hsv.h, hsv.s);
}

function applyHslInput() {
  const el = $("inputHsl");
  if (!el) return;
  const hsl = parseHslText(el.value);
  if (!hsl) {
    setFieldInvalid(el, true);
    toast("Invalid HSL", "error");
    return;
  }
  setFieldInvalid(el, false);
  const rgb = hslToRgb(hsl.h, hsl.s, hsl.l);
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  applyHueSat(hsv.h, hsv.s);
}

$("inputHex")?.addEventListener("change", applyHexInput);
$("inputHex")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") applyHexInput();
});
$("inputRgb")?.addEventListener("change", applyRgbInput);
$("inputRgb")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") applyRgbInput();
});
$("inputHsl")?.addEventListener("change", applyHslInput);
$("inputHsl")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") applyHslInput();
});

function applyHueSat(hue, saturation) {
  state.lighting.hue = clamp(Math.round(hue), 0, 359);
  state.lighting.saturation = clamp(Math.round(saturation), 0, 100);
  $("lightHue").value = state.lighting.hue;
  $("outHue").textContent = String(state.lighting.hue);
  $("lightSat").value = state.lighting.saturation;
  $("outSat").textContent = String(state.lighting.saturation);
  paintBoardsFromLighting();
  drawColorWheel();
  saveStore();
}

function applyLightingToForm(L) {
  state.lighting = {
    isOn: L.isOn,
    mode: L.mode,
    brightness: L.brightness,
    speed: L.speed,
    hue: L.hue,
    saturation: L.saturation,
  };
  $("lightOn").checked = L.isOn;
  $("lightBright").value = L.brightness;
  $("outBright").textContent = L.brightness;
  $("lightSpeed").value = L.speed;
  $("outSpeed").textContent = L.speed;
  $("lightHue").value = L.hue;
  $("outHue").textContent = L.hue;
  $("lightSat").value = L.saturation;
  $("outSat").textContent = L.saturation;
  modeGrid.querySelectorAll(".mode-chip").forEach((c) => {
    c.classList.toggle("is-active", Number(c.dataset.mode) === L.mode);
  });
  updateParamVisibility();
  paintBoardsFromLighting();
  updateAccentFromLighting();
}

function applyActuationToForm(A) {
  state.actuation = {
    press: A.press,
    release: A.release,
    rapidTrigger: A.rapidTrigger !== false,
  };
  $("actPress").value = A.press;
  $("outPress").textContent = A.press;
  $("actRelease").value = A.release;
  $("outRelease").textContent = A.release;
  $("actRT").checked = A.rapidTrigger !== false;
}

function initHelpTips() {
  const pop = $("helpPop");
  if (!pop) return;
  let hideTimer = 0;

  function placePop(btn) {
    const text = btn.getAttribute("data-help") || "";
    if (!text) return;
    pop.textContent = text;
    pop.hidden = false;
    const r = btn.getBoundingClientRect();
    const pad = 10;
    const pw = Math.min(280, window.innerWidth - pad * 2);
    pop.style.width = `${pw}px`;
    pop.style.maxWidth = `${pw}px`;
    requestAnimationFrame(() => {
      const pr = pop.getBoundingClientRect();
      let left = r.left + r.width / 2 - pr.width / 2;
      left = Math.max(pad, Math.min(left, window.innerWidth - pr.width - pad));
      let top = r.bottom + 8;
      if (top + pr.height > window.innerHeight - pad) {
        top = r.top - pr.height - 8;
      }
      pop.style.left = `${left}px`;
      pop.style.top = `${Math.max(pad, top)}px`;
    });
  }

  function hidePop() {
    pop.hidden = true;
  }

  document.addEventListener(
    "pointerover",
    (e) => {
      const btn = e.target.closest?.(".help-tip");
      if (!btn) return;
      clearTimeout(hideTimer);
      placePop(btn);
    },
    true
  );
  document.addEventListener(
    "pointerout",
    (e) => {
      const btn = e.target.closest?.(".help-tip");
      if (!btn) return;
      const to = e.relatedTarget;
      if (to && (btn.contains(to) || pop.contains(to))) return;
      hideTimer = setTimeout(hidePop, 120);
    },
    true
  );
  pop.addEventListener("pointerenter", () => clearTimeout(hideTimer));
  pop.addEventListener("pointerleave", hidePop);
  document.addEventListener("scroll", hidePop, true);
  window.addEventListener("resize", hidePop);

  document.addEventListener("click", (e) => {
    const btn = e.target.closest?.(".help-tip");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    if (!pop.hidden && pop.dataset.for === btn) {
      hidePop();
      return;
    }
    pop.dataset.for = "";
    placePop(btn);
  });
}

$("btnClearTypingTest")?.addEventListener("click", () => {
  const ta = $("typingTest");
  if (ta) {
    ta.value = "";
    ta.focus();
  }
});

initHelpTips();

function syncKeyEditorFromFeelIfNeeded() {
  if (!state.selectedKey || state.keyOverrides[state.selectedKey]) return;
  const press = state.actuation.press;
  const release = state.actuation.release;
  const kp = $("keyPress");
  const kr = $("keyRelease");
  if (kp) kp.value = press;
  if ($("keyOutPress")) $("keyOutPress").textContent = String(press);
  if (kr) kr.value = release;
  if ($("keyOutRelease")) $("keyOutRelease").textContent = String(release);
}

function bindAct(id, outId, key) {
  const el = $(id);
  const out = $(outId);
  const sync = () => {
    state.actuation[key] = Number(el.value);
    out.textContent = String(el.value);
    scheduleActuationSave();
    syncKeyEditorFromFeelIfNeeded();
  };
  el.addEventListener("input", sync);
  out.textContent = String(el.value);
}
bindAct("actPress", "outPress", "press");
bindAct("actRelease", "outRelease", "release");

function scheduleActuationSave() {
  clearTimeout(actSaveTimer);
  actSaveTimer = setTimeout(() => saveStore(), 200);
}

$("actRT").addEventListener("change", (e) => {
  state.actuation.rapidTrigger = e.target.checked;
  saveStore();
});

document.querySelectorAll("[data-preset]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const p = btn.dataset.preset;
    if (p === "gaming") {
      state.actuation = { press: 8, release: 8, rapidTrigger: true };
    } else if (p === "balanced") {
      state.actuation = { press: 15, release: 15, rapidTrigger: true };
    } else {
      state.actuation = { press: 22, release: 20, rapidTrigger: false };
    }
    applyActuationToForm(state.actuation);
    saveStore();
    syncKeyEditorFromFeelIfNeeded();
    toast(p, "ok");
  });
});

function setProfileUI(index) {
  state.profile = index;
  $("statProfile").textContent = state.connected ? `P${index + 1}` : "—";
  document.querySelectorAll(".profile-card").forEach((card) => {
    card.classList.toggle("is-active", Number(card.dataset.profile) === index);
  });
}

$("profileGrid").addEventListener("click", async (e) => {
  const card = e.target.closest(".profile-card");
  if (!card || state.busy) return;
  const idx = Number(card.dataset.profile);
  if (idx === state.profile) return;

  const previousIndex = state.profile;
  try {
    state.busy = true;
    snapshotCurrentToStore();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profileStore));

    if (kb.connected) {
      await kb.writeProfile(idx);
    }

    profileStore.activeProfile = idx;
    applyProfileFromStore(idx);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profileStore));

    if (kb.connected) {
      const failures = [];
      try {
        await kb.writeLighting({ ...state.lighting });
      } catch (err) {
        console.warn("profile lighting write", err);
        failures.push("lights");
      }
      try {
        await writeCurrentActuationToDevice();
      } catch (err) {
        console.warn("profile actuation write", err);
        failures.push("feel");
      }
      if (failures.length) {
        toast(`Profile ${idx + 1} — ${failures.join(" + ")} write failed`, "error");
      } else {
        toast(`Profile ${idx + 1}`, "ok");
      }
    } else {
      toast(`Profile ${idx + 1}`, "ok");
    }
  } catch (err) {
    profileStore.activeProfile = previousIndex;
    applyProfileFromStore(previousIndex);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profileStore));
    toast(err.message || String(err), "error");
  } finally {
    state.busy = false;
  }
});

async function refreshFromDevice({ restoreFeel = false } = {}) {
  if (!kb.connected) return;
  let lightingOk = false;
  let profileOk = false;

  try {
    const profile = await kb.readProfile();
    const idx = Math.max(0, Math.min(PROFILE_COUNT - 1, profile));
    if (idx !== state.profile) {
      snapshotCurrentToStore();
      profileStore.activeProfile = idx;
      applyProfileFromStore(idx);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profileStore));
    } else {
      setProfileUI(idx);
    }
    profileOk = true;
  } catch (err) {
    console.warn("profile read failed", err);
  }

  try {
    const L = await kb.readLighting();
    applyLightingToForm(L);
    snapshotCurrentToStore();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profileStore));
    lightingOk = true;
  } catch (err) {
    console.warn("lighting read failed", err);
  }

  applyActuationToForm(
    deepClone(profileStore.profiles[state.profile]?.actuation || defaultActuation())
  );
  state.keyOverrides = deepClone(
    profileStore.profiles[state.profile]?.keyOverrides || {}
  );
  paintBoardsFromLighting();

  let feelOk = true;
  if (restoreFeel) {
    try {
      await writeCurrentActuationToDevice();
    } catch (err) {
      console.warn("feel restore write failed", err);
      feelOk = false;
    }
  }

  if (lightingOk && feelOk) {
    toast("Synced", "ok");
  } else if (lightingOk && !feelOk) {
    toast("Synced (feel write failed)", "error");
  } else if (profileOk) {
    toast("Lighting read failed", "error");
  } else {
    toast("Command timeout", "error");
  }

  return { lightingOk, profileOk, feelOk };
}

async function connect(existing) {
  try {
    state.busy = true;
    const info = await kb.connect(existing);
    setConnectedUI(true, info);
    toast("Connected", "ok");
    await refreshFromDevice({ restoreFeel: true });
  } catch (err) {
    setConnectedUI(false, null);
    toast(err.message || String(err), "error");
  } finally {
    state.busy = false;
  }
}

async function disconnect() {
  flushStore();
  await kb.disconnect();
  setConnectedUI(false, null);
  toast("Disconnected");
}

$("btnConnect").addEventListener("click", () => connect());
$("btnDisconnect").addEventListener("click", disconnect);
$("btnRefresh").addEventListener("click", async () => {
  try {
    state.busy = true;
    await refreshFromDevice({ restoreFeel: true });
  } catch (err) {
    toast(err.message || String(err), "error");
  } finally {
    state.busy = false;
  }
});

$("btnApplyLighting").addEventListener("click", async () => {
  if (!kb.connected || state.busy) return;
  try {
    state.busy = true;
    await kb.writeLighting({ ...state.lighting });
    saveStore();
    try {
      const L = await kb.readLighting();
      applyLightingToForm(L);
      saveStore();
      toast("Applied", "ok");
    } catch {
      toast("Applied", "ok");
    }
  } catch (err) {
    toast(err.message || String(err), "error");
  } finally {
    state.busy = false;
  }
});

$("btnApplyActuation").addEventListener("click", async () => {
  if (!kb.connected || state.busy) return;
  try {
    state.busy = true;
    const ok = await writeCurrentActuationToDevice();
    saveStore();
    if (state.selectedKey && !state.keyOverrides[state.selectedKey]) {
      openKeyEditor(state.selectedKey);
    }
    paintBoardsFromLighting();
    if (ok) toast("Applied", "ok");
    else toast("Write failed", "error");
  } catch (err) {
    toast(err.message || String(err), "error");
  } finally {
    state.busy = false;
  }
});

window.addEventListener("beforeunload", () => {
  flushStore();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushStore();
});

kb.onStatus(({ type, detail }) => {
  if (type === "disconnected") {
    flushStore();
    setConnectedUI(false, null);
  }
  if (type === "error") toast(detail || "Device error", "error");
});

if (navigator.hid) {
  navigator.hid.addEventListener("disconnect", (e) => {
    if (kb.device && e.device === kb.device) {
      flushStore();
      kb.disconnect();
      setConnectedUI(false, null);
      toast("Unplugged", "error");
    }
  });
  navigator.hid.addEventListener("connect", async (e) => {
    if (state.connected) return;
    if (
      e.device.vendorId === 0x3662 &&
      (e.device.productId === 0x1001 || e.device.productId === 0x1002)
    ) {
      await connect(e.device);
    }
  });
}

if (window.zenShell?.onReconnect) {
  window.zenShell.onReconnect(() => {
    if (!state.connected) connect();
    else refreshFromDevice({ restoreFeel: true });
  });
}

applyLightingToForm(state.lighting);
applyActuationToForm(state.actuation);
setProfileUI(state.profile);
updateParamVisibility();
paintBoardsFromLighting();
updateAccentFromLighting();
setConnectedUI(false, null);

(async () => {
  try {
    if (!navigator.hid) {
      toast("WebHID unavailable", "error");
      return;
    }
    const devices = await navigator.hid.getDevices();
    const known = pickZenbladeDevice(devices);
    if (known) {
      await connect(known);
    }
  } catch (err) {
    console.warn("auto-connect failed", err);
  }
})();

window.__zenTest = {
  getState: () => ({
    connected: state.connected,
    profile: state.profile,
    lighting: { ...state.lighting },
    actuation: { ...state.actuation },
    keyOverrides: deepClone(state.keyOverrides),
    store: deepClone(profileStore),
    info: kb.info,
  }),
  connect: () => connect(),
  refresh: () => refreshFromDevice(),
  saveStore: () => saveStore(),
  loadStore: () => loadStore(),
  async roundTripColor(hue = 0, sat = 100) {
    if (!kb.connected) await connect();
    state.lighting.hue = hue;
    state.lighting.saturation = sat;
    state.lighting.mode = 1;
    state.lighting.isOn = true;
    state.lighting.brightness = 80;
    await kb.writeLighting({ ...state.lighting });
    const L = await kb.readLighting();
    applyLightingToForm(L);
    return L;
  },
};
