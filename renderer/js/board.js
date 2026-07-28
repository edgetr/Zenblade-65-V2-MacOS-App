import { ROWS } from "./layout.js";
import {
  keyDisplayColor,
  keyOverrideDisplayColor,
} from "./preview.js";
import { hexToRgb, rgbToCss } from "./color.js";
import { $ } from "./dom.js";

export function createBoard({ state, onSelect, onPaint } = {}) {
  let paintRaf = 0, scaleRaf = 0;
  const last = new WeakMap();

  function render(root, interactive = false) {
    root.innerHTML = "";
    ROWS.forEach((row, rowIndex) => {
      const line = document.createElement("div");
      line.className = "board__row";
      row.forEach((item, col) => {
        const key = document.createElement("button");
        key.type = "button";
        key.className = "key";
        key.style.setProperty("--w", item.w);
        key.textContent = item.label;
        Object.assign(key.dataset, {
          code: item.code,
          row: rowIndex,
          col,
          cols: row.length,
          rows: ROWS.length,
        });
        key.tabIndex = interactive && rowIndex === 0 && col === 0 ? 0 : -1;
        if (!interactive) key.setAttribute("aria-hidden", "true");
        else key.setAttribute("aria-label", item.code);
        line.append(key);
      });
      root.append(line);
    });
  }

  const pos = (key) => ({
    col: +key.dataset.col,
    row: +key.dataset.row,
    colCount: +key.dataset.cols,
    rowCount: +key.dataset.rows,
  });

  // Use the computed device colour directly — no pastel lift on the fill.
  // Legend readability comes from text-shadow in CSS, not whitened key tops.
  function applyPaint(key, rgb, lit) {
    const css = rgbToCss(rgb);
    key.classList.toggle("is-lit", lit);
    key.style.setProperty("--key-rgb", css);
    key.style.setProperty(
      "--key-glow",
      lit ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, .55)` : "transparent",
    );
    key.style.setProperty("--key-top", lit ? css : "#2a3038");
    key.style.setProperty("--key-bot", lit ? css : "#1c2128");
  }

  function paintRoot(root) {
    if (!root) return;
    const L = state.lighting,
      solid = L.mode === 1 || L.mode === 0 || !L.isOn,
      lit = L.isOn && L.mode !== 0;
    root.querySelectorAll(".key").forEach((key) => {
      const status = state.statusOverlay?.[key.dataset.code];
      const override = !!state.keyOverrides[key.dataset.code];
      key.classList.toggle("is-override", override);
      key.classList.toggle("is-status", !!status);
      key.classList.toggle("is-activity", status?.activityIndex != null);
      key.classList.toggle(
        "is-selected",
        state.selectedKey === key.dataset.code,
      );
      if (status?.activityIndex != null) {
        key.style.setProperty("--activity-index", status.activityIndex);
        key.style.setProperty("--activity-count", status.activityCount);
      } else {
        key.style.removeProperty("--activity-index");
        key.style.removeProperty("--activity-count");
      }
      const baseRgb = override
        ? keyOverrideDisplayColor(L, pos(key))
        : keyDisplayColor(
          L,
          solid ? { col: 0, row: 0, colCount: 1, rowCount: 1 } : pos(key),
        );
      const statusRgb = status ? hexToRgb(status.color) : null;
      const intensity = status?.intensity ?? 1;
      const rgb = statusRgb
        ? {
          r: Math.round(statusRgb.r * intensity),
          g: Math.round(statusRgb.g * intensity),
          b: Math.round(statusRgb.b * intensity),
        }
        : baseRgb;
      key.title = status?.label || "";
      applyPaint(key, rgb, !!statusRgb || lit || override);
    });
  }

  function paint() {
    if (paintRaf) return;
    paintRaf = requestAnimationFrame(() => {
      paintRaf = 0;
      paintRoot($("keyboardBoard"));
      paintRoot($("indicatorBoard"));
      // Selection/override-only paints must not re-sync lighting UI / rewrite
      // the 68-key effect preview. Callers that change lighting invoke
      // lighting.sync() themselves.
      onPaint?.();
    });
  }

  function scale(root) {
    const wrap = root.closest(".board-wrap") || root.parentElement,
      style = getComputedStyle(wrap),
      inner = wrap.clientWidth - (parseFloat(style.paddingLeft) || 0) -
        (parseFloat(style.paddingRight) || 0);
    if (inner < 40) return;
    const gap = Math.max(2, Math.min(6, inner * .004)),
      u = Math.max(14, Math.min(56, (inner - 15 * gap) / 16)),
      stamp = `${u}|${gap}`;
    if (last.get(root) === stamp) return;
    last.set(root, stamp);
    root.style.setProperty("--u", `${u}px`);
    root.style.setProperty("--key-gap", `${gap}px`);
  }

  function scaleAll() {
    document.querySelectorAll(".board").forEach(scale);
  }

  function scheduleScale() {
    if (scaleRaf) return;
    scaleRaf = requestAnimationFrame(() => {
      scaleRaf = 0;
      scaleAll();
    });
  }

  render($("keyboardBoard"), true);
  if ($("indicatorBoard")) render($("indicatorBoard"), false);
  $("keyboardBoard").addEventListener("click", (e) => {
    const key = e.target.closest(".key");
    if (key) {
      $("keyboardBoard").querySelectorAll(".key").forEach((item) => {
        item.tabIndex = item === key ? 0 : -1;
      });
      onSelect?.(key.dataset.code);
    }
  });
  $("keyboardBoard").addEventListener("keydown", (event) => {
    const key = event.target.closest(".key");
    if (!key || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      return;
    }
    const row = Number(key.dataset.row);
    const col = Number(key.dataset.col);
    let next = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const keys = [...$("keyboardBoard").children[row].querySelectorAll(".key")];
      const delta = event.key === "ArrowLeft" ? -1 : 1;
      next = keys[(col + delta + keys.length) % keys.length];
    } else {
      const nextRow = Math.max(0, Math.min(ROWS.length - 1, row + (
        event.key === "ArrowUp" ? -1 : 1
      )));
      const targetKeys = [...$("keyboardBoard").children[nextRow].querySelectorAll(".key")];
      next = targetKeys[Math.min(targetKeys.length - 1, Math.round(
        col / Math.max(1, Number(key.dataset.cols) - 1) *
          Math.max(1, targetKeys.length - 1),
      ))];
    }
    if (!next || next === key) return;
    event.preventDefault();
    key.tabIndex = -1;
    next.tabIndex = 0;
    next.focus();
    onSelect?.(next.dataset.code);
  });
  new ResizeObserver(scheduleScale).observe(
    $("keyboardBoard").closest(".board-wrap"),
  );
  scaleAll();
  return { paint, scheduleScale };
}
