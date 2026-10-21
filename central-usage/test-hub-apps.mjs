// Two real Central Control apps: the hub (main admin) keeps the second main admin's computer in sync, then that
// computer takes over as the hub through the app (Settings → Take over as the hub, with the role PIN). Checks the copy,
// the hand-over, the lighting and slides arriving in the new hub's window, and the old hub keeping itself in sync.
//   xvfb-run -a node test-hub-apps.mjs
import { _electron as electron } from "playwright";
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
let failures = 0; async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e && e.message || e).split("\n").slice(0, 6).join("\n      ")); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, what) { const end = Date.now() + (ms || 15000); let last; while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (_) { } await sleep(300); } throw new Error("timed out: " + (what || "") + " " + JSON.stringify(last)); }

const exe = [process.env.ELECTRON_PATH, path.join(here, "node_modules", "electron", "dist", "electron")].filter((p) => p && fs.existsSync(p))[0];
const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "hub-A-")), dirB = fs.mkdtempSync(path.join(os.tmpdir(), "hub-B-"));
// the hub's song library (its player folder) before it starts
fs.mkdirSync(path.join(dirA, "player", "songs", "way-maker"), { recursive: true });
fs.writeFileSync(path.join(dirA, "player", "songs", "way-maker", "song.json"), '{"title":"Way Maker"}');
fs.writeFileSync(path.join(dirA, "player", "songs", "way-maker", "click.wav"), "RIFF" + "c".repeat(50000));
const env = (role, port) => Object.assign({}, process.env, { CU_ROLE: role, CU_CENTER_PORT: String(port), CU_NO_BEACON: "1", CU_NO_RELAUNCH: "1", CU_SYNC_MS: "3000", CC_UPDATE_API: "http://127.0.0.1:9" });
const launch = (dir, role, port) => electron.launch({ executablePath: exe, args: [path.join(here, "main.js"), "--no-sandbox", "--user-data-dir=" + dir], env: env(role, port) });

const appA = await launch(dirA, "main", 18195), winA = await appA.firstWindow();
await winA.waitForFunction(() => window.CURoles && window.CUCenter && window.CU && window.CU.standby, null, { timeout: 30000 });
const appB = await launch(dirB, "admin", 18196), winB = await appB.firstWindow();
await winB.waitForFunction(() => window.CURoles && window.CUCenter && window.CU && window.CU.standby, null, { timeout: 30000 });
let keysA = null, idB = null;

