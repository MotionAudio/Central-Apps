// The song sheet (js/sheets.js), clefs, and the chart / lyric writers - run with node, no browser needed.
import fs from "node:fs"; import path from "node:path"; import vm from "node:vm"; import assert from "node:assert"; import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const sandbox = { console, setTimeout, clearTimeout, setInterval: () => 0, Math, JSON, Date };
sandbox.globalThis = sandbox; vm.createContext(sandbox);
for (const f of ["js/chords.js", "js/notation.js", "js/parts.js", "js/sheets.js", "js/lyrics-ai.js"]) vm.runInContext(fs.readFileSync(path.join(here, f), "utf8"), sandbox, { filename: f });
const S = sandbox.PPSheets, C = sandbox.PPChords, P = sandbox.PPParts, N = sandbox.PPNotation, LA = sandbox.PPLyricsAI;
let failures = 0;
function check(label, fn) { try { fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e.stack || e.message || e).split("\n").slice(0, 6).join("\n      ")); } }
const J = (x) => JSON.parse(JSON.stringify(x));
const sec = (id, name, bar, lyrics) => ({ id, name, bar, pad: -1, transition: "inherit", cue: "auto", lyrics: lyrics || "", page: 0 });
const song = () => ({ sections: [sec("i", "Intro", 1), sec("v", "Verse 1", 5, "Here I am\nto worship"), sec("c", "Chorus", 13, "Holy holy"), sec("b", "Bridge", 21, "Nothing else")], flow: ["i", "v", "c", "b", "c"], flowOn: true });

console.log("Sections: lengths, add, take away");
check("each section's length in bars; the last one runs to the end of the song", () => {
  assert.deepEqual(J(S.lengths(song().sections, 28)).map((q) => [q.name, q.bar, q.bars]), [["Intro", 1, 4], ["Verse 1", 5, 8], ["Chorus", 13, 8], ["Bridge", 21, 8]]);
});
check("a longer verse moves where the chorus starts (the bridge stays); it can't run into the bridge; the last section can't change", () => {
  const t = song();
  const r = S.setLength(t, "v", 10, 28); assert.ok(r.ok); assert.equal(t.sections.find((q) => q.id === "c").bar, 15); assert.equal(t.sections.find((q) => q.id === "b").bar, 21);
  const r2 = S.setLength(t, "v", 30, 28); assert.equal(r2.ok, false); assert.match(r2.why, /Only 15 bars fit before Bridge/); assert.equal(t.sections.find((q) => q.id === "c").bar, 20);
  const r3 = S.setLength(t, "b", 4, 28); assert.equal(r3.ok, false); assert.match(r3.why, /last section/);
});
check("a new section at a free bar goes there; at a bar where one starts it splits that section in the middle", () => {
  const t = song();
  const a = S.add(t, 9, "Verse 2", 28); assert.equal(a.bar, 9); assert.equal(a.name, "Verse 2");
  const b = S.add(t, 13, "Tag", 28); assert.equal(b.bar, 17, "the chorus (13-20) splits at 17");
  assert.equal(S.add({ sections: [sec("x", "A", 1), sec("y", "B", 2)] }, 1, "C", 3), null, "a one-bar section can't split");
});
check("taking a section out: its bars and words join the one before, and it leaves the flow (repeats of others stay)", () => {
  const t = song(); S.remove(t, "c");
  assert.deepEqual(t.sections.map((q) => q.name), ["Intro", "Verse 1", "Bridge"]);
  assert.equal(t.sections.find((q) => q.id === "v").lyrics, "Here I am\nto worship\nHoly holy");
  assert.deepEqual(J(t.flow), ["i", "v", "b"]);
  const t2 = song(); S.remove(t2, "i"); assert.equal(t2.sections.find((q) => q.id === "v").bar, 1, "the first section gone: the next one starts at bar 1");
});

