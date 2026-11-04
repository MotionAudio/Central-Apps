/* Central Production - what the page gets from the app: files on disk, the website's address, the sound libraries,
 * the computer's sounds and the low-delay player (the same as Central Usage's Studio), updates. */
const { contextBridge, ipcRenderer } = require("electron");
const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld("CPDesktop", {
  server: () => ipcRenderer.sendSync("cp-server"), setServer: inv("cp-set-server"), version: () => ipcRenderer.sendSync("cp-version"),
  put: inv("cp-put"), get: inv("cp-get"), openExternal: inv("cp-open-external"),
  recent: inv("cp-recent"), saveProject: inv("cp-save-project"), openRecent: inv("cp-open-recent"), forgetRecent: inv("cp-forget-recent"),
  saveAs: inv("cp-save-as"), openFile: inv("cp-open-file"), exportFiles: inv("cp-export"), pendingFile: inv("cp-pending-file"),
  onOpenFile: (fn) => ipcRenderer.on("cp-open-file", (_e, f) => fn(f)),
  installPersonal: inv("cp-install-personal"), saveSong: inv("cp-save-song"), loops: inv("cp-loops"), readLoop: inv("cp-read-loop"),
  updates: { status: inv("update-status"), config: inv("update-config"), check: inv("update-check"), install: inv("update-install"), on: (fn) => ipcRenderer.on("update", (_e, st) => fn(st)) }
});
// the same names the shared code uses in Central Usage (js/libraries.js, the DAW's sounds and low-delay player)
contextBridge.exposeInMainWorld("CU", {
  libraries: { list: inv("lib-list"), index: inv("lib-index"), install: inv("lib-install"), installFile: inv("lib-install-file"), remove: inv("lib-remove"), community: inv("lib-community"), centralFx: inv("lib-cmfx"), onProgress: (fn) => ipcRenderer.on("lib-progress", (_e, p) => fn(p)) },
  studio: { catalog: inv("studio-catalog"), read: inv("studio-read"), exportFiles: inv("studio-export"),
    monitor: { start: inv("studio-monitor-start"), send: (m) => ipcRenderer.send("studio-monitor-send", m), stop: inv("studio-monitor-stop"), on: (fn) => ipcRenderer.on("studio-monitor", (_e, m) => fn(m)) },
    native: { stream: { chain: inv("studio-daw-chain"), process: inv("studio-daw-process"), param: (i, k, id, v) => ipcRenderer.send("studio-daw-param", i, k, id, v), drop: (i) => ipcRenderer.send("studio-daw-drop", i), params: inv("studio-daw-params") },
      plugins: inv("studio-native-plugins"), process: inv("studio-native-process"), monitor: (m) => ipcRenderer.send("studio-native-monitor", m), keys: inv("studio-native-keys"), midi: (d) => ipcRenderer.send("studio-native-midi", d), set: (slot, id, v) => ipcRenderer.send("studio-native-set", slot, id, v), editor: inv("studio-native-editor"), on: (fn) => ipcRenderer.on("studio-native", (_e, m) => fn(m)) } }
});
