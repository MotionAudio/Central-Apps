/* The DAW's files (10.8): what comes in by dragging, and what goes out by dragging.
 *
 * In: drop files, or whole folders, from the computer anywhere on the timeline (daw-ui-arrange.js decides where).
 *   Audio: one file onto an audio track goes on that track. Several at once, or dropped anywhere else, each get their own
 *   new track, lined up where they were dropped: a folder of stems from MultiTracks.com or Loop Community comes in as a
 *   multitrack in one go, in the usual order (click, guide, drums, bass, keys, guitars, vocals). An empty song takes the
 *   tempo written in the names ("68 BPM").
 *   MIDI files: an instrument track for each part (CDaw.importMidi). An empty song takes the file's tempo and metre.
 *   SoundFonts (.sf2 / .sf3) and SFZ instruments (an .sfz with its samples, or the folder they're in): added to the
 *   sounds, and the track they're dropped on (or a new one) plays them (CDawUI.addInstrument, daw-ui-instruments.js).
 * Out: a track's ⤓ handle, or a selected clip's, dragged onto the desktop or into a folder saves it as a WAV (in the
 *   apps the system carries the file; in Chrome on the website, its "drag a download" does). The WAV is made while the
 *   pointer is on the handle, so it's ready by the time the drag starts. Clicking the handle saves it the usual way.
 *
 *   CDawUI.collectFiles(dataTransfer) -> Promise<{ files: [{ file, path }], folder }>
 *   CDawUI.dropFiles(got, trackId, beat) -> Promise
 *   CDawUI.trackFile(trackId, clipId?) -> Promise<{ name, data, url }>     CDawUI.dragOut(event, trackId, clipId?)
 *   CDawUI.saveFiles(folder, [{ name, data }]) */
