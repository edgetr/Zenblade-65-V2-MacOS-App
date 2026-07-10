import { PROFILE_COUNT } from "./protocol.js";
import { applyProfile } from "./device-ops.js";

export function createProfileController({
  kb,
  model,
  state,
  gate,
  writeFeel,
  sync,
  toast,
  onLightingRead,
  onLightingApplied,
  onSyncChange,
}) {
  const setSyncIncomplete = (value) => {
    state.syncIncomplete = value;
    onSyncChange?.();
  };

  async function select(index) {
    await gate.run("Profile switch", async () => {
      const previous = state.profile;
      model.selectProfile(index);
      sync();
      if (!kb.connected) return toast(`Profile ${index + 1} selected`, "ok");
      const result = await applyProfile(kb, state, writeFeel);
      if (result.lightingOk) onLightingApplied?.(state.lighting);
      if (result.deviceProfileOk && result.lightingOk && result.feelOk) {
        setSyncIncomplete(null);
        return toast(`Profile ${index + 1} applied`, "ok");
      }
      if (!result.deviceProfileOk) {
        model.selectProfile(previous);
        sync();
        return toast(
          `Profile ${index + 1} could not be selected on the keyboard.`,
          "error",
        );
      }
      setSyncIncomplete({ profile: index, result });
      toast(
        `Profile ${index + 1} is partially applied. Re-apply it to recover.`,
        "error",
      );
    });
  }

  async function retry() {
    if (!state.syncIncomplete) return;
    const result = await gate.run("Profile recovery", () =>
      applyProfile(kb, state, writeFeel)
    );
    if (result.lightingOk) onLightingApplied?.(state.lighting);
    if (result.deviceProfileOk && result.lightingOk && result.feelOk) {
      setSyncIncomplete(null);
      toast("Profile fully re-applied", "ok");
    } else {
      toast("Still incomplete — reconnect and try again.", "error");
    }
  }

  async function refresh({ restoreFeel = false, quiet = false } = {}) {
    if (!kb.connected) throw new Error("Connect a Zenblade first");
    const result = {
      profileOk: false,
      lightingOk: false,
      feelOk: !restoreFeel,
    };
    try {
      const profile = Math.max(
        0,
        Math.min(PROFILE_COUNT - 1, await kb.readProfile()),
      );
      if (profile !== state.profile) model.selectProfile(profile);
      result.profileOk = true;
    } catch (error) {
      result.profileError = error;
    }
    try {
      const lighting = await kb.readLighting();
      if (result.profileOk) {
        model.setLighting(lighting, { persist: false });
        model.persist(true);
        onLightingRead?.(lighting);
      }
      result.lightingOk = true;
    } catch (error) {
      result.lightingError = error;
    }
    if (restoreFeel && result.profileOk) {
      try {
        await writeFeel();
        result.feelOk = true;
      } catch (error) {
        result.feelError = error;
      }
    }
    sync();
    if (result.profileOk && result.lightingOk && result.feelOk) {
      setSyncIncomplete(null);
      // quiet suppresses automatic startup success; user Refresh still toasts.
      if (!quiet) toast("Synced", "ok");
    } else if (!result.profileOk) {
      setSyncIncomplete(null);
      toast(
        "Profile could not be verified. Reconnect, then Refresh before applying changes.",
        "error",
      );
    } else {
      setSyncIncomplete({ profile: state.profile, result });
      toast("Sync incomplete — use Re-apply profile to recover.", "error");
    }
    return result;
  }

  return { select, refresh, retry };
}
