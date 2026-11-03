/* Central Control (10.2) - the CCLI report's "stream" and "record" columns. While the live stream is on air (the Stream
 * mix, or the Video tab's Stream output going out) or the service is being recorded, each song that plays is noted
 * once a day for the church (PPCcli.log keeps it to one per song, kind and day, and sends it when online). The words on
 * the screens ("display") are noted by the Slides tab and the Central Pedal; printing is noted where a chart is printed.
 * Only the main admin's computer notes these, so one service isn't counted twice. */
(function () {
  "use strict";
  var CU = window.CentralUsage; if (!CU) return;
  function streaming() {
    var M = window.CUMixStream; if (M && M.live && M.live()) return true;
    var V = window.CUVideoTab; return !!(V && V.streaming && V.streaming());
  }
  function recording() { var R = window.CURecUI, s = R && R.state && R.state(); return !!(s && s.recording); }
  function note(d) {
    var C = window.PPCcli; if (!C || !C.log || !d || !d.song || !d.playing) return;
    if (CU.role && CU.role() !== "main") return;
    var song = { title: d.song.name, ccli: d.song.ccli, author: d.song.author, copyright: d.song.copyright };
    var opts = { device: CU.appName };
    if (streaming()) C.log(song, "stream", opts);
    if (recording()) C.log(song, "record", opts);
  }
  CU.on("message", function (m) { if (m && m.type === "display") note(m); });
  // (the stream going on air with a song already up: that one counts too - the Video tab and the Stream mix say so)
  CU.on("videoStreaming", function (on) { if (on) note(CU.state.display); });
  var wasLive = false; setInterval(function () { var on = streaming(); if (on && !wasLive) note(CU.state.display); wasLive = on; }, 2000);   // (the Stream mix going on air)
  window.CUCcliUsage = { note: function () { note(CU.state.display); }, streaming: streaming, recording: recording };
})();
