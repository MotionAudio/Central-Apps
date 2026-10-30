// Central Usage - the Studio tab: SoundFont reading, the sounds and their plans, timeline and grid playback (rendered
// offline and checked by ear: timing and pitch), effects (with and without Central Plugins), MIDI keyboards (up to four,
// a Launchpad on the grid), recording (timeline, grid, overdub), editing (piano roll, drum steps, quantize, undo),
// exports (WAV) and saving. Then the real app: the sound list from the computer's banks, projects on disk, cu-studio.
//   bash prepare-shared.sh && node test-studio.mjs        (the Electron part also needs a display: xvfb-run -a)
import { chromium, _electron as electron } from "playwright";
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert";
import { fileURLToPath } from "node:url";
import { makeSf2 } from "./native/make-test-sf2.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
let failures = 0; async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e && e.message || e).split("\n").slice(0, 8).join("\n      ")); } }
const sf2 = Array.from(makeSf2());

const exePath = ["/opt/pw-browsers/chromium", process.env.CHROMIUM_PATH].filter((p) => p && fs.existsSync(p))[0];
const b = await chromium.launch(Object.assign({ args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] }, exePath ? { executablePath: exePath } : {}));
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
await page.addInitScript(() => { try { localStorage.setItem("cu-mode", JSON.stringify("user")); localStorage.setItem("cu-role", JSON.stringify("user1")); if (!localStorage.getItem("cc-license")) localStorage.setItem("cc-license", JSON.stringify({ key: "ADEF-AULT-KEY0-2026", kind: "A", app: "control", okAt: Date.now(), production: "Test church", isDefault: true })); } catch (_) { } });
await page.goto("file://" + path.join(here, "app", "index.html"));
await page.waitForFunction(() => window.CUStudio && window.CUStudioUI && window.CentralUsage);
await page.evaluate(() => { const d = document.querySelector("dialog[open]"); if (d) d.close(); });
const T = (fn, arg) => page.evaluate(fn, arg);

await check("User 1 has a Studio tab; it opens on a new song with Keys, Drums, Bass and Audio tracks and the transport", async () => {
  await T(() => CentralUsage.showTab("studio"));
  await page.waitForSelector("#view-studio.active .st-grid");
  const r = await T(() => ({ tabs: CentralUsage.tabsFor("user1"), u2: CentralUsage.tabsFor("user2"), tracks: CUStudio.project().tracks.map((t) => t.name + ":" + t.kind), heads: document.querySelectorAll(".st-grid .st-head").length, slots: document.querySelectorAll(".st-grid .st-slot").length, play: !!document.querySelector("#stPlay"), rec: !!document.querySelector("#stRec") }));
  assert.ok(r.tabs.includes("studio") && !r.u2.includes("studio"), JSON.stringify(r));
  assert.deepEqual(r.tracks, ["Keys:instrument", "Drums:drums", "Bass:instrument", "Audio:audio"]); assert.equal(r.heads, 4); assert.equal(r.slots, 32); assert.ok(r.play && r.rec);
});

await check("a SoundFont bank: its presets, zones, root key, loop and drum kit are read; the sounds appear in the list with their plan", async () => {
  const r = await T(async (bytes) => {
    const bank = await CUSf2.open(CUSf2.fromBytes(new Uint8Array(bytes)));
    const sine = bank.regions(bank.presetIndex(0, 0)), kit = bank.regions(bank.presetIndex(128, 0));
    await CUStudioSounds.addBank("Test bank", bytes, null); await CUStudioSounds.addBank("Library bank", bytes, "keys");
    const list = CUStudioSounds.list().filter((s) => /Test (Sine|Kit)/.test(s.name)).map((s) => s.name + "|" + s.category + "|" + s.tier + "|" + s.drums);
    return { presets: bank.presets.map((p) => p.name + " " + p.bank + ":" + p.prog), sine: sine.map((z) => [z.lo, z.hi, z.root, z.loop]), kit: kit.map((z) => [z.lo, z.hi, z.root]), list, builtins: CUStudioSounds.list().filter((s) => s.builtin).length };
  }, sf2);
  assert.deepEqual(r.presets, ["Test Sine 0:0", "Test Kit 128:0"]);
  assert.deepEqual(r.sine, [[0, 127, 60, 1]]); assert.deepEqual(r.kit, [[36, 36, 36], [38, 38, 38]]);
  assert.ok(r.list.includes("Test Sine|Other|free|false") && r.list.includes("Test Kit|Drums|free|true"), r.list.join(","));
  assert.ok(r.list.includes("Test Sine|Other|keys|false"), "a library bank keeps its plan: " + r.list.join(","));
  assert.equal(r.builtins, 5);
});

