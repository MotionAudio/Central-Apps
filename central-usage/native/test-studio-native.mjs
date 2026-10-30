// cu-studio (the Studio's live sound) on its own, with no sound card: tracks, notes, layers by key range, mute, all off.
//   node test-studio-native.mjs build/cu-studio
import { spawn } from "node:child_process"; import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert";
import { makeSf2 } from "./make-test-sf2.mjs";
const bin = process.argv[2] || "build/cu-studio";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cu-studio-")), sf2 = path.join(dir, "test.sf2"); fs.writeFileSync(sf2, makeSf2());
const p = spawn(bin, ["--backend", "null", "--block", "128"], { stdio: ["pipe", "pipe", "inherit"] });
let buf = "", waiters = [];
p.stdout.on("data", (b) => { buf += b; let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); let m; try { m = JSON.parse(line); } catch (_) { continue; } const w = waiters.findIndex((x) => x.type === m.type); if (w >= 0) waiters.splice(w, 1)[0].res(m); } });
const next = (type) => new Promise((res, rej) => { waiters.push({ type, res }); setTimeout(() => rej(new Error("no " + type)), 5000); });
const send = (m) => p.stdin.write(JSON.stringify(m) + "\n");
const render = async (frames) => { const w = next("studioRender"); send({ action: "render", frames }); return (await w).peak; };
let failures = 0; async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + (e && e.message || e)); } }

await check("starts without a sound card and says so", async () => { const s = await next("studioMonitor"); assert.equal(s.ok, true); assert.match(s.device, /none/); });
await check("a track with a layer loads its bank; a note sounds, silence before it", async () => {
  const w = next("studioMonitor"); send({ action: "tracks", tracks: [{ id: "keys", volume: 1, pan: 0, layers: [{ file: sf2, bank: 0, prog: 0, lo: 0, hi: 127 }] }, { id: "drums", layers: [{ file: sf2, bank: 128, prog: 0 }] }] });
  const s = await w; assert.equal(s.banks, 1); assert.equal(s.tracks, 2); assert.equal(s.error, null);
  assert.ok(await render(4800) < 0.001, "silent before a note");
  send({ action: "midi", track: "keys", data: [0x90, 60, 110] }); const pk = await render(4800); assert.ok(pk > 0.05, "peak " + pk);
});
await check("note off: the sound ends", async () => { send({ action: "midi", track: "keys", data: [0x80, 60, 0] }); await render(48000); assert.ok(await render(4800) < 0.001); });
await check("the drum track plays its kit (bank 128)", async () => { send({ action: "midi", track: "drums", data: [0x99, 36, 120] }); assert.ok(await render(2400) > 0.05); await render(48000); });
await check("a split: a layer only answers inside its key range", async () => {
  send({ action: "tracks", tracks: [{ id: "keys", layers: [{ file: sf2, bank: 0, prog: 0, lo: 72, hi: 127 }] }] }); await next("studioMonitor");
  send({ action: "midi", track: "keys", data: [0x90, 60, 110] }); assert.ok(await render(4800) < 0.001, "below the split: nothing");
  send({ action: "midi", track: "keys", data: [0x90, 76, 110] }); assert.ok(await render(4800) > 0.05, "above it: sound"); send({ action: "allOff" }); await render(48000);
});
await check("a muted track is silent; an unknown track is ignored", async () => {
  send({ action: "tracks", tracks: [{ id: "keys", mute: true, layers: [{ file: sf2, bank: 0, prog: 0 }] }] }); await next("studioMonitor");
  send({ action: "midi", track: "keys", data: [0x90, 60, 110] }); send({ action: "midi", track: "nope", data: [0x90, 60, 110] }); assert.ok(await render(4800) < 0.001);
});
await check("a bank that isn't there is reported, the rest still works", async () => {
  send({ action: "tracks", tracks: [{ id: "a", layers: [{ file: path.join(dir, "missing.sf2") }] }, { id: "b", layers: [{ file: sf2 }] }] }); const s = await next("studioMonitor");
  assert.match(s.error || "", /could not open/); send({ action: "midi", track: "b", data: [0x90, 60, 100] }); assert.ok(await render(4800) > 0.05);
});
send({ action: "quit" }); await new Promise((r) => p.on("exit", r));
console.log(failures ? failures + " failed" : "cu-studio: all passed"); process.exit(failures ? 1 : 0);