(function () {
  "use strict";
  var D = window.CDaw, UI = window.CDawUI; if (!D || !UI) return;
  var U = UI.U;
  var AUDIO = /\.(wav|wave|mp3|flac|ogg|oga|opus|m4a|aac|aif|aiff|caf|webm)$/i, MIDI = /\.(mid|midi|smf|kar)$/i, BANK = /\.(sf2|sf3)$/i, SFZ = /\.(sfz|dspreset)$/i;
  var MAX_FILES = 256;

  // ------------------------------------------------------------- in
  UI.collectFiles = function (dt) {
    // (the entries have to be taken during the drop itself: after it, the browser forgets them)
    var items = dt && dt.items ? Array.prototype.slice.call(dt.items) : [], entries = [];
    items.forEach(function (it) { var en = it.kind === "file" && it.webkitGetAsEntry ? it.webkitGetAsEntry() : null; if (en) entries.push(en); });
    var plain = Array.prototype.slice.call((dt && dt.files) || []);
    if (!entries.length) return Promise.resolve({ files: plain.map(function (f) { return { file: f, path: f.name }; }), folder: "" });
    var out = [], folder = "";
    function walk(en, prefix) {
      if (out.length >= MAX_FILES) return Promise.resolve();
      if (en.isFile) return new Promise(function (res) { en.file(function (f) { out.push({ file: f, path: prefix + f.name }); res(); }, function () { res(); }); });
      if (!en.isDirectory) return Promise.resolve();
      if (!folder) folder = en.name;
      var rd = en.createReader(), all = [];
      return new Promise(function (res) {
        (function more() { rd.readEntries(function (batch) { if (!batch.length) { all.reduce(function (p, c) { return p.then(function () { return walk(c, prefix + en.name + "/"); }); }, Promise.resolve()).then(res); return; } all = all.concat(batch); more(); }, function () { res(); }); })();
      });
    }
    return entries.reduce(function (p, en) { return p.then(function () { return walk(en, ""); }); }, Promise.resolve()).then(function () { return { files: out.length ? out : plain.map(function (f) { return { file: f, path: f.name }; }), folder: folder }; });
  };
  function bytesOf(x) { return x.file.arrayBuffer().then(function (b) { return new Uint8Array(b); }); }
  function say(m, bad) { UI.say(m, bad); }
  UI.dropFiles = function (got, trackId, beat) {
    var files = (got && got.files) || [], name = function (x) { return x.file.name || x.path || ""; };
    var audio = files.filter(function (x) { return AUDIO.test(name(x)); }), midi = files.filter(function (x) { return MIDI.test(name(x)); }),
      banks = files.filter(function (x) { return BANK.test(name(x)); }), sfz = files.filter(function (x) { return SFZ.test(name(x)); }),
      other = files.length - audio.length - midi.length - banks.length - sfz.length;
    // an SFZ instrument brings its samples (the WAVs and FLACs next to it are its, not stems)
    if (sfz.length && UI.addInstrument) {
      return UI.addInstrument({ sfz: sfz.filter(function (x) { return /\.sfz$/i.test(name(x)); }), dspreset: sfz.filter(function (x) { return /\.dspreset$/i.test(name(x)); }), all: files }, trackId).then(function () { UI.draw("select"); }).catch(function (e) { say(e.message || String(e), true); });
    }
    var t = trackId && D.track(trackId), job = Promise.resolve(), made = [];
    // samples dropped on an instrument track play from it (a sampler); on a drums track they become the kit's pads
    if (t && t.kind !== "audio" && t.kind !== "bus" && audio.length && !midi.length && UI.addInstrument) {
      return UI.addInstrument({ samples: audio }, t.id).then(function () { UI.draw("select"); }).catch(function (e) { say(e.message || String(e), true); });
    }
    if (audio.length === 1 && t && t.kind === "audio" && audio.length + midi.length === 1) {
      job = bytesOf(audio[0]).then(function (b) { return D.importAudio(t.id, b, audio[0].file.name, beat); }).then(function () { say("Added " + audio[0].file.name + " to “" + t.name + "”."); });
    } else if (audio.length) {
      say("Bringing in " + audio.length + " file" + (audio.length > 1 ? "s" : "") + "…");
      job = Promise.all(audio.map(bytesOf)).then(function (all) {
        return D.importStems(audio.map(function (x, i) { return { bytes: all[i], name: x.file.name, path: x.path }; }), beat, { folder: got.folder });
      }).then(function (r) {
        made = made.concat(r.tracks || []);
        say((r.tracks.length > 1 ? r.tracks.length + " tracks added, lined up at bar " + (D.tempo.beatToBar(beat || 0).bar + 1) : r.tracks.length ? "Added " + r.tracks[0].name : "Nothing added") + (r.bpm ? " · the song is at " + r.bpm + " BPM, from the file names" : "") + (r.bad && r.bad.length ? " · " + r.bad.length + " couldn't be read: " + r.bad.slice(0, 3).join(", ") : "") + ".", !!(r.bad && r.bad.length && !r.tracks.length));
      });
    }
    midi.forEach(function (m) {
      job = job.then(function () { return bytesOf(m); }).then(function (b) { return D.importMidi(b, m.file.name, beat); }).then(function (r) {
        made = made.concat(r.tracks || []); say("From " + m.file.name + ": " + r.tracks.length + " instrument track" + (r.tracks.length > 1 ? "s" : "") + (r.bpm ? " · the song is at " + r.bpm + " BPM, from the file" : "") + ".");
      }).catch(function (e) { say(m.file.name + ": " + (e.message || e), true); });
    });
    if (banks.length && UI.addInstrument) job = job.then(function () { return UI.addInstrument({ banks: banks, all: files }, trackId); });
    return job.then(function () {
      if (made.length) { U.sel = made[0].id; UI.draw("select"); }
      if (other > 0 && !audio.length && !midi.length && !banks.length) say("Only audio, MIDI and instrument files (SoundFont, SFZ) can go on the timeline.", true);
    }).catch(function (e) { say(e.message || String(e), true); });
  };

  // ------------------------------------------------------------- out
  var made = {}, URLs = [];
  function fileName(t, c) { var base = String((c && c.name) || t.name || "Track").replace(/[\\/:*?"<>|]+/g, "").trim() || "Track", song = String(D.project().name || "").replace(/[\\/:*?"<>|]+/g, "").trim(); return (song ? song + " - " : "") + base + ".wav"; }
  function sig(id, clipId) { var p = D.project(); return JSON.stringify([id, clipId || "", p.bpm, p.tempos, p.sigs, p.master, p.tracks]); }
  UI.trackFile = function (id, clipId) {
    var t = D.track(id); if (!t) return Promise.reject(new Error("That track isn't there any more."));
    var c = clipId ? (D.findClip(clipId) || {}).clip : null, key = id + ":" + (clipId || ""), s = sig(id, clipId), have = made[key];
    if (have && have.sig === s) return have.p;
    var from = c ? c.start : 0, to = c ? c.start + c.len : t.clips.reduce(function (a, x) { return x.mute ? a : Math.max(a, x.start + x.len); }, 0);
    var p = D.render({ tracks: [id], clips: c ? [c.id] : null, from: from, to: to, tail: c ? 0.5 : 2 }).then(function (buf) {
      var data = new Uint8Array(window.CMProj.wav(buf, 24)), url = null;
      try { url = URL.createObjectURL(new Blob([data], { type: "audio/wav" })); URLs.push(url); while (URLs.length > 8) URL.revokeObjectURL(URLs.shift()); } catch (_) { }
      return { name: fileName(t, c), data: data, url: url };
    });
    made[key] = { sig: s, p: p, ready: null };
    p.then(function (f) { if (made[key] && made[key].p === p) made[key].ready = f; markReady(id, clipId, true); }, function () { if (made[key] && made[key].p === p) delete made[key]; });
    return p;
  };
  function markReady(id, clipId, on) { var b = document.querySelector(clipId ? '[data-cout="' + clipId + '"]' : '[data-tout="' + id + '"]'); if (b) b.classList.toggle("ready", !!on); }
  UI.dragOut = function (e, id, clipId) {
    var key = id + ":" + (clipId || ""), have = made[key], f = have && have.sig === sig(id, clipId) ? have.ready : null;
    if (!f) { e.preventDefault(); say("Getting the WAV ready - drag it again in a moment.", false); UI.trackFile(id, clipId); return; }
    var NS = window.CU && window.CU.studio;
    if (NS && NS.dragOut) { e.preventDefault(); NS.dragOut(f.name, f.data); return; }   // (the app: the system carries the file)
    try { e.dataTransfer.effectAllowed = "copy"; if (f.url) e.dataTransfer.setData("DownloadURL", "audio/wav:" + f.name + ":" + f.url); e.dataTransfer.setData("text/plain", f.name); } catch (_) { }
  };
  UI.saveFiles = function (folder, files) {
    var NS = window.CU && window.CU.studio;
    if (NS && NS.exportFiles) return NS.exportFiles(folder, files);
    if (window.CPHost && window.CPHost.exportFiles) return window.CPHost.exportFiles(folder, files);
    files.forEach(function (f) { var a = document.createElement("a"), u = URL.createObjectURL(new Blob([f.data])); a.href = u; a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000); });
    return Promise.resolve(true);
  };
})();
