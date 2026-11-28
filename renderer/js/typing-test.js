import { $ } from "./dom.js";

// A re-press this soon after a release is faster than a person can type and
// usually means the key bounced (too-sensitive actuation or Rapid Trigger).
export const CHATTER_MS = 25;
const IDLE_RESET_MS = 5000;

export function createTypingStats(now = () => performance.now()) {
  const downAt = new Map();
  const upAt = new Map();
  let holds = [];
  let chatter = 0;
  let keys = 0;
  let typed = 0;
  let startedAt = null;
  let lastAt = null;
  return {
    down(code) {
      const at = now();
      if (lastAt != null && at - lastAt > IDLE_RESET_MS) {
        startedAt = null;
        typed = 0;
      }
      if (startedAt == null) startedAt = at;
      lastAt = at;
      keys++;
      const released = upAt.get(code);
      if (released != null && at - released < CHATTER_MS) chatter++;
      downAt.set(code, at);
    },
    up(code) {
      const at = now();
      const pressed = downAt.get(code);
      if (pressed != null) {
        holds.push(at - pressed);
        if (holds.length > 200) holds = holds.slice(-200);
        downAt.delete(code);
      }
      upAt.set(code, at);
      if (startedAt != null) lastAt = at;
    },
    typedCharacters(count) {
      typed += Math.max(0, count);
    },
    reset() {
      downAt.clear();
      upAt.clear();
      holds = [];
      chatter = 0;
      keys = 0;
      typed = 0;
      startedAt = null;
      lastAt = null;
    },
    snapshot() {
      const minutes = startedAt == null ? 0 : (lastAt - startedAt) / 60000;
      return {
        wpm: minutes > 0.05 ? Math.round(typed / 5 / minutes) : null,
        holdMs: holds.length
          ? Math.round(holds.reduce((sum, value) => sum + value, 0) / holds.length)
          : null,
        chatter,
        keys,
      };
    },
  };
}

export function installTypingTest() {
  const area = $("typingTest");
  if (!area) return null;
  const stats = createTypingStats();
  let frame = 0;
  const render = () => {
    frame = 0;
    const value = stats.snapshot();
    $("typingWpm").textContent = value.wpm ?? "—";
    $("typingHold").textContent = value.holdMs == null ? "—" : `${value.holdMs} ms`;
    $("typingChatter").textContent = String(value.chatter);
    $("typingChatter").closest(".typing-stat")
      ?.classList.toggle("is-warning", value.chatter > 0);
    $("typingKeys").textContent = String(value.keys);
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(render);
  };
  let previousLength = area.value.length;
  area.addEventListener("keydown", (event) => {
    if (event.repeat || event.metaKey) return;
    stats.down(event.code);
    schedule();
  });
  area.addEventListener("keyup", (event) => {
    stats.up(event.code);
    schedule();
  });
  area.addEventListener("input", () => {
    stats.typedCharacters(area.value.length - previousLength);
    previousLength = area.value.length;
    schedule();
  });
  $("btnClearTypingTest").addEventListener("click", () => {
    area.value = "";
    previousLength = 0;
    stats.reset();
    render();
    area.focus();
  });
  render();
  return stats;
}
