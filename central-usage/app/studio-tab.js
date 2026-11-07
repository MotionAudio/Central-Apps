/* Central Usage - the Studio tab (10.2): the same DAW as Central Production (shared/daw/, from server/public/daw), in a
 * smaller layout for a musician - record ideas, loops, a quick multitrack, the instrument and pad sounds. Projects are
 * Central Production projects (.cmproj: project.json + audio): kept on this computer (<userData>/studio/), and
 * "Open in Central Production" hands the song to the full app (or the website's /production/ when it isn't installed).
 * (10.5) Make a loop: New -> New loop picks the bars; the DAW loops them while you record or draw; "Hear it as a loop"
 * plays it round and round; the export is seamless (the reverb's tail wraps round to the start) and "Add to my loops"
 * puts it in this computer's apps as one of your own loops (the texture channels, the Instrument tab, the loop browser).
 *   CUStudioTab.save() / open(id) / list() / fresh(opts) / toCmproj() -> Promise<Uint8Array>
 *   CUStudioTab.loop: isLoop() / bars() / setBars(n) / render(set) -> Promise<[{name, buf}]> / asLoop(buf, seconds) / library(loops) */
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
  function fresh(o) { D.fresh(Object.assign({ name: "New song", tracks: [["instrument", "Keys", "builtin:keys"], ["drums", "Drums", "builtin:kit"], ["instrument", "Bass", "builtin:bass"], ["audio", "Voice", null]] }, o || {})); savedOnce = false; loopSet = false; }

  // ---- (10.5) loops: a project whose DAW loop runs from bar 1 is "a loop" here; its length is the loop's bars
  var loopSet = false, auditionNode = null;   // (a loop per track, rather than one of everything; what "Hear it" is playing)
  function isLoop() { var p = D.project(); return !!(p.loop && p.loop.on && p.loop.start === 0 && p.loop.end > 0); }
  function loopBars() { var p = D.project(); return isLoop() ? Math.max(1, Math.round(D.tempo.beatToBar(p.loop.end).bar)) : 0; }
  function setLoopBars(n) { n = Math.max(1, Math.min(32, n | 0)); D.edit("Loop length", function (q) { q.loop = { on: true, start: 0, end: D.tempo.barToBeat(n) }; }); bar(); }
  function freshLoop(o) {
    var bars = (o && o.bars) || 4;
    D.fresh(Object.assign({ name: "New loop", tracks: [["drums", "Drums", "builtin:kit"], ["instrument", "Bass", "builtin:bass"], ["instrument", "Keys", "builtin:keys"], ["instrument", "Pad", "builtin:pad"], ["audio", "Audio", null]] }, o || {}));
    D.edit("Loop", function (q) { q.loop = { on: true, start: 0, end: D.tempo.barToBeat(bars) }; q.metronome = Object.assign({}, q.metronome || {}, { on: true }); });
    D.markSaved(); savedOnce = false; loopSet = false;
  }
  // the render past the loop's end folded back onto its start, so the reverb and delay tails come round: seamless
  function asLoop(buf, seconds, startSec) {
    var rate = buf.sampleRate, start = Math.round((startSec || 0) * rate), n = Math.round(seconds * rate), out = new AudioBuffer({ numberOfChannels: Math.max(1, buf.numberOfChannels), length: Math.max(1, n), sampleRate: rate });
    for (var c = 0; c < buf.numberOfChannels; c++) {
      var src = buf.getChannelData(c), dst = out.getChannelData(c);
      for (var i = 0; i < n; i++) dst[i] = src[start + i] || 0;
      for (var j = start + n, k = 0; j < src.length; j++, k++) dst[k % n] += src[j];
      for (var m = 0; m < n; m++) dst[m] = Math.max(-1, Math.min(1, dst[m]));
    }
    return out;
  }
  function renderLoops(set) {
    var p = D.project(), end = p.loop.end, secs = D.tempo.beatToSec(end), bars = loopBars();
    if (!isLoop()) return Promise.reject(new Error("This is a song, not a loop: New → New loop makes one."));
    if (!p.tracks.some(function (t) { return t.clips.some(function (c) { return c.start < end && !c.mute; }); })) return Promise.reject(new Error("The loop is empty: record or draw clips in bars 1 to " + bars + "."));
    if (!set) return D.render({ from: 0, to: end }).then(function (b) { return [{ name: p.name, buf: asLoop(b, secs, 0.02) }]; });
    var out = [], list = p.tracks.filter(function (t) { return t.kind !== "bus" && t.clips.some(function (c) { return c.start < end && !c.mute; }); });
    return list.reduce(function (pr, t) { return pr.then(function () { return D.render({ from: 0, to: end, tracks: [t.id] }).then(function (b) { out.push({ name: p.name + " - " + t.name, buf: asLoop(b, secs, 0.02) }); }); }); }, Promise.resolve()).then(function () { return out; });
  }
  function stopAudition() { if (auditionNode) { try { auditionNode.stop(); } catch (_) { } auditionNode = null; } var b = $("[data-s=\"hear\"]", root); if (b) b.textContent = "▶ Hear it as a loop"; }
  function hear() {
    if (auditionNode) { stopAudition(); return; }
    UI.say("Rendering the loop…");
    renderLoops(false).then(function (l) {
      var c = D.ctx(), src = c.createBufferSource(); src.buffer = l[0].buf; src.loop = true; src.connect(c.destination); src.start(); auditionNode = src;
      var b = $("[data-s=\"hear\"]", root); if (b) b.textContent = "■ Stop";
      UI.say("Playing it as a loop - the end runs into the start. Esc, or the button again, stops it.");
    }).catch(function (e) { UI.say(e.message || String(e), true); });
  }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") stopAudition(); });
  var KEYS12 = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"], KEYSB = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  function sha256(bytes) { return crypto.subtle.digest("SHA-256", bytes).then(function (h) { return Array.prototype.map.call(new Uint8Array(h), function (b) { return ("0" + b.toString(16)).slice(-2); }).join(""); }); }
  // a small library of your own (plan "free", personal - the same shape Central Production's "Install into my apps" makes)
  function library(loops) {
    var p = D.project(), id = ("my-" + Z.slug(p.name, "loop")).slice(0, 48) + "-" + String(p.id).slice(-6).toLowerCase().replace(/[^a-z0-9]/g, "x"), key = KEYS12[KEYSB.indexOf(String(p.key || "").replace(/m$/, ""))] || undefined;
    var files = loops.map(function (l, i) { return { name: "loops/" + String(i + 1).padStart(2, "0") + "-" + Z.slug(l.name, "loop") + ".wav", data: new Uint8Array(Z.wav(l.buf, 24)), loop: l }; });
    return Promise.all(files.map(function (f) { return sha256(f.data); })).then(function (sums) {
      var items = files.map(function (f, i) { return { kind: "loop", file: f.name, name: f.loop.name, set: Z.slug(p.name, "loops"), group: "My loops", bpm: p.bpm, key: key, bars: loopBars(), seconds: Math.round(f.loop.buf.duration * 100) / 100, license: "Yours", sha256: sums[i] }; });
      var man = { format: 1, id: id, plan: "free", personal: true, version: "1." + Math.floor(Date.now() / 1000), title: p.name, summary: "Made in Central Usage's Studio", items: items };
      return { id: id, zip: Z.zip([{ name: "manifest.json", data: JSON.stringify(man, null, 1) }].concat(files.map(function (f) { return { name: f.name, data: f.data }; }))) };
    });
  }
  function addToMyLoops() {
    UI.say("Rendering the loop…");
    renderLoops(loopSet).then(library).then(function (lib) {
      var L = window.CU && window.CU.libraries;
      if (L && L.installBytes) return L.installBytes(lib.id + ".zip", lib.zip).then(function (r) {
        if (!r || !r.ok) throw new Error((r && r.error) || "It couldn't be installed.");
        UI.say("“" + D.project().name + "” is in your loops now (" + (loopSet ? "one per track" : "one loop") + ") - in the texture channels, the Instrument tab and the loop browser; it needs no plan.");
        if (window.PPLibraries && window.PPLibraries.load) window.PPLibraries.load();
      });
      Z.download(lib.id + ".zip", lib.zip, "application/zip");
      UI.say("Saved " + lib.id + ".zip to your downloads: Settings → Packages → Libraries → Install from a file puts it in your apps.");
    }).catch(function (e) { UI.say(e.message || String(e), true); });
  }
  function exportLoop() {
    UI.say("Rendering the loop…");
    return renderLoops(loopSet).then(function (l) { return deliver(D.project().name + " loop", l.map(function (x) { return { name: x.name.replace(/[^\w\- ]+/g, "") + " " + D.project().bpm + "bpm " + D.project().key + ".wav", data: new Uint8Array(Z.wav(x.buf, 24)) }; })); }).catch(function (e) { UI.say(e.message || String(e), true); });
  }

  // ---- the song menu (the Studio's own row above the DAW)
  function bar() {
    var b = $(".cu-studio-bar", root), p = D.project(), lp = isLoop(), bars = loopBars();
    b.innerHTML = '<input class="cu-st-name" value="' + esc(p.name) + '" aria-label="' + (lp ? "Loop" : "Song") + ' name"><button data-s="new">New ▾</button><button data-s="open">Open…</button><button data-s="save">Save</button><button data-s="export">Export ▾</button>' +
      (lp ? '<span class="cu-st-loop"><b>Loop</b><label>Length <select data-s="bars">' + [1, 2, 4, 8, 16].map(function (n) { return '<option value="' + n + '"' + (n === bars ? " selected" : "") + ">" + n + " bar" + (n > 1 ? "s" : "") + "</option>"; }).join("") + "</select></label>" +
        '<span class="cu-seg"><button data-s="one"' + (loopSet ? "" : ' class="on"') + '>One loop</button><button data-s="set"' + (loopSet ? ' class="on"' : "") + '>A loop per track</button></span>' +
        '<button data-s="hear">' + (auditionNode ? "■ Stop" : "▶ Hear it as a loop") + '</button><button data-s="mine" class="primary">+ Add to my loops</button></span>' : "") +
      '<span class="cu-st-saved">' + (D.isDirty() ? "Not saved" : p.savedAt ? "Saved" : "") + "</span>" +
      (lp ? '<span class="cu-st-hint">The DAW loops bars 1-' + bars + ' while you work. The export is seamless: the reverb and delay tails wrap round to the start.</span>' : "");
    $(".cu-st-name", b).onchange = function () { var v = this.value.trim() || "Untitled"; D.edit("Rename", function (q) { q.name = v; }); };
    var sel = $('select[data-s="bars"]', b); if (sel) sel.onchange = function () { setLoopBars(+this.value); };
    b.onclick = function (e) {
      var a = e.target.closest("[data-s]"); if (!a || a.tagName === "SELECT") return; var k = a.dataset.s;
      var dsp = CU && CU.state && CU.state.display, sg = dsp && dsp.song, ctx = { bpm: (dsp && dsp.bpm) || (sg && sg.bpm) || 100, key: sg && sg.key ? String(sg.key) : "C" };
      if (k === "new") UI.menu(a, [["New song", function () { if (D.isDirty() && !confirm("Start a new song? What isn't saved here will be lost.")) return; stopAudition(); fresh(ctx); }],
        ["New loop (4 bars)", function () { if (D.isDirty() && !confirm("Start a new loop? What isn't saved here will be lost.")) return; stopAudition(); freshLoop(Object.assign({ bars: 4 }, ctx)); }],
        ["New loop (8 bars)", function () { if (D.isDirty() && !confirm("Start a new loop? What isn't saved here will be lost.")) return; stopAudition(); freshLoop(Object.assign({ bars: 8 }, ctx)); }]]);
      else if (k === "save") save();
      else if (k === "open") openDialog(a);
      else if (k === "one") { loopSet = false; bar(); }
      else if (k === "set") { loopSet = true; bar(); }
      else if (k === "hear") hear();
      else if (k === "mine") addToMyLoops();
      else if (k === "export") UI.menu(a, (lp ? [["The loop (WAV, seamless)", function () { exportLoop(); }]] : []).concat([["The mix (WAV)", function () { exportMix(); }], ["Stems (a WAV per track)", function () { exportStems(); }], ["As a Central Production project (.cmproj)", function () { toCmproj().then(function (bytes) { deliver(Z.slug(D.project().name) + ".cmproj", [{ name: Z.slug(D.project().name) + ".cmproj", data: bytes }]); }); }]]));
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
  window.CUStudioTab = { save: save, open: open, openBytes: openBytes, list: list, remove: remove, fresh: fresh, toCmproj: toCmproj, exportMix: exportMix, exportStems: exportStems, mounted: function () { return mounted; },
    loop: { isLoop: isLoop, bars: loopBars, setBars: setLoopBars, fresh: freshLoop, render: renderLoops, asLoop: asLoop, library: library, hear: hear, stop: stopAudition, addToMyLoops: addToMyLoops, exportLoop: exportLoop, setPerTrack: function (v) { loopSet = !!v; bar(); }, perTrack: function () { return loopSet; } } };
})();
