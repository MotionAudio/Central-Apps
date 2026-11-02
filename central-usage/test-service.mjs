// 10.2: run sheets, the pre-service check and the confidence monitor, in the center (center.js) and the run sheet
// generator (app/runsheet-gen.js) - no browser needed.
//   node test-service.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const { Center, cmpVersion } = require("./center.js");
const Gen = require("./app/runsheet-gen.js");
const WebSocket = require("ws");

let fails = 0;
const ok = (c, msg, d) => { console.log((c ? "  ✓ " : "  ✗ ") + msg + (c || d === undefined ? "" : "  -- " + JSON.stringify(d).slice(0, 600))); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- the generator
console.log("Run sheet generator:");
{
  const songs = [{ id: "s1", name: "Way Maker", duration: 302, hasTracks: true, hasLyrics: true }, { id: "s2", name: "Goodness of God", duration: 288, hasTracks: true, hasLyrics: true },
    { id: "s3", name: "Holy Forever", duration: 336, hasTracks: true, hasLyrics: false }, { id: "s4", name: "Build My Life", duration: 0, hasTracks: false, hasLyrics: true }];
  const a = { name: "Sunday morning", date: "2026-11-08", time: "10:30", length: 75, countdown: 5,
    elements: [{ kind: "welcome" }, { kind: "worship", songs: ["s1", "s2", "s3"] }, { kind: "announcements" }, { kind: "scripture", title: "Psalm 23" }, { kind: "offering" },
      { kind: "sermon", title: "The Good Shepherd", speaker: "Pastor Dan", minutes: 32 }, { kind: "response", songs: ["s4"] }, { kind: "closing" }, { kind: "custom", title: "Baby dedication", minutes: 4 }],
    team: { leader: "Amy", speaker: "Pastor Dan", tech: ["Sam", "Lee"] } };
  const sv = Gen.generate(a, songs);
  ok(sv.name === "Sunday morning" && sv.date === "2026-11-08" && sv.time === "10:30" && sv.length === 75, "keeps the date, start time and length");
  ok(sv.items[0].kind === "countdown" && sv.items[0].minutes === 5, "starts with the countdown before the service", sv.items[0]);
  const songItems = sv.items.filter((x) => x.kind === "song");
  ok(songItems.length === 4 && songItems[0].song === "s1" && songItems[0].title === "Way Maker", "one item per song, from the setlist", songItems.map((x) => x.title));
  ok(Math.abs(songItems[0].minutes - 302 / 60) < 0.1, "a song's length comes from its tracks (5:02)", songItems[0].minutes);
  ok(songItems[3].minutes >= 4 && songItems[3].minutes <= 6, "a song without tracks gets a typical length", songItems[3].minutes);
  ok(songItems[0].cues.song === "s1" && songItems[0].cues.lyrics === "on", "a song fires its track and the lyrics", songItems[0].cues);
  const sermon = sv.items.find((x) => x.kind === "sermon");
  ok(sermon && sermon.minutes === 32 && sermon.who === "Pastor Dan" && /The Good Shepherd/.test(sermon.title) && sermon.cues.lowerThird === "Pastor Dan · The Good Shepherd" && sermon.cues.lyrics === "off", "the sermon: its length, speaker, lower third, lyrics off", sermon);
  ok(sv.items.some((x) => x.kind === "scripture" && /Psalm 23/.test(x.title)), "the scripture reading keeps its passage");
  ok(sv.items.some((x) => x.kind === "other" && x.title === "Baby dedication" && x.minutes === 4), "a custom element");
  const total = sv.items.filter((x) => x.kind !== "countdown").reduce((t, x) => t + x.minutes, 0);
  ok(Math.abs(total - 75) <= 1.5, "the flexible parts are fitted so the service runs 75 minutes (" + total.toFixed(1) + ")", total);
  ok(sv.items.every((x) => x.roles.length), "every item has the roles it uses");
  ok(sv.team.leader === "Amy" && sv.team.tech.join() === "Sam,Lee", "who's on");
  const times = Gen.times(sv);
  ok(times[1].clock === "10:30" && times[0].clock === "10:25", "start times: the countdown at 10:25, the service at 10:30", times.slice(0, 2));
  // too much for the time: says so, doesn't squash the sermon
  const tight = Gen.generate(Object.assign({}, a, { length: 40 }), songs);
  ok(tight.items.find((x) => x.kind === "sermon").minutes === 32 && Gen.fit(tight).over > 0, "too much for 40 minutes: it says it runs long and keeps the sermon's length", Gen.fit(tight));
  // a number of songs, no setlist
  const n3 = Gen.generate({ time: "18:00", length: 60, elements: [{ kind: "worship", count: 3 }, { kind: "sermon", minutes: 30 }] }, []);
  ok(n3.items.filter((x) => x.kind === "song").length === 3 && n3.items.find((x) => x.kind === "song").title === "Song 1", "a worship set of 3 songs with no setlist yet");
}

// ---------------------------------------------------------------- the center
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "center-svc-"));
let center = new Center({ port: 0, dataDir: dir, beacon: false, appVersion: "10.2.0" });
await center.start();
let port = center.port;
function client() {
  return new Promise((resolve) => {
    const ws = new WebSocket("ws://127.0.0.1:" + port), q = [], waiters = [];
    ws.on("message", (raw, isBin) => { if (isBin) return; const m = JSON.parse(String(raw)); const i = waiters.findIndex((w) => w.f(m)); if (i >= 0) { const w = waiters.splice(i, 1)[0]; w.r(m); } else q.push(m); });
    ws.on("open", () => resolve({ ws, q, send: (m) => ws.send(JSON.stringify(m)),
      wait: (f, ms) => new Promise((r) => { const i = q.findIndex(f); if (i >= 0) return r(q.splice(i, 1)[0]); const w = { f, r }; waiters.push(w); setTimeout(() => { const j = waiters.indexOf(w); if (j >= 0) { waiters.splice(j, 1); r(null); } }, ms || 3000); }),
      close: () => ws.close() }));
  });
}
console.log("Run sheets in the center:");
const main = await client();
main.send({ type: "cuRole", action: "hello", id: "dMain", name: "Sound desk", role: "main", token: "t".repeat(32), pin: "4321", pair: "0915" });
ok(!!(await main.wait((m) => m.type === "cuRoles" && m.youAreMain)), "the main admin registers");
const lyr = await client();
lyr.send({ type: "cuRole", action: "join", id: "dLyr", name: "Lyrics laptop", role: "admin", pair: "0915" });
await lyr.wait((m) => m.type === "cuRoleReply" && m.action === "join");
main.send({ type: "cuRole", action: "approve", id: "dMain", target: "dLyr", allow: true });
ok(!!(await lyr.wait((m) => m.type === "cuRoleAssigned" && m.role === "admin")), "an admin computer joins (the lyrics laptop)");
const band = await client();
band.send({ type: "cuRole", action: "join", id: "dBand", name: "Keys iPad", role: "user1", pair: "0915" });
await band.wait((m) => m.type === "cuRoleReply" && m.action === "join");