// a helper: put one track on a sound, a clip on the timeline, render it offline, and measure it
await page.evaluate(() => {
  window.__render = async function (o) {
    CUStudio.fresh({ bpm: o.bpm || 120, tracks: [["instrument", "Keys", o.sound || "builtin:keys"]] });
    const t = CUStudio.project().tracks[0];
    CUStudio.edit("setup", (p) => { if (o.fx) t.fx = Object.assign(CUStudio.defaultFx(), o.fx); const c = CUStudio.newClip("midi", o.len || 4); c.notes = o.notes; p.clips[c.id] = c; p.arrangement.push({ id: "a1", track: t.id, clip: c.id, start: o.start || 0, len: o.len || 4, offset: 0, loop: !!o.loop }); if (o.itemLen) p.arrangement[0].len = o.itemLen; });
    await CUStudio.graph().sync(CUStudio.project());
    const buf = await CUStudio.bounce(o.range || {}); const d = buf.getChannelData(0), sr = buf.sampleRate;
    const rms = (a, z) => { let s = 0, n = 0; for (let i = Math.floor(a * sr); i < Math.min(d.length, Math.floor(z * sr)); i++) { s += d[i] * d[i]; n++; } return n ? Math.sqrt(s / n) : 0; };
    const freq = (a, z) => { let c = 0, prev = d[Math.floor(a * sr)]; for (let i = Math.floor(a * sr) + 1; i < Math.floor(z * sr); i++) { if (prev <= 0 && d[i] > 0) c++; prev = d[i]; } return c / (z - a); };
    const firstLoud = (thr) => { for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > thr) return i / sr; return null; };
    return { len: buf.duration, sr, rms, freq, firstLoud };
  };
});
await check("the timeline plays a SoundFont note at the right moment and pitch (C4 = 261.6 Hz, C5 an octave up), silence before it", async () => {
  const r = await T(async () => {
    const id = CUStudioSounds.list().filter((s) => s.name === "Test Sine" && s.tier === "free")[0].id;
    const x = await __render({ sound: id, bpm: 120, notes: [{ p: 60, s: 1, d: 1, v: 110 }, { p: 72, s: 2.5, d: 1, v: 110 }] });
    return { silent: x.rms(0, 0.5), onset: x.firstLoud(0.02), f1: x.freq(0.62, 0.98), f2: x.freq(1.37, 1.73) };
  });
  assert.ok(r.silent < 1e-4, "silent before: " + r.silent);
  assert.ok(Math.abs(r.onset - 0.55) < 0.02, "onset " + r.onset + " (beat 1 at 120 BPM = 0.5 s + 0.05)");
  assert.ok(Math.abs(r.f1 - 261.6) < 6, "C4 " + r.f1); assert.ok(Math.abs(r.f2 - 523.3) < 10, "C5 " + r.f2);
});
await check("a clip longer on the timeline than its length repeats (loop); the built-in sounds and the Basic Kit play", async () => {
  const r = await T(async () => {
    const loop = await __render({ sound: "builtin:keys", bpm: 120, len: 1, itemLen: 4, loop: true, notes: [{ p: 60, s: 0, d: 0.25, v: 120 }] });
    const kit = await __render({ sound: "builtin:kit", bpm: 120, notes: [{ p: 36, s: 0, d: 0.25, v: 120 }, { p: 38, s: 1, d: 0.25, v: 120 }, { p: 42, s: 2, d: 0.25, v: 120 }] });
    return { hits: [0, 1, 2, 3].map((k) => loop.rms(0.05 + k * 0.5, 0.05 + k * 0.5 + 0.1)), quietBetween: loop.rms(0.05 + 0.4, 0.05 + 0.5), kick: kit.rms(0.05, 0.25), snare: kit.rms(0.55, 0.7), hat: kit.rms(1.05, 1.1) };
  });
  assert.ok(r.hits.every((h) => h > 0.01), "every repeat sounds: " + r.hits); assert.ok(r.kick > 0.02 && r.snare > 0.01 && r.hat > 0.005, JSON.stringify(r));
});
await check("effects: reverb leaves a tail after the note; with no Central Plugins a hall reverb plays as the free room and pro presets are locked", async () => {
  const r = await T(async () => {
    const note = [{ p: 60, s: 0, d: 0.5, v: 120 }];
    const dry = await __render({ sound: "builtin:keys", bpm: 120, len: 4, notes: note });
    const wet = await __render({ sound: "builtin:keys", bpm: 120, len: 4, notes: note, fx: { on: true, reverb: { on: true, type: "room", send: 80, size: 0 }, eq: { on: false } } });
    const P = window.PPPedals, has = P.has; P.has = (t) => t === "free";
    const core = PP_FX_CORE(), plan = core.plan(Object.assign(CUStudio.defaultFx(), { on: true, reverb: { on: true, type: "hall", send: 50 } }), CUStudio.pro(), 120);
    CentralUsage.showTab("studio"); window.CUStudioUI.ui.tab = "fx"; window.CUStudioUI.draw();
    const lockedPro = Array.from(document.querySelectorAll("#stFxPreset option")).filter((o) => o.disabled).map((o) => o.value);
    P.has = has;
    return { dryTail: dry.rms(0.8, 1.1), wetTail: wet.rms(0.8, 1.1), proNow: CUStudio.pro(), type: plan.reverb.type, lockedPro };
  });
  assert.ok(r.wetTail > r.dryTail * 3 && r.wetTail > 0.001, JSON.stringify(r));
  assert.equal(r.type, "room"); assert.ok(r.lockedPro.includes("Grand hall keys") && !r.lockedPro.includes("Keys"), r.lockedPro.join(","));
});
await check("a sound whose plan isn't active can't be picked and plays a built-in stand-in; a free one is picked and named", async () => {
  const r = await T(async () => {
    CUStudio.fresh({}); CentralUsage.showTab("studio"); const ui = CUStudioUI.ui; ui.tab = "sound"; ui.sel = CUStudio.project().tracks[0].id;
    const P = window.PPPedals, has = P.has; P.has = (t) => t === "free"; CUStudioUI.draw();
    const libSine = CUStudioSounds.list().filter((s) => s.name === "Test Sine" && s.tier === "keys")[0];
    const btn = document.querySelector('[data-snd="' + CSS.escape(libSine.id) + '"]'); const lockedShown = btn && btn.classList.contains("locked"); btn.click();
    const after = CUStudio.project().tracks[0].layers[0].sound, msg = document.querySelector("#stMsg").textContent;
    const inst = CUStudioSounds.instrument(CUStudio.ctx(), [{ sound: libSine.id, name: "Test Sine" }]);
    P.has = has;
    const free = CUStudioSounds.list().filter((s) => s.name === "Test Sine" && s.tier === "free")[0]; CUStudioUI.draw(); document.querySelector('[data-snd="' + CSS.escape(free.id) + '"]').click();
    return { lockedShown, after, msg, standIn: inst.names(), picked: CUStudio.project().tracks[0].layers[0].sound === free.id };
  });
  assert.ok(r.lockedShown, "shown with a lock"); assert.equal(r.after, "builtin:keys"); assert.match(r.msg, /Central Keys/);
  assert.match(r.standIn[0], /Simple Keys \(stand-in\)/); assert.ok(r.picked);
});

