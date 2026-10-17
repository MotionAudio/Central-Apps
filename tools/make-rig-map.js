#!/usr/bin/env node
// Builds central-usage/native/rig-map.json for the built-in instrument rig (cu-rig): for every pedal of the
// catalogue (js/pedals.js) its kind (category), plugin URI, knob labels and the plugin's control ranges
// (instrument-plugins.json), plus the control list the Instrument page needs ("app").
//   node tools/make-rig-map.js [out.json]
"use strict";
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "..");
const P = require(path.join(root, "js", "pedals.js"));
const plugins = JSON.parse(fs.readFileSync(path.join(root, "instrument-plugins.json"), "utf8"));
const out = {};
for (const p of P.pedals) {
  const info = plugins[p.uri] || (p.uri === "builtin:convolver" ? { controls: [], ain: 1, aout: 1 } : null);
  const knobs = {}; Object.keys(p.knobs || {}).forEach((label) => { knobs[p.knobs[label]] = label; });
  const controls = {};
  ((info && info.controls) || []).filter((c) => c.dir !== "out" && !c.output).forEach((c) => { controls[c.sym] = [Number(c.min) || 0, Number(c.max) || 1, c.def == null ? Number(c.min) || 0 : Number(c.def), c.log ? 1 : 0, c.unit || "", c.name || c.sym]; });
  out[p.id] = { cat: p.category, uri: p.uri, knobs, controls, app: info ? { controls: info.controls || [], ain: info.ain, aout: info.aout } : { controls: [], ain: 1, aout: 1 } };
}
const file = process.argv[2] || path.join(root, "central-usage", "native", "rig-map.json");
fs.writeFileSync(file, JSON.stringify(out));
console.log("rig map: " + Object.keys(out).length + " pedals -> " + path.relative(process.cwd(), file) + " (" + Math.round(fs.statSync(file).size / 1024) + " KB)");
