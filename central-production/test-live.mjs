// (10.3) VST3 / CLAP plugins playing live in the DAW, in the real app with the real plugin host (cu-rig) and the test
// plugins (central-usage/native/build/test-plugins: Central Test Gain as CLAP and VST3, Central Test Delay - 480 samples
// late, and it says so). The main mix is recorded as it plays (an AudioWorklet on the master), then measured:
//   - several tracks with plugins play together, in step (in-phase sines add up), with no late blocks
//   - the delay lines up: an impulse through the 480-sample plugin lands on the same sample as a dry one
//   - automation of a plugin parameter (the gain drops by half at its point)
//   - starting and stopping (silence after a stop, sound again on the next start)
//   - seeking while it plays (the impulses still line up after the seek)
//   bash prepare.sh && make -C ../central-usage/native && ELECTRON_PATH=<electron> xvfb-run -a node test-live.mjs
import { _electron as electron } from "playwright";
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url)), native = path.join(here, "..", "central-usage", "native", "build"), plugs = path.join(native, "test-plugins");
let failures = 0; async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); if (process.env.LIVE_STATS && typeof T === "function") console.log("      extra " + JSON.stringify(await T(() => [CDaw.liveFx.extra(), CDaw.liveFx.stats().late, CDaw.liveFx.stats().worstMs])).slice(0, 80)); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e && e.stack || e).split("\n").slice(0, 8).join("\n      ")); } }
const exe = [process.env.ELECTRON_PATH, path.join(here, "node_modules", "electron", "dist", "electron"), path.join(here, "..", "central-usage", "node_modules", "electron", "dist", "electron")].filter((p) => p && fs.existsSync(p))[0];
if (!exe) { console.log("SKIP: no Electron (npm install, or ELECTRON_PATH)"); process.exit(0); }
if (!fs.existsSync(path.join(native, "cu-rig")) && !fs.existsSync(path.join(native, "cu-rig.exe")) || !fs.existsSync(path.join(plugs, "central-test.clap"))) { console.log((process.env.CI ? "::warning::" : "") + "SKIP: build the native helpers and test plugins first (make -C central-usage/native)"); process.exit(0); }
const home = fs.mkdtempSync(path.join(os.tmpdir(), "cp-live-")), userData = path.join(home, "data");
const env = Object.assign({}, process.env, { HOME: home, XDG_CONFIG_HOME: path.join(home, ".config"), CC_UPDATE_API: "http://127.0.0.1:9", CLAP_PATH: plugs, VST3_PATH: plugs });
const app = await electron.launch({ executablePath: exe, args: [here, "--no-sandbox", "--autoplay-policy=no-user-gesture-required", "--user-data-dir=" + userData], env });
const win = await app.firstWindow(); const errs = []; win.on("pageerror", (e) => errs.push(String(e)));
const T = (fn, a) => win.evaluate(fn, a);
await win.waitForFunction(() => window.CP && window.CDaw && document.querySelector("#cpStart [data-new]"), null, { timeout: 90000 });
// (10.4) how soon the plugins get the sound: the app's default (Balanced, about 150 ms) on a real computer; LIVE_RESPONSE
// (fast / balanced / safe) for a busy test machine
await T((v) => CDaw.audio.set({ pluginResponse: v, keysRoute: "direct" }), process.env.LIVE_RESPONSE || "balanced");
console.log("VST3 / CLAP plugins, live:");

