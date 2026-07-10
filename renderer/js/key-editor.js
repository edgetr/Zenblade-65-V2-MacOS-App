import { $ } from "./dom.js";

export function createKeyEditor({ model, paint, onApply, toast }) {
  const { state, setOverride, resetOverride, setActuation } = model;

  function open(code) {
    state.selectedKey = code;
    $("keyEditorEmpty").hidden = true;
    $("keyEditorBody").hidden = false;
    const ov = state.keyOverrides[code] || {};
    const notes = state.appNotes[code] || {};
    $("keyEditorTitle").textContent = code;
    [["keyPress", "keyOutPress", ov.press ?? state.actuation.press], [
      "keyRelease",
      "keyOutRelease",
      ov.release ?? state.actuation.release,
    ]].forEach(([input, out, value]) => {
      $(input).value = value;
      $(out).textContent = value;
    });
    $("keyMacro").value = notes.macro || "";
    $("keyCombo").value = notes.combo || "";
    paint();
  }

  function clear() {
    state.selectedKey = null;
    $("keyEditorEmpty").hidden = false;
    $("keyEditorBody").hidden = true;
    paint();
  }

  [["keyPress", "keyOutPress"], ["keyRelease", "keyOutRelease"]].forEach(
    ([id, out]) =>
      $(id).addEventListener(
        "input",
        (e) => $(out).textContent = e.target.value,
      ),
  );

  $("btnApplyKey").addEventListener("click", async () => {
    if (!state.selectedKey) return;
    const values = {
      press: Number($("keyPress").value),
      release: Number($("keyRelease").value),
    };
    const notes = {
      macro: $("keyMacro").value.trim(),
      combo: $("keyCombo").value.trim(),
    };
    setOverride(state.selectedKey, values, notes);
    open(state.selectedKey);
    try {
      await onApply();
      toast("Key applied", "ok");
    } catch (error) {
      toast(`Key saved locally — ${error.message}`, "error");
    }
  });

  $("btnResetKey").addEventListener("click", async () => {
    if (!state.selectedKey) return;
    resetOverride(state.selectedKey);
    open(state.selectedKey);
    try {
      await onApply();
      toast("Key reset", "ok");
    } catch (error) {
      toast(`Reset saved locally — ${error.message}`, "error");
    }
  });

  [["actPress", "outPress", "press"], ["actRelease", "outRelease", "release"]]
    .forEach(([id, out, key]) =>
      $(id).addEventListener("input", (e) => {
        setActuation({ [key]: +e.target.value });
        $(out).textContent = e.target.value;
        if (state.selectedKey && !state.keyOverrides[state.selectedKey]) {
          open(state.selectedKey);
        }
      })
    );

  $("actRT").addEventListener(
    "change",
    (e) => setActuation({ rapidTrigger: e.target.checked }),
  );

  document.querySelectorAll("[data-preset]").forEach((b) =>
    b.addEventListener("click", () => {
      const p = b.dataset.preset;
      setActuation(
        p === "gaming"
          ? { press: 8, release: 8, rapidTrigger: true }
          : p === "balanced"
          ? { press: 15, release: 15, rapidTrigger: true }
          : { press: 22, release: 20, rapidTrigger: false },
      );
      syncFeel();
      toast(p, "ok");
    })
  );

  function syncFeel() {
    const a = state.actuation;
    $("actPress").value = a.press;
    $("outPress").textContent = a.press;
    $("actRelease").value = a.release;
    $("outRelease").textContent = a.release;
    $("actRT").checked = a.rapidTrigger;
  }

  $("btnClearTypingTest").addEventListener("click", () => {
    $("typingTest").value = "";
    $("typingTest").focus();
  });

  return { open, clear, syncFeel };
}
