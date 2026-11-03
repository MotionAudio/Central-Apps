#!/usr/bin/env node
// (10.3) A plan that ends during a song: what's already playing with it keeps going until the song ends, then it
// "needs the X plan" and is bypassed. Choosing something new needs the plan straight away.
// js/license.js runs here as it does in the apps (a stand-in window, a clock the test moves), with js/pedals.js on top
// (the DAW and the Instrument tab ask through it).
//   node test-plan-lapse.mjs
import vm from "node:vm"; import fs from "node:fs"; import path from "node:path"; import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
let failures = 0;
async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e && e.message || e)); } }

let T = Date.parse("2026-11-01T10:00:00Z");
class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(T); } static now() { return T; } }
const store = {}, events = [];
const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
const ends = new Date(T + 60e3).toISOString(), later = new Date(T + 365 * 86400e3).toISOString();
store["cc-packages"] = JSON.stringify([{ key: "S000-0000-0000-0001", ok: true, okAt: T, plans: { plugins: ends, pedals: later } }]);
const win = {
  PP_LICENSE_CONFIG: { server: "https://example.test", required: true }, localStorage: ls, navigator: { userAgent: "node" }, location: { hostname: "127.0.0.1", href: "http://127.0.0.1/", search: "" },
  addEventListener() { }, removeEventListener() { }, dispatchEvent(e) { events.push(e.type); return true; },
  setTimeout: () => 0, clearTimeout() { }, setInterval: () => 0, clearInterval() { }, console,
};
win.window = win; win.self = win; win.parent = win; win.globalThis = win;
win.document = { addEventListener() { }, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, createElement: () => ({ style: {}, setAttribute() { }, appendChild() { } }), body: { appendChild() { } } };
win.CustomEvent = class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } };
win.Date = FakeDate;
const ctx = vm.createContext(win);
vm.runInContext(fs.readFileSync(path.join(here, "js", "license.js"), "utf8"), ctx, { filename: "license.js" });
vm.runInContext(fs.readFileSync(path.join(here, "js", "pedals.js"), "utf8"), ctx, { filename: "pedals.js" });
const L = win.PPLicense, P = win.PPPedals;

await check("both plans are active: chosen and playing", () => {
  assert.equal(L.hasPlan("plugins"), true); assert.equal(L.keeps("plugins"), true); assert.equal(P.keeps("plugins"), true);
});
await check("Central Plugins ends during a song: it can't be chosen any more, but what's playing with it keeps going", () => {
  L.setBusy("tracks", true); T += 120e3;
  assert.equal(L.hasPlan("plugins"), false, "choosing needs the plan"); assert.equal(P.has("plugins"), false);
  assert.equal(L.keeps("plugins"), true, "still playing"); assert.equal(P.keeps("plugins"), true);
  assert.equal(L.keeps("pedals"), true);
});
await check("the song ends: it needs the Central Plugins plan and is bypassed (the apps hear pp-plans and redraw)", () => {
  events.length = 0; L.setBusy("tracks", false);
  assert.equal(L.keeps("plugins"), false); assert.equal(P.keeps("plugins"), false);
  assert.ok(events.includes("pp-plans"), "pp-plans was sent");
  assert.equal(L.needs("plugins"), "needs the Central Plugins plan"); assert.equal(P.needsText("plugins"), "needs the Central Plugins plan");
  assert.equal(L.keeps("pedals"), true, "the other plan is untouched");
});
await check("the next song doesn't bring it back", () => {
  L.setBusy("tracks", true); assert.equal(L.keeps("plugins"), false); L.setBusy("tracks", false);
});
await check("the set moves to the next song while it plays (no stop between): that's the end of the song too", () => {
  store["cc-packages"] = JSON.stringify([{ key: "S000-0000-0000-0001", ok: true, okAt: T, plans: { pedals: new Date(T + 30e3).toISOString() } }]);
  vm.runInContext(fs.readFileSync(path.join(here, "js", "license.js"), "utf8"), ctx, { filename: "license.js" });
  const L2 = win.PPLicense;
  L2.setBusy("tracks", true); L2.setBusy("pads", true); T += 60e3;
  assert.equal(L2.keeps("pedals"), true, "playing");
  L2.setBusy("tracks", false); assert.equal(L2.keeps("pedals"), true, "the pads still play: the song isn't over");
  L2.songBoundary(); assert.equal(L2.keeps("pedals"), false, "a new song: bypassed");
  L2.setBusy("pads", false);
});
await check("a plan that ends with nothing playing stops straight away", () => {
  const L3 = win.PPLicense; assert.equal(L3.keeps("pedals"), false); assert.equal(L3.hasPlan("pedals"), false);
});
await check("every app asks keeps() where the audio plays (the pedal board, pads, Central FX, the DAW, the mixer inserts)", () => {
  const src = (f) => fs.readFileSync(path.join(here, f), "utf8");
  assert.match(src("js/instrument.js"), /function tierStopped\(tier\) \{ return PED\.keeps/);
  assert.match(src("js/app.js"), /L\.keeps\?L\.keeps\("pads"\)/);
  assert.match(src("js/fx.js"), /P\.keeps && !P\.keeps\(t\)/);
  assert.match(src("server/public/daw/daw-engine.js"), /P\.keeps\(t\)/);
  assert.match(src("central-usage/app/mix.js"), /L\.keeps \? L\.keeps\(t\)/);
  assert.match(src("central-usage/app/instrument-shim.js"), /keeps: function \(id\)/);
  assert.match(src("js/tracks.js"), /setBusy\("tracks"/); assert.match(src("js/features.js"), /songBoundary\(\)/); assert.match(src("central-usage/app/app.js"), /setBusy\("song"/);
});

if (failures) { console.error(failures + " failed"); process.exit(1); }
console.log("plan lapse: all passed");