// the song: 120 BPM (a beat is 0.5 s). Ref: a dry impulse at beat 4, hard left. Late: the same impulse through Central Test
// Delay (480 samples) + Gain, hard right. Four sine tracks (beats 8-16) through CLAP and VST3 gains at +6 dB.
let P = null;
await check("the plugin host finds the test plugins (CLAP and VST3) and a song with 5 plugin tracks and a dry reference is set up", async () => {
  P = await T(async () => {
    CP.setDirty(false); CDaw.markSaved(); await CP.create("track", { name: "Live" });
    const list = await CDaw.native.host().list(true), by = (id, fmt) => list.find((p) => (p.id === id || p.name === id) && (!fmt || p.format === fmt));
    const gain = by("audio.motion.test-gain", "clap"), dly = by("audio.motion.test-delay", "clap"), vg = list.find((p) => p.format === "vst3" && p.name === "Central Test Gain VST3");
    if (!gain || !dly) return { list: list.map((p) => p.name) };
    const rate = CDaw.ctx().sampleRate, uid = CDaw.uid;
    const imp = new AudioBuffer({ numberOfChannels: 2, length: rate, sampleRate: rate }); imp.getChannelData(0)[4800] = imp.getChannelData(1)[4800] = 0.8;   // (100 ms in: a clip fades in over its first 3 ms)
    const sine = new AudioBuffer({ numberOfChannels: 2, length: rate * 4, sampleRate: rate }); for (let c = 0; c < 2; c++) { const d = sine.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = 0.2 * Math.sin(2 * Math.PI * 220 * i / rate); }
    const impId = CDaw.addAudio(imp), sineId = CDaw.addAudio(sine);
    const pl = (p) => ({ format: p.format, id: p.id, path: p.path, name: p.name, vendor: p.vendor || "" });
    const clip = (src, start, len) => ({ id: uid("c"), kind: "audio", start, len, name: "", audio: { src, offset: 0, gain: 0, fadeIn: 0, fadeOut: 0 } });
    CDaw.edit("set up", (p) => {
      p.bpm = 120; p.tracks = []; p.master.inserts = []; p.loop.on = false;
      const ref = CDaw.newTrack("audio", "Ref"); ref.pan = -1; ref.clips = [clip(impId, 4, 2), clip(impId, 20, 2)]; p.tracks.push(ref);
      const late = CDaw.newTrack("audio", "Late"); late.pan = 1; late.clips = [clip(impId, 4, 2), clip(impId, 20, 2)];
      late.inserts = [{ id: "fD1", type: "native", on: true, params: {}, plugin: pl(dly) }, { id: "fG1", type: "native", on: true, params: { 1: 0.5 }, plugin: pl(gain) }]; p.tracks.push(late);
      ["S1", "S2", "S3", "S4"].forEach((n, i) => { const t = CDaw.newTrack("audio", n); t.volume = -12; t.clips = [clip(sineId, 8, 8)]; const v = i % 2 && vg ? vg : gain; t.inserts = [{ id: "fS" + i, type: "native", on: true, params: v === gain ? { 1: 0.625 } : {}, plugin: pl(v) }]; p.tracks.push(t); });
    });
    return { ok: true, vst3: !!vg, rate, tracks: CDaw.liveFx.tracks().length };
  });
  assert.ok(P && P.ok, "the test plugins: " + JSON.stringify(P)); assert.equal(P.tracks, 5, "every plugin track plays live (the dry reference has none)");
  if (P.vst3) {   // the VST3 gain's own parameter: +6 dB too (its parameter list from the plugin)
    const ok = await T(async () => { const ids = CDaw.project().tracks.filter((t) => t.inserts[0] && t.inserts[0].plugin.format === "vst3").map((t) => t.id); for (const id of ids) { const t = CDaw.track(id), f = t.inserts[0], l = await CDaw.liveFx.params(id, f.id), g = l.find((q) => /gain/i.test(q.name)); if (!g) return false; CDaw.edit("knob", () => { CDaw.track(id).inserts[0].params = { [g.id]: 0.625 }; }); } return true; });
    assert.ok(ok, "the VST3 gain lists its Gain parameter");
  }
});

// the recorder: the main mix as heard, with the audio clock's time of each block
await T(() => { const c = CDaw.ctx(); window.__rec = { chunks: [] }; const n = new AudioWorkletNode(c, "cdaw-rec", { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: "explicit" }); CDaw.graph().master.mute.connect(n); n.port.onmessage = (e) => window.__rec.chunks.push(e.data); n.port.postMessage({ on: true }); window.__rec.node = n; });
const recSince = (t0) => T((t) => { const ch = window.__rec.chunks.filter((c) => c.t >= t - 0.01), rate = CDaw.ctx().sampleRate; return { t: ch.length ? ch[0].t : 0, rate, L: Array.from(ch.flatMap((c) => Array.from(c.ch[0]))), R: Array.from(ch.flatMap((c) => Array.from(c.ch[1] || c.ch[0]))) }; }, t0);
const playFrom = (beat) => T(async (b) => { CDaw.liveFx.stats().late = 0; CDaw.setPos(b); const t = CDaw.ctx().currentTime; CDaw.play(); for (let i = 0; i < 200 && !CDaw.state().playing; i++) await new Promise((r) => setTimeout(r, 20)); return { asked: t, started: CDaw.ctx().currentTime }; }, beat);
const first = (a, from, thr) => { for (let i = from || 0; i < a.length; i++) if (Math.abs(a[i]) > thr) return i; return -1; };
const rms = (a, i, j) => { let s = 0; for (let k = i; k < j; k++) s += a[k] * a[k]; return Math.sqrt(s / Math.max(1, j - i)); };

