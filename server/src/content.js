// The website's own words and pictures, edited right on the page (edit mode).
// Who edits: Motion Audio staff (ADMIN_EMAILS) and the editors staff add on the Editors card. Staff also change prices
// in edit mode (the same price list as the price page); editors change words, pictures and sections.
// Kept in site_settings 'content':
//   text    { key: html }        the page's words, by the data-edit key of each element (sanitized)
//   images  { key: url }         pictures, by data-edit-img key (uploaded to storage, served from /site-media/)
//   hidden  [section ids]        sections switched off
//   blocks  [{ id, type, after, title, body, items }]   added sections: "text", "faq", "quotes", "picture"
// and site_settings 'editors' { emails: [] }.
import crypto from "node:crypto";
import { q, one } from "./db.js";
import { isAdmin } from "./auth.js";
import { requireStep } from "./signin.js";
import * as store from "./storage.js";

function bad(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }
const EMPTY = { text: {}, images: {}, hidden: [], blocks: [] };

let cache = { at: 0, data: null, by: "", when: null };
export async function getContent() {
  if (cache.data && Date.now() - cache.at < 30e3) return cache;
  const r = await one("SELECT data, updated_at, updated_by FROM site_settings WHERE name='content'").catch(() => null);
  cache = { at: Date.now(), data: Object.assign({}, EMPTY, r ? r.data : {}), by: r ? r.updated_by : "", when: r ? r.updated_at : null };
  return cache;
}
export async function editorEmails() {
  const r = await one("SELECT data FROM site_settings WHERE name='editors'").catch(() => null);
  return r && Array.isArray(r.data.emails) ? r.data.emails : [];
}
export async function isEditor(user) { return !!user && (isAdmin(user) || (await editorEmails()).includes(String(user.email).toLowerCase())); }

// ---- the words are HTML from contenteditable: keep plain formatting and links, nothing that runs
const TAGS = new Set(["b", "strong", "i", "em", "u", "br", "p", "ul", "ol", "li", "a", "h2", "h3", "h4", "span", "small", "div", "blockquote", "s", "sup", "sub"]);
export function sanitize(html) {
  let s = String(html == null ? "" : html).slice(0, 200000);
  s = s.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|iframe|object|embed|svg|math|template|noscript|textarea|select|form)[\s\S]*?<\/\1\s*>/gi, "");
  return s.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (m, tag, attrs) => {
    const t = tag.toLowerCase(); if (!TAGS.has(t)) return "";
    if (m.startsWith("</")) return "</" + t + ">";
    let keep = "";
    if (t === "a") {
      const h = attrs.match(/\shref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i), href = h ? (h[2] ?? h[3] ?? h[4] ?? "").trim() : "";
      if (/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(href) && !/["<>]/.test(href)) keep = ' href="' + href.replace(/&(?!amp;|#)/g, "&amp;") + '"' + (/^https?:/i.test(href) ? ' target="_blank" rel="noopener"' : "");
    }
    return "<" + t + keep + ">";
  }).replace(/javascript:/gi, "").replace(/<(?!\/?(?:b|strong|i|em|u|br|p|ul|ol|li|a|h2|h3|h4|span|small|div|blockquote|s|sup|sub)(?:\s[^<>]*)?>)/g, "&lt;");
}
const plain = (v, n) => String(v == null ? "" : v).replace(/[<>]/g, "").trim().slice(0, n || 300);
const okKey = (k) => /^[a-z0-9][a-z0-9._-]{0,80}$/i.test(k);
function clean(b) {
  const out = { text: {}, images: {}, hidden: [], blocks: [] };
  for (const [k, v] of Object.entries(b.text || {})) if (okKey(k)) out.text[k] = sanitize(v);
  for (const [k, v] of Object.entries(b.images || {})) if (okKey(k) && /^\/site-media\/[a-f0-9]{16,64}\.(png|jpe?g|webp|gif)$/.test(String(v))) out.images[k] = String(v);
  out.hidden = (Array.isArray(b.hidden) ? b.hidden : []).filter((k) => okKey(String(k))).slice(0, 100);
  out.blocks = (Array.isArray(b.blocks) ? b.blocks : []).slice(0, 60).map((x) => ({
    id: okKey(String(x.id || "")) ? String(x.id) : "b" + crypto.randomBytes(4).toString("hex"),
    type: ["text", "faq", "quotes", "picture"].includes(x.type) ? x.type : "text",
    after: okKey(String(x.after || "")) ? String(x.after) : "store",
    title: sanitize(x.title || ""), body: sanitize(x.body || ""),
    image: /^\/site-media\/[a-f0-9]{16,64}\.(png|jpe?g|webp|gif)$/.test(String(x.image || "")) ? String(x.image) : "",
    items: (Array.isArray(x.items) ? x.items : []).slice(0, 40).map((it) => ({ q: sanitize(it.q || ""), a: sanitize(it.a || ""), who: plain(it.who, 120) })),
  }));
  if (JSON.stringify(out).length > 1500000) throw bad("That's more than the site can keep (1.5 MB of words). Shorten something and save again.");
  return out;
}
// what kind of picture a file really is (from its first bytes, not its name)
function imageType(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf.slice(1, 4).toString() === "PNG") return ["png", "image/png"];
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ["jpg", "image/jpeg"];
  if (buf.length > 12 && buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return ["webp", "image/webp"];
  if (buf.length > 6 && /^GIF8[79]a/.test(buf.slice(0, 6).toString())) return ["gif", "image/gif"];
  return null;
}

