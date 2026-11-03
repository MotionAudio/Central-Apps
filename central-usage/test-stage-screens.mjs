// The lights page's 3D stage, 10.2: screens and projectors showing what the real outputs show, the lyric backgrounds,
// the room and its seats with the light on them, lights anywhere (trusses over the audience, side trusses, behind
// the stage), and building a stage quickly (the wizard, tracing a plan, spreading lights, a patch from a CSV).
// Runs the Central Control page in Chromium on its own (no Central Pedal: its messages are given to the page).
//   node test-stage-screens.mjs
import { chromium } from "playwright";
import os from "node:os"; import path from "node:path"; import assert from "node:assert"; import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
let failures = 0; async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e && e.message || e).split("\n").slice(0, 8).join("\n      ")); } }
const errs = [];
const b = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 } });
const p = await ctx.newPage(); p.on("pageerror", (e) => errs.push("page: " + e)); p.on("console", (m) => { if (m.type() === "error" && !/favicon|NAME_NOT_RESOLVED|padpedal\.local|ERR_CONNECTION_REFUSED|ERR_FILE_NOT_FOUND|WebSocket|8095/.test(m.text())) errs.push("console: " + m.text()); });
await p.addInitScript(() => { localStorage.setItem("cu-mode", JSON.stringify("admin")); localStorage.setItem("cc-license", JSON.stringify({ key: "ADEF-AULT-KEY0-2026", kind: "A", app: "control", okAt: Date.now(), production: "Test church", isDefault: true })); });
await p.goto("file://" + path.join(here, "app", "index.html") + "?edition=control", { waitUntil: "domcontentloaded", timeout: 60000 }); await p.waitForFunction(() => window.CentralUsage && window.CULights && window.CULightsBuild, null, { timeout: 30000 });
await p.waitForTimeout(800);
await p.evaluate(() => { const jp = document.querySelector('[data-jp="all"]'); if (jp) { jp.click(); const s = document.querySelector('[data-jp="save"]'); if (s) s.click(); } document.querySelectorAll("dialog[open]").forEach((d) => d.close()); });
await p.evaluate(() => { document.querySelector('[data-tab="lights"]').click(); const s = document.querySelector('[data-lx="show"]'); if (s) s.click(); CULights.stageSize(720); });
await p.waitForFunction(() => window.CULights3D && CULights3D.active() && CULights3D.count() > 0, null, { timeout: 10000 });
await p.evaluate(() => { CULights.rig().units = "m"; });   // (the numbers below are in metres; feet are checked on their own)
// the Central Pedal's song and lyrics, as it would send them
const display = (lines, section, song = "Amazing Grace") => p.evaluate(([lines, section, song]) => CentralUsage.onMessage({ type: "display", song: { name: song, index: 0 }, songs: [{ name: song }], lyrics: { lines, section }, section: { name: section } }), [lines, section, song]);
await display(["Amazing grace how sweet the sound", "That saved a wretch like me"], "Verse 1");
const lum = (px) => px ? px[0] + px[1] + px[2] : -1;
const feedStats = (link) => p.evaluate((link) => { CUScreenFeed._tick(); const c = CUScreenFeed.canvas(link), g = c.getContext("2d"), d = g.getImageData(0, 0, c.width, c.height).data; let s = 0, n = 0, mid = 0; for (let i = 0; i < d.length; i += 16) { s += d[i] + d[i + 1] + d[i + 2]; n++; } const cy = Math.floor(c.height / 2), row = g.getImageData(0, cy - 10, c.width, 20).data; for (let i = 0; i < row.length; i += 4) mid = Math.max(mid, row[i] + row[i + 1] + row[i + 2]); const corner = g.getImageData(4, 4, 1, 1).data; return { avg: s / n, mid, corner: Array.from(corner), ver: c.ver }; }, link);

