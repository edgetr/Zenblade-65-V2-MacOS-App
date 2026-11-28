import { rgbToCss, rgbToHex } from "./color.js";
import { CODE_TO_MATRIX_INDEX, LAYOUT_KEY_COUNT, ROWS } from "./layout.js";
import { baseWireColor, keyDisplayColor } from "./preview.js";
import { modeById } from "./lighting-modes.js";

const KEYBOARD_UNITS = 16;
export function effectPreviewKeys(lighting, phase = null) {
  return ROWS.flatMap((row, rowIndex) => {
    let x = 0;
    return row.map((key) => {
      const width = key.w;
      const previewKey = {
        ...key,
        index: CODE_TO_MATRIX_INDEX[key.code],
        row: rowIndex,
        x,
        width,
        rgb: keyDisplayColor(lighting, {
          col: x + width / 2,
          row: rowIndex,
          colCount: KEYBOARD_UNITS,
          rowCount: ROWS.length,
        }, phase),
      };
      x += width;
      return previewKey;
    });
  });
}

// Retained as a compact, test-friendly representation of the keyboard preview.
export function effectPreviewSamples(lighting) {
  return effectPreviewKeys(lighting).map(({ rgb }) => rgb);
}

export function effectPreviewKind(mode) {
  return mode?.id === 1 ? "Base RGB" : "Effect preview";
}

export function effectPreviewDescription(lighting, mode) {
  const effect = mode?.name || "selected effect";
  const colorMeaning = mode?.id === 1
    ? "Each key shows the selected base colour."
    : "Key colours show the selected pattern across the keyboard.";
  const power = lighting?.isOn ? "Lighting on." : "Lighting off.";
  return `${effect} keyboard preview. ${colorMeaning} ${power}`;
}

// First/last key colours from the same layout traversal used by the keyboard
// preview, so endpoint swatches always match visible gradient ends.
export function effectEndpointColors(lighting) {
  const keys = effectPreviewKeys(lighting);
  if (!keys.length) return { start: baseWireColor(lighting), end: baseWireColor(lighting) };
  return { start: keys[0].rgb, end: keys[keys.length - 1].rgb };
}

// Pure plan for colour UI: one swatch for single-color modes, two endpoint
// swatches for Gradient V/H, none for multi-color palette modes.
export function colorSwatchPlan(lighting, mode = modeById(lighting?.mode)) {
  const resolved = mode || modeById(1);
  if (resolved.gradientEndpoints) {
    const { start, end } = effectEndpointColors(lighting);
    return {
      kind: "endpoints",
      showPicker: true,
      swatches: [
        { rgb: start, hex: rgbToHex(start).toUpperCase(), label: "Start" },
        { rgb: end, hex: rgbToHex(end).toUpperCase(), label: "End" },
      ],
    };
  }
  if (resolved.singleColor && resolved.usesColor) {
    return {
      kind: "single",
      showPicker: true,
      // The native picker is the single editable color bubble; do not repeat
      // the same value as a second read-only swatch.
      swatches: [],
    };
  }
  return {
    kind: "none",
    showPicker: !!resolved.usesColor,
    swatches: [],
  };
}

const previewNodes = new WeakMap();

export function paintEffectPreview(root, lighting, mode, phase = null) {
  if (!root) return;
  const previewKeys = effectPreviewKeys(lighting, phase);
  root.dataset.previewKind = effectPreviewKind(mode);
  root.setAttribute("aria-label", effectPreviewDescription(lighting, mode));

  // Build the key nodes once; each repaint only updates their colours.
  let nodes = previewNodes.get(root);
  if (!nodes) {
    root.replaceChildren();
    nodes = new Map();
    const rows = ROWS.map(() => {
      const row = document.createElement("div");
      row.className = "effect-preview__row";
      root.append(row);
      return row;
    });
    previewKeys.forEach((previewKey) => {
      const key = document.createElement("span");
      key.className = "effect-preview__key";
      key.dataset.code = previewKey.code;
      key.setAttribute("aria-hidden", "true");
      key.textContent = previewKey.label;
      key.style.gridColumn = `span ${Math.round(previewKey.width * 4)}`;
      rows[previewKey.row].append(key);
      nodes.set(previewKey.code, key);
    });
    previewNodes.set(root, nodes);
  }

  previewKeys.forEach((previewKey) => {
    const key = nodes.get(previewKey.code);
    key.style.setProperty("--preview-rgb", rgbToCss(previewKey.rgb));
    key.style.setProperty("--preview-glow", rgbToCss(previewKey.rgb, 0.52));
  });

  if (previewKeys.length !== LAYOUT_KEY_COUNT) {
    throw new Error("Lighting preview must include every Zenblade key");
  }
}
