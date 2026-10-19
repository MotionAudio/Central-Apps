#!/usr/bin/env node
/* Central Control - the audio host gets two pedals at once: the track player (each track, click, pads, the tracks mix,
 * its instrument) and an instrument rig pedal (its instrument and pads) - each on its own channels, the second one's
 * named after the pedal. A stand-in pedal answers like the Central Pedal (subscribe, stream list, CCA1 packets).
 *   node test-piaudio.mjs */
import { createRequire } from "node:module"; import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { WebSocketServer } = require("ws");
const { PiAudio } = require("./piaudio.js");
const { Engine } = require("./engine.js");
let fails = 0; const ok = (c, msg) => { console.log((c ? "ok   " : "FAIL ") + msg); if (!c) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cu-piaudio-"));
const engine = new Engine({ dir, bin: "/nonexistent" });
const got = []; engine.proc = { stdin: { write() { } } }; engine.write = () => { }; engine.netAudio = (s, ch, fr) => got.push([s, ch, fr]); engine.cmd = () => { }; engine.pushNet = () => { };

function pedal(host, sources) {
  const wss = new WebSocketServer({ host, port: 8081 });
  wss.on("connection", (ws) => ws.on("message", (raw) => {
    const m = JSON.parse(String(raw));
    if (m.type === "audioSubscribe") {
      ws.send(JSON.stringify({ type: "audioSubscribed", ok: m.code === "4321", sources, error: m.code === "4321" ? null : "wrong code" }));
      for (const s of Object.keys(sources)) { const ch = sources[s].channels.length, b = Buffer.alloc(20 + 64 * ch * 2); b.write("CCA1", 0, "latin1"); b[4] = Number(s); b[5] = ch; b.writeUInt16LE(64, 6); b.writeUInt32LE(1, 8); ws.send(b); }
    }
  }));
  return wss;
}
const player = pedal("127.0.0.1", { 0: { channels: ["Drums", "Bass", "Click", "Pads", "Tracks mix"], rate: 48000 }, 1: { channels: ["Instrument"], rate: 48000 } });
let rig = null; try { rig = pedal("127.0.0.2", { 0: { channels: ["Pads"], rate: 48000 }, 1: { channels: ["Instrument"], rate: 48000 } }); await wait(100); } catch (_) { rig = null; }

const a = new PiAudio(engine, 0), b = new PiAudio(engine, 2);
a.configure({ enabled: true, address: "127.0.0.1", code: "4321", name: "Sound desk" });
if (rig) b.configure({ enabled: true, address: "127.0.0.2", code: "4321", name: "Sound desk", prefix: "Keys rig" });
await wait(800);
const names = engine.pi.names.map((n) => n.name);
ok(a.status().state === "receiving", "the track player streams: " + names.filter((n) => !/^Keys rig/.test(n)).join(", "));
ok(["Drums", "Bass", "Click", "Pads", "Tracks mix", "Instrument"].every((n) => names.includes(n)), "every track, the click, pads, the mix and its instrument each get a channel");
if (rig) {
  ok(b.status().state === "receiving" && names.includes("Keys rig Instrument") && names.includes("Keys rig Pads"), "the instrument rig pedal's channels come in too, named after it (" + names.filter((n) => /Keys rig/.test(n)).join(", ") + ")");
  ok(got.some((g) => g[0] === 2) && got.some((g) => g[0] === 3) && got.some((g) => g[0] === 0) && got.some((g) => g[0] === 1), "its packets go to engine slots 3-4, the track player's to 1-2: " + JSON.stringify([...new Set(got.map((g) => g[0]))]));
  b.configure({ enabled: false }); b.close(); await wait(50);
  ok(!engine.pi.names.some((n) => /Keys rig/.test(n.name)) && engine.pi.names.some((n) => n.name === "Drums"), "when the rig goes away only its channels go; the track player's stay");
} else console.log("skip (no 127.0.0.2 loopback here) - the rig pedal checks");
const inputs = engine.state.inputs.filter((x) => x.src.kind === "pi").map((x) => x.name);
ok(inputs.includes("Drums") && inputs.includes("Click"), "the mixer gets an input for each channel by name (Drums keeps its fader next song)");
a.close(); player.close(); if (rig) rig.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(fails ? fails + " FAILED" : "all pedal-audio tests passed"); process.exit(fails ? 1 : 0);
