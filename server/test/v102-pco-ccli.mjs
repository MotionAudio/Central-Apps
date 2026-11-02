// 10.2: Planning Center plans -> setlists (OAuth with a stand-in Planning Center, a plan's songs, order of service and
// team, matching Central Tracks, following plan changes, a plan from a CSV file), and CCLI (the licence numbers and the
// copyright line, song usage once per song/kind/day, the report and its file, the partner connection waiting).
// Makes its own database and drops it at the end.
//   node test/v102-pco-ccli.mjs postgres://postgres@127.0.0.1:55432/postgres [port]      (the page part needs Playwright)
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const admin = process.argv[2] || "postgres://postgres@127.0.0.1:55432/postgres", port = Number(process.argv[3] || 19300), mockPort = port + 1;
const S = Date.now(), dbName = "ma_v102_" + S, db = admin.replace(/\/[^/]*$/, "/" + dbName);
const pg = (await import("pg")).default;
async function sql(text) { const c = new pg.Client({ connectionString: admin }); await c.connect(); try { await c.query(text); } finally { await c.end(); } }
await sql("CREATE DATABASE " + dbName);
const KEYS = { PCO_CLIENT_ID: "test-client", PCO_CLIENT_SECRET: "test-secret", PCO_BASE: "http://127.0.0.1:" + mockPort, PCO_REFRESH_MINUTES: "0" };
Object.assign(process.env, { DATABASE_URL: db, PUBLIC_URL: "http://127.0.0.1:" + port, TOKEN_SECRET: "v102-secret" }, KEYS);

let fails = 0;
const ok = (c, m, d) => { console.log((c ? "  ✓ " : "  ✗ ") + m + (c || d === undefined ? "" : "   -- " + JSON.stringify(d).slice(0, 900))); if (!c) fails++; };
const base = "http://127.0.0.1:" + port;

