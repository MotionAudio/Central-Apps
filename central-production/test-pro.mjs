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


// ------------------------------------------------------------- MIDI: external synths, MIDI effects, capture, the pedal and the wheel, bounce
await check("an external MIDI instrument track: its clip's notes go out of its port on its channel, ahead with their times; Stop sends all notes off", async () => {
  const r = await T(async () => {
    window.__out = []; const M = window.CUMidiIn; M.send = (port, bytes, at) => { window.__out.push({ port, bytes: Array.from(bytes), at: at || 0, now: performance.now() }); return true; };
    CDaw.edit("ext", (p) => { const t = CDaw.newTrack("external", "Prophet"); t.id = "text"; t.ext.port = "Fake Synth"; t.ext.channel = 3; t.clips = [{ id: "ce", kind: "midi", start: 0, len: 4, notes: [{ p: 60, v: 100, s: 0, d: 0.5 }, { p: 64, v: 90, s: 1, d: 0.5 }], bends: [{ s: 1.2, v: 100 }] }]; CDaw.insertTrack(t); });
    CDaw.setPos(0); CDaw.play(); await new Promise((res) => setTimeout(res, 1500)); CDaw.stop({ home: true }); await new Promise((res) => setTimeout(res, 100));
    const msgs = __out.map((m) => m.bytes), ons = msgs.filter((b) => b[0] === 0x92), offs = msgs.filter((b) => b[0] === 0x82), late = __out.filter((m) => m.at && m.at < m.now - 5).length;
    return { port: [...new Set(__out.map((m) => m.port))], ons: ons.map((b) => b[1]), offs: offs.length, bend: msgs.some((b) => b[0] === 0xE2), stop: msgs.some((b) => b[0] === 0xB2 && b[1] === 123), late, timed: __out.filter((b) => b.bytes[0] === 0x92).every((m) => m.at > 0) };
  });
  assert.deepEqual(r.port, ["Fake Synth"]); assert.deepEqual(r.ons, [60, 64]); assert.ok(r.offs >= 2, "note offs " + r.offs); assert.ok(r.bend, "the clip's bend goes out"); assert.ok(r.stop, "all notes off on Stop"); assert.ok(r.timed, "sent with their times"); assert.equal(r.late, 0);
});
await check("the keyboard and the wheel on an external synth go straight out; an export says its sound has to be recorded first", async () => {
  const r = await T(async () => {
    __out = []; CDawUI.select("text"); CDaw.live("text", [0x90, 67, 80]); CDaw.live("text", [0xE0, 0, 96]); CDaw.live("text", [0x80, 67, 0]);
    const msgs = __out.map((m) => m.bytes); let said = ""; const off = CDaw.on("message", (m) => { said = m; }); try { await CDaw.render({ from: 0, to: 4, tail: 0 }); } catch (_) { } off();
    return { msgs, said };
  });
  assert.deepEqual(r.msgs[0], [0x92, 67, 80]); assert.deepEqual(r.msgs[1], [0xE2, 0, 96]); assert.deepEqual(r.msgs[2], [0x82, 67, 0]); assert.match(r.said, /External synths aren't in exports/);
  await T(() => CDaw.edit("x", (p) => { p.tracks = p.tracks.filter((t) => t.id !== "text"); }));
});
await check("MIDI effects: scale, chord (a shape, or the key's own) and an arpeggiator - the same on clips and on what you play", async () => {
  const r = await T(async () => {
    const F = CDawMidiFx, n = (p, s, d) => ({ p, v: 100, s, d });
    const scale = F.transform([n(61, 0, 1), n(66, 1, 1)], [{ type: "scale", params: { key: "song", scale: "major" } }], { key: "C" }).map((x) => x.p);
    const chord = F.map(62, [{ type: "chord", params: { shape: "minor" } }], { key: "C" }), dia = F.map(62, [{ type: "chord", params: { diatonic: true } }], { key: "C" }), dia5 = F.map(67, [{ type: "chord", params: { diatonic: true } }], { key: "C" });
    const arp = F.transform([n(60, 0, 1), n(64, 0, 1), n(67, 0, 1)], [{ type: "arp", params: { mode: "up", rate: "1/16", octaves: 1, gate: 0.5 } }], {}).map((x) => [x.p, x.s, x.d]);
    const arp2 = F.transform([n(60, 0, 4), n(64, 0, 4)], [{ type: "arp", params: { mode: "updown", rate: "1/8", octaves: 2 } }], {}).map((x) => x.p);
    // a clip with one held chord and an arpeggiator: the render has a note every sixteenth
    CDaw.edit("arp", (p) => { const t = CDaw.newTrack("instrument", "Arp"); t.id = "tarp"; t.midifx = [{ id: "m1", type: "arp", on: true, params: { mode: "up", rate: "1/16", octaves: 2, gate: 0.4 } }]; t.clips = [{ id: "ca", kind: "midi", start: 0, len: 1, notes: [n(60, 0, 1), n(67, 0, 1)] }]; CDaw.insertTrack(t); });
    await new Promise((res) => setTimeout(res, 50));
    const inst = CDaw.graph().insts.tarp, played = [], orig = inst.noteOn; inst.noteOn = function (dest, p) { played.push(p); return orig.apply(this, arguments); };
    CDaw.setPos(0); CDaw.play(); await new Promise((res) => setTimeout(res, 700)); CDaw.stop({ home: true }); inst.noteOn = orig;
    return { scale, chord, dia, dia5, arp, arp2, played };
  });
  assert.deepEqual(r.scale, [60, 65]); assert.deepEqual(r.chord, [62, 65, 69]); assert.deepEqual(r.dia, [62, 65, 69]); assert.deepEqual(r.dia5, [67, 71, 74]);
  assert.deepEqual(r.arp, [[60, 0, 0.125], [64, 0.25, 0.125], [67, 0.5, 0.125], [60, 0.75, 0.125]]); assert.deepEqual(r.arp2, [60, 64, 72, 76, 72, 64, 60, 64]);
  assert.deepEqual(r.played, [60, 67, 72, 79], "the clip plays through the arpeggiator: " + r.played);
});
await check("a live chord: one key plays the whole chord, and letting go stops all of it", async () => {
  const r = await T(() => {
    CDaw.edit("chd", () => { CDaw.track("tarp").midifx = [{ id: "m2", type: "chord", on: true, params: { shape: "major" } }]; });
    const inst = CDaw.graph().insts.tarp, seen = []; const orig = inst.noteOn; inst.noteOn = function (dest, p) { seen.push(p); return orig.apply(this, arguments); };
    CDaw.live("tarp", [0x90, 60, 100]); const held = inst.voices.length; CDaw.live("tarp", [0x80, 60, 0]); inst.noteOn = orig;
    return { seen, held };
  });
  assert.deepEqual(r.seen, [60, 64, 67]); assert.ok(r.held >= 3);
});
await check("Capture: what you just played (not recording, the song stopped) becomes a clip at the playhead", async () => {
  const r = await T(async () => {
    CDaw.edit("cap", () => { CDaw.track("tarp").midifx = []; CDaw.track("tarp").clips = []; }); CDaw.setPos(CDaw.tempo.barToBeat(3) + 1); CDawUI.select("tarp");
    const w = (ms) => new Promise((res) => setTimeout(res, ms));
    if (CDaw.hasCapture("tarp")) { CDaw.capture("tarp"); CDaw.undo(); }   // (the chord test's note is still kept: take it first)
    CDaw.live("tarp", [0x90, 60, 90]); await w(120); CDaw.live("tarp", [0x80, 60, 0]); CDaw.live("tarp", [0x90, 62, 80]); await w(120); CDaw.live("tarp", [0x80, 62, 0]); CDaw.live("tarp", [0x90, 64, 70]); await w(100); CDaw.live("tarp", [0x80, 64, 0]);
    const cl = CDawUI.capture(); return cl && { want: CDaw.tempo.barToBeat(3), start: cl.start, notes: cl.notes.map((n) => n.p), first: cl.notes[0].s, undo: CDaw.canUndo(), again: CDaw.hasCapture("tarp") };
  });
  assert.ok(r, "a clip"); assert.equal(r.start, r.want, "at the bar the playhead is in"); assert.deepEqual(r.notes, [60, 62, 64]); assert.equal(r.first, 0); assert.equal(r.undo, "Capture MIDI"); assert.equal(r.again, false, "captured once");
});
await check("recording: a note let go under the sustain pedal lasts until the pedal comes up; the pitch wheel is recorded into the clip", async () => {
  const r = await T(async () => {
    const w = (ms) => new Promise((res) => setTimeout(res, ms));
    CDaw.edit("rec", (p) => { p.tracks.forEach((t) => { t.arm = false; }); p.metronome.countIn = 0; p.punch.on = false; p.loop.on = false; CDaw.track("tarp").arm = true; CDaw.track("tarp").clips = []; });
    CDaw.setPos(0); CDaw.record(); await w(150);
    CDaw.live("tarp", [0xB0, 64, 127]); CDaw.live("tarp", [0x90, 60, 100]); await w(150); CDaw.live("tarp", [0x80, 60, 0]); CDaw.live("tarp", [0xE0, 0, 100]); await w(500); CDaw.live("tarp", [0xB0, 64, 0]); CDaw.live("tarp", [0xE0, 0, 64]); await w(100);
    CDaw.stop({ home: true }); await w(100);
    const cl = CDaw.track("tarp").clips[0], n = cl && cl.notes[0], spb = 60 / CDaw.project().bpm;
    return cl ? { secs: n.d * spb, bends: (cl.bends || []).map((b) => b.v) } : null;
  });
  assert.ok(r, "a clip was recorded"); assert.ok(r.secs > 0.55 && r.secs < 0.9, "held by the pedal: " + r.secs + " s"); assert.ok(r.bends.length >= 2 && r.bends[0] > 50 && r.bends.includes(0), "bends " + r.bends);
});
await check("quantize with swing; Save as a MIDI file; Bounce to audio makes an audio track that sounds like it and mutes the original", async () => {
  const r = await T(async () => {
    const q = CDaw.quantize([{ p: 60, v: 100, s: 0.03, d: 0.4 }, { p: 62, v: 100, s: 0.52, d: 0.4 }], 0.5, 1, 1).map((n) => Math.round(n.s * 1000) / 1000);
    CDaw.edit("bnc", () => { const t = CDaw.track("tarp"); t.arm = false; t.clips = [{ id: "cb", kind: "midi", start: 0, len: 4, notes: [{ p: 57, v: 110, s: 0, d: 3 }] }]; });
    const mid = CDawSMF.read(CDaw.midiOf(["tarp"])).parts[0].notes.map((n) => [n.p, n.s, n.d]);
    const a = await CDaw.bounce("tarp"), clip = a.clips[0], buf = CDaw.buffers[clip.audio.src], d = buf.getChannelData(0); let e = 0; for (let i = Math.round(buf.sampleRate * 0.2); i < buf.sampleRate * 1.2; i++) e += d[i] * d[i];
    return { q, mid, name: a.name, kind: a.kind, muted: CDaw.track("tarp").mute, energy: Math.sqrt(e / buf.sampleRate), after: CDaw.project().tracks.findIndex((t) => t.id === a.id) - CDaw.project().tracks.findIndex((t) => t.id === "tarp") };
  });
  assert.deepEqual(r.q, [0, 0.667]); assert.deepEqual(r.mid, [[57, 0, 3]]); assert.equal(r.name, "Arp (audio)"); assert.equal(r.kind, "audio"); assert.ok(r.muted); assert.equal(r.after, 1); assert.ok(r.energy > 0.01, "it has the sound: " + r.energy);
});
await check("the Sound panel: an external synth's port, channel and input; MIDI effects added, changed and taken off", async () => {
  await T(() => { CDaw.edit("ext2", (p) => { const t = CDaw.newTrack("external", "Juno"); t.id = "tjuno"; CDaw.insertTrack(t); }); CDawUI.select("tjuno"); CDawUI.openEditor("sound"); });
  await page.waitForSelector('[data-ext="port"]');
  await page.selectOption('[data-ext="channel"]', "10"); await page.click('[data-mfxadd="chord"]');
  await page.waitForSelector('[data-mfx="0:shape"]'); await page.selectOption('[data-mfx="0:shape"]', "sus4");
  const r = await T(() => ({ ch: CDaw.track("tjuno").ext.channel, fx: CDaw.track("tjuno").midifx.map((f) => [f.type, f.params.shape]) }));
  assert.equal(r.ch, 10); assert.deepEqual(r.fx, [["chord", "sus4"]]);
  await shot("sound-panel");
  await page.click('[data-mfxdel="0"]'); assert.equal(await T(() => CDaw.track("tjuno").midifx.length), 0);
});

// ------------------------------------------------------------- (10.8) the bigger Central FX collection in Add effect
await check("Add effect: 92 Central FX plugins under headings by kind, a search box that narrows the list, and Enter adds the first", async () => {
  const id = await T(() => { const t = CDaw.project().tracks.find((x) => x.kind === "audio" || x.kind === "instrument"); CDawUI.select(t.id); return t.id; });
  const mixerOpen = await T(() => !!document.querySelector(".cdaw .cd-strip"));
  if (!mixerOpen) await page.click('.cdaw [data-a="mixer"]');
  await page.waitForSelector('.cdaw .cd-strip[data-s="' + id + '"] [data-fx="add"]');
  await page.click('.cdaw .cd-strip[data-s="' + id + '"] [data-fx="add"]');
  await page.waitForSelector(".cdaw .cd-pop:not([hidden]) .cd-popq");
  const r = await T(() => {
    const m = document.querySelector(".cdaw .cd-pop"), heads = [...m.querySelectorAll(".cd-pophead")].map((h) => h.textContent);
    return { coll: window.CMFxCollection.length, free: window.CMFxCollection.filter((p) => p.tier === "free").length, heads, focused: document.activeElement === m.querySelector(".cd-popq"),
      airwindows: !!m.querySelector('button[title*="Airwindows"]') };
  });
  assert.equal(r.coll, 92); assert.equal(r.free, 30); assert.ok(r.focused, "the search box has the focus");
  ["Built in", "Central FX · Reverb", "Central FX · Filters", "Central FX · Pitch", "Central FX · Limiters and clippers"].forEach((h) => assert.ok(r.heads.includes(h), "heading " + h + " in " + r.heads.join(", ")));
  assert.ok(r.airwindows, "the Airwindows ports say who made them");
  await shot("add-effect-list");
  await page.keyboard.type("plate free");
  const vis = await T(() => [...document.querySelectorAll(".cdaw .cd-pop button[data-i]")].filter((b) => !b.hidden).map((b) => b.textContent));
  assert.deepEqual(vis, ["Plate Reverb"], "the search narrows to " + vis.join(", "));
  await page.keyboard.press("Enter");
  const fx = await T((tid) => { const t = CDaw.track(tid); const f = t.inserts[t.inserts.length - 1]; return { type: f.type, name: f.plugin && f.plugin.name, hidden: document.querySelector(".cdaw .cd-pop").hidden }; }, id);
  assert.equal(fx.type, "cmfx"); assert.equal(fx.name, "Plate Reverb"); assert.ok(fx.hidden, "the list closed");
  await shot("add-effect");
});

if (errs.length) { failures++; console.error("  ✗ no errors on the page\n      " + errs.slice(0, 5).join("\n      ")); }
await browser.close(); srv.close();
console.log(failures ? "\n" + failures + " failed" : "\n\nall passed"); process.exit(failures ? 1 : 0);
