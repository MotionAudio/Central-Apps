/* Central Pedal - the stem splitter. A song that only exists as one stereo file (a recording, an old backing track)
 * is split into stems on this computer and comes back as a song with tracks.
 *   Studio (the best): several vocal models vote on the vocals, Demucs FT takes the drums and bass and the 6-stem model
 *     the guitar, keys and the rest; then lead and backing vocals, the reverb off the vocals, and the drum kit piece
 *     by piece. Best: one vocal model + Demucs. Or Demucs alone (fastest).
 *   The clean-up pass: bleed taken out (every track re-made from the song, so they add up to it again), Perc (what
 *     is in the drums but not the kit), the kit as Drums or Cymbals, the silence trimmed, mono tracks written mono,
 *     silent tracks left out - and the drum hits (kick, snare, hi-hat, crash) found for the lights.
 *   MultiTracks-style names: Lead Vox, BGVs, Drums, Perc, Bass, Guitars, Keys, Synth & Pads (+ Click and Guide).
 *   Check before adding: play the tracks, solo and mute them, rename them, give them a role, merge some, split one
 *     again - then add them to the song.
 * Afterwards the tempo, key, beat grid and sections are found (js/structure.js), and a Click track and a Guide track
 * (the section names and the count) are made from them. The drum hits go to the lights (MIDI notes and Central
 * Control's timeline). Nothing is installed until you ask (Install: about 2.5 GB). Every setting is here. */
