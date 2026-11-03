/* Central Control / Central Usage - the 10.2 shell (docs/DESIGN-SYSTEM.md): one top bar in the same order in every app,
 * the tabs this computer's jobs need with the rest under More, the Central Pedal's connection as a status chip that
 * opens its address / Find / pairing code, the account button, Ctrl+K search everything, Ctrl+, Settings, and the
 * small ⋯ menus the tabs use to keep rare options out of the way (CUShell.menu). */
(function () {
  "use strict";
  var CU = window.CentralUsage; if (!CU) return;
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  // ------------------------------------------------------------------ the connection chip
  var chip = $("#connChip"), pop = $("#connPop");
  function setPop(open) { if (!pop) return; pop.hidden = !open; chip.setAttribute("aria-expanded", open ? "true" : "false"); if (open) { var h = $("#host"); if (h && !CU.state.connected) setTimeout(function () { h.focus(); h.select(); }, 0); } }
  if (chip && pop) {
    chip.addEventListener("click", function (e) { e.stopPropagation(); setPop(pop.hidden); });
    pop.addEventListener("click", function (e) { e.stopPropagation(); var b = e.target.closest("button"); if (b && (b.id === "connectBtn" || b.id === "findBtn" || b.id === "codeBtn")) setTimeout(function () { setPop(false); }, 0); });
    $("#host").addEventListener("keydown", function (e) { if (e.key === "Enter") setTimeout(function () { setPop(false); }, 0); });
    document.addEventListener("click", function (e) { if (!pop.hidden && !e.target.closest("#connWrap")) setPop(false); });
  }
  // the chip says where things stand in a few words; the dot keeps its colour (app.js sets #dot and #connInfo)
  function chipState() {
    if (!chip) return;
    chip.classList.toggle("ok", !!CU.state.connected); chip.classList.toggle("off", !CU.state.connected);
  }
  CU.on("connected", chipState); CU.on("disconnected", chipState); setInterval(chipState, 2000); chipState();

  // ------------------------------------------------------------------ the tabs: what fits, the rest under More
  var nav = $("#tabs"), more = null, menu = null, order = [];
  function setupMore() {
    if (!nav || more) return;
    order = Array.prototype.slice.call(nav.querySelectorAll(".tab[data-tab]"));
    more = document.createElement("div"); more.className = "tab-more"; more.hidden = true;
    more.innerHTML = '<button class="tab tab-morebtn" type="button" aria-haspopup="true" aria-expanded="false">More <span aria-hidden="true">▾</span></button><div class="tab-menu" role="menu" hidden></div>';
    nav.appendChild(more); menu = more.querySelector(".tab-menu");
    var mb = more.querySelector(".tab-morebtn");
    mb.addEventListener("click", function (e) {
      e.stopPropagation(); menu.hidden = !menu.hidden; mb.setAttribute("aria-expanded", menu.hidden ? "false" : "true");
      if (!menu.hidden) { var r = mb.getBoundingClientRect(); menu.style.top = (r.bottom + 6) + "px"; menu.style.left = Math.max(8, Math.min(window.innerWidth - 220, r.left)) + "px"; }   // (fixed: the tab strip clips what overflows it)
    });
    menu.addEventListener("click", function () { menu.hidden = true; mb.setAttribute("aria-expanded", "false"); setTimeout(fit, 0); });
    document.addEventListener("click", function (e) { if (!menu.hidden && !e.target.closest(".tab-more")) { menu.hidden = true; mb.setAttribute("aria-expanded", "false"); } });
  }
  function fit() {
    if (!nav) return; setupMore();
    // everything back in order first
    order.forEach(function (b) { nav.insertBefore(b, more); });
    more.hidden = true;
    var visible = order.filter(function (b) { return !b.hidden; });
    // group starts get a little gap (the CSS draws it): Service | music | stage | sound | after | setup
    var prev = null; visible.forEach(function (b) { b.classList.toggle("gs", !!prev && prev !== b.dataset.group); prev = b.dataset.group; });
    if (nav.scrollWidth <= nav.clientWidth + 1) return;
    more.hidden = false;
    var active = CU.prefs.tab, moved = [];
    for (var i = visible.length - 1; i >= 0 && nav.scrollWidth > nav.clientWidth + 1; i--) {
      if (visible[i].dataset.tab === active) continue;
      moved.unshift(visible[i]);
      menu.insertBefore(visible[i], menu.firstChild);
    }
    moved.forEach(function (b) { b.classList.remove("gs"); });
    var mbtn = more.querySelector(".tab-morebtn"), inMenu = moved.some(function (b) { return b.dataset.tab === active; });
    mbtn.classList.toggle("active", inMenu);
  }
  var fitT = 0; function fitSoon() { clearTimeout(fitT); fitT = setTimeout(fit, 30); }
  window.addEventListener("resize", fitSoon); CU.on("tab", fitSoon); CU.on("mode", fitSoon); CU.on("ready", fitSoon); CU.on("connected", fitSoon);
  if (window.ResizeObserver) { var hdr = $("header.top"); if (hdr) new ResizeObserver(fitSoon).observe(hdr); }
  // tabs outside the nav (the Settings gear): the same click as a tab
  document.addEventListener("click", function (e) { var b = e.target.closest(".tab[data-tab]"); if (b && !b.closest("#tabs")) CU.showTab(b.dataset.tab); });
  setTimeout(fit, 0); setTimeout(fit, 600);

  // ------------------------------------------------------------------ the account button and the church's name
  var acct = $("#acctBtn");
  function who() {
    var L = window.PPLicense, st = L && L.state ? L.state() : null, c = CU.config ? CU.config() || {} : {};
    var church = (st && (st.production || st.church)) || c.production || "", person = (st && (st.name || st.email)) || CU.store.get("name", "") || "";
    return { church: church, person: person };
  }
  function paintWho() {
    var w = who(), sub = $("#brandSub"); if (sub) sub.textContent = w.church || "";
    if (acct) {
      var src = w.person || w.church || "", ini = src.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(function (x) { return x[0]; }).join("").toUpperCase();
      $("#acctInitials").textContent = ini || "·";
      acct.title = (w.person ? w.person + (w.church ? " · " + w.church : "") : w.church || "Your account") + " - key, packages and purchases";
    }
  }
  if (acct) acct.addEventListener("click", function () { if (window.CUSettings && window.CUSettings.go) window.CUSettings.go("packages"); else CU.showTab("settings"); });
  if (window.PPLicense && window.PPLicense.on) try { window.PPLicense.on("change", paintWho); } catch (_) { }
  CU.on("ready", paintWho); setTimeout(paintWho, 300); setInterval(paintWho, 5000);

  // ------------------------------------------------------------------ keyboard: Ctrl+, Settings
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === ",") { e.preventDefault(); CU.showTab("settings"); }
    if (e.key === "Escape" && pop && !pop.hidden) setPop(false);
  });

  // ------------------------------------------------------------------ ⋯ menus for the tabs (rare options kept close by)
  // CUShell.menu(label, html): a small disclosure button whose panel holds html; clicks inside work as before
  function menuHtml(label, inner, cls) {
    return '<details class="ux-menu' + (cls ? " " + cls : "") + '"><summary title="' + esc(label) + '">' + esc(label) + '</summary><div class="ux-pop">' + inner + "</div></details>";
  }
  document.addEventListener("click", function (e) {   // one open at a time; a click outside closes it, so does picking a button in it
    document.querySelectorAll("details.ux-menu[open]").forEach(function (d) { if (!d.contains(e.target)) d.open = false; });
    var b = e.target.closest && e.target.closest(".ux-pop button"); if (b) { var d = b.closest("details.ux-menu"); if (d && !d.classList.contains("ux-stay")) setTimeout(function () { d.open = false; }, 0); }
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") document.querySelectorAll("details.ux-menu[open]").forEach(function (d) { d.open = false; }); });

  // ------------------------------------------------------------------ Ctrl+K: search everything
  var TAB_NAMES = { service: "Service", chart: "Chord chart", instrument: "Instrument", studio: "Studio", lights: "Lighting", lyrics: "Lyrics", slides: "Slides", video: "Video", mix: "Online mix", inears: "In-ears", shorts: "Shorts", devices: "Devices", io: "I/O", controls: "Controls", settings: "Settings" };
  function allowed(t) { var b = document.querySelector('.tab[data-tab="' + t + '"]'); return b && !b.hidden; }
  function clickWhen(sel, tries) { var el = document.querySelector(sel); if (el) { el.click(); return; } if ((tries || 0) < 20) setTimeout(function () { clickWhen(sel, (tries || 0) + 1); }, 150); }
  if (window.CmdK) {
    // tabs
    window.CmdK.register(function () {
      return Object.keys(TAB_NAMES).filter(allowed).map(function (t) { return { group: "Go to", title: TAB_NAMES[t], keywords: t, run: function () { CU.showTab(t); } }; });
    });
    // actions
    window.CmdK.register(function () {
      var a = [], admin = CU.mode() === "admin";
      a.push({ group: "Actions", title: "Connect to a Central Pedal", keywords: "pedal address find pairing code", run: function () { setPop(true); } });
      if (allowed("service")) {
        a.push({ group: "Actions", title: "Pre-service check", sub: "Check everything before the service", keywords: "precheck check status ready", run: function () { CU.showTab("service"); clickWhen("#serviceRoot [data-svv='check']"); setTimeout(function () { clickWhen("#serviceRoot [data-pc='run']"); }, 250); } });
        a.push({ group: "Actions", title: "New run sheet", sub: "Answer a few questions and it builds the service", keywords: "runsheet order of service plan wizard", run: function () { CU.showTab("service"); clickWhen("#serviceRoot [data-svv='sheets']"); setTimeout(function () { clickWhen("#serviceRoot [data-sv='wizard']"); }, 250); } });
      }
      if (allowed("video")) {
        a.push({ group: "Actions", title: "Start the stream", sub: "Video → Go live", keywords: "live stream youtube facebook go live", run: function () { CU.showTab("video"); clickWhen('[data-act="golive"]'); } });
        a.push({ group: "Actions", title: "Record the stream", sub: "Video → Record", keywords: "record mp4", run: function () { CU.showTab("video"); clickWhen('[data-da="rec"]'); } });
      }
      if (allowed("lights")) {
        a.push({ group: "Actions", title: "Blackout", sub: "Every light off", keywords: "lights off dark", run: function () { CU.showTab("lights"); clickWhen("#lxBlackout"); } });
        a.push({ group: "Actions", title: "Build my stage", sub: "Answer a few questions and it builds the stage", keywords: "stage wizard room seats trusses", run: function () { CU.showTab("lights"); clickWhen('[data-ext3="build"]'); } });
      }
      if (allowed("shorts")) a.push({ group: "Actions", title: "Make shorts from the last service", keywords: "shorts clips social youtube instagram tiktok", run: function () { CU.showTab("shorts"); } });
      a.push({ group: "Actions", title: "Check for updates", keywords: "update version", run: function () { if (window.CUUpdates) window.CUUpdates.open(); } });
      if (admin && allowed("lyrics")) a.push({ group: "Actions", title: "Confidence monitor colours", sub: "The band's screen", keywords: "band screen stage display yellow white", run: function () { if (window.CUSettings) window.CUSettings.go("screens", "Confidence"); } });
      return a;
    });
    // songs (from the Central Pedal / the main admin's library)
    window.CmdK.register(function () {
      var d = CU.state.display, songs = d && d.songs || [];
      return songs.map(function (s, i) { return { group: "Songs", title: s.name || "Song " + (i + 1), sub: [s.key ? "Key " + s.key : "", s.bpm ? s.bpm + " BPM" : ""].filter(Boolean).join(" · "), run: function () {
        if (allowed("chart")) { CU.showTab("chart"); var p = $("#songPick"); if (p) { var f = $("#follow"); if (f && f.checked) f.click(); p.value = String(i); p.dispatchEvent(new Event("change", { bubbles: true })); } }
        else if (allowed("lyrics")) CU.showTab("lyrics");
      } }; });
    });
    // settings: every group and card
    window.CmdK.register(function () {
      if (!window.CUSettings || !window.CUSettings.index) return [];
      var seen = {};
      return window.CUSettings.index().filter(function (x) { var k = x.group + "|" + x.title; if (seen[k]) return false; seen[k] = 1; return true; })
        .map(function (x) { return { group: "Settings", title: x.title, sub: x.card ? x.groupName : "Settings", keywords: "settings preferences options", run: function () { window.CUSettings.go(x.group, x.card); } }; });
    });
    // lights presets
    window.CmdK.register(function () {
      var L = window.CULights, show = L && L.show ? L.show() : null, looks = show && show.looks || [];
      if (!allowed("lights")) return [];
      return looks.map(function (l) { return { group: "Lights presets", title: l.name || "Preset", sub: "Fire it now", keywords: "look scene preset lights", run: function () { CU.showTab("lights"); var b = document.querySelector('#lxLookList [data-look="' + l.id + '"], #lxPalette [data-look="' + l.id + '"]'); if (b) b.click(); else if (L.goLook) L.goLook(l.id); } }; });
    });
    // slide decks and named slides
    window.CmdK.register(function () {
      var S = window.CUSlides; if (!S || !S.names || !allowed("slides")) return [];
      return S.names().slice(0, 200).map(function (n) { return { group: "Slides", title: n, sub: "Go live", keywords: "slide deck", run: function () { CU.showTab("slides"); var f = S.findByName(n); if (f && S.goLiveSlide) S.goLiveSlide(f.deckId, f.slideId); } }; });
    });
  }
  // the search button in the top bar (the same as Ctrl+K)
  (function () {
    var hdr = $("header.top"); if (!hdr || !window.CmdK) return;
    var b = document.createElement("button"); b.className = "cmdk-open"; b.type = "button"; b.title = "Search everything (Ctrl+K)"; b.setAttribute("aria-label", "Search everything");
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M10 3a7 7 0 0 1 5.6 11.2l5.1 5.1-1.4 1.4-5.1-5.1A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10z"/></svg><span>Search</span><kbd>' + (/Mac/.test(navigator.platform) ? "⌘K" : "Ctrl K") + "</kbd>";
    b.addEventListener("click", function () { window.CmdK.open(); });
    hdr.insertBefore(b, $("#cdChip"));
  })();

  window.CUShell = { fit: fit, menu: menuHtml, connection: setPop };
})();