// ------------------------------------------------------------------ a stand-in Planning Center
// (the plan is a week from today, so it counts as an upcoming service whenever the test runs)
const soonDate = new Date(Date.now() + 7 * 86400e3); soonDate.setUTCHours(15, 0, 0, 0);
const SOON = soonDate.toISOString(), SOON_TEXT = soonDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const pco = { access: null, refresh: null, firstExpires: 60, grants: [], revoked: [], hits: [], changed: false };
function itemsBody(pageNo) {
  const songs = [
    { id: "71", attributes: { title: "Amazing Grace", author: "John Newton", ccli_number: 22025, copyright: "Public Domain" } },
    { id: "72", attributes: { title: "It Is Well with My Soul", author: "Horatio Spafford", ccli_number: 25376 } },
    { id: "73", attributes: { title: "Brand New Song", author: "Someone Else", ccli_number: 7777777 } },
    { id: "74", attributes: { title: "Holy, Holy, Holy", author: "Reginald Heber", ccli_number: 1156 } }
  ];
  const arr = [{ id: "81", attributes: { name: "Default", bpm: 72, meter: "3/4", sequence: ["V1", "V2", "C"], length: 240 } }, { id: "82", attributes: { name: "Acoustic", bpm: 66 } }, { id: "83", attributes: { name: "Full band", bpm: 120 } }, { id: "84", attributes: { name: "Hymn", bpm: 90 } }];
  const it = (id, a, rel) => ({ id, type: "Item", attributes: a, relationships: rel || {} });
  const ref = (t, id) => ({ data: id ? { type: t, id } : null });
  const all = [
    it("901", { title: "Pre-service", item_type: "header", length: 0, service_position: "pre" }),
    it("902", { title: "Countdown", item_type: "media", length: 300, service_position: "pre" }),
    it("903", { title: "Welcome", item_type: "item", length: 120 }),
    it("904", { title: "Amazing Grace", item_type: "song", key_name: pco.changed ? "A" : "G", length: 270 }, { song: ref("Song", "71"), arrangement: ref("Arrangement", "81") }),
    it("905", { title: "It Is Well", item_type: "song", key_name: "C", length: 300 }, { song: ref("Song", "72"), arrangement: ref("Arrangement", "82") }),
    it("906", { title: "Brand New Song", item_type: "song", key_name: "Bb", length: 250 }, { song: ref("Song", "73"), arrangement: ref("Arrangement", "83") }),
    it("907", { title: "Message", item_type: "header", length: 0 }),
    it("908", { title: "Sermon", item_type: "item", length: 1800, description: "Pastor Kim" })
  ].concat(pco.changed ? [it("909", { title: "Holy, Holy, Holy", item_type: "song", key_name: "D", length: 200 }, { song: ref("Song", "74"), arrangement: ref("Arrangement", "84") })] : []);
  const half = Math.ceil(all.length / 2), data = pageNo === 1 ? all.slice(0, half) : all.slice(half);
  return { data, included: songs.map((s) => Object.assign({ type: "Song" }, s)).concat(arr.map((a) => Object.assign({ type: "Arrangement" }, a))),
    links: pageNo === 1 ? { next: "http://127.0.0.1:" + mockPort + "/services/v2/service_types/11/plans/501/items?page=2" } : {} };
}
const mock = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"); let body = ""; req.on("data", (d) => { body += d; });
  req.on("end", () => {
    const send = (code, j) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); };
    if (u.pathname === "/oauth/token") {
      const f = new URLSearchParams(body); pco.grants.push(f.get("grant_type"));
      if (f.get("client_id") !== "test-client" || f.get("client_secret") !== "test-secret") return send(401, { error: "invalid_client" });
      if (f.get("grant_type") === "authorization_code") { if (f.get("code") !== "good" || f.get("redirect_uri") !== base + "/pco/callback") return send(400, { error: "invalid_grant" }); pco.access = "at-" + pco.grants.length; pco.refresh = "rt-1"; return send(200, { access_token: pco.access, refresh_token: pco.refresh, expires_in: pco.firstExpires, token_type: "bearer" }); }
      if (f.get("grant_type") === "refresh_token") { if (f.get("refresh_token") !== pco.refresh) return send(400, { error: "invalid_grant" }); pco.access = "at-" + pco.grants.length; pco.refresh = "rt-2"; return send(200, { access_token: pco.access, refresh_token: pco.refresh, expires_in: 7200 }); }
      return send(400, { error: "unsupported_grant_type" });
    }
    if (u.pathname === "/oauth/revoke") { pco.revoked.push(new URLSearchParams(body).get("token")); return send(200, {}); }
    if ((req.headers.authorization || "") !== "Bearer " + pco.access) return send(401, { errors: [{ title: "Unauthorized" }] });
    pco.hits.push(u.pathname);
    if (u.pathname === "/services/v2") return send(200, { data: { type: "Organization", id: "1", attributes: { name: "Grace Church" } } });
    if (u.pathname === "/services/v2/service_types") return send(200, { data: [{ type: "ServiceType", id: "11", attributes: { name: "Sunday Morning" } }, { type: "ServiceType", id: "12", attributes: { name: "Youth" } }] });
    if (u.pathname === "/services/v2/service_types/11/plans") return send(200, { data: [{ type: "Plan", id: "501", attributes: { title: "Gratitude", dates: SOON_TEXT, sort_date: SOON, items_count: 8, updated_at: "2026-10-30T10:00:00Z" } }] });
    if (u.pathname === "/services/v2/service_types/11/plans/501") return send(200, { data: { type: "Plan", id: "501", attributes: { title: "Gratitude", dates: SOON_TEXT, sort_date: SOON } } });
    if (u.pathname === "/services/v2/service_types/11/plans/501/items") return send(200, itemsBody(u.searchParams.get("page") === "2" ? 2 : 1));
    if (u.pathname === "/services/v2/service_types/11/plans/501/team_members") return send(200, { data: [
      { type: "PlanPerson", id: "1", attributes: { name: "Kim Keys", team_position_name: "Keys", status: "C" }, relationships: { team: { data: { type: "Team", id: "5" } } } },
      { type: "PlanPerson", id: "2", attributes: { name: "Dan Drums", team_position_name: "Drums", status: pco.changed ? "D" : "U" }, relationships: { team: { data: { type: "Team", id: "5" } } } }],
      included: [{ type: "Team", id: "5", attributes: { name: "Band" } }] });
    send(404, { errors: [{ title: "Not found" }] });
  });
});
await new Promise((r) => mock.listen(mockPort, "127.0.0.1", r));

