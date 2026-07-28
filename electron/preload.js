const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("zenShell", {
  getInfo: () => ipcRenderer.invoke("app:getInfo"),
  getActiveApplication: () => ipcRenderer.invoke("app:getActiveApplication"),
  chooseApplications: () => ipcRenderer.invoke("app:chooseApplications"),
  exportProfile: (payload) => ipcRenderer.invoke("app:exportProfile", payload),
  importProfile: (profile) => ipcRenderer.invoke("app:importProfile", profile),
  getSystemContext: (detectors) =>
    ipcRenderer.invoke("app:getSystemContext", detectors),
  configureSystemShortcuts: (mappings) =>
    ipcRenderer.invoke("app:configureSystemShortcuts", mappings),
  setDesktopState: (state) => ipcRenderer.send("app:setDesktopState", state),
  onReconnect: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("app:reconnect", handler);
    return () => ipcRenderer.removeListener("app:reconnect", handler);
  },
  onNavigate: (cb) => {
    const handler = (_event, panel) => cb(panel);
    ipcRenderer.on("app:navigate", handler);
    return () => ipcRenderer.removeListener("app:navigate", handler);
  },
  onSelectProfile: (cb) => {
    const handler = (_event, profile) => cb(profile);
    ipcRenderer.on("app:selectProfile", handler);
    return () => ipcRenderer.removeListener("app:selectProfile", handler);
  },
  onToggleLights: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("app:toggleLights", handler);
    return () => ipcRenderer.removeListener("app:toggleLights", handler);
  },
  onToggleAutomation: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("app:toggleAutomation", handler);
    return () => ipcRenderer.removeListener("app:toggleAutomation", handler);
  },
  onActiveApplication: (cb) => {
    const handler = (_event, activeApp) => cb(activeApp);
    ipcRenderer.on("app:activeApplication", handler);
    return () => ipcRenderer.removeListener("app:activeApplication", handler);
  },
  onWake: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("app:wake", handler);
    return () => ipcRenderer.removeListener("app:wake", handler);
  },
  onSuspend: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("app:suspend", handler);
    return () => ipcRenderer.removeListener("app:suspend", handler);
  },
  onSystemContext: (cb) => {
    const handler = (_event, context) => cb(context);
    ipcRenderer.on("app:systemContext", handler);
    return () => ipcRenderer.removeListener("app:systemContext", handler);
  },
  onSystemActionError: (cb) => {
    const handler = (_event, message) => cb(message);
    ipcRenderer.on("app:systemActionError", handler);
    return () => ipcRenderer.removeListener("app:systemActionError", handler);
  },
});
