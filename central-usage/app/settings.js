/* Central Control - Settings: this computer (its name and role - roles.js - and, on the main admin, the People list), the lights' optional AI model,
 * updates and about. (Inputs, outputs and the audio host are on the I/O tab.) */
(function () {
  "use strict";
  var CU = window.CentralUsage, NAT = window.CU; if (!CU) return;
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var ai = null, version = null;
  // the license key (shared/license.js): an A key in Central Control, a U key in Central Usage
  if (window.PPLicense) window.PPLicense.init({ app: CU.edition() === "usage" ? "usage" : "control", deviceName: CU.appName + (navigator.platform ? " (" + navigator.platform + ")" : ""),
    production: (CU.config() || {}).production || "", onChange: function () { render(); }, onReady: function () { render(); } });
  // the person's preferences follow their account: the same on the church's device and at home
  if (window.PPLicense && window.PPLicense.syncSettings && CU.syncedPrefs) window.PPLicense.syncSettings(CU.edition() === "usage" ? "usage" : "control", { get: CU.syncedPrefs, apply: CU.applySyncedPrefs });
  function visible() { return CU.prefs.tab === "settings"; }
  function mb(n) { return Math.round((n || 0) / 1048576); }
  function aiCard() {
    if (!NAT || !NAT.ai) return '<section class="card"><h3>Lights: the AI helper</h3><p class="muted">Works in the Central Control app.</p></section>';
    var a = ai || {}, d = a.download || {}, inBox = a.bundled && a.serverBundled;
    // (10.0) it comes with Central Control: nothing to download or install
    if (inBox) return '<section class="card"><h3>Lights: the AI helper</h3><p class="muted">The "Tell it the show" box on the Lighting tab already understands simple instructions about colours, levels, lights, sections and hits. The AI helper that came with Central Control lets it follow looser sentences too, like "make the bridge feel like a sunrise". It runs on this computer and nothing goes online.</p>' +
      '<p class="small">✓ Ready - ' + esc(a.model || "") + (a.running ? " · running" : "") + "</p>" + (a.error ? '<p class="warn small">' + esc(a.error) + "</p>" : "") +
      '<label class="toggle"><input type="checkbox" data-st="ai-use"' + (CU.store.get("aiUse", true) ? " checked" : "") + "> Use it</label></section>";
    return '<section class="card"><h3>Lights: the AI helper</h3><p class="muted">The "Tell it the show" box on the Lighting tab already understands simple instructions about colours, levels, lights, sections and hits. The AI helper lets it follow looser sentences too. It runs on this computer and nothing goes online. It normally comes with Central Control, but this copy doesn\'t have it, so you can download it here.</p>' +
      '<table class="io-t"><tr><td>Model</td><td>' + esc(a.model || "") + " - " + (a.downloaded ? "✓ here" : d.active ? "downloading… " + mb(d.got) + (d.total ? " / " + mb(d.total) : "") + " MB" : "not downloaded") + "</td></tr>" +
      "<tr><td>llama.cpp</td><td>" + (a.server ? "✓ " + esc(a.server) : 'not found. Reinstalling Central Control puts it back (on Linux it can also come from the llama.cpp package).') + "</td></tr>" +
      (a.error ? '<tr><td></td><td class="warn">' + esc(a.error) + "</td></tr>" : "") + "</table>" +
      '<div class="row">' + (a.downloaded ? (a.bundled ? "" : '<button data-st="ai-remove">Remove the model</button>') : '<button data-st="ai-download"' + (d.active ? " disabled" : "") + ">Download the model (about 470 MB)</button>") + '<label class="toggle"><input type="checkbox" data-st="ai-use"' + (CU.store.get("aiUse", true) ? " checked" : "") + "> Use it when it's ready</label></div></section>";
  }
  function mixCard() {   // where the tracks go out of the audio interface (also on the Online mix tab)
    var X = window.CUMix, st = X && X.state; if (CU.mode() !== "admin") return "";
    if (!st) return '<section class="card"><h3>Tracks out of the interface</h3><p class="muted">This only matters on the computer that\'s the audio host (see the I/O tab).</p></section>';
    return '<section class="card"><h3>Tracks out of the interface</h3><div class="io-opts"><label class="io-opt' + (st.trackOut !== "direct" ? " on" : "") + '"><input type="radio" name="stTrackOut" value="sum"' + (st.trackOut !== "direct" ? " checked" : "") + '><span><b>a) Mixed here, summed</b><small>faders, EQ, compressor on the Online mix tab - out on two outputs (L / R)</small></span></label><label class="io-opt' + (st.trackOut === "direct" ? " on" : "") + '"><input type="radio" name="stTrackOut" value="direct"' + (st.trackOut === "direct" ? " checked" : "") + '><span><b>b) Each track on its own output</b><small>to the desk\'s inputs, one per track (from output ' + ((st.directFirst || 0) + 1) + ")</small></span></label></div><p class=\"muted small\">The outputs themselves are picked on the Online mix tab.</p></section>";
  }
  // (10.2) Settings is one page: the groups on the left (in the same order in every app), a search box over them, and
  // every group's options down the right - the list jumps to a group and the search shows only what matches.
  var GROUPS = [["sound", "Sound"], ["screens", "Screens & displays"], ["look", "Look"], ["controls", "Controls"], ["network", "This computer & devices"],
    ["planning", "Planning Center & CCLI"], ["lights", "Lights"], ["social", "Social media"], ["packages", "Packages & key"], ["updates", "Software updates"], ["about", "About"]];
  function link(title, text, tab, label) { return '<section class="card st-link"><h3>' + esc(title) + '</h3><p class="muted">' + esc(text) + '</p><button data-st-tab="' + tab + '">' + esc(label) + " →</button></section>"; }
  function shell(root) {
    if (root.querySelector(".st-page")) return;
    root.innerHTML = '<div class="st-page"><aside class="st-side"><input type="search" class="st-search" id="stSearch" placeholder="Search settings" aria-label="Search settings" autocomplete="off">' +
      '<nav class="st-nav" id="stNav"></nav></aside><div class="st-main" id="stMain"></div></div>';
    $("#stSearch", root).addEventListener("input", filter);
    $("#stNav", root).addEventListener("click", function (e) { var b = e.target.closest("[data-stg]"); if (b) go(b.dataset.stg); });
    $("#stMain", root).addEventListener("scroll", spy, { passive: true });
  }
  function render() {
    var root = $("#settingsRoot"); if (!root || !visible()) return;
    shell(root);
    var m = CU.mode(), usage = CU.edition && CU.edition() === "usage", admin = m === "admin" && !usage, NATIVE = !!(NAT && NAT.config);
    var parts = {
      sound: (window.CUTalk && window.CUTalk.card ? window.CUTalk.card() : "") + mixCard() +
        (NATIVE ? link("Inputs, outputs and recording", "The audio interface, which computer is the audio host, and recording.", "io", "Open I/O") : ""),
      screens: (admin && window.CUConfidence ? window.CUConfidence.card() : "") + (admin && window.CULyricsListen ? window.CULyricsListen.card() : ""),
      look: window.CUColors ? window.CUColors.card() : "",
      controls: link("MIDI, Stream Deck and footswitches", "Teach any button, knob or key to do something in " + CU.appName + ".", "controls", "Open Controls"),
      network: (window.CURoles ? window.CURoles.card() : "") + (window.CUHubStandby ? window.CUHubStandby.card() : "") +
        (admin && CU.role && CU.role() === "main" ? link("Every device on the team", "Computers, Central Pedals and phones: what each one does and whether it's online.", "devices", "Open Devices") : ""),
      planning: (admin && window.PPPlanningCenter ? window.PPPlanningCenter.settingsHtml("card") : "") + (!usage && window.PPCcli ? window.PPCcli.settingsHtml("card") : ""),
      lights: admin ? aiCard() : "",
      social: admin && CU.role && CU.role() === "main" && window.CUShorts && window.CUShorts.socialCard ? window.CUShorts.socialCard() : "",   // (10.3: shorts, posting, full videos)
      packages: window.PPLicense ? window.PPLicense.settingsHtml("card") : "",
      updates: '<section class="card"><h3>Updates</h3><p class="muted">' + esc(CU.appName) + ' looks for a new version once a day and installs it only when you say so.</p><button data-st="updates">Check for updates…</button></section>',
      about: '<section class="card"><h3>About</h3><p>' + esc(CU.appName) + " " + esc(version && version.app || "") + '</p><p class="muted small">' + (usage ? "For the musicians and singers on the team: your chord chart, your instrument, the lyrics and your own in-ear mix." : "For the people running the service: lights, slides and lyrics, the tracks mixer, the in-ear mixes and the cameras.") + '</p>' +
        '<details class="small"><summary>Credits</summary><p class="muted small">Real light profiles from the Open Fixture Library (MIT licence) and the QLC+ fixture definitions (Apache 2.0 licence). ' +
        "Sounds from the Versilian Community Sample Library and VSCO 2 Community Edition (CC0). Bibles: King James, World English Bible, American Standard and Reina-Valera 1909 (public domain). " +
        "PDF reading by pdf.js (Apache 2.0). The lighting and shorts AI: Qwen2.5 (Apache 2.0) run by llama.cpp (MIT). The full list is in CREDITS.md with the apps' source.</p></details></section>"
    };
    var groups = GROUPS.filter(function (g) { return parts[g[0]]; });
    var html = groups.map(function (g) { return '<section class="st-group" data-stg="' + g[0] + '"><h2>' + esc(g[1]) + '</h2><div class="io-grid">' + parts[g[0]] + "</div></section>"; }).join("");
    // redraw only when something changed, and never under someone typing (a half-typed package key or name stays)
    var main = $("#stMain", root);
    if (main.__h === html) return;
    var f = document.activeElement; if (f && main.contains(f) && /^(INPUT|TEXTAREA)$/.test(f.tagName) && f.type !== "checkbox" && f.type !== "radio" && f.type !== "range") return;
    var y = main.scrollTop;
    main.__h = html; main.innerHTML = html; main.scrollTop = y;
    $("#stNav", root).innerHTML = groups.map(function (g) { return '<button data-stg="' + g[0] + '">' + esc(g[1]) + "</button>"; }).join("");
    filter(); spy();
  }
  // the search: only the cards that mention every word; a group with nothing left fades out of the list
  function filter() {
    var root = $("#settingsRoot"), q = (($("#stSearch", root) || {}).value || "").trim().toLowerCase(), words = q.split(/\s+/).filter(Boolean);
    root.querySelectorAll(".st-group").forEach(function (g) {
      var name = g.querySelector("h2").textContent.toLowerCase(), any = false;
      g.querySelectorAll(".io-grid > *").forEach(function (c) {
        var t = (name + " " + c.textContent + " " + Array.prototype.map.call(c.querySelectorAll("input,select,button"), function (x) { return (x.placeholder || "") + " " + (x.title || ""); }).join(" ")).toLowerCase();
        var hit = !words.length || words.every(function (w) { return t.indexOf(w) >= 0; });
        c.classList.toggle("st-miss", !hit); if (hit) any = true;
      });
      g.classList.toggle("st-miss", !any);
      var nb = root.querySelector('#stNav [data-stg="' + g.dataset.stg + '"]'); if (nb) nb.classList.toggle("st-miss", !any);
    });
    var empty = root.querySelector(".st-none"), main = $("#stMain", root);
    if (words.length && !root.querySelector(".st-group:not(.st-miss)")) { if (!empty) { empty = document.createElement("p"); empty.className = "st-none muted"; main.appendChild(empty); } empty.textContent = 'No setting mentions "' + q + '". Try fewer words, or press Ctrl+K to search everything.'; }
    else if (empty) empty.remove();
  }
  function spy() {
    var root = $("#settingsRoot"), main = root && $("#stMain", root); if (!main) return;
    if (!main.offsetHeight) { if (!spy.later) { spy.later = true; requestAnimationFrame(function () { spy.later = false; if (main.offsetHeight) spy(); }); } return; }   // not on screen yet: measure once it is
    var top = main.getBoundingClientRect().top + 40, cur = null;
    main.querySelectorAll(".st-group:not(.st-miss)").forEach(function (g) { if (g.getBoundingClientRect().top <= top || !cur) cur = g.dataset.stg; });
    root.querySelectorAll("#stNav [data-stg]").forEach(function (b) { b.classList.toggle("on", b.dataset.stg === cur); });
  }
  // jump to a group (and, from the command search, light up one card in it)
  function go(group, find) {
    if (CU.prefs.tab !== "settings") CU.showTab("settings");
    render();
    var root = $("#settingsRoot"), s = $("#stSearch", root); if (s && s.value) { s.value = ""; filter(); }
    var g = root.querySelector('.st-group[data-stg="' + group + '"]'); if (!g) return false;
    var target = g;
    if (find) { var want = String(find).toLowerCase(); Array.prototype.some.call(g.querySelectorAll(".io-grid > *"), function (c) { if (c.textContent.toLowerCase().indexOf(want) >= 0) { target = c; return true; } return false; }); }
    target.scrollIntoView({ block: "start", behavior: "smooth" });
    target.classList.remove("st-flash"); void target.offsetWidth; target.classList.add("st-flash");
    setTimeout(spy, 400); return true;
  }
  function index() {   // every group and card, for the command search
    var root = $("#settingsRoot"), out = [];
    GROUPS.forEach(function (g) { out.push({ group: g[0], title: g[1], card: null, groupName: g[1] }); });
    if (root) root.querySelectorAll(".st-group").forEach(function (g) { g.querySelectorAll(".io-grid > * > h3").forEach(function (h) { out.push({ group: g.dataset.stg, title: h.textContent.trim(), card: h.textContent.trim(), groupName: g.querySelector("h2").textContent }); }); });
    return out;
  }
  var root = $("#settingsRoot");
  root.addEventListener("change", async function (e) {
    var t = e.target;
    if (t.name === "stTrackOut" && window.CUMix) { var st = window.CUMix.state; window.CUMix.op({ op: "trackOut", value: t.value, first: st ? st.directFirst || 0 : 0 }); setTimeout(render, 300); return; }
    if (window.CURoles && await window.CURoles.onSettingsChange(t)) { if (window.CUMix) window.CUMix.choose(); return; }
    if (t.dataset.st === "name") { var nm = t.value.trim(); CU.store.set("name", nm); var c = CU.config(); c.name = nm; if (NAT && NAT.config) CU.setConfig(await NAT.config.set({ name: nm })); else CU.setConfig(c); }
    else if (t.dataset.st === "ai-use") CU.store.set("aiUse", t.checked);
  });
  root.addEventListener("click", async function (e) {
    var b = e.target.closest("button"); if (!b) return;
    if (b.dataset.stTab) { CU.showTab(b.dataset.stTab); return; }
    if (b.dataset.rl && window.CURoles) { await window.CURoles.onSettingsClick(b); if (window.CUMix) window.CUMix.choose(); return; }
    if (b.dataset.st === "updates" && window.CUUpdates) window.CUUpdates.open();
    else if (b.dataset.st === "ai-download") { NAT.ai.download().then(function (s) { ai = s; render(); }); setTimeout(function () { NAT.ai.status().then(function (s) { ai = s; render(); }); }, 300); }
    else if (b.dataset.st === "ai-remove") { ai = await NAT.ai.remove(); render(); }
  });
  if (NAT && NAT.ai) { NAT.ai.status().then(function (s) { ai = s; }); NAT.ai.on(function (s) { ai = s; if (visible()) render(); }); }
  if (NAT && NAT.version) NAT.version().then(function (v) { version = v; });
  CU.on("tab", function (t) { if (t === "settings") { if (NAT && NAT.ai) NAT.ai.status().then(function (s) { ai = s; render(); }); render(); } });
  CU.on("mode", function () { if (visible()) render(); });
  CU.on("connected", function () { if (visible()) render(); });
  window.CUSettings = { render: render, go: go, index: index, GROUPS: GROUPS };
})();
