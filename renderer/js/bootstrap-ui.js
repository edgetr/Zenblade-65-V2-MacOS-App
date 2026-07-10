import { deepClone } from "./store.js";
import { pickZenbladeDevice } from "./protocol.js";

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
  writeFeel,
  setConnected,
}) {
  const $ = (id) => document.getElementById(id);
  const setDiscoveryVisible = (visible) => {
    $("deviceDiscovery").hidden = !visible;
  };
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
  };

  $("btnRefresh").addEventListener(
    "click",
    () =>
      gate.run("Refresh", () => refresh({ restoreFeel: true })).catch(() => {}),
  );
  $("btnChooseKeyboard").addEventListener("click", async () => {
    // This click is the user activation WebHID requires on systems that do
    // not permit a first-launch picker during automatic discovery.
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
        toast("Lighting applied — Refresh verifies it.", "ok");
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

  kb.onStatus(({ type, detail }) => {
    if (type === "disconnected") {
      model.flush();
      setConnected(false, null);
    }
    if (type === "error") toast(detail || "Device error", "error");
  });
  addEventListener("beforeunload", () => model.flush());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") model.flush();
  });
  if (navigator.hid) {
    navigator.hid.addEventListener("disconnect", (event) => {
      if (event.device === kb.device) disconnect();
    });
    navigator.hid.addEventListener("connect", (event) => {
      const zenblade = pickZenbladeDevice([event.device]);
      if (!state.connected && zenblade) {
        connect(zenblade).then((result) => setDiscoveryVisible(!result));
      }
    });
  }
  window.zenShell?.onReconnect?.(() =>
    state.connected
      ? gate.run("Reconnect refresh", () => refresh({ restoreFeel: true })).catch(() => {})
      : connect()
  );

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

  setActivePanel(
    document.querySelector(".nav__btn.is-active")?.dataset.panel || "keyboard",
  );

  (async () => {
    if (!navigator.hid) return toast("WebHID unavailable", "error");
    const known = pickZenbladeDevice(await navigator.hid.getDevices());
    if (known) {
      const result = await connect(known);
      setDiscoveryVisible(!result);
    }
    // On first launch there is no approved device for getDevices() to return.
    // Electron/WebHID may allow this filtered request; if it requires a user
    // gesture, connect() deliberately fails quietly and the Device menu can
    // retry it later.
    else {
      const result = await connect(undefined, { quiet: true });
      setDiscoveryVisible(!result);
    }
  })().catch(() => {});
}
