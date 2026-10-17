// Parts for every instrument (js/parts.js) - run with node, no browser needed.
import fs from "node:fs"; import path from "node:path"; import vm from "node:vm"; import assert from "node:assert"; import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const sandbox = { console, setTimeout, clearTimeout, setInterval: () => 0, Math, JSON, Date };
sandbox.globalThis = sandbox; vm.createContext(sandbox);
for (const f of ["js/chords.js", "js/notation.js", "js/parts.js"]) vm.runInContext(fs.readFileSync(path.join(here, f), "utf8"), sandbox, { filename: f });
const P = sandbox.PPParts;
let failures = 0;
function check(label, fn) { try { fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e.message || e).split("\n").slice(0, 6).join("\n      ")); } }
const pcs = (a) => Array.from(a).map((x) => ((x % 12) + 12) % 12).sort((x, y) => x - y).join(",");

check("chord symbols become the right notes (minor sevenths, sus, maj7, slash bass, add9, dim)", () => {
  assert.equal(pcs(P.parseChord("C").tones), "0,4,7");
  const fm7 = P.parseChord("F#m7"); assert.equal(fm7.root, 6); assert.equal(fm7.third, 9); assert.equal(fm7.seventh, 4);
  assert.equal(P.parseChord("Gsus4").third, 0); assert.equal(P.parseChord("Cmaj7").seventh, 11); assert.equal(P.parseChord("Cmaj7").third, 4);
  assert.equal(P.parseChord("D/F#").bass, 6); assert.ok(P.parseChord("Bbadd9").tones.includes(0)); assert.equal(P.parseChord("Bdim").fifth, 5);
  assert.equal(P.parseChord("Am").third, 0); assert.equal(P.parseChord("E7").seventh, 2);
});
// G - D - Em - C, verse bars 1-4 then chorus bars 5-8, in 4/4
const ctx = { name: "Test", key: "G", bpb: 4, bpm: 72, bars: 8,
  chords: [["G", 1], ["D", 2], ["Em", 3], ["C", 4], ["G", 5], ["D", 6], ["Em", 7], ["C", 8]].map(([label, bar]) => ({ bar, beat: 1, label })),
  sections: [{ name: "Verse 1", bar: 1 }, { name: "Chorus", bar: 5 }], hits: [28],
  chartText: "{title: Test}\n{key: G}\n[Verse 1]\n[G]Here I [D]am to [Em]worship [C]now\n[Chorus]\n[G]Holy [D]holy [Em]holy [C]Lord\n",
  stems: [], transcriptions: {} };