(function () {
  "use strict";
  var PP = window.PP, F = window.PPFeatures; if (!PP) return;
  var esc = PP.escapeHtml, MEDIA = "http://127.0.0.1:8766";
  function T() { return window.PPTracks; }
  function $(s, r) { return (r || document).querySelector(s); }
  function driverOn() { return !!(T() && T().driverOn()); }

  var MODELS = [["htdemucs", "4 stems: drums, bass, vocals, other (fast, good)"], ["htdemucs_6s", "6 stems: + guitar and piano"], ["htdemucs_ft", "4 stems, best quality (4× slower)"],
    ["hdemucs_mmi", "4 stems (older hybrid model)"], ["mdx_extra", "4 stems (MDX, trained on extra data)"], ["mdx_extra_q", "4 stems (MDX, smaller download)"]];
  // the stem keys (the driver's) -> names and roles
  var NICE = { lead_vocals: "Lead vocals", backing_vocals: "Backing vocals", vocals: "Vocals", vox_fx: "Vocal reverb", drums: "Drums", drum_kick: "Kick", drum_snare: "Snare", drum_toms: "Toms",
    drum_hh: "Hi-hat", drum_ride: "Ride", drum_crash: "Crash", drum_cymbals: "Cymbals", drum_perc: "Percussion", bass: "Bass", guitar: "Guitar", piano: "Piano", other: "Other",
    no_vocals: "Band (no vocals)", no_drums: "No drums", no_bass: "No bass", no_other: "Rest" };
  var MT = { lead_vocals: "Lead Vox", backing_vocals: "BGVs", vocals: "Vox", vox_fx: "Vox FX", drum_hh: "Hi-Hat", drum_perc: "Perc", guitar: "Guitars", piano: "Keys", other: "Synth & Pads", no_vocals: "Band" };
  var ROLE = { lead_vocals: "vocals", backing_vocals: "vocals", vocals: "vocals", vox_fx: "vocals", bass: "bass", guitar: "guitar", piano: "keys", other: "music" };
  function roleOf(k) { return ROLE[k] || (k === "drums" || /^drum_/.test(k) ? "drums" : "music"); }
  var ROLES = ["vocals", "drums", "bass", "guitar", "keys", "music", "click", "guide"];
  var DEFAULTS = { quality: "studio", vocalModel: "", ensemble: true, ensembleModels: "", ensembleAlgo: "avg_fft", bandModel: "htdemucs_ft", band6: true,
    leadBacking: true, drumParts: true, keepDrums: false, kit: "drums", dereverb: true, dereverbModel: "", keepReverb: true,
    sepSegment: "", sepOverlap: "", autocast: false,
    model: "htdemucs", twoStems: "", shifts: 1, overlap: 0.25, segment: "", device: "auto", format: "wav16", mp3Kbps: 320, clipMode: "rescale", jobs: 1,
    cleanup: true, bleed: 50, bleedSharp: 1, trim: true, mono: true, dropSilent: true, silentDb: -55, perc: true, trackSet: "multitracks", hits: true, hitSens: 1, review: true,
    into: "new", analyze: true, sections: true, clickTrack: true, clickSub: 1, clickLevel: 70, guideTrack: true, guideCount: true, clickOn: true, guideOn: true,
    keepOriginal: false, keepFiles: false, skip: [] };
  function cfg() {
    var p = PP.project(), c = p.stemSplit || (p.stemSplit = {});
    if (c.kit == null && c.quality != null) c.kit = "pieces";   // (set up before 8.9: the kit pieces stay apart, as they were)
    Object.keys(DEFAULTS).forEach(function (k) { if (c[k] == null) c[k] = Array.isArray(DEFAULTS[k]) ? [] : DEFAULTS[k]; });
    c.shifts = Math.max(0, Math.min(20, Math.round(Number(c.shifts) || 0)));
    c.overlap = Math.max(0, Math.min(0.95, Number(c.overlap) || 0));
    c.bleed = Math.max(0, Math.min(100, Number(c.bleed) || 0));
    c.bleedSharp = Math.max(0.5, Math.min(3, Number(c.bleedSharp) || 1));
    c.silentDb = Math.max(-90, Math.min(-20, Number(c.silentDb) || -55));
    c.hitSens = Math.max(0.25, Math.min(4, Number(c.hitSens) || 1));
    c.clickLevel = c.clickLevel === "" || !isFinite(Number(c.clickLevel)) ? 70 : Math.max(0, Math.min(100, Number(c.clickLevel)));
    return c;
  }
  var status = null, picked = null, current = null, dlg = null, pollTimer = 0, importing = false, msg = "", intoSong = null;   // (intoSong: Add a song → the whole song: this song, just this once)
  var review = null;   // { job, items: [{ id, key, name, role, keep, job, rel, blob, url, db, mono, silent, merge, sub }], subs: { jobId: itemId } }
  var player = { els: {}, playing: false, pos: 0, dur: 0, timer: 0, solo: {}, mute: {} };

  async function refresh() {
    if (!driverOn()) { status = null; draw(); return; }
    try { status = await (await fetch(MEDIA + "/split/status", { cache: "no-store" })).json(); } catch (_) { status = null; }
    if (status) status.jobs.forEach(function (j) { if ((current && j.id === current.id) || (review && review.subs[j.id])) onJob(j); });
    if (status && review) Object.keys(review.subs).forEach(function (id) {   // (a split again that is gone - the driver restarted)
      if (!status.jobs.some(function (j) { return j.id === id; }) && Date.now() - (review.subAt[id] || 0) > 8000) onSubJob({ id: id, state: "failed", error: "it stopped" });
    });
    draw();
  }
  function post(path, body) { return fetch(MEDIA + path, { method: "POST", body: JSON.stringify(body || {}) }).then(function (r) { return r.json(); }); }
  function poll(on) { clearInterval(pollTimer); if (on) pollTimer = setInterval(refresh, 2000); }
  if (F) {
    F.on("stemSplit", function (m) { if (m.job) onJob(m.job); });
    F.on("stemSplitStatus", function (m) { if (status) { status.install = m.install; status.installed = m.installed; if (m.separator != null) status.separator = m.separator; } draw(); });
  }
  function onJob(j) {
    if (review && review.subs[j.id]) return onSubJob(j);
    if (!current || j.id !== current.id) return;
    var was = current.state; j.songName = current.songName; j.intoSong = current.intoSong; j.target = current.target; current = j;
    if (j.state === "done" && was !== "done" && !importing && !review) { if (cfg().review) openReview(j); else bringIn(j, null); }
    if (j.state !== "running" && !subsRunning()) poll(false);
    draw();
  }

  // ---------------------------------------------------------------- running
  function targetSong(c) {   // where the tracks will go (decided when the split starts)
    var fixed = intoSong && PP.project().songs.filter(function (x) { return x.id === intoSong; })[0];
    return fixed || (c.into === "this" && PP.activeSong() ? PP.activeSong() : null);
  }
  function optsFor(c, target) {
    var sep = !!(status && status.separator), q = c.quality;
    if ((q === "studio" || q === "best") && !sep) q = "demucs";
    var hasStems = !!(target && T().data(target).stems.length);
    var ens = String(c.ensembleModels || "").split(/[\s,]+/).filter(Boolean);
    return { quality: q, vocalModel: c.vocalModel || "", ensemble: !!c.ensemble, ensembleModels: ens.length ? ens : undefined, ensembleAlgo: c.ensembleAlgo, bandModel: c.bandModel, band6Model: c.band6 ? "htdemucs_6s" : "",
      leadBacking: !!(c.leadBacking && sep), drumParts: !!(c.drumParts && sep), keepDrums: !!c.keepDrums, kit: c.kit, dereverb: !!(c.dereverb && sep), dereverbModel: c.dereverbModel || "", keepReverb: !!c.keepReverb,
      sepSegment: c.sepSegment ? Number(c.sepSegment) : 0, sepOverlap: c.sepOverlap ? Number(c.sepOverlap) : 0, autocast: !!c.autocast,
      model: c.model, twoStems: c.twoStems || "", shifts: c.shifts, overlap: c.overlap, segment: c.segment ? Number(c.segment) : 0, device: c.device, format: c.format === "wav16" ? "wav" : c.format, mp3Kbps: c.mp3Kbps, clipMode: c.clipMode, jobs: c.jobs,
      twoStems: q === "studio" ? "" : c.twoStems || "",   // (Studio always splits everything)
      cleanup: !!c.cleanup, bleed: c.bleed, bleedSharp: c.bleedSharp, trim: !!c.trim && !hasStems && !c.keepOriginal,   // (trimmed tracks wouldn't line up with tracks already there, or the original)
      mono: !!c.mono, dropSilent: !!c.dropSilent, silentDb: c.silentDb, perc: !!c.perc, trackSet: c.trackSet, hits: !!c.hits, hitSens: c.hitSens, review: !!c.review };
  }
  async function start() {
    var c = cfg();
    if (!picked) return say("Pick the song file first.", true);
    var path = picked.path, target = targetSong(c);
    try {
      if (!path) { say("Sending " + picked.name + "…"); var up = await (await fetch(MEDIA + "/split/upload?name=" + encodeURIComponent(picked.name), { method: "PUT", body: picked.file })).json(); if (up.error) throw new Error(up.error); path = up.path; }
      var j = await post("/split/start", { path: path, opts: optsFor(c, target) }); if (j.error) throw new Error(j.error);
      closeReview(); current = j; current.songName = picked.name.replace(/\.[^.]+$/, ""); current.intoSong = intoSong; current.target = target ? target.id : null; msg = ""; poll(true); draw();
    } catch (error) { say(error.message, true); }
  }
  function nameFor(key, c) { return c.trackSet === "multitracks" && MT[key] ? MT[key] : NICE[key] || key; }

  // ---------------------------------------------------------------- check before adding (the review)
  var nextId = 1;
  function itemOf(f, job) {
    var key = f.stem || f.name.replace(/\.[^.]+$/, "");
    return { id: "i" + (nextId++), key: key, name: f.name.replace(/\.[^.]+$/, ""), ext: f.name.split(".").pop(), role: f.role || roleOf(key), keep: !f.silent && cfg().skip.indexOf(key) < 0,
      job: job, rel: f.rel, db: f.db, mono: f.mono, silent: f.silent, merge: false, sub: null };
  }
  function openReview(j) {
    review = { job: j, items: j.files.map(function (f) { return itemOf(f, j.id); }), subs: {}, subAt: {}, jobIds: [j.id], hits: j.hits || {} };
    stopPlayer(); player = { els: {}, playing: false, pos: 0, dur: 0, timer: 0, solo: {}, mute: {} };
    say(j.files.length + " tracks - listen, fix and add them" + (j.notes && j.notes.length ? " · " + j.notes.join(" ") : ""));
  }
  function closeReview() { stopPlayer(); if (review) review.items.forEach(function (it) { if (it.url) URL.revokeObjectURL(it.url); }); review = null; }
  function urlOf(it) { return it.blob ? (it.url || (it.url = URL.createObjectURL(it.blob))) : MEDIA + "/split/file?id=" + encodeURIComponent(it.job) + "&rel=" + encodeURIComponent(it.rel); }
  function subsRunning() { return !!(review && review.items.some(function (it) { return it.sub && it.sub.state === "running"; })); }
  function onSubJob(j) {
    var it = review.items.filter(function (x) { return x.id === review.subs[j.id]; })[0]; if (!it) return;
    var was = it.sub && it.sub.state; it.sub = j;
    if (j.state !== "running") delete review.subs[j.id];   // (seen once: never added twice)
    if (j.state === "done" && was !== "done") {   // the new tracks come in under it; it stays (unticked) in case you want it back
      var at = review.items.indexOf(it), add = j.files.map(function (f) { var n = itemOf(f, j.id); n.name = it.name + " · " + n.name; return n; });
      review.items.splice.apply(review.items, [at + 1, 0].concat(add)); it.keep = false; it.sub = null; stopPlayer();
      if (j.hits && j.hits.kick && j.hits.kick.length && it.role === "drums") review.hits = j.hits;   // (the kit pieces find the hits better)
      say("✓ " + it.name + " split into " + add.length + " tracks");
    } else if (j.state !== "running") { it.sub = null; say("Splitting " + it.name + " again " + (j.state === "cancelled" ? "was stopped" : "failed: " + (j.error || "")), true); }
    if (!subsRunning() && !(current && current.state === "running")) poll(false);
    draw();
  }
  function againWays(it) {   // what a track can be split into again
    if (it.blob) return [];
    var w = [];
    if (it.role === "vocals") w.push(["lead", "Lead and backing"], ["dereverb", "Reverb off"]);
    if (it.role === "drums") w.push(["drums", "Kit pieces"]);
    if (/^(music|keys|guitar)$/.test(it.role)) w.push(["band6", "Guitar, keys and the rest"]);
    if (it.role !== "vocals") w.push(["vocals", "Take the vocals out"]);
    return w;
  }
  async function splitAgain(it, kind) {
    try {
      var j = await post("/split/resplit", { id: it.job, rel: it.rel, kind: kind }); if (j.error) throw new Error(j.error);
      review.subs[j.id] = it.id; review.subAt[j.id] = Date.now(); review.jobIds.push(j.id); it.sub = j; poll(true); draw();
    } catch (error) { say("Can't split it again: " + error.message, true); }
  }
  async function mergeTicked() {
    var list = review.items.filter(function (it) { return it.merge; }); if (list.length < 2) return say("Tick two or more tracks to merge.", true);
    var ctx = PP.engine.ctx, L = null, R = null, rate = 0;
    say("Merging " + list.length + " tracks…");
    try {
      for (var i = 0; i < list.length; i++) {
        var ab = await (list[i].blob ? list[i].blob.arrayBuffer() : (await fetch(urlOf(list[i]))).arrayBuffer()), b = await ctx.decodeAudioData(ab);
        if (!L) { rate = b.sampleRate; L = new Float32Array(b.length); R = new Float32Array(b.length); }
        if (b.length > L.length) { var L2 = new Float32Array(b.length), R2 = new Float32Array(b.length); L2.set(L); R2.set(R); L = L2; R = R2; }
        var l = b.getChannelData(0), r = b.numberOfChannels > 1 ? b.getChannelData(1) : l;
        for (var k = 0; k < b.length; k++) { L[k] += l[k]; R[k] += r[k]; }
      }
      var peak = 0; for (var q = 0; q < L.length; q++) peak = Math.max(peak, Math.abs(L[q]), Math.abs(R[q]));
      if (peak > 0.999) { var g = 0.999 / peak; for (var z = 0; z < L.length; z++) { L[z] *= g; R[z] *= g; } }   // (never clipped)
      var bits = cfg().format === "wav16" || cfg().format === "mp3" ? 16 : 24;
      var blob = new Blob([window.PPPractice.encodeWav(L, R, rate, bits)], { type: "audio/wav" });
      var first = list[0], it = { id: "i" + (nextId++), key: "merged", name: list.map(function (x) { return x.name; }).join(" + ").slice(0, 60), ext: "wav", role: first.role, keep: true, job: null, rel: null, blob: blob, merge: false, sub: null };
      review.items.splice(review.items.indexOf(first), 0, it);
      list.forEach(function (x) { x.keep = false; x.merge = false; });
      stopPlayer(); say("✓ Merged into “" + it.name + "” (rename it below)");
    } catch (error) { say("Merging failed: " + error.message, true); }
  }
  // the preview: one <audio> per track, kept in step (light on memory: nothing is decoded)
  function audible(it) { var anySolo = Object.keys(player.solo).some(function (k) { return player.solo[k]; }); return it.keep !== false && !player.mute[it.id] && (!anySolo || player.solo[it.id]); }
  function syncEls() {
    review.items.forEach(function (it) {
      var el = player.els[it.id];
      if (!el) { el = player.els[it.id] = new Audio(); el.preload = "auto"; el.src = urlOf(it); el.addEventListener("loadedmetadata", function () { player.dur = Math.max(player.dur, el.duration || 0); drawTransport(); }); }
      el.muted = !audible(it);
    });
  }
  function master() { var it = review && review.items.filter(function (x) { return player.els[x.id] && !player.els[x.id].paused; })[0]; return it ? player.els[it.id] : null; }
  function playPreview() {
    if (!review) return; syncEls(); player.playing = true;
    review.items.forEach(function (it) { var el = player.els[it.id]; try { el.currentTime = player.pos; } catch (_) { } var p = el.play(); if (p && p.catch) p.catch(function () { }); });
    clearInterval(player.timer);
    player.timer = setInterval(function () {   // keep them together (and the clock moving)
      var m = master(); if (!m) return; player.pos = m.currentTime;
      review.items.forEach(function (it) { var el = player.els[it.id]; if (el && el !== m && !el.paused && Math.abs(el.currentTime - m.currentTime) > 0.04) el.currentTime = m.currentTime; });
      if (m.ended) stopPlayer(); drawTransport();
    }, 250);
    drawTransport();
  }
  function pausePreview() { player.playing = false; clearInterval(player.timer); Object.keys(player.els).forEach(function (k) { player.els[k].pause(); }); drawTransport(); }
  function stopPlayer() { clearInterval(player.timer); Object.keys(player.els || {}).forEach(function (k) { var el = player.els[k]; el.pause(); el.removeAttribute("src"); try { el.load(); } catch (_) { } }); player.els = {}; player.playing = false; }
  function seek(t) { player.pos = Math.max(0, t); Object.keys(player.els).forEach(function (k) { try { player.els[k].currentTime = player.pos; } catch (_) { } }); drawTransport(); }
  function drawTransport() { var tm = dlg && dlg.querySelector("[data-rv-time]"), sk = dlg && dlg.querySelector('[data-rv="seek"]'), b = dlg && dlg.querySelector('[data-rv="play"]'); if (tm) tm.textContent = T().fmtTime(player.pos) + " / " + T().fmtTime(player.dur); if (sk && document.activeElement !== sk) { sk.max = Math.max(1, player.dur); sk.value = player.pos; } if (b) b.textContent = player.playing ? "❚❚ Pause" : "▶ Play"; }

  // ---------------------------------------------------------------- bringing the tracks in
  async function bringIn(j, items) {
    var c = cfg(); importing = true; stopPlayer(); draw();
    var jobs = {}; jobs[j.id] = 1; if (review) review.jobIds.forEach(function (id) { jobs[id] = 1; });
    try {
      if (!items) items = j.files.map(function (f) { return itemOf(f, j.id); }).filter(function (it) { return it.keep; });
      var files = [];
      for (var i = 0; i < items.length; i++) {
        var it = items[i], blob = it.blob || await (await fetch(urlOf(it))).blob();
        if (it.job) jobs[it.job] = 1;
        var file = new File([blob], (it.name || "Track") + "." + (it.ext || "wav"), { type: blob.type || "audio/*" }); file._role = it.role || "music";
        files.push(file);
      }
      if (c.keepOriginal && picked && picked.file) { var o = new File([picked.file], "Original mix." + (picked.name.split(".").pop() || "wav")); o._role = "music"; o._mute = true; files.push(o); }
      if (!files.length) throw new Error("no tracks to add");
      var name = (current && current.songName) || "Split song", fixed = current && current.target && PP.project().songs.filter(function (x) { return x.id === current.target; })[0];
      var s = fixed || T().newSong(name), t0 = T().data(s), hadStems = t0.stems.length > 0;
      if (c.analyze && c.sections && !hadStems) t0.sections = [];   // (found from the new stems: vocals, harmony, loudness)
      await T().importFilesIntoSong(s, files, { analyze: c.analyze, sections: !!c.sections });
      var t = T().data(s), made = [];
      // the drum hits for the lights (kick, snare, hi-hat, crash), from the kit pieces
      var hits = (review && review.hits) || j.hits || {};
      if (c.hits && Object.keys(hits).some(function (k) { return hits[k] && hits[k].length; })) t.drumHits = { kick: hits.kick || [], snare: hits.snare || [], hat: hits.hat || [], crash: hits.crash || [] };
      // a Click track and a Guide track, made from the beat grid and the sections (they go to the click out, like MultiTracks')
      if (c.analyze && !hadStems && (c.clickTrack || c.guideTrack)) {
        var extra = [];
        if (c.clickTrack) { PP.setStatus("Making the click track…"); extra.push(clickTrack(s, c)); }
        if (c.guideTrack) { PP.setStatus("Making the guide track…"); var gt = await guideTrack(s, c); if (gt) extra.push(gt); }
        if (extra.length) { await T().importFilesIntoSong(s, extra, { analyze: false }); made = extra.map(function (f) { return f.name.replace(/\.[^.]+$/, ""); }); }
      }
      t = T().data(s);
      if (c.clickTrack && made.indexOf("Click") >= 0) t.click.on = false; else if (c.clickOn) t.click.on = true;   // (the click track plays it; the live click is still a tap away)
      if (c.guideTrack && made.indexOf("Guide") >= 0) t.cues.on = false;
      else if (c.guideOn) { t.cues.on = true; t.cues.countVoice = true; t.sections.forEach(function (sec) { if (!sec.cue || sec.cue === "none") sec.cue = "auto"; }); }   // spoken section names + count-in
      if (T().song() && T().song().id === s.id) T().pushAll(s);
      PP.persistSoon(); T().render(); T().sendDisplay();
      if (!c.keepFiles) Object.keys(jobs).forEach(function (id) { post("/split/forget", { id: id }).catch(function () { }); });
      var dh = t.drumHits ? Object.keys(t.drumHits).reduce(function (a, k) { return a + t.drumHits[k].length; }, 0) : 0;
      closeReview();
      say("✓ " + (files.length + made.length) + " tracks added to “" + s.name + "”" + (c.analyze ? " · " + t.sections.length + " sections" + (t.grid && t.grid.bpm ? " · " + Math.round(t.grid.bpm) + " BPM" : "") : "") + (dh ? " · " + dh + " drum hits for the lights" : ""));
    } catch (error) { say("Bringing the tracks in failed: " + error.message, true); }
    importing = false; draw();
  }
  function blip(rate, f, ms, level) { var n = Math.round(rate * ms / 1000), b = new Float32Array(n); for (var i = 0; i < n; i++) { var u = i / rate; b[i] = Math.sin(2 * Math.PI * f * u) * Math.exp(-u / (ms / 4000)) * level; } return b; }
  function mixIn(L, at, buf) { var s = Math.round(at); for (var i = 0; i < buf.length; i++) { var k = s + i; if (k >= 0 && k < L.length) L[k] += buf[i]; } }
  function clickTrack(s, c) {
    var t = T().data(s), g = T().grid(s), rate = PP.engine.ctx.sampleRate, n = Math.ceil((t.duration || 1) * rate), L = new Float32Array(n), lv = c.clickLevel / 100;
    var hi = blip(rate, 1760, 45, 0.9 * lv), lo = blip(rate, 1175, 40, 0.7 * lv), sub = blip(rate, 1175, 25, 0.35 * lv), per = Math.max(1, Math.min(4, Number(c.clickSub) || 1));
    for (var i = 0; i < g.times.length; i++) {
      var tm = g.times[i]; if (tm < 0 || tm >= t.duration) continue;
      mixIn(L, tm * rate, g.down[i] ? hi : lo);
      var next = g.times[i + 1]; if (per > 1 && next) for (var k = 1; k < per; k++) mixIn(L, (tm + (next - tm) * k / per) * rate, sub);
    }
    var f = new File([window.PPPractice.encodeWav(L, null, rate, 16)], "Click.wav", { type: "audio/wav" }); f._role = "click"; return f;
  }
  async function guideTrack(s, c) {
    var t = T().data(s), g = T().grid(s), secs = T().sectionsOf(s), rate = PP.engine.ctx.sampleRate, n = Math.ceil((t.duration || 1) * rate), L = new Float32Array(n), any = false;
    var lead = Math.max(0, Math.min(4, t.cues.leadBars == null ? 1 : t.cues.leadBars));
    if (T().loadCueList) await T().loadCueList();
    function barTime(b) { return g.bars && g.bars.length ? (b >= 0 && b < g.bars.length ? g.bars[b] : null) : (b * 60 / (s.bpm || 120) * (g.bpb || 4)); }
    for (var i = 0; i < secs.length; i++) {
      var id = T().cueIdFor(secs[i].sec); if (!id) continue;
      var buf = await T().cueBuffer(id); if (!buf) continue;
      var bar = T().timeToBar(s, secs[i].start).bar - 1, at = barTime(bar - lead); if (at == null) at = secs[i].start - lead * 60 / (s.bpm || 120) * (g.bpb || 4);
      if (at < 0) { if (secs[i].start < 0.3) continue; at = Math.max(0, secs[i].start - buf.length / rate - 0.1); }   // (no bar before it: just before it starts)
      mixIn(L, at * rate, buf); any = true;
    }
    if (c.guideCount && secs.length) {   // "1, 2, 3, 4" in the bar before the song comes in
      var b0 = T().timeToBar(s, secs[0].start).bar - 1, from = barTime(b0 - 1), barLen = 60 / (s.bpm || 120) * (g.bpb || 4);
      if (from == null && secs[0].start >= barLen * 0.9) from = secs[0].start - barLen;
      if (from != null && from >= 0) for (var k = 0; k < (g.bpb || 4); k++) { var w = await T().cueBuffer(String(k + 1)), bt = from + k * (secs[0].start - from) / (g.bpb || 4); if (w) { mixIn(L, bt * rate, w); any = true; } }
    }
    if (!any) return null;
    var f = new File([window.PPPractice.encodeWav(L, null, rate, 16)], "Guide.wav", { type: "audio/wav" }); f._role = "guide"; return f;
  }
  function say(m, bad) { msg = (bad ? "⚠ " : "") + m; PP.setStatus(m); draw(); }

  // ---------------------------------------------------------------- the dialog
  function opt(v, label, cur) { return '<option value="' + esc(String(v)) + '"' + (String(cur) === String(v) ? " selected" : "") + ">" + esc(label) + "</option>"; }
  function sel(key, cur, opts) { return '<select data-ss="' + key + '">' + opts.map(function (o) { return opt(o[0], o[1], cur); }).join("") + "</select>"; }
  function num(key, v, min, max, step, ph) { return '<input type="number" data-ss="' + key + '" value="' + esc(String(v)) + '" min="' + min + '" max="' + max + '" step="' + (step || 1) + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : "") + ">"; }
  function chk(key, v, label) { return '<label class="toggle"><input type="checkbox" data-ss="' + key + '"' + (v ? " checked" : "") + "> " + label + "</label>"; }
  // what comes back, for the Keep ticks (the same plan as the driver's)
  function stemsOf(c) {
    var sep = status && status.separator, q = (c.quality === "studio" || c.quality === "best") && sep ? c.quality : "demucs", clean = c.cleanup && status && status.cleanup;
    if (c.twoStems && !(q !== "demucs" && c.twoStems === "vocals")) return [c.twoStems, "no_" + c.twoStems];
    var out = [];
    if (c.leadBacking && sep) out.push("lead_vocals", "backing_vocals"); else out.push("vocals");
    if (c.dereverb && c.keepReverb && sep && q !== "demucs") out.push("vox_fx");
    if (c.twoStems === "vocals") return out.concat(["no_vocals"]);
    if (c.drumParts && sep) {
      if (clean && c.kit === "drums") out.push("drums");
      else { if (c.keepDrums) out.push("drums"); out.push("drum_kick", "drum_snare", "drum_toms"); if (clean && c.kit === "cymbals") out.push("drum_cymbals"); else out.push("drum_hh", "drum_ride", "drum_crash"); }
      if (clean && c.perc) out.push("drum_perc");
    } else out.push("drums");
    out.push("bass"); if ((q === "studio" && c.band6) || (q !== "studio" && c.model === "htdemucs_6s")) out.push("guitar", "piano"); out.push("other");
    return out;
  }
  function stemName(k) { return nameFor(k, cfg()); }
  function eta(sec) { if (sec == null) return ""; sec = Math.max(0, Math.round(sec)); return sec >= 60 ? Math.floor(sec / 60) + " min " + (sec % 60) + " s left" : sec + " s left"; }

  function reviewHtml() {
    var c = cfg(), r = review, kept = r.items.filter(function (it) { return it.keep; }).length;
    var h = '<section class="ss-review"><h3>Check the tracks before adding them</h3>' +
      '<p class="muted small">Listen, solo and mute, rename them, give each its role, merge some, or split one again. Silent tracks are unticked.' + (r.job.notes && r.job.notes.length ? " " + esc(r.job.notes.join(" ")) : "") + "</p>" +
      '<div class="ss-transport"><button type="button" data-rv="play">' + (player.playing ? "❚❚ Pause" : "▶ Play") + '</button><button type="button" data-rv="rewind" title="Back to the start">⏮</button>' +
      '<input type="range" data-rv="seek" min="0" max="' + Math.max(1, player.dur) + '" step="0.1" value="' + player.pos + '"><span data-rv-time class="small">' + T().fmtTime(player.pos) + " / " + T().fmtTime(player.dur) + "</span></div>" +
      '<div class="ss-tracks"><div class="ss-tr head small muted"><span>Keep</span><span>Name</span><span>Role</span><span>Listen</span><span>Level</span><span>Merge</span><span>Split again</span></div>';
    r.items.forEach(function (it) {
      var ways = againWays(it);
      h += '<div class="ss-tr' + (it.keep ? "" : " off") + '" data-rv-item="' + it.id + '">' +
        '<input type="checkbox" data-rvf="keep" title="Add this track"' + (it.keep ? " checked" : "") + ">" +
        '<input data-rvf="name" value="' + esc(it.name) + '">' +
        '<select data-rvf="role">' + ROLES.map(function (x) { return opt(x, x, it.role); }).join("") + "</select>" +
        '<span class="ss-sm"><button type="button" data-rvb="solo" class="' + (player.solo[it.id] ? "on" : "") + '" title="Solo">S</button><button type="button" data-rvb="mute" class="' + (player.mute[it.id] ? "on" : "") + '" title="Mute">M</button></span>' +
        '<span class="small">' + (it.db != null ? Math.round(it.db) + " dB" : "") + (it.mono ? ' <span class="ss-tag">mono</span>' : "") + (it.silent ? ' <span class="ss-tag warn">silent</span>' : "") + (it.blob ? ' <span class="ss-tag">merged</span>' : "") + "</span>" +
        '<input type="checkbox" data-rvf="merge" title="Tick two or more, then Merge"' + (it.merge ? " checked" : "") + ">" +
        (it.sub ? '<span class="small">' + esc(it.sub.step || "splitting") + "… " + Math.round((it.sub.progress || 0) * 100) + "%</span>"
          : ways.length ? '<select data-rvf="again"><option value="">-</option>' + ways.map(function (w) { return opt(w[0], w[1], ""); }).join("") + "</select>" : "<span></span>") + "</div>";
    });
    h += '</div><div class="row"><button type="button" data-rv="merge">Merge the ticked tracks</button><span class="muted small">' + kept + " of " + r.items.length + " tracks ticked" +
      (r.hits && r.hits.kick ? " · drum hits for the lights: " + ["kick", "snare", "hat", "crash"].map(function (k) { return (r.hits[k] || []).length + " " + (k === "hat" ? "hi-hat" : k); }).join(", ") : "") + "</span></div></section>";
    return h;
  }

  function html() {
    var c = cfg(), st = status, h = '<form method="dialog" class="ss"><header><h2>✂ Stem splitter</h2><button value="close" class="ghost" aria-label="Close">✕</button></header>';
    if (review) {
      var fs = current && current.target && PP.project().songs.filter(function (x) { return x.id === current.target; })[0];
      return h + reviewHtml() + '<p class="pm-msg' + (/^⚠/.test(msg) ? " bad" : "") + '">' + esc(msg) + "</p><footer>" +
        '<button type="button" class="ghost" data-rv="discard">Throw them away</button><button type="button" class="primary" data-rv="add"' + (importing || subsRunning() ? " disabled" : "") + ">" +
        (importing ? "Adding…" : "Add " + review.items.filter(function (it) { return it.keep; }).length + " tracks to " + (fs ? "“" + esc(fs.name) + "”" : "a new song")) + "</button></footer></form>";
    }
    h += '<p class="muted small">Split a song that is one stereo file into the tracks a band plays with - Lead Vox, BGVs, Drums, Perc, Bass, Guitars, Keys, Synth & Pads, plus a Click and a Guide - on this computer. Check them, then add them as a song with sections, and with the drum hits for the lights.</p>';
    if (!driverOn()) return h + '<p class="bad">The stem splitter runs in Central Pedal Control on a Mac, Windows or Linux computer, in Central Control, or on a Central Pedal - not on a phone or tablet.</p><footer><button value="close">Close</button></footer></form>';
    if (!st) return h + "<p>…</p></form>";
    if (st.slow) h += '<p class="warn small">On a Central Pedal this is slow (often 20-40 minutes a song, longer in Studio' + (st.memoryGb && st.memoryGb < 3.5 ? ", and this one has only " + st.memoryGb + " GB of memory - 4 GB or more is needed" : "") + "). A Mac with Central Pedal Control does it in a few minutes." +
      (c.quality === "studio" && (!st.memoryGb || st.memoryGb < 7.5) ? " Studio with the kit pieces can need more memory than a 4 GB Central Pedal has - pick Best here, or split on a computer." : "") + "</p>";
    // install
    var ins = st.install || {};
    h += "<section><h3>On this computer</h3>";
    if (st.installed) h += "<p>✓ Installed" + (st.custom ? " (your own command)" : "") + ": Demucs" + (st.separator ? " and the best-quality models (RoFormer, MDX23C, DrumSep, de-reverb)" : "") + ". Each model downloads the first time it is used.</p>" +
      (!st.separator && !st.custom ? '<p class="warn small">' + esc(ins.warning || "The best-quality models aren't installed.") + ' <button type="button" data-ss-act="install">Install them</button></p>' : "");
    else if (ins.running) h += "<p>Installing - " + esc(ins.step || "") + "…</p>";
    else h += "<p>Not installed yet. Install downloads uv, a private Python, PyTorch, Demucs and the best-quality models' runner (audio-separator) into this app's own folder (about 2.5 GB; nothing else on the computer changes)." + (ins.error ? '</p><p class="bad small">Last try failed: ' + esc(ins.error) : "") + "</p>";
    h += '<div class="row">' + (!st.installed && !ins.running ? '<button type="button" class="primary" data-ss-act="install">Install</button>' : "") + ((st.installed || st.partial) && !st.custom && !ins.running ? '<button type="button" class="ghost" data-ss-act="uninstall">' + (st.installed ? "Remove it" : "Clear the failed install") + "</button>" : "") + "</div>";
    if (ins.log && (ins.running || ins.error)) h += '<pre class="ss-log">' + esc(ins.log.slice(-1200)) + "</pre>";
    h += '<details><summary>Advanced</summary><div class="ss-grid"><label>Python version <input data-ss-cfg="python" value="' + esc(st.settings.python || "3.11") + '"></label>' +
      '<label>Packages (blank: the usual) <input data-ss-cfg="packages" value="' + esc(st.settings.packages || "") + '" placeholder="torch torchaudio demucs soundfile"></label>' +
      '</div><p class="muted small">Your own Demucs instead: start the app with CC_DEMUCS_CMD set to its command.</p></details></section>';
    // the song
    var s = PP.activeSong(), t = s && T().data(s), one = t && t.stems.length === 1 && t.stems[0].file ? t.stems[0] : null;
    h += "<section><h3>The song</h3>" +
      '<label class="ss-file">Song file (WAV, MP3, FLAC, M4A…) <input type="file" accept="audio/*,.wav,.mp3,.flac,.m4a,.aif,.aiff,.ogg" data-ss-file></label>' +
      (one ? '<button type="button" data-ss-act="usesong">Use “' + esc(s.name) + '”’s track (' + esc(one.name) + ")</button>" : "") +
      (picked ? '<p>Picked: <b>' + esc(picked.name) + "</b></p>" : "") + "</section>";
    // how to split
    var sepOk = !!st.separator, vm = (st.sepModels && st.sepModels.vocals) || [], dm = (st.sepModels && st.sepModels.dereverb) || [], q = sepOk ? c.quality : "demucs", hq = q === "studio" || q === "best";
    h += '<section><h3>How to split</h3><div class="ss-grid">' +
      "<label>Quality" + sel("quality", q, [["studio", "Studio: vocal models together + Demucs FT and 6-stem (best, slowest)" + (sepOk ? "" : " - install the models")], ["best", "Best: one RoFormer vocal model + Demucs"], ["demucs", "Demucs only (fastest)"]]) + "</label>" +
      (hq ? "<label>Vocal model" + sel("vocalModel", c.vocalModel || (vm[0] && vm[0][0]) || "", vm) + "</label>" : "") +
      (q === "studio" ? "<label>Band model (drums, bass)" + sel("bandModel", c.bandModel, MODELS) + "</label>" : "<label>" + (hq ? "Band model (Demucs)" : "Model") + sel("model", c.model, MODELS) + "</label>") +
      (q !== "studio" ? "<label>Stems" + sel("twoStems", c.twoStems, [["", "All of them"], ["vocals", "Just vocals / no vocals"], ["drums", "Just drums / no drums"], ["bass", "Just bass / no bass"], ["other", "Just other / the rest"]]) + "</label>" : "") +
      '<label title="More = cleaner, slower (each one is a whole extra pass). Studio uses at least 2.">Shifts (passes)' + num("shifts", c.shifts, 0, 20) + "</label>" +
      '<label title="How much the chunks overlap">Overlap' + num("overlap", c.overlap, 0, 0.95, 0.05) + "</label>" +
      '<label title="Seconds per chunk - lower uses less memory (htdemucs: 7.8 max)">Segment (s)' + num("segment", c.segment, 1, 60, 0.1, "model default") + "</label>" +
      "<label>Run on" + sel("device", c.device, [["auto", "The fastest here"]].concat(((st.devices) || ["cpu"]).map(function (d) { return [d, d === "cpu" ? "CPU" : d === "mps" ? "Apple GPU (Metal)" : "NVIDIA GPU (CUDA)"]; }))) + "</label>" +
      '<label title="Several at once - faster, more memory">Parallel jobs' + num("jobs", c.jobs, 1, 16) + "</label>" +
      "<label>File format" + sel("format", c.format, [["wav16", "WAV 16-bit"], ["wav24", "WAV 24-bit"], ["float", "WAV 32-bit float"], ["flac", "FLAC"], ["mp3", "MP3"]]) + "</label>" +
      (c.format === "mp3" ? "<label>MP3 kbps" + num("mp3Kbps", c.mp3Kbps, 96, 320, 32) + "</label>" : "") +
      "<label>When it would clip" + sel("clipMode", c.clipMode, [["rescale", "Turn the stem down"], ["clamp", "Clip it"]]) + "</label></div>" +
      (q === "studio" ? '<div class="ss-more"><b>Studio</b>' + chk("ensemble", c.ensemble, "Several vocal models vote on the vocals (cleaner, fuller - and slower)") +
        (c.ensemble ? '<div class="ss-grid"><label title="Model files, separated by commas (blank: Mel-Band RoFormer Kim)">Models that vote with it<input data-ss="ensembleModels" value="' + esc(c.ensembleModels) + '" placeholder="mel_band_roformer_kim_ft_unwa.ckpt"></label>' +
          "<label>How they vote" + sel("ensembleAlgo", c.ensembleAlgo, ((st.ensembleAlgos) || ["avg_fft"]).map(function (a) { return [a, { avg_fft: "Average (spectrum) - balanced", avg_wave: "Average (wave)", median_fft: "Median (spectrum) - fewer artefacts", median_wave: "Median (wave)", max_fft: "Loudest (fuller, more bleed)", min_fft: "Quietest (cleaner, thinner)", uvr_max_spec: "UVR max spec", uvr_min_spec: "UVR min spec" }[a] || a]; })) + "</label></div>" : "") +
        chk("band6", c.band6, "Guitar, keys and the rest from the 6-stem model (else one “other” track)") + "</div>" : "") +
      '<div class="ss-more"><b>Split further</b>' + (sepOk ? "" : ' <span class="muted small">(needs the best-quality models)</span>') +
      chk("leadBacking", c.leadBacking && sepOk, "Vocals into <b>lead</b> and <b>backing</b> vocals (Lead Vox, BGVs)") +
      (hq ? chk("dereverb", c.dereverb && sepOk, "Take the <b>reverb and echo</b> off the " + (c.leadBacking ? "lead " : "") + "vocal") + (c.dereverb && sepOk ? '<div class="ss-grid">' + (dm.length ? "<label>De-reverb model" + sel("dereverbModel", c.dereverbModel || dm[0][0], dm) + "</label>" : "") + "</div>" + chk("keepReverb", c.keepReverb, "Keep the reverb as its own track (Vox FX)") : "") : "") +
      chk("drumParts", c.drumParts && sepOk, "Drums into <b>kick, snare, toms, hi-hat, ride and crash</b> - and the drum hits for the lights") +
      (c.drumParts && sepOk ? '<div class="ss-grid"><label>The kit as' + sel("kit", c.kit, [["drums", "Drums + Perc (MultiTracks style)"], ["cymbals", "Kick, Snare, Toms, Cymbals + Perc"], ["pieces", "Every piece on its own"]]) + "</label></div>" + (c.kit !== "drums" ? chk("keepDrums", c.keepDrums, "Keep the whole drum track too") : "") : "") + "</div>" +
      (sepOk ? '<details><summary class="small">Best-quality model settings</summary><div class="ss-grid">' +
        '<label title="Bigger = better and slower, more memory (RoFormer / MDX23C)">Segment size' + num("sepSegment", c.sepSegment, 32, 4096, 32, "model default") + "</label>" +
        '<label title="Higher = smoother, slower">Overlap' + num("sepOverlap", c.sepOverlap, 2, 50, 1, "model default") + "</label>" +
        chk("autocast", c.autocast, "Faster on a GPU (half precision)") + "</div></details>" : "") + "</section>";
    // the clean-up
    h += '<section><h3>Clean-up</h3>' + chk("cleanup", c.cleanup, "Clean the tracks up after the split" + (st.cleanup ? "" : ' <span class="muted small">(after Install)</span>')) +
      (c.cleanup ? '<div class="ss-grid">' +
        '<label title="Each track is re-made from the song by how much of each sound it owns - the guitar in the vocals goes back to the guitar, and the tracks add up to the song again">Bleed removal (%)' + num("bleed", c.bleed, 0, 100, 5) + "</label>" +
        "<label>Strength" + sel("bleedSharp", c.bleedSharp, [[0.75, "Gentle"], [1, "Normal"], [1.5, "Strong"], [2, "Strongest (can sound watery)"]]) + "</label>" +
        '<label title="Tracks quieter than this are silent">Silent below (dB)' + num("silentDb", c.silentDb, -90, -20, 1) + "</label>" +
        '<label title="Higher finds softer hits">Drum hit sensitivity' + num("hitSens", c.hitSens, 0.25, 4, 0.25) + "</label></div>" +
        chk("trim", c.trim, "Trim the silence at the start and end (every track the same; not when adding to a song that has tracks)") +
        chk("mono", c.mono, "Mono tracks (bass, kick…) as mono files") + chk("perc", c.perc, "A Perc track: what is in the drums but isn't the kit (shakers, tambourine…)") +
        chk("dropSilent", c.dropSilent, "Leave silent tracks out") + chk("hits", c.hits, "Drum hits (kick, snare, hi-hat, crash) for the lights") : "") +
      '<div class="ss-grid"><label>Track names' + sel("trackSet", c.trackSet, [["multitracks", "MultiTracks style (Lead Vox, BGVs, Synth & Pads…)"], ["plain", "Plain (Lead vocals, Backing vocals, Other…)"]]) + "</label></div></section>";
    var fixedSong = intoSong && PP.project().songs.filter(function (x) { return x.id === intoSong; })[0];
    h += '<section><h3>Then</h3><div class="ss-grid">' + (fixedSong ? "<p>The tracks go into <b>" + esc(fixedSong.name) + "</b>.</p>" : '<label>Put the tracks in' + sel("into", c.into, [["new", "A new song (named after the file)"], ["this", "This song" + (s ? " (" + s.name + ")" : "")]]) + "</label>") + "</div>" +
      chk("review", c.review, "Check the tracks before adding them (listen, solo, rename, merge, split again)") +
      (!c.review ? '<p class="small">Keep: ' + stemsOf(c).map(function (k) { return '<label class="toggle inline"><input type="checkbox" data-ss-keep="' + k + '"' + (c.skip.indexOf(k) < 0 ? " checked" : "") + "> " + esc(stemName(k)) + "</label>"; }).join(" ") + "</p>" : "") +
      chk("analyze", c.analyze, "Find the tempo, the key and the beat grid") +
      (c.analyze ? chk("sections", c.sections, "Find the sections (intro, verse, pre-chorus, chorus, bridge, outro) from the vocals and the music") : "") +
      (c.analyze ? chk("clickTrack", c.clickTrack, "Make a <b>Click</b> track from the beat grid (to the click out)") + (c.clickTrack ? '<div class="ss-grid"><label>Click level (%)' + num("clickLevel", c.clickLevel, 0, 100, 5) + "</label><label>Clicks per beat" + sel("clickSub", c.clickSub, [[1, "1 (quarters)"], [2, "2 (eighths)"], [3, "3 (triplets)"], [4, "4 (sixteenths)"]]) + "</label></div>" : "") +
        chk("guideTrack", c.guideTrack, "Make a <b>Guide</b> track: the section names before each section (your cue words)") + (c.guideTrack ? chk("guideCount", c.guideCount, "…and “1, 2, 3, 4” in the bar before the song comes in") : "") : "") +
      (!(c.analyze && c.clickTrack) ? chk("clickOn", c.clickOn, "Live click on - from the beat grid, always in time") : "") +
      (!(c.analyze && c.guideTrack) ? chk("guideOn", c.guideOn, "Live spoken guide on - the section names before each section, and the count-in") : "") +
      chk("keepOriginal", c.keepOriginal, "Also add the original file (muted) as a track") + chk("keepFiles", c.keepFiles, "Keep the split files here afterwards") + "</section>";
    // progress
    if (current) {
      var pct = Math.round((current.progress || 0) * 100);
      h += '<section class="ss-job"><div class="pm-bar"><i style="width:' + pct + '%"></i></div><p>' + esc(current.name || "") + " - " +
        (current.state === "running" ? esc(current.step || "splitting") + "… " + pct + "%" + (current.eta ? " · " + eta(current.eta) : "") + (current.steps && current.steps.length > 1 ? ' <span class="muted small">(step ' + (Math.max(0, current.steps.indexOf(current.step)) + 1) + " of " + current.steps.length + ")</span>" : "")
          : current.state === "done" ? (importing ? "bringing the tracks in…" : "done") : current.state === "failed" ? "failed: " + esc(current.error || "") : esc(current.state)) + "</p>" +
        (current.notes && current.notes.length ? '<p class="warn small">' + esc(current.notes.join(" ")) + "</p>" : "") + "</section>";
    }
    var running = current && current.state === "running";
    h += '<p class="pm-msg' + (/^⚠/.test(msg) ? " bad" : "") + '">' + esc(msg) + "</p><footer>" +
      (running ? '<button type="button" data-ss-act="cancel">Stop</button>' : '<button type="button" class="primary" data-ss-act="start"' + (st.installed && picked && !importing ? "" : " disabled") + ">Split it</button>") + '<button value="close">Close</button></footer></form>';
    return h;
  }
  function draw() { if (!dlg || !dlg.open) return; var f = dlg.querySelector("form"), y = f ? f.scrollTop : 0, a = document.activeElement; if (a && dlg.contains(a) && (a.tagName === "INPUT" && a.type !== "checkbox" && a.type !== "file" && a.type !== "range")) return; dlg.innerHTML = html(); f = dlg.querySelector("form"); if (f) f.scrollTop = y; }
  function open(o) {
    intoSong = o && o.songId ? o.songId : null;
    if (!dlg) { dlg = document.createElement("dialog"); dlg.id = "ssDialog"; dlg.className = "pm-dialog ss-dialog"; document.body.appendChild(dlg); wire(); dlg.addEventListener("close", function () { pausePreview(); if (!(current && current.state === "running") && !subsRunning()) poll(false); }); }
    if (!dlg.open) dlg.showModal(); dlg.innerHTML = html(); refresh(); poll(true);
  }
  function itemFor(el) { var row = el.closest("[data-rv-item]"); return row && review ? review.items.filter(function (x) { return x.id === row.dataset.rvItem; })[0] : null; }
  function wire() {
    dlg.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target.tagName === "INPUT") e.preventDefault(); });   // (Enter would close the dialog)
    dlg.addEventListener("input", function (e) { if (e.target.dataset.rv === "seek") seek(Number(e.target.value)); });
    dlg.addEventListener("change", function (e) {
      var t = e.target, c = cfg();
      if (t.dataset.rvf) {   // the review
        var it = itemFor(t); if (!it) return; var f = t.dataset.rvf;
        if (f === "keep") { it.keep = t.checked; if (player.els[it.id]) player.els[it.id].muted = !audible(it); }
        else if (f === "name") it.name = PP.safeName ? PP.safeName(t.value) : t.value.replace(/[\\/:*?"<>|]+/g, " ").trim() || it.name;
        else if (f === "role") it.role = t.value;
        else if (f === "merge") it.merge = t.checked;
        else if (f === "again" && t.value) { splitAgain(it, t.value); return; }
        draw(); return;
      }
      if (t.hasAttribute("data-ss-file")) { var fl = t.files && t.files[0]; if (fl) { picked = { name: fl.name, file: fl }; draw(); } return; }
      if (t.dataset.ssKeep) { var k = t.dataset.ssKeep, i = c.skip.indexOf(k); if (t.checked && i >= 0) c.skip.splice(i, 1); if (!t.checked && i < 0) c.skip.push(k); PP.persistSoon(); return; }
      if (t.dataset.ssCfg) { var patch = {}; patch[t.dataset.ssCfg] = t.value; post("/split/config", patch).then(function (s) { status = s; draw(); }).catch(function () { }); return; }
      if (!t.dataset.ss) return;
      var key = t.dataset.ss; c[key] = t.type === "checkbox" ? t.checked : t.type === "number" ? (t.value === "" ? "" : Number(t.value)) : /^(bleedSharp|clickSub)$/.test(key) ? Number(t.value) : t.value; cfg(); PP.persistSoon();
      if (t.type !== "number" && t.type !== "text") { document.activeElement && document.activeElement.blur && document.activeElement.blur(); draw(); }
    });
    dlg.addEventListener("click", async function (e) {
      var b = e.target.closest("button"); if (!b) return;
      if (b.dataset.rvb) { var it = itemFor(b); if (!it) return; var m = b.dataset.rvb === "solo" ? player.solo : player.mute; m[it.id] = !m[it.id]; if (review) review.items.forEach(function (x) { if (player.els[x.id]) player.els[x.id].muted = !audible(x); }); draw(); return; }
      if (b.dataset.rv) {
        var a0 = b.dataset.rv;
        if (a0 === "play") { if (player.playing) pausePreview(); else playPreview(); }
        else if (a0 === "rewind") seek(0);
        else if (a0 === "merge") await mergeTicked();
        else if (a0 === "add") { pausePreview(); var j = review.job; await bringIn(j, review.items.filter(function (x) { return x.keep; })); }
        else if (a0 === "discard") { if (confirm("Throw these tracks away?")) { var ids = review.jobIds.slice(); closeReview(); ids.forEach(function (id) { post("/split/forget", { id: id }).catch(function () { }); }); say("Thrown away."); } }
        draw(); return;
      }
      if (!b.dataset.ssAct) return; var a = b.dataset.ssAct;
      if (a === "install") { status = await post("/split/install"); poll(true); draw(); }
      else if (a === "uninstall") { if (confirm("Remove the stem splitter's models and programs from this computer? (Install again any time.)")) { status = await post("/split/uninstall"); draw(); } }
      else if (a === "start") start();
      else if (a === "cancel" && current) { await post("/split/cancel", { id: current.id }); current.state = "cancelled"; draw(); }
      else if (a === "usesong") { var s = PP.activeSong(), st = s && T().data(s).stems[0]; if (st && st.file) { picked = { name: (s.name || st.name) + ".wav", path: st.file, file: null }; draw(); } }
    });
  }
  function addButton() {
    var anchor = $("#trPractice") || $("#trMixer"); if (!anchor || $("#trSplit")) return;
    var b = document.createElement("button"); b.id = "trSplit"; b.title = "Split a stereo song into the tracks a band plays with (Studio models, clean-up, click and guide)"; b.textContent = "✂ Stem splitter";
    b.addEventListener("click", open); anchor.insertAdjacentElement("afterend", b);
  }
  addButton(); document.addEventListener("DOMContentLoaded", addButton);
  window.PPStemSplit = { open: open, cfg: cfg, refresh: refresh, state: function () { return { status: status, current: current, picked: picked, importing: importing, msg: msg, intoSong: intoSong, review: review, player: { playing: player.playing, pos: player.pos, solo: player.solo, mute: player.mute } }; },
    pick: function (file) { picked = { name: file.name, file: file }; draw(); }, start: start, optsFor: optsFor, stemsOf: stemsOf };
})();