await check("the grid: a clip launched with nothing playing starts at once; another waits for the next bar, then plays; Stop all stops", async () => {
  const r = await T(async () => {
    CUStudio.fresh({ bpm: 240 }); const p = CUStudio.project(), k = p.tracks[0], d = p.tracks[1];
    CUStudio.edit("clips", (pp) => { const a = CUStudio.newClip("midi", 4); a.notes = [{ p: 60, s: 0, d: 1, v: 100 }]; pp.clips[a.id] = a; k.slots[0] = a.id; const c = CUStudio.newClip("midi", 4); c.notes = [{ p: 36, s: 0, d: 0.5, v: 100 }]; pp.clips[c.id] = c; d.slots[0] = c.id; const e = CUStudio.newClip("midi", 4); pp.clips[e.id] = e; k.slots[1] = e.id; });
    CUStudio.launch(k.id, 0); const s1 = CUStudio.gridState()[k.id];
    await new Promise((r) => setTimeout(r, 300));
    CUStudio.launch(k.id, 1); const s2 = CUStudio.gridState()[k.id];
    await new Promise((r) => setTimeout(r, 1300));
    const s3 = CUStudio.gridState()[k.id], playing = CUStudio.state().playing;
    CUStudio.launchScene(0); await new Promise((r) => setTimeout(r, 1100)); const s4 = CUStudio.gridState();
    CUStudio.stopAll(); await new Promise((r) => setTimeout(r, 1100)); const s5 = CUStudio.gridState(); CUStudio.stop();
    return { s1, s2, s3, playing, scene: [s4[k.id].playing, s4[d.id].playing], after: [s5[k.id].playing, s5[d.id].playing] };
  });
  assert.equal(r.s1.playing, 0); assert.equal(r.s2.playing, 0); assert.equal(r.s2.queued, 1); assert.equal(r.s3.playing, 1); assert.equal(r.s3.queued, null); assert.ok(r.playing);
  assert.deepEqual(r.scene, [0, 0]); assert.deepEqual(r.after, [null, null]);
});

