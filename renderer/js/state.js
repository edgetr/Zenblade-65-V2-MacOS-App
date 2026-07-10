import {
  deepClone,
  loadStore,
  normalizeActuation,
  saveStore,
} from "./store.js";
import { normalizeLighting, PROFILE_COUNT } from "./protocol.js";

export function createModel({ storage, validCodes, debounceMs = 220 } = {}) {
  const store = loadStore(storage, validCodes);
  const current = store.profiles[store.activeProfile];
  const state = {
    connected: false,
    profile: store.activeProfile,
    lighting: deepClone(current.lighting),
    actuation: deepClone(current.actuation),
    keyOverrides: deepClone(current.keyOverrides),
    appNotes: deepClone(current.appNotes),
    selectedKey: null,
    colorUi: "simple",
    syncIncomplete: null,
  };
  let timer = 0;
  let saved = "";

  const snapshot = () => {
    store.profiles[state.profile] = {
      lighting: deepClone(state.lighting),
      actuation: deepClone(state.actuation),
      keyOverrides: deepClone(state.keyOverrides),
      appNotes: deepClone(state.appNotes),
    };
    store.activeProfile = state.profile;
  };

  const persist = (immediate = false) => {
    clearTimeout(timer);
    const write = () => {
      snapshot();
      const json = JSON.stringify(store);
      if (json !== saved) {
        saveStore(store, storage);
        saved = json;
      }
    };
    if (immediate) write();
    else timer = setTimeout(write, debounceMs);
  };

  const setLighting = (partial, { persist: shouldPersist = true } = {}) => {
    state.lighting = normalizeLighting(partial, state.lighting);
    if (shouldPersist) persist();
    return state.lighting;
  };

  const setActuation = (partial, { persist: shouldPersist = true } = {}) => {
    state.actuation = normalizeActuation(partial, state.actuation);
    if (shouldPersist) persist();
    return state.actuation;
  };

  const setColorUi = (mode) => {
    state.colorUi = mode === "advanced"
      ? "advanced"
      : mode === "hidden"
      ? "hidden"
      : "simple";
    return state.colorUi;
  };

  const setOverride = (code, values, notes) => {
    const normalized = normalizeActuation(values, state.actuation);
    state.keyOverrides[code] = {
      press: normalized.press,
      release: normalized.release,
    };
    if (notes) {
      state.appNotes[code] = {
        macro: notes.macro || "",
        combo: notes.combo || "",
      };
    }
    persist();
  };

  const resetOverride = (code) => {
    delete state.keyOverrides[code];
    delete state.appNotes[code];
    persist();
  };

  const selectProfile = (index) => {
    snapshot();
    const profileIndex = Math.max(
      0,
      Math.min(PROFILE_COUNT - 1, Number(index) | 0),
    );
    const p = deepClone(store.profiles[profileIndex]);
    state.profile = profileIndex;
    state.lighting = p.lighting;
    state.actuation = p.actuation;
    state.keyOverrides = p.keyOverrides;
    state.appNotes = p.appNotes;
    state.selectedKey = null;
    persist(true);
    return state;
  };

  return {
    state,
    store,
    setLighting,
    setActuation,
    setColorUi,
    setOverride,
    resetOverride,
    selectProfile,
    persist,
    flush: () => persist(true),
    snapshot,
  };
}
