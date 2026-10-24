/* Central Pedal / Central Control / Central Usage - Settings → Packages → Libraries (9.8): the sound libraries, one per
 * sound plan (Central Keys, Central Instrument, Central Plugins, Central Pedals). Like the apps, anyone can download them;
 * what's inside only opens with the plan. The list comes from the website (/v1/libraries) - or, with no website yet, the
 * built-in list below - and shows the libraries of the plans this device has (and any already installed).
 *   Install: downloads the library, checks its sha256 and unpacks it into this device's sounds, IRs, presets and boards -
 *   on the Central Pedal through its driver (libraries.py), on a computer through the app (central-usage/libraries.js,
 *   into the built-in rig's sound folders). Update when the website lists a newer version; Remove; Install from a file…
 *   (a zip from the website's Downloads page). Every installed item keeps its library's plan: locked without it.
 * The same file runs in every app (Central Control / Usage get a copy in app/shared/ - prepare-shared.sh). */
(function () {
  "use strict";
  var DRIVER = "http://127.0.0.1:8766";
  // (no website yet: what each library holds; installing one from the list needs the website's checksum, so it's Install from a file…)
  var BUILTIN = [
    { id: "central-keys-library", plan: "keys", title: "Central Keys Library", version: "1.0", size: 420e6, summary: "Two grand pianos (Steinway B and Kawai), an upright, FM pianos, a clavisynth and a harpsichord; pipe, quiet and positive organs; vibraphone, marimba, xylophone, glockenspiel, bells and hand chimes; nine pads (warm, air, choir aah / ooh, shimmer, strings, glass, swell, worship) - with worship-ready presets." },
    { id: "central-instrument-library", plan: "instrument", title: "Central Instrument Library", version: "1.0", size: 520e6, summary: "Four drum kits (studio, rock, unruly, brushes); hollowbody, archtop and clean electric guitars; upright (plucked and bowed), jazz and hollowbody basses; alto and baritone saxes and a sax section; harps, kalimbas, recorders, harmonicas, saxello, ocarina, world instruments and percussion kits - with presets to play from keys or your instrument." },
    { id: "central-plugins-library", plan: "plugins", title: "Central Plugins Library", version: "1.0", size: 12e6, summary: "Ambient drone and transitions (risers, a downlifter, swells, reverse cymbals, an impact) as sounds, and mix-ready boards built from the Central Plugins effects: ambient and rhythm electric, acoustic and bass channel strips, pad wash, shimmer keys and piano polish." },
    { id: "central-pedals-library", plan: "pedals", title: "Central Pedals Library", version: "1.0", size: 0.2e6, summary: "28 cabinet and acoustic-body impulse responses for the IR loader (7 guitar cabinets with centre, edge and room microphones, 3 bass cabinets, 4 acoustic bodies) and pedalboards that use them: worship crunch and lead, edge delay, vintage and modern stacks, fuzz walls, tremolo combos, bass rigs and acoustic bodies." }
  ];
  var st = { list: null, source: "", installed: [], jobs: {}, msg: "", busy: false, loading: false, loadedAt: 0, backend: null };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function L() { return window.PPLicense || null; }
  function planName(id) { var l = L(); return l && l.planName ? l.planName(id) : id; }
  function hasPlan(id) { var l = L(); return !l || !l.hasPlan || l.hasPlan(id); }
  function size(n) { n = Number(n) || 0; return n >= 1e9 ? (n / 1e9).toFixed(1) + " GB" : n >= 1e6 ? Math.round(n / 1e6) + " MB" : Math.max(1, Math.round(n / 1e3)) + " KB"; }
  function vkey(v) { return String(v || "0").split(".").map(function (x) { return parseInt(x, 10) || 0; }); }
  function newer(a, b) { var x = vkey(a), y = vkey(b); for (var i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; }
  // where libraries install: "cu" (a computer: the app), "driver" (the Central Pedal's driver), or none (download them from the website)
  function backend() {
    if (window.CU && window.CU.libraries) return "cu";
    var l = L(), a = l && l.app ? l.app() : "";
    return a === "pedal" ? "driver" : null;   // (Pedal Control on a Mac / iPad: download them from the website)
  }

  // ------------------------------------------------------------- talking to the installer
  function api(path, opt) {
    return fetch(DRIVER + path, Object.assign({ cache: "no-store" }, opt || {})).then(function (r) { return r.json().then(function (j) { if (!r.ok || j.error) throw new Error(j.error || "the Central Pedal answered " + r.status); return j; }); });
  }
  function installedNow() {
    var be = backend();
    if (be === "cu") return window.CU.libraries.list().then(function (r) { return { installed: (r && r.installed) || [], jobs: {} }; });
    if (be === "driver") return api("/libraries").then(function (r) { return { installed: r.installed || [], jobs: r.jobs || {} }; });
    return Promise.resolve({ installed: [], jobs: {} });
  }
  function boardsChanged() {   // (the Instrument page adds / replaces / removes the libraries' presets and boards)
    try { if (window.PPInstrument && window.PPInstrument.syncLibraries) window.PPInstrument.syncLibraries(st.installed); } catch (_) { }
    try { window.dispatchEvent(new CustomEvent("pp-libraries", { detail: { installed: st.installed } })); } catch (_) { }
  }
  function websiteList() {
    var l = L(), base = l && l.server ? l.server() : "";
    if (!base) return Promise.resolve({ source: "built-in", libraries: BUILTIN.map(function (x) { return Object.assign({ ready: false, approximate: true }, x); }) });
    var ctl = window.AbortController ? new AbortController() : null, t = ctl ? setTimeout(function () { ctl.abort(); }, 12000) : 0;
    return fetch(base + "/v1/libraries", { cache: "no-store", signal: ctl ? ctl.signal : undefined }).then(function (r) { clearTimeout(t); if (!r.ok) throw new Error("the website answered " + r.status); return r.json(); })
      .then(function (j) { return { source: j.source === "index" ? "website" : "website-built-in", libraries: Array.isArray(j.libraries) ? j.libraries : [] }; })
      .catch(function () { clearTimeout(t); return { source: "built-in", offline: true, libraries: BUILTIN.map(function (x) { return Object.assign({ ready: false, approximate: true }, x); }) }; });
  }
  function load(force) {
    if (st.loading || (!force && st.list && Date.now() - st.loadedAt < 5 * 60e3)) return Promise.resolve();
    st.loading = true; st.backend = backend();
    return Promise.all([websiteList(), installedNow().catch(function () { return { installed: [], jobs: {} }; })]).then(function (r) {
      st.list = r[0].libraries; st.source = r[0].source + (r[0].offline ? "-offline" : ""); st.installed = r[1].installed; st.jobs = r[1].jobs; st.loadedAt = Date.now(); st.loading = false; redraw(); boardsChanged();
    }, function () { st.loading = false; redraw(); });
  }

  // ------------------------------------------------------------- actions
  function listed(id) { return (st.list || []).filter(function (x) { return x.id === id; })[0] || null; }
  function done(r, okText) {
    st.busy = false;
    if (r && r.installed) st.installed = r.installed;
    if (r && r.ok === false && !r.canceled) st.msg = r.error || "That didn't work.";
    else if (r && !r.canceled) st.msg = okText;
    redraw(); boardsChanged();
  }
  function fail(e) { st.busy = false; st.msg = e && e.message ? e.message : String(e); redraw(); }
  function install(id) {
    var lib = listed(id); if (!lib) return;
    if (!lib.ready || !lib.sha256) { st.msg = "This library isn't published yet. When it is, it installs from here; until then use Install from a file… with the zip from the website's Downloads page."; return redraw(); }
    var be = backend(); st.busy = true; st.msg = "Downloading " + lib.title + "…"; st.jobs[id] = { state: "downloading", done: 0, total: lib.size || 0 }; redraw();
    var payload = { id: lib.id, url: lib.url, sha256: lib.sha256, size: lib.size };
    if (be === "cu") return window.CU.libraries.install(payload).then(function (r) { delete st.jobs[id]; done(r, lib.title + " " + lib.version + " is installed."); }, fail);
    if (be === "driver") return api("/libraries/install", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).then(function () { poll(id, lib); }, fail);
    fail(new Error("Libraries install on the Central Pedal and on computers."));
  }
  function poll(id, lib) {
    api("/libraries").then(function (r) {
      var j = (r.jobs || {})[id] || {}; st.jobs = r.jobs || {}; st.installed = r.installed || st.installed;
      if (j.state === "done") { delete st.jobs[id]; return done({ ok: true, installed: r.installed }, lib.title + " " + lib.version + " is installed."); }
      if (j.state === "failed") { delete st.jobs[id]; return done({ ok: false, error: j.error, installed: r.installed }); }
      redraw(); setTimeout(function () { poll(id, lib); }, 1000);
    }, function () { setTimeout(function () { poll(id, lib); }, 2000); });
  }
  function remove(id) {
    var be = backend(), rec = st.installed.filter(function (x) { return x.id === id; })[0]; if (!rec) return;
    st.busy = true; st.msg = ""; redraw();
    if (be === "cu") return window.CU.libraries.remove(id).then(function (r) { done(r, rec.title + " was removed."); }, fail);
    if (be === "driver") return api("/libraries/remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: id }) }).then(function (r) { done(r, rec.title + " was removed."); }, fail);
  }
  function byFile() { var m = {}; (st.list || []).forEach(function (x) { if (x.file && x.sha256) m[x.file] = x.sha256; }); return m; }
  function installFile() {
    var be = backend();
    if (be === "cu") { st.busy = true; st.msg = ""; redraw(); return window.CU.libraries.installFile({ byFile: byFile() }).then(function (r) { done(r, r && r.record ? "Installed from the file (version " + r.record.version + ")." : ""); }, fail); }
    if (be !== "driver") return;
    var inp = document.createElement("input"); inp.type = "file"; inp.accept = ".zip,application/zip";
    inp.onchange = function () {
      var f = inp.files && inp.files[0]; if (!f) return;
      var sha = byFile()[f.name] || "";
      st.busy = true; st.msg = "Installing " + f.name + "…"; redraw();
      api("/libraries/file?name=" + encodeURIComponent(f.name) + (sha ? "&sha256=" + sha : ""), { method: "PUT", body: f }).then(function (r) { done(r, "Installed from the file (version " + (r.record && r.record.version) + ")."); }, fail);
    };
    inp.click();
  }

  // ------------------------------------------------------------- the panel
  function rowHtml(lib, rec) {
    var be = st.backend, job = st.jobs[lib.id], open = hasPlan(lib.plan), id = esc(lib.id);
    var status = rec ? "Installed · version " + esc(rec.version) : lib.ready === false ? "Not published yet" : "Not installed";
    var upd = rec && lib.version && newer(lib.version, rec.version) && lib.ready !== false;
    var btns = "";
    if (be && job && (job.state === "downloading" || job.state === "installing")) {
      btns = '<progress max="' + (job.total || 1) + '" value="' + (job.done || 0) + '"></progress> <span class="muted small">' + (job.state === "installing" ? "Installing…" : size(job.done) + (job.total ? " of " + size(job.total) : "")) + "</span>";
    } else if (be) {
      if (!rec && open) btns += '<button class="primary" data-lib-install="' + id + '"' + (st.busy || lib.ready === false ? " disabled" : "") + ">Install</button>";
      if (upd && open) btns += '<button class="primary" data-lib-install="' + id + '"' + (st.busy ? " disabled" : "") + ">Update to " + esc(lib.version) + "</button>";
      if (rec) btns += '<button data-lib-remove="' + id + '"' + (st.busy ? " disabled" : "") + ">Remove</button>";
    } else if (lib.url && lib.ready !== false) btns = '<a href="' + esc(lib.url) + '" target="_blank" rel="noopener">Download</a>';
    var what = rec && rec.counts ? [["sound", "sound bank"], ["preset", "preset"], ["board", "board"], ["ir", "impulse response"]].filter(function (k) { return rec.counts[k[0]]; }).map(function (k) { return rec.counts[k[0]] + " " + k[1] + (rec.counts[k[0]] === 1 ? "" : "s"); }).join(", ") : "";
    return '<li data-lib="' + id + '"><b>' + esc(lib.title || planName(lib.plan) + " Library") + '</b> <span class="muted">· ' + esc(planName(lib.plan)) + (lib.size ? " · " + (lib.approximate ? "about " : "") + size(lib.size) : "") + "</span><br>" +
      '<span class="' + (rec ? "ok" : "muted") + '">' + status + "</span>" + (what ? ' <span class="muted small">(' + esc(what) + ")</span>" : "") + (rec && !open ? ' <span class="bad">· locked: needs ' + esc(planName(lib.plan)) + "</span>" : "") +
      (lib.summary && !rec ? '<br><span class="muted small">' + esc(lib.summary) + "</span>" : "") + (btns ? '<div class="row">' + btns + "</div>" : "") + "</li>";
  }
  function html(cls) {
    if (!st.list && !st.loading) setTimeout(function () { load(false); }, 0);
    var be = st.backend || backend();
    var mine = (st.list || []).filter(function (x) { return hasPlan(x.plan) || st.installed.some(function (r) { return r.id === x.id; }); });
    st.installed.forEach(function (r) { if (!mine.some(function (x) { return x.id === r.id; })) mine.push({ id: r.id, plan: r.plan, title: r.title, version: r.version, ready: false }); });
    var rows = mine.map(function (lib) { return rowHtml(lib, st.installed.filter(function (r) { return r.id === lib.id; })[0] || null); }).join("");
    var others = (st.list || []).filter(function (x) { return mine.indexOf(x) < 0; }).map(function (x) { return esc(x.title) + " (" + esc(planName(x.plan)) + ")"; });
    var intro = '<p class="muted">Sounds, presets, boards and impulse responses for your sound plans. Anyone can download them; each opens with its plan' + (be ? ", and installs here in one step." : ": install them on the Central Pedal or in Central Control / Central Usage on a computer.") + "</p>";
    var body = !st.list ? '<p class="muted">Loading the libraries…</p>' : (rows ? '<ul class="plain pkg-list lib-list">' + rows + "</ul>" : '<p class="muted">No libraries for this device\'s plans yet. Add a package above to see yours.</p>');
    var foot = (others.length ? '<p class="muted small">With other plans: ' + others.join(", ") + ".</p>" : "") +
      (st.source.indexOf("built-in") === 0 ? '<p class="muted small">' + (st.source === "built-in-offline" ? "The website didn't answer: this is the list that came with the app." : "The website isn't open yet: download a library from its Downloads page later and use Install from a file….") + "</p>" : "") +
      (be ? '<div class="row"><button data-lib-file' + (st.busy ? " disabled" : "") + '>Install from a file…</button><button data-lib-refresh' + (st.busy ? " disabled" : "") + ">Check for new versions</button></div>" : "") + (st.msg ? '<p class="small">' + esc(st.msg) + "</p>" : "");
    return '<section class="' + (cls || "") + '" data-st="libraries" id="libSettings"><h3>Libraries</h3>' + intro + body + foot + "</section>";
  }
  function redraw() { var el = document.getElementById("libSettings"); if (el) el.outerHTML = html(el.className); }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-lib-install],[data-lib-remove],[data-lib-file],[data-lib-refresh]"); if (!b) return;
    if (b.dataset.libInstall) install(b.dataset.libInstall);
    else if (b.dataset.libRemove) remove(b.dataset.libRemove);
    else if (b.hasAttribute("data-lib-file")) installFile();
    else { st.msg = "Checking…"; redraw(); load(true).then(function () { st.msg = ""; redraw(); }); }
  });
  window.addEventListener("pp-plans", function () { redraw(); });
  // the Central Pedal: its installed libraries' presets and boards on the Instrument page from the start
  setTimeout(function () { if (backend() === "driver") installedNow().then(function (r) { st.installed = r.installed; boardsChanged(); }).catch(function () { }); }, 2500);
  if (window.PPFeatures && window.PPFeatures.on) window.PPFeatures.on("libraries", function (m) { if (m && Array.isArray(m.installed)) { st.installed = m.installed; redraw(); boardsChanged(); } });

  window.PPLibraries = { html: html, load: load, install: install, remove: remove, installFile: installFile, state: function () { return st; }, builtin: BUILTIN, newer: newer, backend: backend };
})();
