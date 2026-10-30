/* Central Control - "Write lyrics + chords from the vocal": the vocal track of the song the Central Pedal is on
 * is fetched, the speech model on this computer hears the words (with their times), a lyric chart is written
 * with the chords on the words they land on, and both go back to the Central Pedal (the chart, and the
 * words' timing for the vocal part). Also the Settings card for the speech model. */
(function () {
  "use strict";
  var CU = window.CentralUsage, NAT = window.CU, L = window.PPLyricsAI; if (!CU || !L) return;
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var st = null, busy = false;
  var LANGS = [["", "Find out by itself"], ["english", "English"], ["spanish", "Spanish"], ["portuguese", "Portuguese"], ["french", "French"], ["german", "German"], ["korean", "Korean"], ["chinese", "Chinese"], ["tagalog", "Tagalog"], ["swahili", "Swahili"]];

  // ------------------------------------------------------------- the button on the Lyrics tab (admin side)
  var bar = $("#view-lyrics .bar");
  if (bar && L.available()) {
    var span = document.createElement("span"); span.className = "admin-only lyr-listen";
    span.innerHTML = '<button id="lyrListen" title="Hear the words in the vocal track and write a lyric chart with the chords">♫ Lyrics + chords from the vocal</button><span class="muted small" id="lyrListenInfo"></span>';
    bar.appendChild(span);
    $("#lyrListen").addEventListener("click", run);
  }
  function info(t) { var el = $("#lyrListenInfo"); if (el) el.textContent = t || ""; }
  function vocalOf(stems) {
    var v = (stems || []).filter(function (s) { return s.file && s.bus !== "click" && (s.role === "vocals" || /vox|vocal|lead|melody|\blv\b/i.test(s.name || "")); });
    v.sort(function (a, b) { return (/lead|\blv\b|melody/i.test(b.name) ? 1 : 0) - (/lead|\blv\b|melody/i.test(a.name) ? 1 : 0); });
    return v[0] || null;
  }
  async function run() {
    if (busy) return;
    var d = CU.state.display, s = d && d.song && (d.songs || [])[d.song.index]; if (!s || !s.id) { info("No song on the Central Pedal."); return; }
    if (!CU.prefs.code) { await CU.askCode(); if (!CU.prefs.code) return; }
    busy = true; $("#lyrListen").disabled = true;
    try {
      info("Getting the song…");
      var hub = await (await fetch(CU.api("/hub/" + encodeURIComponent(s.id)), { cache: "no-store" })).json();
      var voc = vocalOf(hub.stems); if (!voc) throw new Error("this song has no vocal track (name one Vocal / Lead / Vox)");
      info("Loading the " + voc.name + " track…");
      var r = await fetch(CU.api("/hub-file?code=" + encodeURIComponent(CU.prefs.code) + "&path=" + encodeURIComponent(voc.file))); if (!r.ok) throw new Error("the Central Pedal did not send the track (" + r.status + ")");
      var ac = new (window.AudioContext || window.webkitAudioContext)(), buf = await ac.decodeAudioData(await r.arrayBuffer()); try { ac.close(); } catch (_) { }
      var mono = new Float32Array(buf.length); for (var c = 0; c < buf.numberOfChannels; c++) { var ch = buf.getChannelData(c); for (var i = 0; i < ch.length; i++) mono[i] += ch[i] / buf.numberOfChannels; }
      var words = await L.listen(mono, buf.sampleRate, function (t) { info(t + " (" + voc.name + ")"); });
      if (!words.length) throw new Error("no words heard in " + voc.name);
      var m = hub.music || {}, g = hub.grid || {}, period = 60 / (g.bpm || hub.bpm || 100), bars = g.bars || [];
      var chords = (m.chords || []).map(function (c2) { var t0 = bars[c2.bar - 1]; if (t0 == null) t0 = (bars[0] || 0) + (c2.bar - 1) * (hub.bpb || 4) * period; return { start: t0 + (c2.beat - 1) * period, label: c2.label, bass: c2.bass }; });
      var text = L.chartFromWords(words, { title: hub.name || s.name, key: (d && d.key) || hub.key, chords: chords, bars: bars, sections: (hub.sections || []).map(function (q) { return { name: q.name, start: q.start }; }) });
      info("Sending the chart to the Central Pedal…");
      var up = await fetch(CU.api("/upload?kind=charts&code=" + encodeURIComponent(CU.prefs.code) + "&song=" + encodeURIComponent(hub.name || s.name) + "&name=" + encodeURIComponent((hub.name || s.name) + " (lyrics + chords).txt")), { method: "POST", body: text });
      if (!up.ok) throw new Error("the chart was not saved (" + up.status + ")");
      CU.send({ type: "songWords", code: CU.prefs.code, song: s.id, words: words.map(function (w) { return { text: w.text, start: w.start, end: w.end }; }) });
      info("✓ " + words.length + " words heard - the lyric chart is on the Central Pedal (" + text.split("\n").filter(function (l) { return l && !/^[{\[|]/.test(l); }).length + " lines)");
    } catch (e) { info("Not written: " + (e && e.message || e)); }
    busy = false; var b = $("#lyrListen"); if (b) b.disabled = false;
  }

  // ------------------------------------------------------------- Settings card (the speech model)
  function card() {
    if (!L.available() || !NAT || !NAT.asr) return "";
    var a = st || {}, models = a.models || [], cur = models.filter(function (m) { return m.key === a.model; })[0] || {}, dl = a.download;
    return '<section class="card"><h3>Lyrics from the vocal (speech model)</h3><p class="muted">Hears the words sung in a song\'s vocal track and writes the lyric chart with the chords (Lyrics tab → "Lyrics + chords from the vocal"). Runs on this computer - nothing goes to the internet after the one download.</p>' +
      '<table class="io-t"><tr><td>Model</td><td><select data-asr="model">' + models.map(function (m) { return '<option value="' + m.key + '"' + (m.key === a.model ? " selected" : "") + ">" + esc(m.label) + (m.downloaded ? " ✓" : "") + "</option>"; }).join("") + "</select></td></tr>" +
      '<tr><td>Language</td><td><select data-asr="language">' + LANGS.map(function (l) { return '<option value="' + l[0] + '"' + (l[0] === (a.language || "") ? " selected" : "") + ">" + l[1] + "</option>"; }).join("") + "</select></td></tr>" +
      "<tr><td>Status</td><td>" + (dl ? "downloading… " + Math.round((dl.got || 0) / 1048576) + (dl.total ? " / " + Math.round(dl.total / 1048576) : "") + " MB" : cur.downloaded ? "✓ ready" : "not downloaded") + (a.error ? ' <span class="warn">' + esc(a.error) + "</span>" : "") + "</td></tr></table>" +
      '<div class="row">' + (cur.downloaded ? '<button data-asr="remove">Remove this model</button>' : '<button data-asr="download"' + (dl ? " disabled" : "") + ">Download it now</button>") + "</div></section>";
  }
  async function refresh() { if (NAT && NAT.asr) { st = await NAT.asr.status(); if (window.CUSettings && CU.prefs.tab === "settings") window.CUSettings.render(); } }
  document.addEventListener("change", async function (e) {
    var k = e.target.dataset && e.target.dataset.asr; if (!k || !NAT || !NAT.asr) return;
    var patch = {}; patch[k] = e.target.value; st = await NAT.asr.config(patch); refresh();
  });
  document.addEventListener("click", async function (e) {
    var b = e.target.closest && e.target.closest("[data-asr]"); if (!b || b.tagName !== "BUTTON" || !NAT || !NAT.asr) return;
    if (b.dataset.asr === "download") { b.disabled = true; NAT.asr.download().then(refresh); setTimeout(refresh, 400); }
    else if (b.dataset.asr === "remove") { st = await NAT.asr.remove(); refresh(); }
  });
  if (NAT && NAT.asr) { refresh(); NAT.asr.on(function (m) { if (m.type === "download" && st) { st.download = { got: m.got, total: m.total }; } else refresh(); if (window.CUSettings && CU.prefs.tab === "settings") window.CUSettings.render(); }); }
  window.CULyricsListen = { card: card, run: run, vocalOf: vocalOf };
})();
