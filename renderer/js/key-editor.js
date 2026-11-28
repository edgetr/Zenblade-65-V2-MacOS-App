import { $ } from "./dom.js";
import { keyName } from "./layout.js";
import { formatMm } from "./units.js";

export const KEY_GROUPS = Object.freeze({
  wasd: ["W", "A", "S", "D"],
  arrows: ["UP", "LEFT", "DOWN", "RGHT"],
  modifiers: ["LSFT", "RSFT", "LCTL", "LALT", "LGUI", "RALT", "RGUI"],
});

const TRI_STATE = { "": undefined, on: true, off: false };
const triStateValue = (value) =>
  value === true ? "on" : value === false ? "off" : "";

export function createKeyEditor({
  model,
  paint,
  onApply,
  onChange,
  toast,
  connected,
}) {
  const { state, setOverride, resetOverride, setActuation } = model;
  const setRangeProgress = (input) => {
    const min = Number(input.min);
    const max = Number(input.max);
    input.style.setProperty(
      "--range-progress",
      `${(Number(input.value) - min) / (max - min) * 100}%`,
    );
  };
  const selection = () =>
    state.selectedKeys?.length
      ? state.selectedKeys
      : state.selectedKey
      ? [state.selectedKey]
      : [];

  function render() {
    const codes = selection();
    const primary = state.selectedKey;
    if (!primary) return;
    const ov = state.keyOverrides[primary] || {};
    $("keyEditorTitle").textContent = codes.length > 1
      ? `${codes.length} keys`
      : keyName(primary);
    $("keyEditorKeys").textContent = codes.length > 1
      ? codes.map(keyName).join(", ")
      : "";
    [["keyPress", "keyOutPress", ov.press ?? state.actuation.press], [
      "keyRelease",
      "keyOutRelease",
      ov.release ?? state.actuation.release,
    ]].forEach(([input, out, value]) => {
      $(input).value = value;
      $(out).textContent = formatMm(value);
      setRangeProgress($(input));
    });
    $("keyRT").value = triStateValue(ov.rapidTrigger);
    $("keyCRT").value = triStateValue(ov.continuousRapidTrigger);
    $("keyRT").options[0].textContent = `Use Feel (${
      state.actuation.rapidTrigger ? "on" : "off"
    })`;
    $("keyCRT").options[0].textContent = `Use Feel (${
      state.actuation.continuousRapidTrigger ? "on" : "off"
    })`;
    syncContinuousAvailability();
  }

  function syncContinuousAvailability() {
    const rapid = TRI_STATE[$("keyRT").value] ?? state.actuation.rapidTrigger;
    $("keyCRT").disabled = !rapid;
  }

  // extend: Shift- or Command-click adds or removes a key from the selection.
  function open(code, { extend = false } = {}) {
    let codes = selection();
    if (extend && codes.length) {
      codes = codes.includes(code)
        ? codes.filter((item) => item !== code)
        : [...codes, code];
    } else {
      codes = [code];
    }
    if (!codes.length) {
      clear();
      return;
    }
    select(codes, codes.includes(code) ? code : codes.at(-1));
  }

  function select(codes, primary = codes.at(-1)) {
    if (!codes.length) {
      clear();
      return;
    }
    state.selectedKeys = [...codes];
    state.selectedKey = primary;
    $("keyEditor").hidden = false;
    $("keyEditorEmpty").hidden = true;
    $("keyEditorBody").hidden = false;
    render();
    paint();
    onChange?.();
  }

  function clear() {
    $("keyEditor").hidden = true;
    state.selectedKey = null;
    state.selectedKeys = [];
    $("keyEditorEmpty").hidden = false;
    $("keyEditorBody").hidden = true;
    paint();
    onChange?.();
  }

  [["keyPress", "keyOutPress"], ["keyRelease", "keyOutRelease"]].forEach(
    ([id, out]) =>
      $(id).addEventListener(
        "input",
        (e) => {
          $(out).textContent = formatMm(e.target.value);
          setRangeProgress(e.target);
        },
      ),
  );
  $("keyRT").addEventListener("change", syncContinuousAvailability);

  $("btnApplyKey").addEventListener("click", async () => {
    const codes = selection();
    if (!codes.length) return;
    const rapidTrigger = TRI_STATE[$("keyRT").value];
    const values = {
      press: Number($("keyPress").value),
      release: Number($("keyRelease").value),
      rapidTrigger,
      // A key with Rapid Trigger off has no continuous mode to set.
      continuousRapidTrigger: (rapidTrigger ?? state.actuation.rapidTrigger)
        ? TRI_STATE[$("keyCRT").value]
        : undefined,
    };
    codes.forEach((code) => setOverride(code, values));
    render();
    paint();
    syncOverrideTools();
    const label = codes.length > 1 ? `${codes.length} keys` : "Key";
    try {
      await onApply();
      toast(
        connected?.() ? `${label} applied` : `${label} saved locally`,
        "ok",
      );
    } catch (error) {
      toast(`Saved locally — ${error.message}`, "error");
    }
  });

  $("btnResetKey").addEventListener("click", async () => {
    const codes = selection();
    if (!codes.length) return;
    codes.forEach((code) => resetOverride(code));
    render();
    paint();
    syncOverrideTools();
    const label = codes.length > 1 ? `${codes.length} keys` : "Key";
    try {
      await onApply();
      toast(
        connected?.() ? `${label} reset on keyboard` : `${label} reset saved locally`,
        "ok",
      );
    } catch (error) {
      toast(`Reset saved locally — ${error.message}`, "error");
    }
  });

  document.querySelectorAll("[data-key-group]").forEach((button) =>
    button.addEventListener("click", () => {
      const group = KEY_GROUPS[button.dataset.keyGroup];
      if (group) select(group, group[0]);
    })
  );

  // Two-step confirm: the first click arms the button for a few seconds.
  let clearArmed = 0;
  $("btnClearOverrides").addEventListener("click", async () => {
    const codes = Object.keys(state.keyOverrides);
    if (!codes.length) return;
    if (!clearArmed) {
      $("btnClearOverrides").textContent = `Clear ${codes.length}?`;
      clearArmed = setTimeout(() => {
        clearArmed = 0;
        syncOverrideTools();
      }, 3000);
      return;
    }
    clearTimeout(clearArmed);
    clearArmed = 0;
    codes.forEach((code) => resetOverride(code));
    if (state.selectedKey) render();
    paint();
    syncOverrideTools();
    try {
      await onApply();
      toast(`Cleared ${codes.length} key override${codes.length === 1 ? "" : "s"}`, "ok");
    } catch (error) {
      toast(`Cleared locally — ${error.message}`, "error");
    }
  });

  function syncOverrideTools() {
    const count = Object.keys(state.keyOverrides).length;
    $("btnClearOverrides").disabled = count === 0;
    if (!clearArmed) {
      $("btnClearOverrides").textContent = count
        ? `Clear overrides (${count})`
        : "No overrides";
    }
  }

  [["actPress", "outPress", "press"], ["actRelease", "outRelease", "release"]]
    .forEach(([id, out, key]) =>
      $(id).addEventListener("input", (e) => {
        setActuation({ [key]: +e.target.value });
        $(out).textContent = formatMm(e.target.value);
        setRangeProgress(e.target);
        if (state.selectedKey && !state.keyOverrides[state.selectedKey]) {
          render();
        }
        onChange?.();
      })
    );

  $("actRT").addEventListener("change", (e) => {
    setActuation({ rapidTrigger: e.target.checked });
    syncFeel();
    onChange?.();
  });
  $("actCRT").addEventListener("change", (e) => {
    setActuation({ continuousRapidTrigger: e.target.checked });
    syncFeel();
    onChange?.();
  });

  document.querySelectorAll("[data-preset]").forEach((b) =>
    b.addEventListener("click", () => {
      const p = b.dataset.preset;
      setActuation(
        p === "gaming"
          ? { press: 8, release: 8, rapidTrigger: true }
          : p === "balanced"
          ? { press: 15, release: 15, rapidTrigger: true }
          : { press: 22, release: 20, rapidTrigger: false, continuousRapidTrigger: false },
      );
      // Sliders already reflect the preset — skip redundant selection toasts.
      syncFeel();
      onChange?.();
    })
  );

  function syncFeel() {
    const a = state.actuation;
    $("actPress").value = a.press;
    $("outPress").textContent = formatMm(a.press);
    setRangeProgress($("actPress"));
    $("actRelease").value = a.release;
    $("outRelease").textContent = formatMm(a.release);
    setRangeProgress($("actRelease"));
    $("actRT").checked = a.rapidTrigger;
    $("actCRT").checked = a.continuousRapidTrigger;
    $("actCRT").disabled = !a.rapidTrigger;
    syncOverrideTools();
    if (state.selectedKey) render();
  }

  return { open, select, clear, syncFeel, syncOverrideTools };
}
