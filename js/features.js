/* Pad Pedal - live-performance features:
 * setlist/songs, tap tempo, MIDI (notes, program changes, CCs, clock),
 * layering (hold one footswitch, press another), A/B morph, freeze,
 * the USB / SD card browser, and the System menu (safe mode, shut down). */
(function () {
  "use strict";
  var PP = window.PP;
  if (!PP) return;
  var engine = PP.engine, clamp = PP.clamp, esc = PP.escapeHtml;
  var MEDIA = "http://127.0.0.1:8766";
  function $(sel) { return document.querySelector(sel); }
  function project() { return PP.project(); }
  function bridge() { return window.__pedalBridge; }
  function sendToDriver(msg) { var b = bridge(); if (b && b.socket && b.socket.readyState === 1) { b.socket.send(JSON.stringify(msg)); return true; } return false; }

  // ------------------------------------------------------------- tempo
  var taps = [], tempoSource = "manual", lastClockAt = -1e9, clocks = [];
  function setTempo(bpm, source) {
    bpm = Math.round(clamp(bpm, 30, 300) * 10) / 10;
    var p = project(), changed = Math.abs(p.tempo.bpm - bpm) >= .05;
    tempoSource = source || "manual";
    if (!changed) return;
    p.tempo.bpm = bpm; engine.refreshAll(); PP.persistSoon(); renderPerformExtras();
    if (window.PPGraphics) window.PPGraphics.refresh();
    var input = $("#sysBpm"); if (input && document.activeElement !== input) input.value = Math.round(bpm);
  }
  function tap() {
    var now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
    taps.push(now); if (taps.length > 5) taps.shift();
    if (taps.length >= 2) { var sum = 0; for (var i = 1; i < taps.length; i++) sum += taps[i] - taps[i - 1]; var bpm = 60000 / (sum / (taps.length - 1)); setTempo(bpm, "tap"); PP.setStatus("Tempo " + Math.round(bpm) + " BPM (tap)"); }
    else PP.setStatus("Tap again to set the tempo");
  }
  // MIDI clock: 24 ticks per beat. Re-estimate once per beat from the last two beats of ticks.
  function midiClock(t) {
    if (!project().midi.clock) return;
    if (clocks.length && t - clocks[clocks.length - 1] > 500) clocks = [];
    clocks.push(t); if (clocks.length > 49) clocks.shift();
    lastClockAt = t;
    if (clocks.length >= 25 && clocks.length % 24 === 1) { var per = (clocks[clocks.length - 1] - clocks[0]) / (clocks.length - 1); setTempo(60000 / (per * 24), "MIDI clock"); }
  }
  function clockFollowing() { return tempoSource === "MIDI clock" && performance.now() - lastClockAt < 3000; }
  (function beatLight() {
    requestAnimationFrame(beatLight);
    var btn = $("#pfTap"); if (!btn) return;
    var phase = (performance.now() / 1000 * project().tempo.bpm / 60) % 1;
    btn.classList.toggle("beat", phase < .12);
  })();

  // ------------------------------------------------------------- songs
  var songHooks = [];
  // Each song can carry its own complete set of pads (sounds + effects). When such a song is
  // loaded, project.pads IS the song's set (so edits are saved into the song); the normal
  // set is kept aside in project.globalPads until a song without its own pads comes up.
  function applyPadSet(song) {
    var p = project(), own = song && song.padSet && song.padSet.enabled && Array.isArray(song.padSet.pads);
    if (own) {
      if (!song.padSet.normalized) { song.padSet.pads = Array.from({ length: PP.PAD_COUNT }, function (_, i) { return PP.mergePad(song.padSet.pads[i], i); }); song.padSet.normalized = true; }
      if (!p.usingSongPads) p.globalPads = p.pads;
      p.pads = song.padSet.pads; p.usingSongPads = song.id;
    } else if (p.usingSongPads) {
      if (Array.isArray(p.globalPads) && p.globalPads.length === PP.PAD_COUNT) p.pads = p.globalPads;
      p.globalPads = null; p.usingSongPads = null;
    }
  }
  function savePadsToSong(song, enable) {
    var p = project(); if (!song) return;
    if (enable === false) { song.padSet = song.padSet || {}; song.padSet.enabled = false; if (p.usingSongPads === song.id) applyPadSet(null); PP.persistSoon(); PP.loadForm(); PP.renderPads(); renderSetlist(); return; }
    song.padSet = { enabled: true, normalized: true, pads: JSON.parse(JSON.stringify(p.usingSongPads && p.usingSongPads !== song.id ? p.pads : p.pads)) };
    if (p.usingSongPads === song.id) { p.pads = song.padSet.pads; }
    else { if (!p.usingSongPads) p.globalPads = p.pads; p.pads = song.padSet.pads; p.usingSongPads = song.id; }
    PP.persistSoon(); PP.loadForm(); PP.renderPads(); renderSetlist(); PP.setStatus("These pads are now saved with \"" + song.name + "\"");
  }
  function loadSong(index) {
    var p = project(); index = clamp(index, -1, p.songs.length - 1); p.songIndex = index;
    var song = p.songs[index], playing = engine.playingIndexes();
    applyPadSet(song);
    if (window.PPSetups) window.PPSetups.onSong(song);
    if (song && !clockFollowing()) setTempo(song.bpm, "song");
    if (song && song.pad >= 0) PP.setSelectedPad(song.pad, playing.length > 0);
    else if (playing.length) engine.playPad(playing[0]); // same pad, crossfades into the song's key
    PP.persistSoon(); PP.loadForm(); PP.renderPads(); renderSetlist(); renderPerformExtras();
    PP.setStatus(song ? "Song " + (index + 1) + ": " + song.name + " · key " + song.key.replace("#", "♯") + " · " + song.bpm + " BPM" : "No song: pads use their own keys");
    songHooks.forEach(function (fn) { try { fn(song, index); } catch (error) { console.warn("song hook failed", error); } });
  }
  function stepSong(delta) {
    var p = project();
    if (!p.songs.length) { PP.setStatus("The setlist is empty. Add songs with ♫ Setlist."); return; }
    loadSong(clamp(p.songIndex + delta, 0, p.songs.length - 1));
  }
  function keyOptions(selected) { return PP.KEYS.map(function (k) { return '<option value="' + k + '"' + (k === selected ? " selected" : "") + ">" + k.replace("#", "♯") + "</option>"; }).join(""); }
  function padOptions(selected) { return '<option value="-1"' + (selected < 0 ? " selected" : "") + ">Keep current pad</option>" + project().pads.map(function (pad, i) { return '<option value="' + i + '"' + (i === selected ? " selected" : "") + ">Pad " + (i + 1) + ": " + esc(pad.name) + "</option>"; }).join(""); }
  function renderSetlist() {
    var root = $("#setlistRows"); if (!root) return;
    var p = project();
    root.innerHTML = p.songs.length ? p.songs.map(function (s, i) {
      return '<div class="song-row' + (i === p.songIndex ? " current" : "") + '" data-song="' + i + '"><span class="n">' + (i + 1) + '</span>' +
        '<input data-field="name" value="' + esc(s.name) + '" aria-label="Song name">' +
        '<select data-field="key" aria-label="Key">' + keyOptions(s.key) + "</select>" +
        '<input data-field="bpm" type="number" min="30" max="300" value="' + s.bpm + '" aria-label="Tempo">' +
        '<select data-field="pad" aria-label="Pad">' + padOptions(s.pad) + "</select>" +
        '<div class="acts"><button data-act="use" class="primary">Use</button><button data-act="pads" title="' + (s.padSet && s.padSet.enabled ? "This song has its own pad settings. Click to save the current pads into it again." : "Save the current pads (sounds + effects) with this song") + '"' + (s.padSet && s.padSet.enabled ? ' class="on"' : "") + '>⎘ pads</button>' + (s.padSet && s.padSet.enabled ? '<button data-act="padsOff" title="Use the normal pads for this song">✕pads</button>' : "") + '<button data-act="up" aria-label="Move up">↑</button><button data-act="down" aria-label="Move down">↓</button><button data-act="del" class="danger" aria-label="Delete">✕</button></div></div>';
    }).join("") : '<p class="muted">No songs yet. Add one for each song in your set, in order.</p>';
  }
  $("#setlistRows").addEventListener("change", function (e) {
    var row = e.target.closest("[data-song]"), field = e.target.dataset.field; if (!row || !field) return;
    var song = project().songs[Number(row.dataset.song)];
    song[field] = field === "bpm" ? clamp(Number(e.target.value) || 72, 30, 300) : field === "pad" ? Number(e.target.value) : e.target.value;
    PP.persistSoon();
    if (Number(row.dataset.song) === project().songIndex && field !== "name") loadSong(project().songIndex);
    renderPerformExtras();
  });
  $("#setlistRows").addEventListener("click", function (e) {
    var b = e.target.closest("[data-act]"); if (!b) return;
    var p = project(), i = Number(b.closest("[data-song]").dataset.song), songs = p.songs;
    if (b.dataset.act === "use") { loadSong(i); return; }
    if (b.dataset.act === "pads") { if (p.songIndex !== i) loadSong(i); savePadsToSong(songs[i], true); return; }
    if (b.dataset.act === "padsOff") { savePadsToSong(songs[i], false); return; }
    if (b.dataset.act === "del") {
      if (window.PPSync && window.PPSync.linked()) { window.PPSync.askDelete(songs[i], i); return; }
      songs.splice(i, 1); if (p.songIndex >= songs.length) p.songIndex = songs.length - 1;
    }
    if (b.dataset.act === "up" && i > 0) { songs.splice(i - 1, 0, songs.splice(i, 1)[0]); if (p.songIndex === i) p.songIndex--; }
    if (b.dataset.act === "down" && i < songs.length - 1) { songs.splice(i + 1, 0, songs.splice(i, 1)[0]); if (p.songIndex === i) p.songIndex++; }
    PP.persistSoon(); renderSetlist(); renderPerformExtras();
  });
  $("#songAdd").addEventListener("click", function () {
    if (window.PPSources) { $("#setlistDialog").close(); window.PPSources.open(); return; }   // (your songs, then the four ways to bring the tracks in)
    var p = project(); p.songs.push({ id: PP.id(), name: "Song " + (p.songs.length + 1), key: PP.playKeyFor(PP.currentPad()), bpm: Math.round(p.tempo.bpm), pad: -1, notes: "" });
    PP.persistSoon(); renderSetlist(); renderPerformExtras();
    var inputs = document.querySelectorAll('#setlistRows [data-field="name"]'); if (inputs.length) { inputs[inputs.length - 1].focus(); inputs[inputs.length - 1].select(); }
  });
  $("#songNone").addEventListener("click", function () { loadSong(-1); });
  function openSetlist() { renderSetlist(); $("#setlistDialog").showModal(); }

  // ------------------------------------------------------------- freeze / layer / morph
  var morphPick = null, held = new Set();
  function toggleFreeze() { return engine.toggleFreeze().then(renderPerformExtras); }
  function toggleLayerMode() { var perf = project().performance; perf.layerMode = !perf.layerMode; PP.persistSoon(); PP.setStatus(perf.layerMode ? "Layer mode: tapped pads stack on top of each other" : "Layer mode off: tapping a pad crossfades to it"); renderPerformExtras(); }
  function morphButton() {
    if (engine.morph) { var keep = project().performance.morph < .5 ? engine.morph.a : engine.morph.b, idx = project().pads.findIndex(function (p) { return p.id === keep; }); engine.morph = null; if (idx > -1) PP.setSelectedPad(idx, true); renderPerformExtras(); return; }
    morphPick = morphPick ? null : []; PP.setStatus(morphPick ? "Morph: tap the first pad (A)" : "Morph cancelled"); renderPerformExtras();
  }
  function interceptPad(index) {
    if (!morphPick) return false;
    morphPick.push(index);
    if (morphPick.length === 1) { PP.setStatus("Morph: now tap the second pad (B)"); renderPerformExtras(); return true; }
    var a = morphPick[0], b = morphPick[1]; morphPick = null;
    if (a === b) { PP.setStatus("Morph needs two different pads"); renderPerformExtras(); return true; }
    engine.startMorph(a, b).then(renderPerformExtras);
    return true;
  }
  // Footswitches: holding one pad's switch while pressing another layers the second on top.
  function footswitchPad(index) {
    var info = bridge() && bridge().info, canHold = info && info.version >= 3;
    if (canHold && held.size && !held.has(index)) PP.triggerPad(index, { layer: true }); else PP.triggerPad(index);
    if (canHold) held.add(index);
  }

  // ------------------------------------------------------------- MIDI
  function playInKey(key) {
    var song = PP.activeSong(); if (song) song.key = key; else PP.currentPad().key = key;
    PP.persistSoon(); var playing = engine.playingIndexes(); engine.playPad(playing.length ? playing[0] : PP.selected()); PP.renderPads();
  }
  function handleMidi(d, t) {
    if (!d || !d.length) return;
    var st = d[0], type = st & 0xF0, ch = (st & 0x0F) + 1, want = Number(project().midi.channel) || 0;
    if (st === 0xF8) { midiClock(t || performance.now()); return; }
    if (window.PPScenes && window.PPScenes.midiInput(d)) return;
    if (window.PPActions && window.PPActions.midiInput && window.PPActions.midiInput(d)) return;
    if (st >= 0xF0 || (want && ch !== want)) return;
    if (type === 0x90 && d[2] > 0) { playInKey(PP.KEYS[d[1] % 12]); return; }
    if (type === 0xC0) { if (d[1] < PP.PAD_COUNT) PP.triggerPad(d[1]); return; }
    if (type !== 0xB0) return;
    var cc = d[1], v = d[2] / 127, on = d[2] >= 64;
    if (cc === 1) { if (engine.morph) { project().performance.morph = v; engine.setMorph(v); renderPerformExtras(); } return; }
    if (cc === 7) return PP.setPerformance("volume", v);
    if (cc === 74) return PP.setPerformance("tone", v);
    if (cc === 91) return PP.setPerformance("reverb", v);
    if (cc === 73) return PP.setPerformance("fade", v);
    if (cc === 11) return PP.setExpression(v);
    if (cc === 64) { if (on !== !!engine.frozen) toggleFreeze(); return; }
    if (!on) return;
    if (cc >= 20 && cc < 20 + PP.PAD_COUNT) return PP.triggerPad(cc - 20);
    if (cc === 27) return engine.stop();
    if (cc === 28) return stepSong(1);
    if (cc === 29) return stepSong(-1);
    if (cc === 30) return tap();
    if (cc === 31) return toggleFreeze();
  }
  var webMidi = null, midiPorts = [];
  function startWebMidi() {
    var info = bridge() && bridge().info;
    if (info && info.midi) return; // the Pi's driver already reads MIDI devices
    if (!navigator.requestMIDIAccess || webMidi) return;
    navigator.requestMIDIAccess({ sysex: false }).then(function (access) {
      webMidi = access;
      function attach() { var names = []; access.inputs.forEach(function (input) { input.onmidimessage = function (e) { handleMidi(e.data, e.timeStamp); }; names.push(input.name); }); midiPorts = names; renderSystem(); }
      access.onstatechange = attach; attach();
    }).catch(function () {});
  }

  // ------------------------------------------------------------- hardware messages
  var listeners = {};
  function on(type, fn) { (listeners[type] = listeners[type] || []).push(fn); }
  function emit(m) { (listeners[m.type] || []).forEach(function (fn) { try { fn(m); } catch (error) { console.warn("listener failed", m.type, error); } }); }
  function handleHardware(m) {
    emit(m);
    switch (m.type) {
      case "control": if (window.PPActions) window.PPActions.onControl(m); break;
      case "action": if (window.PPActions) window.PPActions.run(m.name, m.args, { from: m.from || "satellite", value: typeof m.value === "number" ? m.value : null, delta: typeof m.delta === "number" ? m.delta : 0 }); break;
      case "padRelease": held.delete(m.index); break;
      case "tap": tap(); break;
      case "tapHold": toggleFreeze(); break;
      case "freeze": toggleFreeze(); break;
      case "nextSong": stepSong(1); break;
      case "prevSong": stepSong(-1); break;
      case "midi": handleMidi(m.data, performance.now()); break;
      case "tempo":
        if (m.source === "link") { if (project().link && project().link.enabled && !(window.PPTracks && window.PPTracks.isPlaying())) setTempo(m.bpm, "link"); }
        else if (project().midi.clock) { lastClockAt = performance.now(); setTempo(m.bpm, "MIDI clock"); }
        break;
      case "systemStatus": systemStatus = m; if (m.midiPorts) midiPorts = Array.isArray(m.midiPorts) ? m.midiPorts : (m.midiPorts.inputs || []).concat((m.midiPorts.outputs || []).map(function (n) { return n + " (out)"; })); renderSystem(); break;
      case "midiPorts": midiPorts = (m.inputs || m.ports || []).concat(m.outputs ? m.outputs.map(function (n) { return n + " (out)"; }) : []); renderSystem(); break;
    }
  }

  // ------------------------------------------------------------- USB / SD browser
  var usbPath = null, usbFiles = [], usbKind = "";
  function size(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }
  async function mediaAvailable() { try { var r = await fetch(MEDIA + "/roots", { cache: "no-store" }); return r.ok; } catch (_) { return false; } }
  async function listUsb(path) {
    var list = $("#usbList"); list.innerHTML = '<p class="muted">Loading…</p>';
    try {
      var data = await (await fetch(path ? MEDIA + "/list?path=" + encodeURIComponent(path) + (usbKind ? "&kind=" + usbKind : "") : MEDIA + "/roots", { cache: "no-store" })).json();
      usbPath = path; usbFiles = data.files || [];
      $("#usbPath").textContent = path ? path : "Choose a USB stick or SD card";
      var sf2 = usbKind === "sf2", pack = usbKind === "pack", irk = usbKind === "ir";
      var rows = (data.dirs || []).map(function (d) { return '<button data-dir="' + esc(d.path) + '">📁 ' + esc(d.name) + "<small>" + (path ? "folder" : "drive") + "</small></button>"; })
        .concat(usbFiles.filter(function (f) { return sf2 ? /\.sf[23]$/i.test(f.name) : pack ? /\.zip$/i.test(f.name) : irk ? /\.(wav|flac)$/i.test(f.name) : true; }).map(function (f) { return '<button data-file="' + esc(f.path) + '">' + (sf2 ? "🎹 " : pack ? "📦 " : irk ? "🔊 " : "♪ ") + esc(f.name) + "<small>" + size(f.size) + "</small></button>"; }));
      if (pack && path) { var au = usbFiles.filter(function (f) { return !/\.zip$/i.test(f.name); }).length; if (au) rows.push('<p class="muted">' + au + " audio file" + (au === 1 ? "" : "s") + " in this folder - press <b>Use this folder</b> to import them as one song's stems.</p>"); }
      var wavs = sf2 ? usbFiles.filter(function (f) { return /\.wav$/i.test(f.name); }).length : 0;
      if (sf2 && wavs) rows.push('<p class="muted">' + wavs + " WAV file" + (wavs === 1 ? "" : "s") + " here - name them by note (C4.wav, F#3.wav, 60.wav…) and press <b>Make a sound from this folder</b>.</p>");
      list.innerHTML = rows.length ? rows.join("") : '<p class="muted">' + (path ? (sf2 ? "No folders, .sf2 SoundFonts or WAV files here." : "No folders or sounds (WAV, MP3, FLAC, OGG, M4A, AIFF) here.") : "No USB stick or SD card found. Plug one in and press Refresh.") + "</p>";
      $("#usbAll").disabled = sf2 ? !(path && wavs) : pack ? !path : irk ? true : !usbFiles.length; $("#usbUp").disabled = !path;
    } catch (_) {
      list.innerHTML = '<p class="muted">The USB / SD browser works on the Central Pedal itself. On a computer, use the file picker.</p>';
    }
  }
  async function importFromUsb(path, makeActive) {
    var name = path.split("/").pop(); PP.setStatus("Importing " + name + "…");
    var blob = await (await fetch(MEDIA + "/file?path=" + encodeURIComponent(path))).blob();
    return PP.importFile(new File([blob], name, { type: blob.type || "audio/*" }), makeActive && !PP.isEditingInput());
  }
  var usbConsumer = null;
  // openUsb(fn)            -> fn([paths]) with the sounds picked (or every sound in a folder)
  // openUsb(fn, {kind:"sf2"}) -> keys sounds: fn({files:[path.sf2]}) or fn({folder: path}) for "make a sound from the WAVs here"
  function openUsb(consumer, opts) {
    usbConsumer = typeof consumer === "function" ? consumer : null; usbKind = (opts && opts.kind) || "";
    $("#usbDialog").showModal(); listUsb(null);
    $("#usbDialog h2").textContent = usbKind === "ir" ? "Add an impulse response (.wav) from USB / SD card" : usbKind === "sf2" ? "Add keys sounds from USB / SD card" : usbKind === "pack" ? "Choose a track pack (zip) or a folder of stems" : "Import from USB / SD card";
    $("#usbAll").textContent = usbKind === "sf2" ? "Make a sound from this folder" : usbKind === "pack" ? "Use this folder" : usbConsumer ? "Add all files here" : "Add all to Voices";
    $("#usbNative").style.display = usbKind === "sf2" || usbKind === "pack" || usbKind === "ir" ? "none" : "";
  }
  function pick(paths) { var fn = usbConsumer, kind = usbKind; usbConsumer = null; $("#usbDialog").close(); fn(kind === "sf2" || kind === "pack" || kind === "ir" ? (Array.isArray(paths) ? { files: paths } : paths) : paths); usbKind = ""; }
  $("#usbList").addEventListener("click", async function (e) {
    var b = e.target.closest("button"); if (!b) return;
    if (b.dataset.dir) { listUsb(b.dataset.dir); return; }
    if (b.dataset.file) { if (usbConsumer) { pick([b.dataset.file]); return; } b.disabled = true; var ok = await importFromUsb(b.dataset.file, true); b.disabled = false; if (ok) $("#usbDialog").close(); }
  });
  $("#usbUp").addEventListener("click", function () { if (!usbPath) return; var parent = usbPath.replace(/\/[^/]+\/?$/, ""); listUsb(/^\/media\/[^/]+$/.test(usbPath) || !parent ? null : parent); });
  $("#usbRefresh").addEventListener("click", function () { listUsb(usbPath); });
  $("#usbDialog").addEventListener("close", function () { usbConsumer = null; usbKind = ""; });
  $("#usbAll").addEventListener("click", async function () { if (usbConsumer) { pick(usbKind === "sf2" || usbKind === "pack" ? { folder: usbPath } : usbFiles.map(function (f) { return f.path; })); return; } var n = 0; for (var i = 0; i < usbFiles.length; i++) { if (await importFromUsb(usbFiles[i].path, false)) n++; } PP.setStatus("Added " + n + " sound" + (n === 1 ? "" : "s") + " to Voices"); $("#usbDialog").close(); });
  $("#usbNative").addEventListener("click", function () { $("#usbDialog").close(); $("#audioFile").click(); });
  $("#usbImport").addEventListener("click", function () { openUsb(); });
  // "Import Sound" opens the USB/SD browser on the Pad Pedal, or the normal file picker on a computer
  document.addEventListener("click", function (e) {
    if (!e.target.closest || !e.target.closest("#importAudio")) return;
    e.stopImmediatePropagation(); e.preventDefault();
    mediaAvailable().then(function (ok) { if (ok) openUsb(); else $("#audioFile").click(); });
  }, true);

  // ------------------------------------------------------------- System menu
  var systemStatus = null;
  function renderSystem() {
    var s = systemStatus, connected = bridge() && bridge().connected;
    $("#sysInfo").textContent = connected ? "Central Pedal OS" + (s && s.hostname ? " · " + s.hostname : "") : "Running in a browser (not on the Central Pedal hardware)";
    var safe = $("#safeToggle"), text = $("#safeText");
    if (!connected || !s) { text.textContent = "Only available on the Central Pedal (Raspberry Pi) itself."; safe.disabled = true; safe.textContent = "Safe mode"; }
    else {
      safe.disabled = !s.safeModeAvailable;
      text.textContent = !s.safeModeAvailable ? "Not available on this system." : s.safeModePending ? "Change saved. It takes effect after a restart." : s.safeMode ? "ON: the system can't be damaged by pulling the plug. Your pads, songs and sounds still save normally." : "OFF: shut down before unplugging, or turn safe mode on.";
      safe.textContent = s.safeMode ? "Turn safe mode off" : "Turn safe mode on";
      safe.dataset.want = s.safeMode ? "off" : "on";
    }
    $("#sysShutdown").disabled = !connected; $("#sysReboot").disabled = !connected;
    $("#midiPorts").textContent = midiPorts.length ? "Connected: " + midiPorts.join(", ") : "No MIDI devices found. Plug in a USB MIDI keyboard or foot controller.";
    $("#midiClock").checked = !!project().midi.clock; $("#midiChannel").value = String(project().midi.channel || 0);
    $("#sysBpm").value = Math.round(project().tempo.bpm);
    $("#tempoSource").textContent = "Currently set by: " + (clockFollowing() ? "MIDI clock" : tempoSource === "tap" ? "tap tempo" : tempoSource === "song" ? "the current song" : "this setting");
  }
  function openSystem() { renderSystem(); if (window.PPShell) window.PPShell.showTab("settings"); sendToDriver({ type: "system", action: "status" }); }
  (function () { var sel = $("#midiChannel"); for (var i = 1; i <= 16; i++) sel.insertAdjacentHTML("beforeend", '<option value="' + i + '">Channel ' + i + "</option>"); })();
  $("#midiChannel").addEventListener("change", function (e) { project().midi.channel = Number(e.target.value); PP.persistSoon(); });
  $("#midiClock").addEventListener("change", function (e) { project().midi.clock = e.target.checked; PP.persistSoon(); });
  $("#sysBpm").addEventListener("change", function (e) { setTempo(Number(e.target.value) || 72, "manual"); });
  $("#safeToggle").addEventListener("click", function (e) { if (sendToDriver({ type: "system", action: "safeMode", value: e.target.dataset.want })) { $("#safeText").textContent = "Working…"; } });
  $("#sysShutdown").addEventListener("click", function () { PP.persistNow(); if (sendToDriver({ type: "system", action: "shutdown" })) PP.setStatus("Shutting down. Wait for the screen to go dark before unplugging."); });
  $("#sysReboot").addEventListener("click", function () { PP.persistNow(); sendToDriver({ type: "system", action: "reboot" }); });

  // ------------------------------------------------------------- Perform-screen controls
  function renderPerformExtras() {
    var p = project(), s = PP.activeSong(), name = $("#pfSongName"); if (!name) return;
    name.textContent = s ? (p.songIndex + 1) + "/" + p.songs.length + "  " + s.name + " · " + s.key.replace("#", "♯") : (p.songs.length ? "No song · " + p.songs.length + " in setlist" : "No setlist · tap to add songs");
    $("#pfBpm").textContent = Math.round(p.tempo.bpm);
    $("#pfFreeze").classList.toggle("frozen", !!engine.frozen);
    $("#pfLayer").classList.toggle("on", !!p.performance.layerMode);
    $("#pfMorph").classList.toggle("on", !!engine.morph); $("#pfMorph").classList.toggle("picking", !!morphPick);
    var slider = $("#pfMorphPos"); slider.classList.toggle("hidden", !engine.morph); if (document.activeElement !== slider) slider.value = p.performance.morph;
  }
  $("#pfTap").addEventListener("pointerdown", function (e) { e.preventDefault(); tap(); });
  $("#pfFreeze").addEventListener("click", toggleFreeze);
  $("#pfLayer").addEventListener("click", toggleLayerMode);
  $("#pfMorph").addEventListener("click", morphButton);
  $("#pfMorphPos").addEventListener("input", function (e) { var v = Number(e.target.value); project().performance.morph = v; engine.setMorph(v); PP.persistSoon(); });
  $("#pfSongPrev").addEventListener("click", function () { stepSong(-1); });
  $("#pfSongNext").addEventListener("click", function () { stepSong(1); });
  $("#pfSongName").addEventListener("click", openSetlist);
  $("#setlistButton").addEventListener("click", openSetlist);
  $("#systemButton").addEventListener("click", openSystem);
  document.addEventListener("keydown", function (e) {
    if ((e.target.matches && e.target.matches("input,select,textarea")) || e.repeat || e.ctrlKey || e.metaKey) return;
    var k = e.key.toLowerCase();
    if (k === "b") { e.preventDefault(); tap(); } else if (k === "z") { e.preventDefault(); toggleFreeze(); } else if (k === "l") { e.preventDefault(); toggleLayerMode(); }
    else if (k === "]" || k === "pagedown") { e.preventDefault(); stepSong(1); } else if (k === "[" || k === "pageup") { e.preventDefault(); stepSong(-1); }
  });

  // re-link a song's pad set after a reload (project.pads was saved while that song was active)
  (function () { var p = project(); if (p.usingSongPads) { var song = p.songs.filter(function (s) { return s.id === p.usingSongPads; })[0]; if (song && song.padSet) { song.padSet.pads = p.pads; song.padSet.normalized = true; } else { p.usingSongPads = null; if (p.globalPads) { p.pads = p.globalPads; p.globalPads = null; } } } })();
  window.PPFeatures = { renderSetlist: renderSetlist, openSetlist: openSetlist, onSong: function (fn) { songHooks.push(fn); }, toggleLayerMode: toggleLayerMode, morphButton: morphButton, savePadsToSong: savePadsToSong, applyPadSet: applyPadSet, on: on, emit: emit, systemStatus: function () { return systemStatus; }, sendToDriver: sendToDriver, clockFollowing: clockFollowing, tempoSource: function () { return tempoSource; }, interceptPad: interceptPad, handleHardware: handleHardware, renderPerformExtras: renderPerformExtras, footswitchPad: footswitchPad, handleMidi: handleMidi, tap: tap, setTempo: setTempo, loadSong: loadSong, stepSong: stepSong, toggleFreeze: toggleFreeze, openUsb: openUsb, mediaAvailable: mediaAvailable, renderSystem: renderSystem };
  renderPerformExtras();
  setTimeout(startWebMidi, 2500);
})();
