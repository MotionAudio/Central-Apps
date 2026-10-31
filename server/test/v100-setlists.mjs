// 10.0: setlists on the church account - every device sees the earlier ones; a setlist's team comes from the church's
// Central Services teams, up to its slots; the website's "Add songs" (#setlist-<id>) puts Central Tracks songs in it
// (owned, or any with Central Tracks Unlimited; the rest are bought first). Someone without a church keeps their own.
// Makes its own database and drops it at the end.
//   node test/v100-setlists.mjs postgres://postgres@127.0.0.1:55432/postgres [port]      (the page part needs Playwright)
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const admin = process.argv[2] || "postgres://postgres@127.0.0.1:55432/postgres", port = Number(process.argv[3] || 19100);
const S = Date.now(), dbName = "ma_v100_" + S, db = admin.replace(/\/[^/]*$/, "/" + dbName);
const pg = (await import("pg")).default;
async function sql(text) { const c = new pg.Client({ connectionString: admin }); await c.connect(); try { await c.query(text); } finally { await c.end(); } }
await sql("CREATE DATABASE " + dbName);
process.env.DATABASE_URL = db;

let fails = 0;
const ok = (c, m, d) => { console.log((c ? "  ✓ " : "  ✗ ") + m + (c || d === undefined ? "" : "   -- " + JSON.stringify(d).slice(0, 700))); if (!c) fails++; };
const base = "http://127.0.0.1:" + port;
const srv = spawn(process.execPath, [path.join(here, "..", "src", "index.js")], { env: Object.assign({}, process.env, { DATABASE_URL: db, PORT: String(port), STRIPE_SECRET_KEY: "", RESEND_API_KEY: "", PUBLIC_URL: base, REMINDERS: "off" }), stdio: ["ignore", "pipe", "pipe"] });
let log = ""; srv.stdout.on("data", (d) => { log += d; }); srv.stderr.on("data", (d) => { log += d; });
for (let i = 0; i < 150 && !/Motion Audio server on/.test(log); i++) await new Promise((r) => setTimeout(r, 100));
const j = async (method, p, body, tok) => { const r = await fetch(base + "/v1" + p, { method, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); return Object.assign(await r.json().catch(() => ({})), { _status: r.status }); };

let browser = null;
try {
  if (!/Motion Audio server on/.test(log)) console.log(log.slice(-1500));
  const { q, one } = await import("../src/db.js");
  const { makeToken } = await import("../src/auth.js");
  const user = async (who) => { const u = await one("INSERT INTO users (email,name,pass_hash,email_confirmed) VALUES ($1,$2,'x',TRUE) RETURNING *", [who + "@grace100.test", who[0].toUpperCase() + who.slice(1)]); return { u, tok: makeToken(u.id, true) }; };
  const lead = await user("lead"), keys = await user("keys"), drums = await user("drums"), solo = await user("solo"), other = await user("other");
  const church = await one("INSERT INTO churches (name,owner_id,admin_code,user_code,services_slots) VALUES ('Grace 100',$1,'A100" + S + "','U100" + S + "',2) RETURNING *", [lead.u.id]);
  const otherChurch = await one("INSERT INTO churches (name,owner_id,admin_code,user_code) VALUES ('Elsewhere',$1,'B100" + S + "','V100" + S + "') RETURNING *", [other.u.id]);
  await q("INSERT INTO church_members (church_id,user_id,role) VALUES ($1,$2,'owner'),($1,$3,'user'),($1,$4,'user'),($5,$6,'owner')", [church.id, lead.u.id, keys.u.id, drums.u.id, otherChurch.id, other.u.id]);
  const team = await one("INSERT INTO service_teams (church_id,kind,name) VALUES ($1,'worship','Band A') RETURNING *", [church.id]);
  await q("INSERT INTO service_team_members (team_id,email,name,role) VALUES ($1,'keys@grace100.test','Kim Keys','Keys'),($1,'drums@grace100.test','Dan Drums','Drums'),($1,'bass@grace100.test','Bea Bass','Bass')", [team.id]);
  const pub = await user("publisher");
  const t1 = await one("INSERT INTO tracks (publisher_id,title,artist,kind,stars,price_cents,status,song_key,bpm) VALUES ($1,'Amazing Grace','Motion Audio','Multitrack',5,2500,'live','G',72) RETURNING id", [pub.u.id]);
  const t2 = await one("INSERT INTO tracks (publisher_id,title,artist,kind,stars,price_cents,status,song_key,bpm) VALUES ($1,'It Is Well','Motion Audio','Prime',4,1500,'live','C',66) RETURNING id", [pub.u.id]);
  const t3 = await one("INSERT INTO tracks (publisher_id,title,artist,kind,stars,price_cents,status,item_format) VALUES ($1,'Warm Upright','Motion Audio','Sound',4,500,'live','sf2') RETURNING id", [pub.u.id]);

  console.log("setlists on the church account:");
  let r = await j("GET", "/setlists", null, lead.tok);
  ok(r._status === 200 && r.setlists.length === 0 && r.church === "Grace 100" && r.teamMax === 2, "none yet; a team can have as many people as the church has Central Services slots (2)", r);
  r = await j("GET", "/setlists/people?q=dr", null, lead.tok);
  ok(r.people.length === 1 && r.people[0].email === "drums@grace100.test" && r.people[0].name === "Dan Drums" && r.people[0].role === "Drums" && r.max === 2, "searching the team: from the church's Central Services teams, with their role", r);
  r = await j("GET", "/setlists/people", null, lead.tok);
  ok(r.total >= 3 && r.people.some((p) => p.email === "bass@grace100.test"), "everyone on the teams can be picked", r.people);
  r = await j("POST", "/setlists", { name: "Sunday", team: [{ email: "keys@grace100.test" }, { email: "drums@grace100.test" }, { email: "bass@grace100.test" }] }, lead.tok);
  ok(r._status === 402 && /2 Central Services slots/.test(r.error), "three people with two slots: refused, and it says why", r);
  r = await j("POST", "/setlists", { name: "Sunday", team: [{ email: "stranger@x.test" }] }, lead.tok);
  ok(r._status === 400 && /isn't on your church's teams/.test(r.error), "someone who isn't on the teams can't be added", r);
  r = await j("POST", "/setlists", { name: "  ", team: [] }, lead.tok);
  ok(r._status === 400, "a setlist needs a name", r);
  r = await j("POST", "/setlists", { name: "Sunday Nov 1", team: [{ email: "KEYS@grace100.test" }, { email: "drums@grace100.test", role: "Drums + click" }], serviceAt: "2026-11-01T15:00:00Z" }, lead.tok);
  const sid = r.setlist && r.setlist.id;
  ok(r._status === 200 && sid && r.setlist.team.length === 2 && r.setlist.team[0].name === "Kim Keys" && r.setlist.team[1].role === "Drums + click" && r.setlist.serviceAt && r.setlist.songs.length === 0, "Create new: a name, the day and two people (their names from the teams)", r);
  r = await j("GET", "/setlists", null, keys.tok);
  ok(r.setlists.length === 1 && r.setlists[0].name === "Sunday Nov 1" && r.setlists[0].count === 0, "another person in the church sees it from their own device (Load setlist)", r);
  r = await j("GET", "/setlists/" + sid, null, other.tok);
  ok(r._status === 404, "another church can't open it", r);
  r = await j("GET", "/setlists", null, other.tok);
  ok(r.setlists.length === 0 && r.teamMax === 0, "...or list it; a church without Central Services gets no team", r);

  console.log("Add songs (the website):");
  r = await j("POST", "/setlists/" + sid + "/songs", { trackId: t1.id }, keys.tok);
  ok(r._status === 402 && r.checkoutUrl === base + "/#buy-" + t1.id && /Buy this song first/.test(r.error), "a song nobody bought, no subscription: buy it first (the website's buy link)", r);
  await q("INSERT INTO library (user_id,track_id,how) VALUES ($1,$2,'purchase')", [keys.u.id, t1.id]);
  r = await j("POST", "/setlists/" + sid + "/songs", { trackId: t1.id }, keys.tok);
  ok(r._status === 200 && r.setlist.songs.length === 1 && r.setlist.songs[0].trackId === String(t1.id) && r.setlist.songs[0].title === "Amazing Grace" && r.setlist.songs[0].key === "G" && r.setlist.songs[0].bpm === 72 && r.setlist.songs[0].addedBy === "keys@grace100.test", "a song they own goes straight in (title, key, tempo, who added it)", r.setlist);
  r = await j("POST", "/setlists/" + sid + "/songs", { trackId: t1.id }, lead.tok);
  ok(r._status === 200 && r.already && r.setlist.songs.length === 1, "adding it again changes nothing", r);
  r = await j("POST", "/setlists/" + sid + "/songs", { trackId: t3.id }, lead.tok);
  ok(r._status !== 200, "a Sound isn't a song: not in a setlist", r);
  await q("UPDATE churches SET subscribed=TRUE WHERE id=$1", [church.id]);
  r = await j("POST", "/setlists/" + sid + "/songs", { trackId: t2.id }, lead.tok);
  ok(r._status === 200 && r.setlist.songs.length === 2 && r.setlist.songs[1].title === "It Is Well", "with Central Tracks Unlimited any song goes in", r);
  ok(!!(await one("SELECT 1 FROM library WHERE user_id=$1 AND track_id=$2", [lead.u.id, t2.id])), "...and it's in their storage, so the app can download it");

  console.log("the apps keep the setlist up to date:");
  r = await j("POST", "/setlists/" + sid, { songs: [{ title: "It Is Well", trackId: t2.id, localId: "s-well" }, { title: "Our Own Song", localId: "s-own", key: "D", bpm: 80 }] }, lead.tok);
  const titles = r.setlist && r.setlist.songs.map((x) => x.title);
  ok(r._status === 200 && JSON.stringify(titles) === JSON.stringify(["It Is Well", "Our Own Song", "Amazing Grace"]), "the app's order and its own songs go up; a song added on the website the app hasn't downloaded yet stays", titles);
  r = await j("POST", "/setlists/" + sid, { songs: [{ title: "Our Own Song", localId: "s-own" }], removed: [String(t2.id), String(t1.id)] }, lead.tok);
  ok(r.setlist.songs.length === 1 && r.setlist.songs[0].title === "Our Own Song", "songs taken out in the app are out (also one added on the website)", r.setlist.songs);
  r = await j("POST", "/setlists/" + sid, { name: "Sunday Nov 1 (9:00)", team: [{ email: "bass@grace100.test" }] }, lead.tok);
  ok(r.setlist.name === "Sunday Nov 1 (9:00)" && r.setlist.team.length === 1 && r.setlist.team[0].name === "Bea Bass", "renamed, and the team changed", r.setlist);
  r = await j("POST", "/setlists/" + sid + "/songs/remove", { trackId: "999" }, lead.tok);
  ok(r._status === 200, "taking out a song that isn't there is fine", r);

  console.log("someone without a church:");
  r = await j("POST", "/setlists", { name: "My practice" }, solo.tok);
  const own = r.setlist && r.setlist.id;
  ok(r._status === 200 && own, "makes setlists for themselves", r);
  r = await j("POST", "/setlists", { name: "With a band", team: [{ email: "keys@grace100.test" }] }, solo.tok);
  ok(r._status === 403 && /church account/.test(r.error), "...but no team (that needs a church with Central Services)", r);
  r = await j("GET", "/setlists", null, solo.tok);
  ok(r.setlists.length === 1 && r.setlists[0].name === "My practice", "...and sees only theirs", r);
  r = await j("GET", "/setlists/" + own, null, lead.tok);
  ok(r._status === 404, "the church can't see a person's own setlist", r);
  r = await j("GET", "/setlists", null, null);
  ok(r._status === 401, "signing in is needed", r);

  // the website's Add songs page: #setlist-<id> lists the songs to add, Add puts one in
  let pw; try { pw = createRequire(import.meta.url)("playwright"); } catch (_) { pw = null; }
  if (!pw) console.log("  (no Playwright: the page part is skipped)");
  else {
    console.log("the website's Add songs page:");
    browser = await pw.chromium.launch();
    const page = await browser.newPage();
    const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/");
    await page.evaluate((t) => localStorage.setItem("ma-token", t), lead.tok);
    await page.goto(base + "/#setlist-" + sid); await page.reload();
    await page.waitForSelector("#setlistAdd:not([hidden]) #slBody button, #setlistAdd:not([hidden]) #slBody .added", { timeout: 15000 });
    const view = await page.evaluate(() => ({ h: document.querySelector("#setlistAdd h2").textContent, rows: [...document.querySelectorAll("#slBody tr")].map((r) => r.textContent.replace(/\s+/g, " ").trim()), songs: [...document.querySelectorAll(".sl-songs li")].map((l) => l.textContent.trim()) }));
    ok(/Add songs to Sunday Nov 1 \(9:00\)/.test(view.h) && view.rows.some((x) => /Amazing Grace/.test(x)) && view.rows.some((x) => /It Is Well/.test(x)) && !view.rows.some((x) => /Warm Upright/.test(x)) && view.songs.some((x) => /Our Own Song/.test(x)),
      "it shows the setlist, what's in it, and the songs to add (no sounds or boards)", view);
    await page.click('[data-sl-add="' + t1.id + '"]');
    await page.waitForFunction(() => [...document.querySelectorAll(".sl-songs li")].some((l) => /Amazing Grace/.test(l.textContent)), null, { timeout: 8000 });
    r = await j("GET", "/setlists/" + sid, null, lead.tok);
    ok(r.setlist.songs.some((x) => x.trackId === String(t1.id)), "Add puts it in the setlist (the app downloads it from there)", r.setlist.songs);
    const after = await page.evaluate(() => [...document.querySelectorAll("#slBody tr")].find((r) => /Amazing Grace/.test(r.textContent)).textContent);
    ok(/In the setlist/.test(after), "...and the row says it's in the setlist", after);
    await page.evaluate(() => localStorage.removeItem("ma-token"));
    await page.goto(base + "/#setlist-" + sid); await page.reload();
    await page.waitForTimeout(1500);
    const signIn = await page.evaluate(() => ({ hash: location.hash, after: sessionStorage.getItem("ma-after-signin") }));
    ok(signIn.after === "#setlist-" + sid, "signed out: it asks to sign in first, then comes back to the setlist", signIn);
    ok(!errors.length, "no errors on the page", errors);

    // 10.0.1: Central Services shows each service's setlist (same day): songs, keys, tempos, which have tracks, the team
    console.log("Central Services shows the setlists (10.0.1):");
    r = await j("GET", "/setlists?full=1", null, keys.tok);
    ok(r.setlists[0].songs && r.setlists[0].songs.length === 2, "the list can carry each setlist's songs (?full=1)", r.setlists[0]);
    await q("INSERT INTO services (church_id,title,starts_at) VALUES ($1,'Sunday 9:00','2026-11-01T15:00:00Z')", [church.id]);
    const cs = await browser.newPage(); const csErr = []; cs.on("pageerror", (e) => csErr.push(e.message));
    await cs.goto(base + "/services/"); await cs.evaluate((t) => localStorage.setItem("cs-token", t), keys.tok); await cs.reload();
    await cs.waitForSelector("nav [data-tab=setlists]", { timeout: 15000 });
    await cs.click("nav [data-tab=schedule]"); await cs.waitForSelector(".svc .setlist-box", { timeout: 8000 });
    const onSvc = await cs.evaluate(() => { const b = document.querySelector(".svc .setlist-box"); return { head: b.querySelector("b").textContent, rows: [...b.querySelectorAll("ol.setlist li")].map((l) => l.textContent.replace(/\s+/g, " ").trim()), team: b.textContent }; });
    ok(/Setlist: Sunday Nov 1 \(9:00\)/.test(onSvc.head) && onSvc.rows.length === 2 && /Our Own Song.*No tracks/.test(onSvc.rows[0]) && /Amazing Grace\s*G\s*72 BPM\s*Tracks/.test(onSvc.rows[1]) && /Team: Bea Bass \(Bass\)/.test(onSvc.team),
      "the service shows its setlist: each song with key, tempo and whether it has tracks, and the setlist's team", onSvc);
    await cs.click("nav [data-tab=setlists]"); await cs.waitForSelector("main .card .card[data-setlist]", { timeout: 5000 });
    const tab = await cs.evaluate(() => document.querySelector("main .card .card[data-setlist]").textContent.replace(/\s+/g, " "));
    ok(/Sunday Nov 1 \(9:00\)/.test(tab) && /2 songs · 1 with tracks/.test(tab), "the Setlists tab lists the church's setlists (upcoming first)", tab);
    await cs.setViewportSize({ width: 1100, height: 900 }); await cs.click("nav [data-tab=schedule]");
    if (process.env.SHOTS) await cs.screenshot({ path: path.join(process.env.SHOTS, "services-setlist.png"), fullPage: true });
    ok(!csErr.length, "no errors on Central Services", csErr);
  }
  r = await j("POST", "/setlists/" + sid + "/remove", null, lead.tok);
  const left = await j("GET", "/setlists", null, keys.tok);
  ok(r.ok && left.setlists.length === 0, "a deleted setlist is gone for everyone", left);
} catch (e) { console.log(e); fails++; }
finally {
  if (browser) await browser.close().catch(() => {});
  srv.kill();
  await new Promise((r) => setTimeout(r, 300));
  const { pool } = await import("../src/db.js").catch(() => ({}));
  if (pool) await pool.end().catch(() => {});
  await sql("DROP DATABASE IF EXISTS " + dbName + " WITH (FORCE)").catch((e) => console.log("drop:", e.message));
}
console.log(fails ? "\n" + fails + " CHECK(S) FAILED" : "\nALL SETLIST (WEBSITE) CHECKS PASSED");
process.exit(fails ? 1 : 0);
