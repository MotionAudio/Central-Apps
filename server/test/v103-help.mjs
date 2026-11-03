// 10.3: the Help Center and the support desk, through the API: the built-in setup guides, staff writing, editing,
// reordering and deleting articles (with pictures, an uploaded video and a YouTube link), "Was this helpful?", the
// Contact support form (a honeypot, a limit per address, the mail to support with the person as Reply-To), tickets
// (staff answer, the customer sees it on the website and answers back), and the status page with an incident note.
//   node test/v103-help.mjs postgres://.../ma [port]
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const db = process.argv[2] || "postgres://postgres@127.0.0.1:55432/ma", port = Number(process.argv[3] || 18930), base = "http://127.0.0.1:" + port;
const S = Date.now(), STAFF = "staff" + S + "@motion.test", CUST = "cust" + S + "@grace.test", HELP = "support@motion.test";
const mails = [];
const stub = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { mails.push(JSON.parse(b || "{}")); res.end('{"id":"x"}'); }); });
await new Promise((r) => stub.listen(0, "127.0.0.1", r));
const srv = spawn(process.execPath, [path.join(here, "..", "src", "index.js")], { env: Object.assign({}, process.env, { DATABASE_URL: db, PORT: String(port), STRIPE_SECRET_KEY: "", RESEND_API_KEY: "re_test", MAIL_FROM: "M <t@motion.test>",
  RESEND_API_URL: "http://127.0.0.1:" + stub.address().port + "/emails", PUBLIC_URL: base, ADMIN_EMAILS: STAFF, REMINDERS: "off", SUPPORT_EMAIL: HELP, STATUS_CHECKS: "off", CC_UPDATE_API: "http://127.0.0.1:9" }), stdio: ["ignore", "pipe", "pipe"] });