let run1 = null;
await check("playing: it waits for the plugins' first sound, then every track plays together", async () => {
  const st = await playFrom(0); assert.ok(st.started - st.asked < 2 + 2 * (await T(() => CDaw.liveFx.response().proc)), "it started within a few seconds: " + (st.started - st.asked).toFixed(2)); run1 = st;
  await win.waitForTimeout(8600);   // to beat ~17
  const late = await T(() => CDaw.liveFx.stats());
  if (process.env.LIVE_STATS) console.log("      stats " + JSON.stringify(late)); assert.equal(late.late, 0, "no block arrived late: " + JSON.stringify(late));
});
await check("the delay lines up: the impulse through the 480-sample plugin lands on the dry one's sample", async () => {
  const r = await recSince(run1.asked), iL = first(r.L, 0, 0.3), iR = first(r.R, 0, 0.3);
  if (!(Math.abs(iL - iR) <= 1)) console.log("      per track " + JSON.stringify(await T(() => ({ st: CDaw.liveFx.stats(), names: CDaw.project().tracks.map((t) => t.id + ":" + t.name) }))));
  assert.ok(iL > 0 && iR > 0, "both impulses heard: " + iL + " " + iR);
  assert.ok(Math.abs(iL - iR) <= 1, "left (dry) at " + iL + ", right (through the plugins) at " + iR + ": " + (iR - iL) + " samples apart");
});
await check("several plugin tracks in step: four in-phase sines through CLAP and VST3 gains (+6 dB) add up", async () => {
  const r = await recSince(run1.asked), i0 = first(r.L, 0, 0.3), s = i0 + 4 * 0.5 * r.rate;   // beat 8 = 2 s after the impulse at beat 4
  const lv = rms(r.L, s + 2400, s + 2400 + r.rate) * Math.SQRT2, want = (P.vst3 ? 4 : 4) * 0.2 * Math.pow(10, -12 / 20) * 2;
  assert.ok(Math.abs(lv - want) / want < 0.08, "peak level " + lv.toFixed(3) + " (want about " + want.toFixed(3) + ": every track in step, every plugin playing)");
});
await check("stopping: silence straight after, and the next start plays again", async () => {
  await T(() => CDaw.stop()); const tStop = await T(() => CDaw.ctx().currentTime); await win.waitForTimeout(700);
  const r = await recSince(tStop + 0.1); assert.ok(rms(r.L, 0, Math.min(r.L.length, r.rate * 0.4)) < 1e-3, "silent after the stop");
  const st = await playFrom(9); await win.waitForTimeout(1200); const r2 = await recSince(st.started + 0.3);
  assert.ok(rms(r2.L, 0, r.rate * 0.5) > 0.05, "the sines again after starting at beat 9");
  await T(() => CDaw.stop());
});
await check("automation: the gain plugin's parameter follows its lane (+6 dB, then 0 dB from beat 12)", async () => {
  await T(() => { const p = CDaw.project(); CDaw.edit("solo", () => { p.tracks.forEach((t) => { t.solo = t.name === "S1"; }); const t = CDaw.project().tracks.find((x) => x.name === "S1"); CDaw.track(t.id).auto = { "fx:fS0:1": [{ b: 0, v: 0.625 }, { b: 11.999, v: 0.625 }, { b: 12, v: 0.5 }] }; CDaw.track(t.id).lanes = ["fx:fS0:1"]; }); });
  const st = await playFrom(9); await win.waitForTimeout(3600); await T(() => CDaw.stop());
  const r = await recSince(st.asked), on = first(r.L, 0, 0.02), rate = r.rate;   // the sine from beat 9; beat 12 is 1.5 s later
  const a = rms(r.L, on + rate * 0.3, on + rate * 1.2), b = rms(r.L, on + rate * 1.7, on + rate * 2.6);
  assert.ok(on > 0, "it played"); assert.ok(Math.abs(a / b - 2) < 0.15, "before / after the point: " + a.toFixed(4) + " / " + b.toFixed(4) + " = " + (a / b).toFixed(2) + " (want 2)");
  await T(() => CDaw.edit("unsolo", (p) => { p.tracks.forEach((t) => { t.solo = false; t.auto = {}; t.lanes = []; }); }));
});
await check("seeking while it plays: the impulses still line up after the seek (and the plugins are reset)", async () => {
  await playFrom(8); await win.waitForTimeout(1500);
  const tSeek = await T(() => { const t = CDaw.ctx().currentTime; CDaw.setPos(18); return t; });
  await win.waitForTimeout(3500); await T(() => CDaw.stop());
  const r = await recSince(tSeek + 0.02); let iL = -1, iR = -1;
  // the impulses at beat 20 (1 s after the seek's start): the first loud samples left and right
  iL = first(r.L, 0, 0.3); iR = first(r.R, 0, 0.3);
  assert.ok(iL > 0 && iR > 0, "both impulses after the seek: " + iL + " " + iR); assert.ok(Math.abs(iL - iR) <= 1, (iR - iL) + " samples apart after the seek");
  assert.equal((await T(() => CDaw.liveFx.stats())).late, 0, "no late blocks");
});
// ---- (10.4)
await check("(10.4) a knob turned while it plays is heard within the plugin response (not 0.6 s later)", async () => {
  await T(() => { CDaw.edit("solo", (p) => { p.tracks.forEach((t) => { t.solo = t.name === "S1"; }); }); });
  const st = await playFrom(9); await win.waitForTimeout(1200);
  const tk = await T(() => { const t = CDaw.project().tracks.find((x) => x.name === "S1"), at = CDaw.ctx().currentTime; CDaw.nudge("knob", () => { CDaw.track(t.id).inserts[0].params = { 1: 0.5 }; }); return at; /* (as the panel's knobs do) */ });
  await win.waitForTimeout(1200); await T(() => CDaw.stop());
  const resp = await T(() => CDaw.liveFx.response().proc), r = await recSince(tk - 0.2), rate = r.rate, w = 256;
  const before = rms(r.L, 0, Math.round(rate * 0.15)); let at = -1;
  for (let i = Math.round(rate * 0.2); i + w < r.L.length; i += 64) if (rms(r.L, i, i + w) < before * 0.7) { at = i; break; }
  const lagMs = ((r.t + at / rate) - tk) * 1000; console.log("      knob heard after " + lagMs.toFixed(0) + " ms (plugin response " + Math.round(resp * 1000) + " ms)");
  assert.ok(at > 0, "the level dropped"); assert.ok(lagMs < resp * 1000 + 120, "heard within the response: " + lagMs.toFixed(0) + " ms");
  assert.equal((await T(() => CDaw.liveFx.stats())).late, 0, "turning a knob doesn't make anything late");
  await T(() => CDaw.edit("unsolo", (p) => { p.tracks.forEach((t) => { t.solo = false; }); const t = p.tracks.find((x) => x.name === "S1"); t.inserts[0].params = { 1: 0.625 }; }));
});
await check("(10.4) silence isn't sent to the plugins: the mostly quiet tracks go as silence marks", async () => {
  const s = await T(() => CDaw.liveFx.stats()); assert.ok(s.silent > s.batches, "silent blocks " + s.silent + " over " + s.batches + " batches");
});
await check("(10.4) a keyboard on an instrument track plays through its plugins (the page's sound through the rig, into the track)", async () => {
  const r0 = await T(async () => {
    CDaw.audio.set({ keysRoute: "track" });   // (the test has no sound card to hear "Lowest delay" on)
    const gainP = CDaw.project().tracks.find((x) => x.name === "S1").inserts[0].plugin;
    CDaw.edit("keys", (p) => { p.tracks.forEach((t) => { t.solo = false; t.mute = true; }); const k = CDaw.newTrack("instrument", "Keys"); k.mute = false; k.inserts = [{ id: "fK1", type: "native", on: true, params: { 1: 0.75 }, plugin: gainP }]; p.tracks.push(k); });
    const t = CDaw.project().tracks.find((x) => x.name === "Keys"); return { id: t.id, mode: CDaw.liveFx.keyboard().mode(t.id) };
  });
  assert.equal(r0.mode, "track", "Through the whole track");
  const play = async (ms) => T(async (a) => { const t0 = CDaw.ctx().currentTime; CDaw.live(a.id, [0x90, 69, 110]); await new Promise((r) => setTimeout(r, a.ms)); CDaw.live(a.id, [0x80, 69, 0]); return t0; }, { id: r0.id, ms });
  await play(600); await win.waitForTimeout(400);   // (the first note sets the copy of its plugins up)
  const t1 = await play(900); await win.waitForTimeout(300);
  const st = await T((id) => ({ mode: CDaw.liveFx.keyboard().mode(id), kb: !!CDaw.liveFx.keyboard().tracks[id], s: CDaw.liveFx.stats() }), r0.id);
  assert.ok(st.kb, "the track's keyboard copy of its plugins");
  const r = await recSince(t1), on = first(r.L, 0, 0.01); assert.ok(on >= 0, "the note was heard");
  const lv = rms(r.L, on + 2400, on + 2400 + r.rate * 0.3);
  await T((id) => CDaw.edit("knob", () => { CDaw.track(id).inserts[0].params = { 1: 0.5 }; }), r0.id); await win.waitForTimeout(200);
  const t2 = await play(900); await win.waitForTimeout(300); const r2 = await recSince(t2), on2 = first(r2.L, 0, 0.003), lv2 = rms(r2.L, on2 + 2400, on2 + 2400 + r2.rate * 0.3);
  console.log("      keyboard: +12 dB " + lv.toFixed(4) + ", 0 dB " + lv2.toFixed(4) + ", worst round trip " + (st.s.kbRtMax || 0).toFixed(1) + " ms");
  assert.ok(Math.abs(lv / lv2 - 3.98) < 0.5, "the knob changes the keyboard's sound: +12 dB vs 0 dB = " + (lv / lv2).toFixed(2) + " (want 3.98)");
});
await check("(10.4) an export keeps the plugin's automation", async () => {
  const lv = await T(async () => {
    CDaw.edit("auto", (p) => { const k = p.tracks.find((x) => x.name === "Keys"); if (k) k.mute = true; p.tracks.forEach((t) => { t.solo = t.name === "S1"; t.mute = false; }); const t = p.tracks.find((x) => x.name === "S1"); t.inserts[0].params = { 1: 0.625 }; t.auto = { "fx:fS0:1": [{ b: 0, v: 0.625 }, { b: 11.999, v: 0.625 }, { b: 12, v: 0.5 }] }; t.lanes = ["fx:fS0:1"]; });
    const t = CDaw.project().tracks.find((x) => x.name === "S1"), b = await CDaw.render({ from: 8, to: 16, tracks: [t.id], tail: 0 }), d = b.getChannelData(0), rate = b.sampleRate;
    const rms2 = (i, j) => { let s = 0; for (let k = i; k < j; k++) s += d[k] * d[k]; return Math.sqrt(s / (j - i)); };
    return { a: rms2(Math.round(rate * 0.3), Math.round(rate * 1.8)), b: rms2(Math.round(rate * 2.2), Math.round(rate * 3.7)), state: CDaw.native.state(t) };
  });
  assert.ok(Math.abs(lv.a / lv.b - 2) < 0.15, "before / after the point in the export: " + lv.a.toFixed(4) + " / " + lv.b.toFixed(4) + " (want 2)");
  assert.notEqual(lv.state, "frozen", "the export left the track live");
});
await check("no page errors", async () => { assert.deepEqual(errs, []); });
await T(() => { CP.setDirty(false); CDaw.markSaved(); }).catch(() => { }); await app.close();
console.log(failures ? "\n" + failures + " failed" : "\nall passed");
process.exit(failures ? 1 : 0);
