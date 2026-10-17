/* Central Usage - DMX output (main process). One output per universe, any mix of:
 *  - USB-DMX: ENTTEC DMX USB Pro protocol (also DMXking ultraDMX Pro / Micro, Eurolite USB-DMX512 PRO,
 *    and most "Pro compatible" boxes). They appear as a serial port (/dev/ttyUSB*, /dev/serial/by-id/...).
 *    One interface = one universe.
 *  - Art-Net 4 (ArtDmx, UDP 6454) to a node's IP or broadcast.
 *  - sACN / E1.31 (UDP 5568), multicast 239.255.<universe> or unicast.
 * The page renders the universes ~40 times a second and hands them here. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const dgram = require("node:dgram");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");

let outputs = [];            // [{ universe, mode, path, host, port, offset, serial, frames, error, target }]
let udp = null, udpReady = false, udpError = null;
let seq = 0;
const sacnSeq = {};
const CID = crypto.randomBytes(16);

function listPorts() {
  const out = [], seen = new Set();
  try {
    for (const n of fs.readdirSync("/dev/serial/by-id")) {
      const full = path.join("/dev/serial/by-id", n), real = fs.realpathSync(full);
      seen.add(real);
      out.push({ path: full, name: n.replace(/^usb-/, "").replace(/-if\d+.*$/, "").replace(/_/g, " "), device: real, likely: /enttec|dmx|ftdi|ft232|dmxking|eurolite/i.test(n) });
    }
  } catch (_) { }
  for (const n of (() => { try { return fs.readdirSync("/dev"); } catch (_) { return []; } })()) {
    if (/^tty(USB|ACM)\d+$/.test(n) && !seen.has("/dev/" + n)) out.push({ path: "/dev/" + n, name: n, device: "/dev/" + n, likely: /USB/.test(n) });
  }
  return out;
}

function closeSerial(o) { if (o.serial && o.serial.fd != null) { try { fs.closeSync(o.serial.fd); } catch (_) { } } o.serial = null; }
function openSerial(o) {
  o.serial = { fd: null, busy: false };
  execFile("stty", ["-F", o.path, "raw", "-echo", "-echoe", "-echok", "115200"], () => { });   // raw 8N1 (the Pro makes the DMX timing itself)
  try { o.serial.fd = fs.openSync(o.path, fs.constants.O_WRONLY | fs.constants.O_NOCTTY | (fs.constants.O_NONBLOCK || 0)); o.error = null; }
  catch (e) { o.error = e.code === "EACCES" ? "No permission for " + o.path + " - reinstall Central Usage (it adds a udev rule) or add yourself to the 'dialout' group, then log out and in." : e.message; }
}

function enttecPacket(data) {  // label 6 = Output Only Send DMX Packet Request
  const n = data.length + 1, buf = Buffer.alloc(n + 5);
  buf[0] = 0x7e; buf[1] = 6; buf[2] = n & 0xff; buf[3] = n >> 8; buf[4] = 0;
  Buffer.from(data.buffer, data.byteOffset, data.length).copy(buf, 5);
  buf[n + 4] = 0xe7;
  return buf;
}
function artnetPacket(universe, data) {
  const buf = Buffer.alloc(18 + 512);
  buf.write("Art-Net\0", 0, "latin1"); buf.writeUInt16LE(0x5000, 8); buf.writeUInt16BE(14, 10);
  buf[12] = seq = (seq % 255) + 1; buf[13] = 0;
  buf.writeUInt16LE(universe & 0x7fff, 14); buf.writeUInt16BE(512, 16);
  Buffer.from(data.buffer, data.byteOffset, Math.min(512, data.length)).copy(buf, 18);
  return buf;
}
function sacnPacket(universe, data) {
  const buf = Buffer.alloc(638);
  buf.writeUInt16BE(0x0010, 0); buf.writeUInt16BE(0, 2); buf.write("ASC-E1.17\0\0\0", 4, "latin1");
  buf.writeUInt16BE(0x7000 | (638 - 16), 16); buf.writeUInt32BE(0x00000004, 18); CID.copy(buf, 22);
  buf.writeUInt16BE(0x7000 | (638 - 38), 38); buf.writeUInt32BE(0x00000002, 40);
  buf.write("Central Usage", 44, "utf8"); buf[108] = 100; buf.writeUInt16BE(0, 109);
  sacnSeq[universe] = ((sacnSeq[universe] || 0) + 1) & 0xff; buf[111] = sacnSeq[universe]; buf[112] = 0;
  buf.writeUInt16BE(universe, 113);
  buf.writeUInt16BE(0x7000 | (638 - 115), 115); buf[117] = 0x02; buf[118] = 0xa1;
  buf.writeUInt16BE(0x0000, 119); buf.writeUInt16BE(0x0001, 121); buf.writeUInt16BE(513, 123); buf[125] = 0;
  Buffer.from(data.buffer, data.byteOffset, Math.min(512, data.length)).copy(buf, 126);
  return buf;
}
function ensureUdp() {
  if (udp) return;
  udp = dgram.createSocket({ type: "udp4", reuseAddr: true });
  udp.on("error", (e) => { udpError = e.message; });
  udp.bind(0, () => { try { udp.setBroadcast(true); udp.setMulticastTTL(4); } catch (_) { } udpReady = true; });
}

/* configure({ outputs: [{ universe, mode: off|usb|artnet|sacn, path, host, port, offset }] })  (1.x: one { mode, ... } = universe 1) */
function configure(next) {
  // the 1.x form, one { mode, ... }: the network modes send every universe, USB sends universe 1
  const list = next && Array.isArray(next.outputs) ? next.outputs : next && next.mode ? [Object.assign({ universe: Number(next.universe) || 1, all: next.mode !== "usb" }, next)] : [];
  outputs.forEach(closeSerial);
  outputs = list.filter((o) => o && o.mode && o.mode !== "off").map((o) => ({ universe: Math.max(1, Number(o.universe) || 1), all: !!o.all, mode: o.mode, path: o.path || "", host: o.host || "", port: Number(o.port) || 0, offset: Number(o.offset) || 0, frames: 0, error: null, target: "" }));
  const usedPaths = new Set();
  for (const o of outputs) {
    if (o.mode === "usb") {
      if (!o.path) { o.error = "choose the USB-DMX interface"; continue; }
      if (usedPaths.has(o.path)) { o.error = "that interface already sends another universe"; continue; }
      usedPaths.add(o.path); openSerial(o); o.target = o.path;
    } else if (o.mode === "artnet" || o.mode === "sacn") {
      ensureUdp();
      o.target = o.mode === "artnet" ? (o.host || "255.255.255.255") + ":" + (o.port || 6454) + " (Art-Net " + Math.max(0, o.universe - 1 + o.offset) + ")" : (o.host || "239.255." + ((o.universe >> 8) & 0xff) + "." + (o.universe & 0xff)) + ":" + (o.port || 5568);
    }
  }
  return status();
}

