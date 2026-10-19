/* Central Pedal - LIVE: the one screen for a whole service. Setlist on the left; the song (key, BPM, time left, what
 * comes next), its sections to jump to, big transport (Play / Pause, sections, Vamp, Safe Stop, next song), the pads,
 * the instrument with its tuner, meters and the Pi's health along the top.
 *
 * Service lock: while the service runs, nothing can be edited or deleted from the screens - the other tabs, the
 * mixer, tracks mode, seeking are locked; playing works. Unlocked with the Central Pedal's PIN. It survives a restart.
 * Safe Stop: one press fades the tracks and pads out (2.5 s) instead of cutting them; a second press during the fade
 * stops at once.
 * Ready check: before the service - every song has its tracks, the click only goes to the in-ears, the outputs, the
 * Pi's temperature, power and storage, the pairing. Green "Ready" or a list of what to fix. */
(function () {
  "use strict";
  var PP = window.PP, F = window.PPFeatures; if (!PP || !F) return;
  var engine = PP.engine, esc = PP.escapeHtml;
  function $(s, r) { return (r || document).querySelector(s); }
  function T() { return window.PPTracks; }
  function A() { return window.PPActions; }
  function I() { return window.PPInstrument; }
  function project() { return PP.project(); }
  function bridge() { return window.__pedalBridge; }
  function connected() { return !!(bridge() && bridge().connected); }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) { } return null; }
  function fmt(t) { return T() ? T().fmtTime(t) : "0:00"; }
  function f(c) { return Math.round(c * 9 / 5 + 32); }   // °F

  var root = null, visible = false, lastKey = "", armed = { key: "", at: 0 }, tuner = { note: "–", cents: null }, ready = null;
  var locked = store("cp-service-lock") === "1";
  function note(kind, extra) { if (window.PPReport) window.PPReport.log(kind, extra); }

  // ------------------------------------------------------------- the screen
  function build() {
    root = $("#tabLive");
    if (!root) {
      root = document.createElement("section"); root.id = "tabLive"; root.className = "toptab hidden"; root.setAttribute("aria-label", "Live");
      var after = $("#perform"); (after && after.parentNode ? after.parentNode : document.body).insertBefore(root, after ? after.nextSibling : null);
    }
    root.classList.add("live");
    root.innerHTML =
      '<div class="lv-status" id="lvStatus"></div>' +
      '<div class="lv-body"><aside class="lv-setlist" id="lvSetlist" aria-label="Setlist"></aside>' +
      '<div class="lv-main"><header class="lv-song" id="lvSong"></header>' +
      '<div class="lv-sections" id="lvSections"></div>' +
      '<div class="lv-progress" id="lvProgress" title="Song position"><i id="lvProgFill"></i><div id="lvMarks"></div></div>' +
      '<div class="lv-transport" id="lvTransport"></div>' +
      '<div class="lv-bottom"><div class="lv-pads" id="lvPads"></div><div class="lv-right"><div class="lv-inst" id="lvInst"></div><div class="lv-meters" id="lvMeters">' +
      '<div class="lv-meter"><span>TRACKS</span><div class="vu-bar"><i id="lvVuT"></i></div></div><div class="lv-meter"><span>PADS</span><div class="vu-bar"><i id="lvVuP"></i></div></div></div></div></div>' +
      "</div></div>" +
      '<div class="lv-ready hidden" id="lvReady" role="dialog" aria-label="Ready check"></div>';
  }

  function song() { var p = project(); return p.songs[p.songIndex] || null; }
  function tdata(s) { return s && T() ? T().data(s) : null; }
  function hasTracks(s) { var t = tdata(s); return !!(t && t.stems && t.stems.length); }
  function sections(s) { return s && T() ? T().sectionsOf(s) : []; }
  function playing() { return !!(T() && T().isPlaying()); }
  function curSection(s) { var st = T() && T().state, list = sections(s); if (!st) return -1; for (var i = list.length - 1; i >= 0; i--) if (st.pos >= list[i].start - 0.01) return i; return -1; }

  function structureKey() {
    var p = project(), s = song(), st = T() && T().state || {};
    return [p.songIndex, p.songs.length, s ? s.name + s.key + s.bpm : "", sections(s).length, p.pads.length, p.tracksMode ? 1 : 0, locked ? 1 : 0, (I() && I().kind()) || "", st.loop, p.songs.map(function (q) { return q.name; }).join("|")].join("·");
  }

  function render() {
    if (!root) return;
    lastKey = structureKey();
    renderSetlist(); renderSong(); renderSections(); renderTransport(); renderPads(); renderInst(); renderStatus(); tick(true);
    document.body.classList.toggle("service-locked", locked);
  }

  function renderSetlist() {
    var p = project(), el = $("#lvSetlist");
    el.innerHTML = '<div class="lv-h">SETLIST <small>' + p.songs.length + " songs</small></div>" + (p.songs.length ? p.songs.map(function (s, i) {
      var cur = i === p.songIndex, tr = hasTracks(s), sure = armed.key === "song" + i && Date.now() - armed.at < 3000;
      return '<button class="lv-row' + (cur ? " now" : "") + (sure ? " sure" : "") + '" data-lv="song" data-i="' + i + '"><span class="n">' + (i + 1) + "</span><span class=\"t\"><b>" + esc(s.name) + "</b><small>" + esc(String(s.key || "").replace("#", "♯")) + " · " + (s.bpm || "–") + " BPM" + (tr ? "" : " · pads only") + "</small></span>" + (sure ? '<em>tap again</em>' : (tr ? '<i class="ok" title="tracks loaded">●</i>' : '<i title="no tracks">○</i>')) + "</button>";
    }).join("") : '<p class="muted small">No setlist yet.' + (locked ? "" : ' <button data-lv="setlist">♫ Make the setlist</button>') + "</p>");
  }

  function renderSong() {
    var p = project(), s = song(), el = $("#lvSong"), next = p.songs[p.songIndex + 1];
    if (!s) { el.innerHTML = '<div class="lv-title"><b>No song</b><span>Pick a song from the setlist</span></div>'; return; }
    var t = tdata(s) || {};
    el.innerHTML = '<div class="lv-title"><span class="lv-of">' + (p.songIndex + 1) + " / " + p.songs.length + "</span><b>" + esc(s.name) + "</b><span>" + (next ? "Next: " + esc(next.name) : "Last song") + "</span></div>" +
      '<div class="lv-stat"><small>KEY</small><b>' + esc(String(s.key || "–").replace("#", "♯")) + "</b></div>" +
      '<div class="lv-stat"><small>BPM</small><b>' + (s.bpm || "–") + "</b></div>" +
      '<div class="lv-stat lv-time"><small>LEFT</small><b id="lvLeft">–</b><span id="lvPos"></span></div>' +
      '<div class="lv-chips">' +
      (hasTracks(s) ? '<button class="lv-chip' + (t.click && t.click.on ? " on" : "") + '" data-lv="click" title="Click in the in-ears">♩ Click</button><button class="lv-chip' + (t.cues && t.cues.on ? " on" : "") + '" data-lv="cues" title="Spoken section cues">🗣 Cues</button>' : "") +
      '<button class="lv-chip' + (p.tracksMode ? " on" : "") + '" data-lv="tracksMode"' + (locked ? " disabled" : "") + ' title="Tracks mode: tracks play, pads follow">' + (p.tracksMode ? "Tracks on" : "Tracks off") + "</button></div>";
  }

  function renderSections() {
    var s = song(), el = $("#lvSections"), list = sections(s), st = T() && T().state || {};
    if (!s || !list.length) { el.innerHTML = s && hasTracks(s) ? '<p class="muted small">No sections in this song yet (Tracks → Edit sections).</p>' : ""; $("#lvMarks").innerHTML = ""; return; }
    var dur = Math.max(1, (tdata(s) || {}).duration || list[list.length - 1].end);
    el.innerHTML = list.map(function (x, i) {
      var len = Math.max(1, x.end - x.start);
      return '<button class="lv-sec' + (st.loop === i ? " loop" : "") + '" data-lv="sec" data-i="' + i + '" style="flex:' + Math.round(len) + ' 1 72px;--c:' + secColor(x.sec.name) + '"><i></i><b>' + esc(x.sec.name || "Section") + "</b><small>" + fmt(x.start) + (st.loop === i ? " · ⟲" : "") + "</small></button>";
    }).join("");
    $("#lvMarks").innerHTML = list.map(function (x) { return '<b style="left:' + (x.start / dur * 100).toFixed(2) + '%"></b>'; }).join("");
  }
  function secColor(name) {
    var n = String(name || "").toLowerCase();
    if (/chorus|refrain/.test(n)) return "#5de6b0"; if (/bridge/.test(n)) return "#ffb86b"; if (/verse/.test(n)) return "#75adff";
    if (/pre/.test(n)) return "#b99cff"; if (/intro|outro|ending|tag|turn/.test(n)) return "#9bb2c9"; if (/vamp|instrumental|interlude/.test(n)) return "#ff8fb3"; return "#7fd3ff";
  }

  function renderTransport() {
    var st = T() && T().state || {}, s = song(), safe = safeStop.timer ? " fading" : "";
    var b = function (lv, small, big, cls, title) { return '<button class="lv-btn ' + (cls || "") + '" data-lv="' + lv + '"' + (title ? ' title="' + title + '"' : "") + "><small>" + small + "</small><b>" + big + "</b></button>"; };
    $("#lvTransport").innerHTML =
      b("prevSec", "SECTION", "◀ PREV") +
      b("play", st.countIn ? "COUNT-IN" : (playing() ? "PLAYING" : (s && hasTracks(s) && project().tracksMode ? "TRACKS" : "PADS")), playing() ? "❚❚ PAUSE" : "▶ PLAY", "big play" + (playing() ? " on" : "")) +
      b("nextSec", "SECTION", "NEXT ▶") +
      b("vamp", "SECTION", "⟲ VAMP", st.loop >= 0 ? "on" : "", "Repeat this section until you press it again") +
      b("safeStop", safe ? "AGAIN = NOW" : "FADE OUT", "■ SAFE STOP", "stop" + safe, "Fades the tracks and pads out over 2.5 seconds") +
      b("nextSong", "SONG", armed.key === "nextSong" && Date.now() - armed.at < 3000 ? "TAP AGAIN" : "NEXT ▶▶", "", "Loads the next song (while playing: tap twice)");
  }

  function renderPads() {
    var p = project(), playingIdx = engine.playingIndexes(), sel = PP.selected();
    $("#lvPads").innerHTML = '<div class="lv-h">PADS <button class="lv-mini" data-lv="padsStop">fade</button></div><div class="lv-padgrid">' + p.pads.slice(0, 8).map(function (pad, i) {
      return '<button class="lv-pad' + (playingIdx.indexOf(i) > -1 ? " on" : "") + (i === sel ? " sel" : "") + '" data-lv="pad" data-i="' + i + '" style="--padc:' + (window.PPColors ? window.PPColors.pad(i) : "") + '"><span>' + (i + 1) + "</span><b>" + esc(pad.name) + "</b></button>";
    }).join("") + "</div>";
  }

  function renderInst() {
    var el = $("#lvInst"), ins = I();
    if (!ins) { el.innerHTML = ""; return; }
    var k = ins.kind(), st = ins.state(), kinds = ins.kinds ? ins.kinds() : [], kname = (kinds.filter(function (x) { return x[0] === k; })[0] || [k, k])[1];
    var name = k === "keys" ? (st.patch && st.patch.name) || "No sound picked" : (ins.boardName && ins.boardName()) || "Default board";
    var tOn = st.tuner, c = tuner.cents, ok = c != null && Math.abs(c) < 3;
    el.innerHTML = '<div class="lv-h">INSTRUMENT <small>' + esc(kname) + "</small></div>" +
      (k === "off" ? '<p class="muted small">Instrument off.' + (locked ? "" : ' <button data-lv="instTab">Set it up</button>') + "</p>" :
        '<div class="lv-inst-row"><button data-lv="instPrev" aria-label="Previous">◀</button><b class="lv-inst-name">' + esc(name) + '</b><button data-lv="instNext" aria-label="Next">▶</button></div>' +
        '<button class="lv-tuner' + (tOn ? " on" : "") + (ok ? " intune" : "") + '" data-lv="tuner">' + (tOn ? '<b id="lvTunerNote">' + esc(tuner.note) + '</b><span class="lv-needle"><i id="lvNeedle" style="left:' + (50 + Math.max(-50, Math.min(50, c || 0))) + '%"></i></span><small id="lvTunerTxt">' + (c == null ? "play a string" : ok ? "in tune" : (c > 0 ? "+" + c + "¢ sharp" : c + "¢ flat")) + "</small>" : "<b>TUNER</b><small>mutes the instrument</small>") + "</button>");
  }

  // the status bar along the top: health, outputs, pairing, lock, ready
  function renderStatus() {
    var sys = F.systemStatus() || {}, h = sys.health || {}, chips = [];
    if (!connected()) chips.push('<span class="lv-st warn">Not on a Central Pedal</span>');
    if (h.tempC != null) chips.push('<span class="lv-st' + (h.tempC >= 80 ? " bad" : h.tempC >= 70 ? " warn" : "") + '" title="Raspberry Pi temperature">🌡 ' + f(h.tempC) + "°F</span>");
    if (h.underVoltage) chips.push('<span class="lv-st bad" title="The power supply is too weak">⚡ Low power</span>');
    var r = engine.ctx && engine.routing; if (r) chips.push('<span class="lv-st" title="Audio outputs">🔊 ' + (r.mode === "stereo2" ? "2 outputs" : (r.channels || 2) + " outputs") + "</span>");
    var c = sys.center || (bridge() && bridge().info && bridge().info.center); if (c && c.paired) chips.push('<span class="lv-st" title="Paired with the main admin">🔗 ' + esc(c.name || "Main admin") + "</span>");
    var rs = ready ? ready.summary : null;
    $("#lvStatus").innerHTML = (locked ? '<b class="lv-brand">SERVICE</b>' : "") + chips.join("") + '<span class="lv-sp"></span>' +
      '<button class="lv-st btn" data-lv="report" title="What played, when, any dropouts">📋 Report</button>' +
      '<button class="lv-st btn ' + (rs ? rs.level : "") + '" data-lv="ready">' + (rs ? rs.label : "Ready check") + "</button>" +
      '<button class="lv-st btn lock' + (locked ? " on" : "") + '" data-lv="lock">' + (locked ? "🔒 Service lock on" : "🔓 Lock for service") + "</button>";
  }

  // the moving parts, a few times a second
  var meterBuf = null;
  function level(an) { if (!an) return 0; if (!meterBuf || meterBuf.length !== an.fftSize) meterBuf = new Float32Array(an.fftSize); an.getFloatTimeDomainData(meterBuf); var m = 0; for (var i = 0; i < meterBuf.length; i += 4) { var v = Math.abs(meterBuf[i]); if (v > m) m = v; } return m; }
  function pct(v) { var db = v > 0 ? 20 * Math.log10(v) : -90; return Math.max(0, Math.min(100, (db + 60) / 60 * 100)); }
  function tick(force) {
    if (!root || (!visible && !force)) return;
    if (structureKey() !== lastKey) { render(); return; }
    var s = song(), st = T() && T().state || {}, t = tdata(s) || {}, dur = t.duration || 0, pos = st.pos || 0;
    var left = $("#lvLeft"); if (left) left.textContent = st.countIn ? "Count " + st.countIn : (dur ? "−" + fmt(Math.max(0, dur - pos)) : "–");
    var pe = $("#lvPos"); if (pe) pe.textContent = dur ? fmt(pos) + " / " + fmt(dur) : "";
    var fill = $("#lvProgFill"); if (fill) fill.style.width = (dur ? Math.min(100, pos / dur * 100) : 0) + "%";
    var list = sections(s), ci = curSection(s), q = T() && T().pendingJump ? T().pendingJump() : null;
    root.querySelectorAll(".lv-sec").forEach(function (b, i) {
      var x = list[i]; b.classList.toggle("now", i === ci); b.classList.toggle("queued", !!(q && x && Math.abs((q.time || 0) - x.start) < 0.05 && i !== ci));
      var bar = b.querySelector("i"); if (bar) bar.style.width = i === ci && x ? Math.min(100, (pos - x.start) / Math.max(0.1, x.end - x.start) * 100) + "%" : (i < ci ? "100%" : "0%");
    });
    var pb = root.querySelector('[data-lv="play"]'); if (pb) { var on = playing(); if (pb.classList.contains("on") !== on || force) renderTransport(); }
    var playingIdx = engine.playingIndexes(); root.querySelectorAll(".lv-pad").forEach(function (b, i) { b.classList.toggle("on", playingIdx.indexOf(i) > -1); });
    var m = T() && T().meters ? T().meters() : {}, tm = 0; Object.keys(m).forEach(function (k) { if (m[k] > tm) tm = m[k]; });
    var vt = $("#lvVuT"); if (vt) vt.style.width = (100 - pct(tm)) + "%";
    var vp = $("#lvVuP"); if (vp && engine.postL) vp.style.width = (100 - pct(Math.max(level(engine.postL), level(engine.postR)))) + "%";
  }
  var raf = 0, lastTick = 0;
  function loop(now) { raf = 0; if (!visible) return; if (now - lastTick > 90) { lastTick = now; try { tick(false); } catch (error) { console.warn("live", error); } } raf = requestAnimationFrame(loop); }

  // ------------------------------------------------------------- Safe Stop
  function safeStop(seconds) {
    seconds = seconds || 2.5;
    if (safeStop.timer) { finishSafeStop(true); return; }   // pressed again: now
    var ctx = engine.ctx, any = false;
    if (T() && T().isPlaying() && ctx && engine.tracksBus) {
      any = true; var now = ctx.currentTime;
      [engine.tracksBus.gain, engine.clickBus && engine.clickBus.gain].forEach(function (g) { if (!g) return; try { g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(0.0001, now + seconds); } catch (_) { } });
    } else if (T() && T().isPlaying()) { T().stop(false); }
    if (engine.voices().length) { any = true; fadePads(seconds); }
    var L = window.PPLooper; if (L && L.state && L.state().state === "playing") L.stop();
    if (!any) { PP.setStatus("Nothing is playing"); return; }
    PP.setStatus("Safe stop: fading out…"); note("safeStop");
    safeStop.timer = setTimeout(function () { finishSafeStop(false); }, seconds * 1000 + 80);
    renderTransport();
  }
  function fadePads() { engine.stop(); }   // (each pad fades with its own fade time)
  function finishSafeStop(now) {
    clearTimeout(safeStop.timer); safeStop.timer = 0;
    if (T() && T().isPlaying()) T().stop(false);
    if (now && engine.voices().length) { try { A().run("panic"); } catch (_) { } }
    if (T() && T().applyLevels) T().applyLevels();   // the faders back where they were, for the next song
    PP.setStatus(now ? "Stopped" : "Faded out");
    renderTransport();
  }
  function cancelSafeStop() { if (!safeStop.timer) return; clearTimeout(safeStop.timer); safeStop.timer = 0; if (T() && T().applyLevels) T().applyLevels(); }

  // ------------------------------------------------------------- service lock
  var BLOCKED = { tab: 1, performEdit: 1, showMixer: 1, toggleTracks: 1, instrumentAuto: 1, instrumentKind: 1 };
  function setLocked(on) {
    if (!!on !== locked) note(on ? "lock" : "unlock");
    locked = !!on; store("cp-service-lock", locked ? "1" : null);
    if (locked && window.PPShell && window.PPShell.currentTab() !== "live") window.PPShell.showTab("live");
    document.querySelectorAll("dialog[open]").forEach(function (d) { if (locked) try { d.close(); } catch (_) { } });
    render(); PP.setStatus(locked ? "Service lock on: only playing works until you unlock" : "Unlocked");
    if (bridge() && bridge().send) bridge().send({ type: "serviceLock", on: locked });
  }
  function pin() { var sys = F.systemStatus() || {}; return String(sys.code || (bridge() && bridge().info && bridge().info.code) || ""); }
  async function unlock() {
    var want = pin();
    if (!/^\d{4}$/.test(want)) { if (confirm("Turn the service lock off?")) setLocked(false); return; }
    var got = await PP.ask("The Central Pedal's PIN to unlock", { password: true, ok: "Unlock" });
    if (got === null) return;
    if (String(got).trim() === want) setLocked(false); else PP.setStatus("Wrong PIN - still locked");
  }
  var notified = 0;
  function lockedNotice() { if (Date.now() - notified > 1500) { notified = Date.now(); PP.setStatus("Service lock is on - unlock it on the LIVE screen"); } }
  // every action runs through here (buttons, pedals, MIDI, the small screen): the lock and Safe Stop
  function wrapActions() {
    var a = A(); if (!a || a.__live) return; a.__live = true;
    var run = a.run;
    a.run = function (name, args, info) {
      if (locked && BLOCKED[name] && !(name === "tab" && args && args.tab === "live")) { lockedNotice(); return true; }
      if (/^(playAll|playPauseAll|playPause|playTracks|nextSongPlay|segueNow)$/.test(name)) cancelSafeStop();
      if (name === "panic") note("panic");
      return run.call(a, name, args, info);
    };
    a.ACTIONS.safeStop = { id: "safeStop", label: "Safe stop: fade tracks and pads out (again = now)", group: "Transport", kind: "trigger", run: function () { safeStop(); } };
    a.ACTIONS.serviceLock = { id: "serviceLock", label: "Service lock on (unlock on the LIVE screen)", group: "Screens", kind: "trigger", run: function () { if (!locked) setLocked(true); } };
    a.ACTIONS.readyCheck = { id: "readyCheck", label: "Ready check (before the service)", group: "Screens", kind: "trigger", run: function () { if (window.PPShell) window.PPShell.showTab("live"); openReady(); } };
  }

  // ------------------------------------------------------------- Ready check
  function routeText(r) { var b = r.buses || {}; return ["tracks", "pad", "click", "instrument"].filter(function (k) { return b[k] && b[k] !== "off"; }).map(function (k) { return { tracks: "Tracks", pad: "Pads", click: "Click", instrument: "Instrument" }[k] + " " + b[k]; }).join(" · "); }
  function overlap(a, b) { if (!a || !b || a === "off" || b === "off") return false; var ra = String(a).split("-").map(Number), rb = String(b).split("-").map(Number); var a0 = ra[0], a1 = ra[1] || ra[0], b0 = rb[0], b1 = rb[1] || rb[0]; return a0 <= b1 && b0 <= a1; }
  function runChecks() {
    var out = [], p = project(), sys = F.systemStatus() || {}, h = sys.health || {};
    function add(level, title, detail, fix) { out.push({ level: level, title: title, detail: detail || "", fix: fix || null }); }
    // the Central Pedal itself
    if (connected()) add("ok", "Running on the Central Pedal", sys.hostname ? "Connected to " + sys.hostname : "");
    else add("warn", "Not connected to the Central Pedal's driver", "Footswitches, the small screen and the Pi checks need it. Restart the Central Pedal if this stays.");
    // sound
    var ctx = engine.ctx;
    if (!ctx) add("warn", "Sound has not started yet", "Tap Play once or press a pad: the sound starts with the first touch.", { label: "Start sound", act: "startAudio" });
    else if (ctx.state !== "running") add("fail", "Sound is paused", "The browser paused the audio. Tap here to start it again.", { label: "Start sound", act: "startAudio" });
    else add("ok", "Sound running", Math.round(ctx.sampleRate / 100) / 10 + " kHz");
    // outputs and the click
    var r = ctx && engine.routing, anyTracks = p.songs.some(hasTracks);   // (the outputs are known once the sound runs)
    if (r) {
      var b = r.buses || {};
      if (r.mode === "stereo2") {
        if (b.click === "mix") add(anyTracks ? "fail" : "warn", "The click is in the main mix", "On a 2-output device the click plays with the music - the congregation would hear it. Use an interface with 4 outputs, or send the click to its own device.", { label: "Audio settings", act: "settings" });
        else if (b.click === "split") add("warn", "Click on the right channel, music on the left", "Works with one in-ear mix and a mono feed to the desk. An interface with 4 outputs keeps everything in stereo.");
        else if (b.click === "device") add("ok", "Click goes to its own audio device", "");
        else add(anyTracks ? "warn" : "ok", "2 outputs: no click output", anyTracks ? "The tracks play without a click on this device. A 4-output interface gives the band a click." : "");
      } else {
        if (!b.click || b.click === "off") add(anyTracks ? "warn" : "ok", "Click output is off", "Settings → Audio routing: give the click its own output for the in-ears.", { label: "Audio settings", act: "settings" });
        else if (overlap(b.click, b.tracks) || overlap(b.click, b.pad)) add("fail", "The click shares an output with the music", "It would reach the front-of-house speakers. Give it an output of its own.", { label: "Audio settings", act: "settings" });
        else add("ok", (r.channels || r.need) + " outputs, click on its own", routeText(r));
      }
    }
    var vol = (p.performance || {}).volume; if (typeof vol === "number" && vol < 0.05) add("warn", "Master volume is at zero", "", null);
    // the setlist
    if (!p.songs.length) add("warn", "No setlist", "Add the songs for this service.", { label: "Setlist", act: "setlist" });
    else {
      var noTracks = p.songs.filter(function (s) { return !hasTracks(s); }), noSec = p.songs.filter(function (s) { return hasTracks(s) && !sections(s).length; }), noClick = p.songs.filter(function (s) { var t = tdata(s); return hasTracks(s) && t.click && t.click.on === false; });
      if (!noTracks.length) add("ok", "Every song has its tracks", p.songs.length + " songs");
      else add(noTracks.length === p.songs.length && !p.tracksMode ? "ok" : "warn", noTracks.length + " of " + p.songs.length + " songs have no tracks", noTracks.map(function (s) { return s.name; }).join(", ") + " - they play pads only.");
      if (noSec.length) add("warn", "Songs without sections", noSec.map(function (s) { return s.name; }).join(", ") + " - the section buttons and cues need them.");
      if (noClick.length) add("info", "Click turned off in " + noClick.length + " song" + (noClick.length > 1 ? "s" : ""), noClick.map(function (s) { return s.name; }).join(", "));
      if (anyTracks && !p.tracksMode) add("warn", "Tracks mode is off", "The songs have tracks but Play only plays pads.", { label: "Tracks on", act: "tracksOn" });
      if (p.songIndex < 0) add("warn", "No song loaded", "", { label: "Load song 1", act: "song1" });
    }
    // the Pi
    if (h.tempC != null) add(h.tempC >= 80 ? "fail" : h.tempC >= 70 ? "warn" : "ok", "Temperature " + f(h.tempC) + "°F", h.tempC >= 70 ? "The Pi slows down when it gets this hot. Give it air or a fan case." : "");
    if (h.underVoltage) add("fail", "The power supply is too weak right now", "Use the official Raspberry Pi power supply (5.1 V, 3 A for a Pi 4).");
    else if (h.underVoltageSinceBoot) add("warn", "The power dipped since the Pi started", "A weak power supply or a long USB-C cable. The official supply fixes it.");
    if (h.throttled) add("warn", "The Pi is slowing itself down", "Too hot or not enough power.");
    if (h.diskFreeMB != null) add(h.diskFreeMB < 300 ? "fail" : h.diskFreeMB < 1500 ? "warn" : "ok", "Storage: " + (h.diskFreeMB >= 1024 ? (h.diskFreeMB / 1024).toFixed(1) + " GB" : h.diskFreeMB + " MB") + " free", h.diskFreeMB < 1500 ? "Remove old songs or use a bigger SD card." : "");
    if (h.memFreeMB != null && h.memFreeMB < 250) add("warn", "Memory is low (" + h.memFreeMB + " MB free)", "Restart the Central Pedal before the service.");
    // the team
    var c = sys.center || (bridge() && bridge().info && bridge().info.center);
    if (c) add(c.paired ? "ok" : "info", c.paired ? "Paired with the main admin" + (c.name ? " (" + c.name + ")" : "") : "Not paired with the main admin", c.paired ? "" : "The Central Pedal works on its own; Central Control computers follow it once paired.");
    var rank = { fail: 3, warn: 2, info: 1, ok: 0 };
    out.sort(function (a, b) { return rank[b.level] - rank[a.level]; });
    var fails = out.filter(function (x) { return x.level === "fail"; }).length, warns = out.filter(function (x) { return x.level === "warn"; }).length;
    return { at: Date.now(), items: out, summary: fails ? { level: "bad", label: "✕ " + fails + " problem" + (fails > 1 ? "s" : "") } : warns ? { level: "warn", label: "⚠ " + warns + " to check" } : { level: "good", label: "✓ Ready" } };
  }
  function openReady() {
    if (connected()) F.sendToDriver({ type: "system", action: "status" });
    ready = runChecks(); renderStatus(); drawReady(); note("ready", { summary: ready.summary.label });
    setTimeout(function () { if (!$("#lvReady").classList.contains("hidden")) { ready = runChecks(); renderStatus(); drawReady(); } }, 1500);   // (the Pi's numbers arrive)
  }
  function drawReady() {
    var el = $("#lvReady"), rs = ready; if (!rs) return;
    var icon = { ok: "✓", warn: "⚠", fail: "✕", info: "i" };
    el.innerHTML = '<div class="lv-ready-box"><div class="row spread"><h2 class="' + rs.summary.level + '">' + (rs.summary.level === "good" ? "✓ Ready for the service" : rs.summary.label) + '</h2><span><button data-lv="readyAgain">Check again</button> <button data-lv="readyClose">Close</button></span></div>' +
      '<ul>' + rs.items.map(function (x, i) { return '<li class="' + x.level + '"><i>' + icon[x.level] + "</i><div><b>" + esc(x.title) + "</b>" + (x.detail ? "<small>" + esc(x.detail) + "</small>" : "") + "</div>" + (x.fix && !(locked && /settings|setlist|tracksOn/.test(x.fix.act)) ? '<button data-lv="fix" data-i="' + i + '">' + esc(x.fix.label) + "</button>" : "") + "</li>"; }).join("") + "</ul>" +
      (rs.summary.level === "good" && !locked ? '<button class="primary lv-go" data-lv="lockGo">🔒 Lock for the service</button>' : "") + "</div>";
    el.classList.remove("hidden");
  }
  function fix(item) {
    var act = item && item.fix && item.fix.act;
    if (act === "startAudio") { try { engine.ensure(); } catch (_) { } }
    else if (act === "settings") { $("#lvReady").classList.add("hidden"); if (window.PPShell) window.PPShell.showTab("settings"); return; }
    else if (act === "setlist") { $("#lvReady").classList.add("hidden"); F.openSetlist(); return; }
    else if (act === "tracksOn") { if (T()) T().setTracksMode(true); }
    else if (act === "song1") F.loadSong(0);
    setTimeout(openReady, 400);
  }

  // ------------------------------------------------------------- touches
  function sure(key) { if (armed.key === key && Date.now() - armed.at < 3000) { armed.key = ""; return true; } armed = { key: key, at: Date.now() }; setTimeout(function () { if (armed.key === key) { armed.key = ""; render(); } }, 3100); return false; }
  function onClick(e) {
    var b = e.target.closest && e.target.closest("[data-lv]"); if (!b || !root.contains(b) || b.disabled) return;
    var a = b.dataset.lv, i = Number(b.dataset.i), run = function (n, args) { A() && A().run(n, args); };
    if (a === "play") { cancelSafeStop(); run("playPauseAll"); }
    else if (a === "prevSec") run("prevSection");
    else if (a === "nextSec") run("nextSection");
    else if (a === "vamp") run("repeatSection");
    else if (a === "safeStop") safeStop();
    else if (a === "nextSong") { if (playing() && !sure("nextSong")) { renderTransport(); return; } run("nextSongStop"); }
    else if (a === "song") { if (i === project().songIndex) return; if (playing() && !sure("song" + i)) { renderSetlist(); return; } if (playing()) T().stop(false); F.loadSong(i); }
    else if (a === "sec") { if (T()) T().goSection(i); }
    else if (a === "pad") run("pad", { index: i });
    else if (a === "padsStop") run("stop");
    else if (a === "click") run("toggleClick");
    else if (a === "cues") run("toggleCues");
    else if (a === "tracksMode") { if (!locked && T()) T().setTracksMode(!project().tracksMode); }
    else if (a === "instPrev" || a === "instNext") { var d = a === "instNext" ? 1 : -1, ins = I(); if (ins) { if (ins.kind() === "keys") ins.stepPatch(d); else ins.stepBoard(d); } }
    else if (a === "tuner") { var ins2 = I(); if (ins2) { ins2.toggleTuner(); tuner = { note: "–", cents: null }; } }
    else if (a === "instTab") { if (window.PPShell) window.PPShell.showTab("instrument"); return; }
    else if (a === "setlist") { F.openSetlist(); return; }
    else if (a === "lock") { if (locked) unlock(); else setLocked(true); return; }
    else if (a === "ready" || a === "readyAgain") { openReady(); return; }
    else if (a === "report") { if (window.PPReport) window.PPReport.open(); return; }
    else if (a === "readyClose") { $("#lvReady").classList.add("hidden"); return; }
    else if (a === "lockGo") { $("#lvReady").classList.add("hidden"); setLocked(true); return; }
    else if (a === "fix") { fix(ready && ready.items[i]); return; }
    setTimeout(render, 60);
  }
  function onProgress(e) {
    if (locked || !T()) return; var s = song(), t = tdata(s); if (!t || !t.duration) return;
    var r = e.currentTarget.getBoundingClientRect(); T().seek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * t.duration);
  }

  // ------------------------------------------------------------- wiring
  function shown(on) {
    visible = !!on;
    if (!on) { var ins = I(); if (ins && ins.tunerOn && ins.tunerOn() && window.PPShell && window.PPShell.currentTab() !== "instrument") ins.toggleTuner(false); }
    if (on) { render(); if (!raf) raf = requestAnimationFrame(loop); if (connected()) F.sendToDriver({ type: "system", action: "status" }); }
  }
  function init() {
    build(); wrapActions();
    root.addEventListener("click", onClick);
    $("#lvProgress").addEventListener("click", onProgress);
    if (F.onSong) F.onSong(function () { setTimeout(render, 30); });
    F.on("systemStatus", function () { if (visible) { renderStatus(); if (ready && Date.now() - ready.at > 20000) { ready = runChecks(); renderStatus(); } } });
    F.on("hello", function () { if (visible) render(); if (locked && bridge() && bridge().send) bridge().send({ type: "serviceLock", on: true }); });
    var ins = I(); if (ins && ins.onTuner) ins.onTuner(function (note, cents) {
      tuner = { note: note, cents: cents }; if (!visible) return;
      var n = $("#lvTunerNote"), nd = $("#lvNeedle"), tx = $("#lvTunerTxt"), box = root.querySelector(".lv-tuner"), ok = Math.abs(cents) < 3;
      if (!n) { renderInst(); return; }
      n.textContent = note; nd.style.left = (50 + Math.max(-50, Math.min(50, cents))) + "%"; tx.textContent = ok ? "in tune" : (cents > 0 ? "+" + cents + "¢ sharp" : cents + "¢ flat"); box.classList.toggle("intune", ok);
    });
    setInterval(function () { if (visible && connected()) F.sendToDriver({ type: "system", action: "status" }); }, 15000);
    setInterval(function () { if (visible) { ready = runChecks(); renderStatus(); } }, 30000);
    document.body.classList.toggle("service-locked", locked);
  }
  init();
  window.PPLive = { render: render, shown: shown, locked: function () { return locked; }, setLocked: setLocked, lockedNotice: lockedNotice, safeStop: safeStop, readyCheck: function () { return runChecks(); }, openReady: openReady, unlock: unlock };
})();
