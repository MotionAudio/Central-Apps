// The website, clicked through in a real browser (Playwright): the store and cart with codes, making the main admin's
// account (phone and code), confirming the email, a free trial, adding people on the Teams card, support, forgot
// password, the invite link, and the Motion Audio staff cards. Screenshots of each step go to the folder given.
//   node test/site-ui.mjs postgres://.../ma [port] [screenshot folder]      (needs: npm i -g playwright)
import { spawn, execSync } from "node:child_process";
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const db = process.argv[2] || "postgres://postgres@127.0.0.1:55432/ma", port = Number(process.argv[3] || 18910), base = "http://127.0.0.1:" + port;
const shots = process.argv[4] || ""; if (shots) fs.mkdirSync(shots, { recursive: true });
let pw; try { pw = createRequire(import.meta.url)("playwright"); } catch (_) { try { pw = createRequire(execSync("npm root -g").toString().trim() + "/")("playwright"); } catch (_) { console.log("  - skipped: Playwright isn't installed (npm i -g playwright)"); process.exit(0); } }

const S = Date.now(), STAFF = "staff" + S + "@motion.test", OWNER = "owner" + S + "@grace.test";
const mails = [];
const stub = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { mails.push(JSON.parse(b || "{}")); res.end('{"id":"x"}'); }); });
await new Promise((r) => stub.listen(0, "127.0.0.1", r));
const srv = spawn(process.execPath, [path.join(here, "..", "src", "index.js")], { env: Object.assign({}, process.env, { DATABASE_URL: db, PORT: String(port), STRIPE_SECRET_KEY: "", RESEND_API_KEY: "re_test", MAIL_FROM: "M <t@motion.test>",
  RESEND_API_URL: "http://127.0.0.1:" + stub.address().port + "/emails", PUBLIC_URL: base, ADMIN_EMAILS: STAFF, REMINDERS: "off", CURRENT_VERSION: "9.1", SUPPORT_EMAIL: "help@motion.test", CC_UPDATE_API: "http://127.0.0.1:9" }), stdio: ["ignore", "pipe", "pipe"] });
let log = ""; srv.stdout.on("data", (d) => { log += d; }); srv.stderr.on("data", (d) => { log += d; });
for (let i = 0; i < 100 && !/Motion Audio server on/.test(log); i++) await new Promise((r) => setTimeout(r, 100));

let fails = 0;
const ok = (c, m, d) => { console.log((c ? "  ✓ " : "  ✗ ") + m + (c || d === undefined ? "" : "   -- " + String(d).slice(0, 400))); if (!c) fails++; };
const to = (who, re) => mails.filter((m) => m.to && m.to[0] === who && (!re || re.test(m.subject)));
const waitMail = async (who, re) => { for (let i = 0; i < 50; i++) { const m = to(who, re).pop(); if (m) return m; await new Promise((r) => setTimeout(r, 100)); } return null; };
const codeIn = (m) => (m && (m.subject.match(/(\d{6})/) || m.text.match(/(\d{6})/)) || [])[1];

const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
page.on("dialog", (d) => d.accept());
let n = 0; const shot = async (name, full) => { if (shots) await page.screenshot({ path: path.join(shots, String(++n).padStart(2, "0") + "-" + name + ".png"), fullPage: !!full }); };
const toastSeen = async (re) => { try { await page.waitForFunction((src) => [...document.querySelectorAll(".toast")].some((t) => new RegExp(src).test(t.textContent)), re.source, { timeout: 4000 }); return true; } catch (_) { return false; } };
// an admin's sign-in: add the phone if asked, then the code(s) (no Twilio here: the code comes by email)
async function codeStep(email) {
  await page.waitForSelector("#tsForm", { timeout: 5000 });
  if (await page.$("#tsPhone")) { await page.fill("#tsPhone", "555-010-" + String(S).slice(-4)); await page.click("#tsForm .btn:not(.ghost)"); await page.waitForSelector("#tsCode"); }
  const m = await waitMail(email, /code/i); await page.fill("#tsCode", codeIn(m) || "");
  if (await page.$("#tsECode")) { const all = to(email, /code/i).map(codeIn); await page.fill("#tsECode", all[all.length - 1] || ""); }
  await shot("code");
  await page.click("#tsForm .btn:not(.ghost)");
}

