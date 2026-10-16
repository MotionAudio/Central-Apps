/* Central Control - scenes: everything saved per song, recalled smoothly.
 *
 * A scene is a snapshot of any of:
 *   pads  - up to 4 pads playing at once, each at its own level (the pad layers)
 *   mix   - every track's fader, mute and pan
 *   rig   - the instrument: which pedals are on, each pedal's mix and level, the keys layers and their volumes
 *           (and, when captured "with the board", the whole pedalboard / keys setup for the song)
 * and how to get there:
 *   fade (s), style (smooth / cut / swell), when (now / next beat / next bar).
 * Triggers - automatic: the song's start scene when the song is chosen, a section's scene when that section starts;
 *            triggered: tap it (mixer, pads screen, song editor), or a footswitch / knob ("Scene: next", "Scene N");
 *            MIDI-cued: a note, CC or program change you teach it (any channel or one channel).
 * A song can also be called up by its own MIDI cue.
 */
(function () {
  "use strict";
  var PP = window.PP, F = window.PPFeatures; if (!PP || !F) return;
  var engine = PP.engine, esc = PP.escapeHtml, clamp = PP.clamp;
  function $(s, r) { return (r || document).querySelector(s); }
  function project() { return PP.project(); }
  function T() { return window.PPTracks; }
  function I() { return window.PPInstrument; }
  function song() { return PP.activeSong(); }
  function uid() { return Math.random().toString(36).slice(2, 10); }
  var MAX_PAD_LAYERS = 4;

  function scenes(s) { s = s || song(); if (!s) return []; if (!Array.isArray(s.scenes)) s.scenes = []; return s.scenes; }
  function byId(s, id) { return scenes(s).filter(function (x) { return x.id === id; })[0] || null; }
  var active = { songId: null, id: null };
  var learning = null;   // {kind:"scene", id} or {kind:"song", songId}

  // ------------------------------------------------------------- capture / recall
  function capture(parts, full) {
    var out = {};
    if (parts.pads) out.pads = engine.layerState().slice(0, MAX_PAD_LAYERS).map(function (l) { return { pad: l.pad, level: Math.round(l.level * 100) / 100 }; });
    if (parts.mix && T() && song() && T().data(song()).stems.length) out.mix = T().captureMix();
    if (parts.rig && I() && I().kind() !== "off") out.rig = I().captureRig(!!full);
    return out;
  }
  function describe(sc) {
    var bits = [];
    if (sc.pads) bits.push(sc.pads.length ? sc.pads.map(function (l) { var p = project().pads[l.pad]; return (p ? p.name : "pad " + (l.pad + 1)) + (l.level !== 1 ? " " + Math.round(l.level * 100) + "%" : ""); }).join(" + ") : "pads off");
    if (sc.mix) bits.push("mix of " + sc.mix.length + " track" + (sc.mix.length === 1 ? "" : "s"));
    if (sc.rig) bits.push(sc.rig.kind === "keys" ? "keys (" + ((sc.rig.layers || []).filter(function (l) { return l.on; }).length) + " layer" + (((sc.rig.layers || []).filter(function (l) { return l.on; }).length) === 1 ? "" : "s") + ")" : (sc.rig.pedals || []).filter(function (p) { return p.on; }).length + " pedals on" + (sc.rig.chain ? " + board" : ""));
    return bits.join(" · ") || "empty - press Capture";
  }
  // how long until the scene should happen (next beat / bar of the song that is playing)
  function waitFor(sc) {
    var t = T(), s = song(); if (!sc.when || sc.when === "now" || !t || !t.isPlaying() || !s) return 0;
    var st = t.state, bar = t.timeToBar(s, st.pos), speed = (t.data(s).tempoPercent || 100) / 100, next;
    if (sc.when === "bar") next = t.barStart(s, bar.bar + 1);
    else { var bs = t.barStart(s, bar.bar), bpb = t.beatsInBar(s) || 4, bl = (t.barStart(s, bar.bar + 1) - bs) / bpb; next = bs + Math.ceil((st.pos - bs + 0.001) / bl) * bl; }
    return Math.max(0, (next - st.pos) / speed);
  }
  var pending = 0;
  function recall(sc, opts) {
    if (!sc) return;
    opts = opts || {};
    var wait = opts.now ? 0 : waitFor(sc);
    clearTimeout(pending);
    if (wait > 0.02) { PP.setStatus("Scene " + sc.name + " at the next " + (sc.when === "bar" ? "bar" : "beat")); pending = setTimeout(function () { doRecall(sc, opts); }, wait * 1000 - 15); return; }
    doRecall(sc, opts);
  }
  function doRecall(sc, opts) {
    var style = sc.style || "smooth", fade = style === "cut" ? 0.05 : clamp(sc.fade == null ? 1.5 : Number(sc.fade), 0.05, 30);
    if (style === "swell") fade = Math.max(fade, 3);
    if (sc.pads) engine.applyPadScene(sc.pads, fade);
    if (sc.mix && T()) T().applyMix(sc.mix, style === "cut" ? 0.02 : Math.min(fade, 8));
    if (sc.rig && I()) I().applyRig(sc.rig);
    var s = song(); active = { songId: s ? s.id : null, id: sc.id };
    if (!opts.quiet) PP.setStatus("Scene: " + sc.name);
    renderAll();
    if (window.PPActions) window.PPActions.sendLeds();
  }
  function recallIndex(i) { var list = scenes(); if (list[i]) recall(list[i]); else PP.setStatus("This song has no scene " + (i + 1)); }
  function activeIndex() { var s = song(); if (!s || active.songId !== s.id) return -1; return scenes(s).findIndex(function (x) { return x.id === active.id; }); }
  function step(d) { var list = scenes(); if (!list.length) { PP.setStatus("This song has no scenes yet (song editor → Scenes)"); return; } var i = activeIndex(); recall(list[((i < 0 ? (d > 0 ? -1 : 0) : i) + d + list.length) % list.length]); }
  function newScene(parts, name) {
    var s = song(); if (!s) { PP.setStatus("Choose a song first"); return null; }
    var list = scenes(s), sc = Object.assign({ id: uid(), name: name || "Scene " + (list.length + 1), fade: 1.5, style: "smooth", when: "now", midi: null }, capture(parts));
    list.push(sc); active = { songId: s.id, id: sc.id }; PP.persistSoon(); renderAll();
    PP.setStatus("Saved " + sc.name + ": " + describe(sc));
    return sc;
  }

  // ------------------------------------------------------------- automatic triggers
  F.onSong(function (s) {
    active = { songId: s ? s.id : null, id: null };
    if (!s || !s.startScene) { renderAll(); return; }
    var sc = byId(s, s.startScene); if (sc) setTimeout(function () { if (song() === s) recall(sc, { now: true }); }, 60);
  });
  function onSection(x) {   // called by the tracks player when a section starts
    var s = song(); if (!s || !x || !x.sec || !x.sec.scene) return;
    var sc = byId(s, x.sec.scene); if (sc && !(active.songId === s.id && active.id === sc.id)) recall(sc, { now: true });
  }

  // ------------------------------------------------------------- MIDI cues
  function midiMatch(cue, d) {
    if (!cue || !d || d.length < 2) return false;
    var st = d[0], type = st & 0xF0, ch = (st & 0x0F) + 1;
    if (cue.ch && cue.ch !== ch) return false;
    if (cue.type === "pc") return type === 0xC0 && d[1] === cue.num;
    if (cue.type === "note") return type === 0x90 && d[2] > 0 && d[1] === cue.num;
    if (cue.type === "cc") return type === 0xB0 && d[1] === cue.num && d[2] >= 64;
    return false;
  }
  function cueFrom(d) {
    var st = d[0], type = st & 0xF0, ch = (st & 0x0F) + 1;
    if (type === 0xC0) return { type: "pc", ch: ch, num: d[1] };
    if (type === 0x90 && d[2] > 0) return { type: "note", ch: ch, num: d[1] };
    if (type === 0xB0 && d[2] >= 64) return { type: "cc", ch: ch, num: d[1] };
    return null;
  }
  function cueText(c) { return c ? (c.type === "pc" ? "PC " + c.num : c.type === "note" ? "note " + c.num : "CC " + c.num) + (c.ch ? " · ch " + c.ch : " · any ch") : "none"; }
  function midiInput(d) {
    if (!d || d[0] >= 0xF0) return false;
    if (learning) {
      var c = cueFrom(d); if (!c) return true;
      if (learning.kind === "scene") { var sc = byId(song(), learning.id); if (sc) sc.midi = c; }
      else { var sg = project().songs.filter(function (q) { return q.id === learning.songId; })[0]; if (sg) sg.midiCue = c; }
      PP.setStatus("MIDI cue learned: " + cueText(c)); learning = null; PP.persistSoon(); renderAll(); return true;
    }
    var s = song(), hit = s && scenes(s).filter(function (x) { return midiMatch(x.midi, d); })[0];
    if (hit) { recall(hit); return true; }
    var songs = project().songs;
    for (var i = 0; i < songs.length; i++) if (songs[i].midiCue && midiMatch(songs[i].midiCue, d)) { if (project().songIndex !== i) F.loadSong(i); return true; }
    return false;
  }

  // ------------------------------------------------------------- UI: pads screen (layers + scenes)
  function layersHtml() {
    var ls = engine.layerState();
    return '<div class="pf-layers-h"><b>LAYERS</b><small>' + ls.length + "/" + MAX_PAD_LAYERS + "</small></div>" + (ls.length ? ls.map(function (l) {
      return '<div class="pf-layer" data-layer="' + l.pad + '"><span>' + esc(l.name) + '</span><input type="range" min="0" max="140" value="' + Math.round(l.level * 100) + '" data-llevel="' + l.pad + '" aria-label="' + esc(l.name) + ' level"><button data-loff="' + l.pad + '" title="Fade this layer out">✕</button></div>';
    }).join("") : '<p class="muted small">Tap pads with LAYER on to stack up to 4.</p>') + scenesBar("pf");
  }
  function scenesBar(where) {
    var s = song(), list = scenes(s), ai = activeIndex();
    if (!s) return "";
    return '<div class="sc-bar" data-scbar="' + where + '">' + list.map(function (sc, i) { return '<button class="sc-btn' + (i === ai ? " on" : "") + '" data-screcall="' + sc.id + '" title="' + esc(describe(sc)) + '">' + esc(sc.name) + "</button>"; }).join("") +
      '<button class="sc-add" data-scadd="' + where + '" title="Save what is playing now (' + (where === "mix" ? "the mix" : "pads + mix + instrument") + ') as a scene of this song">＋ Scene</button></div>';
  }
  var layersTimer = 0;
  function layersChanged() { clearTimeout(layersTimer); layersTimer = setTimeout(function () { var el = $("#pfLayers"); if (el && !el.contains(document.activeElement)) el.innerHTML = layersHtml(); }, 40); }
  function renderMixerBar() { var el = $("#mixScenes"); if (el) el.innerHTML = scenesBar("mix"); }

  // ------------------------------------------------------------- UI: song editor (Scenes section)
  function editorHtml() {
    var s = song(); if (!s) return "";
    var list = scenes(s);
    return '<div class="row spread"><div><h3>Scenes</h3><p class="muted small">Snapshots of the pads (up to 4 layers and their levels), the track mix and the instrument, recalled smoothly: when the song starts, when a section starts (pick it on the section below), from a footswitch ("Scene: next" / "Scene N"), by tapping it, or by a MIDI cue.</p></div>' +
      '<div class="se-row"><button class="primary" data-scnew="all">＋ Capture pads + mix + instrument</button><button data-scnew="pads">＋ Pads only</button><button data-scnew="mix">＋ Mix only</button><button data-scnew="rig">＋ Instrument only</button></div></div>' +
      '<div class="se-row"><label>When the song is chosen<select data-scsong="start"><option value="">— nothing changes —</option>' + list.map(function (sc) { return '<option value="' + sc.id + '"' + (s.startScene === sc.id ? " selected" : "") + ">recall " + esc(sc.name) + "</option>"; }).join("") + '</select></label><label>MIDI cue for this song <span class="sc-cue">' + esc(cueText(s.midiCue)) + '</span></label><button data-sclearn="song">' + (learning && learning.kind === "song" ? "Waiting for MIDI…" : "Learn") + '</button>' + (s.midiCue ? '<button data-scunlearn="song">Clear</button>' : "") + "</div>" +
      (list.length ? '<div class="sc-list">' + list.map(function (sc, i) {
        return '<div class="sc-row' + (activeIndex() === i ? " on" : "") + '" data-scid="' + sc.id + '"><b class="n">' + (i + 1) + '</b><input data-scf="name" value="' + esc(sc.name) + '" aria-label="Scene name"><span class="sc-what">' + esc(describe(sc)) + "</span>" +
          '<span class="sc-parts"><label class="toggle"><input type="checkbox" data-scpart="pads"' + (sc.pads ? " checked" : "") + '>pads</label><label class="toggle"><input type="checkbox" data-scpart="mix"' + (sc.mix ? " checked" : "") + '>mix</label><label class="toggle"><input type="checkbox" data-scpart="rig"' + (sc.rig ? " checked" : "") + '>instrument</label><label class="toggle" title="Also store the whole pedalboard / keys setup (a different board restarts the instrument chain)"><input type="checkbox" data-scpart="board"' + (sc.rig && sc.rig.chain ? " checked" : "") + ">+ board</label></span>" +
          '<label>Style<select data-scf="style">' + [["smooth", "Smooth"], ["swell", "Swell (slow)"], ["cut", "Cut"]].map(function (o) { return '<option value="' + o[0] + '"' + ((sc.style || "smooth") === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></label>" +
          '<label>Fade s<input data-scf="fade" type="number" min="0" max="30" step=".1" value="' + (sc.fade == null ? 1.5 : sc.fade) + '"></label>' +
          '<label>When<select data-scf="when">' + [["now", "at once"], ["beat", "next beat"], ["bar", "next bar"]].map(function (o) { return '<option value="' + o[0] + '"' + ((sc.when || "now") === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></label>" +
          '<span class="sc-cue" title="MIDI cue">' + esc(cueText(sc.midi)) + '</span><button data-sclearn="' + sc.id + '">' + (learning && learning.id === sc.id ? "Waiting…" : "MIDI learn") + "</button>" + (sc.midi ? '<button data-scunlearn="' + sc.id + '">✕ MIDI</button>' : "") +
          '<button data-sccap="' + sc.id + '" title="Store what is playing now in this scene">⟳ Capture</button><button class="primary" data-screcall="' + sc.id + '">▶ Recall</button><button data-scup="' + sc.id + '" title="Move up">↑</button><button class="danger" data-scdel="' + sc.id + '">✕</button></div>';
      }).join("") + "</div>" : '<p class="muted">No scenes yet. Set up the pads, the mix and the instrument the way this song needs them, then capture.</p>');
  }
  function renderEditor() { var el = $("#seScenes"); if (el) el.innerHTML = editorHtml(); }
  function renderAll() { renderEditor(); renderMixerBar(); layersChanged(); var pf = $("#pfScenes"); if (pf) pf.innerHTML = scenesBar("tr"); }

  // ------------------------------------------------------------- events
  document.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return; var s = song(); var d = b.dataset;
    if (d.screcall) { var sc = byId(s, d.screcall); if (sc) recall(sc, { now: true }); return; }
    if (d.scadd) { newScene(d.scadd === "mix" ? { mix: true } : { pads: true, mix: true, rig: true }); return; }
    if (d.scnew) { var parts = d.scnew === "all" ? { pads: true, mix: true, rig: true } : {}; if (d.scnew !== "all") parts[d.scnew] = true; newScene(parts); return; }
    if (d.sccap) { var sc2 = byId(s, d.sccap); if (!sc2) return; var parts2 = { pads: !!sc2.pads, mix: !!sc2.mix, rig: !!sc2.rig }; if (!parts2.pads && !parts2.mix && !parts2.rig) parts2 = { pads: true, mix: true, rig: true }; var cap = capture(parts2, !!(sc2.rig && sc2.rig.chain)); ["pads", "mix", "rig"].forEach(function (k) { if (parts2[k]) sc2[k] = cap[k] || null; }); PP.persistSoon(); renderAll(); PP.setStatus(sc2.name + ": " + describe(sc2)); return; }
    if (d.scdel) { var list = scenes(s), i = list.findIndex(function (x) { return x.id === d.scdel; }); if (i < 0 || !confirm("Delete scene \"" + list[i].name + "\"?")) return; list.splice(i, 1); if (s.startScene === d.scdel) s.startScene = ""; T() && T().data(s).sections.forEach(function (sec) { if (sec.scene === d.scdel) sec.scene = ""; }); PP.persistSoon(); renderAll(); if (T()) T().renderEditor(); return; }
    if (d.scup) { var l2 = scenes(s), j = l2.findIndex(function (x) { return x.id === d.scup; }); if (j > 0) { l2.splice(j - 1, 0, l2.splice(j, 1)[0]); PP.persistSoon(); renderAll(); } return; }
    if (d.sclearn) { learning = d.sclearn === "song" ? { kind: "song", songId: s && s.id } : { kind: "scene", id: d.sclearn }; PP.setStatus("Send the MIDI note, CC or program change for this cue…"); renderAll(); return; }
    if (d.scunlearn) { if (d.scunlearn === "song") { if (s) s.midiCue = null; } else { var sc3 = byId(s, d.scunlearn); if (sc3) sc3.midi = null; } PP.persistSoon(); renderAll(); return; }
    if (d.loff != null) { var pi = Number(d.loff); if (engine.voiceFor(pi)) { var keep = engine.layerState().filter(function (l) { return l.pad !== pi; }); engine.applyPadScene(keep, PP.project().pads[pi] ? 1.5 : 0.5); } return; }
  });
  document.addEventListener("input", function (e) {
    var el = e.target, d = el.dataset;
    if (d.llevel != null) { engine.setLayerLevel(Number(d.llevel), Number(el.value) / 100, 0.05); return; }
    var row = el.closest && el.closest("[data-scid]"); if (!row || !d.scf) return;
    var sc = byId(song(), row.dataset.scid); if (!sc) return;
    if (d.scf === "name") sc.name = el.value || "Scene"; else if (d.scf === "fade") sc.fade = clamp(Number(el.value) || 0, 0, 30);
    PP.persistSoon();
  });
  document.addEventListener("change", function (e) {
    var el = e.target, d = el.dataset, s = song(); if (!s) return;
    if (d.scsong === "start") { s.startScene = el.value; PP.persistSoon(); return; }
    var row = el.closest && el.closest("[data-scid]"); if (!row) return; var sc = byId(s, row.dataset.scid); if (!sc) return;
    if (d.scf === "style" || d.scf === "when") { sc[d.scf] = el.value; PP.persistSoon(); return; }
    if (d.scpart) {
      if (d.scpart === "board") { if (el.checked) sc.rig = capture({ rig: true }, true).rig || null; else if (sc.rig) { delete sc.rig.chain; delete sc.rig.board; delete sc.rig.keys; delete sc.rig.input; } }
      else if (el.checked) { var cap = capture((function () { var o = {}; o[d.scpart] = true; return o; })()); sc[d.scpart] = cap[d.scpart] || (d.scpart === "pads" ? [] : null); }
      else sc[d.scpart] = null;
      PP.persistSoon(); renderAll();
    }
  });
  document.addEventListener("pp-song-editor", renderEditor);

  window.PPScenes = { capture: capture, recall: recall, recallIndex: recallIndex, step: step, activeIndex: activeIndex, scenes: scenes, newScene: newScene, onSection: onSection, midiInput: midiInput, layersChanged: layersChanged, renderMixerBar: renderMixerBar, renderEditor: renderEditor, describe: describe, cueText: cueText, learning: function () { return learning; } };
  setTimeout(renderAll, 500);
})();
