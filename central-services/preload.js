/* Central Services - what the page gets from the computer app: that it is the app, and this app's updates. */
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("CSDesktop", {
  updates: { status: () => ipcRenderer.invoke("update-status"), config: (cfg) => ipcRenderer.invoke("update-config", cfg), check: () => ipcRenderer.invoke("update-check"), install: () => ipcRenderer.invoke("update-install"), on: (fn) => ipcRenderer.on("update", (_e, st) => fn(st)) }
});
