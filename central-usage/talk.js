/* Central Control - talkback on the audio host (main process).
 *   In-ears: the main admin and the admins with the Mix, In-ears or General job talk into the in-ear mixes - all of
 *     them or chosen ones - and the music in those mixes can dim meanwhile. The mic: on the audio host an input of
 *     the interface / Dante (no delay) or this computer's own mic; on another admin computer its own mic, sent here
 *     over the network (48 kHz mono, 10 ms packets - the in-ear stream the other way round). The engine mixes it
 *     into the chosen mixes, so it reaches the wired packs and the phones / computers alike.
 *   Desk: a user (User 1 / User 2) talks to the sound desk. Their voice goes only to the desk's headphones (the
 *     listen output of the main admin and of the admins with the Mix / General job), never into anyone's in-ears.
 * The engine has 4 talk slots (network sources 4..7); a talker holds one while talking.
 * Audio frames: "TKA1", u8 channels (1), u8 0, u16 frames, u32 rate, int16 data. */
"use strict";
const EventEmitter = require("node:events");
const SLOTS = 4, TALKNET = 4, MAXMIX = 64;

function frame(pcm, frames, rate, ch) {   // pcm: Buffer of int16
  const h = Buffer.alloc(12); h.write("TKA1", 0, "latin1"); h[4] = ch || 1; h.writeUInt16LE(frames, 6); h.writeUInt32LE(rate || 48000, 8);
  return Buffer.concat([h, pcm]);
}
function parse(buf) {
  if (!buf || buf.length < 12 || buf[0] !== 84 || buf[1] !== 75 || buf[2] !== 65 || buf[3] !== 49) return null;
  const ch = buf[4] || 1, frames = buf.readUInt16LE(6), rate = buf.readUInt32LE(8);
  if (ch !== 1 || !frames || buf.length < 12 + frames * 2 || rate < 8000 || rate > 96000) return null;
  return { ch, frames, rate, pcm: buf.subarray(12, 12 + frames * 2) };
}
function targetsOf(t) {
  t = t || {}; if (t.all) return { all: true, mixes: [] };
  const mixes = Array.isArray(t.mixes) ? [...new Set(t.mixes.map((m) => Number(m) | 0).filter((m) => m >= 0 && m < MAXMIX))].sort((a, b) => a - b) : [];
  return { all: false, mixes };
}

class Talk extends EventEmitter {
  constructor(opts) {
    super(); this.engine = opts.engine; this.talkers = new Map(); this.slots = new Array(SLOTS).fill(null);
    this.engine.on("pushed", () => this.pushAll());   // (the engine restarted: its slots are empty)
    this.watch = setInterval(() => this.watchdog(), 1000); if (this.watch.unref) this.watch.unref();
  }
  /* key: who (one talker per connection); o: { kind: "inears" | "desk", targets: { all, mixes }, dim (dB, 0 = off), src: "net" | "input", ch };
   * who: { role: "admin" | "user", name } */
  start(key, o, who) {
    o = o || {}; who = who || {};
    const kind = o.kind === "desk" ? "desk" : "inears";
    if (kind === "inears" && who.role !== "admin") return { ok: false, error: "Only the sound desk talks into the in-ears." };
    const old = this.talkers.get(key); if (old && old.kind !== kind) this.stop(key, true);
    const t = this.talkers.get(key) || { key, slot: -1, since: Date.now(), frames: 0 };
    Object.assign(t, { kind, name: String(who.name || o.name || "Someone").slice(0, 40), last: Date.now() });
    if (kind === "inears") {
      t.targets = targetsOf(o.targets); t.dim = Math.max(-40, Math.min(0, Number(o.dim) || 0));
      t.src = o.src === "input" && Number(o.ch) >= 0 ? "input" : "net"; t.ch = Number(o.ch) | 0;
      if (!t.targets.all && !t.targets.mixes.length) return { ok: false, error: "Pick who hears it (All, or some mixes)." };
      if (t.slot < 0) { t.slot = this.slots.indexOf(null); if (t.slot < 0) return { ok: false, error: "Four people are talking already." }; this.slots[t.slot] = key; t.fresh = true; }
    }
    this.talkers.set(key, t); this.push(t); this.changed();
    return { ok: true, talker: this.pub(t) };
  }
  stop(key, quiet) {
    const t = this.talkers.get(key); if (!t) return { ok: true };
    this.talkers.delete(key);
    if (t.slot >= 0) { this.slots[t.slot] = null; this.engine.cmd({ cmd: "talk", slot: t.slot, on: 0 }); }
    if (!quiet) this.changed();
    return { ok: true };
  }
  audio(key, buf) {
    const t = this.talkers.get(key); if (!t) return false;
    const a = parse(buf); if (!a) return false;
    t.last = Date.now(); t.frames += a.frames;
    if (t.kind === "inears") { if (t.slot >= 0 && t.src === "net") { if (t.rate !== a.rate) { t.rate = a.rate; this.netCmd(t); } this.engine.netAudio(TALKNET + t.slot, 1, a.frames, a.pcm); } }
    else this.emit("desk", { key, name: t.name, frames: a.frames, rate: a.rate, pcm: a.pcm, buf });
    return true;
  }
  // ---------------------------------------------------------------- the engine
  netCmd(t) { this.engine.cmd({ cmd: "net", src: TALKNET + t.slot, channels: 1, rate: t.rate || 48000, latency: 50 }); }
  push(t) {
    if (t.kind !== "inears" || t.slot < 0) return;
    if (t.src === "net" && (t.fresh || !t.rate)) { t.rate = t.rate || 48000; this.netCmd(t); }
    t.fresh = false;
    this.engine.cmd({ cmd: "talk", slot: t.slot, on: 1, src: t.src === "input" ? 1 : 2, ch: t.ch, gain: 0, dim: t.dim, all: t.targets.all ? 1 : 0, mixes: t.targets.mixes });
  }
  pushAll() { for (let k = 0; k < SLOTS; k++) this.engine.cmd({ cmd: "talk", slot: k, on: 0 }); this.talkers.forEach((t) => { t.fresh = true; this.push(t); }); }
  watchdog() {   // a computer that went away mid-talk (its mic frames stopped) lets go after 4 s
    const now = Date.now(); let gone = false;
    this.talkers.forEach((t) => { if (t.src !== "input" && now - t.last > 4000) { this.stop(t.key, true); gone = true; } });
    if (gone) this.changed();
  }
  // ---------------------------------------------------------------- who is talking
  pub(t) { return { key: t.key, name: t.name, kind: t.kind, all: !!(t.targets && t.targets.all), mixes: t.targets ? t.targets.mixes : [], dim: t.dim || 0, src: t.src || "net", since: t.since, slot: t.slot }; }
  list() { return [...this.talkers.values()].map((t) => this.pub(t)); }
  /* the in-ear talkers a mix hears now (for the note on that person's screen) */
  heardBy(m) { return this.list().filter((t) => t.kind === "inears" && (t.all || t.mixes.indexOf(m) >= 0)).map((t) => t.name); }
  changed() { this.emit("talkers", this.list()); }
  close() { clearInterval(this.watch); }
}
/* the desk: the main admin, and admins with the Mix (or General) job, hear the users' talkback */
function isDesk(role, jobs) { if (role === "main") return true; if (role !== "admin") return false; const j = Array.isArray(jobs) && jobs.length ? jobs : ["general"]; return j.indexOf("mix") >= 0 || j.indexOf("general") >= 0; }
module.exports = { Talk, frame, parse, isDesk, SLOTS };
