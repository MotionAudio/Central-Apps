/* Shorts - the captions: lines of a few words, the word being said lit up (ASS subtitles, burned in by ffmpeg's
 * libass), plus a plain SRT next to each short for the platforms that take one.
 * Style (settings.captions): { on, font, size (% of the picture's height), color, highlight, outline, position
 * "top" | "middle" | "bottom", upper, words (per line) } */
"use strict";

const STYLE = { on: true, font: "Archivo SemiBold", size: 4.6, color: "#ffffff", highlight: "#ffd23f", outline: "#000000", position: "bottom", upper: false, words: 4, box: false };

/* words [{ text, start, end }] (seconds from the clip's start) -> lines [{ start, end, words }] */
function lines(words, perLine) {
  const n = Math.max(1, Math.min(8, Math.round(perLine || 4))), out = []; let cur = [];
  const flush = () => { if (cur.length) out.push({ start: cur[0].start, end: cur[cur.length - 1].end, words: cur }); cur = []; };
  (words || []).forEach((w) => {
    const prev = cur[cur.length - 1];
    if (prev && (w.start - prev.end > 0.6 || cur.length >= n || cur.map((x) => x.text).join(" ").length + w.text.length > 26)) flush();
    cur.push(w);
    if (/[.?!,;:]$/.test(w.text) && cur.length >= Math.ceil(n / 2)) flush();
  });
  flush();
  // each line stays up until the next one starts (no flicker in short gaps)
  out.forEach((l, i) => { const next = out[i + 1]; if (next && next.start - l.end < 0.6) l.end = next.start; else l.end += 0.25; });
  return out;
}

// "#rrggbb" -> ASS "&H00BBGGRR"
function assColor(hex, alpha) { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "")) || [0, "ffffff"]; const h = m[1].toUpperCase(); return "&H" + (alpha || "00") + h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2); }
function assTime(t) { t = Math.max(0, t); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = Math.floor(t) % 60, cs = Math.floor((t - Math.floor(t)) * 100); return h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0") + "." + String(cs).padStart(2, "0"); }
function assText(s) { return String(s).replace(/\\/g, "＼").replace(/[{}]/g, "").replace(/\n/g, " "); }

/* the .ass file for one short: words relative to the clip, W x H picture */
function ass(words, style, W, H) {
  const s = Object.assign({}, STYLE, style || {});
  W = W || 1080; H = H || 1920;
  const size = Math.round(H * Math.max(2, Math.min(9, Number(s.size) || 4.6)) / 100);
  const align = s.position === "top" ? 8 : s.position === "middle" ? 5 : 2, marginV = Math.round(H * (s.position === "middle" ? 0 : 0.14));
  const border = s.box ? 3 : 1, outline = s.box ? Math.round(size * 0.25) : Math.max(2, Math.round(size * 0.07));
  const head = "[Script Info]\nScriptType: v4.00+\nPlayResX: " + W + "\nPlayResY: " + H + "\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n" +
    "[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n" +
    "Style: Cap," + String(s.font || STYLE.font).replace(/,/g, " ") + "," + size + "," + assColor(s.color) + "," + assColor(s.highlight) + "," + assColor(s.outline, s.box ? "40" : "00") + "," + assColor(s.outline, "80") + ",-1,0,0,0,100,100,0,0," + border + "," + outline + ",0," + align + "," + Math.round(W * 0.08) + "," + Math.round(W * 0.08) + "," + marginV + ",1\n\n" +
    "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n";
  const hi = "{\\c" + assColor(s.highlight) + "}", lo = "{\\c" + assColor(s.color) + "}";
  const ev = [];
  lines(words, s.words).forEach((l) => {
    const t = l.words.map((w) => assText(s.upper ? w.text.toUpperCase() : w.text));
    l.words.forEach((w, i) => {
      const a = i === 0 ? l.start : w.start, b = i + 1 < l.words.length ? l.words[i + 1].start : l.end;
      if (b - a < 0.02) return;
      ev.push("Dialogue: 0," + assTime(a) + "," + assTime(b) + ",Cap,,0,0,0,," + t.map((x, k) => k === i ? hi + x + lo : x).join(" "));
    });
  });
  return head + ev.join("\n") + "\n";
}

function srtTime(t) { t = Math.max(0, t); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = Math.floor(t) % 60, ms = Math.round((t - Math.floor(t)) * 1000) % 1000; return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0") + "," + String(ms).padStart(3, "0"); }
function srt(words, perLine) { return lines(words, perLine).map((l, i) => (i + 1) + "\n" + srtTime(l.start) + " --> " + srtTime(l.end) + "\n" + l.words.map((w) => w.text).join(" ")).join("\n\n") + "\n"; }

/* edited caption text back onto the timed words: the same number of words keeps every time; a different number spreads
 * the new words over each line's time */
function retext(words, text) {
  const nw = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (!words || !words.length) return [];
  if (nw.length === words.length) return words.map((w, i) => Object.assign({}, w, { text: nw[i] }));
  const a = words[0].start, b = words[words.length - 1].end, step = (b - a) / Math.max(1, nw.length);
  return nw.map((t, i) => ({ text: t, start: Math.round((a + i * step) * 1000) / 1000, end: Math.round((a + (i + 1) * step) * 1000) / 1000 }));
}

module.exports = { STYLE, lines, ass, srt, retext, assColor };
