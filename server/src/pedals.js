// The CM5 pedals' and control boxes' own codes (rev E), the website's side. Each one has a one-time chip under its main
// board. The Central Burner app (burn.js) gives the board its code when it loads the software, and leaves the code
// and a one-time pass on the boot partition (central-device.json). At its first start the device writes the code into
// that chip for good, then checks in here. The contract is in central-native's docs/DEVICE-CODES.md.
//   check-in   POST /v1/pedals/register {kind, code, pass, serial, board?, version}: the burner's code list
//              (burn.js, through setDeviceClaim) checks the pass and ties the code to that chip's serial for good.
//              The answer is {status: "ok", deviceCode}; the device then deletes the burner's file.
//   updates    POST /v1/pedals/update {kind, code, serial, board?, version, job?}: the code has to be a live one, and
//              its chip's serial has to be the one it checked in with (or, before it has checked in, the board's own
//              serial has to be the one it was burned on). When that pedal's updates are on and the build marked "the
//              one to ship" is newer, the answer is its version, what changed, its SHA-256 and a download link for an
//              hour. Nothing else gets a link to the pedal's software.
// A control box uses the same calls with kind "controller" and its job (pedal, inears or wave) on update checks: its
// updates are the ship build of that job's kind (io-pedal, io-inears, io-wave in builds.js).
import { q, one } from "./db.js";
import { canSee } from "./builds.js";
import { requireStep } from "./signin.js";
import * as store from "./storage.js";

function bad(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }
const SERIAL = /^[0-9a-f]{18}$/, VERSION = /^[0-9][0-9A-Za-z.+~-]{0,39}$/;
const DEVICE_CODE = /^[A-Za-z0-9][A-Za-z0-9-]{2,25}$/, PASS = /^[A-Za-z0-9_-]{16,128}$/, BOARD = /^[0-9a-fA-F:x ]{8,40}$/;

// The burner's code list says whether a code may go with this chip:
//   fn({kind, code, pass?, serial, board?}) → {code} when it may; throws an Error with .status (403 a wrong pass or
//   another chip, 404 no such code...) when it may not. With a pass: the burner's pass ties the code to the serial.
//   Without one: the serial has to be the one tied to it already, or the board the one the code was burned on.
let deviceClaim = null;
export function setDeviceClaim(fn) { deviceClaim = typeof fn === "function" ? fn : null; }
export async function pedalByDeviceCode(code) { return one("SELECT id, serial, status, updates, last_seen, last_version FROM pedals WHERE device_code=$1", [String(code || "")]); }

export const kindOf = (k) => (k === "controller" ? "controller" : "pedal");
const noun = (kind) => (kind === "controller" ? "control box" : "pedal");
const JOB_BUILDS = { pedal: "io-pedal", inears: "io-inears", wave: "io-wave" };

