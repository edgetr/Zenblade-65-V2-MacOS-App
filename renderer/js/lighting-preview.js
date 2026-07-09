import { rgbToCss } from "./color.js";
import { keyDisplayColor } from "./preview.js";

const PREVIEW_ROWS = 3;
const PREVIEW_COLUMNS = 12;

export function effectPreviewSamples(lighting, columns = PREVIEW_COLUMNS, rows = PREVIEW_ROWS) {
  return Array.from({ length: columns * rows }, (_, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    return keyDisplayColor(lighting, {
      col,
      row,
      colCount: columns,
      rowCount: rows,
    });
  });
}

export function effectPreviewKind(mode) {
  return mode?.id === 1 ? "Base RGB" : "Effect preview";
}

export function paintEffectPreview(root, lighting, mode) {
  if (!root) return;
  const samples = effectPreviewSamples(lighting);
  root.dataset.previewKind = effectPreviewKind(mode);
  root.setAttribute("aria-label", `${effectPreviewKind(mode)} for ${mode?.name || "selected effect"}`);
  const keys = root.children.length === samples.length
    ? [...root.children]
    : samples.map(() => {
      const key = document.createElement("span");
      key.className = "effect-preview__key";
      root.append(key);
      return key;
    });
  samples.forEach((rgb, index) => {
    const key = keys[index];
    key.style.setProperty("--preview-rgb", rgbToCss(rgb));
    key.style.setProperty("--preview-glow", rgbToCss(rgb, 0.52));
  });
}