function status() {
  const one = outputs[0] || {};
  return { mode: outputs.length ? (outputs.length > 1 ? "multi" : one.mode) : "off", target: outputs.map((o) => o.target).join(", "), frames: outputs.reduce((m, o) => Math.max(m, o.frames), 0), error: outputs.map((o) => o.error).filter(Boolean)[0] || udpError || null,
    outputs: outputs.map((o) => ({ universe: o.universe, mode: o.mode, target: o.target, frames: o.frames, error: o.error })), ports: listPorts() };
}

/* frame: { universes: { "1": Uint8Array(512) | number[], ... } }  (universe numbers as the user sees them, 1-based) */
function sendFrame(frame) {
  const unis = (frame && frame.universes) || {};
  const jobs = [];
  for (const o of outputs) { if (o.all) Object.keys(unis).forEach((k) => jobs.push([Object.assign(o, {}), Number(k)])); else jobs.push([o, o.universe]); }
  for (const [o, universe] of jobs) {
    const raw = unis[String(universe)]; if (!raw) continue;
    const data = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    if (o.mode === "usb") {
      if (!o.serial || o.serial.fd == null || o.serial.busy) continue;
      const pkt = enttecPacket(data); o.serial.busy = true;
      fs.write(o.serial.fd, pkt, 0, pkt.length, null, (err) => { if (o.serial) o.serial.busy = false; if (err) { o.error = err.code === "EAGAIN" ? null : err.message; } else o.frames++; });
    } else if (udpReady && o.mode === "artnet") {
      udp.send(artnetPacket(Math.max(0, universe - 1 + o.offset), data), o.port || 6454, o.host || "255.255.255.255", (e) => { if (e) o.error = e.message; }); o.frames++;
    } else if (udpReady && o.mode === "sacn") {
      const host = o.host || ("239.255." + ((universe >> 8) & 0xff) + "." + (universe & 0xff));
      udp.send(sacnPacket(universe, data), o.port || 5568, host, (e) => { if (e) o.error = e.message; }); o.frames++;
    }
  }
}

function blackout() { const z = new Uint8Array(512), u = {}; outputs.forEach((o) => { u[String(o.universe)] = z; }); sendFrame({ universes: u }); }

module.exports = { listPorts, configure, sendFrame, status, blackout, enttecPacket, artnetPacket, sacnPacket };
