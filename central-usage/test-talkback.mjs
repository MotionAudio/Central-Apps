// Talkback and recording, end to end: Central Control (the real Electron app) as the main admin and audio host
// (null test devices: 4 inputs, 4 outputs); another admin computer and a user computer (the app's page in Chromium,
// a fake microphone each); a phone with an in-ear mix.
//   TALK: top bar + In-ears + Mix tabs, a quick tap latches (tap again: off), hold to talk, who hears it (All or
//   chosen mixes, remembered), the dim, ON AIR on the talker's screen, "🎙 <name> talking" on the receiver's phone,
//   the mic from another admin computer over the network, a user's "Talk to the sound desk" reaching only the desk.
//   Recording: Start / Stop on the Mix tab (time, free space), a folder per recording named with the date and the
//   service, a 24-bit WAV per input + the program + its MP3, the I/O tab's card, CU.recorder (start / stop / state /
//   events), an admin elsewhere starting it, and a recording a crash left behind repaired on the next start.
//   npm install && (cd native && make) && xvfb-run -a node test-talkback.mjs
// Ports: the audio host listens on CU_TEST_TALK_PORT (default 18094). Beside another copy: sudo bash ../tools/netns-run.sh xvfb-run -a node test-talkback.mjs
import { _electron as electron, chromium } from "playwright";
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.CU_TEST_TALK_PORT || 18094), ADDR = "127.0.0.1:" + PORT;
let failures = 0; async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e && e.message || e).split("\n").slice(0, 8).join("\n      ")); } }
const until = async (fn, ms = 10000, step = 150) => { const t0 = Date.now(); let last; while (Date.now() - t0 < ms) { try { last = await fn(); if (last) return last; } catch (_) { } await new Promise((r) => setTimeout(r, step)); } throw new Error("timed out waiting for: " + String(fn).slice(6, 200)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FAKE = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"];
const SHOTS = process.env.CU_TEST_SHOTS;   // a folder: screenshots of the screens along the way
const shot = async (p, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, name + ".png") }).catch(() => { }); } };
function wav(file) { const b = fs.readFileSync(file); return { ch: b.readUInt16LE(22), rate: b.readUInt32LE(24), bits: b.readUInt16LE(34), data: b.readUInt32LE(40), size: b.length, riff: b.toString("latin1", 0, 4) }; }

// ---- a recording a crash left behind (its marker still there, the header says 0 bytes)
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "cu-talk-ud-")), recDir = path.join(userData, "Recordings");
const crashed = path.join(recDir, "2026-01-04 09.30 - Crashed"); fs.mkdirSync(crashed, { recursive: true });
{ const h = Buffer.alloc(44); h.write("RIFF", 0, "latin1"); h.write("WAVE", 8, "latin1"); h.write("fmt ", 12, "latin1"); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(48000, 24); h.writeUInt32LE(144000, 28); h.writeUInt16LE(3, 32); h.writeUInt16LE(24, 34); h.write("data", 36, "latin1");
  fs.writeFileSync(path.join(crashed, "In 01.wav"), Buffer.concat([h, Buffer.alloc(48000 * 3, 7)])); fs.writeFileSync(path.join(crashed, ".recording"), "{}"); }

