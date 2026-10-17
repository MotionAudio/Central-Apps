/* Lyrics from a vocal track, heard on this computer (Central Control and Central Pedal on a PC - never the Pi).
 * An offline speech model (OpenAI Whisper, ONNX build, via transformers.js) runs in the app's main process;
 * the page sends 16 kHz mono audio of the parts where someone sings and gets the words with their times.
 * The model is downloaded once (Settings) into the app's folder; nothing is sent anywhere.
 * The same file is used by both apps (central-usage/asr.js, central-control-desktop/asr.js). */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const MODELS = {
  accurate: { id: "onnx-community/whisper-small_timestamped", label: "Accurate (about 500 MB)" },
  fast: { id: "onnx-community/whisper-base_timestamped", label: "Fast (about 140 MB)" }
};

function setupAsr({ ipcMain, app, getWin }) {
  const dir = path.join(app.getPath("userData"), "speech-models");
  const cfgFile = path.join(app.getPath("userData"), "asr.json");
  let cfg = { model: "accurate", language: "" };
  try { cfg = Object.assign(cfg, JSON.parse(fs.readFileSync(cfgFile, "utf8"))); } catch (_) { }
  let pipe = null, pipeModel = null, loading = null, busy = false, download = null, error = null;
  const send = (m) => { const w = getWin && getWin(); if (w && !w.isDestroyed()) w.webContents.send("asr-event", m); };
  function modelDir(key) { return path.join(dir, ...MODELS[key].id.split("/")); }
  function downloaded(key) { try { return fs.readdirSync(path.join(modelDir(key), "onnx")).some((f) => /decoder_model_merged/.test(f)); } catch (_) { return false; } }
  function status() { return { model: cfg.model, language: cfg.language, models: Object.keys(MODELS).map((k) => ({ key: k, label: MODELS[k].label, downloaded: downloaded(k) })), ready: downloaded(cfg.model), busy, download, error }; }
  async function load() {
    const key = MODELS[cfg.model] ? cfg.model : "accurate";
    if (pipe && pipeModel === key) return pipe;
    if (loading) return loading;
    loading = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.cacheDir = dir; env.allowRemoteModels = true; env.allowLocalModels = true;
      const files = {};
      download = { model: key, got: 0, total: 0 };
      const p = await pipeline("automatic-speech-recognition", MODELS[key].id, {
        dtype: { encoder_model: "fp32", decoder_model_merged: "q8" },
        progress_callback: (e) => {
          if (e.status === "progress" && e.file) { files[e.file] = { got: e.loaded || 0, total: e.total || 0 }; let got = 0, total = 0; Object.values(files).forEach((f) => { got += f.got; total += f.total; }); download = { model: key, got, total }; send({ type: "download", got, total }); }
        }
      });
      download = null; pipe = p; pipeModel = key; error = null; send({ type: "ready" });
      return p;
    })().catch((e) => { download = null; error = String(e && e.message || e); send({ type: "error", error }); throw e; }).finally(() => { loading = null; });
    return loading;
  }
  ipcMain.handle("asr-status", () => status());
  ipcMain.handle("asr-config", (_e, patch) => {
    patch = patch || {};
    if (patch.model && MODELS[patch.model]) cfg.model = patch.model;
    if (typeof patch.language === "string") cfg.language = patch.language.slice(0, 20);
    try { fs.mkdirSync(path.dirname(cfgFile), { recursive: true }); fs.writeFileSync(cfgFile, JSON.stringify(cfg)); } catch (_) { }
    return status();
  });
  ipcMain.handle("asr-download", async () => { try { await load(); } catch (_) { } return status(); });
  ipcMain.handle("asr-remove", () => { try { fs.rmSync(modelDir(cfg.model), { recursive: true, force: true }); } catch (_) { } if (pipeModel === cfg.model) { pipe = null; pipeModel = null; } return status(); });
  // one stretch of singing: { pcm: Float32Array at 16 kHz, offset: seconds } -> [{ text, start, end }]
  ipcMain.handle("asr-run", async (_e, job) => {
    busy = true;
    try {
      const p = await load();
      const pcm = job.pcm instanceof Float32Array ? job.pcm : new Float32Array(job.pcm);
      const opts = { return_timestamps: "word", chunk_length_s: 30, stride_length_s: 5, task: "transcribe" };
      if (cfg.language) opts.language = cfg.language;
      const r = await p(pcm, opts);
      const off = Number(job.offset) || 0;
      return { ok: true, text: r.text || "", words: (r.chunks || []).map((c) => ({ text: String(c.text || "").trim(), start: Math.round(((c.timestamp && c.timestamp[0]) || 0) * 1000 + off * 1000) / 1000, end: Math.round(((c.timestamp && c.timestamp[1]) || (c.timestamp && c.timestamp[0]) || 0) * 1000 + off * 1000) / 1000 })).filter((w) => w.text) };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    finally { busy = false; }
  });
  return { status };
}
module.exports = { setupAsr, MODELS };
