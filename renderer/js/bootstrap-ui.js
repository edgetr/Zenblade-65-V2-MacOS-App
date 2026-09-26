import { deepClone } from "./store.js";
import { pickZenbladeDevice } from "./protocol.js";
import { runRecoverySequence } from "./desktop-controller.js";
import { profileApplyComplete } from "./device-ops.js";
import { $ } from "./dom.js";

export function installBootstrapUi({
  kb,
  model,
  state,
  board,
  lighting,
  gate,
  toast,
  refresh,
  connect,
  disconnect,
  setConnected,
  syncChrome,
  writeFeel,
  applyCurrent,
}) {
  const setDiscoveryVisible = (visible) => {
    $("deviceDiscovery").hidden = !visible;
  };
  document.querySelectorAll("details").forEach((section) => {
    section.addEventListener("toggle", () => {
      if (section.open) board.scheduleScale();
    });
  });
  const setActivePanel = (panel) => {
    document.querySelectorAll(".nav__btn").forEach((item) => {
      const active = item.dataset.panel === panel;
      item.classList.toggle("is-active", active);
      if (active) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
    document.querySelectorAll(".panel").forEach((item) => {
      const active = item.id === `panel-${panel}`;
      item.classList.toggle("is-active", active);
      item.hidden = !active;
      item.toggleAttribute("inert", !active);
      item.setAttribute("aria-hidden", String(!active));
    });
    document.querySelector(".main__scroll")?.scrollTo({ top: 0 });
    document.title = `${panel[0].toUpperCase()}${panel.slice(1)} — Zenblade`;
  };

  $("btnRefresh").addEventListener(
    "click",
    () =>
      gate.run("Refresh", () => refresh({ restoreFeel: true })).catch(() => {}),
  );
  $("btnChooseKeyboard").addEventListener("click", async () => {
    setDiscoveryVisible(false);
    const result = await connect();
    if (!result) setDiscoveryVisible(true);
  });
  $("btnApplyLighting").addEventListener(
    "click",
    () =>
      gate.run("Lighting apply", async () => {
        await kb.writeLighting(state.lighting);
        model.flush();
        lighting.markApplied();
        toast("Lighting applied", "ok");
      }).catch(() => {}),
  );
  $("btnApplyActuation").addEventListener(
    "click",
    () =>
      gate.run("Feel apply", async () => {
        await writeFeel();
        model.flush();
        toast("Feel applied", "ok");
      }).catch(() => {}),
  );
  $("nav").addEventListener("click", (event) => {
    const button = event.target.closest(".nav__btn");
    if (!button || button.disabled) return;
    setActivePanel(button.dataset.panel);
    board.scheduleScale();
    board.paint();
    lighting.visibility();
  });
  const navigate = (panel, { focus = true } = {}) => {
    if (![
      "keyboard",
      "lighting",
      "actuation",
      "profiles",
      "advanced",
      "system",
    ].includes(panel)) return;
    setActivePanel(panel);
    if (focus) document.querySelector(`[data-panel="${panel}"]`)?.focus();
    board.scheduleScale();
    board.paint();
    lighting.visibility();
  };
  window.zenShell?.onNavigate?.((panel) => navigate(panel));
  document.addEventListener("keydown", (event) => {
    const command = event.metaKey || event.ctrlKey;
    if (command && !event.altKey && !event.shiftKey && /^[1-6]$/.test(event.key)) {
      event.preventDefault();
      const panel = [
        "keyboard",
        "lighting",
        "actuation",
        "profiles",
        "advanced",
        "system",
      ][
        Number(event.key) - 1
      ];
      // macOS routes Command-number through the native View menu. Keeping the
      // renderer fallback makes Control-number work on other platforms.
      if (!event.metaKey) navigate(panel);
      return;
    }
    if (command && event.key === "Enter") {
      const activePanel = document.querySelector(".panel.is-active")?.id;
      const apply = activePanel === "panel-lighting"
        ? $("btnApplyLighting")
        : activePanel === "panel-actuation"
        ? $("btnApplyActuation")
        : activePanel === "panel-keyboard" && state.selectedKey
        ? $("btnApplyKey")
        : null;
      if (apply && !apply.disabled) {
        event.preventDefault();
        apply.click();
      }
    }
  });

  kb.onStatus(({ type, detail }) => {
    if (type === "disconnected") {
      model.flush();
      setConnected(false, null);
      setDiscoveryVisible(true);
    }
    if (type === "error") toast(detail || "Device error", "error");
  });
  addEventListener("beforeunload", () => model.flush());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") model.flush();
  });
  if (navigator.hid) {
    navigator.hid.addEventListener("disconnect", (event) => {
      if (event.device === kb.device) {
        disconnect().finally(() => setDiscoveryVisible(true));
      }
    });
    navigator.hid.addEventListener("connect", (event) => {
      const zenblade = pickZenbladeDevice([event.device]);
      if (!state.connected && zenblade) {
        recoverWithRetry({ device: zenblade }).catch(() => {});
      }
    });
  }
  let recoveryPromise = null;
  const profileApplied = profileApplyComplete;
  const recoverConnection = ({ quiet = false, device = null } = {}) => {
    if (recoveryPromise) return recoveryPromise;
    recoveryPromise = (async () => {
      if (!navigator.hid) return false;
      // Wait briefly if another device operation is finishing so wake/HID
      // reconnect does not lose the only recovery attempt to a busy gate.
      for (let spin = 0; gate.running && spin < 20; spin++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (gate.running) return false;
      if (kb.connected) {
        try {
          const result = await applyCurrent({ quiet: true, silent: true });
          if (!profileApplied(result)) throw new Error("Profile restore failed");
          setDiscoveryVisible(false);
          if (!quiet) toast("Reconnected and restored", "ok");
          return true;
        } catch {
          try {
            await kb.disconnect();
          } catch {
            // Device may already be gone after sleep.
          }
          setConnected(false, null);
        }
      }
      let known = null;
      try {
        known = pickZenbladeDevice(
          device ? [device] : await navigator.hid.getDevices(),
        );
      } catch {
        known = device ? pickZenbladeDevice([device]) : null;
      }
      if (!known) {
        setDiscoveryVisible(true);
        if (!quiet) toast("Keyboard is unavailable", "error");
        return false;
      }
      const result = await connect(known, {
        quiet: true,
        restoreLocal: true,
        silent: true,
      });
      const recovered = profileApplied(result);
      setDiscoveryVisible(!kb.connected);
      if (!quiet) {
        toast(
          recovered
            ? "Reconnected and restored"
            : "Reconnected, but the profile could not be fully restored",
          recovered ? "ok" : "error",
        );
      }
      return recovered;
    })().finally(() => {
      recoveryPromise = null;
    });
    return recoveryPromise;
  };
  let recoveryGeneration = 0;
  const cancelRecovery = () => {
    recoveryGeneration++;
  };
  const recoverWithRetry = ({ device = null } = {}) => {
    const generation = ++recoveryGeneration;
    return runRecoverySequence({
      attempt: () => recoverConnection({ quiet: true, device }),
      isCurrent: () => generation === recoveryGeneration,
    });
  };
  window.zenShell?.onReconnect?.(() => {
    recoverConnection({ quiet: true })
      .then((recovered) =>
        toast(
          recovered
            ? "Reconnected and restored"
            : "Keyboard is unavailable or could not be fully restored",
          recovered ? "ok" : "error",
        )
      )
      .catch((error) => toast(error?.message || String(error), "error"));
  });

  if (new URLSearchParams(location.search).has("test")) {
    window.__zenTest = {
      getState: () => ({
        connected: state.connected,
        profile: state.profile,
        lighting: { ...state.lighting },
        actuation: { ...state.actuation },
        keyOverrides: deepClone(state.keyOverrides),
        store: deepClone(model.store),
        info: kb.info,
      }),
      connect,
      refresh: () => refresh(),
      saveStore: () => model.flush(),
      async roundTripColor(hue = 0, saturation = 100) {
        model.setLighting({
          hue,
          saturation,
          mode: 1,
          isOn: true,
          brightness: 80,
        });
        await kb.writeLighting(state.lighting);
        return kb.readLighting();
      },
    };
  }

  setActivePanel(
    document.querySelector(".nav__btn.is-active")?.dataset.panel || "keyboard",
  );
  syncChrome?.();

  (async () => {
    if (!navigator.hid) return toast("WebHID unavailable", "error");
    const known = pickZenbladeDevice(await navigator.hid.getDevices());
    // Startup auto-connect: keep connection stats accurate, but suppress the
    // Connected/Synced success toasts. User-initiated Choose/Refresh still toast.
    if (known) {
      const result = await connect(known, { quiet: true });
      setDiscoveryVisible(!result);
    } else {
      // Never interrupt startup with a system device chooser. Discovery is a
      // deliberate user action through the visible Choose keyboard button.
      setDiscoveryVisible(true);
    }
  })().catch(() => {});

  return {
    navigate,
    recoverConnection,
    recoverWithRetry,
    cancelRecovery,
  };
}
