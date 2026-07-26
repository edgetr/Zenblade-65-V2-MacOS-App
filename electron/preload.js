const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("zenShell", {
  getInfo: () => ipcRenderer.invoke("app:getInfo"),
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
});
