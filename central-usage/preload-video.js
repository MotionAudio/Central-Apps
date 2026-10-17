/* Central Control - the Video tab's bridge to the main process (video-service.js). Called from preload.js:
 *   require("./preload-video")();                                                                       */
"use strict";
const { contextBridge, ipcRenderer } = require("electron");
module.exports = function exposeVideo() {
  contextBridge.exposeInMainWorld("CUVideo", {
    init: () => ipcRenderer.invoke("video-init"),
    config: (patch) => ipcRenderer.invoke("video-config", patch),
    want: (map) => ipcRenderer.invoke("video-want", map),
    screens: () => ipcRenderer.invoke("video-screens"),
    encoders: () => ipcRenderer.invoke("video-encoders"),
    ndiFind: () => ipcRenderer.invoke("video-ndi-find"),
    ndiExtraIps: (ips) => ipcRenderer.invoke("video-ndi-extra", ips),
    audio: (cmd) => ipcRenderer.invoke("video-audio", cmd),
    dest: (id, on) => ipcRenderer.invoke("video-dest", id, on),
    streamAll: (on) => ipcRenderer.invoke("video-stream-all", on),
    record: (on) => ipcRenderer.invoke("video-record", on),
    ndiOut: (which, on) => ipcRenderer.invoke("video-ndi-out", which, on),
    status: () => ipcRenderer.invoke("video-status"),
    slides: (on) => ipcRenderer.invoke("video-slides", on),
    phones: (on) => ipcRenderer.invoke("video-phones", on),
    openRecordings: () => ipcRenderer.invoke("video-open-recordings"),
    stats: () => ipcRenderer.invoke("video-stats"),
    tally: (map) => ipcRenderer.send("video-tally", map),
    on: (fn) => ipcRenderer.on("video-event", (_e, ev) => fn(ev))
  });
};