await check("MIDI keyboards: up to four play at once; a keyboard plays the picked track or always one track; MIDI Start / Stop run the Studio", async () => {
  const r = await T(async () => {
    CUStudio.fresh({}); const p = CUStudio.project(), keys = p.tracks[0], bass = p.tracks[2], seen = [];
    const off = CUStudio.on("live", (m) => { if (m.on) seen.push(CUStudio.track(m.track).name + ":" + m.note); });
    ["Keyboard A", "Keyboard B", "Pads C", "Looper D", "Fifth E"].forEach((n) => CUMidiIn.addFake(n));
    localStorage.removeItem("cu-studio-devices"); CUStudioUI.setupDevices();
    const active = CUStudioUI.activeDevices();
    CUStudioUI.ui.sel = keys.id;
    const sel = document.createElement("select"); // set Keyboard B to always play Bass the way the devices page does
    CentralUsage.showTab("studio"); CUStudioUI.ui.tab = "devices"; CUStudioUI.draw();
    const s = document.querySelector('[data-dev="Keyboard B"]'); s.value = "track:" + bass.id; s.dispatchEvent(new Event("change", { bubbles: true }));
    CUMidiIn.inject("Keyboard A", [0x90, 60, 100]); CUMidiIn.inject("Keyboard B", [0x90, 40, 100]); CUMidiIn.inject("Fifth E", [0x90, 70, 100]);
    CUMidiIn.inject("Keyboard A", [0x80, 60, 0]); CUMidiIn.inject("Keyboard B", [0x80, 40, 0]);
    CUMidiIn.inject("Pads C", [0xFA]); const playing = CUStudio.state().playing; CUMidiIn.inject("Pads C", [0xFC]); const stopped = !CUStudio.state().playing;
    const devRows = document.querySelectorAll(".st-dev").length; off(); ["Keyboard A", "Keyboard B", "Pads C", "Looper D", "Fifth E"].forEach((n) => CUMidiIn.removeFake(n)); localStorage.removeItem("cu-studio-devices");
    return { active, seen, playing, stopped, devRows };
  });
  assert.equal(r.active.length, 4); assert.ok(!r.active.includes("Fifth E"));
  assert.deepEqual(r.seen, ["Keys:60", "Bass:40"], "the fifth device is ignored: " + r.seen); assert.ok(r.playing && r.stopped); assert.equal(r.devRows, 5);
});

await check("recording on the timeline: notes played land on their beats (the count-in and click heard first), Quantize snaps them, Undo takes it back", async () => {
  const r = await T(async () => {
    CUStudio.fresh({ bpm: 240 }); const p = CUStudio.project(), keys = p.tracks[0];
    CUStudio.edit("arm", () => { keys.arm = true; p.metronome.countIn = 1; });
    CUStudioUI.ui.sel = keys.id; CUMidiIn.addFake("Rec Keys");
    CUStudio.record();
    const st = CUStudio.state(), counting = st.countingIn;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const at = (beat) => new Promise((res) => { const iv = setInterval(() => { if (CUStudio.position() >= beat) { clearInterval(iv); res(); } }, 2); });
    await at(1); CUMidiIn.inject("Rec Keys", [0x90, 60, 100]); await wait(100); CUMidiIn.inject("Rec Keys", [0x80, 60, 0]);
    await at(2.9); CUMidiIn.inject("Rec Keys", [0x90, 64, 90]); await wait(100); CUMidiIn.inject("Rec Keys", [0x80, 64, 0]);
    await at(4.2); CUStudio.stop(); CUMidiIn.removeFake("Rec Keys");
    const item = p.arrangement[0] && CUStudio.project().arrangement[0], c = item && CUStudio.clip(item.clip), notes = c ? c.notes.map((n) => [n.p, Math.round(n.s * 100) / 100]) : [];
    const items = CUStudio.project().arrangement.length;
    CUStudio.edit("q", () => CUStudio.quantizeNotes(c.notes, "1/4", 1)); const q = c.notes.map((n) => n.s);
    const u1 = CUStudio.undo(), u2 = CUStudio.undo();
    return { counting, items, after: CUStudio.project().arrangement.length, notes, q, len: c && c.len, u1, u2 };
  });
  assert.ok(r.counting, "the count-in comes first");
  assert.equal(r.notes.length, 2, JSON.stringify(r.notes)); assert.equal(r.notes[0][0], 60); assert.ok(Math.abs(r.notes[0][1] - 1) < 0.25, "near beat 1: " + r.notes[0][1]); assert.ok(Math.abs(r.notes[1][1] - 2.9) < 0.25, "near beat 2.9: " + r.notes[1][1]);
  assert.deepEqual(r.q, [1, 3]); assert.equal(r.len, 8);
  assert.equal(r.u1, "q"); assert.equal(r.u2, "Record"); assert.equal(r.items, 1); assert.equal(r.after, 0, "undoing the recording takes the clip away");
});
await check("recording into a grid slot makes a clip there; Overdub adds to it on the next pass instead of replacing it", async () => {
  const r = await T(async () => {
    CUStudio.fresh({ bpm: 240 }); const p = CUStudio.project(), keys = p.tracks[0];
    CUStudio.edit("arm", () => { keys.arm = true; p.metronome.countIn = 0; p.recordLen = 1; });
    CUMidiIn.addFake("Rec Keys"); CUStudioUI.ui.sel = keys.id;
    const at = (beat) => new Promise((res) => { const iv = setInterval(() => { if (CUStudio.position() >= beat) { clearInterval(iv); res(); } }, 2); });
    CUStudio.record({ slot: 2, track: keys.id }); await at(0.5); CUMidiIn.inject("Rec Keys", [0x90, 62, 100]); await at(0.7); CUMidiIn.inject("Rec Keys", [0x80, 62, 0]);
    await at(4.3); const first = keys.slots[2] && CUStudio.clip(CUStudio.project().tracks[0].slots[2]);
    const firstNotes = first ? first.notes.length : -1, rec1 = CUStudio.state().recording; CUStudio.stop();
    CUStudio.edit("od", (pp) => { pp.overdub = true; });
    CUStudio.record({ slot: 2, track: keys.id }); await at(1.5); CUMidiIn.inject("Rec Keys", [0x90, 67, 100]); await at(1.7); CUMidiIn.inject("Rec Keys", [0x80, 67, 0]); await at(4.3); CUStudio.stop();
    CUMidiIn.removeFake("Rec Keys");
    const c = CUStudio.clip(CUStudio.project().tracks[0].slots[2]);
    return { firstNotes, rec1, after: c.notes.map((n) => n.p).sort(), clips: Object.keys(CUStudio.project().clips).length };
  });
  assert.equal(r.firstNotes, 1); assert.equal(r.rec1, false, "a 1-bar recording stops by itself"); assert.deepEqual(r.after, [62, 67]); assert.equal(r.clips, 1);
});

