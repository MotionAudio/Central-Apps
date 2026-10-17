/* Central Pedal desktop - what the page gets from the app: updates of this PC app, and the speech model
 * that hears lyrics in a vocal track (asr.js; a PC only - the Raspberry Pi has none). */
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("CCDesktop", {
  updates: { status: () => ipcRenderer.invoke("update-status"), config: (cfg) => ipcRenderer.invoke("update-config", cfg), check: () => ipcRenderer.invoke("update-check"), install: () => ipcRenderer.invoke("update-install"), on: (fn) => ipcRenderer.on("update", (_e, st) => fn(st)) },
  asr: { status: () => ipcRenderer.invoke("asr-status"), config: (patch) => ipcRenderer.invoke("asr-config", patch), download: () => ipcRenderer.invoke("asr-download"), remove: () => ipcRenderer.invoke("asr-remove"), run: (job) => ipcRenderer.invoke("asr-run", job), on: (fn) => ipcRenderer.on("asr-event", (_e, m) => fn(m)) }
});
