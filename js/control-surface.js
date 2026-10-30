/* Central apps - controls you teach the app: MIDI footswitches, pedals, knobs, sliders and keyboard keys.
 * Shared by the Central Pedal / Central Pedal Control app and Central Control / Central Usage (copied into
 * central-usage/app/shared by prepare-shared.sh).
 *
 *   CCSurface.parse(data, port)        a MIDI message -> {msg: note|noteoff|cc|pc|pitch, channel, number, value, port}
 *   CCSurface.learner(kind)            the Learn steps for a button, knob or slider (feed it messages / keys)
 *   CCSurface.match(spec, evt)         a learned control + a message -> {event: press|release} or {value: 0..1}
 *   CCSurface.matchKey(spec, e, down)  the same for a computer key
 *   CCSurface.learn(opts)              the Learn window: what kind, its name, then press / turn / slide it
 *   CCSurface.feedMidi(data, port)     hosts pass every MIDI message here first (true = the Learn window took it)
 *   CCSurface.midi                     one place for every MIDI device (Web MIDI): ports, subscribe, send - the
 *                                      studio and the controls both use it, so several devices just work
 *   CCSurface.feedback(spec, on)       lights a learned button's LED (note / CC back to the same device)
 *
 * A learned control:  { kind: "button"|"knob"|"slider", midi: {msg, number, channel, port, lo, hi, onHigh} }
 *                 or  { kind: "button", key: {code, ctrl, shift, alt, meta} }
 * lo / hi are where the knob or slider sat at each end while it was learned (a knob that sends 127 at the left
 * end just works backwards). Old controls ({type: note|cc|pc, number, channel}) still match. */
