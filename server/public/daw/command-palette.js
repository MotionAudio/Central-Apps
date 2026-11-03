/* Motion Audio Central - the command search (10.2): Ctrl+K / ⌘K in Central Control, Central Usage and Central
 * Production. One box finds songs, setlists, settings, lights presets, slide decks and actions, and Enter does it.
 *
 *   CmdK.register(provider)   provider() returns [{ title, sub?, group, keywords?, run }] (called each time it opens,
 *                             so lists are always current)
 *   CmdK.open(text?)  CmdK.close()  CmdK.isOpen()
 *
 * Shared file: server/public/daw/command-palette.js (copied into Central Usage by prepare-shared.sh). */
(function () {
  "use strict";
  if (window.CmdK) return;
  var providers = [], el = null, items = [], shown = [], sel = 0, lastFocus = null;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function norm(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  // a score: whole words first, then the start of a word, then letters in order (so "pre chk" finds "Pre-service check")
  function score(item, q) {
    if (!q) return 1;
    var hay = norm(item.title + " " + (item.sub || "") + " " + (item.keywords || "") + " " + (item.group || ""));
    var t = norm(item.title), words = q.split(/\s+/).filter(Boolean), s = 0;
    for (var i = 0; i < words.length; i++) {
      var w = words[i], at = hay.indexOf(w);
      if (at < 0) {   // letters in order
        var k = 0, j = 0; for (; j < hay.length && k < w.length; j++) if (hay[j] === w[k]) k++;
        if (k < w.length) return 0; s += 1; continue;
      }
      s += (t.indexOf(w) === 0 ? 30 : t.indexOf(w) >= 0 ? 20 : 8) + (at === 0 || /\W/.test(hay[at - 1] || " ") ? 6 : 0);
    }
    return s;
  }
  function collect() {
    var out = [];
    providers.forEach(function (p) { try { var r = p(); if (r && r.length) out = out.concat(r); } catch (e) { if (window.console) console.warn("command search:", e); } });
    return out.filter(function (x) { return x && x.title && typeof x.run === "function"; });
  }
  function build() {
    el = document.createElement("div"); el.className = "cmdk"; el.hidden = true; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Search everything");
    el.innerHTML = '<div class="cmdk-box"><div class="cmdk-in"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M10 3a7 7 0 0 1 5.6 11.2l5.1 5.1-1.4 1.4-5.1-5.1A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10z"/></svg>' +
      '<input type="search" placeholder="Search songs, settings, presets, slides and actions…" aria-label="Search" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></div>' +
      '<div class="cmdk-list" role="listbox"></div><div class="cmdk-foot muted small"><span><kbd>↑</kbd><kbd>↓</kbd> to move</span><span><kbd>Enter</kbd> to go</span></div></div>';
    document.body.appendChild(el);
    var input = el.querySelector("input");
    input.addEventListener("input", function () { sel = 0; paint(); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { sel = Math.min(shown.length - 1, sel + 1); paint(true); e.preventDefault(); }
      else if (e.key === "ArrowUp") { sel = Math.max(0, sel - 1); paint(true); e.preventDefault(); }
      else if (e.key === "Enter") { go(shown[sel]); e.preventDefault(); }
      else if (e.key === "Escape") { close(); e.preventDefault(); }
    });
    el.addEventListener("mousedown", function (e) { if (e.target === el) close(); });
    el.querySelector(".cmdk-list").addEventListener("click", function (e) { var r = e.target.closest("[data-i]"); if (r) go(shown[+r.dataset.i]); });
    el.querySelector(".cmdk-list").addEventListener("mousemove", function (e) { var r = e.target.closest("[data-i]"); if (r && +r.dataset.i !== sel) { sel = +r.dataset.i; paint(true); } });
  }
  function paint(keepList) {
    var list = el.querySelector(".cmdk-list"), q = norm(el.querySelector("input").value.trim());
    if (!keepList) {
      shown = items.map(function (it, i) { return { it: it, s: score(it, q), i: i }; }).filter(function (x) { return x.s > 0; })
        .sort(function (a, b) { return q ? b.s - a.s || a.i - b.i : a.i - b.i; }).slice(0, 60).map(function (x) { return x.it; });
      if (!q) {   // nothing typed: a few of each kind, actions first
        var per = {}; shown = shown.filter(function (x) { per[x.group] = (per[x.group] || 0) + 1; return per[x.group] <= 6; });
      }
    }
    if (!shown.length) { list.innerHTML = '<div class="cmdk-empty">Nothing matches "' + esc(el.querySelector("input").value) + '". Try fewer letters, or a word like "settings".</div>'; return; }
    var h = "", g = null;
    shown.forEach(function (it, i) {
      if (it.group !== g) { g = it.group; h += '<div class="cmdk-group">' + esc(g) + "</div>"; }
      h += '<div class="cmdk-row' + (i === sel ? " on" : "") + '" role="option" aria-selected="' + (i === sel) + '" data-i="' + i + '"><b>' + esc(it.title) + "</b>" + (it.sub ? '<span class="muted">' + esc(it.sub) + "</span>" : "") + "</div>";
    });
    list.innerHTML = h;
    var on = list.querySelector(".on"); if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest" });
  }
  function go(it) { if (!it) return; close(); setTimeout(function () { try { it.run(); } catch (e) { if (window.console) console.warn("command search:", e); } }, 0); }
  function open(text) {
    if (!el) build();
    lastFocus = document.activeElement; items = collect(); sel = 0;
    el.hidden = false; var input = el.querySelector("input"); input.value = text || ""; paint(); input.focus(); input.select();
  }
  function close() { if (!el || el.hidden) return; el.hidden = true; if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (_) { } }
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === "k" || e.key === "K")) { e.preventDefault(); if (el && !el.hidden) close(); else open(); }
  }, true);
  window.CmdK = { register: function (p) { if (typeof p === "function") providers.push(p); }, open: open, close: close, isOpen: function () { return !!el && !el.hidden; }, score: score };
})();