// ---- Central Control: the main admin, the audio host
fs.writeFileSync(path.join(userData, "cu.json"), JSON.stringify({ mode: "admin", role: "main", name: "Desk", host: { enabled: true, port: PORT, userCode: "1111", adminCode: "2222" }, piAudio: { transport: "off" }, recordDir: recDir }));
fs.writeFileSync(path.join(userData, "mixer.json"), JSON.stringify({ device: { backend: "null", capture: "NULL#4", playback: "NULL#4", buffer: 256 } }));
const exe = [process.env.ELECTRON_PATH, path.join(here, "node_modules", "electron", "dist", "electron")].filter((p) => p && fs.existsSync(p))[0];
// (9.5: Central Control needs a key - with no website yet, its default A key)
async function passKey(p, key) {
  await p.waitForFunction(() => window.PPLicense && PPLicense.app && PPLicense.app(), null, { timeout: 15000 }).catch(() => { });
  if (!(await p.evaluate(() => !!document.getElementById("licWiz")))) return;
  await p.evaluate((k) => { localStorage.setItem("cc-license", JSON.stringify({ key: k, kind: k[0], app: k[0] === "U" ? "usage" : "control", okAt: Date.now(), production: "Test church", isDefault: true })); }, key);
  await p.reload(); await p.waitForFunction(() => window.PPLicense && PPLicense.app && PPLicense.app(), null, { timeout: 15000 });
}
const app = await electron.launch({ executablePath: exe, args: [path.join(here, "main.js"), "--no-sandbox", "--user-data-dir=" + userData].concat(FAKE), env: Object.assign({}, process.env, { CC_UPDATE_API: "http://127.0.0.1:9" }) });
const cu = await app.firstWindow(); const errs = []; cu.on("pageerror", (e) => errs.push("host: " + e));
await passKey(cu, "ADEF-AULT-KEY0-2026");
await cu.waitForFunction(() => window.CentralUsage && window.CUMix && window.CUTalk && window.CURecUI && window.CU && window.CU.recorder);
await until(() => cu.evaluate(() => CUMix.kind === "local" && CUMix.state && CUMix.hostStatus && CUMix.hostStatus.engine && CUMix.hostStatus.engine.status && CUMix.hostStatus.engine.status.inputs === 4), 15000);
// two mixes that go somewhere (wired to the test outputs): Mix 3 and Mix 5
await cu.evaluate(() => { CUMix.op({ op: "mix", m: 2, patch: { wired: true, outL: 0, outR: 1 } }); CUMix.op({ op: "mix", m: 4, patch: { wired: true, outL: 2, outR: 3, name: "Bass" } }); });
const browser = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium", args: FAKE });
async function cuPage(label, store) {   // the app's page in a browser (another computer), set up through its local storage
  const c = await browser.newContext({ viewport: { width: 1280, height: 800 } }); await c.grantPermissions(["microphone"]).catch(() => { });
  await c.addInitScript((s) => { Object.keys(s).forEach((k) => localStorage.setItem("cu-" + k, JSON.stringify(s[k]))); }, store);
  await c.addInitScript(() => { try { if (!localStorage.getItem("cc-license")) localStorage.setItem("cc-license", JSON.stringify({ key: "ADEF-AULT-KEY0-2026", kind: "A", app: "control", okAt: Date.now(), production: "Test church", isDefault: true })); } catch (_) { } });
  const p = await c.newPage(); p.on("pageerror", (e) => errs.push(label + ": " + e));
  await p.goto("file://" + path.join(here, "app", "index.html")); await p.waitForFunction(() => window.CentralUsage && window.CUTalk);
  return p;
}
const meter = (m) => cu.evaluate((m) => { const x = CUMix.meters; return x ? Math.max(x.mix[m * 2], x.mix[m * 2 + 1]) : 0; }, m);
async function maxMeter(m, ms) { let best = 0; const t0 = Date.now(); while (Date.now() - t0 < ms) { best = Math.max(best, await meter(m)); await sleep(60); } return best; }
const hostTalkers = () => cu.evaluate(() => CU.talk.state().then((s) => s.talkers));

