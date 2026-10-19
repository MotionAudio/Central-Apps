/* Central Pedal Control - what the page gets from the Mac app: this app's updates, and that it is the editor. */
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("CCDesktop", {
  pedalControl: true,
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
  updates: { status: () => ipcRenderer.invoke("update-status"), config: (cfg) => ipcRenderer.invoke("update-config", cfg), check: () => ipcRenderer.invoke("update-check"), install: () => ipcRenderer.invoke("update-install"), on: (fn) => ipcRenderer.on("update", (_e, st) => fn(st)) }
});
