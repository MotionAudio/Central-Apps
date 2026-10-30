// The lights' AI helper as it comes in the installer (10.0): starts its llama-server with its model, asks it what
// the Lighting tab's "Tell it the show" asks (the same system prompt), and checks the answer is the steps the
// lighting engine takes (JSON it can read, with a section and something to light). About a minute on a CI runner.
//   node tools/smoke-lights-ai.mjs <folder with llama-server[.exe] and the .gguf model>
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
const require = createRequire(import.meta.url), here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const dir = process.argv[2]; if (!dir) { console.error("usage: node tools/smoke-lights-ai.mjs <ai folder>"); process.exit(2); }
const exe = path.join(dir, process.platform === "win32" ? "llama-server.exe" : "llama-server"), model = path.join(dir, "qwen2.5-0.5b-instruct-q4_k_m.gguf");
for (const f of [exe, model]) if (!fs.existsSync(f)) { console.error("missing: " + f); process.exit(1); }
const A = require(path.join(here, "..", "central-usage", "app", "lights-ai.js")).CULightsAI;   // (it sets itself on "this": module.exports here)
const port = 18000 + Math.floor(Math.random() * 1000);
const proc = spawn(exe, ["-m", model, "--port", String(port), "--host", "127.0.0.1", "-c", "4096"], { stdio: ["ignore", "ignore", "pipe"] });
let err = ""; proc.stderr.on("data", (c) => { err = (err + c).slice(-4000); });
const get = (p) => new Promise((r) => http.get({ host: "127.0.0.1", port, path: p }, (res) => { res.resume(); r(res.statusCode); }).on("error", () => r(0)));
const post = (p, body) => new Promise((r, j) => { const b = JSON.stringify(body); const q = http.request({ host: "127.0.0.1", port, path: p, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(b) } }, (res) => { let s = ""; res.on("data", (c) => { s += c; }); res.on("end", () => r(s)); }); q.on("error", j); q.setTimeout(180000, () => q.destroy(new Error("timeout"))); q.end(b); });
let fail = "";
try {
  let up = 0; for (let i = 0; i < 240 && up !== 200; i++) { await new Promise((r) => setTimeout(r, 500)); up = await get("/health"); }
  if (up !== 200) throw new Error("llama-server did not start\n" + err);
  const ctx = { fixtures: [{ id: "f1", name: "Front L", group: "front" }, { id: "f2", name: "Back 1", group: "back" }, { id: "f3", name: "Mover L", group: "beam" }], groups: [["front", "Front / faces"], ["back", "Back / wash"], ["beam", "Movers"], ["fx", "Strobes"]], sections: [{ name: "Verse 1" }, { name: "Chorus" }, { name: "Bridge" }] };
  const t0 = Date.now();
  const raw = await post("/v1/chat/completions", { messages: [{ role: "system", content: A.systemPrompt(ctx) }, { role: "user", content: "verse soft blue washes, chorus full white with movers sweeping, bridge warm amber" }], temperature: 0.2, max_tokens: 800 });
  const text = JSON.parse(raw).choices[0].message.content, json = JSON.parse((text.match(/\{[\s\S]*\}/) || ["null"])[0]);
  const steps = A.fromModel(json, ctx) || [];
  console.log("answered in " + ((Date.now() - t0) / 1000).toFixed(1) + " s; " + steps.length + " steps: " + JSON.stringify(steps).slice(0, 300));
  if (!steps.length || !steps.some((s) => s.targets && s.targets.length)) fail = "the model's answer gave no usable steps: " + text.slice(0, 400);
} catch (e) { fail = String(e && e.message || e); }
proc.kill();
if (fail) { console.error("::error title=lights AI helper::" + fail.replace(/\n/g, "%0A")); process.exit(1); }
console.log("the lights' AI helper answers from the installer");
