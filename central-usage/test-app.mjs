// Central Usage as the real Electron app: the phone remote's web server, the update check against a
// stand-in GitHub, the checksum guard of the updater, and the fixture library IPC.
//   npm install && xvfb-run -a node test-app.mjs      (needs a display: Xvfb is fine)
import { _electron as electron } from "playwright";
import http from "node:http"; import crypto from "node:crypto"; import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert";
import { createRequire } from "node:module"; import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url)), require = createRequire(import.meta.url);
let failures = 0; async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e && e.message || e).split("\n").slice(0, 6).join("\n      ")); } }

// a stand-in for api.github.com + its download host
const deb = Buffer.from("!<arch>\nfake central-usage 2.4.0 package\n"), appimg = Buffer.from("\x7fELF fake appimage");
const sums = ["central-usage-2.4.0-amd64.deb", "central-usage-2.4.0-x86_64.AppImage"].map((n, i) => crypto.createHash("sha256").update(i ? appimg : deb).digest("hex") + "  " + n).join("\n") + "\n";
const gh = http.createServer((req, res) => {
  const base = "http://127.0.0.1:" + gh.address().port, send = (b, type) => { res.writeHead(200, { "Content-Type": type || "application/json" }); res.end(b); };
  if (req.url === "/repos/church/cc/releases/latest") return send(JSON.stringify({ tag_name: "v2.4.0", body: "Lighting remote fixes", assets: [
    { name: "central-usage-2.4.0-amd64.deb", browser_download_url: base + "/dl/deb" }, { name: "central-usage-2.4.0-x86_64.AppImage", browser_download_url: base + "/dl/appimage" },
    { name: "central-control-source.zip", browser_download_url: base + "/dl/zip" }, { name: "SHA256SUMS", browser_download_url: base + "/dl/sums" }] }));
  if (req.url === "/dl/deb") { res.writeHead(302, { Location: base + "/dl/deb2" }); return res.end(); }   // GitHub redirects downloads
  if (req.url === "/dl/deb2") return send(deb, "application/octet-stream");
  if (req.url === "/dl/sums") return send(sums, "text/plain");
  res.writeHead(404); res.end();
});
await new Promise((r) => gh.listen(0, "127.0.0.1", r));
const API = "http://127.0.0.1:" + gh.address().port;
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "cu-app-"));

const exe = [process.env.ELECTRON_PATH, path.join(here, "node_modules", "electron", "dist", "electron")].filter((p) => p && fs.existsSync(p))[0];
const app = await electron.launch({ executablePath: exe, args: [path.join(here, "main.js"), "--no-sandbox", "--user-data-dir=" + userData], env: Object.assign({}, process.env, { CC_UPDATE_API: API }) });
const win = await app.firstWindow();
await win.waitForFunction(() => window.CULights && window.CU && window.CU.remote);

await check("the phone remote: switched on in Lighting → Output, it serves its page and the lights' state with the code, refuses a wrong code", async () => {
  await win.evaluate(() => { document.querySelector('[data-tab="lights"]').click(); CULights.showSub("output"); });
  await win.waitForSelector("#lxRmOn", { timeout: 5000 });
  await win.evaluate(() => { document.querySelector("#lxRmPort").value = "18191"; const on = document.querySelector("#lxRmOn"); on.checked = true; on.dispatchEvent(new Event("change", { bubbles: true })); });
  await win.waitForFunction(() => /18191/.test(document.querySelector("#lxRemote").textContent), null, { timeout: 5000 });
  const pin = await win.evaluate(() => document.querySelector(".lx-pin").textContent);
  const page = await (await fetch("http://127.0.0.1:18191/")).text(); assert.match(page, /Lights remote/);
  let st = null; for (let i = 0; i < 20 && !(st && st.looks && st.looks.length); i++) { await new Promise((r) => setTimeout(r, 200)); st = await (await fetch("http://127.0.0.1:18191/api/state?pin=" + pin)).json(); }
  assert.ok(st.looks.length >= 10 && st.faders.some((f) => f.id === "master"), JSON.stringify(st).slice(0, 200));
  assert.equal((await fetch("http://127.0.0.1:18191/api/state?pin=0000")).status, 403);
  const r = await fetch("http://127.0.0.1:18191/api/cmd?pin=" + pin, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cmd: "look", id: "bridge" }) });
  assert.equal(r.status, 200);
  await win.waitForFunction(() => CULights.live.manual && CULights.live.manual.id === "bridge", null, { timeout: 3000 });
});
await check("updates: with the update source set, a newer Central Usage on the release page is found (and which file fits this computer)", async () => {
  const st = await win.evaluate(async () => { await CU.updates.config({ repo: "https://github.com/church/cc", auto: true }); return CU.updates.check(); });
  assert.equal(st.repo, "church/cc"); assert.equal(st.latest, "2.4.0"); assert.equal(st.available, true, JSON.stringify(st)); assert.equal(st.kind, "deb");
  await win.waitForFunction(() => !document.querySelector("#updBanner").hidden, null, { timeout: 3000 });
});
await check("the updater only accepts a download whose checksum is in SHA256SUMS (redirects followed)", async () => {
  const { Updater } = require("./updater.js");
  const u = new Updater({ product: "central-usage", current: "1.2.0", dir: userData, api: API }); u.save({ repo: "church/cc" }); await u.check();
  const file = await u.download(); assert.deepEqual(fs.readFileSync(file), deb);
  u.latest.assets.SHA256SUMS = API + "/dl/deb2";   // a wrong checksum list
  await assert.rejects(() => u.download(), /SHA256SUMS has no line|checksum/);
});
await check("fixture library: the QLC+ library scan answers (empty when QLC+ is not installed) and reading is limited to scanned files", async () => {
  const r = await win.evaluate(async () => { const list = await CU.fixtures.scan(); const bad = await CU.fixtures.read("/etc/passwd"); return { n: list.length, bad }; });
  assert.ok(r.n >= 0); assert.equal(r.bad, null);
});
await app.close(); gh.close();
console.log(failures ? "\n" + failures + " CHECK(S) FAILED" : "\nALL CENTRAL USAGE APP CHECKS PASSED"); process.exit(failures ? 1 : 0);
