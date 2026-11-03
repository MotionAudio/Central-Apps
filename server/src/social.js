// Shorts (10.2): connecting a church's YouTube, Facebook / Instagram (one Meta sign-in) and TikTok so Central Control
// can post its shorts with one click. The church signs in on the platform's own page; the website keeps the tokens
// (encrypted with TOKEN_SECRET) and hands Central Control a fresh access token when it posts, so the platforms' app
// secrets never leave the server. Each platform stays off until Motion Audio adds its app keys in Render:
//   YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET      (Google Cloud: an OAuth client, the YouTube Data API v3)
//   META_APP_ID, META_APP_SECRET                  (Meta for Developers: Facebook Login, Pages, Instagram Graph API)
//   TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET       (TikTok for Developers: Login Kit, Content Posting API)
// docs/SHORTS.md says how to register each one. A church's connection belongs to the church (anyone with an admin
// role posts with it); someone without a church keeps their own.
//   GET  /v1/social/status                  each platform: available (keys added), connected, the account's name
//   POST /v1/social/:platform/start         the platform's sign-in page to open ({ url })
//   GET  /v1/social/:platform/callback      where the platform sends the person back (a page that says it worked)
//   POST /v1/social/:platform/token         a fresh token to post with (and the page / Instagram account for Meta)
//   POST /v1/social/:platform/disconnect
import crypto from "node:crypto";
import { q, one } from "./db.js";
import { config } from "./config.js";
import { churchOf } from "./licenses.js";

