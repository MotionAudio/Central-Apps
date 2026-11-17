// Device codes and the Central Burner app (private: the owner and the people the owner adds as Burners).
//
// The Central Burner app (Ubuntu, central-native/apps/burner) puts the software on every device and gives each one a
// code that is its own for life: P pedal · C control box · I input box · O output box, then 15 to 25 random numbers.
// The code is written into the device's one-time chip, where it can never be changed, and kept here with what the
// device is, its board revision and batch, the software, who burned it and when. No keys or signatures.
//   Pedal, control box (CM5)  the code goes with the CM5's serial when it's burned, and the burner leaves the code and
//                             a one-time pass on its boot partition (central-device.json). At its first start the
//                             device writes the code into its chip, then checks in with pedals.js, which asks this file
//                             through setDeviceClaim: the right pass ties the code to that chip's serial for good, and
//                             its update checks have to come from that chip (pedals.js). docs/DEVICE-CODES.md.
//   Input, output box (STM32) the burner reads the chip's serial while the new firmware waits, gets the code here, and
//                             the firmware writes it into the chip for good.
// Burning the same chip again keeps its code. A scrapped board's code can be freed (the owner); never given out again.
//
// The zips: the GitHub builds (central-native's .github/workflows/burner-zips.yml) send each one here as it's made
// (POST /burn/upload, signed in as that GitHub job with its OIDC token: no secret to set anywhere), into the site's own
// storage; the app asks here and gets a short-lived download link. Without any sent here yet, the newest GitHub
// releases are used when GITHUB_TOKEN is set (BURN_REPO, private). The app can also burn a zip from the computer.
//
//   GET  /burn/me                       can this account burn?
//   GET  /burn/software                 the newest zip for each slot (and the burner app itself)
//   POST /burn/upload · /burn/upload/:id/done   a GitHub build of BURN_REPO sending a zip (its OIDC token, not an account)
//   GET  /burn/software/:asset/link     a short-lived download link for one of them
//   POST /burn/claim                    the chip's code (new or kept): {kind, chip | serial, use?, mac?, software?,
//                                       boardRev?, batch?, peek?}; pedal / control: + a new one-time pass
//   POST /burn/done                     {code, chip, software, sha256?, ok, notes?} → the burn in the history
//   GET  /burn/devices?q=               the codes, newest first
//   POST /burn/devices/:code/free       {why} the owner only: a scrapped board's code stops working
//   GET  /admin/burners · POST /admin/burners {email} · POST /admin/burners/delete {email}   the owner only
import crypto from "node:crypto";
import { q, one } from "./db.js";
import { isOwner } from "./auth.js";
import { requireStep } from "./signin.js";
import { setDeviceClaim } from "./pedals.js";
import * as store from "./storage.js";

function bad(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }

export const KINDS = {
  pedal: { letter: "P", name: "Central Pedal" },
  control: { letter: "C", name: "Control box" },
  input: { letter: "I", name: "Input box" },
  output: { letter: "O", name: "Output box" },
};
export const USES = { pedal: "Pad pedal outputs", inears: "In-ears", wave: "Central Waves" };
// the slots the app burns from, and the file names that fill them on GitHub (newest release first)
export const SLOTS = [
  { id: "pedal", kind: "pedal", name: "Central Pedal", match: /^central-pedal[-_](?!control|rp2040)[\w.+-]*\.zip$/i },
  { id: "control-pedal", kind: "control", use: "pedal", name: "Control box: pad pedal outputs", match: /^central-(?:io|control-box)[-_](?:pedal|outputs?)[-_][\w.+-]*\.zip$/i },
  { id: "control-inears", kind: "control", use: "inears", name: "Control box: in-ears", match: /^central-(?:io|control-box)[-_]in-?ears[-_][\w.+-]*\.zip$/i },
  { id: "control-wave", kind: "control", use: "wave", name: "Control box: Central Waves", match: /^central-(?:io|control-box)[-_]waves?[-_][\w.+-]*\.zip$/i },
  { id: "input", kind: "input", name: "Input box", match: /^central-input(?:[-_]?(?:box|8))?[-_][\w.+-]*\.zip$/i },
  { id: "output", kind: "output", name: "Output box", match: /^central-output(?:[-_]?(?:box|8))?[-_][\w.+-]*\.zip$/i },
  { id: "burner", name: "Central Burner app (Ubuntu)", match: /^central-burner[-_][\w.+-]*(?:amd64|x86_64)[\w.+-]*\.deb$/i },
];
// a chip's factory ID, the same however it was read: lower-case hex, no spaces, colons or leading zeros
export function cleanChip(s) { return String(s || "").toLowerCase().replace(/^0x/, "").replace(/[^0-9a-f]/g, "").replace(/^0+(?=.)/, "").slice(0, 64); }
export function cleanMac(s) { const h = String(s || "").toLowerCase().replace(/[^0-9a-f]/g, ""); return h.length === 12 ? h.match(/../g).join(":") : ""; }
// the same chip? The CM5's serial reads as 8 or 16 hex digits depending on where it's read (the USB boot ROM or the
// running system), so the longer may end with the shorter, as long as that's at least 8 digits. Or the same Ethernet
// address, when both sides have one.
export function sameChip(row, chip, mac) {
  const a = cleanChip(row.chip), b = cleanChip(chip);
  if (a && b) {
    if (a === b) return true;
    const [s, l] = a.length <= b.length ? [a, b] : [b, a];
    if (s.length >= 8 && l.endsWith(s)) return true;
  }
  const m = cleanMac(mac);
  return !!(row.mac && m && row.mac === m);
}
// a new code: the kind's letter and 15-25 random numbers (any of them may be 0). It fits the chip's 32 bytes.
export function newCode(kind) {
  const k = KINDS[kind]; if (!k) throw bad("Unknown kind of device.");
  const n = crypto.randomInt(15, 26);
  let s = k.letter;
  for (let i = 0; i < n; i++) s += String(crypto.randomInt(0, 10));
  return s;
}
export const CODE_RE = /^[PCIO]\d{15,25}$/;

export async function canBurn(user) {
  if (!user || user.email_confirmed === false) return false;
  if (isOwner(user)) return true;
  return !!(await one("SELECT 1 FROM burners WHERE email=$1", [String(user.email || "").toLowerCase()]).catch(() => null));
}
async function gate(req) {
  if (!(await canBurn(req.user))) throw bad("Only the website's owner and the people they add as Burners can use the Central Burner.", 403);
  await requireStep(req);
}
async function ownerGate(req) {
  if (!isOwner(req.user)) throw bad("Only the website's owner can do this.", 403);
  await requireStep(req);
}

