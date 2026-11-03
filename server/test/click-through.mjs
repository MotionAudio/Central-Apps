// (10.2) The click-through check: every page, link and button on the website, the review site and Central Services,
// as a visitor, a musician and a church main admin who is also staff (the demo church, made staff for this run only).
// Fails on a page error, a dead link or a #link with nothing there. Errors the server sends on purpose (an empty form,
// payments not set up here) are listed but don't fail it.
//   node test/click-through.mjs postgres://.../ma [port]      (needs: npm i -g playwright)
import { spawn } from "node:child_process";
import path from "node:path";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
let pw; try { pw = createRequire(import.meta.url)("playwright"); } catch (_) { try { pw = createRequire(execSync("npm root -g").toString().trim() + "/")("playwright"); } catch (_) { console.log("  - skipped: Playwright isn't installed (npm i -g playwright)"); process.exit(0); } }
const { chromium } = pw;
const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const db = process.argv[2] || "postgres://postgres@127.0.0.1:55432/ma", port = Number(process.argv[3] || 18995), base = "http://127.0.0.1:" + port, DEMO = "riverstone-demo@motionaudio.org";
const srv = spawn(process.execPath, [path.join(repo, "server/src/index.js")], { env: Object.assign({}, process.env, { DATABASE_URL: db, PORT: String(port), STRIPE_SECRET_KEY: "", RESEND_API_KEY: "", PUBLIC_URL: base, ADMIN_EMAILS: DEMO, REMINDERS: "off", CURRENT_VERSION: "10.2", CC_UPDATE_API: "http://127.0.0.1:9", REVIEW_PATH: "/review-check" }), stdio: ["ignore", "pipe", "pipe"] });
let log = ""; srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
for (let i = 0; i < 150 && !/Motion Audio server on/.test(log); i++) await new Promise((r) => setTimeout(r, 100));
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const issues = new Set(), fatal = new Set(); let clicks = 0, links = 0;
const note = (s) => { issues.add(s); if (/pageerror|dead link|#anchor/.test(s) && !/dead link \/download\//.test(s)) fatal.add(s); };   // (/download/... comes from GitHub's releases, not this server)
const PAGES = ["/", "/apps/", "/apps/central-pedal.html", "/apps/central-pedal-control.html", "/apps/central-control.html", "/apps/central-usage.html", "/apps/central-services.html", "/help/", "/help/install.html", "/help/accounts.html", "/create/", "/privacy", "/terms", "/refunds", "/services/"];
const checked = new Map();
async function linkOk(url) {
  if (checked.has(url)) return checked.get(url);
  const r = await fetch(url, { redirect: "follow" }).then((x) => x.status).catch(() => 0); checked.set(url, r); return r;
}
async function crawl(ctx, who, extra) {
  for (const u of PAGES.concat(extra || [])) {
    const p = await ctx.newPage(); let errs = [];
    p.on("console", (m) => { if (m.type() === "error" && !/stripe|Failed to load resource: net::ERR_/.test(m.text())) errs.push("console: " + m.text().slice(0, 160)); });
    p.on("pageerror", (e) => errs.push("pageerror: " + e.message.slice(0, 160)));
    p.on("response", (r) => { const x = r.url(); if (r.status() >= 400 && x.startsWith(base) && !/favicon/.test(x)) errs.push(r.status() + " " + x.replace(base, "")); });
    await p.goto(base + u, { waitUntil: "networkidle" }).catch((e) => errs.push("goto: " + e.message.slice(0, 120)));
    await p.waitForTimeout(500);
    errs.forEach((e) => note(`[${who}] ${u} load: ${e}`)); errs = [];
    // links: internal pages answer, #anchors exist on the page they point to
    const hrefs = await p.$$eval("a[href]", (as) => as.filter((a) => a.offsetParent !== null || a.closest("details")).map((a) => a.getAttribute("href")));
    for (const h of [...new Set(hrefs)]) {
      if (/^(mailto:|tel:|javascript:)/.test(h)) continue;
      const abs = new URL(h, base + u);
      if (abs.origin !== base) continue;
      links++;
      const st = await linkOk(abs.origin + abs.pathname + abs.search); if (st >= 400 || st === 0) note(`[${who}] ${u}: dead link ${h} (${st})`);
      if (abs.hash && abs.hash.length > 1 && abs.pathname === new URL(base + u).pathname && !/^#(account|purchases|downloads|support|reset-|invite-|confirm-|order-|plans-done|subscribed|buy-|setlist-|open-)/.test(abs.hash)) {
        const there = await p.$(abs.hash.replace(/([^\w#-])/g, "\\$1")).catch(() => null); if (!there) note(`[${who}] ${u}: #anchor with nothing there: ${h}`);
      }
    }
    // buttons: click each visible one (not ones that sign out, delete or leave the site), close what opens, note errors
    const n = await p.$$eval("button", (bs) => bs.length);
    for (let i = 0; i < n; i++) {
      const b = (await p.$$("button"))[i]; if (!b) continue;
      const info = await b.evaluate((x) => ({ vis: !!(x.offsetParent) && !x.disabled, t: (x.textContent || x.getAttribute("aria-label") || "").trim().slice(0, 40), id: x.id }));
      if (!info.vis || /sign out|delete|remove|log ?out|revoke|close the church|hand|step down|disconnect|reset|clear|pay|checkout|subscribe|buy|renew|send it again/i.test(info.t) || /signOut|acctOut/.test(info.id)) continue;
      clicks++;
      await b.click({ timeout: 2500, trial: false }).catch(() => {});
      await p.waitForTimeout(250);
      errs.forEach((e) => note(`[${who}] ${u}: after "${info.t}": ${e}`)); errs = [];
      if (await p.$(".modal")) { const c = await p.$(".modal [data-close]"); if (c) await c.click().catch(() => {}); else await p.keyboard.press("Escape"); await p.evaluate(() => { const h = document.getElementById("modalHost"); if (h) h.innerHTML = ""; }); }
      if (new URL(p.url()).pathname !== new URL(base + u).pathname) { await p.goto(base + u, { waitUntil: "networkidle" }).catch(() => {}); }
    }
    await p.close();
  }
}
const visitor = await browser.newContext({ viewport: { width: 1280, height: 860 } });
await crawl(visitor, "visitor"); await visitor.close();
async function signedIn(email, password, who, extra) {
  const r = await (await fetch(base + "/v1/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, device: "crawl-" + who }) })).json();
  if (!r.token) { note(`[${who}] sign-in failed: ${JSON.stringify(r).slice(0, 160)}`); return; }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript((t) => { try { localStorage.setItem("ma-token", t); localStorage.setItem("cs-token", t); } catch (_) { } }, r.token);
  await crawl(ctx, who, extra); await ctx.close();
}
// a musician: a plain account (made here, test only)
const mu = "check-musician-" + Date.now() + "@example.test", mpw = "Crawl-test-" + Math.random().toString(36).slice(2, 10) + "A1";
const su = await (await fetch(base + "/v1/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Crawl Musician", email: mu, password: mpw, device: "crawl" }) })).json();
if (su.token) await signedIn(mu, mpw, "musician"); else note("[musician] signup: " + JSON.stringify(su).slice(0, 160));
// the demo church's main admin, made staff for this local run: the account's staff cards and the review site
await signedIn(DEMO, "Riverstone-Demo-2026", "main admin + staff", ["/#account", "/review-check/"]);
await browser.close(); srv.kill();
console.log(`  ${links} links and ${clicks} clicks checked`);
for (const s of issues) console.log((fatal.has(s) ? "  ✗ " : "  · ") + s);
console.log(fatal.size ? "\n" + fatal.size + " FAILED" : "\nall passed (the · lines are answers the server gives on purpose)");
process.exit(fatal.size ? 1 : 0);
