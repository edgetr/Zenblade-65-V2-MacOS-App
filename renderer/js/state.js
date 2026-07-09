import {
  deepClone,
  defaultActuation,
  defaultLighting,
  loadStore,
  saveStore,
} from "./store.js";
import { normalizeLighting, PROFILE_COUNT } from "./protocol.js";
export { deepClone } from "./store.js";
export function createModel({ storage, validCodes, debounceMs = 220 } = {}) {
  const store = loadStore(storage, validCodes),
    current = store.profiles[store.activeProfile];
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
  let timer = 0, saved = "";
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
    immediate ? write() : timer = setTimeout(write, debounceMs);
  };
  const setLighting = (partial, { persist: shouldPersist = true } = {}) => {
    state.lighting = normalizeLighting(partial, state.lighting);
    if (shouldPersist) persist();
    return state.lighting;
  };
  const setActuation = (partial, { persist: shouldPersist = true } = {}) => {
    Object.assign(state.actuation, partial);
    if (shouldPersist) persist();
    return state.actuation;
  };
  const setOverride = (code, values, notes) => {
    state.keyOverrides[code] = { press: values.press, release: values.release };
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
    setOverride,
    resetOverride,
    selectProfile,
    persist,
    flush: () => persist(true),
    snapshot,
  };
}