// ---------------------------------------------------------------- GitHub (the private repo's releases)
const repo = () => process.env.BURN_REPO || "MotionAudio/central-native";
const ghApi = () => (process.env.BURN_GITHUB_API || "https://api.github.com").replace(/\/+$/, "");
function ghHeaders(accept) {
  const h = { Accept: accept || "application/vnd.github+json", "User-Agent": "motion-audio-burner", "X-GitHub-Api-Version": "2022-11-28" };
  const t = process.env.GITHUB_TOKEN || process.env.BURN_GITHUB_TOKEN;
  if (t) h.Authorization = "Bearer " + t;
  return h;
}
let relCache = { at: 0, list: null };
async function releases() {
  if (relCache.list && Date.now() - relCache.at < 60e3) return relCache.list;
  const r = await fetch(ghApi() + "/repos/" + repo() + "/releases?per_page=40", { headers: ghHeaders(), signal: AbortSignal.timeout(15000) }).catch((e) => ({ ok: false, status: 0, why: e.message }));
  if (!r.ok) {
    if (r.status === 404 || r.status === 401) throw bad("The website can't read the releases of " + repo() + " on GitHub. Set GITHUB_TOKEN on Render to a token that can read that repo.", 502);
    throw bad("GitHub didn't answer (" + (r.status || r.why) + "). Try again in a minute.", 502);
  }
  const list = (await r.json()).filter((x) => !x.draft);
  relCache = { at: Date.now(), list };
  return list;
}
const verOf = (rel, name) => { const m = String(name).match(/[-_]v?(\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?)(?=[-_.](?:zip|deb|amd64|x86_64|arm64))/i) || String(rel.tag_name || "").match(/(\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?)/); return m ? m[1] : rel.tag_name || ""; };
// ---------------------------------------------------------------- the zips the GitHub builds send here
// A GitHub Actions job proves who it is with its OIDC token (RS256, from token.actions.githubusercontent.com, for the
// audience "motionaudio-burner"): only a job in BURN_REPO is let in.
const OIDC_ISSUER = "https://token.actions.githubusercontent.com", OIDC_AUDIENCE = "motionaudio-burner";
const jwksUrl = () => process.env.BURN_OIDC_JWKS || OIDC_ISSUER + "/.well-known/jwks";
let jwks = { at: 0, keys: [] };
async function oidcKeys(kid) {
  if (!jwks.keys.some((k) => k.kid === kid) || Date.now() - jwks.at > 3600e3) {
    const r = await fetch(jwksUrl(), { signal: AbortSignal.timeout(10000) }).catch(() => null);
    if (r && r.ok) jwks = { at: Date.now(), keys: ((await r.json()) || {}).keys || [] };
  }
  return jwks.keys.find((k) => k.kid === kid) || null;
}
export async function githubJob(req) {
  const m = String(req.headers.authorization || "").match(/^Bearer\s+([\w-]+)\.([\w-]+)\.([\w-]+)$/);
  if (!m) throw bad("Only a GitHub build can send the burner's zips.", 401);
  let head, claims;
  try { head = JSON.parse(Buffer.from(m[1], "base64url")); claims = JSON.parse(Buffer.from(m[2], "base64url")); } catch { throw bad("That isn't a GitHub token.", 401); }
  if (head.alg !== "RS256" || !head.kid) throw bad("That isn't a GitHub token.", 401);
  const jwk = await oidcKeys(head.kid);
  if (!jwk) throw bad("GitHub's keys don't know that token.", 401);
  const ok = crypto.verify("RSA-SHA256", Buffer.from(m[1] + "." + m[2]), crypto.createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(m[3], "base64url"));
  const now = Date.now() / 1000;
  if (!ok || claims.iss !== OIDC_ISSUER || [].concat(claims.aud).indexOf(OIDC_AUDIENCE) < 0 || !(claims.exp > now) || (claims.nbf && claims.nbf > now + 60)) throw bad("That GitHub token doesn't check out.", 401);
  if (String(claims.repository || "").toLowerCase() !== repo().toLowerCase()) throw bad("Only " + repo() + "'s builds can send the burner's zips.", 403);
  return claims;
}
const slotOf = (name) => SLOTS.find((x) => x.match.test(name)) || null;
const verOfName = (name) => { const m = String(name).match(/[-_]v?(\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?)(?=[-_.](?:zip|deb|amd64|x86_64|arm64))/i); return m ? m[1] : ""; };

