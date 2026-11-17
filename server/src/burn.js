// Device codes and the Central Burner app (private: the owner and the people the owner adds as Burners).
//
// The Central Burner app (Ubuntu, central-native/apps/burner) puts the software on every device and gives each one a
// code that is its own for life: P pedal · C control box · I input box · O output box, then random numbers (15 to 25;
// an output box keeps 16 characters, so its code is O and 15 numbers).
//   Pedal, control box (CM5)  the code goes with the board's serial when it's burned, and the burner leaves the code
//                             and a one-time pass on its boot partition (central-device.json). At its first start the
//                             device registers its number chip (ATECC608B) with pedals.js, which asks this file
//                             through setDeviceClaim: the right pass ties the code to that chip for good. Updates then
//                             need that chip's signature and that code (pedals.js). docs/DEVICE-CODES.md in the pedal.
//   Output box (STM32 + chip) the burner reads its number chip's serial and key while the new firmware waits, and this
//                             file signs serial + key + code with the loader key; the box keeps them for good.
//   Input box (STM32)         the code goes in its flash's last 256 bytes, tied to the STM32's 96-bit ID.
// Burning the same chip again keeps its code. A scrapped board's code can be freed (the owner); never given out again.
//
// The zips come from the newest releases on GitHub (BURN_REPO, private, read with GITHUB_TOKEN), so staff don't need
// GitHub access: the app asks here and gets a short-lived download link. It can also burn a zip from the computer.
//
//   GET  /burn/me                       can this account burn?
//   GET  /burn/software                 the newest zip on GitHub for each slot (and the burner app itself)
//   GET  /burn/software/:asset/link     a short-lived download link for one of them
//   POST /burn/claim                    the chip's code (new or kept): {kind, chip, use?, mac?, software?, peek?};
//                                       pedal / control: + a new one-time pass; output: {serial, publicKey} → + signature
//   POST /burn/done                     {code, chip, software, sha256?, ok, notes?} → the burn in the history
//   GET  /burn/devices?q=               the codes, newest first
//   POST /burn/devices/:code/free       {why} the owner only: a scrapped board's code stops working
//   GET  /burn/loader-key               the owner: the loader key's public half (for the output box's ident_key.h)
//   GET  /admin/burners · POST /admin/burners {email} · POST /admin/burners/delete {email}   the owner only
import crypto from "node:crypto";
import { q, one } from "./db.js";
import { isOwner } from "./auth.js";
import { requireStep } from "./signin.js";
import { setDeviceClaim, hasDeviceClaim } from "./pedals.js";

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
// a new code: the kind's letter and 15-25 random numbers (any of them may be 0). An output box's number chip keeps 16
// characters (firmware/output-box/inc/ident.h), so its code is O and 15 numbers.
export const CODE_MAX = { output: 16 };
export function newCode(kind) {
  const k = KINDS[kind]; if (!k) throw bad("Unknown kind of device.");
  const n = CODE_MAX[kind] ? CODE_MAX[kind] - 1 : crypto.randomInt(15, 26);
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
export async function software() {
  const rels = await releases();
  return SLOTS.map((s) => {
    for (const rel of rels) for (const a of rel.assets || []) {
      if (!s.match.test(a.name)) continue;
      const digest = /^sha256:[0-9a-f]{64}$/.test(a.digest || "") ? a.digest.slice(7) : null;
      return { slot: s.id, kind: s.kind || null, use: s.use || null, slotName: s.name, asset: a.id, name: a.name, bytes: a.size, version: verOf(rel, a.name),
        release: rel.tag_name, published: a.updated_at || rel.published_at, sha256: digest, prerelease: !!rel.prerelease };
    }
    return { slot: s.id, kind: s.kind || null, use: s.use || null, slotName: s.name, asset: null };
  });
}
async function assetLink(id) {
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
  numberChip: d.number_serial || null, registeredAt: d.registered_at || null });