(function (root) {
  "use strict";
  var W = typeof window !== "undefined" ? window : root;

  // ------------------------------------------------------------- messages
  function parse(data, port) {
    if (!data || data.length < 1) return null;
    var st = data[0] & 0xF0, ch = (data[0] & 0x0F) + 1, a = data.length > 1 ? data[1] : 0, b = data.length > 2 ? data[2] : 0, p = port || "";
    if (st === 0x90 && b > 0) return { msg: "note", channel: ch, number: a, value: b, port: p };
    if (st === 0x80 || (st === 0x90 && b === 0)) return { msg: "noteoff", channel: ch, number: a, value: 0, port: p };
    if (st === 0xB0) return { msg: "cc", channel: ch, number: a, value: b, port: p };
    if (st === 0xC0) return { msg: "pc", channel: ch, number: a, value: 127, port: p };
    if (st === 0xE0) return { msg: "pitch", channel: ch, number: 0, value: a | (b << 7), port: p };
    return null;
  }
  function maxOf(m) { return m === "pitch" ? 16383 : 127; }
  // an old control ({type, number, channel}) as a new one
  function norm(mi) {
    if (!mi) return null;
    if (mi.msg) return mi;
    return { msg: mi.type === "note" ? "note" : mi.type === "pc" ? "pc" : "cc", number: mi.number || 0, channel: mi.channel || 0, port: "", lo: 0, hi: 127, onHigh: true };
  }
  function samePort(want, got) { return !want || !got || shortPort(want) === shortPort(got); }
  // "nanoKONTROL2:nanoKONTROL2 MIDI 1 20:0" and "nanoKONTROL2 MIDI 1" are the same device
  function shortPort(n) { n = String(n || "").replace(/ \(out\)$/, "").replace(/\s+\d+:\d+$/, ""); var i = n.indexOf(":"); return (i > 0 && n.slice(i + 1).trim() ? n.slice(i + 1).trim() : n).toLowerCase(); }

  function clamp01(v) { return v <= 0 ? 0 : v > 1 ? 1 : v; }
  function match(spec, evt) {
    var mi = norm(spec && spec.midi); if (!mi || !evt) return null;
    if (mi.channel && evt.channel !== mi.channel) return null;
    if (!samePort(mi.port, evt.port)) return null;
    var button = !spec.kind || spec.kind === "button";
    if (mi.msg === "note") {
      if ((evt.msg !== "note" && evt.msg !== "noteoff") || evt.number !== mi.number) return null;
      if (button) return { event: evt.msg === "note" ? "press" : "release" };
      return { value: evt.msg === "note" ? clamp01(evt.value / 127) : 0 };
    }
    if (mi.msg === "pc") return evt.msg === "pc" && evt.number === mi.number ? { event: "tap" } : null;
    if (mi.msg === "cc" || mi.msg === "pitch") {
      if (evt.msg !== mi.msg || (mi.msg === "cc" && evt.number !== mi.number)) return null;
      var top = maxOf(mi.msg);
      if (button) { var high = evt.value >= top / 2; return { event: high === (mi.onHigh !== false) ? "press" : "release" }; }
      var lo = mi.lo == null ? 0 : mi.lo, hi = mi.hi == null ? top : mi.hi;
      if (lo === hi) return { value: evt.value > lo ? 1 : 0 };
      return { value: clamp01((evt.value - lo) / (hi - lo)) };
    }
    return null;
  }

  // ------------------------------------------------------------- the computer keyboard
  var MOD_KEYS = { Shift: 1, Control: 1, Alt: 1, Meta: 1, AltGraph: 1, CapsLock: 1 };
  function keyOf(e) { return { code: e.code || e.key, ctrl: !!e.ctrlKey, shift: !!e.shiftKey, alt: !!e.altKey, meta: !!e.metaKey }; }
  function typing(e) { var t = e && e.target; return !!(t && t.matches && (t.matches("input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]), select, textarea") || t.isContentEditable)); }
  function matchKey(spec, e, down) {
    var k = spec && spec.key; if (!k || !e) return null;
    if ((e.code || e.key) !== k.code) return null;
    if (down && (!!e.ctrlKey !== !!k.ctrl || !!e.shiftKey !== !!k.shift || !!e.altKey !== !!k.alt || !!e.metaKey !== !!k.meta)) return null;
    return { event: down ? "press" : "release" };
  }
  function keyLabel(k) {
    if (!k) return "";
    var c = String(k.code || ""), n = c.replace(/^Key/, "").replace(/^Digit/, "").replace(/^Numpad/, "Num ").replace(/^Arrow/, "Arrow ");
    if (c === "Space") n = "Space bar";
    return (k.ctrl ? "Ctrl+" : "") + (k.alt ? "Alt+" : "") + (k.shift ? "Shift+" : "") + (k.meta ? "Cmd+" : "") + n;
  }
  function describe(spec) {
    if (!spec) return "";
    if (spec.key) return "Key " + keyLabel(spec.key);
    var mi = norm(spec.midi); if (!mi) return "";
    var what = mi.msg === "note" ? "note " + mi.number : mi.msg === "pc" ? "program " + (mi.number + 1) : mi.msg === "pitch" ? "pitch wheel" : "CC " + mi.number;
    return "MIDI " + what + (mi.channel ? " · ch " + mi.channel : "") + (mi.port ? " · " + shortPort(mi.port).replace(/(^|\s)\S/g, function (s) { return s.toUpperCase(); }) : "");
  }

  // ------------------------------------------------------------- the Learn steps
  // kind button: one step (press it). knob: left, then right. slider: down, then up.
  // feed({midi: evt}) or feed({key: e}) -> {state: "wait"|"moving"|"next"|"done"|"hint", spec?, value?}
  // A knob / slider step finishes when it has moved and then stays put for a moment (or when you press Next).
  var STEPS = { button: ["press"], knob: ["left", "right"], slider: ["down", "up"] };
  var PROMPT = {
    press: "Press it once.",
    left: "Turn it all the way to the left.", right: "Now turn it all the way to the right.",
    down: "Slide it all the way down.", up: "Now slide it all the way up."
  };
  function learner(kind, opts) {
    opts = opts || {};
    kind = STEPS[kind] ? kind : "button";
    var steps = STEPS[kind], i = 0, ctl = null, ends = [], last = null, moved = 0, still = opts.stillMs || 700, timer = null, onAuto = null;
    function step() { return steps[i]; }
    function same(evt) { return ctl && evt.msg === ctl.msg && evt.channel === ctl.channel && (ctl.msg === "pitch" || evt.number === ctl.number) && samePort(ctl.port, evt.port); }
    function finishStep() {
      if (last == null) return { state: "wait" };
      if (i === 1 && Math.abs(last - ends[0]) < maxOf(ctl.msg) * 0.15) { moved = 0; return { state: "hint", text: kind === "knob" ? "Turn it further - all the way to the right." : "Slide it further - all the way up." }; }
      ends[i] = last; i++; moved = 0;
      if (i < steps.length) return { state: "next", step: step(), prompt: PROMPT[step()] };
      return { state: "done", spec: { kind: kind, midi: { msg: ctl.msg, number: ctl.number, channel: ctl.channel, port: ctl.port || "", lo: ends[0], hi: ends[1] } } };
    }
    function arm() { clearTimeout(timer); if (!onAuto) return; timer = setTimeout(function () { var r = finishStep(); onAuto(r); }, still); }
    return {
      kind: kind, steps: steps,
      step: step, prompt: function () { return PROMPT[step()]; }, index: function () { return i; },
      onAuto: function (fn) { onAuto = fn; },
      next: function () { clearTimeout(timer); return finishStep(); },
      stop: function () { clearTimeout(timer); onAuto = null; },
      feed: function (ev) {
        if (kind === "button") {
          if (ev.key) {
            if (!opts.keys || MOD_KEYS[ev.key.key]) return { state: "wait" };
            return { state: "done", spec: { kind: "button", key: keyOf(ev.key) } };
          }
          var e = ev.midi; if (!e) return { state: "wait" };
          if (e.msg === "note") return { state: "done", spec: { kind: "button", midi: { msg: "note", number: e.number, channel: e.channel, port: e.port || "" } } };
          if (e.msg === "pc") return { state: "done", spec: { kind: "button", midi: { msg: "pc", number: e.number, channel: e.channel, port: e.port || "" } } };
          if (e.msg === "cc") return { state: "done", spec: { kind: "button", midi: { msg: "cc", number: e.number, channel: e.channel, port: e.port || "", onHigh: e.value >= 64 } } };
          return { state: "wait" };
        }
        var m = ev.midi; if (!m || (m.msg !== "cc" && m.msg !== "pitch")) return { state: "wait" };
        if (!ctl) ctl = { msg: m.msg, number: m.number, channel: m.channel, port: m.port || "" };
        if (!same(m)) return { state: "wait" };
        last = m.value; moved++; arm();
        return { state: "moving", value: m.value / maxOf(m.msg), raw: m.value };
      }
    };
  }

  // ------------------------------------------------------------- one MIDI hub for the whole app (Web MIDI)
  var hub = { access: null, subs: [], portSubs: [], ins: [], outs: [], asked: false };
  function midiStart() {
    if (hub.asked) return Promise.resolve(hub.access);
    hub.asked = true;
    if (!W.navigator || !W.navigator.requestMIDIAccess) return Promise.resolve(null);
    return W.navigator.requestMIDIAccess({ sysex: false }).then(function (access) {
      hub.access = access;
      function attach() {
        hub.ins = []; hub.outs = [];
        access.inputs.forEach(function (input) { hub.ins.push({ id: input.id, name: input.name }); input.onmidimessage = function (e) { var data = e.data; hub.subs.slice().forEach(function (fn) { try { fn(data, input.name, e.timeStamp, input.id); } catch (err) { console.warn("midi listener", err); } }); }; });
        access.outputs.forEach(function (o) { hub.outs.push({ id: o.id, name: o.name }); });
        hub.portSubs.slice().forEach(function (fn) { try { fn(hub.ins.slice(), hub.outs.slice()); } catch (_) { } });
      }
      access.onstatechange = attach; attach();
      return access;
    }).catch(function () { return null; });
  }
  var midi = {
    start: midiStart,
    available: function () { return !!(W.navigator && W.navigator.requestMIDIAccess); },
    inputs: function () { return hub.ins.slice(); },
    outputs: function () { return hub.outs.slice(); },
    subscribe: function (fn) { hub.subs.push(fn); return function () { hub.subs = hub.subs.filter(function (f) { return f !== fn; }); }; },
    onPorts: function (fn) { hub.portSubs.push(fn); return function () { hub.portSubs = hub.portSubs.filter(function (f) { return f !== fn; }); }; },
    send: function (portName, data) {
      if (!hub.access) return false; var want = shortPort(portName), sent = false;
      hub.access.outputs.forEach(function (o) { if (!want || shortPort(o.name) === want) { try { o.send(data); sent = true; } catch (_) { } } });
      return sent;
    },
    shortPort: shortPort
  };

  // ------------------------------------------------------------- LEDs on the controller
  var ledSent = {}, ledOut = null;
  function feedbackData(spec, on) {
    var mi = norm(spec && spec.midi); if (!mi) return null;
    var ch = Math.max(0, (mi.channel || 1) - 1);
    if (mi.msg === "note") return [0x90 | ch, mi.number, on ? 127 : 0];
    if (mi.msg === "cc") return [0xB0 | ch, mi.number, on ? 127 : 0];
    return null;
  }
  function feedback(spec, on, id) {
    var data = feedbackData(spec, on); if (!data) return false;
    var k = id || JSON.stringify(spec.midi); if (ledSent[k] === !!on) return false; ledSent[k] = !!on;
    if (ledOut) return ledOut(spec.midi.port || "", data);
    return midi.send(spec.midi.port || "", data);
  }

  // ------------------------------------------------------------- the Learn window
  var active = null;   // the open Learn window's learner + its update function
  function feedMidi(data, port) {
    if (!active) return false;
    var e = parse(data, port); if (!e || e.msg === "noteoff") return !!(e && active.learner.kind === "button");
    active.take({ midi: e });
    return true;
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var CSS = ".cs-learn{max-width:min(520px,94vw);width:520px;border:1px solid var(--line,#343a44);border-radius:16px;background:var(--panel,#1a1d22);color:var(--text,#ece7dd);padding:20px}" +
    ".cs-learn::backdrop{background:rgba(0,0,0,.55)}.cs-learn h3{margin:0 0 4px;font-size:18px}.cs-learn p{margin:6px 0}.cs-learn .cs-sub{color:var(--muted,#9aa1ab);font-size:13px}" +
    ".cs-kinds{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:14px 0}.cs-kinds button{display:grid;gap:6px;justify-items:center;padding:14px 8px;border-radius:12px;font-weight:600}" +
    ".cs-kinds svg{width:44px;height:44px;stroke:currentColor;fill:none;stroke-width:2}.cs-kinds small{font-weight:400;color:var(--muted,#9aa1ab)}" +
    ".cs-big{font-size:20px;font-weight:650;margin:16px 0 8px}.cs-meter{height:14px;border-radius:7px;background:var(--well,#0e1013);border:1px solid var(--line,#343a44);overflow:hidden}" +
    ".cs-meter i{display:block;height:100%;width:0;background:var(--accent,#e2c27e);transition:width .05s}.cs-got{color:var(--ok,#6fcf97);font-weight:600}.cs-hint{color:var(--warn,#f5cf72)}" +
    ".cs-dots{display:flex;gap:6px;margin:4px 0 10px}.cs-dots i{width:8px;height:8px;border-radius:50%;background:var(--line,#343a44)}.cs-dots i.on{background:var(--accent,#e2c27e)}" +
    ".cs-row{display:flex;gap:8px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap}.cs-name{width:100%;font-size:16px;padding:8px 10px;margin-top:8px}" +
    ".cs-pulse{animation:csPulse 1.2s ease-in-out infinite}@keyframes csPulse{50%{opacity:.45}}@media (prefers-reduced-motion:reduce){.cs-pulse{animation:none}}";
  var ICONS = {
    button: '<svg viewBox="0 0 48 48"><rect x="8" y="22" width="32" height="18" rx="4"/><circle cx="24" cy="18" r="7"/></svg>',
    knob: '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="15"/><path d="M24 24 L24 11"/><path d="M9 38 l4-4 M39 38 l-4-4"/></svg>',
    slider: '<svg viewBox="0 0 48 48"><path d="M24 6 V42"/><rect x="15" y="20" width="18" height="9" rx="3"/></svg>'
  };
  var KIND_TEXT = { button: ["Button", "footswitch, pad, key"], knob: ["Knob", "turns left and right"], slider: ["Slider", "fader or expression pedal"] };
  // opts: {kinds: ["button","knob","slider"], kind, name, keys (allow computer keys), title, defaultName(kind), onOpen, onClose}
  // resolves {kind, name, spec} or null
  function learn(opts) {
    opts = opts || {};
    var D = W.document; if (!D) return Promise.resolve(null);
    if (!D.getElementById("csLearnCss")) { var s = D.createElement("style"); s.id = "csLearnCss"; s.textContent = CSS; D.head.appendChild(s); }
    if (active) active.close(null);
    return new Promise(function (resolve) {
      var d = D.createElement("dialog"); d.className = "cs-learn"; D.body.appendChild(d);
      var kinds = (opts.kinds || ["button", "knob", "slider"]).filter(function (k) { return STEPS[k]; });
      var st = { kind: opts.kind || (kinds.length === 1 ? kinds[0] : null), name: opts.name || "", phase: opts.kind || kinds.length === 1 ? (opts.name ? "learn" : "name") : "kind", got: null, hint: "", value: null, lr: null };
      function defName(k) { return opts.defaultName ? opts.defaultName(k) : KIND_TEXT[k][0]; }
      function draw() {
        var html = "";
        if (st.phase === "kind") {
          html = "<h3>" + esc(opts.title || "Add a control") + '</h3><p class="cs-sub">What kind of control is it?</p><div class="cs-kinds">' +
            kinds.map(function (k) { return '<button data-cs-kind="' + k + '">' + ICONS[k] + KIND_TEXT[k][0] + "<small>" + KIND_TEXT[k][1] + "</small></button>"; }).join("") + "</div>" +
            '<div class="cs-row"><button data-cs="cancel">Cancel</button></div>';
        } else if (st.phase === "name") {
          html = "<h3>Name it</h3><p class=\"cs-sub\">Something you'll recognise later, like \"Left footswitch\" or \"Pad volume knob\".</p>" +
            '<input class="cs-name" data-cs="name" maxlength="40" value="' + esc(st.name || defName(st.kind)) + '">' +
            '<div class="cs-row"><button data-cs="cancel">Cancel</button>' + (opts.kind ? "" : '<button data-cs="back">Back</button>') + '<button class="primary" data-cs="toName">Next</button></div>';
        } else if (st.phase === "learn") {
          var L = st.lr, n = L.steps.length;
          html = "<h3>" + esc(st.name) + '</h3><div class="cs-dots">' + L.steps.map(function (_, k) { return '<i class="' + (k <= L.index() ? "on" : "") + '"></i>'; }).join("") + "</div>" +
            '<p class="cs-big cs-pulse">' + esc(L.prompt()) + "</p>" +
            (st.kind === "button" ? '<p class="cs-sub">On your MIDI pedal or controller' + (opts.keys ? ", or a key on this computer's keyboard" : "") + ".</p>" :
              '<div class="cs-meter"><i style="width:' + Math.round((st.value || 0) * 100) + '%"></i></div><p class="cs-sub">' + (st.value == null ? "Waiting for it to move…" : "Got it moving. Hold it there for a second.") + "</p>") +
            (st.hint ? '<p class="cs-hint">' + esc(st.hint) + "</p>" : "") +
            '<div class="cs-row"><button data-cs="cancel">Cancel</button>' + (st.kind !== "button" && st.value != null ? '<button data-cs="next">' + (L.index() === n - 1 ? "Done" : "Next") + "</button>" : "") + "</div>";
        } else if (st.phase === "done") {
          html = "<h3>" + esc(st.name) + '</h3><p class="cs-big cs-got">Learned it.</p><p>' + esc(describe(st.got)) + "</p>" +
            '<div class="cs-row"><button data-cs="again">Learn it again</button><button class="primary" data-cs="save">Save</button></div>';
        }
        d.innerHTML = html;
        var inp = d.querySelector("[data-cs=name]"); if (inp) { inp.focus(); inp.select(); }
      }
      function startLearn() {
        st.phase = "learn"; st.value = null; st.hint = ""; st.got = null;
        st.lr = learner(st.kind, { keys: !!opts.keys });
        st.lr.onAuto(function (r) { onResult(r); });
        draw();
      }
      function onResult(r) {
        if (!r) return;
        if (r.state === "moving") { st.value = r.value; st.hint = ""; var bar = d.querySelector(".cs-meter i"); if (bar && d.querySelector("[data-cs=next]")) { bar.style.width = Math.round(r.value * 100) + "%"; return; } draw(); return; }
        if (r.state === "hint") { st.hint = r.text; draw(); return; }
        if (r.state === "next") { st.value = null; st.hint = ""; draw(); return; }
        if (r.state === "done") { st.lr.stop(); st.got = r.spec; st.phase = "done"; draw(); }
      }
      var me = {
        learner: { get kind() { return st.lr ? st.lr.kind : null; } },
        take: function (ev) { if (st.phase === "learn" && st.lr) onResult(st.lr.feed(ev)); },
        close: function (v) { if (st.lr) st.lr.stop(); D.removeEventListener("keydown", onKey, true); if (active === me) active = null; try { d.close(); } catch (_) { } d.remove(); if (opts.onClose) opts.onClose(); resolve(v); },
        state: function () { return st; }
      };
      function onKey(e) {
        if (st.phase !== "learn") return;
        if (e.key === "Escape") { e.preventDefault(); me.close(null); return; }
        if (st.kind === "button" && opts.keys && !MOD_KEYS[e.key]) { e.preventDefault(); e.stopPropagation(); me.take({ key: e }); }
      }
      D.addEventListener("keydown", onKey, true);
      d.addEventListener("cancel", function (e) { e.preventDefault(); me.close(null); });
      d.addEventListener("click", function (e) {
        var b = e.target.closest && e.target.closest("button"); if (!b) return;
        if (b.dataset.csKind) { st.kind = b.dataset.csKind; st.phase = "name"; draw(); return; }
        var a = b.dataset.cs;
        if (a === "cancel") me.close(null);
        else if (a === "back") { st.phase = "kind"; draw(); }
        else if (a === "toName") { var v = (d.querySelector("[data-cs=name]") || {}).value; st.name = String(v || "").trim() || defName(st.kind); startLearn(); }
        else if (a === "next") onResult(st.lr.next());
        else if (a === "again") startLearn();
        else if (a === "save") me.close({ kind: st.kind, name: st.name, spec: st.got });
      });
      d.addEventListener("keydown", function (e) { if (e.key === "Enter" && st.phase === "name") { e.preventDefault(); var b = d.querySelector("[data-cs=toName]"); if (b) b.click(); } });
      active = me;
      if (st.phase === "learn") startLearn(); else draw();
      try { d.showModal(); } catch (_) { d.setAttribute("open", ""); }
      if (opts.onOpen) opts.onOpen(me);
    });
  }

  W.CCSurface = {
    parse: parse, match: match, matchKey: matchKey, keyOf: keyOf, keyLabel: keyLabel, typing: typing, describe: describe, norm: norm,
    learner: learner, learn: learn, feedMidi: feedMidi, learning: function () { return !!active; }, active: function () { return active; },
    midi: midi, feedback: feedback, feedbackData: feedbackData, setLedOut: function (fn) { ledOut = fn; ledSent = {}; }, resetLeds: function () { ledSent = {}; },
    shortPort: shortPort, PROMPT: PROMPT
  };
  if (typeof module === "object" && module.exports) module.exports = W.CCSurface;
})(this);
