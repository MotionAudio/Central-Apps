/* Central Usage - talkback: the TALK button.
 *  Admins (the main admin, and admins with the Mix, In-ears or General job): TALK on the In-ears and Mix tabs and a
 *    compact one in the top bar. Hold to talk; a quick tap latches it on (tap again: off). Who hears it: All, or
 *    chosen in-ear mixes (by their names / who has them), remembered on this computer; optionally the music in
 *    their ears dims while you talk (-12 dB unless changed).
 *    The mic: on the audio host an input of the interface / Dante, or this computer's own mic (the Mic setting);
 *    on another admin computer its own mic, sent to the audio host over the network (48 kHz mono, 10 ms frames).
 *  Users (User 1 / User 2): "Talk to the sound desk" - only the desk's headphones hear it (the main admin's and the
 *    Mix admins' listen output), never anyone's in-ears.
 *  While talking this screen shows a red ON AIR; the receivers' in-ear screens show "🎙 <name> talking".
 *  The desk (this computer, if it is the main admin or has the Mix / General job) plays the users' talkback on its
 *  listen output (the Mix tab's "Listen here" device).
 * window.CUTalk: state(), on(kind), off(), targets(), setTargets({ all, mixes }), setDim({ on, db }), render() */
(function () {
  "use strict";
  var CU = window.CentralUsage, IE = window.CUInEar, NAT = window.CU, X = window.CUMix; if (!CU || !IE) return;
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var TAP_MS = 300, RATE = 48000, CHUNK = 480;   // a tap shorter than this latches; 10 ms mic frames

  // ------------------------------------------------------------------ who may talk
  function jobs() { return CU.jobs ? CU.jobs() : ["general"]; }
  function canTalk() { var r = CU.role(); if (r === "main") return true; if (r !== "admin") return false; var j = jobs(); return j.indexOf("general") >= 0 || j.indexOf("mix") >= 0 || j.indexOf("inears") >= 0; }
  function isUser() { var r = CU.role(); return r === "user1" || r === "user2"; }
  function isDesk() { var r = CU.role(); if (r === "main") return true; if (r !== "admin") return false; var j = jobs(); return j.indexOf("general") >= 0 || j.indexOf("mix") >= 0; }
  function kindHere() { return canTalk() ? "inears" : isUser() ? "desk" : null; }
  function myName() { return (CU.config() || {}).name || CU.store.get("name", "") || (isUser() ? "Someone" : "Sound desk"); }
  function micAllowed() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext !== false; }

  // ------------------------------------------------------------------ settings (this computer)
  var prefs = { targets: CU.store.get("tbTargets", { all: true, mixes: [] }), dim: CU.store.get("tbDim", { on: true, db: -12 }), mic: CU.store.get("tbMic", "mic"), micDev: CU.store.get("tbMicDev", "") };
  function save() { CU.store.set("tbTargets", prefs.targets); CU.store.set("tbDim", prefs.dim); CU.store.set("tbMic", prefs.mic); CU.store.set("tbMicDev", prefs.micDev); }
  function targets() { return prefs.targets.all ? { all: true, mixes: [] } : { all: false, mixes: (prefs.targets.mixes || []).slice() }; }
  function mixLabel(m) { var s = X && X.state, q = s && s.mixes[m]; return "Mix " + (m + 1) + (q ? " · " + (q.owner || q.name) : ""); }
  function targetText() { var t = targets(); if (t.all) return "everyone"; if (!t.mixes.length) return "nobody yet - pick mixes"; return t.mixes.map(mixLabel).join(", "); }

  // ------------------------------------------------------------------ the way to the audio host
  var acks = {}, seq = 0;
  function onAck(m) { var w = acks[m.seq]; if (w) { delete acks[m.seq]; w(m); } }
  if (X) X.on("talkAck", onAck);
  function linkWay(link) {
    return {
      local: false,
      start: function (o) {
        return new Promise(function (resolve) {
          var t0 = Date.now();
          (function go() {
            if (!link.connected()) { if (Date.now() - t0 > 4000) return resolve({ ok: false, error: "Not connected to the audio host." }); return setTimeout(go, 100); }
            var s = ++seq; acks[s] = resolve; link.send(Object.assign({ type: "talk", on: true, seq: s }, o));
            setTimeout(function () { if (acks[s]) { delete acks[s]; resolve({ ok: false, error: "The audio host did not answer." }); } }, 4000);
          })();
        });
      },
      audio: function (pcm) { link.sendBinary(IE.talkFrame(pcm, RATE)); },
      stop: function () { link.send({ type: "talk", on: false }); }
    };
  }
  var localWay = NAT && NAT.talk ? { local: true, start: function (o) { return NAT.talk.start(o); }, audio: function (pcm) { NAT.talk.audio(new Uint8Array(IE.talkFrame(pcm, RATE))); }, stop: function () { return NAT.talk.stop(); } } : null;
  // users: a small connection of their own to the audio host (the in-ear code), made on the first talk
  var ulink = null, ulinkKey = "";
  function userLink() {
    var addr = X ? X.hostAddress() : CU.store.get("hostAddr", ""), code = CU.store.get("userCode", "");
    if (!addr || !code) return null;
    if (ulink && ulinkKey === addr + "|" + code) return ulink;
    if (ulink) ulink.close();
    ulinkKey = addr + "|" + code;
    ulink = IE.link({ url: "ws://" + addr + "/ws", role: "user", code: code, id: IE.deviceId(), name: myName(), hello: { talkOnly: true } });
    ulink.on("talkAck", onAck); ulink.on("refused", function (err) { if (T.on) fail(err); });
    return ulink;
  }
  function way(kind) {
    if (kind === "inears") { if (!X) return null; if (X.kind === "local") return localWay; if (X.kind === "remote" && X.link()) return linkWay(X.link()); return null; }
    if (X && X.kind === "local" && localWay) return localWay;   // (an admin on the audio host talking to the desk)
    if (X && X.kind === "remote" && X.link()) return linkWay(X.link());
    var l = userLink(); return l ? linkWay(l) : null;
  }
  function useInput(kind) { return kind === "inears" && X && X.kind === "local" && /^in:\d+$/.test(prefs.mic); }

  // ------------------------------------------------------------------ the microphone (48 kHz mono, 10 ms frames)
  var mic = { ctx: null, stream: null, node: null, sp: null, sending: false, closeTimer: 0, level: 0, frames: 0, opening: null };
  var workletSrc = "(" + function (CHUNK) {
    class TalkCap extends AudioWorkletProcessor {
      constructor() { super(); this.buf = new Int16Array(CHUNK); this.n = 0; this.peak = 0; }
      process(inputs) {
        var i = inputs[0], ch = i && i[0]; if (!ch) return true;
        for (var k = 0; k < ch.length; k++) { var v = ch[k]; if (i.length > 1) v = (v + i[1][k]) / 2; if (v > 1) v = 1; else if (v < -1) v = -1; var a = v < 0 ? -v : v; if (a > this.peak) this.peak = a; this.buf[this.n++] = v * 32767; if (this.n === CHUNK) { this.port.postMessage({ pcm: this.buf, peak: this.peak }, [this.buf.buffer]); this.buf = new Int16Array(CHUNK); this.n = 0; this.peak = 0; } }
        return true;
      }
    }
    registerProcessor("cu-talk-cap", TalkCap);
  }.toString() + ")(" + CHUNK + ");";
  function onMicFrame(pcm, peak) { mic.level = Math.max(peak, mic.level * 0.8); mic.frames++; if (mic.sending && T.way) T.way.audio(pcm); }
  async function micOpen() {
    clearTimeout(mic.closeTimer);
    if (mic.ctx) return;
    if (mic.opening) return mic.opening;
    mic.opening = (async function () {
      if (!micAllowed()) throw new Error("This page can't use the microphone (it needs the Central Usage app).");
      var a = { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }; if (prefs.micDev) a.deviceId = { exact: prefs.micDev };
      var stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: a }); } catch (e) { if (prefs.micDev) stream = await navigator.mediaDevices.getUserMedia({ audio: true }); else throw e; }
      var ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: RATE, latencyHint: "interactive" });
      var src = ctx.createMediaStreamSource(stream), sink = ctx.createGain(); sink.gain.value = 0; sink.connect(ctx.destination);
      var node = null;
      if (ctx.audioWorklet) {
        try {
          await ctx.audioWorklet.addModule("data:text/javascript;charset=utf-8," + encodeURIComponent(workletSrc));
          node = new AudioWorkletNode(ctx, "cu-talk-cap", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
          node.port.onmessage = function (e) { onMicFrame(e.data.pcm, e.data.peak); };
          src.connect(node); node.connect(sink);
        } catch (_) { node = null; }
      }
      if (!node) {   // (no AudioWorklet: a ScriptProcessor, in 10 ms pieces)
        var sp = ctx.createScriptProcessor(1024, 1, 1), acc = new Int16Array(CHUNK), n = 0, pk = 0;
        sp.onaudioprocess = function (e) { var d = e.inputBuffer.getChannelData(0); for (var k = 0; k < d.length; k++) { var v = Math.max(-1, Math.min(1, d[k])); pk = Math.max(pk, Math.abs(v)); acc[n++] = v * 32767; if (n === CHUNK) { onMicFrame(acc, pk); acc = new Int16Array(CHUNK); n = 0; pk = 0; } } };
        src.connect(sp); sp.connect(sink); mic.sp = sp;
      }
      if (ctx.state !== "running") { try { await ctx.resume(); } catch (_) { } }
      mic.ctx = ctx; mic.stream = stream; mic.node = node;
    })();
    try { await mic.opening; } finally { mic.opening = null; }
  }
  function micClose() { mic.sending = false; try { if (mic.stream) mic.stream.getTracks().forEach(function (t) { t.stop(); }); if (mic.ctx) mic.ctx.close(); } catch (_) { } mic.ctx = mic.stream = mic.node = mic.sp = null; mic.level = 0; }
  function micCloseSoon() { clearTimeout(mic.closeTimer); mic.closeTimer = setTimeout(function () { if (!T.on) micClose(); }, 15000); }   // (warm for a quick second press)

  // ------------------------------------------------------------------ talking
  var T = { on: false, latched: false, kind: null, way: null, err: "", note: "", key: null, since: 0, receivers: null };
  async function talkOn(kind) {
    if (T.on || !kind) return;
    T.on = true; T.latched = false; T.kind = kind; T.err = ""; T.note = ""; T.since = Date.now(); T.receivers = null; paint();
    var w = way(kind);
    if (!w) return fail(kind === "desk" ? "The audio host isn't found yet - set up your in-ear mix (In-ears tab) first." : X && X.error ? X.error : "Not connected to the audio host.");
    var input = useInput(kind);
    if (!input) { try { await micOpen(); } catch (e) { return fail("Microphone: " + (e && e.message || e)); } }
    if (!T.on) return;   // (let go while the mic opened)
    var r;
    try { r = await w.start({ kind: kind, targets: kind === "inears" ? targets() : undefined, dim: prefs.dim.on ? Number(prefs.dim.db) || -12 : 0, src: input ? "input" : "net", ch: input ? Number(prefs.mic.slice(3)) : 0, name: myName() }); }
    catch (e) { r = { ok: false, error: e.message }; }
    if (!T.on) { try { w.stop(); } catch (_) { } return; }
    if (!r || !r.ok) return fail((r && r.error) || "The audio host refused.");
    T.way = w; T.key = r.talker && r.talker.key; T.receivers = r.receivers == null ? null : r.receivers; mic.sending = !input;
    if (kind === "desk" && T.receivers === 0) T.note = "Nobody at the desk is connected right now.";
    paint();
  }
  function talkOff() {
    if (!T.on) return;
    var w = T.way; T.on = false; T.latched = false; T.way = null; mic.sending = false;
    if (w) { try { w.stop(); } catch (_) { } }
    micCloseSoon(); paint();
  }
  function fail(msg) { var w = T.way; T.on = false; T.latched = false; T.way = null; mic.sending = false; T.err = msg; if (w) { try { w.stop(); } catch (_) { } } micCloseSoon(); paint(); }

  // ------------------------------------------------------------------ hold to talk, a quick tap latches
  var press = { active: false, t0: 0, unlatch: false };
  function down(kind) { press.active = true; press.t0 = Date.now(); press.unlatch = T.on && T.latched; if (!T.on) talkOn(kind); }
  function up() {
    if (!press.active) return; press.active = false;
    if (press.unlatch) { talkOff(); return; }
    if (!T.on) return;
    if (Date.now() - press.t0 < TAP_MS) { T.latched = true; paint(); } else talkOff();
  }
  document.addEventListener("pointerdown", function (e) {
    var b = e.target.closest && e.target.closest("[data-tb-talk]"); if (!b || b.disabled || (e.button != null && e.button > 0)) return;
    e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (_) { }
    down(b.dataset.tbTalk);
  });
  document.addEventListener("pointerup", up); document.addEventListener("pointercancel", up);
  window.addEventListener("blur", function () { if (press.active && !T.latched) up(); });
  document.addEventListener("keydown", function (e) {   // keyboard: Space / Enter on the button switches it on / off
    var b = e.target.closest && e.target.closest("[data-tb-talk]"); if (!b || (e.key !== " " && e.key !== "Enter") || e.repeat) return;
    e.preventDefault(); if (T.on) talkOff(); else { talkOn(b.dataset.tbTalk); T.latched = true; }
  });

  // ------------------------------------------------------------------ who else is talking; the desk hears the users
  var talkers = [];
  function setTalkers(list) {
    talkers = list || [];
    // the audio host let go of this computer's talkback (no mic sound arrived for a while): not on air any more
    if (T.on && T.way && T.key && !talkers.some(function (t) { return t.key === T.key; })) return fail("The audio host stopped the talkback (no sound from the mic arrived).");
    paint();
  }
  if (NAT && NAT.talk) { NAT.talk.on(function (ev) { if (X && X.kind === "local") setTalkers(ev.talkers); }); }
  if (X) { X.on("talkers", function (list) { if (X.kind === "remote") setTalkers(list); }); X.on("state", function () { if (X.kind === "local" && NAT && NAT.talk) NAT.talk.state().then(function (s) { setTalkers(s.talkers); }).catch(function () { }); render(); }); }
  var desk = { player: null, timer: 0, frames: 0, from: "" };
  function deskAudio(pcm, frames, rate, name) {
    if (!isDesk()) return;
    desk.frames += frames; if (name) desk.from = name;
    if (!desk.player) { desk.player = IE.player({ latency: 60, sinkId: window.CUListen ? window.CUListen.sink() : "" }); desk.player.start(); paint(); }
    desk.player.push(pcm, frames, 1, rate || RATE);
    clearTimeout(desk.timer); desk.timer = setTimeout(function () { if (desk.player) desk.player.stop(); desk.player = null; paint(); }, 1500);
  }
  if (NAT && NAT.talk) NAT.talk.onDesk(function (pcm, frames, rate, name) { deskAudio(new Int16Array(new Uint8Array(pcm).buffer), frames, rate, name); });
  if (X) X.on("talkAudio", function (pcm, frames, rate) { if (X.kind === "remote") deskAudio(pcm, frames, rate); });
  function othersText() {
    return talkers.filter(function (t) { return !(T.on && T.key && t.key === T.key); }).map(function (t) { return "🎙 " + esc(t.name) + " → " + (t.kind === "desk" ? "the desk" : t.all ? "everyone" : t.mixes.map(function (m) { return "Mix " + (m + 1); }).join(", ")); }).join(" · ");
  }

  // ------------------------------------------------------------------ the buttons and panels
  function micOptions() {
    var h = '<option value="mic"' + (prefs.mic === "mic" ? " selected" : "") + ">This computer's mic</option>";
    if (X && X.kind === "local") {
      var st = X.hostStatus && X.hostStatus.engine && X.hostStatus.engine.status, names = st && st.captureNames || [];
      if (names.length) { h += '<optgroup label="Audio interface / Dante">'; names.forEach(function (n, k) { h += '<option value="in:' + k + '"' + (prefs.mic === "in:" + k ? " selected" : "") + ">Input " + (k + 1) + " · " + esc(String(n).replace(/^.*:/, "")) + "</option>"; }); h += "</optgroup>"; }
    }
    return h;
  }
  function adminPanel() {
    var s = X && X.state, t = targets(), mixes = s ? s.mixes : [];
    return '<div class="tb-row"><button class="tb-talk" data-tb-talk="inears" title="Hold to talk · a quick tap keeps it on (tap again to stop)">🎙 TALK</button>' +
      '<div class="tb-side"><div class="tb-line"><b>To</b><label class="toggle"><input type="checkbox" data-tb="all"' + (t.all ? " checked" : "") + '> All</label><button data-tb="pick" class="' + (t.all ? "" : "on") + '">' + (t.all ? "Choose…" : t.mixes.length + " chosen") + '</button><span class="tb-to muted small"></span></div>' +
      '<div class="tb-line"><label class="toggle"><input type="checkbox" data-tb="dim"' + (prefs.dim.on ? " checked" : "") + '> Dim the music in their ears</label><select data-tb="dimdb">' + [-6, -12, -18, -24].map(function (d) { return '<option value="' + d + '"' + (Number(prefs.dim.db) === d ? " selected" : "") + ">" + d + " dB</option>"; }).join("") + "</select>" +
      '<label>Mic <select data-tb="mic">' + micOptions() + '</select></label><select data-tb="micdev" title="Which microphone of this computer"' + (prefs.mic !== "mic" ? " hidden" : "") + '><option value="">Default microphone</option></select><span class="tb-level" title="Mic level"><i></i></span></div>' +
      '<div class="tb-line"><span class="tb-msg"></span><span class="tb-others muted small"></span></div></div></div>' +
      '<div class="tb-mixes"' + (t.all || !panelOpen ? " hidden" : "") + ">" + (mixes.length ? mixes.map(function (q, m) { var on = t.mixes.indexOf(m) >= 0; return '<label class="tb-mix' + (q.ownerId ? " owned" : "") + '"><input type="checkbox" data-tb-mix="' + m + '"' + (on ? " checked" : "") + "><b>" + (m + 1) + "</b><span>" + esc(q.owner || q.name) + "</span></label>"; }).join("") : '<span class="muted">No mixer yet.</span>') + "</div>";
  }
  function userPanel() {
    return '<div class="tb-row"><button class="tb-talk tb-desk" data-tb-talk="desk" title="Hold to talk · a quick tap keeps it on"' + (micAllowed() ? "" : " disabled") + '>🎙 Talk to the sound desk</button><div class="tb-side"><span class="tb-msg"></span><span class="tb-level" title="Mic level"><i></i></span>' +
      '<span class="muted small">Only the sound desk hears it' + (micAllowed() ? "" : " (on this phone the microphone needs the Central Usage app)") + ".</span></div></div>";
  }
  var panelOpen = false, structKey = "";
  function render() {
    var kind = kindHere(), s = X && X.state;
    var key = JSON.stringify([kind, s ? s.mixes.map(function (q) { return q.owner || q.name; }) : null, panelOpen, prefs.targets.all, X && X.kind, ((X && X.hostStatus && X.hostStatus.engine && X.hostStatus.engine.status) || {}).inputs, prefs.mic]);
    if (key !== structKey) {
      structKey = key;
      // the top bar
      var top = document.getElementById("tbTop");
      if (!kind) { if (top) top.remove(); }
      else {
        if (!top) { top = document.createElement("div"); top.id = "tbTop"; top.className = "tb-top"; var hdr = document.querySelector("header.top"), song = document.getElementById("songBox"); if (hdr) hdr.insertBefore(top, song || null); }
        top.innerHTML = '<button class="tb-talk tb-mini" data-tb-talk="' + kind + '" title="' + (kind === "desk" ? "Talk to the sound desk" : "Talkback") + ' - hold to talk, a quick tap keeps it on"' + (kind === "desk" && !micAllowed() ? " disabled" : "") + ">🎙 " + (kind === "desk" ? "Desk" : "TALK") + "</button>";
      }
      // the panels: In-ears (admins and users), Mix (admins)
      [["view-inears", "inearsRoot"], ["view-mix", "mixRoot"]].forEach(function (v) {
        var view = document.getElementById(v[0]), root = document.getElementById(v[1]); if (!view || !root) return;
        var p = view.querySelector(".tb-panel"), want = kind === "inears" || (kind === "desk" && v[0] === "view-inears");
        if (!want) { if (p) p.remove(); return; }
        if (!p) { p = document.createElement("div"); p.className = "tb-panel"; view.insertBefore(p, root); }
        p.classList.toggle("tb-user", kind === "desk"); p.innerHTML = kind === "desk" ? userPanel() : adminPanel();
      });
      fillMicDevices();
    }
    paint();
  }
  function fillMicDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices().then(function (list) {
      document.querySelectorAll('[data-tb="micdev"]').forEach(function (sel) {
        if (sel.options.length > 1) return;
        list.filter(function (d) { return d.kind === "audioinput" && d.deviceId !== "default" && d.deviceId !== "communications"; }).forEach(function (d) { var o = document.createElement("option"); o.value = d.deviceId; o.textContent = d.label || "Microphone " + d.deviceId.slice(0, 6); if (d.deviceId === prefs.micDev) o.selected = true; sel.appendChild(o); });
      });
    }).catch(function () { });
  }
  function paint() {
    var on = T.on, kind = T.kind || kindHere();
    document.querySelectorAll("[data-tb-talk]").forEach(function (b) {
      b.classList.toggle("onair", on); b.classList.toggle("latched", on && T.latched);
      var base = b.classList.contains("tb-mini") ? (b.dataset.tbTalk === "desk" ? "🎙 Desk" : "🎙 TALK") : b.dataset.tbTalk === "desk" ? "🎙 Talk to the sound desk" : "🎙 TALK";
      b.textContent = on ? (b.classList.contains("tb-mini") ? "● ON AIR" : "● ON AIR" + (T.latched ? " · tap to stop" : "")) : base;
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    document.body.classList.toggle("tb-onair", on);
    var banner = document.getElementById("tbOnAir");
    if (on) {
      if (!banner) { banner = document.createElement("div"); banner.id = "tbOnAir"; banner.className = "tb-banner"; banner.setAttribute("role", "status"); document.body.appendChild(banner); }
      banner.innerHTML = "<b>● ON AIR</b> <span>" + (kind === "desk" ? "talking to the sound desk" : "talking to " + esc(targetText()) + (prefs.dim.on ? " · their music " + Number(prefs.dim.db) + " dB" : "")) + (T.latched ? " · tap TALK to stop" : "") + "</span>";
    } else if (banner) banner.remove();
    var msg = T.err ? '<span class="bad">' + esc(T.err) + "</span>" : T.note ? '<span class="warn">' + esc(T.note) + "</span>" : on && !T.way ? '<span class="muted">connecting…</span>' : "";
    document.querySelectorAll(".tb-msg").forEach(function (el) { el.innerHTML = msg; });
    var others = othersText() + (desk.player ? (othersText() ? " · " : "") + "🔊 playing " + esc(desk.from || "a user") + "'s talkback here" : "");
    document.querySelectorAll(".tb-others").forEach(function (el) { el.innerHTML = others; });
    document.querySelectorAll(".tb-to").forEach(function (el) { el.textContent = targets().all ? "every in-ear mix" : targetText(); });
    // the panels' controls follow the settings (changed on the other tab's panel, or through CUTalk)
    var t = targets();
    document.querySelectorAll(".tb-panel").forEach(function (p) {
      var all = p.querySelector('[data-tb="all"]'); if (!all) return;
      all.checked = t.all;
      var pick = p.querySelector('[data-tb="pick"]'); pick.textContent = t.all ? "Choose…" : t.mixes.length + " chosen"; pick.classList.toggle("on", !t.all);
      p.querySelectorAll("[data-tb-mix]").forEach(function (c) { c.checked = !t.all && t.mixes.indexOf(Number(c.dataset.tbMix)) >= 0; });
      p.querySelector('[data-tb="dim"]').checked = !!prefs.dim.on; p.querySelector('[data-tb="dimdb"]').value = String(prefs.dim.db);
      var ms = p.querySelector('[data-tb="mic"]'); if (ms.value !== prefs.mic) ms.value = prefs.mic;
      var md = p.querySelector('[data-tb="micdev"]'); md.hidden = prefs.mic !== "mic";
    });
  }
  setInterval(function () { if (!mic.ctx) return; document.querySelectorAll(".tb-level i").forEach(function (i) { var d = mic.level > 0 ? 20 * Math.log10(mic.level) : -90; i.style.width = Math.max(0, Math.min(100, (d + 60) / 60 * 100)) + "%"; }); mic.level *= 0.7; }, 100);

  // ------------------------------------------------------------------ the panel's settings
  document.addEventListener("change", function (e) {
    var t = e.target; if (!t.closest || !t.closest(".tb-panel")) return;
    if (t.dataset.tb === "all") { prefs.targets.all = t.checked; if (!t.checked) panelOpen = true; }
    else if (t.dataset.tbMix != null) { var m = Number(t.dataset.tbMix), list = (prefs.targets.mixes || []).filter(function (x) { return x !== m; }); if (t.checked) list.push(m); list.sort(function (a, b) { return a - b; }); prefs.targets.mixes = list; prefs.targets.all = false; }
    else if (t.dataset.tb === "dim") prefs.dim.on = t.checked;
    else if (t.dataset.tb === "dimdb") prefs.dim.db = Number(t.value);
    else if (t.dataset.tb === "mic") { prefs.mic = t.value; }
    else if (t.dataset.tb === "micdev") { prefs.micDev = t.value; if (!T.on) micClose(); }
    else return;
    save(); render(); restartIfOn();
  });
  document.addEventListener("click", function (e) { var b = e.target.closest && e.target.closest('.tb-panel [data-tb="pick"]'); if (!b) return; panelOpen = !panelOpen; if (panelOpen && prefs.targets.all) { prefs.targets.all = false; save(); } render(); });
  function restartIfOn() { if (T.on && T.way && T.kind === "inears") { var latched = T.latched; T.way.start({ kind: "inears", targets: targets(), dim: prefs.dim.on ? Number(prefs.dim.db) || -12 : 0, src: useInput("inears") ? "input" : "net", ch: useInput("inears") ? Number(prefs.mic.slice(3)) : 0, name: myName() }); T.latched = latched; } }   // (who hears it changed mid-talk)

  // ------------------------------------------------------------------ keep in step with the role, the tabs and the mixer
  CU.on("role", function () { if (T.on && !kindHere()) talkOff(); render(); });
  CU.on("mode", function () { render(); });
  CU.on("tab", function () { setTimeout(render, 0); });
  CU.on("audioHost", function () { render(); });
  if (X) { X.on("op", function (op) { if (op && (op.op === "claim" || op.op === "release" || (op.op === "mix" && op.patch && op.patch.name != null))) render(); }); X.on("status", function () { render(); }); }
  setTimeout(render, 0);
  window.CUTalk = {
    state: function () { return { on: T.on, latched: T.latched, kind: T.kind, error: T.err, note: T.note, receivers: T.receivers, sending: mic.sending, micFrames: mic.frames, talkers: talkers.slice(), deskFrames: desk.frames, deskPlaying: !!desk.player, canTalk: canTalk(), isDesk: isDesk(), kindHere: kindHere() }; },
    on: function (kind) { return talkOn(kind || kindHere()); }, off: talkOff,
    targets: targets, setTargets: function (t) { prefs.targets = { all: !!t.all, mixes: (t.mixes || []).slice() }; save(); render(); restartIfOn(); },
    setDim: function (d) { prefs.dim = { on: !!d.on, db: d.db == null ? -12 : Number(d.db) }; save(); render(); },
    setMic: function (m) { prefs.mic = m; save(); render(); }, render: render
  };
})();
