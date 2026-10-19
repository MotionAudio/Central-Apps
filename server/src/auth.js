// Passwords: scrypt. Sign-in tokens: HMAC-signed "userId.expires.signature" (30 days), sent as a Bearer token.
import crypto from "node:crypto";
import { config } from "./config.js";
import { one } from "./db.js";

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64);
  return "scrypt$" + salt.toString("hex") + "$" + key.toString("hex");
}
export function checkPassword(pw, stored) {
  const [, saltHex, keyHex] = String(stored).split("$");
  if (!saltHex || !keyHex) return false;
  const key = crypto.scryptSync(pw, Buffer.from(saltHex, "hex"), 64);
  return crypto.timingSafeEqual(key, Buffer.from(keyHex, "hex"));
}
function sign(s) { return crypto.createHmac("sha256", config.tokenSecret).update(s).digest("base64url"); }
export function makeToken(userId) {
  const body = userId + "." + (Date.now() + 30 * 864e5);
  return body + "." + sign(body);
}
export function readToken(tok) {
  const parts = String(tok || "").split(".");
  if (parts.length !== 3) return null;
  const body = parts[0] + "." + parts[1], sig = Buffer.from(parts[2]), want = Buffer.from(sign(body));
  if (sig.length !== want.length || !crypto.timingSafeEqual(sig, want)) return null;
  if (Number(parts[1]) < Date.now()) return null;
  return Number(parts[0]);
}

// Express middleware: req.user when signed in
export async function attachUser(req, _res, next) {
  const h = req.headers.authorization || "";
  const id = h.startsWith("Bearer ") ? readToken(h.slice(7)) : null;
  req.user = id ? await one("SELECT * FROM users WHERE id=$1", [id]) : null;
  next();
}
export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Sign in to Central Tracks" });
  next();
}
export function isAdmin(user) { return !!user && config.adminEmails.includes(user.email.toLowerCase()); }
