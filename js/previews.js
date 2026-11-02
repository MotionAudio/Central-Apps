/* Central Pedal / Central Pedal Control / Central Control / Central Usage - Listen before you download (10.2).
 * Every pad, loop, instrument preset, keys preset and impulse response in the sound libraries has a 30-second preview
 * (tools/make-previews.py makes them when the libraries are built; the library list - the website's /v1/libraries or the
 * published libraries-index.json - says where each one is). This file is the play / stop button for them:
 *   PPPreview.button(preview, label?, class?)   a button that streams that preview (nothing is downloaded or installed)
 *   PPPreview.find(lib, kind, name, preset?)   a library's preview of one item (kind: pad, loops, loop, sound, preset, ir)
 *   PPPreview.forItem(libs, kind, name, preset?)   the same, looked for in every library of a list
 *   PPPreview.listHtml(lib)   a library's previews grouped by what they are, in a "Listen" fold
 *   PPPreview.play(url) / stop() / playing()
 * Only one preview plays at a time, in every app: starting one stops the one before. The same file runs in every app
 * (Central Control / Usage get a copy in app/shared/ - prepare-shared.sh; the website keeps an exact copy,
 * server/public/previews.js - test-previews.mjs checks they are the same). */
(function () {
  "use strict";
  var audio = null, cur = "", timer = 0;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function css() {
    if (document.getElementById("ppPreviewCss")) return;
    var st = document.createElement("style"); st.id = "ppPreviewCss";
    st.textContent = ".pv-btn{display:inline-flex;align-items:center;gap:.35em;min-width:6.2em;justify-content:center;white-space:nowrap;font-variant-numeric:tabular-nums;position:relative;overflow:hidden}" +
      ".pv-btn .pv-ico{width:0;height:0;border-style:solid;border-width:.42em 0 .42em .7em;border-color:transparent transparent transparent currentColor;display:inline-block}" +
      ".pv-btn.pv-on .pv-ico{border:0;width:.7em;height:.7em;background:currentColor;border-radius:1px}" +
      ".pv-btn .pv-bar{position:absolute;left:0;bottom:0;height:3px;background:currentColor;opacity:.55;width:0}" +
      ".pv-btn.pv-err{opacity:.7}.pv-list{margin:.4em 0 0}.pv-list summary{cursor:pointer}.pv-group{margin:.5em 0 0}.pv-group b{display:block;font-size:.85em;opacity:.75;margin-bottom:.25em}" +
      ".pv-items{display:flex;flex-wrap:wrap;gap:.35em .5em}.pv-item{display:inline-flex;align-items:center;gap:.4em}.pv-item .pv-name{font-size:.9em}";
    (document.head || document.documentElement).appendChild(st);
  }
  function clock(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ":" + (s % 60 < 10 ? "0" : "") + (s % 60); }
  function buttons(url) { return Array.prototype.slice.call(document.querySelectorAll("[data-pv]")).filter(function (b) { return b.getAttribute("data-pv") === url; }); }
  function paint(url, state, left, frac) {
    buttons(url).forEach(function (b) {
      var label = b.getAttribute("data-pv-label") || "Listen";
      b.classList.toggle("pv-on", state === "on" || state === "load");
      b.classList.toggle("pv-err", state === "err");
      var txt = state === "load" ? "Loading…" : state === "on" ? "Stop " + clock(left) : state === "err" ? (b.getAttribute("data-pv-why") || "No preview yet") : label;
      b.innerHTML = '<span class="pv-ico" aria-hidden="true"></span><span>' + esc(txt) + '</span><span class="pv-bar" style="width:' + Math.round((frac || 0) * 100) + '%"></span>';
      b.setAttribute("aria-pressed", state === "on" || state === "load" ? "true" : "false");
      b.title = state === "on" ? "Stop the preview" : "Hear 30 seconds of it (streams - nothing is downloaded)";
    });
  }
  function stop() {
    if (!audio) return;
    var was = cur; cur = "";
    try { audio.pause(); audio.removeAttribute("src"); audio.load(); } catch (_) { }
    clearInterval(timer); timer = 0;
    if (was) paint(was, "idle");
    try { window.dispatchEvent(new CustomEvent("pp-preview", { detail: { url: "", playing: false } })); } catch (_) { }
  }
  function play(url) {
    if (!url) return;
    if (cur === url) return stop();
    stop();
    css();
    if (!audio) {
      audio = new Audio(); audio.preload = "none";
      audio.addEventListener("ended", function () { stop(); });
      audio.addEventListener("error", function () {
        if (!cur) return;
        var u = cur, why = navigator.onLine === false ? "No internet here" : "No preview yet";
        cur = ""; clearInterval(timer); timer = 0;
        buttons(u).forEach(function (b) { b.setAttribute("data-pv-why", why); });
        paint(u, "err");
        setTimeout(function () { if (cur !== u) paint(u, "idle"); }, 4000);
      });
      audio.addEventListener("playing", function () { if (cur) paint(cur, "on", (audio.duration || 30) - audio.currentTime, 0); });
    }
    cur = url; paint(url, "load");
    audio.src = url;
    var p = audio.play(); if (p && p.catch) p.catch(function () { /* (the error event says why) */ });
    timer = setInterval(function () { if (!cur || audio.paused) return; var d = audio.duration || 30; paint(cur, "on", d - audio.currentTime, audio.currentTime / d); }, 250);
    try { window.dispatchEvent(new CustomEvent("pp-preview", { detail: { url: url, playing: true } })); } catch (_) { }
  }
  function button(p, label, cls) {
    if (!p || !p.url) return "";
    css();
    var playing = cur === p.url;
    return '<button type="button" class="pv-btn ' + esc(cls || "small") + (playing ? " pv-on" : "") + '" data-pv="' + esc(p.url) + '" data-pv-label="' + esc(label || "Listen") + '" aria-pressed="' + (playing ? "true" : "false") + '" title="Hear 30 seconds of it (streams - nothing is downloaded)">' +
      '<span class="pv-ico" aria-hidden="true"></span><span>' + esc(playing ? "Stop" : (label || "Listen")) + '</span><span class="pv-bar"></span></button>';
  }
  // (a SoundFont keeps 19-20 characters of a preset name: "Concert Grand (Steinway B)" is "Concert Grand (Stei")
  function same(a, b) { a = String(a || "").toLowerCase().trim(); b = String(b || "").toLowerCase().trim(); return a === b || (a.length >= 19 && b.length >= 19 && a.slice(0, 19) === b.slice(0, 19)); }
  function find(lib, kind, name, preset) {
    var list = lib && Array.isArray(lib.previews) ? lib.previews : [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (p.kind !== kind) continue;
      if (kind === "sound" && preset != null) { if (same(p.preset, preset) && (!name || same(p.name, name) || String(p.name || "").toLowerCase().indexOf(String(name).toLowerCase()) >= 0)) return p; continue; }
      if (same(p.name, name)) return p;
    }
    // (an instrument by its preset alone - the bank's name wasn't given)
    if (kind === "sound" && preset == null) for (var j = 0; j < list.length; j++) if (list[j].kind === "sound" && same(list[j].preset, name)) return list[j];
    return null;
  }
  function forItem(libs, kind, name, preset) {
    libs = Array.isArray(libs) ? libs : [];
    for (var i = 0; i < libs.length; i++) { var p = find(libs[i], kind, name, preset); if (p) return p; }
    return null;
  }
  var GROUPS = [["pad", "Pads"], ["loops", "Loop sets"], ["loop", "Loops"], ["sound", "Instruments"], ["preset", "Presets"], ["ir", "Cabinets and bodies (impulse responses)"]];
  function listHtml(lib, opts) {
    var list = lib && Array.isArray(lib.previews) ? lib.previews : [];
    if (!list.length) return "";
    css();
    opts = opts || {};
    var groups = GROUPS.map(function (g) {
      var items = list.filter(function (p) { return p.kind === g[0]; });
      if (!items.length) return "";
      return '<div class="pv-group"><b>' + esc(g[1]) + '</b><div class="pv-items">' + items.map(function (p) {
        var name = p.kind === "sound" ? p.preset : p.name;
        return '<span class="pv-item">' + button(p, "Listen") + '<span class="pv-name">' + esc(name) + "</span></span>";
      }).join("") + "</div></div>";
    }).join("");
    var expected = list.some(function (p) { return p.expected; });
    return '<details class="pv-list"' + (opts.open ? " open" : "") + '><summary>Listen before you download (' + list.length + " preview" + (list.length === 1 ? "" : "s") + ", 30 seconds each)</summary>" +
      (expected ? '<p class="muted small">These play once the library is published online.</p>' : "") + groups + "</details>";
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-pv]"); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    play(b.getAttribute("data-pv"));
  }, true);
  // (a page that redraws its list while one plays: the timer above repaints the new button within a quarter second)
  window.PPPreview = { button: button, find: find, forItem: forItem, listHtml: listHtml, play: play, stop: stop, playing: function () { return cur; }, same: same };
})();
