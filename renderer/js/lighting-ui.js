import {
  categorySelectionState,
  LIGHT_CATEGORIES,
  LIGHT_MODES,
} from "./lighting-modes.js";
import {
  clamp,
  hexToRgb,
  hsvToRgb,
  rgbToCss,
  rgbToHex,
  rgbToHsl,
  rgbToHsv,
} from "./color.js";
import { paintEffectPreview } from "./lighting-preview.js";
import { normalizeLighting } from "./protocol.js";
import { $ } from "./dom.js";

export const colorUiForMode = (hasColor, colorUi) =>
  hasColor && colorUi === "hidden" ? "simple" : colorUi;

export const lightingColorUpdate = (rgb) => {
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  return { hue: hsv.h, saturation: hsv.s, brightness: hsv.v };
};

const lightingKeys = [
  "isOn",
  "mode",
  "brightness",
  "speed",
  "hue",
  "saturation",
];
export const lightingMatches = (left, right) =>
  !!left && !!right && lightingKeys.every((key) => left[key] === right[key]);
export const lightingIsDirty = (lighting, baseline) =>
  !!baseline && !lightingMatches(lighting, baseline);

export function wheelGeometry(size) {
  const center = size / 2;
  const hueRadius = center - 5;
  return { center, hueRadius, saturationRadius: hueRadius - 14 };
}

export function wheelMarkerPosition(lighting, size) {
  const { center, saturationRadius } = wheelGeometry(size);
  const angle = lighting.hue * Math.PI / 180;
  const distance = lighting.saturation / 100 * saturationRadius;
  return {
    x: center + Math.cos(angle) * distance,
    y: center + Math.sin(angle) * distance,
  };
}

export function isWheelHitArea(x, y, size) {
  return Math.hypot(x, y) <= wheelGeometry(size).hueRadius;
}

