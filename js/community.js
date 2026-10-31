/* Central Pedal / Central Control / Central Usage - Settings → Packages → Community (10.1): samples, loops, pads,
 * instruments, pedal boards and plugins made by musicians on the website's Make & sell, checked and reviewed by Motion
 * Audio. Each is part of a sound plan (loops and pads: Central Pads; samples and instruments: Central Keys or Central
 * Instrument; boards: Central Pedals; plugins: Central Plugins) and installs like a library (js/libraries.js: the
 * Central Pedal's driver, or the app on a computer), locked by the plan like everything else in it.
 *   Plugins are programs, so they stay off unless this device's "Allow community plugins" is on (off by default), carry
 *   the label "Community plugin - made by <creator>, checked by Motion Audio", and run walled off. Anything can be
 *   reported. The website's revoke list (an item Motion Audio took down, or a program file it blocked) is checked when
 *   this opens and every few hours: what's on it comes off this device.
 * The same file runs in every app (Central Control / Usage get a copy in app/shared/ - prepare-shared.sh). */
(function () {
  "use strict";
  var DRIVER = "http://127.0.0.1:8766", PACKS = ["pads", "keys", "instrument", "pedals", "plugins"];
  var KIND = { sample: "Samples", instrument: "Instrument", loop: "Loops", pad: "Pad", board: "Pedal board", plugin: "Plugin" };
  var st = { items: null, installed: [], pluginsAllowed: false, loading: false, loadedAt: 0, msg: "", busy: "", report: null, revokedAt: 0, error: "" };
  try {   // (the plugin label stands out a little, in every app's theme)
    var css = document.createElement("style");
    css.textContent = ".cm-label{display:inline-block;margin:.15rem 0;padding:.1rem .45rem;border:1px dashed currentColor;border-radius:6px;font-size:.82em;opacity:.9}.cm-list h4{margin:.6rem 0 .2rem}.cm-switch{display:flex;gap:.45rem;align-items:center;margin:.3rem 0}";
    document.head.appendChild(css);
  } catch (_) { }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function L() { return window.PPLicense || null; }
  function base() { var l = L(); return l && l.server ? l.server() : ""; }
  function hasPlan(id) { var l = L(); return !l || !l.hasPlan || l.hasPlan(id); }
  function planName(id) { var l = L(); return l && l.planName ? l.planName(id) : id; }
  function backend() { return window.PPLibraries && window.PPLibraries.backend ? window.PPLibraries.backend() : null; }
  // the device's platform, for a plugin's build: the Central Pedal is Linux ARM; computers say what they are
  function platform() {
    if (backend() === "driver") return "linux-arm64";
    var cu = window.CU || {};
    if (cu.platform === "darwin") return "mac";
    if (cu.platform === "win32") return "win-x64";
    if (cu.platform === "linux") return cu.arch === "arm64" ? "linux-arm64" : "linux-x64";
    return "";
  }
  // a package key that opens this plan (Central Pads comes with every plan)
  function keyFor(pack) {
    var l = L(), list = l && l.packages ? l.packages() : [];
    var p = list.filter(function (x) { return x.ok !== false && x.plans && x.plans[pack]; })[0];
    return p ? p.key : "";
  }
  function labelOf(it) { return it.kind === "plugin" ? "Community plugin - made by " + (it.creator || "a creator") + ", checked by Motion Audio" : "Community - made by " + (it.creator || "a creator"); }
  function libId(it) { return "community-" + it.id; }

  // ------------------------------------------------------------- the installer (the same as the libraries')
  function driver(path, opt) {
    return fetch(DRIVER + path, Object.assign({ cache: "no-store" }, opt || {})).then(function (r) { return r.json().then(function (j) { if (!r.ok || j.error) throw new Error(j.error || "the Central Pedal answered " + r.status); return j; }); });
  }
  function post(path, body) { return driver(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }); }
  function community(o) {   // the switch and the revoke list, on this device
    var be = backend();
    if (be === "cu" && window.CU.libraries.community) return window.CU.libraries.community(o || {});
    if (be === "driver") return post("/libraries/community", o || {});
    return Promise.resolve({ ok: true, pluginsAllowed: false, installed: [], revoked: [] });
  }
  function installed() {
    var be = backend();
    if (be === "cu") return window.CU.libraries.list().then(function (r) { return (r && r.installed) || []; });
    if (be === "driver") return driver("/libraries").then(function (r) { if ("pluginsAllowed" in r) st.pluginsAllowed = !!r.pluginsAllowed; return r.installed || []; });
    return Promise.resolve([]);
  }
  function librariesChanged(list) {
    st.installed = list || st.installed;
    try { if (window.PPLibraries && window.PPLibraries.load) window.PPLibraries.load(true); } catch (_) { }
  }

  // ------------------------------------------------------------- the website
  function web(path, body) {
    var b = base(); if (!b) return Promise.reject(new Error("The website isn't open yet."));
    return fetch(b + "/v1" + path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" } : { cache: "no-store" })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || "the website answered " + r.status); return j; }); });
  }
  function load(force) {
    if (st.loading || (!force && st.items && Date.now() - st.loadedAt < 5 * 60e3)) return Promise.resolve();
    st.loading = true; st.error = "";
    var packs = PACKS.filter(hasPlan);
    return Promise.all([
      Promise.all(packs.map(function (p) { return web("/community?pack=" + p).then(function (j) { return j.items || []; }); })).then(function (a) { return [].concat.apply([], a); }),
      installed().catch(function () { return []; }),
      community({}).catch(function () { return {}; })
    ]).then(function (r) {
      st.items = r[0]; st.installed = r[1]; if (r[2] && "pluginsAllowed" in r[2]) st.pluginsAllowed = !!r[2].pluginsAllowed;
      st.loadedAt = Date.now(); st.loading = false; redraw(); return checkRevoked();
    }, function (e) { st.loading = false; st.items = st.items || []; st.error = e.message; redraw(); });
  }
  // the revoke list: what Motion Audio took down comes off this device
  function checkRevoked() {
    if (!base() || !backend()) return Promise.resolve([]);
    return web("/community/revoked").then(function (j) {
      st.revokedAt = Date.now();
      var ids = (j.items || []).map(function (x) { return x.libraryId; }), hashes = j.hashes || [];
      var mine = (st.installed || []).filter(function (r) { return /^community-/.test(r.id); });
      if (!mine.length) return [];
      return community({ revokeIds: ids, revokeHashes: hashes }).then(function (r) {
        var gone = (r && r.revoked) || [];
        if (gone.length) { st.msg = gone.length === 1 ? "Motion Audio took a community item down, so it was removed from this device." : gone.length + " community items were taken down by Motion Audio and removed from this device."; librariesChanged(r.installed); redraw(); }
        return gone;
      });
    }).catch(function () { return []; });
  }

  // ------------------------------------------------------------- actions
  function find(id) { return (st.items || []).filter(function (x) { return String(x.id) === String(id); })[0] || null; }
  function install(id) {
    var it = find(id), be = backend(); if (!it || !be) return;
    if (it.kind === "plugin" && !st.pluginsAllowed) { st.msg = "Switch on Allow community plugins first."; return redraw(); }
    var key = keyFor(it.pack);
    st.busy = String(id); st.msg = "Downloading " + it.title + "…"; redraw();
    web("/community/" + it.id + "/download", { key: key, platform: platform(), deviceId: L() && L().deviceId ? L().deviceId() : "" }).then(function (d) {
      var payload = { id: d.id, url: d.url, sha256: d.sha256, size: d.size };
      if (be === "cu") return window.CU.libraries.install(payload).then(function (r) { if (r && r.ok === false) throw new Error(r.error || "That didn't install."); return r.installed; });
      return post("/libraries/install", payload).then(function () { return waitDriver(d.id); });
    }).then(function (list) { st.busy = ""; st.msg = it.title + " is installed." + (it.kind === "plugin" ? " It runs walled off from the rest of the app." : ""); librariesChanged(list); redraw(); })
      .catch(function (e) { st.busy = ""; st.msg = e.message; redraw(); });
  }
  function waitDriver(lid) {
    return new Promise(function (ok, bad) {
      (function poll(n) {
        driver("/libraries").then(function (r) {
          var j = (r.jobs || {})[lid] || {};
          if (j.state === "done") return ok(r.installed);
          if (j.state === "failed") return bad(new Error(j.error || "That didn't install."));
          if (n > 900) return bad(new Error("The install is taking too long."));
          setTimeout(function () { poll(n + 1); }, 1000);
        }, function () { setTimeout(function () { poll(n + 1); }, 2000); });
      })(0);
    });
  }
  function remove(lid) {
    var be = backend(); st.busy = lid; redraw();
    var p = be === "cu" ? window.CU.libraries.remove(lid).then(function (r) { return r.installed; }) : post("/libraries/remove", { id: lid }).then(function (r) { return r.installed; });
    p.then(function (list) { st.busy = ""; st.msg = "Removed."; librariesChanged(list); redraw(); }, function (e) { st.busy = ""; st.msg = e.message; redraw(); });
  }
  function setPlugins(on) {
    community({ pluginsAllowed: !!on }).then(function (r) { st.pluginsAllowed = !!(r && r.pluginsAllowed); st.msg = st.pluginsAllowed ? "Community plugins are allowed on this device. They run walled off, and Motion Audio can take any of them away." : "Community plugins are off on this device."; redraw(); })
      .catch(function (e) { st.msg = e.message; redraw(); });
  }
  function report(id, reason) {
    var l = L();
    web("/community/" + id + "/report", { reason: reason, device: (l && l.app ? l.app() : "app") + " · " + platform() }).then(function () { st.report = null; st.msg = "Thanks: Motion Audio will look at it."; redraw(); })
      .catch(function (e) { st.msg = e.message; redraw(); });
  }

  // ------------------------------------------------------------- the panel
  function stars(n) { return n ? '<span class="muted" title="' + n + ' of 5 stars">' + "★★★★★".slice(0, n) + "</span>" : ""; }
  function rowHtml(it) {
    var lid = libId(it), rec = (st.installed || []).filter(function (r) { return r.id === lid; })[0], open = hasPlan(it.pack), be = backend(), busy = !!st.busy;
    var plugin = it.kind === "plugin", winOff = plugin && platform() === "win-x64", blocked = plugin && !st.pluginsAllowed, noBuild = plugin && (winOff || (it.packages && platform() && !it.packages[platform()]));   // (Windows: no wall for plugins yet - docs/COMMUNITY-PLUGINS.md)
    var btns = "";
    if (be) {
      if (!rec && open && !blocked && !noBuild) btns += '<button class="primary" data-cm-install="' + it.id + '"' + (busy ? " disabled" : "") + ">" + (st.busy === String(it.id) ? "Installing…" : "Install") + "</button>";
      if (rec) btns += '<button data-cm-remove="' + lid + '"' + (busy ? " disabled" : "") + ">Remove</button>";
    }
    btns += '<button class="small" data-cm-report="' + it.id + '">Report</button>';
    var why = blocked && !rec && !winOff ? '<span class="muted small">Switch on Allow community plugins to install it.</span>' : noBuild ? '<span class="muted small">' + (winOff ? "Community plugins can't run walled off on Windows yet." : "Not made for this device.") + "</span>" : !open ? '<span class="bad">Needs ' + esc(planName(it.pack)) + "</span>" : "";
    var rep = st.report === String(it.id) ? '<div class="row"><input data-cm-why="' + it.id + '" placeholder="What\'s wrong with it?" maxlength="500"><button data-cm-send="' + it.id + '">Send</button><button data-cm-cancel>Cancel</button></div>' : "";
    return '<li data-cm="' + it.id + '"><b>' + esc(it.title) + '</b> <span class="muted">· ' + esc(KIND[it.kind] || it.kind) + " · " + esc(planName(it.pack)) + "</span> " + stars(it.stars) + "<br>" +
      '<span class="' + (plugin ? "cm-label" : "muted small") + '">' + esc(labelOf(it)) + "</span>" + (rec ? ' <span class="ok">· Installed</span>' : "") +
      (it.description ? '<br><span class="muted small">' + esc(it.description).slice(0, 240) + "</span>" : "") +
      '<div class="row">' + btns + why + "</div>" + rep + "</li>";
  }
  function html(cls) {
    if (!st.items && !st.loading) setTimeout(function () { load(false); }, 0);
    var be = backend(), items = st.items || [];
    var groups = PACKS.filter(function (p) { return items.some(function (x) { return x.pack === p; }); });
    var body = !st.items ? '<p class="muted">Loading the community items…</p>' : !base() ? '<p class="muted">Community items come from the Motion Audio website, once it\'s open.</p>' :
      (groups.length ? groups.map(function (p) { return "<h4>" + esc(planName(p)) + '</h4><ul class="plain pkg-list cm-list">' + items.filter(function (x) { return x.pack === p; }).map(rowHtml).join("") + "</ul>"; }).join("")
        : '<p class="muted">' + (PACKS.some(hasPlan) ? "Nothing yet for your plans." : "Add a package above to see the community items for your plans.") + "</p>");
    var sw = be && platform() !== "win-x64" ? '<label class="toggle cm-switch"><input type="checkbox" data-cm-plugins' + (st.pluginsAllowed ? " checked" : "") + '> Allow community plugins on this device</label><p class="muted small">Off unless you switch it on. Community plugins are checked and reviewed by Motion Audio, run walled off from the rest of the app, and come off this device if Motion Audio takes one down.</p>' : "";
    return '<section class="' + (cls || "") + '" data-st="community" id="cmSettings"><h3>Community</h3><p class="muted">Sounds, loops, pads, boards and plugins made by other musicians (on the website\'s Make &amp; sell), checked by Motion Audio. They\'re part of your plans: install them here.</p>' +
      sw + body + (st.error ? '<p class="small bad">' + esc(st.error) + "</p>" : "") + (st.msg ? '<p class="small">' + esc(st.msg) + "</p>" : "") +
      (be && st.items ? '<div class="row"><button data-cm-refresh' + (st.busy ? " disabled" : "") + ">Check for new items</button></div>" : "") + "</section>";
  }
  function redraw() { var el = document.getElementById("cmSettings"); if (el) el.outerHTML = html(el.className); }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-cm-install],[data-cm-remove],[data-cm-report],[data-cm-send],[data-cm-cancel],[data-cm-refresh]"); if (!b) return;
    if (b.dataset.cmInstall) install(b.dataset.cmInstall);
    else if (b.dataset.cmRemove) remove(b.dataset.cmRemove);
    else if (b.dataset.cmReport) { st.report = b.dataset.cmReport; redraw(); }
    else if (b.dataset.cmSend) { var inp = document.querySelector('[data-cm-why="' + b.dataset.cmSend + '"]'), why = inp ? inp.value.trim() : ""; if (!why) { st.msg = "Say what's wrong with it."; return redraw(); } report(b.dataset.cmSend, why); }
    else if (b.hasAttribute("data-cm-cancel")) { st.report = null; redraw(); }
    else { st.msg = "Checking…"; redraw(); load(true).then(function () { st.msg = ""; redraw(); }); }
  });
  document.addEventListener("change", function (e) { if (e.target && e.target.hasAttribute && e.target.hasAttribute("data-cm-plugins")) setPlugins(e.target.checked); });
  window.addEventListener("pp-plans", function () { st.loadedAt = 0; redraw(); });
  // the revoke list on start (a little after the app has its packages) and every 6 hours, even with Settings closed
  setTimeout(function () { if (backend()) installed().then(function (l) { st.installed = l; return checkRevoked(); }).catch(function () { }); }, 8000);
  setInterval(function () { if (backend()) installed().then(function (l) { st.installed = l; return checkRevoked(); }).catch(function () { }); }, 6 * 3600e3);

  window.PPCommunity = { html: html, load: load, install: install, remove: remove, setPlugins: setPlugins, checkRevoked: checkRevoked, state: function () { return st; }, labelOf: labelOf, platform: platform };
})();
