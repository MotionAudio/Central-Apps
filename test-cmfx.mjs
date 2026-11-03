// Central FX (10.2): the plugin core's checks.  node test-cmfx.mjs
//   1. the committed browser runtime (production/cmfx/cmfx.js) was built from today's C (tools/build-cmfx.sh)
//      and its copies in the apps are the same file;
//   2. the C core (native, cmfx-cli) and the WebAssembly build sound the same - for every block type (and their modes,
//      with knobs and modulation), the code language and every preset;
//   3. the code language: errors with the right line, the read-only names, and hostile scripts that can't hang,
//      crash or blow up (instruction caps, bounded loops, invalid numbers);
//   4. every preset loads and makes sound.
// Needs a C compiler (CC, default cc); with clang + wasm-ld it also checks a fresh WebAssembly build.
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)), src = path.join(root, "central-usage", "native", "cmfx");
const require = createRequire(import.meta.url);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cmfx-"));
let failures = 0;
const ok = (m) => console.log("  ✓ " + m), bad = (m) => { failures++; console.error("  ✗ " + m); };
const check = (c, m) => (c ? ok(m) : bad(m));

console.log("Central FX core:");
// ---- 1. the runtime is current, and the same everywhere
const h = crypto.createHash("sha256");
for (const f of ["cmfx.h", "cmfx_int.h", "cmfx.c", "cmfx_code.c", "cmfx_util.c", "cmfx_wasm.c"]) h.update(fs.readFileSync(path.join(src, f)));
const rt = fs.readFileSync(path.join(root, "production/cmfx/cmfx.js"));
check(rt.includes('source: "' + h.digest("hex") + '"'), "production/cmfx/cmfx.js was built from the current C (else run tools/build-cmfx.sh)");
check(fs.readFileSync(path.join(root, "js/cmfx-presets.js")).equals(fs.readFileSync(path.join(root, "production/plugin-builder/presets.js"))), "js/cmfx-presets.js is the same file");
for (const c of ["production/plugin-builder/plugin-builder.js", "production/plugin-builder/plugin-builder.css", "production/plugin-builder/presets.js"]) { const w = c.replace("production/", "server/public/production/"); check(fs.existsSync(path.join(root, w)) && fs.readFileSync(path.join(root, w)).equals(fs.readFileSync(path.join(root, c))), w + " is the same file (tools/build-cmfx.sh copies it)"); }
for (const c of ["central-usage/app/cmfx.js", "js/cmfx.js", "server/public/production/cmfx/cmfx.js"]) check(fs.existsSync(path.join(root, c)) && fs.readFileSync(path.join(root, c)).equals(rt), c + " is the same file");
const CMFx = require(path.join(root, "production/cmfx/cmfx.js"));

// ---- the native build
const cli = path.join(tmp, "cmfx-cli" + (process.platform === "win32" ? ".exe" : ""));
const cc = process.env.CC || "cc";
const b = spawnSync(cc, ["-O2", "-ffp-contract=off", "-o", cli, ...["cmfx-cli.c", "cmfx.c", "cmfx_code.c", "cmfx_util.c"].map((f) => path.join(src, f)), "-lm"], { encoding: "utf8" });
if (b.status !== 0) { bad("the C core builds: " + (b.stderr || b.error)); process.exit(1); }
ok("the C core builds (" + cc + ", no warnings that stop it)");
let fresh = null;
const w = spawnSync("bash", [path.join(root, "tools/build-cmfx.sh"), "--wasm", path.join(tmp, "fresh.wasm")], { encoding: "utf8" });
if (w.status === 0) { fresh = new WebAssembly.Module(fs.readFileSync(path.join(tmp, "fresh.wasm"))); ok("a fresh WebAssembly build of the same C builds too"); }
else console.log("  (no clang with WebAssembly here: only the committed build is compared)");

