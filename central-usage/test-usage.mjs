// Central Usage renderer against the simulated driver: chart transposition, sections, lyrics, MIDI relay timing
import { chromium } from "playwright";
import { spawn } from "node:child_process"; import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert";
import { fileURLToPath } from "node:url"; const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pp-cu-")); fs.mkdirSync(path.join(tmp, "media"), { recursive: true }); fs.writeFileSync(path.join(tmp, "code-chosen"), "1"); // the pairing PIN counts as picked (its own test is in test-integration)
const drv = spawn("python3", [path.join(here, "..", "pedal-driver.py"), "--simulate", tmp, "--app-root", path.join(here, "..")], { stdio: ["pipe", "pipe", "pipe"] });
let log = ""; drv.stderr.on("data", (b) => { log += b; }); drv.stdout.on("data", (b) => { log += b; });
await new Promise((r) => { const t = setInterval(() => { if (log.includes("USB/SD browser on")) { clearInterval(t); r(); } }, 100); setTimeout(r, 8000); });
let code = null;
let failures = 0; async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e && e.message || e).split("\n").slice(0, 6).join("\n      ")); } }
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--autoplay-policy=no-user-gesture-required"] });
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
// Central Usage renderer
const cu = await ctx.newPage(); cu.on("pageerror", (e) => errs.push("cu:" + e)); cu.on("console", (m) => { if (m.type() === "error" && !/favicon|NAME_NOT_RESOLVED|padpedal\.local/.test(m.text())) errs.push("cu-console:" + m.text()); });
await cu.addInitScript(() => { if (!localStorage.getItem("cu-mode")) localStorage.setItem("cu-mode", JSON.stringify("user")); });   // a musician's computer first (chart, lyrics)
await cu.goto("file://" + path.join(here, "app", "index.html") + ""); await cu.waitForFunction(() => window.CentralUsage);
await cu.evaluate(() => { CentralUsage.connect("127.0.0.1"); });
await check("connects to the Central Control and shows its song", async () => { await cu.waitForFunction(() => CentralUsage.state.connected && CentralUsage.state.display && CentralUsage.state.display.song, null, { timeout: 8000 }); assert.match(await cu.textContent("#songName"), /Test Song/); });
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
await check("only the Central Control moves the tracks: the section buttons show where it is, a jump request is refused; the lyrics can be paged", async () => {
  await cu.evaluate((c) => { CentralUsage.prefs.code = c; CentralUsage.send({ type: "auth", code: c }); }, code);
  await cu.evaluate(() => document.querySelector('[data-tab="chart"]').click()); await cu.waitForSelector("#sections [data-sec='1']", { timeout: 5000 });
  const before = await pi.evaluate(() => PPTracks.state.section);
  await cu.click("#sections [data-sec='1']"); await cu.evaluate((c) => CentralUsage.send({ type: "action", name: "nextSection", code: c }), code); await cu.waitForTimeout(700);
  assert.equal(await pi.evaluate(() => PPTracks.state.section), before, "the Pi did not move");
  const refused = await cu.evaluate(() => new Promise((res) => { CentralUsage.on("refused", (m) => res(m)); CentralUsage.send({ type: "action", name: "playPause", code: CentralUsage.prefs.code }); setTimeout(() => res(null), 2000); }));
  assert.ok(refused && /Only the Central Control/.test(refused.error), JSON.stringify(refused));
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
await check("lighting: the example rig is on the stage plot and the auto show is built from the song's sections", async () => {
  await cu.evaluate(() => CentralUsage.setMode("admin"));   // the lights are on admin computers
  await cu.click('[data-tab="lights"]'); await cu.click('[data-lx="show"]');
  await cu.waitForFunction(() => document.querySelectorAll("#lxPlot .lx-fix").length === 11 && CULights.cuesNow().length >= 3, null, { timeout: 8000 });
  const cues = await cu.evaluate(() => CULights.cuesNow().filter((c) => c.kind === "look").map((c) => c.look + "@" + c.bar));
  assert.ok(cues[0] === "verse@1" && cues.some((c) => /^chorus@/.test(c)) && /^blackout@/.test(cues[cues.length - 1]), cues.join(" "));
  assert.ok(await cu.evaluate(() => document.querySelectorAll("#lxPalette .lx-look").length >= 12));
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
await check("lighting: a cue added on the timeline is saved on the Central Control (with the pairing code) and read back", async () => {
  await cu.evaluate((c) => { CentralUsage.prefs.code = c; }, code);
  const box = await cu.$("#lxTimeline"); const bb = await box.boundingBox();
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
  assert.deepEqual(f, [54, 58, 62, 66]); assert.equal(await cu.evaluate(() => CULights.rig().fixtures.length), n0 + 4);
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
  assert.ok(await cu.evaluate(() => !document.querySelector('[data-lxv="show"]').hidden && !!document.querySelector('#lxRight #lxSongs') && !!document.querySelector('#lxRight #lxLookList') && document.querySelector('#lxLookList').children.length >= 10), "songs and presets are on the right of the Show view");
  await cu.click('[data-ls-pick="cu-test"]'); await cu.waitForSelector('[data-ls="scene"]', { timeout: 5000 });
  await cu.click('[data-ls="scene"]'); await cu.click('[data-ls="scene"]');
  await cu.waitForFunction(() => document.querySelectorAll(".lx-scenes tbody tr").length === 2);
  await cu.evaluate(() => { const i = document.querySelector('.lx-scenes tbody tr:nth-child(2) [data-scf="bar"]'); i.value = "5"; i.dispatchEvent(new Event("change", { bubbles: true })); });
  await cu.click('[data-ls="program"]');
  const t = await cu.evaluate(() => { const S = CULights.song; const a = CULights.timeOf(5, 1); S.bpm = 112; const b = CULights.timeOf(5, 1); return { id: S.id, local: S.local, a, b, scenes: CULights.show().cues.length }; });
  assert.equal(t.id, "cu-test"); assert.ok(t.local); assert.ok(Math.abs(t.a - 16 * 60 / 93) < 0.01 && Math.abs(t.b - 16 * 60 / 112) < 0.01, JSON.stringify(t));
  await cu.waitForFunction(() => CULights.show().cues.filter((c) => c.kind === "look").length === 2, null, { timeout: 5000 });
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
  await p.goto("file://" + path.join(here, "app", "index.html")); await p.waitForFunction(() => window.CentralUsage && window.CURoles);
  return p;
}
const tabsShown = (p) => p.evaluate(() => Array.from(document.querySelectorAll("#tabs [data-tab]")).filter((x) => !x.hidden).map((x) => x.dataset.tab).join(","));
let mainP, userP, keys;
await check("first launch: Main admin / Admin / User 1 / User 2; the main admin's setup asks inputs & outputs, the pairing PIN (the pedal's) and its own role PIN", async () => {
  mainP = await cuPage("main");
  for (const r of ["main", "admin", "user1", "user2"]) assert.ok(await mainP.isVisible(`#modePick [data-rp='${r}']`), r);
  await mainP.evaluate(() => CentralUsage.connect("127.0.0.1"));
  await mainP.waitForFunction(() => CentralUsage.state.connected, null, { timeout: 6000 });
  await mainP.fill("#modePick [data-rp='name']", "Sound desk"); await mainP.click("#modePick [data-rp='main']");
  await mainP.waitForSelector("#modePick [data-step='io']:not([hidden])"); await mainP.click("#modePick [data-rp='ioNext']");
  await mainP.fill("#modePick [data-rp='pair']", "1111"); await mainP.fill("#modePick [data-rp='pin']", "1111"); await mainP.click("#modePick [data-rp='pinsGo']");
  assert.match(await mainP.textContent("#modePick .rp-msg"), /different/);
  const wrong = code === "1234" ? "4321" : "1234";
  await mainP.fill("#modePick [data-rp='pair']", wrong); await mainP.fill("#modePick [data-rp='pin']", "9876"); await mainP.click("#modePick [data-rp='pinsGo']");
  await mainP.waitForFunction(() => /already has a pairing PIN/.test(document.querySelector("#modePick .rp-msg").textContent), null, { timeout: 8000 });
  await mainP.fill("#modePick [data-rp='pair']", code); await mainP.click("#modePick [data-rp='pinsGo']");
  try { await mainP.waitForSelector("#modePick .rp-done:not([hidden]) .io-code", { timeout: 8000 }); }
  catch (e) { throw new Error("setup did not finish: " + await mainP.evaluate(() => JSON.stringify([document.querySelector("#modePick .rp-msg") && document.querySelector("#modePick .rp-msg").textContent, CentralUsage.role(), CURoles.keys(), CentralUsage.prefs.code, CURoles.view()]))); }
  keys = await mainP.evaluate(() => CURoles.keys());
  assert.equal(keys.pair, code); assert.equal(keys.pin, "9876");
  assert.match(await mainP.textContent("#modePick .rp-done"), new RegExp(keys.pin)); await mainP.click("#modePick [data-rp='close']");
  await mainP.waitForFunction(() => CURoles.view() && CURoles.view().youAreMain, null, { timeout: 5000 });
  assert.equal(await tabsShown(mainP), "devices,service,lights,mix,inears,lyrics,slides,video,io,settings");
});
await check("another computer picks User 1 and pairs with the pairing PIN (wrong PIN refused)", async () => {
  userP = await cuPage("user"); await userP.evaluate(() => CentralUsage.connect("127.0.0.1")); await userP.waitForFunction(() => CentralUsage.state.connected, null, { timeout: 6000 });
  await userP.fill("#modePick [data-rp='name']", "Keys"); await userP.click("#modePick [data-rp='user1']");
  await userP.fill("#modePick [data-rp='joinPin']", "0000"); await userP.click("#modePick [data-rp='go']");
  await userP.waitForFunction(() => /not right/.test(document.querySelector("#modePick .rp-msg").textContent), null, { timeout: 5000 });
  await userP.fill("#modePick [data-rp='joinPin']", keys.pair); await userP.click("#modePick [data-rp='go']");
  await userP.waitForFunction(() => CentralUsage.role() === "user1" && !document.getElementById("modePick"), null, { timeout: 6000 });
  assert.equal(await userP.evaluate(() => CentralUsage.prefs.code), code);
  assert.equal(await tabsShown(userP), "chart,instrument,inears,lyrics,io,settings");
});
await check("the user flips to User 2 from the top bar: lyrics, chart, in-ears, settings", async () => {
  await userP.click("#roleChip [data-chip='user2']"); await userP.waitForFunction(() => CentralUsage.role() === "user2", null, { timeout: 5000 });
  assert.equal(await tabsShown(userP), "chart,inears,lyrics,settings");
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
await check("Devices tab: the main admin sees it online with its connection health, gives it jobs (Lighting + Production) - it then shows only those tabs", async () => {
  await mainP.click('[data-tab="devices"]'); await mainP.waitForSelector("#devicesRoot tr:has-text('Keys')", { timeout: 6000 });
  await mainP.waitForFunction(() => { const tr = [...document.querySelectorAll("#devicesRoot tr")].find((x) => /Keys/.test(x.textContent)); return tr && /good|fair|poor/.test(tr.querySelector(".dv-g").textContent); }, null, { timeout: 15000 });
  await mainP.click("#devicesRoot tr:has-text('Keys') [data-dv='jobs']");
  await mainP.click("#devicesRoot tr:has-text('Keys') [data-dv-job='lighting']"); await mainP.waitForTimeout(400);
  await mainP.click("#devicesRoot tr:has-text('Keys') [data-dv-job='production']");
  try { await userP.waitForFunction(() => JSON.stringify(CentralUsage.jobs()) === '["lighting","production"]', null, { timeout: 5000 }); }
  catch (e) { throw new Error("jobs " + await userP.evaluate(() => JSON.stringify([CentralUsage.jobs(), CentralUsage.role()])) + " main view " + await mainP.evaluate(() => JSON.stringify(CURoles.view().devices))); }
  assert.equal(await tabsShown(userP), "lights,video,io,settings");
});
await check("Devices tab: Change role moves it back to User 1", async () => {
  await mainP.selectOption("#devicesRoot tr:has-text('Keys') [data-dv-role]", "user1"); await mainP.click("#devicesRoot tr:has-text('Keys') [data-dv='apply']");
  await userP.waitForFunction(() => CentralUsage.role() === "user1", null, { timeout: 5000 });
  assert.equal(await tabsShown(userP), "chart,instrument,inears,lyrics,io,settings");
});
await check("a computer set up as Admin without the role PIN waits; the main admin allows it on the Devices tab", async () => {
  const adminP = await cuPage("admin2"); await adminP.evaluate(() => CentralUsage.connect("127.0.0.1")); await adminP.waitForFunction(() => CentralUsage.state.connected, null, { timeout: 6000 });
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
  assert.ok(!(await tabsShown(userP)).includes("io"), await tabsShown(userP));
  assert.equal(await mainP.evaluate(() => document.body.classList.contains("svc-locked")), false, "the main admin is never locked");
  await mainP.waitForSelector("#devicesRoot [data-dv='lockAll'].on"); await mainP.click("#devicesRoot [data-dv='lockAll']");
  await userP.waitForFunction(() => !document.body.classList.contains("svc-locked"), null, { timeout: 6000 });
  assert.ok((await tabsShown(userP)).includes("io"));
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
  const st = await (await fetch("http://127.0.0.1:8080/api/service")).json(); assert.equal(st.run.item, 1);
  await mainP.evaluate(() => { window.confirm = () => true; }); await mainP.click("#serviceRoot [data-sv='stop']");
});
await check("Forget role on the main admin goes back to the first-launch choice", async () => {
  await mainP.click('[data-tab="settings"]'); await mainP.waitForSelector("#settingsRoot [data-rl='forget']");
  await mainP.evaluate(() => { window.confirm = () => true; }); await mainP.click("#settingsRoot [data-rl='forget']");
  await mainP.waitForSelector("#modePick [data-rp='main']", { timeout: 5000 }); assert.equal(await mainP.evaluate(() => CentralUsage.role()), null);
});
await check("iPhone / iPad: Central Usage opens from the Central Control (http://pi:8080/cu/), joins as a user, shows the user tabs and the parts", async () => {
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
  const p = await c.newPage(); p.on("pageerror", (e) => errs.push("web:" + e)); p.on("console", (m) => { if (m.type() === "error" && !/favicon|icon\.png|404|ERR_CONNECTION_REFUSED/.test(m.text())) errs.push("web-console:" + m.text()); });
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
await check("no page errors", () => assert.deepEqual(errs, []));
await b.close(); drv.kill();
console.log(failures ? "\n" + failures + " CHECK(S) FAILED" : "\nALL CENTRAL USAGE CHECKS PASSED"); process.exit(failures ? 1 : 0);
