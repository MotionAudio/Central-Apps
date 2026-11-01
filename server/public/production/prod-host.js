/* Central Production - where it runs: the website (/production/) or the app on a computer (window.CPDesktop, from the
 * app's preload). Everything that differs between the two is here, so the rest of the page is the same in both.
 *
 *   CPHost.kind                 "web" | "desktop"
 *   CPHost.server()             the Motion Audio website's address ("" on the website itself: the same address)
 *   CPHost.api(method, path, body) -> Promise   the website's /v1 API, signed in when there's a token
 *   CPHost.put(url, bytes, type) / get(url)     a file straight to / from storage (signed links)
 *   CPHost.local: list() / save(entry, bytes) / open(id) / remove(id)   projects kept on this computer
 *     (the app: files on disk, with a list of recent ones; the website: this browser's storage)
 *   CPHost.saveAs(name, bytes) / openFile() / exportFiles(folderName, files)
 *   CPHost.account: { me(), signIn(email, password), code(ticket, code), signOut(), token() }
 */
(function () {
  "use strict";
  var D = window.CPDesktop || null;
  var kind = D ? "desktop" : "web";
  function server() { if (D) return String(D.server() || "").replace(/\/+$/, ""); return location.protocol === "file:" ? "" : location.origin; }
  var TOKEN = "ma-token";   // (the same sign-in as the rest of the website)
  function token() { try { return localStorage.getItem(TOKEN) || ""; } catch (_) { return ""; } }
  function setToken(t) { try { if (t) localStorage.setItem(TOKEN, t); else localStorage.removeItem(TOKEN); } catch (_) { } }
  function api(method, path, body) {
    var base = server();
    if (!base) return Promise.reject(Object.assign(new Error(D ? "The Motion Audio website isn't set up in this app yet: Settings → Website address." : "The Motion Audio website can't be reached from here."), { status: 0, noServer: true }));
    var t = token();
    return fetch(base + "/v1" + path, { method: method, headers: Object.assign({ "Content-Type": "application/json" }, t ? { Authorization: "Bearer " + t } : {}), body: body ? JSON.stringify(body) : undefined })
      .catch(function () { throw Object.assign(new Error("The Motion Audio website didn't answer. Check the internet connection and try again."), { status: 0 }); })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { if (r.status === 401) setToken(""); throw Object.assign(new Error(j.error || "Something went wrong (" + r.status + ")."), { status: r.status }); } return j; }); });
  }
  function put(url, data, type, onProgress) {
    if (D && D.put) return D.put(url, data, type || "application/octet-stream");   // (the app sends it itself: no browser rules about other addresses)
    return new Promise(function (ok, bad) {
      var x = new XMLHttpRequest(); x.open("PUT", url); x.setRequestHeader("Content-Type", type || "application/octet-stream");
      x.upload.onprogress = function (e) { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      x.onload = function () { x.status >= 200 && x.status < 300 ? ok() : bad(new Error("The upload didn't go through (" + x.status + "). Try again.")); };
      x.onerror = function () { bad(new Error("The upload didn't go through. Check the internet connection and try again.")); };
      x.send(data instanceof Blob ? data : new Blob([data], { type: type }));
    });
  }
  function get(url) {
    if (D && D.get) return D.get(url).then(function (b) { return new Uint8Array(b); });
    return fetch(url).then(function (r) { if (!r.ok) throw new Error("The download didn't come (" + r.status + ")."); return r.arrayBuffer(); }).then(function (b) { return new Uint8Array(b); });
  }

  // ---- projects on this computer
  var DB = null;
  function idb() { if (DB) return DB; DB = new Promise(function (res, rej) { var r = indexedDB.open("central-production", 1); r.onupgradeneeded = function () { r.result.createObjectStore("projects"); r.result.createObjectStore("files"); }; r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); return DB; }
  function tx(store, mode, fn) { return idb().then(function (db) { return new Promise(function (res, rej) { var t = db.transaction(store, mode), st = t.objectStore(store), r = fn(st); t.oncomplete = function () { res(r && r.result); }; t.onerror = function () { rej(t.error); }; t.onabort = function () { rej(t.error || new Error("This browser's storage is full. Save the project to your account or as a file instead.")); }; }); }); }
  var local = D ? {
    list: function () { return D.recent(); },
    save: function (entry, bytes) { return D.saveProject(entry, bytes); },   // -> { path, id, name, type, savedAt }
    open: function (id) { return D.openRecent(id); },                        // -> { entry, bytes }
    remove: function (id) { return D.forgetRecent(id); }
  } : {
    list: function () { return tx("projects", "readonly", function (st) { return st.getAll(); }).then(function (a) { return (a || []).sort(function (x, y) { return (y.savedAt || 0) - (x.savedAt || 0); }); }); },
    save: function (entry, bytes) { var e = Object.assign({}, entry, { savedAt: Date.now(), bytes: bytes.length }); return tx("files", "readwrite", function (st) { return st.put(bytes, e.id); }).then(function () { return tx("projects", "readwrite", function (st) { return st.put(e, e.id); }); }).then(function () { return e; }); },
    open: function (id) { return Promise.all([tx("projects", "readonly", function (st) { return st.get(id); }), tx("files", "readonly", function (st) { return st.get(id); })]).then(function (r) { if (!r[0] || !r[1]) throw new Error("That project isn't in this browser any more."); return { entry: r[0], bytes: r[1] }; }); },
    remove: function (id) { return tx("files", "readwrite", function (st) { return st.delete(id); }).then(function () { return tx("projects", "readwrite", function (st) { return st.delete(id); }); }); }
  };
  function saveAs(name, bytes) { if (D) return D.saveAs(name, bytes); window.CMProj.download(name, bytes, "application/zip"); return Promise.resolve({ path: "downloads" }); }
  function openFile(accept) {
    if (D && !accept) return D.openFile();   // -> { path, bytes } or null
    return new Promise(function (res) {
      var i = document.createElement("input"); i.type = "file"; i.accept = accept || ".cmproj,.zip"; i.style.display = "none"; document.body.appendChild(i);
      i.onchange = function () { var f = i.files && i.files[0]; i.remove(); if (!f) return res(null); f.arrayBuffer().then(function (b) { res({ path: f.name, name: f.name, bytes: new Uint8Array(b) }); }); };
      i.click();
    });
  }
  // pick audio (or other) files: [{ name, bytes }]
  function pickFiles(accept, multiple) {
    return new Promise(function (res) {
      var i = document.createElement("input"); i.type = "file"; i.accept = accept || "audio/*,.wav,.mp3,.aif,.aiff,.flac,.ogg"; i.multiple = multiple !== false; i.style.display = "none"; document.body.appendChild(i);
      i.onchange = function () { var fs = Array.prototype.slice.call(i.files || []); i.remove(); Promise.all(fs.map(function (f) { return f.arrayBuffer().then(function (b) { return { name: f.name, bytes: new Uint8Array(b) }; }); })).then(res); };
      i.click();
    });
  }
  function exportFiles(folder, files) {
    if (D) return D.exportFiles(folder, files.map(function (f) { return { name: f.name, data: f.data }; }));
    if (files.length === 1) { window.CMProj.download(files[0].name, files[0].data); return Promise.resolve("downloads"); }
    window.CMProj.download(window.CMProj.slug(folder) + ".zip", window.CMProj.zip(files), "application/zip"); return Promise.resolve("downloads");
  }

  // ---- the account (the same sign-in as the website)
  var me = null;
  var account = {
    token: token,
    me: function (fresh) { if (me && !fresh) return Promise.resolve(me); if (!token()) return Promise.resolve(null); return api("GET", "/me").then(function (m) { me = m; return m; }).catch(function (e) { if (e.status === 401) { me = null; return null; } throw e; }); },
    cached: function () { return me; },
    signIn: function (email, password) {
      var dev = window.PPLicense && PPLicense.deviceId ? PPLicense.deviceId() : "cp-" + Math.random().toString(36).slice(2);
      return api("POST", "/login", { email: email, password: password, device: dev }).then(function (r) { if (r.token) { setToken(r.token); me = null; return account.me(true).then(function () { return { ok: true }; }); } return r; });
    },
    step: function (path, body) { return api("POST", path, body).then(function (r) { if (r.token) { setToken(r.token); me = null; return account.me(true).then(function () { return { ok: true }; }); } return r; }); },
    signOut: function () { setToken(""); me = null; },
    signUpUrl: function () { return (server() || "") + "/#account"; }
  };
  // loops for the DAW's browser: the installed libraries' (the app reads them from disk)
  function loops() { return D && D.loops ? D.loops().then(function (l) { return (l || []).map(function (x) { return Object.assign({}, x, { read: function () { return D.readLoop(x.file).then(function (b) { return new Uint8Array(b); }); } }); }); }) : Promise.resolve([]); }
  window.CPHost = { kind: kind, loops: loops, desktop: D, server: server, api: api, put: put, get: get, local: local, saveAs: saveAs, openFile: openFile, pickFiles: pickFiles, exportFiles: exportFiles, account: account,
    openExternal: function (url) { if (D && D.openExternal) D.openExternal(url); else window.open(url, "_blank", "noopener"); } };
})();
