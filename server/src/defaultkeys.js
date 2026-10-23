// Default keys (9.5): one shared key per kind, for now, so the apps work before every church has its own. Staff switch
// them off on the staff page ("Default keys: on/off", saved in site_settings 'default_keys'); then the apps are told it
// was a temporary key at their next check and ask for a real one. They aren't rows in the database: no church, any
// number of devices, no end, updates always, no Central Tracks Unlimited. P, A and U work on /v1/license/...; S (all
// four sound plans) on /v1/package/....
import { one, q } from "./db.js";
import { config, DEFAULT_KEYS } from "./config.js";
import { isAdmin } from "./auth.js";
import { requireStep } from "./signin.js";

const canon = (k) => String(k || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const pretty = (k) => canon(k).match(/.{4}/g).join("-");
export const DEFAULT_CHURCH = "Motion Audio (default key)";
export const DEFAULT_END = "2099-12-31T00:00:00.000Z";   // (a package's plans: no real end)
// which default key this is (P, A, U or S), or null
export function defaultKind(key) { const c = canon(key); return Object.keys(DEFAULT_KEYS).find((k) => canon(DEFAULT_KEYS[k]) === c) || null; }
export async function defaultKeysOn() { const r = await one("SELECT data FROM site_settings WHERE name='default_keys'").catch(() => null); return !(r && r.data && r.data.on === false); }   // (on until staff switch them off)
export const defaultOffMessage = () => "This was a temporary key. Ask your church for its own key, or buy one at " + config.publicUrl + ".";

export function routes(api, { wrap, requireUser }) {
  const staff = async (req) => { if (!isAdmin(req.user)) { const e = new Error("Admins only."); e.status = 403; throw e; } await requireStep(req); };
  const view = async () => ({ on: await defaultKeysOn(), keys: Object.fromEntries(Object.entries(DEFAULT_KEYS).map(([k, v]) => [k, pretty(v)])) });
  api.get("/admin/default-keys", requireUser, wrap(async (req, res) => { await staff(req); res.json(await view()); }));
  api.post("/admin/default-keys", requireUser, wrap(async (req, res) => {
    await staff(req);
    await q("INSERT INTO site_settings (name,data,updated_by) VALUES ('default_keys',$1,$2) ON CONFLICT (name) DO UPDATE SET data=EXCLUDED.data, updated_at=now(), updated_by=EXCLUDED.updated_by", [{ on: req.body.on !== false }, req.user.email]);
    res.json(Object.assign({ ok: true }, await view()));
  }));
}