console.log("Talkback (the main admin):");
const phone = await browser.newPage(); phone.on("pageerror", (e) => errs.push("phone: " + e));
await check("the main admin has Band / Production and TALK in the top bar, on the In-ears tab and on the Mix tab", async () => {
  await cu.waitForSelector("#tbTop [data-tb-talk='group']", { timeout: 5000 });
  assert.ok(await cu.evaluate(() => !!document.querySelector('#tbTop [data-tb-group="band"]') && !!document.querySelector('#tbTop [data-tb-group="production"]')));
  await cu.evaluate(() => CentralUsage.showTab("inears")); await cu.waitForSelector("#view-inears .tb-panel [data-tb-talk='group']", { timeout: 5000 });
  await cu.evaluate(() => CentralUsage.showTab("mix")); await cu.waitForSelector("#view-mix .tb-panel [data-tb-talk='group']", { timeout: 5000 });
  await cu.evaluate(() => CentralUsage.showTab("inears"));
  await cu.click('#view-inears [data-tb-group="production"]'); assert.equal(await cu.evaluate(() => CUTalk.group()), "production");
  assert.equal(await cu.evaluate(() => JSON.parse(localStorage.getItem("cu-tbGroup"))), "production", "remembered on this computer");
  await cu.click('#view-inears [data-tb-group="band"]');
});
await check("nobody in the Band online yet: TALK says so (devices join groups on the Devices tab)", async () => {
  await cu.evaluate(() => CUTalk.on()); await until(() => cu.evaluate(() => !CUTalk.state().on && /Nobody in the Band/.test(CUTalk.state().error)), 4000);
});
await check("chosen in-ear mixes (Mix 3): only Mix 3 hears the mic (Mix 5 doesn't), Sam's phone says who is talking; a quick tap latched it", async () => {
  await phone.goto("http://" + ADDR + "/?name=Sam&code=1111"); await phone.waitForSelector("[data-ie-claim]", { timeout: 8000 }); await phone.click('[data-ie-claim="2"]');
  await until(() => cu.evaluate(() => CUMix.state.mixes[2].owner === "Sam"), 5000);
  await cu.evaluate(() => CUTalk.setTargets({ all: false, mixes: [2] }));
  await cu.click("#view-inears .tb-panel [data-tb-talk]");
  const st = await until(() => cu.evaluate(() => { const s = CUTalk.state(); return s.on && s.latched && s.sending && s.micFrames > 20 ? s : null; }), 8000);
  assert.equal(st.kind, "group");
  assert.match(await cu.textContent("#view-inears .tb-panel [data-tb-talk]"), /ON AIR/); assert.match(await cu.textContent("#tbTop [data-tb-talk]"), /ON AIR/);
  assert.match(await cu.textContent("#tbOnAir"), /ON AIR.*Mix 3/);
  const t = await until(async () => { const l = await hostTalkers(); return l.length === 1 ? l[0] : null; }, 4000);
  assert.deepEqual([t.name, t.kind, t.all, t.mixes, t.src, t.dim], ["Desk", "inears", false, [2], "net", -12]);
  const heard = await until(async () => { const v = await maxMeter(2, 1500); return v > 0.005 ? v : null; }, 10000);
  assert.ok(heard > 0.005, "Mix 3 hears the talkback " + heard);
  assert.ok(await maxMeter(4, 1500) < 0.0005, "Mix 5 doesn't");
  await phone.waitForFunction(() => /🎙 Desk talking/.test((document.querySelector(".ie-talk") || {}).textContent || ""), null, { timeout: 5000 });
  await shot(cu, "1-desk-onair"); await shot(phone, "2-phone-note");
});
await check("tap again: off - ON AIR gone here, the host lets go, the phone's note goes", async () => {
  await cu.click("#view-inears .tb-panel [data-tb-talk]");
  await until(() => cu.evaluate(() => !CUTalk.state().on && !document.getElementById("tbOnAir") && !document.body.classList.contains("tb-onair")), 4000);
  await until(async () => (await hostTalkers()).length === 0, 4000);
  await phone.waitForFunction(() => !document.querySelector(".ie-talk"), null, { timeout: 5000 });
});
await check("hold to talk (top bar button): on while held, not latched, off on release", async () => {
  const b = await cu.$("#tbTop [data-tb-talk]"), bb = await b.boundingBox();
  await cu.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await cu.mouse.down();
  await until(() => cu.evaluate(() => CUTalk.state().on && CUTalk.state().sending), 5000); await sleep(500);
  assert.equal(await cu.evaluate(() => CUTalk.state().latched), false);
  assert.equal((await hostTalkers()).length, 1);
  await cu.mouse.up();
  await until(() => cu.evaluate(() => !CUTalk.state().on), 3000); await until(async () => (await hostTalkers()).length === 0, 3000);
});
await check("the mic can be an input of the interface (on the audio host): no network mic frames, the engine takes input 2", async () => {
  await cu.evaluate(() => { CUTalk.setMic("in:1"); CUTalk.setTargets({ all: true }); CUTalk.setDim({ on: false }); });
  assert.ok(await cu.evaluate(() => [...document.querySelectorAll('#view-inears [data-tb="mic"] option')].some((o) => o.value === "in:1" && /Input 2/.test(o.textContent))));
  await cu.evaluate(() => CUTalk.on());
  const t = await until(async () => { const l = await hostTalkers(); return l.length === 1 ? l[0] : null; }, 4000);
  assert.deepEqual([t.src, t.all, t.dim], ["input", true, 0]); assert.equal(await cu.evaluate(() => CUTalk.state().sending), false);
  await cu.evaluate(() => CUTalk.off()); await until(async () => (await hostTalkers()).length === 0, 3000);
  await cu.evaluate(() => { CUTalk.setMic("mic"); CUTalk.setDim({ on: true, db: -12 }); CUTalk.setGroup("band"); });
});

