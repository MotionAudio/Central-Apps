// Automatic audio-quality grade (1-5 stars) worked out with ffprobe / ffmpeg on the uploaded mix.
// The grade sets the price (config.STAR_PRICE_CENTS). The website shows a quick estimate before upload;
// this one is final.
import { execFile } from "node:child_process";

function run(cmd, args) {
  return new Promise((resolve, reject) => execFile(cmd, args, { maxBuffer: 32 * 1024 * 1024, timeout: 10 * 60e3 }, (err, stdout, stderr) => {
    if (err && !stderr) return reject(err); resolve({ stdout: String(stdout), stderr: String(stderr), err });
  }));
}
function overall(stderr) {  // astats "Overall" block → { "Peak level dB": -0.3, ... }
  const i = stderr.lastIndexOf("Overall"); if (i < 0) return {};
  const out = {};
  stderr.slice(i).split("\n").forEach((line) => { const m = line.match(/\]\s*([A-Za-z][A-Za-z _]+?):\s*(-?[\d.]+|-?inf)/); if (m) out[m[1].trim()] = m[2] === "-inf" ? -Infinity : Number(m[2]); });
  return out;
}

export async function gradeAudio(file) {
  const probe = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
  let info; try { info = JSON.parse(probe.stdout); } catch { throw new Error("That file isn't audio we can read. Upload an MP3 or WAV."); }
  const st = (info.streams || []).find((s) => s.codec_type === "audio");
  if (!st) throw new Error("No audio found in that file.");
  const codec = st.codec_name || "", sr = Number(st.sample_rate) || 0, ch = Number(st.channels) || 0;
  const dur = Number(info.format && info.format.duration) || Number(st.duration) || 0;
  const kbps = Math.round((Number(info.format && info.format.bit_rate) || Number(st.bit_rate) || 0) / 1000);
  const lossless = /^(pcm_|flac|alac|wavpack)/.test(codec);
  const bits = Number(st.bits_per_raw_sample) || Number(st.bits_per_sample) || 0;
  if (dur < 1) throw new Error("That file is too short to grade.");

  const full = overall((await run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-map", "0:a:0", "-af", "aformat=sample_fmts=s16,astats=metadata=0", "-f", "null", "-"])).stderr);
  const checks = []; let score = 5;
  const add = (ok, text, penalty) => { checks.push({ ok, text }); if (!ok) score -= penalty; };
  const m = Math.floor(dur / 60), s = String(Math.round(dur % 60)).padStart(2, "0");
  checks.push({ ok: true, text: m + ":" + s + " · " + (ch === 1 ? "mono" : ch === 2 ? "stereo" : ch + " channels") });

  if (lossless) add(!bits || bits >= 16, (codec.startsWith("pcm_") ? "WAV" : codec.toUpperCase()) + " · " + (bits || "?") + "-bit · lossless", 1);
  else add(kbps >= 192, codec.toUpperCase() + " · " + kbps + " kbps" + (kbps < 192 ? " (192+ recommended)" : ""), kbps < 128 ? 2 : 1);
  add(sr >= 44100, (sr / 1000).toFixed(1) + " kHz sample rate", 1);

  const peak = full["Peak level dB"], samples = full["Number of samples"] || 1, peakCount = full["Peak count"] || 0;
  const clipPct = peak >= -0.1 ? (peakCount / samples) * 100 : 0;
  add(clipPct < 0.1, "Clipping " + (clipPct < 0.01 ? "none" : clipPct.toFixed(2) + "% of samples"), clipPct > 1 ? 2 : 1);
  const loud = full["RMS peak dB"], quiet = full["RMS trough dB"];
  add(loud > -30, "Level " + Math.round(loud) + " dBFS (loud parts)" + (loud <= -30 ? " · too quiet" : ""), 1);
  if (!(loud - quiet >= 20)) checks.push({ ok: true, text: "Sustained throughout · no quiet gaps to check for noise" });
  else add(quiet < -50, "Noise in quiet parts " + Math.round(quiet) + " dBFS" + (quiet >= -50 ? " · hiss or hum" : ""), 1);

  if (!lossless) {  // low-bitrate files lose everything above ~16 kHz
    const hf = overall((await run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-map", "0:a:0", "-af", "highpass=f=16000,highpass=f=16000,astats=metadata=0", "-f", "null", "-"])).stderr);
    const rel = (hf["RMS level dB"] ?? -Infinity) - (full["RMS level dB"] ?? 0);
    add(rel > -60, "High-frequency detail " + (rel > -60 ? "present" : "cut off · sounds dull"), 1);
  }
  const stars = Math.max(1, Math.min(5, score));
  return { stars, checks, info: { codec, sampleRate: sr, channels: ch, kbps, bits, duration: dur } };
}
