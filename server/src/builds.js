// Pedal builds (rev E): the Central Pedal's software, its SD card images and the two boards' firmware, kept private in the
// file storage (Cloudflare R2) under builds/. The software is closed: only the website's owner (and anyone added in
// BUILDS_EMAILS) can see this, after the sign-in code. Nothing here is linked from a public page and every link is signed
// and lasts an hour.
//   Account → Staff → Pedal builds: pick what it is, type the version and what changed, choose the file. The browser
//   sends the file straight to storage (one signed upload, up to 4.9 GB: compress an image with xz first), then tells us
//   it's there; we check its size and work out its SHA-256 (the pedals check a download against it).
//   Each kind has one build marked "the one to ship". Download makes a link for an hour; Delete removes the file too.
import { q, one } from "./db.js";
import { isOwner } from "./auth.js";
import { requireStep } from "./signin.js";
import * as store from "./storage.js";

function bad(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }
export const KINDS = [
  { id: "pedal", name: "Central Pedal software", hint: "The pedal's app for the CM5: a .deb or .tar.zst" },
  { id: "image", name: "SD card image", hint: "The whole pedal system, ready to flash: .img.xz" },
  { id: "audio-fw", name: "Audio board firmware", hint: "The RP2040 on the main board: .uf2" },
  { id: "controls-fw", name: "Controls board firmware", hint: "The RP2040 on the footswitch board: .uf2" },
  { id: "other", name: "Other files", hint: "Source archives, notes, anything else for the pedal" },
];
const KIND = Object.fromEntries(KINDS.map((k) => [k.id, k]));
export const MAX_BYTES = 4.9e9;   // (one signed upload to R2 goes up to 5 GB)
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,39}$/;
const EXT = /\.(deb|zst|gz|xz|bz2|zip|tar|img|iso|uf2|bin|hex|elf|txt|md|pdf|json|sha256|sig|asc|log)$/i;
const cleanName = (s) => String(s || "").normalize("NFKD").replace(/[^\w.+-]+/g, "-").replace(/-+\./g, ".").replace(/^[-.]+|-+$/g, "").slice(0, 120);

