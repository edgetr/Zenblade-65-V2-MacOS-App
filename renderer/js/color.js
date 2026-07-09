export const clamp = (value, low, high) =>
  Math.max(low, Math.min(high, Number(value) || 0));

export function hsvToRgb(h, s, v) {
  const hue = (((Number(h) % 360) + 360) % 360) / 60;
  const sat = clamp(s, 0, 100) / 100;
  const value = clamp(v, 0, 100) / 100;
  const c = value * sat;
  const x = c * (1 - Math.abs((hue % 2) - 1));
  const m = value - c;
  const [r, g, b] = hue < 1
    ? [c, x, 0]
    : hue < 2
    ? [x, c, 0]
    : hue < 3
    ? [0, c, x]
    : hue < 4
    ? [0, x, c]
    : hue < 5
    ? [x, 0, c]
    : [c, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

export function hslToRgb(h, s, l) {
  const hue = ((Number(h) % 360) + 360) % 360;
  const sat = clamp(s, 0, 100) / 100;
  const light = clamp(l, 0, 100) / 100;
  const a = sat * Math.min(light, 1 - light);
  const channel = (n) =>
    Math.round(
      255 *
        (light -
          a *
            Math.max(
              Math.min(
                (n + hue / 30) % 12 - 3,
                9 - ((n + hue / 30) % 12 - 3),
                1,
              ),
              -1,
            )),
    );
  return { r: channel(0), g: channel(8), b: channel(4) };
}

export function rgbToHsv(r, g, b) {
  const [rr, gg, bb] = [r, g, b].map((x) => clamp(x, 0, 255) / 255);
  const max = Math.max(rr, gg, bb),
    min = Math.min(rr, gg, bb),
    delta = max - min;
  let h = 0;
  if (delta) {
    h = 60 * (max === rr
      ? ((gg - bb) / delta) % 6
      : max === gg
      ? (bb - rr) / delta + 2
      : (rr - gg) / delta + 4);
  }
  return {
    h: Math.round((h + 360) % 360),
    s: Math.round(max ? delta / max * 100 : 0),
    v: Math.round(max * 100),
  };
}

export function rgbToHsl(r, g, b) {
  const [rr, gg, bb] = [r, g, b].map((x) => clamp(x, 0, 255) / 255);
  const max = Math.max(rr, gg, bb),
    min = Math.min(rr, gg, bb),
    d = max - min,
    l = (max + min) / 2;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    h = 60 *
      (max === rr
        ? ((gg - bb) / d) % 6
        : max === gg
        ? (bb - rr) / d + 2
        : (rr - gg) / d + 4);
  }
  return {
    h: Math.round((h + 360) % 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

export function hexToRgb(hex) {
  const raw = String(hex || "").trim().replace(/^#/, "");
  const normal = raw.length === 3 ? [...raw].map((x) => x + x).join("") : raw;
  if (!/^[0-9a-f]{6}$/i.test(normal)) return null;
  return {
    r: parseInt(normal.slice(0, 2), 16),
    g: parseInt(normal.slice(2, 4), 16),
    b: parseInt(normal.slice(4, 6), 16),
  };
}
export const rgbToHex = ({ r, g, b }) =>
  `#${
    [r, g, b].map((x) =>
      clamp(Math.round(x), 0, 255).toString(16).padStart(2, "0")
    ).join("")
  }`;
export const rgbToCss = ({ r, g, b }, alpha = 1) =>
  alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
