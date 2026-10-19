// Audio files live in Cloudflare R2 (S3-compatible). Browsers upload straight to R2 and the apps download straight
// from it, through short-lived signed links, so the server never streams the audio itself.
// With no R2 settings (local testing), files go to a folder and the server signs its own links.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "./config.js";

const S = config.storage;
export const usingR2 = !!(S.endpoint && S.bucket && S.accessKey && S.secretKey);
const s3 = usingR2 ? new S3Client({ region: "auto", endpoint: S.endpoint, credentials: { accessKeyId: S.accessKey, secretAccessKey: S.secretKey } }) : null;

export function newKey(userId, fileName) {
  const ext = (path.extname(fileName || "").toLowerCase().match(/^\.(wav|mp3|flac|m4a|aif|aiff|ogg|zip)$/) || [".bin"])[0];
  return "u" + userId + "/" + Date.now().toString(36) + "-" + crypto.randomBytes(6).toString("hex") + ext;
}

function localSig(op, key, exp) { return crypto.createHmac("sha256", config.tokenSecret).update(op + ":" + key + ":" + exp).digest("base64url"); }
export function checkLocalSig(op, key, exp, sig) {
  if (Number(exp) < Date.now()) return false;
  const want = Buffer.from(localSig(op, key, exp)), got = Buffer.from(String(sig || ""));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
export function localPath(key) {
  const p = path.resolve(S.localDir, key);
  if (!p.startsWith(path.resolve(S.localDir) + path.sep)) throw new Error("bad key");
  return p;
}

export async function uploadUrl(key, contentType) {
  if (usingR2) return getSignedUrl(s3, new PutObjectCommand({ Bucket: S.bucket, Key: key, ContentType: contentType || "application/octet-stream" }), { expiresIn: 3600 });
  const exp = Date.now() + 3600e3;
  return config.publicUrl + "/local-files/" + encodeURI(key) + "?op=put&exp=" + exp + "&sig=" + localSig("put", key, exp);
}
export async function downloadUrl(key, fileName) {
  if (usingR2) return getSignedUrl(s3, new GetObjectCommand({ Bucket: S.bucket, Key: key, ResponseContentDisposition: 'attachment; filename="' + String(fileName || "track").replace(/["\\\r\n]/g, "") + '"' }), { expiresIn: 3600 });
  const exp = Date.now() + 3600e3;
  return config.publicUrl + "/local-files/" + encodeURI(key) + "?op=get&exp=" + exp + "&sig=" + localSig("get", key, exp);
}
// the server reads a file once, to grade it
export async function fetchToTemp(key) {
  const tmp = path.join(fs.mkdtempSync(path.join((await import("node:os")).tmpdir(), "grade-")), path.basename(key));
  if (usingR2) {
    const r = await s3.send(new GetObjectCommand({ Bucket: S.bucket, Key: key }));
    const out = fs.createWriteStream(tmp);
    await new Promise((res, rej) => { r.Body.pipe(out); r.Body.on("error", rej); out.on("finish", res); out.on("error", rej); });
  } else fs.copyFileSync(localPath(key), tmp);
  return tmp;
}
export async function exists(key) {
  if (usingR2) { try { await s3.send(new GetObjectCommand({ Bucket: S.bucket, Key: key, Range: "bytes=0-0" })); return true; } catch { return false; } }
  try { return fs.statSync(localPath(key)).isFile(); } catch { return false; }
}
export async function remove(key) {
  if (usingR2) await s3.send(new DeleteObjectCommand({ Bucket: S.bucket, Key: key }));
  else { try { fs.unlinkSync(localPath(key)); } catch {} }
}
