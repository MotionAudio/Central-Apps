// Central Usage as the audio host, end to end: the simulated Central Control (driver + app with a song of
// two tracks) sends its audio over the network; Central Usage (the real Electron app, admin, audio host,
// engine on its own clock) receives it, maps the tracks, mixes, records; a phone takes an in-ear mix and
// hears it over Wi-Fi; the lights get the song's waveform and the music's level.
//   npm install && (cd native && make) && xvfb-run -a node test-host.mjs      (CC_ROOT = the Central Control folder)
// Ports: the audio host listens on CU_TEST_HOST_PORT (default 18092); the simulated Central Control uses its
// usual ports (8765/8766/8080/8081). To run beside another copy on the same machine, give the whole run its
// own network:  sudo bash ../tools/netns-run.sh xvfb-run -a node test-host.mjs
import { _electron as electron, chromium } from "playwright";
import { spawn } from "node:child_process"; import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url)), root = process.env.CC_ROOT || path.join(here, "..");
const HOST_PORT = Number(process.env.CU_TEST_HOST_PORT || 18092);
let failures = 0; async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e && e.message || e).split("\n").slice(0, 6).join("\n      ")); } }
const until = async (fn, ms = 10000, step = 150) => { const t0 = Date.now(); let last; while (Date.now() - t0 < ms) { try { last = await fn(); if (last) return last; } catch (_) { } await new Promise((r) => setTimeout(r, step)); } throw new Error("timed out waiting for: " + String(fn).slice(6, 160)); };

// ---- the Central Control
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cu-host-")); fs.mkdirSync(path.join(tmp, "media")); fs.writeFileSync(path.join(tmp, "code-chosen"), "1"); // the pairing PIN counts as picked (its own test is in test-integration)
const drv = spawn("python3", [path.join(root, "pedal-driver.py"), "--simulate", tmp, "--app-root", root], { stdio: ["pipe", "pipe", "pipe"] });
let dlog = ""; drv.stderr.on("data", (b) => { dlog += b; }); drv.stdout.on("data", (b) => { dlog += b; });
await until(() => dlog.includes("USB/SD browser on"), 15000);
const browser = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium", args: ["--autoplay-policy=no-user-gesture-required"] });
const pi = await browser.newPage(); const errs = []; pi.on("pageerror", (e) => errs.push("pi: " + e));
await pi.goto("http://127.0.0.1:8766/app/#tracks"); await pi.waitForFunction(() => window.PPNetSend && window.__pedalBridge && __pedalBridge.connected);
await pi.evaluate(async () => {
  PPTracks.newSong("Host Song"); PPFeatures.loadSong(PP.project().songs.length - 1);
  const rate = 11025, n = rate * 150, mk = (name, f) => { const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf); const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }; w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true); for (let i = 0; i < n; i++) { const t = i / rate, beat = t % 0.5; v.setInt16(44 + i * 2, Math.round(9000 * Math.sin(2 * Math.PI * f * t) * (f < 100 ? Math.exp(-beat * 12) : 1)), true); } return new File([buf], name + ".wav", { type: "audio/wav" }); };
  await PPTracks.importFilesIntoSong(PPTracks.song(), [mk("Kick", 60), mk("Keys", 440)], { analyze: false });
});
const code = await pi.evaluate(() => __pedalBridge.info.code);
await pi.evaluate(() => PPNetSend.configure({ mode: "ethernet" }));
await pi.evaluate(() => { PPTracks.goSection(0, { immediate: true }); PPTracks.play({ countIn: false }); });

// ---- Central Usage: admin, audio host
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "cu-host-ud-"));
fs.writeFileSync(path.join(userData, "cu.json"), JSON.stringify({ mode: "admin", name: "Desk", host: { enabled: true, port: HOST_PORT, userCode: "1111", adminCode: "2222" }, piAudio: { transport: "ethernet", latency: 80 }, recordDir: path.join(userData, "rec") }));
fs.writeFileSync(path.join(userData, "mixer.json"), JSON.stringify({ device: { backend: "internal", buffer: 256 } }));
const exe = [process.env.ELECTRON_PATH, path.join(here, "node_modules", "electron", "dist", "electron")].filter((p) => p && fs.existsSync(p))[0];
const app = await electron.launch({ executablePath: exe, args: [path.join(here, "main.js"), "--no-sandbox", "--user-data-dir=" + userData], env: Object.assign({}, process.env, { CC_UPDATE_API: "http://127.0.0.1:9" }) });
const cu = await app.firstWindow(); cu.on("pageerror", (e) => errs.push("cu: " + e));
await cu.waitForFunction(() => window.CentralUsage && window.CUMix && window.CU && window.CU.host);
await cu.evaluate((c) => { CentralUsage.prefs.code = c; CentralUsage.store.set("code", c); CentralUsage.connect("127.0.0.1"); }, code);

