/* Central Usage - DMX output (main process).
 *
 *  - USB-DMX: ENTTEC DMX USB Pro protocol (also DMXking ultraDMX Pro / Micro, Eurolite USB-DMX512 PRO,
 *    and most "Pro compatible" boxes). They appear as a serial port (/dev/ttyUSB*, /dev/serial/by-id/...).
 *  - Art-Net 4 (ArtDmx, UDP 6454) to a node's IP or broadcast.
 *  - sACN / E1.31 (UDP 5568), multicast 239.255.<universe> or unicast.
 * The page renders the universes ~40 times a second and hands them here. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const dgram = require("node:dgram");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");

let cfg = { mode: "off" };
let serial = { fd: null, path: null, busy: false, error: null, frames: 0 };
let udp = null, udpReady = false;
let seq = 0, sacnSeq = {};
const CID = crypto.randomBytes(16);
let stats = { frames: 0, lastError: null, lastAt: 0, target: "" };

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

function closeSerial() { if (serial.fd != null) { try { fs.closeSync(serial.fd); } catch (_) { } } serial = { fd: null, path: null, busy: false, error: null, frames: 0 }; }
function openSerial(p) {
  closeSerial();
  serial.path = p;
  // raw 8N1 (the Pro's own processor makes the DMX timing; the baud rate does not matter for it)
  execFile("stty", ["-F", p, "raw", "-echo", "-echoe", "-echok", "115200"], () => { });
  try { serial.fd = fs.openSync(p, fs.constants.O_WRONLY | fs.constants.O_NOCTTY | (fs.constants.O_NONBLOCK || 0)); serial.error = null; }
  catch (e) { serial.error = e.code === "EACCES" ? "No permission for " + p + " - reinstall Central Usage (it adds a udev rule) or add yourself to the 'dialout' group, then log out and in." : e.message; }
}

function enttecPacket(data) {  // label 6 = Output Only Send DMX Packet Request
  const n = data.length + 1, buf = Buffer.alloc(n + 5);
  buf[0] = 0x7e; buf[1] = 6; buf[2] = n & 0xff; buf[3] = n >> 8; buf[4] = 0; // DMX start code
  Buffer.from(data.buffer, data.byteOffset, data.length).copy(buf, 5);
  buf[n + 4] = 0xe7;
  return buf;
}

function artnetPacket(universe, data) {
  const buf = Buffer.alloc(18 + 512);
  buf.write("Art-Net\0", 0, "latin1");
  buf.writeUInt16LE(0x5000, 8);        // OpDmx
  buf.writeUInt16BE(14, 10);           // protocol version
  buf[12] = seq = (seq % 255) + 1;     // sequence 1..255
  buf[13] = 0;                         // physical
  buf.writeUInt16LE(universe & 0x7fff, 14); // SubUni + Net
  buf.writeUInt16BE(512, 16);
  Buffer.from(data.buffer, data.byteOffset, Math.min(512, data.length)).copy(buf, 18);
  return buf;
}

function sacnPacket(universe, data) {
  const buf = Buffer.alloc(638);
  buf.writeUInt16BE(0x0010, 0); buf.writeUInt16BE(0, 2); buf.write("ASC-E1.17\0\0\0", 4, "latin1");
  buf.writeUInt16BE(0x7000 | (638 - 16), 16); buf.writeUInt32BE(0x00000004, 18); CID.copy(buf, 22);
  buf.writeUInt16BE(0x7000 | (638 - 38), 38); buf.writeUInt32BE(0x00000002, 40);
  buf.write("Central Usage", 44, "utf8");                 // source name (64 bytes, zero padded)
  buf[108] = 100;                                          // priority
  buf.writeUInt16BE(0, 109);                               // sync address
  sacnSeq[universe] = ((sacnSeq[universe] || 0) + 1) & 0xff; buf[111] = sacnSeq[universe];
  buf[112] = 0;                                            // options
  buf.writeUInt16BE(universe, 113);
  buf.writeUInt16BE(0x7000 | (638 - 115), 115); buf[117] = 0x02; buf[118] = 0xa1;
  buf.writeUInt16BE(0x0000, 119); buf.writeUInt16BE(0x0001, 121); buf.writeUInt16BE(513, 123);
  buf[125] = 0; // start code
  Buffer.from(data.buffer, data.byteOffset, Math.min(512, data.length)).copy(buf, 126);
  return buf;
}

function ensureUdp() {
  if (udp) return;
  udp = dgram.createSocket({ type: "udp4", reuseAddr: true });
  udp.on("error", (e) => { stats.lastError = e.message; });
  udp.bind(0, () => { try { udp.setBroadcast(true); udp.setMulticastTTL(4); } catch (_) { } udpReady = true; });
}

function configure(next) {
  cfg = Object.assign({ mode: "off" }, next || {});
  stats = { frames: 0, lastError: null, lastAt: 0, target: "" };
  if (cfg.mode === "usb" && cfg.path) { openSerial(cfg.path); stats.target = cfg.path; stats.lastError = serial.error; }
  else closeSerial();
  if (cfg.mode === "artnet" || cfg.mode === "sacn") { ensureUdp(); stats.target = cfg.mode === "artnet" ? (cfg.host || "255.255.255.255") + ":6454" : (cfg.host || "multicast") + ":5568"; }
  return status();
}

function status() { return { mode: cfg.mode, target: stats.target, frames: stats.frames, error: stats.lastError || serial.error, ports: listPorts() }; }

/* frame: { universes: { "1": Uint8Array(512), ... } }  (universe numbers as the user sees them, 1-based) */
function sendFrame(frame) {
  const unis = (frame && frame.universes) || {};
  if (cfg.mode === "usb") {
    if (serial.fd == null || serial.busy) return;
    const data = unis[String(cfg.universe || 1)] || unis["1"]; if (!data) return;
    const pkt = enttecPacket(new Uint8Array(data));
    serial.busy = true;
    fs.write(serial.fd, pkt, 0, pkt.length, null, (err) => { serial.busy = false; if (err) { stats.lastError = err.code === "EAGAIN" ? null : err.message; } else stats.frames++; });
  } else if ((cfg.mode === "artnet" || cfg.mode === "sacn") && udpReady) {
    for (const k of Object.keys(unis)) {
      const u = Number(k), data = new Uint8Array(unis[k]);
      if (cfg.mode === "artnet") {
        const port = Number(cfg.port) || 6454, au = Math.max(0, u - 1 + (Number(cfg.offset) || 0)); // Art-Net counts from 0
        udp.send(artnetPacket(au, data), port, cfg.host || "255.255.255.255", (e) => { if (e) stats.lastError = e.message; });
      } else {
        const host = cfg.host || ("239.255." + ((u >> 8) & 0xff) + "." + (u & 0xff));
        udp.send(sacnPacket(u, data), Number(cfg.port) || 5568, host, (e) => { if (e) stats.lastError = e.message; });
      }
    }
    stats.frames++;
  }
  stats.lastAt = Date.now();
}

function blackout() { const z = new Uint8Array(512); const u = {}; for (let i = 1; i <= 4; i++) u[String(i)] = z; sendFrame({ universes: u }); }

module.exports = { listPorts, configure, sendFrame, status, blackout, enttecPacket, artnetPacket, sacnPacket };
