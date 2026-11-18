// Central Production 10.8 in the browser: the pop-up keyboard (⌘K / Ctrl+K) and the search on ⌘P, drag and drop (files
// and folders of stems anywhere, MIDI files, reordering tracks, samples from the browser, dragging a track out), external
// MIDI instrument tracks, your own instruments (SFZ / SoundFont), and the pro tools (capture MIDI, the arpeggiator and
// chords, scale, quantize strength and swing, humanize, the sustain pedal and pitch bend recorded).
//   node test-pro.mjs            (CHROME=<chromium> to pick the browser; SHOTS=<dir> saves screenshots)
import { chromium } from "playwright";
import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import assert from "node:assert";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, ".."), pub = path.join(root, "server", "public");
let failures = 0; async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e && e.stack || e).split("\n").slice(0, 8).join("\n      ")); } }
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".json": "application/json" };
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"), send = (code, body, type) => { res.writeHead(code, { "Content-Type": type || "application/json" }); res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
  if (u.pathname.startsWith("/v1/")) return send(404, { error: "offline" });
  // the Central Pedal's page (Central Pedal Control) is served from the repository's root, the website from server/public
  const fromRoot = u.pathname.startsWith("/pedal/"), baseDir = fromRoot ? root : pub;
  let f = path.join(baseDir, decodeURIComponent(fromRoot ? u.pathname.slice(6) : u.pathname)); if (f.endsWith("/")) f += "index.html";
  if (!f.startsWith(baseDir) || !fs.existsSync(f)) return send(404, "not here", "text/plain");
  send(200, fs.readFileSync(f), TYPES[path.extname(f)] || "application/octet-stream");
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const base = "http://127.0.0.1:" + srv.address().port;
const exe = [process.env.CHROME, "/usr/bin/google-chrome", "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome"].filter((p) => p && fs.existsSync(p))[0];
const browser = await chromium.launch(Object.assign({ args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] }, exe ? { executablePath: exe } : {}));
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
let page; const errs = [];
const shots = process.env.SHOTS; const shot = async (n) => { if (shots) await page.screenshot({ path: path.join(shots, n + ".png") }); };
async function openPage() {
  page = await ctx.newPage(); page.on("pageerror", (e) => errs.push(String(e.stack || e))); page.on("console", (m) => { if (m.type() === "error" && !/favicon|404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto(base + "/production/");
  await page.waitForFunction(() => window.CP && window.CDaw && window.CDawUI && document.querySelector(".cp-kinds"));
}
await openPage();
const T = (fn, arg) => page.evaluate(fn, arg);
async function newTrack(name) {
  await page.click('#cpStart [data-new="track"]'); await page.fill("#npName", name || "Pro Song"); await page.click("#npForm .primary");
  await page.waitForSelector(".cdaw .cd-tname");
}

// ------------------------------------------------------------- the pop-up keyboard and the search
await check("the keyboard: js/keys-popup.js (Central Pedal Control) is the same file as server/public/daw/keys-popup.js", () => assert.equal(fs.readFileSync(path.join(root, "js", "keys-popup.js"), "utf8"), fs.readFileSync(path.join(pub, "daw", "keys-popup.js"), "utf8")));
await check("⌘P / Ctrl+P opens the search; Ctrl+K with nothing open shows the keyboard and says what to do", async () => {
  await page.keyboard.press("Control+p"); await page.waitForSelector(".cmdk:not([hidden])");
  await page.keyboard.press("Escape"); assert.equal(await T(() => window.CmdK.isOpen()), false);
  await page.keyboard.press("Control+k"); await page.waitForSelector(".ckeys:not([hidden])");
  const r = await T(() => ({ search: window.CmdK.isOpen(), say: document.querySelector(".ckeys-say").textContent, keys: document.querySelectorAll(".ckeys [data-n]").length }));
  assert.equal(r.search, false, "Ctrl+K must not open the search here"); assert.ok(/project/i.test(r.say), r.say); assert.equal(r.keys, 49);
  await page.keyboard.press("Escape"); assert.equal(await T(() => window.CKeys.isOpen()), false);
});
await check("in a song, the keyboard plays the selected instrument track: the computer keys, the mouse, octaves and velocity, sustain", async () => {
  await newTrack("Keys Song");
  const keys = await T(() => { const t = CDaw.project().tracks.find((x) => x.name === "Keys"); CDawUI.select(t.id); return t.id; });
  await T(() => { window.__live = []; const orig = CDaw.live; window.__origLive = orig; CDaw.live = function (id, d) { window.__live.push([id].concat(d)); return orig.apply(this, arguments); }; });
  await page.keyboard.press("Control+k"); await page.waitForSelector(".ckeys:not([hidden])");
  assert.match(await T(() => document.querySelector(".ck-name").textContent), /^Keys/);
  await page.keyboard.down("a"); await page.keyboard.up("a");           // C4
  await page.keyboard.press("x"); await page.keyboard.down("k"); await page.keyboard.up("k");   // octave up: C6
  await page.keyboard.press("c");                                        // softer
  await page.keyboard.down("Tab"); await page.keyboard.down("d"); await page.keyboard.up("d"); await page.keyboard.up("Tab");   // E5 held by the sustain, let go with Tab
  const box = await page.locator('.ckeys [data-n="72"]').boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height - 8); await page.mouse.down(); await page.mouse.up();
  const live = await T(() => window.__live.map((x) => x.join(",")));
  assert.equal(live[0], keys + ",144,60,100"); assert.equal(live[1], keys + ",128,60,0");
  assert.equal(live[2], keys + ",144,84,100");
  assert.ok(live.includes(keys + ",144,76,80"), "softer E5: " + live.join(" | ")); assert.ok(live.includes(keys + ",176,64,127") && live.includes(keys + ",176,64,0"), "sustain: " + live.join(" | "));
  assert.ok(live.some((x) => /,144,72,1[0-2]\d$/.test(x)), "the mouse low on a key plays hard: " + live.join(" | "));
  // keys it doesn't use still reach the DAW: Space plays
  await page.keyboard.press("Space"); await page.waitForTimeout(150); const playing = await T(() => CDaw.state().playing); await T(() => CDaw.stop({ home: true }));
  assert.equal(playing, true, "Space still plays while the keyboard is open");
  await shot("keys-daw");
  await page.keyboard.press("Control+k"); assert.equal(await T(() => window.CKeys.isOpen()), false);
  await T(() => { CDaw.live = window.__origLive; });
});
await check("a MIDI keyboard lights the keys and the MIDI light, and plays the selected track without arming it", async () => {
  await T(() => { window.CKeys.open(); window.CUMidiIn.inject("Test Keys", [0x90, 64, 90]); });
  const r = await T(() => ({ lit: document.querySelector('.ckeys [data-n="64"]').classList.contains("midi"), dot: document.querySelector(".cd-midi").classList.contains("on") }));
  await T(() => { window.CUMidiIn.inject("Test Keys", [0x80, 64, 0]); window.CKeys.close(); });
  assert.ok(r.lit, "the key lights"); assert.ok(r.dot, "the MIDI light flashes");
});
await check("the Instrument type: the keyboard plays the instrument being built", async () => {
  const r = await T(() => { const d = CP.types.instrument; return !!(d && d.play && d.stop); }); assert.ok(r);
});

// ------------------------------------------------------------- Central Pedal Control: the same keyboard on the pedal's page
await check("Central Pedal Control's page: Ctrl+P searches, Ctrl+K opens the keyboard on the Pad tab", async () => {
  const p2 = await ctx.newPage(); const e2 = [];
  p2.on("pageerror", (e) => e2.push(String(e)));
  await p2.addInitScript(() => { window.CCDesktop = { platform: "linux" }; });
  await p2.goto(base + "/pedal/index.html"); await p2.waitForFunction(() => window.PP && window.PPShell && window.CKeys, null, { timeout: 15000 });
  await p2.evaluate(() => window.PPShell.showTab("pads"));
  await p2.keyboard.press("Control+k"); await p2.waitForSelector(".ckeys:not([hidden])");
  const r = await p2.evaluate(() => ({ name: document.querySelector(".ck-name").textContent, wants: window.CKeys.wants() }));
  await p2.keyboard.press("Escape");
  await p2.keyboard.press("Control+p"); const searched = await p2.evaluate(() => !!document.querySelector("dialog[open]"));
  await p2.close();
  assert.ok(r.wants); assert.match(r.name, /Stop ends it/); assert.ok(searched, "Ctrl+P opens the pedal's search");
});


// ------------------------------------------------------------- drag and drop
// helpers in the page: a WAV of a tone (or a click), a drop of files at a point of the timeline
await T(() => {
  window.__tone = (hz, secs, opts) => { opts = opts || {}; const rate = opts.rate || 48000, n = Math.round(rate * secs), b = new AudioBuffer({ length: n, sampleRate: rate, numberOfChannels: 1 }), d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = opts.click ? (i < 200 ? 0.9 * (1 - i / 200) : 0) : 0.5 * Math.sin(2 * Math.PI * hz * i / rate) * Math.min(1, (n - i) / 400); return new Uint8Array(CMProj.wav(b, 16)); };
  window.__drop = async (files, sel, dx, dy) => {
    const dt = new DataTransfer(); files.forEach((f) => dt.items.add(new File([f.data], f.name)));
    const el = typeof sel === "string" ? document.querySelector(sel) : sel, r = el.getBoundingClientRect();
    const x = r.left + (dx == null ? r.width / 2 : dx), y = r.top + (dy == null ? r.height / 2 : dy), target = document.elementFromPoint(x, y) || el;
    target.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    target.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }));
  };
});
await check("a folder's worth of stems dropped on empty space: a track each, in the usual order, lined up; an empty song takes the BPM in the names", async () => {
  await T(() => CP.create("track", { name: "Stems" })); await page.waitForSelector(".cdaw .cd-tname");
  await T(() => CDaw.edit("empty", (p) => { p.tracks = p.tracks.filter((t) => t.kind === "bus"); p.bpm = 100; }));
  await T(() => window.__drop([{ name: "04 Vox 72bpm.wav", data: __tone(440, 1) }, { name: "Click 72bpm.wav", data: __tone(1000, 1, { click: true }) }, { name: "Bass.wav", data: __tone(110, 1) }, { name: "Drums.wav", data: __tone(80, 1) }], ".cd-endrow .cd-endlane", 300));
  await page.waitForFunction(() => CDaw.project().tracks.filter((t) => t.kind === "audio").length === 4, null, { timeout: 8000 });
  const r = await T(() => ({ names: CDaw.project().tracks.filter((t) => t.kind === "audio").map((t) => t.name), starts: CDaw.project().tracks.filter((t) => t.kind === "audio").map((t) => t.clips[0].start), bpm: CDaw.project().bpm, undo: CDaw.canUndo() }));
  assert.deepEqual(r.names, ["Click 72bpm", "Drums", "Bass", "Vox 72bpm"]); assert.equal(new Set(r.starts).size, 1, "lined up: " + r.starts); assert.equal(r.bpm, 72); assert.equal(r.undo, "Add 4 tracks");
});
await check("one file dropped on an audio track goes on it; dropped in the names column it starts at bar 1", async () => {
  const id = await T(() => CDaw.project().tracks.find((t) => t.name === "Bass").id);
  await T((id) => window.__drop([{ name: "Bass 2.wav", data: __tone(110, 0.5) }], '.cd-row[data-t="' + id + '"] .cd-lane', 500), id);
  await page.waitForFunction((id) => CDaw.track(id).clips.length === 2, id);
  await T(() => window.__drop([{ name: "Shaker.wav", data: __tone(6000, 0.3) }], ".cd-endrow .cd-endhead", 30));
  await page.waitForFunction(() => CDaw.project().tracks.some((t) => t.name === "Shaker"));
  assert.equal(await T(() => CDaw.project().tracks.find((t) => t.name === "Shaker").clips[0].start), 0);
});
await check("a MIDI file dropped in: an instrument track per part (channel 10: drums) with its notes; a MIDI file written back reads the same", async () => {
  const r = await T(async () => {
    const bytes = CDawSMF.write({ bpm: 132, sig: [3, 4], name: "Hymn", parts: [{ name: "Organ", program: 19, notes: [{ p: 60, v: 90, s: 0, d: 1 }, { p: 64, v: 90, s: 1, d: 1 }, { p: 67, v: 90, s: 2, d: 2 }] }, { name: "Kit", drums: true, channel: 10, notes: [{ p: 36, v: 110, s: 0, d: 0.25 }, { p: 38, v: 100, s: 1, d: 0.25 }] }] });
    const back = CDawSMF.read(bytes);
    CDaw.edit("empty", (p) => { p.tracks = p.tracks.filter((t) => t.kind === "bus"); });
    await window.__drop([{ name: "Hymn.mid", data: bytes }], ".cd-endrow .cd-endlane", 10);
    await new Promise((res) => { const t0 = Date.now(); (function w() { if (CDaw.project().tracks.some((t) => t.name === "Kit") || Date.now() - t0 > 5000) res(); else setTimeout(w, 50); })(); });
    const org = CDaw.project().tracks.find((t) => t.name === "Organ"), kit = CDaw.project().tracks.find((t) => t.name === "Kit");
    return { back: back.parts.map((x) => [x.name, x.channel, x.drums, x.notes.length]), bpm: back.bpm, sig: back.sigs[0], org: org && { kind: org.kind, notes: org.clips[0].notes.map((n) => [n.p, n.s, n.d]), sound: org.layers[0].sound }, kit: kit && kit.kind, song: { bpm: CDaw.project().bpm, sig: CDaw.project().sig } };
  });
  assert.deepEqual(r.back, [["Organ", 1, false, 3], ["Kit", 10, true, 2]]); assert.equal(r.bpm, 132); assert.deepEqual([r.sig.n, r.sig.d], [3, 4]);
  assert.ok(r.org, "an Organ track"); assert.equal(r.org.kind, "instrument"); assert.deepEqual(r.org.notes, [[60, 0, 1], [64, 1, 1], [67, 2, 2]]); assert.equal(r.kit, "drums");
  assert.deepEqual(r.song, { bpm: 132, sig: [3, 4] });
});
await check("the sustain pedal in a MIDI file holds the notes it catches; SMPTE files are refused with a reason", async () => {
  const r = await T(() => {
    // a hand-made file: C4 on, off at 1 beat while the pedal is down; pedal up at beat 3
    const ev = [0x00, 0xB0, 64, 127, 0x00, 0x90, 60, 100, 0x83, 0x60, 0x80, 60, 0, 0x87, 0x40, 0xB0, 64, 0, 0x00, 0xFF, 0x2F, 0x00];
    const b = new Uint8Array([0x4D, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xE0, 0x4D, 0x54, 0x72, 0x6B, 0, 0, 0, ev.length].concat(ev));
    const s = CDawSMF.read(b), smpte = new Uint8Array(b); smpte[12] = 0xE7; smpte[13] = 0x28; let err = ""; try { CDawSMF.read(smpte); } catch (e) { err = e.message; }
    return { d: s.parts[0].notes[0].d, err };
  });
  assert.equal(r.d, 3); assert.match(r.err, /SMPTE/);
});
await check("drag a track's name up or down to move it", async () => {
  const before = await T(() => CDaw.project().tracks.filter((t) => t.kind !== "bus").map((t) => t.name));
  const first = page.locator(".cd-row[data-t] .cd-head .cd-ticon").first(), last = page.locator(".cd-row.cd-endrow");
  const a = await first.boundingBox(), b = await last.boundingBox();
  await page.mouse.move(a.x + 4, a.y + 4); await page.mouse.down(); await page.mouse.move(a.x + 4, a.y + 30, { steps: 4 }); await page.mouse.move(a.x + 4, b.y + 2, { steps: 6 }); await page.mouse.up();
  const after = await T(() => CDaw.project().tracks.filter((t) => t.kind !== "bus").map((t) => t.name));
  assert.equal(after[after.length - 1], before[0], before + " → " + after); assert.equal(await T(() => CDaw.canUndo()), "Move track");
});
await check("a track's ⤓ handle: the WAV is made while the pointer is on it, then dragging it out carries the file (Chrome: DownloadURL)", async () => {
  const r = await T(async () => {
    const t = CDaw.project().tracks.find((x) => x.name === "Organ"); CDawUI.draw();
    const h = document.querySelector('[data-tout="' + t.id + '"]'); if (!h) return { none: true };
    const f = await CDawUI.trackFile(t.id); await new Promise((res) => setTimeout(res, 50));
    const dt = new DataTransfer(), ev = new DragEvent("dragstart", { dataTransfer: dt, bubbles: true, cancelable: true }); h.dispatchEvent(ev);
    const head = String.fromCharCode.apply(null, f.data.slice(0, 4)) + String.fromCharCode.apply(null, f.data.slice(8, 12));
    return { name: f.name, head, url: dt.getData("DownloadURL"), cancelled: ev.defaultPrevented, ready: h.classList.contains("ready"), secs: (f.data.length - 44) / 48000 / 2 / 3 };
  });
  assert.ok(!r.none, "the handle shows"); assert.equal(r.head, "RIFFWAVE"); assert.match(r.name, /Organ\.wav$/); assert.match(r.url, /^audio\/wav:.*Organ\.wav:blob:/); assert.equal(r.cancelled, false); assert.ok(r.ready);
  assert.ok(r.secs > 1.5, "the length " + r.secs);
});

