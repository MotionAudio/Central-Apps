// Central Control renderer against the simulated driver: chart transposition, sections, lyrics, MIDI relay timing
import { chromium } from "playwright";
import { spawn } from "node:child_process"; import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert";
import { fileURLToPath } from "node:url"; const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pp-cu-")); fs.mkdirSync(path.join(tmp, "media"), { recursive: true }); fs.writeFileSync(path.join(tmp, "code-chosen"), "1"); // the pairing PIN counts as picked (its own test is in test-integration)
// the center (normally inside the main admin's Central Control): here on its own, at 127.0.0.1:8095
const ctrDir = fs.mkdtempSync(path.join(os.tmpdir(), "pp-center-"));
const ctr = spawn(process.execPath, [path.join(here, "center.js"), "--port", "8095", "--data", ctrDir, "--no-beacon"], { stdio: ["ignore", "pipe", "pipe"] });
let ctrLog = ""; ctr.stdout.on("data", (b) => { ctrLog += b; }); ctr.stderr.on("data", (b) => { ctrLog += b; });
const drv = spawn("python3", [path.join(here, "..", "pedal-driver.py"), "--simulate", tmp, "--app-root", path.join(here, "..")], { stdio: ["pipe", "pipe", "pipe"], env: Object.assign({}, process.env, { CC_CENTER: "127.0.0.1:8095" }) });
let log = ""; drv.stderr.on("data", (b) => { log += b; }); drv.stdout.on("data", (b) => { log += b; });
await new Promise((r) => { const t = setInterval(() => { if (log.includes("USB/SD browser on")) { clearInterval(t); r(); } }, 100); setTimeout(r, 8000); });
let code = null;
let failures = 0; async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e && e.message || e).split("\n").slice(0, 6).join("\n      ")); } }
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
const ctx = await b.newContext({ viewport: { width: 1200, height: 800 } });
// the Pi app (so the driver has a song + chart + display state)
const pi = await ctx.newPage(); const errs = []; pi.on("pageerror", (e) => errs.push("pi:" + e));
await pi.goto("http://127.0.0.1:8766/app/#tracks"); await pi.waitForFunction(() => window.PPTracks && window.PPShell); await pi.waitForTimeout(800);
const text = "Test Song\n{key: G}\n\n[Verse 1]\nG     D\nThis is the first verse line\nAnd the second verse line\n\n[Chorus]\nC   G\nSing the chorus line here\n";
await pi.evaluate(async () => { PPTracks.newSong("Test Song"); PPFeatures.loadSong(PP.project().songs.length - 1);
  // a 12-second synthetic track so the transport works (sine + click)
  const rate = 22050, n = rate * 12, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf); const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) { const t = i / rate, ph = t % 0.5; v.setInt16(44 + i * 2, Math.round(8000 * Math.sin(2 * Math.PI * 196 * t) + (ph < 0.03 ? 12000 * Math.exp(-ph * 80) : 0)), true); }
  await PPTracks.importFilesIntoSong(PPTracks.song(), [new File([buf], "Pad.wav", { type: "audio/wav" })], { analyze: true });
});
const r = await fetch("http://127.0.0.1:8080/api/upload?kind=charts&name=Test%20Song.txt&song=Test%20Song", { method: "POST", body: text }); assert.equal(r.status, 200);
await pi.waitForFunction(() => PPTracks.song() && PPTracks.song().chart && PPTracks.data(PPTracks.song()).sections.length >= 2, null, { timeout: 8000 });
await pi.evaluate(() => { PPTracks.sendDisplay(); PPFeatures.sendToDriver({ type: "system", action: "status" }); }); await pi.waitForFunction(() => PPFeatures.systemStatus() && PPFeatures.systemStatus().code, null, { timeout: 5000 }); code = await pi.evaluate(() => PPFeatures.systemStatus().code);
// Central Control renderer
const cu = await ctx.newPage(); cu.on("pageerror", (e) => errs.push("cu:" + e)); cu.on("console", (m) => { if (m.type() === "error" && !/favicon|NAME_NOT_RESOLVED|padpedal\.local/.test(m.text())) errs.push("cu-console:" + m.text()); });
await cu.addInitScript(() => { if (!localStorage.getItem("cu-mode")) localStorage.setItem("cu-mode", JSON.stringify("user")); });
await cu.addInitScript(() => { try { if (!localStorage.getItem("cc-license")) localStorage.setItem("cc-license", JSON.stringify({ key: "ADEF-AULT-KEY0-2026", kind: "A", app: "control", okAt: Date.now(), production: "Test church", isDefault: true })); } catch (_) { } });   // (no website yet: Central Control on its default key)   // a musician's computer first (chart, lyrics)
await cu.goto("file://" + path.join(here, "app", "index.html") + ""); await cu.waitForFunction(() => window.CentralUsage);
await cu.evaluate(() => { CentralUsage.connect("127.0.0.1"); });
await check("connects to the Central Pedal and shows its song", async () => { await cu.waitForFunction(() => CentralUsage.state.connected && CentralUsage.state.display && CentralUsage.state.display.song, null, { timeout: 8000 }); assert.match(await cu.textContent("#songName"), /Test Song/); });
await check("the chart loads with chords over lyrics, in the song key", async () => { await cu.waitForFunction(() => document.querySelectorAll("#chart .csec").length >= 2, null, { timeout: 8000 }); const t = await cu.textContent("#chart"); assert.match(t, /first\s+verse\s+line/); assert.ok((await cu.$$eval("#chart .ch", (l) => l.map((e) => e.textContent))).includes("G"), "G chord shown"); });
await check("guitar with G shapes when the song is in A shows capo 2 and A->G", async () => {
  await pi.evaluate(() => { PPTracks.song().key = "A"; PPTracks.sendDisplay(); });
  await cu.waitForFunction(() => /Key A|A /.test(document.querySelector("#songMeta").textContent), null, { timeout: 5000 });
  await cu.selectOption("#instrument", "guitar"); await cu.waitForTimeout(100); await cu.selectOption("#shapes", "G"); await cu.waitForTimeout(200);
  assert.match(await cu.textContent("#written"), /Capo 2/); const chords = await cu.$$eval("#chart .ch", (l) => l.map((e) => e.textContent)); assert.ok(chords.includes("G") && chords.includes("D") && !chords.includes("A"), chords.join(","));
});
await check("B-flat trumpet reads a song in A as B", async () => { await cu.selectOption("#instrument", "Bb"); await cu.waitForTimeout(200); assert.match(await cu.textContent("#written"), /written in B/); const chords = await cu.$$eval("#chart .ch", (l) => l.map((e) => e.textContent)); assert.ok(chords.includes("B") && chords.includes("E"), chords.join(",")); });
await check("Nashville numbers", async () => { await cu.click("#nashville"); await cu.waitForTimeout(200); const chords = await cu.$$eval("#chart .ch", (l) => l.map((e) => e.textContent)); assert.ok(chords.includes("1") && chords.includes("4"), chords.join(",")); await cu.click("#nashville"); });
await check("the lyrics tab shows the current section's words without chords", async () => {
  await pi.evaluate(() => { PPTracks.setTracksMode(true); PPTracks.goSection(0, { immediate: true }); PPTracks.sendDisplay(); });
  await cu.evaluate(() => document.querySelector('[data-tab="lyrics"]').click());
  await cu.waitForFunction(() => /first verse line|Verse/.test(document.querySelector("#lyrics").textContent), null, { timeout: 6000 }); const t = await cu.textContent("#lyrics"); assert.ok(!/\bG\s+D\b/.test(t), "no chord line in lyrics: " + t);
});
await check("only the Central Pedal moves the tracks: the section buttons show where it is, a jump request is refused; the lyrics can be paged", async () => {
  await cu.evaluate((c) => { CentralUsage.prefs.code = c; CentralUsage.send({ type: "auth", code: c }); }, code);
  await cu.evaluate(() => document.querySelector('[data-tab="chart"]').click()); await cu.waitForSelector("#sections [data-sec='1']", { timeout: 5000 });
  const before = await pi.evaluate(() => PPTracks.state.section);
  await cu.click("#sections [data-sec='1']"); await cu.evaluate((c) => CentralUsage.send({ type: "action", name: "nextSection", code: c }), code); await cu.waitForTimeout(700);
  assert.equal(await pi.evaluate(() => PPTracks.state.section), before, "the Pi did not move");
  const refused = await cu.evaluate(() => new Promise((res) => { CentralUsage.on("refused", (m) => res(m)); CentralUsage.send({ type: "action", name: "playPause", code: CentralUsage.prefs.code }); setTimeout(() => res(null), 2000); }));
  assert.ok(refused && /Only the Central Pedal/.test(refused.error), JSON.stringify(refused));
  const page = await pi.evaluate(() => JSON.stringify([PPTracks.state.lyricsPage, PPTracks.state.section, PPTracks.state.lyricsManual])); await cu.evaluate(() => CentralUsage.action("lyricsNext")); await pi.waitForFunction((p) => JSON.stringify([PPTracks.state.lyricsPage, PPTracks.state.section, PPTracks.state.lyricsManual]) !== p, page, { timeout: 4000 });
});
await check("MIDI relay: the Pi's hit notes arrive with its clock and are scheduled on a local output", async () => {
  const sent = await cu.evaluate(async () => {
    const out = []; CentralUsage.__fake = { send: (d, at) => out.push({ d: Array.from(d), at }) };
    // monkey-patch: expose via a fake port by sending through onMessage with the midiSend path
    const orig = navigator.requestMIDIAccess; return new Promise((resolve) => { resolve(out); });
  });
  // emulate an incoming relay message (the driver forwards app midiOut as type "midi" with its monotonic clock)
  const ok = await cu.evaluate(() => { const st = CentralUsage.state; st.offset = 1000; const localNow = performance.now(); const piNow = localNow + 1000; const seen = []; const l = document.querySelector("#log"); CentralUsage.onMessage({ type: "midi", t: piNow, messages: [{ data: [0x90, 48, 127], at: 250 }, { data: [0x80, 48, 0], at: 350 }] }); return /note 48/.test(l.textContent) && /in 2\d\d ms/.test(l.textContent); });
  assert.ok(ok, "hit logged with ~250 ms lookahead");
});
await check("lighting: the example rig (with light bars and a strobe) is on the 3D stage and the auto show is built from the song's sections", async () => {
  await cu.evaluate(() => CentralUsage.setMode("admin"));   // the lights are on admin computers
  await cu.click('[data-tab="lights"]'); await cu.click('[data-lx="show"]');
  await cu.waitForFunction(() => window.CULights3D && CULights3D.active() && CULights3D.count() === CULights.rig().fixtures.length && CULights.rig().fixtures.length === 14 && CULights.cuesNow().length >= 3, null, { timeout: 8000 });
await check("lighting: light bars (each cell its own colour), strobes (button, beat-locked, hit bursts) and the 3D stage", async () => {
  const r = await cu.evaluate(() => {
    const L = CULights, rig = L.rig(), bar = rig.fixtures.find((f) => f.name === "Bar L"), strobe = rig.fixtures.find((f) => f.name === "Strobe");
    const out = { kinds: [L.kindOf(bar), L.cellsOf(bar), L.kindOf(strobe), L.isStrobe(strobe), L.kindOf(rig.fixtures.find((f) => f.name === "Mover L")), L.kindOf(rig.fixtures.find((f) => f.name === "Blinder")), L.cellsOf(rig.fixtures.find((f) => f.name === "Blinder"))] };
    // a rainbow and a chase run along the bar's cells
    const look = { g: { back: { dim: 1, color: "#ff0000", fx: "rainbow", speed: 4, size: 1 } } }, cells = [0, 3, 7].map((c) => L.stateFor(look, bar, 0, 2, 0, c, 8));
    out.rainbow = cells.map((s) => [s.r, s.g, s.b].map((v) => v.toFixed(2)).join("/"));
    const chase = { g: { back: { dim: 1, color: "#ffffff", fx: "chase", speed: 1, size: 1 } } };
    out.chase = [0, 1, 2].map((b) => [0, 1, 2].map((c) => L.stateFor(chase, bar, 0, 2, b, c, 8).dim).join(""));
    // its channels: cell k's red is the k-th "r"
    const unis = {}; const sts = Array.from({ length: 8 }, (_, k) => ({ dim: 1, r: k === 2 ? 1 : 0, g: 0, b: k === 5 ? 1 : 0, w: 0, a: 0, uv: 0, strobe: 0, pan: 0.5, tilt: 0.5, haze: 0 }));
    L.write(unis, bar, sts); const u = unis[String(bar.universe)], a = bar.address - 1;
    out.dmx = [u[a + 6], u[a + 8], u[a + 17], u[a + 3]];
    // a strobe locked to the beat flashes only near the beat
    const sb = { g: { fx: { dim: 1, color: "#ffffff", strobe: 1, strobeSync: "beat" } } };
    out.beat = [0, 0.02, 0.5, 1.01].map((b) => L.stateFor(sb, strobe, 0, 2, b).dim);
    out.place = [bar.mount, Math.round(bar.pos.y * 10) / 10, strobe.mount, rig.fixtures.find((f) => f.name === "Mover L").mount, rig.stage.trusses.length];
    return out;
  });
  assert.deepEqual(r.kinds, ["bar", 8, "strobe", true, "mover", "blinder", 2], JSON.stringify(r));
  assert.ok(new Set(r.rainbow).size === 3, "every cell its own colour " + JSON.stringify(r.rainbow));
  assert.deepEqual(r.chase, ["100", "010", "001"], "a chase steps cell by cell " + JSON.stringify(r.chase));
  assert.deepEqual(r.dmx, [255, 0, 255, 0], "cell 3's red and cell 6's blue " + JSON.stringify(r.dmx));
  assert.ok(r.beat[0] === 1 && r.beat[1] === 1 && r.beat[2] === 0 && r.beat[3] === 1, "beat-locked strobe " + JSON.stringify(r.beat));
  assert.ok(r.place[0] === "floor" && r.place[2] === "back" && r.place[3] === "mid" && r.place[4] === 3, JSON.stringify(r.place));
  // the Strobe button: held, the strobe flashes; let go, it follows the show again
  await cu.evaluate(() => { CULights.rig().strobe.button = "free"; });
  await cu.dispatchEvent("#lxStrobe", "pointerdown");
  const seen = new Set(); for (let i = 0; i < 25; i++) { seen.add(await cu.evaluate(() => { const L = CULights, f = L.rig().fixtures.find((x) => x.name === "Strobe"); return L.live.fixtureColor[f.id].dim > 0.5 ? 1 : 0; })); await new Promise((res) => setTimeout(res, 23)); }
  await cu.dispatchEvent("#lxStrobe", "pointerup");
  assert.ok(seen.has(1) && seen.has(0), "the strobe flashes while the button is held");
  assert.ok(!(await cu.evaluate(() => CULights.live.strobeHold)), "let go: it stops");
  // the 3D stage: click a light to pick it, its panel shows; the stage settings change the stage
  const pick = await cu.evaluate(() => { const f = CULights.rig().fixtures.find((x) => x.name === "Mover L"); CULights3D.select(f.id); return !!document.querySelector("#lx3dPanel:not([hidden]) [data-pf='mount']"); });
  assert.ok(pick, "the light's panel");
  await cu.evaluate(() => { CULights3D.select(null); document.querySelector("[data-stage3]").click(); const w = document.querySelector("[data-sf='width']"); w.value = "12"; w.dispatchEvent(new Event("input", { bubbles: true })); });
  assert.equal(await cu.evaluate(() => CULights.rig().stage.width), 12);
  await cu.evaluate(() => { const w = document.querySelector("[data-sf='width']"); w.value = "10"; w.dispatchEvent(new Event("input", { bubbles: true })); document.querySelector("[data-stage3]").click(); });
});
  // (the Classic Auto here - a preset per section name; the smart Auto is checked after the drum hits)
  await cu.evaluate(() => { CULights.rig().auto.smart = false; CULights.dirty(); });
  const cues = await cu.evaluate(() => CULights.cuesNow().filter((c) => c.kind === "look").map((c) => c.look + "@" + c.bar));
  assert.ok(cues[0] === "verse@1" && cues.some((c) => /^chorus@/.test(c)) && /^blackout@/.test(cues[cues.length - 1]), cues.join(" "));
  assert.ok(await cu.evaluate(() => document.querySelectorAll("#lxPalette [data-slot]").length === 10 && document.querySelectorAll("#lxPalette .lx-look").length === 10 && document.querySelectorAll("#lxLookList .lx-look").length >= 12), "10 quick buttons filled from the presets; every preset under All presets");
});
await check("lighting: a look becomes the right DMX values (dimmer + RGBW pars, moving heads)", async () => {
  await cu.evaluate(() => { CULights.goLook("chorus"); CULights.live.manualFrom = CULights.lookById("chorus"); });
  await cu.waitForTimeout(150);
  const u = await cu.evaluate(() => Array.from(CULights.render()["1"].slice(0, 40)));
  // Front L: dimmer+RGBW at 1 - 95 % warm (#ffb36b) + 30 % white; Back 1 at 11: 100 % purple (#7a2bff)
  assert.deepEqual(u.slice(0, 5), [242, 255, 179, 107, 77], "front " + u.slice(0, 5));
  assert.deepEqual(u.slice(10, 15), [255, 122, 43, 255, 0], "back " + u.slice(10, 15));
  // Mover L (mini 9 ch at 31): dim channel 3 at full, white channel 8 at full
  assert.equal(u[32], 255); assert.equal(u[37], 255);
  await cu.evaluate(() => CULights.goLook("blackout")); await cu.waitForTimeout(700);
  const z = await cu.evaluate(() => Array.from(CULights.render()["1"].slice(0, 60)).filter((v, i) => ![30, 31, 38, 39, 40, 47].includes(i)).reduce((a, b) => a + b, 0));
  assert.equal(z, 0, "blackout leaves only pan / tilt / speed");
  await cu.click("#lxFollow");
});
await check("lighting: following the song - at the chorus the chorus look is up, a hit cue flashes white", async () => {
  const r = await cu.evaluate(() => {
    const S = CULights.song, sh = CULights.show(), chorus = CULights.cuesNow().find((c) => c.look === "chorus");
    const t = CULights.timeOf(chorus.bar, 1) + 1.5;
    S.playing = true; S.pos = t; S.at = performance.now();
    const a = Array.from(CULights.render()["1"].slice(10, 15));
    sh.cues.push({ id: "h", bar: chorus.bar, beat: 3, look: "hit", kind: "flash", dur: 1 }); CULights.dirty();
    S.pos = CULights.timeOf(chorus.bar, 3) + 0.01; S.at = performance.now();
    const f = Array.from(CULights.render()["1"].slice(10, 15));
    sh.cues = sh.cues.filter((c) => c.id !== "h"); CULights.dirty(); S.playing = false;
    return { a, f };
  });
  assert.deepEqual(r.a, [255, 122, 43, 255, 0], "chorus back " + r.a);
  assert.ok(r.f[1] > 200 && r.f[2] > 200 && r.f[4] > 200, "flash white " + r.f);
});
await check("lighting: a split song's drum hits (kick, snare, hi-hat, crash) come from the Central Pedal with its tempo - the crash flashes, the kick when you give it a preset, the pedal's drum notes too", async () => {
  // the pedal's current song gets drum hits (as a split does); the hub brings them here with the grid and tempo
  await pi.evaluate(() => { const s = PPTracks.song(); PPTracks.data(s).drumHits = { kick: [1, 2, 3], snare: [1.5, 2.5], hat: [], crash: [0.5] }; PPHub.push(true); });
  await cu.waitForFunction(() => CULights.song.drumHits && CULights.song.drumHits.crash.length === 1 && CULights.song.drumHits.kick.length === 3, null, { timeout: 10000 });
  const r = await cu.evaluate(() => {
    const L = CULights, rig = L.rig(); L.dirty();
    const before = L.cuesNow().filter((c) => c.drum).map((c) => c.drum + ":" + c.look);
    rig.drums.kick = "strobehit"; L.dirty();
    const after = L.cuesNow().filter((c) => c.drum).map((c) => c.drum + ":" + c.look);
    rig.drums.kick = ""; L.dirty();
    return { before, after, bpm: L.song.bpm, bars: L.song.bars.length };
  });
  assert.deepEqual(r.before, ["crash:hit"]); assert.deepEqual(r.after.sort(), ["crash:hit", "kick:strobehit", "kick:strobehit", "kick:strobehit"]);
  assert.ok(r.bpm > 0 && r.bars > 0, "the tempo and the bars came too " + JSON.stringify(r));
  // MIDI from the pedal: its drum notes flash only when the timeline doesn't have the hits; the crash note (49) flashes "hit", a kick (36) nothing (no preset)
  const m = await cu.evaluate(async () => {
    const L = CULights, st = CentralUsage.state; st.offset = 1000; const piNow = performance.now() + 1000, keep = L.song.drumHits;
    const note = (n) => L.onMessage({ type: "midi", t: piNow, messages: [{ data: [0x90, n, 127], at: 0 }] });
    L.live.flash = null; note(49); await new Promise((r) => setTimeout(r, 60)); const withHits = L.live.flash && L.live.flash.look;
    L.song.drumHits = null; L.live.flash = null; note(49); await new Promise((r) => setTimeout(r, 60)); const crash = L.live.flash && L.live.flash.look;
    L.live.flash = null; note(36); await new Promise((r) => setTimeout(r, 60)); const kick = L.live.flash && L.live.flash.look;
    L.song.drumHits = keep; L.dirty(); return { withHits: withHits || null, crash: crash || null, kick: kick || null };
  });
  assert.deepEqual(m, { withHits: null, crash: "hit", kick: null });
  await pi.evaluate(() => { const s = PPTracks.song(); delete PPTracks.data(s).drumHits; PPHub.push(true); });
});
await check("lighting, the smart Auto on the Central Pedal's song: its feel and each section's, a look per section from the analysis, the Auto panel, and a section previewed on the stage", async () => {
  const r = await cu.evaluate(async () => {
    const L = CULights; L.rig().auto.smart = true; L.dirty(); L.renderAll();
    const sd = L.smart(), looks = L.cuesNow().filter((c) => c.kind === "look" && c.look !== "blackout");
    const panel = document.getElementById("lxAutoPanel"), chips = panel.querySelectorAll(".lx-ausec").length;
    panel.querySelector("[data-ax-prev='0']").click(); await new Promise((res) => setTimeout(res, 300));
    const previewing = L.live.manual && L.live.manual.id;
    document.getElementById("lxFollow").click();
    return { style: sd.analysis.style, sections: sd.analysis.sections.length, songSections: L.song.sections.length, looks: looks.map((c) => c.look), panel: panel.textContent, chips, previewing, first: sd.built.sections[0].look, back: L.live.manual };
  });
  assert.ok(["intimate", "mid", "upbeat"].includes(r.style)); assert.equal(r.sections, r.songSections);
  assert.ok(r.looks.length === r.sections && r.looks.every((l) => /^auto:/.test(l)), r.looks.join(" "));
  assert.match(r.panel, /Auto lighting/); assert.equal(r.chips, r.sections);
  assert.equal(r.previewing, r.first); assert.equal(r.back, null);
});
await check("lighting: a cue added on the timeline is saved on the Central Pedal (with the pairing code) and read back", async () => {
  await cu.evaluate((c) => { CentralUsage.prefs.code = c; }, code);
  const box = await cu.$("#lxTimeline"); await box.scrollIntoViewIfNeeded(); const bb = await box.boundingBox();   // (below a bigger 3D stage)
  const before = await cu.evaluate(() => CULights.show().cues.length);
  await cu.mouse.click(bb.x + bb.width * 0.6, bb.y + 50);
  await cu.waitForFunction((n) => CULights.show().cues.length === n + 1 && CULights.show().saved, before, { timeout: 6000 });
  const sid = await cu.evaluate(() => CULights.show().song);
  const got = await (await fetch("http://127.0.0.1:8080/api/lighting?song=" + encodeURIComponent(sid))).json();
  assert.equal(got.cues.length, before + 1); assert.equal(got.mode, "semi");
  const bad = await fetch("http://127.0.0.1:8080/api/lighting", { method: "POST", body: JSON.stringify({ song: sid, code: "0000", show: { cues: [] } }) });
  assert.equal(bad.status, 403);
});
await check("lighting: fixtures can be added with addresses that follow on, and overlaps are flagged", async () => {
  await cu.click('[data-lx="fixtures"]');
  const n0 = await cu.evaluate(() => CULights.rig().fixtures.length);
  await cu.selectOption("#lxAddProfile", "rgbw4"); await cu.fill("#lxAddCount", "4"); await cu.fill("#lxAddName", "Side"); await cu.click("#lxAddBtn");
  const f = await cu.evaluate(() => CULights.rig().fixtures.slice(-4).map((x) => x.address));
  // (after the example rig: its strobe is at 101-102)
  assert.deepEqual(f, [103, 107, 111, 115]); assert.equal(await cu.evaluate(() => CULights.rig().fixtures.length), n0 + 4);
  await cu.evaluate(() => { const fx = CULights.rig().fixtures; fx[fx.length - 1].address = 1; CULights.renderAll(); });
  assert.ok(await cu.evaluate(() => document.querySelectorAll("#lxFixTable tr.clash").length >= 2));
  await cu.click('[data-lx="show"]');
});
await check("fixture library: a QLC+ .qxf and an Open Fixture Library .json become fixture types (every mode), usable in the patch", async () => {
  const r = await cu.evaluate(() => {
    const qxf = `<?xml version="1.0" encoding="UTF-8"?><FixtureDefinition xmlns="http://www.qlcplus.org/FixtureDefinition"><Manufacturer>Chauvet</Manufacturer><Model>Intimidator Spot 260</Model><Type>Moving Head</Type>
      <Channel Name="Pan"><Group Byte="0">Pan</Group></Channel><Channel Name="Pan Fine"><Group Byte="1">Pan</Group></Channel><Channel Name="Tilt"><Group Byte="0">Tilt</Group></Channel><Channel Name="Tilt Fine"><Group Byte="1">Tilt</Group></Channel>
      <Channel Name="Color Wheel"><Group Byte="0">Colour</Group></Channel><Channel Name="Gobo Wheel"><Group Byte="0">Gobo</Group></Channel><Channel Name="Dimmer" Preset="IntensityMasterDimmer"/><Channel Name="Shutter"><Group Byte="0">Shutter</Group></Channel><Channel Name="Pan/Tilt Speed"><Group Byte="0">Speed</Group></Channel>
      <Mode Name="11 Channel"><Channel Number="0">Pan</Channel><Channel Number="1">Tilt</Channel><Channel Number="2">Pan Fine</Channel><Channel Number="3">Tilt Fine</Channel><Channel Number="4">Pan/Tilt Speed</Channel><Channel Number="5">Color Wheel</Channel><Channel Number="6">Shutter</Channel><Channel Number="7">Dimmer</Channel><Channel Number="8">Gobo Wheel</Channel></Mode>
      <Mode Name="6 Channel"><Channel Number="0">Pan</Channel><Channel Number="1">Tilt</Channel><Channel Number="2">Color Wheel</Channel><Channel Number="3">Gobo Wheel</Channel><Channel Number="4">Dimmer</Channel><Channel Number="5">Shutter</Channel></Mode></FixtureDefinition>`;
    const ofl = JSON.stringify({ name: "SlimPAR Q12 BT", availableChannels: { Red: { capability: { type: "ColorIntensity", color: "Red" } }, Green: { capability: { type: "ColorIntensity", color: "Green" } }, Blue: { capability: { type: "ColorIntensity", color: "Blue" } }, Amber: { capability: { type: "ColorIntensity", color: "Amber" } }, Dimmer: { capability: { type: "Intensity" } }, Strobe: { capability: { type: "ShutterStrobe" } } }, modes: [{ name: "4-channel", channels: ["Red", "Green", "Blue", "Amber"] }, { name: "6-channel", channels: ["Red", "Green", "Blue", "Amber", "Dimmer", "Strobe"] }] });
    const a = CUFixtureLib.parse("Chauvet-Intimidator-Spot-260.qxf", qxf), b = CUFixtureLib.parse("chauvet-dj/slimpar-q12-bt.json", ofl);
    CULights.addToLibrary(a.concat(b));
    const rig = CULights.rig(), lib = rig.library;
    const spot = a.find((e) => e.mode === "11 Channel"), par = b.find((e) => e.mode === "6-channel");
    rig.fixtures.push({ id: "t-spot", name: "Spot", profile: spot.id, group: "beam", universe: 1, address: 300, x: 0.5, y: 0.3 });
    rig.fixtures.push({ id: "t-par", name: "Par", profile: par.id, group: "back", universe: 1, address: 320, x: 0.4, y: 0.2 });
    return { a: a.map((e) => [e.mode, e.ch.join(" "), e.mover]), b: b.map((e) => [e.mode, e.ch.join(" ")]), lib: lib.length, spotCh: CULights.profileOf(rig.fixtures.find((f) => f.id === "t-spot")).ch.length, opts: document.querySelectorAll("#lxAddProfile optgroup").length };
  });
  assert.deepEqual(r.a[0], ["11 Channel", "pan tilt panf tiltf speed wheel strobe dim gobo", true]);
  assert.deepEqual(r.b[1], ["6-channel", "r g b a dim strobe"]);
  assert.equal(r.lib, 4); assert.equal(r.spotCh, 9); assert.equal(r.opts, 2, "Add fixtures offers generic types and your library");
});
await check("moving heads: positions, fan and shapes (circle, figure 8, waves) move pan / tilt; invert mirrors a mover", async () => {
  const r = await cu.evaluate(() => {
    const L = CULights, f = { id: "m1", group: "beam" }, f2 = { id: "m2", group: "beam", invertPan: true };
    const look = { g: { beam: { dim: 1, color: "#ffffff", fx: "circle", speed: 1, size: 1, pan: 0.5, tilt: 0.6, fan: 0.4, offset: 1 } } };
    const a = L.stateFor(look, f, 0, 2, 0), b = L.stateFor(look, f, 0, 2, 1), c = L.stateFor(look, f, 0, 2, 3);
    const steady = { g: { beam: { dim: 1, color: "#fff", fx: "none", pan: 0.3, tilt: 0.7, fan: 0 } } };
    const s1 = L.stateFor(steady, f, 0, 1, 0), s2 = L.stateFor(steady, f2, 0, 1, 0);
    const fan = { g: { beam: { dim: 1, color: "#fff", fx: "none", pan: 0.5, tilt: 0.5, fan: 0.4 } } };
    return { moving: [a.pan, b.pan, c.pan].map((x) => x.toFixed(3)), tiltMoves: a.tilt !== b.tilt, s1: [s1.pan, s1.tilt], s2: [s2.pan, s2.tilt], fanL: L.stateFor(fan, f, 0, 3, 0).pan, fanR: L.stateFor(fan, f, 2, 3, 0).pan, fx: [...document.querySelectorAll("select")].length >= 0, positions: L.POSITIONS.length };
  });
  assert.equal(new Set(r.moving).size, 3, "pan changes with the beat: " + r.moving); assert.ok(r.tiltMoves);
  assert.deepEqual(r.s1.map((x) => Math.round(x * 100) / 100), [0.3, 0.7]); assert.deepEqual(r.s2.map((x) => Math.round(x * 100) / 100), [0.7, 0.7], "invert pan mirrors");
  assert.ok(r.fanL < 0.4 && r.fanR > 0.6, "fan spreads the group: " + r.fanL + " / " + r.fanR); assert.ok(r.positions >= 6);
});
await check("phone remote: looks, follow, blackout and faders from the remote's commands; its state lists them", async () => {
  const r = await cu.evaluate(() => {
    const L = CULights; L.remoteCommand({ cmd: "look", id: "chorus" }); const a = L.live.manual && L.live.manual.id;
    L.remoteCommand({ cmd: "fader", id: "back", value: 0.25 }); const fb = L.rig().groupLevel.back;
    L.remoteCommand({ cmd: "blackout" }); const st = L.remoteState(); L.remoteCommand({ cmd: "blackout" }); L.remoteCommand({ cmd: "follow" });
    return { a, fb, black: st.blackout, now: st.now, looks: st.looks.length, faders: st.faders.map((f) => f.id), manualAfter: !!L.live.manual };
  });
  assert.equal(r.a, "chorus"); assert.equal(r.fb, 0.25); assert.equal(r.black, true); assert.match(r.now, /Blackout/); assert.ok(r.looks >= 10); assert.ok(r.faders.includes("master") && r.faders.includes("back")); assert.equal(r.manualAfter, false);
  const html = fs.readFileSync(path.join(here, "app", "remote.html"), "utf8"); assert.match(html, /"\/api\/"/); assert.match(html, /cmd:/); assert.match(html, /pin/);
});
await check("timecode: MTC quarter frames carry the song position (01:00:00:00 + position), LTC/MTC settings render", async () => {
  const r = await cu.evaluate(() => { const T = CUTimecode, cfg = T.config(); cfg.fps = 25; cfg.offset = "01:00:00:00"; const fr = (3600 + 62) * 25 + 13; return { qf: [0, 1, 2, 3, 4, 5, 6, 7].map((k) => T.qfData(k, fr)[1]), txt: T.fmt(fr) }; });
  // 01:01:02:13 at 25 fps: frame 13 = 0x0D, sec 2, min 1, hour 1 with rate code 1 (25 fps) in the top piece
  assert.deepEqual(r.qf, [0x0D, 0x10, 0x22, 0x30, 0x41, 0x50, 0x61, 0x72]); assert.equal(r.txt, "01:01:02:13");
  await cu.evaluate(() => { document.querySelector('[data-tab="lights"]').click(); CULights.showSub("output"); });
  await cu.waitForSelector("#lxTimecode [data-tc=mtc]", { timeout: 4000 }); await cu.waitForSelector("#lxRemote", { timeout: 4000 });
});
await check("lighting modes: Auto runs the automatic cues only, Manual only yours, Semi-auto both", async () => {
  const r = await cu.evaluate(() => { const sh = CULights.show(), keep = sh.cues.slice(); sh.cues = [{ id: "mine", bar: 2, beat: 1, look: "bridge", kind: "look", fade: 0 }]; const out = {};
    ["auto", "manual", "semi"].forEach((m) => { sh.mode = m; CULights.dirty(); out[m] = CULights.cuesNow().map((c) => c.look + (c.auto ? "*" : "")); });
    sh.cues = keep; sh.mode = "semi"; CULights.dirty(); return out; });
  assert.ok(r.auto.length >= 2 && !r.auto.includes("bridge"), "auto " + r.auto); assert.deepEqual(r.manual, ["bridge"]); assert.ok(r.semi.includes("bridge") && r.semi.length === r.auto.length + 1, "semi " + r.semi);
});
await check("songs: a song of your own (no tracks) with scenes on bars - programmed at 93 BPM, at 112 BPM every scene moves with it", async () => {
  await cu.evaluate(() => { const rig = CULights.rig(); rig.localSongs.push({ id: "cu-test", name: "Spontaneous", bpm: 93, bpb: 4 }); CULights.showSub("songs"); });
  assert.deepEqual(await cu.evaluate(() => [...document.querySelectorAll("#lxNav [data-lx]")].map((b) => b.textContent)), ["Show", "Fixtures", "Output"]);
  assert.ok(await cu.evaluate(() => !document.querySelector('[data-lxv="show"]').hidden && !!document.querySelector('#lxRight #lxSongs') && !!document.querySelector('#lxRLooks #lxLookList') && document.querySelector('#lxLookList').children.length >= 10), "songs on the right under the stage, all presets below");
  await cu.click('[data-ls-pick="cu-test"]'); await cu.waitForSelector('[data-ls="scene"]', { timeout: 5000 });
  // Add scene → the presets pop up; picking one adds the scene with that preset
  for (let i = 0; i < 2; i++) { await cu.click('[data-ls="scene"]'); await cu.waitForSelector("#lxPick:not([hidden]) [data-pk-item]", { timeout: 3000 }); await cu.click("#lxPick [data-pk-item]:nth-child(" + (i + 1) + ")"); }
  assert.ok(await cu.evaluate(() => document.querySelector("#lxPick").hidden), "the picker closes after a pick");
  await cu.waitForFunction(() => document.querySelectorAll(".lx-scenes tbody tr").length === 2);
  await cu.evaluate(() => { const i = document.querySelector('.lx-scenes tbody tr:nth-child(2) [data-scf="bar"]'); i.value = "5"; i.dispatchEvent(new Event("change", { bubbles: true })); });
  await cu.click('[data-ls="program"]');
  const t = await cu.evaluate(() => { const S = CULights.song; const a = CULights.timeOf(5, 1); S.bpm = 112; const b = CULights.timeOf(5, 1); return { id: S.id, local: S.local, a, b, scenes: CULights.show().cues.length }; });
  assert.equal(t.id, "cu-test"); assert.ok(t.local); assert.ok(Math.abs(t.a - 16 * 60 / 93) < 0.01 && Math.abs(t.b - 16 * 60 / 112) < 0.01, JSON.stringify(t));
  await cu.waitForFunction(() => CULights.show().cues.filter((c) => c.kind === "look").length === 2, null, { timeout: 5000 });
});
await check("scenes: Delete asks 'Are you sure?' - Cancel keeps the scene, OK deletes it", async () => {
  await cu.evaluate(() => CULights.showSub("songs")); await cu.waitForSelector(".lx-scenes [data-sc-del]", { timeout: 4000 });
  const n = () => cu.evaluate(() => CULights.show().cues.filter((c) => c.kind === "look").length);
  const n0 = await n(); let asked = "";
  cu.once("dialog", (d) => { asked = d.message(); d.dismiss(); }); await cu.click('.lx-scenes [data-sc-del="0"]'); await cu.waitForTimeout(150);
  assert.match(asked, /Delete scene 1/); assert.equal(await n(), n0, "Cancel keeps it");
  cu.once("dialog", (d) => d.accept()); await cu.click('.lx-scenes [data-sc-del="0"]');
  await cu.waitForFunction((k) => CULights.show().cues.filter((c) => c.kind === "look").length === k - 1, n0, { timeout: 3000 });
  await cu.evaluate(() => CULights.addScene("chorus"));   // (put one back for the checks after)
});
await check("pause: the click here stops where it is and Carry on resumes from that bar (not from the top)", async () => {
  await cu.evaluate(() => CULights.showSub("show"));
  const pos = () => cu.evaluate(() => { const S = CULights.song; return S.playing ? S.pos + (performance.now() - S.at) / 1000 * (S.speed || 1) : S.pos; });
  assert.ok(await cu.evaluate(() => document.querySelector("#lxPause").disabled), "nothing to pause yet");
  await cu.click("#lxPreview"); await cu.waitForFunction(() => CULights.song.playing && !document.querySelector("#lxPause").disabled, null, { timeout: 3000 });
  await cu.waitForTimeout(900); await cu.click("#lxPause");
  const p1 = await pos(); assert.ok(p1 > 0.5, "it ran " + p1); assert.equal(await cu.evaluate(() => CULights.paused() && CULights.paused().kind), "click");
  await cu.waitForTimeout(500); assert.ok(Math.abs((await pos()) - p1) < 0.05, "it holds while paused"); assert.match(await cu.textContent("#lxPause"), /Carry on/);
  await cu.click("#lxPause"); await cu.waitForTimeout(400);
  const p2 = await pos(); assert.ok(p2 > p1 + 0.2 && p2 < p1 + 1.5, "carried on from " + p1 + " to " + p2); assert.equal(await cu.evaluate(() => CULights.paused()), null);
  await cu.click("#lxPreview"); await cu.waitForFunction(() => !CULights.song.playing, null, { timeout: 3000 });
  // with the tracks playing on the pedal, Pause holds the lights (the band plays on)
  const h = await cu.evaluate(() => { const S = CULights.song; S.playing = true; S.at = performance.now(); S.pos = 4; CULights.pause(); const k = CULights.paused() && CULights.paused().kind, fr = !!CULights.live.frozen; CULights.pause(); const after = CULights.paused(); S.playing = false; return { k, fr, after, frozen: !!CULights.live.frozen }; });
  assert.deepEqual(h, { k: "hold", fr: true, after: null, frozen: false });
});
await check("quick buttons: 10 slots; a preset dragged in lands in its slot, slot onto slot swaps, ✕ empties it, and it is saved", async () => {
  await cu.evaluate(() => CULights.showSub("show"));
  assert.equal(await cu.evaluate(() => document.querySelectorAll("#lxPalette [data-slot]").length), 10);
  const r = await cu.evaluate(() => {
    const drag = (src, dst) => { const dt = new DataTransfer(); src.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt })); dst.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt })); dst.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt })); };
    const slot = (i) => document.querySelector('#lxPalette [data-slot="' + i + '"]');
    CULights.setQuick(0, "chorus"); CULights.setQuick(3, null); const was0 = CULights.quick()[0];
    drag(document.querySelector('#lxLookList [data-edit-look="bridge"]'), slot(3)); const a = CULights.quick()[3];
    drag(slot(0), slot(3)); const b = CULights.quick().slice(0, 4);
    slot(0).querySelector("[data-x]").click(); const c = CULights.quick()[0];
    const saved = JSON.parse(localStorage.getItem("cu-rig") || "{}").quick;
    return { a, b, was0, c, saved, empty: !!slot(0).dataset.empty };
  });
  assert.equal(r.a, "bridge"); assert.equal(r.b[0], "bridge"); assert.equal(r.b[3], r.was0); assert.equal(r.c, null); assert.ok(r.empty); assert.equal(r.saved && r.saved[3], r.was0);
});
await check("presets per section: each part's presets show next to the songs and switch as the song moves; clicking one plays it", async () => {
  const r = await cu.evaluate(async () => {
    const L = CULights, S = L.song, sh = L.show(); S.sections = [{ name: "Verse 1", start: 0, end: 10 }, { name: "Chorus", start: 10, end: 20 }, { name: "Verse 2", start: 20, end: 30 }];
    sh.sets = { perSection: true, song: [], sections: {} }; const kv = (() => { S.pos = 1; S.playing = false; return L.nowSecKey(); })(); S.pos = 12; const kc = L.nowSecKey();
    sh.sets.sections[kv] = ["verse", "worship"]; sh.sets.sections[kc] = ["chorus"]; L.dirty(); L.renderSecPresets();
    const shown = () => [...document.querySelectorAll("#lxSecList [data-look]")].map((b) => b.dataset.look);
    const inChorus = shown(); S.pos = 25; await new Promise((res) => setTimeout(res, 450)); const inVerse = shown();
    document.querySelector('#lxSecList [data-look="worship"]').click(); const live = L.live.manual && L.live.manual.id;
    sh.sets.perSection = false; sh.sets.song = ["hit"]; L.renderSecPresets(); const whole = shown();
    return { kv, kc, inChorus, inVerse, live, whole, heading: document.querySelector("#lxSecPresets h3").textContent };
  });
  assert.equal(r.kv, "verse"); assert.equal(r.kc, "chorus"); assert.deepEqual(r.inChorus, ["chorus"]); assert.deepEqual(r.inVerse, ["verse", "worship"]); assert.equal(r.live, "worship"); assert.deepEqual(r.whole, ["hit"]); assert.match(r.heading, /song/i);
  await cu.evaluate(() => { CULights.show().sets = { perSection: false, song: [], sections: {} }; CULights.song.sections = []; CULights.song.pos = 0; CULights.goLook("worship"); });
});
await check("setlists: the worship leader's setlist imports its songs (title, tempo, key) - a song with no tracks here becomes one of yours", async () => {
  const r = await cu.evaluate(() => {
    const L = CULights; L.importSetlist({ id: "sl-test", name: "Sunday test", songs: [{ trackId: "trk-grace", title: "Amazing Grace Test", bpm: 72, key: "G" }, { trackId: "trk-way", title: "Way Maker Test", bpm: 68, key: "E" }] });
    const set = L.curSet(), mine = L.rig().localSongs.filter((s) => /Test$/.test(s.name));
    return { name: set.name, source: set.source, n: set.songs.length, mine: mine.map((s) => s.name + "@" + s.bpm + ":" + s.key), first: L.song.id === set.songs[0].localId || document.querySelector("#lxSongs").textContent.includes("Amazing Grace Test"), listed: document.querySelector("#lxSongs").textContent.includes("Way Maker Test") };
  });
  assert.equal(r.name, "Sunday test"); assert.equal(r.source, "cloud"); assert.equal(r.n, 2); assert.deepEqual(r.mine, ["Amazing Grace Test@72:G", "Way Maker Test@68:E"]); assert.ok(r.first && r.listed, JSON.stringify(r));
  // importing it again doesn't duplicate the songs; Save setlist keeps it here
  const again = await cu.evaluate(() => { CULights.importSetlist({ id: "sl-test", name: "Sunday test", songs: [{ trackId: "trk-grace", title: "Amazing Grace Test", bpm: 72 }] }); CULights.saveSet(); return { mine: CULights.rig().localSongs.filter((s) => /Test$/.test(s.name)).length, saved: CULights.rig().lxSets.some((x) => x.name === "Sunday test") }; });
  assert.deepEqual(again, { mine: 2, saved: true });
});
await check("record: presets pressed while the song plays land on its timeline; recording again over a part replaces only that part", async () => {
  const r = await cu.evaluate(async () => {
    const S = CULights.song, sh = CULights.show(), at = (bar) => { S.pos = CULights.timeOf(bar, 1) + 0.01; S.at = performance.now(); };
    sh.cues = []; sh.mode = "manual"; CULights.dirty(); S.playing = true; at(2); CULights.record(true);
    at(3); CULights.goLook("chorus"); at(6); CULights.goLook("bridge"); at(8); CULights.record(false);
    const first = CULights.show().cues.map((c) => c.look + "@" + c.bar);
    at(3); CULights.record(true); at(3); CULights.goLook("verse"); at(4); CULights.record(false); S.playing = false;
    return { first, second: CULights.show().cues.map((c) => c.look + "@" + c.bar) };
  });
  assert.deepEqual(r.first, ["chorus@3", "bridge@6"]); assert.deepEqual(r.second, ["verse@3", "bridge@6"]);
});
await check("every light's colour: one light changed in the list takes over live, and '+ Cue with these colours' puts it on the timeline", async () => {
  await cu.evaluate(() => CULights.showSub("show")); await cu.waitForSelector("#lxLights .lx-lt");
  const id = await cu.evaluate(() => CULights.rig().fixtures[2].id);
  await cu.evaluate((id) => { const el = document.querySelector('#lxLights [data-lt-id="' + id + '"] [data-lt="color"]'); el.value = "#ff0000"; el.dispatchEvent(new Event("input", { bubbles: true })); }, id);
  const st = await cu.evaluate((id) => { CULights.render(); return CULights.live.fixtureColor[id]; }, id); assert.ok(st.r > 0.9 && st.g < 0.1 && st.b < 0.1 && st.dim > 0.02, JSON.stringify(st));
  const before = await cu.evaluate(() => CULights.show().cues.length); await cu.click('[data-lt="cue"]');
  const c = await cu.evaluate(() => CULights.show().cues.filter((x) => x.kind === "fixture").pop()); assert.ok(c && c.fixtures[id].color === "#ff0000"); assert.equal(await cu.evaluate(() => CULights.show().cues.length), before + 1);
});
await check("tell it the show (built-in engine): sections, groups, colours, levels and the hits become presets and cues", async () => {
  await cu.evaluate(() => { CULights.show().cues = []; CULights.dirty(); const S = CULights.song; S.sections = [{ name: "Verse 1", start: 0, end: 8, bar: 1 }, { name: "Chorus", start: 8, end: 16, bar: 5 }]; S.hits = [9, 12]; });
  await cu.evaluate(() => CULights.showSub("show"));
  assert.ok(await cu.evaluate(() => document.querySelector("#lxChatWin").hidden), "the chat is a closed window until opened");
  await cu.click("#lxChatOpen"); await cu.waitForSelector("#lxChatWin:not([hidden])");
  await cu.fill("#lxChatIn", "back blue 30% for the verse, then chorus full white with strobes on the hits"); await cu.click("#lxChatGo");
  await cu.waitForFunction(() => /✓/.test(document.querySelector("#lxChatOut").textContent), null, { timeout: 5000 });
  await cu.waitForFunction(() => document.querySelectorAll("#lxChatLog .lx-msg.me").length === 1 && /✓/.test([...document.querySelectorAll("#lxChatLog .lx-msg.bot")].pop().textContent), null, { timeout: 5000 });
  await cu.click("#lxChatClose"); assert.ok(await cu.evaluate(() => document.querySelector("#lxChatWin").hidden));
  const r = await cu.evaluate(() => CULights.show().cues.map((c) => c.kind + "@" + c.bar + "." + c.beat + ":" + (CULights.lookById(c.look) || {}).name));
  assert.ok(r.some((x) => /^look@1\.1:Said: Verse/.test(x)) && r.some((x) => /^look@5\.1:Said: Chorus/.test(x)) && r.filter((x) => /^flash/.test(x)).length === 2, r.join(" | "));
  const back = await cu.evaluate(() => { const l = CULights.rig().looks.find((x) => /Said: Verse/.test(x.name)); return l.g.back; }); assert.equal(back.color, "#1f4dff"); assert.ok(Math.abs(back.dim - 0.3) < 0.01);
});
await check("parts on the chart tab: pick Bass / Keys / Drums / Trumpet and the part for the Pi's song is drawn", async () => {
  await cu.evaluate(() => CentralUsage.setMode("user")); await cu.click('[data-tab="chart"]');
  await pi.evaluate(() => { PPHub.push(true); PPTracks.sendDisplay(); });
  for (const inst of ["bass", "keys", "drums", "trumpet"]) {
    await cu.selectOption("#partPick", inst);
    await cu.waitForFunction(() => document.querySelector("#partView svg"), null, { timeout: 8000 });
    assert.ok(await cu.evaluate(() => !document.querySelector("#partView").hidden && document.querySelector("#chart").hidden));
  }
  assert.match(await cu.textContent("#partView"), /Trumpet/);
  await cu.selectOption("#partPick", "chart"); assert.ok(await cu.evaluate(() => document.querySelector("#partView").hidden && !document.querySelector("#chart").hidden));
});
// ---- roles: a main admin and a computer that joins, User 1 / User 2, the PIN, admin jobs
async function cuPage(label) {
  const c = await b.newContext({ viewport: { width: 1280, height: 800 } }); const p = await c.newPage();
  p.on("pageerror", (e) => errs.push(label + ":" + e)); p.on("console", (m) => { if (m.type() === "error" && !/favicon|NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED|padpedal\.local/.test(m.text())) errs.push(label + "-console:" + m.text()); });
  await p.addInitScript(() => { if (!localStorage.getItem("cu-centerHost")) localStorage.setItem("cu-centerHost", JSON.stringify("127.0.0.1:8095")); });
  await p.addInitScript(() => { try { if (!localStorage.getItem("cc-license")) localStorage.setItem("cc-license", JSON.stringify({ key: "ADEF-AULT-KEY0-2026", kind: "A", app: "control", okAt: Date.now(), production: "Test church", isDefault: true })); } catch (_) { } });   // (the app finds the main admin by itself; a plain browser page is told)
  await p.goto("file://" + path.join(here, "app", "index.html")); await p.waitForFunction(() => window.CentralUsage && window.CURoles);
  return p;
}
const tabsShown = (p) => p.evaluate(() => Array.from(document.querySelectorAll("#tabs [data-tab]")).filter((x) => !x.hidden).map((x) => x.dataset.tab).join(","));
let mainP, userP, keys;
await check("first launch: Main admin / Admin / User 1 / User 2; the main admin's setup asks inputs & outputs, the pairing PIN and its own role PIN - no Central Pedal needed", async () => {
  mainP = await cuPage("main");
  for (const r of ["main", "admin", "user1", "user2"]) assert.ok(await mainP.isVisible(`#modePick [data-rp='${r}']`), r);
  await mainP.fill("#modePick [data-rp='name']", "Sound desk"); await mainP.click("#modePick [data-rp='main']");
  await mainP.waitForSelector("#modePick [data-step='io']:not([hidden])"); await mainP.click("#modePick [data-rp='ioNext']");
  await mainP.fill("#modePick [data-rp='pair']", "1111"); await mainP.fill("#modePick [data-rp='pin']", "1111"); await mainP.click("#modePick [data-rp='pinsGo']");
  assert.match(await mainP.textContent("#modePick .rp-msg"), /different/);
  assert.equal(await mainP.evaluate(() => CentralUsage.state.connected), false, "not connected to the Central Pedal yet");
  // the Central Pedal (its PIN is the one picked on it) pairs with the main admin by itself once the main admin uses the same PIN
  await mainP.fill("#modePick [data-rp='pair']", code); await mainP.fill("#modePick [data-rp='pin']", "9876"); await mainP.click("#modePick [data-rp='pinsGo']");
  try { await mainP.waitForSelector("#modePick .rp-done:not([hidden]) .io-code", { timeout: 8000 }); }
  catch (e) { throw new Error("setup did not finish: " + await mainP.evaluate(() => JSON.stringify([document.querySelector("#modePick .rp-msg") && document.querySelector("#modePick .rp-msg").textContent, CentralUsage.role(), CURoles.keys(), CentralUsage.prefs.code, CURoles.view()]))); }
  keys = await mainP.evaluate(() => CURoles.keys());
  assert.equal(keys.pair, code); assert.equal(keys.pin, "9876");
  assert.match(await mainP.textContent("#modePick .rp-done"), new RegExp(keys.pin)); await mainP.click("#modePick [data-rp='close']");
  await mainP.waitForFunction(() => CURoles.view() && CURoles.view().youAreMain, null, { timeout: 5000 });
  assert.equal(await tabsShown(mainP), "devices,service,lights,mix,inears,lyrics,slides,video,io,controls,settings");
});
await check("the Central Pedal pairs with the main admin; the main admin is told where it is and connects to it (songs, charts, lyrics, tracks)", async () => {
  try { await mainP.waitForFunction(() => CURoles.view() && CURoles.view().pedal && CURoles.view().pedal.online, null, { timeout: 15000 }); }
  catch (e) { throw new Error("pedal not paired: " + log.split("\n").filter((l) => /center/.test(l)).slice(-5).join(" | ") + " " + ctrLog.slice(-300)); }
  await mainP.waitForFunction(() => CentralUsage.state.connected && CentralUsage.state.authed, null, { timeout: 10000 });
  await mainP.click('[data-tab="devices"]'); await mainP.waitForFunction(() => { const c = document.querySelector("#devicesRoot .dv-pedals"); return c && /Playing from/.test(c.textContent) && c.querySelector("select[data-dv-pjob]") && c.querySelector("select[data-dv-pjob]").value === "player"; }, null, { timeout: 6000 });
});
await check("another computer picks User 1 and pairs with the pairing PIN (wrong PIN refused)", async () => {
  userP = await cuPage("user"); await userP.waitForFunction(() => window.CUCenter.connected(), null, { timeout: 6000 });
  await userP.fill("#modePick [data-rp='name']", "Keys"); await userP.click("#modePick [data-rp='user1']");
  await userP.fill("#modePick [data-rp='joinPin']", "0000"); await userP.click("#modePick [data-rp='go']");
  await userP.waitForFunction(() => /not right/.test(document.querySelector("#modePick .rp-msg").textContent), null, { timeout: 5000 });
  await userP.fill("#modePick [data-rp='joinPin']", keys.pair); await userP.click("#modePick [data-rp='go']");
  await userP.waitForFunction(() => CentralUsage.role() === "user1" && !document.getElementById("modePick"), null, { timeout: 6000 });
  assert.equal(await userP.evaluate(() => CentralUsage.prefs.code), code);
  await userP.waitForFunction(() => CentralUsage.state.connected && CentralUsage.state.authed, null, { timeout: 10000 });   // found the Central Pedal through the main admin
  assert.equal(await tabsShown(userP), "chart,instrument,studio,inears,lyrics,io,controls,settings");
});
await check("the user flips to User 2 from the top bar: lyrics, chart, in-ears, settings", async () => {
  await userP.click("#roleChip [data-chip='user2']"); await userP.waitForFunction(() => CentralUsage.role() === "user2", null, { timeout: 5000 });
  assert.equal(await tabsShown(userP), "chart,inears,lyrics,controls,settings");
});
await check("becoming an admin needs the main admin's role PIN (wrong PIN refused)", async () => {
  await userP.click('[data-tab="settings"]'); await userP.waitForSelector("#settingsRoot input[name='rlRole'][value='admin']");
  await userP.evaluate(() => { CentralUsage.askText = () => Promise.resolve("0000"); window.__alerts = []; window.alert = (t) => window.__alerts.push(t); });
  await userP.click("#settingsRoot input[name='rlRole'][value='admin']");
  await userP.waitForFunction(() => window.__alerts.length > 0, null, { timeout: 5000 });
  assert.ok(/PIN/.test(await userP.evaluate(() => window.__alerts[0])) && await userP.evaluate(() => CentralUsage.role()) === "user2");
  await userP.evaluate((pin) => { CentralUsage.askText = () => Promise.resolve(pin); }, keys.pin);
  await userP.click("#settingsRoot input[name='rlRole'][value='admin']");
  await userP.waitForFunction(() => CentralUsage.role() === "admin", null, { timeout: 5000 });
});
await check("Devices tab: the main admin sees it online with its connection health, gives it jobs (Lights + Cameras) - it then shows only those tabs", async () => {
  await mainP.click('[data-tab="devices"]'); await mainP.waitForSelector("#devicesRoot tr:has-text('Keys')", { timeout: 6000 });
  await mainP.waitForFunction(() => { const tr = [...document.querySelectorAll("#devicesRoot tr")].find((x) => /Keys/.test(x.textContent)); return tr && /good|fair|poor/.test(tr.querySelector(".dv-g").textContent); }, null, { timeout: 15000 });
  await mainP.click("#devicesRoot tr:has-text('Keys') [data-dv='jobs']");
  await mainP.click("#devicesRoot tr:has-text('Keys') [data-dv-job='lights']"); await mainP.waitForTimeout(400);
  await mainP.click("#devicesRoot tr:has-text('Keys') [data-dv-job='cameras']");
  try { await userP.waitForFunction(() => JSON.stringify(CentralUsage.jobs()) === '["lights","cameras"]', null, { timeout: 5000 }); }
  catch (e) { throw new Error("jobs " + await userP.evaluate(() => JSON.stringify([CentralUsage.jobs(), CentralUsage.role()])) + " main view " + await mainP.evaluate(() => JSON.stringify(CURoles.view().devices))); }
  assert.equal(await tabsShown(userP), "lights,video,io,controls,settings");
});
await check("10.0: Central Control's setup asks what the computer will do (any of 7 jobs) after Main admin / Admin; Settings shows them and who runs each", async () => {
  const c = await b.newContext({ viewport: { width: 1280, height: 800 } }), p = await c.newPage();
  p.on("pageerror", (e) => errs.push("setup10:" + e));
  await p.addInitScript(() => { try { localStorage.setItem("cc-license", JSON.stringify({ key: "ADEF-AULT-KEY0-2026", kind: "A", app: "control", okAt: Date.now(), production: "Grace Harbor Church", isDefault: true })); localStorage.setItem("cu-centerHost", JSON.stringify("127.0.0.1:1")); } catch (_) { } });
  await p.goto("file://" + path.join(here, "app", "index.html") + "?edition=control"); await p.waitForFunction(() => window.CentralUsage && window.CURoles && document.querySelector("#modePick"));
  await p.waitForFunction(() => /Grace Harbor Church/.test(document.querySelector("#modePick .rp-church").textContent), null, { timeout: 8000 }).catch(() => { });
  assert.match(await p.textContent("#modePick .rp-church") + " " + await p.evaluate(() => JSON.stringify([!!window.PPLicense, window.PPLicense && window.PPLicense.state()])), /Grace Harbor Church/);
  await p.fill("#modePick [data-rp='name']", "Booth"); await p.click("#modePick [data-rp='admin']");
  await p.waitForSelector("#modePick [data-step='jobs']:not([hidden])");
  assert.equal(await p.locator("#modePick [data-rp-job]").count(), 7);
  for (const j of ["lights", "cameras", "inears", "tracks", "stream"]) await p.uncheck(`#modePick [data-rp-job='${j}']`);
  await p.click("#modePick [data-rp='jobsNext']");
  await p.waitForSelector("#modePick [data-step='join']:not([hidden])");
  assert.equal(await p.evaluate(() => JSON.stringify(CentralUsage.jobs())), '["lyrics","slides"]');
  await p.click("#modePick [data-rp='later']"); await p.waitForFunction(() => CentralUsage.role() === "admin" && !document.getElementById("modePick"));
  assert.equal(await tabsShown(p), "lyrics,slides,io,controls,settings");
  await p.click('[data-tab="settings"]'); await p.waitForSelector(".rl-jobs-card [data-rl-myjob='lights']");
  await p.check(".rl-jobs-card [data-rl-myjob='lights']"); await p.waitForFunction(() => CentralUsage.jobs().indexOf("lights") >= 0);
  assert.equal(await tabsShown(p), "lights,lyrics,slides,io,controls,settings");
  await c.close();
});
await check("Devices tab: Change role moves it back to User 1", async () => {
  await mainP.selectOption("#devicesRoot tr:has-text('Keys') [data-dv-role]", "user1"); await mainP.click("#devicesRoot tr:has-text('Keys') [data-dv='apply']");
  await userP.waitForFunction(() => CentralUsage.role() === "user1", null, { timeout: 5000 });
  assert.equal(await tabsShown(userP), "chart,instrument,studio,inears,lyrics,io,controls,settings");
});
await check("a computer set up as Admin without the role PIN waits; the main admin allows it on the Devices tab", async () => {
  const adminP = await cuPage("admin2"); await adminP.waitForFunction(() => window.CUCenter.connected(), null, { timeout: 6000 });
  await adminP.fill("#modePick [data-rp='name']", "Lights desk"); await adminP.click("#modePick [data-rp='admin']");
  await adminP.fill("#modePick [data-rp='joinPin']", keys.pair); await adminP.click("#modePick [data-rp='go']");
  await adminP.waitForFunction(() => CentralUsage.role() === "user1", null, { timeout: 6000 });
  await mainP.waitForSelector("#devicesRoot .dv-ask:has-text('Lights desk') [data-dv='allow']", { timeout: 6000 });
  await mainP.click("#devicesRoot .dv-ask:has-text('Lights desk') [data-dv='allow']");
  await adminP.waitForFunction(() => CentralUsage.role() === "admin", null, { timeout: 6000 });
  await adminP.context().close();
});
await check("service lock: the main admin locks everyone - the user's I/O tab and settings close; unlock brings them back", async () => {
  await mainP.click("#devicesRoot [data-dv='lockAll']");
  await userP.waitForFunction(() => document.body.classList.contains("svc-locked"), null, { timeout: 6000 });
  assert.ok(!(await tabsShown(userP)).split(",").includes("io"), await tabsShown(userP));
  assert.equal(await mainP.evaluate(() => document.body.classList.contains("svc-locked")), false, "the main admin is never locked");
  await mainP.waitForSelector("#devicesRoot [data-dv='lockAll'].on"); await mainP.click("#devicesRoot [data-dv='lockAll']");
  await userP.waitForFunction(() => !document.body.classList.contains("svc-locked"), null, { timeout: 6000 });
  assert.ok((await tabsShown(userP)).split(",").includes("io"));
});
await check("manual lock: nothing changes (the User 2 switch is refused) until the lock is held for 2 seconds", async () => {
  await userP.click("#mlBtn"); assert.ok(await userP.evaluate(() => document.body.classList.contains("man-locked")));
  await userP.click("#roleChip [data-chip='user2']", { force: true }); await userP.waitForTimeout(500);
  assert.equal(await userP.evaluate(() => CentralUsage.role()), "user1");
  await userP.click('[data-tab="lyrics"]'); assert.equal(await userP.evaluate(() => CentralUsage.prefs.tab), "lyrics", "tabs can still be looked at");
  const bx = await userP.locator("#mlBtn").boundingBox(); await userP.mouse.move(bx.x + 5, bx.y + 5); await userP.mouse.down(); await userP.waitForTimeout(2300); await userP.mouse.up();
  await userP.waitForFunction(() => !document.body.classList.contains("man-locked"), null, { timeout: 3000 });
});
await check("Service tab: the main admin adds a service and starts it - the user's countdown shows its own next part (the band's first song)", async () => {
  await mainP.click('[data-tab="service"]'); await mainP.waitForSelector("#serviceRoot [data-sv='add']"); await mainP.click("#serviceRoot [data-sv='add']");
  await mainP.waitForSelector("#serviceRoot .sv-items tbody tr"); await mainP.waitForTimeout(1200);
  await userP.waitForFunction(() => !document.querySelector("#cdChip").hidden, null, { timeout: 6000 });
  await mainP.click("#serviceRoot [data-sv='start']");
  await userP.waitForFunction(() => /▶ Welcome[\s\S]*Band: Song 1 in/.test(document.querySelector("#cdChip").textContent), null, { timeout: 6000 });
  await mainP.click("#serviceRoot [data-sv='next']");
  await userP.waitForFunction(() => /you're on/.test(document.querySelector("#cdChip").textContent), null, { timeout: 6000 });
  await new Promise((r) => setTimeout(r, 500));
  const st = await (await fetch("http://127.0.0.1:8080/api/service")).json(); assert.equal(st.run && st.run.item, 1, "the Central Pedal's stage display follows the service");
  await mainP.evaluate(() => { window.confirm = () => true; }); await mainP.click("#serviceRoot [data-sv='stop']");
});
await check("talkback: the main admin talks to the Band (the user's computer plays it); the user's talkback reaches only the main admin; a device moved to Production stops hearing Band talk", async () => {
  await mainP.waitForFunction(() => (CURoles.view().devices || []).some((d) => d.name === "Keys" && d.online && d.talkGroup === "band"), null, { timeout: 6000 });
  await mainP.evaluate(() => CUTalk.setMode("groups")); await userP.evaluate(() => CUTalk.setMode("groups"));   // (10.0.1: the party line is the default; this is the groups way)
  await mainP.evaluate(() => CUTalk.setGroup("band"));
  assert.ok(await mainP.evaluate(() => !!document.querySelector('#tbTop [data-tb-group="band"].on') && !!document.querySelector('#tbTop [data-tb-group="production"]')), "Band / Production next to TALK");
  await mainP.evaluate(() => CUTalk.on());
  try { await mainP.waitForFunction(() => CUTalk.state().on && CUTalk.state().sending && CUTalk.state().receivers === 1, null, { timeout: 8000 }); }
  catch (e) { throw new Error("main talk: " + await mainP.evaluate(() => JSON.stringify(CUTalk.state()))); }
  await userP.waitForFunction(() => CUTalk.state().heardFrames > 48000 * 0.3 && CUTalk.state().incoming.some((x) => x.group === "band"), null, { timeout: 8000 });
  assert.ok(await userP.evaluate(() => /Band/.test((document.getElementById("tbHeard") || {}).textContent || "")), "the user sees who is talking");
  await mainP.evaluate(() => CUTalk.off());
  assert.equal(await userP.evaluate(() => CUTalk.state().kindHere), "main", "a user talks to the main admin");
  const before = await mainP.evaluate(() => CUTalk.state().heardFrames);
  await userP.evaluate(() => CUTalk.on());
  await mainP.waitForFunction((n) => CUTalk.state().heardFrames > n + 48000 * 0.3 && CUTalk.state().incoming.some((x) => x.name === "Keys" && x.kind === "main"), before, { timeout: 8000 });
  await userP.evaluate(() => CUTalk.off());
  await mainP.click('[data-tab="devices"]'); await mainP.waitForSelector("#devicesRoot select[data-dv-tg]");
  await mainP.evaluate(() => { const tr = [...document.querySelectorAll("#devicesRoot tr")].find((x) => /Keys/.test(x.textContent)); const sel = tr.querySelector("select[data-dv-tg]"); sel.value = "production"; sel.dispatchEvent(new Event("change", { bubbles: true })); });
  await mainP.waitForFunction(() => (CURoles.view().devices || []).some((d) => d.name === "Keys" && d.talkGroup === "production"), null, { timeout: 5000 });
  await mainP.evaluate(() => CUTalk.on());
  await mainP.waitForFunction(() => !CUTalk.state().on && /Nobody in the Band/.test(CUTalk.state().error), null, { timeout: 5000 });
  await mainP.evaluate(() => { const tr = [...document.querySelectorAll("#devicesRoot tr")].find((x) => /Keys/.test(x.textContent)); const sel = tr.querySelector("select[data-dv-tg]"); sel.value = "band"; sel.dispatchEvent(new Event("change", { bubbles: true })); });
});
await check("(10.0.1) the party line is the default: the user's Talk (top right) reaches the main admin, who sees who is talking", async () => {
  await mainP.evaluate(() => CUTalk.setMode("team")); await userP.evaluate(() => CUTalk.setMode("team"));
  await userP.waitForSelector("#tbTop.tb-team [data-tb-talk='team']", { timeout: 4000 });
  assert.ok(await mainP.evaluate(() => !!document.querySelector("#tbTop.tb-team [data-tb-talk='team']")), "the main admin has the team Talk button too");
  const order = await userP.evaluate(() => getComputedStyle(document.getElementById("tbTop")).order); assert.equal(order, "10", "the Talk button sits at the top right");
  await userP.evaluate(() => CUTalk.on());
  try { await userP.waitForFunction(() => CUTalk.state().on && CUTalk.state().sending && CUTalk.state().receivers >= 1, null, { timeout: 8000 }); }
  catch (e) { throw new Error("team talk: " + await userP.evaluate(() => JSON.stringify(CUTalk.state()))); }
  await mainP.waitForFunction(() => CUTalk.state().incoming.some((x) => x.kind === "team"), null, { timeout: 8000 });
  await mainP.waitForFunction(() => /Keys|User/.test((document.querySelector("#tbTop .tb-who") || {}).textContent || ""), null, { timeout: 8000 });
  await userP.evaluate(() => CUTalk.off());
  await mainP.click('[data-tab="settings"]'); await mainP.waitForSelector("#settingsRoot .tb-settings [data-tb-mode='groups']", { timeout: 4000 });
  assert.match(await mainP.textContent("#settingsRoot .tb-settings"), /party line/);
});
await check("(10.0.1) changing what this computer does asks for the admin code: a wrong one changes nothing, the right one does", async () => {
  await mainP.evaluate(() => { CentralUsage.store.set("jobsPicked", true); window.__alerts = []; window.alert = (t) => window.__alerts.push(t); CentralUsage.askText = () => Promise.resolve("9999"); });
  await mainP.click('[data-tab="settings"]'); await mainP.waitForSelector("#settingsRoot [data-rl-myjob='lights']", { timeout: 4000 });
  const before = await mainP.evaluate(() => JSON.stringify(CentralUsage.jobs()));
  await mainP.evaluate(() => { const box = document.querySelector("#settingsRoot [data-rl-myjob='lights']"); box.checked = !box.checked; box.dispatchEvent(new Event("change", { bubbles: true })); });
  await mainP.waitForTimeout(500);
  assert.equal(await mainP.evaluate(() => JSON.stringify(CentralUsage.jobs())), before, "unchanged with a wrong code");
  assert.match(await mainP.evaluate(() => window.__alerts.join(" ")), /admin code/);
  const code = await mainP.evaluate(() => CURoles.keys().pin);
  await mainP.evaluate((c) => { CentralUsage.askText = () => Promise.resolve(c); }, code);
  await mainP.evaluate(() => { document.querySelectorAll("#settingsRoot [data-rl-myjob]").forEach((x) => { x.checked = x.dataset.rlMyjob === "lights" || x.dataset.rlMyjob === "lyrics"; }); const box = document.querySelector("#settingsRoot [data-rl-myjob='lights']"); box.dispatchEvent(new Event("change", { bubbles: true })); });
  await mainP.waitForFunction(() => JSON.stringify(CentralUsage.jobs()) === JSON.stringify(["lyrics", "lights"]), null, { timeout: 5000 });
  // everything again, for the checks after this one
  await mainP.evaluate(() => { document.querySelectorAll("#settingsRoot [data-rl-myjob]").forEach((x) => { x.checked = true; }); document.querySelector("#settingsRoot [data-rl-myjob='lights']").dispatchEvent(new Event("change", { bubbles: true })); });
  await mainP.waitForFunction(() => CentralUsage.jobs()[0] === "general", null, { timeout: 5000 });
});
await check("(10.0.1) a Central Control set up before 10.0 (an admin, no jobs picked) asks what it does on its first start; then shows only those tabs", async () => {
  const c = await b.newContext({ viewport: { width: 1280, height: 800 } }), p = await c.newPage(); p.on("pageerror", (e) => errs.push("old:" + e));
  await p.addInitScript(() => { try { localStorage.setItem("cu-mode", JSON.stringify("admin")); localStorage.setItem("cu-role", JSON.stringify("admin")); localStorage.setItem("cu-name", JSON.stringify("Old lights PC")); localStorage.setItem("cc-license", JSON.stringify({ key: "ADEF-AULT-KEY0-2026", kind: "A", app: "control", okAt: Date.now(), production: "Test church", isDefault: true })); } catch (_) { } });
  await p.goto("file://" + path.join(here, "app", "index.html") + "?edition=control"); await p.waitForFunction(() => window.CentralUsage && window.CURoles);
  await p.waitForSelector("#jobsPick [data-jp-job='lights']", { timeout: 6000 });
  await p.check("#jobsPick [data-jp-job='lights']"); await p.click("#jobsPick [data-jp='save']");
  await p.waitForFunction(() => !document.getElementById("jobsPick") && JSON.stringify(CentralUsage.jobs()) === JSON.stringify(["lights"]) && CentralUsage.store.get("jobsPicked", false), null, { timeout: 5000 });
  const tabs = await p.evaluate(() => CentralUsage.tabsFor("admin")); assert.ok(tabs.includes("lights") && !tabs.includes("lyrics") && !tabs.includes("mix"), tabs.join(","));
  await p.reload(); await p.waitForFunction(() => window.CentralUsage && window.CURoles); await p.waitForTimeout(600);
  assert.equal(await p.evaluate(() => !!document.getElementById("jobsPick")), false, "asked only once");
  await c.close();
});
await check("Forget role on the main admin goes back to the first-launch choice", async () => {
  await mainP.click('[data-tab="settings"]'); await mainP.waitForSelector("#settingsRoot [data-rl='forget']");
  // (10.0.1) it asks for the admin code first: a wrong one keeps everything as it is
  await mainP.evaluate(() => { window.confirm = () => true; window.__alerts = []; window.alert = (t) => window.__alerts.push(t); CentralUsage.askText = () => Promise.resolve("9999"); });
  await mainP.click("#settingsRoot [data-rl='forget']"); await mainP.waitForTimeout(400);
  assert.equal(await mainP.evaluate(() => CentralUsage.role()), "main", "a wrong admin code doesn't forget the setup");
  assert.match(await mainP.evaluate(() => window.__alerts.join(" ")), /admin code/);
  const code = await mainP.evaluate(() => CURoles.keys().pin);
  await mainP.evaluate((c) => { CentralUsage.askText = () => Promise.resolve(c); }, code); await mainP.click("#settingsRoot [data-rl='forget']");
  await mainP.waitForSelector("#modePick [data-rp='main']", { timeout: 5000 }); assert.equal(await mainP.evaluate(() => CentralUsage.role()), null);
});
await check("iPhone / iPad: Central Control opens from the Central Pedal (http://pi:8080/cu/), joins as a user, shows the user tabs and the parts", async () => {
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
  const p = await c.newPage(); p.on("pageerror", (e) => errs.push("web:" + e)); p.on("console", (m) => { if (m.type() === "error" && !/favicon|icon\.png|404|ERR_CONNECTION_REFUSED/.test(m.text())) errs.push("web-console:" + m.text()); });
  await p.addInitScript(() => { try { if (!localStorage.getItem("cc-license")) localStorage.setItem("cc-license", JSON.stringify({ key: "UDEF-AULT-KEY0-2026", kind: "U", app: "usage", okAt: Date.now(), production: "Test church", isDefault: true })); } catch (_) { } });   // (a phone is Central Usage: its default U key)
  const r = await p.goto("http://127.0.0.1:8080/cu/"); assert.equal(r.status(), 200);
  await p.waitForFunction(() => window.CentralUsage && window.CURoles && CentralUsage.web);
  const man = await (await fetch("http://127.0.0.1:8080/cu/manifest.webmanifest")).json(); assert.equal(man.display, "standalone");
  assert.ok(await p.isHidden("#modePick [data-rp='main']"), "no main admin on a phone");
  await p.waitForFunction(() => CentralUsage.state.connected, null, { timeout: 8000 });
  assert.ok(await p.isHidden("#modePick [data-rp='admin']"), "no admin on a phone");
  await p.fill("#modePick [data-rp='name']", "Sarah's iPhone"); await p.click("#modePick [data-rp='user1']");
  await p.fill("#modePick [data-rp='joinPin']", code); await p.click("#modePick [data-rp='go']");
  await p.waitForFunction(() => CentralUsage.role() === "user1" && !document.getElementById("modePick"), null, { timeout: 6000 });
  assert.equal(await p.evaluate(() => Array.from(document.querySelectorAll("#tabs [data-tab]")).filter((x) => !x.hidden).map((x) => x.dataset.tab).join(",")), "chart,inears,lyrics,settings");
  await p.click('[data-tab="chart"]'); await p.selectOption("#partPick", "bass");
  await p.waitForFunction(() => document.querySelector("#partView svg"), null, { timeout: 8000 });
  const wide = await p.evaluate(() => document.documentElement.scrollWidth); assert.ok(wide <= 400, "no sideways scrolling of the page: " + wide);
  await c.close();
});
await check("no website yet: Central Usage asks for its U key; an A key and a random key are refused, the default U key opens it and stays after a reload", async () => {
  const c = await b.newContext({ viewport: { width: 1280, height: 800 } }), p = await c.newPage(); p.on("pageerror", (e) => errs.push("usage-key:" + e));
  await p.goto("file://" + path.join(here, "app", "index.html") + "?edition=usage"); await p.waitForSelector("dialog#licWiz[open] #lwProd", { timeout: 10000 });
  await p.fill("#lwProd", "Grace Church"); await p.click('#licWiz [data-lw="prod"]'); await p.waitForSelector("#lwKey");
  await p.fill("#lwKey", "ADEF-AULT-KEY0-2026"); await p.click('#licWiz [data-lw="key"]');
  assert.match(await p.textContent("#licWiz .bad"), /That's an A key .*Central Usage needs a key that starts with U\./);
  await p.fill("#lwKey", "UQ7K-2MXR-9TLB-4WZD"); await p.click('#licWiz [data-lw="key"]'); await p.waitForTimeout(100);
  assert.match(await p.textContent("#licWiz .bad"), /website isn't open\. Use the default key for now\./);
  await p.fill("#lwKey", "UDEF-AULT-KEY0-2026"); await p.click('#licWiz [data-lw="key"]'); await p.waitForSelector("dialog#licWiz", { state: "detached", timeout: 4000 });
  await p.reload(); await p.waitForFunction(() => window.CentralUsage && window.PPLicense); await p.waitForTimeout(800);
  assert.equal(await p.$("dialog#licWiz"), null); assert.equal(await p.evaluate(() => PPLicense.app()), "usage");
  await c.close();
});
await check("two apps from one code: Central Control offers the main admin and Admin; Central Usage (and phones) only User 1 / User 2", async () => {
  for (const [ed, show, hide] of [["control", ["main", "admin"], ["user1", "user2"]], ["usage", ["user1", "user2"], ["main", "admin"]]]) {
    const c = await b.newContext({ viewport: { width: 1280, height: 800 } }), p = await c.newPage();
    await p.goto("file://" + path.join(here, "app", "index.html") + "?edition=" + ed); await p.waitForFunction(() => window.CentralUsage && window.CURoles && document.querySelector("#modePick"));
    for (const r of show) assert.ok(await p.isVisible(`#modePick [data-rp='${r}']`), ed + " shows " + r);
    for (const r of hide) assert.ok(!(await p.isVisible(`#modePick [data-rp='${r}']`)), ed + " hides " + r);
    assert.match(await p.textContent("#modePick .rp-other"), ed === "usage" ? /Central Control/ : /Central Usage/);
    if (ed === "usage") { await p.evaluate(() => CentralUsage.setRole("admin")); assert.notEqual(await p.evaluate(() => CentralUsage.role()), "admin", "Central Usage can't become an admin"); }
    await c.close();
  }
});
await check("no page errors", () => assert.deepEqual(errs, []));
await b.close(); drv.kill(); ctr.kill();
console.log(failures ? "\n" + failures + " CHECK(S) FAILED" : "\nALL CENTRAL USAGE CHECKS PASSED"); process.exit(failures ? 1 : 0);