export function createLightingUi({ model, paint, toast, onChromeChange }) {
  const { state, setLighting, setColorUi } = model;
  const grid = $("modeGrid");
  const categoryGrid = $("modeCategories");
  const wheel = $("colorWheel");
  const ctx = wheel?.getContext("2d");
  let category =
    (LIGHT_MODES.find((mode) => mode.id === state.lighting.mode) ||
      LIGHT_MODES[0]).category;
  let dragging = false;
  let wheelImage = null;
  let paintFrame = 0;
  let appliedBaseline = null;

  const currentMode = () =>
    LIGHT_MODES.find((mode) => mode.id === state.lighting.mode) ||
    LIGHT_MODES[0];
  const allowsBaseColor = () => currentMode().usesColor;
  const schedulePaint = () => {
    if (paintFrame) return;
    paintFrame = requestAnimationFrame(() => {
      paintFrame = 0;
      paint();
    });
  };
  const announce = (message) => {
    $("effectSelectionStatus").textContent = message;
  };
  const setRangeProgress = (input, value) => {
    const min = Number(input.min) || 0;
    const max = Number(input.max) || 100;
    input.style.setProperty(
      "--range-progress",
      `${(Number(value) - min) / (max - min) * 100}%`,
    );
  };
  const isDirty = () => lightingIsDirty(state.lighting, appliedBaseline);
  const syncApplyState = () => onChromeChange?.();
  const markApplied = (lighting = state.lighting) => {
    appliedBaseline = normalizeLighting(lighting, state.lighting);
    syncApplyState();
  };
  const clearAppliedBaseline = () => {
    appliedBaseline = null;
    syncApplyState();
  };

  function renderCategories() {
    categoryGrid.innerHTML = "";
    categoryGrid.setAttribute("role", "group");
    categoryGrid.setAttribute("aria-label", "Effect category");
    LIGHT_CATEGORIES.forEach((name) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mode-category";
      button.textContent = name;
      button.dataset.category = name;
      button.setAttribute("aria-pressed", "false");
      categoryGrid.append(button);
    });
  }

  function renderModes() {
    grid.innerHTML = "";
    grid.setAttribute("role", "radiogroup");
    grid.setAttribute("aria-label", "Lighting effect");
    const selection = categorySelectionState(category, state.lighting.mode);
    if (!selection.selectedVisible) {
      const selected = currentMode();
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mode-chip mode-chip--selected-outside";
      button.dataset.mode = selected.id;
      button.textContent = `Selected: ${selected.name}`;
      button.disabled = true;
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", "true");
      button.setAttribute(
        "aria-label",
        `Selected effect: ${selected.name}. Not shown by the ${category} filter.`,
      );
      grid.append(button);
    }
    selection.modes.forEach((mode) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mode-chip";
      button.dataset.mode = mode.id;
      button.textContent = mode.name;
      button.title = `${mode.category}: ${mode.name}`;
      button.setAttribute("role", "radio");
      grid.append(button);
    });
  }

  function drawWheel() {
    if (!wheel || !ctx) return;
    const size = wheel.width;
    const { center, hueRadius, saturationRadius } = wheelGeometry(size);
    const image = wheelImage || ctx.createImageData(size, size);
    if (!wheelImage) {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const dx = x - center;
          const dy = y - center;
          const distance = Math.hypot(dx, dy);
          const index = (y * size + x) * 4;
          if (distance <= hueRadius) {
            const hue = (Math.atan2(dy, dx) * 180 + 360) % 360;
            const rgb = hsvToRgb(
              hue,
              distance > saturationRadius
                ? 100
                : distance / saturationRadius * 100,
              100,
            );
            image.data.set([rgb.r, rgb.g, rgb.b, 255], index);
          }
        }
      }
      wheelImage = image;
    }
    ctx.putImageData(image, 0, 0);
    const angle = state.lighting.hue * Math.PI / 180;
    const marker = wheelMarkerPosition(state.lighting, size);
    const hueX = center + Math.cos(angle) * hueRadius;
    const hueY = center + Math.sin(angle) * hueRadius;
    ctx.beginPath();
    ctx.arc(hueX, hueY, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#15111d";
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(marker.x, marker.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(16, 13, 23, 0.88)";
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(marker.x, marker.y, 5, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(9, 7, 13, 0.95)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function visibility() {
    const mode = currentMode();
    const params = mode.params;
    $("fieldBright").hidden = !params.includes("brightness");
    $("fieldSpeed").hidden = !mode.usesSpeed;
    const canEditColor = allowsBaseColor();
    setColorUi(colorUiForMode(canEditColor, state.colorUi));
    if (!canEditColor) setColorUi("hidden");
    const advanced = canEditColor && state.colorUi === "advanced";
    $("simpleColorControls").hidden = !canEditColor || advanced;
    $("advancedColor").hidden = !advanced;
    $("btnToggleAdvancedColor").hidden = !canEditColor;
    $("btnToggleAdvancedColor").textContent = advanced
      ? "Simple view"
      : "Advanced…";
    $("btnToggleAdvancedColor").setAttribute(
      "aria-expanded",
      String(advanced),
    );
    $("colorUnavailable").hidden = canEditColor;
    $("colorUnavailable").textContent =
      "Effect preview uses the firmware’s multi-color palette.";
  }

  function sync() {
    const lighting = state.lighting;
    const mode = currentMode();
    const categoryState = categorySelectionState(category, lighting.mode);
    $("lightOn").checked = lighting.isOn;
    [["lightBright", "outBright", "brightness"], [
      "lightSpeed",
      "outSpeed",
      "speed",
    ]].forEach(([inputId, outputId, key]) => {
      const input = $(inputId);
      input.value = lighting[key];
      setRangeProgress(input, lighting[key]);
      $(outputId).textContent = lighting[key];
    });
    categoryGrid.querySelectorAll(".mode-category").forEach((button) => {
      const active = button.dataset.category === category;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    grid.querySelectorAll(".mode-chip").forEach((button) => {
      const active = Number(button.dataset.mode) === lighting.mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-checked", String(active));
      button.tabIndex = Number(button.dataset.mode) === categoryState.tabStopId
        ? 0
        : -1;
    });
    const filterNotice = $("modeFilterNotice");
    filterNotice.hidden = categoryState.selectedVisible;
    filterNotice.textContent = categoryState.selectedVisible
      ? ""
      : `Selected: ${mode.name}. Showing ${category} effects.`;
    const baseRgb = hsvToRgb(
      lighting.hue,
      lighting.saturation,
      lighting.brightness,
    );
    const baseHex = rgbToHex(baseRgb).toUpperCase();
    if (document.activeElement !== $("lightColorPicker")) {
      $("lightColorPicker").value = baseHex;
    }
    if (document.activeElement !== $("inputHex")) $("inputHex").value = baseHex;
    const hsl = rgbToHsl(baseRgb.r, baseRgb.g, baseRgb.b);
    $("rgbValue").textContent = `${baseRgb.r}, ${baseRgb.g}, ${baseRgb.b}`;
    $("hslValue").textContent = `${hsl.h}, ${hsl.s}%, ${hsl.l}%`;
    $("simpleColorReadout").textContent = `Base color ${baseHex}`;
    $("colorWheelSwatch").style.setProperty(
      "--selected-color",
      rgbToCss(baseRgb),
    );
    $("colorWheelValue").textContent = baseHex;
    $("colorWheelMeta").textContent =
      `Hue ${lighting.hue}° · Saturation ${lighting.saturation}% · Value ${lighting.brightness}%`;
    paintEffectPreview($("effectPreview"), lighting, mode);
    visibility();
    if (state.colorUi === "advanced") drawWheel();
    syncApplyState();
  }

  const update = (partial) => {
    setLighting(partial);
    sync();
    schedulePaint();
  };

  const chooseMode = (id, focus = false) => {
    const selected = LIGHT_MODES.find((mode) => mode.id === id);
    if (!selected) return;
    update({ mode: selected.id });
    announce(`Selected ${selected.name}.`);
    if (focus) grid.querySelector(`[data-mode="${selected.id}"]`)?.focus();
  };

  const moveRadio = (event, selector, choose) => {
    const items = [...event.currentTarget.querySelectorAll(selector)];
    const current = items.indexOf(document.activeElement);
    if (!items.length || current < 0) return;
    const delta = event.key === "ArrowRight" || event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
      ? -1
      : 0;
    let next = current;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (delta) next = (current + delta + items.length) % items.length;
    else return;
    event.preventDefault();
    choose(items[next]);
  };

  renderCategories();
  renderModes();
  categoryGrid.addEventListener("click", (event) => {
    const button = event.target.closest(".mode-category");
    if (!button) return;
    category = button.dataset.category;
    renderModes();
    sync();
    announce(`${category} effects. ${currentMode().name} remains selected.`);
  });
  categoryGrid.addEventListener(
    "keydown",
    (event) =>
      moveRadio(event, ".mode-category", (button) => {
        category = button.dataset.category;
        renderModes();
        sync();
        announce(
          `${category} effects. ${currentMode().name} remains selected.`,
        );
        categoryGrid.querySelector(`[data-category="${category}"]`)?.focus();
      }),
  );
  grid.addEventListener("click", (event) => {
    const button = event.target.closest(".mode-chip");
    if (button) chooseMode(Number(button.dataset.mode));
  });
  grid.addEventListener(
    "keydown",
    (event) =>
      moveRadio(
        event,
        ".mode-chip:not(:disabled)",
        (button) => chooseMode(Number(button.dataset.mode), true),
      ),
  );
  [["lightBright", "brightness"], ["lightSpeed", "speed"]].forEach(
    ([id, key]) =>
      $(id).addEventListener(
        "input",
        (event) => update({ [key]: Number(event.target.value) }),
      ),
  );
  $("lightOn").addEventListener(
    "change",
    (event) => update({ isOn: event.target.checked }),
  );
  const setColor = (rgb) => update(lightingColorUpdate(rgb));
  $("lightColorPicker").addEventListener("input", (event) => {
    const rgb = hexToRgb(event.target.value);
    if (rgb) setColor(rgb);
  });
  $("btnToggleAdvancedColor").addEventListener("click", () => {
    const wasAdvanced = state.colorUi === "advanced";
    setColorUi(wasAdvanced ? "simple" : "advanced");
    sync();
    if (wasAdvanced) $("btnToggleAdvancedColor").focus();
    else wheel?.focus();
  });
  const applyHex = () => {
    const input = $("inputHex");
    const rgb = hexToRgb(input.value);
    input.classList.toggle("is-invalid", !rgb);
    input.setAttribute("aria-invalid", String(!rgb));
    if (rgb) setColor(rgb);
    else toast("Enter a valid HEX color", "error");
  };
  $("inputHex").addEventListener("change", applyHex);
  $("inputHex").addEventListener("keydown", (event) => {
    if (event.key === "Enter") applyHex();
  });
  function wheelEvent(event, allowOutside = false) {
    const rect = wheel.getBoundingClientRect();
    const x = (event.clientX - rect.left) * wheel.width / rect.width -
      wheel.width / 2;
    const y = (event.clientY - rect.top) * wheel.height / rect.height -
      wheel.height / 2;
    if (!allowOutside && !isWheelHitArea(x, y, wheel.width)) return false;
    const { saturationRadius } = wheelGeometry(wheel.width);
    const distance = Math.min(saturationRadius, Math.hypot(x, y));
    update({
      hue: Math.round((Math.atan2(y, x) * 180 + 360) % 360),
      saturation: Math.round(distance / saturationRadius * 100),
    });
    return true;
  }
  if (wheel) {
    wheel.addEventListener("pointerdown", (event) => {
      if (!wheelEvent(event)) return;
      dragging = true;
      wheel.setPointerCapture(event.pointerId);
    });
    wheel.addEventListener(
      "pointermove",
      (event) => dragging && wheelEvent(event, true),
    );
    wheel.addEventListener("pointerup", () => dragging = false);
    wheel.addEventListener("pointercancel", () => dragging = false);
    wheel.addEventListener("keydown", (event) => {
      const delta = event.shiftKey ? 5 : 1;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        update({
          hue: (state.lighting.hue +
            (event.key === "ArrowRight" ? delta : -delta) + 360) % 360,
        });
      } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        update({
          saturation: clamp(
            state.lighting.saturation +
              (event.key === "ArrowUp" ? delta : -delta),
            0,
            100,
          ),
        });
      }
    });
  }

  return {
    sync,
    visibility,
    syncApplyState,
    markApplied,
    clearAppliedBaseline,
    isDirty,
  };
}