console.log("Talkback (another admin, a user):");
let booth, keys;
await check("another admin (any job) and a user talk to the main admin only - their button says so", async () => {
  booth = await cuPage("booth", { role: "admin", mode: "admin", jobs: ["lighting"], name: "Booth", hostAddr: ADDR, adminCode: "2222" });
  await booth.waitForSelector("#tbTop [data-tb-talk='main']", { timeout: 4000 });
  assert.equal(await booth.evaluate(() => CUTalk.state().kindHere), "main");
  assert.equal(await booth.evaluate(() => !!document.querySelector("[data-tb-group]")), false, "no Band / Production for other admins");
  keys = await cuPage("keys", { role: "user1", mode: "user", name: "Keys", hostAddr: ADDR, userCode: "1111" });
  await keys.waitForSelector("#tbTop [data-tb-talk='main']", { timeout: 4000 });
  await keys.evaluate(() => CentralUsage.showTab("inears")); await keys.waitForSelector("#view-inears .tb-panel [data-tb-talk='main']", { timeout: 4000 });
  assert.match(await keys.textContent("#view-inears .tb-panel"), /Only the main admin hears it/);
});
await check("a user can't talk into the in-ears (the host refuses)", async () => {
  const r = await keys.evaluate((addr) => new Promise((res) => { const ws = new WebSocket("ws://" + addr + "/ws"); ws.onopen = () => ws.send(JSON.stringify({ type: "hello", role: "user", code: "1111", id: "x", name: "X", talkOnly: true })); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === "welcome") ws.send(JSON.stringify({ type: "talk", on: true, kind: "inears", targets: { all: true }, seq: 1 })); if (m.type === "talkAck") { res(m); ws.close(); } }; setTimeout(() => res(null), 3000); }), ADDR);
  assert.ok(r && !r.ok && /sound desk/.test(r.error), JSON.stringify(r));
});

