/* The DAW's browser: Sounds (the built-in ones and the sound plans' - click to put one on the selected track, ▶ to hear
 * it: a 30-second preview when the library has one, else a few notes), Loops (from your installed libraries - drag one
 * onto the timeline and it's stretched to the song's tempo and moved to its key) and Files (audio from this computer).
 * Hosts can add loops: opts.loops() -> Promise<[{ id, name, bpm, key, bars, group, preview?, read() -> Promise<bytes> }]>. */
(function () {
  "use strict";
  var D = window.CDaw, UI = window.CDawUI, U = UI.U, $ = UI.$, $$ = UI.$$, esc = UI.esc, SND = window.CUStudioSounds;
  var br = { el: null, tab: UI.store("btab", "sounds"), q: "", cat: "all", loops: null, files: [], items: {}, audio: null };
  function build(el) { br.el = el; draw(); }
  function draw() {
    var el = br.el; if (!el) return;
    el.innerHTML = '<div class="cd-btabs"><button data-bt="sounds">Sounds</button><button data-bt="loops">Loops</button><button data-bt="files">Files</button></div><input class="cd-bq" placeholder="Search" value="' + esc(br.q) + '"><div class="cd-blist"></div>';
    $$("[data-bt]", el).forEach(function (b) { b.classList.toggle("on", b.dataset.bt === br.tab); b.onclick = function () { br.tab = b.dataset.bt; UI.keep("btab", br.tab); draw(); }; });
    $(".cd-bq", el).oninput = function () { br.q = this.value; list(); };
    list();
  }
  function match(s) { var q = br.q.trim().toLowerCase(); return !q || String(s).toLowerCase().indexOf(q) >= 0; }
  function preview(item) {
    stopPreview();
    var url = item.preview || (window.CDawPreviews && window.CDawPreviews.url && window.CDawPreviews.url(item));   // (the 30-second previews, when the libraries carry them)
    if (url) { br.audio = new Audio(url); br.audio.play().catch(function () { }); setTimeout(stopPreview, 30000); return true; }
    return false;
  }
  function stopPreview() { if (br.audio) { br.audio.pause(); br.audio = null; } if (br.src) { try { br.src.stop(); } catch (_) { } br.src = null; } }
  function list() {
    var box = $(".cd-blist", br.el); br.items = {};
    if (br.tab === "sounds") {
      var all = SND ? SND.list() : [], cats = SND ? SND.CAT_ORDER : [];
      box.innerHTML = '<select class="cd-bcat"><option value="all">Every kind</option>' + cats.map(function (c) { return '<option' + (br.cat === c ? " selected" : "") + ">" + esc(c) + "</option>"; }).join("") + "</select>" +
        all.filter(function (s) { return (br.cat === "all" || s.category === br.cat) && match(s.name + " " + (s.bankName || "")); }).slice(0, 400).map(function (s) { var locked = SND.locked(s); br.items["s:" + s.id] = s; return '<div class="cd-bitem' + (locked ? " locked" : "") + '" data-bi="s:' + esc(s.id) + '" title="' + esc(locked ? SND.lockText(s) : "Click: put it on the selected track") + '"><button class="cd-bplay" data-prev>▶</button><span><b>' + esc(s.name) + "</b><i>" + esc(s.category + (s.bankName && !s.builtin ? " · " + s.bankName : "")) + (locked ? " · " + esc(SND.lockText(s)) : "") + "</i></span></div>"; }).join("") +
        '<p class="cd-dim">Sounds from your sound plans show here once their library is installed (Settings → Sound plans). ' + (SND && SND.addBank ? '<button class="cd-link" data-addbank>Add a SoundFont from this computer…</button>' : "") + "</p>";
      $(".cd-bcat", box).onchange = function () { br.cat = this.value; list(); };
      var ab = $("[data-addbank]", box); if (ab) ab.onclick = function () { pick(".sf2,.sf3", function (f, bytes) { SND.addBank(f.name.replace(/\.sf[23]$/i, ""), bytes, "free"); UI.say("Added " + f.name + "."); list(); }); };
    } else if (br.tab === "loops") {
      if (!br.loops) { box.innerHTML = '<p class="cd-dim">Looking for loops…</p>'; (U.opts.loops ? U.opts.loops() : Promise.resolve([])).then(function (l) { br.loops = l || []; list(); }).catch(function () { br.loops = []; list(); }); return; }
      var groups = {}; br.loops.filter(function (l) { return match(l.name + " " + (l.group || "") + " " + (l.key || "")); }).forEach(function (l) { (groups[l.group || "Loops"] = groups[l.group || "Loops"] || []).push(l); });
      box.innerHTML = Object.keys(groups).map(function (g) { return '<div class="cd-bgroup">' + esc(g) + "</div>" + groups[g].map(function (l) { br.items["l:" + l.id] = l; return '<div class="cd-bitem" draggable="true" data-bi="l:' + esc(l.id) + '"><button class="cd-bplay" data-prev>▶</button><span><b>' + esc(l.name) + "</b><i>" + [l.bpm ? l.bpm + " BPM" : "", l.key || "", l.bars ? l.bars + " bars" : ""].filter(Boolean).join(" · ") + "</i></span></div>"; }).join(""); }).join("") ||
        '<p class="cd-dim">No loops yet. Loops come with the Central Pads library (Settings → Sound plans), and loops you make in Central Production install here too. Drag a loop onto the timeline: it plays at the song\'s tempo and in its key.</p>';
    } else {
      box.innerHTML = '<button class="cd-bwide" data-addfiles>Add audio files…</button><p class="cd-dim">Or drag files from your computer straight onto a track.</p>' +
        br.files.filter(function (f) { return match(f.name); }).map(function (f) { br.items["f:" + f.id] = f; return '<div class="cd-bitem" draggable="true" data-bi="f:' + f.id + '"><button class="cd-bplay" data-prev>▶</button><span><b>' + esc(f.name) + "</b><i>" + (f.buf ? f.buf.duration.toFixed(1) + " s" : "") + "</i></span></div>"; }).join("");
      $("[data-addfiles]", box).onclick = function () { pick("audio/*,.wav,.mp3,.aif,.aiff,.flac,.ogg", function (f, bytes) { D.decode(bytes).then(function (buf) { br.files.unshift({ id: D.uid("f"), name: f.name, bytes: bytes, buf: buf }); list(); }).catch(function () { UI.say(f.name + " isn't audio this computer can read.", true); }); }, true); };
    }
    box.onclick = function (e) {
      var it = e.target.closest("[data-bi]"); if (!it) return; var key = it.dataset.bi, item = br.items[key]; if (!item) return;
      if (e.target.closest("[data-prev]")) return previewItem(key, item);
      if (key[0] === "s") { if (SND.locked(item)) return UI.say(SND.lockText(item) + ": add your package key in Settings to use it.", true); useSound(item); }
      else addAt(key, item, null, D.snapBeat(D.state().pos));
    };
    box.ondragstart = function (e) { var it = e.target.closest("[data-bi]"); if (!it) return; e.dataTransfer.setData("application/x-cdaw", it.dataset.bi); e.dataTransfer.effectAllowed = "copy"; };
  }
  function pick(accept, fn, multi) { var i = document.createElement("input"); i.type = "file"; i.accept = accept; i.multiple = !!multi; i.onchange = function () { Array.prototype.forEach.call(i.files, function (f) { f.arrayBuffer().then(function (b) { fn(f, new Uint8Array(b)); }); }); }; i.click(); }
  function useSound(s) {
    var t = UI.track();
    if (!t || t.kind === "audio" || t.kind === "bus") { D.edit("New track: " + s.name, function () { var nt = D.newTrack(s.drums ? "drums" : "instrument", s.name.slice(0, 24), s.id); nt.color = D.COLORS[D.project().tracks.length % D.COLORS.length]; D.insertTrack(nt); U.sel = nt.id; }); UI.say("Made a new track with " + s.name + "."); return; }
    D.edit("Sound: " + s.name, function () { var tt = D.track(t.id); tt.layers = tt.layers && tt.layers.length ? tt.layers : [{ lo: 0, hi: 127, velLo: 1, velHi: 127, octave: 0, transpose: 0, volume: 1, pan: 0 }]; tt.layers[0].sound = s.id; });
    D.live(t.id, [0x90, 60, 96]); setTimeout(function () { D.live(t.id, [0x80, 60, 0]); }, 400); UI.say("“" + t.name + "” plays " + s.name + ".");
  }
  function previewItem(key, item) {
    if (preview(item)) return;
    var c = D.ctx(); if (c.state === "suspended") c.resume();
    if (key[0] === "s") { var inst = SND.instrument(c, [{ sound: item.id, lo: 0, hi: 127, velLo: 1, velHi: 127, octave: 0, volume: 1, pan: 0 }]); inst.ready.then(function () { var t = c.currentTime + 0.05; (item.drums ? [36, 42, 38, 42, 36, 36, 38, 46] : [60, 64, 67, 72]).forEach(function (n, i) { var v = inst.noteOn(c.destination, n, 90, t + i * (item.drums ? 0.2 : 0.28)); inst.noteOff(v, t + i * 0.28 + (item.drums ? 0.15 : 1.2)); }); }); return; }
    var bytesP = item.bytes ? Promise.resolve(item.bytes) : item.read ? item.read() : Promise.reject(new Error("no audio"));
    bytesP.then(function (b) { return item.buf || D.decode(b); }).then(function (buf) { item.buf = buf; var s = c.createBufferSource(); s.buffer = buf; s.loop = key[0] === "l"; s.connect(c.destination); s.start(); br.src = s; setTimeout(function () { if (br.src === s) stopPreview(); }, 30000); }).catch(function () { UI.say("That couldn't play.", true); });
  }
  // something from here onto a track at a beat
  function addAt(key, item, trackId, beat) {
    if (key[0] === "s") { if (!SND.locked(item)) useSound(item); return; }
    var bytesP = item.bytes ? Promise.resolve(item.bytes) : item.read ? item.read() : Promise.reject(new Error("no audio"));
    UI.say("Adding " + item.name + "…");
    return bytesP.then(function (b) { return D.importAudio(trackId, b, item.name, beat || 0, key[0] === "l" && item.bpm ? { bpm: item.bpm, key: item.key, bars: item.bars } : {}); })
      .then(function (r) { UI.say(key[0] === "l" && item.bpm ? "Added " + item.name + " at " + Math.round(D.tempo.bpmAt(beat || 0)) + " BPM" + (item.key ? " in " + D.project().key : "") + "." : "Added " + item.name + "."); if (r && r.track) U.sel = r.track.id; })
      .catch(function (e) { UI.say((item.name || "That") + " couldn't be added: " + (e.message || e), true); });
  }
  function drop(e, trackId, beat) {
    var key = e.dataTransfer.getData("application/x-cdaw"); if (!key) return false;
    var item = br.items[key]; if (!item) return false; addAt(key, item, trackId, beat); return true;
  }
  UI.parts.browser = { build: build, draw: draw, drop: drop, refreshLoops: function () { br.loops = null; if (br.tab === "loops") list(); } };
  if (SND && SND.onChange) SND.onChange(function () { if (br.el && br.tab === "sounds") list(); });
})();
