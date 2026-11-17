// The Central Pedal's own number (rev E). Each CM5 pedal has an ATECC608B chip under its main board, burned once at the
// factory test: the chip makes its own P-256 key, which can never be read out or changed. This is the website's side.
//   register   POST /v1/pedals/register {serial, publicKey, signature (the chip's, over
//              "central-pedal-register|<serial>|<publicKey>"), version} → a short code and a ticket. The owner types the
//              code on the Pedal builds page (Pedals) to approve it; the pedal asks with its ticket every few seconds
//              (GET /v1/pedals/register/:ticket) and, once approved, gets its certificate: the website's signature over
//              "central-pedal-cert-v1|<serial>|<publicKey>", and the website's public key, which the pedal keeps.
//   updates    POST /v1/pedals/challenge {serial} → a random number for 5 minutes, used once; then POST
//              /v1/pedals/update {serial, nonce, signature over "central-pedal-update|<nonce>|<serial>", version}. When
//              the chip's signature checks out against the key approved for that serial, and that pedal's updates are
//              on, the answer is the "pedal" build marked "the one to ship" (a .deb, when it's newer): its version, what
//              changed, its SHA-256 and a download link for an hour. Nothing else gets a link to the pedal's software.
//   the burner  The burner app keeps the device codes (CP-00001 and so on) and gives each pedal it loads a code and a
//              one-time pass. The pedal registers with both ({..., code, pass}); this file hands them to the burner's
//              code list through setDeviceClaim(fn) and, when it says yes, approves the pedal straight away and keeps
//              its code (no code to type). Update checks then have to carry that code. Without a claim function set,
//              or for a pedal with no code, it's the usual approval by hand. The contract is in the pedal's
//              docs/DEVICE-CODES.md.
// The website's signing key (P-256) is made here the first time it's needed and kept in its own table - or comes from
// PEDAL_SIGNING_KEY (a PKCS#8 PEM) if that's set. Only its public half ever leaves the server.
import crypto from "node:crypto";
import { q, one } from "./db.js";
import { canSee } from "./builds.js";
import { requireStep } from "./signin.js";
import * as store from "./storage.js";

function bad(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }
const SERIAL = /^[0-9a-f]{18}$/, KEY = /^[0-9a-f]{128}$/, SIG = /^[0-9a-f]{128}$/, NONCE = /^[0-9a-f]{64}$/;
const VERSION = /^[0-9][0-9A-Za-z.+~-]{0,39}$/;
const DEVICE_CODE = /^[A-Za-z0-9][A-Za-z0-9-]{2,25}$/, PASS = /^[A-Za-z0-9_-]{16,128}$/;

// The burner's code list says whether a code and its one-time pass may go to this chip:
//   fn({kind: "pedal", code, pass, serial, publicKey}) → {code} (the code as the list keeps it) when it may; throws an
//   Error with .status (403 a wrong or used pass, 404 no such code...) when it may not. The same chip asking again
//   with the same pass (a retry after the network dropped) must get yes again.
let deviceClaim = null;
export function setDeviceClaim(fn) { deviceClaim = typeof fn === "function" ? fn : null; }
export function hasDeviceClaim() { return !!deviceClaim; }   // (burn.js sets the real one unless a test set its own first)
export async function pedalByDeviceCode(code) { return one("SELECT id, serial, status, updates, last_seen, last_version FROM pedals WHERE device_code=$1", [String(code || "")]); }
const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // (no 0/O or 1/I to mix up)
export const PENDING_DAYS = 7;

// A Central I/O control box uses the same calls with kind "controller" (and its job on update checks). Its messages
// start "central-io-" instead of "central-pedal-", so a pedal's approval can't stand in for a control box's or the
// other way round; its updates are the ship build of its job's kind (io-pedal, io-inears, io-wave in builds.js).
const PREFIX = { pedal: "central-pedal", controller: "central-io" };
export const kindOf = (k) => (k === "controller" ? "controller" : "pedal");
const noun = (kind) => (kind === "controller" ? "control box" : "pedal");
const JOB_BUILDS = { pedal: "io-pedal", inears: "io-inears", wave: "io-wave" };
export const certMessage = (serial, pub, kind = "pedal") => PREFIX[kindOf(kind)] + "-cert-v1|" + serial + "|" + pub;
export const registerMessage = (serial, pub, kind = "pedal") => PREFIX[kindOf(kind)] + "-register|" + serial + "|" + pub;
export const updateMessage = (nonce, serial, kind = "pedal") => PREFIX[kindOf(kind)] + "-update|" + nonce + "|" + serial;

