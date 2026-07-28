import { profileApplyComplete } from "./device-ops.js";

export function resolveAutomationProfile(automation, activeApplication) {
  if (!automation?.enabled || !activeApplication?.bundleId) return null;
  const rule = automation.rules.find(
    (value) => value.bundleId === activeApplication.bundleId,
  );
  if (rule) return rule.profile;
  return automation.restoreDefault ? automation.defaultProfile : null;
}

export async function runRecoverySequence({
  attempt,
  delays = [0, 1000, 2500, 5000, 8500],
  wait = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  isCurrent = () => true,
}) {
  for (let index = 0; index < delays.length; index++) {
    const delay = delays[index];
    if (delay > 0) await wait(delay);
    if (!isCurrent()) return false;
    try {
      if (await attempt()) return true;
    } catch {
      // A later attempt may succeed after the HID stack settles.
    }
    if (!isCurrent()) return false;
  }
  return false;
}

export function createDesktopController({
  kb,
  model,
  state,
  gate,
  lighting,
  profileController,
  sync,
  toast,
  recoverConnection,
  cancelRecovery,
}) {
  let activeApplication = null;
  let pendingProfile = null;
  let pendingAttempt = 0;
  let retryTimer = 0;
  let recoveryGeneration = 0;
  let lastReport = "";

  const report = () => {
    const snapshot = {
      connected: state.connected,
      profile: state.profile,
      lightingOn: state.lighting.isOn,
      automationEnabled: state.automation.enabled,
    };
    const stamp = JSON.stringify(snapshot);
    if (stamp === lastReport) return;
    lastReport = stamp;
    window.zenShell?.setDesktopState?.(snapshot);
  };

  const drainProfileRequest = async () => {
    clearTimeout(retryTimer);
    if (pendingProfile == null) return;
    if (gate.running) {
      retryTimer = setTimeout(drainProfileRequest, 300);
      return;
    }
    const target = pendingProfile;
    pendingProfile = null;
    let completed = true;
    try {
      if (target === state.profile) {
        if (!state.syncIncomplete || !kb.connected) return report();
        const result = await profileController.applyCurrent({
          quiet: true,
          silent: true,
        });
        completed = result.localOnly || profileApplyComplete(result);
      } else {
        const result = await profileController.select(target, { quiet: true });
        completed = result?.ok !== false;
      }
    } catch (error) {
      // Busy-gate rejections are expected under load; suppress their toast by
      // re-queuing without surfacing a second user-facing failure.
      const busy = /waiting for the current device operation/i.test(
        error?.message || "",
      );
      if (busy) {
        if (pendingProfile == null) pendingProfile = target;
        retryTimer = setTimeout(drainProfileRequest, 300);
        return;
      }
      completed = false;
    }
    const stillDesired =
      resolveAutomationProfile(state.automation, activeApplication) === target;
    if (!completed && pendingProfile == null && stillDesired && pendingAttempt < 3) {
      const retryDelays = [900, 1800, 3600];
      pendingProfile = target;
      retryTimer = setTimeout(
        drainProfileRequest,
        retryDelays[pendingAttempt++],
      );
      return;
    }
    pendingAttempt = 0;
    report();
    if (pendingProfile != null) drainProfileRequest();
  };

  const applyActiveApplication = (next) => {
    if (!next?.bundleId) return;
    activeApplication = next;
    const target = resolveAutomationProfile(state.automation, next);
    if (target == null) {
      pendingProfile = null;
      pendingAttempt = 0;
      clearTimeout(retryTimer);
      return;
    }
    pendingAttempt = 0;
    pendingProfile = target;
    drainProfileRequest();
  };

  const automationChanged = () => {
    report();
    if (state.automation.enabled && activeApplication) {
      applyActiveApplication(activeApplication);
    } else if (state.automation.enabled) {
      window.zenShell?.getActiveApplication?.()
        .then(applyActiveApplication)
        .catch(() => {});
    } else {
      pendingProfile = null;
      pendingAttempt = 0;
      clearTimeout(retryTimer);
    }
  };

  const toggleLights = async () => {
    model.setLighting({ isOn: !state.lighting.isOn });
    lighting.sync();
    sync();
    report();
    if (!kb.connected) {
      toast(`Lights ${state.lighting.isOn ? "enabled" : "disabled"} locally`, "ok");
      return;
    }
    try {
      await gate.run("Lighting toggle", () => kb.writeLighting(state.lighting));
      lighting.markApplied();
      toast(`Lights ${state.lighting.isOn ? "on" : "off"}`, "ok");
    } catch {
      // The operation gate or device layer already provides actionable state.
    }
  };

  const recover = () => {
    const generation = ++recoveryGeneration;
    recoverConnection({ quiet: true }).then((recovered) => {
      if (generation !== recoveryGeneration) return;
      // Bump generation so a later suspend/wake owns the next sequence.
      recoveryGeneration++;
      report();
      if (recovered) return;
      // Stay quiet when already connected (partial restore uses other UI).
      // Offline after wake: discovery banner is enough; avoid noisy toasts.
    });
  };

  window.zenShell?.onSelectProfile?.((profile) => {
    profileController.select(profile).catch(() => {});
  });
  window.zenShell?.onToggleLights?.(() => toggleLights());
  window.zenShell?.onToggleAutomation?.(() => {
    const shouldEnable = !state.automation.enabled;
    model.setAutomation({ enabled: shouldEnable });
    sync();
    automationChanged();
    if (shouldEnable && !state.automation.enabled) {
      toast("Add an app rule or fallback first.", "error");
      return;
    }
    toast(
      `Automatic switching ${state.automation.enabled ? "enabled" : "paused"}`,
      "ok",
    );
  });
  window.zenShell?.onActiveApplication?.(applyActiveApplication);
  window.zenShell?.onWake?.(recover);
  window.zenShell?.onSuspend?.(() => {
    recoveryGeneration++;
    cancelRecovery?.();
    model.flush();
  });
  if (state.automation.enabled) {
    window.zenShell?.getActiveApplication?.()
      .then(applyActiveApplication)
      .catch(() => {});
  }

  report();
  return {
    applyActiveApplication,
    automationChanged,
    connectionChanged: () => {
      report();
      if (state.connected && state.automation.enabled && activeApplication) {
        applyActiveApplication(activeApplication);
      }
    },
    report,
  };
}