console.log("Audio host:");
await check("Central Usage connects to the Central Control and, as the audio host, registers itself there", async () => {
  await until(() => cu.evaluate(() => CentralUsage.state.connected && CentralUsage.state.authed), 10000);
  const info = await until(async () => { const j = await (await fetch("http://127.0.0.1:8080/api/info")).json(); return j.audioHost && j.audioHost.name === "Desk" ? j : null; }, 10000);
  assert.equal(info.audioHost.port, HOST_PORT);
});
await check("the Central Control's audio arrives over the network: each track on its own channel, mapped to inputs by name", async () => {
  const st = await until(() => cu.evaluate(async () => { const s = await CU.host.status(); return s.pi && s.pi.state === "receiving" && CUMix.pi.length >= 5 ? { pi: s.pi, names: CUMix.pi.map((n) => n.name) } : null; }), 20000);
  assert.ok(st.names.includes("Kick") && st.names.includes("Keys") && st.names.includes("Tracks mix L"), st.names.join(","));
  const inputs = await cu.evaluate(() => CUMix.state.inputs.filter((x) => x.src.kind === "pi").map((x) => x.name + ":" + x.group));
  assert.ok(inputs.includes("Kick:tracks") && inputs.includes("Keys:tracks"), inputs.join(","));
  const listeners = await pi.evaluate(() => PPNetSend.status().listeners.map((l) => l.name)); assert.ok(listeners.length >= 1, "the Pi lists the listener");
});
await check("the engine hears it: the Kick and Keys inputs move their meters", async () => {
  const peaks = await until(() => cu.evaluate(() => { const m = CUMix.meters, s = CUMix.state; if (!m) return null; const k = s.inputs.findIndex((x) => x.name === "Kick"), y = s.inputs.findIndex((x) => x.name === "Keys"); return m.in[k] > 0.05 && m.in[y] > 0.05 ? [m.in[k], m.in[y]] : null; }), 15000);
  assert.ok(peaks[0] > 0.05);
});
await check("Mix tab: a strip per track; a fader move and the EQ go to the engine and stick", async () => {
  await cu.evaluate(() => CentralUsage.showTab("mix")); await cu.waitForSelector(".mx-strip", { timeout: 5000 });
  const n = await cu.evaluate(() => document.querySelectorAll(".mx-strip").length); assert.ok(n >= 3, n + " strips");
  const k = await cu.evaluate(() => CUMix.state.inputs.findIndex((x) => x.name === "Keys"));
  await cu.evaluate((k) => { CUMix.op({ op: "input", i: k, patch: { fader: -12, eq: { on: true, hg: 4 } } }); }, k);
  await until(() => cu.evaluate((k) => CUMix.state.inputs[k].fader === -12 && CUMix.state.inputs[k].eq.on, k), 3000);
  const saved = await until(() => { try { const j = JSON.parse(fs.readFileSync(path.join(userData, "mixer.json"), "utf8")); return j.inputs && j.inputs[k].fader === -12 ? j : null; } catch (_) { return null; } }, 4000);
  assert.ok(saved);
});
await check("tracks out: each track on its own output (direct) is chosen on the Mix tab", async () => {
  await cu.evaluate(() => CUMix.op({ op: "trackOut", value: "direct", first: 2 }));
  await until(() => cu.evaluate(() => CUMix.state.trackOut === "direct" && document.querySelector('[name="mxOut"][value="direct"]').checked), 3000);
  await cu.evaluate(() => CUMix.op({ op: "trackOut", value: "sum", first: 2 }));
});
console.log("In-ears:");
const phone = await browser.newPage(); phone.on("pageerror", (e) => errs.push("phone: " + e));
await check("a phone opens the audio host's page, picks a free mix and gets only the routed channels", async () => {
  await phone.goto("http://127.0.0.1:" + HOST_PORT + "/?name=Sam&code=1111");
  await phone.waitForSelector("[data-ie-claim]", { timeout: 8000 });
  await phone.click('[data-ie-claim="2"]');
  try { await phone.waitForFunction(() => /Mix 3/.test(document.body.textContent) && document.querySelectorAll(".ie-ch").length >= 2, null, { timeout: 5000 }); }
  catch (e) { throw new Error("phone shows: " + (await phone.evaluate(() => document.body.innerText)).slice(0, 400).replace(/\n/g, " | ") + " / host owner: " + await cu.evaluate(() => CUMix.state.mixes[2].owner)); }
  const names = await phone.$$eval(".ie-ch .ie-name", (l) => l.map((e) => e.textContent)); assert.ok(names.includes("Kick") && names.includes("Keys"), names.join(","));
  const owner = await until(() => cu.evaluate(() => CUMix.state.mixes[2].owner), 4000); assert.equal(owner, "Sam");
});
await check("the phone sets its own levels (they reach the audio host) and hears its mix over Wi-Fi (local)", async () => {
  await phone.evaluate(() => { const row = [...document.querySelectorAll(".ie-ch")].find((r) => r.querySelector(".ie-name").textContent === "Kick"), r = row.querySelector("[data-ie-send]"); r.value = "0.75"; r.dispatchEvent(new Event("input", { bubbles: true })); });
  await until(() => cu.evaluate(() => { const s = CUMix.state.mixes[2].sends; return Object.keys(s).length && Object.values(s)[0].level > -1; }), 4000);
  await phone.click('[data-ie="listen"]');
  await phone.waitForFunction(() => /buffer \d+ ms/.test((document.querySelector(".ie-stats") || {}).textContent || ""), null, { timeout: 8000 });
  const mine = await until(() => cu.evaluate(() => CUMix.meters && CUMix.meters.mix[4] > 0.01 ? CUMix.meters.mix[4] : null), 6000); assert.ok(mine > 0.01);
});
await check("a phone can't change someone else's mix or the channels", async () => {
  const ok = await phone.evaluate(() => new Promise((res) => { const ws = new WebSocket("ws://" + location.host + "/ws"); ws.onopen = () => { ws.send(JSON.stringify({ type: "hello", role: "user", code: "1111", id: "other", name: "Other" })); setTimeout(() => { ws.send(JSON.stringify({ type: "op", op: { op: "send", m: 2, i: 0, patch: { level: 6 } } })); ws.send(JSON.stringify({ type: "op", op: { op: "input", i: 0, patch: { fader: 6 } } })); }, 200); }; const got = []; ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === "refused") got.push(m.error); if (got.length === 2) res(got); }; setTimeout(() => res(got), 3000); }));
  assert.equal(ok.length, 2, JSON.stringify(ok));
});
await check("the admin's In-ears tab shows who has which mix", async () => {
  await cu.evaluate(() => CentralUsage.showTab("inears")); await cu.waitForSelector(".ia-mix", { timeout: 5000 });
  const t = await cu.evaluate(() => document.querySelector('.ia-mix[data-ia-mix="2"]').textContent); assert.match(t, /Sam/);
});
await check("64 stereo mixes: the model, the In-ears grid, and Mix 64 mixes and meters", async () => {
  assert.equal(await cu.evaluate(() => CUMix.state.mixes.length), 64);
  assert.equal(await cu.evaluate(() => document.querySelectorAll(".ia-mix").length), 64);
  await cu.evaluate(() => { const k = CUMix.state.inputs.findIndex((x) => x.name === "Kick"); CUMix.op({ op: "claim", m: 63, id: "desk-test", name: "Last" }); CUMix.op({ op: "send", m: 63, i: k, patch: { level: 0 } }); CUMix.op({ op: "mix", m: 63, patch: { local: false, wired: false } }); });
  // nothing listens and it goes nowhere: the engine still mixes it once it is wired somewhere or tapped - tap it from here
  await cu.evaluate(() => CUMix.listen(63, true));
  const v = await until(() => cu.evaluate(() => CUMix.meters && CUMix.meters.mix[126] > 0.01 ? CUMix.meters.mix[126] : null), 6000); assert.ok(v > 0.01);
  await cu.evaluate(() => CUMix.listen(63, false));
});
await check("wired and local per mix: auto-assign gives the first 20 mixes output pairs, the rest stay local", async () => {
  await cu.evaluate(() => CUMix.op({ op: "autoWire", count: 20, first: 4 }));
  const m = await until(() => cu.evaluate(() => { const q = CUMix.state.mixes; return q[19].wired && q[19].outL === 42 ? q.map((x) => [x.wired, x.local, x.outL, x.outR]) : null; }), 3000);
  assert.deepEqual(m[0], [true, true, 4, 5]); assert.deepEqual(m[1], [true, true, 6, 7]); assert.deepEqual(m[20], [false, true, -1, -1]);
  const card = await cu.evaluate(() => document.querySelector('.ia-mix[data-ia-mix="0"]').textContent); assert.match(card, /Out 5\/6/);
});
await check("a mix that is wired only: the phone can't listen to it (and stops), and is told it goes to the pack", async () => {
  await cu.evaluate(() => CUMix.op({ op: "mix", m: 2, patch: { local: false } }));
  await phone.waitForFunction(() => !document.querySelector('[data-ie="listen"]') && /in-ear pack/.test(document.body.textContent), null, { timeout: 5000 });
  const refused = await phone.evaluate(() => new Promise((res) => { const ws = new WebSocket("ws://" + location.host + "/ws"); ws.onopen = () => ws.send(JSON.stringify({ type: "hello", role: "user", code: "1111", id: localStorage.getItem("cu-device-id"), name: "Sam" })); ws.onmessage = (e) => { if (typeof e.data !== "string") return; const m = JSON.parse(e.data); if (m.type === "welcome") ws.send(JSON.stringify({ type: "listen", tap: 2, on: true })); if (m.type === "refused") { res(m.error); ws.close(); } }; setTimeout(() => res(null), 3000); }));
  assert.ok(/wired|pack/.test(refused || ""), "refusal: " + refused);
  await cu.evaluate(() => CUMix.op({ op: "mix", m: 2, patch: { local: true } }));
  await phone.waitForSelector('[data-ie="listen"]', { timeout: 5000 });
});
await check("an older saved mixer (cloud / local mode) becomes wired / local", async () => {
  const r = await cu.evaluate(() => { const s = CUMixer.normalize({ mixes: [{ mode: "cloud", outL: 4, outR: 5 }, { mode: "local" }] }); return [s.mixes.length, s.mixes[0].wired, s.mixes[0].local, s.mixes[0].outL, s.mixes[1].wired, s.mixes[1].local, "mode" in s.mixes[0]]; });
  assert.deepEqual(r, [64, true, false, 4, false, true, false]);
});
await check("recording the service writes a WAV of the main mix", async () => {
  await cu.evaluate(() => CU.mixer.record({ on: true, tap: 0 })); await new Promise((r) => setTimeout(r, 2500));
  const st = await cu.evaluate(() => CU.mixer.record({ on: false }));
  assert.ok(st.saved && fs.existsSync(st.saved), JSON.stringify(st)); assert.ok(fs.statSync(st.saved).size > 48000 * 4, "size " + fs.statSync(st.saved).size);
  assert.equal(fs.readFileSync(st.saved).toString("latin1", 0, 4), "RIFF");
});
console.log("Lights:");
await check("the lights get the song from the hub: waveform, and the music's level from the engine", async () => {
  await cu.evaluate(() => { CentralUsage.showTab("lights"); CULights.showSub("show"); });
  await until(() => cu.evaluate(() => CULights.song.name === "Host Song" && CULights.song.overview.length > 100), 10000);
  const lvl = await until(() => cu.evaluate(() => CUMix.meters && CUMix.meters.bands && CUMix.meters.bands[0] > 0.001 ? CUMix.meters.bands : null), 6000); assert.ok(lvl[0] > 0);
});
await check("tell it the show: words become presets and cues on the timeline", async () => {
  await cu.evaluate(() => { CULights.setMode("semi"); return CULights.chat("back blue 40% and front warm white 70% for the whole song, beams sweep slow"); });
  const r = await cu.evaluate(() => ({ cues: CULights.show().cues.length, out: document.querySelector("#lxChatOut").textContent }));
  assert.ok(r.cues >= 1 && /✓/.test(r.out), JSON.stringify(r));
});
await check("only the Central Control plays the tracks: Central Usage's requests to move them are refused by the Pi", async () => {
  const before = await pi.evaluate(() => PPTracks.state.section);
  await cu.evaluate((c) => CentralUsage.send({ type: "action", name: "nextSection", code: c }), code); await new Promise((r) => setTimeout(r, 600));
  assert.equal(await pi.evaluate(() => PPTracks.state.section), before);
});
console.log("Devices:");
await check("several devices at once (null test devices): 8 + 4 inputs and 16 + 16 outputs join, the I/O tab lists them", async () => {
  await cu.evaluate(() => CUMix.op({ op: "device", patch: { backend: "null", capture: "NULL#8|NULL#4", playback: "NULL#16|NULL#16" } }));
  const st = await until(() => cu.evaluate(async () => { const s = await CU.host.status(); const e = s.engine && s.engine.status; return e && e.backend === "null" && e.inputs === 12 ? e : null; }), 12000);
  assert.equal(st.outputs, 32); assert.equal(st.captureDevices.length, 2); assert.equal(st.captureDevices[1].first, 8);
  await cu.evaluate(() => CentralUsage.showTab("io"));
  const devs = await until(() => cu.evaluate(() => document.querySelectorAll(".io-dev").length >= 4 ? [...document.querySelectorAll(".io-dev")].map((d) => d.textContent) : null), 6000);
  assert.ok(devs.some((t) => /12|1–8/.test(t)) || devs.length >= 4, devs.join(" | "));
  await cu.evaluate(() => CUMix.op({ op: "device", patch: { backend: "internal", capture: "", playback: "" } }));
  await until(() => cu.evaluate(async () => { const s = await CU.host.status(); return s.engine && s.engine.status && s.engine.status.backend === "internal"; }), 12000);
});
await check("no page errors", async () => { assert.deepEqual(errs, []); });

await app.close().catch(() => { }); await browser.close(); drv.kill();
console.log(failures ? "\n" + failures + " CHECK(S) FAILED" : "\nALL HOST CHECKS PASSED");
process.exit(failures ? 1 : 0);
