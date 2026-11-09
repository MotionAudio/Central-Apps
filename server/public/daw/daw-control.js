/* The DAW - MIDI and foot controls (10.6): any pad, button, knob, fader or footswitch on a MIDI controller (or a
 * Central Pedal / footswitch sending MIDI) runs the transport and the mix.
 *   CDawControl.ACTIONS                 [[id, label, kind]]   kind: "press" (a button / footswitch) or "level" (a knob / fader)
 *   CDawControl.bindings()              { actionId: { type: "note" | "cc", ch, num, device } }
 *   CDawControl.learn(id) -> Promise    the next message moved/pressed is kept for that action
 *   CDawControl.clear(id) / clearAll()
 *   CDawControl.handle(midiMessage)     true when the message was a control (the DAW doesn't play it as a note)
 * Kept on this computer (localStorage). A footswitch that sends CC 64/127 when pressed and 0 when let go works as a
 * button (it acts on the press). */
(function () {
  "use strict";
  var D = window.CDaw; if (!D) return;
  var KEY = "cdaw-controls";
  var ACTIONS = [
    ["play", "Play / stop", "press"], ["stop", "Stop (and back)", "press"], ["rec", "Record", "press"], ["home", "To the start", "press"],
    ["loop", "Loop on / off", "press"], ["click", "Click on / off", "press"], ["prev", "Previous section", "press"], ["next", "Next section", "press"],
    ["marker", "Add a section here", "press"], ["undo", "Undo", "press"], ["redo", "Redo", "press"], ["tap", "Tap the tempo", "press"],
    ["vol", "Volume of the selected track", "level"], ["pan", "Pan of the selected track", "level"], ["master", "Master volume", "level"]];
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (_) { return {}; } }
  function save(b) { try { localStorage.setItem(KEY, JSON.stringify(b)); } catch (_) { } }
  var binds = load(), learning = null, lastVal = {};

  function parse(m) {
    var d = m.data || [], st = d[0] & 0xF0, ch = d[0] & 0x0F;
    if (st === 0x90 && d[2] > 0) return { type: "note", ch: ch, num: d[1], value: d[2], on: true };
    if (st === 0x80 || (st === 0x90 && d[2] === 0)) return { type: "note", ch: ch, num: d[1], value: 0, on: false };
    if (st === 0xB0) return { type: "cc", ch: ch, num: d[1], value: d[2] };
    if (st === 0xC0) return { type: "pc", ch: ch, num: d[1], value: 127, on: true };
    return null;
  }
  function same(b, e) { return b && e && b.type === e.type && b.ch === e.ch && b.num === e.num; }
  function label(b) { if (!b) return "-"; return (b.type === "note" ? "Note " + b.num : b.type === "cc" ? "CC " + b.num : "Program " + b.num) + " · ch " + (b.ch + 1) + (b.device ? " · " + b.device : ""); }

  function sectionsInOrder() { return (D.project().markers || []).slice().sort(function (a, z) { return a.beat - z.beat; }); }
  function run(id, value) {
    var UI = window.CDawUI, p = D.project();
    if (id === "prev" || id === "next") {
      var pos = D.position ? D.position() : 0, ms = sectionsInOrder(), target = null;
      if (id === "next") target = ms.filter(function (m) { return m.beat > pos + 0.01; })[0];
      else { var before = ms.filter(function (m) { return m.beat < pos - 0.5; }); target = before[before.length - 1] || ms[0]; }
      if (target) { D.setPos(target.beat); if (UI) UI.say("▸ " + target.name); }
      return;
    }
    if (id === "marker") {
      var at = D.snapBeat(D.position ? D.position() : 0, "bar"), names = ["Intro", "Verse", "Pre-chorus", "Chorus", "Bridge", "Tag", "Outro"];
      D.edit("Add section", function (q) { q.markers = q.markers || []; q.markers.push({ id: D.uid("m"), beat: at, name: names[q.markers.length % names.length] }); });
      return;
    }
    if (id === "vol" || id === "pan") {
      var t = UI && UI.track ? UI.track() : null; if (!t) return;
      var v = id === "vol" ? Math.round((value / 127 * 66 - 60) * 10) / 10 : Math.round((value / 127 * 2 - 1) * 100) / 100;
      D.nudge(id === "vol" ? "Volume" : "Pan", function () { var x = D.track(t.id); if (!x) return; if (id === "vol") x.volume = value === 0 ? -96 : v; else x.pan = v; });
      return;
    }
    if (id === "master") { var mv = value === 0 ? -96 : Math.round((value / 127 * 66 - 60) * 10) / 10; D.nudge("Master volume", function (q) { q.master.volume = mv; }); return; }
    if (UI && UI.action) UI.action(id);
    else if (id === "play") D.toggle(); else if (id === "stop") D.stop({ back: true }); else if (id === "rec") D.record(); else if (id === "home") D.setPos(0);
  }

  function handle(m) {
    var e = parse(m); if (!e) return false;
    if (learning) {
      if (e.type === "note" && !e.on) return true;           // wait for the press
      if (e.type === "cc" && learning.kind === "press" && e.value < 64) return true;
      var b = { type: e.type, ch: e.ch, num: e.num, device: m.device && m.device.name || "" };
      // one control does one thing
      Object.keys(binds).forEach(function (k) { if (same(binds[k], b)) delete binds[k]; });
      binds[learning.id] = b; save(binds);
      var done = learning; learning = null; done.resolve(b);
      return true;
    }
    var hit = null;
    for (var i = 0; i < ACTIONS.length && !hit; i++) { var a = ACTIONS[i], b2 = binds[a[0]]; if (same(b2, e) && (!b2.device || !m.device || b2.device === m.device.name)) hit = a; }
    if (!hit) return false;
    if (hit[2] === "level") { if (e.type === "cc") run(hit[0], e.value); else if (e.on) run(hit[0], e.value); return true; }
    // a button: on the press (note on, a CC going up past the middle, a program change)
    var key = e.type + e.ch + ":" + e.num, prev = lastVal[key] || 0;
    if (e.type === "cc") { lastVal[key] = e.value; if (!(e.value >= 64 && prev < 64)) return true; }
    else if (!e.on) return true;
    run(hit[0]);
    return true;
  }

  function learn(id) {
    var a = ACTIONS.filter(function (x) { return x[0] === id; })[0]; if (!a) return Promise.reject(new Error("no such control"));
    if (learning) learning.resolve(null);
    if (window.CUMidiIn) window.CUMidiIn.start().catch(function () { });
    return new Promise(function (resolve) { learning = { id: id, kind: a[2], resolve: resolve }; });
  }
  function cancelLearn() { if (learning) { var l = learning; learning = null; l.resolve(null); } }

  /** The Controls box (in the DAW's own dialog). */
  function dialog() {
    var UI = window.CDawUI; if (!UI || !UI.modal) return;
    var esc = UI.esc;
    function rows() {
      return ACTIONS.map(function (a) { return '<div class="cd-line cd-ctl"><span style="flex:1">' + esc(a[1]) + '</span><code class="cd-ctl-b" data-b="' + a[0] + '">' + esc(label(binds[a[0]])) + '</code><button data-learn="' + a[0] + '">Learn</button><button data-clear="' + a[0] + '" title="Forget it">✕</button></div>'; }).join("");
    }
    var devs = window.CUMidiIn ? window.CUMidiIn.inputs().map(function (d) { return d.name; }) : [];
    UI.modal("MIDI and foot controls", '<p class="cd-dim">Press <b>Learn</b>, then the pad, button, footswitch, knob or fader you want. Buttons and footswitches act when pressed; knobs and faders set the level. ' +
      (devs.length ? "Plugged in: " + esc(devs.join(", ")) + "." : "No MIDI device found yet: plug one in.") + '</p><div class="cd-ctls">' + rows() + '</div>', function () { cancelLearn(); });
    var m = UI.U.root && UI.U.root.querySelector(".cd-modal"); if (!m) return;
    var dlg = m.querySelector(".cd-dialog"); if (dlg) dlg.classList.add("cd-wide");
    var box = m.querySelector(".cd-ctls"), close = m.onclick;
    m.onclick = function (ev) { if (ev.target.closest("[data-m]")) cancelLearn(); if (close) close(ev); };
    box.onclick = function (ev) {
      var l = ev.target.closest("[data-learn]"), c = ev.target.closest("[data-clear]");
      if (l) { var id = l.dataset.learn; box.querySelector('[data-b="' + id + '"]').textContent = "Waiting… press or move it"; l.disabled = true; learn(id).then(function (b) { if (box.isConnected) box.innerHTML = rows(); if (b) UI.say("Learned: " + label(b)); }); }
      if (c) { delete binds[c.dataset.clear]; save(binds); box.innerHTML = rows(); }
    };
  }

  window.CDawControl = {
    ACTIONS: ACTIONS, bindings: function () { return JSON.parse(JSON.stringify(binds)); }, learn: learn, cancelLearn: cancelLearn, label: label,
    clear: function (id) { delete binds[id]; save(binds); }, clearAll: function () { binds = {}; save(binds); }, set: function (id, b) { binds[id] = b; save(binds); },
    handle: handle, dialog: dialog, run: run
  };
})();
