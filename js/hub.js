/* Central Control - the hub: every song (with or without tracks) goes to the driver, which keeps a copy for
 * Central Usage - its lighting Songs tab, the waveform with the sections in their colours, the hits, the
 * tempo. Changed songs are sent within a few seconds; removed songs are removed there too. */
(function () {
  "use strict";
  var PP = window.PP, F = window.PPFeatures; if (!PP || !F) return;
  var sent = {}, timer = 0;
  function bridge() { return window.__pedalBridge; }
  function sig(r) { return JSON.stringify([r.name, r.key, r.bpm, r.bpb, r.duration, r.sections, r.hits.length, r.stems.length, r.overview.length, r.grid ? r.grid.bars.length : 0, r.music ? [r.music.chords.length, Object.keys(r.music.transcriptions || {}).length, r.music.drums ? 1 : 0, r.music.words.length, (r.music.chartText || "").length] : 0]); }
  function push(all) {
    var b = bridge(), T = window.PPTracks; if (!b || !b.connected || !T || !T.hubSong) return;
    var songs = PP.project().songs || [], out = [], seen = {};
    songs.forEach(function (s) {
      if (!s || !s.id) return; seen[s.id] = true;
      var r; try { r = T.hubSong(s); } catch (_) { r = null; } if (!r) return;
      var k = sig(r); if (!all && sent[s.id] === k) return; sent[s.id] = k; out.push(r);
    });
    var gone = Object.keys(sent).filter(function (id) { return !seen[id]; }); gone.forEach(function (id) { delete sent[id]; });
    for (var i = 0; i < out.length; i += 4) b.send({ type: "hub", songs: out.slice(i, i + 4) });   // a few at a time (overviews are big)
    if (gone.length) b.send({ type: "hub", songs: [], remove: gone });
  }
  F.on("hello", function () { sent = {}; setTimeout(function () { push(true); }, 1500); });
  clearInterval(timer); timer = setInterval(function () { push(false); }, 4000);
  window.PPHub = { push: push };
})();
