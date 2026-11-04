// The DAW under load (10.2): 32 tracks at 48 kHz - 16 audio tracks with clips and 16 instrument tracks with MIDI, every
// track sending to a reverb bus and a delay bus, EQ + compressor on half of them, chorus / drive / a Central FX plugin
// on a few, the master limiter. It reports:
//   - the offline render (an export): how many times faster than real time
//   - real-time playback for a while: the browser's CPU (all its processes, from the DevTools protocol) and the
//     dropouts the audio output saw (AudioContext.playbackStats: underruns), plus how far the audio clock fell behind
//   node test-load.mjs [seconds]     (CHROME=<chromium>; LOAD_JSON=<file> writes the numbers)
// It reports; with LOAD_STRICT=1 it fails if the export is slower than real time or playback has more than
// LOAD_MAX_UNDERRUNS (default 3) underruns - meant for a real computer (a small cloud machine is far below one).
import { chromium } from "playwright";
import http from "node:http"; import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url)), pub = path.join(here, "..", "server", "public"), secs = Number(process.argv[2] || 30);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".json": "application/json" };
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"); let f = path.join(pub, decodeURIComponent(u.pathname)); if (f.endsWith("/")) f += "index.html";
  if (u.pathname.startsWith("/v1/")) { res.writeHead(404, { "Content-Type": "application/json" }); return res.end("{}"); }
  if (!f.startsWith(pub) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" }); res.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const exe = [process.env.CHROME, "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome"].filter((p) => p && fs.existsSync(p))[0];
const browser = await chromium.launch(Object.assign({ args: ["--autoplay-policy=no-user-gesture-required"] }, exe ? { executablePath: exe } : {}));
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } }); const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
await page.goto("http://127.0.0.1:" + srv.address().port + "/production/");
await page.waitForFunction(() => window.CP && window.CDaw && document.querySelector(".cp-kinds"));

// the song: 32 tracks, 32 bars at 120 BPM (64 s)
await page.evaluate((o) => { window.__noCmfx = !!o.nc; window.__n = o.n; window.__only = o.only; window.__bare = o.bare; window.__beats = o.beats; window.__nosend = o.nosend; window.__noins = o.noins; }, { beats: Number(process.env.LOAD_BEATS || 64), nosend: !!process.env.LOAD_NOSEND, noins: !!process.env.LOAD_NOINS, bare: !!process.env.LOAD_BARE, nc: !!process.env.LOAD_NO_CMFX, n: Number(process.env.LOAD_TRACKS || 32), only: process.env.LOAD_ONLY || "" });
const built = await page.evaluate(async () => {
  CP.setDirty(false); CDaw.markSaved(); await CP.create("track", { name: "Load test" });
  const rate = CDaw.ctx().sampleRate, bars = 32, uid = CDaw.uid;
  const loop = (f, kind) => { const n = rate * 4, b = new AudioBuffer({ numberOfChannels: 2, length: n, sampleRate: rate }); for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); let lp = 0; for (let i = 0; i < n; i++) { const t = i / rate, env = Math.exp(-((t * 2) % 0.5) * 8); lp += 0.2 * ((Math.random() * 2 - 1) - lp); d[i] = (kind ? lp * env : Math.sin(2 * Math.PI * f * t) * 0.3 * env) * 0.5; } } return CDaw.addAudio(b); };
  const srcs = Array.from({ length: 8 }, (_, i) => loop(110 * (i + 1), i % 2));
  const trem = (window.CPPluginPresets || []).find((p) => p.name === "Tremolo");
  let fxCount = 0, clips = 0;
  CDaw.edit("load", (p) => {
    p.bpm = 120; p.tracks = []; p.markers = [];
    const rev = CDaw.newTrack("bus", "Reverb"), dly = CDaw.newTrack("bus", "Delay");
    rev.inserts = [{ id: uid("f"), type: "reverb", on: true, params: { type: 1, mix: 1 } }]; dly.inserts = [{ id: uid("f"), type: "delay", on: true, params: { time: 3, feedback: 0.35, mix: 1 } }];
    const N = window.__n || 32;
    for (let i = 0; i < N; i++) {
      const audio = window.__only ? window.__only === "audio" : i < N / 2, t = CDaw.newTrack(audio ? "audio" : "instrument", (audio ? "Audio " : "Keys ") + (i + 1));
      for (let b = 0; b < bars; b += 2) {
        if (audio) t.clips.push({ id: uid("c"), kind: "audio", start: b * 4, len: 8, name: "", audio: { src: srcs[(i + b) % srcs.length], offset: 0, gain: -6, fadeIn: 0.005, fadeOut: 0.01, loop: true } });
        else t.clips.push({ id: uid("c"), kind: "midi", start: b * 4, len: 8, name: "", notes: Array.from({ length: 16 }, (_, k) => ({ p: 48 + ((i * 3 + k * 5) % 24), v: 80 + (k % 4) * 10, s: k * 0.5, d: 0.45 })) });
        clips++;
      }
      t.volume = -12; if (!window.__bare && !window.__nosend) t.sends = [{ to: rev.id, level: -14, pre: false }, { to: dly.id, level: -20, pre: false }];
      if (i % 2 === 0 && !window.__bare && !window.__noins) t.inserts.push({ id: uid("f"), type: "eq", on: true, params: { low: 2, high: -1 } }, { id: uid("f"), type: "comp", on: true, params: {} });
      if (i % 8 === 1) t.inserts.push({ id: uid("f"), type: "chorus", on: true, params: {} });
      if (i % 8 === 5) t.inserts.push({ id: uid("f"), type: "drive", on: true, params: {} });
      if ((i === 3 || i === 19) && trem && !window.__noCmfx) t.inserts.push({ id: uid("f"), type: "cmfx", on: true, plugin: trem, params: CDaw.fxDefaults({ type: "cmfx", plugin: trem }) });
      fxCount += t.inserts.length; p.tracks.push(t);
    }
    p.tracks.push(rev, dly);
  });
  return { rate, tracks: CDaw.project().tracks.filter((t) => t.kind !== "bus").length, buses: 2, clips, inserts: fxCount, cmfx: !!trem };
});
console.log(`Load: ${built.tracks} tracks + ${built.buses} buses at ${built.rate / 1000} kHz, ${built.clips} clips, ${built.inserts} track inserts (Central FX: ${built.cmfx && !process.env.LOAD_NO_CMFX ? "2" : "none"}), every track with 2 sends`);