// ------------------------------------------------------------- samples, kits and your own instruments
await check("samples dropped on a drums track become the kit's pads on their General MIDI notes, and play", async () => {
  const r = await T(async () => {
    CDaw.edit("kit", (p) => { const t = CDaw.newTrack("drums", "Kit 2"); t.id = "tkit"; CDaw.insertTrack(t); });
    await window.__drop([{ name: "Kick 01.wav", data: __tone(60, 0.4) }, { name: "Snare Tight.wav", data: __tone(200, 0.3) }, { name: "HiHat Closed.wav", data: __tone(8000, 0.1) }, { name: "Open Hat.wav", data: __tone(7000, 0.4) }, { name: "Weird.wav", data: __tone(500, 0.2) }], '.cd-row[data-t="tkit"] .cd-lane', 50);
    await new Promise((res) => { const t0 = Date.now(); (function w() { const l = (CDaw.track("tkit").layers || [])[0]; if ((l && l.zones && l.zones.length === 5) || Date.now() - t0 > 5000) res(); else setTimeout(w, 50); })(); });
    const l = CDaw.track("tkit").layers[0];
    CDaw.edit("notes", () => { CDaw.track("tkit").clips = [{ id: "ck", kind: "midi", start: 0, len: 4, notes: [{ p: 36, v: 110, s: 0, d: 0.1 }, { p: 38, v: 110, s: 2, d: 0.1 }] }]; });
    const b = await CDaw.render({ from: 0, to: 4, tracks: ["tkit"], tail: 0 }), d = b.getChannelData(0), rms = (a, z) => { let s = 0; for (let i = Math.round(a * b.sampleRate); i < z * b.sampleRate; i++) s += d[i] * d[i]; return Math.sqrt(s / ((z - a) * b.sampleRate)); };
    const snare = 0.02 + CDaw.tempo.beatToSec(2);   // (the kick is 0.4 s long and plays to its end: a one-shot, though its note is short)
    return { sound: l.sound, kit: l.kit, notes: l.zones.map((z) => [z.name, z.lo]).sort((a, z) => a[1] - z[1]), hit: rms(0.03, 0.25), tail: rms(0.3, 0.4), quiet: rms(0.48, snare - 0.03) };
  });
  assert.equal(r.sound, "sampler"); assert.ok(r.kit);
  assert.deepEqual(r.notes, [["Kick 01", 36], ["Snare Tight", 38], ["HiHat Closed", 42], ["Open Hat", 46], ["Weird", 60]]);
  assert.ok(r.hit > 0.01 && r.quiet < r.hit / 10, "the kick hits " + r.hit + " then stops " + r.quiet); assert.ok(r.tail > r.hit / 4, "a one-shot plays past its short note: " + r.tail);
});
await check("samples named by their notes, dropped on an instrument track, spread across the keys and play in tune", async () => {
  const r = await T(async () => {
    CDaw.edit("smp", (p) => { const t = CDaw.newTrack("instrument", "Mine"); t.id = "tsmp"; CDaw.insertTrack(t); });
    await window.__drop([{ name: "Flute C4.wav", data: __tone(261.63, 1.5) }, { name: "Flute G4.wav", data: __tone(392, 1.5) }], '.cd-row[data-t="tsmp"] .cd-lane', 50);
    await new Promise((res) => { const t0 = Date.now(); (function w() { const l = (CDaw.track("tsmp").layers || [])[0]; if ((l && l.zones && l.zones.length === 2) || Date.now() - t0 > 5000) res(); else setTimeout(w, 50); })(); });
    const z = CDaw.track("tsmp").layers[0].zones.map((x) => [x.root, x.lo, x.hi]);
    CDaw.edit("notes", () => { CDaw.track("tsmp").clips = [{ id: "cs", kind: "midi", start: 0, len: 2, notes: [{ p: 69, v: 110, s: 0, d: 1.5 }] }]; });
    const b = await CDaw.render({ from: 0, to: 2, tracks: ["tsmp"], tail: 0 }), d = b.getChannelData(0), st = Math.round(0.3 * b.sampleRate), n = Math.round(0.5 * b.sampleRate);
    let cross = 0; for (let i = st + 1; i < st + n; i++) if (d[i - 1] < 0 && d[i] >= 0) cross++;
    return { z, hz: cross / 0.5 };
  });
  assert.deepEqual(r.z, [[60, 0, 63], [67, 64, 127]]); assert.ok(Math.abs(r.hz - 440) < 6, "A4 from the G4 sample: " + r.hz + " Hz");
});
await check("an SFZ with its samples dropped in: a sampler track with its key ranges, velocity layers and loops; a Decent Sampler file reads too", async () => {
  const r = await T(async () => {
    const sfzText = "// test\n<control> default_path=samples/\n<global> ampeg_release=0.4\n<group> lovel=1 hivel=80\n<region> sample=Low C3.wav lokey=c2 hikey=d#3 pitch_keycenter=c3 loop_mode=loop_continuous loop_start=100 loop_end=2000\n<region> sample=High C5.wav lokey=e3 hikey=127 pitch_keycenter=72\n<group> lovel=81 hivel=127 seq_length=2\n<region> sample=Low C3.wav lokey=0 hikey=63 pitch_keycenter=48 volume=-6 seq_position=1\n<region> sample=High C5.wav lokey=0 hikey=63 pitch_keycenter=48 seq_position=2\n<region> sample=High C5.wav key=99 trigger=release\n";
    const regs = CDawUI.sfz(sfzText);
    CDaw.edit("sfz", (p) => { const t = CDaw.newTrack("instrument", "Piano"); t.id = "tsfz"; CDaw.insertTrack(t); });
    await window.__drop([{ name: "My Piano.sfz", data: new TextEncoder().encode(sfzText) }, { name: "Low C3.wav", data: __tone(130.81, 1) }, { name: "High C5.wav", data: __tone(523.25, 1) }], '.cd-row[data-t="tsfz"] .cd-lane', 50);
    await new Promise((res) => { const t0 = Date.now(); (function w() { const l = (CDaw.track("tsfz").layers || [])[0]; if ((l && l.zones && l.zones.length) || Date.now() - t0 > 5000) res(); else setTimeout(w, 50); })(); });
    const l = CDaw.track("tsfz").layers[0];
    const ds = CDawUI.dspreset('<DecentSampler><groups attack="0.01" release="0.5"><group volume="-3dB"><sample path="Samples/A3.wav" rootNote="57" loNote="50" hiNote="62" loopStart="10" loopEnd="900"/><sample path="Samples/A4.wav" rootNote="69" loNote="63" hiNote="80" trigger="release"/></group></groups></DecentSampler>');
    return { regs: regs.map((x) => [x.sample, x.lo, x.hi, x.root, x.vlo, x.vhi]), zones: l.zones.map((z) => [z.name, z.lo, z.hi, z.root, z.vlo, !!(z.loop && z.loop.on)]), name: l.name, env: l.zones[0].env.release, ds: ds.map((x) => [x.sample, x.lo, x.hi, x.root, !!x.loop, Math.round(x.gain * 100) / 100]) };
  });
  assert.deepEqual(r.regs, [["samples/Low C3.wav", 36, 51, 48, 1, 80], ["samples/High C5.wav", 52, 127, 72, 1, 80], ["samples/Low C3.wav", 0, 63, 48, 81, 127]]);
  assert.equal(r.name, "My Piano"); assert.equal(r.zones.length, 3); assert.deepEqual(r.zones[0], ["Low C3", 36, 51, 48, 1, true]); assert.equal(r.env, 0.4);
  assert.deepEqual(r.ds, [["Samples/A3.wav", 50, 62, 57, true, 0.71]]);
});
await check("the browser's Samples tab: a sample dragged onto the timeline becomes a clip; the project saves its samples and kit", async () => {
  const r = await T(async () => {
    CDawUI.U.opts.samples = () => Promise.resolve([{ id: "s1", name: "Big Kick", group: "Kicks", library: "Central Starter", read: () => Promise.resolve(__tone(55, 0.5)) }, { id: "s2", name: "Riser", group: "FX", library: "Central Starter", read: () => Promise.resolve(__tone(900, 2)) }]);
    document.querySelector('.cd-browser [data-bt="samples"]').click(); await new Promise((res) => setTimeout(res, 200));
    const names = Array.from(document.querySelectorAll('.cd-browser [data-bi^="m:"] b')).map((b) => b.textContent);
    const item = document.querySelector('.cd-browser [data-bi="m:s2"]'), dt = new DataTransfer(); item.dispatchEvent(new DragEvent("dragstart", { dataTransfer: dt, bubbles: true }));
    const lane = document.querySelector(".cd-endrow .cd-endlane"), rr = lane.getBoundingClientRect();
    lane.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, clientX: rr.left + 40, clientY: rr.top + 10, bubbles: true, cancelable: true }));
    await new Promise((res) => { const t0 = Date.now(); (function w() { if (CDaw.project().tracks.some((t) => t.name === "Riser") || Date.now() - t0 > 5000) res(); else setTimeout(w, 50); })(); });
    const used = CDaw.usedAudio(), kit = CDaw.track("tkit").layers[0].zones.map((z) => z.src);
    return { names, riser: CDaw.project().tracks.some((t) => t.name === "Riser" && t.kind === "audio" && t.clips.length === 1), kitSaved: kit.every((id) => used.includes(id)) };
  });
  assert.deepEqual(r.names, ["Big Kick", "Riser"]); assert.ok(r.riser, "a Riser audio track"); assert.ok(r.kitSaved, "the kit's samples go into the project");
  await shot("dnd-samples");
});

if (errs.length) { failures++; console.error("  ✗ no errors on the page\n      " + errs.slice(0, 5).join("\n      ")); }
await browser.close(); srv.close();
console.log(failures ? "\n" + failures + " failed" : "\n\nall passed"); process.exit(failures ? 1 : 0);
