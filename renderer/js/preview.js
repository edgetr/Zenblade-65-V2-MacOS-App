import { hsvToRgb, rgbToCss, rgbToHsv } from "./color.js";
import { lightingWirePreview } from "./protocol.js";

const OFF = { r: 42, g: 40, b: 52 };
const recipes = {
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
  const x = p.colCount > 1 ? p.col / (p.colCount - 1) : 0;
  const y = p.rowCount > 1 ? p.row / (p.rowCount - 1) : 0;
  const dx = x - .5;
  const dy = y - .5;
  return {
    x,
    y,
    d: Math.min(1, Math.hypot(dx, dy) * 2),
    a: (Math.atan2(dy, dx) * 180 + 360) % 360,
  };
};

const handlers = {
  solid: (ctx) => ctx,
  gradient: (ctx) => {
    ctx.s = Math.max(ctx.s, 78);
    ctx.h += (ctx.r.axis === "row"
      ? ctx.p.y
      : ctx.r.axis === "col"
      ? ctx.p.x
      : ctx.p.x + ctx.p.y) * ctx.r.span;
    return ctx;
  },
  breath: (ctx) => {
    ctx.v *= .55 + .45 * Math.sin(ctx.p.x * Math.PI);
    return ctx;
  },
  band: (ctx) => {
    if (ctx.r.channel === "s") ctx.s = 18 + ctx.p.x * 82;
    else ctx.v = 22 + ctx.p.x * (ctx.base - 22);
    return ctx;
  },
  pinwheel: (ctx) => {
    ctx.s = Math.max(ctx.s, 78);
    ctx.h += ctx.p.a * (ctx.r.angle || 1);
    if (ctx.r.channel === "s") ctx.s = 35 + ctx.p.d * 65;
    else if (ctx.r.channel === "v") ctx.v = 20 + ctx.p.d * (ctx.base - 20);
    return ctx;
  },
  spiral: (ctx) => {
    ctx.s = Math.max(ctx.s, 78);
    ctx.h += ctx.p.a +
      ctx.p.d * (ctx.r.row ? 0 : (ctx.r.distSpan ?? 120)) +
      (ctx.r.row ? ctx.p.y * 90 : 0);
    if (ctx.r.channel === "v") {
      ctx.v = 18 + ((ctx.p.a / 360 + ctx.p.d) / 2) * (ctx.base - 18);
    }
    return ctx;
  },
  chevron: (ctx) => {
    ctx.s = Math.max(ctx.s, 85);
    ctx.h += (Math.abs(ctx.p.x - .5) * 2 + ctx.p.y * .35) * 280;
    return ctx;
  },
  radial: (ctx) => {
    ctx.s = Math.max(ctx.s, 80);
    ctx.h += ctx.p.d * 320 + (ctx.r.dual && ctx.p.x > .5 ? 140 : 0);
    return ctx;
  },
  beacon: (ctx) => {
    ctx.s = Math.max(ctx.s, 70);
    ctx.h += ctx.p.x < .5 ? 0 : 180;
    return ctx;
  },
  steps: (ctx) => {
    ctx.s = Math.max(ctx.s, 85);
    ctx.h += Math.floor(ctx.p.x * 6) * 60;
    return ctx;
  },
  noise: (ctx) => {
    ctx.s = Math.max(ctx.s, 70);
    const c = (ctx.pos.col * 17 + ctx.pos.row * 31) % 100;
    ctx.h += c * 3.6;
    ctx.v *= .4 + (c % 60) / 100;
    return ctx;
  },
  "hue-breath": (ctx) => {
    ctx.h += ctx.p.x * 40 - 20;
    return ctx;
  },
  pendulum: (ctx) => {
    ctx.s = Math.max(ctx.s, 75);
    ctx.h += Math.sin(ctx.p.x * Math.PI * 2) * 50 + ctx.p.y * 20;
    return ctx;
  },
  wave: (ctx) => {
    ctx.s = Math.max(ctx.s, 80);
    ctx.h += ctx.p.x * 200 + Math.sin(ctx.p.y * Math.PI) * 40;
    return ctx;
  },
  heat: (ctx) => {
    ctx.s = Math.max(40, ctx.s * .7);
    ctx.v *= .35 + ctx.p.x * .45 + (1 - ctx.p.y) * .2;
    ctx.h += ctx.p.x * 40;
    return ctx;
  },
  reactive: (ctx) => {
    ctx.v *= .5 + .5 * (1 - ctx.p.d);
    if (ctx.r.hue) ctx.h += ctx.p.d * 50;
    return ctx;
  },
};

// Pure per-key colour for keyboard and effect previews. Always quantizes to the
// 8-bit wire values the firmware receives (no cosmetic brightness lift).
export function keyDisplayColor(lighting, pos) {
  const L = lightingWirePreview(lighting);
  if (!L.isOn || L.mode === 0) return OFF;
  const p = norm(pos);
  const r = recipes[L.mode] || { kind: "solid" };
  const base = Math.max(0, Math.min(100, L.brightness));
  let ctx = {
    h: L.hue || 0,
    s: Math.max(0, Math.min(100, L.saturation)),
    v: base,
    p,
    r,
    base,
    pos,
  };
  ctx = (handlers[r.kind] || handlers.solid)(ctx);
  if (r.minS != null) ctx.s = Math.max(ctx.s, r.minS);
  return hsvToRgb(ctx.h, ctx.s, ctx.v);
}

export function keyOverrideDisplayColor(lighting, pos) {
  const base = keyDisplayColor(lighting, pos);
  const hsv = rgbToHsv(base.r, base.g, base.b);
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

// Base colour after wire quantization — used for solid single-color swatches
// and the native colour readout.
export function baseWireColor(lighting) {
  const L = lightingWirePreview(lighting);
  return hsvToRgb(L.hue, L.saturation, L.brightness);
}
