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
import { baseWireColor, lightingModeAnimates } from "./preview.js";
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

export const COLOR_PRESETS = Object.freeze([
  ["Red", "#FF0000"],
  ["Orange", "#FF6A00"],
  ["Amber", "#FFB000"],
  ["Green", "#00FF40"],
  ["Cyan", "#00E5FF"],
  ["Blue", "#0040FF"],
  ["Violet", "#7A00FF"],
  ["Pink", "#FF00A0"],
  ["White", "#FFFFFF"],
]);

export const parseHexColor = (value) => {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value).trim());
  if (!match) return null;
  const hex = match[1].length === 3
    ? match[1].split("").map((c) => c + c).join("")
    : match[1];
  return `#${hex.toUpperCase()}`;
};

// One full cycle of an animated preview takes 20 s at speed 0 and 2 s at 100.
export const previewCyclesPerSecond = (speed) =>
  0.05 + Math.max(0, Math.min(100, Number(speed) || 0)) / 100 * 0.45;

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
    if (document.activeElement !== $("simpleColorReadout")) {
      $("simpleColorReadout").value = baseHex;
      $("simpleColorReadout").classList.remove("is-invalid");
    }
    $("simpleColorReadout").title =
      `Hue ${wire.hue}° · Sat ${wire.saturation}% · Bright ${wire.brightness}%`;
    $("colorPresets").querySelectorAll(".color-preset").forEach((button) => {
      const rgb = hexToRgb(button.dataset.hex);
      const preset = rgbToHex(baseWireColor({ ...lighting, ...lightingColorUpdate(rgb) }));
      button.setAttribute("aria-pressed", String(preset.toUpperCase() === baseHex));
    });
    // Keep the running animation's frame instead of flashing a still one.
    paintEffectPreview($("effectPreview"), lighting, mode, shouldAnimate() ? phase : null);
    syncAnimation();
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
  $("simpleColorReadout").addEventListener("input", (event) => {
    const hex = parseHexColor(event.target.value);
    event.target.classList.toggle("is-invalid", !hex && event.target.value.length >= 4);
    if (hex) setColor(hexToRgb(hex));
  });
  $("simpleColorReadout").addEventListener("change", () => sync());
  $("colorPresets").replaceChildren(...COLOR_PRESETS.map(([name, hex]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "color-preset";
    button.dataset.hex = hex;
    button.style.setProperty("--preset", hex);
    button.title = `${name} ${hex}`;
    button.setAttribute("aria-label", name);
    button.addEventListener("click", () => setColor(hexToRgb(hex)));
    return button;
  }));

  // Animated preview: runs only while the Lighting panel is on screen, the
  // effect moves, and the system does not ask for reduced motion.
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let animationFrame = 0;
  let phase = 0;
  let lastFrameAt = 0;
  const shouldAnimate = () =>
    state.lighting.isOn &&
    lightingModeAnimates(state.lighting.mode) &&
    !reducedMotion.matches &&
    document.visibilityState === "visible" &&
    !$("panel-lighting").hidden;
  function animate(at) {
    animationFrame = 0;
    if (!shouldAnimate()) return;
    // ~30 fps is plenty for a preview and halves the work of 60 fps.
    if (at - lastFrameAt >= 33) {
      const elapsed = lastFrameAt ? Math.min(100, at - lastFrameAt) / 1000 : 0;
      lastFrameAt = at;
      phase = (phase + elapsed * previewCyclesPerSecond(state.lighting.speed)) % 1;
      paintEffectPreview($("effectPreview"), state.lighting, currentMode(), phase);
    }
    animationFrame = requestAnimationFrame(animate);
  }
  function syncAnimation() {
    if (shouldAnimate()) {
      if (!animationFrame) {
        lastFrameAt = 0;
        animationFrame = requestAnimationFrame(animate);
      }
    } else if (animationFrame) {
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
  }
  reducedMotion.addEventListener("change", syncAnimation);
  document.addEventListener("visibilitychange", syncAnimation);
  document.addEventListener("zen:panel", syncAnimation);

  return {
    sync,
    visibility,
    syncApplyState,
    markApplied,
    clearAppliedBaseline,
    isDirty,
  };
}
