/* Central Control - the Parts screen: pick an instrument, read its part (chart, notation, tab, drums).
 * "Listen to every track" writes down what each track really plays (bass, keys, guitar, vocal, horns,
 * strings: notes; the drum track: kick / snare / hats / crash), so the parts come from the tracks;
 * songs without tracks get parts written from the chords. The parts go to Central Usage with the song. */
(function () {
  "use strict";
  var PP = window.PP, T = window.PPTracks, P = window.PPParts; if (!PP || !T || !P) return;
  var ui = { inst: "chords", view: null }, busy = false;
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function ctxNow() { var s = T.song(); if (!s) return null; var t = T.data(s); return P.contextOf(s, t, t.stems.length ? T.grid(s) : null, { chartText: t.chartText || "" }); }
  function dialog() {
    var d = $("#partsDialog"); if (d) return d;
    d = document.createElement("dialog"); d.id = "partsDialog"; d.className = "parts-dialog";
    var groups = {}; P.INSTRUMENTS.forEach(function (i) { (groups[i.group] = groups[i.group] || []).push(i); });
    d.innerHTML = '<div class="row spread"><div><h2>Parts</h2><p class="muted" id="ptInfo"></p></div><div class="se-row"><button class="primary" id="ptListen">♫ Listen to every track</button><button id="ptLyrics" hidden>✎ Lyrics + chords from the vocal</button><button data-close="partsDialog">Done</button></div></div>' +
      '<div class="pt-bar"><label>Instrument <select id="ptInst">' + Object.keys(groups).map(function (g) { return '<optgroup label="' + esc(g) + '">' + groups[g].map(function (i) { return '<option value="' + i.id + '">' + esc(i.name) + "</option>"; }).join("") + "</optgroup>"; }).join("") + '</select></label><nav class="tabs" id="ptViews"></nav><span class="muted small" id="ptStatus"></span></div>' +
      '<div class="pt-body" id="ptBody"></div>';
    document.body.appendChild(d);
    d.addEventListener("change", function (e) { if (e.target.id === "ptInst") { ui.inst = e.target.value; ui.view = null; paint(); } });
    d.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      if (b.dataset.view) { ui.view = b.dataset.view; paint(); }
      else if (b.id === "ptListen") listenAll();
      else if (b.id === "ptLyrics") lyricsFromVocal();
      else if (b.dataset.close) d.close();
    });
    return d;
  }
  function open(inst) {
    var s = T.song(); if (!s) { PP.setStatus("Pick a song first."); return; }
    var d = dialog(); if (inst) ui.inst = inst; $("#ptInst", d).value = ui.inst;
    if (!d.open) d.showModal(); paint();
  }
  function paint() {
    var d = $("#partsDialog"), s = T.song(); if (!d || !s) return;
    var ctx = ctxNow(), part = P.build(ctx, ui.inst), t = T.data(s);
    var heard = Object.keys(t.transcriptions || {}).length + (t.drums ? 1 : 0);
    $("#ptInfo", d).textContent = s.name + " · " + T.keyName(s.key) + " · " + Math.round(s.bpm) + " BPM · " + (t.stems.length ? t.stems.length + " tracks, " + heard + " listened to" : "no tracks: parts are written from the chords");
    $("#ptListen", d).hidden = !t.stems.length;
    $("#ptLyrics", d).hidden = !(LA && LA.available() && vocalStem(t));
    if (!part.views.length) part.views = ["chart"];
    var view = ui.view && part.views.indexOf(ui.view) >= 0 ? ui.view : part.views[0];
    $("#ptViews", d).innerHTML = part.views.length > 1 ? part.views.map(function (v) { return '<button class="tab' + (v === view ? " active" : "") + '" data-view="' + v + '">' + ({ chart: "Chart", notation: "Notation", tab: "Tab", drums: "Drum chart" }[v] || v) + "</button>"; }).join("") : "";
    var body = $("#ptBody", d); body.innerHTML = P.render(part, view, { ctx: ctx, width: Math.max(640, body.clientWidth - 24) });
  }
  // which job each track gets
  function jobFor(st) {
    if (st.bus === "click" || st.role === "guide" || st.role === "click") return null;
    var n = st.name || "";
    if (st.role === "drums" || /drum|kit|perc|\bdr\b/i.test(n)) return { cmd: "drums" };
    if (st.role === "bass" || /bass|\bbs\b/i.test(n)) return { cmd: "transcribe", opts: { mode: "mono", fmin: 30, fmax: 400, low: 24, high: 60 } };
    if (st.role === "vocals" || /vox|vocal|lead|bgv|choir|melody/i.test(n)) return { cmd: "transcribe", opts: { mode: "mono", fmin: 80, fmax: 1100 } };
    if (/key|piano|pno|organ|rhodes|wurli|synth|\bep\b|gtr|guitar|\beg\b|\bag\b|acoustic/i.test(n) || st.role === "keys" || st.role === "guitar") return { cmd: "transcribe", opts: { mode: "poly" } };
    if (/horn|brass|trumpet|sax|trombone|string|violin|cello|orch|flute|clarinet/i.test(n)) return { cmd: "transcribe", opts: { mode: "auto" } };
    return null;
  }
  async function listenAll() {
    var s = T.song(), t = s && T.data(s); if (!t || busy) return; busy = true;
    var status = $("#ptStatus"), btn = $("#ptListen"); btn.disabled = true;
    var todo = t.stems.filter(jobFor), done = 0;
    try {
      var g = T.grid(s), first = g.bars.length ? g.bars[0] : 0, base = { grid: { period: g.period, first: first }, beatsPerBar: g.bpb, division: 4 };
      for (var i = 0; i < todo.length; i++) {
        var st = todo[i], job = jobFor(st);
        status.textContent = "Listening to " + st.name + " (" + (i + 1) + " of " + todo.length + ")…";
        var rec = await T.getStem(st.id); if (!rec) continue;
        var L = new Int16Array(rec.L), R = rec.R ? new Int16Array(rec.R) : null, mono = new Float32Array(L.length), k = 1 / 32768;
        for (var j = 0; j < L.length; j++) mono[j] = (R ? (L[j] + R[j]) * .5 : L[j]) * k;
        var res = await T.workerJob(job.cmd, mono, PP.engine.context().sampleRate, Object.assign({}, base, job.opts || {}));
        if (job.cmd === "drums") t.drums = res;
        else { t.transcriptions = t.transcriptions || {}; t.transcriptions[st.id] = { mode: res.mode, notes: res.notes, lowest: res.lowest, highest: res.highest, division: 4, at: Date.now() }; }
        done++; PP.persistSoon(); paint();
      }
      status.textContent = done ? done + " track" + (done === 1 ? "" : "s") + " written down - the parts now come from the tracks" : "No tracks here that can be written down (click and guide are skipped).";
      if (window.PPHub) window.PPHub.push(false);
    } catch (error) { status.textContent = "Stopped: " + error.message; }
    busy = false; btn.disabled = false; paint();
  }
  // ------------------------------------------------------------- lyrics + chords from the vocal (on a PC: the speech model runs there)
  var LA = window.PPLyricsAI;
  function vocalStem(t) {
    var v = t.stems.filter(function (st) { return st.bus !== "click" && (st.role === "vocals" || /vox|vocal|lead|melody|\blv\b/i.test(st.name || "")); });
    v.sort(function (a, b) { return (/lead|\blv\b|melody/i.test(b.name) ? 1 : 0) - (/lead|\blv\b|melody/i.test(a.name) ? 1 : 0); });
    return v[0] || null;
  }
  async function lyricsFromVocal() {
    var s = T.song(), t = s && T.data(s); if (!t || busy || !LA || !LA.available()) return;
    var status = $("#ptStatus"), voc = vocalStem(t); if (!voc) { status.textContent = "This song has no vocal track (name one Vocal / Lead / Vox)."; return; }
    busy = true; $("#ptLyrics").disabled = true;
    try {
      var rec = await T.getStem(voc.id); if (!rec) throw new Error("the vocal audio is missing");
      var L = new Int16Array(rec.L), R = rec.R ? new Int16Array(rec.R) : null, mono = new Float32Array(L.length), k = 1 / 32768;
      for (var j = 0; j < L.length; j++) mono[j] = (R ? (L[j] + R[j]) * .5 : L[j]) * k;
      var words = await LA.listen(mono, PP.engine.context().sampleRate, function (m) { status.textContent = m + " (" + voc.name + ")"; });
      if (!words.length) throw new Error("no words heard in " + voc.name);
      var g = T.grid(s), barT = function (bar, beat) { var t0 = g.bars[bar - 1]; if (t0 == null) t0 = (g.bars[0] || 0) + (bar - 1) * g.bpb * g.period; return t0 + ((beat || 1) - 1) * g.period; };
      var chords = (t.chords || []).map(function (c) { return { start: c.start != null ? c.start : barT(c.bar, c.beat), label: c.label, bass: c.bass }; });
      var text = LA.chartFromWords(words, { title: s.name, key: s.key, chords: chords, sections: t.sections.map(function (q) { return { name: q.name, start: barT(q.bar, 1) }; }) });
      t.words = words; t.chartText = text;
      status.textContent = "Saving the chart…";
      var saved = null; try { saved = await (await fetch("http://127.0.0.1:8766/chart/text", { method: "POST", body: JSON.stringify({ name: s.name + " (lyrics + chords)", text: text }) })).json(); } catch (_) { saved = null; }
      if (saved && saved.id) { await T.refreshCharts(); await T.applyChart(s, saved); }
      PP.persistSoon(); T.render(); T.sendDisplay(); if (window.PPHub) window.PPHub.push(false);
      status.textContent = "✓ " + words.length + " words heard - the lyric chart (with the chords) is saved with the song";
    } catch (e) { status.textContent = "Not written: " + (e && e.message || e); }
    busy = false; $("#ptLyrics").disabled = false; paint();
  }
  // words heard by Central Usage for a song here
  if (window.PPFeatures) window.PPFeatures.on("songWords", function (m) {
    var song = (PP.project().songs || []).filter(function (x) { return x.id === m.song; })[0]; if (!song || !Array.isArray(m.words)) return;
    var t = T.data(song); t.words = m.words; PP.persistSoon(); if (window.PPHub) window.PPHub.push(false);
    PP.setStatus("Lyrics heard for \"" + song.name + "\" (" + m.words.length + " words) - the vocal part has its words now");
    if ($("#partsDialog") && $("#partsDialog").open) paint();
  });

  // a button in the song editor's "Charts & sheet music" section
  function wire() {
    var sec = $("#seSheetSection"); if (!sec || $("#seParts")) return;
    var row = sec.querySelector(".se-row"); if (!row) return;
    var b = document.createElement("button"); b.id = "seParts"; b.textContent = "♫ Parts for every instrument"; b.addEventListener("click", function () { open(); }); row.appendChild(b);
  }
  wire(); setTimeout(wire, 1500);
  window.PPPartsUI = { open: open, listenAll: listenAll, jobFor: jobFor, lyricsFromVocal: lyricsFromVocal, vocalStem: vocalStem };
})();
