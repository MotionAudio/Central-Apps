/* Central Control (10.2) - a running run sheet's cues, fired on every computer at the same moment.
 * When the main admin presses Next (or Back, or starts the service) the center sends the run to every computer with a
 * new cue number; each computer fires the cues of the item now on, for the jobs it runs:
 *   Lights       look       the lighting look with that name ("Follow the song" goes back to the song's own lights)
 *   Slides       slide      the slide with that name goes live (and lyrics on/off on the lyrics screens)
 *   Lyrics       lyrics     "on" sends the lyrics to the screens, "off" takes them off
 *   Cameras      camera     the camera with that name goes to the program output (a fade)
 *                lowerThird the lower third on the stream (shown on the band's screen too)
 *   Stream       scene      the stream scene with that name (where a scene switcher is set up)
 * The song cue is for the track player, which alone changes songs: the main admin's computer checks the song is in its
 * setlist. Each computer keeps a short log of what it fired; a cue it couldn't fire says why. */
(function () {
  "use strict";
  var CU = window.CentralUsage; if (!CU) return;
  var lastSeq = null, log = [];
  function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
  // this computer does a job (by its jobs) and is the one running it (when several have it)
  function doing(job) {
    var r = CU.role(); if (r !== "admin" && r !== "main") return false;
    var j = CU.jobs(); if (j[0] !== "general" && j.indexOf(job) < 0) return false;
    return CU.runs ? CU.runs(job) !== false : true;
  }
  function note(cue, ok, text) { log.unshift({ at: Date.now(), cue: cue, ok: ok, text: text }); log = log.slice(0, 40); CU.fire("cueFired", log[0]); }
  var FIRE = {
    look: function (v) {
      var L = window.CULights; if (!L) return note("look", false, "the Lighting tab isn't here");
      if (/^follow/i.test(v)) { L.remoteCommand({ cmd: "follow" }); return note("look", true, "lights follow the song"); }
      var looks = (L.rig && L.rig().looks) || [], hit = looks.filter(function (l) { return norm(l.name) === norm(v); })[0] || looks.filter(function (l) { return norm(l.name).indexOf(norm(v)) === 0; })[0];
      if (!hit) return note("look", false, "no lighting look called “" + v + "”");
      L.goLook(hit.id); note("look", true, "lights: " + hit.name);
    },
    slide: function (v) {
      var SL = window.CUSlides; if (!SL) return note("slide", false, "the Slides tab isn't here");
      var items = (SL.state() && SL.state().items) || [], hit = items.filter(function (x) { return norm(x.kind === "text" ? x.title : x.name) === norm(v); })[0] || items.filter(function (x) { return norm(x.kind === "text" ? x.title : x.name).indexOf(norm(v)) === 0; })[0];
      if (!hit) return note("slide", false, "no slide called “" + v + "”");
      SL.goLive(hit.id); note("slide", true, "slide: " + (hit.kind === "text" ? hit.title : hit.name));
    },
    lyrics: function (v) {
      var SL = window.CUSlides; if (!SL || !SL.setLyricsLive) return note("lyrics", false, "the lyrics output isn't here");
      SL.setLyricsLive(v === "on"); note("lyrics", true, "lyrics " + (v === "on" ? "on the screens" : "off the screens"));
    },
    camera: function (v) {
      var V = window.CUVideoTab; if (!V || !V.state || !V.state.cfg) return note("camera", false, "the video switcher isn't running here");
      var src = (V.state.cfg.sources || []).filter(function (x) { return norm(x.name) === norm(v); })[0] || (V.state.cfg.sources || []).filter(function (x) { return norm(x.name).indexOf(norm(v)) === 0; })[0];
      if (!src) return note("camera", false, "no camera called “" + v + "”");
      V.take(src.id); note("camera", true, "camera: " + src.name);
    },
    lowerThird: function (v) {
      var V = window.CUVideoTab;
      if (V && V.lowerThird) { V.lowerThird(v); return note("lowerThird", true, "lower third: " + v); }
      note("lowerThird", true, "lower third (on the band's screen): " + v);   // (the video switcher shows lyrics as its lower third; a text lower third comes with its titles)
    },
    scene: function (v) {
      var V = window.CUVideoTab;
      if (V && V.scene) { V.scene(v); return note("scene", true, "stream scene: " + v); }
      note("scene", false, "no stream scene switcher here (“" + v + "”)");
    }
  };
  var JOB = { look: "lights", slide: "slides", lyrics: "lyrics", camera: "cameras", lowerThird: "cameras", scene: "stream" };
  function fire(it) {
    var cues = it.cues || {};
    Object.keys(FIRE).forEach(function (k) { if (cues[k] && doing(JOB[k])) { try { FIRE[k](cues[k]); } catch (e) { note(k, false, e.message); } } });
    // the song: only the track player (the Central Pedal or the main admin's player) starts and changes songs, so here
    // it's a check that the song is in its setlist (the run panel and the band's screen show what's up next)
    if ((cues.song || it.song) && CU.role() === "main") {
      var ref = cues.song || it.song, d = CU.state.display, list = (d && d.songs) || [], q = list.filter(function (x) { return x.id === ref || x.name === ref; })[0];
      if (q) note("song", true, "song up next on the track player: " + q.name + (d && d.song && d.song.name === q.name ? " (already on it)" : ""));
      else if (list.length) note("song", false, "“" + (it.title || ref) + "” isn't in the track player's setlist");
    }
  }
  CU.on("services", function (st) {
    var run = st && st.run;
    if (!run) { lastSeq = null; return; }
    var key = run.service + ":" + (run.seq || 0) + ":" + run.startedAt;
    if (lastSeq === null) { lastSeq = key; if (Date.now() + (st.offset || 0) - run.itemStart > 4000) return; }   // (opened mid-service: don't fire the item that's been on for a while)
    else if (key === lastSeq) return;
    lastSeq = key;
    var sv = (st.services || []).filter(function (x) { return x.id === run.service; })[0], it = sv && sv.items[run.item];
    if (it) fire(it);
  });
  window.CURunsheetCues = { log: function () { return log.slice(); }, fire: fire, doing: doing };
})();