console.log("Recording:");
await check("Mix tab: Record with a service name - the time runs, free space shows; Stop saves a folder named with the date and the service", async () => {
  await cu.evaluate(() => CentralUsage.showTab("mix")); await cu.waitForSelector("#mixRoot .rec-ctl [data-rec='go']", { timeout: 5000 });
  assert.match(await cu.textContent("#mixRoot [data-rec='go']"), /Record/);
  await cu.fill("#mixRoot [data-rec='name']", "Sunday Morning");
  await cu.click("#mixRoot [data-rec='go']");
  await cu.waitForFunction(() => /Stop/.test(document.querySelector("#mixRoot [data-rec='go']").textContent) && /0:0[1-9]/.test(document.querySelector("#mixRoot .rec-time").textContent), null, { timeout: 6000 });
  assert.match(await cu.textContent("#mixRoot .rec-free"), /(GB|TB|MB) free/);
  await shot(cu, "5-mix-recording");
  const st = await cu.evaluate(() => CU.recorder.state()); assert.ok(st.recording && st.tracks === 5, JSON.stringify(st));
  assert.match(path.basename(st.folder), /^\d{4}-\d\d-\d\d \d\d\.\d\d - Sunday Morning$/);
  await sleep(1500);
  await cu.click("#mixRoot [data-rec='go']");
  await cu.waitForFunction(() => /Saved/.test(document.querySelector("#mixRoot .rec-msg").textContent), null, { timeout: 10000 });
  const files = fs.readdirSync(st.folder).sort();
  assert.ok(files.filter((f) => /^In 0[1-4]( - .*)?\.wav$/.test(f)).length === 4 && files.includes("Program.wav") && !files.includes(".recording"), files.join(", "));
  for (const f of files.filter((x) => x.endsWith(".wav"))) { const w = wav(path.join(st.folder, f)); assert.deepEqual([w.riff, w.rate, w.bits, w.ch, w.data], ["RIFF", 48000, 24, f === "Program.wav" ? 2 : 1, w.size - 44], f); assert.ok(w.data > 48000 * 3 * 2, f + " " + w.data); }
  await until(() => fs.existsSync(path.join(st.folder, "Program.mp3")) && fs.statSync(path.join(st.folder, "Program.mp3")).size > 1000, 15000);
  await cu.waitForFunction(() => /MP3 ✓/.test(document.querySelector("#mixRoot .rec-msg").textContent), null, { timeout: 8000 });
});
await check("the recording a crash left behind is repaired (the app's start / the next recording): header fixed, marker gone", async () => {
  const w = wav(path.join(crashed, "In 01.wav")); assert.equal(w.data, 48000 * 3); assert.ok(!fs.existsSync(path.join(crashed, ".recording")));
});
await check("CU.recorder: start({ name }) / state() / stop() and its events (for services to come)", async () => {
  await cu.evaluate(() => { window.__recEv = []; CU.recorder.on((st, ev) => window.__recEv.push(ev)); });
  const r = await cu.evaluate(() => CU.recorder.start({ name: "API Service" })); assert.ok(r.state && r.state.recording, JSON.stringify(r));
  const again = await cu.evaluate(() => CU.recorder.start({ name: "Twice" })); assert.match(again.error || "", /Already/);
  await sleep(1200);
  const s = await cu.evaluate(() => CU.recorder.stop()); assert.ok(!s.state.recording && s.state.last && /API Service/.test(s.state.last.folder), JSON.stringify(s.state.last));
  const ev = await cu.evaluate(() => window.__recEv); assert.ok(ev.includes("starting") && ev.includes("started") && ev.includes("stopping") && ev.includes("stopped"), ev.join(","));
});
await check("I/O tab: the Listening & recording card has the control and the folder", async () => {
  await cu.evaluate(() => CentralUsage.showTab("io")); await cu.waitForSelector("#ioRoot .io-rec .rec-ctl [data-rec='go']", { timeout: 5000 });
  assert.equal(await cu.textContent("#ioRoot .rec-dir"), recDir);
  await shot(cu, "6-io-card");
});
await check("an admin on another computer starts and stops the audio host's recording from its Mix tab", async () => {
  await booth.evaluate(() => CentralUsage.setJobs(["mix", "inears"])); await booth.evaluate(() => CentralUsage.showTab("mix"));
  await booth.waitForSelector("#mixRoot .rec-ctl [data-rec='go']", { timeout: 6000 });
  await booth.fill("#mixRoot [data-rec='name']", "From the booth"); await booth.click("#mixRoot [data-rec='go']");
  await until(() => cu.evaluate(() => CU.recorder.state().then((s) => s.recording && /From the booth/.test(s.folder))), 6000);
  await booth.waitForFunction(() => /Stop/.test(document.querySelector("#mixRoot [data-rec='go']").textContent), null, { timeout: 4000 });
  await sleep(800); await booth.click("#mixRoot [data-rec='go']");
  await until(() => cu.evaluate(() => CU.recorder.state().then((s) => !s.recording && s.last && /From the booth/.test(s.last.folder))), 8000);
  await booth.waitForFunction(() => /Saved/.test(document.querySelector("#mixRoot .rec-msg").textContent), null, { timeout: 6000 });
});
await check("no page errors", async () => { assert.deepEqual(errs, []); });

await app.close().catch(() => { }); await browser.close();
console.log(failures ? "\n" + failures + " CHECK(S) FAILED" : "\nALL TALKBACK / RECORDING CHECKS PASSED");
process.exit(failures ? 1 : 0);
