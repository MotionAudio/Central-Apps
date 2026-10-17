/* Central Control - the audio host's server (port 8092): the other Central Control computers (admins and users)
 * and phones connect here.
 *   admins  (admin code)    see and change the whole mixer, listen to any mix, get the meters and the lights' bands
 *   users   (in-ear code)   pick a free mix, see only the channels routed to them, set their levels; their mix
 *                           comes back over the network ("local") and / or leaves the interface / Dante for an
 *                           in-ear transmitter ("wired") - the sound desk sets that per mix
 *   phones                  http://<this computer>:8092/ - the same user page in the browser
 * Audio frames to a client: "IEA1", u8 tap (0 main, 1..64 mix), u8 channels, u16 frames, u32 rate, int16 data.
 * Talkback (talk.js): a client's mic comes in as "TKA1" frames (the same layout, mono); { type: "talk", on, kind:
 * "inears" | "desk", targets, dim } starts / stops it. The users' talkback goes out as "TKA1" frames to the desk's
 * admin clients only; everybody hears who is talking ({ type: "talkers" } to admins, { type: "talking" } to a user:
 * the names talking into their mix). */
"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const M = require("./app/mixer-model");
const { isDesk } = require("./talk");
let WS = null; try { WS = require("ws"); } catch (_) { }

const FILES = { "/": ["phone.html", "text/html; charset=utf-8"], "/index.html": ["phone.html", "text/html; charset=utf-8"], "/mixer-model.js": ["mixer-model.js", "text/javascript"], "/inear-client.js": ["inear-client.js", "text/javascript"], "/inear-ui.js": ["inear-ui.js", "text/javascript"], "/inear.css": ["inear.css", "text/css"], "/fonts/fonts.css": ["fonts/fonts.css", "text/css"] };