console.log("Screens and projectors:");
let scr = null, proj = null;
// (10.2) the 3D stage's add buttons live in its Stage menu: open it, then click
const stageMenu = async (sel) => { await p.evaluate(() => document.querySelectorAll(".lx3d-menu").forEach((d) => { d.open = d.querySelector("summary").textContent.trim() === "Stage"; })); await p.click(sel); };
await check("+ Screen adds an LED wall on the back wall, + Projector a projector; both are on the 3D stage and saved with the stage", async () => {
  await stageMenu('[data-ext3="screen"]'); await stageMenu('[data-ext3="projector"]');
  const r = await p.evaluate(() => ({ n: CULightsScreens.count(), s: CULights.rig().stage.screens, pr: CULights.rig().stage.projectors, saved: JSON.parse(localStorage.getItem("cu-rig")).stage.screens.length, panel: !document.querySelector("#lx3dScreenPanel").hidden }));
  assert.deepEqual([r.n, r.s.length, r.pr.length, r.saved, r.panel], [2, 1, 1, 1, true], JSON.stringify(r));
  scr = r.s[0].id; proj = r.pr[0].id; assert.equal(r.s[0].kind, "led"); assert.equal(r.pr[0].target, "wall");
});
await check("a projector aimed at a projection screen lights it with its picture (the screen shows the projector's output)", async () => {
  const r = await p.evaluate(([scr, proj]) => { const st = CULights.rig().stage; const ps = CULightsScreens.addScreen("projection"); const pr = st.projectors.find((x) => x.id === proj); pr.target = ps.id; pr.link = "pi1"; CULights.saveRig(); CULights3D.frame(); return { ps: ps.id, feed: CULightsScreens.feedOf(ps.id) }; }, [scr, proj]);
  assert.equal(r.feed, "pi1");
});
await check("the LED wall, linked to the Central Pedal's HDMI 2, shows its lyrics live in the 3D map; a new line changes the picture", async () => {
  await p.evaluate((scr) => { const s = CULights.rig().stage.screens.find((x) => x.id === scr); s.link = "pi2"; s.w = 6; CULights.saveRig(); CULights3D.view("audience"); }, scr);
  await p.waitForTimeout(300);
  const a = await feedStats("pi2"); assert.ok(a.mid > 600, "white lyrics in the middle of HDMI 2's picture " + JSON.stringify(a));
  const s1 = await p.evaluate((scr) => CULightsScreens.sample(scr), scr);
  await display(["", ""], "Verse 1"); await p.waitForTimeout(200); const b0 = await feedStats("pi2");
  assert.ok(b0.mid < 60, "no words: dark " + JSON.stringify(b0));
  await display(["When we've been there ten thousand years"], "Verse 4"); await p.waitForTimeout(200); const c = await feedStats("pi2"); assert.ok(c.mid > 600 && c.ver > a.ver, JSON.stringify(c));
  assert.ok(Array.isArray(s1) && s1.length === 4, "the 3D picture can be read " + JSON.stringify(s1));
});
await check("lyric backgrounds: Lyrics → Background lists 40+ of ours; picking Royal for every song puts it behind the lyrics (slides output and HDMI 2 with Slides)", async () => {
  await p.evaluate(() => { document.querySelector('[data-tab="lyrics"]').click(); document.querySelector("#lyricsBgBtn").click(); });
  const n = await p.evaluate(() => document.querySelectorAll("#lyricsBgPanel .lb-tile").length); assert.ok(n >= 41, "tiles " + n);
  await p.evaluate(() => { CUSlides.setLyricsLive(true); document.querySelector('#lyricsBgPanel [data-lbv="bg:royal"]').click(); });
  assert.equal(await p.evaluate(() => CUSlides.bgFor()), "bg:royal");
  // routed: HDMI 2 set to show the slides (Slides tab → outputs), the stage screen linked to HDMI 2
  await p.evaluate(() => { CUSlides.state().outputs.pi.on = true; CUSlides.setLyricsLive(true); });
  await p.waitForTimeout(200); const f = await feedStats("pi2");
  assert.ok(f.corner[2] > f.corner[1] && f.corner[0] + f.corner[2] > 30, "a purple-blue background in the corner " + JSON.stringify(f.corner));
  await p.evaluate(() => document.querySelector('#lyricsBgPanel [data-lbv="bg:ember"]').click()); await p.waitForTimeout(200);
  const g = await feedStats("pi2"); assert.ok(g.corner[0] > g.corner[2], "now warm (Ember) " + JSON.stringify(g.corner));
  await p.evaluate(() => { document.querySelector('#lyricsBgPanel [data-lbs="song"]').click(); });
  await p.evaluate(() => document.querySelector('#lyricsBgPanel [data-lbv="bg:forest"]').click());
  assert.equal(await p.evaluate(() => CUSlides.bgFor()), "bg:forest"); assert.equal(await p.evaluate(() => CUSlides.bgFor("Another song", "")), "bg:ember", "other songs keep the one for everything");
  await p.evaluate(() => { document.querySelector('[data-tab="lights"]').click(); });
});
await check("(10.2) Central Utility's seasonal set: Seasons opens on This Sunday's season, search finds by name and tag, locked without the plan and usable with it", async () => {
  await p.evaluate(() => { window.__hp = PPLicense.hasPlan; PPLicense.hasPlan = (t) => t !== "utility" && window.__hp(t);   // a plan without Central Utility
    document.querySelector('[data-tab="lyrics"]').click(); if (document.querySelector("#lyricsBgPanel").hidden) document.querySelector("#lyricsBgBtn").click(); document.querySelector('#lyricsBgPanel [data-lbf="seasons"]').click(); });
  try {
  const r = await p.evaluate(() => ({ sun: (document.querySelector("#lyricsBgPanel .lb-sun") || {}).textContent || "", want: CUSeasons.NAMES[CUSeasons.thisSunday().season], on: (document.querySelector("#lyricsBgPanel .lb-seasons button.on") || {}).dataset, n: document.querySelectorAll("#lyricsBgPanel .lb-tile[data-lbv]").length, locked: document.querySelectorAll("#lyricsBgPanel .lb-tile.locked").length }));
  assert.ok(r.sun.indexOf("This Sunday") === 0 && r.sun.indexOf(r.want) > 0, JSON.stringify(r)); assert.ok(r.n >= 2 && r.locked === r.n, "this season's tiles, all locked here " + JSON.stringify(r));
  await p.evaluate(() => document.querySelector('#lyricsBgPanel [data-lbseason="any"]').click());
  await p.fill("#lyricsBgPanel [data-lbq]", "empty tomb"); const one = await p.evaluate(() => Array.from(document.querySelectorAll("#lyricsBgPanel .lb-tile[data-lbv]")).map((t) => t.dataset.lbv));
  assert.deepEqual(one, ["bg:s-easter-tomb"]);
  await p.fill("#lyricsBgPanel [data-lbq]", "dove"); const doves = await p.evaluate(() => document.querySelectorAll("#lyricsBgPanel .lb-tile[data-lbv]").length); assert.ok(doves >= 2, "tag search: doves " + doves);
  const before = await p.evaluate(() => CUSlides.bgFor());
  await p.evaluate(() => document.querySelector('#lyricsBgPanel [data-lbv="bg:s-pent-dove"]').click());
  const lk = await p.evaluate(() => ({ bg: CUSlides.bgFor(), msg: (document.querySelector("#lyricsBgPanel .lb-lock-msg") || {}).textContent || "" }));
  assert.equal(lk.bg, before, "not used without Central Utility"); assert.match(lk.msg, /comes with Central Utility/);
  await p.evaluate(() => { PPLicense.hasPlan = (t) => t === "utility" || window.__hp(t); CUSlides.openBgPicker(true); document.querySelector('#lyricsBgPanel [data-lbv="bg:s-pent-dove"]').click(); });
  assert.equal(await p.evaluate(() => CUSlides.bgFor()), "bg:s-pent-dove", "with Central Utility it goes up");
  const off = await p.evaluate(() => { PPLicense.hasPlan = (t) => t !== "utility" && window.__hp(t); return CUSlides.bgFor(); }); assert.notEqual(off, "bg:s-pent-dove", "the plan gone: back off the screens");
  } finally {
  await p.evaluate(() => { PPLicense.hasPlan = window.__hp; CUSlides.setBg("song", undefined); const q = document.querySelector("#lyricsBgPanel [data-lbq]"); q.value = ""; q.dispatchEvent(new Event("input", { bubbles: true })); document.querySelector('#lyricsBgPanel [data-lbf="all"]').click(); document.querySelector('#lyricsBgPanel [data-lbs="song"]').click(); document.querySelector('#lyricsBgPanel [data-lbv="bg:forest"]').click(); document.querySelector('[data-tab="lights"]').click(); });
  }
});
await check("(10.2) Central Utility's graphics: a countdown ticks ({countdown}), seasonal themes and Utility templates are listed", async () => {
  const r = await p.evaluate(() => {
    const R = CUSlideRender, d = R.newDeck({}), s = R.newSlide(d, "u-count"), c = document.createElement("canvas"); c.width = 480; c.height = 270;
    R.render(c.getContext("2d"), s, d, { time: 10, clock: 10 });
    return { left: R.clockText(R.countdownLeft(s.countdown, 10)), anim: R.animated(s, 999), at: R.countdownLeft({ at: "10:30" }, 0, new Date(2026, 10, 1, 10, 29, 0).getTime()), lower: R.newSlide(d, "u-lower-pill").kind, transparent: R.isTransparent(R.newSlide(d, "u-ov-live")),
      themes: R.themes().filter((t) => t.tier === "utility").length, tpls: R.TEMPLATES.filter((t) => t.tier === "utility").map((t) => t.group) };
  });
  assert.equal(r.left, "4:50"); assert.equal(r.anim, true); assert.equal(r.at, 60); assert.equal(r.lower, "lower"); assert.equal(r.transparent, true);
  assert.ok(r.themes >= 12 && r.themes <= 20, "themes " + r.themes); for (const g of ["Countdowns", "Lower thirds", "Overlays"]) assert.ok(r.tpls.includes(g), g);
});
await check("the 3D screen's picture follows: its pixels change when the background changes", async () => {
  await p.evaluate(() => { CULights3D.view("audience"); });
  await p.evaluate(() => document.querySelector('[data-tab="lyrics"]').click()); await p.evaluate(() => document.querySelector('#lyricsBgPanel [data-lbv="bg:snowfall"]').click()); await p.evaluate(() => document.querySelector('[data-tab="lights"]').click());
  await p.waitForTimeout(300); const a = await p.evaluate((scr) => CULightsScreens.sample(scr), scr);
  await p.evaluate(() => document.querySelector('[data-tab="lyrics"]').click()); await p.evaluate(() => document.querySelector('#lyricsBgPanel [data-lbv="bg:morning-glow"]').click()); await p.evaluate(() => document.querySelector('[data-tab="lights"]').click());
  await p.waitForTimeout(300); const c = await p.evaluate((scr) => CULightsScreens.sample(scr), scr);
  assert.ok(Math.abs(lum(a) - lum(c)) > 25 || Math.abs(a[0] - c[0]) > 20, "pixels " + JSON.stringify([a, c]));
});
await check("Blank screens (Stream Deck / MIDI) blacks the lyrics out and brings them back", async () => {
  const r = await p.evaluate(() => { const on = CULightsScreens.blankAll(true); CUScreenFeed._tick(); const c = CUScreenFeed.canvas("pi2"); const px = c.getContext("2d").getImageData(c.width / 2, c.height / 2, 1, 1).data; const off = CULightsScreens.blankAll(false); return { on, off, px: Array.from(px), action: !!(window.CUControls && CUControls.ACTIONS.screensBlank) }; });
  assert.ok(r.on && !r.off && r.px[0] + r.px[1] + r.px[2] < 30, JSON.stringify(r)); assert.ok(r.action, "a Controls job");
});

