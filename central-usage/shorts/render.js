/* Shorts - making one short with ffmpeg: 9:16 (1080 x 1920, 30 fps), the speaker kept in frame or the wide shot over a
 * blurred copy of itself, the captions burned in, the church's logo, an optional intro / outro, the sound brought to
 * the level social apps play at (-14 LUFS), and a picture for the list.
 *
 *   render({ bin, out, work, start, end, video: { file, lag, w, h } | null, audio: { file, lag }, words, settings, fonts, path })
 *     start / end: seconds on the recording's clock; a source's lag: where its own 0 sits on that clock
 *     words: the clip's words (times on the recording's clock); path: the crop path from audio.cropPath (or null)
 *   thumb(bin, file, out) */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { run } = require("./audio");
const C = require("./captions");

const W = 1080, H = 1920, FPS = 30;
const DEFAULTS = { framing: "auto", background: "#16181d", accent: "#ffd23f", logo: "", logoCorner: "top-right", logoSize: 16, logoOpacity: 0.9, intro: "", introSeconds: 2.5, outro: "", outroSeconds: 3, loudness: -14 };

function num(x) { return Math.round(x * 1000) / 1000; }
function hex(c, d) { return /^#[0-9a-f]{6}$/i.test(String(c || "")) ? String(c).slice(1) : d; }
/* the crop's x (left edge, in pixels) over time from the path: piecewise straight lines between its points */
function cropX(pts) {
  if (!pts || !pts.length) return "(iw-ow)/2";
  const step = Math.max(1, Math.ceil(pts.length / 70)), p = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);   // (at most ~70 pieces: ffmpeg's expressions nest)
  const px = (x) => "(" + num(x) + "*iw-ow/2)";
  let e = px(p[p.length - 1].x);
  for (let i = p.length - 2; i >= 0; i--) { const a = p[i], b = p[i + 1], d = Math.max(0.01, b.t - a.t); e = "if(lt(t," + num(b.t) + ")," + px(a.x) + "+(" + px(b.x) + "-" + px(a.x) + ")*(t-" + num(a.t) + ")/" + num(d) + "," + e + ")"; }
  return "max(0,min(iw-ow," + e + "))";
}

function isImage(f) { return /\.(png|jpe?g|webp|bmp|gif)$/i.test(f || ""); }

