// 10.2: SongSelect / ChordPro song files (js/songfiles.js) and the CCLI copyright line and song keys (js/ccli.js).
//   node test-songfiles.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const S = require("./js/songfiles.js"), C = require("./js/ccli.js");
let fails = 0;
const ok = (c, m, d) => { console.log((c ? "  ✓ " : "  ✗ ") + m + (c || d === undefined ? "" : "   -- " + JSON.stringify(d).slice(0, 600))); if (!c) fails++; };

console.log("SongSelect lyrics (.txt):");
const txt = "Amazing Grace (My Chains Are Gone)\n\nVerse 1\nAmazing grace how sweet the sound\nThat saved a wretch like me\n\nVerse 2\nTwas grace that taught my heart to fear\n\nChorus\nMy chains are gone\nI have been set free\n\nCCLI Song # 4768151\nChris Tomlin | John Newton | Louie Giglio\n© 2006 sixsteps Music (Admin. by Capitol CMG Publishing)\nFor use solely with the SongSelect® Terms of Use. All rights reserved. www.ccli.com\nCCLI License # 1234567\n";
let p = S.parse("amazing.txt", txt);
ok(p.format === "songselect-txt" && p.title === "Amazing Grace (My Chains Are Gone)" && p.ccli === "4768151" && p.authors.join("|") === "Chris Tomlin|John Newton|Louie Giglio" && /^2006 sixsteps/.test(p.copyright), "title, CCLI number, writers and copyright from the footer", p);
ok(p.sections.map((s) => s.name).join("|") === "Verse 1|Verse 2|Chorus" && p.sections[0].lines.length === 2 && !p.sections.some((s) => s.lines.some((l) => /CCLI|©/.test(l))), "the sections and their lines, without the footer", p.sections);

console.log("SongSelect import (.usr):");
const usr = "[File]\nType=SongSelect Import File\nVersion=3.0\n[S A4768151]\nTitle=Amazing Grace (My Chains Are Gone)\nAuthor=Chris Tomlin | John Newton\nCopyright=2006 sixsteps Music\nKeys=G\nFields=Verse 1/tChorus/tMisc 1\nWords=Amazing grace how sweet the sound/nThat saved a wretch like me/tMy chains are gone/nI have been set free/tTag line\n";
p = S.parse("x.usr", usr);
ok(p.format === "songselect-usr" && p.ccli === "4768151" && p.key === "G" && p.sections.map((s) => s.name).join("|") === "Verse 1|Chorus|Tag 1" && p.sections[1].lines[1] === "I have been set free", ".usr: fields and words, Misc becomes Tag", p);

console.log("ChordPro:");
const cp = "{title: Amazing Grace}\n{artist: John Newton}\n{key: G}\n{tempo: 72}\n{ccli: 22025}\n{copyright: Public Domain}\n{comment: Verse 1}\n[G]Amazing [G7]grace how [C]sweet the [G]sound\n{soc}\n[C]My chains are [G]gone\n{eoc}\n{start_of_tab}\ne|---0---|\n{end_of_tab}\n{chorus}\n";
p = S.parse("ag.cho", cp);
ok(p.format === "chordpro" && p.title === "Amazing Grace" && p.key === "G" && p.tempo === 72 && p.ccli === "22025" && p.copyright === "Public Domain", "directives: title, key, tempo, CCLI, copyright", p);
ok(p.sections.map((s) => s.name).join("|") === "Verse 1|Chorus|Chorus" && p.sections[2].lines[0] === "[C]My chains are [G]gone" && !p.sections.some((s) => s.lines.some((l) => /e\|/.test(l))), "sections, {chorus} repeats the chorus, tabs left out, chords kept inline", p.sections);
const chart = S.toChart(p);
ok(/^\{title: Amazing Grace\}\n\{key: G\}\n\{tempo: 72\}\n\n\[Verse 1\]\n\[G\]Amazing/.test(chart), "toChart makes the chart text the apps read", chart);
ok(S.wordsOf(p.sections[0].lines) === "Amazing grace how sweet the sound", "the words without chords");
ok(S.detect("plain.txt", "Verse 1\nhello") === "text" && S.parse("My Song.txt", "Verse\na\nVerse\nb").sections.map((s) => s.name).join("|") === "Verse 1|Verse 2", "plain text: numbered verses, the title from the file name");

console.log("the CCLI copyright line:");
const set = { license: "1234567", credit: { on: true, where: "first" } };
ok(C.creditLine({ title: "Amazing Grace (My Chains Are Gone)", authors: ["Chris Tomlin", "John Newton"], copyright: "© 2006 sixsteps", ccli: "4768151" }, set) === "Amazing Grace (My Chains Are Gone) · Chris Tomlin, John Newton · © 2006 sixsteps · CCLI Song # 4768151 · CCLI License # 1234567", "the full line");
ok(C.creditLine({ title: "Be Thou My Vision", author: "Traditional", copyright: "Public Domain" }, set) === "Be Thou My Vision · Traditional · Public Domain", "a public-domain hymn: no numbers, no ©");
ok(C.creditLine({ title: "X", ccli: "55" }, set, { first: false, last: true }) === null && C.creditLine({ title: "X", ccli: "55" }, { credit: { where: "last" } }, { first: false, last: true }) === "X · CCLI Song # 55", "only on the slide it's set for; a missing licence number is left out");
ok(C.creditLine({ title: "X", ccli: "55" }, { credit: { on: false } }) === null, "off is off");
ok(C.songKey({ title: "The Amazing Grace (Live)" }) === "t:amazing grace" && C.songKey({ ccli: "CCLI 123" }) === "ccli:123", "a song is its CCLI number, or its plain title");

console.log(fails ? "\n" + fails + " FAILED" : "\nall passed");
process.exit(fails ? 1 : 0);
