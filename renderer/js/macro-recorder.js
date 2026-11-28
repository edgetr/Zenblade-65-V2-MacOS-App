import { isModifierHid } from "./advanced-data.js";

export const MIN_RECORDED_DELAY_MS = 30;
const MAX_DELAY_MS = 60000;

// Turns key down/up events into onboard macro actions. Keys are recorded as
// press/release so chords such as Command-C replay with the modifier held; a
// press released before anything else happens collapses back into a tap.
export function createMacroRecorder(actions, now = () => performance.now()) {
  const held = new Set();
  let lastAt = null;
  const pause = () => {
    const at = now();
    if (lastAt != null) {
      const duration = Math.round(at - lastAt);
      if (duration >= MIN_RECORDED_DELAY_MS) {
        actions.push({ type: "delay", duration: Math.min(duration, MAX_DELAY_MS) });
      }
    }
    lastAt = at;
  };
  return {
    down(keycode, { command = false } = {}) {
      if (held.has(keycode)) return;
      pause();
      // macOS never delivers keyup for a key pressed while Command is held,
      // so record it as a complete tap inside the held modifier.
      if (command && !isModifierHid(keycode)) {
        actions.push({ type: "tap", keycode });
        return;
      }
      held.add(keycode);
      actions.push({ type: "press", keycode });
    },
    up(keycode) {
      if (!held.delete(keycode)) return;
      const last = actions.at(-1);
      if (last?.type === "press" && last.keycode === keycode) {
        actions[actions.length - 1] = { type: "tap", keycode };
        lastAt = now();
        return;
      }
      pause();
      actions.push({ type: "release", keycode });
    },
    // Release anything still held so a stopped recording never leaves a key
    // stuck down on the keyboard.
    finish() {
      for (const keycode of [...held]) this.up(keycode);
    },
  };
}