async function render(o) {
  const s = Object.assign({}, DEFAULTS, o.settings || {}), cap = Object.assign({}, C.STYLE, (o.settings || {}).captions || {});
  const dur = num(o.end - o.start); if (!(dur > 1)) throw new Error("That short is too short.");
  fs.mkdirSync(o.work, { recursive: true });
  const args = ["-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1", "-y"];
  const fg = []; let n = 0;
  // the picture
  let vIn = -1, aIn = -1;
  if (o.video && o.video.file) { const t = Math.max(0, o.start - (o.video.lag || 0)); args.push("-ss", String(num(t)), "-t", String(dur), "-i", o.video.file); vIn = n++; }
  // the sound: the stream mix / program recording (or the video's own sound)
  if (o.audio && o.audio.file) { const t = Math.max(0, o.start - (o.audio.lag || 0)); args.push("-ss", String(num(t)), "-t", String(dur), "-i", o.audio.file); aIn = n++; }
  else if (vIn >= 0) aIn = vIn;
  if (aIn < 0) throw new Error("No sound to make the short from.");
  let logoIn = -1; if (s.logo && fs.existsSync(s.logo)) { args.push("-i", s.logo); logoIn = n++; }

  if (vIn >= 0) {
    const vw = o.video.w || 1920, vh = o.video.h || 1080, tall = vw / vh <= 9 / 16 + 0.01;
    const mode = tall ? "fit" : s.framing === "auto" ? (o.path ? "follow" : "blur") : s.framing;
    if (mode === "fit") fg.push("[" + vIn + ":v]scale=" + W + ":" + H + ":force_original_aspect_ratio=decrease,pad=" + W + ":" + H + ":(ow-iw)/2:(oh-ih)/2:color=0x" + hex(s.background, "16181d") + ",setsar=1,fps=" + FPS + "[pic]");
    else if (mode === "follow" || mode === "center") fg.push("[" + vIn + ":v]crop=w='trunc(ih*9/16/2)*2':h=ih:x='" + (mode === "follow" ? cropX(o.path) : "(iw-ow)/2") + "':y=0,scale=" + W + ":" + H + ",setsar=1,fps=" + FPS + "[pic]");
    else fg.push("[" + vIn + ":v]split[w1][w2];[w1]scale=" + W + ":" + H + ":force_original_aspect_ratio=increase,crop=" + W + ":" + H + ",boxblur=24:2,eq=brightness=-0.1:saturation=1.1[bg];[w2]scale=" + W + ":-2[fgv];[bg][fgv]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=" + FPS + "[pic]");
  } else {
    // no camera recording: the church's colour, a moving waveform of the sound, the captions
    args.push("-f", "lavfi", "-t", String(dur), "-i", "color=c=0x" + hex(s.background, "16181d") + ":s=" + W + "x" + H + ":r=" + FPS); const bgIn = n++;
    fg.push("[" + aIn + ":a]asplit[aw][am];[aw]showwaves=s=" + W + "x420:mode=cline:rate=" + FPS + ":colors=0x" + hex(s.accent, "ffd23f") + ",format=rgba[wv];[" + bgIn + ":v][wv]overlay=0:(H-h)/2-160:shortest=1,setsar=1[pic]");
  }
  let last = "pic";
  // captions (relative to the clip)
  const rel = (o.words || []).map((w) => ({ text: w.text, start: num(w.start - o.start), end: num(w.end - o.start) })).filter((w) => w.end > 0 && w.start < dur);
  if (cap.on !== false && rel.length) {
    fs.writeFileSync(path.join(o.work, "captions.ass"), C.ass(rel, cap, W, H));
    const fdir = path.join(o.work, "fonts"); fs.mkdirSync(fdir, { recursive: true });
    if (o.fonts && fs.existsSync(o.fonts)) for (const f of fs.readdirSync(o.fonts)) if (/\.(ttf|otf)$/i.test(f)) fs.copyFileSync(path.join(o.fonts, f), path.join(fdir, f));
    fg.push("[" + last + "]ass=captions.ass:fontsdir=fonts[capd]"); last = "capd";   // (relative names: ffmpeg runs in the work folder, so no drive letters in the filter)
  }
  if (logoIn >= 0) {
    const lw = Math.round(W * Math.max(5, Math.min(40, Number(s.logoSize) || 16)) / 100), m = 48;
    const pos = { "top-left": [m, m], "top-right": ["W-w-" + m, m], "bottom-left": [m, "H-h-" + (m + 260)], "bottom-right": ["W-w-" + m, "H-h-" + (m + 260)] }[s.logoCorner] || ["W-w-" + m, m];
    fg.push("[" + logoIn + ":v]scale=" + lw + ":-1,format=rgba,colorchannelmixer=aa=" + Math.max(0.1, Math.min(1, Number(s.logoOpacity) || 0.9)) + "[lg];[" + last + "][lg]overlay=" + pos[0] + ":" + pos[1] + "[lgd]"); last = "lgd";
  }
  fg.push("[" + last + "]fade=t=in:st=0:d=0.25,fade=t=out:st=" + num(Math.max(0, dur - 0.35)) + ":d=0.35,format=yuv420p[main_v]");
  fg.push((vIn < 0 ? "[am]" : "[" + aIn + ":a]") + "aresample=48000,aformat=channel_layouts=stereo,loudnorm=I=" + (Number(s.loudness) || -14) + ":TP=-1.5:LRA=11,afade=t=in:st=0:d=0.2,afade=t=out:st=" + num(Math.max(0, dur - 0.4)) + ":d=0.4[main_a]");
  // intro / outro: a picture held for a few seconds, or a short video
  const segs = [];
  const addCard = async (file, secs, tag) => {
    if (!file || !fs.existsSync(file)) return;
    if (isImage(file)) { args.push("-loop", "1", "-t", String(secs), "-i", file); const i = n++; args.push("-f", "lavfi", "-t", String(secs), "-i", "anullsrc=r=48000:cl=stereo"); const a = n++; fg.push("[" + i + ":v]scale=" + W + ":" + H + ":force_original_aspect_ratio=decrease,pad=" + W + ":" + H + ":(ow-iw)/2:(oh-ih)/2:color=0x" + hex(s.background, "16181d") + ",setsar=1,fps=" + FPS + ",format=yuv420p[" + tag + "v];[" + a + ":a]anull[" + tag + "a]"); }
    else { const p = await require("./audio").probe(o.bin, file); args.push("-i", file); const i = n++; let aTag = i + ":a"; if (!p.audio) { args.push("-f", "lavfi", "-t", String(p.duration || 3), "-i", "anullsrc=r=48000:cl=stereo"); aTag = (n++) + ":a"; } fg.push("[" + i + ":v]scale=" + W + ":" + H + ":force_original_aspect_ratio=decrease,pad=" + W + ":" + H + ":(ow-iw)/2:(oh-ih)/2,setsar=1,fps=" + FPS + ",format=yuv420p[" + tag + "v];[" + aTag + "]aresample=48000,aformat=channel_layouts=stereo[" + tag + "a]"); }
    segs.push(tag);
  };
  await addCard(s.intro, Number(s.introSeconds) || 2.5, "in");
  segs.push("main_");
  await addCard(s.outro, Number(s.outroSeconds) || 3, "out");
  let vOut = "main_v", aOut = "main_a";
  if (segs.length > 1) { fg.push(segs.map((t) => "[" + t + "v][" + t + "a]").join("") + "concat=n=" + segs.length + ":v=1:a=1[cv][ca]"); vOut = "cv"; aOut = "ca"; }
  args.push("-filter_complex", fg.join(";"), "-map", "[" + vOut + "]", "-map", "[" + aOut + "]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-maxrate", "6M", "-bufsize", "12M", "-r", String(FPS), "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", path.resolve(o.out) + ".part.mp4");
  let lastT = 0;
  const r = await run(o.bin, args, (b) => { const m = /out_time_us=(\d+)/.exec(String(b)); if (m && o.progress) { const t = Number(m[1]) / 1e6; if (t - lastT > 1) { lastT = t; o.progress(Math.min(1, t / dur)); } } }, { cwd: o.work, low: true, signal: o.signal });
  if (r.code !== 0) throw new Error("ffmpeg couldn't make the short: " + (r.err.trim().split("\n").slice(-2).join(" ") || "exit " + r.code));
  fs.renameSync(path.resolve(o.out) + ".part.mp4", o.out);
  if (rel.length) fs.writeFileSync(o.out.replace(/\.mp4$/i, ".srt"), C.srt(rel, cap.words));
  return { file: o.out, seconds: dur + (segs.length > 1 ? (segs.includes("in") ? Number(s.introSeconds) || 2.5 : 0) + (segs.includes("out") ? Number(s.outroSeconds) || 3 : 0) : 0) };
}

