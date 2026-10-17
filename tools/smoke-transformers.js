#!/usr/bin/env node
// Smoke test of the offline speech model's runtime inside a packed app (Central Control / Central Pedal):
//  1. the app carries only its own onnxruntime-node binary (no other OS / CPU, no CUDA / TensorRT)
//  2. @huggingface/transformers loads in the app's own Electron, as its main process does (asr.js's import(),
//     and require), which also loads onnxruntime-node's native binding and sharp
//   node tools/smoke-transformers.js <app executable> <resources folder>
"use strict";
const fs = require("node:fs"), path = require("node:path"), { spawnSync } = require("node:child_process");
const exe = path.resolve(process.argv[2] || ""), res = path.resolve(process.argv[3] || "");
const fail = (m) => { console.log("::error title=transformers smoke test::" + m); process.exit(1); };
const base = path.join(res, "app.asar.unpacked", "node_modules", "onnxruntime-node", "bin", "napi-v3");
if (!fs.existsSync(base)) fail("no unpacked onnxruntime-node in " + res);
const kept = []; for (const os of fs.readdirSync(base)) for (const a of fs.readdirSync(path.join(base, os))) kept.push(os + "/" + a + ": " + fs.readdirSync(path.join(base, os, a)).join(", "));
console.log("onnxruntime-node binaries:\n  " + kept.join("\n  "));
const want = process.platform + "/" + process.arch;
if (kept.length !== 1 || !kept[0].startsWith(want + ":")) fail("expected only " + want + ", found: " + kept.join(" | "));
if (/providers_(cuda|tensorrt)/.test(kept[0])) fail("CUDA / TensorRT providers are packed: " + kept[0]);
const code = [
  "const path = require('path'), { pathToFileURL } = require('url');",
  "const pkg = path.join(process.argv[1], 'app.asar', 'node_modules', '@huggingface', 'transformers');",
  "const meta = require(path.join(pkg, 'package.json'));",
  "const ex = (meta.exports['.'] || meta.exports).node;",
  "const cjs = require(path.join(pkg, ex.require.default || ex.require));",
  "import(pathToFileURL(path.join(pkg, ex.import.default || ex.import)).href)",
  "  .then((m) => { console.log('TRANSFORMERS OK ' + meta.version + ' pipeline:' + typeof m.pipeline + ' require:' + typeof cjs.pipeline + ' onnx backend:' + typeof (m.env && m.env.backends && m.env.backends.onnx)); process.exit(typeof m.pipeline === 'function' ? 0 : 1); })",
  "  .catch((e) => { console.error('IMPORT FAILED ' + (e && e.stack || e)); process.exit(1); });"
].join("\n");
const r = spawnSync(exe, ["-e", code, res], { env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: "1" }), encoding: "utf8", timeout: 120000 });
process.stdout.write(r.stdout || ""); process.stderr.write(r.stderr || "");
if (r.status !== 0) fail("transformers did not load in the packed app (exit " + r.status + "): " + String(r.stderr || r.error || "").slice(-1500).replace(/\n/g, "%0A"));
console.log("TRANSFORMERS SMOKE TEST PASSED");