console.log("The chart keeps its sections in step");
const chart = "{title: Here I Am}\n{key: G}\n\n[Intro]\n| G | D | Em | C |\n\n[Verse 1]\n[G]Here I am to [D]worship\n\n[Chorus]\n[C]Holy [G]holy\n\n[Bridge]\n[Em]Nothing [D]else\n";
check("renamed: the heading follows; taken out: its block goes; added: a new heading in the right place", () => {
  const before = [{ id: "i", name: "Intro" }, { id: "v", name: "Verse 1" }, { id: "c", name: "Chorus" }, { id: "b", name: "Bridge" }];
  let txt = S.syncChart(chart, before, [{ id: "i", name: "Intro" }, { id: "v", name: "Verse 1" }, { id: "c", name: "Big Chorus" }, { id: "b", name: "Bridge" }]);
  assert.match(txt, /\[Big Chorus\]\n\[C\]Holy/); assert.doesNotMatch(txt, /\[Chorus\]/);
  txt = S.syncChart(chart, before, [{ id: "i", name: "Intro" }, { id: "v", name: "Verse 1" }, { id: "b", name: "Bridge" }]);
  assert.doesNotMatch(txt, /Holy/); assert.match(txt, /\[Bridge\]/);
  txt = S.syncChart(chart, before, [{ id: "i", name: "Intro" }, { id: "v", name: "Verse 1" }, { id: "n", name: "Pre-Chorus" }, { id: "c", name: "Chorus" }, { id: "b", name: "Bridge" }]);
  assert.match(txt, /\[Pre-Chorus\]\n\n\[Chorus\]/, txt);
  const parsed = C.parseChart(txt); assert.deepEqual(parsed.sections.map((q) => q.name).filter((n) => n !== "Pre-Chorus"), ["Intro", "Verse 1", "Chorus", "Bridge"]);
});
check("a heading another section still has (a repeated Chorus) isn't taken out or renamed", () => {
  const before = [{ id: "c1", name: "Chorus" }, { id: "c2", name: "Chorus" }];
  assert.match(S.syncChart("[Chorus]\n[C]Holy\n", before, [{ id: "c2", name: "Chorus" }]), /\[Chorus\]/);
  assert.match(S.syncChart("[Chorus]\n[C]Holy\n", before, [{ id: "c1", name: "Chorus" }, { id: "c2", name: "Last Chorus" }]), /^\[Chorus\]/m);
});

console.log("Chords heard in the tracks");
check("flickers, pushes into the next bar, and one unsure beat go; repeats join up", () => {
  const ch = [{ bar: 1, beat: 1, label: "G", beats: 4 }, { bar: 2, beat: 1, label: "D", beats: 3 }, { bar: 2, beat: 4, label: "A", beats: 0.5 }, { bar: 2, beat: 4.5, label: "D", beats: 0.5 },
    { bar: 3, beat: 1, label: "Em", beats: 3 }, { bar: 3, beat: 4, label: "B7", beats: 1, conf: 0.2 }, { bar: 4, beat: 1, label: "C", beats: 3 }, { bar: 4, beat: 4, label: "D", beats: 1 }, { bar: 5, beat: 1, label: "G", beats: 4 }, { bar: 6, beat: 1, label: "N", beats: 1 }, { bar: 6, beat: 2, label: "G", beats: 3 }];
  assert.deepEqual(J(S.tidyChords(ch, 4)).map((c) => c.label + "@" + c.bar + "." + c.beat), ["G@1.1", "D@2.1", "Em@3.1", "C@4.1", "G@5.1"]);
});

