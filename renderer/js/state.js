import {
  deepClone,
  defaultProfile,
  loadStore,
  normalizeActuation,
  normalizeAutomation,
  normalizeKeyOverride,
  normalizeProfileName,
  normalizeStore,
  profileLabel,
  saveStore,
} from "./store.js";
import { normalizeSystemProfile } from "./system-data.js";
import {
  normalizeLighting,
  normalizeSocdConfig,
  PROFILE_COUNT,
} from "./protocol.js";

// Everything stored per profile. The live copy of the active profile is kept
// on `state` under the same names.
const PROFILE_FIELDS = Object.freeze([
  "name",
  "lighting",
  "actuation",
  "keyOverrides",
  "appNotes",
  "system",
  "socd",
]);
const clampProfile = (index) =>
  Math.max(0, Math.min(PROFILE_COUNT - 1, Number(index) | 0));

export function createModel({ storage, validCodes, debounceMs = 220 } = {}) {
  const store = loadStore(storage, validCodes);
  const current = store.profiles[store.activeProfile];
  const state = {
    connected: false,
    profile: store.activeProfile,
    ...deepClone(Object.fromEntries(PROFILE_FIELDS.map((key) => [key, current[key]]))),
    automation: deepClone(store.automation),
    selectedKey: null,
    selectedKeys: [],
    syncIncomplete: null,
    statusOverlay: {},
  };
  let timer = 0;
  let saved = "";

  const loadLive = (profile) => {
    const next = deepClone(profile);
    for (const key of PROFILE_FIELDS) state[key] = next[key];
    state.selectedKey = null;
    state.selectedKeys = [];
  };

  const snapshot = () => {
    store.profiles[state.profile] = deepClone(
      Object.fromEntries(PROFILE_FIELDS.map((key) => [key, state[key]])),
    );
    store.activeProfile = state.profile;
    store.automation = deepClone(state.automation);
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

  const setOverride = (code, values, notes) => {
    const normalized = normalizeActuation(values, state.actuation);
    state.keyOverrides[code] = normalizeKeyOverride({
      ...values,
      press: normalized.press,
      release: normalized.release,
    });
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

  const setAutomation = (partial) => {
    state.automation = normalizeAutomation({
      ...state.automation,
      ...partial,
    });
    persist(true);
    return state.automation;
  };

  const setSystem = (partial) => {
    state.system = normalizeSystemProfile({
      ...state.system,
      ...partial,
      audio: {
        ...state.system.audio,
        ...partial?.audio,
      },
      indicators: {
        ...state.system.indicators,
        ...partial?.indicators,
      },
    });
    persist(true);
    return state.system;
  };

  const replaceProfile = (index, profile) => {
    snapshot();
    const profileIndex = clampProfile(index);
    const normalized = normalizeStore({
      activeProfile: profileIndex,
      profiles: Array.from({ length: PROFILE_COUNT }, (_, i) =>
        i === profileIndex ? profile : store.profiles[i]
      ),
      automation: state.automation,
    }, validCodes);
    store.profiles[profileIndex] = deepClone(normalized.profiles[profileIndex]);
    if (profileIndex === state.profile) loadLive(store.profiles[profileIndex]);
    persist(true);
    return deepClone(store.profiles[profileIndex]);
  };

  const profileAt = (index) => {
    snapshot();
    return deepClone(store.profiles[clampProfile(index)]);
  };

  const renameProfile = (index, name) => {
    const profileIndex = clampProfile(index);
    const normalized = normalizeProfileName(name);
    if (profileIndex === state.profile) state.name = normalized;
    else store.profiles[profileIndex].name = normalized;
    persist(true);
    return normalized;
  };

  // Copies settings into another profile slot, keeping that slot's name.
  const duplicateProfile = (from, to) => {
    const source = profileAt(from);
    const targetIndex = clampProfile(to);
    return replaceProfile(targetIndex, {
      ...source,
      name: store.profiles[targetIndex].name,
    });
  };

  const resetProfile = (index) => {
    const profileIndex = clampProfile(index);
    return replaceProfile(profileIndex, {
      ...defaultProfile(),
      name: profileAt(profileIndex).name,
    });
  };

  const setSocd = (config) => {
    state.socd = config ? normalizeSocdConfig(config) : null;
    persist(true);
  };

  const labelFor = (index) => {
    const profileIndex = clampProfile(index);
    const name = profileIndex === state.profile
      ? state.name
      : store.profiles[profileIndex].name;
    return profileLabel({ name }, profileIndex);
  };

  const exportProfile = (index = state.profile) => {
    snapshot();
    const profileIndex = clampProfile(index);
    return {
      format: "zenblade-profile",
      version: 1,
      profile: deepClone(store.profiles[profileIndex]),
    };
  };

  const selectProfile = (index) => {
    snapshot();
    const profileIndex = clampProfile(index);
    state.profile = profileIndex;
    loadLive(store.profiles[profileIndex]);
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
    setAutomation,
    setSystem,
    replaceProfile,
    renameProfile,
    duplicateProfile,
    resetProfile,
    setSocd,
    profileAt,
    labelFor,
    exportProfile,
    selectProfile,
    persist,
    flush: () => persist(true),
    snapshot,
  };
}
