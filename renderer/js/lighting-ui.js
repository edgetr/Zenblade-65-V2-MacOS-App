import { LIGHT_MODES } from "./lighting-modes.js";
import {
  clamp,
  hexToRgb,
  hslToRgb,
  hsvToRgb,
  rgbToHex,
  rgbToHsl,
  rgbToHsv,
} from "./color.js";
import { keyDisplayColor } from "./preview.js";
export const colorUiForMode = (hasColor, colorUi) =>
  hasColor && colorUi === "hidden" ? "simple" : colorUi;
export function createLightingUi({ model, paint, toast }) {
  const { state, setLighting } = model,
    $ = (id) => document.getElementById(id),
    grid = $("modeGrid"),
    wheel = $("colorWheel"),
    ctx = wheel?.getContext("2d");
  let dragging = false, wheelImage = null;
  LIGHT_MODES.forEach((m) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "mode-chip";
    b.dataset.mode = m.id;
    b.textContent = m.name;
    b.title = m.name;
    grid.append(b);
  });
  const hasColor = () =>
    (LIGHT_MODES.find((m) => m.id === state.lighting.mode)?.params || [])
      .includes("color");
  function visibility() {
    const params =
      LIGHT_MODES.find((m) => m.id === state.lighting.mode)?.params || [];
    [
      ["fieldBright", "brightness"],
      ["fieldSpeed", "speed"],
      ["fieldHue", "color"],
      ["fieldSat", "color"],
      ["fieldColor", "color"],
    ].forEach(([id, param]) => $(id).hidden = !params.includes(param));
    if (!hasColor()) state.colorUi = "hidden";
    // A colorless mode intentionally hides color UI, but it must not leave the
    // next color-capable mode without a way back to the simple/advanced picker.
    state.colorUi = colorUiForMode(hasColor(), state.colorUi);
    $("advancedColor").hidden = state.colorUi !== "advanced";
    $("simpleColorControls").hidden = state.colorUi !== "simple";
    $("btnToggleAdvancedColor").textContent = state.colorUi === "advanced"
      ? "Simple"
      : "Advanced";
  }
  function draw() {
    if (!wheel || !ctx) return;
    const size = wheel.width,
      c = size / 2,
      r = c - 2,
      img = wheelImage || ctx.createImageData(size, size);
    if (!wheelImage) {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const dx = x - c,
            dy = y - c,
            d = Math.hypot(dx, dy),
            i = (y * size + x) * 4;
          if (d <= r) {
            const color = hsvToRgb(
              (Math.atan2(dy, dx) * 180 + 360) % 360,
              d / r * 100,
              100,
            );
            img.data.set([color.r, color.g, color.b, 255], i);
          }
        }
      }
      wheelImage = img;
    }
    ctx.putImageData(img, 0, 0);
    const rad = state.lighting.hue * Math.PI / 180,
      d = state.lighting.saturation / 100 * r;
    ctx.beginPath();
    ctx.arc(c + Math.cos(rad) * d, c + Math.sin(rad) * d, 7, 0, Math.PI * 2);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  function sync() {
    const L = state.lighting;
    $("lightOn").checked = L.isOn;
    [
      ["lightBright", "outBright", "brightness"],
      ["lightSpeed", "outSpeed", "speed"],
      ["lightHue", "outHue", "hue"],
      ["lightSat", "outSat", "saturation"],
    ].forEach(([input, out, key]) => {
      $(input).value = L[key];
      $(out).textContent = L[key];
    });
    grid.querySelectorAll(".mode-chip").forEach((b) =>
      {
        const active = +b.dataset.mode === L.mode;
        b.classList.toggle("is-active", active);
        b.setAttribute("aria-pressed", String(active));
      }
    );
    const rgb = keyDisplayColor(
      { ...L, mode: 1, isOn: true, brightness: 100 },
      { col: 0, row: 0, colCount: 1, rowCount: 1 },
    );
    if (document.activeElement !== $("lightColorPicker")) {
      $("lightColorPicker").value = rgbToHex(rgb);
    }
    if (document.activeElement !== $("inputHex")) {
      $("inputHex").value = rgbToHex(rgb);
    }
    if (document.activeElement !== $("inputRgb")) {
      $("inputRgb").value = `${rgb.r}, ${rgb.g}, ${rgb.b}`;
    }
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    if (document.activeElement !== $("inputHsl")) {
      $("inputHsl").value = `${hsl.h}, ${hsl.s}%, ${hsl.l}%`;
    }
    visibility();
    if (state.colorUi === "advanced") draw();
    if (wheel) {
      wheel.setAttribute("aria-valuenow", String(L.hue));
      wheel.setAttribute("aria-valuetext", `Hue ${L.hue}, saturation ${L.saturation}%`);
    }
  }
  const update = (part) => {
    setLighting(part);
    sync();
    paint();
  };
  grid.addEventListener("click", (e) => {
    const b = e.target.closest(".mode-chip");
    if (b) update({ mode: +b.dataset.mode });
  });
  [
    ["lightBright", "brightness"],
    ["lightSpeed", "speed"],
    ["lightHue", "hue"],
    ["lightSat", "saturation"],
  ].forEach(([id, key]) =>
    $(id).addEventListener("input", (e) => update({ [key]: +e.target.value }))
  );
  $("lightOn").addEventListener(
    "change",
    (e) => update({ isOn: e.target.checked }),
  );
  function color(rgb) {
    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    update({ hue: hsv.h, saturation: hsv.s });
  }
  $("lightColorPicker").addEventListener("input", (e) => {
    const rgb = hexToRgb(e.target.value);
    if (rgb) color(rgb);
  });
  $("btnToggleAdvancedColor").addEventListener("click", () => {
    state.colorUi = state.colorUi === "advanced" ? "simple" : "advanced";
    sync();
  });
  $("btnToggleAdvancedColorClose").addEventListener("click", () => {
    state.colorUi = "simple";
    sync();
  });
  [["inputHex", (v) => hexToRgb(v)], ["inputRgb", (v) => {
    const a = v.match(/\d+/g);
    return a?.length >= 3
      ? {
        r: clamp(a[0], 0, 255),
        g: clamp(a[1], 0, 255),
        b: clamp(a[2], 0, 255),
      }
      : null;
  }], ["inputHsl", (v) => {
    const a = v.match(/[\d.]+/g);
    return a?.length >= 3 ? hslToRgb(a[0], a[1], a[2]) : null;
  }]].forEach(([id, parse]) => {
    const el = $(id),
      apply = () => {
        const rgb = parse(el.value);
        el.classList.toggle("is-invalid", !rgb);
        el.setAttribute("aria-invalid", String(!rgb));
        if (rgb) color(rgb);
        else toast(`Invalid ${id.replace("input", "")}`, "error");
      };
    el.addEventListener("change", apply);
    el.addEventListener("keydown", (e) => e.key === "Enter" && apply());
  });
  function wheelEvent(e) {
    const rect = wheel.getBoundingClientRect(),
      x = (e.clientX - rect.left) * wheel.width / rect.width - wheel.width / 2,
      y = (e.clientY - rect.top) * wheel.height / rect.height -
        wheel.height / 2,
      r = wheel.width / 2 - 2,
      d = Math.min(r, Math.hypot(x, y));
    update({
      hue: Math.round((Math.atan2(y, x) * 180 + 360) % 360),
      saturation: Math.round(d / r * 100),
    });
  }
  if (wheel) {
    wheel.addEventListener("pointerdown", (e) => {
      dragging = true;
      wheel.setPointerCapture(e.pointerId);
      wheelEvent(e);
    });
    wheel.addEventListener("pointermove", (e) => dragging && wheelEvent(e));
    wheel.addEventListener("pointerup", () => dragging = false);
    wheel.addEventListener("pointercancel", () => dragging = false);
    wheel.addEventListener("keydown", (event) => {
      const delta = event.shiftKey ? 5 : 1;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        update({ hue: (state.lighting.hue + (event.key === "ArrowRight" ? delta : -delta) + 360) % 360 });
      }
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        update({ saturation: clamp(state.lighting.saturation + (event.key === "ArrowUp" ? delta : -delta), 0, 100) });
      }
    });
  }
  return { sync, visibility };
}
