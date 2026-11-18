/* Motion Audio Central - the pop-up keyboard (10.8): ⌘K / Ctrl+K in Central Production, Central Usage and Central Pedal
 * Control. (The command search moved to ⌘P / Ctrl+P. In an app with nothing to play, ⌘K still opens the search.)
 *
 * A piano strip pops up along the bottom of the window and plays whatever the page says is playing: the DAW's selected
 * instrument track, the instrument you're building, the Instrument tab's keys sound, the selected pad. Click or drag
 * across its keys (lower down a key plays harder), or play the computer keys the way Logic and Ableton lay them out:
 *   A W S E D F T G Y H U J K O L P ; '   C up to the F an octave and a half above (black keys on the row above)
 *   Z / X  octave down / up     C / V  softer / harder     Tab (hold)  sustain     Esc  close
 * Keys it doesn't use (Space, R…) still reach the page, so you can start the song or record while you play.
 * A MIDI keyboard's notes light its keys too (CKeys.light), so you can see what's being played.
 *
 *   CKeys.target(t)     t = { id, available() -> bool, name() -> what plays, noteOn(note, velocity), noteOff(note),
 *                             sustain(on)?, allOff()?, hint()? (said when nothing can play yet), priority? (higher first) }
 *                       the available target with the highest priority plays; registering the same id replaces it
 *   CKeys.open() / close() / toggle() / isOpen()
 *   CKeys.wants()       true once a target is registered: ⌘K is the keyboard in this app
 *   CKeys.light(note, on)    CKeys.refresh()    CKeys.octave(n?)    CKeys.velocity(v?)
 *
 * Shared file: server/public/daw/keys-popup.js. js/keys-popup.js is a copy for the Central Pedal's own page (Central
 * Pedal Control): copy it across after changing this one (central-production/test-web.mjs checks they're the same). */
