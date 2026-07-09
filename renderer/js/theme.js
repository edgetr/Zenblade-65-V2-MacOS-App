import { hsvToRgb, rgbToCss, rgbToHsv } from "./color.js";
export function uiAccentFromLighting(lighting) {
  // Physical LEDs may be intentionally dim/desaturated; chrome must remain readable.
  if (!lighting?.isOn || lighting.brightness < 22 || lighting.saturation < 25) {
    return { r: 184, g: 245, b: 200 };
  }
  return hsvToRgb(
    lighting.hue || 0,
    Math.max(45, lighting.saturation),
    Math.max(54, lighting.brightness),
  );
}
export function applyTheme(lighting) {
  const rgb = uiAccentFromLighting(lighting),
    root = document.documentElement,
    hot = {
      r: Math.min(255, rgb.r + 40),
      g: Math.min(255, rgb.g + 40),
      b: Math.min(255, rgb.b + 40),
    },
    ov = hsvToRgb(rgbToHsv(rgb.r, rgb.g, rgb.b).h + 168, 70, 90);
  root.style.setProperty("--accent-rgb", `${rgb.r}, ${rgb.g}, ${rgb.b}`);
  root.style.setProperty(
    "--accent-ink",
    (rgb.r * 0.299 + rgb.g * 0.587 + rgb.b * 0.114) > 150 ? "#101014" : "#ffffff",
  );
  root.style.setProperty("--accent", rgbToCss(rgb));
  root.style.setProperty("--accent-hot", rgbToCss(hot));
  root.style.setProperty(
    "--accent-dim",
    `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, .16)`,
  );
  root.style.setProperty(
    "--accent-glow",
    `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, .35)`,
  );
  root.style.setProperty("--override-rgb", `${ov.r}, ${ov.g}, ${ov.b}`);
}