// ---------------------------------------------------------------- the keys
let cached = null;
function rawPublic(keyObject) {
  const j = crypto.createPublicKey(keyObject).export({ format: "jwk" });
  return Buffer.concat([Buffer.from(j.x, "base64url"), Buffer.from(j.y, "base64url")]).toString("hex");
}
export async function signingKey() {
  if (cached) return cached;
  let pem = process.env.PEDAL_SIGNING_KEY ? String(process.env.PEDAL_SIGNING_KEY).replace(/\\n/g, "\n") : null;
  if (!pem) {
    let row = await one("SELECT private_pem FROM pedal_signing_key WHERE id=1");
    if (!row) {
      const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      await q("INSERT INTO pedal_signing_key (id, private_pem, public_hex) VALUES (1, $1, $2) ON CONFLICT (id) DO NOTHING",
        [privateKey.export({ type: "pkcs8", format: "pem" }), rawPublic(privateKey)]);
      row = await one("SELECT private_pem FROM pedal_signing_key WHERE id=1");   // (two at once: the first one kept wins)
    }
    pem = row.private_pem;
  }
  const priv = crypto.createPrivateKey(pem);
  cached = { priv, publicHex: rawPublic(priv) };
  return cached;
}
export function publicKeyOf(hex) {
  const b = Buffer.from(hex, "hex");
  return crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: b.subarray(0, 32).toString("base64url"), y: b.subarray(32, 64).toString("base64url") }, format: "jwk" });
}
// the chip's signature (R then S, 64 bytes) over SHA-256(message)
export function chipSigned(pubHex, message, sigHex) {
  try { return crypto.verify("sha256", Buffer.from(message), { key: publicKeyOf(pubHex), dsaEncoding: "ieee-p1363" }, Buffer.from(sigHex, "hex")); } catch (_) { return false; }
}
async function certificate(serial, pub, kind = "pedal") {
  const k = await signingKey();
  return crypto.sign("sha256", Buffer.from(certMessage(serial, pub, kind)), { key: k.priv, dsaEncoding: "ieee-p1363" }).toString("hex");
}
function newCode() {
  const b = crypto.randomBytes(7);
  const s = Array.from(b, (x) => CODE_LETTERS[x % CODE_LETTERS.length]).join("");
  return s.slice(0, 3) + "-" + s.slice(3);
}
const plainCode = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export function newer(a, b) {
  const p = (v) => String(v || "").split(/[^0-9]+/).filter(Boolean).slice(0, 3).map(Number).concat([0, 0, 0]).slice(0, 3);
  const x = p(a), y = p(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
const pretty = (serial) => String(serial || "").toUpperCase().replace(/(.{4})(?=.)/g, "$1 ");
const out = (p) => ({ id: Number(p.id), kind: kindOf(p.kind), serial: p.serial, serialText: pretty(p.serial), deviceCode: p.device_code || "", status: p.status, code: p.status === "pending" ? p.code : null, updates: p.updates,
  note: p.note, version: p.last_version || p.first_version || "", lastSeen: p.last_seen, registeredAt: p.created_at, approvedAt: p.approved_at, approvedBy: p.approved_by_email || "" });
const ROW = "SELECT p.*, u.email AS approved_by_email FROM pedals p LEFT JOIN users u ON u.id=p.approved_by";

async function gate(req) {
  if (!canSee(req.user)) throw bad("Only the website's owner can see the pedals.", 403);
  await requireStep(req);
}

export function routes(api, { wrap, brake, requireUser }) {
  const slow = (req) => { if (brake) brake(req); };
  // ---------------------------------------------------------------- the pedal's own calls (no account: the chip signs)
  api.post("/pedals/register", wrap(async (req, res) => {
    slow(req);
    const b = req.body || {}, serial = String(b.serial || "").toLowerCase(), pub = String(b.publicKey || "").toLowerCase(), sig = String(b.signature || "").toLowerCase();
    const kind = kindOf(b.kind), what = noun(kind);
    if (!SERIAL.test(serial) || !KEY.test(pub) || !SIG.test(sig)) throw bad("That isn't a " + what + "'s number.");
    if (!chipSigned(pub, registerMessage(serial, pub, kind), sig)) throw bad("That signature doesn't check out.", 403);
    const version = VERSION.test(String(b.version || "")) ? String(b.version) : "";
    await q("DELETE FROM pedals WHERE status='pending' AND created_at < now() - ($1 || ' days')::interval", [String(PENDING_DAYS)]);
    const was = await one("SELECT * FROM pedals WHERE serial=$1", [serial]);
    if (was && was.status === "approved" && was.public_key !== pub) throw bad(kind === "pedal" ? "This pedal's number is already registered to another chip. Contact Motion Audio." : "This control box's number is already registered. Contact Motion Audio.", 409);
    if (was && was.status === "approved" && kindOf(was.kind) !== kind) throw bad("This number is registered as a " + noun(was.kind) + ". Contact Motion Audio.", 409);
    // ---- the burner's code and one-time pass: approved straight away, when its code list says so
    const devCode = String(b.code || "").toUpperCase(), pass = String(b.pass || "");
    if (deviceClaim && DEVICE_CODE.test(devCode) && PASS.test(pass)) {
      if (was && was.device_code && was.device_code !== devCode) throw bad("This " + what + " already has the code " + was.device_code + ". Contact Motion Audio.", 409);
      const said = await deviceClaim({ kind, code: devCode, pass, serial, publicKey: pub });
      const dc = String((said && said.code) || devCode).toUpperCase();
      if (!DEVICE_CODE.test(dc)) throw bad("The code list gave back a code that isn't one.", 500);
      const taken = await one("SELECT id FROM pedals WHERE device_code=$1 AND serial<>$2", [dc, serial]);
      if (taken) throw bad("The code " + dc + " is already another device's. Contact Motion Audio.", 409);
      const cert = was && was.status === "approved" ? was.certificate : await certificate(serial, pub, kind);
      if (was) await q("UPDATE pedals SET status='approved', kind=$5, public_key=$2, certificate=$3, code=NULL, device_code=$4, approved_at=COALESCE(approved_at, now()), note=CASE WHEN note='' THEN 'Loaded with the burner' ELSE note END WHERE id=$1", [was.id, pub, cert, dc, kind]);
      else await q("INSERT INTO pedals (serial, kind, public_key, ticket, status, certificate, device_code, first_version, approved_at, note) VALUES ($1,$7,$2,$3,'approved',$4,$5,$6,now(),'Loaded with the burner')",
        [serial, pub, crypto.randomBytes(24).toString("base64url"), cert, dc, version, kind]);
      return res.json({ status: "approved", certificate: cert, serverKey: (await signingKey()).publicHex, deviceCode: dc });
    }
    if (was && was.status === "approved") return res.json({ status: "approved", certificate: was.certificate, serverKey: (await signingKey()).publicHex, deviceCode: was.device_code || undefined });
    if (was && was.public_key === pub && kindOf(was.kind) === kind) return res.json({ status: "pending", ticket: was.ticket, code: was.code });
    const ticket = crypto.randomBytes(24).toString("base64url"), code = newCode();
    if (was) await q("UPDATE pedals SET kind=$6, public_key=$2, ticket=$3, code=$4, first_version=$5, created_at=now() WHERE id=$1", [was.id, pub, ticket, code, version, kind]);
    else await q("INSERT INTO pedals (serial, kind, public_key, ticket, code, first_version) VALUES ($1,$6,$2,$3,$4,$5)", [serial, pub, ticket, code, version, kind]);
    res.json({ status: "pending", ticket, code });
  }));
  api.get("/pedals/register/:ticket", wrap(async (req, res) => {
    const p = await one("SELECT * FROM pedals WHERE ticket=$1 AND (status='approved' OR created_at > now() - ($2 || ' days')::interval)", [String(req.params.ticket || ""), String(PENDING_DAYS)]);
    res.set("Cache-Control", "no-store");
    if (!p) throw bad("That registration isn't there any more. Register again.", 404);
    if (p.status !== "approved") return res.json({ status: "pending" });
    res.json({ status: "approved", certificate: p.certificate, serverKey: (await signingKey()).publicHex, deviceCode: p.device_code || undefined });
  }));
  api.get("/pedals/key", wrap(async (req, res) => res.json({ serverKey: (await signingKey()).publicHex })));
  api.post("/pedals/challenge", wrap(async (req, res) => {
    slow(req);
    const serial = String((req.body || {}).serial || "").toLowerCase();
    if (!SERIAL.test(serial)) throw bad("That isn't a pedal's number.");
    const nonce = crypto.randomBytes(32).toString("hex");
    const r = await one("UPDATE pedals SET challenge=$2, challenge_at=now() WHERE serial=$1 AND status='approved' RETURNING id", [serial, nonce]);
    if (!r) throw bad("This pedal isn't registered with Motion Audio.", 404);
    res.set("Cache-Control", "no-store").json({ nonce });
  }));
  api.post("/pedals/update", wrap(async (req, res) => {
    slow(req);
    const b = req.body || {}, serial = String(b.serial || "").toLowerCase(), nonce = String(b.nonce || "").toLowerCase(), sig = String(b.signature || "").toLowerCase();
    if (!SERIAL.test(serial) || !NONCE.test(nonce) || !SIG.test(sig)) throw bad("That isn't an update check.");
    // (the challenge is used up here, whatever happens next)
    const p = await one("UPDATE pedals SET challenge=NULL WHERE serial=$1 AND status='approved' AND challenge=$2 AND challenge_at > now() - interval '5 minutes' RETURNING *", [serial, nonce]);
    if (!p) throw bad("That check ran out. Try again.", 400);
    const kind = kindOf(p.kind), what = noun(kind);
    if (!chipSigned(p.public_key, updateMessage(nonce, serial, kind), sig)) throw bad("That signature doesn't check out.", 403);
    // (a device the burner gave a code has to say that code)
    if (p.device_code && String(b.code || "").toUpperCase() !== p.device_code) throw bad("This " + what + "'s code doesn't match the website. Contact Motion Audio.", 403);
    const buildKind = kind === "controller" ? JOB_BUILDS[String(b.job || "")] : "pedal";
    if (!buildKind) throw bad("Which program is this control box running?");
    const version = VERSION.test(String(b.version || "")) ? String(b.version) : "";
    await q("UPDATE pedals SET last_seen=now(), last_version=$2 WHERE id=$1", [p.id, version]);
    if (!p.updates) throw bad("Updates are off for this " + what + ". Contact Motion Audio.", 403);
    res.set("Cache-Control", "no-store");
    const ship = await one("SELECT * FROM builds WHERE kind=$1 AND ship AND state='ready'", [buildKind]);
    if (!ship || !/\.deb$/i.test(ship.name) || !ship.sha256 || !newer(ship.version, version)) return res.json({ upToDate: true, version: ship ? ship.version : version });
    await q("UPDATE builds SET downloads=downloads+1 WHERE id=$1", [ship.id]);
    res.json({ update: { version: ship.version, notes: ship.notes || "", sha256: ship.sha256, bytes: Number(ship.bytes), name: ship.name, url: await store.downloadUrl(ship.storage_key, ship.name) } });
  }));

  // ---------------------------------------------------------------- the owner's (Account → Pedal builds → Pedals)
  api.get("/admin/pedals", requireUser, wrap(async (req, res) => {
    await gate(req);
    await q("DELETE FROM pedals WHERE status='pending' AND created_at < now() - ($1 || ' days')::interval", [String(PENDING_DAYS)]);
    res.set("Cache-Control", "no-store");
    res.json({ pedals: (await q(ROW + " ORDER BY (p.status='pending') DESC, p.created_at DESC LIMIT 500")).map(out), serverKey: (await signingKey()).publicHex, pendingDays: PENDING_DAYS });
  }));
  api.post("/admin/pedals/approve", requireUser, wrap(async (req, res) => {
    await gate(req);
    const code = plainCode((req.body || {}).code);
    if (code.length !== 7) throw bad("Type the 7-letter code the pedal shows (like K7P-4QXR).");
    const p = (await q("SELECT * FROM pedals WHERE status='pending' AND created_at > now() - ($1 || ' days')::interval", [String(PENDING_DAYS)])).find((x) => plainCode(x.code) === code);
    if (!p) throw bad("No pedal is waiting with that code. Check it on the pedal's screen (it changes if the pedal registers again).", 404);
    const cert = await certificate(p.serial, p.public_key, p.kind);
    await q("UPDATE pedals SET status='approved', certificate=$2, code=NULL, approved_at=now(), approved_by=$3, note=$4 WHERE id=$1",
      [p.id, cert, req.user.id, String((req.body || {}).note || p.note || "").slice(0, 200)]);
    res.json({ pedal: out(await one(ROW + " WHERE p.id=$1", [p.id])) });
  }));
  api.post("/admin/pedals/:id", requireUser, wrap(async (req, res) => {
    await gate(req);
    const p = await one("SELECT * FROM pedals WHERE id=$1", [Number(req.params.id) || 0]);
    if (!p) throw bad("That pedal isn't there any more.", 404);
    const b = req.body || {};
    if (typeof b.updates === "boolean") await q("UPDATE pedals SET updates=$2 WHERE id=$1", [p.id, b.updates]);
    if (typeof b.note === "string") await q("UPDATE pedals SET note=$2 WHERE id=$1", [p.id, b.note.slice(0, 200)]);
    res.json({ pedal: out(await one(ROW + " WHERE p.id=$1", [p.id])) });
  }));
  api.post("/admin/pedals/:id/delete", requireUser, wrap(async (req, res) => {
    await gate(req);
    await q("DELETE FROM pedals WHERE id=$1", [Number(req.params.id) || 0]);
    res.json({ ok: true });
  }));
}
