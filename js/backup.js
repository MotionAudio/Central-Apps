/* Central Pedal - the backup player. A Central Pedal (or the main admin's player window) with the job "Backup player"
 * follows the track player: the same song, the same place, playing silently (its whole output faded to nothing - no
 * MIDI hits, clock or ProPresenter either). If the track player stops sending mid-song - its link drops, or nothing
 * arrives for a moment - the backup asks the main admin, which agrees only when the track player's heartbeat has
 * stopped too, and then fades in where the song is: the service carries on. Then it is the track player.
 * Everything is a setting (Settings → Backup player): automatic or with a button, how long a silence counts as lost,
 * the fade-in, how close it keeps in step, the network delay it allows for, whether the pads come too. */
(function () {
  "use strict";
  var PP = window.PP, F = window.PPFeatures; if (!PP || !F) return;
  var engine = PP.engine, esc = PP.escapeHtml;
  function T() { return window.PPTracks; }
  function project() { return PP.project(); }
  function job() { return window.PPPedalJob ? window.PPPedalJob.job() : "player"; }
  function cfg() {
    var p = project(), c = p.backup || (p.backup = {});
    if (!/^(auto|button|off)$/.test(c.mode || "")) c.mode = "auto";
    if (!(c.timeoutMs >= 300)) c.timeoutMs = 1500;
    if (!(c.fadeMs >= 0)) c.fadeMs = 400;
    if (!(c.toleranceMs >= 20)) c.toleranceMs = 120;
    if (!(c.latencyMs >= 0)) c.latencyMs = 30;
    if (c.pads == null) c.pads = true;
    if (c.alarm == null) c.alarm = true;
    return c;
  }
  var last = null, lastAt = 0, took = false, lost = false, asking = false, seeking = false, status = "waiting";

  function active() { return job() === "backup" && cfg().mode !== "off"; }
  function silent() { return job() === "backup" && !took; }
  function predicted() { if (!last) return 0; var c = cfg(); return (last.pos || 0) + ((last.playing && !last.countIn) ? ((performance.now() - lastAt) + c.latencyMs) / 1000 * (last.speed || 1) : 0); }

  // ---------------------------------------------------------- following
  F.on("backupFollow", function (m) {
    last = m; lastAt = performance.now(); lost = false;
    if (!active() || took) return;
    var t = T(); if (!t) return;
    if (t.outLevel() !== 0) t.setOut(0);
    var p = project(), idx = p.songs.findIndex(function (s) { return s.id === m.songId; });
    if (idx < 0 && m.song) idx = p.songs.findIndex(function (s) { return s.name === m.song; });
    if (idx < 0) { status = m.song ? "doesn't have “" + m.song + "” yet (the song library is still copying)" : "waiting for a song"; render(); return; }
    if (idx !== p.songIndex) { if (t.isPlaying()) t.stop(false); F.loadSong(idx); }
    if (!!p.tracksMode !== !!m.tracksMode) t.setTracksMode(!!m.tracksMode);
    if (m.loop != null && t.state.loop !== m.loop && t.setLoop) t.setLoop(m.loop);
    if (m.playing && !m.countIn) {
      if (!t.isPlaying() && !seeking) {
        seeking = true; t.seek(predicted());
        Promise.resolve(t.play({ countIn: false })).then(function () { t.seek(predicted()); }).catch(function () { }).then(function () { seeking = false; });
      } else if (!seeking) {
        var diff = (t.state.pos - predicted()) * 1000;
        if (Math.abs(diff) > cfg().toleranceMs) t.seek(predicted());
      }
      status = "in step with the track player (silent)";
    } else {
      if (t.isPlaying()) t.pause();
      if (Math.abs((t.state.pos || 0) - (m.pos || 0)) > 0.25) t.seek(m.pos || 0);
      status = m.countIn ? "count-in on the track player" : "ready - the track player is stopped";
    }
    render();
  });
  // the link to the track player dropped (its websocket closed)
  F.on("backupLost", function () { onLost("the link to the track player dropped"); });
  setInterval(function () {
    if (!active() || took || !last || !last.playing || last.countIn) return;
    if (performance.now() - lastAt > cfg().timeoutMs) onLost("nothing from the track player for " + Math.round((performance.now() - lastAt) / 100) / 10 + " s");
  }, 100);

  function onLost(why) {
    if (!active() || took || lost) return;
    lost = true; status = "lost the track player: " + why;
    if (!last || !last.playing) { render(); return; }   // (stopped anyway: nothing to carry on)
    if (cfg().alarm) PP.setStatus("⚠ The track player stopped mid-song" + (cfg().mode === "auto" ? " - the backup takes over" : " - press TAKE OVER"));
    if (cfg().mode === "auto") takeOver(); else render();
  }
  // ask the main admin first (it says no while the track player's heartbeat is still there - then only this
  // computer lost its Wi-Fi); no answer within a moment: the main admin is gone too, so it plays anyway
  function takeOver(manual) {
    if (took || asking) return;
    asking = true; status = "taking over…"; render();
    var answered = false, timer = setTimeout(function () { if (!answered) go(); }, 700);
    function go() {
      asking = false; took = true; lost = false;
      var t = T(); if (!t) return;
      var pos = predicted();
      var start = t.isPlaying() ? Promise.resolve() : (t.seek(pos), Promise.resolve(t.play({ countIn: false })));
      start.then(function () { if (Math.abs(t.state.pos - predicted()) > 0.3) t.seek(predicted()); t.setOut(1, cfg().fadeMs); });
      if (cfg().pads && last && last.pads && last.pads.length && !engine.voices().length) { try { PP.triggerPad(last.pads[0]); for (var i = 1; i < last.pads.length; i++) PP.triggerPad(last.pads[i], { layer: true }); } catch (_) { } }
      status = "PLAYING - took over from the track player"; render();
      PP.setStatus("✓ Backup player took over at " + (t.fmtTime ? t.fmtTime(pos) : Math.round(pos) + " s"));
      if (window.PPShell && window.PPShell.currentTab() !== "live" && !(window.PPLive && window.PPLive.locked())) window.PPShell.showTab("live");
    }
    replyWait = function (m) { if (answered) return; answered = true; clearTimeout(timer); if (m.ok || !m.playerAlive || manual) go(); else { asking = false; lost = false; status = "the track player is still there (this computer lost its Wi-Fi) - staying silent"; render(); } };
    if (!F.sendToDriver({ type: "backupTakeover" })) { answered = true; clearTimeout(timer); go(); }
  }
  var replyWait = null;
  F.on("backupTakeoverReply", function (m) { if (replyWait) { var fn = replyWait; replyWait = null; fn(m); } });
  // the main admin changed the job: as the player (after taking over) it plays out loud; back to backup: silent again
  F.on("hello", function (m) {
    var j = m.pedalJob || "player", t = T();
    if (j === "backup" && took) { took = false; lost = false; if (t) t.setOut(0, 200); }
    if (j !== "backup" && t && t.outLevel() !== 1) t.setOut(1, j === "player" ? cfg().fadeMs : 0);
    render();
  });

  // ---------------------------------------------------------- the bar and the settings
  function barHtml(playerName, linked) {
    var c = cfg();
    if (c.mode === "off") return '<span class="pj-sub">is off (Settings → Backup player)</span>';
    var lostNow = lost && !took;
    return '<span class="pj-sub">→ ' + esc(playerName) + " " + (linked ? '<span class="pj-ok">● linked</span>' : '<span class="pj-warn">● connecting…</span>') + " · " + esc(status) + (last && last.song ? " · ♪ " + esc(last.song) : "") + "</span>" +
      (lostNow || (c.mode === "button" && !took) ? ' <button class="' + (lostNow ? "danger" : "") + '" data-bk="take">TAKE OVER' + (lostNow ? " NOW" : "") + "</button>" : "");
  }
  function render() { if (window.PPPedalJob && job() === "backup") { var bar = document.getElementById("pedalJobBar"); if (bar) { var c = window.PPPedalJob; c.set(c.job()); } } }
  function settingsHtml() {
    var c = cfg();
    return '<section data-st="audio" class="bk"><h3>Backup player</h3>' +
      '<p class="muted small">When the main admin makes this ' + (window.PPTransfer && window.PPTransfer.isControl() ? "computer" : "Central Pedal") + ' the <b>backup player</b> (Devices tab), it plays the same song in step with the track player, silently, and carries on where it was if the track player stops mid-song. Now: <b>' + esc(job() === "backup" ? status : job() === "player" && took ? "playing (took over)" : "not the backup") + "</b></p>" +
      '<label>When the track player stops<select data-bk="mode"><option value="auto"' + (c.mode === "auto" ? " selected" : "") + '>Take over by itself</option><option value="button"' + (c.mode === "button" ? " selected" : "") + '>Show a TAKE OVER button</option><option value="off"' + (c.mode === "off" ? " selected" : "") + ">Don't follow (off)</option></select></label>" +
      '<label>Silence that counts as stopped (ms)<input type="number" min="300" max="10000" step="100" data-bk="timeoutMs" value="' + c.timeoutMs + '"></label>' +
      '<label>Fade-in when it takes over (ms)<input type="number" min="0" max="5000" step="50" data-bk="fadeMs" value="' + c.fadeMs + '"></label>' +
      '<label>Keep in step within (ms)<input type="number" min="20" max="1000" step="10" data-bk="toleranceMs" value="' + c.toleranceMs + '"></label>' +
      '<label>Network delay to allow for (ms)<input type="number" min="0" max="500" step="5" data-bk="latencyMs" value="' + c.latencyMs + '"></label>' +
      '<label class="toggle"><input type="checkbox" data-bk="pads"' + (c.pads ? " checked" : "") + "> Bring in the pads that were playing too</label>" +
      '<label class="toggle"><input type="checkbox" data-bk="alarm"' + (c.alarm ? " checked" : "") + "> Say so on the screen when the track player stops</label></section>";
  }
  document.addEventListener("change", function (e) {
    var t = e.target; if (!t.dataset || !t.dataset.bk) return; var c = cfg(), k = t.dataset.bk;
    if (k === "mode") c.mode = t.value; else if (k === "pads" || k === "alarm") c[k] = t.checked; else c[k] = Math.max(0, Number(t.value) || 0);
    cfg(); PP.persistSoon(); render();
  });
  document.addEventListener("click", function (e) { var b = e.target.closest && e.target.closest('[data-bk="take"]'); if (b) takeOver(true); });

  window.PPBackup = { silent: silent, active: active, barHtml: barHtml, settingsHtml: settingsHtml, takeOver: takeOver, cfg: cfg, state: function () { return { last: last, took: took, lost: lost, status: status, predicted: predicted() }; } };
})();