function startServer(env) {
  const srv = spawn(process.execPath, [path.join(here, "..", "src", "index.js")], { env: Object.assign({}, process.env, { PORT: String(port), STRIPE_SECRET_KEY: "", RESEND_API_KEY: "", REMINDERS: "off" }, env), stdio: ["ignore", "pipe", "pipe"] });
  srv.log = ""; srv.stdout.on("data", (d) => { srv.log += d; }); srv.stderr.on("data", (d) => { srv.log += d; });
  return srv;
}
async function ready(srv) { for (let i = 0; i < 150 && !/Motion Audio server on/.test(srv.log); i++) await new Promise((r) => setTimeout(r, 100)); if (!/Motion Audio server on/.test(srv.log)) console.log(srv.log.slice(-1500)); }
async function stop(srv) { srv.kill(); await new Promise((r) => setTimeout(r, 400)); }
const j = async (method, p, body, tok) => { const r = await fetch(base + "/v1" + p, { method, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); return Object.assign(await r.json().catch(() => ({})), { _status: r.status }); };

let srv = startServer({ PCO_CLIENT_ID: "", PCO_CLIENT_SECRET: "" }), browser = null;
try {
  await ready(srv);
  const { q, one } = await import("../src/db.js");
  const { makeToken } = await import("../src/auth.js");
  const user = async (who, dom = "grace102.test") => { const u = await one("INSERT INTO users (email,name,pass_hash,email_confirmed) VALUES ($1,$2,'x',TRUE) RETURNING *", [who + "@" + dom, who[0].toUpperCase() + who.slice(1)]); return { u, tok: makeToken(u.id, true) }; };
  const lead = await user("lead"), adm = await user("admin"), singer = await user("singer"), other = await user("other", "elsewhere.test");
  const church = await one("INSERT INTO churches (name,owner_id,admin_code,user_code,services_slots) VALUES ('Grace 102',$1,'A102" + S + "','U102" + S + "',4) RETURNING *", [lead.u.id]);
  const otherChurch = await one("INSERT INTO churches (name,owner_id,admin_code,user_code) VALUES ('Elsewhere',$1,'B102" + S + "','V102" + S + "') RETURNING *", [other.u.id]);
  await q("INSERT INTO church_members (church_id,user_id,role) VALUES ($1,$2,'owner'),($1,$3,'admin'),($1,$4,'user'),($5,$6,'owner')", [church.id, lead.u.id, adm.u.id, singer.u.id, otherChurch.id, other.u.id]);
  const pub = await user("publisher");
  const tGrace = await one("INSERT INTO tracks (publisher_id,title,artist,kind,stars,price_cents,status,song_key,bpm,ccli) VALUES ($1,'Amazing Grace','Motion Audio','Multitrack',5,2000,'live','G',72,NULL) RETURNING id", [pub.u.id]);
  const tWell = await one("INSERT INTO tracks (publisher_id,title,artist,kind,stars,price_cents,status,song_key,bpm,ccli) VALUES ($1,'It Is Well (Hymn)','Motion Audio','Prime',4,1500,'live','C',66,'25376') RETURNING id", [pub.u.id]);
  await q("INSERT INTO library (user_id,track_id,how) VALUES ($1,$2,'purchase')", [lead.u.id, tGrace.id]);

  console.log("Planning Center without Motion Audio's keys:");
  let r = await j("GET", "/pco/status", null, lead.tok);
  ok(r._status === 200 && r.configured === false && r.connected === false && /isn't connected yet/.test(r.why) && r.canConnect === true, "status: isn't connected yet, and says to import a file meanwhile", r);
  r = await j("POST", "/pco/connect", {}, lead.tok);
  ok(r._status === 409 && /isn't connected yet/.test(r.error), "Connect says it isn't set up yet (no keys in Render)", r);

  console.log("a plan from a file:");
  const csv = "Sunday Service November 8 2026\nTitle,Type,Length,Key,Arrangement,Author,CCLI,Notes\nPre-service,Header,,,,,,\nWelcome,Item,2:00,,,,,Greeting\n\"Amazing Grace\",Song,4:30,G,Default,John Newton,22025,\nIt Is Well,Song,5:00,C,,Horatio Spafford,25376,\nSermon,Item,30:00,,,,,\"Pastor Kim, Romans 8\"\n\nName,Position,Team,Status\nKim Keys,Keys,Band,Confirmed\nDan Drums,Drums,Band,Declined\n";
  r = await j("POST", "/pco/import-file", { name: "plan.csv", text: csv, serviceAt: "2026-11-08T15:00:00Z" }, adm.tok);
  const fs1 = r.setlist;
  ok(r._status === 200 && fs1 && fs1.songs.length === 2 && fs1.songs[0].title === "Amazing Grace" && fs1.songs[0].key === "G" && fs1.songs[0].ccli === "22025" && fs1.songs[0].fromPco === true && fs1.songs[1].length === 300,
    "an admin imports a CSV: the two songs in order, with key, CCLI number and length", r);
  ok(fs1 && fs1.pco && fs1.pco.source === "file" && fs1.pco.items.length === 5 && fs1.pco.items[0].type === "header" && fs1.pco.items[4].length === 1800 && fs1.pco.items[4].description === "Pastor Kim, Romans 8" && fs1.pco.team.length === 2 && fs1.pco.team[1].status === "Declined" && fs1.serviceAt,
    "the whole order of service (headers, items with lengths and notes) and the team come with it", fs1 && fs1.pco);
  ok(r.missing.length === 2 && r.missing.some((m) => m.title === "Amazing Grace" && /buy it/.test(m.why) && m.trackId === String(tGrace.id)) && r.missing.some((m) => m.title === "It Is Well" && m.trackId === String(tWell.id)),
    "matched to Central Tracks by title and by CCLI number; songs the admin doesn't own say how to get them", r.missing);
  r = await j("POST", "/pco/import-file", { name: "list.txt", text: "Sunday Night\n0:05 Countdown\n4:00 Amazing Grace - G\n30:00 Message\n" }, lead.tok);
  ok(r._status === 200 && r.setlist.songs.length === 1 && r.setlist.songs[0].key === "G" && r.setlist.songs[0].trackId === String(tGrace.id) && r.setlist.pco.items.length === 3 && r.setlist.pco.items[2].length === 1800,
    "a plain list (\"4:00 Amazing Grace - G\") works too; a song the main admin owns goes in with its track", r);
  r = await j("POST", "/pco/import-file", { name: "x.csv", text: "   " }, lead.tok);
  ok(r._status === 400, "an empty file is refused", r);
  r = await j("POST", "/pco/import-file", { name: "plan.csv", text: csv }, singer.tok);
  ok(r._status === 403, "a user (not an admin) can't bring in plans", r);

  console.log("CCLI settings and the copyright line:");
  r = await j("GET", "/ccli/settings", null, singer.tok);
  ok(r._status === 200 && r.license === "" && r.credit.on === true && r.credit.where === "first" && /\{ccli\}/.test(r.credit.template) && r.canEdit === false && r.partner && r.partner.enabled === false && /waiting for CCLI partner approval/.test(r.partner.why),
    "everyone reads them: the line is on by default (first slide), the partner connection is waiting", r);
  r = await j("POST", "/ccli/settings", { license: "999" }, adm.tok);
  ok(r._status === 403, "an admin who isn't a main admin can't change them", r);
  r = await j("POST", "/ccli/settings", { license: "CCLI 1234567", streaming: "7654321", credit: { where: "last", template: "{title} <b>· CCLI {ccli}" } }, lead.tok);
  ok(r._status === 200 && r.license === "1234567" && r.streaming === "7654321" && r.credit.where === "last" && r.credit.on === true && !/</.test(r.credit.template), "the main admin sets the numbers (digits only) and the wording (no markup)", r);
  r = await j("GET", "/ccli/settings", null, singer.tok);
  ok(r.license === "1234567" && r.credit.where === "last", "the church's devices read the same", r);
  r = await j("GET", "/ccli/settings", null, other.tok);
  ok(r.license === "", "another church doesn't see them", r);

  console.log("CCLI usage and the report:");
  const today = new Date().toISOString().slice(0, 10), yesterday = new Date(Date.now() - 86400e3).toISOString().slice(0, 10);
  r = await j("POST", "/ccli/usage", { entries: [
    { title: "Amazing Grace (My Chains Are Gone)", ccli: "4768151", authors: "Chris Tomlin, John Newton", copyright: "2006 sixsteps Music", kind: "display", day: today, device: "Central Pedal" },
    { title: "Amazing Grace (My Chains Are Gone)", ccli: "4768151", kind: "stream", day: today, device: "Central Control" },
    { title: "Be Thou My Vision", kind: "display", day: today },
    { title: "Be Thou My Vision", kind: "record", day: yesterday },
    { title: "Nope", kind: "dance", day: today },
    { title: "Far future", kind: "display", day: "2099-01-01" }] }, singer.tok);
  ok(r._status === 200 && r.saved === 4 && r.skipped === 2, "four uses saved; an unknown kind and a far-off day are skipped", r);
  r = await j("POST", "/ccli/usage", { entries: [{ title: "Amazing Grace (My Chains Are Gone)", ccli: "4768151", kind: "display", day: today, device: "Central Control" }, { title: "BE THOU MY VISION!", kind: "display", day: today }] }, adm.tok);
  ok(r._status === 200 && r.saved === 0 && r.already === 2, "the same song shown on another device the same day counts once (by number, or by its plain title)", r);
  r = await j("POST", "/ccli/usage", { entries: [{ title: "Amazing Grace (My Chains Are Gone)", ccli: "4768151", kind: "display", day: today }] }, other.tok);
  ok(r.saved === 1, "another church's use is its own", r);
  r = await j("GET", "/ccli/report?from=" + yesterday + "&to=" + today, null, adm.tok);
  const ag = r.songs && r.songs.find((s) => s.ccli === "4768151"), bt = r.songs && r.songs.find((s) => s.title === "Be Thou My Vision");
  ok(r._status === 200 && r.songs.length === 2 && ag && ag.display === 1 && ag.stream === 1 && ag.authors === "Chris Tomlin, John Newton" && bt && bt.display === 1 && bt.record === 1 && r.totals.display === 2 && r.missingCcli === 1 && r.license === "1234567" && r.church === "Grace 102",
    "the report: each song, its number and its uses; one song without a number is pointed out", r);
  r = await j("GET", "/ccli/report", null, singer.tok);
  ok(r._status === 403, "the report is for admins", r);
  let res = await fetch(base + "/v1/ccli/report?format=csv&from=" + yesterday + "&to=" + today, { headers: { Authorization: "Bearer " + lead.tok } }), csvOut = await res.text();
  ok(res.ok && /text\/csv/.test(res.headers.get("content-type")) && /attachment/.test(res.headers.get("content-disposition")) && csvOut.split("\r\n")[0] === "Song Title,CCLI Song #,Authors,Copyright,Digital (shown on screens),Print,Record,Translate,Stream,First used,Last used" &&
    /Amazing Grace \(My Chains Are Gone\),4768151,"Chris Tomlin, John Newton",2006 sixsteps Music,1,0,0,0,1/.test(csvOut) && /CCLI License #,1234567/.test(csvOut) && /CCLI Streaming License #,7654321/.test(csvOut),
    "the file for CCLI: one row per song with Digital, Print, Record, Translate and Stream, then the licence numbers", csvOut.slice(0, 600));
  r = await j("GET", "/ccli/songselect/search?q=grace", null, lead.tok);
  ok(r._status === 503 && /waiting for CCLI partner approval/.test(r.error), "searching SongSelect directly says it's waiting for partner approval", r);
  r = await j("POST", "/ccli/report/submit", {}, lead.tok);
  ok(r._status === 503, "sending the report straight to CCLI waits too", r);

  // the website: the Planning Center and CCLI cards on Account
  let pw; try { pw = createRequire(import.meta.url)("playwright"); } catch (_) { pw = null; }
  if (pw) {
    console.log("the website's Account page:");
    browser = await pw.chromium.launch({ executablePath: process.env.CHROME || undefined });
    const pg = await browser.newPage(); const errs = []; pg.on("pageerror", (e) => errs.push(e.message));
    await pg.goto(base + "/"); await pg.evaluate((t) => localStorage.setItem("ma-token", t), lead.tok); await pg.goto(base + "/#account"); await pg.reload();
    await pg.waitForSelector("#pcoCard .pco-why", { timeout: 15000 }).catch(() => { });
    const pcoText = await pg.textContent("#pcoCard").catch(() => "");
    if (!pcoText) console.log("    (page errors: " + JSON.stringify(errs) + "; account: " + String(await pg.textContent("#acctBody").catch(() => "")).slice(0, 300) + ")");
    ok(/isn't connected yet/.test(pcoText) && /import/i.test(pcoText), "the Planning Center card says it isn't connected yet and offers a file", pcoText.slice(0, 300));
    await pg.waitForSelector("#ccliCard input[data-cc='license']", { timeout: 15000 }).catch(() => { });
    ok(await pg.inputValue("#ccliCard input[data-cc='license']").catch(() => "") === "1234567", "the CCLI card shows the licence number to the main admin");
    await pg.fill("#ccliCard input[data-cc='from']", yesterday); await pg.fill("#ccliCard input[data-cc='to']", today);
    await pg.click("#ccliCard [data-cc='report']"); await pg.waitForSelector("#ccliCard table", { timeout: 10000 }).catch(() => { });
    const rep = await pg.textContent("#ccliCard").catch(() => "");
    ok(/Be Thou My Vision/.test(rep) && /4768151/.test(rep), "Show the report lists the songs and numbers", rep.slice(0, 400));
    const setPage = await pg.textContent("#pcoCard").catch(() => "");
    ok(/Sunday Service November 8 2026|Sunday Night/.test(setPage), "plans brought in from files are listed on the card", setPage.slice(0, 400));
    ok(!errs.length, "no page errors", errs);
    await pg.close();
  } else console.log("  (Playwright isn't here: the page part is skipped)");

  // ---- now with Motion Audio's keys and a stand-in Planning Center
  await stop(srv); srv = startServer(KEYS); await ready(srv);
  console.log("Planning Center sign-in (OAuth):");
  r = await j("POST", "/pco/connect", {}, adm.tok);
  ok(r._status === 403, "an admin who isn't a main admin can't connect it", r);
  r = await j("POST", "/pco/connect", { from: "web" }, lead.tok);
  const au = r.url ? new URL(r.url) : null;
  ok(r._status === 200 && au && au.origin === KEYS.PCO_BASE && au.pathname === "/oauth/authorize" && au.searchParams.get("client_id") === "test-client" && au.searchParams.get("redirect_uri") === base + "/pco/callback" && au.searchParams.get("scope") === "services" && au.searchParams.get("response_type") === "code" && au.searchParams.get("state"),
    "Connect gives Planning Center's sign-in page with our app, the callback and the services scope", r);
  const state = au.searchParams.get("state");
  res = await fetch(base + "/pco/callback?code=good&state=" + encodeURIComponent(state.slice(0, -2) + "xx"), { redirect: "manual" });
  ok(res.status === 400, "a changed state is refused");
  res = await fetch(base + "/pco/callback?error=access_denied&state=" + encodeURIComponent(state), { redirect: "manual" });
  ok(res.status === 302 && /#account-pco-failed$/.test(res.headers.get("location")), "a cancelled sign-in goes back to the account page and says so");
  res = await fetch(base + "/pco/callback?code=good&state=" + encodeURIComponent(state), { redirect: "manual" });
  ok(res.status === 302 && /#account-pco-connected$/.test(res.headers.get("location")) && pco.grants.includes("authorization_code"), "the callback swaps the code for tokens and goes back to the account page", { status: res.status, loc: res.headers.get("location"), grants: pco.grants });
  const link = await one("SELECT * FROM pco_links WHERE scope=$1", ["c:" + church.id]);
  ok(link && !/at-\d/.test(link.access_enc) && !/rt-/.test(link.refresh_enc) && link.organization === "Grace Church" && link.connected_by === "lead@grace102.test", "the tokens are kept sealed, with the organization's name and who connected it", link && { org: link.organization, by: link.connected_by });
  r = await j("GET", "/pco/status", null, singer.tok);
  ok(r.configured && r.connected && r.organization === "Grace Church" && r.canConnect === false && r.canImport === false, "everyone sees it's connected; only admins import, only main admins connect", r);
  r = await j("POST", "/pco/connect", { from: "app" }, lead.tok);
  res = await fetch(base + "/pco/callback?code=good&state=" + encodeURIComponent(new URL(r.url).searchParams.get("state")));
  const html = await res.text();
  ok(res.status === 200 && /Planning Center is connected/.test(html) && /go back to the app/.test(html), "from an app, the callback page says to go back to the app");

  console.log("plans -> setlists:");
  r = await j("GET", "/pco/service-types", null, adm.tok);
  ok(r._status === 200 && r.serviceTypes.length === 2 && r.serviceTypes[0].name === "Sunday Morning", "the service types", r);
  ok(pco.grants.includes("refresh_token"), "the 1-minute token was refreshed before use", pco.grants);
  r = await j("GET", "/pco/plans?serviceType=11", null, adm.tok);
  ok(r._status === 200 && r.plans.length === 1 && r.plans[0].id === "501" && r.plans[0].dates === SOON_TEXT && r.plans[0].setlistId === null, "the upcoming plans", r);
  r = await j("GET", "/pco/plan?serviceType=11&plan=501", null, adm.tok);
  ok(r._status === 200 && r.items.length === 8 && r.items[3].type === "song" && r.items[3].key === "G" && r.items[3].ccli === "22025" && r.items[3].arrangement === "Default" && r.items[3].bpm === 72 && r.items[1].type === "media" && r.items[1].length === 300 && r.items[7].description === "Pastor Kim" && r.team.length === 2 && r.team[0].team === "Band" && r.team[1].status === "not answered yet",
    "a plan: every item over two pages (headers, media, songs with key/arrangement/CCLI, notes) and the team", r);
  r = await j("GET", "/pco/plans?serviceType=abc", null, adm.tok);
  ok(r._status === 400, "a bad service type is refused", r);
  r = await j("POST", "/pco/import", { serviceType: "11", plan: "501" }, lead.tok);
  const ps = r.setlist;
  ok(r._status === 200 && ps && ps.name === "Sunday Morning · " + SOON_TEXT && ps.songs.map((s) => s.title).join("|") === "Amazing Grace|It Is Well with My Soul|Brand New Song" && ps.songs[0].trackId === String(tGrace.id) && !ps.songs[1].trackId && ps.songs[2].key === "A#" && ps.serviceAt && ps.serviceAt.startsWith(SOON.slice(0, 10)),
    "Import: a setlist named for the service, its songs in order (keys too), the owned one with its track", r);
  ok(r.matched === 1 && r.missing.length === 2 && r.missing.some((m) => /It Is Well/.test(m.title) && m.trackId === String(tWell.id)) && r.missing.some((m) => m.title === "Brand New Song" && /Not in Central Tracks/.test(m.why)), "it says which songs it found and which are missing", r.missing);
  ok(ps.pco && ps.pco.source === "api" && ps.pco.plan === "501" && ps.pco.items.length === 8 && ps.pco.team.length === 2, "the order of service and the team are kept with it", ps.pco);
  r = await j("GET", "/pco/plans?serviceType=11", null, adm.tok);
  ok(r.plans[0].setlistId === ps.id, "the plan shows its setlist", r.plans);
  r = await j("POST", "/pco/import", { serviceType: "11", plan: "501" }, adm.tok);
  ok(r.setlist.id === ps.id, "importing the same plan again updates that setlist (no second copy)", r.setlist && r.setlist.id);
  // the worship leader adds a song in the app; then the plan changes in Planning Center
  r = await j("POST", "/setlists/" + ps.id, { songs: ps.songs.concat([{ title: "Extra from the app", key: "E" }]) }, lead.tok);
  ok(r.setlist.songs.length === 4, "a song added in the app", r.setlist);
  r = await j("POST", "/pco/refresh", { setlistId: ps.id }, singer.tok);
  ok(r._status === 200 && r.changed === false, "nothing changed in Planning Center: the setlist stays", r);
  pco.changed = true;
  r = await j("POST", "/pco/refresh", { setlistId: ps.id }, singer.tok);
  ok(r._status === 200 && r.changed === true && r.setlist.songs.map((s) => s.title).join("|") === "Amazing Grace|It Is Well with My Soul|Brand New Song|Holy, Holy, Holy|Extra from the app" && r.setlist.songs[0].key === "A" && r.setlist.pco.team[1].status === "declined",
    "the plan changed (a key, a new song, a declined player): the setlist follows, and the app's own song stays at the end", r.setlist && r.setlist.songs);
  const { refreshUpcoming, setRunSheetMaker, importPlan } = await import("../src/pco.js");
  pco.changed = false;
  const n = await refreshUpcoming();
  const after = await one("SELECT songs FROM setlists WHERE id=$1", [Number(ps.id)]);
  ok(n === 1 && after.songs.length === 4 && after.songs[0].key === "G", "the regular check finds the change by itself (upcoming services)", { n, songs: after.songs.map((s) => s.title + " " + s.key) });
  r = await j("POST", "/pco/refresh", { setlistId: fs1.id }, lead.tok);
  ok(r._status === 409, "a setlist from a file has nothing to check", r);

  console.log("the run sheet hook:");
  let seen = null;
  setRunSheetMaker(async (x) => { seen = x; return { id: "rs-1", items: x.items.length }; });
  const rr = await importPlan(lead.u, { plan: { title: "Wednesday", dates: "Nov 4" }, items: [{ id: "a", type: "header", title: "Start", length: 0 }, { id: "b", type: "song", title: "Doxology", key: "G", length: 60 }], team: [] }, "file");
  ok(rr.runSheet && rr.runSheet.id === "rs-1" && rr.runSheet.items === 2 && seen && seen.setlist.id === rr.setlist.id && seen.church && seen.church.id === church.id, "after an import, the run sheet maker gets the plan, its items and the new setlist", rr.runSheet);
  setRunSheetMaker(null);
  const rr2 = await importPlan(lead.u, { plan: { title: "Thursday" }, items: [{ id: "c", type: "song", title: "Doxology" }] }, "file");
  ok(!rr2.runSheet && rr2.setlist.songs.length === 1, "without it, plan -> setlist works on its own", rr2);

  console.log("disconnect:");
  r = await j("POST", "/pco/disconnect", {}, adm.tok);
  ok(r._status === 403, "only a main admin disconnects", r);
  r = await j("POST", "/pco/disconnect", {}, lead.tok);
  ok(r._status === 200 && pco.revoked.length === 1, "the main admin disconnects; the token is given back to Planning Center", { r, revoked: pco.revoked });
  r = await j("GET", "/pco/service-types", null, adm.tok);
  ok(r._status === 409 && /isn't connected/.test(r.error), "after that, plans need connecting again", r);
  r = await j("GET", "/setlists", null, singer.tok);
  ok(r.setlists.some((s) => s.pco && s.pco.source === "api"), "the church's setlists show which came from Planning Center", r.setlists && r.setlists.map((s) => s.pco));
} catch (e) { console.log(e.stack || e); fails++; }
finally {
  if (browser) await browser.close().catch(() => { });
  srv.kill(); mock.close();
  try { const { pool } = await import("../src/db.js"); await pool.end(); } catch (_) { }
  await new Promise((r) => setTimeout(r, 500));
  await sql("DROP DATABASE IF EXISTS " + dbName + " WITH (FORCE)").catch(() => { });
}
console.log(fails ? "\n" + fails + " FAILED" : "\nall passed");
process.exit(fails ? 1 : 0);