async function thumb(bin, file, out, at) {
  const r = await run(bin, ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(at || 1), "-i", file, "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "4", out], null, { low: true });
  return r.code === 0 && fs.existsSync(out) ? out : null;
}

/* (10.3) a full-length video (the worship set, the sermon): the camera's picture as it is (16:9, up to 1080p) or, without
 * a camera, the waveform on the church's colour; the sound brought to -14 LUFS; a short fade in and out */
async function renderFull(o) {
  const s = Object.assign({}, DEFAULTS, o.settings || {}), dur = num(o.end - o.start); if (!(dur > 5)) throw new Error("That part of the service is too short.");
  fs.mkdirSync(o.work, { recursive: true });
  const args = ["-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1", "-y"], fg = []; let n = 0, vIn = -1, aIn = -1;
  const VH = o.height === 720 ? 720 : 1080, VW = VH === 720 ? 1280 : 1920;
  if (o.video && o.video.file) { args.push("-ss", String(num(Math.max(0, o.start - (o.video.lag || 0)))), "-t", String(dur), "-i", o.video.file); vIn = n++; }
  if (o.audio && o.audio.file) { args.push("-ss", String(num(Math.max(0, o.start - (o.audio.lag || 0)))), "-t", String(dur), "-i", o.audio.file); aIn = n++; } else aIn = vIn;
  if (aIn < 0) throw new Error("No sound to make the video from.");
  if (vIn >= 0) fg.push("[" + vIn + ":v]scale=" + VW + ":" + VH + ":force_original_aspect_ratio=decrease,pad=" + VW + ":" + VH + ":(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30[pv]");
  else { args.push("-f", "lavfi", "-t", String(dur), "-i", "color=c=0x" + hex(s.background, "16181d") + ":s=" + VW + "x" + VH + ":r=30"); const bg = n++; fg.push("[" + aIn + ":a]asplit[aw][am];[aw]showwaves=s=" + VW + "x" + Math.round(VH / 3) + ":mode=cline:rate=30:colors=0x" + hex(s.accent, "ffd23f") + ",format=rgba[wv];[" + bg + ":v][wv]overlay=0:(H-h)/2:shortest=1,setsar=1[pv]"); }
  fg.push("[pv]fade=t=in:st=0:d=1,fade=t=out:st=" + num(Math.max(0, dur - 1.5)) + ":d=1.5,format=yuv420p[v]");
  fg.push((vIn < 0 ? "[am]" : "[" + aIn + ":a]") + "aresample=48000,aformat=channel_layouts=stereo,loudnorm=I=" + (Number(s.loudness) || -14) + ":TP=-1.5:LRA=11,afade=t=in:st=0:d=1,afade=t=out:st=" + num(Math.max(0, dur - 2)) + ":d=2[a]");
  args.push("-filter_complex", fg.join(";"), "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-maxrate", "8M", "-bufsize", "16M", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", path.resolve(o.out) + ".part.mp4");
  let lastT = 0;
  const r = await run(o.bin, args, (b) => { const m = /out_time_us=(\d+)/.exec(String(b)); if (m && o.progress) { const t = Number(m[1]) / 1e6; if (t - lastT > 5) { lastT = t; o.progress(Math.min(1, t / dur)); } } }, { cwd: o.work, low: true, signal: o.signal });
  if (r.code !== 0) throw new Error("ffmpeg couldn't make the video: " + (r.err.trim().split("\n").slice(-2).join(" ") || "exit " + r.code));
  fs.renameSync(path.resolve(o.out) + ".part.mp4", o.out);
  return { file: o.out, seconds: dur };
}
/* the video's thumbnail: a frame with its title across the bottom (1280 x 720, under 2 MB for YouTube) */
async function titleThumb(bin, file, out, at, text, fontsDir, work) {
  fs.mkdirSync(work, { recursive: true });
  const fdir = path.join(work, "fonts"); fs.mkdirSync(fdir, { recursive: true });
  if (fontsDir && fs.existsSync(fontsDir)) for (const f of fs.readdirSync(fontsDir)) if (/\.(ttf|otf)$/i.test(f)) fs.copyFileSync(path.join(fontsDir, f), path.join(fdir, f));
  const ass = "[Script Info]\nScriptType: v4.00+\nPlayResX: 1280\nPlayResY: 720\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: T,Archivo SemiBold,64,&H00FFFFFF,&H00FFFFFF,&H00000000,&H90000000,-1,0,0,0,100,100,0,0,1,4,2,1,60,60,56,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:10.00,T,,0,0,0,," + String(text || "").replace(/[{}\\]/g, "").slice(0, 80) + "\n";
  fs.writeFileSync(path.join(work, "thumb.ass"), ass);
  const r = await run(bin, ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(at || 5), "-i", file, "-frames:v", "1", "-vf", "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,eq=brightness=-0.06,ass=thumb.ass:fontsdir=fonts", "-q:v", "3", path.resolve(out)], null, { cwd: work, low: true });
  return r.code === 0 && fs.existsSync(out) ? out : null;
}

module.exports = { render, renderFull, thumb, titleThumb, cropX, DEFAULTS, W, H };
