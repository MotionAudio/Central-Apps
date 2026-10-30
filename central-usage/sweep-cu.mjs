// QA sweep (10.0): the real Central Control / Central Usage (Electron) against a simulated Central Pedal with a song.
// For each setup (main admin with every job, an admin with one job, User 1, User 2, a phone browser, and the first-run
// windows) it opens every tab at three window sizes, screenshots it, clicks every visible control, and records page
// errors, console errors, controls that change nothing and controls something else covers.
//   SHOTS=/tmp/cu-shots ONLY="main-all,user1" CLICK=1 xvfb-run -a node sweep-cu.mjs
import { chromium, _electron as electron } from "playwright";
import { spawn } from "node:child_process"; import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, "..");
const shots = process.env.SHOTS || "/tmp/cu-shots"; fs.mkdirSync(shots, { recursive: true });
const ONLY = (process.env.ONLY || "").split(",").filter(Boolean), CLICK = process.env.CLICK !== "0";
const SIZES = (process.env.SIZES || "1920x1080,1366x768").split(",").map((s) => s.split("x").map(Number));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cu-sweep-")); fs.mkdirSync(path.join(tmp, "media"), { recursive: true }); fs.writeFileSync(path.join(tmp, "code-chosen"), "1");
const drv = spawn("python3", [path.join(root, "pedal-driver.py"), "--simulate", tmp, "--app-root", root], { stdio: ["pipe", "pipe", "pipe"] });
let log = ""; drv.stderr.on("data", (b) => { log += b; }); drv.stdout.on("data", (b) => { log += b; });
await new Promise((r) => { const t = setInterval(() => { if (log.includes("USB/SD browser on")) { clearInterval(t); r(); } }, 100); setTimeout(r, 10000); });
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
await pi.evaluate(() => { PPTracks.setTracksMode(true); PPTracks.sendDisplay(); });

const exe = [process.env.ELECTRON_PATH, path.join(here, "node_modules", "electron", "dist", "electron")].filter((p) => p && fs.existsSync(p))[0];
const pkgFile = path.join(here, "package.json"), pkg0 = fs.readFileSync(pkgFile, "utf8");
const report = { errors: [], dead: [], obscured: [], dialogs: [], overflow: [], skipped: 0, ok: 0, shots: [] };
const SKIPSEL = /data-sl="add"|data-mx-file|data-mx-rec="folder"|data-io="recs"|data-st="ai-download"|data-ls="del"|data-o="del"|data-ff="del"|data-sl-del|data-st="updates"|lxRigSave|lxRigOpen|lxLibImport|findBtn|data-lic="release"|data-st="quit"|data-sd="export"|data-sd="import"|data-ctl="export"|data-ctl="import"|data-studio="export|data-studio="open"|data-studio="save"|type="file"/;