const sheet = { id: "svA", name: "Sunday 9", date: "2030-01-06", time: "09:00", length: 70, countdown: 5, team: { leader: "Amy", speaker: "Dan", tech: ["Sam"] },
  items: [{ id: "i0", title: "Countdown", kind: "countdown", minutes: 5, roles: ["slides"], cues: { slide: "Countdown" } },
    { id: "i1", title: "Way Maker", kind: "song", minutes: 5, roles: ["band", "lyrics", "lighting"], song: "s1", who: "Amy", cues: { song: "s1", lyrics: "on", look: "Warm wash", bogus: "x" } },
    { id: "i2", title: "Sermon", kind: "sermon", minutes: 30, roles: ["production"], who: "Dan", note: "Bring up the pulpit mic", cues: { camera: "Pulpit", lowerThird: "Dan · Grace", lyrics: "off" } }] };
main.send({ type: "service", action: "save", services: [sheet] });
let st = await lyr.wait((m) => m.type === "services" && m.services.length === 1);
const s0 = st && st.services[0];
ok(s0 && s0.date === "2030-01-06" && s0.length === 70 && s0.countdown === 5 && s0.team.speaker === "Dan", "a run sheet keeps its date, length, countdown and team", s0);
ok(s0 && s0.items[1].cues.look === "Warm wash" && !s0.items[1].cues.bogus && s0.items[2].note === "Bring up the pulpit mic" && s0.items[2].who === "Dan", "items keep their cues (and only real cue kinds), notes and who leads them", s0 && s0.items);
ok(s0 && s0.items[0].kind === "countdown" && st.kinds.includes("scripture") && st.kinds.includes("baptism"), "the new kinds (countdown, scripture, baptism, closing)");
// more than the old 4
main.send({ type: "service", action: "save", services: Array.from({ length: 9 }, (_, i) => Object.assign({}, sheet, { id: "sv" + i, name: "Sheet " + i })) });
st = await main.wait((m) => m.type === "services" && m.services.length === 9);
ok(!!st, "up to 12 run sheets (9 saved)");
main.send({ type: "service", action: "save", services: [sheet] }); await main.wait((m) => m.type === "services" && m.services.length === 1);
// templates
main.send({ type: "service", action: "saveTemplate", template: Object.assign({}, sheet, { id: "tpSun", name: "Sunday template" }) });
st = await main.wait((m) => m.type === "services" && m.templates && m.templates.length === 1);
ok(st && st.templates[0].name === "Sunday template" && st.templates[0].date === "" && st.templates[0].items.length === 3, "save as a template (no date)", st && st.templates);
lyr.send({ type: "service", action: "saveTemplate", template: sheet });
let rr = await lyr.wait((m) => m.type === "serviceReply" && m.action === "saveTemplate");
ok(rr && !rr.ok, "only the main admin saves templates");
// run it: next / back carry a seq the computers fire cues on
main.send({ type: "service", action: "start", service: "svA" });
st = await lyr.wait((m) => m.type === "services" && m.run);
const seq0 = st && st.run.seq;
main.send({ type: "service", action: "next" });
st = await lyr.wait((m) => m.type === "services" && m.run && m.run.item === 1);
ok(st && st.run.seq > seq0 && st.run.startedAt, "Next moves every computer to item 2, with a new cue number", st && st.run);
main.send({ type: "service", action: "stop" }); await main.wait((m) => m.type === "services" && !m.run);
main.send({ type: "service", action: "deleteTemplate", id: "tpSun" });
st = await main.wait((m) => m.type === "services" && m.templates && m.templates.length === 0);
ok(!!st, "delete a template");

