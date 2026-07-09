import { hsvToRgb, rgbToCss, rgbToHsv } from "./color.js";

const OFF = { r: 42, g: 40, b: 52 };
const recipes = {
  2: { kind: "edge" },
  3: { kind: "gradient", axis: "row", span: 300 },
  4: { kind: "gradient", axis: "col", span: 300 },
  5: { kind: "breath" },
  6: { kind: "band", channel: "s" },
  7: { kind: "band", channel: "v" },
  8: { kind: "pinwheel", channel: "s" },
  9: { kind: "pinwheel", channel: "v", angle: .5, minS: 70 },
  10: { kind: "spiral" },
  11: { kind: "spiral", channel: "v", minS: 70, distSpan: 80 },
  12: { kind: "gradient", axis: "both", span: 180, minS: 85 },
  13: { kind: "gradient", axis: "col", span: 360, minS: 85 },
  14: { kind: "gradient", axis: "row", span: 360, minS: 85 },
  15: { kind: "chevron" },
  16: { kind: "radial" },
  17: { kind: "radial", dual: true },
  18: { kind: "pinwheel", minS: 85 },
  19: { kind: "spiral", row: true, minS: 85 },
  20: { kind: "beacon" },
  21: { kind: "steps" },
  22: { kind: "pinwheel", angle: 2, minS: 85 },
  23: { kind: "noise" },
  24: { kind: "noise" },
  28: { kind: "noise" },
  29: { kind: "noise" },
  30: { kind: "noise" },
  32: { kind: "noise" },
  25: { kind: "hue-breath" },
  26: { kind: "pendulum" },
  27: { kind: "wave" },
  31: { kind: "heat" },
  33: { kind: "reactive" },
  34: { kind: "reactive" },
  35: { kind: "reactive" },
  36: { kind: "reactive", hue: true },
  37: { kind: "reactive", hue: true },
  38: { kind: "reactive", hue: true },
  39: { kind: "reactive", hue: true },
  40: { kind: "reactive", hue: true },
  41: { kind: "reactive", hue: true },
  42: { kind: "reactive", hue: true },
  43: { kind: "reactive", hue: true },
  44: { kind: "reactive", hue: true },
};
const norm = (p) => {
  const x = p.colCount > 1 ? p.col / (p.colCount - 1) : 0,
    y = p.rowCount > 1 ? p.row / (p.rowCount - 1) : 0,
    dx = x - .5,
    dy = y - .5;
  return {
    x,
    y,
    d: Math.min(1, Math.hypot(dx, dy) * 2),
    a: (Math.atan2(dy, dx) * 180 + 360) % 360,
  };
};

export function keyDisplayColor(lighting, pos) {
  if (!lighting.isOn || lighting.mode === 0) return OFF;
  const p = norm(pos),
    r = recipes[lighting.mode] || { kind: "solid" },
    base = 18 + Math.max(0, Math.min(100, lighting.brightness)) * .82;
  let h = lighting.hue || 0,
    s = Math.max(0, Math.min(100, lighting.saturation)),
    v = base;
  if (r.kind === "edge" && (p.x < .12 || p.x > .88 || p.y > .75)) {
    h += 48;
    s = Math.min(100, s + 12);
  }
  if (r.kind === "gradient") {
    s = Math.max(s, 78);
    h += (r.axis === "row" ? p.y : r.axis === "col" ? p.x : p.x + p.y) * r.span;
  }
  if (r.kind === "breath") v *= .55 + .45 * Math.sin(p.x * Math.PI);
  if (r.kind === "band") {
    r.channel === "s"
      ? s = 18 + p.x * 82
      : v = 22 + p.x * (base - 22);
  }
  if (r.kind === "pinwheel") {
    s = Math.max(s, 78);
    h += p.a * (r.angle || 1);
    r.channel === "s"
      ? s = 35 + p.d * 65
      : r.channel === "v" && (v = 20 + p.d * (base - 20));
  }
  if (r.kind === "spiral") {
    s = Math.max(s, 78);
    h += p.a + p.d * (r.row ? 0 : (r.distSpan ?? 120)) + (r.row ? p.y * 90 : 0);
    if (r.channel === "v") v = 18 + ((p.a / 360 + p.d) / 2) * (base - 18);
  }
  if (r.kind === "chevron") {
    s = Math.max(s, 85);
    h += (Math.abs(p.x - .5) * 2 + p.y * .35) * 280;
  }
  if (r.kind === "radial") {
    s = Math.max(s, 80);
    h += p.d * 320 + (r.dual && p.x > .5 ? 140 : 0);
  }
  if (r.kind === "beacon") {
    s = Math.max(s, 70);
    h += p.x < .5 ? 0 : 180;
  }
  if (r.kind === "steps") {
    s = Math.max(s, 85);
    h += Math.floor(p.x * 6) * 60;
  }
  if (r.kind === "noise") {
    s = Math.max(s, 70);
    const c = (pos.col * 17 + pos.row * 31) % 100;
    h += c * 3.6;
    v *= .4 + (c % 60) / 100;
  }
  if (r.kind === "hue-breath") h += p.x * 40 - 20;
  if (r.kind === "pendulum") {
    s = Math.max(s, 75);
    h += Math.sin(p.x * Math.PI * 2) * 50 + p.y * 20;
  }
  if (r.kind === "wave") {
    s = Math.max(s, 80);
    h += p.x * 200 + Math.sin(p.y * Math.PI) * 40;
  }
  if (r.kind === "heat") {
    s = Math.max(40, s * .7);
    v *= .35 + p.x * .45 + (1 - p.y) * .2;
    h += p.x * 40;
  }
  if (r.kind === "reactive") {
    v *= .5 + .5 * (1 - p.d);
    if (r.hue) h += p.d * 50;
  }
  if (r.minS != null) s = Math.max(s, r.minS);
  return hsvToRgb(h, s, v);
}
export function keyOverrideDisplayColor(lighting, pos) {
  const base = keyDisplayColor(lighting, pos),
    hsv = rgbToHsv(base.r, base.g, base.b);
  return hsvToRgb(
    hsv.h + 168,
    Math.max(55, hsv.s + 10),
    Math.max(72, hsv.v + 8),
  );
}
export function lightingSwatchCss(lighting) {
  return rgbToCss(
    keyDisplayColor(lighting, { col: 0, row: 0, colCount: 1, rowCount: 1 }),
  );
}
