#!/usr/bin/env node
// Before packing an app: keep only this system's onnxruntime-node binary (bin/napi-v3/<os>/<arch>) and drop the
// CUDA / TensorRT providers, so each installer carries one copy (the others are 30-370 MB each).
//   node tools/prune-onnx.js <app folder> [platform] [arch]      (default: this computer's)
"use strict";
const fs = require("node:fs"), path = require("node:path");
const dir = process.argv[2], plat = process.argv[3] || process.platform, arch = process.argv[4] || process.arch;
const base = path.join(dir, "node_modules", "onnxruntime-node", "bin", "napi-v3");
if (!fs.existsSync(base)) { console.log("no onnxruntime-node in " + dir); process.exit(0); }
let freed = 0;
const size = (p) => { const st = fs.statSync(p); return st.isDirectory() ? fs.readdirSync(p).reduce((n, f) => n + size(path.join(p, f)), 0) : st.size; };
for (const os of fs.readdirSync(base)) for (const a of fs.readdirSync(path.join(base, os))) {
  const d = path.join(base, os, a);
  if (os !== plat || a !== arch) { freed += size(d); fs.rmSync(d, { recursive: true, force: true }); continue; }
  for (const f of fs.readdirSync(d)) if (/providers_(cuda|tensorrt)/.test(f)) { freed += size(path.join(d, f)); fs.rmSync(path.join(d, f)); }
}
for (const os of fs.readdirSync(base)) if (!fs.readdirSync(path.join(base, os)).length) fs.rmdirSync(path.join(base, os));
console.log("onnxruntime-node: kept " + plat + "/" + arch + ", removed " + Math.round(freed / 1048576) + " MB");
