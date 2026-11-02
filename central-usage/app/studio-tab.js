/* Central Usage - the Studio tab (10.2): the same DAW as Central Production (shared/daw/, from server/public/daw), in a
 * smaller layout for a musician - record ideas, loops, a quick multitrack, the instrument and pad sounds. Projects are
 * Central Production projects (.cmproj: project.json + audio): kept on this computer (<userData>/studio/), and
 * "Open in Central Production" hands the song to the full app (or the website's /production/ when it isn't installed).
 *   CUStudioTab.save() / open(id) / list() / fresh(opts) / toCmproj() -> Promise<Uint8Array> */
(function () {
  "use strict";
  var D = window.CDaw, UI = window.CDawUI, Z = window.CMProj, CU = window.CentralUsage, NAT = window.CU && window.CU.studio;
  var root = document.getElementById("view-studio"); if (!D || !UI || !root) return;
  var mounted = false, savedOnce = false;
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return UI.esc(s); }

  // ---- saving: on this computer (the app), or in this browser
  var DB = null;
  function idb() { if (DB) return DB; DB = new Promise(function (res, rej) { var r = indexedDB.open("cu-studio2", 1); r.onupgradeneeded = function () { r.result.createObjectStore("projects"); }; r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); return DB; }
  function tx(mode, fn) { return idb().then(function (db) { return new Promise(function (res, rej) { var t = db.transaction("projects", mode), r = fn(t.objectStore("projects")); t.oncomplete = function () { res(r && r.result); }; t.onerror = function () { rej(t.error); }; }); }); }
  function audioFiles() { var out = {}; D.usedAudio().forEach(function (id) { out["audio/" + id + ".wav"] = new Uint8Array(Z.wav(D.buffers[id], 24)); }); return out; }
  function save() {
    var p = D.project(); p.savedAt = Date.now();
    var json = JSON.stringify(p), files = audioFiles(), done;
    if (NAT && NAT.save) { var audio = {}; Object.keys(files).forEach(function (n) { audio[n.slice(6)] = files[n]; }); p.audioFiles = Object.keys(audio); done = NAT.save(p.id, JSON.stringify(p), audio); }
    else done = tx("readwrite", function (st) { return st.put({ id: p.id, name: p.name, savedAt: p.savedAt, bytes: Z.pack(wrap(p), files) }, p.id); });
    return done.then(function () { savedOnce = true; D.markSaved(); UI.say("Saved “" + p.name + "”."); return p.id; }).catch(function (e) { UI.say("Couldn't save: " + (e.message || e), true); throw e; });
  }
  function wrap(p) { return { format: "central-production", version: 1, id: p.id, type: "track", name: p.name, createdAt: p.createdAt || Date.now(), savedAt: Date.now(), app: "central-usage", bpm: p.bpm, key: p.key, data: { title: p.name, artist: "", click: true, roles: {}, lyrics: {}, chords: {} }, daw: p }; }
  function list() {
    if (NAT && NAT.list) return NAT.list();
    return tx("readonly", function (st) { return st.getAll(); }).then(function (a) { return (a || []).map(function (x) { return { id: x.id, name: x.name, savedAt: x.savedAt }; }).sort(function (a2, b) { return b.savedAt - a2.savedAt; }); });
  }
  function open(id) {
    var c = D.ctx();
    if (NAT && NAT.load) return NAT.load(id).then(function (p) {
      if (!p) throw new Error("That song wasn't found.");
      var bufs = {}; return Promise.all((p.audioFiles || []).map(function (f) { return NAT.audio(p.id, f).then(function (b) { if (!b) return; return Z.decode(c, new Uint8Array(b.buffer ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : b)).then(function (buf) { bufs[f.replace(/\.wav$/, "")] = buf; }); }).catch(function () { }); })).then(function () { D.load(p, bufs); savedOnce = true; return p; });
    });
    return tx("readonly", function (st) { return st.get(id); }).then(function (x) { if (!x) throw new Error("That song wasn't found."); return openBytes(x.bytes); });
  }
  function openBytes(bytes) {
    return Z.unpack(bytes).then(function (r) {
      var p = r.project.daw; if (!p) throw new Error("That project isn't a song or a loop - open it in Central Production.");
      var bufs = {}, c = D.ctx();
      return Promise.all(Object.keys(r.files).filter(function (n) { return /^audio\/.+\.wav$/.test(n); }).map(function (n) { return Z.decode(c, r.files[n]).then(function (b) { bufs[n.slice(6, -4)] = b; }); })).then(function () { D.load(p, bufs); savedOnce = true; return p; });
    });
  }
  function remove(id) { return NAT && NAT.remove ? NAT.remove(id) : tx("readwrite", function (st) { return st.delete(id); }); }
  function toCmproj() { return Promise.resolve(Z.pack(wrap(D.project()), audioFiles())); }
  function fresh(o) { D.fresh(Object.assign({ name: "New song", tracks: [["instrument", "Keys", "builtin:keys"], ["drums", "Drums", "builtin:kit"], ["instrument", "Bass", "builtin:bass"], ["audio", "Voice", null]] }, o || {})); savedOnce = false; }

  // ---- the song menu (the Studio's own row above the DAW)
  function bar() {
    var b = $(".cu-studio-bar", root), p = D.project();
    b.innerHTML = '<input class="cu-st-name" value="' + esc(p.name) + '" aria-label="Song name"><button data-s="new">New</button><button data-s="open">Open…</button><button data-s="save">Save</button><button data-s="export">Export ▾</button><span class="cu-st-saved">' + (D.isDirty() ? "Not saved" : p.savedAt ? "Saved" : "") + "</span>";
    $(".cu-st-name", b).onchange = function () { var v = this.value.trim() || "Untitled"; D.edit("Rename", function (q) { q.name = v; }); };
    b.onclick = function (e) {
      var a = e.target.closest("[data-s]"); if (!a) return; var k = a.dataset.s;
      if (k === "new") { if (D.isDirty() && !confirm("Start a new song? What isn't saved here will be lost.")) return; var dsp = CU && CU.state && CU.state.display, s = dsp && dsp.song; fresh({ bpm: (dsp && dsp.bpm) || (s && s.bpm) || 100, key: s && s.key ? String(s.key) : "C" }); }
      else if (k === "save") save();
      else if (k === "open") openDialog(a);
      else if (k === "export") UI.menu(a, [["The mix (WAV)", function () { exportMix(); }], ["Stems (a WAV per track)", function () { exportStems(); }], ["As a Central Production project (.cmproj)", function () { toCmproj().then(function (bytes) { deliver(Z.slug(D.project().name) + ".cmproj", [{ name: Z.slug(D.project().name) + ".cmproj", data: bytes }]); }); }]]);
    };
  }
  function deliver(name, files) {
    if (NAT && NAT.exportFiles) return NAT.exportFiles(name, files.map(function (f) { return { name: f.name, data: f.data }; })).then(function (r) { UI.say(r ? "Exported: " + r : "Export cancelled."); });
    files.forEach(function (f) { Z.download(f.name, f.data); }); UI.say("Exported to your downloads."); return Promise.resolve();
  }
  function exportMix() { UI.say("Exporting…"); return D.render().then(function (b) { return deliver(D.project().name, [{ name: Z.slug(D.project().name) + ".wav", data: new Uint8Array(Z.wav(b, 24)) }]); }).catch(function (e) { UI.say(e.message || String(e), true); }); }
  function exportStems() { UI.say("Exporting stems…"); return D.stems().then(function (l) { return deliver(D.project().name + " stems", l.map(function (x, i) { return { name: String(i + 1).padStart(2, "0") + " " + x.track.name.replace(/[^\w\- ]+/g, "") + ".wav", data: new Uint8Array(Z.wav(x.buffer, 24)) }; })); }).catch(function (e) { UI.say(e.message || String(e), true); }); }
  function openDialog(btn) {
    list().then(function (l) {
      if (!l.length) return UI.say("No saved songs yet.");
      UI.menu(btn, l.slice(0, 30).map(function (x) { return [x.name + (x.savedAt ? " · " + new Date(x.savedAt).toLocaleDateString() : ""), function () { if (D.isDirty() && !confirm("Open another song? What isn't saved here will be lost.")) return; open(x.id).then(function () { UI.say("Opened “" + x.name + "”."); }).catch(function (e) { UI.say(e.message, true); }); }]; }));
    });
  }
  // ---- Open in Central Production: the app on this computer if it's there, else the website
  function openInProduction() {
    toCmproj().then(function (bytes) {
      if (NAT && NAT.openInProduction) return NAT.openInProduction(Z.slug(D.project().name) + ".cmproj", bytes).then(function (r) {
        if (r && r.ok) UI.say("Opened in Central Production.");
        else { UI.say("Central Production isn't installed on this computer: we saved the song as a file you can open on the website's Central Production page" + (r && r.path ? " (" + r.path + ")" : "") + ".", true); if (r && r.web) window.open(r.web, "_blank"); }
      });
      return Z.download(Z.slug(D.project().name) + ".cmproj", bytes); window.open("/production/", "_blank");
    });
  }
  // loops for the browser panel: the installed libraries' (the app reads them)
  function loops() { return NAT && NAT.loops ? NAT.loops().then(function (l) { return (l || []).map(function (x) { return Object.assign({}, x, { read: function () { return NAT.readLoop(x.file).then(function (b) { return new Uint8Array(b.buffer ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : b); }); } }); }); }) : Promise.resolve([]); }

  function mount() {
    if (mounted) return; mounted = true;
    root.innerHTML = '<div class="cu-studio-bar"></div><div class="cu-studio-daw"></div>';
    fresh({});
    UI.mount($(".cu-studio-daw", root), { layout: "compact", openInProduction: openInProduction, onSave: save, loops: loops });
    bar(); D.on("change", function (w) { if (w !== "nudge") bar(); });
    UI.offerRecovery("central-usage", function () { bar(); });
  }
  if (CU) CU.on("tab", function (t) { if (t !== "studio") return; setTimeout(mount, 0); });
  window.CUStudioTab = { save: save, open: open, openBytes: openBytes, list: list, remove: remove, fresh: fresh, toCmproj: toCmproj, exportMix: exportMix, exportStems: exportStems, mounted: function () { return mounted; } };
})();
