// The Help Center and the support desk (10.3).
//   Help articles: setup guides in categories, kept in help_articles. Motion Audio staff, the website's owner and its
//     editors write, edit, reorder and delete them on the site (Help → Edit). An article's body is a list of blocks:
//     { t: "h", text } a heading, { t: "p", text } text (**bold**, [words](https://link) and line breaks), { t: "steps",
//     items: [..] } numbered steps, { t: "img", url, alt } a picture (uploaded like the page's own pictures), { t: "video",
//     url } a video: an uploaded file (/help-media/…) or a YouTube link. "Was this helpful?" counts yes and no.
//     The built-in guides (help-articles.json) are added once each; a guide staff have edited or deleted stays that way.
//   Tickets: every Contact support message (support.js) is a ticket: open, waiting (we answered, waiting on them) or
//     closed. Staff answer on the website (Account → Staff → Support); the answer goes by email from SUPPORT_EMAIL with a
//     link back to the ticket. The mailer (Resend) only sends here - it doesn't receive - so the customer answers on the
//     website, from that link or under Account → Help & tickets; their answer reopens the ticket and is emailed to us.
import crypto from "node:crypto";
import fs from "node:fs";
import { q, one } from "./db.js";
import { config } from "./config.js";
import { isAdmin } from "./auth.js";
import { isEditor } from "./content.js";
import { requireStep } from "./signin.js";
import { sendMail, mailOn, escHtml } from "./mail.js";
import * as store from "./storage.js";

function bad(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }
const clip = (s, n) => String(s == null ? "" : s).slice(0, n);
export const CATEGORIES = ["Getting started", "Central Pedal", "Sound and effects", "Main admins and admins", "Musicians", "Lights", "Slides, lyrics and video", "Stream and shorts", "Planning Center and CCLI", "Central Production", "Keys, plans and billing", "Troubleshooting"];
const SLUG = /^[a-z0-9][a-z0-9-]{1,79}$/;
const slugify = (s) => clip(String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""), 80) || "article";

// ---------------------------------------------------------------- an article's blocks: only what the page can draw
const YT = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/;
export function cleanBody(blocks) {
  const out = [];
  for (const b of Array.isArray(blocks) ? blocks.slice(0, 200) : []) {
    if (!b || typeof b !== "object") continue;
    if ((b.t === "h" || b.t === "p") && String(b.text || "").trim()) out.push({ t: b.t, text: clip(b.text, b.t === "h" ? 200 : 6000) });
    else if (b.t === "steps") { const items = (Array.isArray(b.items) ? b.items : []).map((x) => clip(x, 1200)).filter((x) => x.trim()).slice(0, 40); if (items.length) out.push({ t: "steps", items }); }
    else if (b.t === "img" && /^\/(site-media|help-media)\/[\w./-]{3,120}\.(png|jpe?g|webp|gif)$|^\/img\/[\w./-]{3,120}\.(png|jpe?g|webp|gif|svg)$/.test(String(b.url || ""))) out.push({ t: "img", url: String(b.url), alt: clip(b.alt, 300) });
    else if (b.t === "video") {
      const u = String(b.url || "").trim(), yt = u.match(YT);
      if (yt) out.push({ t: "video", url: "https://www.youtube-nocookie.com/embed/" + yt[1], youtube: yt[1] });
      else if (/^\/help-media\/videos\/[a-f0-9]{16,64}\.(mp4|webm|mov|m4v)$/.test(u)) out.push({ t: "video", url: u });
    }
  }
  return out;
}
const textOf = (body) => body.map((b) => (b.text || "") + " " + (b.items || []).join(" ")).join(" ");