const CONFIGS = [
  { name: "main-all", edition: "control", key: "ADEF-AULT-KEY0-2026", kind: "A", cfg: { role: "main", jobs: ["general"], jobsV: 2, jobsAt: 1, name: "Sound desk", host: { enabled: true, port: 18095, userCode: "1111", adminCode: "2222" }, recordDir: "" } },
  { name: "admin-lights", edition: "control", key: "ADEF-AULT-KEY0-2026", kind: "A", cfg: { role: "admin", jobs: ["lights"], jobsV: 2, jobsAt: 1, name: "Lights" } },
  { name: "admin-lyrics-slides", edition: "control", key: "ADEF-AULT-KEY0-2026", kind: "A", cfg: { role: "admin", jobs: ["lyrics", "slides"], jobsV: 2, jobsAt: 1, name: "Words" } },
  { name: "user1", edition: "usage", key: "UDEF-AULT-KEY0-2026", kind: "U", cfg: { role: "user1", name: "Keys" } },
  { name: "user2", edition: "usage", key: "UDEF-AULT-KEY0-2026", kind: "U", cfg: { role: "user2", name: "Vocal stand" } },
  { name: "fresh-control", edition: "control", fresh: true },
  { name: "fresh-usage", edition: "usage", fresh: true },
];
const pageVisible = () => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden" && !el.closest("[hidden]") && !el.closest("dialog:not([open])"); };
  const out = [];
  // text that's cut off or spills sideways
  document.querySelectorAll("button, label, h1, h2, h3, h4, th, td, .muted, p, span, b").forEach((el) => { if (!vis(el)) return; const cs = getComputedStyle(el); if (el.scrollWidth > el.clientWidth + 2 && cs.overflowX !== "visible" && cs.textOverflow !== "ellipsis" && el.clientWidth > 0 && !el.closest("pre,code,.scroll,[data-scrollx]")) out.push((el.id ? "#" + el.id : el.tagName.toLowerCase() + "." + (el.className || "").toString().split(" ")[0]) + " «" + el.textContent.trim().slice(0, 40) + "»"); });
  if (document.documentElement.scrollWidth > innerWidth + 2) out.push("PAGE scrolls sideways: " + document.documentElement.scrollWidth + " > " + innerWidth);
  return out.slice(0, 12);
};
async function run(c) {
  if (ONLY.length && !ONLY.includes(c.name)) return;
  const pkg = JSON.parse(pkg0); if (c.edition === "usage") pkg.edition = "usage"; else delete pkg.edition; fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "cu-ud-"));
  if (c.cfg) fs.writeFileSync(path.join(userData, "cu.json"), JSON.stringify(c.cfg));
  fs.writeFileSync(path.join(userData, "mixer.json"), JSON.stringify({ device: { backend: "internal" } }));
  const app = await electron.launch({ executablePath: exe, args: [path.join(here, "main.js"), "--no-sandbox", "--user-data-dir=" + userData], env: Object.assign({}, process.env, { CU_CENTER_PORT: "18095", CU_NO_BEACON: "1", CC_UPDATE_API: "http://127.0.0.1:9" }) });
  const win = await app.firstWindow();
  let cur = c.name + " start";
  win.on("pageerror", (e) => report.errors.push({ where: cur, err: String(e).slice(0, 300) }));
  win.on("console", (m) => { if (m.type() === "error" && !/favicon|NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED|padpedal\.local|127\.0\.0\.1:9\b|Failed to load resource/.test(m.text())) report.errors.push({ where: cur, err: m.text().slice(0, 300) }); });
  win.on("dialog", async (d) => { report.dialogs.push({ where: cur, type: d.type(), msg: d.message().slice(0, 160) }); await d.dismiss().catch(() => {}); });
  await win.waitForFunction(() => window.CentralUsage && window.CU, null, { timeout: 20000 });
  const setSize = async (s) => { await app.evaluate(({ BrowserWindow }, s) => { const all = BrowserWindow.getAllWindows(), w = all.find((x) => /app\/index\.html/.test(x.webContents.getURL())) || all[0]; if (w.isFullScreen()) w.setFullScreen(false); w.unmaximize(); w.setSize(s[0], s[1]); }, s); await win.waitForTimeout(350); };
  const shot = async (n) => { const f = path.join(shots, n.replace(/[^\w.-]+/g, "_") + ".png"); await win.screenshot({ path: f }); report.shots.push(f); const o = await win.evaluate(pageVisible).catch(() => []); if (o.length) report.overflow.push({ where: n, items: o }); };
  if (c.fresh) {
    for (const s of SIZES) { await setSize(s); await win.waitForTimeout(800); await shot(c.name + "-key-" + s[0]); }
    // the key window: name and the default key, then the role / jobs steps
    await win.waitForSelector("#lwProd, #lwKey", { timeout: 10000 }).catch(() => {});
    if (await win.$("#lwProd")) { await win.fill("#lwProd", "Riverstone Church"); await win.click('#licWiz [data-lw="prod"]'); }
    await win.waitForSelector("#lwKey", { timeout: 5000 }).catch(() => {});
    if (await win.$("#lwKey")) { await win.fill("#lwKey", c.edition === "usage" ? "UDEF-AULT-KEY0-2026" : "ADEF-AULT-KEY0-2026"); await win.click('#licWiz [data-lw="key"]'); }
    await win.waitForTimeout(1500);
    for (const s of SIZES) { await setSize(s); await shot(c.name + "-roles-" + s[0]); }
    if (c.edition === "control" && await win.$('[data-rp="admin"]')) {
      await win.click('[data-rp="admin"]'); await win.waitForTimeout(600); for (const s of SIZES) { await setSize(s); await shot(c.name + "-admin-next-" + s[0]); }
      await win.click('[data-rp="back"]').catch(() => {}); await win.waitForTimeout(300);
      await win.click('[data-rp="main"]').catch(() => {}); await win.waitForTimeout(600); await shot(c.name + "-main-next");
      const jobsBtn = await win.$('[data-rp="jobsAll"]:visible'); if (jobsBtn) { await jobsBtn.click(); await win.waitForTimeout(500); await shot(c.name + "-main-after-jobs"); }
      const io = await win.$('[data-rp="ioSkip"]:visible'); if (io) { await io.click(); await win.waitForTimeout(400); await shot(c.name + "-main-pins"); }
    } else if (await win.$('[data-rp="user1"]')) { await win.click('[data-rp="user1"]'); await win.waitForTimeout(600); for (const s of SIZES) { await setSize(s); await shot(c.name + "-user1-next-" + s[0]); } }
    await app.close(); return;
  }
  // the key, then reload so the app starts as this setup
  await win.evaluate((k) => { localStorage.setItem("cc-license", JSON.stringify({ key: k.key, kind: k.kind, app: k.edition, church: "Riverstone Church (demo)", production: "Riverstone Church (demo)", okAt: Date.now(), recheckDays: 30, isDefault: true })); localStorage.setItem("cu-host", JSON.stringify("127.0.0.1")); localStorage.setItem("cu-code", JSON.stringify(k.code)); }, Object.assign({ code }, c));
  await win.reload(); await win.waitForFunction(() => window.CentralUsage && window.CU, null, { timeout: 20000 }); await win.waitForTimeout(1500);
  await win.evaluate(() => CentralUsage.connect("127.0.0.1")).catch(() => {});
  await win.waitForFunction(() => CentralUsage.state.connected, null, { timeout: 10000 }).catch(() => report.errors.push({ where: c.name, err: "never connected to the simulated pedal" }));
  await win.evaluate((cd) => { CentralUsage.prefs.code = cd; CentralUsage.send({ type: "auth", code: cd }); }, code).catch(() => {});
  await win.waitForTimeout(1200);
  const tabs = await win.evaluate(() => [...document.querySelectorAll("#tabs [data-tab]")].filter((b) => !b.hidden).map((b) => b.dataset.tab));
  report.dialogs.push({ where: c.name, type: "tabs", msg: tabs.join(",") });
  const enter = async (t) => { await win.evaluate((t) => { document.querySelectorAll("dialog[open]").forEach((d) => d.close()); document.querySelectorAll(".mode-pick").forEach((d) => d.remove()); const b = document.querySelector('[data-tab="' + t + '"]'); if (b) b.click(); }, t); await win.waitForTimeout(450); };
  const subs = { lights: ["show", "songs", "looks", "fixtures", "output"] };
  for (const s of SIZES) {
    await setSize(s);
    for (const t of tabs) {
      await enter(t); cur = c.name + " " + t + " " + s[0]; await shot(c.name + "-" + t + "-" + s[0]);
      if (subs[t] && await win.evaluate(() => !!(window.CULights && CULights.showSub))) for (const sub of subs[t]) { await win.evaluate((v) => CULights.showSub(v), sub); await win.waitForTimeout(300); await shot(c.name + "-" + t + "-" + sub + "-" + s[0]); }
    }
  }
  if (CLICK) {
    await setSize(SIZES[SIZES.length - 1]);
    for (const t of tabs) {
      const views = subs[t] ? subs[t] : [null];
      for (const sub of views) {
        const go = async () => { await enter(t); if (sub) { await win.evaluate((v) => CULights.showSub(v), sub); await win.waitForTimeout(200); } };
        await go();
        const list = await win.evaluate(() => {
          const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden" && !el.closest("[hidden]") && !el.closest("dialog:not([open])"); };
          const sel = (el) => { if (el.id) return "#" + CSS.escape(el.id); const parts = []; while (el && el.nodeType === 1 && el !== document.body) { let i = 1, s = el; while ((s = s.previousElementSibling)) if (s.tagName === el.tagName) i++; parts.unshift(el.tagName.toLowerCase() + ":nth-of-type(" + i + ")"); if (el.parentElement && el.parentElement.id) { parts.unshift("#" + CSS.escape(el.parentElement.id)); break; } el = el.parentElement; } return parts.join(" > "); };
          return [...document.querySelectorAll("main button, main select, main input[type=checkbox], main input[type=radio], main input[type=range], section button, section select, section input[type=checkbox], section input[type=range]")].filter((el) => vis(el) && !el.disabled && !el.closest("#tabs")).map((el) => ({ sel: sel(el), tag: el.tagName.toLowerCase(), type: el.type, label: (el.textContent || el.title || el.getAttribute("aria-label") || el.id || el.name || "").trim().slice(0, 50), html: el.outerHTML.slice(0, 240) }));
        });
        for (const ctl of list) {
          if (SKIPSEL.test(ctl.html)) { report.skipped++; continue; }
          cur = c.name + " " + t + (sub ? "/" + sub : "") + " → " + (ctl.label || ctl.sel);
          await win.evaluate(() => { window.__mut = 0; if (!window.__mo) { window.__mo = new MutationObserver((l) => { window.__mut += l.length; }); window.__mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true }); } });
          try {
            const loc = win.locator(ctl.sel).first();
            if (ctl.tag === "select") { const opts = await loc.evaluate((s) => [...s.options].filter((o) => !o.disabled).map((o) => o.value)); const now = await loc.inputValue(); const other = opts.find((o) => o !== now); if (other == null) { report.ok++; continue; } await loc.selectOption(other, { timeout: 2000 }); }
            else if (ctl.type === "range") { await loc.evaluate((r) => { r.value = String((Number(r.min || 0) + Number(r.max || 100)) / 2 + Number(r.step || 1)); r.dispatchEvent(new Event("input", { bubbles: true })); r.dispatchEvent(new Event("change", { bubbles: true })); }); }
            else await loc.click({ timeout: 2000 });
          } catch (e) { (/intercepts pointer|not visible|outside of the viewport|Timeout|not attached/.test(e.message) ? report.obscured : report.errors).push({ where: cur, err: e.message.split("\n")[0].slice(0, 160) }); await win.keyboard.press("Escape").catch(() => {}); await go(); continue; }
          await win.waitForTimeout(220);
          const after = await win.evaluate(() => window.__mut).catch(() => 1);
          if (!after) report.dead.push(cur); else report.ok++;
          await win.keyboard.press("Escape").catch(() => {});
          await go();
        }
      }
    }
  }
  await app.close().catch(() => {});
}
for (const c of CONFIGS) { try { await run(c); } catch (e) { report.errors.push({ where: c.name, err: "sweep stopped: " + String(e).slice(0, 300) }); } }
fs.writeFileSync(pkgFile, pkg0);
// a phone browser: Central Usage from the pedal (http://<pi>:8080/cu/)
if (!ONLY.length || ONLY.includes("phone")) {
  const ph = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
  const errs = (e) => report.errors.push({ where: "phone", err: String(e).slice(0, 300) }); ph.on("pageerror", errs);
  await ph.addInitScript(() => { try { localStorage.setItem("cu-role", JSON.stringify("user1")); localStorage.setItem("cu-mode", JSON.stringify("user")); localStorage.setItem("cc-license", JSON.stringify({ key: "UDEF-AULT-KEY0-2026", kind: "U", app: "usage", production: "Riverstone Church (demo)", okAt: Date.now(), recheckDays: 30, isDefault: true })); } catch (_) { } });
  await ph.goto("http://127.0.0.1:8080/cu/").catch((e) => errs(e)); await ph.waitForTimeout(2500);
  await ph.evaluate((cd) => { try { CentralUsage.prefs.code = cd; CentralUsage.send({ type: "auth", code: cd }); } catch (_) { } }, code).catch(() => {});
  await ph.waitForTimeout(800);
  const tabs = await ph.evaluate(() => [...document.querySelectorAll("#tabs [data-tab]")].filter((b) => !b.hidden).map((b) => b.dataset.tab)).catch(() => []);
  report.dialogs.push({ where: "phone", type: "tabs", msg: tabs.join(",") });
  for (const t of tabs) { await ph.evaluate((t) => { document.querySelectorAll("dialog[open]").forEach((d) => d.close()); document.querySelector('[data-tab="' + t + '"]').click(); }, t); await ph.waitForTimeout(500); const f = path.join(shots, "phone-" + t + ".png"); await ph.screenshot({ path: f, fullPage: true }); report.shots.push(f); const o = await ph.evaluate(pageVisible).catch(() => []); if (o.length) report.overflow.push({ where: "phone " + t, items: o }); }
  await ph.screenshot({ path: path.join(shots, "phone-first.png") });
}
fs.writeFileSync(path.join(shots, "report.json"), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ errors: report.errors.length, dead: report.dead.length, obscured: report.obscured.length, dialogs: report.dialogs.length, overflow: report.overflow.length, ok: report.ok, skipped: report.skipped, shots: report.shots.length }));
await b.close(); drv.kill(); process.exit(0);