class Host {
  constructor(opts) { this.engine = opts.engine; this.talk = opts.talk || null; this.recorder = opts.recorder || null; this.keys = 0; this.appDir = opts.appDir; this.cfg = opts.cfg; this.server = null; this.wss = null; this.clients = new Map(); this.meterTimer = null; this.viewTimer = null; this.port = 0; this.error = null; this.extra = opts.extra || (() => ({})); }
  addresses() { const out = []; for (const list of Object.values(os.networkInterfaces())) for (const n of list || []) if (n.family === "IPv4" && !n.internal) out.push(n.address); return out; }
  status() { return { running: !!this.server, port: this.port, error: this.error, addresses: this.addresses(), clients: [...this.clients.values()].filter((c) => c.role && !c.talkOnly).map((c) => ({ role: c.role, name: c.name, mix: c.mix, listening: [...c.listening.keys()] })) }; }
  start(port) {
    this.stop(); this.port = port || 8092;
    if (!WS) { this.error = "the 'ws' module is missing"; return this.status(); }
    this.server = http.createServer((req, res) => this.http(req, res));
    this.wss = new WS.WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 1 << 20 });
    this.server.on("upgrade", (req, sock, head) => { if (!/^\/ws\b/.test(req.url)) return sock.destroy(); this.wss.handleUpgrade(req, sock, head, (ws) => this.connection(ws, req)); });
    this.server.on("error", (e) => { this.error = e.code === "EADDRINUSE" ? "port " + this.port + " is in use" : e.message; this.server = null; });
    this.server.listen(this.port, "0.0.0.0"); this.error = null;
    this.onOp = (op, who) => this.broadcastOp(op, who); this.engine.on("op", this.onOp);
    this.onPi = () => { this.clients.forEach((c) => { if (c.role === "admin") this.sendJson(c.ws, { type: "pi", names: this.engine.pi.names }); }); this.viewsSoon(); }; this.engine.on("pi", this.onPi);
    this.onState = () => { this.clients.forEach((c) => { if (c.role === "admin") this.sendJson(c.ws, { type: "state", state: this.engine.state }); }); this.viewsSoon(); }; this.engine.on("state", this.onState);
    this.meterTimer = setInterval(() => this.meters(), 100);
    if (this.talk) {
      this.onTalkers = (list) => { this.clients.forEach((c) => { if (c.role === "admin") this.sendJson(c.ws, { type: "talkers", talkers: list }); }); this.talkNotes(); };
      this.onDesk = (d) => { this.clients.forEach((c) => { if (c.role === "admin" && c.key !== d.key && isDesk(c.cuRole, c.jobs) && c.ws.readyState === 1 && c.ws.bufferedAmount < 64 * 1024) c.ws.send(d.buf); }); };
      this.talk.on("talkers", this.onTalkers); this.talk.on("desk", this.onDesk);
    }
    return this.status();
  }
  talkNotes() {   // each user: who is talking into their mix right now
    if (!this.talk) return;
    this.clients.forEach((c) => {
      if (c.role !== "user") return;
      const m = this.engine.state.mixes.findIndex((q) => q.ownerId && q.ownerId === c.id), names = m >= 0 ? this.talk.heardBy(m) : [], key = names.join("|");
      if (key !== (c.talkNote || "")) { c.talkNote = key; this.sendJson(c.ws, { type: "talking", names }); }
    });
  }
  stop() {
    clearInterval(this.meterTimer); if (this.onTalkers) { this.talk.off("talkers", this.onTalkers); this.talk.off("desk", this.onDesk); this.onTalkers = null; }
    this.clients.forEach((c) => { if (this.talk) this.talk.stop(c.key); });
    if (this.onOp) { this.engine.off("op", this.onOp); this.engine.off("pi", this.onPi); this.engine.off("state", this.onState); this.onOp = null; }
    this.clients.forEach((c) => { this.unlistenAll(c); try { c.ws.terminate(); } catch (_) { } }); this.clients.clear();
    if (this.wss) { try { this.wss.close(); } catch (_) { } this.wss = null; }
    if (this.server) { try { this.server.close(); } catch (_) { } this.server = null; }
  }
  http(req, res) {
    const u = new URL(req.url, "http://x"), f = FILES[u.pathname];
    if (u.pathname === "/api/info") { res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }); return res.end(JSON.stringify({ app: "central-usage", name: this.cfg().name, port: this.port })); }
    if (u.pathname.startsWith("/fonts/") && !f) { const name = path.basename(u.pathname); const p = path.join(this.appDir, "fonts", name); if (/^[\w.-]+\.woff2$/.test(name) && fs.existsSync(p)) { res.writeHead(200, { "Content-Type": "font/woff2", "Cache-Control": "max-age=86400" }); return fs.createReadStream(p).pipe(res); } }
    if (!f) { res.writeHead(404); return res.end("not found"); }
    fs.readFile(path.join(this.appDir, f[0]), (err, data) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200, { "Content-Type": f[1], "Cache-Control": "no-store" }); res.end(data); });
  }
  connection(ws, req) {
    const c = { ws, role: null, id: null, name: "", mix: null, listening: new Map(), address: req.socket.remoteAddress, fails: 0, key: "ws" + (++this.keys), cuRole: "", jobs: [], talkOnly: false };
    this.clients.set(ws, c);
    const hello = setTimeout(() => { if (!c.role) ws.close(); }, 15000);
    ws.on("message", (data, bin) => { if (bin) { if (c.role && this.talk) this.talk.audio(c.key, data); return; } let m; try { m = JSON.parse(data.toString()); } catch (_) { return; } this.message(c, m); });
    ws.on("close", () => { clearTimeout(hello); this.unlistenAll(c); if (this.talk) this.talk.stop(c.key); this.clients.delete(ws); this.emitClients(); });
    ws.on("error", () => { });
  }
  who(c, m) { if (m.cuRole != null) c.cuRole = String(m.cuRole).slice(0, 10); if (Array.isArray(m.jobs)) c.jobs = m.jobs.slice(0, 8).map(String); }
  deskCount(except) { let n = this.localDesk ? (this.localDesk() ? 1 : 0) : 0; this.clients.forEach((c) => { if (c !== except && c.role === "admin" && isDesk(c.cuRole, c.jobs)) n++; }); return n; }
  admins(o) { this.clients.forEach((c) => { if (c.role === "admin" && !c.talkOnly) this.sendJson(c.ws, o); }); }
  sendJson(ws, o) { if (ws.readyState === 1) ws.send(JSON.stringify(o)); }
  live() { return this.engine.pi.live; }
  message(c, m) {
    const cfg = this.cfg();
    if (m.type === "hello") {
      const role = m.role === "admin" ? "admin" : "user", want = role === "admin" ? cfg.adminCode : cfg.userCode;
      if (String(m.code || "") !== String(want || "")) { if (++c.fails > 5) c.ws.close(); return this.sendJson(c.ws, { type: "refused", error: role === "admin" ? "Wrong admin code (the audio host shows it in Settings)." : "Wrong in-ear code (ask the sound desk: it is on the audio host's In-ears tab)." }); }
      c.role = role; c.id = String(m.id || "").slice(0, 40) || "anon-" + Math.random().toString(36).slice(2, 8); c.name = String(m.name || "").slice(0, 40) || (role === "admin" ? "Admin" : "Someone");
      c.talkOnly = !!m.talkOnly; this.who(c, m);
      this.sendJson(c.ws, { type: "welcome", role, host: cfg.name, state: role === "admin" ? this.engine.state : M.forUser(this.engine.state, c.id, this.live()), pi: this.engine.pi.names, engine: this.engine.info() });
      if (this.talk && role === "admin") this.sendJson(c.ws, { type: "talkers", talkers: this.talk.list() });
      if (this.recorder && role === "admin") this.sendJson(c.ws, { type: "recState", state: this.recorder.state() });
      c.talkNote = null; if (role === "user") this.talkNotes();
      this.emitClients(); return;
    }
    if (!c.role) return;
    if (m.type === "who") { this.who(c, m); return; }   // its role / jobs changed (the desk hears the users' talkback)
    if (m.type === "recorder" && c.role === "admin" && this.recorder) {   // an admin elsewhere starts / stops the recording here
      const done = (st, err) => this.sendJson(c.ws, { type: "recState", state: st, error: err || null, seq: m.seq });
      const job = m.action === "start" ? this.recorder.start({ name: m.name }) : m.action === "stop" ? this.recorder.stop() : Promise.resolve(this.recorder.state());
      job.then((st) => done(st), (e) => done(this.recorder.state(), e.message)); return;
    }
    if (m.type === "talk" && this.talk) {   // { on, kind: "inears" | "desk", targets: { all, mixes }, dim }
      const r = m.on ? this.talk.start(c.key, m, { role: c.role, name: c.name }) : this.talk.stop(c.key);
      if (m.on && r.ok && r.talker.kind === "desk") r.receivers = this.deskCount(c);
      this.sendJson(c.ws, Object.assign({ type: "talkAck", on: !!m.on, seq: m.seq }, r)); return;
    }
    if (m.type === "op" && m.op) {
      const ok = this.engine.apply(m.op, { role: c.role, id: c.id });
      if (!ok) this.sendJson(c.ws, { type: "refused", op: m.op.op, error: c.role === "user" ? "Only your own mix can be changed." : "Nothing changed." });
      return;
    }
    if (m.type === "listen") {   // { tap: "main" | mix index, on, rate: 48000 | 24000, mono }
      const tap = m.tap === "main" ? 0 : (Number(m.tap) | 0) + 1;
      if (c.role === "user" && m.on) { const q = this.engine.state.mixes[tap - 1]; if (!q || q.ownerId !== c.id) return this.sendJson(c.ws, { type: "refused", error: "Pick your mix first." }); if (!q.local) return this.sendJson(c.ws, { type: "refused", error: "This mix goes to a wired in-ear pack - the sound desk can also send it to your device." }); }
      if (m.on) this.listen(c, tap, { rate: m.rate === 24000 ? 24000 : 48000, mono: !!m.mono }); else this.unlisten(c, tap);
      this.emitClients(); return;
    }
  }
  listen(c, tap, opt) {
    this.unlisten(c, tap);
    const ws = c.ws, fn = (pcm, frames) => {
      if (ws.readyState !== 1 || ws.bufferedAmount > 256 * 1024) return;   // a slow Wi-Fi client skips rather than drifts behind
      let data = pcm, ch = 2, n = frames, rate = 48000;
      if (opt.rate === 24000 || opt.mono) {
        const src = new Int16Array(pcm.buffer, pcm.byteOffset, frames * 2), step = opt.rate === 24000 ? 2 : 1; ch = opt.mono ? 1 : 2; n = Math.floor(frames / step); rate = 48000 / step;
        const out = new Int16Array(n * ch);
        for (let f = 0; f < n; f++) { let l = 0, r = 0; for (let k = 0; k < step; k++) { l += src[(f * step + k) * 2]; r += src[(f * step + k) * 2 + 1]; } l /= step; r /= step; if (ch === 1) out[f] = (l + r) / 2; else { out[f * 2] = l; out[f * 2 + 1] = r; } }
        data = Buffer.from(out.buffer);
      }
      const h = Buffer.alloc(12); h.write("IEA1", 0, "latin1"); h[4] = tap; h[5] = ch; h.writeUInt16LE(n, 6); h.writeUInt32LE(rate, 8);
      ws.send(Buffer.concat([h, data]));
    };
    c.listening.set(tap, fn); this.engine.tap(tap, fn, true);
  }
  unlisten(c, tap) { const fn = c.listening.get(tap); if (fn) { this.engine.tap(tap, fn, false); c.listening.delete(tap); } }
  unlistenAll(c) { [...c.listening.keys()].forEach((t) => this.unlisten(c, t)); }
  broadcastOp(op, who) {
    this.clients.forEach((c) => { if (c.role === "admin") this.sendJson(c.ws, { type: "op", op, by: who && who.id }); });
    // a user's mix stopped being theirs: stop its audio
    if (op.op === "release" || op.op === "claim" || op.op === "mix") this.clients.forEach((c) => { if (c.role === "user") c.listening.forEach((fn, tap) => { if (tap >= 1) { const q = this.engine.state.mixes[tap - 1]; if (!q || q.ownerId !== c.id || !q.local) this.unlisten(c, tap); } }); });
    this.viewsSoon();
  }
  viewsSoon() { clearTimeout(this.viewTimer); this.viewTimer = setTimeout(() => { this.clients.forEach((c) => { if (c.role === "user" && !c.talkOnly) this.sendJson(c.ws, { type: "view", state: M.forUser(this.engine.state, c.id, this.live()) }); }); this.talkNotes(); }, 80); }
  meters() {
    const e = this.engine.meters; if (!e || !this.clients.size) return;
    const extra = this.extra();
    this.clients.forEach((c) => {
      if (!c.role || c.talkOnly || c.ws.bufferedAmount > 128 * 1024) return;
      if (c.role === "admin") this.sendJson(c.ws, { type: "meters", in: e.in, gr: e.gr, mix: e.mix, main: e.main, net: e.net, bands: e.bands, onsets: e.onsets, xruns: e.xruns, extra });
      else {
        const view = M.forUser(this.engine.state, c.id, this.live()), mine = view.mixes.find((q) => q.mine);
        this.sendJson(c.ws, { type: "meters", in: view.inputs.map((x) => Math.round((e.in[x.i] || 0) * 1000) / 1000), mine: mine ? [e.mix[mine.m * 2], e.mix[mine.m * 2 + 1]] : null });
      }
    });
  }
  emitClients() { if (this.onClients) this.onClients(this.status()); }
}
module.exports = { Host };