export function canSee(user) {
  if (!user) return false;
  const extra = String(process.env.BUILDS_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return isOwner(user) || (user.email_confirmed !== false && extra.includes(String(user.email || "").toLowerCase()));
}
async function gate(req) {
  if (!canSee(req.user)) throw bad("Only the website's owner can see the pedal builds.", 403);
  await requireStep(req);
}
const out = (b) => ({ id: Number(b.id), kind: b.kind, kindName: (KIND[b.kind] || {}).name || b.kind, version: b.version, name: b.name, bytes: Number(b.bytes),
  sha256: b.sha256 || null, notes: b.notes, state: b.state, ship: b.ship, by: b.by_name || b.by_email || "", at: b.created_at, downloads: b.downloads });
const ROW = "SELECT b.*, u.name AS by_name, u.email AS by_email FROM builds b LEFT JOIN users u ON u.id=b.uploaded_by";

// the file's SHA-256, read back from storage (in the background: an image takes a minute)
const hashing = new Set();
function hashLater(id, key) {
  if (hashing.has(id)) return;
  hashing.add(id);
  store.sha256Of(key).then((h) => q("UPDATE builds SET sha256=$2 WHERE id=$1", [id, h])).catch((e) => console.error("build hash", id, e.message)).finally(() => hashing.delete(id));
}

export function routes(api, { wrap, requireUser }) {
  api.get("/admin/builds", requireUser, wrap(async (req, res) => {
    await gate(req);
    // (an upload that never finished: gone after a day)
    for (const s of await q("SELECT id, storage_key FROM builds WHERE state='uploading' AND created_at < now() - interval '1 day'")) {
      await store.remove(s.storage_key).catch(() => { });
      await q("DELETE FROM builds WHERE id=$1", [s.id]);
    }
    const rows = await q(ROW + " ORDER BY b.created_at DESC LIMIT 300");
    for (const r of rows) if (r.state === "ready" && !r.sha256) hashLater(Number(r.id), r.storage_key);
    res.json({ kinds: KINDS, builds: rows.map(out), maxBytes: MAX_BYTES, storage: store.usingR2 ? "Cloudflare R2" : "this server's folder (testing)" });
  }));
  // a new build: its row, and a signed upload link for the browser
  api.post("/admin/builds", requireUser, wrap(async (req, res) => {
    await gate(req);
    const b = req.body || {}, kind = String(b.kind || ""), version = String(b.version || "").trim().replace(/^v(?=\d)/i, ""), name = cleanName(b.name), size = Number(b.size);
    if (!KIND[kind]) throw bad("Pick what this build is.");
    if (!VERSION.test(version)) throw bad("Type the version, like 1.0.0 (letters, numbers, dots and dashes).");
    if (!name || !EXT.test(name)) throw bad("That kind of file can't go here. Use .img.xz, .deb, .tar.zst, .uf2, .zip and the like.");
    if (!(size > 0)) throw bad("That file is empty.");
    if (size > MAX_BYTES) throw bad("That file is " + (size / 1e9).toFixed(1) + " GB. One upload can be up to 4.9 GB: compress it first (xz -T0 -9 the image).");
    if (await one("SELECT 1 FROM builds WHERE kind=$1 AND version=$2 AND name=$3 AND state='ready'", [kind, version, name])) throw bad("There's already a " + name + " in " + kind + " " + version + ". Delete that one first, or change the version.");
    const key = "builds/" + kind + "/" + version + "/" + Date.now().toString(36) + "-" + name;
    const row = await one("INSERT INTO builds (kind,version,name,storage_key,bytes,notes,uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
      [kind, version, name, key, Math.round(size), String(b.notes || "").slice(0, 4000), req.user.id]);
    res.json({ build: out(await one(ROW + " WHERE b.id=$1", [row.id])), uploadUrl: await store.uploadUrl(key, "application/octet-stream") });
  }));
  // the browser finished sending it: check it's all there
  api.post("/admin/builds/:id/done", requireUser, wrap(async (req, res) => {
    await gate(req);
    const b = await one("SELECT * FROM builds WHERE id=$1", [Number(req.params.id) || 0]);
    if (!b) throw bad("That build isn't there any more.", 404);
    const got = await store.sizeOf(b.storage_key);
    if (got == null) throw bad("The file didn't reach the storage. Try the upload again.");
    if (got !== Number(b.bytes)) throw bad("Only " + got + " of " + b.bytes + " bytes arrived. Try the upload again.");
    await q("UPDATE builds SET state='ready' WHERE id=$1", [b.id]);
    if (!(await one("SELECT 1 FROM builds WHERE kind=$1 AND ship AND id<>$2", [b.kind, b.id]))) await q("UPDATE builds SET ship=TRUE WHERE id=$1", [b.id]);   // (the first of its kind ships)
    hashLater(Number(b.id), b.storage_key);
    res.json({ build: out(await one(ROW + " WHERE b.id=$1", [b.id])) });
  }));
  // what changed, and "the one to ship"
  api.post("/admin/builds/:id", requireUser, wrap(async (req, res) => {
    await gate(req);
    const b = await one("SELECT * FROM builds WHERE id=$1 AND state='ready'", [Number(req.params.id) || 0]);
    if (!b) throw bad("That build isn't there any more.", 404);
    const body = req.body || {};
    if (typeof body.notes === "string") await q("UPDATE builds SET notes=$2 WHERE id=$1", [b.id, body.notes.slice(0, 4000)]);
    if (body.ship === true) { await q("UPDATE builds SET ship=FALSE WHERE kind=$1", [b.kind]); await q("UPDATE builds SET ship=TRUE WHERE id=$1", [b.id]); }
    res.json({ build: out(await one(ROW + " WHERE b.id=$1", [b.id])) });
  }));
  // a download link (an hour)
  api.get("/admin/builds/:id/link", requireUser, wrap(async (req, res) => {
    await gate(req);
    const b = await one("SELECT * FROM builds WHERE id=$1 AND state='ready'", [Number(req.params.id) || 0]);
    if (!b) throw bad("That build isn't there any more.", 404);
    await q("UPDATE builds SET downloads=downloads+1 WHERE id=$1", [b.id]);
    res.set("Cache-Control", "no-store");
    res.json({ url: await store.downloadUrl(b.storage_key, b.name), name: b.name, sha256: b.sha256 || null });
  }));
  api.post("/admin/builds/:id/delete", requireUser, wrap(async (req, res) => {
    await gate(req);
    const b = await one("SELECT * FROM builds WHERE id=$1", [Number(req.params.id) || 0]);
    if (!b) return res.json({ ok: true });
    await store.remove(b.storage_key).catch(() => { });
    await q("DELETE FROM builds WHERE id=$1", [b.id]);
    if (b.ship) { const next = await one("SELECT id FROM builds WHERE kind=$1 AND state='ready' ORDER BY created_at DESC LIMIT 1", [b.kind]); if (next) await q("UPDATE builds SET ship=TRUE WHERE id=$1", [next.id]); }
    res.json({ ok: true });
  }));
}