(function () {
  "use strict";
  if (window.CKeys) return;
  var targets = [], el = null, keysEl = null, open = false, oct = 4, vel = 100, sus = false, cur = null, timer = null;
  var held = {}, sounding = {}, sustained = {}, mouseNote = null, lit = {}, midiAt = 0;
  // physical keys (so it plays the same on any keyboard layout), then what they print, for older browsers
  var CODES = ["KeyA", "KeyW", "KeyS", "KeyE", "KeyD", "KeyF", "KeyT", "KeyG", "KeyY", "KeyH", "KeyU", "KeyJ", "KeyK", "KeyO", "KeyL", "KeyP", "Semicolon", "Quote"];
  var CHARS = "awsedftgyhujkolp;'";
  var NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"], BLACK = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
  var VELS = [1, 20, 40, 60, 80, 100, 120, 127];
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function isMac() { return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || ""); }
  function noteName(n) { return NAMES[n % 12].replace("♯", "#") + (Math.floor(n / 12) - 1); }
  function base() { return (oct + 1) * 12; }   // the note the A key plays (C4 = 60 at octave 4)
  function slot(e) { var i = CODES.indexOf(e.code); if (i < 0 && e.key && e.key.length === 1) i = CHARS.indexOf(e.key.toLowerCase()); return i; }
  function typing(t) {
    if (!t || !t.tagName) return false;
    if (el && el.contains(t)) return false;   // (our own slider and buttons: the letters still play)
    if (/^(textarea|select)$/i.test(t.tagName)) return true;
    if (/^input$/i.test(t.tagName)) return !/^(range|checkbox|radio|button|submit|color)$/i.test(t.type || "");
    return !!t.isContentEditable;
  }

  // ------------------------------------------------------------- who plays
  function pick() {
    for (var i = 0; i < targets.length; i++) { var t = targets[i]; try { if (!t.available || t.available()) return t; } catch (_) { } }
    return null;
  }
  function target(t) {
    if (!t || !t.id || typeof t.noteOn !== "function") return;
    targets = targets.filter(function (x) { return x.id !== t.id; });
    targets.push(t); targets.sort(function (a, b) { return (b.priority || 0) - (a.priority || 0); });
    if (open) refresh();
  }
  function on(n, v) {
    n = clamp(n | 0, 0, 127); var t = cur || pick(); light(n, true, true);
    if (!t) return;
    if (sounding[n]) off(n, true);
    sounding[n] = t; delete sustained[n];
    try { t.noteOn(n, clamp(v | 0, 1, 127)); } catch (e) { console.warn("keyboard:", e); }
  }
  function off(n, now) {
    light(n, false, true);
    var t = sounding[n]; if (!t) return;
    if (sus && !now && !t.sustain) { sustained[n] = t; return; }   // (a target without its own sustain: hold the note until Tab is let go)
    delete sounding[n];
    try { t.noteOff(n); } catch (e) { console.warn("keyboard:", e); }
  }
  function allOff() {
    Object.keys(held).forEach(function (k) { delete held[k]; });
    Object.keys(sounding).forEach(function (n) { off(+n, true); });
    Object.keys(sustained).forEach(function (k) { delete sustained[k]; });
    if (mouseNote != null) mouseNote = null;
    setSustain(false);
  }
  function setSustain(v) {
    if (v === sus) return; sus = v;
    var t = cur; if (t && t.sustain) try { t.sustain(v); } catch (_) { }
    if (!v) Object.keys(sustained).forEach(function (n) { var x = sustained[n]; delete sustained[n]; delete sounding[n]; try { x.noteOff(+n); } catch (_) { } });
    paintBar();
  }

  // ------------------------------------------------------------- drawing
  var CSS = ".ckeys{position:fixed;left:0;right:0;bottom:0;z-index:1900;background:var(--panel,#1A1D22);border-top:1px solid var(--line2,#454C58);box-shadow:0 -18px 50px -20px rgba(0,0,0,.8);color:var(--text,#ECE7DD);font-family:var(--font,Archivo,system-ui,sans-serif);user-select:none;-webkit-user-select:none;touch-action:none}" +
    ".ckeys[hidden]{display:none}" +
    ".ckeys-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:7px 12px;font-size:13px;min-height:40px}" +
    ".ckeys-bar b.ck-name{font-weight:600;color:var(--accent,#E2C27E);max-width:36vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".ckeys-bar .ck-dim{color:var(--muted,#9AA1AB)}.ckeys-bar .ck-grow{flex:1}" +
    ".ckeys-bar button{min-height:30px;min-width:30px;padding:0 10px;border-radius:var(--r-sm,6px);border:1px solid var(--line,#343A44);background:var(--panel2,#23272E);color:inherit;font:inherit;cursor:pointer}" +
    ".ckeys-bar button:hover{background:var(--panel3,#2C313A)}.ckeys-bar button.on{background:var(--accent,#E2C27E);color:var(--accentText,#1A1408);border-color:var(--accent,#E2C27E)}" +
    ".ckeys-bar .ck-grp{display:inline-flex;align-items:center;gap:6px}.ckeys-bar .ck-oct{min-width:30px;text-align:center;font-variant-numeric:tabular-nums}" +
    ".ckeys-bar input[type=range]{width:110px;accent-color:var(--accent,#E2C27E)}" +
    ".ckeys-bar .ck-midi{width:9px;height:9px;border-radius:50%;background:var(--line2,#454C58);display:inline-block;transition:background .25s}.ckeys-bar .ck-midi.on{background:var(--ok,#6FCF97);transition:none}" +
    ".ckeys-hint{padding:0 12px 6px;font-size:12px;color:var(--dim,#6E7682)}.ckeys-hint kbd{font:600 11px/1 var(--font,sans-serif);padding:2px 5px;border:1px solid var(--line,#343A44);border-bottom-width:2px;border-radius:4px;color:var(--muted,#9AA1AB)}" +
    ".ckeys-say{padding:0 12px 6px;font-size:13px;color:var(--warn,#F0B429)}.ckeys-say:empty{display:none}" +
    ".ckeys-keys{position:relative;height:clamp(96px,17vh,150px);margin:0 10px 10px;display:flex;cursor:pointer}" +
    ".ck-w{flex:1;position:relative;background:linear-gradient(#F4F1EA,#E4DFD4);border:1px solid #2a2d33;border-top:0;border-radius:0 0 6px 6px;margin-right:-1px;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;padding-bottom:6px;color:#3a3a3a;font-size:11px}" +
    ".ck-b{position:absolute;top:0;height:60%;background:linear-gradient(#2b2f36,#121418);border:1px solid #000;border-top:0;border-radius:0 0 4px 4px;z-index:2;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;padding-bottom:5px;color:#c9c3b7;font-size:10px}" +
    ".ck-w.mapped{box-shadow:inset 0 -3px 0 var(--accent,#E2C27E)}.ck-b.mapped{box-shadow:inset 0 -3px 0 var(--accent,#E2C27E)}" +
    ".ck-w.down{background:linear-gradient(#E9D3A0,var(--accent,#E2C27E))}.ck-b.down{background:linear-gradient(#8b7444,#5c4b2a)}" +
    ".ck-w.midi:not(.down){background:linear-gradient(#cfe6d6,#a9d3b6)}.ck-b.midi:not(.down){background:linear-gradient(#2f5a3e,#1d3a28)}" +
    ".ck-w i,.ck-b i{font-style:normal;font-weight:700;opacity:.75;text-transform:uppercase}.ck-w small{opacity:.55;font-size:10px}" +
    "@media (max-width:640px){.ckeys-hint{display:none}.ckeys-bar input[type=range]{width:70px}}";
  function build() {
    if (!document.getElementById("ckeys-css")) { var st = document.createElement("style"); st.id = "ckeys-css"; st.textContent = CSS; (document.head || document.documentElement).appendChild(st); }
    el = document.createElement("div"); el.className = "ckeys"; el.hidden = true; el.setAttribute("role", "region"); el.setAttribute("aria-label", "Keyboard");
    el.innerHTML = '<div class="ckeys-bar"><span>⌨ <span class="ck-dim">Playing</span> <b class="ck-name"></b></span><span class="ck-midi" title="Lights when a MIDI keyboard plays"></span><span class="ck-grow"></span>' +
      '<span class="ck-grp"><span class="ck-dim">Octave</span><button data-ck="down" title="Octave down (Z)" aria-label="Octave down">−</button><span class="ck-oct"></span><button data-ck="up" title="Octave up (X)" aria-label="Octave up">+</button></span>' +
      '<span class="ck-grp"><span class="ck-dim">Velocity</span><input type="range" min="1" max="127" step="1" data-ck="vel" aria-label="Velocity" title="How hard the computer keys play (C softer, V harder)"><span class="ck-vel ck-dim"></span></span>' +
      '<button data-ck="sus" title="Sustain (hold Tab)">Sustain</button><button data-ck="close" title="Close (Esc or ' + (isMac() ? "⌘K" : "Ctrl+K") + ')" aria-label="Close the keyboard">✕</button></div>' +
      '<div class="ckeys-say" aria-live="polite"></div>' +
      '<div class="ckeys-keys"></div>' +
      '<div class="ckeys-hint"><kbd>A</kbd>–<kbd>\'</kbd> play · <kbd>W</kbd><kbd>E</kbd><kbd>T</kbd><kbd>Y</kbd><kbd>U</kbd><kbd>O</kbd><kbd>P</kbd> sharps · <kbd>Z</kbd><kbd>X</kbd> octave · <kbd>C</kbd><kbd>V</kbd> velocity · hold <kbd>Tab</kbd> sustain · <kbd>Esc</kbd> close</div>';
    document.body.appendChild(el);
    keysEl = el.querySelector(".ckeys-keys");
    el.addEventListener("click", function (e) {
      var b = e.target.closest("[data-ck]"); if (!b) return; var k = b.dataset.ck;
      if (k === "down" || k === "up") setOctave(oct + (k === "up" ? 1 : -1));
      else if (k === "sus") setSustain(!sus);
      else if (k === "close") close();
    });
    el.querySelector("[data-ck=vel]").addEventListener("input", function (e) { vel = clamp(+e.target.value, 1, 127); paintBar(); });
    keysEl.addEventListener("pointerdown", function (e) {
      var k = e.target.closest("[data-n]"); if (!k) return; e.preventDefault();
      try { keysEl.setPointerCapture(e.pointerId); } catch (_) { }
      mouseNote = +k.dataset.n; on(mouseNote, mouseVel(k, e));
    });
    keysEl.addEventListener("pointermove", function (e) {
      if (mouseNote == null) return;
      var hit = document.elementFromPoint(e.clientX, e.clientY), k = hit && hit.closest && hit.closest("[data-n]");
      if (!k || !keysEl.contains(k) || +k.dataset.n === mouseNote) return;
      off(mouseNote); mouseNote = +k.dataset.n; on(mouseNote, mouseVel(k, e));
    });
    function up() { if (mouseNote != null) { off(mouseNote); mouseNote = null; } }
    keysEl.addEventListener("pointerup", up); keysEl.addEventListener("pointercancel", up); keysEl.addEventListener("lostpointercapture", up);
  }
  function mouseVel(k, e) { var r = k.getBoundingClientRect(); return Math.round(40 + 87 * clamp((e.clientY - r.top) / Math.max(1, r.height), 0, 1)); }
  function range() {   // four octaves round the computer keys: one below, the octave and a half they play, and a bit above
    var lo = clamp(base() - 12, 0, 127 - 48); return [lo, Math.min(127, lo + 48)];
  }
  function paintKeys() {
    if (!keysEl) return;
    var r = range(), whites = [], h = "", b = base();
    for (var n = r[0]; n <= r[1]; n++) if (!BLACK[n % 12]) whites.push(n);
    var w = 100 / whites.length;
    whites.forEach(function (n) {
      var s = n - b, letter = s >= 0 && s < CHARS.length ? CHARS[s] : "";
      h += '<div class="ck-w' + (letter ? " mapped" : "") + (lit[n] ? " " + lit[n] : "") + '" data-n="' + n + '">' + (letter ? "<i>" + esc(letter) + "</i>" : "") + (n % 12 === 0 ? "<small>" + noteName(n) + "</small>" : "") + "</div>";
    });
    for (var m = r[0]; m <= r[1]; m++) {
      if (!BLACK[m % 12]) continue;
      var wi = whites.indexOf(m - 1); if (wi < 0) continue;
      var s2 = m - b, l2 = s2 >= 0 && s2 < CHARS.length ? CHARS[s2] : "";
      h += '<div class="ck-b' + (l2 ? " mapped" : "") + (lit[m] ? " " + lit[m] : "") + '" data-n="' + m + '" style="left:' + ((wi + 1) * w - w * 0.31).toFixed(3) + "%;width:" + (w * 0.62).toFixed(3) + '%">' + (l2 ? "<i>" + esc(l2) + "</i>" : "") + "</div>";
    }
    keysEl.innerHTML = h;
  }
  function paintBar() {
    if (!el) return;
    var t = cur, name = el.querySelector(".ck-name"), say = el.querySelector(".ckeys-say");
    var nm = ""; try { nm = t && t.name ? t.name() : ""; } catch (_) { }
    name.textContent = t ? (nm || "the selected sound") : "nothing yet";
    var hint = ""; if (!t) { var h0 = targets[0]; try { hint = h0 && h0.hint ? h0.hint() : ""; } catch (_) { } hint = hint || "Pick something to play, then the keys will play it."; }
    say.textContent = hint;
    el.querySelector(".ck-oct").textContent = "C" + oct;
    var vr = el.querySelector("[data-ck=vel]"); if (document.activeElement !== vr) vr.value = vel; el.querySelector(".ck-vel").textContent = vel;
    el.querySelector("[data-ck=sus]").classList.toggle("on", sus);
  }
  function light(n, onNow, mine) {
    var cls = mine ? "down" : "midi";
    if (onNow) lit[n] = cls; else if (lit[n] === cls) delete lit[n];
    if (!mine && onNow) { midiAt = Date.now(); var d = el && el.querySelector(".ck-midi"); if (d) { d.classList.add("on"); setTimeout(function () { if (Date.now() - midiAt >= 240) d.classList.remove("on"); }, 260); } }
    if (!keysEl) return;
    var k = keysEl.querySelector('[data-n="' + n + '"]'); if (!k) return;
    k.classList.remove("down", "midi"); if (lit[n]) k.classList.add(lit[n]);
  }
  function setOctave(o) { o = clamp(o | 0, 0, 8); if (o === oct) return; Object.keys(held).forEach(function (c) { off(held[c]); delete held[c]; }); oct = o; paintKeys(); paintBar(); }
  function setVelocity(v) { vel = clamp(v | 0, 1, 127); paintBar(); }
  function refresh() {
    var t = pick();
    if (t !== cur) { Object.keys(sounding).forEach(function (n) { off(+n, true); }); if (sus && cur && cur.sustain) try { cur.sustain(false); } catch (_) { } cur = t; if (sus && cur && cur.sustain) try { cur.sustain(true); } catch (_) { } }
    paintBar();
  }

  // ------------------------------------------------------------- open, close and the keys
  function openIt() {
    if (!el) build();
    open = true; el.hidden = false; cur = null; refresh(); paintKeys();
    var a = document.activeElement; if (a && a !== document.body && typing(a) && a.blur) a.blur();   // (you opened it to play: the letters play, they don't type)
    document.documentElement.classList.add("ckeys-open");
    clearInterval(timer); timer = setInterval(function () { if (open) refresh(); }, 600);
    try { window.dispatchEvent(new CustomEvent("ckeys", { detail: { open: true } })); } catch (_) { }
  }
  function close() {
    if (!el || !open) return;
    allOff(); open = false; el.hidden = true; clearInterval(timer);
    document.documentElement.classList.remove("ckeys-open");
    try { window.dispatchEvent(new CustomEvent("ckeys", { detail: { open: false } })); } catch (_) { }
  }
  function toggle() { if (open) close(); else openIt(); }
  window.addEventListener("keydown", function (e) {
    var mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && !e.shiftKey && (e.key === "k" || e.key === "K" || e.code === "KeyK") && targets.length) { e.preventDefault(); e.stopPropagation(); toggle(); return; }
    if (!open || mod || e.altKey) return;
    var k = e.key;
    if (k === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (typing(e.target)) return;
    if (k === "Tab") { e.preventDefault(); e.stopPropagation(); setSustain(true); return; }
    if (e.code === "KeyZ" || e.code === "KeyX" || (!e.code && /^[zx]$/i.test(k))) { e.preventDefault(); e.stopPropagation(); if (!e.repeat) setOctave(oct + ((e.code === "KeyX" || /x/i.test(k)) ? 1 : -1)); return; }
    if (e.code === "KeyC" || e.code === "KeyV" || (!e.code && /^[cv]$/i.test(k))) {
      e.preventDefault(); e.stopPropagation(); if (e.repeat) return;
      var up = e.code === "KeyV" || /v/i.test(k), i = 0; while (i < VELS.length - 1 && VELS[i] < vel) i++;
      setVelocity(up ? VELS[Math.min(VELS.length - 1, VELS[i] > vel ? i : i + 1)] : VELS[Math.max(0, VELS[i] >= vel ? i - 1 : i)]); return;
    }
    var s = slot(e); if (s < 0) return;   // (anything else - Space, R, the arrows - goes on to the page)
    e.preventDefault(); e.stopPropagation();
    var code = e.code || k; if (e.repeat || held[code] != null) return;
    held[code] = base() + s; on(held[code], vel);
  }, true);
  window.addEventListener("keyup", function (e) {
    if (!open) return;
    if (e.key === "Tab") { e.preventDefault(); setSustain(false); return; }
    var code = e.code || e.key; if (held[code] == null) return;
    e.preventDefault(); e.stopPropagation(); off(held[code]); delete held[code];
  }, true);
  window.addEventListener("blur", function () { if (open) { Object.keys(held).forEach(function (c) { off(held[c]); delete held[c]; }); setSustain(false); } });

  window.CKeys = {
    target: target, open: openIt, close: close, toggle: toggle, isOpen: function () { return open; },
    wants: function () { return targets.length > 0; }, refresh: refresh, light: function (n, v) { light(n, !!v, false); },
    octave: function (o) { if (o != null) setOctave(o); return oct; }, velocity: function (v) { if (v != null) setVelocity(v); return vel; },
    remove: function (id) { targets = targets.filter(function (x) { return x.id !== id; }); if (open) refresh(); },
    current: function () { return cur; }, noteName: noteName
  };
})();