check("bass from the chords: the roots, low; held in the verse, a quarter-note pulse with approach notes in the chorus", () => {
  const b = P.build(ctx, "bass"); assert.equal(b.source, "chart");
  assert.ok(b.notes.every((n) => n.midi >= 28 && n.midi <= 47), JSON.stringify(b.notes.map((n) => n.midi)));
  const verse = b.notes.filter((n) => n.start < 16), chorus = b.notes.filter((n) => n.start >= 16);
  assert.deepEqual(verse.map((n) => [n.start, n.dur, n.midi % 12]), [[0, 4, 7], [4, 4, 2], [8, 4, 4], [12, 4, 0]]);
  assert.equal(chorus.length, 16); assert.ok(chorus.filter((n) => n.start % 4 === 0).every((n, i) => n.midi % 12 === [7, 2, 4, 0][i]));
});
check("keys: close triads that move little (voice leading) over roots in the left hand", () => {
  const k = P.build(ctx, "keys"); assert.equal(k.kind, "grand");
  const at = (t) => k.rh.filter((n) => n.start === t).map((n) => n.midi);
  assert.equal(pcs(at(0)), "2,7,11"); assert.equal(pcs(at(4)), "2,6,9");
  const moves = [0, 4, 8, 12].map((t) => at(t).reduce((a, b) => a + b, 0) / 3); for (let i = 1; i < moves.length; i++) assert.ok(Math.abs(moves[i] - moves[i - 1]) <= 4, moves.join(" "));
  assert.ok(k.lh.every((n) => n.midi < 60) && k.rh.every((n) => n.midi >= 57));
});
check("trumpet (B♭): rests in the quiet verse, guide tones in the chorus, written a tone higher (in A)", () => {
  const t = P.build(ctx, "trumpet"); assert.equal(t.writtenKey, "A");
  assert.ok(t.notes.every((n) => n.start >= 16), "tacet in the verse"); assert.ok(t.notes.length === 4);
  assert.ok(t.notes.every((n) => n.midi >= 55 && n.midi <= 79));
  assert.equal(t.chords[0].label, "A", "chord symbols written for the trumpet");
  const svg = P.render(t, "notation", { ctx, width: 900 }); assert.ok(/<svg/.test(svg) && /written in A/.test(svg));
});
check("alto sax in E♭ reads a song in G in E; cello plays the roots low in bass clef", () => {
  assert.equal(P.build(ctx, "altosax").writtenKey, "E");
  const c = P.build(ctx, "cello"); assert.ok(c.notes.length === 8 && c.notes.every((n) => n.midi <= 62)); assert.equal(c.clef, "bass");
});
check("drums from the sections: kick on every bar, backbeat in the chorus, a fill into the chorus, crash on a hit", () => {
  const d = P.build(ctx, "drums"); assert.equal(d.kind, "drums");
  for (let b = 0; b < 8; b++) assert.ok(d.drums.some((n) => n.voice === "kick" && n.start === b * 4), "kick bar " + (b + 1));
  assert.ok(d.drums.some((n) => n.voice === "snare" && n.start === 17) && d.drums.some((n) => n.voice === "snare" && n.start === 19));
  assert.ok(d.drums.some((n) => n.start >= 15 && n.start < 16 && (n.voice === "tom" || n.voice === "snare")), "fill in bar 4");
  assert.ok(d.drums.some((n) => n.voice === "crash" && n.start === 16) && d.drums.some((n) => n.voice === "crash" && n.start === 28 && n.accent));
  assert.ok(/<svg[^>]*drums/.test(P.render(d, "drums", { ctx })));
});
check("guitar: the chord chart with capo and a diagram for every shape used", () => {
  const g = P.build(ctx, "guitar"); const html = P.render(g, "chart", { ctx });
  assert.ok((html.match(/class="chord-diagram"/g) || []).length === 4, html.slice(0, 300)); assert.ok(/Here(&nbsp;| )I/.test(html));
  assert.ok(P.diagramSvg("F#m"), "a barre shape for a chord with no open shape"); assert.equal(P.shape("F#m").base, 2);
});
check("number chart: Nashville numbers against the key", () => { const html = P.render(P.build(ctx, "nashville"), "chart", { ctx }); assert.ok(/>1</.test(html) && />5</.test(html) && />6(m|-)?</.test(html) && />4</.test(html), html.slice(0, 400)); });
check("with a track for the instrument, what it really plays comes first (moved into the instrument's range)", () => {
  const c2 = Object.assign({}, ctx, { stems: [{ id: "s1", name: "Bass DI", role: "bass" }], transcriptions: { s1: { mode: "mono", notes: [{ start: 0, dur: 2, midi: 55 }, { start: 2, dur: 2, midi: 57 }] } } });
  const b = P.build(c2, "bass"); assert.equal(b.source, "stem"); assert.equal(b.stemName, "Bass DI"); assert.deepEqual(b.notes.map((n) => n.midi), [43, 45]);
  const c3 = Object.assign({}, ctx, { stems: [{ id: "s2", name: "Bass", role: "bass" }] });
  assert.ok(/transcribe/.test(P.build(c3, "bass").warn.join(" ")), "asks to transcribe the track when it exists but isn't heard yet");
});
check("vocals: the melody from the vocal track with the chart's words under the notes", () => {
  const notes = []; for (let i = 0; i < 6; i++) notes.push({ start: i, dur: 1, midi: 67 + (i % 3) });
  const c4 = Object.assign({}, ctx, { stems: [{ id: "v", name: "Lead Vox", role: "vocals" }], transcriptions: { v: { mode: "mono", notes } } });
  const v = P.build(c4, "vocals"); assert.equal(v.kind, "single");
  assert.deepEqual(v.lyrics.slice(0, 3).map((w) => w.text), ["Here", "I", "am"]);
  assert.ok(/class="n-lyric"/.test(P.render(v, "notation", { ctx: c4 })));
  const timed = P.build(Object.assign({}, c4, { words: [{ beat: 0.1, text: "Here" }, { beat: 1.2, text: "I" }] }), "vocals"); assert.deepEqual(timed.lyrics.map((w) => w.beat), [0, 1]);
  assert.equal(P.build(ctx, "vocals").kind, "chart", "no vocal track: the lead sheet");
});
check("a chart with no heard chords: its chords are spread over the song's sections (a | bar | is a bar)", () => {
  const c5 = { key: "G", bpb: 4, bars: 8, chords: [], sections: [{ name: "Verse 1", bar: 1 }, { name: "Chorus", bar: 5 }], chartText: "{key: G}\n[Verse 1]\n[G]Here I [D]am to [Em]worship [C]now\n[Chorus]\n| G | D | Em | C |\n" };
  const e = P.chordsFromChart(c5); assert.deepEqual(e.chords.map((c) => c.label + "@" + c.bar + "." + c.beat), ["G@1.1", "D@2.1", "Em@3.1", "C@4.1", "G@5.1", "D@6.1", "Em@7.1", "C@8.1"]);
  const b = P.build(c5, "bass"); assert.equal(b.notes.length > 0, true); assert.ok(/estimated/.test(b.warn.join(" ")));
});
check("a chart in another key than the song: its chords move to the song's key (E chart, song in G)", () => {
  const c6 = { key: "G", bpb: 4, bars: 4, chords: [], sections: [{ name: "Chorus", bar: 1 }], chartText: "{key: E}\n[Chorus]\n| E | B | C#m | A |\n" };
  assert.deepEqual(P.chordsFromChart(c6).chords.map((c) => c.label), ["G", "D", "Em", "C"]);
  assert.equal(P.build(c6, "trumpet").chords[0].label, "A");
});
check("every instrument builds and draws", () => { P.INSTRUMENTS.forEach((i) => { const p = P.build(ctx, i.id); const h = P.render(p, p.views[0], { ctx, width: 800 }); assert.ok(h.length > 100, i.id); }); });
console.log(failures ? "\n" + failures + " CHECK(S) FAILED" : "\nALL PARTS CHECKS PASSED"); process.exit(failures ? 1 : 0);
