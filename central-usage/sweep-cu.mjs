// QA sweep: the real Central Control (Electron) connected to a simulated Central Pedal with a song.
// Clicks every visible control in every view, records errors, dialogs, and controls that change nothing.
import { chromium, _electron as electron } from "playwright";
import { spawn } from "node:child_process"; import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, "..");
const shots = process.env.SHOTS || "/tmp/cu-shots"; fs.mkdirSync(shots, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cu-sweep-")); fs.mkdirSync(path.join(tmp, "media"), { recursive: true });
const drv = spawn("python3", [path.join(root, "pedal-driver.py"), "--simulate", tmp, "--app-root", root], { stdio: ["pipe", "pipe", "pipe"] });
let log = ""; drv.stderr.on("data", (b) => { log += b; }); drv.stdout.on("data", (b) => { log += b; });
await new Promise((r) => { const t = setInterval(() => { if (log.includes("listening on ws")) { clearInterval(t); r(); } }, 100); setTimeout(r, 10000); });
const code = fs.readFileSync(path.join(tmp, "code"), "utf8").trim();
// the Pi app with a song, a track and a chart
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--autoplay-policy=no-user-gesture-required"] });
const pi = await (await b.newContext()).newPage();
await pi.goto("http://127.0.0.1:8766/app/#tracks"); await pi.waitForFunction(() => window.PPTracks && window.PPShell); await pi.waitForTimeout(600);
await pi.evaluate(async () => {
  PPTracks.newSong("Way Maker"); PPFeatures.loadSong(PP.project().songs.length - 1);
  const rate = 22050, n = rate * 30, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf); const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) { const t = i / rate, ph = t % 0.5; v.setInt16(44 + i * 2, Math.round(8000 * Math.sin(2 * Math.PI * 196 * t) + (ph < 0.03 ? 12000 * Math.exp(-ph * 80) : 0)), true); }
  await PPTracks.importFilesIntoSong(PPTracks.song(), [new File([buf], "Keys.wav", { type: "audio/wav" })], { analyze: true });
});
const chart = "Way Maker\n{key: E}\n\n[Verse 1]\nE        B\nYou are here moving in our midst\nC#m       A\nI worship You I worship You\n\n[Chorus]\nE           B\nWay maker miracle worker\nC#m             A\nPromise keeper light in the darkness\n\n[Bridge]\nA     E\nEven when I don't see it You're working\n";
await fetch("http://127.0.0.1:8080/api/upload?kind=charts&name=Way%20Maker.txt&song=Way%20Maker", { method: "POST", body: chart });
await pi.waitForFunction(() => PPTracks.song() && PPTracks.song().chart, null, { timeout: 10000 }).catch(() => {});
await pi.evaluate(() => { PPTracks.setTracksMode(true); PPTracks.sendDisplay(); PPNetSend.configure({ mode: "ethernet" }); });

const exe = path.join(here, "node_modules", "electron", "dist", "electron");
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "cu-ud-"));
fs.writeFileSync(path.join(userData, "cu.json"), JSON.stringify({ mode: "admin", name: "Desk", host: { enabled: true, port: 18095, userCode: "1111", adminCode: "2222" }, piAudio: { transport: "ethernet", latency: 80 }, recordDir: path.join(userData, "rec") }));
fs.writeFileSync(path.join(userData, "mixer.json"), JSON.stringify({ device: { backend: "internal" } }));
const app = await electron.launch({ executablePath: exe, args: [path.join(here, "main.js"), "--no-sandbox", "--user-data-dir=" + userData] });
const win = await app.firstWindow();
const report = { errors: [], dead: [], obscured: [], dialogs: [], skipped: [], ok: 0 };
win.on("pageerror", (e) => report.errors.push({ where: cur, err: String(e) }));
win.on("console", (m) => { if (m.type() === "error" && !/favicon|NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED|padpedal\.local/.test(m.text())) report.errors.push({ where: cur, err: m.text() }); });
win.on("dialog", async (d) => { report.dialogs.push({ where: cur, type: d.type(), msg: d.message().slice(0, 120) }); await d.dismiss().catch(() => {}); });
let cur = "start";
await win.waitForFunction(() => window.CentralUsage && window.CULights);
await win.evaluate(() => CentralUsage.connect("127.0.0.1"));
await win.waitForFunction(() => CentralUsage.state.connected && CentralUsage.state.display, null, { timeout: 10000 });
await win.evaluate((c) => { CentralUsage.prefs.code = c; CentralUsage.send({ type: "auth", code: c }); }, code);
await win.waitForTimeout(800);