export async function software() {
  const sent = await q(`SELECT DISTINCT ON (slot) * FROM burn_files WHERE state='ready' ORDER BY slot, created_at DESC, id DESC`);
  let rels = null;
  if (SLOTS.some((x) => !sent.find((f) => f.slot === x.id)) && (process.env.GITHUB_TOKEN || process.env.BURN_GITHUB_TOKEN)) rels = await releases().catch(() => null);
  return SLOTS.map((s) => {
    const f = sent.find((x) => x.slot === s.id);
    const base = { slot: s.id, kind: s.kind || null, use: s.use || null, slotName: s.name };
    if (f) return { ...base, asset: "f" + f.id, name: f.name, bytes: Number(f.bytes), version: f.version, release: f.release || null, published: f.created_at, sha256: f.sha256 || null, prerelease: false, from: "website" };
    for (const rel of rels || []) for (const a of rel.assets || []) {
      if (!s.match.test(a.name)) continue;
      const digest = /^sha256:[0-9a-f]{64}$/.test(a.digest || "") ? a.digest.slice(7) : null;
      return { ...base, asset: a.id, name: a.name, bytes: a.size, version: verOf(rel, a.name), release: rel.tag_name, published: a.updated_at || rel.published_at, sha256: digest, prerelease: !!rel.prerelease, from: "github" };
    }
    return { ...base, asset: null };
  });
}
async function assetLink(id) {
  const f = /^f\d+$/.test(String(id)) ? await one("SELECT * FROM burn_files WHERE id=$1 AND state='ready'", [Number(String(id).slice(1))]) : null;
  if (f) return { url: await store.downloadUrl(f.storage_key, f.name), name: f.name, bytes: Number(f.bytes), sha256: f.sha256 || null };
  if (/^f/.test(String(id))) throw bad("That file isn't one of the burner's zips.", 404);
  const rels = await releases();
  let asset = null;
  for (const rel of rels) for (const a of rel.assets || []) if (String(a.id) === String(id)) asset = a;
  if (!asset || !SLOTS.some((s) => s.match.test(asset.name))) throw bad("That file isn't one of the burner's zips.", 404);
  // GitHub answers a private asset with a redirect to a link that works for a few minutes: hand that to the app
  const r = await fetch(ghApi() + "/repos/" + repo() + "/releases/assets/" + asset.id, { headers: ghHeaders("application/octet-stream"), redirect: "manual", signal: AbortSignal.timeout(15000) });
  const url = r.headers.get("location") || (r.ok ? asset.browser_download_url : null);
  if (!url) throw bad("GitHub didn't give a download link (" + r.status + ").", 502);
  return { url, name: asset.name, bytes: asset.size, sha256: /^sha256:[0-9a-f]{64}$/.test(asset.digest || "") ? asset.digest.slice(7) : null };
}

const out = (d) => ({ code: d.code, kind: d.kind, kindName: (KINDS[d.kind] || {}).name || d.kind, use: d.use || null, useName: USES[d.use] || null, chip: d.chip, mac: d.mac || null,
  software: d.software || null, burns: d.burns, burnedBy: d.by_name || d.by_email || null, burnedAt: d.burned_at, lastSeen: d.p_seen || null, lastVersion: d.p_version || null, approved: d.p_status ? d.p_status === "approved" : null,
  freed: !!d.freed_at, freedAt: d.freed_at, freedWhy: d.freed_why || null, createdAt: d.created_at,
  numberChip: d.number_serial || null, registeredAt: d.registered_at || null, boardRev: d.board_rev || null, batch: d.batch || null });

// ---------------------------------------------------------------- pedals and control boxes: the one-time pass
const sha = (x) => crypto.createHash("sha256").update(String(x)).digest("hex");
const newPass = () => crypto.randomBytes(24).toString("base64url");   // (32 characters: 192 random bits)
const NUMBER_KIND = { pedal: "pedal", controller: "control" };
// pedals.js asks this when a pedal or control box checks in (docs/DEVICE-CODES.md). With the pass the burner left: the
// code is tied to that chip's serial for good (the same chip again gets yes again). Without a pass (an update check):
// the serial has to be the one already tied to it, or, before it has checked in, the board has to be the CM5 the code
// was burned on. Anything else is turned down.
export async function claimForChip({ kind, code, pass, serial, board }) {
  const want = NUMBER_KIND[kind];
  const d = await one("SELECT * FROM device_codes WHERE code=$1", [String(code || "").toUpperCase()]);
  if (!d || !want || d.kind !== want) throw bad("That code isn't one of Motion Audio's.", 404);
  if (d.freed_at) throw bad("That code was freed. Burn the board again to give it a new one.", 403);
  const s = String(serial || "").toLowerCase();
  if (d.number_serial && d.number_serial !== s) throw bad("That code is already another device's.", 403);
  if (pass !== undefined && pass !== null) {
    const a = Buffer.from(sha(pass), "hex"), b = Buffer.from(String(d.pass_hash || ""), "hex");
    if (a.length !== 32 || b.length !== 32 || !crypto.timingSafeEqual(a, b)) throw bad("That pass isn't the one the burner left. Burn the board again.", 403);
  } else if (!d.number_serial && !(board && sameChip(d, board))) throw bad("This device hasn't checked in with Motion Audio yet.", 403);
  if (!d.number_serial) await q("UPDATE device_codes SET number_serial=$2, registered_at=now() WHERE code=$1 AND number_serial IS NULL", [d.code, s]);
  const now = await one("SELECT number_serial FROM device_codes WHERE code=$1", [d.code]);
  if (now.number_serial !== s) throw bad("That code is already another device's.", 403);   // (two at once: the first kept it)
  return { code: d.code };
}