// ---- the test signal: a sweep, noise bursts, clicks, a chord and silence (the tails)
const SR = 48000, N = SR * 2;
function signal() {
  const L = new Float32Array(N), R = new Float32Array(N); let s = 1;
  const rnd = () => { s = (s * 1103515245 + 12345) >>> 0; return (s / 4294967296) * 2 - 1; };
  for (let i = 0; i < N; i++) {
    const t = i / SR, f = 60 * Math.pow(200, Math.min(1, t / 1.2));
    let x = t < 1.2 ? 0.5 * Math.sin(2 * Math.PI * 60 * (Math.pow(200, t / 1.2) - 1) / Math.log(200) * 1.2) : 0;
    if (t >= 1.2 && t < 1.5) x = 0.3 * (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277 * t) + Math.sin(2 * Math.PI * 330 * t));
    if ((i % 9600) < 240) x += 0.4 * rnd();
    if (i % 12000 === 0) x += 0.9;
    void f; L[i] = x; R[i] = t < 1.2 ? x * 0.7 + 0.1 * rnd() : x;
  }
  for (let i = Math.floor(SR * 1.5); i < N; i++) { L[i] = 0; R[i] = 0; }
  return { L, R };
}
const SIG = signal();
const inter = new Float32Array(N * 2); for (let i = 0; i < N; i++) { inter[2 * i] = SIG.L[i]; inter[2 * i + 1] = SIG.R[i]; }
fs.writeFileSync(path.join(tmp, "in.f32"), Buffer.from(inter.buffer));

function nativeRender(plugin, values) {
  const pf = path.join(tmp, "p.cmfx.json"), out = path.join(tmp, "out.f32"); fs.writeFileSync(pf, JSON.stringify(plugin));
  const args = ["render", pf, String(SR), path.join(tmp, "in.f32"), out, "128", ...Object.entries(values || {}).map(([k, v]) => k + "=" + v)];
  const r = spawnSync(cli, args, { encoding: "utf8", timeout: 120000 });
  if (r.status !== 0) return { error: (r.stdout || "") + (r.stderr || "") || "status " + r.status };
  const f = new Float32Array(new Uint8Array(fs.readFileSync(out)).buffer); const L = new Float32Array(N), R = new Float32Array(N);
  for (let i = 0; i < N; i++) { L[i] = f[2 * i]; R[i] = f[2 * i + 1]; }
  return { L, R, status: (r.stderr || "").replace(/^status: /, "").trim() };
}
function wasmRender(plugin, values, module) {
  if (module) {   // a fresh build: the same calls, by hand
    const ex = new WebAssembly.Instance(module, {}).exports, t = new TextEncoder().encode(JSON.stringify(plugin)), p = ex.cmw_alloc(t.length + 1);
    new Uint8Array(ex.memory.buffer).set(t, p); const fx = ex.cmw_new(p, t.length, SR); if (!fx) return { error: "no" };
    const ids = (plugin.params || []).map((q) => q.id); for (const [k, v] of Object.entries(values || {})) ex.cmw_set_param(fx, ids.indexOf(k), v); ex.cmw_reset(fx);
    const b0 = ex.cmw_alloc(2048), L = new Float32Array(N), R = new Float32Array(N);
    for (let off = 0; off < N; off += 128) {
      let F = new Float32Array(ex.memory.buffer); F.set(SIG.L.subarray(off, off + 128), b0 >> 2); F.set(SIG.R.subarray(off, off + 128), (b0 >> 2) + 128);
      ex.cmw_process(fx, b0, b0 + 512, b0 + 1024, b0 + 1536, 128); F = new Float32Array(ex.memory.buffer);
      L.set(F.subarray((b0 >> 2) + 256, (b0 >> 2) + 384), off); R.set(F.subarray((b0 >> 2) + 384, (b0 >> 2) + 512), off);
    }
    return { L, R };
  }
  const r = CMFx.render(plugin, SR, SIG.L, SIG.R, values); return r.error ? { error: r.error } : { L: r.left, R: r.right, status: r.status };
}
const stats = (a) => { let pk = 0, e = 0, fin = true; for (const x of a) { if (!Number.isFinite(x)) fin = false; pk = Math.max(pk, Math.abs(x)); e += x * x; } return { pk, rms: Math.sqrt(e / a.length), fin }; };
function maxDiff(a, b) { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; }
const P = (name, blocks, wires, params, code) => ({ format: "central-fx", version: 1, name, params: params || [], graph: { blocks, wires }, code });
const chain = (type, props, extra) => P(type, [{ id: "in", type: "input" }, { id: "fx", type, props }, ...(extra || []).map((e) => e.block), { id: "out", type: "output" }],
  [{ from: "in.out", to: "fx.in" }, { from: "fx.out", to: "out.in" }, ...(extra || []).flatMap((e) => e.wires)]);
