/* Central Production - the app around the editors: the start page, File → New project (pick what you're making first),
 * open and save (this computer, a .cmproj file, your Motion Audio account), undo, the menus and messages.
 * Each kind of project is a module in types/ that registers itself with CP.type({...}):
 *   { id, name, blurb, daw (uses the timeline), options(opts) -> html for the New project form, create(opts) -> data,
 *     load(project, files) -> Promise, mount(el, project), unmount(), collect() -> Promise<{ data, files }>,
 *     exports: [[label, fn]], publish: { ... } (prod-publish.js), install() (prod-publish.js) }
 */
(function () {
  "use strict";
  var H = window.CPHost, Z = window.CMProj, S = window.CDaw;
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function uid(p) { return (p || "p") + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  var KEYS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  var ORDER = ["track", "loop", "sample", "pad", "instrument", "plugin", "board"];
  var types = {}, cur = null, mod = null, hist = { undo: [], redo: [] }, dirty = false, where = { path: null, cloud: null, localId: null };

  // ------------------------------------------------------------- messages
  var toastT = 0;
  function toast(msg, kind) { var t = $("#cpToast"); if (!t) return; t.textContent = msg; t.className = "cp-toast show" + (kind ? " " + kind : ""); clearTimeout(toastT); toastT = setTimeout(function () { t.className = "cp-toast"; }, kind === "bad" ? 7000 : 4000); }
  function busy(msg) { var b = $("#cpBusy"); if (!b) return; if (msg) { b.querySelector("span").textContent = msg; b.hidden = false; } else b.hidden = true; }
  function modal(html, opts) {
    opts = opts || {};
    var m = $("#cpModal"); m.innerHTML = '<div class="cp-dialog' + (opts.wide ? " wide" : "") + '" role="dialog" aria-modal="true">' + html + "</div>"; m.hidden = false;
    var d = m.firstChild; setTimeout(function () { var f = d.querySelector("[autofocus], input, select, textarea, button.primary"); if (f) f.focus(); }, 30);
    m.onclick = function (e) { if (e.target === m && !opts.sticky) close(); if (e.target.closest("[data-close]")) close(); };
    function close() { m.hidden = true; m.innerHTML = ""; if (opts.onClose) opts.onClose(); }
    d.close = close; return d;
  }
  function closeModal() { var m = $("#cpModal"); if (m && !m.hidden) { m.hidden = true; m.innerHTML = ""; } }
  function ask(title, text, yes, no) {
    return new Promise(function (res) {
      var d = modal("<h2>" + esc(title) + "</h2><p>" + esc(text) + '</p><div class="cp-row end"><button data-a="no">' + esc(no || "Cancel") + '</button><button class="primary" data-a="yes">' + esc(yes || "OK") + "</button></div>", { onClose: function () { res(false); } });
      d.onclick = function (e) { var b = e.target.closest("[data-a]"); if (!b) return; var r = b.dataset.a === "yes"; d.close(); res(r); };
    });
  }

  // ------------------------------------------------------------- the project
  function type(def) { types[def.id] = def; }
  function project() { return cur; }
  function setDirty(v) { dirty = v !== false; drawTop(); }
  function isDirty() { return dirty || !!(cur && mod && mod.daw && S && S.isDirty()); }
  // undo for the editors that aren't the timeline: CP.edit("Trim", function (data) { ... })
  function edit(label, fn) {
    if (!cur) return;
    hist.undo.push({ label: label, json: JSON.stringify(cur.data) }); if (hist.undo.length > 100) hist.undo.shift(); hist.redo = [];
    var r = fn(cur.data); setDirty(true); if (mod && mod.changed) mod.changed(label); return r;
  }
  function undo() {
    if (mod && mod.daw && S) { var l = S.undo(); if (l) toast("Undid: " + l); return; }
    var u = hist.undo.pop(); if (!u || !cur) return;
    hist.redo.push({ label: u.label, json: JSON.stringify(cur.data) }); cur.data = JSON.parse(u.json); setDirty(true); if (mod.changed) mod.changed("undo"); toast("Undid: " + u.label);
  }
  function redo() {
    if (mod && mod.daw && S) { var l = S.redo(); if (l) toast("Redid: " + l); return; }
    var r = hist.redo.pop(); if (!r || !cur) return;
    hist.undo.push({ label: r.label, json: JSON.stringify(cur.data) }); cur.data = JSON.parse(r.json); setDirty(true); if (mod.changed) mod.changed("redo"); toast("Redid: " + r.label);
  }
  function canUndo() { return mod && mod.daw && S ? S.canUndo() : (hist.undo.length ? hist.undo[hist.undo.length - 1].label : null); }
  function canRedo() { return mod && mod.daw && S ? S.canRedo() : (hist.redo.length ? hist.redo[hist.redo.length - 1].label : null); }

  function confirmLeave() { if (!isDirty()) return Promise.resolve(true); return ask("Leave this project?", "“" + cur.name + "” has changes that aren't saved. They'll be lost.", "Leave without saving", "Stay"); }

  function unmount() {
    if (mod && mod.unmount) try { mod.unmount(); } catch (e) { console.warn(e); }
    if (window.CDawUI) window.CDawUI.unmount();
    $("#cpTypeBody").innerHTML = "";
  }
  function mount() {
    $("#cpStart").hidden = true; $("#cpEditor").hidden = false;
    mod = types[cur.type];
    document.body.dataset.type = cur.type;
    $("#cpTypeBody").innerHTML = "";
    mod.mount($("#cpTypeBody"), cur);
    hist = { undo: [], redo: [] };
    drawTop(); drawTypeBar();
    if (S && !mod.daw) S.stop({ home: true });
  }
  // the timeline (tracks and loops): the DAW's screen, in the editor
  function showStudio(into, opts) {
    if (!window.CDawUI) return null;
    window.CDawUI.mount(into, Object.assign({ layout: "full", onSave: function () { save(); }, loops: H.loops }, opts || {}));
    return into;
  }
  function blankProject(t, opts) {
    var d = types[t]; opts = opts || {};
    return { format: "central-production", version: 1, id: uid("p"), type: t, name: opts.name || ("New " + d.name.toLowerCase()), createdAt: Date.now(), savedAt: 0, app: H.kind, bpm: opts.bpm || 100, key: opts.key || "C", data: null, daw: null };
  }
  function create(t, opts) {
    return confirmLeave().then(function (ok) {
      if (!ok) return false;
      unmount();
      cur = blankProject(t, opts);
      var d = types[t];
      cur.data = d.create ? d.create(opts || {}, cur) : {};
      if (d.daw && S) { S.fresh(Object.assign({ name: cur.name, bpm: cur.bpm, key: cur.key, id: cur.id }, d.dawOptions ? d.dawOptions(opts || {}) : {})); if (d.afterFresh) d.afterFresh(opts || {}); }
      where = { path: null, cloud: null, localId: null }; dirty = false;
      mount(); setDirty(false);
      remember();
      return true;
    });
  }
  // the timeline's audio (AudioBuffers by id) <-> audio/<id>.wav in the file
  function dawFiles() {
    var files = {};
    S.usedAudio().forEach(function (id) { files["audio/" + id + ".wav"] = new Uint8Array(Z.wav(S.buffers[id], 24)); });
    return files;
  }
  function serialize() {
    if (!cur) return Promise.reject(new Error("There's no project open."));
    var name = cur.name;
    return Promise.resolve(mod.collect ? mod.collect(cur) : { data: cur.data, files: {} }).then(function (r) {
      var out = clone(Object.assign({}, cur, { data: r && r.data !== undefined ? r.data : cur.data, savedAt: Date.now(), app: H.kind, name: name }));
      var files = Object.assign({}, (r && r.files) || {});
      if (mod.daw && S) { var p = clone(S.project()); p.name = name; out.daw = p; out.bpm = p.bpm; out.key = p.key; Object.assign(files, dawFiles()); }
      return { project: out, bytes: Z.pack(out, files) };
    });
  }
  function load(bytes, how) {
    return Z.unpack(bytes).then(function (r) {
      var p = r.project, d = types[p.type];
      if (!d) throw new Error("This project is a kind this version of Central Production doesn't know (" + p.type + "). Update the app.");
      return confirmLeave().then(function (ok) {
        if (!ok) return false;
        busy("Opening “" + p.name + "”…");
        unmount();
        var jobs = [];
        if (d.daw && S && p.daw) {
          var c = S.ctx();
          Object.keys(r.files).filter(function (n) { return /^audio\/.+\.wav$/.test(n); }).forEach(function (n) {
            var id = n.slice(6, -4); jobs.push(Z.decode(c, r.files[n]).then(function (b) { S.buffers[id] = b; }).catch(function () { }));
          });
        }
        return Promise.all(jobs).then(function () {
          cur = p; if (p.daw && S) S.load(p.daw);
          return d.load ? d.load(p, r.files) : null;
        }).then(function () {
          where = Object.assign({ path: null, cloud: null, localId: null }, how || {});
          mount(); dirty = false; drawTop(); busy(); remember();
          toast("Opened “" + p.name + "”.");
          return true;
        });
      });
    }).catch(function (e) { busy(); toast(e.message || String(e), "bad"); return false; });
  }
  function save(opts) {
    opts = opts || {};
    if (!cur) return Promise.resolve(false);
    busy("Saving…");
    return serialize().then(function (r) {
      cur.savedAt = r.project.savedAt;
      var entry = { id: cur.id, name: cur.name, type: cur.type, savedAt: cur.savedAt, path: opts.as ? null : where.path };
      return H.local.save(entry, r.bytes).then(function (e) {
        if (e && e.path) where.path = e.path; where.localId = cur.id;
        dirty = false; if (S && mod.daw && S.markSaved) S.markSaved();
        busy(); drawTop(); remember(); toast(H.kind === "desktop" && e && e.path ? "Saved to " + e.path : "Saved in this browser. Use Save to my account to open it anywhere.");
        if (opts.cloud !== false && where.cloud && H.account.token()) return saveCloud(true);
        return true;
      });
    }).catch(function (e) { busy(); if (e && e.canceled) return false; toast("Couldn't save: " + (e.message || e), "bad"); return false; });
  }
  function saveAsFile() {
    if (!cur) return;
    busy("Saving…");
    serialize().then(function (r) { return H.saveAs(Z.slug(cur.name, "project") + ".cmproj", r.bytes); })
      .then(function (r) { busy(); if (!r) return; if (r.path && r.path !== "downloads") where.path = r.path; dirty = false; if (S && mod.daw && S.markSaved) S.markSaved(); drawTop(); toast(r.path === "downloads" ? "Saved to your downloads." : "Saved to " + r.path); })
      .catch(function (e) { busy(); toast("Couldn't save: " + (e.message || e), "bad"); });
  }
  function saveCloud(quiet) {
    if (!cur) return Promise.resolve(false);
    if (!H.account.token()) { signInDialog("Sign in to save “" + cur.name + "” to your account.").then(function (ok) { if (ok) saveCloud(); }); return Promise.resolve(false); }
    busy("Saving to your account…");
    return serialize().then(function (r) {
      return H.api("POST", "/projects", { id: where.cloud || cur.id, name: cur.name, type: cur.type, size: r.bytes.length }).then(function (u) {
        return H.put(u.url, r.bytes, "application/zip").then(function () { return H.api("POST", "/projects/" + encodeURIComponent(u.project.id) + "/done", { key: u.key }); });
      }).then(function (d) { where.cloud = d.project.id; busy(); if (!quiet) toast("Saved to your Motion Audio account."); dirty = false; if (S && mod.daw && S.markSaved) S.markSaved(); drawTop(); return true; });
    }).catch(function (e) { busy(); toast("Couldn't save to your account: " + (e.message || e), "bad"); return false; });
  }
  function openCloud(id) {
    busy("Opening from your account…");
    return H.api("GET", "/projects/" + encodeURIComponent(id)).then(function (r) { return H.get(r.url); })
      .then(function (bytes) { busy(); return load(bytes, { cloud: id }); })
      .catch(function (e) { busy(); toast("Couldn't open it: " + (e.message || e), "bad"); });
  }
  function openFile() {
    return H.openFile().then(function (f) { if (f) return load(f.bytes, { path: H.kind === "desktop" ? f.path : null }); });
  }
  function remember() { try { localStorage.setItem("cp-last-type", cur ? cur.type : ""); } catch (_) { } }

  // ------------------------------------------------------------- sign in (the same account as the website)
  function signInDialog(why) {
    return new Promise(function (res) {
      var done = false;
      var d = modal('<h2>Sign in</h2><p class="muted">' + esc(why || "Sign in with your Motion Audio account.") + '</p><form id="cpSignIn" class="cp-form"><label>Email<input id="siEmail" type="email" autocomplete="username" required autofocus></label><label>Password<input id="siPass" type="password" autocomplete="current-password" required></label><div class="err" id="siErr"></div>' +
        '<div class="cp-row end"><a href="#" id="siNew">Make an account</a><button type="button" data-close>Cancel</button><button class="primary">Sign in</button></div></form>', { onClose: function () { if (!done) res(false); } });
      $("#siNew", d).onclick = function (e) { e.preventDefault(); H.openExternal(H.account.signUpUrl()); };
      var ticket = null;
      $("#cpSignIn", d).onsubmit = function (e) {
        e.preventDefault(); var err = $("#siErr", d); err.textContent = "";
        var p = ticket ? H.account.step(ticket.step === "phone" ? "/login/phone" : "/login/code", ticket.step === "phone" ? { ticket: ticket.ticket, phone: $("#siCode", d).value } : { ticket: ticket.ticket, code: $("#siCode", d).value, trust: true })
          : H.account.signIn($("#siEmail", d).value.trim(), $("#siPass", d).value);
        p.then(function (r) {
          if (r && r.ok) { done = true; d.close(); drawTop(); toast("Signed in."); res(true); return; }
          if (r && r.step) { ticket = r; var f = $("#cpSignIn", d); f.querySelectorAll("label").forEach(function (l) { l.hidden = true; }); var l = document.createElement("label"); l.innerHTML = (r.step === "phone" ? "Your mobile number (we text a code to it)" : "The code we sent" + (r.to ? " to " + esc(r.to) : "")) + '<input id="siCode" autocomplete="one-time-code" required>'; f.insertBefore(l, $("#siErr", d)); $("#siCode", d).focus(); }
        }).catch(function (e2) { err.textContent = e2.message || String(e2); });
      };
    });
  }

  // ------------------------------------------------------------- the top bar and menus
  function drawTop() {
    var name = $("#cpName"), chip = $("#cpTypeChip"), saved = $("#cpSaved");
    if (!name) return;
    if (cur) { if (document.activeElement !== name) name.value = cur.name; name.hidden = false; chip.textContent = types[cur.type].name; chip.hidden = false; saved.textContent = isDirty() ? "Not saved" : cur.savedAt ? "Saved" : ""; saved.classList.toggle("warn", isDirty()); }
    else { name.hidden = true; chip.hidden = true; saved.textContent = ""; }
    var m = H.account.cached(), acc = $("#cpAccount");
    acc.textContent = m ? (m.name || m.email || "Account") : H.account.token() ? "Account" : "Sign in";
    var u = $("#cpUndo"), r = $("#cpRedo");
    if (u) { u.disabled = !cur || !canUndo(); u.title = canUndo() ? "Undo: " + canUndo() : "Nothing to undo"; r.disabled = !cur || !canRedo(); r.title = canRedo() ? "Redo: " + canRedo() : "Nothing to redo"; }
  }
  function drawTypeBar() {
    var bar = $("#cpTypeBar"); if (!bar || !cur) return;
    var d = types[cur.type];
    bar.innerHTML = '<span class="cp-tb-what">' + esc(d.blurb) + '</span><span class="cp-tb-acts">' +
      (d.exports || []).slice(0, 2).map(function (x, i) { return '<button data-exp="' + i + '">' + esc(x[0]) + "</button>"; }).join("") +
      '<button data-act="install" title="Put it in Central Control, Central Usage and this app, on this computer">Install into my apps</button>' +
      '<button class="primary" data-act="publish">' + (d.publish && d.publish.store === "tracks" ? "Publish to Central Tracks" : "Publish to Make &amp; sell") + "</button></span>";
    bar.onclick = function (e) {
      var x = e.target.closest("[data-exp]"), a = e.target.closest("[data-act]");
      if (x) runExport(d.exports[+x.dataset.exp]);
      if (a && a.dataset.act === "publish") window.CPPublish.open();
      if (a && a.dataset.act === "install") window.CPPublish.install();
    };
  }
  function runExport(x) {
    busy("Exporting…");
    Promise.resolve().then(function () { return x[1](cur); }).then(function (r) { busy(); if (r === false) return; toast(r === "downloads" ? "Exported to your downloads." : r ? "Exported: " + r : "Exported."); })
      .catch(function (e) { busy(); if (e && e.canceled) return; toast(e.message || String(e), "bad"); });
  }
  function popMenu(btn, items) {
    var m = $("#cpMenu"); m.innerHTML = items.map(function (it, i) { return it ? '<button data-i="' + i + '"' + (it[2] === false ? " disabled" : "") + ">" + esc(it[0]) + (it[3] ? '<kbd>' + esc(it[3]) + "</kbd>" : "") + "</button>" : "<hr>"; }).join("");
    var r = btn.getBoundingClientRect(); m.style.left = Math.max(6, Math.min(r.left, innerWidth - 280)) + "px"; m.style.top = (r.bottom + 4) + "px"; m.hidden = false;
    m.onclick = function (e) { var b = e.target.closest("[data-i]"); if (!b) return; m.hidden = true; items[+b.dataset.i][1](); };
    setTimeout(function () { document.addEventListener("pointerdown", function off(e) { if (!m.contains(e.target)) { m.hidden = true; document.removeEventListener("pointerdown", off); } }); }, 0);
  }
  var MOD = /Mac/.test(navigator.platform) ? "⌘" : "Ctrl+";
  function fileMenu(btn) {
    var d = cur && types[cur.type], open = !!cur;
    popMenu(btn, [["New project…", newDialog, true, MOD + "N"], ["Open…", openFile, true, MOD + "O"], ["Open from my account…", accountProjects], null,
      ["Save", function () { save(); }, open, MOD + "S"], ["Save as a file…", saveAsFile, open], ["Save to my account", function () { saveCloud(); }, open], null]
      .concat(open ? (d.exports || []).map(function (x) { return [x[0], function () { runExport(x); }]; }) : [])
      .concat(open ? [null, ["Install into my apps", function () { window.CPPublish.install(); }], [d.publish && d.publish.store === "tracks" ? "Publish to Central Tracks…" : "Publish to Make & sell…", function () { window.CPPublish.open(); }]] : [])
      .concat([null, ["Settings…", function () { window.CPSettings.open(); }], ["Close project", closeProject, open]]));
  }
  function closeProject() { confirmLeave().then(function (ok) { if (!ok) return; unmount(); cur = null; mod = null; dirty = false; delete document.body.dataset.type; $("#cpEditor").hidden = true; $("#cpStart").hidden = false; drawStart(); drawTop(); }); }
  function accountMenu(btn) {
    var m = H.account.cached();
    if (!H.account.token()) { signInDialog().then(function (ok) { if (ok) drawStart(); }); return; }
    popMenu(btn, [[m ? "Signed in as " + (m.email || m.name) : "Signed in", function () { }, false], ["My projects in my account…", accountProjects], ["Open the website", function () { H.openExternal((H.server() || "") + "/#account"); }], null,
      ["Sign out", function () { H.account.signOut(); drawTop(); drawStart(); toast("Signed out."); }]]);
  }

  // ------------------------------------------------------------- New project: pick what you're making
  var ICON = {
    track: '<path d="M8 34V14m8 20V8m8 26V18m8 16V11m8 23V20"/>',
    loop: '<path d="M14 18a12 12 0 1 1-2 12"/><path d="M14 10v8h8"/>',
    sample: '<path d="M4 24h6l3-9 4 18 4-24 4 30 4-20 3 9 2-4h6"/>',
    pad: '<path d="M4 30c6-10 10-10 16 0s10 10 16 0 6-6 8-4"/><path d="M4 22c6-8 10-8 16 0s10 8 16 0"/>',
    instrument: '<rect x="5" y="12" width="38" height="24" rx="3"/><path d="M13 12v14m8-14v14m8-14v14m8-14v14"/>',
    plugin: '<circle cx="15" cy="24" r="6"/><circle cx="33" cy="24" r="6"/><path d="M21 24h6M15 12v6m18-6v6m-18 18v-6m18 6v-6"/>',
    board: '<rect x="6" y="14" width="14" height="22" rx="3"/><rect x="28" y="14" width="14" height="22" rx="3"/><circle cx="13" cy="21" r="3"/><circle cx="35" cy="21" r="3"/><path d="M20 30h8"/>'
  };
  function icon(t) { return '<svg viewBox="0 0 48 48" aria-hidden="true">' + (ICON[t] || "") + "</svg>"; }
  function newDialog(pre) {
    var pick = pre && types[pre] ? pre : null;
    function form(t) {
      var d = types[t];
      return '<form class="cp-form" id="npForm"><h3>' + icon(t) + " " + esc(d.name) + '</h3><p class="muted">' + esc(d.long || d.blurb) + '</p>' +
        '<label>Name<input id="npName" maxlength="80" value="' + esc("New " + d.name.toLowerCase()) + '" autofocus></label>' +
        (d.tempo ? '<div class="cp-row"><label>Tempo <input id="npBpm" type="number" min="30" max="300" value="' + (d.tempo === true ? 100 : d.tempo) + '"></label><label>Key <select id="npKey">' + KEYS.map(function (k) { return "<option>" + k + "</option>"; }).join("") + "</select></label></div>" : "") +
        (d.options ? d.options() : "") +
        '<div class="cp-row end"><button type="button" id="npBack">Back</button><button class="primary">Make it</button></div></form>';
    }
    var d = modal('<h2>What are you making?</h2><div class="cp-kinds" id="npKinds">' + ORDER.filter(function (t) { return types[t]; }).map(function (t) {
      return '<button class="cp-kind" data-t="' + t + '">' + icon(t) + "<b>" + esc(types[t].name) + "</b><span>" + esc(types[t].blurb) + "</span></button>"; }).join("") + '</div><div id="npMore"></div><div class="cp-row end" id="npFoot"><button data-close>Cancel</button></div>', { wide: true });
    function choose(t) {
      pick = t; $("#npKinds", d).hidden = true; $("#npFoot", d).hidden = true; d.querySelector("h2").textContent = "New project";
      $("#npMore", d).innerHTML = form(t);
      $("#npBack", d).onclick = function () { $("#npKinds", d).hidden = false; $("#npFoot", d).hidden = false; $("#npMore", d).innerHTML = ""; d.querySelector("h2").textContent = "What are you making?"; };
      $("#npForm", d).onsubmit = function (e) {
        e.preventDefault();
        var opts = { name: $("#npName", d).value.trim() || "Untitled" };
        if ($("#npBpm", d)) { opts.bpm = Math.max(30, Math.min(300, +$("#npBpm", d).value || 100)); opts.key = $("#npKey", d).value; }
        if (types[t].readOptions) Object.assign(opts, types[t].readOptions(d));
        d.close(); create(t, opts);
      };
      setTimeout(function () { var n = $("#npName", d); if (n) { n.focus(); n.select(); } }, 30);
    }
    $("#npKinds", d).onclick = function (e) { var b = e.target.closest("[data-t]"); if (b) choose(b.dataset.t); };
    if (pick) choose(pick);
  }

  // ------------------------------------------------------------- the start page
  function when(t) { if (!t) return ""; var d = new Date(t), now = new Date(); return d.toDateString() === now.toDateString() ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" }); }
  function size(n) { n = Number(n) || 0; return n >= 1e9 ? (n / 1e9).toFixed(1) + " GB" : n >= 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1e3)) + " KB"; }
  function drawStart() {
    var el = $("#cpStart"); if (!el) return;
    el.innerHTML = '<div class="cp-hero"><h1>What are you making today?</h1><p>Pick one and Central Production sets everything up for it. Everything you make can go into your own apps, or to Make &amp; sell for other churches.</p></div>' +
      '<div class="cp-kinds big">' + ORDER.filter(function (t) { return types[t]; }).map(function (t) { return '<button class="cp-kind" data-new="' + t + '">' + icon(t) + "<b>" + esc(types[t].name) + "</b><span>" + esc(types[t].blurb) + "</span></button>"; }).join("") + "</div>" +
      '<div class="cp-recent"><section><div class="cp-sec-h"><h2>On this ' + (H.kind === "desktop" ? "computer" : "browser") + '</h2><button id="stOpen">Open a file…</button></div><div id="stLocal" class="cp-list"><p class="muted">Loading…</p></div></section>' +
      '<section><div class="cp-sec-h"><h2>In your account</h2><span id="stUsed" class="muted small"></span></div><div id="stCloud" class="cp-list"></div></section></div>';
    el.onclick = function (e) {
      var n = e.target.closest("[data-new]"), o = e.target.closest("[data-open]"), c = e.target.closest("[data-cloud]"), del = e.target.closest("[data-forget]");
      if (n) newDialog(n.dataset.new);
      if (del) { e.stopPropagation(); ask("Remove it from this list?", H.kind === "desktop" ? "The file stays where it is on your computer." : "It's deleted from this browser. Projects saved to your account or as files aren't touched.", "Remove").then(function (ok) { if (ok) H.local.remove(del.dataset.forget).then(drawStart); }); return; }
      if (o) H.local.open(o.dataset.open).then(function (r) { return load(r.bytes, { localId: r.entry.id, path: r.entry.path || null }); }).catch(function (er) { toast(er.message || String(er), "bad"); });
      if (c) openCloud(c.dataset.cloud);
      if (e.target.id === "stOpen") openFile();
      if (e.target.id === "stSignIn") signInDialog().then(function (ok) { if (ok) drawStart(); });
    };
    H.local.list().then(function (list) {
      $("#stLocal").innerHTML = list && list.length ? list.slice(0, 12).map(function (p) {
        return '<div class="cp-item" data-open="' + esc(p.id) + '" role="button" tabindex="0">' + icon(p.type) + '<span><b>' + esc(p.name) + '</b><span class="muted small">' + esc(types[p.type] ? types[p.type].name : p.type) + " · " + esc(when(p.savedAt)) + (p.path ? " · " + esc(p.path) : "") + '</span></span><button class="ghost small" data-forget="' + esc(p.id) + '" title="Remove from this list">✕</button></div>'; }).join("")
        : '<p class="muted">Nothing yet. Projects you save show up here.</p>';
    }).catch(function () { $("#stLocal").innerHTML = '<p class="muted">Nothing yet.</p>'; });
    if (!H.account.token()) { $("#stCloud").innerHTML = '<p class="muted">Save projects to your Motion Audio account and open them in the app or on the website.</p><button id="stSignIn">Sign in</button>'; return; }
    H.api("GET", "/projects").then(function (r) {
      $("#stUsed").textContent = size(r.used) + " of " + size(r.limit) + " used";
      $("#stCloud").innerHTML = r.projects.length ? r.projects.slice(0, 20).map(function (p) { return '<div class="cp-item" data-cloud="' + esc(p.id) + '" role="button" tabindex="0">' + icon(p.type) + '<span><b>' + esc(p.name) + '</b><span class="muted small">' + esc(types[p.type] ? types[p.type].name : p.type) + " · " + esc(when(p.updatedAt)) + " · " + size(p.bytes) + "</span></span></div>"; }).join("") : '<p class="muted">Nothing saved to your account yet. Open a project, then File → Save to my account.</p>';
    }).catch(function (e) { $("#stCloud").innerHTML = '<p class="muted">' + esc(e.message) + "</p>"; });
  }
  function accountProjects() {
    if (!H.account.token()) { signInDialog().then(function (ok) { if (ok) accountProjects(); }); return; }
    var d = modal('<h2>Projects in your account</h2><div id="apList" class="cp-list"><p class="muted">Loading…</p></div><div class="cp-row end"><span class="muted small" id="apUsed"></span><button data-close>Close</button></div>', { wide: true });
    function draw() {
      H.api("GET", "/projects").then(function (r) {
        $("#apUsed", d).textContent = size(r.used) + " of " + size(r.limit) + " used";
        $("#apList", d).innerHTML = r.projects.length ? r.projects.map(function (p) { return '<div class="cp-item">' + icon(p.type) + '<span><b>' + esc(p.name) + '</b><span class="muted small">' + esc(types[p.type] ? types[p.type].name : p.type) + " · " + esc(when(p.updatedAt)) + " · " + size(p.bytes) + '</span></span><button data-ao="' + esc(p.id) + '">Open</button><button class="ghost" data-ad="' + esc(p.id) + '">Delete</button></div>'; }).join("") : '<p class="muted">Nothing saved to your account yet.</p>';
      }).catch(function (e) { $("#apList", d).innerHTML = '<p class="err">' + esc(e.message) + "</p>"; });
    }
    d.onclick = function (e) {
      var o = e.target.closest("[data-ao]"), x = e.target.closest("[data-ad]");
      if (o) { d.close(); openCloud(o.dataset.ao); }
      if (x) ask("Delete this project from your account?", "It's gone for good from your account. Copies on your computer aren't touched.", "Delete").then(function (ok) { if (!ok) return accountProjects(); H.api("POST", "/projects/" + encodeURIComponent(x.dataset.ad) + "/delete").then(function () { toast("Deleted."); accountProjects(); }); });
    };
    draw();
  }

  // ------------------------------------------------------------- start up
  function wire() {
    $("#cpFile").onclick = function () { fileMenu(this); };
    $("#cpAccount").onclick = function () { accountMenu(this); };
    $("#cpSettings").onclick = function () { window.CPSettings.open(); };
    $("#cpUndo").onclick = undo; $("#cpRedo").onclick = redo;
    $("#cpName").onchange = function () { if (!cur) return; cur.name = this.value.trim() || "Untitled"; if (mod.daw && S) S.edit("Rename", function (p) { p.name = cur.name; }); setDirty(true); };
    document.addEventListener("keydown", function (e) {
      var k = e.key.toLowerCase(), m = e.ctrlKey || e.metaKey, typing = /input|textarea|select/i.test((e.target.tagName || "")) || e.target.isContentEditable;
      if (e.key === "Escape") { closeModal(); $("#cpMenu").hidden = true; }
      if (!m) return;
      if (k === "s") { e.preventDefault(); if (e.shiftKey) saveCloud(); else save(); }
      else if (k === "o") { e.preventDefault(); openFile(); }
      else if (k === "n") { e.preventDefault(); newDialog(); }
      else if (k === "z" && !typing && !(mod && mod.daw)) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (k === "y" && !typing && !(mod && mod.daw)) { e.preventDefault(); redo(); }
    });
    window.addEventListener("beforeunload", function (e) { if (isDirty() && H.kind === "web") { e.preventDefault(); e.returnValue = ""; } });
    if (S) S.on("change", function () { if (mod && mod.daw) drawTop(); });
    if (H.desktop && H.desktop.onOpenFile) H.desktop.onOpenFile(function (f) { load(f.bytes, { path: f.path }); });   // (a .cmproj opened from the computer's files)
    setInterval(drawTop, 3000);
  }
  function start() {
    wire(); drawTop(); drawStart();
    if (H.account.token()) H.account.me().then(drawTop).catch(function () { });
    if (H.desktop && H.desktop.pendingFile) H.desktop.pendingFile().then(function (f) { if (f) load(f.bytes, { path: f.path }); });
    var want = (location.hash.match(/new=([a-z]+)/) || [])[1]; if (want && types[want]) setTimeout(function () { newDialog(want); }, 50);
  }

  window.CP = { type: type, types: types, project: project, edit: edit, undo: undo, redo: redo, setDirty: setDirty, isDirty: isDirty, create: create, load: load, save: save, saveCloud: saveCloud, saveAsFile: saveAsFile, openCloud: openCloud,
    serialize: serialize, showStudio: showStudio, toast: toast, busy: busy, modal: modal, ask: ask, esc: esc, uid: uid, clone: clone, KEYS: KEYS, icon: icon, newDialog: newDialog, signIn: signInDialog,
    start: start, drawTop: drawTop, drawStart: drawStart, where: function () { return where; }, mod: function () { return mod; } };
})();