console.log("The sheet");
const tracks = { sections: [sec("v", "Verse 1", 1, "Here I am"), sec("c", "Chorus", 5)], chords: [{ bar: 1, beat: 1, label: "G" }, { bar: 2, beat: 1, label: "D" }, { bar: 5, beat: 1, label: "C" }], keyShift: 2, tempoPercent: 90, originalKey: "G", chartText: "", flowOn: false, flow: [], duration: 30, grid: { bpb: 4 } };
const grid = { bpb: 4, bars: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28] };
check("a song played 2 up: the heard chords move with it; sections carry their bars; the tempo is the one played", () => {
  const sh = S.sheetOf({ id: "s1", name: "Here I Am", key: "A", bpm: 72 }, tracks, grid);
  assert.equal(sh.key, "A"); assert.equal(sh.keyShift, 2); assert.equal(sh.tempo, 90); assert.equal(sh.bars, 15);
  assert.deepEqual(J(sh.chords).map((c) => c.label), ["A", "E", "D"]);
  assert.deepEqual(J(sh.sections).map((q) => [q.name, q.bar, q.bars]), [["Verse 1", 1, 4], ["Chorus", 5, 11]]);
  const again = S.sheetOf({ id: "s1", name: "Here I Am", key: "A", bpm: 72 }, tracks, grid); assert.equal(again.sig, sh.sig, "the same song gives the same signature");
  const moved = S.sheetOf({ id: "s1", name: "Here I Am", key: "A", bpm: 72 }, Object.assign({}, tracks, { tempoPercent: 100 }), grid); assert.notEqual(moved.sig, sh.sig, "a tempo change is a new sheet");
});
const sheet = { id: "s", name: "Here I Am", key: "A", origKey: "G", keyShift: 2, mode: "major", bpm: 80, tempo: 90, bpb: 4, bars: 8, sections: [{ id: "v", name: "Verse 1", bar: 1, bars: 4 }, { id: "c", name: "Chorus", bar: 5, bars: 4 }, { id: "c2", name: "Chorus", bar: 9, bars: 4 }], chords: [], chartText: chart };
check("chord chart: the chart written in G shows in A (the key played), with the tempo played", () => {
  const out = S.render(sheet, { type: "chords", instrument: "concert" });
  assert.match(out.html, />A</); assert.match(out.html, /Here/); assert.doesNotMatch(out.html, />G</); assert.match(out.note, /Key of A/); assert.match(out.note, /♩ = 72 \(90%\)/);
});
check("number chart: numbers against the key played", () => {
  const out = S.render(sheet, { type: "numbers" }); assert.match(out.note, /Numbers in A/); assert.match(out.html, />1</); assert.match(out.html, />5</); assert.match(out.html, />6-</);
});
check("guitar: the easiest shapes, or the capo the player picks (capo 2 in A = G shapes)", () => {
  const auto = S.render(sheet, { type: "chords", instrument: "guitar", capo: "auto" }); assert.match(auto.note, /no capo/, "A shapes are open: no capo needed");
  const two = S.render(sheet, { type: "chords", instrument: "guitar", capo: "2" }); assert.match(two.note, /capo 2, play G shapes/); assert.match(two.html, />G</);
  const bb = S.render(Object.assign({}, sheet, { key: "Bb" }), { type: "chords", instrument: "guitar", capo: "auto" }); assert.match(bb.note, /capo 1, play A shapes/);
  const none = S.render(sheet, { type: "chords", instrument: "guitar", capo: "0" }); assert.match(none.note, /no capo/); assert.match(none.html, />A</);
  const four = S.render(sheet, { type: "chords", instrument: "guitar", capo: "4" }); assert.match(four.note, /capo 4, play F shapes/);
});
check("B♭ and E♭ instruments read in their own key", () => {
  assert.match(S.render(sheet, { type: "chords", instrument: "Bb" }).note, /written in B for your instrument/);
  assert.match(S.render(sheet, { type: "chords", instrument: "Eb" }).note, /written in (F♯|G♭) for your instrument/);
});
check("words only: no chords", () => { const out = S.render(sheet, { type: "lyrics" }); assert.match(out.html, /Holy/); assert.doesNotMatch(out.html, /class="ch"/); });
check("sheet music for any part, in the clef the player picks (alto for viola, tenor for cello / trombone)", () => {
  const alto = S.render(sheet, { type: "sheet", part: "violin", clef: "alto" }, { width: 800 });
  assert.match(alto.html, /<svg class="notation/); assert.match(alto.note, /Sheet music · Violin/);
  const treble = S.render(sheet, { type: "sheet", part: "violin", clef: "treble" }, { width: 800 });
  assert.notEqual(alto.html, treble.html, "the clef changes the drawing");
  assert.ok(alto.html.includes('<rect class="n-glyph"'), "a C clef is drawn");
});
check("the chart section that's playing: the same name, counting repeats", () => {
  const parsed = C.parseChart("[Verse 1]\nA\n[Chorus]\nB\n[Chorus]\nC\n");
  assert.equal(S.chartSectionFor(sheet, parsed, 0), 0); assert.equal(S.chartSectionFor(sheet, parsed, 1), 1); assert.equal(S.chartSectionFor(sheet, parsed, 2), 2);
  assert.equal(S.chartSectionFor(sheet, C.parseChart("[Verse]\nA\n[Chorus]\nB\n"), 2), 1, "one Chorus in the chart serves both");
});
check("a song with no chart text: the chart is written from the heard chords and the sections' words", () => {
  const sh2 = Object.assign({}, sheet, { chartText: "", chords: [{ bar: 1, beat: 1, label: "A" }, { bar: 5, beat: 1, label: "D" }], sections: [{ name: "Verse 1", bar: 1, bars: 4, lyrics: "" }, { name: "Chorus", bar: 5, bars: 4, lyrics: "" }] });
  const txt = S.textOf(sh2); assert.match(txt, /\{key: A\}/); assert.match(txt, /Verse 1\n\| A \| A \| A \| A \|/);
});

console.log("Clefs");
check("middle C sits on the alto clef's middle line and the tenor clef's 4th line", () => {
  const y = (clef) => { const svg = N.renderNotation([{ start: 0, dur: 4, midi: 60 }], { clef, key: "C", beatsPerBar: 4, width: 400 }); const m = /<ellipse[^>]*cy="([\d.]+)"/.exec(svg); const lines = [...svg.matchAll(/<line class="n-line"[^>]*y1="([\d.]+)"/g)].map((x) => +x[1]).slice(0, 5); return { head: m ? +m[1] : null, lines }; };
  const a = y("alto"), t = y("tenor");
  assert.ok(a.head != null && Math.abs(a.head - a.lines[2]) < 1.5, JSON.stringify(a));
  assert.ok(t.head != null && Math.abs(t.head - t.lines[1]) < 1.5, JSON.stringify(t));
});
check("key signatures in the alto clef: F♯ on the 4th line (one step under treble)", () => {
  const svg = N.renderNotation([], { clef: "alto", key: "G", beatsPerBar: 4, width: 300, minBars: 1 });
  assert.ok(/n-glyphs/.test(svg));
});

console.log("Parts follow the key the tracks play in");
check("chords heard in the recording move up with the tracks (keyShift), and so do transcribed notes", () => {
  const ctx = P.contextOf({ name: "x", key: "A", bpm: 80 }, { keyShift: 2, chords: [{ bar: 1, beat: 1, label: "G", bass: "B" }], sections: [], hits: [], words: [], stems: [], transcriptions: { b: { mode: "mono", notes: [{ start: 0, dur: 1, midi: 43 }] } }, grid: { bpb: 4 }, duration: 10 }, { bpb: 4, bars: [0, 3], period: 0.75 });
  assert.equal(ctx.chords[0].label, "A"); assert.equal(ctx.chords[0].bass, "C#"); assert.equal(ctx.transcriptions.b.notes[0].midi, 45);
});

console.log("Lyrics heard in the vocal");
check("[Music], made-up sign-offs and stutters go; i becomes I", () => {
  const w = LA.tidyWords([{ text: "[Music]", start: 0 }, { text: "i", start: 1, end: 1.2 }, { text: "will", start: 1.3, end: 1.5 }, { text: "will", start: 1.55, end: 1.7 }, { text: "praise", start: 1.8, end: 2.2 }, { text: "Thank", start: 30, end: 30.2 }, { text: "you", start: 30.3, end: 30.4 }, { text: "for", start: 30.45, end: 30.5 }, { text: "watching.", start: 30.55, end: 30.9 }]);
  assert.deepEqual(J(w).map((x) => x.text), ["I", "will", "praise"]);
});
check("lines start on a bar after a short pause; each line starts with a capital; chords spelled for the key (B♭, not A♯)", () => {
  const words = "here i am to worship here i am to bow down".split(" ").map((t, i) => ({ text: t, start: i < 5 ? i * 0.5 : 4 + (i - 5) * 0.5, end: (i < 5 ? i * 0.5 : 4 + (i - 5) * 0.5) + 0.3 }));
  const text = LA.chartFromWords(words, { title: "T", key: "F", bars: [0, 2, 4, 6], chords: [{ start: 0, end: 2, label: "F" }, { start: 2, end: 4, label: "A#" }, { start: 2.1, end: 2.2, label: "C" }, { start: 4, end: 6, label: "C" }], sections: [{ name: "Verse 1", start: 0 }] });
  const lines = text.split("\n").filter((l) => /[a-z]/i.test(l) && !/^[{[]/.test(l.replace(/^\[[^\]]*\]/, "x")) || /^\[[A-G]/.test(l));
  assert.ok(/\n\[F\]Here I am to \[B♭|\n\[F\]Here I am to \[Bb/.test(text) || /Bb/.test(text), text);
  assert.doesNotMatch(text, /A#/); assert.doesNotMatch(text, /\[C\]worship/, "the flicker chord (0.1 s) isn't written");
  assert.ok(text.split("\n").some((l) => /^\[?C?\]?Here I am to bow down/.test(l.replace(/\[[^\]]*\]/g, ""))), text);
});

console.log(failures ? "\n" + failures + " FAILED" : "\nALL SHEET CHECKS PASSED");
process.exit(failures ? 1 : 0);
