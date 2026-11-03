const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("CUOut", { onSlide: (fn) => ipcRenderer.on("slide", (_e, s) => fn(s)), onConfidence: (fn) => ipcRenderer.on("confidence", (_e, m) => fn(m)) });
