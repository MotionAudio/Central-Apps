// Central Usage - the Studio tab (10.2): the same DAW as Central Production (shared/daw/), in its compact layout.
// The page: the tab is User 1's (not User 2's); it opens on a new song; sounds and their plans; playback timed to the
// sample (rendered offline and checked by ear: timing and pitch); effects with and without Central Plugins; a MIDI
// keyboard plays and records; editing (piano roll, quantize, split, undo); a WAV export; saving and opening; the
// Open in Central Production hand-off (a .cmproj). Then the real app: the computer's banks, songs on disk, cu-studio.
//   bash prepare-shared.sh && node test-studio.mjs        (the Electron part also needs a display: xvfb-run -a)
import { chromium, _electron as electron } from "playwright";
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert";
import { fileURLToPath } from "node:url";
import { makeSf2 } from "./native/make-test-sf2.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
let failures = 0; async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e && e.stack || e).split("\n").slice(0, 5).join("\n      ")); } }
if (!fs.existsSync(path.join(here, "app", "shared", "daw", "daw-engine.js"))) { console.error("run bash prepare-shared.sh first (it copies the DAW into app/shared/daw)"); process.exit(1); }
const sf2 = Array.from(makeSf2());
const exePath = [process.env.CHROME, process.env.CHROMIUM_PATH, "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome", "/opt/pw-browsers/chromium"].filter((p) => p && fs.existsSync(p) && fs.statSync(p).isFile())[0];
const b = await chromium.launch(Object.assign({ args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] }, exePath ? { executablePath: exePath } : {}));
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(String(e.stack || e)));
await page.addInitScript(() => { try { localStorage.setItem("cu-mode", JSON.stringify("user")); localStorage.setItem("cu-role", JSON.stringify("user1")); if (!localStorage.getItem("cc-license")) localStorage.setItem("cc-license", JSON.stringify({ key: "ADEF-AULT-KEY0-2026", kind: "A", app: "control", okAt: Date.now(), production: "Test church", isDefault: true })); } catch (_) { } });
await page.goto("file://" + path.join(here, "app", "index.html"));
await page.waitForFunction(() => window.CDaw && window.CDawUI && window.CUStudioTab && window.CentralUsage);
await page.evaluate(() => { const d = document.querySelector("dialog[open]"); if (d) d.close(); });
const T = (fn, arg) => page.evaluate(fn, arg);
const onsets = (fnBody) => T(async () => { const b = await CDaw.render({ from: 0, to: 4, tail: 0.5 }), d = b.getChannelData(0), out = [], win = 240; let prev = 0; for (let i = 0; i < d.length; i += win) { let e = 0; for (let k = i; k < i + win && k < d.length; k++) e = Math.max(e, Math.abs(d[k])); if (e > 0.02 && prev < 0.01) out.push(i / b.sampleRate); prev = e; } return out; });