await check("an audio track records the input (the test microphone) into a clip on the timeline, lined up from where recording started", async () => {
  const r = await T(async () => {
    CUStudio.fresh({ bpm: 240 }); const p = CUStudio.project(), au = p.tracks[3];
    CUStudio.edit("arm", () => { au.arm = true; p.metronome.countIn = 0; p.metronome.on = false; });
    const at = (beat) => new Promise((res) => { const iv = setInterval(() => { if (CUStudio.position() >= beat) { clearInterval(iv); res(); } }, 5); });
    CUStudio.setPos(4); CUStudio.record(); await at(9); CUStudio.stop();
    const it = CUStudio.project().arrangement[0], c = it && CUStudio.clip(it.clip), buf = c && CUStudio.buffers[c.audio.id];
    let pk = 0; if (buf) { const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i])); }
    return { items: CUStudio.project().arrangement.length, kind: c && c.kind, start: it && it.start, len: it && Math.round(it.len * 10) / 10, secs: buf && Math.round(buf.duration * 10) / 10, pk, saved: CUStudio.project().audioFiles.length };
  });
  assert.equal(r.items, 1, JSON.stringify(r)); assert.equal(r.kind, "audio"); assert.ok(Math.abs(r.start - 4) < 0.6, "starts near beat 4: " + r.start);
  assert.ok(r.secs > 0.8 && r.secs < 1.6, "about 5 beats at 240 BPM: " + r.secs); assert.ok(r.pk > 0.01, "the input was heard: " + r.pk); assert.equal(r.saved, 1);
});
await check("the piano roll: a click adds a note on the snap grid, a drag moves it, double-click removes it; ×2 doubles the clip", async () => {
  await T(() => { CUStudio.fresh({}); const p = CUStudio.project(), k = p.tracks[0]; CUStudio.edit("c", (pp) => { const c = CUStudio.newClip("midi", 4); pp.clips[c.id] = c; k.slots[0] = c.id; }); const ui = CUStudioUI.ui; ui.sel = k.id; ui.clip = k.slots[0]; ui.tab = "clip"; ui.prTop = 84; ui.prZoom = 64; CentralUsage.showTab("studio"); CUStudioUI.draw(); });
  await page.waitForTimeout(100); await T(() => { const pr = document.querySelector(".st-pr"); pr.scrollTop = 0; document.querySelectorAll("dialog[open]").forEach((d) => d.close()); });
  assert.equal(await T(() => document.querySelectorAll("dialog[open]").length), 0, "nothing in front of the Studio");
  const g = await page.$("#stPrGrid"), box = await g.boundingBox();
  await page.mouse.click(box.x + 64 * 1.1, box.y + 14 * (84 - 72) + 7);   // beat 1.1 -> snaps to 1 (1/16 grid: 1.0), pitch 72
  let notes = await T(() => CUStudio.clip(CUStudioUI.ui.clip).notes.map((n) => [n.p, n.s, n.d]));
  assert.deepEqual(notes, [[72, 1, 0.25]]);
  await page.waitForTimeout(150); const n = await page.$('#stPrGrid [data-note="0"]'), nb = await n.boundingBox();
  await page.mouse.move(nb.x + 4, nb.y + 6); await page.mouse.down(); await page.mouse.move(nb.x + 4 + 64, nb.y + 6 - 28, { steps: 4 }); await page.mouse.up();
  await page.waitForTimeout(150); notes = await T(() => CUStudio.clip(CUStudioUI.ui.clip).notes.map((n) => [n.p, n.s]));
  assert.deepEqual(notes, [[74, 2]]);
  await page.click("#stDouble"); const dbl = await T(() => { const c = CUStudio.clip(CUStudioUI.ui.clip); return [c.len, c.notes.length]; }); assert.deepEqual(dbl, [8, 2]);
  await page.waitForTimeout(150); const n2 = await page.$('#stPrGrid [data-note="0"]'), b2 = await n2.boundingBox(); await page.mouse.dblclick(b2.x + 6, b2.y + 6); await page.waitForTimeout(150);
  assert.equal(await T(() => CUStudio.clip(CUStudioUI.ui.clip).notes.length), 1);
});
await check("the drum editor: a Drums clip shows steps per drum; a click adds a hit, again removes it; right-click makes an accent", async () => {
  await T(() => { CUStudio.fresh({}); const p = CUStudio.project(), d = p.tracks[1]; CUStudio.edit("c", (pp) => { const c = CUStudio.newClip("midi", 4); pp.clips[c.id] = c; d.slots[0] = c.id; }); const ui = CUStudioUI.ui; ui.sel = d.id; ui.clip = d.slots[0]; ui.tab = "clip"; CUStudioUI.draw(); });
  const rows = await page.$$eval(".st-drow .st-dname", (l) => l.map((e) => e.textContent)); assert.ok(rows.includes("Kick") && rows.includes("Closed hat"), rows.join(","));
  await page.click('.st-step[data-dn="36"][data-step="4"]');
  let n = await T(() => CUStudio.clip(CUStudioUI.ui.clip).notes.map((x) => [x.p, x.s])); assert.deepEqual(n, [[36, 1]]);
  await page.click('.st-step[data-dn="36"][data-step="4"]', { button: "right" }); assert.ok(await T(() => CUStudio.clip(CUStudioUI.ui.clip).notes[0].v > 110), "accent");
  await page.click('.st-step[data-dn="36"][data-step="4"]'); n = await T(() => CUStudio.clip(CUStudioUI.ui.clip).notes.length); assert.equal(n, 0);
});
await check("layers: a split sends low keys to one sound and high keys to another; a velocity split by how hard you play", async () => {
  const r = await T(async () => {
    const c = CUStudio.ctx();
    const inst = CUStudioSounds.instrument(c, [{ sound: "builtin:bass", lo: 0, hi: 59 }, { sound: "builtin:lead", lo: 60, hi: 127 }]); await inst.ready;
    const low = inst.noteOn(c.destination, 40, 100, 0), high = inst.noteOn(c.destination, 72, 100, 0); inst.allOff(0, true);
    const vel = CUStudioSounds.instrument(c, [{ sound: "builtin:keys", velLo: 1, velHi: 89 }, { sound: "builtin:pad", velLo: 90, velHi: 127 }]); await vel.ready;
    const soft = vel.noteOn(c.destination, 60, 50, 0), hard = vel.noteOn(c.destination, 60, 120, 0); vel.allOff(0, true);
    return { low: low.parts.map((p) => p.layer.s.name), high: high.parts.map((p) => p.layer.s.name), soft: soft.parts.map((p) => p.layer.s.name), hard: hard.parts.map((p) => p.layer.s.name) };
  });
  assert.deepEqual(r, { low: ["Synth Bass"], high: ["Bright Lead"], soft: ["Simple Keys"], hard: ["Warm Pad"] });
});
await check("a Launchpad plays the grid: its top-left pad launches track 1 / row 1, the right-hand button a row", async () => {
  const r = await T(async () => {
    CUStudio.fresh({ bpm: 240 }); const p = CUStudio.project(), k = p.tracks[0], d = p.tracks[1];
    CUStudio.edit("c", (pp) => { const a = CUStudio.newClip("midi", 4); pp.clips[a.id] = a; k.slots[0] = a.id; const b2 = CUStudio.newClip("midi", 4); pp.clips[b2.id] = b2; d.slots[1] = b2.id; });
    CUMidiIn.addFake("Launchpad X"); CUStudioUI.setupDevices(); const mode = CUStudioUI.devMode("Launchpad X");
    CUMidiIn.inject("Launchpad X", [0x90, 81, 127]); const s1 = CUStudio.gridState()[k.id].playing;
    CUMidiIn.inject("Launchpad X", [0xB0, 79, 127]); const q = CUStudio.gridState()[d.id];
    CUStudio.stop(); CUMidiIn.removeFake("Launchpad X");
    return { mode, s1, q };
  });
  assert.equal(r.mode, "grid"); assert.equal(r.s1, 0); assert.equal(r.q.queued, 1);
});
await check("export: the mix is a 48 kHz 24-bit stereo WAV of the timeline; an empty timeline says what to do", async () => {
  const r = await T(async () => {
    const x = await __render({ sound: "builtin:keys", bpm: 120, notes: [{ p: 60, s: 0, d: 1, v: 100 }] });
    const buf = await CUStudio.bounce(), w = new DataView(CUStudio.wav(buf, 24)); const tag = (o) => String.fromCharCode(w.getUint8(o), w.getUint8(o + 1), w.getUint8(o + 2), w.getUint8(o + 3));
    CUStudio.fresh({}); let msg = ""; try { await CUStudio.bounce(); } catch (e) { msg = e.message; }
    return { riff: tag(0), wave: tag(8), ch: w.getUint16(22, true), rate: w.getUint32(24, true), bits: w.getUint16(34, true), bytes: w.getUint32(40, true), frames: buf.length, msg };
  });
  assert.equal(r.riff, "RIFF"); assert.equal(r.wave, "WAVE"); assert.equal(r.ch, 2); assert.equal(r.rate, 48000); assert.equal(r.bits, 24); assert.equal(r.bytes, r.frames * 6);
  assert.match(r.msg, /timeline is empty/);
});
await check("the grid's rows go onto the timeline one after another; undo, redo", async () => {
  const r = await T(async () => {
    CUStudio.fresh({}); const p = CUStudio.project(), k = p.tracks[0], d = p.tracks[1];
    CUStudio.edit("c", (pp) => { const a = CUStudio.newClip("midi", 4); pp.clips[a.id] = a; k.slots[0] = a.id; const b2 = CUStudio.newClip("midi", 8); pp.clips[b2.id] = b2; d.slots[1] = b2.id; });
    CUStudio.scenesToTimeline(); const items = CUStudio.project().arrangement.map((it) => [CUStudio.track(it.track).name, it.start, it.len]);
    CUStudio.undo(); const undone = CUStudio.project().arrangement.length; CUStudio.redo(); const redone = CUStudio.project().arrangement.length;
    return { items, undone, redone };
  });
  assert.deepEqual(r.items, [["Keys", 0, 4], ["Drums", 4, 8]]); assert.equal(r.undone, 0); assert.equal(r.redone, 2);
});
await check("saving: a song with an audio clip is saved, a new song started, and the saved one opens again with its audio", async () => {
  const r = await T(async () => {
    CUStudio.fresh({ name: "Saved song", bpm: 90 }); const p = CUStudio.project(), au = p.tracks[3];
    const c = CUStudio.ctx(), sr = 48000, n = sr, ab = new ArrayBuffer(44 + n * 2), v = new DataView(ab); const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(9000 * Math.sin(2 * Math.PI * 330 * i / sr)), true);
    await CUStudio.importAudio(au.id, ab, "Guitar idea", 4);
    const id = await CUStudio.save(); const before = CUStudio.project().arrangement.length;
    CUStudio.fresh({}); const list = await CUStudio.list();
    await CUStudio.open(id); const q = CUStudio.project(), it = q.arrangement[0], cl = CUStudio.clip(it.clip), buf = CUStudio.buffers[cl.audio.id];
    const out = await CUStudio.bounce();
    return { listed: list.some((x) => x.name === "Saved song"), name: q.name, bpm: q.bpm, before, start: it.start, hasBuf: !!buf, dur: buf && Math.round(buf.duration * 10) / 10, loud: (() => { const d = out.getChannelData(0); let m = 0; for (let i = Math.round(48000 * (0.05 + 4 * 60 / 90)); i < Math.round(48000 * (0.05 + 4 * 60 / 90 + 0.5)); i++) m = Math.max(m, Math.abs(d[i])); return m; })() };
  });
  assert.ok(r.listed); assert.equal(r.name, "Saved song"); assert.equal(r.bpm, 90); assert.equal(r.start, 4); assert.ok(r.hasBuf); assert.equal(r.dur, 1); assert.ok(r.loud > 0.05, "the audio plays: " + r.loud);
});
await check("the screens draw without errors: grid, timeline (with the audio's waveform), clip, sound, effects, mixer and devices", async () => {
  const r = await T(async () => {
    const ui = CUStudioUI.ui; CentralUsage.showTab("studio");
    const out = {};
    for (const v of ["grid", "timeline"]) { ui.view = v; CUStudioUI.draw(); out[v] = document.querySelector("#stArea").children.length; }
    out.items = document.querySelectorAll(".st-item").length; out.wave = document.querySelectorAll("canvas[data-wave]").length;
    for (const t of ["clip", "sound", "fx", "mixer", "devices"]) { ui.tab = t; CUStudioUI.draw(); out[t] = document.querySelector("#stDetail").textContent.length > 20; }
    return out;
  });
  assert.ok(r.grid && r.timeline && r.items >= 1 && r.wave >= 1 && r.clip && r.sound && r.fx && r.mixer && r.devices, JSON.stringify(r));
});
await check("no page errors", async () => { assert.deepEqual(errs, []); });
await b.close();