const env = process.env;
// (tests: SOCIAL_TEST_BASE points every platform at a stand-in server)
const T = env.SOCIAL_TEST_BASE ? env.SOCIAL_TEST_BASE.replace(/\/+$/, "") : null;
const u = (real, path) => T ? T + path : real;
export const PLATFORMS = {
  youtube: { label: "YouTube", id: () => env.YOUTUBE_CLIENT_ID, secret: () => env.YOUTUBE_CLIENT_SECRET,
    auth: u("https://accounts.google.com/o/oauth2/v2/auth", "/google/auth"), token: u("https://oauth2.googleapis.com/token", "/google/token"),
    scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly https://www.googleapis.com/auth/youtube.force-ssl", extra: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" } },
  meta: { label: "Facebook and Instagram", id: () => env.META_APP_ID, secret: () => env.META_APP_SECRET,
    auth: u("https://www.facebook.com/v21.0/dialog/oauth", "/meta/auth"), token: u("https://graph.facebook.com/v21.0/oauth/access_token", "/meta/token"), graph: u("https://graph.facebook.com/v21.0", "/meta/graph"),
    scope: "pages_show_list,pages_read_engagement,pages_manage_posts,publish_video,instagram_basic,instagram_content_publish,instagram_manage_insights,read_insights,business_management", extra: {} },
  tiktok: { label: "TikTok", id: () => env.TIKTOK_CLIENT_KEY, secret: () => env.TIKTOK_CLIENT_SECRET,
    auth: u("https://www.tiktok.com/v2/auth/authorize/", "/tiktok/auth"), token: u("https://open.tiktokapis.com/v2/oauth/token/", "/tiktok/token"), api: u("https://open.tiktokapis.com", "/tiktok/api"),
    scope: "user.info.basic,video.upload,video.publish", extra: {} }
};
const ALIAS = { facebook: "meta", instagram: "meta", youtube: "youtube", meta: "meta", tiktok: "tiktok" };
function bad(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }
function platformOf(p) { const k = ALIAS[String(p || "").toLowerCase()]; if (!k) throw bad("That isn't a platform Central Control posts to.", 404); return k; }
const available = (k) => !!(PLATFORMS[k].id() && PLATFORMS[k].secret());
const redirect = (k) => config.publicUrl + "/v1/social/" + k + "/callback";

// ---------------------------------------------------------------- the tokens, encrypted
const KEY = () => crypto.createHash("sha256").update("social-tokens:" + config.tokenSecret).digest();
function seal(obj) { const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", KEY(), iv); const enc = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]); return Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64"); }
function open(s) { const b = Buffer.from(String(s || ""), "base64"); const d = crypto.createDecipheriv("aes-256-gcm", KEY(), b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8")); }
// the state that comes back with the person: who started it, for which platform, and when (signed, 15 minutes)
function stateFor(userId, k) { const body = Buffer.from(JSON.stringify({ u: userId, k, n: crypto.randomBytes(8).toString("hex"), e: Date.now() + 15 * 60e3 })).toString("base64url"); return body + "." + crypto.createHmac("sha256", config.tokenSecret).update("social:" + body).digest("base64url"); }
function readState(s) { const [body, sig] = String(s || "").split("."); if (!body || !sig) return null; const want = crypto.createHmac("sha256", config.tokenSecret).update("social:" + body).digest("base64url"); if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null; const o = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); return o.e > Date.now() ? o : null; }

async function scopeOf(userId) { const c = await churchOf(userId); return c ? "c:" + c.id : "u:" + userId; }
async function form(url, params) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams(params).toString() });
  const j = await r.json().catch(() => ({})); if (!r.ok || j.error) throw bad((PLATFORMS.meta && j.error && j.error.message) || j.error_description || j.error || ("The platform answered " + r.status), 502); return j;
}
async function getJson(url, headers) { const r = await fetch(url, { headers: Object.assign({ Accept: "application/json" }, headers || {}) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw bad((j.error && (j.error.message || j.error)) || ("The platform answered " + r.status), 502); return j; }

// after the sign-in: the code -> tokens -> the account's name (and for Meta: the Page and its Instagram account)
async function exchange(k, code) {
  const P = PLATFORMS[k];
  if (k === "youtube") {
    const t = await form(P.token, { code, client_id: P.id(), client_secret: P.secret(), redirect_uri: redirect(k), grant_type: "authorization_code" });
    let account = "YouTube channel", avatar = ""; try { const ch = await getJson(u("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", "/google/channels"), { Authorization: "Bearer " + t.access_token }); if (ch.items && ch.items[0]) { account = ch.items[0].snippet.title; const th = ch.items[0].snippet.thumbnails || {}; avatar = ((th.default || th.medium || {}).url) || ""; } } catch (_) { }
    return { account, avatar, data: { access: t.access_token, refresh: t.refresh_token, expires: Date.now() + (Number(t.expires_in) || 3600) * 1000, scopes: String(t.scope || "") } };
  }
  if (k === "meta") {
    const short = await getJson(P.token + "?" + new URLSearchParams({ client_id: P.id(), client_secret: P.secret(), redirect_uri: redirect(k), code }));
    const long = await getJson(P.token + "?" + new URLSearchParams({ grant_type: "fb_exchange_token", client_id: P.id(), client_secret: P.secret(), fb_exchange_token: short.access_token }));
    const pages = await getJson(P.graph + "/me/accounts?" + new URLSearchParams({ fields: "id,name,access_token,picture{url},instagram_business_account{id,username,profile_picture_url}", access_token: long.access_token }));
    const pg = (pages.data || [])[0]; if (!pg) throw bad("That Facebook account doesn't manage a Facebook Page. Shorts post to a Page (and its Instagram professional account).");
    const ig = pg.instagram_business_account || null;
    let granted = ""; try { const pm = await getJson(P.graph + "/me/permissions?" + new URLSearchParams({ access_token: long.access_token })); granted = (pm.data || []).filter((x) => x.status === "granted").map((x) => x.permission).join(","); } catch (_) { }
    return { account: pg.name + (ig && ig.username ? " · @" + ig.username : ""), avatar: (pg.picture && pg.picture.data && pg.picture.data.url) || (ig && ig.profile_picture_url) || "", data: { igAvatar: ig ? ig.profile_picture_url || "" : "", pageAvatar: (pg.picture && pg.picture.data && pg.picture.data.url) || "", scopes: granted, user: long.access_token, page: pg.id, pageName: pg.name, pageToken: pg.access_token, ig: ig ? ig.id : null, igName: ig ? ig.username : null, pages: (pages.data || []).map((p) => ({ id: p.id, name: p.name })) } };
  }
  const t = await form(P.token, { client_key: P.id(), client_secret: P.secret(), code, grant_type: "authorization_code", redirect_uri: redirect(k) });
  let account = "TikTok account", avatar = ""; try { const me = await getJson(P.api + "/v2/user/info/?fields=display_name,avatar_url", { Authorization: "Bearer " + t.access_token }); if (me.data && me.data.user) { account = me.data.user.display_name; avatar = me.data.user.avatar_url || ""; } } catch (_) { }
  return { account, avatar, data: { access: t.access_token, refresh: t.refresh_token, expires: Date.now() + (Number(t.expires_in) || 86400) * 1000, openId: t.open_id } };
}
// a token good for the next hour (refreshed with the stored refresh token when needed)
async function fresh(k, row) {
  const d = open(row.data_enc), P = PLATFORMS[k];
  if (k === "meta") return { accessToken: d.pageToken, pageId: d.page, pageName: d.pageName, igUserId: d.ig, igName: d.igName };
  if (d.expires && d.expires > Date.now() + 10 * 60e3) return { accessToken: d.access, expiresAt: d.expires, openId: d.openId };
  if (!d.refresh) throw bad(P.label + " needs to be connected again (Shorts → Connect).", 409);
  const t = k === "youtube" ? await form(P.token, { client_id: P.id(), client_secret: P.secret(), refresh_token: d.refresh, grant_type: "refresh_token" })
    : await form(P.token, { client_key: P.id(), client_secret: P.secret(), refresh_token: d.refresh, grant_type: "refresh_token" });
  d.access = t.access_token; d.expires = Date.now() + (Number(t.expires_in) || 3600) * 1000; if (t.refresh_token) d.refresh = t.refresh_token;
  await q("UPDATE social_accounts SET data_enc=$3, updated_at=now() WHERE scope=$1 AND platform=$2", [row.scope, k, seal(d)]);
  return { accessToken: d.access, expiresAt: d.expires, openId: d.openId };
}

function page(title, text, okay) {
  return "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>" + title + "</title><body style='font:17px system-ui,sans-serif;background:#111418;color:#e9ecef;display:grid;place-items:center;min-height:100vh;margin:0'><div style='max-width:460px;padding:28px;text-align:center'><h1 style='font-size:24px;margin:0 0 10px;color:" + (okay ? "#7bd88f" : "#ff8a80") + "'>" + title + "</h1><p style='line-height:1.5;color:#b8c0c8'>" + text + "</p></div></body>";
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function routes(api, { wrap, requireUser }) {
  api.get("/social/status", requireUser, wrap(async (req, res) => {
    const scope = await scopeOf(req.user.id), rows = await q("SELECT platform, account, avatar, connected_by, updated_at FROM social_accounts WHERE scope=$1", [scope]);
    const row = (k) => rows.find((r) => r.platform === k);
    const meta = row("meta"); let metaData = null; if (meta) { try { metaData = open((await one("SELECT data_enc FROM social_accounts WHERE scope=$1 AND platform='meta'", [scope])).data_enc); } catch (_) { } }
    let ytData = null; if (row("youtube")) { try { ytData = open((await one("SELECT data_enc FROM social_accounts WHERE scope=$1 AND platform='youtube'", [scope])).data_enc); } catch (_) { } }
    const numbers = { youtube: !!(ytData && /yt-analytics\.readonly/.test(ytData.scopes || "")), facebook: !!(metaData && /read_insights/.test(metaData.scopes || "")), instagram: !!(metaData && /instagram_manage_insights/.test(metaData.scopes || "")) };
    const one_ = (k, extra) => Object.assign({ available: available(k), connected: !!row(k), account: row(k) ? row(k).account : null, avatar: row(k) ? row(k).avatar || null : null, by: row(k) ? row(k).connected_by : null }, extra || {});
    res.json({ platforms: {
      youtube: one_("youtube", { numbers: numbers.youtube }),
      facebook: Object.assign(one_("meta"), { account: metaData ? metaData.pageName : null, numbers: numbers.facebook, avatar: metaData ? metaData.pageAvatar || null : null }),
      instagram: Object.assign(one_("meta"), { connected: !!(metaData && metaData.ig), account: metaData && metaData.igName ? "@" + metaData.igName : null, why: meta && metaData && !metaData.ig ? "The Facebook Page has no Instagram professional account linked to it." : null, numbers: numbers.instagram, avatar: metaData ? metaData.igAvatar || null : null }),
      tiktok: one_("tiktok", { numbers: false })
    } });
  }));
  api.post("/social/:platform/start", requireUser, wrap(async (req, res) => {
    const k = platformOf(req.params.platform), P = PLATFORMS[k];
    if (!available(k)) throw bad(P.label + " posting isn't switched on yet: Motion Audio still has to add its app keys.", 503);
    const params = Object.assign({ response_type: "code", redirect_uri: redirect(k), state: stateFor(req.user.id, k), scope: P.scope }, P.extra);
    if (k === "tiktok") params.client_key = P.id(); else params.client_id = P.id();
    res.json({ url: P.auth + "?" + new URLSearchParams(params).toString() });
  }));
  api.get("/social/:platform/callback", wrap(async (req, res) => {
    let k = null; try { k = platformOf(req.params.platform); } catch (_) { }
    const st = readState(req.query.state);
    if (!k || !st || st.k !== k) return res.status(400).type("html").send(page("That didn't work", "The sign-in link was old or not from Central Control. Go back to Central Control and press Connect again.", false));
    if (req.query.error) return res.status(400).type("html").send(page("Not connected", esc(String(req.query.error_description || req.query.error_message || "You didn't allow it.")) + " You can try again from Central Control → Shorts.", false));
    try {
      const got = await exchange(k, String(req.query.code || ""));
      const scope = await scopeOf(st.u), who = await one("SELECT email FROM users WHERE id=$1", [st.u]);
      const avatar = /^https:\/\//.test(String(got.avatar || "")) ? String(got.avatar).slice(0, 600) : "";
      await q("INSERT INTO social_accounts (scope,platform,account,data_enc,connected_by,avatar) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (scope,platform) DO UPDATE SET account=EXCLUDED.account, data_enc=EXCLUDED.data_enc, connected_by=EXCLUDED.connected_by, avatar=EXCLUDED.avatar, updated_at=now()", [scope, k, String(got.account || "").slice(0, 120), seal(got.data), who ? who.email : "", avatar]);
      res.type("html").send(page(PLATFORMS[k].label + " is connected", "Shorts will post to <b>" + esc(got.account) + "</b>. You can close this page and go back to Central Control.", true));
    } catch (e) { res.status(502).type("html").send(page("Not connected", esc(e.message) + " Go back to Central Control and try again.", false)); }
  }));
  api.post("/social/:platform/token", requireUser, wrap(async (req, res) => {
    const k = platformOf(req.params.platform);
    if (!available(k)) throw bad(PLATFORMS[k].label + " posting isn't switched on yet.", 503);
    const row = await one("SELECT * FROM social_accounts WHERE scope=$1 AND platform=$2", [await scopeOf(req.user.id), k]);
    if (!row) throw bad("Connect " + PLATFORMS[k].label + " first (Shorts → Connect).", 409);
    res.json(Object.assign({ platform: k, account: row.account }, await fresh(k, row)));
  }));
  api.post("/social/:platform/disconnect", requireUser, wrap(async (req, res) => {
    const k = platformOf(req.params.platform);
    await q("DELETE FROM social_accounts WHERE scope=$1 AND platform=$2", [await scopeOf(req.user.id), k]);
    res.json({ ok: true });
  }));
}
export const _test = { seal, open, stateFor, readState };
