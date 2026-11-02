// 10.2: the pre-service check's alerts (POST /v1/church/alert) and a Planning Center plan as a run sheet draft.
// Against a real Postgres, with a stand-in email service:  node test/v102-alerts.mjs postgres://... [port]
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const db = process.argv[2] || "postgres://postgres@127.0.0.1:55432/ma", port = Number(process.argv[3] || 18990), base = "http://127.0.0.1:" + port, mailPort = port + 1;
process.env.DATABASE_URL = db;
// the stand-in email service: every email the website sends lands here
const mails = [];
const mailSrv = http.createServer((req, res) => { let b = ""; req.on("data", (c) => { b += c; }); req.on("end", () => { try { mails.push(JSON.parse(b)); } catch (_) { } res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"id":"m1"}'); }); }).listen(mailPort);
const srv = spawn(process.execPath, [path.join(here, "..", "src", "index.js")], { env: Object.assign({}, process.env, { PORT: String(port), STRIPE_SECRET_KEY: "", RESEND_API_KEY: "re_test", MAIL_FROM: "Motion Audio <test@example.test>", RESEND_API_URL: "http://127.0.0.1:" + mailPort + "/emails", ALERT_GAP_MINUTES: "10" }), stdio: ["ignore", "pipe", "pipe"] });
let log = ""; srv.stdout.on("data", (d) => { log += d; }); srv.stderr.on("data", (d) => { log += d; });
for (let i = 0; i < 150 && !/Motion Audio server on/.test(log); i++) await new Promise((r) => setTimeout(r, 100));

let fails = 0;
const ok = (c, m, d) => { console.log((c ? "  ✓ " : "  ✗ ") + m + (c || d === undefined ? "" : "   -- " + JSON.stringify(d).slice(0, 400))); if (!c) fails++; };
const j = async (method, p, body, tok) => { const r = await fetch(base + "/v1" + p, { method, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const stamp = Date.now();
try {
  console.log("The pre-service check's alerts:");
  const email = "main" + stamp + "@church.test";
  const own = await j("POST", "/signup", { email, password: "password123", name: "Main", churchName: "Grace Church " + stamp });
  ok(!!(own.body.token || own.body.step), "a main admin makes the church when signing up", own.body);
  const { q, one } = await import("../src/db.js");
  const cid = (await one("SELECT church_id FROM church_members m JOIN users u ON u.id=m.user_id WHERE u.email=$1", [email])).church_id;
  const order = await one("INSERT INTO orders (email, stripe_session, items, total_cents) VALUES ($1,$2,'{}',0) RETURNING id", [email, "cs_alert_" + stamp]);
  const A = "AALR" + String(stamp).slice(-12), U = "UALR" + String(stamp).slice(-12), dev = "dev-booth-" + stamp;
  await q("INSERT INTO licenses (key, order_id, product, kind, church_id) VALUES ($1,$2,'admin','A',$3), ($4,$2,'user','U',$3)", [A, order.id, cid, U]);
  await q("INSERT INTO license_devices (key, device_id, device_name, app) VALUES ($1,$2,'Sound booth','control'), ($3,$2,'Sound booth','usage')", [A, dev, U]);

  let r = await j("POST", "/church/alert", { key: A.toLowerCase(), device: dev, kind: "precheck", subject: "Pre-service check: 2 problems before Sunday morning", text: "✗ Pedal 2 is offline\n✗ The stream key isn't set", service: "Sunday morning" });
  ok(r.status === 200 && r.body.ok && r.body.mailed === 1 && r.body.to === 1, "the church's admin key, active on that computer, sends it: emailed to the main admin", r.body);
  const m = mails[mails.length - 1] || {};
  ok(m.to && m.to[0] === email && /Pre-service check: 2 problems/.test(m.subject) && /Pedal 2 is offline/.test(m.text) && /Grace Church/.test(m.subject), "the email says what's wrong, for which church", m);
  r = await j("POST", "/church/alert", { key: A, device: dev, subject: "again", text: "still" });
  ok(r.status === 200 && r.body.held && r.body.mailed === 0 && mails.filter((x) => /Grace Church/.test(x.subject || "")).length === 1, "a second alert within 10 minutes is kept, not emailed again", r.body);
  r = await j("POST", "/church/alert", { key: A, device: "some-other-computer", text: "x" });
  ok(r.status === 403, "the key on a computer it isn't active on: refused", r.body);
  r = await j("POST", "/church/alert", { key: U, device: dev, text: "x" });
  ok(r.status === 403, "a user (U) key: refused - alerts come from the admin computers", r.body);
  r = await j("POST", "/church/alert", { key: "AXXX-XXXX-XXXX-XXXX", device: dev, text: "x" });
  ok(r.status === 403, "an unknown key: refused", r.body);
  r = await j("POST", "/church/alert", { device: dev });
  ok(r.status === 400, "no key: a plain error", r.body);
  const kept = await q("SELECT mailed FROM church_alerts WHERE church_id=$1 ORDER BY id", [cid]);
  ok(kept.length === 2 && kept[0].mailed && !kept[1].mailed, "both are kept for the Account page, the first marked as emailed", kept);
  const other = await j("POST", "/signup", { email: "other" + stamp + "@else.test", password: "password123", name: "Other" });
  const none = await j("GET", "/church/alerts", null, other.body.token);
  ok(none.status === 200 && none.body.alerts.length === 0, "someone outside the church sees none", none.body);

  console.log("\nA Planning Center plan as a run sheet draft:");
  const { runSheetFromPlan } = await import("../src/runsheet-from-plan.js");
  const rs = runSheetFromPlan({ plan: { id: "p1", title: "Easter", serviceTypeName: "Sunday", sortDate: "2027-03-28T09:30:00" },
    items: [{ type: "header", title: "Worship" }, { type: "item", title: "Welcome & Announcements", length: 300 }, { type: "song", title: "Amazing Grace", length: 260, key: "G" },
      { type: "item", title: "Scripture reading: John 3:16", length: 120 }, { type: "item", title: "Message", length: 2100, description: "Grace that finds us" }, { type: "item", title: "Offering", length: 240 },
      { type: "item", title: "Pre-service loop", position: "pre" }, { type: "media", title: "Easter bumper", length: 90 }, { type: "item", title: "Benediction", length: 60 }],
    team: [{ name: "Ann", position: "Worship Leader" }, { name: "Pastor Dan", position: "Senior Pastor" }, { name: "Ben", position: "Lights" }, { name: "Cal", position: "Sound", status: "D" }] });
  ok(rs.name === "Sunday · Easter" && rs.date === "2027-03-28" && rs.time === "09:30", "its name, date and time", rs);
  ok(JSON.stringify(rs.items.map((x) => x.kind)) === JSON.stringify(["welcome", "song", "scripture", "sermon", "offering", "video", "closing"]), "each part's kind from its title (headers and pre-service items left out)", rs.items.map((x) => x.kind));
  ok(rs.items[1].minutes === 4.33 && rs.items[3].note === "Grace that finds us", "lengths in minutes, notes kept", rs.items);
  ok(rs.team.leader === "Ann" && rs.team.speaker === "Pastor Dan" && rs.team.tech.join() === "Ben", "who's on (someone who declined left out)", rs.team);
} finally {
  srv.kill(); mailSrv.close();
}
console.log(fails ? "\n" + fails + " ALERT CHECK(S) FAILED\n" + log.slice(-2000) : "\nALL ALERT CHECKS PASSED");
process.exit(fails ? 1 : 0);
