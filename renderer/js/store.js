import { normalizeLighting, PROFILE_COUNT } from "./protocol.js";
import { clamp } from "./color.js";

export const STORAGE_KEY = "zenblade.profiles.v2";
export const deepClone = (value) => JSON.parse(JSON.stringify(value));

export const defaultLighting = () => ({
  isOn: true,
  mode: 1,
  brightness: 80,
  speed: 50,
  hue: 0,
  saturation: 100,
});

export const defaultActuation = () => ({
  press: 15,
  release: 15,
  rapidTrigger: true,
});

export const defaultProfile = () => ({
  lighting: defaultLighting(),
  actuation: defaultActuation(),
  keyOverrides: {},
  appNotes: {},
});

export const defaultStore = () => ({
  activeProfile: 0,
  profiles: Array.from({ length: PROFILE_COUNT }, defaultProfile),
});

const number = (value, fallback) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;

export function normalizeActuation(partial = {}, fallback = {}) {
  const base = {
    press: fallback.press ?? 15,
    release: fallback.release ?? 15,
    rapidTrigger: fallback.rapidTrigger !== false,
  };
  return {
    press: clamp(number(partial.press, base.press), 1, 40),
    release: clamp(number(partial.release, base.release), 1, 40),
    rapidTrigger: typeof partial.rapidTrigger === "boolean"
      ? partial.rapidTrigger
      : base.rapidTrigger,
  };
}

export function normalizeStore(raw, validCodes = {}) {
  const store = defaultStore();
  if (!raw || typeof raw !== "object") return store;
  store.activeProfile = clamp(raw.activeProfile, 0, PROFILE_COUNT - 1) | 0;
  for (let i = 0; i < PROFILE_COUNT; i++) {
    const src = raw.profiles?.[i];
    if (!src || typeof src !== "object") continue;
    const p = store.profiles[i];
    const l = src.lighting || {};
    const a = src.actuation || {};
    p.lighting = normalizeLighting(l, defaultLighting());
    p.actuation = normalizeActuation(a, defaultActuation());
    for (const [code, ov] of Object.entries(src.keyOverrides || {})) {
      if (validCodes[code] != null && ov && typeof ov === "object") {
        p.keyOverrides[code] = {
          press: clamp(number(ov.press, 15), 1, 40),
          release: clamp(number(ov.release, 15), 1, 40),
        };
        if (ov.macro || ov.combo) {
          p.appNotes[code] = {
            macro: String(ov.macro || ""),
            combo: String(ov.combo || ""),
          };
        }
      }
    }
    for (const [code, note] of Object.entries(src.appNotes || {})) {
      if (validCodes[code] != null && note) {
        p.appNotes[code] = {
          macro: String(note.macro || ""),
          combo: String(note.combo || ""),
        };
      }
    }
  }
  return store;
}

export function loadStore(storage = localStorage, validCodes) {
  try {
    return normalizeStore(
      JSON.parse(storage.getItem(STORAGE_KEY) || "null"),
      validCodes,
    );
  } catch {
    return defaultStore();
  }
}

export function saveStore(store, storage = localStorage) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch (error) {
    console.warn("profile store save failed", error);
    return false;
  }
}
