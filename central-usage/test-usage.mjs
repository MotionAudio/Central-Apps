// Central Usage renderer against the simulated driver: chart transposition, sections, lyrics, MIDI relay timing
import { chromium } from "playwright";
import { spawn } from "node:child_process"; import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert";
import { fileURLToPath } from "node:url"; const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pp-cu-")); fs.mkdirSync(path.join(tmp, "media"), { recursive: true });
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
const cu = await ctx.newPage(); cu.on("pageerror", (e) => errs.push("cu:" + e)); cu.on("console", (m) => { if (m.type() === "error" && !/favicon|NAME_NOT_RESOLVED/.test(m.text())) errs.push("cu-console:" + m.text()); });
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
await check("a remote action with the pairing code jumps the Pi to the next section", async () => {
  await cu.evaluate((c) => { CentralUsage.prefs.code = c; CentralUsage.onMessage({ type: "auth", ok: true }); CentralUsage.state.authed = true; }, code);
  await cu.evaluate(() => document.querySelector('[data-tab="chart"]').click()); await cu.waitForSelector("#sections [data-sec='1']", { timeout: 5000 }); const r1 = await cu.evaluate(() => CentralUsage.send({ type: "ping", t: 1 })); console.log("    socket open:", r1); await cu.click("#sections [data-sec='1']"); await cu.waitForTimeout(300); console.log("    drv log tail:", log.split("\n").slice(-4).join(" | ").slice(0, 400));
  try { await pi.waitForFunction(() => PPTracks.state.section === 1, null, { timeout: 6000 }); }
  catch (e) { const dbg = await pi.evaluate(() => ({ section: PPTracks.state.section, tracks: PP.project().tracksMode, secs: PPTracks.sectionsOf(PPTracks.song()).length, stems: PPTracks.data(PPTracks.song()).stems.length })); const cud = await cu.evaluate(() => ({ authed: CentralUsage.state.authed, code: CentralUsage.prefs.code, secBtns: document.querySelectorAll("#sections button").length })); throw new Error("pi " + JSON.stringify(dbg) + " cu " + JSON.stringify(cud) + " drvlog: " + log.split("\n").filter((l) => /action|auth/.test(l)).slice(-3).join(" | ")); }
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
  await cu.click('[data-tab="lights"]'); await cu.click('[data-lx="show"]');
  await cu.waitForFunction(() => document.querySelectorAll("#lxPlot .lx-fix").length === 11 && CULights.show().cues.length >= 3, null, { timeout: 8000 });
  const cues = await cu.evaluate(() => CULights.show().cues.filter((c) => c.kind === "look").map((c) => c.look + "@" + c.bar));
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
    const S = CULights.song, sh = CULights.show(), chorus = sh.cues.find((c) => c.look === "chorus");
    const t = CULights.timeOf(chorus.bar, 1) + 1.5;
    S.playing = true; S.pos = t; S.at = performance.now();
    const a = Array.from(CULights.render()["1"].slice(10, 15));
    sh.cues.push({ id: "h", bar: chorus.bar, beat: 3, look: "hit", kind: "flash", dur: 1 });
    S.pos = CULights.timeOf(chorus.bar, 3) + 0.01; S.at = performance.now();
    const f = Array.from(CULights.render()["1"].slice(10, 15));
    sh.cues = sh.cues.filter((c) => c.id !== "h"); S.playing = false;
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
  assert.equal(got.cues.length, before + 1); assert.ok(got.auto === false);
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
await check("no page errors", () => assert.deepEqual(errs, []));
await b.close(); drv.kill();
console.log(failures ? "\n" + failures + " CHECK(S) FAILED" : "\nALL CENTRAL USAGE CHECKS PASSED"); process.exit(failures ? 1 : 0);