console.log("Pre-service check:");
// the lyrics laptop answers with its own checks; the band iPad doesn't answer (a user device isn't expected to)
lyr.send({ type: "cuRole", action: "health", id: "dLyr", health: { rtt: 14, app: "10.1.0", battery: 18, charging: false, clock: Date.now() - 45000 } });
band.send({ type: "cuRole", action: "health", id: "dBand", health: { rtt: 22, app: "10.2.0" } });
await sleep(150);
main.send({ type: "precheck", action: "run" });
const req = await lyr.wait((m) => m.type === "precheckRequest");
ok(req && req.id && req.service && req.service.id === "svA", "the center asks each computer to check itself, saying which service is next", req);
lyr.send({ type: "precheck", action: "report", id: req.id, items: [{ key: "license", group: "keys", label: "Key", status: "ok", detail: "ADEF… valid" }, { key: "disk", group: "recording", label: "Disk space", status: "bad", detail: "2 GB free", fix: "Free up space before recording." }] });
let res = await main.wait((m) => m.type === "precheckResult", 10000);
ok(!!res, "the result comes back to the main admin");
const it = (k) => res && res.result.items.find((x) => x.key === k || x.key.startsWith(k));
ok(it("disk") && it("disk").status === "bad" && it("disk").from === "Lyrics laptop" && /Free up space/.test(it("disk").fix), "a computer's own check line, with its fix", it("disk"));
ok(it("dev:dLyr") && it("dev:dLyr").status === "warn" && /Update Lyrics laptop to 10.2.0/.test(it("dev:dLyr").fix), "an older version is amber with how to update", it("dev:dLyr"));
ok(it("bat:dLyr") && it("bat:dLyr").status === "bad", "a low battery is red", it("bat:dLyr"));
ok(it("clock:dLyr") && it("clock:dLyr").status === "bad" && /Off by 4\d s/.test(it("clock:dLyr").detail), "a clock 45 s off is red", it("clock:dLyr"));
ok(it("pedal") && it("pedal").status === "info", "no Central Pedal: said, not a problem");
ok(res && res.alert === true && res.result.counts.bad >= 2, "red lines ask for an alert", res && res.result.counts);
main.send({ type: "precheck", action: "get", full: true });
let pcs = await main.wait((m) => m.type === "precheck" && m.full);
ok(pcs && pcs.history.length === 1 && pcs.history[0].items.length > 3, "the check is kept in the history");
lyr.send({ type: "precheck", action: "run" });
rr = await lyr.wait((m) => m.type === "precheckReply");
ok(rr && !rr.ok, "only the main admin runs the check");
main.send({ type: "precheck", action: "settings", settings: { lead: 45, tone: true, auto: true } });
pcs = await main.wait((m) => m.type === "precheck" && m.settings && m.settings.lead === 45);
ok(pcs && pcs.settings.tone === true, "settings: how long before the service, the test tone");
// it runs by itself before a service (a sheet starting 40 minutes from now, 45 minutes' lead)
const soon = new Date(Date.now() + 40 * 60000), hh = String(soon.getHours()).padStart(2, "0") + ":" + String(soon.getMinutes()).padStart(2, "0");
const ymd = soon.getFullYear() + "-" + String(soon.getMonth() + 1).padStart(2, "0") + "-" + String(soon.getDate()).padStart(2, "0");
main.send({ type: "service", action: "save", services: [Object.assign({}, sheet, { date: ymd, time: hh })] }); await main.wait((m) => m.type === "services" && m.services[0].time === hh);
center.autoPrecheck(Date.now());
const auto = await lyr.wait((m) => m.type === "precheckRequest", 3000);
ok(!!auto, "it runs by itself the set time before a service");
lyr.send({ type: "precheck", action: "report", id: auto && auto.id, items: [] });
res = await main.wait((m) => m.type === "precheckResult", 10000);
ok(res && res.result.auto === true, "an automatic check says so");
center.autoPrecheck(Date.now());
ok(!(await lyr.wait((m) => m.type === "precheckRequest", 800)), "only once per service");
ok(cmpVersion("10.1.0", "10.2.0") < 0 && cmpVersion("10.10.0", "10.2.0") > 0 && cmpVersion("10.2", "10.2.0") === 0, "versions compare by number");