console.log("\nThe room and the seats:");
await check("draw a room (corners one by one), ask for 800 seats: 800 laid out facing the stage, drawn in 3D", async () => {
  await stageMenu('[data-ext3="room"]'); await p.click('#lx3dRoom [data-tpl="rect"]');
  await p.evaluate(() => { CULightsRoom.mode("draw"); [[-14, -6.6], [14, -6.6], [14, 30], [-14, 30]].forEach((q) => CULightsRoom.planClick(q[0], q[1])); document.querySelector('#lx3dRoom [data-rm="done"]').click(); });
  await p.evaluate(() => { const i = document.querySelector('#lx3dRoom [data-rf="count"]'); i.value = "800"; i.dispatchEvent(new Event("input", { bubbles: true })); CULights3D.frame(); });
  const r = await p.evaluate(() => ({ outline: CULights.rig().stage.hall.outline.length, l: CULightsRoom.layout(), msg: document.querySelector("#lxRoomFit").textContent }));
  assert.equal(r.outline, 4); assert.equal(r.l.placed, 800, JSON.stringify({ placed: r.l.placed, asked: r.l.asked })); assert.match(r.msg, /All 800 seats fit/);
  assert.ok(r.l.seats.every((s) => s.z > 0), "all in front of the stage");
});
await check("too many seats: the count that fits is said plainly", async () => {
  await p.evaluate(() => { const i = document.querySelector('#lx3dRoom [data-rf="count"]'); i.value = "6000"; i.dispatchEvent(new Event("input", { bubbles: true })); CULights3D.frame(); });
  const msg = await p.evaluate(() => document.querySelector("#lxRoomFit").textContent); assert.match(msg, /Only \d+ of 6000 seats fit/);
  await p.evaluate(() => { const i = document.querySelector('#lx3dRoom [data-rf="count"]'); i.value = "800"; i.dispatchEvent(new Event("input", { bubbles: true })); CULights3D.frame(); });
});
await check("an overhead truss over the audience with a light on it; the house lights coming up light the seats (and the summary says so)", async () => {
  const before = await p.evaluate(async () => {
    const L = CULights; L.rig().fixtures.forEach((f) => L.setOverride(f.id, { dim: 0, color: "#000000" }));
    for (let i = 0; i < 4; i++) { CULights.render(); CULights3D.frame(); await new Promise((r) => setTimeout(r, 150)); }
    return CULightsRoom.summary();
  });
  await p.evaluate(() => { document.querySelector('[data-stage3]').click(); document.querySelector('#lx3dStage [data-tk="aud"]').click(); });
  const r = await p.evaluate(async () => {
    const L = CULights, st = L.rig().stage, aud = st.trusses.find((t) => t.d < 0 && /Audience/.test(t.name)), house = L.rig().fixtures.find((f) => f.group === "house");
    CULights3D.pick([house.id]); document.querySelector('#lx3dPanel [data-put3="over-aud"]').click();
    house.aim = { yaw: 0, pitch: 90 }; L.saveRig();
    L.setOverride(house.id, { dim: 1, color: "#ffffff" });
    for (let i = 0; i < 4; i++) { CULights.render(); CULights3D.frame(); await new Promise((r) => setTimeout(r, 150)); }
    return { mount: house.mount, aud: aud && aud.id, sum: CULightsRoom.summary(), sug: CULights3D.ext.suggestGroup(house) };
  });
  assert.equal(r.mount, r.aud, "on the audience truss"); assert.equal(r.sug, "house", "a light over the audience pointing down is a house light");
  assert.ok(r.sum.avg > before.avg * 2 + 0.01, "brighter seats " + before.avg + " -> " + r.sum.avg); assert.match(r.sum.text, /Most seats/);
  await p.evaluate(() => { CULights.rig().fixtures.forEach((f) => CULights.setOverride(f.id, null)); });
});

