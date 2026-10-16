const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("CU", {
  discover: () => ipcRenderer.invoke("discover"),
  version: () => ipcRenderer.invoke("version"),
  onMenu: (fn) => ipcRenderer.on("menu", (_e, name, arg) => fn(name, arg)),
  platform: process.platform,
  // DMX output (USB-DMX Pro, Art-Net, sACN) - the page renders the universes, the main process sends them
  dmx: {
    ports: () => ipcRenderer.invoke("dmx-ports"),
    configure: (cfg) => ipcRenderer.invoke("dmx-configure", cfg),
    status: () => ipcRenderer.invoke("dmx-status"),
    frame: (universes) => ipcRenderer.send("dmx-frame", { universes }),
    blackout: () => ipcRenderer.invoke("dmx-blackout")
  },
  fixtures: { scan: () => ipcRenderer.invoke("fixtures-scan"), read: (file) => ipcRenderer.invoke("fixtures-read", file), open: () => ipcRenderer.invoke("fixtures-open") },
  remote: { config: (cfg) => ipcRenderer.invoke("remote-config", cfg), status: () => ipcRenderer.invoke("remote-status"), state: (st) => ipcRenderer.send("remote-state", st), onCommand: (fn) => ipcRenderer.on("remote-cmd", (_e, cmd) => fn(cmd)) },
  updates: { status: () => ipcRenderer.invoke("update-status"), config: (cfg) => ipcRenderer.invoke("update-config", cfg), check: () => ipcRenderer.invoke("update-check"), install: () => ipcRenderer.invoke("update-install"), on: (fn) => ipcRenderer.on("update", (_e, st) => fn(st)) },
  saveFile: (name, text) => ipcRenderer.invoke("save-file", name, text),
  openFile: () => ipcRenderer.invoke("open-file")
});
