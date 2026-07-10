import { ROWS } from "./layout.js";
import {
  keyDisplayColor,
  keyOverrideDisplayColor,
} from "./preview.js";
import { rgbToCss } from "./color.js";
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
        key.tabIndex = interactive ? 0 : -1;
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
  function applyPaint(key, rgb, lit) {
    const css = rgbToCss(rgb);
    key.classList.toggle("is-lit", lit);
    key.style.setProperty("--key-rgb", css);
    key.style.setProperty(
      "--key-glow",
      lit ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, .65)` : "transparent",
    );
    key.style.setProperty(
      "--key-top",
      lit
        ? rgbToCss({
          r: Math.min(255, Math.round(rgb.r * .55 + 115)),
          g: Math.min(255, Math.round(rgb.g * .55 + 115)),
          b: Math.min(255, Math.round(rgb.b * .55 + 115)),
        })
        : "#2a3038",
    );
    key.style.setProperty("--key-bot", lit ? css : "#1c2128");
  }
  function paintRoot(root) {
    if (!root) return;
    const L = state.lighting,
      solid = L.mode === 1 || L.mode === 0 || !L.isOn,
      lit = L.isOn && L.mode !== 0;
    root.querySelectorAll(".key").forEach((key) => {
      const override = !!state.keyOverrides[key.dataset.code];
      key.classList.toggle("is-override", override);
      key.classList.toggle(
        "is-selected",
        state.selectedKey === key.dataset.code,
      );
      const rgb = override
        ? keyOverrideDisplayColor(L, pos(key))
        : keyDisplayColor(
          L,
          solid ? { col: 0, row: 0, colCount: 1, rowCount: 1 } : pos(key),
        );
      applyPaint(key, rgb, lit || override);
    });
  }
  function paint() {
    if (paintRaf) return;
    paintRaf = requestAnimationFrame(() => {
      paintRaf = 0;
      paintRoot($("keyboardBoard"));
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
  $("keyboardBoard").addEventListener("click", (e) => {
    const key = e.target.closest(".key");
    if (key) onSelect?.(key.dataset.code);
  });
  new ResizeObserver(scheduleScale).observe(
    $("keyboardBoard").closest(".board-wrap"),
  );
  scaleAll();
  return { paint, scheduleScale };
}