// ---- the real app (Electron): the computer's banks, projects on disk, cu-studio
const exe = [process.env.ELECTRON_PATH, path.join(here, "node_modules", "electron", "dist", "electron")].filter((p) => p && fs.existsSync(p))[0];
if (exe && (process.env.DISPLAY || process.platform !== "linux")) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "cu-studio-app-")), sfDir = path.join(userData, "instrument", "sounds", "sf2");
  fs.mkdirSync(sfDir, { recursive: true }); fs.writeFileSync(path.join(sfDir, "Test Bank - studio-test.sf2"), makeSf2()); fs.writeFileSync(path.join(sfDir, "tiers.txt"), "Test Bank|keys|CC0|Test\n");
  const app = await electron.launch({ executablePath: exe, args: [path.join(here, "main.js"), "--no-sandbox", "--user-data-dir=" + userData], env: Object.assign({}, process.env, { CU_CENTER_PORT: "18096", CU_NO_BEACON: "1" }) });
  const win = await app.firstWindow(); await win.waitForFunction(() => window.CU && window.CU.studio && window.CUStudio, null, { timeout: 20000 });
  await check("the app lists the computer's banks with their plan (tiers.txt) and reads only those files", async () => {
    const r = await win.evaluate(async (dir) => {
      const cat = await CU.studio.catalog(), b = cat.filter((x) => /studio-test/.test(x.file))[0];
      const head = await CU.studio.read(b.file, 0, 4); let refused = ""; try { await CU.studio.read("/etc/passwd", 0, 10); } catch (e) { refused = String(e.message || e); }
      return { name: b && b.name, tier: b && b.tier, presets: b && b.presets.map((p) => p.name), head: String.fromCharCode.apply(null, Array.from(head)), refused };
    }, sfDir);
    assert.equal(r.name, "Test Bank"); assert.equal(r.tier, "keys"); assert.deepEqual(r.presets, ["Test Sine", "Test Kit"]); assert.equal(r.head, "RIFF"); assert.match(r.refused, /not a sound bank/);
  });
  await check("a SoundFont sound from the computer plays in a render (read in parts through the app)", async () => {
    const r = await win.evaluate(async () => {
      await CUStudioSounds.refresh(); const s = CUStudioSounds.list().filter((x) => x.name === "Test Sine" && /studio-test/.test(x.file))[0];
      CUStudio.fresh({ bpm: 120, tracks: [["instrument", "Keys", s.id]] }); const t = CUStudio.project().tracks[0];
      CUStudio.edit("c", (p) => { const c = CUStudio.newClip("midi", 4); c.notes = [{ p: 60, s: 0, d: 1, v: 110 }]; p.clips[c.id] = c; p.arrangement.push({ id: "a", track: t.id, clip: c.id, start: 0, len: 4, offset: 0 }); });
      const buf = await CUStudio.bounce(), d = buf.getChannelData(0); let m = 0; for (let i = 4800; i < 24000; i++) m = Math.max(m, Math.abs(d[i]));
      return m;
    });
    assert.ok(r > 0.05, "peak " + r);
  });
  await check("projects are saved as files in the app's folder and open again", async () => {
    const r = await win.evaluate(async () => { CUStudio.fresh({ name: "On disk", bpm: 77 }); const id = await CUStudio.save(); CUStudio.fresh({}); await CUStudio.open(id); return [CUStudio.project().name, CUStudio.project().bpm, (await CUStudio.list()).length]; });
    assert.deepEqual(r, ["On disk", 77, 1]);
    assert.ok(fs.readdirSync(path.join(userData, "studio")).length === 1);
  });
  await check("cu-studio (the low-delay player) starts and answers, or says why not", async () => {
    const bin = path.join(here, "native", "build", "cu-studio");
    const r = await win.evaluate(async () => { const m = await CUStudio.startMonitor(); await new Promise((r) => setTimeout(r, 1500)); const s = CUStudio.monitor(); return { started: !!s.started, ok: s.ok, error: s.error, lat: s.latencyMs }; });
    if (fs.existsSync(bin)) assert.ok(r.ok || r.error, JSON.stringify(r)); else assert.match(r.error || "", /isn't installed/);
  });
  await app.close();
} else console.log("  - the app part needs Electron and a display (xvfb-run -a) - skipped");
console.log(failures ? failures + " failed" : "Studio: all passed"); process.exit(failures ? 1 : 0);
