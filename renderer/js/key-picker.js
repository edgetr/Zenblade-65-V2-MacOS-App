import { ROWS, keyName } from "./layout.js";

// A compact keyboard drawing for choosing one physical key. Uses the same
// key markup as the main board so it shares its styles and scaling.
export function createKeyPicker(root, { onPick, describe } = {}) {
  root.replaceChildren();
  root.setAttribute("role", "group");
  ROWS.forEach((row, rowIndex) => {
    const line = document.createElement("div");
    line.className = "board__row";
    row.forEach((item, col) => {
      const key = document.createElement("button");
      key.type = "button";
      key.className = "key";
      key.style.setProperty("--w", item.w);
      key.textContent = item.label;
      key.dataset.code = item.code;
      key.tabIndex = rowIndex === 0 && col === 0 ? 0 : -1;
      key.setAttribute("aria-label", keyName(item.code));
      line.append(key);
    });
    root.append(line);
  });
  const keys = () => [...root.querySelectorAll(".key")];

  root.addEventListener("click", (event) => {
    const key = event.target.closest(".key");
    if (key && !key.disabled) onPick?.(key.dataset.code);
  });
  root.addEventListener("keydown", (event) => {
    const key = event.target.closest(".key");
    if (!key || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    const all = keys();
    const rect = key.getBoundingClientRect();
    const center = (item) => {
      const box = item.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    };
    const from = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
    const sign = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    // Nearest key in the arrow's direction, preferring the same row/column.
    let best = null;
    let bestScore = Infinity;
    for (const item of all) {
      if (item === key) continue;
      const to = center(item);
      const along = horizontal ? to.x - from.x : to.y - from.y;
      const across = horizontal ? to.y - from.y : to.x - from.x;
      if (along * sign <= 1) continue;
      const score = Math.abs(along) + Math.abs(across) * 3;
      if (score < bestScore) {
        best = item;
        bestScore = score;
      }
    }
    if (!best) return;
    event.preventDefault();
    key.tabIndex = -1;
    best.tabIndex = 0;
    best.focus();
    onPick?.(best.dataset.code);
  });

  function paint({ selected = null, disabled = false } = {}) {
    keys().forEach((key) => {
      const active = key.dataset.code === selected;
      key.classList.toggle("is-selected", active);
      key.setAttribute("aria-pressed", String(active));
      key.disabled = disabled;
      const detail = describe?.(key.dataset.code) || "";
      if (key.title !== detail) key.title = detail;
      if (active && !root.contains(document.activeElement)) {
        keys().forEach((item) => {
          item.tabIndex = item === key ? 0 : -1;
        });
      }
    });
  }

  return { paint };
}