// ---------------------------------------------------------------- the built-in guides
let seeding = null;
export function seedArticles() { return seeding || (seeding = seedOnce().catch((e) => { seeding = null; throw e; })); }
async function seedOnce() {
  let list = [];
  try { list = JSON.parse(fs.readFileSync(new URL("./help-articles.json", import.meta.url), "utf8")).articles || []; } catch (e) { console.error("help articles:", e.message); return; }
  const done = await one("SELECT data FROM site_settings WHERE name='help-seeded'").catch(() => null), had = new Set(done && Array.isArray(done.data.slugs) ? done.data.slugs : []);
  let pos = 0;
  for (const a of list) {
    pos += 10;
    if (had.has(a.slug)) continue;   // (seeded before: staff may have changed or deleted it since)
    await q("INSERT INTO help_articles (slug,title,category,summary,body,position,updated_by) VALUES ($1,$2,$3,$4,$5,$6,'Motion Audio') ON CONFLICT (slug) DO NOTHING",
      [a.slug, a.title, a.category, a.summary || "", JSON.stringify(cleanBody(a.body)), pos]);
    had.add(a.slug);
  }
  await q("INSERT INTO site_settings (name,data,updated_by) VALUES ('help-seeded',$1,'server') ON CONFLICT (name) DO UPDATE SET data=EXCLUDED.data", [{ slugs: [...had] }]);
}
const out = (a, full) => Object.assign({ id: Number(a.id), slug: a.slug, title: a.title, category: a.category, summary: a.summary, position: a.position, published: a.published, updated: a.updated_at, helpful: { yes: a.helpful_yes, no: a.helpful_no } },
  full ? { body: a.body } : { text: clip(textOf(a.body || []), 1200) });

// ---------------------------------------------------------------- tickets
export function newToken() { return crypto.randomBytes(18).toString("base64url"); }
export const ticketLink = (token) => config.publicUrl + "/help/ticket.html#" + token;
async function thread(id) { return q("SELECT from_staff, author, message, created_at FROM support_replies WHERE request_id=$1 ORDER BY id", [id]); }
const ticketOut = async (r, staff) => Object.assign({ id: Number(r.id), subject: r.subject, status: r.status, created: r.created_at, updated: r.updated_at, message: r.message, name: r.name, replies: await thread(r.id) },
  staff ? { email: r.email, app: r.app, version: r.version, user: r.user_id ? Number(r.user_id) : null } : {});

