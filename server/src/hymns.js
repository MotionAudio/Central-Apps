// Central Tracks hymns (10.0): Motion Audio's own multitracks of public-domain hymns, rendered by the apps repository's
// CI (tools/make-hymns.py, in .github/workflows/libraries.yml) and published with hymns-index.json at HYMNS_BASE_URL -
// today the GitHub release "central-tracks", later Cloudflare R2.
//
// They are ordinary Central Tracks: listed in the store, bought like any multitrack, and included in Central Tracks
// Unlimited. The website reads the published index when it starts and every hour after, and keeps one track per hymn
// (published by the "Motion Audio" account) in step with it: new hymns appear, changed files are replaced. Nothing is
// listed until the index is published, so a hymn never shows before its files exist. The files stay where CI put them:
// a track file's storage key is its https address (storage.downloadUrl hands those out as they are).
import { q, one } from "./db.js";
import { STAR_PRICE_CENTS } from "./config.js";

export const PUBLISHER_EMAIL = "central-tracks@motion-audio.invalid";   // (no one signs in with it: its password can't match)
export const STARS = 4;   // (the price comes from the star grade: 4 stars = STAR_PRICE_CENTS[4])
const EVERY_MS = 60 * 60e3;
const str = (v, n) => String(v == null ? "" : v).slice(0, n);
const URL_RE = /^https:\/\/[^\s"'<>]+$/;
const ROLES = new Set(["drums", "bass", "keys", "guitar", "vocals", "music", "click", "guide"]);

export function baseUrl() { return (process.env.HYMNS_BASE_URL || "https://github.com/MotionAudio/central-apps/releases/download/central-tracks").trim().replace(/\/+$/, ""); }

// one hymn from the index as it's kept (only known fields, plain values: the index comes from outside)
export function clean(h) {
  if (!h || typeof h !== "object" || !/^[a-z0-9-]{3,60}$/.test(h.id || "") || !Array.isArray(h.stems)) return null;
  const file = (f, role) => (f && URL_RE.test(f.url || "") ? { name: str(f.name, 80) || "file", role: role || (ROLES.has(f.role) ? f.role : ""), url: f.url } : null);
  const stems = h.stems.slice(0, 16).map((f) => file(f)).filter(Boolean);
  const song = file(h.song, "song"), mix = file(h.mix, "");
  if (!stems.length || !song) return null;
  return {
    id: h.id, title: str(h.title, 120), artist: str(h.artist, 80) || "Motion Audio", key: str(h.key, 4), bpm: Math.max(0, Math.min(400, Number(h.bpm) || 0)),
    words: str(h.words, 200), music: str(h.music, 200), stems, song, mix, preview: file(h.preview, ""),
  };
}

async function publisher() {
  const u = await one("SELECT id FROM users WHERE email=$1", [PUBLISHER_EMAIL]);
  if (u) return u.id;
  const r = await one("INSERT INTO users (email, name, pass_hash) VALUES ($1, 'Motion Audio', '!no-sign-in') ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name RETURNING id", [PUBLISHER_EMAIL]);
  return r.id;
}

// the published index -> the Central Tracks rows (one per hymn). Returns {source, hymns, added, updated}.
export async function sync(fetcher = fetch) {
  const base = baseUrl();
  let list;
  try {
    const r = await fetcher(base + "/hymns-index.json", { headers: { Accept: "application/json", "User-Agent": "motion-audio" }, signal: AbortSignal.timeout(8000), redirect: "follow" });
    if (!r.ok) return { source: "none", hymns: 0, added: 0, updated: 0 };
    const j = await r.json();
    list = (Array.isArray(j && j.hymns) ? j.hymns : []).map(clean).filter(Boolean);
  } catch (_) {
    return { source: "none", hymns: 0, added: 0, updated: 0 };
  }
  if (!list.length) return { source: "index", hymns: 0, added: 0, updated: 0 };
  const pub = await publisher();
  let added = 0, updated = 0;
  for (const h of list) {
    const report = [{ note: "A Motion Audio arrangement of a public-domain hymn", words: h.words, music: h.music, hymn: h.id }];
    let t = await one("SELECT id FROM tracks WHERE publisher_id=$1 AND grade_report @> $2::jsonb", [pub, JSON.stringify([{ hymn: h.id }])]);
    if (t) {
      await q("UPDATE tracks SET title=$2, artist=$3, song_key=$4, bpm=$5, grade_report=$6, status=CASE WHEN status='removed' THEN status ELSE 'live' END WHERE id=$1", [t.id, h.title, h.artist, h.key, h.bpm, JSON.stringify(report)]);
      updated++;
    } else {
      t = await one(`INSERT INTO tracks (publisher_id,title,artist,kind,song_key,bpm,stars,price_cents,grade_report,rights_ok)
        VALUES ($1,$2,$3,'Multitrack',$4,$5,$6,$7,$8,TRUE) RETURNING id`, [pub, h.title, h.artist, h.key, h.bpm, STARS, STAR_PRICE_CENTS[STARS], JSON.stringify(report)]);
      added++;
    }
    await q("DELETE FROM track_files WHERE track_id=$1", [t.id]);
    const files = h.stems.map((f) => [f.name, f.role, f.url, false]).concat([[h.song.name, "song", h.song.url, false]]);   // (song.json says which stems start muted)
    if (h.mix) files.push([h.mix.name, "", h.mix.url, true]);
    for (const [name, role, url, isMix] of files) await q("INSERT INTO track_files (track_id,name,role,storage_key,is_mix) VALUES ($1,$2,$3,$4,$5)", [t.id, name, role, url, isMix]);
  }
  return { source: "index", hymns: list.length, added, updated };
}

export function start() {
  const run = () => sync().then((r) => { if (r.added || r.updated) console.log("Central Tracks hymns:", JSON.stringify(r)); }).catch((e) => console.warn("hymns:", e.message));
  run();
  setInterval(run, EVERY_MS).unref();
}
