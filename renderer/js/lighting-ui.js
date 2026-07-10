import {
  categorySelectionState,
  LIGHT_CATEGORIES,
  LIGHT_MODES,
  modeById,
} from "./lighting-modes.js";
import {
  hexToRgb,
  rgbToCss,
  rgbToHex,
  rgbToHsv,
} from "./color.js";
import {
  colorSwatchPlan,
  paintEffectPreview,
} from "./lighting-preview.js";
import { baseWireColor } from "./preview.js";
import { lightingWirePreview, normalizeLighting } from "./protocol.js";
import { $ } from "./dom.js";

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
  !baseline || !lightingMatches(lighting, baseline);

export function createLightingUi({ model, paint, onChromeChange, onLightingPaint }) {
  const { state, setLighting } = model;
  const grid = $("modeGrid");
  const categoryGrid = $("modeCategories");
  let category =
    (LIGHT_MODES.find((mode) => mode.id === state.lighting.mode) ||
      LIGHT_MODES[0]).category;
  let filterTouched = false;
  let renderedCategory = null;
  let renderedMode = null;
  let paintFrame = 0;
  let appliedBaseline = null;

  const currentMode = () => modeById(state.lighting.mode);
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
    renderedCategory = category;
    renderedMode = state.lighting.mode;
  }

  function renderSwatches(plan) {
    const root = $("colorSwatches");
    if (!root) return;
    const needsSwatches = plan.swatches.length > 0;
    root.hidden = !needsSwatches;
    root.setAttribute("aria-hidden", String(!needsSwatches));
    if (!needsSwatches) {
      root.innerHTML = "";
      return;
    }
    const stamp = plan.swatches.map((s) => s.hex).join("|");
    if (root.dataset.stamp === stamp && root.childElementCount === plan.swatches.length) {
      // Nothing visual changed; preserve the existing Start/End labels.
      return;
    }
    root.dataset.stamp = stamp;
    root.innerHTML = "";
    plan.swatches.forEach((swatch) => {
      const item = document.createElement("div");
      item.className = "color-swatch";
      item.style.setProperty("--swatch-rgb", rgbToCss(swatch.rgb));
      item.innerHTML =
        `<span class="color-swatch__bubble" aria-hidden="true"></span>` +
        `<span class="color-swatch__hex mono">${swatch.label} ${swatch.hex}</span>`;
      item.setAttribute("title", `${swatch.label} ${swatch.hex}`);
      item.setAttribute("aria-label", `${swatch.label} color ${swatch.hex}`);
      root.append(item);
    });
  }

  function visibility() {
    const mode = currentMode();
    const params = mode.params;
    $("fieldBright").hidden = !params.includes("brightness");
    $("fieldSpeed").hidden = !mode.usesSpeed;
    const canEditColor = allowsBaseColor();
    const plan = colorSwatchPlan(state.lighting, mode);
    $("simpleColorControls").hidden = !canEditColor;
    $("fieldColor").hidden = !plan.showPicker;
    $("colorUnavailable").hidden = canEditColor;
    $("colorUnavailable").textContent =
      "Effect preview uses the firmware’s multi-color palette.";
    renderSwatches(plan);
  }

  function sync() {
    const lighting = state.lighting;
    const mode = currentMode();
    // Startup/device/profile sync can replace the locally cached mode after
    // the first render. Follow that real mode until the user chooses a filter,
    // and always rebuild a grid whose selection state is stale.
    if (!filterTouched && category !== mode.category) category = mode.category;
    if (renderedCategory !== category || renderedMode !== lighting.mode) {
      renderModes();
    }
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

    // Readouts and previews use wire-quantized colour, matching firmware bytes.
    const wire = lightingWirePreview(lighting);
    const baseRgb = baseWireColor(lighting);
    const baseHex = rgbToHex(baseRgb).toUpperCase();
    if (document.activeElement !== $("lightColorPicker")) {
      $("lightColorPicker").value = baseHex;
    }
    $("simpleColorReadout").textContent = baseHex;
    $("simpleColorReadout").title =
      `Hue ${wire.hue}° · Sat ${wire.saturation}% · Bright ${wire.brightness}%`;
    paintEffectPreview($("effectPreview"), lighting, mode);
    visibility();
    onLightingPaint?.(lighting);
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
    setLighting({ mode: selected.id });
    // The current filter may contain a disabled "Selected: …" row. Rebuild
    // the list so a stale out-of-filter selection never survives a choice.
    renderModes();
    sync();
    schedulePaint();
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
    filterTouched = true;
    category = button.dataset.category;
    renderModes();
    sync();
    announce(`${category} effects. ${currentMode().name} remains selected.`);
  });
  categoryGrid.addEventListener(
    "keydown",
    (event) =>
      moveRadio(event, ".mode-category", (button) => {
        filterTouched = true;
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

  return {
    sync,
    visibility,
    syncApplyState,
    markApplied,
    clearAppliedBaseline,
    isDirty,
  };
}
