/* Shorts (10.3) - the full-length videos from the service recording: just the worship set, and just the sermon.
 *   cuts(reg, f, sents, opts) -> { worship: { start, end, songs: [{ name, at }] } | null, sermon: { start, end, chapters } | null }
 *   worshipDescription / sermonDescription -> the text for YouTube / Facebook (song list with times; speaker, scripture,
 *   chapters - YouTube makes chapters from "0:00 Title" lines when there are at least three, the first at 0:00, each at
 *   least 10 seconds long)
 * Plain logic; worker.js cuts and encodes, index.js posts. */
"use strict";
const P = require("./pick");

function at(f, t) { return Math.max(0, Math.min(f.rms.length - 1, Math.round(t / f.hop))); }
/* where the sound dies away after t (within `max` seconds): the music's last ring, or the next quiet */
function tail(f, t, max) {
  const floor = f.floor != null ? f.floor : -60, i0 = at(f, t), i1 = at(f, t + max);
  for (let i = i0; i < i1; i++) { let q = true; for (let k = i; k < Math.min(i1, i + 8); k++) if (f.rms[k] > floor + 8) { q = false; break; } if (q) return Math.round(i * f.hop * 10) / 10; }
  return Math.round((t + Math.min(max, 3)) * 10) / 10;
}
function stamp(sec) { sec = Math.max(0, Math.floor(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0"); }

function cuts(reg, f, sents, opts) {
  const o = Object.assign({ setGap: 240, minSet: 120, minSermon: 300, lead: 2 }, opts || {}), out = { worship: null, sermon: null };
  // the worship set: songs one after another (talking or prayer between them under 4 minutes stays in), the longest run
  const sets = []; for (const s of reg.songs || []) { const l = sets[sets.length - 1]; if (l && s.start - l.end <= o.setGap && !(reg.sermon && reg.sermon.start > l.end && reg.sermon.start < s.start)) { l.end = s.end; l.songs.push(s); } else sets.push({ start: s.start, end: s.end, songs: [s] }); }
  const set = sets.filter((x) => x.end - x.start >= o.minSet).sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
  if (set) {
    const start = Math.max(0, P.breath(f, Math.max(0, set.start - o.lead), 2)), end = Math.min(f.dur, tail(f, set.end, 10));
    out.worship = { start, end, songs: set.songs.map((s) => ({ name: s.name, at: Math.max(0, Math.round((s.start - start) * 10) / 10) })) };
  }
  // the sermon: its talking, from its first sentence to its last (a little air either side)
  if (reg.sermon && reg.sermon.end - reg.sermon.start >= o.minSermon) {
    const inside = (sents || []).filter((s) => s.start >= reg.sermon.start - 5 && s.end <= reg.sermon.end + 5);
    const start = Math.max(0, (inside.length ? inside[0].start : reg.sermon.start) - 1), end = Math.min(f.dur, (inside.length ? inside[inside.length - 1].end : reg.sermon.end) + 1.5);
    const st = P.structure(inside), ch = st.chapters.map((c) => ({ at: Math.max(0, Math.round(c.start - start)), title: c.title }));
    if (ch.length && ch[0].at > 15) ch.unshift({ at: 0, title: "Introduction" }); else if (ch.length) ch[0].at = 0;   // (a first point in the opening seconds starts the video)
    const ok = ch.filter((c, i) => i === 0 || c.at - ch[i - 1].at >= 10);
    out.sermon = { start, end, chapters: ok.length >= 3 ? ok : [], theme: st.theme };
  }
  return out;
}
function worshipDescription(cut, v) {
  const lines = [v.intro || ""].concat(cut.songs.length >= 2 ? ["", "Songs:"].concat(cut.songs.map((s) => stamp(s.at) + " " + s.name)) : cut.songs.length ? ["", "Song: " + cut.songs[0].name] : []);
  if (v.ccli) lines.push("", v.ccli);
  if (v.links) lines.push("", v.links); if (v.hashtags) lines.push("", v.hashtags);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
function sermonDescription(cut, v) {
  const lines = [[v.speaker, v.scripture].filter(Boolean).join(" · "), v.intro || ""].filter(Boolean);
  if (cut.chapters.length) lines.push("", cut.chapters.map((c) => stamp(c.at) + " " + c.title).join("\n"));
  if (v.link) lines.push("", "The whole service: " + v.link);
  if (v.links) lines.push("", v.links); if (v.hashtags) lines.push("", v.hashtags);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
/* a title from its template: {date} {speaker} {scripture} {theme} {church} */
function title(tpl, v) { return String(tpl || "").replace(/\{(date|speaker|scripture|theme|church|sermon)\}/g, (_, k) => String(v[k] || "").trim()).replace(/\s*[-–·|]\s*$/, "").replace(/^\s*[-–·|]\s*/, "").replace(/\s{2,}/g, " ").trim().slice(0, 100) || "Sunday service"; }

module.exports = { cuts, worshipDescription, sermonDescription, title, stamp, tail };