export function routes(api, app, { wrap, requireUser, optionalUser }) {
  const editor = async (req) => { if (!(await isEditor(req.user))) throw bad("Only Motion Audio staff and the website's editors can change the help articles.", 403); await requireStep(req); };
  const staff = async (req) => { if (!isAdmin(req.user)) throw bad("Motion Audio staff only.", 403); await requireStep(req); };
  seedArticles().catch((e) => console.error("help articles:", e.message));

  // ---- articles
  api.get("/help/articles", optionalUser, wrap(async (req, res) => {
    await seedArticles();
    const all = req.user && (await isEditor(req.user));
    const rows = await q("SELECT * FROM help_articles" + (all && req.query.all ? "" : " WHERE published") + " ORDER BY position, id");
    res.json({ categories: CATEGORIES, articles: rows.map((a) => out(a, false)), canEdit: !!all });
  }));
  api.get("/help/articles/:slug", optionalUser, wrap(async (req, res) => {
    await seedArticles();
    const a = await one("SELECT * FROM help_articles WHERE slug=$1", [String(req.params.slug)]);
    if (!a || (!a.published && !(req.user && (await isEditor(req.user))))) throw bad("We couldn't find that article.", 404);
    res.json({ article: out(a, true) });
  }));
  api.post("/help/articles", requireUser, wrap(async (req, res) => {
    await editor(req);
    const b = req.body || {}, title = clip(String(b.title || "").trim(), 160);
    if (!title) throw bad("Give the article a title.");
    const category = CATEGORIES.includes(b.category) ? b.category : CATEGORIES[0], body = cleanBody(b.body);
    const slug = SLUG.test(String(b.slug || "")) ? String(b.slug) : slugify(title);
    let row;
    if (b.id) {
      row = await one("UPDATE help_articles SET slug=$2,title=$3,category=$4,summary=$5,body=$6,published=$7,updated_by=$8,updated_at=now() WHERE id=$1 RETURNING *",
        [Number(b.id), slug, title, category, clip(b.summary, 400), JSON.stringify(body), b.published !== false, req.user.email]).catch((e) => { if (/unique/i.test(e.message)) throw bad("Another article already has that address."); throw e; });
      if (!row) throw bad("That article isn't there any more.", 404);
    } else {
      const last = await one("SELECT COALESCE(MAX(position),0)+10 AS p FROM help_articles");
      let s = slug; for (let i = 2; await one("SELECT 1 FROM help_articles WHERE slug=$1", [s]); i++) s = slug.slice(0, 74) + "-" + i;
      row = await one("INSERT INTO help_articles (slug,title,category,summary,body,position,published,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
        [s, title, category, clip(b.summary, 400), JSON.stringify(body), last.p, b.published !== false, req.user.email]);
    }
    res.json({ ok: true, article: out(row, true) });
  }));
  api.post("/help/articles/:id/delete", requireUser, wrap(async (req, res) => {
    await editor(req);
    await q("DELETE FROM help_articles WHERE id=$1", [Number(req.params.id) || 0]);
    res.json({ ok: true });
  }));
  api.post("/help/articles-order", requireUser, wrap(async (req, res) => {
    await editor(req);
    const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter((x) => x > 0).slice(0, 500);
    for (let i = 0; i < ids.length; i++) await q("UPDATE help_articles SET position=$2 WHERE id=$1", [ids[i], (i + 1) * 10]);
    res.json({ ok: true });
  }));
  const voted = new Map();
  setInterval(() => voted.clear(), 864e5).unref();
  api.post("/help/articles/:slug/helpful", wrap(async (req, res) => {
    const k = req.ip + "|" + req.params.slug; if (voted.has(k)) return res.json({ ok: true, already: true });
    voted.set(k, 1);
    const col = req.body && req.body.yes ? "helpful_yes" : "helpful_no";
    await q("UPDATE help_articles SET " + col + "=" + col + "+1 WHERE slug=$1", [String(req.params.slug)]);
    res.json({ ok: true });
  }));
  // a video for an article: the browser uploads it straight to storage, then the article links /help-media/videos/…
  api.post("/help/media/video", requireUser, wrap(async (req, res) => {
    await editor(req);
    const b = req.body || {}, type = String(b.type || ""), ext = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "video/x-m4v": "m4v" }[type];
    if (!ext) throw bad("Use an MP4, WebM or MOV video.");
    if (!(Number(b.size) > 0) || Number(b.size) > 2 * 1024 ** 3) throw bad("A video can be up to 2 GB.");
    const name = crypto.randomBytes(16).toString("hex") + "." + ext, key = "help-media/videos/" + name;
    res.json({ ok: true, uploadUrl: await store.uploadUrl(key, type), url: "/help-media/videos/" + name });
  }));
  app.get("/help-media/videos/:name", wrap(async (req, res) => {
    if (!/^[a-f0-9]{16,64}\.(mp4|webm|mov|m4v)$/.test(req.params.name)) return res.status(404).end();
    res.set("Cache-Control", "no-store"); res.redirect(302, await store.downloadUrl("help-media/videos/" + req.params.name, req.params.name).then((u) => u.replace(/response-content-disposition=[^&]*&?/i, "")));
  }));

  // ---- tickets: the customer's side
  api.get("/support/mine", requireUser, wrap(async (req, res) => {
    const rows = await q("SELECT * FROM support_requests WHERE user_id=$1 OR lower(email)=lower($2) ORDER BY updated_at DESC LIMIT 50", [req.user.id, req.user.email]);
    res.json({ tickets: await Promise.all(rows.map(async (r) => Object.assign(await ticketOut(r, false), { token: r.token }))) });
  }));
  async function byToken(token) {
    const t = String(token || ""); if (!/^[\w-]{20,40}$/.test(t)) throw bad("That ticket link isn't right.", 404);
    const r = await one("SELECT * FROM support_requests WHERE token=$1", [t]); if (!r) throw bad("That ticket link isn't right.", 404);
    return r;
  }
  api.get("/support/ticket/:token", wrap(async (req, res) => { res.json({ ticket: await ticketOut(await byToken(req.params.token), false) }); }));
  const replyTimes = new Map();
  api.post("/support/ticket/:token/reply", wrap(async (req, res) => {
    const r = await byToken(req.params.token), msg = clip(String((req.body || {}).message || "").trim(), 8000);
    if (msg.length < 2) throw bad("Write your answer first.");
    const now = Date.now(), t = (replyTimes.get(r.id) || []).filter((x) => now - x < 3600e3); if (t.length >= 20) throw bad("That's a lot of messages in an hour. We'll read what's here first.", 429);
    t.push(now); replyTimes.set(r.id, t);
    await q("INSERT INTO support_replies (request_id,from_staff,author,message) VALUES ($1,FALSE,$2,$3)", [r.id, r.name || r.email, msg]);
    await q("UPDATE support_requests SET status='open', updated_at=now() WHERE id=$1", [r.id]);
    if (config.supportEmail && mailOn) await sendMail(config.supportEmail, "[Support #" + r.id + "] " + r.subject + " (they answered)", (r.name || r.email) + " answered on the website:\n\n" + msg + "\n\nThe ticket: " + config.publicUrl + "/#account (Staff → Support)\n",
      '<div style="font:15px/1.5 system-ui,sans-serif"><p><b>' + escHtml(r.name || r.email) + '</b> answered on the website:</p><p style="white-space:pre-wrap">' + escHtml(msg) + "</p></div>", r.email);
    res.json({ ok: true, ticket: await ticketOut(await byToken(req.params.token), false) });
  }));

  // ---- tickets: Motion Audio staff
  api.get("/admin/support", requireUser, wrap(async (req, res) => {
    await staff(req);
    const st = ["open", "waiting", "closed"].includes(req.query.status) ? req.query.status : null;
    const rows = await q("SELECT * FROM support_requests" + (st ? " WHERE status=$1" : "") + " ORDER BY (status='open') DESC, updated_at DESC LIMIT 100", st ? [st] : []);
    const counts = await q("SELECT status, COUNT(*)::int AS n FROM support_requests GROUP BY status");
    res.json({ tickets: await Promise.all(rows.map((r) => ticketOut(r, true))), counts: Object.fromEntries(counts.map((c) => [c.status, c.n])), mailOn: !!(mailOn && config.supportEmail) });
  }));
  api.post("/admin/support/:id/reply", requireUser, wrap(async (req, res) => {
    await staff(req);
    const r = await one("SELECT * FROM support_requests WHERE id=$1", [Number(req.params.id) || 0]); if (!r) throw bad("That ticket isn't there.", 404);
    const msg = clip(String((req.body || {}).message || "").trim(), 8000), status = ["open", "waiting", "closed"].includes(req.body.status) ? req.body.status : "waiting";
    if (msg) await q("INSERT INTO support_replies (request_id,from_staff,author,message) VALUES ($1,TRUE,$2,$3)", [r.id, req.user.name || "Motion Audio support", msg]);
    if (!r.token) await q("UPDATE support_requests SET token=$2 WHERE id=$1", [r.id, newToken()]);
    const fresh = await one("UPDATE support_requests SET status=$2, updated_at=now() WHERE id=$1 RETURNING *", [r.id, status]);
    let sent = false;
    if (msg && mailOn) {
      const link = ticketLink(fresh.token);
      const m = await sendMail(r.email, "Re: " + (r.subject || "your message") + " [#" + r.id + "]", msg + "\n\nTo answer, use this link (replies to this email don't reach us yet):\n" + link + "\n\nMotion Audio support\n",
        '<div style="font:15px/1.5 system-ui,sans-serif"><p style="white-space:pre-wrap">' + escHtml(msg) + '</p><p><a href="' + escHtml(link) + '">Answer on the website</a> (replies to this email don\'t reach us yet)</p><p>Motion Audio support</p></div>', config.supportEmail || undefined);
      sent = !!m.sent;
    }
    res.json({ ok: true, sent, ticket: await ticketOut(fresh, true) });
  }));
}
