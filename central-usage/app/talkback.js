/* Central Control - talkback.
 *  The main admin has two groups to talk to, picked next to its TALK button:
 *    🎸 Band        every device in the Band (users start there)
 *    🎬 Production  every device in Production (admins start there: lighting, cameras, slides, mix…)
 *  The main admin puts each device in one of them on the Devices tab. A device with an in-ear mix of its own hears
 *  the main admin in that mix (the audio host mixes it in, the music can dim); any other device of the group plays
 *  it on its headphones (the "Listen here" output), sent through the main admin's computer (the center).
 *  Everyone else - the lighting admin's mic, another admin, a musician - talks to the main admin's headphones only.
 *  Hold to talk; a quick tap latches it on (tap again: off). While talking this screen shows a red ON AIR.
 * window.CUTalk: state(), on(kind), off(), group(), setGroup(g), targets(), setTargets({ all, mixes }) (a custom set
 *   of in-ear mixes instead of a group), setDim({ on, db }), setMic(m), render() */
(function () {
  "use strict";
  var CU = window.CentralUsage, IE = window.CUInEar, NAT = window.CU, X = window.CUMix; if (!CU || !IE) return;
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var TAP_MS = 300, RATE = 48000, CHUNK = 480;   // a tap shorter than this latches; 10 ms mic frames

  // ------------------------------------------------------------------ who may talk
  function jobs() { return CU.jobs ? CU.jobs() : ["general"]; }
  function canTalk() { return CU.role() === "main"; }   // to the Band / Production: the main admin only
  function isUser() { var r = CU.role(); return r === "user1" || r === "user2"; }
  function isDesk() { return CU.role() === "main"; }     // everyone's talkback ends up in the main admin's headphones
  function kindHere() { var r = CU.role(); return r === "main" ? "group" : r ? "main" : null; }
  var GROUPS = { band: "Band", production: "Production" }, GICON = { band: "🎸", production: "🎬" };
  function mainName() { var v = window.CURoles && window.CURoles.view(); return (v && v.mainName) || "the main admin"; }
  function myName() { return (CU.config() || {}).name || CU.store.get("name", "") || (isUser() ? "Someone" : "Sound desk"); }
  function micAllowed() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext !== false; }

  // ------------------------------------------------------------------ settings (this computer)
  var prefs = { group: CU.store.get("tbGroup", "band"), targets: CU.store.get("tbTargets", { all: true, mixes: [] }), dim: CU.store.get("tbDim", { on: true, db: -12 }), mic: CU.store.get("tbMic", "mic"), micDev: CU.store.get("tbMicDev", "") };
  function save() { CU.store.set("tbGroup", prefs.group); CU.store.set("tbTargets", prefs.targets); CU.store.set("tbDim", prefs.dim); CU.store.set("tbMic", prefs.mic); CU.store.set("tbMicDev", prefs.micDev); }
  function targets() { return prefs.targets.all ? { all: true, mixes: [] } : { all: false, mixes: (prefs.targets.mixes || []).slice() }; }
  function mixLabel(m) { var s = X && X.state, q = s && s.mixes[m]; return "Mix " + (m + 1) + (q ? " · " + (q.owner || q.name) : ""); }
  function targetText() { if (prefs.group !== "custom") return "the " + GROUPS[prefs.group]; var t = targets(); if (t.all) return "every in-ear mix"; if (!t.mixes.length) return "nobody yet - pick mixes"; return t.mixes.map(mixLabel).join(", "); }
  // who is in a group now: those with an in-ear mix of their own hear it in that mix, the others on their headphones
  function groupPlan(g) {
    var v = (window.CURoles && window.CURoles.view()) || {}, members = (v.devices || []).filter(function (d) { return d.online && d.role !== "pedal" && d.talkGroup === g; });
    var mixes = (X && X.state && X.state.mixes) || [], plan = { mixes: [], owners: [], play: [], names: [] };
    members.forEach(function (d) {
      plan.names.push(d.name);
      var m = -1; mixes.forEach(function (q, k) { if (m < 0 && q.ownerId === d.id) m = k; });
      if (m >= 0) { plan.mixes.push(m); plan.owners.push(d.id); } else plan.play.push(d.id);
    });
    return plan;
  }
  // the center (the main admin's computer) carries talkback that is not mixed into in-ears
  var cseq = 0, cwait = {};
  CU.on("message", function (m) { if (m.type === "talkReply" && cwait[m.seq]) { var f = cwait[m.seq]; delete cwait[m.seq]; f(m); } });
  function centerWay(o) {
    var C = window.CUCenter;
    return {
      center: true,
      start: function () {
        return new Promise(function (resolve) {
          if (!C || !C.connected()) return resolve({ ok: false, error: "Not connected to the main admin's computer." });
          var s2 = ++cseq; cwait[s2] = resolve; C.send(Object.assign({ type: "talk", on: true, seq: s2, name: myName() }, o));
          setTimeout(function () { if (cwait[s2]) { delete cwait[s2]; resolve({ ok: false, error: "The main admin's computer did not answer." }); } }, 4000);
        });
      },
      audio: function (pcm) { C && C.sendBinary(IE.talkFrame(pcm, RATE)); },
      stop: function () { if (C) C.send({ type: "talk", on: false }); }
    };
  }

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
  function onMicFrame(pcm, peak) { mic.level = Math.max(peak, mic.level * 0.8); mic.frames++; if (mic.sending && T.ways.length) sendFrame(pcm); }
  async function micOpen() {
    clearTimeout(mic.closeTimer);
    if (mic.ctx) return;
    if (mic.opening) return mic.opening;
    mic.opening = (async function () {
      if (!micAllowed()) throw new Error("This page can't use the microphone (it needs the Central Control app).");
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
  var T = { on: false, latched: false, kind: null, ways: [], err: "", note: "", key: null, since: 0, receivers: null, to: "" };
  async function talkOn(kind) {
    if (T.on || !kind) return;
    T.on = true; T.latched = false; T.kind = kind; T.err = ""; T.note = ""; T.since = Date.now(); T.receivers = null; T.ways = []; T.key = null; paint();
    var plan = [], dim = prefs.dim.on ? Number(prefs.dim.db) || -12 : 0;
    if (kind === "main") {
      plan.push({ w: centerWay({ to: "main" }) }); T.to = mainName();
    } else if (kind === "group" && prefs.group === "custom") {   // (chosen in-ear mixes)
      var wc = way("inears"); if (!wc) return fail(X && X.error ? X.error : "Not connected to the audio host.");
      plan.push({ w: wc, o: { kind: "inears", targets: targets(), dim: dim } }); T.to = targetText();
    } else {
      var g = prefs.group === "production" ? "production" : "band", gp = groupPlan(g), wi = gp.mixes.length ? way("inears") : null;
      if (gp.mixes.length && !wi) gp.play = gp.play.concat(gp.owners);   // (no audio host: everyone through the center)
      if (wi && gp.mixes.length) plan.push({ w: wi, o: { kind: "inears", targets: { all: false, mixes: gp.mixes }, dim: dim } });
      if (gp.play.length) plan.push({ w: centerWay({ to: "group", group: g, devices: gp.play }) });
      T.to = "the " + GROUPS[g] + (gp.names.length ? " (" + gp.names.join(", ") + ")" : "");
      if (!plan.length) return fail("Nobody in the " + GROUPS[g] + " is online. Put devices in it on the Devices tab.");
    }
    var input = plan.length === 1 && !plan[0].w.center && useInput("inears");
    if (!input) { try { await micOpen(); } catch (e) { return fail("Microphone: " + (e && e.message || e)); } }
    if (!T.on) return;   // (let go while the mic opened)
    var started = [], errors = [], rec = 0;
    for (var k = 0; k < plan.length; k++) {
      var p = plan[k], r;
      try { r = await p.w.start(p.o ? Object.assign({ src: input ? "input" : "net", ch: input ? Number(prefs.mic.slice(3)) : 0, name: myName() }, p.o) : undefined); } catch (e) { r = { ok: false, error: e.message }; }
      if (r && r.ok) { started.push(p.w); if (!p.w.center && r.talker) T.key = r.talker.key; if (r.receivers != null) rec += r.receivers; else if (!p.w.center) rec += p.o.targets.all ? 1 : p.o.targets.mixes.length; }
      else errors.push((r && r.error) || "refused");
    }
    if (!T.on) { started.forEach(function (w) { try { w.stop(); } catch (_) { } }); return; }
    if (!started.length) return fail(errors[0] || "Nobody could be reached.");
    T.ways = started; T.receivers = rec; mic.sending = !input;
    if (errors.length) T.note = "Not everyone: " + errors[0];
    else if (kind === "main" && rec === 0) T.note = mainName() + " is not connected right now.";
    paint();
  }
  function sendFrame(pcm) { T.ways.forEach(function (w) { try { w.audio(pcm); } catch (_) { } }); }
  function talkOff() {
    if (!T.on) return;
    var ws = T.ways; T.on = false; T.latched = false; T.ways = []; mic.sending = false;
    ws.forEach(function (w) { try { w.stop(); } catch (_) { } });
    micCloseSoon(); paint();
  }
  function fail(msg) { var ws = T.ways; T.on = false; T.latched = false; T.ways = []; mic.sending = false; T.err = msg; ws.forEach(function (w) { try { w.stop(); } catch (_) { } }); micCloseSoon(); paint(); }

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
    if (T.on && T.ways.length && T.key && !talkers.some(function (t) { return t.key === T.key; })) return fail("The audio host stopped the talkback (no sound from the mic arrived).");
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
  // talkback through the center: to the main admin (from anyone), or from the main admin to this device's group
  var incoming = {}, heard = { frames: 0 };
  CU.on("message", function (m) {
    if (m.type !== "talkFrom") return;
    if (m.on) incoming[m.id] = { name: m.name, group: m.group, kind: m.kind, player: (incoming[m.id] || {}).player || null, timer: 0 };
    else if (incoming[m.id]) { var x = incoming[m.id]; if (x.player) x.player.stop(); clearTimeout(x.timer); delete incoming[m.id]; }
    paint();
  });
  CU.on("centerTalk", function (a) {
    var x = incoming[a.id] || (incoming[a.id] = { name: "Someone", player: null, timer: 0 });
    heard.frames += a.frames;
    if (!x.player) { x.player = IE.player({ latency: 60, sinkId: window.CUListen ? window.CUListen.sink() : "" }); x.player.start(); paint(); }
    x.player.push(a.pcm, a.frames, 1, a.rate || RATE);
    clearTimeout(x.timer); x.timer = setTimeout(function () { if (x.player) x.player.stop(); x.player = null; paint(); }, 1500);
  });
  function incomingText() {
    return Object.keys(incoming).filter(function (k) { return incoming[k].player || incoming[k].kind; }).map(function (k) { var x = incoming[k]; return "🔊 " + esc(x.name) + (x.kind === "group" ? " → the " + esc(GROUPS[x.group] || "group") : " talking to you"); }).join(" · ");
  }
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
  function groupButtons(mini) {
    return '<span class="tb-groups' + (mini ? " mini" : "") + '" role="radiogroup" aria-label="Talk to">' + ["band", "production"].map(function (g) {
      var n = groupPlan(g).names.length;
      return '<button data-tb-group="' + g + '" role="radio" aria-checked="' + (prefs.group === g) + '" class="' + (prefs.group === g ? "on" : "") + '">' + GICON[g] + " " + GROUPS[g] + (mini ? "" : ' <small>' + n + " online</small>") + "</button>";
    }).join("") + "</span>";
  }
  function adminPanel() {
    var gp = groupPlan(prefs.group === "production" ? "production" : "band");
    return '<div class="tb-row"><button class="tb-talk" data-tb-talk="group" title="Hold to talk · a quick tap keeps it on (tap again to stop)">🎙 TALK</button>' +
      '<div class="tb-side"><div class="tb-line"><b>To</b>' + groupButtons(false) + '<span class="tb-to muted small"></span></div>' +
      '<div class="tb-line muted small">' + (gp.names.length ? esc(gp.names.join(", ")) + (gp.mixes.length ? " · " + gp.mixes.length + " hear it in their in-ear mix" : "") + (gp.play.length ? " · " + gp.play.length + " on their headphones" : "") : "Nobody in this group is online - put devices in it on the Devices tab.") + "</div>" +
      '<div class="tb-line"><label class="toggle"><input type="checkbox" data-tb="dim"' + (prefs.dim.on ? " checked" : "") + '> Dim the music in their in-ears</label><select data-tb="dimdb">' + [-6, -12, -18, -24].map(function (d) { return '<option value="' + d + '"' + (Number(prefs.dim.db) === d ? " selected" : "") + ">" + d + " dB</option>"; }).join("") + "</select>" +
      '<label>Mic <select data-tb="mic">' + micOptions() + '</select></label><select data-tb="micdev" title="Which microphone of this computer"' + (prefs.mic !== "mic" ? " hidden" : "") + '><option value="">Default microphone</option></select><span class="tb-level" title="Mic level"><i></i></span></div>' +
      '<div class="tb-line"><span class="tb-msg"></span><span class="tb-others muted small"></span></div></div></div>';
  }
  function userPanel() {
    return '<div class="tb-row"><button class="tb-talk tb-desk" data-tb-talk="main" title="Hold to talk · a quick tap keeps it on"' + (micAllowed() ? "" : " disabled") + '>🎙 Talk to ' + esc(mainName()) + '</button><div class="tb-side"><span class="tb-msg"></span><span class="tb-level" title="Mic level"><i></i></span>' +
      '<span class="muted small">Only the main admin hears it, in their headphones' + (micAllowed() ? "" : " (on this phone the microphone needs the Central Control app)") + '.</span><span class="tb-others muted small"></span></div></div>';
  }
  var panelOpen = false, structKey = "";
  function render() {
    var kind = kindHere(), s = X && X.state;
    var gb = kind === "group" ? ["band", "production"].map(function (g) { return groupPlan(g).names.join(","); }) : null;
    var key = JSON.stringify([kind, s ? s.mixes.map(function (q) { return (q.owner || q.name) + (q.ownerId || ""); }) : null, panelOpen, prefs.group, X && X.kind, ((X && X.hostStatus && X.hostStatus.engine && X.hostStatus.engine.status) || {}).inputs, prefs.mic, gb, mainName()]);
    if (key !== structKey) {
      structKey = key;
      // the top bar
      var top = document.getElementById("tbTop");
      if (!kind) { if (top) top.remove(); }
      else {
        if (!top) { top = document.createElement("div"); top.id = "tbTop"; top.className = "tb-top"; var hdr = document.querySelector("header.top"), song = document.getElementById("songBox"); if (hdr) hdr.insertBefore(top, song || null); }
        top.innerHTML = (kind === "group" ? groupButtons(true) : "") + '<button class="tb-talk tb-mini" data-tb-talk="' + kind + '" title="' + (kind === "main" ? "Talk to " + esc(mainName()) : "Talk to the " + (GROUPS[prefs.group] || "chosen mixes")) + ' - hold to talk, a quick tap keeps it on"' + (kind === "main" && !micAllowed() ? " disabled" : "") + ">🎙 " + (kind === "main" ? "Main admin" : "TALK") + "</button>";
      }
      // the panels: In-ears (admins and users), Mix (admins)
      [["view-inears", "inearsRoot"], ["view-mix", "mixRoot"]].forEach(function (v) {
        var view = document.getElementById(v[0]), root = document.getElementById(v[1]); if (!view || !root) return;
        var p = view.querySelector(".tb-panel"), want = kind === "group" || (kind === "main" && v[0] === "view-inears");
        if (!want) { if (p) p.remove(); return; }
        if (!p) { p = document.createElement("div"); p.className = "tb-panel"; view.insertBefore(p, root); }
        p.classList.toggle("tb-user", kind === "main"); p.innerHTML = kind === "main" ? userPanel() : adminPanel();
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
      var base = b.classList.contains("tb-mini") ? (b.dataset.tbTalk === "main" ? "🎙 Main admin" : "🎙 TALK") : b.dataset.tbTalk === "main" ? "🎙 Talk to " + mainName() : "🎙 TALK";
      b.textContent = on ? (b.classList.contains("tb-mini") ? "● ON AIR" : "● ON AIR" + (T.latched ? " · tap to stop" : "")) : base;
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    document.body.classList.toggle("tb-onair", on);
    var banner = document.getElementById("tbOnAir");
    if (on) {
      if (!banner) { banner = document.createElement("div"); banner.id = "tbOnAir"; banner.className = "tb-banner"; banner.setAttribute("role", "status"); document.body.appendChild(banner); }
      banner.innerHTML = "<b>● ON AIR</b> <span>" + (kind === "main" ? "talking to " + esc(mainName()) : "talking to " + esc(T.to || targetText())) + (T.latched ? " · tap TALK to stop" : "") + "</span>";
    } else if (banner) banner.remove();
    var msg = T.err ? '<span class="bad">' + esc(T.err) + "</span>" : T.note ? '<span class="warn">' + esc(T.note) + "</span>" : on && !T.ways.length ? '<span class="muted">connecting…</span>' : "";
    document.querySelectorAll(".tb-msg").forEach(function (el) { el.innerHTML = msg; });
    var others = [othersText(), desk.player ? "🔊 playing " + esc(desk.from || "a user") + "'s talkback here" : "", incomingText()].filter(Boolean).join(" · ");
    var hb = document.getElementById("tbHeard"), inc = incomingText();
    if (inc && !on) { if (!hb) { hb = document.createElement("div"); hb.id = "tbHeard"; hb.className = "tb-banner tb-heard"; hb.setAttribute("role", "status"); document.body.appendChild(hb); } hb.innerHTML = inc; }
    else if (hb) hb.remove();
    document.querySelectorAll(".tb-others").forEach(function (el) { el.innerHTML = others; });
    document.querySelectorAll(".tb-to").forEach(function (el) { el.textContent = ""; });
    document.querySelectorAll("[data-tb-group]").forEach(function (b) { var on2 = b.dataset.tbGroup === prefs.group; b.classList.toggle("on", on2); b.setAttribute("aria-checked", on2 ? "true" : "false"); });
    // the panels' controls follow the settings (changed on the other tab's panel, or through CUTalk)
    var t = targets();
    document.querySelectorAll(".tb-panel").forEach(function (p) {
      if (!p.querySelector('[data-tb="dim"]')) return;
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
  document.addEventListener("click", function (e) { var b = e.target.closest && e.target.closest("[data-tb-group]"); if (!b) return; setGroup(b.dataset.tbGroup); });
  function setGroup(g) { if (!GROUPS[g] && g !== "custom") return; if (prefs.group === g) return; prefs.group = g; save(); structKey = ""; render(); restartIfOn(); }
  function restartIfOn() { if (T.on && T.kind === "group") { var latched = T.latched; talkOff(); talkOn("group").then(function () { T.latched = latched; paint(); }); } }   // (who hears it changed mid-talk)

  // ------------------------------------------------------------------ keep in step with the role, the tabs and the mixer
  CU.on("role", function () { if (T.on && !kindHere()) talkOff(); render(); });
  CU.on("message", function (m) { if (m.type === "cuRoles") render(); });
  CU.on("mode", function () { render(); });
  CU.on("tab", function () { setTimeout(render, 0); });
  CU.on("audioHost", function () { render(); });
  if (X) { X.on("op", function (op) { if (op && (op.op === "claim" || op.op === "release" || (op.op === "mix" && op.patch && op.patch.name != null))) render(); }); X.on("status", function () { render(); }); }
  setTimeout(render, 0);
  window.CUTalk = {
    state: function () { return { on: T.on, latched: T.latched, kind: T.kind, error: T.err, note: T.note, receivers: T.receivers, sending: mic.sending, micFrames: mic.frames, talkers: talkers.slice(), heardFrames: heard.frames, incoming: Object.keys(incoming).map(function (k) { return { id: k, name: incoming[k].name, kind: incoming[k].kind, group: incoming[k].group, playing: !!incoming[k].player }; }), to: T.to, deskFrames: desk.frames, deskPlaying: !!desk.player, canTalk: canTalk(), isDesk: isDesk(), kindHere: kindHere() }; },
    on: function (kind) { return talkOn(kind || kindHere()); }, off: talkOff,
    group: function () { return prefs.group; }, setGroup: setGroup,
    targets: targets, setTargets: function (t) { prefs.targets = { all: !!t.all, mixes: (t.mixes || []).slice() }; prefs.group = "custom"; save(); render(); restartIfOn(); },
    setDim: function (d) { prefs.dim = { on: !!d.on, db: d.db == null ? -12 : Number(d.db) }; save(); render(); },
    setMic: function (m) { prefs.mic = m; save(); render(); }, render: render
  };
})();