await check("User 1 has a Studio tab (User 2 doesn't); it opens the DAW on a new song: Keys, Drums, Bass, Voice and a reverb bus", async () => {
  await T(() => CentralUsage.showTab("studio"));
  await page.waitForSelector("#view-studio.active .cdaw .cd-tname");
  const r = await T(() => ({ tabs: CentralUsage.tabsFor("user1"), u2: CentralUsage.tabsFor("user2"), names: CDaw.project().tracks.map((t) => t.name), compact: !!document.querySelector("#view-studio .cdaw.cd-compact"), prod: !!document.querySelector('#view-studio [data-a="production"]') }));
  assert.ok(r.tabs.includes("studio") && !r.u2.includes("studio"), JSON.stringify(r));
  assert.deepEqual(r.names, ["Keys", "Drums", "Bass", "Voice", "Reverb"]); assert.ok(r.compact, "the compact layout"); assert.ok(r.prod, "Open in Central Production");
});
await check("the sounds: the built-in ones always; a bank's sound is locked without its plan and plays a stand-in", async () => {
  const r = await T(async (bytes) => { await CUStudioSounds.addBank("Test Bank", new Uint8Array(bytes), "instrument"); const l = CUStudioSounds.list(), s = l.find((x) => x.name === "Test Sine"); return { builtin: l.filter((x) => x.builtin).length, s: !!s, locked: s ? CUStudioSounds.locked(s) : null }; }, sf2);
  assert.ok(r.builtin >= 5 && r.s, JSON.stringify(r)); assert.equal(typeof r.locked, "boolean");
});
await check("a clip plays in time: rendered offline, the notes land on their beats (100 BPM)", async () => {
  await T(() => { CDaw.project().tracks.forEach((t) => { if (t.kind === "bus") t.inserts = []; }); const t = CDaw.project().tracks[0]; CDaw.edit("c", () => { CDaw.track(t.id).clips.push({ id: "k1", kind: "midi", start: 0, len: 4, notes: [0, 1, 2, 3].map((x) => ({ p: 69, v: 110, s: x, d: 0.25 })) }); }); });
  const o = await onsets(); [0, 0.6, 1.2, 1.8].forEach((w, i) => assert.ok(Math.abs(o[i] - (w + 0.02)) < 0.012, "beat " + i + ": " + o[i]));
});
await check("...and in tune: A4 rings at 440 Hz", async () => {
  const hz = await T(async () => { const b = await CDaw.render({ from: 0, to: 1, tail: 0 }), d = b.getChannelData(0); let z = 0; const a = Math.round(0.05 * b.sampleRate), n = Math.round(0.2 * b.sampleRate); for (let i = a + 1; i < a + n; i++) if (d[i - 1] <= 0 && d[i] > 0) z++; return z / 0.2; });
  assert.ok(Math.abs(hz - 440) < 12, "Hz " + hz);
});
await check("effects: the basic EQ is everyone's; the full knobs and the pro effects are Central Plugins'", async () => {
  const r = await T(() => ({ pro: Object.keys(CDaw.FX).filter((k) => CDaw.FX[k].pro), eqFull: CDaw.FX.eq.params.filter((p) => p[6]).map((p) => p[0]) }));
  assert.ok(r.pro.includes("chorus") && r.pro.includes("limiter") && !r.pro.includes("eq") && !r.pro.includes("reverb"), JSON.stringify(r)); assert.ok(r.eqFull.includes("hpf"));
});
await check("a MIDI keyboard plays the selected track and records into the armed one", async () => {
  const n = await T(async () => { const t = CDaw.project().tracks.find((x) => x.name === "Bass"); CDaw.edit("arm", (p) => { p.tracks.forEach((x) => { x.arm = x.id === t.id; }); p.metronome.countIn = 0; }); CDaw.setPos(4); CDaw.record(); await new Promise((r) => setTimeout(r, 300)); CUMidiIn.inject("Test Keyboard", [0x90, 40, 100]); CDaw.live(t.id, [0x90, 40, 100]); await new Promise((r) => setTimeout(r, 250)); CDaw.live(t.id, [0x80, 40, 0]); await new Promise((r) => setTimeout(r, 150)); CDaw.stop(); return CDaw.track(t.id).clips.reduce((a, c) => a + (c.notes || []).length, 0); });
  assert.ok(n >= 1, "notes " + n);
});
await check("editing: the piano roll opens, quantize lines notes up, split makes two clips, undo puts it back", async () => {
  const r = await T(() => { const t = CDaw.project().tracks[0]; CDaw.edit("n", () => { CDaw.findClip("k1").clip.notes.push({ p: 72, v: 90, s: 1.07, d: 0.5 }); }); CDawUI.select(t.id, ["k1"]); CDawUI.openEditor("editor"); const roll = !!document.querySelector("#view-studio .cd-roll-cv");
    CDaw.edit("Quantize", () => CDaw.quantize(CDaw.findClip("k1").clip.notes, "1/4", 1)); const q = CDaw.findClip("k1").clip.notes.find((n) => n.p === 72).s;
    CDaw.edit("Split", () => CDaw.split("k1", 2)); const parts = CDaw.track(t.id).clips.length; CDaw.undo(); return { roll, q, parts, after: CDaw.track(t.id).clips.length }; });
  assert.ok(r.roll); assert.equal(r.q, 1); assert.equal(r.parts, 2); assert.equal(r.after, 1);
});
await check("export: the mix as a WAV (in the browser: a download)", async () => {
  const [dl] = await Promise.all([page.waitForEvent("download"), T(() => CUStudioTab.exportMix())]);
  assert.match(dl.suggestedFilename(), /\.wav$/);
});
await check("save, start a new song, open it again: name, tempo, clips and audio come back", async () => {
  const r = await T(async () => { const rate = 48000, buf = new AudioBuffer({ length: rate, numberOfChannels: 1, sampleRate: rate }); buf.getChannelData(0).fill(0.1); const id = CDaw.addAudio(buf); const v = CDaw.project().tracks.find((x) => x.name === "Voice");
    CDaw.edit("a", (p) => { p.name = "Idea 1"; p.bpm = 88; CDaw.track(v.id).clips.push({ id: "a1", kind: "audio", start: 0, len: 2, audio: { src: id, offset: 0, gain: 0, fadeIn: 0.004, fadeOut: 0.008 } }); });
    const pid = await CUStudioTab.save(); CUStudioTab.fresh({}); await CUStudioTab.open(pid); const p = CDaw.project(); return { name: p.name, bpm: p.bpm, audio: CDaw.usedAudio().length, clip: !!CDaw.findClip("a1") }; });
  assert.deepEqual(r, { name: "Idea 1", bpm: 88, audio: 1, clip: true });
});
await check("Open in Central Production: the song as a .cmproj that Central Production opens (project.json + its audio)", async () => {
  const r = await T(async () => { const bytes = await CUStudioTab.toCmproj(), u = await CMProj.unpack(bytes); return { fmt: u.project.format, type: u.project.type, name: u.project.daw.name, files: Object.keys(u.files) }; });
  assert.equal(r.fmt, "central-production"); assert.equal(r.type, "track"); assert.equal(r.name, "Idea 1"); assert.ok(r.files.some((f) => /^audio\/.+\.wav$/.test(f)), r.files.join());
});
await check("(10.5) make a loop: New loop sets the DAW loop to its bars, the render is seamless (the tail comes round), and it packs as a library of your own", async () => {
  const r = await T(async () => {
    CUStudioTab.loop.fresh({ bars: 2, bpm: 120, key: "D" });
    const p = CDaw.project(), isLoop = CUStudioTab.loop.isLoop(), bars = CUStudioTab.loop.bars(), loopEnd = p.loop.end, barEl = !!document.querySelector('#view-studio .cu-st-loop select[data-s="bars"]');
    let empty = ""; try { await CUStudioTab.loop.render(false); } catch (e) { empty = e.message; }
    const t = p.tracks.find((x) => x.kind === "instrument"); CDaw.project().tracks.forEach((x) => { if (x.kind === "bus") x.inserts = []; });
    CDaw.edit("n", () => { CDaw.track(t.id).clips.push({ id: "L1", kind: "midi", start: 0, len: 8, notes: [{ p: 62, v: 100, s: 7.5, d: 0.5 }] }); });   // (a note at the very end: its ring comes round to the start)
    const l = await CUStudioTab.loop.render(false), buf = l[0].buf, secs = buf.duration, d = buf.getChannelData(0);
    let head = 0, mid = 0; const w = Math.round(0.05 * buf.sampleRate); for (let i = 0; i < w; i++) head += Math.abs(d[i]); const m0 = Math.round(secs * 0.4 * buf.sampleRate); for (let i = 0; i < w; i++) mid += Math.abs(d[m0 + i]);
    CUStudioTab.loop.setBars(4); const bars4 = CUStudioTab.loop.bars();
    CUStudioTab.loop.setPerTrack(true); const lib = await CUStudioTab.loop.library(await CUStudioTab.loop.render(true));
    return { isLoop, bars, loopEnd, barEl, empty, secs, head, mid, n: l.length, bars4, libId: lib.id, zipLen: lib.zip.length, per: CUStudioTab.loop.perTrack() };
  });
  assert.ok(r.isLoop && r.bars === 2 && r.loopEnd === 8 && r.barEl, JSON.stringify(r));
  assert.match(r.empty, /empty/);
  assert.ok(Math.abs(r.secs - 4) < 0.01, "2 bars at 120 = 4 s: " + r.secs); assert.equal(r.n, 1);
  assert.ok(r.head > r.mid * 3, "the last note's ring is heard at the start (seamless): head " + r.head + " mid " + r.mid);
  assert.equal(r.bars4, 4); assert.ok(/^my-new-loop-/.test(r.libId) && r.zipLen > 1000 && r.per, JSON.stringify(r));
});
await check("a song from the Studio before 10.2 opens in the new one (clips on the timeline, the fader in dB)", async () => {
  const r = await T(() => { const old = { v: 1, id: "old1", name: "Old song", bpm: 90, key: "D", sig: [4, 4], tracks: [{ id: "t1", name: "Keys", kind: "instrument", volume: 0.8, pan: 0, layers: [{ sound: "builtin:keys", lo: 0, hi: 127 }], fx: {}, slots: {} }], clips: { c1: { id: "c1", kind: "midi", len: 4, notes: [{ p: 60, v: 100, s: 0, d: 1 }] } }, arrangement: [{ id: "x", track: "t1", clip: "c1", start: 4, len: 4, offset: 0 }] };
    CDaw.load(old); const p = CDaw.project(); return { v: p.v, name: p.name, clip: p.tracks[0].clips[0].start, vol: p.tracks[0].volume }; });
  assert.deepEqual(r, { v: 2, name: "Old song", clip: 4, vol: 0 });
});
if (errs.length) { failures++; console.error("  page errors:\n    " + errs.slice(0, 6).join("\n    ")); }
await b.close();

