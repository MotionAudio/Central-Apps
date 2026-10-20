// Version numbers: 9.0, 9.1 … 9.9, then 10.0. Each .1 is a full release; a fix is the third number (9.4.1).
// Update coverage: a Central Control (A) or Central Usage (U) key bought while 8.4 is current gets every update through
// 9.4 (ten full releases); renewing ($20 a key) moves that to ten full releases past the current one. Central Pedal and
// Central Pedal Control (P) keys get updates forever. An app never stops working - it just doesn't install versions
// past its key's coverage.
// Versions are compared as "tenths": 9.4.2 -> 94. The current release comes from GitHub (the newest release of
// MotionAudio/Central-Apps, looked up at most once an hour) or CURRENT_VERSION.
const REPO = process.env.CC_UPDATE_REPO || "MotionAudio/Central-Apps";
export const COVER_RELEASES = 10;   // ten full releases = one whole version (8.4 -> 9.4)

export function tenths(v) {
  if (typeof v === "number") return v;
  const n = String(v || "").replace(/^v/i, "").match(/^(\d+)(?:\.(\d+))?/);
  return n ? Number(n[1]) * 10 + Math.min(9, Number(n[2] || 0)) : null;
}
export function fmt(t) { return t == null ? null : Math.floor(t / 10) + "." + (t % 10); }

let cached = { at: 0, t: tenths(process.env.CURRENT_VERSION) || 90 };
export async function currentTenths() {
  if (process.env.CURRENT_VERSION) return tenths(process.env.CURRENT_VERSION);
  if (Date.now() - cached.at < 3600e3) return cached.t;
  cached.at = Date.now();
  try {
    const r = await fetch("https://api.github.com/repos/" + REPO + "/releases/latest", { headers: { Accept: "application/vnd.github+json", "User-Agent": "motion-audio" }, signal: AbortSignal.timeout(8000) });
    if (r.ok) { const t = tenths((await r.json()).tag_name); if (t) cached.t = t; }
  } catch (_) { }
  return cached.t;
}
// the coverage of a key bought (or renewed) now: through the current version + one whole version
export async function newCoverage(from) { const now = await currentTenths(); return Math.max(now, from || 0) + COVER_RELEASES; }
