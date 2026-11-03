// 10.2: the pedal app with the 10.2 files: loads clean, Settings → Planning Center & CCLI, a SongSelect .usr into a song
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = process.argv[2] || path.dirname(fileURLToPath(import.meta.url));
let fails = 0; const ok = (c, m, d) => { console.log((c ? "  ✓ " : "  ✗ ") + m + (c || d === undefined ? "" : "   -- " + JSON.stringify(d).slice(0, 500))); if (!c) fails++; };
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } }); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
await page.goto("file://" + root + "/index.html");
await page.waitForFunction(() => window.PPShell && window.PPCcli && window.PPPlanningCenter && window.PPSongFiles, null, { timeout: 30000 });
await page.waitForTimeout(3500);
ok(!errs.length, "the app loads with no page errors", errs);
// Settings: the new group
const groups = await page.evaluate(() => { window.PPShell.renderSystemExtras(); const n = document.querySelector("#stNav"); return n ? n.textContent : ""; });
await page.evaluate(() => { const s = document.querySelector("#pcoSettings"), c = document.querySelector("#ccliSettings"); window.__cards = { pco: s ? s.textContent : "", ccli: c ? c.textContent : "" }; });
const cards = await page.evaluate(() => window.__cards);
ok(/Sign in to your church account/.test(cards.pco) && /CCLI/.test(cards.ccli) && /SongSelect/.test(cards.ccli), "Settings has the Planning Center card (asks to sign in) and the CCLI card", cards);
// a song, then a .usr through the song editor's chart upload
const usr = "[File]\nType=SongSelect Import File\n[S A4768151]\nTitle=Amazing Grace (My Chains Are Gone)\nAuthor=Chris Tomlin | John Newton\nCopyright=2006 sixsteps Music\nFields=Verse 1/tChorus\nWords=Amazing grace how sweet the sound/nThat saved a wretch like me/tMy chains are gone/nI have been set free\n";
fs.writeFileSync(path.join(os.tmpdir(), "pp-test-ag.usr") + "", usr);
const made = await page.evaluate(async () => { if (!window.PPTracks.newSong) return "no newSong"; await window.PPTracks.newSong("Test song"); window.PPTracks.openEditor(); return !!window.PPTracks.song(); });
ok(made === true, "a new song with the song editor open", made);
await page.setInputFiles("#chartFile", "" + path.join(os.tmpdir(), "pp-test-ag.usr") + "");
await page.waitForTimeout(1500);
const s = await page.evaluate(() => { const s = window.PPTracks.song(), t = window.PPTracks.data(s); return { ccli: s.ccli, author: s.author, copyright: s.copyright, secs: t.sections.map((x) => x.name + ":" + x.lyrics), chart: (t.chartText || "").slice(0, 80), field: (document.querySelector("#seCcli") || {}).value }; });
ok(s.ccli === "4768151" && s.author === "Chris Tomlin, John Newton" && s.copyright === "2006 sixsteps Music" && s.secs.length === 2 && /^Verse 1:Amazing grace/.test(s.secs[0]) && s.field === "4768151", "SongSelect .usr: the CCLI number, writers and copyright, and the sections with their words", s);
// the credit line in the display message
const cr = await page.evaluate(() => window.PPCcli.credit({ title: "Amazing Grace (My Chains Are Gone)", ccli: "4768151", author: "Chris Tomlin, John Newton", copyright: "2006 sixsteps Music" }, { first: true, last: false }));
ok(/CCLI Song # 4768151/.test(cr || ""), "the copyright line for the song's first slide", cr);
// usage: noted on the device when signed out (sent later)
const q = await page.evaluate(() => { window.PPCcli.log({ title: "Amazing Grace", ccli: "22025" }, "display"); window.PPCcli.log({ title: "Amazing Grace", ccli: "22025" }, "display"); return window.PPCcli.queue().length; });
ok(q === 1, "a use is noted once per song, kind and day, and waits while signed out", q);
ok(!errs.length, "still no page errors", errs);
await browser.close();
console.log(fails ? "\n" + fails + " FAILED" : "\nall passed"); process.exit(fails ? 1 : 0);