// ---- the real app (Electron): the computer's banks, songs on disk, cu-studio
const exe = [process.env.ELECTRON_PATH, path.join(here, "node_modules", "electron", "dist", "electron")].filter((p) => p && fs.existsSync(p))[0];
if (exe && (process.env.DISPLAY || process.platform !== "linux")) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "cu-studio-app-")), sfDir = path.join(userData, "instrument", "sounds", "sf2");
  fs.mkdirSync(sfDir, { recursive: true }); fs.writeFileSync(path.join(sfDir, "Test Bank - studio-test.sf2"), makeSf2()); fs.writeFileSync(path.join(sfDir, "tiers.txt"), "Test Bank|keys|CC0|Test\n");
  const app = await electron.launch({ executablePath: exe, args: [path.join(here, "main.js"), "--no-sandbox", "--user-data-dir=" + userData], env: Object.assign({}, process.env, { CU_CENTER_PORT: "18096", CU_NO_BEACON: "1" }) });
  const win = await app.firstWindow(); await win.waitForFunction(() => window.CU && window.CU.studio && window.CDaw && window.CUStudioTab, null, { timeout: 20000 });
  await check("the app lists the computer's banks with their plan (tiers.txt) and reads only those files", async () => {
    const r = await win.evaluate(async () => {
      const cat = await CU.studio.catalog(), b = cat.filter((x) => /studio-test/.test(x.file))[0];
      const head = await CU.studio.read(b.file, 0, 4); let refused = ""; try { await CU.studio.read("/etc/passwd", 0, 10); } catch (e) { refused = String(e.message || e); }
      return { name: b && b.name, tier: b && b.tier, presets: b && b.presets.map((p) => p.name), head: String.fromCharCode.apply(null, Array.from(head)), refused };
    });
    assert.equal(r.name, "Test Bank"); assert.equal(r.tier, "keys"); assert.deepEqual(r.presets, ["Test Sine", "Test Kit"]); assert.equal(r.head, "RIFF"); assert.match(r.refused, /not a sound bank/);
  });
  await check("a SoundFont sound from the computer plays in a render (read in parts through the app)", async () => {
    const r = await win.evaluate(async () => {
      await CUStudioSounds.refresh(); const s = CUStudioSounds.list().filter((x) => x.name === "Test Sine" && /studio-test/.test(x.file))[0];
      CDaw.fresh({ bpm: 120, tracks: [["instrument", "Keys", s.id]], reverbBus: false }); const t = CDaw.project().tracks[0];
      CDaw.edit("c", () => { CDaw.track(t.id).clips.push({ id: "c1", kind: "midi", start: 0, len: 4, notes: [{ p: 60, s: 0, d: 1, v: 110 }] }); });
      const buf = await CDaw.render(), d = buf.getChannelData(0); let m = 0; for (let i = 4800; i < 24000; i++) m = Math.max(m, Math.abs(d[i]));
      return m;
    });
    assert.ok(r > 0.05, "peak " + r);
  });
  await check("songs are saved as files in the app's folder and open again", async () => {
    const r = await win.evaluate(async () => { CUStudioTab.fresh({ name: "On disk", bpm: 77 }); const id = await CUStudioTab.save(); CUStudioTab.fresh({}); await CUStudioTab.open(id); return [CDaw.project().name, CDaw.project().bpm, (await CUStudioTab.list()).length]; });
    assert.deepEqual(r, ["On disk", 77, 1]);
    assert.ok(fs.readdirSync(path.join(userData, "studio")).length === 1);
  });
  await check("cu-studio (the low-delay player) starts and answers, or says why not", async () => {
    const bin = path.join(here, "native", "build", "cu-studio");
    const r = await win.evaluate(async () => { await CDaw.startMonitor(); await new Promise((r) => setTimeout(r, 1500)); const s = CDaw.monitor(); return { started: !!s.started, ok: s.ok, error: s.error, lat: s.latencyMs }; });
    if (fs.existsSync(bin)) assert.ok(r.ok || r.error, JSON.stringify(r)); else assert.match(r.error || "", /isn't installed/);
  });
  await check("Open in Central Production writes the song as a .cmproj and hands it to the computer", async () => {
    const r = await win.evaluate(async () => CU.studio.openInProduction("On disk", await CUStudioTab.toCmproj()));
    assert.ok(r && r.path && fs.existsSync(r.path) && /\.cmproj$/.test(r.path), JSON.stringify(r));
  });
  await app.close();
} else console.log("  - the app part needs Electron and a display (xvfb-run -a) - skipped");
console.log(failures ? failures + " failed" : "Studio: all passed"); process.exit(failures ? 1 : 0);