// (a pedal's or control box's registration: pedals.js keeps when it last checked for updates, and which version)
const DEV = `SELECT d.*, u.name AS by_name, u.email AS by_email, p.last_seen AS p_seen, p.last_version AS p_version, p.status AS p_status
  FROM device_codes d LEFT JOIN users u ON u.id = d.burned_by LEFT JOIN pedals p ON p.device_code = d.code`;
const withNames = (code) => one(DEV + " WHERE d.code=$1", [code]);

export function routes(api, { wrap, requireUser }) {
  setDeviceClaim(claimForChip);   // (pedals.js: a pedal or control box checking in with the burner's code and pass)
  api.get("/burn/me", requireUser, wrap(async (req, res) => {
    res.json({ canBurn: await canBurn(req.user), owner: isOwner(req.user), email: req.user.email, name: req.user.name || "", kinds: KINDS, uses: USES });
  }));

  api.get("/burn/software", requireUser, wrap(async (req, res) => {
    await gate(req);
    res.set("Cache-Control", "no-store");
    res.json({ repo: repo(), slots: await software() });
  }));
  api.get("/burn/software/:asset/link", requireUser, wrap(async (req, res) => {
    await gate(req);
    res.set("Cache-Control", "no-store");
    res.json(await assetLink(req.params.asset));
  }));

  // a GitHub build sending a zip: its row and a signed upload link; then "done" once it's all there
  api.post("/burn/upload", wrap(async (req, res) => {
    const job = await githubJob(req);
    const b = req.body || {}, name = String(b.name || "").replace(/[^\w.+-]/g, "").slice(0, 120), bytes = Number(b.bytes), sha256 = String(b.sha256 || "").toLowerCase();
    const slot = slotOf(name);
    if (!slot) throw bad("That file isn't one of the burner's zips (" + name + ").");
    if (!(bytes > 0) || bytes > 4.9e9) throw bad("That file's size doesn't fit (" + bytes + " bytes).");
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw bad("Send the file's SHA-256 with it.");
    const key = "burn/" + slot.id + "/" + Date.now().toString(36) + "-" + name;
    const release = String(b.release || job.ref_name || "").slice(0, 120);
    const row = await one("INSERT INTO burn_files (slot,name,version,release,bytes,sha256,storage_key,run) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
      [slot.id, name, verOfName(name), release, Math.round(bytes), sha256, key, String(job.run_id || "").slice(0, 40)]);
    res.json({ id: Number(row.id), slot: slot.id, uploadUrl: await store.uploadUrl(key, "application/octet-stream") });
  }));
  api.post("/burn/upload/:id/done", wrap(async (req, res) => {
    await githubJob(req);
    const f = await one("SELECT * FROM burn_files WHERE id=$1", [Number(req.params.id) || 0]);
    if (!f) throw bad("That upload isn't there.", 404);
    const got = await store.sizeOf(f.storage_key);
    if (got == null) throw bad("The file didn't reach the storage. Send it again.");
    if (got !== Number(f.bytes)) throw bad("Only " + got + " of " + f.bytes + " bytes arrived. Send it again.");
    await q("UPDATE burn_files SET state='ready' WHERE id=$1", [f.id]);
    res.json({ ok: true, slot: f.slot, name: f.name });
  }));

  // the chip's code: the one it has, or a new one. peek: only say whether it has one (nothing is made)
  api.post("/burn/claim", requireUser, wrap(async (req, res) => {
    await gate(req);
    const b = req.body || {}, kind = String(b.kind || ""), mac = cleanMac(b.mac);
    if (!KINDS[kind]) throw bad("Pick what's being burned: pedal, control, input or output.");
    // an input or output box: its one-time chip's serial (9 bytes), read while the new firmware waits; it's the box's ID
    const box = kind === "input" || kind === "output", nSerial = String(b.serial || "").toLowerCase();
    if (box && !/^[0-9a-f]{18}$/.test(nSerial)) throw bad("The box's chip didn't answer with its serial. Start it again and retry.");
    const chip = cleanChip(box ? nSerial : b.chip);
    if (chip.length < 8) throw bad("The chip's ID didn't come through (" + (String(b.chip || "").slice(0, 40) || "nothing") + "). Plug it in again and retry.");
    const use = kind === "control" ? String(b.use || "") : "";
    if (kind === "control" && !USES[use]) throw bad("Pick the control box's job: pedal, inears or wave.");
    const software = String(b.software || "").slice(0, 200);
    const boardRev = String(b.boardRev || "").trim().slice(0, 40), batch = String(b.batch || "").trim().slice(0, 80);
    // the chip already has a code (burned before): keep it. The CM5's serial may come through 8 or 16 digits long
    const have = (await q("SELECT * FROM device_codes WHERE kind=$1 AND freed_at IS NULL AND (chip=$2 OR chip LIKE $3 OR $2 LIKE '%' || chip OR ($4 <> '' AND mac=$4))",
      [kind, chip, "%" + chip, mac])).find((r) => sameChip(r, chip, mac));
    if (b.peek) return res.json({ code: have ? have.code : null, kept: !!have, device: have ? out(have) : null });
    // what goes with the code: a pedal's or control box's one-time pass
    const extras = async (row, kept) => {
      const r = { code: row.code, kept };
      if (kind === "pedal" || kind === "control") {
        r.pass = newPass();
        await q("UPDATE device_codes SET pass_hash=$2 WHERE code=$1", [row.code, sha(r.pass)]);
      }
      r.device = out(await withNames(row.code));
      return r;
    };
    if (have) {
      const u = await one(`UPDATE device_codes SET use=$2, mac=CASE WHEN $3 <> '' THEN $3 ELSE mac END, software=CASE WHEN $4 <> '' THEN $4 ELSE software END,
        board_rev=CASE WHEN $5 <> '' THEN $5 ELSE board_rev END, batch=CASE WHEN $6 <> '' THEN $6 ELSE batch END WHERE code=$1 RETURNING *`, [have.code, use, mac, software, boardRev, batch]);
      return res.json(await extras(u, true));
    }
    for (let i = 0; i < 20; i++) {
      const code = newCode(kind);
      try {
        const r = await one(`INSERT INTO device_codes (code,kind,use,chip,mac,software,burned_by,board_rev,batch,number_serial) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          ON CONFLICT DO NOTHING RETURNING *`, [code, kind, use, chip, mac, software, req.user.id, boardRev, batch, box ? nSerial : null]);
        if (r) return res.json(await extras(r, false));
        // (no row: the code was taken, or another burn of this chip got there first)
        const again = await one("SELECT * FROM device_codes WHERE kind=$1 AND chip=$2 AND freed_at IS NULL", [kind, chip]);
        if (again) return res.json(await extras(again, true));
      } catch (e) { if (e.code !== "23505") throw e; }
    }
    throw bad("Couldn't make a new code. Try again.", 500);
  }));
  api.post("/burn/done", requireUser, wrap(async (req, res) => {
    await gate(req);
    const b = req.body || {}, code = String(b.code || "").toUpperCase();
    const d = await one("SELECT * FROM device_codes WHERE code=$1", [code]);
    if (!d) throw bad("That code isn't on the website.", 404);
    if (d.freed_at) throw bad("That code was freed. Burn the board again to give it a new one.", 409);
    if (!sameChip(d, b.chip, b.mac)) throw bad("That code belongs to a different chip.", 409);
    const ok = b.ok !== false, software = String(b.software || "").slice(0, 200);
    await q("INSERT INTO device_burns (code,software,sha256,ok,notes,by_user) VALUES ($1,$2,$3,$4,$5,$6)",
      [code, software, String(b.sha256 || "").toLowerCase().replace(/[^0-9a-f]/g, "").slice(0, 64), ok, String(b.notes || "").slice(0, 2000), req.user.id]);
    if (ok) await q("UPDATE device_codes SET burns=burns+1, burned_at=now(), burned_by=$2, software=CASE WHEN $3 <> '' THEN $3 ELSE software END WHERE code=$1", [code, req.user.id, software]);
    res.json({ ok: true, device: out(await withNames(code)) });
  }));

  api.get("/burn/devices", requireUser, wrap(async (req, res) => {
    await gate(req);
    const s = String(req.query.q || "").trim().slice(0, 60);
    const like = "%" + s.replace(/[%_\\]/g, (c) => "\\" + c) + "%";
    const rows = await q(DEV + ` WHERE ($1 = '' OR d.code ILIKE $2 OR d.chip ILIKE $2 OR d.software ILIKE $2 OR d.kind ILIKE $2 OR d.number_serial ILIKE $2
      OR d.board_rev ILIKE $2 OR d.batch ILIKE $2)
      ORDER BY d.created_at DESC LIMIT 500`, [s, like]);
    const counts = await q("SELECT kind, count(*)::int AS n FROM device_codes WHERE freed_at IS NULL GROUP BY kind");
    res.set("Cache-Control", "no-store");
    res.json({ devices: rows.map(out), counts: Object.fromEntries(counts.map((c) => [c.kind, c.n])), owner: isOwner(req.user) });
  }));
  api.get("/burn/devices/:code", requireUser, wrap(async (req, res) => {
    await gate(req);
    const d = await withNames(String(req.params.code).toUpperCase());
    if (!d) throw bad("That code isn't on the website.", 404);
    const burns = await q("SELECT b.*, u.name, u.email FROM device_burns b LEFT JOIN users u ON u.id = b.by_user WHERE b.code=$1 ORDER BY b.at DESC LIMIT 100", [d.code]);
    res.json({ device: out(d), burns: burns.map((b) => ({ software: b.software, sha256: b.sha256 || null, ok: b.ok, notes: b.notes || null, by: b.name || b.email || null, at: b.at })) });
  }));
  api.post("/burn/devices/:code/free", requireUser, wrap(async (req, res) => {
    await ownerGate(req);
    const d = await one("UPDATE device_codes SET freed_at=now(), freed_by=$2, freed_why=$3 WHERE code=$1 AND freed_at IS NULL RETURNING *",
      [String(req.params.code).toUpperCase(), req.user.id, String((req.body && req.body.why) || "").slice(0, 300)]);
    if (!d) throw bad("That code isn't on the website, or it's already freed.", 404);
    await q("UPDATE pedals SET updates=FALSE WHERE device_code=$1", [d.code]);   // (a pedal or control box with it: no more updates)
    res.json({ ok: true, device: out(await withNames(d.code)) });
  }));

  // ---- who can burn (the owner only changes this)
  api.get("/admin/burners", requireUser, wrap(async (req, res) => {
    await ownerGate(req);
    const rows = await q(`SELECT b.email, b.added_at, u.name, (u.id IS NOT NULL) AS has_account FROM burners b LEFT JOIN users u ON lower(u.email) = b.email AND u.deleted_at IS NULL ORDER BY b.added_at`);
    res.json({ burners: rows.map((r) => ({ email: r.email, name: r.name || "", hasAccount: r.has_account, addedAt: r.added_at })) });
  }));
  api.post("/admin/burners", requireUser, wrap(async (req, res) => {
    await ownerGate(req);
    const email = String((req.body && req.body.email) || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) throw bad("Type their email address.");
    await q("INSERT INTO burners (email, added_by) VALUES ($1,$2) ON CONFLICT (email) DO NOTHING", [email, req.user.id]);
    res.json({ ok: true });
  }));
  api.post("/admin/burners/delete", requireUser, wrap(async (req, res) => {
    await ownerGate(req);
    await q("DELETE FROM burners WHERE email=$1", [String((req.body && req.body.email) || "").trim().toLowerCase()]);
    res.json({ ok: true });
  }));
}
