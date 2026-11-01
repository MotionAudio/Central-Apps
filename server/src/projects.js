// Central Production projects in your Motion Audio account (10.2). A project is one .cmproj file (a zip: project.json
// and its audio). The app on a computer and the website's /production/ both save here, so either one opens what the
// other saved. Each account has a storage limit (PROJECT_STORAGE_MB, 2 GB to start).
//
//   GET  /v1/projects                         { projects: [{ id, name, type, bytes, updatedAt, version }], used, limit }
//   POST /v1/projects { id?, name, type, size } { project, url, key }  a new version's upload link (PUT the .cmproj there)
//   POST /v1/projects/:id/done { key }        { project }            the upload finished: it becomes the project's file
//   GET  /v1/projects/:id                     { project, url }       a download link for the newest version
//   POST /v1/projects/:id/delete              { ok }
// The file goes straight to storage (R2, or the local folder in testing) through short-lived signed links, like every
// other upload. A version is only swapped in when its upload is there and the right size; the older file is then removed.
import crypto from "node:crypto";
import { q, one } from "./db.js";
import * as store from "./storage.js";

function bad(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }
export const TYPES = ["track", "loop", "sample", "pad", "instrument", "plugin", "board"];
export const limitBytes = () => Math.max(50, Number(process.env.PROJECT_STORAGE_MB) || 2048) * 1024 * 1024;
const MAX_ONE = 1024 ** 3;   // one project file: up to 1 GB

const out = (r) => ({ id: r.id, name: r.name, type: r.type, bytes: Number(r.bytes) || 0, version: r.version, updatedAt: r.updated_at, createdAt: r.created_at });
async function usedBy(userId, except) {
  const r = await one("SELECT COALESCE(SUM(bytes),0)::bigint AS n FROM production_projects WHERE user_id=$1 AND storage_key IS NOT NULL" + (except ? " AND id<>$2" : ""), except ? [userId, except] : [userId]);
  return Number(r.n) || 0;
}
async function mine(req) {
  const p = await one("SELECT * FROM production_projects WHERE id=$1 AND user_id=$2", [String(req.params.id || ""), req.user.id]);
  if (!p) throw bad("That project isn't in your account.", 404);
  return p;
}

export function routes(api, { wrap, requireUser }) {
  api.get("/projects", requireUser, wrap(async (req, res) => {
    const rows = await q("SELECT * FROM production_projects WHERE user_id=$1 AND storage_key IS NOT NULL ORDER BY updated_at DESC LIMIT 500", [req.user.id]);
    res.json({ projects: rows.map(out), used: await usedBy(req.user.id), limit: limitBytes() });
  }));
  // a new project, or a new version of one: the upload link
  api.post("/projects", requireUser, wrap(async (req, res) => {
    const b = req.body || {}, size = Math.round(Number(b.size) || 0);
    const name = String(b.name || "").trim().slice(0, 120) || "Untitled", type = TYPES.includes(b.type) ? b.type : null;
    if (!type) throw bad("Unknown project type.");
    if (!(size > 0)) throw bad("That project is empty.");
    if (size > MAX_ONE) throw bad("A project can be up to 1 GB. Remove audio it doesn't use, or keep this one on your computer.");
    let p = b.id ? await one("SELECT * FROM production_projects WHERE id=$1 AND user_id=$2", [String(b.id), req.user.id]) : null;
    const used = await usedBy(req.user.id, p && p.id);
    if (used + size > limitBytes()) throw bad("Your account has " + Math.round((limitBytes() - used) / 1048576) + " MB of project space left, and this project is " + Math.round(size / 1048576) + " MB. Delete projects you don't need, or keep this one on your computer.", 413);
    if (!p) p = await one("INSERT INTO production_projects (id,user_id,name,type) VALUES ($1,$2,$3,$4) RETURNING *", [b.id && /^[A-Za-z0-9_-]{6,40}$/.test(String(b.id)) ? String(b.id) : "p" + crypto.randomBytes(9).toString("hex"), req.user.id, name, type]);
    else await q("UPDATE production_projects SET name=$1 WHERE id=$2", [name, p.id]);
    const key = "projects/u" + req.user.id + "/" + p.id + "/" + Date.now().toString(36) + "-" + crypto.randomBytes(4).toString("hex") + ".zip";
    await q("UPDATE production_projects SET pending_key=$1, pending_bytes=$2 WHERE id=$3", [key, size, p.id]);
    res.json({ project: out(Object.assign(p, { name })), key, url: await store.uploadUrl(key, "application/zip") });
  }));
  api.post("/projects/:id/done", requireUser, wrap(async (req, res) => {
    const p = await mine(req), key = String((req.body || {}).key || "");
    if (!key || key !== p.pending_key) throw bad("That upload isn't this project's newest one. Save again.");
    if (!(await store.exists(key))) throw bad("The project didn't finish uploading. Save again.");
    const old = p.storage_key;
    const r = await one("UPDATE production_projects SET storage_key=$1, bytes=$2, pending_key=NULL, pending_bytes=NULL, version=version+1, updated_at=now() WHERE id=$3 RETURNING *", [key, p.pending_bytes || 0, p.id]);
    if (old && old !== key) store.remove(old).catch(() => { });
    res.json({ project: out(r) });
  }));
  api.get("/projects/:id", requireUser, wrap(async (req, res) => {
    const p = await mine(req); if (!p.storage_key) throw bad("That project has no saved file yet.", 404);
    res.json({ project: out(p), url: await store.downloadUrl(p.storage_key, p.name.replace(/[^\w .-]+/g, "") + ".cmproj") });
  }));
  api.post("/projects/:id/delete", requireUser, wrap(async (req, res) => {
    const p = await mine(req);
    await q("DELETE FROM production_projects WHERE id=$1", [p.id]);
    for (const k of [p.storage_key, p.pending_key]) if (k) store.remove(k).catch(() => { });
    res.json({ ok: true });
  }));
}
