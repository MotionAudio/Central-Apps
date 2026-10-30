// The demo church (10.0): Riverstone Church (demo), for showing Motion Audio to a church. While the default keys are on
// (staff page → Default keys), the server keeps a demo account ready: riverstone-demo@motionaudio.org with the password
// in config.js, its church, and Central Tracks Unlimited. Its keys are the built-in demo keys (config.js DEMO_KEYS and
// DEMO_PACKAGES), shown under its Purchases. The account sends no email (no invites, no password resets), skips the phone
// code (its password is shared on purpose) and can't be deleted or have its password changed; every start puts the
// password back. When the default keys are switched off, the demo account is locked out too.
import crypto from "node:crypto";
import { q, one } from "./db.js";
import { DEMO_ACCOUNT, DEMO_CHURCH, DEMO_KEYS, DEMO_PACKAGES, PLANS, PLAN_IDS, withPads } from "./config.js";
import { hashPassword } from "./auth.js";
import { defaultKeysOn } from "./defaultkeys.js";

const ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const code = () => Array.from({ length: 8 }, () => ABC[crypto.randomInt(ABC.length)]).join("");
export const isDemoEmail = (email) => String(email || "").trim().toLowerCase() === DEMO_ACCOUNT.email;
export const isDemoUser = (u) => !!u && isDemoEmail(u.email);

// make (or repair) the demo account and its church; nothing when the default keys are off
export async function seedDemo() {
  if (!(await defaultKeysOn())) return { seeded: false };
  let u = await one("SELECT * FROM users WHERE email=$1", [DEMO_ACCOUNT.email]);
  if (!u) u = await one("INSERT INTO users (email,name,pass_hash,email_confirmed,subscribed) VALUES ($1,$2,$3,TRUE,TRUE) RETURNING *", [DEMO_ACCOUNT.email, DEMO_ACCOUNT.name, hashPassword(DEMO_ACCOUNT.password)]);
  else await q("UPDATE users SET pass_hash=$2, email_confirmed=TRUE, subscribed=TRUE, deleted_at=NULL WHERE id=$1", [u.id, hashPassword(DEMO_ACCOUNT.password)]);
  let c = await one("SELECT c.* FROM churches c JOIN church_members m ON m.church_id=c.id WHERE m.user_id=$1", [u.id]);
  if (!c) {
    c = await one("INSERT INTO churches (name,owner_id,admin_code,user_code,has_pack,demo,subscribed) VALUES ($1,$2,$3,$4,TRUE,TRUE,TRUE) RETURNING *", [DEMO_CHURCH, u.id, code(), code()]);
    await q("INSERT INTO church_members (church_id,user_id,role) VALUES ($1,$2,'owner') ON CONFLICT DO NOTHING", [c.id, u.id]);
  } else await q("UPDATE churches SET name=$2, demo=TRUE, subscribed=TRUE, closed_at=NULL WHERE id=$1", [c.id, DEMO_CHURCH]);
  return { seeded: true, userId: u.id, churchId: c.id };
}
// a church made for the demo: no emails go out from it
export async function isDemoChurch(churchId) {
  if (!churchId) return false;
  const c = await one("SELECT demo FROM churches WHERE id=$1", [churchId]).catch(() => null);
  return !!(c && c.demo);
}
// the demo account's Purchases: its built-in keys, as one purchase
export function demoPurchase() {
  const pretty = (k) => k.replace(/[^A-Z0-9]/g, "").match(/.{4}/g).join("-");
  const apps = [["P", "Central Pedal Control", "pedal-control"], ["A", "Central Control", "control"], ["U", "Central Usage", "usage"]]
    .map(([kind, name, app]) => ({ kind, name, app, key: pretty(DEMO_KEYS[kind]) }));
  const packages = Object.entries(DEMO_PACKAGES).map(([key, plans]) => {
    const ids = PLAN_IDS.filter((id) => withPads(plans).includes(id));
    const all = PLAN_IDS.every((id) => ids.includes(id));
    return { key: pretty(key), planIds: ids, plans: all ? "All sound plans (with Central Pads)" : ids.map((id) => PLANS[id].name).join(", ") };
  });
  return { church: DEMO_CHURCH, apps, packages };
}