console.log("Confidence monitor:");
// a stage tablet: no pairing, just watching
const tab = await client();
tab.send({ type: "confidence", action: "watch" });
ok(!!(await tab.wait((m) => m.type === "confidence")), "a stage tablet watches without pairing");
lyr.send({ type: "confidence", action: "state", state: { lines: ["Way maker, miracle worker"], next: ["Promise keeper"], section: "Chorus", song: "Way Maker", left: 182 } });
let cs = await tab.wait((m) => m.type === "confidence" && m.state);
ok(cs && cs.state.lines[0] === "Way maker, miracle worker" && cs.state.next[0] === "Promise keeper" && cs.state.from === "Lyrics laptop", "the lyrics computer's lines (now and next) reach it", cs);
band.send({ type: "confidence", action: "state", state: { lines: ["hijack"] } });
ok(!!(await band.wait((m) => m.type === "refused" && m.for === "confidence")), "a user device can't change the band's screen");
tab.send({ type: "confidence", action: "message", text: "hi" });
ok(!!(await tab.wait((m) => m.type === "auth" && m.ok === false)), "a watching tablet can't send messages");
main.send({ type: "confidence", action: "message", text: "One more chorus", seconds: 30 });
cs = await tab.wait((m) => m.type === "confidenceMessage");
ok(cs && cs.message.text === "One more chorus" && cs.message.by === "Sound desk", "the booth's message flashes on the band's screen", cs);
const http = await (await fetch("http://127.0.0.1:" + port + "/api/confidence")).json();
ok(http.state && http.message && http.message.text === "One more chorus", "/api/confidence for a plain page");
main.send({ type: "confidence", action: "clear" });
cs = await tab.wait((m) => m.type === "confidenceMessage");
ok(cs && cs.message === null, "Clear takes it off");
const page = await fetch("http://127.0.0.1:" + port + "/cu/confidence.html");
ok(page.status === 200 && /confidence/i.test(await page.text()), "the confidence page is served for a browser on stage");
const rs = await fetch("http://127.0.0.1:" + port + "/cu/runsheet.html");
ok(rs.status === 200, "the run sheet page is served for phones and printing");

// it all survives a restart
[main, lyr, band, tab].forEach((c) => c.close());
await center.stop();
center = new Center({ port: 0, dataDir: dir, beacon: false });
ok(center.services[0].team.leader === "Amy" && center.precheck.history.length === 2 && center.precheck.settings.lead === 45, "run sheets, checks and settings are kept");
console.log(fails ? "\n" + fails + " FAILED" : "\nall passed");
process.exit(fails ? 1 : 0);