export function newer(a, b) {
  const p = (v) => String(v || "").split(/[^0-9]+/).filter(Boolean).slice(0, 3).map(Number).concat([0, 0, 0]).slice(0, 3);
  const x = p(a), y = p(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
const pretty = (serial) => String(serial || "").toUpperCase().replace(/(.{4})(?=.)/g, "$1 ");
const out = (p) => ({ id: Number(p.id), kind: kindOf(p.kind), serial: p.serial, serialText: pretty(p.serial), deviceCode: p.device_code || "", updates: p.updates,
  note: p.note, version: p.last_version || p.first_version || "", lastSeen: p.last_seen, registeredAt: p.approved_at || p.created_at });

async function gate(req) {
  if (!canSee(req.user)) throw bad("Only the website's owner can see the pedals.", 403);
  await requireStep(req);
}

// what a device says about itself, checked; then the code list's yes (or why not)
async function claimed(b, withPass) {
  const kind = kindOf(b.kind), what = noun(kind);
  const serial = String(b.serial || "").toLowerCase(), code = String(b.code || "").toUpperCase(), pass = String(b.pass || "");
  const board = BOARD.test(String(b.board || "")) ? String(b.board) : "";
  if (!SERIAL.test(serial) || !DEVICE_CODE.test(code)) throw bad("That isn't a " + what + "'s code and chip.");
  if (withPass && !PASS.test(pass)) throw bad("That isn't the burner's pass.");
  if (!deviceClaim) throw bad("The website can't check device codes right now. Try again later.", 503);
  const said = await deviceClaim({ kind, code, pass: withPass ? pass : undefined, serial, board });
  const dc = String((said && said.code) || code).toUpperCase();
  const taken = await one("SELECT id FROM pedals WHERE device_code=$1 AND serial<>$2", [dc, serial]);
  if (taken) throw bad("The code " + dc + " is already another device's. Contact Motion Audio.", 409);
  const was = await one("SELECT * FROM pedals WHERE serial=$1", [serial]);
  if (was && was.device_code && was.device_code !== dc) throw bad("This " + what + "'s chip already has the code " + was.device_code + ". Contact Motion Audio.", 409);
  const version = VERSION.test(String(b.version || "")) ? String(b.version) : "";
  if (was) await q("UPDATE pedals SET kind=$2, device_code=$3, status='approved', approved_at=COALESCE(approved_at, now()) WHERE id=$1", [was.id, kind, dc]);
  else await q("INSERT INTO pedals (serial, kind, device_code, status, first_version, approved_at, note) VALUES ($1,$2,$3,'approved',$4,now(),'Loaded with the burner') ON CONFLICT (serial) DO NOTHING",
    [serial, kind, dc, version]);
  return { kind, what, serial, code: dc, version, row: await one("SELECT * FROM pedals WHERE serial=$1", [serial]) };
}

export function routes(api, { wrap, brake, requireUser }) {
  const slow = (req) => { if (brake) brake(req); };
  // ---------------------------------------------------------------- the device's own calls (no account)
  api.post("/pedals/register", wrap(async (req, res) => {
    slow(req);
    const c = await claimed(req.body || {}, true);
    res.json({ status: "ok", deviceCode: c.code });
  }));
  api.post("/pedals/update", wrap(async (req, res) => {
    slow(req);
    const b = req.body || {};
    const c = await claimed(b, false), p = c.row;
    const buildKind = c.kind === "controller" ? JOB_BUILDS[String(b.job || "")] : "pedal";
    if (!buildKind) throw bad("Which program is this control box running?");
    await q("UPDATE pedals SET last_seen=now(), last_version=$2 WHERE id=$1", [p.id, c.version]);
    if (!p.updates) throw bad("Updates are off for this " + c.what + ". Contact Motion Audio.", 403);
    res.set("Cache-Control", "no-store");
    const ship = await one("SELECT * FROM builds WHERE kind=$1 AND ship AND state='ready'", [buildKind]);
    if (!ship || !/\.deb$/i.test(ship.name) || !ship.sha256 || !newer(ship.version, c.version)) return res.json({ upToDate: true, version: ship ? ship.version : c.version });
    await q("UPDATE builds SET downloads=downloads+1 WHERE id=$1", [ship.id]);
    res.json({ update: { version: ship.version, notes: ship.notes || "", sha256: ship.sha256, bytes: Number(ship.bytes), name: ship.name, url: await store.downloadUrl(ship.storage_key, ship.name) } });
  }));

  // ---------------------------------------------------------------- the owner's (Account → Pedal builds → Pedals)
  api.get("/admin/pedals", requireUser, wrap(async (req, res) => {
    await gate(req);
    res.set("Cache-Control", "no-store");
    res.json({ pedals: (await q("SELECT * FROM pedals WHERE status='approved' ORDER BY created_at DESC LIMIT 500")).map(out) });
  }));
  api.post("/admin/pedals/:id", requireUser, wrap(async (req, res) => {
    await gate(req);
    const p = await one("SELECT * FROM pedals WHERE id=$1", [Number(req.params.id) || 0]);
    if (!p) throw bad("That pedal isn't there any more.", 404);
    const b = req.body || {};
    if (typeof b.updates === "boolean") await q("UPDATE pedals SET updates=$2 WHERE id=$1", [p.id, b.updates]);
    if (typeof b.note === "string") await q("UPDATE pedals SET note=$2 WHERE id=$1", [p.id, b.note.slice(0, 200)]);
    res.json({ pedal: out(await one("SELECT * FROM pedals WHERE id=$1", [p.id])) });
  }));
  api.post("/admin/pedals/:id/delete", requireUser, wrap(async (req, res) => {
    await gate(req);
    await q("DELETE FROM pedals WHERE id=$1", [Number(req.params.id) || 0]);
    res.json({ ok: true });
  }));
}