const lfoInto = (port, from, to, rate) => ({ block: { id: "lfo", type: "lfo", props: { rate: rate || 3, from, to, stereo: 90 } }, wires: [{ from: "lfo.out", to: "fx." + port }] });

// ---- 2. every block type, native and WebAssembly
const CASES = [
  ["gain", chain("gain", { gain: -6 })], ["gain moved by an LFO", chain("gain", {}, [lfoInto("gain", -20, 0)])],
  ...["lowpass", "highpass", "bandpass", "notch", "peak", "lowshelf", "highshelf", "allpass"].map((m) => ["filter " + m, chain("filter", { mode: m, freq: 900, q: 2, gain: 6 })]),
  ["filter 24 dB", chain("filter", { mode: "lowpass", freq: 600, slope: 24 })], ["filter swept by an LFO", chain("filter", { mode: "lowpass", q: 4 }, [lfoInto("freq", 200, 4000, 2)])],
  ["eq band", chain("eq", { freq: 2500, gain: -8, q: 1.5 })],
  ["delay", chain("delay", { time: 120, feedback: 0.5, mix: 0.5 })], ["delay ping-pong", chain("delay", { time: 90, feedback: 0.6, mix: 0.5, mode: "pingpong", maxTime: 500 })],
  ["delay with a moving time", chain("delay", { feedback: 0.3, mix: 0.6 }, [lfoInto("time", 20, 60, 0.7)])],
  ["reverb", chain("reverb", { size: 0.8, mix: 0.5, predelay: 30 })],
  ["chorus", chain("chorus", { depth: 0.7, mix: 0.5 })], ["flanger", chain("chorus", { mode: "flanger", feedback: 0.6, mix: 0.5 })],
  ["phaser", chain("phaser", { stages: 6, feedback: 0.5 })],
  ...["soft", "hard", "tube", "fuzz", "fold"].map((m) => ["drive " + m, chain("drive", { mode: m, drive: 18 })]),
  ["bitcrush", chain("bitcrush", { bits: 6, rate: 8000 })],
  ["compressor", chain("compressor", { threshold: -30, ratio: 8, attack: 2 })],
  ["compressor with a key", P("key", [{ id: "in", type: "input" }, { id: "hp", type: "filter", props: { mode: "highpass", freq: 4000 } }, { id: "fx", type: "compressor", props: { threshold: -40, ratio: 10 } }, { id: "out", type: "output" }],
    [{ from: "in.out", to: "hp.in" }, { from: "hp.out", to: "fx.key" }, { from: "in.out", to: "fx.in" }, { from: "fx.out", to: "out.in" }])],
  ["limiter", chain("limiter", { ceiling: -12 })], ["gate", chain("gate", { threshold: -20, range: -60 })],
  ...["sine", "triangle", "saw", "ramp", "square"].map((s) => ["tremolo " + s, chain("tremolo", { shape: s, depth: 0.9, rate: 6 })]), ["auto-pan", chain("tremolo", { mode: "autopan", depth: 1 })],
  ["pitch up an octave", chain("pitch", { semitones: 12 })], ["pitch down a fifth", chain("pitch", { semitones: -7, fine: 10, window: 80 })],
  ...["sine", "triangle", "saw", "square", "random"].map((s) => ["lfo " + s + " into gain", chain("gain", {}, [{ block: { id: "lfo", type: "lfo", props: { shape: s, rate: 5, from: -24, to: 0 } }, wires: [{ from: "lfo.out", to: "fx.gain" }] }])]),
  ["envelope into a filter", chain("filter", { mode: "bandpass", q: 3 }, [{ block: { id: "env", type: "envelope", props: { from: 300, to: 3000, sensitivity: 6 } }, wires: [{ from: "in.out", to: "env.in" }, { from: "env.out", to: "fx.freq" }] }])],
  ...["add", "subtract", "multiply", "divide", "min", "max", "abs", "negate", "clamp", "map", "db2gain", "gain2db", "sin", "tanh", "value", "smooth"].map((op) => ["math " + op,
    P("m", [{ id: "in", type: "input" }, { id: "fx", type: "math", props: { op, b: 0.5, lo: -0.3, hi: 0.3, inLo: -1, inHi: 1, outLo: 0, outHi: 0.5 } }, { id: "out", type: "output" }], [{ from: "in.out", to: "fx.a" }, { from: "fx.out", to: "out.in" }])]),
  ["mix (equal power)", P("x", [{ id: "in", type: "input" }, { id: "rv", type: "reverb", props: { mix: 1 } }, { id: "fx", type: "mix", props: { mix: 0.4, law: "equal" } }, { id: "out", type: "output" }],
    [{ from: "in.out", to: "rv.in" }, { from: "in.out", to: "fx.dry" }, { from: "rv.out", to: "fx.wet" }, { from: "fx.out", to: "out.in" }])],
  ["stereo width + pan", chain("stereo", { width: 1.8, pan: -0.4 })], ["stereo mono", chain("stereo", { mode: "mono" })],
  ["a knob block and a bound knob", P("k", [{ id: "in", type: "input" }, { id: "k", type: "param", props: { param: "g" } }, { id: "fx", type: "gain", props: {} }, { id: "f", type: "filter", props: { freq: { param: "c" } } }, { id: "out", type: "output" }],
    [{ from: "in.out", to: "fx.in" }, { from: "k.out", to: "fx.gain" }, { from: "fx.out", to: "f.in" }, { from: "f.out", to: "out.in" }], [{ id: "g", min: -24, max: 6, default: -3 }, { id: "c", min: 100, max: 8000, default: 2000, curve: "log" }]), { g: -9, c: 700 }],
  ["two wires into one input (summed)", P("s", [{ id: "in", type: "input" }, { id: "a", type: "delay", props: { time: 50, mix: 1 } }, { id: "out", type: "output" }],
    [{ from: "in.out", to: "out.in" }, { from: "in.out", to: "a.in" }, { from: "a.out", to: "out.in" }])],
  ["a code block in the graph", P("c", [{ id: "in", type: "input" }, { id: "lfo", type: "lfo", props: { rate: 2 } }, { id: "fx", type: "code", props: { code: "outL = inL * c1\noutR = inR * (1 - c1)" } }, { id: "out", type: "output" }],
    [{ from: "in.out", to: "fx.in" }, { from: "lfo.out", to: "fx.c1" }, { from: "fx.out", to: "out.in" }])],
  ["a code-only plugin with arrays, delays, loops and @init/@block", P("code", [], [], [{ id: "amt", min: 0, max: 1, default: 0.5 }],
    "@init\narray hist[64]\ndelay d[300]\nk = 0.25\n@block\nn = blocksize\n@sample\ni = (i + 1) % 64\nhist[i] = inL\nacc = 0\nloop (8) { acc += hist[i - j]; j = (j + 1) % 8 }\nd.write(acc * k)\nouty = d.read(37.5)\nif (outy > 0.8) outy = 0.8 else if (outy < -0.8) { outy = -0.8 }\noutL = mix(inL, outy, amt)\noutR = inR * (rand() * 0 + 1) + noise() * 0\nz = sin(inL) + cos(inL) + tan(0.1) + tanh(inL) + exp(-1) + log(2) + log10(10) + log2(8) + sqrt(4) + abs(-1) + floor(1.5) + ceil(1.5) + round(1.5) + sign(-2) + atan(1) + atan2(1, 1) + pow(2, 3) + min(1, 2) + max(1, 2) + clamp(5, 0, 1) + fmod(7, 3) + db2gain(-6) + gain2db(0.5) + len(hist)\n"), { amt: 0.8 }],
];
let worst = 0, worstName = "";
for (const [name, plugin, values] of CASES) {
  const n = nativeRender(plugin, values), wv = wasmRender(plugin, values);
  if (n.error || wv.error) { bad(name + ": " + (n.error || wv.error)); continue; }
  const d = Math.max(maxDiff(n.L, wv.L), maxDiff(n.R, wv.R)), s = stats(n.L), s2 = stats(n.R);
  if (d > worst) { worst = d; worstName = name; }
  const changed = maxDiff(n.L, SIG.L) > 1e-3 || maxDiff(n.R, SIG.R) > 1e-3;
  if (d > 1e-4 || !s.fin || !s2.fin || s.pk > 16 || (!changed && !/stereo mono|math value/.test(name))) bad(name + ": native vs WebAssembly differ by " + d.toExponential(2) + ", peak " + s.pk.toFixed(3) + (changed ? "" : ", and it did nothing"));
  if (fresh) { const f = wasmRender(plugin, values, fresh); const d2 = f.error ? 1 : Math.max(maxDiff(n.L, f.L), maxDiff(n.R, f.R)); if (d2 > 1e-4) bad(name + ": the fresh WebAssembly build differs by " + d2); }
}
check(failures === 0, CASES.length + " block cases sound the same native and in WebAssembly (largest difference " + worst.toExponential(2) + ", " + worstName + ")");