const SKIP = new Set(["lxRigSave", "lxRigOpen", "lxLibImport", "findBtn"]);   // native file dialogs / a 254-address network scan
const SKIPSEL = /data-sl="add"|data-mx-file|data-mx-rec="folder"|data-io="recs"|data-st="ai-download"|data-ls="del"|data-o="del"|data-ff="del"|data-sl-del|data-st="updates"/;   // native file dialogs / a 254-address network scan
async function sweep(name, enter) {
  cur = name; await enter(); await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(shots, name.replace(/\W+/g, "_") + ".png") });
  const list = await win.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden" && !el.closest("[hidden]") && !el.closest("dialog:not([open])"); };
    const path = (el) => { if (el.id) return "#" + CSS.escape(el.id); const parts = []; while (el && el.nodeType === 1 && el !== document.body) { let i = 1, s = el; while ((s = s.previousElementSibling)) if (s.tagName === el.tagName) i++; parts.unshift(el.tagName.toLowerCase() + ":nth-of-type(" + i + ")"); if (el.parentElement && el.parentElement.id) { parts.unshift("#" + CSS.escape(el.parentElement.id)); break; } el = el.parentElement; } return parts.join(" > "); };
    return [...document.querySelectorAll("button, select, input[type=checkbox], input[type=radio], input[type=range]")].filter((el) => vis(el) && !el.disabled).map((el) => ({ sel: path(el), tag: el.tagName.toLowerCase(), type: el.type, id: el.id, label: (el.textContent || el.title || el.getAttribute("aria-label") || el.id || el.name || "").trim().slice(0, 50), html: el.outerHTML.slice(0, 200) }));
  });
  for (const c of list) {
    if (SKIP.has(c.id) || SKIPSEL.test(c.html || "")) { report.skipped.push(name + ": " + (c.label || c.id)); continue; }
    cur = name + " → " + (c.label || c.sel);
    const before = await win.evaluate(() => { window.__mut = 0; if (!window.__mo) { window.__mo = new MutationObserver((l) => { window.__mut += l.length; }); window.__mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true }); } return { status: document.title }; });
    const ipc0 = await app.evaluate(() => 0);
    try {
      const loc = win.locator(c.sel).first();
      if (c.tag === "select") { const opts = await loc.evaluate((s) => [...s.options].map((o) => o.value)); const now = await loc.inputValue(); const other = opts.find((o) => o !== now); if (other == null) { report.ok++; continue; } await loc.selectOption(other, { timeout: 2000 }); }
      else if (c.type === "range") { await loc.evaluate((r) => { r.value = String((Number(r.min || 0) + Number(r.max || 100)) / 2 + Number(r.step || 1)); r.dispatchEvent(new Event("input", { bubbles: true })); r.dispatchEvent(new Event("change", { bubbles: true })); }); }
      else await loc.click({ timeout: 2000 });
    } catch (e) { (/intercepts pointer|not visible|outside of the viewport|Timeout/.test(e.message) ? report.obscured : report.errors).push({ where: cur, err: e.message.split("\n")[0].slice(0, 160) }); await win.keyboard.press("Escape").catch(() => {}); continue; }
    await win.waitForTimeout(250);
    const after = await win.evaluate(() => window.__mut);
    if (!after) report.dead.push(cur); else report.ok++;
    await win.keyboard.press("Escape").catch(() => {});
    // put things back where the sweep expects them
    await enter(); await win.waitForTimeout(120);
  }
  fs.writeFileSync(path.join(shots, "report.json"), JSON.stringify(report, null, 1));
}
const tab = (t) => async () => { await win.evaluate((t) => { document.querySelectorAll("dialog[open]").forEach((d) => d.close()); document.querySelector('[data-tab="' + t + '"]').click(); }, t); };
const lx = (v) => async () => { await tab("lights")(); await win.evaluate((v) => CULights.showSub(v), v); };
for (const size of [[1366, 768]]) {
  await app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].setSize(s[0], s[1]), size);
  await win.waitForFunction(() => window.CUMix && CUMix.state && CUMix.pi.length > 0, null, { timeout: 15000 }).catch(() => report.errors.push({ where: "setup", err: "no Central Pedal audio" }));
  await pi.evaluate(() => PPTracks.play({ countIn: false }));
  await sweep("admin-mix", tab("mix"));
  await sweep("admin-inears", tab("inears"));
  await sweep("admin-slides", tab("slides"));
  await sweep("admin-io", tab("io"));
  await sweep("admin-settings", tab("settings"));
  await sweep("admin-lyrics", tab("lyrics"));
  await sweep("lights-show", lx("show"));
  await pi.evaluate(() => PPTracks.pause());
  await sweep("lights-songs", lx("songs"));
  await sweep("lights-looks", lx("looks"));
  await sweep("lights-fixtures", lx("fixtures"));
  await sweep("lights-output", lx("output"));
  await win.evaluate(() => CentralUsage.setMode("user")); await win.waitForTimeout(500);
  await win.evaluate(() => { CentralUsage.store.set("userCode", "1111"); });
  await sweep("user-chart", tab("chart"));
  await sweep("user-inears", tab("inears"));
  await sweep("user-lyrics", tab("lyrics"));
  await sweep("user-io", tab("io"));
  await win.evaluate(() => CentralUsage.setMode("admin")); await win.waitForTimeout(500);
}
// screenshots at a small laptop / big screen
for (const size of [[1024, 640], [1920, 1080]]) {
  await app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].setSize(s[0], s[1]), size);
  for (const [n, f] of [["mix", tab("mix")], ["inears", tab("inears")], ["slides", tab("slides")], ["io", tab("io")], ["show", lx("show")], ["songs", lx("songs")], ["looks", lx("looks")], ["output", lx("output")]]) { await f(); await win.waitForTimeout(400); await win.screenshot({ path: path.join(shots, n + "-" + size[0] + ".png") }); }
}
fs.writeFileSync(path.join(shots, "report.json"), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ errors: report.errors.length, dead: report.dead.length, obscured: report.obscured.length, dialogs: report.dialogs.length, ok: report.ok }, null, 0));
await app.close(); await b.close(); drv.kill(); process.exit(0);