let log = ""; srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
for (let i = 0; i < 150 && !/Motion Audio server on/.test(log); i++) await new Promise((r) => setTimeout(r, 100));
let fails = 0;
const ok = (c, m, d) => { console.log((c ? "  ✓ " : "  ✗ ") + m + (c || d === undefined ? "" : "   -- " + JSON.stringify(d).slice(0, 400))); if (!c) fails++; };
const j = async (method, p, body, tok, ip) => { const r = await fetch(base + "/v1" + p, { method, headers: Object.assign({ "Content-Type": "application/json" }, tok ? { Authorization: "Bearer " + tok } : {}, ip ? { "X-Forwarded-For": ip } : {}), body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const waitMail = async (who, re) => { for (let i = 0; i < 50; i++) { const m = mails.filter((x) => x.to && x.to[0] === who && (!re || re.test(x.subject))).pop(); if (m) return m; await new Promise((r) => setTimeout(r, 100)); } return null; };
const codeIn = (m) => (m && (m.subject.match(/(\d{6})/) || m.text.match(/(\d{6})/)) || [])[1];
async function staffToken() {
  // staff sign-in: password, then the phone (added) and the codes (by email here)
  const pw = "staff-pass-" + S;
  const s = await j("POST", "/signup", { email: STAFF, password: pw, name: "Sam Staff", device: "t" });
  let r = s.body.token ? s.body : null;
  if (!r || r.step) {
    let st = s.body;
    if (st.step === "phone") st = (await j("POST", "/login/phone", { ticket: st.ticket, phone: "555-010-" + String(S).slice(-4) })).body;
    const m = await waitMail(STAFF, /code/i), codes = mails.filter((x) => x.to && x.to[0] === STAFF && /code/i.test(x.subject)).map(codeIn);
    r = (await j("POST", "/login/code", { ticket: st.ticket, code: codeIn(m), emailCode: codes[codes.length - 1], device: "t" })).body;
  }
  return r.token;
}

try {
  // ---------------------------------------------------------------- articles
  const list = await j("GET", "/help/articles");
  ok(list.status === 200 && list.body.articles.length >= 12 && list.body.categories.includes("Troubleshooting") && !list.body.canEdit, "the built-in setup guides are there, in categories; visitors can't edit", list.body.articles && list.body.articles.length);
  const one_ = await j("GET", "/help/articles/set-up-the-central-pedal");
  ok(one_.body.article && one_.body.article.body.some((b) => b.t === "steps") && one_.body.article.body.some((b) => b.t === "img"), "an article: headings, steps and a picture");
  ok((await j("POST", "/help/articles", { title: "Nope" })).status === 401, "writing an article needs staff");
  const tok = await staffToken();
  ok(!!tok, "staff signed in (with the code)");
  const mine = await j("GET", "/help/articles?all=1", null, tok);
  ok(mine.body.canEdit === true, "staff can edit the Help Center");
  const vid = await j("POST", "/help/media/video", { type: "video/mp4", size: 1234567, name: "setup.mp4" }, tok);
  ok(vid.body.uploadUrl && /^\/help-media\/videos\/[a-f0-9]+\.mp4$/.test(vid.body.url), "an uploaded video gets an upload link and its address", vid.body);
  const put = await fetch(vid.body.uploadUrl, { method: "PUT", body: Buffer.from("fake mp4"), headers: { "Content-Type": "video/mp4" } });
  ok(put.ok, "the video uploads to the site's file storage");
  const vget = await fetch(base + vid.body.url, { redirect: "manual" });
  ok(vget.status === 302, "the video's address leads to it");
  const made = await j("POST", "/help/articles", { title: "Setting up a second pedal", category: "Central Pedal", summary: "Two pedals, one setlist.",
    body: [{ t: "h", text: "Before you start" }, { t: "p", text: "You need **two** pedals." }, { t: "steps", items: ["Plug in", "Pair it"] }, { t: "img", url: "/img/apps/pedal-live.webp", alt: "LIVE" },
      { t: "video", url: vid.body.url }, { t: "video", url: "https://youtu.be/dQw4w9WgXcQ" }, { t: "video", url: "https://evil.example/x.mp4" }, { t: "script", text: "<script>" }] }, tok);
  const a = made.body.article;
  ok(a && a.slug === "setting-up-a-second-pedal" && a.body.length === 6 && a.body[5].youtube === "dQw4w9WgXcQ" && /youtube-nocookie/.test(a.body[5].url), "staff write an article: heading, text, steps, picture, an uploaded video and a YouTube link (other videos and blocks are dropped)", a);
  const ed = await j("POST", "/help/articles", { id: a.id, title: "Setting up a second Central Pedal", category: "Central Pedal", body: a.body, slug: a.slug }, tok);
  ok(ed.body.article && ed.body.article.title === "Setting up a second Central Pedal", "...and edit it");
  const all = (await j("GET", "/help/articles?all=1", null, tok)).body.articles, ids = all.map((x) => x.id), moved = [a.id].concat(ids.filter((x) => x !== a.id));
  await j("POST", "/help/articles-order", { ids: moved }, tok);
  ok((await j("GET", "/help/articles")).body.articles[0].id === a.id, "...reorder (it's first now)");
  await j("POST", "/help/articles/" + a.slug + "/helpful", { yes: true });
  await j("POST", "/help/articles/" + a.slug + "/helpful", { yes: true });
  ok((await j("GET", "/help/articles/" + a.slug)).body.article.helpful.yes === 1, "Was this helpful? counts once per visitor");
  await j("POST", "/help/articles/" + a.id + "/delete", {}, tok);
  ok((await j("GET", "/help/articles/" + a.slug)).status === 404, "...and delete it");

  // ---------------------------------------------------------------- Contact support: a ticket
  const bot = await j("POST", "/support", { email: "bot@spam.test", message: "Buy cheap things", website: "http://spam.test" });
  ok(bot.body.ok && bot.body.id === 0 && !mails.some((m) => /spam/.test(m.text || "")), "a robot that fills in the hidden box is told it went, and nothing is sent");
  const sent = await j("POST", "/support", { name: "Grace", email: CUST, subject: "Pedal won't connect", message: "Our pedal doesn't show up in Central Control.", app: "Website" }, null, "10.9.9.1");
  ok(sent.body.ok && sent.body.sent && /\/help\/ticket\.html#[\w-]{20,}$/.test(sent.body.link || ""), "the message is sent, and the person gets a link to their ticket", sent.body);
  const toUs = await waitMail(HELP, /Pedal won't connect/);
  ok(toUs && toUs.reply_to && [].concat(toUs.reply_to)[0] === CUST, "it goes to support@ with the person as Reply-To", toUs && toUs.reply_to);
  for (let i = 0; i < 6; i++) await j("POST", "/support", { email: CUST, message: "More " + i + " about it" }, null, "10.9.9.2");
  ok((await j("POST", "/support", { email: CUST, message: "Seventh message" }, null, "10.9.9.2")).status === 429, "at most 6 messages an hour from one address");
  const tokn = sent.body.link.split("#")[1];
  const desk = await j("GET", "/admin/support?status=open", null, tok);
  const t = desk.body.tickets.find((x) => x.subject === "Pedal won't connect");
  ok(t && t.status === "open" && t.email === CUST && desk.body.counts.open >= 1, "staff see it as an open ticket");
  const rep = await j("POST", "/admin/support/" + t.id + "/reply", { message: "Is the pedal on the same Wi-Fi?", status: "waiting" }, tok);
  ok(rep.body.ok && rep.body.sent && rep.body.ticket.status === "waiting", "staff answer on the website: waiting on the customer", rep.body);
  const back = await waitMail(CUST, /Re: Pedal won't connect/);
  ok(back && /Answer on the website/.test(back.html) && back.html.includes(tokn) && [].concat(back.reply_to)[0] === HELP, "the answer goes by email from support, with a link to answer on the website", back && back.subject);
  const view = await j("GET", "/support/ticket/" + tokn);
  ok(view.body.ticket && view.body.ticket.replies.length === 1 && view.body.ticket.replies[0].from_staff && !view.body.ticket.email, "the ticket link shows the conversation (no staff-only details)");
  const ans = await j("POST", "/support/ticket/" + tokn + "/reply", { message: "Yes it is, same network." });
  ok(ans.body.ticket && ans.body.ticket.status === "open" && ans.body.ticket.replies.length === 2, "the customer answers on the website: open again");
  ok(!!(await waitMail(HELP, /they answered/)), "...and support gets it by email");
  ok((await j("GET", "/support/ticket/not-a-real-token-at-all-xx")).status === 404, "a wrong ticket link is refused");
  await j("POST", "/admin/support/" + t.id + "/reply", { status: "closed" }, tok);
  ok((await j("GET", "/admin/support?status=closed", null, tok)).body.tickets.some((x) => x.id === t.id), "staff close it");

  // ---------------------------------------------------------------- the status page
  const chk = await j("POST", "/admin/status/check", {}, tok);
  ok(chk.body.ok && chk.body.results.website.state === "up" && chk.body.results.storage.state === "up" && chk.body.results.downloads.state === "down" && chk.body.results.payments.state === "off", "the checks: website and storage up, downloads down (no GitHub here), payments not set up", chk.body.results);
  await j("POST", "/admin/status/incident", { title: "Downloads are slow", message: "GitHub is having a bad day." }, tok);
  const st = await j("GET", "/status");
  ok(st.body.services.length === 5 && st.body.services.find((s) => s.id === "website").state === "up" && st.body.services[0].history.length === 48 && st.body.incidents[0].title === "Downloads are slow", "/status: five services, their state and 24 hours of history, and the incident note");
  ok((await j("POST", "/admin/status/incident", { title: "x" })).status === 401, "only staff post incident notes");
  const page = await fetch(base + "/status/"); ok(page.ok && /Status/.test(await page.text()), "the status page loads");
} catch (e) { ok(false, "crashed: " + e.message); console.error(e); }
srv.kill(); stub.close();
console.log(fails ? "\n" + fails + " FAILED" : "\nall passed");
process.exit(fails ? 1 : 0);