// ---- the blocks really do their jobs (a few measured)
{
  const lp = nativeRender(chain("filter", { mode: "lowpass", freq: 200 })), hp = nativeRender(chain("filter", { mode: "highpass", freq: 5000 }));
  const hiPart = (x) => { let e = 0; for (let i = 1; i < SR; i++) e += (x[i] - x[i - 1]) ** 2; return e; };
  check(hiPart(lp.L) < hiPart(SIG.L) * 0.2 && hiPart(hp.L) > 0, "a lowpass takes the highs away, a highpass keeps them");
  const dl = nativeRender(chain("delay", { time: 100, feedback: 0, mix: 1 })); let at = -1;
  for (let i = 0; i < N; i++) if (Math.abs(dl.L[i]) > 0.5) { at = i; break; }
  check(Math.abs(at - 4800) <= 2, "a 100 ms delay repeats the first click 4800 samples later (at " + at + ")");
  const lim = nativeRender(chain("limiter", { ceiling: -6 })); check(stats(lim.L).pk <= 0.5013, "the limiter keeps everything under its ceiling (" + stats(lim.L).pk.toFixed(4) + ")");
  const rv = nativeRender(chain("reverb", { size: 0.9, mix: 1 })); check(stats(rv.L.subarray(Math.floor(SR * 1.6))).rms > 1e-4, "the reverb rings on after the sound stops");
}

