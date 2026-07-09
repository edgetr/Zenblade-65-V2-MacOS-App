const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("zenShell", {
  getInfo: () => ipcRenderer.invoke("app:getInfo"),
  onReconnect: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("app:reconnect", handler);
    return () => ipcRenderer.removeListener("app:reconnect", handler);
  },
});
