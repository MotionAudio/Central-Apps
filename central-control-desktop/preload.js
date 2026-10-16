/* Central Control desktop - the only thing the page gets from the app: updates of this PC app. */
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("CCDesktop", {
  updates: { status: () => ipcRenderer.invoke("update-status"), config: (cfg) => ipcRenderer.invoke("update-config", cfg), check: () => ipcRenderer.invoke("update-check"), install: () => ipcRenderer.invoke("update-install"), on: (fn) => ipcRenderer.on("update", (_e, st) => fn(st)) }
});