// ---- 3. the code language
const codeErr = (codeText) => JSON.parse(execFileSync(cli, ["code", (fs.writeFileSync(path.join(tmp, "c.txt"), codeText), path.join(tmp, "c.txt"))], { encoding: "utf8" }));
const ERRS = [
  ["outL = sinn(inL)", 1, /function 'sinn'/], ["x = 1\n\ny = (2 +\n 3\n", 0, /\)/], ["inL = 3", 1, /read-only/], ["while (1) { }", 1, /use loop/],
  ["a = 1\nb = 2 +* 3", 2, /didn't expect|\*/], ["array b[0]", 1, /1 to 65536/], ["array b[100000000]", 1, /1 to 65536/], ["delay d[99999]", 1, /1 to 10000/],
  ["@foo\nx = 1", 1, /isn't a section/], ["x = 1 }", 1, /'}'/], ["if x > 1 { }", 1, /condition/], ["outL = pow(1)", 1, /takes 2/], ["3 = x", 1, /only a variable/],
  ["/* never closed", 1, /comment/], ["x = $", 1, /character/], ["@init\nx=1\n@init\n", 3, /twice/], ["array a[4]\narray a[4]", 2, /already used/],
  ["outL = " + "(".repeat(60) + "1" + ")".repeat(60), 1, /nested too deep/], ["x = d.read(1)", 1, /d/], ["delay d[10]\nx = d[3]", 2, /delay line/],
];
let codeOk = 0;
for (const [txt, line, re] of ERRS) {
  const r = codeErr(txt), wv = CMFx.checkCode(txt);
  if (r.ok || !re.test(r.error) || (line && !r.error.startsWith("line " + line + ":")) || wv.ok || wv.error !== r.error) bad("code error for " + JSON.stringify(txt.slice(0, 40)) + ": got " + JSON.stringify(r.error) + " / " + JSON.stringify(wv.error));
  else codeOk++;
}
check(codeOk === ERRS.length, ERRS.length + " mistakes in code each get a plain message with the right line (native and WebAssembly agree)");
check(codeErr("x = 1 +\n  2\ny = x; z = y\n// a comment\n/* and\nanother */ outL = z * inL\n").ok, "a statement can go on to the next line after an operator; ; and new lines both end statements; comments");
check(codeErr("x".repeat(70000)).error.includes("too long"), "code longer than 64 KB is refused");

