/* Central Pedal / Central Pedal Control - the command search (10.2, docs/DESIGN-SYSTEM.md rule 5).
 * Ctrl+K / ⌘K (or the Search button in the top bar) opens one box that finds songs, setlists, every setting (it opens
 * Settings at that option and highlights it) and actions ("Start pad sound", "Test sound", "Save project"...).
 * The same index of settings drives the search box over the Settings groups (PPCommand.searchSettings). */
(function () {
  "use strict";
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim(); }
  function visible(el) { return !!(el && (el.offsetParent || el.getClientRects().length)); }
  function project() { try { return window.PP && PP.project ? PP.project() : null; } catch (_) { return null; } }

  // ------------------------------------------------------------- what can be found
  var TABS = [["live", "Live", "the big-button screen for the service"], ["pads", "Pad", "pads, their sound and effects"], ["tracks", "Tracks", "songs, sections, the mixer"],
    ["instrument", "Instrument", "guitar / keys sounds and pedals"], ["looper", "Looper", "three loops"], ["configure", "Controls", "buttons, knobs and pedals: what each one does"],
    ["learn", "Learn", "learn a MIDI or Stream Deck control"], ["io", "I/O", "inputs, outputs and network audio"], ["settings", "Settings", "sound, screens, look, Wi-Fi, packages, updates"]];
  // actions: [label, words people might type, the button that does it (clicked if it's in the page)]
  var ACTIONS = [["Start pad sound", "play start pad sound on", "#startButton"], ["Stop all sound", "stop silence panic", "#stopButton"],
    ["Perform (big buttons)", "perform big buttons stage", "#performButton"], ["Open the setlist", "setlist songs order service", "#setlistButton"],
    ["Save project", "save project set", "#saveProject"], ["Open a project", "open load project", "#openProject"],
    ["Import a sound", "import audio sample mp3 wav usb sd", "#importAudio"], ["Play pads from the keyboard", "computer keyboard play", "#keyboardButton"],
    ["Add a song", "new song add", "#songAdd"], ["Edit this song", "song editor sections lyrics chords", "#trEdit"],
    ["Test sound", "test tone headphones no sound output", function () { go("settings"); open("audio", "#soundTest"); }],
    ["Check for updates", "software update upgrade version", function () { go("settings"); open("software"); }],
    ["Colours and look", "theme colour color look appearance", function () { go("settings"); open("look"); }],
    ["Wi-Fi", "wifi wireless network internet", function () { go("settings"); open("network"); }],
    ["Packages and key", "license key package plan library libraries", function () { go("settings"); open("packages"); }]];
  function go(tab) { if (window.PPShell) PPShell.showTab(tab); }
  function open(group, sel) {
    if (window.PPSettings && PPSettings.showGroup) PPSettings.showGroup(group);
    if (sel) setTimeout(function () { flash($(sel)); }, 60);
  }
  function flash(el) {
    if (!el) return;
    try { el.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (_) { el.scrollIntoView(); }
    el.classList.remove("st-hit"); void el.offsetWidth; el.classList.add("st-hit");
    setTimeout(function () { el.classList.remove("st-hit"); }, 2000);
    var f = el.matches && el.matches("input,select,textarea,button") ? el : el.querySelector && el.querySelector("input,select,textarea,button");
    if (f) try { f.focus({ preventScroll: true }); } catch (_) { }
  }

  // every option in Settings: a card's heading, and each label / toggle / button in it
  function settingsIndex() {
    var out = [], cards = document.querySelectorAll("#systemDialog > section, #sysExtra > section");
    var groupName = function (st) { var g = window.PPSettings && PPSettings.groupFor ? PPSettings.groupFor(st) : null; return g || ["system", "Settings"]; };
    cards.forEach(function (sec) {
      var st = sec.dataset.st || "", g = groupName(st), h = $("h3", sec) || $("h2", sec), card = h ? h.textContent.trim() : "";
      if (card) out.push({ kind: "setting", label: card, where: g[1], words: norm(card + " " + g[1]), el: sec, group: g[0] });
      sec.querySelectorAll("label, .toggle, button[id], h4, summary").forEach(function (el) {
        var t = (el.childNodes.length ? Array.prototype.map.call(el.childNodes, function (n) { return n.nodeType === 3 ? n.textContent : n.tagName === "SPAN" || n.tagName === "B" ? n.textContent : ""; }).join(" ") : el.textContent).replace(/\s+/g, " ").trim();
        if (!t || t.length < 3 || t.length > 90) return;
        out.push({ kind: "setting", label: t, where: g[1] + (card ? " › " + card : ""), words: norm(t + " " + card), el: el, group: g[0] });
      });
    });
    return out;
  }
  function searchSettings(q) {
    var n = norm(q); if (!n) return [];
    var words = n.split(" "), seen = {};
    return settingsIndex().filter(function (it) { return words.every(function (w) { return it.words.indexOf(w) >= 0; }); })
      .filter(function (it) { var k = it.where + "|" + it.label; if (seen[k]) return false; seen[k] = 1; return true; })
      .sort(function (a, b) { return score(b, n) - score(a, n); }).slice(0, 30);
  }
  function score(it, n) { var l = norm(it.label); return (l === n ? 100 : 0) + (l.indexOf(n) === 0 ? 40 : 0) + (l.indexOf(n) >= 0 ? 20 : 0) - l.length / 50; }
  function openSetting(it) {
    go("settings");
    if (window.PPSettings && PPSettings.showGroup) PPSettings.showGroup(it.group);
    setTimeout(function () { flash(it.el); }, 80);
  }

  function results(q) {
    var n = norm(q), words = n ? n.split(" ") : [], hit = function (s) { var t = norm(s); return words.every(function (w) { return t.indexOf(w) >= 0; }); }, out = [];
    var p = project();
    if (p && Array.isArray(p.songs)) p.songs.forEach(function (s, i) {
      if (!n || hit(s.name + " " + (s.key || "") + " " + (s.artist || ""))) out.push({ group: "Songs", icon: "♫", label: s.name || "Song " + (i + 1), note: [s.key, s.bpm ? s.bpm + " BPM" : ""].filter(Boolean).join(" · "), run: function () { if (window.PPFeatures && PPFeatures.loadSong) PPFeatures.loadSong(i); go("tracks"); } });
    });
    if (n && p && Array.isArray(p.setlists)) p.setlists.forEach(function (sl) { if (hit(sl.name)) out.push({ group: "Setlists", icon: "☰", label: sl.name, note: (sl.songs || []).length + " songs", run: function () { if (window.PPSetlists) PPSetlists.open(); } }); });
    TABS.forEach(function (t) { if (!n || hit(t[1] + " " + t[2])) out.push({ group: "Go to", icon: "→", label: t[1], note: t[2], run: function () { go(t[0]); } }); });
    ACTIONS.forEach(function (a) {
      if (n && !hit(a[0] + " " + a[1])) return;
      if (typeof a[2] === "string") { var el = $(a[2]); if (!el) return; out.push({ group: "Do", icon: "▸", label: a[0], run: function () { if (!visible(el) && window.PPShell) { if (/#tr|#song/.test(a[2])) go("tracks"); else go("pads"); } el.click(); } }); }
      else out.push({ group: "Do", icon: "▸", label: a[0], run: a[2] });
    });
    if (n) searchSettings(q).forEach(function (it) { out.push({ group: "Settings", icon: "⚙", label: it.label, note: it.where, run: function () { openSetting(it); } }); });
    if (!n) out = out.slice(0, 40);
    return out.slice(0, 60);
  }

  // ------------------------------------------------------------- the box
  var dlg = null, list = [], sel = 0;
  function build() {
    dlg = document.createElement("dialog"); dlg.className = "cmd"; dlg.setAttribute("aria-label", "Search");
    dlg.innerHTML = '<div class="cmd-in"><span aria-hidden="true">⌕</span><input id="cmdInput" placeholder="Find a song, a setting or an action" autocomplete="off" spellcheck="false" aria-controls="cmdList"></div>' +
      '<div class="cmd-list" id="cmdList" role="listbox"></div><div class="cmd-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> to move</span><span><kbd>Enter</kbd> to open</span><span><kbd>Esc</kbd> to close</span></div>';
    document.body.appendChild(dlg);
    var input = $("#cmdInput", dlg);
    input.addEventListener("input", function () { sel = 0; draw(input.value); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(list.length - 1, sel + 1); mark(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); mark(); }
      else if (e.key === "Enter") { e.preventDefault(); pick(sel); }
    });
    $("#cmdList", dlg).addEventListener("click", function (e) { var b = e.target.closest("[data-i]"); if (b) pick(+b.dataset.i); });
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
  }
  function draw(q) {
    list = results(q); var box = $("#cmdList", dlg), html = "", last = "";
    if (!list.length) { box.innerHTML = '<div class="cmd-empty">Nothing matches “' + esc(q) + '”. Try a song name, “wifi”, “click” or “update”.</div>'; return; }
    list.forEach(function (r, i) {
      if (r.group !== last) { html += '<div class="cmd-group">' + esc(r.group) + "</div>"; last = r.group; }
      html += '<button role="option" data-i="' + i + '"' + (i === sel ? ' class="on" aria-selected="true"' : "") + "><i>" + esc(r.icon) + "</i><span>" + esc(r.label) + "</span><small>" + esc(r.note || "") + "</small></button>";
    });
    box.innerHTML = html;
  }
  function mark() { dlg.querySelectorAll("[data-i]").forEach(function (b) { var on = +b.dataset.i === sel; b.classList.toggle("on", on); b.setAttribute("aria-selected", on ? "true" : "false"); if (on) b.scrollIntoView({ block: "nearest" }); }); }
  function pick(i) { var r = list[i]; if (!r) return; dlg.close(); try { r.run(); } catch (e) { console.warn("command search:", e); } }
  function show(q) {
    if (!dlg) build();
    var input = $("#cmdInput", dlg); input.value = q || ""; sel = 0; draw(input.value);
    if (!dlg.open) dlg.showModal(); input.focus(); input.select();
  }
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "k" || e.key === "K")) { e.preventDefault(); if (dlg && dlg.open) dlg.close(); else show(); }
  });
  function wire() { var b = $("#cmdOpen"); if (b && !b.__cmd) { b.__cmd = 1; b.addEventListener("click", function () { show(); }); } }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire); else wire();
  window.PPCommand = { open: show, results: results, searchSettings: searchSettings, openSetting: openSetting, flash: flash };
})();
