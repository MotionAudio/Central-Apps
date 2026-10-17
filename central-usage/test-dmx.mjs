// DMX output (main process module): ENTTEC Pro framing, Art-Net and sACN packets, and real sends
// over UDP (loopback) and to a "serial port" (a plain file stands in for /dev/ttyUSB0).
import { createRequire } from "node:module"; import dgram from "node:dgram"; import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert";
const require = createRequire(import.meta.url); const dmx = require("./dmx.js");
let failures = 0; async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e && e.message || e)); } }
const data = new Uint8Array(512); data[0] = 255; data[1] = 128; data[511] = 7;

await check("ENTTEC DMX USB Pro packet: 0x7E, label 6, length 513, start code 0, 512 slots, 0xE7", () => {
  const p = dmx.enttecPacket(data);
  assert.equal(p.length, 518); assert.deepEqual([p[0], p[1], p[2], p[3], p[4]], [0x7e, 6, 513 & 255, 513 >> 8, 0]);
  assert.equal(p[5], 255); assert.equal(p[6], 128); assert.equal(p[516], 7); assert.equal(p[517], 0xe7);
});
await check("Art-Net ArtDmx: header, opcode 0x5000, version 14, universe, length 512", () => {
  const p = dmx.artnetPacket(3, data);
  assert.equal(p.toString("latin1", 0, 8), "Art-Net\0"); assert.equal(p.readUInt16LE(8), 0x5000); assert.equal(p.readUInt16BE(10), 14);
  assert.equal(p.readUInt16LE(14), 3); assert.equal(p.readUInt16BE(16), 512); assert.equal(p[18], 255); assert.equal(p[18 + 511], 7);
});
await check("sACN E1.31: 638 bytes, ACN id, the three flags+length fields, universe, 513 values", () => {
  const p = dmx.sacnPacket(1, data);
  assert.equal(p.length, 638); assert.equal(p.toString("latin1", 4, 13), "ASC-E1.17");
  assert.equal(p.readUInt16BE(16), 0x7000 | 622); assert.equal(p.readUInt16BE(38), 0x7000 | 600); assert.equal(p.readUInt16BE(115), 0x7000 | 523);
  assert.equal(p.readUInt32BE(18), 4); assert.equal(p.readUInt32BE(40), 2); assert.equal(p[117], 2); assert.equal(p.readUInt16BE(113), 1); assert.equal(p.readUInt16BE(123), 513);
  assert.equal(p[125], 0); assert.equal(p[126], 255); assert.equal(p[637], 7);
});
await check("Art-Net goes out over UDP to the node (loopback), universe 1 -> Art-Net 0", async () => {
  const sock = dgram.createSocket("udp4"); await new Promise((r) => sock.bind(0, "127.0.0.1", r));
  const got = new Promise((res) => sock.on("message", (m) => res(m)));
  dmx.configure({ mode: "artnet", host: "127.0.0.1", port: sock.address().port });
  await new Promise((r) => setTimeout(r, 100));
  dmx.sendFrame({ universes: { "1": Array.from(data) } });
  const m = await Promise.race([got, new Promise((_, rej) => setTimeout(() => rej(new Error("no packet")), 2000))]);
  assert.equal(m.readUInt16LE(14), 0); assert.equal(m[18], 255); sock.close();
});
await check("sACN goes out over UDP (unicast to the node)", async () => {
  const sock = dgram.createSocket("udp4"); await new Promise((r) => sock.bind(0, "127.0.0.1", r));
  const got = new Promise((res) => sock.on("message", (m) => res(m)));
  dmx.configure({ mode: "sacn", host: "127.0.0.1", port: sock.address().port });
  await new Promise((r) => setTimeout(r, 100));
  dmx.sendFrame({ universes: { "2": Array.from(data) } });
  const m = await Promise.race([got, new Promise((_, rej) => setTimeout(() => rej(new Error("no packet")), 2000))]);
  assert.equal(m.readUInt16BE(113), 2); assert.equal(m[126], 255); sock.close();
});
await check("USB-DMX: frames are written to the interface's port in ENTTEC Pro framing", async () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dmx-")), "ttyUSB-test"); fs.writeFileSync(f, "");
  const st = dmx.configure({ mode: "usb", path: f });
  assert.ok(!st.error, st.error);
  dmx.sendFrame({ universes: { "1": Array.from(data) } });
  await new Promise((r) => setTimeout(r, 150));
  const b = fs.readFileSync(f); assert.equal(b.length, 518); assert.equal(b[0], 0x7e); assert.equal(b[5], 255); assert.equal(b[517], 0xe7);
  assert.equal(dmx.status().frames, 1);
  dmx.configure({ mode: "off" });
});
await check("one output per universe: universe 1 over Art-Net to one node, universe 2 over sACN to another, at the same time", async () => {
  const a = dgram.createSocket("udp4"), b = dgram.createSocket("udp4"); await new Promise((r) => a.bind(0, "127.0.0.1", r)); await new Promise((r) => b.bind(0, "127.0.0.1", r));
  const gotA = [], gotB = []; a.on("message", (m) => gotA.push(m)); b.on("message", (m) => gotB.push(m));
  const st = dmx.configure({ outputs: [{ universe: 1, mode: "artnet", host: "127.0.0.1", port: a.address().port }, { universe: 2, mode: "sacn", host: "127.0.0.1", port: b.address().port }, { universe: 3, mode: "off" }] });
  assert.equal(st.outputs.length, 2);
  await new Promise((r) => setTimeout(r, 100));
  const u1 = new Uint8Array(512), u2 = new Uint8Array(512); u1[0] = 11; u2[0] = 22;
  dmx.sendFrame({ universes: { "1": Array.from(u1), "2": Array.from(u2), "3": Array.from(u1) } });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(gotA.length, 1); assert.equal(gotA[0][18], 11); assert.equal(gotA[0].readUInt16LE(14), 0);
  assert.equal(gotB.length, 1); assert.equal(gotB[0][126], 22); assert.equal(gotB[0].readUInt16BE(113), 2);
  const s2 = dmx.status(); assert.ok(s2.outputs.every((o) => o.frames === 1), JSON.stringify(s2.outputs));
  a.close(); b.close(); dmx.configure({ outputs: [] });
});
await check("the port list finds serial interfaces (or is simply empty)", () => { assert.ok(Array.isArray(dmx.listPorts())); });
console.log(failures ? "\n" + failures + " DMX CHECK(S) FAILED" : "\nALL DMX CHECKS PASSED"); process.exit(failures ? 1 : 0);
