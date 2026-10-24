/* Central Pedal - move around the screen without touching it: buttons, knobs, sliders, MIDI or a keyboard can move a
 * highlight up / down / left / right, press what's highlighted (OK), go back (close a dialog), scroll, and change the
 * highlighted slider or list with a knob. The highlight is a clear ring (.nav-focus) that follows the real keyboard
 * focus, so whatever the highlight is on also answers the keyboard. */
(function () {
  "use strict";
  var FOCUSABLE = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [tabindex]:not([tabindex="-1"])';
  var current = null, ringTimer = 0;

  function visible(el) {
    if (!el || el.disabled || el.closest("[hidden], .hidden, [inert]")) return false;
    var r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false;
    var cs = getComputedStyle(el); return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05;
  }
  // where the highlight may go: an open dialog / pop-up first, else the whole page
  function scope() {
    var open = Array.prototype.slice.call(document.querySelectorAll("dialog[open], .modal:not(.hidden), [role=dialog]:not(.hidden)")).filter(function (d) { return d.getBoundingClientRect().width > 0; });
    return open.length ? open[open.length - 1] : document.body;
  }
  function items() { return Array.prototype.slice.call(scope().querySelectorAll(FOCUSABLE)).filter(visible); }
  function center(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
  function alive(el) { return el && document.contains(el) && visible(el) && scope().contains(el); }

  function mark(el) {
    if (current && current !== el) current.classList.remove("nav-focus");
    current = el; if (!el) return;
    el.classList.add("nav-focus");
    try { el.focus({ preventScroll: true }); } catch (_) { }
    try { el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" }); } catch (_) { el.scrollIntoView(false); }
    document.body.classList.add("nav-active");
    clearTimeout(ringTimer); ringTimer = setTimeout(function () { document.body.classList.remove("nav-active"); }, 20000);   // (the ring fades after a while untouched)
  }
  function start() {   // nothing highlighted yet: the first thing on the screen (top-left)
    var list = items(), vh = window.innerHeight;
    var onScreen = list.filter(function (el) { var r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < vh; });
    (onScreen.length ? onScreen : list).sort(function (a, b) { var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return (ra.top - rb.top) || (ra.left - rb.left); });
    return (onScreen.length ? onScreen : list)[0] || null;
  }
  function from() { var a = document.activeElement; if (a && a !== document.body && a.matches && a.matches(FOCUSABLE) && alive(a)) return a; return alive(current) ? current : null; }   // (what has the focus - a tap or the keyboard may have moved it)

  // the nearest control in a direction (by the centres; sideways distance counts double)
  function move(dir) {
    var here = from(); if (!here) { mark(start()); return current; }
    var hr = here.getBoundingClientRect(), c = center(hr), best = null, bestScore = Infinity;
    items().forEach(function (el) {
      if (el === here || el.contains(here) || here.contains(el)) return;
      var r = el.getBoundingClientRect(), p = center(r), dx = p.x - c.x, dy = p.y - c.y, main, side;
      if (dir === "down") { if (r.top < hr.bottom - 4 && dy <= 4) return; main = dy; side = dx; }
      else if (dir === "up") { if (r.bottom > hr.top + 4 && dy >= -4) return; main = -dy; side = dx; }
      else if (dir === "right") { if (r.left < hr.right - 4 && dx <= 4) return; main = dx; side = dy; }
      else { if (r.right > hr.left + 4 && dx >= -4) return; main = -dx; side = dy; }
      if (main <= 0) return;
      var score = main + Math.abs(side) * 2;
      if (score < bestScore) { bestScore = score; best = el; }
    });
    if (best) mark(best);
    return current;
  }
  function step(d) {   // next / previous in reading order (an encoder)
    var list = items(); if (!list.length) return null;
    var i = list.indexOf(from()); mark(list[i < 0 ? 0 : (i + (d < 0 ? -1 : 1) + list.length) % list.length]); return current;
  }
  function adjustable(el) { return el && (el.matches("input[type=range], input[type=number]") || el.tagName === "SELECT"); }
  function fire(el, type) { el.dispatchEvent(new Event(type, { bubbles: true })); }
  // a slider / number / list: one step up or down (as the arrow keys would)
  function nudge(el, d) {
    if (el.tagName === "SELECT") { var n = el.options.length; if (!n) return; var i = Math.max(0, Math.min(n - 1, el.selectedIndex + (d < 0 ? -1 : 1))); if (i !== el.selectedIndex) { el.selectedIndex = i; fire(el, "input"); fire(el, "change"); } return; }
    var min = el.min === "" ? -Infinity : Number(el.min), max = el.max === "" ? Infinity : Number(el.max), st = el.step === "any" || !Number(el.step) ? ((isFinite(max) && isFinite(min)) ? (max - min) / 100 : 1) : Number(el.step);
    if (el.type === "range" && isFinite(max) && isFinite(min)) st = Math.max(st, (max - min) / 50);
    var v = Math.max(min, Math.min(max, (Number(el.value) || 0) + (d < 0 ? -st : st)));
    el.value = String(Math.round(v / st) * st === v ? v : +v.toFixed(4)); fire(el, "input"); fire(el, "change");
  }
  // a knob: the highlighted slider / list follows the knob (0..1 = its whole range)
  function setValue(v) {
    var el = from(); if (!adjustable(el)) return false;
    v = Math.max(0, Math.min(1, Number(v) || 0));
    if (el.tagName === "SELECT") { var n = el.options.length; if (!n) return false; var i = Math.min(n - 1, Math.floor(v * n)); if (i !== el.selectedIndex) { el.selectedIndex = i; fire(el, "input"); fire(el, "change"); } return true; }
    var min = Number(el.min || 0), max = el.max === "" ? 100 : Number(el.max), stp = Number(el.step) || 0, val = min + (max - min) * v;
    if (stp) val = Math.round(val / stp) * stp;
    el.value = String(+val.toFixed(4)); fire(el, "input"); fire(el, "change"); return true;
  }
  function horizontal(dir) {   // left / right change a slider or a list; elsewhere they move
    var el = from(); if (adjustable(el) && el.type !== "number") { nudge(el, dir === "left" ? -1 : 1); return el; }
    return move(dir);
  }
  function ok() {
    var el = from(); if (!el) { mark(start()); return current; }
    if (el.tagName === "SELECT") { nudge(el, 1); return el; }   // (a list: OK goes to the next choice - a knob picks any)
    if (el.matches("input[type=range], input[type=number]")) return el;
    if (el.matches("input, textarea") && !el.matches("input[type=checkbox], input[type=radio], input[type=button], input[type=submit]")) { el.focus(); return el; }
    // a pad and other buttons that play on pointerdown: the same as a tap
    var down = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerType: "mouse" });
    var handled = !el.dispatchEvent(down);
    el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerType: "mouse" }));
    if (!handled) el.click();
    setTimeout(function () { if (!alive(current)) { var a = document.activeElement; mark(a && a !== document.body && alive(a) ? a : start()); } }, 120);
    return el;
  }
  function back() {
    var d = scope();
    if (d !== document.body) {
      var close = d.querySelector('[data-close], .close, button[aria-label="Close"], [data-dismiss]');
      if (d.tagName === "DIALOG" && d.close) d.close(); else if (close) close.click(); else d.classList.add("hidden");
      setTimeout(function () { mark(start()); }, 60); return true;
    }
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    if (current) { current.classList.remove("nav-focus"); current.blur(); current = null; }
    return false;
  }
  // the scroll box the highlight is in (else the open tab / dialog / page)
  function scroller() {
    function scrolls(el) { if (!el || el === document.body) return false; var cs = getComputedStyle(el); return /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 4; }
    for (var el = from(); el; el = el.parentElement) if (scrolls(el)) return el;
    var s = scope(); if (s !== document.body) { if (scrolls(s)) return s; var inner = Array.prototype.slice.call(s.querySelectorAll("*")).filter(scrolls)[0]; if (inner) return inner; }
    var tab = document.querySelector(".toptab:not(.hidden), main.app:not(.hidden), #perform:not(.hidden)");
    if (tab) { if (scrolls(tab)) return tab; var inside = Array.prototype.slice.call(tab.querySelectorAll("*")).filter(function (x) { return scrolls(x) && x.clientHeight > 120; })[0]; if (inside) return inside; }
    return document.scrollingElement || document.documentElement;
  }
  function scrollBy(d) { var s = scroller(); s.scrollBy({ top: d * Math.max(80, s.clientHeight * 0.6), behavior: "smooth" }); return s; }
  function scrollTo(v) { var s = scroller(); s.scrollTop = Math.max(0, Math.min(1, Number(v) || 0)) * Math.max(0, s.scrollHeight - s.clientHeight); return s; }

  // the ring follows a real tap too (it stays out of the way of touch: only shown after a nav action)
  document.addEventListener("pointerdown", function (e) { if (!e.isTrusted) return; if (current) current.classList.remove("nav-focus"); current = null; document.body.classList.remove("nav-active"); }, true);

  window.PPNav = { move: function (d) { return d === "left" || d === "right" ? horizontal(d) : move(d); }, step: step, ok: ok, back: back, scrollBy: scrollBy, scrollTo: scrollTo, setValue: setValue,
    current: function () { return from(); }, nudge: nudge };
})();
