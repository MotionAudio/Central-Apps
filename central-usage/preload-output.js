const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("CUOut", { onSlide: (fn) => ipcRenderer.on("slide", (_e, s) => fn(s)) });
