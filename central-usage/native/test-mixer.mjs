// Unit test of the cu-mixer engine on its own (no app, no ports): the null backend, several devices
// combined into one set of inputs / outputs, the 64 stereo mixes and the per-mix wired outputs.
//   node native/test-mixer.mjs [path/to/cu-mixer]
import { spawn } from "node:child_process";
import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const bin = process.argv[2] || path.join(here, "build", "cu-mixer" + (process.platform === "win32" ? ".exe" : ""));

function engine(args) {
  const p = spawn(bin, args, { stdio: ["pipe", "pipe", "inherit"] });
  let buf = Buffer.alloc(0); const events = []; const waiters = []; const taps = {};
  p.stdout.on("data", (c) => {
    buf = Buffer.concat([buf, c]);
    while (buf.length >= 5) {
      const n = buf.readUInt32LE(1); if (buf.length < 5 + n) break;
      const t = String.fromCharCode(buf[0]), body = buf.subarray(5, 5 + n); buf = buf.subarray(5 + n);
      if (t === "J") { const e = JSON.parse(body.toString("utf8")); events.push(e); waiters.slice().forEach((w) => { if (w.test(e)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(e); } }); }
      else if (t === "A") { const tap = body[0]; taps[tap] = (taps[tap] || 0) + 1; }
    }
  });
  const cmd = (o) => { const b = Buffer.from(JSON.stringify(o)), h = Buffer.alloc(5); h[0] = 74; h.writeUInt32LE(b.length, 1); p.stdin.write(Buffer.concat([h, b])); };
  const wait = (test, ms = 8000) => new Promise((resolve, reject) => { const hit = events.find(test); if (hit) return resolve(hit); const w = { test, resolve }; waiters.push(w); setTimeout(() => reject(new Error("timeout waiting for event")), ms); });
  const meters = async (pred, ms = 6000) => { const t0 = Date.now(); for (;;) { const m = await wait((e) => e.ev === "meters" && !e._seen, 3000); m._seen = true; if (pred(m)) return m; if (Date.now() - t0 > ms) return m; } };
  return { p, cmd, wait, meters, taps, quit: () => { cmd({ cmd: "quit" }); setTimeout(() => p.kill(), 800); } };
}
let failures = 0;
async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + (e && e.message || e)); } }

const e = engine(["--backend", "null", "--capture", "NULL#8|NULL#4", "--playback", "NULL#16|NULL#16", "--block", "256"]);
let st;
await check("status: null backend, two capture devices combined (8 + 4 inputs), two playback devices (32 outputs)", async () => {
  st = await e.wait((x) => x.ev === "status");
  assert.equal(st.backend, "null", JSON.stringify(st).slice(0, 300));
  assert.equal(st.inputs, 12); assert.equal(st.outputs, 32);
  assert.equal(st.captureDevices.length, 2); assert.equal(st.captureDevices[1].first, 8); assert.equal(st.captureDevices[0].clock, 1); assert.equal(st.captureDevices[1].clock, 0);
  assert.equal(st.max.mixes, 64);
  assert.ok(/:in_8$/.test(st.captureNames[7]) && /:in_1$/.test(st.captureNames[8]), st.captureNames.join(" "));
});
await check("a tone on the second device's first channel (input 9) reaches the meters through the drift-corrected bridge", async () => {
  e.cmd({ cmd: "input", i: 5, src: 1, ch: 8, fader: 0, pan: 0 });
  e.cmd({ cmd: "testgen", ch: 8, freq: 440, level: 0.5 });
  const m = await e.meters((x) => x.in[5] > 0.3);
  assert.ok(m.in[5] > 0.3, "input meter " + m.in[5]);
});
await check("mix 64 (the last): a send, a wired output pair on the second playback device, and a tap", async () => {
  e.cmd({ cmd: "mix", m: 63, level: 0, mute: 0, outL: 30, outR: 31, stereo: 1, tap: 1, used: 1 });
  e.cmd({ cmd: "send", m: 63, i: 5, level: 0, pan: 0, on: 1 });
  const m = await e.meters((x) => x.mix[126] > 0.2);
  assert.ok(m.mix[126] > 0.2 && m.mix[127] > 0.2, "mix 64 meters " + m.mix[126] + " / " + m.mix[127]);
  await new Promise((r) => setTimeout(r, 400));
  assert.ok(e.taps[64] > 2, "tap 64 messages: " + e.taps[64]);
});
await check("mixes 1-64 all usable at once", async () => {
  for (let m = 0; m < 64; m++) { e.cmd({ cmd: "mix", m, level: 0, mute: 0, outL: -1, outR: -1, stereo: 1, tap: 0, used: 1 }); e.cmd({ cmd: "send", m, i: 5, level: -6, pan: 0, on: 1 }); }
  const m = await e.meters((x) => { for (let k = 0; k < 64; k++) if (!(x.mix[k * 2] > 0.1)) return false; return true; });
  const silent = []; for (let k = 0; k < 64; k++) if (!(m.mix[k * 2] > 0.1)) silent.push(k + 1);
  assert.equal(silent.length, 0, "silent mixes: " + silent.join(","));
});
e.quit();

const s = engine(["--backend", "internal"]);
await check("internal clock still works (no device)", async () => { const x = await s.wait((v) => v.ev === "status"); assert.equal(x.backend, "internal"); assert.equal(x.inputs, 0); await s.wait((v) => v.ev === "meters"); });
s.quit();

const bad = engine(["--backend", "null", "--capture", "Nope Device"]);
await check("a device that isn't there is reported, the rest still opens", async () => { const x = await bad.wait((v) => v.ev === "status"); assert.ok(/not found/.test(x.deviceError || ""), JSON.stringify(x).slice(0, 300)); });
bad.quit();

setTimeout(() => { console.log(failures ? "\n" + failures + " MIXER CHECK(S) FAILED" : "\nALL MIXER CHECKS PASSED"); process.exit(failures ? 1 : 0); }, 1200);