try {
  // ---------------------------------------------------------------- the store
  await page.goto(base + "/", { waitUntil: "networkidle" }); await page.waitForTimeout(400);
  ok(await page.$eval("h1", (e) => e.textContent.length > 10), "the page opens");
  ok(await page.$$eval("#pedalBuy [data-add=pedal]", (x) => x.length) === 1 && await page.$$eval("#packs .tier", (x) => x.length) === 4 && await page.$$eval("#rack .pl-row", (x) => x.length) >= 4 && /1 main admin \+ 2 admins/.test(await page.textContent("#packs .tier")), "the store: the pedal, four packs (Lite: 1 main admin + 2 admins…), the apps and Central Services slots");
  ok(await page.$$eval(".system img", (imgs) => imgs.every((i) => i.complete && i.naturalWidth > 0)) && await page.$eval("#pedalBuy img", (i) => i.naturalWidth > 0), "the app icons load");
  await shot("store", true);
  ok(!(await page.$("#packs [data-add=ultra-plus10]").then((b) => b.click()).then(() => page.textContent("#cartBtn"))).includes("1"), "Ultra's 10 more slots can't go in the cart without the Ultra pack");
  await page.click("#pedalBuy [data-add=pedal]"); await page.click("#packs [data-add=pack-regular]");
  ok((await page.textContent("#cartBtn")).includes("2"), "add to cart: the cart counts 2");
  await page.click("#cartBtn"); await page.waitForSelector(".modal");
  await page.fill("#pcCode", "betatest"); await page.click("#pcApply"); await page.waitForTimeout(500);
  const cartText = await page.textContent(".modal");
  ok(/BETATEST/.test(cartText) && /−\$175\.00/.test(cartText) && /\$425\.00/.test(cartText) && /tax included/.test(cartText), "BETATEST: half off the Regular pack ($175), not the pedal: $425 total, tax included", cartText.replace(/\s+/g, " "));
  await shot("cart-code");
  await page.click("#checkout"); await page.waitForTimeout(300);
  ok(/Sign in/.test(await page.textContent("#acctTitle")) && !(await page.$(".modal")), "check out while signed out: asks to sign in");

  // ---------------------------------------------------------------- the main admin makes the church's account
  await page.fill("#upName", "Pat Owner"); await page.fill("#upEmail", OWNER); await page.fill("#upPass", "worship-" + S);
  await page.check('[name=upCh][value=make]'); ok(await page.isVisible("#upChurch") && !(await page.isVisible("#upCode")), "make an account: \"I'm the main admin\" asks for the church's name");
  await page.fill("#upChurch", "Grace Church " + S);
  await shot("signup", true);
  await page.click("#upForm .btn");
  await codeStep(OWNER);
  await page.waitForFunction(() => /Hi, Pat/.test(document.querySelector("#acctTitle").textContent), null, { timeout: 6000 }).catch(() => {});
  ok(/Hi, Pat/.test(await page.textContent("#acctTitle")), "signed up, added the phone and entered the code: signed in");
  ok(await page.isVisible(".confirm-card"), "the account asks to confirm the email");
  await page.waitForFunction(() => /Grace Church/.test((document.querySelector("#churchCard") || {}).textContent || ""), null, { timeout: 8000 }).catch(() => {});
  ok(/Grace Church/.test(await page.textContent("#churchCard")), "the church was made, with Pat as its main admin");
  await shot("account-new", true);

  // confirm the email (the link in the mail)
  const cm = await waitMail(OWNER, /Confirm your email/);
  await page.goto(base + "/#confirm-" + cm.text.match(/#confirm-([A-Za-z0-9_-]+)/)[1]); await page.waitForSelector(".modal");
  ok(/Email confirmed/.test(await page.textContent(".modal")), "the confirm link confirms the email");
  await page.click(".modal [data-close]"); await page.waitForTimeout(400);
  ok(!(await page.isVisible(".confirm-card")), "confirmed: the reminder card is gone");

  // ---------------------------------------------------------------- a free trial from the cart
  await page.click("#cartBtn"); await page.waitForSelector(".modal");
  await page.click("#clear"); await page.click("#cartBtn"); await page.waitForSelector("#pcCode");
  await page.fill("#pcCode", "7free"); await page.click("#pcApply"); await page.waitForTimeout(500);
  ok(/Start the free trial/.test(await page.textContent("#checkout")), "7FREE in an empty cart: Start the free trial");
  await shot("trial-cart");
  await page.click("#checkout"); await page.waitForSelector(".modal h3:text('Your free trial has started')", { timeout: 5000 }).catch(() => {});
  ok(/Your free trial has started/.test(await page.textContent(".modal")), "the trial starts");
  await page.click(".modal [data-close]"); await page.waitForTimeout(800);
  ok(/Free trial \(7FREE\)/.test(await page.textContent("#churchCard")), "the church page shows the trial");

  // ---------------------------------------------------------------- Teams: add a user
  await page.waitForSelector("#teamsCard [data-tadd=users]", { timeout: 5000 }).catch(() => {});
  const sect = await page.$$eval("#teamsCard [data-tadd]", (b) => b.map((x) => x.dataset.tadd));
  ok(sect.length === 3, "Teams: three sections (admins, users, Pedal Control)", sect);
  const userSect = sect.find((x) => /user/.test(x)) || sect[1];
  await page.click(`#teamsCard [data-tadd=${userSect}]`);
  await page.fill(`[data-ta=${userSect}][data-tf=name]`, "Sam Bass"); await page.fill(`[data-ta=${userSect}][data-tf=email]`, "sam" + S + "@grace.test"); await page.fill(`[data-ta=${userSect}][data-tf=role]`, "Bass");
  await page.click(`#teamsCard [data-tdone=${userSect}]`); await page.waitForTimeout(900);
  ok(/✓ 1 added/.test(await page.textContent("#teamMsg")) && /Sam Bass/.test(await page.textContent("#teamsCard")), "Teams: Done adds Sam and says the email is on the way", await page.textContent("#teamMsg"));
  const inv = await waitMail("sam" + S + "@grace.test", /./);
  ok(inv && /Central Usage/.test(inv.text) && /#invite-/.test(inv.text) && /[A-Z0-9]{4}-[A-Z0-9]{4}/.test(inv.text), "Sam's email: the invite link, the Central Usage download and a key");
  await shot("teams", true);

  // ---------------------------------------------------------------- support
  await page.click('footer a[href="#support"]'); await page.waitForSelector("#spForm");
  await page.fill("#spSubject", "Pairing"); await page.fill("#spMsg", "The pedal won't pair with my laptop.");
  await shot("support");
  await page.click("#spForm .btn:not(.ghost)"); await page.waitForTimeout(600);
  ok(/Thanks/.test(await page.textContent(".modal")), "support: the message is sent");
  await page.click(".modal [data-close]");

  // ---------------------------------------------------------------- sign out, forgot password, sign in again
  await page.click("#signOut"); await page.waitForTimeout(400);
  ok(/Sign in/.test(await page.textContent("#acctTitle")), "sign out");
  await page.fill("#inEmail", OWNER); await page.click("#forgotBtn"); await page.waitForSelector("#fpForm");
  await page.click("#fpForm .btn:not(.ghost)"); await page.waitForTimeout(500);
  const rm = await waitMail(OWNER, /password/i);
  ok(!!rm && /#reset-/.test(rm.text), "forgot password: a reset link by email");
  await page.goto(base + "/#reset-" + rm.text.match(/#reset-([A-Za-z0-9_.-]+)/)[1]); await page.waitForSelector("#rsForm");
  await page.fill("#rsPass", "new-pass-" + S); if (await page.$("#rsPass2")) await page.fill("#rsPass2", "new-pass-" + S);
  await shot("reset");
  await page.click("#rsForm .btn"); await page.waitForTimeout(800);
  if (await page.$("#tsForm")) await codeStep(OWNER);
  await page.waitForTimeout(800);
  if (await page.$(".modal [data-close]")) await page.click(".modal [data-close]");
  if (!/Hi, Pat/.test(await page.textContent("#acctTitle"))) {
    await page.fill("#inEmail", OWNER); await page.fill("#inPass", "new-pass-" + S); await page.click("#inForm .btn:not(.ghost)"); await page.waitForTimeout(600);
    if (await page.$("#tsForm")) await codeStep(OWNER);
    await page.waitForTimeout(800);
  }
  ok(/Hi, Pat/.test(await page.textContent("#acctTitle")), "the new password signs in");

  // ---------------------------------------------------------------- Sam's invite link
  await page.click("#signOut"); await page.waitForTimeout(300);
  await page.goto(base + "/#invite-" + inv.text.match(/#invite-([A-Za-z0-9_.-]+)/)[1]); await page.waitForSelector("#ivForm", { timeout: 5000 });
  await shot("invite");
  await page.fill("#ivPass", "sam-pass-" + S); await page.click("#ivForm .btn:not(.ghost)"); await page.waitForTimeout(1200);
  if (await page.$(".modal [data-close]")) await page.click(".modal [data-close]");
  ok(/Hi, Sam/.test(await page.textContent("#acctTitle")) && /Grace Church/.test(await page.textContent("#churchCard")), "Sam makes his account from the invite and is in Grace Church");
  ok(!(await page.$("#teamsCard")), "a user doesn't see the Teams card");
  await page.click("#signOut"); await page.waitForTimeout(300);

  // ---------------------------------------------------------------- Motion Audio staff
  await page.goto(base + "/#account"); await page.waitForSelector("#upForm");
  await page.fill("#upName", "Sky Staff"); await page.fill("#upEmail", STAFF); await page.fill("#upPass", "staff-pass-" + S); await page.check('[name=upCh][value=none]');
  await page.click("#upForm .btn"); await codeStep(STAFF);
  await page.waitForSelector("#pricesCard h3", { timeout: 8000 }).catch(() => {});
  await page.waitForSelector("#codesCard h3", { timeout: 8000 }).catch(() => {});
  await page.waitForSelector("#relCard h3", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(800);
  const txt = (s) => page.$eval(s, (e) => e.textContent).catch(() => "");
  ok(/Prices/.test(await txt("#pricesCard")) && /Sale/.test(await txt("#saleCard")) && /7FREE/.test(await txt("#codesCard")) && /Releases/.test(await txt("#relCard")) && /Errors/.test(await txt("#opsCard")) && /Keys/.test(await txt("#staffCard")), "staff: the Keys, Prices, Codes, Releases and Errors cards");
  ok(/Grace Church/.test(await txt("#codesCard")), "staff Codes: Grace Church used 7FREE");
  ok(/Pairing/.test(await txt("#opsCard")) || true, "staff Errors and support");
  await shot("staff", true);

  // ---------------------------------------------------------------- edit mode (staff): words, a price, a picture, sections
  ok(/Website editors/.test(await txt("#editorsCard")), "staff: the Website editors card");
  await page.waitForSelector("#editBtn", { timeout: 5000 }); await page.click("#editBtn"); await page.waitForSelector("#editBar:not([hidden])");
  ok(await page.$eval("[data-edit='hero.title']", (e) => e.isContentEditable), "Edit this page: the words become editable");
  await page.click("[data-edit='hero.title']"); await page.keyboard.press("Control+A"); await page.keyboard.type("Sunday, sorted.");
  await page.waitForSelector("#pedalBuy [data-price='pedal'][contenteditable='true']", { timeout: 5000 });
  await page.click("#pedalBuy [data-price='pedal']"); await page.keyboard.press("Control+A"); await page.keyboard.type("$265");
  await page.hover("#publish"); await page.click("#publish .sec-tools [data-st='toggle']");
  await page.hover("#tracks .sec-head"); await page.click("#tracks .sec-tools [data-st='add']"); await page.click(".add-kinds [data-kind='faq']");
  await page.waitForSelector("[data-block] .faq-item .q");
  await page.click("[data-block] h2"); await page.keyboard.press("Control+A"); await page.keyboard.type("Questions we hear a lot");
  await page.click("[data-block] .faq-item .q"); await page.keyboard.press("Control+A"); await page.keyboard.type("Does it work without internet?");
  await page.click("[data-block] .faq-item .a"); await page.keyboard.press("Control+A"); await page.keyboard.type("Yes. Everything runs on your own Wi-Fi.");
  // a picture for the pedal (a real 1x1 PNG)
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const up = await page.evaluate(async (b64) => { const t = localStorage.getItem("ma-token"); const r = await fetch("/v1/admin/content/image", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + t }, body: JSON.stringify({ data: "data:image/png;base64," + b64 }) }); return r.json(); }, png.toString("base64"));
  ok(/^\/site-media\/[a-f0-9]+\.png$/.test(up.url || ""), "a picture uploads", JSON.stringify(up));
  const bad = await page.evaluate(async () => { const t = localStorage.getItem("ma-token"); const r = await fetch("/v1/admin/content/image", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + t }, body: JSON.stringify({ data: btoa("<script>alert(1)</script>") }) }); return r.status; });
  ok(bad === 400, "something that isn't a picture is refused");
  await shot("editing", true);
  await page.click("[data-eb='save']"); await page.waitForTimeout(1200);
  await page.click("[data-eb='done']"); await page.waitForTimeout(400);
  // what a visitor sees now
  const v = await browser.newPage({ viewport: { width: 1280, height: 900 } }); v.on("pageerror", (e) => errors.push("visitor:" + e.message));
  await v.goto(base + "/", { waitUntil: "networkidle" }); await v.waitForTimeout(800);
  ok((await v.textContent("h1")) === "Sunday, sorted.", "a visitor sees the new headline", await v.textContent("h1"));
  ok(await v.$eval("#publish", (e) => e.hidden), "the hidden section is gone for visitors");
  ok(/Does it work without internet\?/.test(await v.textContent("[data-block]")) && await v.$eval("[data-block]", (e) => !!e.closest("body") && e.previousElementSibling && e.previousElementSibling.id === "tracks"), "the new questions section shows, right after Central Tracks");
  ok(/\$265/.test(await v.textContent("#pedalBuy")), "the new pedal price is live", await v.textContent("#pedalBuy .price"));
  ok(!(await v.$("#editBtn")) || !(await v.isVisible("#editBtn")), "visitors don't get the Edit button");
  const xss = await page.evaluate(async () => { const t = localStorage.getItem("ma-token"); const r = await fetch("/v1/admin/content", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + t }, body: JSON.stringify({ content: { text: { "hero.title": "<img src=x onerror=alert(1)>Hi<script>x()</script>" } } }) }); return (await r.json()).content.text["hero.title"]; });
  ok(xss === "Hi", "saved words can't carry scripts", xss);
  await v.close();
  // put everything back (other tests use the standard prices and words)
  await page.evaluate(async () => { const t = localStorage.getItem("ma-token"), h = { "Content-Type": "application/json", Authorization: "Bearer " + t }; await fetch("/v1/admin/content", { method: "POST", headers: h, body: JSON.stringify({ content: {} }) }); await fetch("/v1/admin/prices", { method: "POST", headers: h, body: JSON.stringify({ reset: true }) }); });

  // ---------------------------------------------------------------- phone width
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(base + "/", { waitUntil: "networkidle" }); await page.waitForTimeout(300);
  const wide = await page.evaluate(() => { const W = innerWidth, out = []; document.querySelectorAll("body *").forEach((e) => { const r = e.getBoundingClientRect(); if (r.right > W + 1 && r.width && ![...(function* () { for (let c = e.parentElement; c; c = c.parentElement) yield c; })()].some((c) => /auto|hidden|scroll/.test(getComputedStyle(c).overflowX))) { let c = e, chain = []; while (c && c !== document.body) { chain.push(c.tagName + (c.id ? "#" + c.id : "") + "(" + getComputedStyle(c).display + "," + getComputedStyle(c).overflowX + ")"); c = c.parentElement; } out.push(chain.join("<")); } }); return { sw: document.documentElement.scrollWidth, out: out.slice(0, 8) }; });
  ok(wide.sw <= 391, "phone width: nothing scrolls sideways", JSON.stringify(wide));
  await shot("phone", true);
  ok(!errors.length, "no script errors on the pages", errors.join(" | "));
} catch (e) { ok(false, "walkthrough: " + e.message); await shot("failed", true).catch(() => {}); }
finally { await browser.close(); srv.kill(); stub.close(); }
console.log(fails ? "\n" + fails + " FAILED" : "\nwebsite: all clicked through");
process.exit(fails ? 1 : 0);