export function routes(app, api, { wrap, requireUser }) {
  // the page's content, for everyone (the website lays it over its built-in words)
  api.get("/content", wrap(async (_req, res) => {
    const c = await getContent();
    res.setHeader("Cache-Control", "no-cache");
    res.json(Object.assign({}, c.data, { updatedAt: c.when, updatedBy: undefined }));
  }));
  // am I an editor? (the page shows the Edit page button)
  api.get("/editor", requireUser, wrap(async (req, res) => { res.json({ editor: await isEditor(req.user), staff: isAdmin(req.user) }); }));
  const editor = async (req) => { if (!(await isEditor(req.user))) throw bad("Only Motion Audio staff and the website's editors can change the page.", 403); await requireStep(req); };
  api.post("/admin/content", requireUser, wrap(async (req, res) => {
    await editor(req);
    const data = clean(req.body.content || {});
    await q("INSERT INTO site_settings (name,data,updated_by) VALUES ('content',$1,$2) ON CONFLICT (name) DO UPDATE SET data=EXCLUDED.data, updated_at=now(), updated_by=EXCLUDED.updated_by", [data, req.user.email]);
    cache.at = 0;
    res.json({ ok: true, content: data });
  }));
  // a picture: { name, data: base64 } -> { url }
  api.post("/admin/content/image", requireUser, wrap(async (req, res) => {
    await editor(req);
    const buf = Buffer.from(String(req.body.data || "").replace(/^data:[^,]*,/, ""), "base64");
    if (!buf.length) throw bad("Choose a picture.");
    if (buf.length > 8 * 1024 * 1024) throw bad("That picture is over 8 MB. Make it smaller (2000 pixels wide is plenty) and try again.");
    const t = imageType(buf); if (!t) throw bad("Use a PNG, JPEG, WebP or GIF picture.");
    const name = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 32) + "." + t[0];
    await store.putFile("site-media/" + name, buf, t[1]);
    res.json({ ok: true, url: "/site-media/" + name });
  }));
  // editors (staff only)
  const staff = async (req) => { if (!isAdmin(req.user)) throw bad("Motion Audio staff only.", 403); await requireStep(req); };
  api.get("/admin/editors", requireUser, wrap(async (req, res) => { await staff(req); res.json({ emails: await editorEmails() }); }));
  api.post("/admin/editors", requireUser, wrap(async (req, res) => {
    await staff(req);
    const emails = [...new Set((Array.isArray(req.body.emails) ? req.body.emails : []).map((e) => String(e).trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))].slice(0, 50);
    await q("INSERT INTO site_settings (name,data,updated_by) VALUES ('editors',$1,$2) ON CONFLICT (name) DO UPDATE SET data=EXCLUDED.data, updated_at=now(), updated_by=EXCLUDED.updated_by", [{ emails }, req.user.email]);
    res.json({ ok: true, emails });
  }));
  // the pictures themselves (named by their contents, so they can be cached for good)
  app.get("/site-media/:name", wrap(async (req, res) => {
    const m = String(req.params.name).match(/^([a-f0-9]{16,64})\.(png|jpe?g|webp|gif)$/); if (!m) return res.status(404).end();
    let buf; try { buf = await store.readFile("site-media/" + req.params.name); } catch (_) { return res.status(404).end(); }
    res.setHeader("Content-Type", { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" }[m[2]]);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable"); res.setHeader("X-Content-Type-Options", "nosniff");
    res.end(buf);
  }));
}