// hostile scripts: they run, they stop, nothing hangs or breaks
const HOSTILE = [
  ["a loop inside a loop (16 million steps a sample)", "loop (4096) { loop (4096) { x += 1 } }\noutL = inL", /too much work/],
  ["a giant count", "loop (1e30) { x += 1 }", /too much work/],
  ["dividing by zero and taking the log of zero", "outL = 1 / 0 + inL * 0\noutR = log(0) * 0 + sqrt(-1) + fmod(1, 0) + pow(-2, 0.5)", null],
  ["numbers that overflow", "x = x * 1e30 + 1e30\noutL = x", /invalid number/],
  ["an array index far outside", "array a[8]\na[1e9] = 1\na[-5] = 2\noutL = a[123456789] + a[-1e12]", null],
  ["reading a delay far behind", "delay d[5]\nd.write(inL)\noutL = d.read(1e9) + d.read(-1e9)", null],
];
for (const [name, codeText, re] of HOSTILE) {
  const pl = P("hostile", [], [], [], codeText), t0 = Date.now(), n = nativeRender(pl), ms = Date.now() - t0, wv = wasmRender(pl);
  if (n.error || wv.error) { bad(name + ": " + (n.error || wv.error)); continue; }
  const s = stats(n.L), s2 = stats(wv.L);
  const msgOk = re ? re.test(n.status || "") && re.test(wv.status || "") : true;
  check(s.fin && s2.fin && s.pk <= 16 && ms < 60000 && msgOk, name + ": stops in " + (ms / 1000).toFixed(1) + " s for 2 s of sound, stays finite" + (re ? ", and says so (\"" + (n.status || "nothing").slice(0, 60) + "\")" : ""));
}
{   // random scripts never crash the compiler (WebAssembly traps on any bad memory access, so this also checks the C)
  const toks = ["x", "y", "inL", "outL", "1", "2.5", "(", ")", "[", "]", "{", "}", "+", "-", "*", "/", "%", "^", "=", "+=", "==", "<", "&&", "||", "!", "?", ":", ";", "\n", ",", ".", "if", "else", "loop", "array", "delay", "sin", "pow", "@init", "@sample", "read", "write", "len", "#", "\"", "/*", "//"];
  let s = 7, crashes = 0; const rnd = (n) => { s = (s * 1103515245 + 12345) >>> 0; return s % n; };
  for (let k = 0; k < 3000; k++) { let t = ""; for (let i = 0, n = 1 + rnd(40); i < n; i++) t += toks[rnd(toks.length)] + (rnd(3) ? " " : ""); try { CMFx.checkCode(t); } catch (e) { crashes++; if (crashes < 3) console.error("    " + JSON.stringify(t) + " -> " + e.message); } }
  check(crashes === 0, "3000 random scripts: the compiler answers every one without crashing");
}

