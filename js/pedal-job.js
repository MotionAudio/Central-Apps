/* Central Pedal - what this Central Pedal does. The main admin (Central Control) gives every Central Pedal a job:
 *   Track player     plays the tracks and sends the charts and lyrics (one at a time; every Central Control follows it)
 *   Foot controller  its buttons, pedals, knobs and MIDI start / stop, change song and section on the track player
 *   Instrument rig   only its own instrument (boards, pedals, keys sounds) - no tracks
 *   Standby          keeps the song library, does not play (the main admin's player window while a pedal plays)
 * A Central Pedal on its own (not paired with a main admin) is always the track player.
 * Instrument, looper and touch-select actions always stay on this pedal. */
(function () {
  "use strict";
  var PP = window.PP, F = window.PPFeatures; if (!PP || !F) return;
  var esc = PP.escapeHtml || function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var JOB_NAMES = { player: "Track player", controller: "Foot controller", instrument: "Instrument rig", backup: "Backup player", standby: "Standby" };
  // what a foot controller sends to the track player (and an instrument rig / standby does not do itself)
  var SONG_GROUPS = { Transport: 1, Pads: 1, Tempo: 1, Key: 1, Setlist: 1, Tracks: 1, Screens: 1, Textures: 1, Scenes: 1, Rehearse: 1 };
  var LOCAL = { none: 1, tab: 1, performEdit: 1, showMixer: 1 };
  var REMOTE_FROM = { companion: 1, "central-usage": 1, controller: 1, satellite: 1 };
  var job = "player", center = null, player = null, shown = null, warnAt = 0;

  function songAction(a) { return SONG_GROUPS[a.group] && !LOCAL[a.id]; }
  function intercept(a, args, info) {
    if (job === "player" || !a || !songAction(a)) return false;
    if (info && REMOTE_FROM[info.from]) return job !== "player";   // (another device asked this pedal to play: it does not)
    if (job === "controller") {
      var m = { type: "forwardAction", name: a.id, args: args || {} };
      if (info && typeof info.value === "number") m.value = info.value;
      if (info && info.delta) m.delta = info.delta;
      if (!F.sendToDriver(m)) note("Not connected - the button did nothing.");
      return true;
    }
    note(job === "instrument" ? "This Central Pedal is the instrument rig - the tracks play on " + playerName() + "." : job === "backup" ? "Backup player - it follows " + playerName() + " (Settings → Backup player)." : "Standby - the tracks play on " + playerName() + ".");
    return true;
  }
  function playerName() { return (player && player.name) || (center && center.player && center.player.name) || "the track player"; }
  function note(t) { var now = Date.now(); if (now - warnAt < 1500) return; warnAt = now; PP.setStatus(t); }

  function set(newJob) {
    newJob = JOB_NAMES[newJob] ? newJob : "player";
    var was = job; job = newJob;
    document.body.dataset.pedalJob = job;
    if (was !== job && job !== "player") {   // it stops playing: the track player has the song now
      try { if (window.PPTracks && window.PPTracks.isPlaying()) window.PPTracks.stop(false); } catch (_) { }
      try { if (PP.engine && PP.engine.voices().length) PP.engine.stop(); } catch (_) { }
    }
    if (was !== job) PP.setStatus(job === "player" ? "This Central Pedal plays the tracks" : "This Central Pedal is now the " + JOB_NAMES[job].toLowerCase() + (job === "controller" ? " for " + playerName() : ""));
    render();
  }
  // a bar at the top while this pedal does not play: what it does, and (foot controller) what the player is doing
  function render() {
    var bar = document.getElementById("pedalJobBar");
    if (job === "player") { if (bar) bar.remove(); return; }
    if (!bar) { bar = document.createElement("div"); bar.id = "pedalJobBar"; bar.className = "pj-bar"; document.body.appendChild(bar); }
    var c = center || {}, d = shown || {};
    var link = c.remote ? '<span class="pj-ok">● linked</span>' : '<span class="pj-warn">● connecting…</span>';
    var main = '<b>' + esc(JOB_NAMES[job]) + "</b>";
    if (job === "controller") main += " → " + esc(playerName()) + " " + link + (d.song ? ' <span class="pj-song">' + (d.playing ? "▶ " : "■ ") + esc(d.song) + (d.section ? " · " + esc(d.section) : "") + (d.next ? ' <small>next: ' + esc(d.next) + "</small>" : "") + "</span>" : "");
    else if (job === "instrument") main += ' <span class="pj-sub">your instrument only - the tracks play on ' + esc(playerName()) + "</span>";
    else if (job === "backup") main += " " + (window.PPBackup ? window.PPBackup.barHtml(playerName(), c.remote) : "");
    else main += ' <span class="pj-sub">keeps the song library - the tracks play on ' + esc(playerName()) + "</span>";
    bar.innerHTML = main + ' <small class="pj-by">set by the main admin' + (c.name ? " (" + esc(c.name) + ")" : "") + "</small>";
  }
  F.on("hello", function (m) { center = m.center || null; player = center && center.player; set(m.pedalJob || "player"); });
  F.on("pedalRole", function (m) { player = m.player || null; render(); });
  F.on("playerDisplay", function (m) { shown = m; render(); });
  F.on("forwardFailed", function () { note("Not connected to the track player - the button did nothing."); });

  // Settings: what this pedal does (shown; the main admin changes it)
  function section() {
    var c = center || {};
    return '<p>This Central Pedal: <b>' + esc(JOB_NAMES[job]) + "</b>" + (c.state === "paired" ? ' <span class="muted small">(the main admin picks it on the Devices tab)</span>' : ' <span class="muted small">(not paired with a main admin - it plays the tracks itself)</span>') + "</p>";
  }
  window.PPPedalJob = { intercept: intercept, job: function () { return job; }, set: set, section: section, names: JOB_NAMES };
})();
