import { rgbToCss } from "./color.js";
import { CODE_TO_MATRIX_INDEX, LAYOUT_KEY_COUNT, ROWS } from "./layout.js";
import { keyDisplayColor } from "./preview.js";

const KEYBOARD_UNITS = 16;

export function effectPreviewKeys(lighting) {
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
        }),
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

export function paintEffectPreview(root, lighting, mode) {
  if (!root) return;
  const previewKeys = effectPreviewKeys(lighting);
  root.dataset.previewKind = effectPreviewKind(mode);
  root.setAttribute("aria-label", effectPreviewDescription(lighting, mode));

  const matchingLayout = root.children.length === ROWS.length &&
    [...root.children].every((row, index) => row.children.length === ROWS[index].length);
  const rows = matchingLayout
    ? [...root.children]
    : ROWS.map(() => {
      const row = document.createElement("div");
      row.className = "effect-preview__row";
      root.append(row);
      return row;
    });

  previewKeys.forEach((previewKey) => {
    const row = rows[previewKey.row];
    let key = row.querySelector(`[data-code="${previewKey.code}"]`);
    if (!key) {
      key = document.createElement("span");
      key.className = "effect-preview__key";
      key.dataset.code = previewKey.code;
      key.setAttribute("aria-hidden", "true");
      key.textContent = previewKey.label;
      row.append(key);
    }
    key.style.gridColumn = `span ${Math.round(previewKey.width * 4)}`;
    key.style.setProperty("--preview-rgb", rgbToCss(previewKey.rgb));
    key.style.setProperty("--preview-glow", rgbToCss(previewKey.rgb, 0.52));
  });

  if (previewKeys.length !== LAYOUT_KEY_COUNT) {
    throw new Error("Lighting preview must include every Zenblade key");
  }
}