// ---------------------------------------------------------------- pedals and control boxes: the one-time pass
const sha = (x) => crypto.createHash("sha256").update(String(x)).digest("hex");
const newPass = () => crypto.randomBytes(24).toString("base64url");   // (32 characters: 192 random bits)
const NUMBER_KIND = { pedal: "pedal", controller: "control" };
// pedals.js asks this when a pedal or control box registers its number chip with the code and pass the burner left
// (docs/DEVICE-CODES.md): the right pass ties the code to that chip for good; the same chip asking again gets yes
// again; any other chip is turned down.
export async function claimForChip({ kind, code, pass, serial, publicKey }) {
  const want = NUMBER_KIND[kind];
  const d = await one("SELECT * FROM device_codes WHERE code=$1", [String(code || "").toUpperCase()]);
  if (!d || !want || d.kind !== want) throw bad("That code isn't one of Motion Audio's.", 404);
  if (d.freed_at) throw bad("That code was freed. Burn the board again to give it a new one.", 403);
  const a = Buffer.from(sha(pass), "hex"), b = Buffer.from(String(d.pass_hash || ""), "hex");
  if (a.length !== 32 || b.length !== 32 || !crypto.timingSafeEqual(a, b)) throw bad("That pass isn't the one the burner left. Burn the board again.", 403);
  const s = String(serial || "").toLowerCase(), k = String(publicKey || "").toLowerCase();
  if (d.number_serial && d.number_serial !== s) throw bad("That code is already another chip's.", 403);
  if (!d.number_serial) await q("UPDATE device_codes SET number_serial=$2, number_key=$3, registered_at=now() WHERE code=$1 AND number_serial IS NULL", [d.code, s, k]);
  const now = await one("SELECT number_serial FROM device_codes WHERE code=$1", [d.code]);
  if (now.number_serial !== s) throw bad("That code is already another chip's.", 403);   // (two at once: the first kept it)
  return { code: d.code };
}

// ---------------------------------------------------------------- output boxes: the loader key
// The box only keeps a code signed by the key in its firmware (ident_key.h): P-256 ECDSA (r || s) over
// SHA-256(serial[9] || pub[64] || code[16, zero-padded]). Made here the first time it's needed and kept in its own table,
// or BURN_LOADER_KEY (a PKCS#8 PEM). Only its public half ever leaves the server.
let loaderCached = null;
function rawPub(keyObject) {
  const j = crypto.createPublicKey(keyObject).export({ format: "jwk" });
  return Buffer.concat([Buffer.from(j.x, "base64url"), Buffer.from(j.y, "base64url")]).toString("hex");
}
export async function loaderKey() {
  if (loaderCached) return loaderCached;
  let pem = process.env.BURN_LOADER_KEY ? String(process.env.BURN_LOADER_KEY).replace(/\\n/g, "\n") : null;
  if (!pem) {
    let row = await one("SELECT private_pem FROM burn_loader_key WHERE id=1");
    if (!row) {
      const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      await q("INSERT INTO burn_loader_key (id, private_pem, public_hex) VALUES (1,$1,$2) ON CONFLICT (id) DO NOTHING", [privateKey.export({ type: "pkcs8", format: "pem" }), rawPub(privateKey)]);
      row = await one("SELECT private_pem FROM burn_loader_key WHERE id=1");
    }
    pem = row.private_pem;
  }
  const priv = crypto.createPrivateKey(pem);
  loaderCached = { priv, publicHex: rawPub(priv) };
  return loaderCached;
}
export function boxMessage(serialHex, pubHex, code) {
  const c = Buffer.alloc(16); Buffer.from(code, "latin1").copy(c);
  return Buffer.concat([Buffer.from(serialHex, "hex"), Buffer.from(pubHex, "hex"), c]);
}
async function signBox(serialHex, pubHex, code) {
  return crypto.sign("sha256", boxMessage(serialHex, pubHex, code), { key: (await loaderKey()).priv, dsaEncoding: "ieee-p1363" }).toString("hex");
}
export const cArray = (hex) => "static const uint8_t IDENT_LOADER_KEY[64] = {\n" + hex.match(/.{32}/g).map((r) => "    " + r.match(/../g).map((b) => "0x" + b.toUpperCase()).join(", ") + ",").join("\n") + "\n};";

// (a pedal's or control box's registration: pedals.js keeps when it last checked for updates, and which version)
const DEV = `SELECT d.*, u.name AS by_name, u.email AS by_email, p.last_seen AS p_seen, p.last_version AS p_version, p.status AS p_status
  FROM device_codes d LEFT JOIN users u ON u.id = d.burned_by LEFT JOIN pedals p ON p.device_code = d.code`;
const withNames = (code) => one(DEV + " WHERE d.code=$1", [code]);

