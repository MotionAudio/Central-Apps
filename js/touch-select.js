/* Central Control - touch select: a knob, slider or the encoder given the "Touch select" job (Configure tab)
 * changes whatever setting was last tapped on the screen - any slider, number, list or switch on any tab
 * (pad sound, a pedal's knobs, a track fader, the lyrics size...).
 *  - tap a setting: the touch-select knob takes it (a quick tap on a slider does not move the slider itself)
 *  - it stays on that setting until another one is tapped; tapping the same one again lets it go (or the ✕)
 *  - pick-up: a knob only starts changing the setting once it reaches where the setting already is, so nothing
 *    jumps; until then an arrow says which way to turn. The encoder has nothing to pick up (it steps from there)
 *  - with more than one touch-select knob, the next one turned after a tap takes the tapped setting
 *  - shown in a strip at the bottom of the screen, and on the 3.5" screen */
(function () {
  "use strict";
  var PP = window.PP, A = window.PPActions; if (!PP || !A) return;
  var esc = PP.escapeHtml;
  var SKIP = "#tabConfigure, #tabLearn, #tsChip, .tuner-overlay, .ts-skip";
  var hold = {};          // input id -> { loc, label, caught, last }
  var pending = null;     // a tapped setting waiting for a knob (several touch knobs)
  var down = null;        // the pointer that may turn out to be a tap

  // ------------------------------------------------------------- which inputs have the job
  function touchInputs() {
    var m = A.mapping(), out = [];
    Object.keys(m).forEach(function (id) { var e = m[id]; if (e && (e.action === "touchSelect" || e.action === "touchSelectStep")) out.push(id); });
    return out;
  }
  function inputName(id) { var C = window.PPConfigure, spec = C && C.inputs().filter(function (i) { return i.id === id; })[0]; return spec ? spec.name : id; }

  // ------------------------------------------------------------- what can be held
  function controllable(el) {
    if (!el || !el.tagName || el.disabled) return null;
    if (el.closest && el.closest(SKIP)) return null;
    if (el.tagName === "SELECT") return el.options.length > 1 ? el : null;
    if (el.tagName === "INPUT") { var t = (el.type || "").toLowerCase(); return t === "range" || t === "number" || t === "checkbox" ? el : null; }
    return null;
  }
  function fromEvent(e) {
    var t = e.target; if (!t || !t.closest) return null;
    var el = controllable(t); if (el) return el;
    var lab = t.closest("label"); if (lab) { var inner = lab.querySelector("input[type=range],input[type=number],input[type=checkbox],select"); if (inner && !lab.querySelector("button")) return controllable(inner); }
    return null;
  }
  // a way to find the same setting again after the screen is redrawn
  function locate(el) {
    if (el.id) return { id: el.id };
    var scope = el.parentNode, path = [];
    while (scope && scope !== document.body && !scope.id) scope = scope.parentNode;
    var sel = el.tagName.toLowerCase();
    Array.prototype.forEach.call(el.attributes, function (a) { if (/^data-|^name$|^aria-label$/.test(a.name)) sel += "[" + a.name + '="' + cssEsc(a.value) + '"]'; });
    if (el.type && el.tagName === "INPUT") sel += '[type="' + el.type + '"]';
    if (el.className && typeof el.className === "string") el.className.split(/\s+/).filter(function (c) { return c && c !== "ts-target"; }).slice(0, 2).forEach(function (c) { sel += "." + cssEsc(c); });
    var full = (scope && scope.id ? "#" + cssEsc(scope.id) + " " : "") + sel, all = document.querySelectorAll(full);
    return { sel: full, index: Math.max(0, Array.prototype.indexOf.call(all, el)), label: labelOf(el) };
  }
  function cssEsc(v) { return window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/["\\]/g, "\\$&"); }
  function resolve(loc) {
    if (!loc) return null;
    if (loc.el && loc.el.isConnected) return loc.el;
    var el = null;
    if (loc.id) el = document.getElementById(loc.id);
    else { var all = document.querySelectorAll(loc.sel); el = all[loc.index] || (all.length === 1 ? all[0] : null); }
    loc.el = el; return el;
  }
  function visible(el) { return !!(el && el.getClientRects().length); }
  function clean(t) { return String(t || "").replace(/\s+/g, " ").trim(); }
  function labelOf(el) {
    var name = el.getAttribute("aria-label") || "";
    if (!name) { var lab = el.closest("label"); if (lab) { var c = lab.cloneNode(true); c.querySelectorAll("select,input,output,small,button,textarea").forEach(function (x) { x.remove(); }); name = clean(c.textContent); } }
    if (!name && el.id) { var f = document.querySelector('label[for="' + cssEsc(el.id) + '"]'); if (f) name = clean(f.textContent); }
    if (!name) name = el.title || el.name || (el.dataset && (el.dataset.path || el.dataset.ctl || el.dataset.sys)) || "setting";
    // where it is (a pedal's name, a mixer strip, a section)
    var box = el.closest(".in-detail, .stem, .card, section, dialog"), ctx = "";
    if (box) { var h = box.querySelector(".stem-name, h3, h2"); if (h && h !== el) ctx = clean(h.textContent); }
    name = clean(name).replace(/[:\s]+$/, "");
    return (ctx && ctx.toLowerCase() !== name.toLowerCase() ? name + " · " + ctx : name).slice(0, 48);
  }

  // ------------------------------------------------------------- reading / writing a setting as 0..1
  function range(el) {
    if (el.tagName === "SELECT") return { n: el.options.length };
    if (el.type === "checkbox") return { n: 2 };
    var min = el.min === "" ? (el.type === "number" ? 0 : 0) : Number(el.min), max = el.max === "" ? (el.type === "number" ? min + 100 : 100) : Number(el.max), step = el.step === "" || el.step === "any" ? (el.type === "range" ? 1 : 1) : Number(el.step);
    if (!(max > min)) max = min + 1; if (!(step > 0)) step = (max - min) / 100;
    return { min: min, max: max, step: step };
  }
  function norm(el) {
    var r = range(el);
    if (el.tagName === "SELECT") return r.n > 1 ? el.selectedIndex / (r.n - 1) : 0;
    if (el.type === "checkbox") return el.checked ? 1 : 0;
    var v = Number(el.value); if (!isFinite(v)) v = r.min; return PP.clamp((v - r.min) / (r.max - r.min), 0, 1);
  }
  var changeTimers = new WeakMap();
  function fire(el, immediate) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    clearTimeout(changeTimers.get(el));
    if (immediate) el.dispatchEvent(new Event("change", { bubbles: true }));
    else changeTimers.set(el, setTimeout(function () { if (el.isConnected) el.dispatchEvent(new Event("change", { bubbles: true })); }, 140));
  }
  function setNorm(el, v) {
    v = PP.clamp(v, 0, 1); var r = range(el);
    if (el.tagName === "SELECT") { var i = Math.round(v * (r.n - 1)); if (i !== el.selectedIndex) { el.selectedIndex = i; fire(el, true); } return; }
    if (el.type === "checkbox") { var on = v >= 0.5; if (on !== el.checked) { el.checked = on; fire(el, true); } return; }
    var raw = r.min + v * (r.max - r.min), snapped = Math.round((raw - r.min) / r.step) * r.step + r.min;
    snapped = PP.clamp(Number(snapped.toFixed(6)), r.min, r.max);
    if (Number(el.value) !== snapped) { el.value = String(snapped); fire(el, false); }
  }
  function stepBy(el, d) {
    var r = range(el);
    if (el.tagName === "SELECT") { var i = PP.clamp(el.selectedIndex + d, 0, r.n - 1); if (i !== el.selectedIndex) { el.selectedIndex = i; fire(el, true); } return; }
    if (el.type === "checkbox") { el.checked = d > 0; fire(el, true); return; }
    var inc = Math.max(r.step, Math.round((r.max - r.min) / 100 / r.step) * r.step);
    var v = PP.clamp((Number(el.value) || 0) + d * inc, r.min, r.max); el.value = String(Number(v.toFixed(6))); fire(el, false);
  }
  function valueText(el) {
    if (el.tagName === "SELECT") return clean(el.options[el.selectedIndex] ? el.options[el.selectedIndex].textContent : "");
    if (el.type === "checkbox") return el.checked ? "on" : "off";
    var out = el.parentNode && el.parentNode.querySelector("output"); if (out && clean(out.textContent)) return clean(out.textContent);
    return el.type === "range" ? Math.round(norm(el) * 100) + "%" : String(el.value);
  }

  // ------------------------------------------------------------- taking / letting go
  function take(el) {
    var ins = touchInputs(); if (!ins.length) return;
    var loc = locate(el); loc.el = el;
    // tapping what a knob already holds lets it go
    var already = Object.keys(hold).filter(function (id) { return resolve(hold[id].loc) === el; })[0];
    if (already) { release(already); return; }
    var target = ins.length === 1 ? ins[0] : null;
    if (!target) { pending = { loc: loc, label: labelOf(el) }; paint(); return; }
    give(target, loc);
  }
  function give(id, loc) {
    hold[id] = { loc: loc, label: loc.label || labelOf(resolve(loc)), caught: false, last: null, step: (A.entryFor(id) || {}).action === "touchSelectStep" };
    if (hold[id].step) hold[id].caught = true;
    pending = null; paint();
  }
  function release(id) {
    if (id) delete hold[id]; else hold = {};
    pending = null; paint();
  }

  // ------------------------------------------------------------- the knob moved (from actions.js)
  function knob(id, v) {
    if (pending) give(id, pending.loc);
    var h = hold[id]; if (!h) { paint(); return; }
    var el = resolve(h.loc); if (!el) { h.lost = true; paint(); return; }
    h.lost = false;
    if (!h.caught) {
      var t = norm(el), near = Math.abs(v - t) <= 0.035, crossed = h.last != null && (h.last - t) * (v - t) <= 0;
      h.last = v;
      if (near || crossed) h.caught = true; else { h.dir = v < t ? "up" : "down"; paint(); return; }
    }
    h.last = v; h.dir = null; setNorm(el, v); paint();
  }
  function step(id, d) {
    if (pending) give(id, pending.loc);
    var h = hold[id]; if (!h) { paint(); return; }
    var el = resolve(h.loc); if (!el) { h.lost = true; paint(); return; }
    stepBy(el, d < 0 ? -1 : 1); paint();
  }

  // ------------------------------------------------------------- taps
  document.addEventListener("pointerdown", function (e) {
    down = null; if (!touchInputs().length) return;
    var el = fromEvent(e); if (!el) return;
    down = { el: el, x: e.clientX, y: e.clientY, t: performance.now(), before: el.type === "range" ? el.value : null };
  }, true);
  document.addEventListener("pointerup", function (e) {
    var d = down; down = null; if (!d) return;
    var tap = performance.now() - d.t < 350 && Math.abs(e.clientX - d.x) < 10 && Math.abs(e.clientY - d.y) < 10;
    // a quick tap on a slider only picks it; it does not jump the slider to where the finger landed
    if (tap && d.before != null && d.el.value !== d.before) { d.el.value = d.before; fire(d.el, true); }
    take(d.el);
  }, true);

  // ------------------------------------------------------------- showing it
  function chip() {
    var el = document.getElementById("tsChip"); if (el) return el;
    el = document.createElement("div"); el.id = "tsChip"; el.className = "ts-chip"; el.hidden = true;
    document.body.appendChild(el);
    el.addEventListener("click", function (e) { var b = e.target.closest("[data-ts-drop]"); if (b) release(b.dataset.tsDrop || null); });
    return el;
  }
  var lastMini = "";
  function paint() {
    document.querySelectorAll(".ts-target").forEach(function (x) { x.classList.remove("ts-target"); });
    var c = chip(), rows = [], mini = null;
    if (pending) rows.push('<div class="ts-row"><b>' + esc(pending.label) + '</b><span class="ts-sub">turn the touch knob you want for it</span><button data-ts-drop="">✕</button></div>');
    Object.keys(hold).forEach(function (id) {
      var h = hold[id], el = resolve(h.loc); if (el && visible(el)) el.classList.add("ts-target");
      var val = el ? valueText(el) : "", sub = h.lost ? "not on this screen" : h.dir ? (h.dir === "up" ? "▲ turn up to pick it up" : "▼ turn down to pick it up") : val;
      rows.push('<div class="ts-row' + (h.dir ? " pick" : "") + '"><small>' + esc(inputName(id)) + '</small><b>' + esc(h.label) + '</b><span class="ts-sub">' + esc(sub) + '</span><button data-ts-drop="' + esc(id) + '" title="Let go">✕</button></div>');
      if (!mini) mini = { knob: inputName(id), label: h.label, value: val, pickup: h.dir || null };
    });
    c.innerHTML = rows.join(""); c.hidden = !rows.length;
    var key = JSON.stringify(mini);
    if (key !== lastMini) { lastMini = key; var b = window.__pedalBridge; if (b && b.connected && b.send) b.send(Object.assign({ type: "touchSelect" }, mini || {})); }
  }
  // keep the highlight on the setting when its screen is redrawn
  setInterval(function () { if (Object.keys(hold).length) paint(); }, 1000);

  window.PPTouchSelect = { knob: knob, step: step, take: take, release: release, held: function () { var o = {}; Object.keys(hold).forEach(function (id) { o[id] = { label: hold[id].label, caught: hold[id].caught, dir: hold[id].dir || null }; }); return o; }, pending: function () { return pending; }, labelOf: labelOf, inputs: touchInputs };
})();
