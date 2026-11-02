// Real lights on the lights page (10.2), in a browser window with no Central Pedal:
//   the fixture library (thousands of real lights, searchable), adding one by maker and model, the channels a real light
//   needs (shutter open, the colour wheel's slots, CMY), making your own profile and exporting it as an Open Fixture
//   Library file, a light's own settings (movable or not, limits, curve), and the scene programmer (two lights' colour
//   and position recorded into a scene, recalled on the DMX output).
//     node test-lights-fixtures.mjs
import { chromium } from "playwright";
import path from "node:path"; import assert from "node:assert"; import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
let failures = 0; async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e && e.message || e).split("\n").slice(0, 6).join("\n      ")); } }

const b = await chromium.launch({ executablePath: CHROME, args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
const p = await ctx.newPage(); const errs = [];
p.on("pageerror", (e) => errs.push(String(e))); p.on("dialog", (d) => d.accept(d.type() === "prompt" ? "My programmed look" : undefined));
await p.addInitScript(() => {
  localStorage.setItem("cu-mode", JSON.stringify("admin")); localStorage.setItem("cu-role", JSON.stringify("admin"));
  localStorage.setItem("cc-license", JSON.stringify({ key: "ADEF-AULT-KEY0-2026", kind: "A", app: "control", okAt: Date.now() }));
});
await p.goto("file://" + path.join(here, "app", "index.html")); await p.waitForFunction(() => window.CentralUsage && window.CULights && window.CUFixtureCatalog && window.CULightsProg);
await p.evaluate(() => { try { CentralUsage.setMode("admin"); } catch (_) { } document.querySelector('[data-tab="lights"]').click(); CULights.showSub("fixtures"); });
await p.waitForSelector("#fpFindBtn", { timeout: 8000 });
const DMX = (uni, from, n) => p.evaluate(([u, a, k]) => Array.from(CULights.render()[String(u)] || []).slice(a - 1, a - 1 + k), [uni, from, n]);

console.log("The fixture library:");
await check("it opens offline: over 2,000 real lights from over 200 makers, in thousands of modes", async () => {
  const info = await p.evaluate(async () => { await CUFixtureCatalog.load(); return CUFixtureCatalog.info(); });
  assert.ok(info.fixtures >= 2000, "fixtures " + info.fixtures); assert.ok(info.makers >= 200, "makers " + info.makers); assert.ok(info.modes >= 6000, "modes " + info.modes);
  assert.deepEqual(info.sources.map((s) => s.license), ["MIT", "Apache-2.0"]);
});
await check("known lights map right: a Chauvet SlimPAR Pro H (RGBAW+UV) and a Martin MAC Aura (shutter, zoom, 16-bit pan and tilt)", async () => {
  const r = await p.evaluate(() => {
    const sp = CUFixtureCatalog.search("chauvet slimpar pro h usb", 20).filter((h) => h.fx.n === "SlimPAR Pro H USB" && h.fx.s === "o")[0], aura = CUFixtureCatalog.search("martin mac aura", 5).filter((h) => h.fx.n === "MAC Aura")[0];
    return { sp: sp && CUFixtureCatalog.entry(sp.fx, sp.fx.md.findIndex((m) => m.n === "7-channel")), aura: aura && CUFixtureCatalog.entry(aura.fx, 0) };
  });
  assert.ok(r.sp, "SlimPAR found"); assert.deepEqual(r.sp.ch, ["dim", "r", "g", "b", "a", "w", "uv"]); assert.equal(r.sp.mover, false);
  assert.ok(r.aura, "MAC Aura found"); assert.deepEqual(r.aura.ch.slice(0, 7), ["strobe", "dim", "zoom", "pan", "panf", "tilt", "tiltf"]); assert.equal(r.aura.mover, true);
  assert.equal(r.aura.cv[0].o, 22, "shutter open at 22"); assert.ok(r.aura.panDeg >= 500, "pan " + r.aura.panDeg);
});
await check("searching by maker and model finds it, and Add puts it in the rig at the address asked", async () => {
  await p.evaluate(() => { CULights.rig().fixtures = []; CULights.saveRig(); CULights.renderFixtures(); });
  await p.click("#fpFindBtn"); await p.waitForSelector("#fpQ"); await p.fill("#fpQ", "mac aura"); await p.waitForSelector('[data-fp-hit]');
  await p.click('[data-fp-hit]:has-text("MAC Aura")'); await p.waitForSelector("#fpMode");
  await p.fill("#fpUni", "2"); await p.fill("#fpAddr", "101"); await p.fill("#fpCount", "2"); await p.fill("#fpName", "Aura");
  await p.click('[data-fp="add"]'); await p.waitForFunction(() => CULights.rig().fixtures.length === 2);
  const f = await p.evaluate(() => CULights.rig().fixtures.map((x) => ({ name: x.name, profile: x.profile, universe: x.universe, address: x.address, group: x.group })));
  assert.deepEqual(f.map((x) => [x.name, x.universe, x.address, x.group]), [["Aura 1", 2, 101, "beam"], ["Aura 2", 2, 115, "beam"]]);
  assert.ok(/^lib:ofl-martin-mac-aura/.test(f[0].profile), f[0].profile);
});
await check("a real moving head gets its shutter open (not 0 = dark), its dimmer and a 16-bit position", async () => {
  await p.evaluate(() => { CULights.goLook("chorus"); });
  await p.waitForTimeout(1200);
  const d = await DMX(2, 101, 7);
  assert.equal(d[0], 22, "shutter open " + d); assert.ok(d[1] > 100, "dimmer " + d[1]); assert.equal(d[2], 128, "zoom middle");
});
await check("a colour-wheel light picks the slot nearest the colour, CMY lights mix by taking colour away", async () => {
  const r = await p.evaluate(() => {
    const M = CUFixtureMap, f = { id: "x" }, p = { src: { cv: { 0: { o: 0, sl: [[16, "#ff0000"], [32, "#0000ff"], [48, "#00ff00"]] } } } };
    const st = (r, g, b) => ({ r, g, b, dim: 1, strobe: 0 });
    return { blue: M.channel(f, p, 0, "wheel", st(0.1, 0.2, 1), 0), red: M.channel(f, p, 0, "wheel", st(1, 0.1, 0), 0), white: M.channel(f, p, 0, "wheel", st(1, 1, 1), 0),
      c: M.channel(f, {}, 1, "c", st(1, 0, 0), 0), m: M.channel(f, {}, 1, "m", st(1, 0, 0), 0), y: M.channel(f, {}, 1, "y", st(1, 0, 0), 0) };
  });
  assert.deepEqual([r.blue, r.red, r.white], [32, 16, 0]); assert.deepEqual([r.c, r.m, r.y], [0, 255, 255]);
});

console.log("Your own profile:");
await check("make a profile channel by channel, save it, and it's in the Type list; it exports as an Open Fixture Library file and comes back the same", async () => {
  await p.click("#fpMakeBtn"); await p.waitForSelector(".fp-make");
  await p.fill('[data-pm="maker"]', "Acme"); await p.fill('[data-pm="model"]', "Wash 5"); await p.fill('[data-pm="mode"]', "5-channel");
  await p.click('[data-fp="addch"]');
  await p.selectOption('[data-pj="4"]', "strobe"); await p.fill('[data-pv="4:o"]', "8");
  await p.click('[data-fp="save"]');
  const e = await p.evaluate(() => CULights.rig().library.filter((x) => x.model === "Wash 5")[0]);
  assert.deepEqual(e.ch, ["dim", "r", "g", "b", "strobe"]); assert.equal(e.cv[4].o, 8);
  assert.ok(await p.evaluate(() => !!document.querySelector('#lxAddProfile option[value^="lib:mine-acme-wash-5"]')), "in the Type list");
  const back = await p.evaluate((en) => { const ofl = CUFixtureCatalog.toOfl(en); return CUFixtureCatalog.fromOfl(JSON.stringify(ofl), "acme.json")[0]; }, e);
  assert.deepEqual(back.ch, e.ch); assert.equal(back.cv[4].o, 8);
  await p.click('.fp-make [data-fp="close"]');
});

console.log("A light's own settings:");
await check("⚙ on a light: movable no hides the position controls, and the light holds its home position", async () => {
  await p.click('#lxFixTable [data-fp-set]'); await p.waitForSelector(".fp-set");
  assert.ok(await p.isVisible('.fp-set [data-fs="pan0"]'), "pan limits shown for a moving head");
  await p.selectOption('.fp-set [data-fs="movable"]', "false"); await p.waitForTimeout(150);
  assert.equal(await p.locator('.fp-set [data-fs="pan0"]').count(), 0, "no position settings once it's fixed");
  const f = await p.evaluate(() => CULights.rig().fixtures[0]); assert.equal(f.movable, false);
  await p.click('.fp-set [data-fp="close"]');
});
await check("max intensity and the dimmer curve change what goes out", async () => {
  await p.evaluate(() => { const f = CULights.rig().fixtures[1]; f.maxDim = 0.5; CULights.saveRig(); });
  await p.waitForTimeout(300);
  const a = await DMX(2, 101, 2), c = await DMX(2, 115, 2);
  assert.ok(Math.abs(c[1] - a[1] / 2) <= 2, "half: " + a[1] + " vs " + c[1]);
  await p.evaluate(() => { delete CULights.rig().fixtures[1].maxDim; CULights.saveRig(); });
});

console.log("The scene programmer:");
await check("a scene's row has Program lights; two lights get a colour and a position and are recorded into the scene", async () => {
  await p.evaluate(() => {
    const X = CULights; X.rig().fixtures = []; X.saveRig();
    window.CUFixturePicker.addLights("mhwash14", 2, 1, 1, "beam", "Wash");
    X.rig().fixtures.forEach((f) => { delete f.movable; }); X.saveRig();
    X.rig().localSongs = (X.rig().localSongs || []).filter((s) => s.id !== "cu-test").concat([{ id: "cu-test", name: "Test song", bpm: 120, bpb: 4 }]); X.saveRig();
  });
  // a song of our own with one scene
  await p.evaluate(() => { CULights.showSub("songs"); CULights.renderSongs(); });
  await p.waitForSelector('#lxSongs [data-ls-pick="cu-test"]', { timeout: 4000 }); await p.click('#lxSongs [data-ls-pick="cu-test"]');
  await p.waitForFunction(() => { const t = CULights.editTarget(); return t && !t.loading && Array.isArray(t.cues); }, null, { timeout: 4000 });
  const has = await p.evaluate(() => !!document.querySelector('#lxSongs [data-ls="new"]'));
  assert.ok(has, "the songs page");
  await p.evaluate(() => { const X = CULights, t = X.editTarget(); if (t && !t.cues.some((c) => c.kind === "look")) X.addScene("worship"); });
  await p.waitForSelector("#lxSongs [data-lp-open]", { timeout: 4000 });
  await p.click("#lxSongs [data-lp-open]"); await p.waitForSelector("#lpPanel:not([hidden])");
  await p.click('#lpPanel [data-lpa="all"]');
  await p.click('#lpPanel [data-lpsw="#ff2a10"]');
  await p.evaluate(() => { CULightsProg.set("pan", 0.25); CULightsProg.set("tilt", 0.75); CULightsProg.set("dim", 0.9); });
  await p.click('#lpPanel [data-lpa="record"]');
  const prog = await p.evaluate(() => { const t = CULights.editTarget(); return t.cues.filter((c) => c.kind === "look")[0].prog; });
  const ids = await p.evaluate(() => CULights.rig().fixtures.map((f) => f.id));
  assert.equal(Object.keys(prog).length, 2); assert.equal(prog[ids[0]].color, "#ff2a10"); assert.equal(prog[ids[1]].pan, 0.25);
});
await check("while programming it's live, and the recorded scene plays those values on the DMX output", async () => {
  // mhwash14: pan panf tilt tiltf speed dim strobe r g b w - - -
  const live = await DMX(1, 1, 11);
  assert.equal(live[0], Math.round(0.25 * 65535) >> 8, "pan " + live); assert.equal(live[2], Math.round(0.75 * 65535) >> 8, "tilt");
  assert.ok(live[7] > 200 && live[8] < 60 && live[9] < 30, "red " + live.slice(7, 10)); assert.ok(Math.abs(live[5] - 230) <= 3, "dimmer 90% " + live[5]);
  await p.click('#lpPanel [data-lpa="close"]');
  const after = await p.evaluate(() => { const t = CULights.editTarget(), cue = t.cues.filter((c) => c.kind === "look")[0], f = CULights.rig().fixtures[0];
    const base = { from: CULights.lookById(cue.look), to: CULights.lookById(cue.look), p: 1, cue: cue };
    const st = CULightsProg.apply({ dim: 0.2, r: 0, g: 0, b: 1, w: 0, a: 0, uv: 0, strobe: 0, pan: 0.5, tilt: 0.5, haze: 0 }, f, base, 0, 999);
    return st; });
  assert.ok(after.r > 0.9 && after.b < 0.1, "the scene's red wins over the preset's blue"); assert.equal(after.pan, 0.25); assert.ok(Math.abs(after.dim - 0.9) < 1e-6);
});
await check("Highlight shows the picked lights at full white; undo takes the last change back", async () => {
  await p.click("#lxSongs [data-lp-open]"); await p.waitForSelector("#lpPanel:not([hidden])");
  await p.click('#lpPanel [data-lpa="all"]'); await p.check('#lpPanel [data-lpa="highlight"]'); await p.waitForTimeout(150);
  const d = await DMX(1, 1, 11); assert.equal(d[5], 255); assert.deepEqual(d.slice(7, 10), [255, 255, 255]);
  await p.uncheck('#lpPanel [data-lpa="highlight"]');
  await p.click('#lpPanel [data-lpsw="#1f4dff"]'); assert.equal(await p.evaluate(() => CULightsProg.state().work[CULights.rig().fixtures[0].id].color), "#1f4dff");
  await p.click('#lpPanel [data-lpa="undo"]'); assert.equal(await p.evaluate(() => CULightsProg.state().work[CULights.rig().fixtures[0].id].color), "#ff2a10");
});
await check("a fixed light shows no position controls in the programmer", async () => {
  await p.evaluate(() => { CULights.rig().fixtures.forEach((f) => { f.movable = false; }); CULights.saveRig(); CULightsProg.select(CULights.rig().fixtures.map((f) => f.id)); });
  assert.equal(await p.locator("#lpPanel [data-lpxy]").count(), 0);
  await p.evaluate(() => { CULights.rig().fixtures.forEach((f) => { delete f.movable; }); CULights.saveRig(); CULightsProg.select(CULights.rig().fixtures.map((f) => f.id)); });
  assert.equal(await p.locator("#lpPanel [data-lpxy]").count(), 1);
});
await check("Save as a new preset keeps the programmed lights in one of the church's own presets", async () => {
  await p.click('#lpPanel [data-lpa="aspreset"]');
  const l = await p.evaluate(() => CULights.rig().looks.filter((x) => x.name === "My programmed look")[0]);
  assert.ok(l && l.mine && l.prog && Object.keys(l.prog).length === 2);
  await p.click('#lpPanel [data-lpa="close"]');
});

await check("no page errors", async () => { assert.deepEqual(errs, []); });
await b.close();
console.log(failures ? "\n" + failures + " FAILED" : "\nall passed");
process.exit(failures ? 1 : 0);