export function routes(api, { wrap, requireUser }) {
  // (pedals.js: a pedal or control box registering with the burner's code and pass. BURN_CLAIM=off: no code list, for
  // the pedal tests of approval by hand; a test's own stand-in, set first, is kept)
  if (process.env.BURN_CLAIM !== "off" && !hasDeviceClaim()) setDeviceClaim(claimForChip);
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

  // the chip's code: the one it has, or a new one. peek: only say whether it has one (nothing is made)
  api.post("/burn/claim", requireUser, wrap(async (req, res) => {
    await gate(req);
    const b = req.body || {}, kind = String(b.kind || ""), mac = cleanMac(b.mac);
    if (!KINDS[kind]) throw bad("Pick what's being burned: pedal, control, input or output.");
    // an output box: its number chip's serial (9 bytes) and key (64 bytes), read while the new firmware waits
    const nSerial = String(b.serial || "").toLowerCase(), nKey = String(b.publicKey || "").toLowerCase();
    if (kind === "output" && !b.peek && (!/^[0-9a-f]{18}$/.test(nSerial) || !/^[0-9a-f]{128}$/.test(nKey))) throw bad("The box's number chip didn't answer with its serial and key. Start it again and retry.");
    const chip = cleanChip(kind === "output" && nSerial ? nSerial : b.chip);
    if (chip.length < 8) throw bad("The chip's ID didn't come through (" + (String(b.chip || "").slice(0, 40) || "nothing") + "). Plug it in again and retry.");
    const use = kind === "control" ? String(b.use || "") : "";
    if (kind === "control" && !USES[use]) throw bad("Pick the control box's job: pedal, inears or wave.");
    const software = String(b.software || "").slice(0, 200);
    // the chip already has a code (burned before): keep it. The CM5's serial may come through 8 or 16 digits long
    const have = (await q("SELECT * FROM device_codes WHERE kind=$1 AND freed_at IS NULL AND (chip=$2 OR chip LIKE $3 OR $2 LIKE '%' || chip OR ($4 <> '' AND mac=$4))",
      [kind, chip, "%" + chip, mac])).find((r) => sameChip(r, chip, mac));
    if (b.peek) return res.json({ code: have ? have.code : null, kept: !!have, device: have ? out(have) : null });
    // what goes with the code: a pedal's or control box's one-time pass; an output box's signature
    const extras = async (row, kept) => {
      const r = { code: row.code, kept };
      if (kind === "pedal" || kind === "control") {
        r.pass = newPass();
        await q("UPDATE device_codes SET pass_hash=$2 WHERE code=$1", [row.code, sha(r.pass)]);
      }
      if (kind === "output") {
        if (row.number_key && row.number_key !== nKey) throw bad("This box's number chip has a different key from the one its code was signed for. Contact Motion Audio.", 409);
        r.signature = await signBox(nSerial, nKey, row.code);
        await q("UPDATE device_codes SET number_serial=$2, number_key=$3 WHERE code=$1", [row.code, nSerial, nKey]);
      }
      r.device = out(await withNames(row.code));
      return r;
    };
    if (have) {
      const u = await one("UPDATE device_codes SET use=$2, mac=CASE WHEN $3 <> '' THEN $3 ELSE mac END, software=CASE WHEN $4 <> '' THEN $4 ELSE software END WHERE code=$1 RETURNING *", [have.code, use, mac, software]);
      return res.json(await extras(u, true));
    }
    for (let i = 0; i < 20; i++) {
      const code = newCode(kind);
      try {
        const r = await one(`INSERT INTO device_codes (code,kind,use,chip,mac,software,burned_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT DO NOTHING RETURNING *`, [code, kind, use, chip, mac, software, req.user.id]);
        if (r) return res.json(await extras(r, false));
        // (no row: the code was taken, or another burn of this chip got there first)
        const again = await one("SELECT * FROM device_codes WHERE kind=$1 AND chip=$2 AND freed_at IS NULL", [kind, chip]);
        if (again) return res.json(await extras(again, true));
      } catch (e) { if (e.code !== "23505") throw e; }
    }
    throw bad("Couldn't make a new code. Try again.", 500);
  }));
  // the loader key's public half, for the output box's firmware (inc/ident_key.h)
  api.get("/burn/loader-key", requireUser, wrap(async (req, res) => {
    await ownerGate(req);
    const k = await loaderKey();
    res.json({ publicKey: k.publicHex, header: cArray(k.publicHex) });
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
    const rows = await q(DEV + ` WHERE ($1 = '' OR d.code ILIKE $2 OR d.chip ILIKE $2 OR d.software ILIKE $2 OR d.kind ILIKE $2 OR d.number_serial ILIKE $2)
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