// (a short one first, to see it's alive)
if (process.env.LOAD_DEBUG) console.log("  1 bar:", await page.evaluate(async () => { const t0 = performance.now(); await CDaw.render({ from: 0, to: 4, tail: 0, exact: true }); return Math.round(performance.now() - t0) + " ms"; }));
// 1. the export: 16 bars (32 s), offline
const off = await page.evaluate(async () => { const t0 = performance.now(); const b = await CDaw.render({ from: 0, to: window.__beats || 64, tail: 0, exact: true }); const ms = performance.now() - t0; let pk = 0; const d = b.getChannelData(0); for (let i = 0; i < d.length; i += 7) pk = Math.max(pk, Math.abs(d[i])); return { audio: b.duration, ms, peak: pk }; });
const speed = off.audio / (off.ms / 1000);
console.log(`  export (offline): ${off.audio.toFixed(1)} s of the song in ${(off.ms / 1000).toFixed(2)} s = ${speed.toFixed(1)}× real time (peak ${off.peak.toFixed(2)})`);

if (process.env.LOAD_ABLATE) { console.log(await page.evaluate(async () => { const r = {}, base = JSON.parse(JSON.stringify(CDaw.project())); const time = async (name, fn) => { CDaw.edit("x", (p) => { Object.assign(p, JSON.parse(JSON.stringify(base))); fn && fn(p); }); const t0 = performance.now(); await CDaw.render({ from: 0, to: 16, tail: 0, exact: true }); r[name] = (8 / ((performance.now() - t0) / 1000)).toFixed(2) + "x"; }; await time("all"); await time("no buses", (p) => { p.tracks = p.tracks.filter((t) => t.kind !== "bus"); p.tracks.forEach((t) => { t.sends = []; }); }); await time("no inserts", (p) => p.tracks.forEach((t) => { if (t.kind !== "bus") t.inserts = []; })); await time("no midi", (p) => { p.tracks = p.tracks.filter((t) => t.kind !== "instrument"); }); await time("no audio", (p) => { p.tracks = p.tracks.filter((t) => t.kind !== "audio"); }); await time("nothing on master", (p) => { p.master.inserts = []; }); return r; })); await browser.close(); srv.close(); process.exit(0); }
if (process.env.LOAD_NOPLAY) { await browser.close(); srv.close(); process.exit(0); }
// 2. playing it, in real time
const cdp = await browser.newBrowserCDPSession();
const cpu = async () => { const l = (await cdp.send("SystemInfo.getProcessInfo")).processInfo; const by = {}; l.forEach((p) => { by[p.type] = (by[p.type] || 0) + p.cpuTime; }); return by; };
const before = await page.evaluate(() => { const c = CDaw.ctx(), s = c.playbackStats; return { under: s ? s.underrunEvents : null, underDur: s ? s.underrunDuration : null, total: s ? s.totalDuration : null }; });
if (process.env.LOAD_HIDE) await page.evaluate((w) => { if (w === "ui") document.querySelector(".cdaw").style.display = "none"; if (w === "meters") document.querySelectorAll(".cd-hmeter").forEach((c) => c.remove()); const css = { phlayer: ".cd-playhead{will-change:transform}", phhide: ".cd-playhead{visibility:hidden}", posfix: ".cd-pos,.cd-time{contain:strict;width:9ch;height:1.4em;display:inline-block}", all: ".cd-playhead{visibility:hidden}.cd-pos,.cd-time,.cd-hmeter{visibility:hidden}", combo: ".cd-playhead{will-change:transform}.cd-pos,.cd-time{visibility:hidden}", "phl-nopos-nometer": ".cd-playhead{will-change:transform}", "phl-nometer": ".cd-playhead{will-change:transform}", "phl-nopos": ".cd-playhead{will-change:transform}", cv: ".cd-row{content-visibility:auto;contain-intrinsic-size:auto 58px}", noccv: ".cd-ccv{display:none}", nohm: ".cd-hmeter{display:none}", nosticky: ".cd-head{position:relative!important}" }[w]; if (w === "combo") document.querySelectorAll(".cd-hmeter").forEach((c) => c.remove()); if (w === "all") document.querySelectorAll(".cd-hmeter").forEach((c) => c.remove()); if (w === "raf") { window.requestAnimationFrame = () => 0; } if (w === "half") { const r0 = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (fn) => setTimeout(() => r0(fn), 20); } const U2 = window.CDawUI; if (/noph/.test(w)) U2.parts.arrange.playhead = () => { }; if (/nopos/.test(w)) { U2.posText = () => "x"; U2.timeText = () => "x"; } if (/nometer/.test(w)) U2.parts.arrange.meters = () => { }; if (/noed/.test(w) && U2.parts.editors) U2.parts.editors.playhead = () => { }; if (/nomix/.test(w) && U2.parts.mixer) U2.parts.mixer.meters = () => { }; window.__dock = [U2.U.dockOpen, U2.U.dock]; if (css) { const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st); } }, process.env.LOAD_HIDE);   // (10.4: what the screen costs)
const c0 = await cpu(), w0 = Date.now(); if (process.env.LOAD_HIDE) console.log("  dock", await page.evaluate(() => JSON.stringify(window.__dock)));
await page.evaluate(() => { window.__clk = []; CDaw.setPos(0); CDaw.play(); const c = CDaw.ctx(), t0 = performance.now(), a0 = c.currentTime; window.__clkT = setInterval(() => { window.__clk.push((c.currentTime - a0) - (performance.now() - t0) / 1000); }, 500); });
let prof = null, met = null, m0 = null;
if (process.env.LOAD_METRICS) { met = await page.context().newCDPSession(page); await met.send("Performance.enable"); m0 = Object.fromEntries((await met.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value])); }
if (process.env.LOAD_PROFILE) {   // (10.4) where the page's own time goes while it plays: the top functions by self time
  prof = await page.context().newCDPSession(page); await prof.send("Profiler.enable"); await prof.send("Profiler.setSamplingInterval", { interval: 500 }); await prof.send("Profiler.start");
}
if (process.env.LOAD_TRACE) {   // (10.4) what the page's main thread does each frame
  const tr = await page.context().newCDPSession(page), events = []; tr.on("Tracing.dataCollected", (e) => events.push(...e.value));
  await page.waitForTimeout(2000); await tr.send("Tracing.start", { categories: "devtools.timeline,disabled-by-default-devtools.timeline,blink,cc,gpu,viz", transferMode: "ReportEvents" }); await page.waitForTimeout(3000);
  const done = new Promise((r) => tr.once("Tracing.tracingComplete", r)); await tr.send("Tracing.end"); await done;
  const names = {}; events.forEach((e) => { if (e.ph === "M" && e.name === "thread_name") names[e.pid + ":" + e.tid] = e.args.name; });
  const agg = {}; events.forEach((e) => { if (e.ph !== "X" || !e.dur) return; const th = names[e.pid + ":" + e.tid] || "?"; if (!/CrRendererMain|Compositor|Raster|AudioOutput|VizCompositor/.test(th)) return; const k = th.replace(/\d+/g, "") + " | " + e.name; agg[k] = (agg[k] || 0) + e.dur / 1000; });
  Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 30).forEach(([k, v]) => console.log("    " + v.toFixed(0).padStart(6) + " ms  " + k));
}
await page.waitForTimeout(secs * 1000);
if (met) { const m1 = Object.fromEntries((await met.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value])); console.log("  page metrics over the playback: " + ["TaskDuration", "ScriptDuration", "LayoutDuration", "RecalcStyleDuration", "LayoutCount", "RecalcStyleCount", "Nodes", "JSEventListeners"].map((k) => k + " " + (/Duration/.test(k) ? ((m1[k] - m0[k]) * 1000).toFixed(0) + " ms" : Math.round(m1[k] - (/Count/.test(k) ? m0[k] : 0)))).join(", ")); }
if (prof) {
  const { profile } = await prof.send("Profiler.stop"), self = {}, byId = {}; profile.nodes.forEach((n) => { byId[n.id] = n; });
  const dt = profile.timeDeltas, total = (profile.endTime - profile.startTime) / 1000; const cnt = {}; profile.samples.forEach((id, i) => { cnt[id] = (cnt[id] || 0) + (dt[i] || 0); });
  Object.keys(cnt).forEach((id) => { const n = byId[id], cf = n.callFrame, k = (cf.functionName || "(anon)") + " " + (cf.url || "").split("/").pop() + ":" + (cf.lineNumber + 1); self[k] = (self[k] || 0) + cnt[id] / 1000; });
  const top = Object.entries(self).sort((a, b) => b[1] - a[1]).slice(0, 30);
  console.log("  main thread over " + (total / 1000).toFixed(1) + " s (ms of self time):"); top.forEach(([k, v]) => console.log("    " + v.toFixed(0).padStart(6) + "  " + k));
}
const after = await page.evaluate(() => { clearInterval(window.__clkT); CDaw.stop(); const c = CDaw.ctx(), s = c.playbackStats; return { under: s ? s.underrunEvents : null, underDur: s ? s.underrunDuration : null, total: s ? s.totalDuration : null, lat: s ? s.averageLatency : null, drift: window.__clk, base: c.baseLatency, out: c.outputLatency }; });
const c1 = await cpu(), wall = (Date.now() - w0) / 1000, cores = os.cpus().length;
const d = (k) => (c1[k] || 0) - (c0[k] || 0), total = Object.keys(c1).reduce((a, k) => a + d(k), 0);
const underruns = after.under != null ? after.under - before.under : null, underMs = after.underDur != null ? (after.underDur - before.underDur) * 1000 : null;
const drift = after.drift.length ? Math.min(...after.drift) - after.drift[0] : 0;
console.log(`  playing ${wall.toFixed(0)} s: CPU ${(total / wall * 100).toFixed(0)}% of one core (${(total / wall / cores * 100).toFixed(0)}% of this ${cores}-core machine) - renderer ${(d("renderer") / wall * 100).toFixed(0)}%, audio service ${(d("audio.mojom.AudioService") / wall * 100).toFixed(0)}%, browser ${(d("browser") / wall * 100).toFixed(0)}%, GPU ${(d("GPU") / wall * 100).toFixed(0)}%`);
console.log(`  dropouts: ${underruns == null ? "(no playbackStats in this browser)" : underruns + " underrun" + (underruns === 1 ? "" : "s") + " (" + underMs.toFixed(1) + " ms of silence)"}; the audio clock fell ${Math.max(0, -drift * 1000).toFixed(0)} ms behind the wall clock; output latency ${(after.base * 1000).toFixed(1)} + ${(after.out * 1000).toFixed(1)} ms`);
if (errs.length) console.log("  page errors: " + errs.join("; "));
const out = { built, export: { seconds: off.audio, ms: off.ms, speed }, play: { seconds: wall, cpuOneCore: total / wall, cpuMachine: total / wall / cores, cores, byProcess: Object.fromEntries(Object.keys(c1).map((k) => [k, d(k) / wall])), underruns, underrunMs: underMs, clockBehindMs: Math.max(0, -drift * 1000) } };
if (process.env.LOAD_JSON) fs.writeFileSync(process.env.LOAD_JSON, JSON.stringify(out, null, 2));
await browser.close(); srv.close();
const maxU = Number(process.env.LOAD_MAX_UNDERRUNS || 3), bad = process.env.LOAD_STRICT && (speed < 1 || (underruns != null && underruns > maxU)) || errs.length;
console.log(bad ? "\nthe load test FAILED" : "\nload test passed");
process.exit(bad ? 1 : 0);
