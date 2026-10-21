const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("CU", {
  discover: () => ipcRenderer.invoke("discover"),
  version: () => ipcRenderer.invoke("version"),
  health: () => ipcRenderer.invoke("sys-health"),
  onMenu: (fn) => ipcRenderer.on("menu", (_e, name, arg) => fn(name, arg)),
  platform: process.platform,
  edition: (process.argv.find((a) => a.startsWith("--cu-edition=")) || "--cu-edition=control").split("=")[1],   // "control" (admins) or "usage" (musicians)
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
  player: { open: () => ipcRenderer.invoke("player-open"), status: () => ipcRenderer.invoke("player-status"), stop: () => ipcRenderer.invoke("player-stop"), on: (fn) => ipcRenderer.on("player-status", (_e, st) => fn(st)) },
  center: { status: () => ipcRenderer.invoke("center-status"), heard: () => ipcRenderer.invoke("center-heard"), probe: (host, port) => ipcRenderer.invoke("center-probe", host, port), on: (fn) => ipcRenderer.on("center-status", (_e, st) => fn(st)) },
  config: { get: () => ipcRenderer.invoke("cu-config"), set: (patch) => ipcRenderer.invoke("cu-config-set", patch) },
  // the hub and the second main admin's computer kept in sync with it (hubsync.js)
  standby: { status: () => ipcRenderer.invoke("standby-status"), sync: () => ipcRenderer.invoke("standby-sync"), set: (m) => ipcRenderer.invoke("standby-set", m),
    takeover: (o) => ipcRenderer.invoke("hub-takeover", o), on: (fn) => ipcRenderer.on("standby-status", (_e, st) => fn(st)),
    onHubChanged: (fn) => ipcRenderer.on("hub-changed", (_e, m) => fn(m)), onRestart: (fn) => ipcRenderer.on("hub-restart", () => fn()) },
  hubState: (store) => ipcRenderer.send("hub-state", store),
  hubImport: () => ipcRenderer.sendSync("hub-state-import"),
  host: { status: () => ipcRenderer.invoke("host-status"), on: (fn) => ipcRenderer.on("host-status", (_e, st) => fn(st)), piTarget: (t) => ipcRenderer.invoke("pi-target", t) },
  mixer: {
    get: () => ipcRenderer.invoke("mixer-get"), op: (op) => ipcRenderer.invoke("mixer-op", op), replace: (st) => ipcRenderer.invoke("mixer-replace", st),
    listen: (tap, on) => ipcRenderer.invoke("mixer-listen", tap, on), record: (opt) => ipcRenderer.invoke("mixer-record", opt), openRecordings: () => ipcRenderer.invoke("open-recordings"),
    exportFile: () => ipcRenderer.invoke("mixer-export"), importFile: () => ipcRenderer.invoke("mixer-import"),
    onOp: (fn) => ipcRenderer.on("mixer-op", (_e, op, by) => fn(op, by)), onState: (fn) => ipcRenderer.on("mixer-state", (_e, st) => fn(st)), onMeters: (fn) => ipcRenderer.on("mixer-meters", (_e, m) => fn(m)),
    onPi: (fn) => ipcRenderer.on("mixer-pi", (_e, names) => fn(names)), onAudio: (fn) => ipcRenderer.on("listen-audio", (_e, tap, frames, pcm) => fn(tap, frames, pcm))
  },
  // multitrack recording on the audio host (recorder.js): start({ name, program, inputs }) / stop() -> { state } or { error, state };
  // on(fn(state, event)) - events: starting, started, stopping, stopped, error, mp3, repaired, tick
  recorder: { start: (opts) => ipcRenderer.invoke("rec-start", opts), stop: () => ipcRenderer.invoke("rec-stop"), state: () => ipcRenderer.invoke("rec-state"),
    on: (fn) => ipcRenderer.on("rec-event", (_e, st, ev) => fn(st, ev)), chooseDir: () => ipcRenderer.invoke("rec-choose-dir"), open: (which) => ipcRenderer.invoke("rec-open", which) },
  // talkback (talk.js) when this computer is the audio host: start({ kind, targets, dim, src, ch }), the mic's "TKA1" frames, stop()
  talk: { start: (o) => ipcRenderer.invoke("talk-start", o), stop: () => ipcRenderer.invoke("talk-stop"), audio: (frame) => ipcRenderer.send("talk-audio", frame), state: () => ipcRenderer.invoke("talk-state"),
    on: (fn) => ipcRenderer.on("talk-event", (_e, ev) => fn(ev)), onDesk: (fn) => ipcRenderer.on("talk-desk-audio", (_e, frames, rate, pcm, name) => fn(pcm, frames, rate, name)) },
  slides: { open: () => ipcRenderer.invoke("slides-open"), readFile: (f) => ipcRenderer.invoke("read-file", f), show: (slide) => ipcRenderer.send("slide", slide), screens: () => ipcRenderer.invoke("screens"),
    outputScreen: (opt) => ipcRenderer.invoke("output-screen", opt), outputNdi: (opt) => ipcRenderer.invoke("output-ndi", opt), outputs: () => ipcRenderer.invoke("outputs-status"), onOutputs: (fn) => ipcRenderer.on("outputs", (_e, st) => fn(st)) },
  inst: { start: () => ipcRenderer.invoke("inst-start"), send: (m) => ipcRenderer.send("inst-send", m), stop: () => ipcRenderer.invoke("inst-stop"), on: (fn) => ipcRenderer.on("inst-msg", (_e, m) => fn(m)) },
  ai: { status: () => ipcRenderer.invoke("ai-status"), download: () => ipcRenderer.invoke("ai-download"), remove: () => ipcRenderer.invoke("ai-remove"), ask: (system, user) => ipcRenderer.invoke("ai-ask", system, user), on: (fn) => ipcRenderer.on("ai-status", (_e, st) => fn(st)) },
  asr: { status: () => ipcRenderer.invoke("asr-status"), config: (patch) => ipcRenderer.invoke("asr-config", patch), download: () => ipcRenderer.invoke("asr-download"), remove: () => ipcRenderer.invoke("asr-remove"), run: (job) => ipcRenderer.invoke("asr-run", job), on: (fn) => ipcRenderer.on("asr-event", (_e, m) => fn(m)) },
  saveFile: (name, text) => ipcRenderer.invoke("save-file", name, text),
  openFile: () => ipcRenderer.invoke("open-file")
});
require("./preload-video")();   // window.CUVideo for the Video tab