// ---- plugin files: plain errors
const FILE_ERRS = [
  [{}, /format/], [{ format: "central-fx", version: 9, name: "x" }, /newer/], [{ format: "central-fx", name: "" }, /needs a name/],
  [P("x", [{ id: "a", type: "spaceship" }], []), /block type/], [P("x", [{ id: "in", type: "input" }], []), /output block/],
  [P("x", [{ id: "a", type: "gain" }, { id: "b", type: "gain" }, { id: "o", type: "output" }], [{ from: "a", to: "b.in" }, { from: "b", to: "a.in" }, { from: "b", to: "o" }]), /loop/],
  [P("x", [{ id: "in", type: "input" }, { id: "o", type: "output" }], [{ from: "in", to: "o.nope" }]), /no input called nope/],
  [P("x", [{ id: "in", type: "input" }, { id: "f", type: "filter", props: { freq: { param: "zz" } } }, { id: "o", type: "output" }], []), /knob that isn't there/],
  [P("x", [{ id: "f", type: "filter", props: { mode: "wobble" } }, { id: "o", type: "output" }], []), /choices/],
  [P("x", [{ id: "c", type: "code", props: { code: "outL = (" } }, { id: "o", type: "output" }], []), /c: line 1/],
  [P("x", [], [], [{ id: "a b", min: 0, max: 1 }]), /id must be/], [P("x", [], [], [{ id: "a", min: 1, max: 0 }]), /max bigger/],
  ["{ not json", /valid JSON/], [P("x", [], []), /empty/],
];
let fileOk = 0;
for (const [pl, re] of FILE_ERRS) { const r = CMFx.check(pl); if (r.ok || !re.test(r.error)) bad("plugin error " + re + ": got " + JSON.stringify(r.error)); else fileOk++; }
check(fileOk === FILE_ERRS.length, FILE_ERRS.length + " broken plugin files are refused with a plain reason");

// ---- 4. the presets
const presetDir = path.join(root, "production/plugin-builder/presets"), presets = fs.readdirSync(presetDir).filter((f) => f.endsWith(".cmfx.json"));
for (const f of presets) {
  const pl = JSON.parse(fs.readFileSync(path.join(presetDir, f), "utf8")), r = CMFx.check(pl);
  if (!r.ok) { bad(f + ": " + r.error); continue; }
  const n = nativeRender(pl), wv = wasmRender(pl), d = Math.max(maxDiff(n.L, wv.L), maxDiff(n.R, wv.R)), s = stats(n.L);
  check(s.fin && s.rms > 1e-3 && s.pk < 4 && d < 1e-4 && pl.description, "preset " + pl.name + ": loads, makes sound (peak " + s.pk.toFixed(2) + "), the same native and in WebAssembly, and says what it's for");
}
check(presets.length >= 6, presets.length + " presets ship with the builder");

// ---- 5. sharing one: the website's upload check, and the installers on computers and on the Central Pedal
{
  const buf = fs.readFileSync(path.join(presetDir, "tape-delay.cmfx.json")), sha = crypto.createHash("sha256").update(buf).digest("hex");
  try {
    const CF = await import(path.join(root, "server/src/creatorfiles.js"));
    const r = CF.checkPlugin("all", "tape-delay.cmfx.json", buf, new Set());
    let refused = ""; try { CF.checkPlugin("all", "x.cmfx.json", Buffer.from(JSON.stringify(P("x", [{ id: "a", type: "nope" }], []))), new Set()); } catch (e) { refused = e.message; }
    let blocked = ""; try { CF.checkPlugin("all", "t.cmfx.json", buf, new Set([sha])); } catch (e) { blocked = e.message; }
    check(r.format === "cmfx" && r.binaries[0].sha256 === sha && /block type/.test(refused) && /harmful/.test(blocked), "the website takes a .cmfx.json as a plugin for every device, checked by the same core (and refuses a broken or blocked one)");
  } catch (e) { bad("the website's upload check: " + e.message); }
  const item = { kind: "plugin", format: "cmfx", bundle: "tape-delay.cmfx.json", name: "Tape Delay", binaries: [{ name: "tape-delay.cmfx.json", sha256: sha }] };
  try {
    const { Libraries } = require(path.join(root, "central-usage/libraries.js")), dir = path.join(tmp, "libs-js"); fs.mkdirSync(dir);
    const L = new Libraries({ dir, send() { } }); L.setPluginsAllowed(true);
    const rec = L._unpackPlugin("community-5", item, buf);
    let wrong = ""; try { L._unpackPlugin("community-6", Object.assign({}, item, { binaries: [{ name: item.bundle, sha256: "0".repeat(64) }] }), buf); } catch (e) { wrong = e.message; }
    check(fs.readFileSync(rec.path).equals(buf) && rec.format === "cmfx" && /doesn't match/.test(wrong), "the computers' installer puts a community Central FX plugin in place, and refuses one that isn't the file Motion Audio checked");
  } catch (e) { bad("the computers' installer: " + e.message); }
  const py = spawnSync(process.platform === "win32" ? "python" : "python3", ["-c", [
    "import sys, json, os; sys.path.insert(0, sys.argv[1]); import libraries as L",
    "s = L.LibraryStore(sys.argv[2]); s.set_plugins_allowed(True); it = json.loads(sys.argv[3]); data = open(sys.argv[4], 'rb').read()",
    "r = s._unpack_plugin('community-5', it, data); ok = open(r['path'], 'rb').read() == data",
    "it['binaries'][0]['sha256'] = '0' * 64",
    "try:\n    s._unpack_plugin('community-6', it, data); ok = False\nexcept L.LibraryError as e:\n    ok = ok and \"doesn't match\" in str(e)",
    "print('OK' if ok else 'NO')"].join("\n"), root, path.join(tmp, "libs-py"), JSON.stringify(item), path.join(presetDir, "tape-delay.cmfx.json")], { encoding: "utf8" });
  check(/OK/.test(py.stdout || ""), "the Central Pedal's installer does the same" + (/OK/.test(py.stdout || "") ? "" : ": " + (py.stderr || py.stdout || py.error).slice(-400)));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? "\n" + failures + " FAILED" : "\nall passed");
process.exit(failures ? 1 : 0);