try {
  await check("the hub (A) runs the center; its lighting rig and slides are in its window", async () => {
    keysA = await until(() => winA.evaluate(() => window.CUCenter.connected() && window.CURoles.keys()), 20000, "A's center");
    assert.ok(/^\d{4}$/.test(keysA.pin) && /^\d{4}$/.test(keysA.pair));
    await winA.evaluate(() => { localStorage.setItem("cu-rig", JSON.stringify({ fixtures: [{ name: "Wash 1" }] })); localStorage.setItem("cu-slides", JSON.stringify(["Welcome to Grace Church"])); localStorage.setItem("cu-fontSize", "31"); });
  });
  await check("the second main admin's laptop (B) pairs with the hub as an admin", async () => {
    await winB.evaluate(() => { localStorage.setItem("cu-centerHost", JSON.stringify("127.0.0.1:18195")); window.CUCenter.setAddress("127.0.0.1:18195"); });
    await until(() => winB.evaluate(() => window.CUCenter.connected()), 15000, "B connects");
    const r = await winB.evaluate((k) => window.CURoles.request("join", { pair: k.pair, code: k.pair, role: "admin", pin: k.pin }), keysA);
    assert.ok(r.ok && r.role === "admin", JSON.stringify(r));
    idB = await winB.evaluate(() => window.CURoles.devId());
  });
  await check("Devices on the hub: Keep B in sync; B gets its first copy (songs, tracks, paired devices)", async () => {
    await until(() => winA.evaluate((id) => (window.CURoles.view().devices || []).some((d) => d.id === id && d.online && d.edition === "control"), idB), 15000, "A sees B");
    const r = await winA.evaluate((id) => window.CURoles.request("standby", { target: id, on: true }), idB);
    assert.ok(r.ok, JSON.stringify(r));
    const st = await until(() => winB.evaluate(() => window.CU.standby.status().then((s) => s.on && s.ok && s.files >= 3 && s)), 20000, "B's first copy");
    assert.ok(fs.readFileSync(path.join(dirB, "standby", "player", "songs", "way-maker", "click.wav"), "utf8").length === 50004 && fs.existsSync(path.join(dirB, "standby", "center.json")), JSON.stringify(st));
  });
  await check("the hub's lighting and slides reach the copy (its window hands them over every 10 s)", async () => {
    await until(() => { try { const j = JSON.parse(fs.readFileSync(path.join(dirB, "standby", "hub-state.json"), "utf8")); return j.store["cu-rig"] && j.store["cu-slides"] && !j.store["cu-fontSize"] && j.pin === keysA.pin; } catch (_) { return false; } }, 30000, "hub-state in B's copy");
  });
  await check("the hub's Devices tab says B is in sync; B's Settings has Take over as the hub", async () => {
    await until(() => winA.evaluate(() => { const sb = window.CURoles.view().standby; return sb && sb.syncAt && sb.syncOk; }), 20000, "A sees B in sync");
    await winB.evaluate(() => { document.querySelector('[data-tab="settings"]').click(); });
    await until(() => winB.evaluate(() => /Take over as the hub/.test((document.querySelector("#settingsRoot") || {}).textContent || "")), 10000, "B's card");
    if (process.env.SHOTS) {   // (pictures of both cards)
      await winA.evaluate(() => document.querySelector('[data-tab="devices"]').click()); await sleep(800);
      const a = await winA.$(".dv-sb"); if (a) await a.screenshot({ path: path.join(process.env.SHOTS, "hub-devices-card.png") });
      const b = await winB.$(".hs-card"); if (b) await b.screenshot({ path: path.join(process.env.SHOTS, "hub-settings-card.png") });
    }
  });
  await check("a wrong role PIN doesn't take over", async () => {
    const r = await winB.evaluate((id) => window.CU.standby.takeover({ pin: "0000", deviceId: id }), idB);
    assert.ok(!r.ok && /role PIN/.test(r.error), JSON.stringify(r));
  });
  await check("Take over as the hub: B is the hub, with the songs, the lighting rig and the slides (not A's own preferences)", async () => {
    fs.writeFileSync(path.join(dirA, "player", "songs", "way-maker", "lyrics.txt"), "Way maker, miracle worker");
    const r = await winB.evaluate(({ pin, id }) => window.CU.standby.takeover({ pin, deviceId: id }), { pin: keysA.pin, id: idB });
    assert.ok(r.ok && r.planned, JSON.stringify(r));
    await until(() => appB.evaluate(({ }) => true), 5000);
    await until(() => winB.evaluate(() => window.CU && window.CU.center && window.CU.center.status().then((s) => s.on)), 20000, "B's center");
    assert.ok(fs.existsSync(path.join(dirB, "player", "songs", "way-maker", "lyrics.txt")), "the last change came over in the final copy");
    const ls = await until(() => winB.evaluate(() => localStorage.getItem("cu-rig") && { rig: localStorage.getItem("cu-rig"), slides: localStorage.getItem("cu-slides"), font: localStorage.getItem("cu-fontSize") }), 15000, "B's window");
    assert.ok(/Wash 1/.test(ls.rig) && /Welcome/.test(ls.slides) && ls.font !== "31", JSON.stringify(ls));
    const cfgB = JSON.parse(fs.readFileSync(path.join(dirB, "cu.json"), "utf8"));
    assert.ok(cfgB.role === "main" && cfgB.mainKeys.pin === keysA.pin && cfgB.mainKeys.pair === keysA.pair && !cfgB.standby, JSON.stringify({ role: cfgB.role, keys: cfgB.mainKeys }));
  });
  await check("the old hub (A) stepped down: an admin computer, kept in sync with B", async () => {
    const cfgA = await until(() => { const c = JSON.parse(fs.readFileSync(path.join(dirA, "cu.json"), "utf8")); return c.role === "admin" && c.standby && c.standby.host && c.standby.port === 18196 && c; }, 15000, "A's settings");
    await until(() => winA.evaluate(() => window.CU.center.status().then((s) => !s.on)), 10000, "A's center stops");
    await until(() => winA.evaluate(() => window.CU.standby.status().then((s) => s.on && s.ok && s.files >= 3)), 20000, "A copies from B");
  });
  await check("the new hub knows everyone: A as an admin, B as the main admin, same pairing PIN", async () => {
    const cj = JSON.parse(fs.readFileSync(path.join(dirB, "center.json"), "utf8"));
    assert.ok(cj.main.id === idB && cj.pair === keysA.pair && cj.gen === 2 && Object.values(cj.devices).some((d) => d.role === "admin" && d.name) && cj.standby, JSON.stringify({ main: cj.main.id, gen: cj.gen }));
  });
} finally { await appA.close().catch(() => { }); await appB.close().catch(() => { }); }
console.log(failures ? "\n" + failures + " HUB APP CHECK(S) FAILED" : "\nALL HUB APP CHECKS PASSED");
process.exit(failures ? 1 : 0);