console.log("\nBuilding a stage quickly:");
await check("the questions build a stage with the counts asked for (6 front, 4 back, 2 movers a side, 8 house, side trusses, a hazer) and DMX addresses that follow on", async () => {
  const r = await p.evaluate(() => {
    const out = CULightsBuild.build({ width: 12, depth: 7, deck: 0.8, shape: "thrust", seats: 600, room: "fan", back: "projection", risers: { drums: true, keys: true, choir: true }, choirRows: 2, stairs: true, lights: { front: 6, mid: 0, back: 4, moversEach: 2, house: 8, sides: 2, uplights: 0, blinders: 0, haze: true } });
    const F = CULights.rig().fixtures, st = CULights.rig().stage, by = (m) => F.filter((f) => f.mount === m).length;
    const addrs = F.map((f) => [f.universe, f.address, CULights.profileOf(f).ch.length]).sort((a, b) => a[0] - b[0] || a[1] - b[1]); let overlap = 0; for (let i = 1; i < addrs.length; i++) if (addrs[i][0] === addrs[i - 1][0] && addrs[i][1] < addrs[i - 1][1] + addrs[i - 1][2]) overlap++;
    return { out, front: F.filter((f) => /^Front/.test(f.name)).length, back: F.filter((f) => /^Back /.test(f.name)).length, movers: F.filter((f) => f.group === "beam").length, house: F.filter((f) => f.group === "house").length, sides: by("sideL") + by("sideR"), haze: F.filter((f) => f.group === "haze").length, overlap, shape: st.shape, width: st.width, seats: CULightsRoom.layout().asked, screens: st.screens.length, projectors: st.projectors.length, props: st.props.map((x) => x.kind).sort().join(","), risers: st.risers.length };
  });
  assert.deepEqual([r.front, r.back, r.movers, r.house, r.sides, r.haze, r.overlap], [6, 4, 4, 8, 4, 1, 0], JSON.stringify(r));
  assert.deepEqual([r.shape, r.width, r.seats, r.screens, r.projectors, r.risers], ["thrust", 12, 600, 1, 1, 2], JSON.stringify(r));
  assert.match(r.props, /choir/); assert.match(r.props, /drums/); assert.match(r.props, /stairs/);
  await p.waitForTimeout(200); assert.equal(await p.evaluate(() => CULights3D.count()), r.out.lights);
});
await check("undo brings back the stage from before; redo builds it again", async () => {
  const r = await p.evaluate(() => { const n1 = CULights.rig().fixtures.length; CULights3D.ext.undo(); const n0 = CULights.rig().fixtures.length, w0 = CULights.rig().stage.width; CULights3D.ext.redo(); return { n1, n0, w0, n2: CULights.rig().fixtures.length, w2: CULights.rig().stage.width }; });
  assert.ok(r.n0 !== r.n1 && r.w0 !== 12 && r.n2 === r.n1 && r.w2 === 12, JSON.stringify(r));
});
await check("spread 6 lights evenly along a truss (copies made of the picked light)", async () => {
  const r = await p.evaluate(() => {
    const L = CULights, st = L.rig().stage, t = st.trusses.find((x) => x.id === "back"), one = L.rig().fixtures.find((f) => f.mount === "back" && f.group === "back");
    L.rig().fixtures.filter((f) => f.mount === "back" && f !== one).forEach((f) => { f.mount = "floor"; });
    CULights3D.pick([one.id]); const msg = CULights3D.ext.spreadOnTruss(t, 6, one);
    const on = L.rig().fixtures.filter((f) => f.mount === "back").map((f) => CULights3D.ext.trussAlong(t, f.pos.x, f.pos.z)).sort((a, b) => a - b), gaps = on.slice(1).map((v, i) => +(v - on[i]).toFixed(3));
    return { msg, n: on.length, gaps };
  });
  assert.equal(r.msg, ""); assert.equal(r.n, 6); assert.ok(new Set(r.gaps).size === 1, "even gaps " + JSON.stringify(r.gaps));
});
await check("feet by default: the stage panel shows feet, and typing 40 ft makes a 12.19 m stage", async () => {
  const r = await p.evaluate(() => { delete CULights.rig().units; CULights3D.ext.closeOthers(); document.querySelector("[data-stage3]").click(); const w = document.querySelector("#lx3dStage [data-sf='width']"); const shown = w.value; w.value = "40"; w.dispatchEvent(new Event("input", { bubbles: true })); return { shown, label: w.parentNode.textContent, m: CULights.rig().stage.width }; });
  assert.match(r.label, /\(ft\)/); assert.equal(Math.round(r.m * 100) / 100, 12.19); assert.equal(Number(r.shown), 39.37);
  await p.evaluate(() => { CULights.rig().units = "m"; document.querySelector("[data-stage3]").click(); });
});
await check("trace a floor plan: a picture, its scale from one known distance, then the stage traced over it", async () => {
  const r = await p.evaluate(async () => {
    const c = document.createElement("canvas"); c.width = 400; c.height = 300; const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 400, 300); g.strokeStyle = "#000"; g.strokeRect(20, 20, 360, 260); g.fillStyle = "#888"; g.fillRect(150, 30, 100, 50);
    const blob = await new Promise((res) => c.toBlob(res, "image/png")); await CULightsRoom.loadTrace(new File([blob], "plan.png", { type: "image/png" }));
    const tr = CULights.rig().stage.trace, mpp0 = tr.mpp;
    // the room's 360 px wall is 18 m: mark its two ends
    CULightsRoom.open(true); CULightsRoom.mode("scale"); CULightsRoom.planClick(tr.x0 + 20 * mpp0, tr.z0 + 20 * mpp0); CULightsRoom.planClick(tr.x0 + 380 * mpp0, tr.z0 + 20 * mpp0);
    const inp = document.querySelector('#lx3dRoom [data-rf="scale-d"]'); inp.value = "18"; document.querySelector('#lx3dRoom [data-rm="scale-ok"]').click();
    const t2 = CULights.rig().stage.trace, k = t2.mpp, P = (x, y) => [t2.x0 + x * k, t2.z0 + y * k];
    // the stage: 100 px wide (5 m), 50 px deep (2.5 m)
    CULightsRoom.mode("stage"); const a = P(150, 80), b2 = P(250, 80), c2 = P(200, 30); CULightsRoom.planClick(a[0], a[1]); CULightsRoom.planClick(b2[0], b2[1]); CULightsRoom.planClick(c2[0], c2[1]);
    return { mpp: k, w: CULights.rig().stage.width, d: CULights.rig().stage.depth, img: !!document.querySelector("#lx3dRoom [data-trace]") };
  });
  assert.ok(Math.abs(r.mpp - 0.05) < 0.002, "18 m / 360 px = 0.05 m a pixel: " + r.mpp); assert.ok(Math.abs(r.w - 5) <= 0.25 && Math.abs(r.d - 2.5) <= 0.25, JSON.stringify(r)); assert.ok(r.img, "the picture shows under the plan");
});
await check("a patch from a CSV: names, types matched to fixtures, universes and addresses (2/101 too), where they hang; overlaps and bad addresses flagged", async () => {
  const csv = "Name,Manufacturer,Model,Universe,Address,Position\nFront 1,Generic,RGBW par 5ch,1,1,Front truss\nFront 2,Generic,RGBW par 5ch,1,6,Front truss\nWash L,Generic,Moving head wash RGBW 14ch,1,20,Back truss\nHouse A,ETC,Dimmer,,2/1,House\nBroken,Generic,Par,1,600,Floor\nClash,Generic,RGBW par 5ch,1,3,Floor\n";
  const r = await p.evaluate((csv) => { const rows = CULightsBuild.previewPatch(CULightsBuild.readPatch(csv, "patch.csv")); const n = CULightsBuild.importPatch(rows, true); const F = CULights.rig().fixtures; return { rows: rows.map((x) => [x.name, x.profile, x.universe, x.address, x.mount, x.group, !!x.bad, !!x.clash]), n, wash: F.find((f) => f.name === "Wash L") }; }, csv);
  const by = Object.fromEntries(r.rows.map((x) => [x[0], x]));
  assert.equal(by["Front 1"][1], "rgbwd5", JSON.stringify(by["Front 1"])); assert.equal(by["Wash L"][1], "mhwash14", JSON.stringify(by["Wash L"])); assert.equal(by["Wash L"][5], "beam"); assert.equal(by["Front 1"][4], "front");
  assert.deepEqual([by["House A"][2], by["House A"][3], by["House A"][4], by["House A"][5]], [2, 1, "house", "house"]);
  assert.ok(by["Broken"][6], "address 600 flagged"); assert.ok(by["Clash"][7], "overlaps Front 1");
  assert.equal(r.n, 5, "the bad one is left out"); assert.equal(r.wash.mount, "back");
});
await check("a stage file round trip, and props (drum kit, pulpit, cross) placed and saved", async () => {
  const r = await p.evaluate(() => { ["drums", "pulpit", "cross"].forEach((k) => CULightsBuild.addProp(k)); const f = CULightsBuild.stageFile("Test"); const n = CULights.rig().fixtures.length; CULightsBuild.useStageFile(JSON.parse(JSON.stringify(f))); return { fmt: f.format, props: CULights.rig().stage.props.length, n, n2: CULights.rig().fixtures.length }; });
  assert.equal(r.fmt, "central-stage"); assert.ok(r.props >= 3); assert.equal(r.n, r.n2);
});
await check("templates: each builds (small church to large stage with an LED wall)", async () => {
  const r = await p.evaluate(() => CULightsBuild.templates.map((t) => { const out = CULightsBuild.useTemplate(t.id); return [t.id, out.lights, CULights.rig().stage.screens.length]; }));
  assert.equal(r.length, 5); assert.ok(r.every((x) => x[1] > 3), JSON.stringify(r)); assert.ok(r.find((x) => x[0] === "large")[1] > 60, JSON.stringify(r));
});
await p.screenshot({ path: path.join(os.tmpdir(), "stage-screens-end.png") });
await check("no page errors", () => assert.deepEqual(errs, []));
console.log(failures ? "\n" + failures + " FAILED" : "\nall passed");
await b.close(); process.exit(failures ? 1 : 0);
