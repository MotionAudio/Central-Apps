/* Central Pedal - the stem splitter. A song that only exists as one stereo file (a recording, a YouTube rip of
 * your own band, an old backing track) is split into drums, bass, vocals and the rest - or six stems, or just
 * vocals / no vocals - with Demucs, on this computer, and comes back as a song with tracks (tempo, key and
 * sections found as for any import). Best on a Mac (Central Pedal Control) or the Central Control computer; it
 * also runs on a Central Pedal, slowly. Nothing is installed until you ask (Install: about 2 GB).
 * Every Demucs setting is here: model, shifts, overlap, segment, device, format, clipping - and what to do with
 * the stems (new song or this one, names, which to keep, tempo/key analysis). */
(function () {
  "use strict";
  var PP = window.PP, F = window.PPFeatures; if (!PP) return;
  var esc = PP.escapeHtml, MEDIA = "http://127.0.0.1:8766";
  function T() { return window.PPTracks; }
  function $(s, r) { return (r || document).querySelector(s); }
  function driverOn() { return !!(T() && T().driverOn()); }

  var MODELS = [["htdemucs", "4 stems: drums, bass, vocals, other (fast, good)"], ["htdemucs_6s", "6 stems: + guitar and piano"], ["htdemucs_ft", "4 stems, best quality (4× slower)"],
    ["hdemucs_mmi", "4 stems (older hybrid model)"], ["mdx_extra", "4 stems (MDX, trained on extra data)"], ["mdx_extra_q", "4 stems (MDX, smaller download)"]];
  var NICE = { drums: "Drums", bass: "Bass", vocals: "Vocals", other: "Other", guitar: "Guitar", piano: "Piano", no_vocals: "Band (no vocals)", no_drums: "No drums", no_bass: "No bass", no_other: "Rest" };
  var ROLE = { drums: "drums", bass: "bass", vocals: "vocals", other: "music", guitar: "guitar", piano: "keys", no_vocals: "music", no_drums: "music", no_bass: "music", no_other: "music" };
  var DEFAULTS = { model: "htdemucs", twoStems: "", shifts: 1, overlap: 0.25, segment: "", device: "auto", format: "wav16", mp3Kbps: 320, clipMode: "rescale", jobs: 1,
    into: "new", analyze: true, keepOriginal: false, keepFiles: false, skip: [] };
  function cfg() {
    var p = PP.project(), c = p.stemSplit || (p.stemSplit = {});
    Object.keys(DEFAULTS).forEach(function (k) { if (c[k] == null) c[k] = Array.isArray(DEFAULTS[k]) ? [] : DEFAULTS[k]; });
    c.shifts = Math.max(0, Math.min(20, Math.round(Number(c.shifts) || 0)));
    c.overlap = Math.max(0, Math.min(0.95, Number(c.overlap) || 0));
    return c;
  }
  var status = null, picked = null, current = null, dlg = null, pollTimer = 0, importing = false, msg = "";

  async function refresh() {
    if (!driverOn()) { status = null; draw(); return; }
    try { status = await (await fetch(MEDIA + "/split/status", { cache: "no-store" })).json(); } catch (_) { status = null; }
    if (current && status) { var j = status.jobs.filter(function (x) { return x.id === current.id; })[0]; if (j) onJob(j); }
    draw();
  }
  function post(path, body) { return fetch(MEDIA + path, { method: "POST", body: JSON.stringify(body || {}) }).then(function (r) { return r.json(); }); }
  function poll(on) { clearInterval(pollTimer); if (on) pollTimer = setInterval(refresh, 2000); }
  if (F) {
    F.on("stemSplit", function (m) { if (m.job) onJob(m.job); });
    F.on("stemSplitStatus", function (m) { if (status) { status.install = m.install; status.installed = m.installed; } draw(); });
  }
  function onJob(j) {
    if (!current || j.id !== current.id) return;
    var was = current.state; j.songName = current.songName; current = j;
    if (j.state === "done" && was !== "done" && !importing) bringIn(j);
    if (j.state !== "running") poll(false);
    draw();
  }

  // ---------------------------------------------------------------- running
  async function start() {
    var c = cfg();
    if (!picked) return say("Pick the song file first.", true);
    var path = picked.path;
    try {
      if (!path) { say("Sending " + picked.name + "…"); var up = await (await fetch(MEDIA + "/split/upload?name=" + encodeURIComponent(picked.name), { method: "PUT", body: picked.file })).json(); if (up.error) throw new Error(up.error); path = up.path; }
      var opts = { model: c.twoStems ? (c.model === "htdemucs_6s" ? "htdemucs" : c.model) : c.model, twoStems: c.twoStems || "", shifts: c.shifts, overlap: c.overlap, segment: c.segment ? Number(c.segment) : 0, device: c.device, format: c.format === "wav16" ? "wav" : c.format, mp3Kbps: c.mp3Kbps, clipMode: c.clipMode, jobs: c.jobs };
      var j = await post("/split/start", { path: path, opts: opts }); if (j.error) throw new Error(j.error);
      current = j; current.songName = picked.name.replace(/\.[^.]+$/, ""); msg = ""; poll(true); draw();
    } catch (error) { say(error.message, true); }
  }
  async function bringIn(j) {
    var c = cfg(); importing = true; draw();
    try {
      var files = [];
      for (var i = 0; i < j.files.length; i++) {
        var f = j.files[i], stem = f.name.replace(/\.[^.]+$/, ""); if (c.skip.indexOf(stem) >= 0) continue;
        var blob = await (await fetch(MEDIA + "/split/file?id=" + encodeURIComponent(j.id) + "&rel=" + encodeURIComponent(f.rel))).blob();
        var file = new File([blob], (NICE[stem] || stem) + "." + f.name.split(".").pop(), { type: blob.type || "audio/*" }); file._role = ROLE[stem] || "music";
        files.push(file);
      }
      if (c.keepOriginal && picked && picked.file) { var o = new File([picked.file], "Original mix." + (picked.name.split(".").pop() || "wav")); o._role = "music"; o._mute = true; files.push(o); }
      if (!files.length) throw new Error("no stems came back");
      var name = (current && current.songName) || "Split song", s = c.into === "this" && PP.activeSong() ? PP.activeSong() : T().newSong(name);
      await T().importFilesIntoSong(s, files, { analyze: c.analyze });
      if (!c.keepFiles) post("/split/forget", { id: j.id }).catch(function () { });
      say("✓ " + files.length + " stems added to “" + s.name + "”");
    } catch (error) { say("Bringing the stems in failed: " + error.message, true); }
    importing = false; draw();
  }
  function say(m, bad) { msg = (bad ? "⚠ " : "") + m; PP.setStatus(m); draw(); }

  // ---------------------------------------------------------------- the dialog
  function opt(v, label, cur) { return '<option value="' + esc(String(v)) + '"' + (String(cur) === String(v) ? " selected" : "") + ">" + esc(label) + "</option>"; }
  function sel(key, cur, opts) { return '<select data-ss="' + key + '">' + opts.map(function (o) { return opt(o[0], o[1], cur); }).join("") + "</select>"; }
  function num(key, v, min, max, step, ph) { return '<input type="number" data-ss="' + key + '" value="' + esc(String(v)) + '" min="' + min + '" max="' + max + '" step="' + (step || 1) + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : "") + ">"; }
  function chk(key, v, label) { return '<label class="toggle"><input type="checkbox" data-ss="' + key + '"' + (v ? " checked" : "") + "> " + label + "</label>"; }
  function stemsOf(c) { if (c.twoStems) return [c.twoStems, "no_" + c.twoStems]; return c.model === "htdemucs_6s" ? ["drums", "bass", "vocals", "guitar", "piano", "other"] : ["drums", "bass", "vocals", "other"]; }

  function html() {
    var c = cfg(), st = status, h = '<form method="dialog" class="ss"><header><h2>✂ Stem splitter</h2><button value="close" class="ghost" aria-label="Close">✕</button></header>';
    h += '<p class="muted small">Split a song that is one stereo file into drums, bass, vocals and the rest (or 6 stems, or vocals / no vocals) - on this computer, with Demucs - and get it back as a song with tracks.</p>';
    if (!driverOn()) return h + '<p class="bad">The stem splitter runs in Central Pedal Control on a Mac, in Central Control, or on a Central Pedal - this copy has no driver to run it.</p><footer><button value="close">Close</button></footer></form>';
    if (!st) return h + "<p>…</p></form>";
    if (st.slow) h += '<p class="warn small">On a Central Pedal this is slow (often 20-40 minutes a song' + (st.memoryGb && st.memoryGb < 3.5 ? ", and this one has only " + st.memoryGb + " GB of memory - 4 GB or more is needed" : "") + "). A Mac with Central Pedal Control does it in a minute or two.</p>";
    // install
    var ins = st.install || {};
    h += "<section><h3>Demucs on this computer</h3>";
    if (st.installed) h += "<p>✓ Installed" + (st.custom ? " (your own command)" : "") + ". The models download the first time each is used.</p>";
    else if (ins.running) h += "<p>Installing - " + esc(ins.step || "") + "…</p>";
    else h += "<p>Not installed yet. Install downloads uv, a private Python, PyTorch and Demucs into this app's own folder (about 2 GB; nothing else on the computer changes)." + (ins.error ? '</p><p class="bad small">Last try failed: ' + esc(ins.error) : "") + "</p>";
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
    // settings
    h += '<section><h3>How to split</h3><div class="ss-grid">' +
      "<label>Model" + sel("model", c.model, MODELS) + "</label>" +
      "<label>Stems" + sel("twoStems", c.twoStems, [["", "All of them"], ["vocals", "Just vocals / no vocals"], ["drums", "Just drums / no drums"], ["bass", "Just bass / no bass"], ["other", "Just other / the rest"]]) + "</label>" +
      '<label title="More = cleaner, slower (each one is a whole extra pass)">Shifts (passes)' + num("shifts", c.shifts, 0, 20) + "</label>" +
      '<label title="How much the chunks overlap">Overlap' + num("overlap", c.overlap, 0, 0.95, 0.05) + "</label>" +
      '<label title="Seconds per chunk - lower uses less memory (htdemucs: 7.8 max)">Segment (s)' + num("segment", c.segment, 1, 60, 0.1, "model default") + "</label>" +
      "<label>Run on" + sel("device", c.device, [["auto", "The fastest here"]].concat(((st.devices) || ["cpu"]).map(function (d) { return [d, d === "cpu" ? "CPU" : d === "mps" ? "Apple GPU (Metal)" : "NVIDIA GPU (CUDA)"]; }))) + "</label>" +
      '<label title="Several at once - faster, more memory">Parallel jobs' + num("jobs", c.jobs, 1, 16) + "</label>" +
      "<label>File format" + sel("format", c.format, [["wav16", "WAV 16-bit"], ["wav24", "WAV 24-bit"], ["float", "WAV 32-bit float"], ["flac", "FLAC"], ["mp3", "MP3"]]) + "</label>" +
      (c.format === "mp3" ? "<label>MP3 kbps" + num("mp3Kbps", c.mp3Kbps, 96, 320, 32) + "</label>" : "") +
      "<label>When it would clip" + sel("clipMode", c.clipMode, [["rescale", "Turn the stem down"], ["clamp", "Clip it"]]) + "</label></div></section>";
    h += '<section><h3>Then</h3><div class="ss-grid"><label>Put the stems in' + sel("into", c.into, [["new", "A new song (named after the file)"], ["this", "This song" + (s ? " (" + s.name + ")" : "")]]) + "</label></div>" +
      '<p class="small">Keep: ' + stemsOf(c).map(function (k) { return '<label class="toggle inline"><input type="checkbox" data-ss-keep="' + k + '"' + (c.skip.indexOf(k) < 0 ? " checked" : "") + "> " + esc(NICE[k] || k) + "</label>"; }).join(" ") + "</p>" +
      chk("analyze", c.analyze, "Find the tempo, key and sections") + chk("keepOriginal", c.keepOriginal, "Also add the original file (muted) as a track") + chk("keepFiles", c.keepFiles, "Keep the split files here afterwards") + "</section>";
    // progress
    if (current) {
      var pct = Math.round((current.progress || 0) * 100);
      h += '<section class="ss-job"><div class="pm-bar"><i style="width:' + pct + '%"></i></div><p>' + esc(current.name || "") + " - " +
        (current.state === "running" ? "splitting… " + pct + "%" : current.state === "done" ? (importing ? "bringing the stems in…" : "done") : current.state === "failed" ? "failed: " + esc(current.error || "") : esc(current.state)) + "</p></section>";
    }
    var running = current && current.state === "running";
    h += '<p class="pm-msg' + (/^⚠/.test(msg) ? " bad" : "") + '">' + esc(msg) + "</p><footer>" +
      (running ? '<button type="button" data-ss-act="cancel">Stop</button>' : '<button type="button" class="primary" data-ss-act="start"' + (st.installed && picked && !importing ? "" : " disabled") + ">Split it</button>") + '<button value="close">Close</button></footer></form>';
    return h;
  }
  function draw() { if (!dlg || !dlg.open) return; var f = dlg.querySelector("form"), y = f ? f.scrollTop : 0, a = document.activeElement; if (a && dlg.contains(a) && a.tagName === "INPUT" && a.type !== "checkbox" && a.type !== "file") return; dlg.innerHTML = html(); f = dlg.querySelector("form"); if (f) f.scrollTop = y; }
  function open() {
    if (!dlg) { dlg = document.createElement("dialog"); dlg.id = "ssDialog"; dlg.className = "pm-dialog ss-dialog"; document.body.appendChild(dlg); wire(); dlg.addEventListener("close", function () { if (!(current && current.state === "running")) poll(false); }); }
    if (!dlg.open) dlg.showModal(); dlg.innerHTML = html(); refresh(); poll(true);
  }
  function wire() {
    dlg.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target.tagName === "INPUT") e.preventDefault(); });   // (Enter would close the dialog)
    dlg.addEventListener("change", function (e) {
      var t = e.target, c = cfg();
      if (t.hasAttribute("data-ss-file")) { var f = t.files && t.files[0]; if (f) { picked = { name: f.name, file: f }; draw(); } return; }
      if (t.dataset.ssKeep) { var k = t.dataset.ssKeep, i = c.skip.indexOf(k); if (t.checked && i >= 0) c.skip.splice(i, 1); if (!t.checked && i < 0) c.skip.push(k); PP.persistSoon(); return; }
      if (t.dataset.ssCfg) { var patch = {}; patch[t.dataset.ssCfg] = t.value; post("/split/config", patch).then(function (s) { status = s; draw(); }).catch(function () { }); return; }
      if (!t.dataset.ss) return;
      var key = t.dataset.ss; c[key] = t.type === "checkbox" ? t.checked : t.type === "number" ? (t.value === "" ? "" : Number(t.value)) : t.value; cfg(); PP.persistSoon();
      if (/^(model|twoStems|format)$/.test(key)) { document.activeElement && document.activeElement.blur && document.activeElement.blur(); draw(); }
    });
    dlg.addEventListener("click", async function (e) {
      var b = e.target.closest("button"); if (!b || !b.dataset.ssAct) return; var a = b.dataset.ssAct;
      if (a === "install") { status = await post("/split/install"); poll(true); draw(); }
      else if (a === "uninstall") { if (confirm("Remove Demucs from this computer? (Install again any time.)")) { status = await post("/split/uninstall"); draw(); } }
      else if (a === "start") start();
      else if (a === "cancel" && current) { await post("/split/cancel", { id: current.id }); current.state = "cancelled"; draw(); }
      else if (a === "usesong") { var s = PP.activeSong(), st = s && T().data(s).stems[0]; if (st && st.file) { picked = { name: (s.name || st.name) + ".wav", path: st.file, file: null }; draw(); } }
    });
  }
  function addButton() {
    var anchor = $("#trPractice") || $("#trMixer"); if (!anchor || $("#trSplit")) return;
    var b = document.createElement("button"); b.id = "trSplit"; b.title = "Split a stereo song into drums, bass, vocals and the rest (Demucs)"; b.textContent = "✂ Stem splitter";
    b.addEventListener("click", open); anchor.insertAdjacentElement("afterend", b);
  }
  addButton(); document.addEventListener("DOMContentLoaded", addButton);
  window.PPStemSplit = { open: open, cfg: cfg, refresh: refresh, state: function () { return { status: status, current: current, picked: picked, importing: importing, msg: msg }; }, pick: function (file) { picked = { name: file.name, file: file }; draw(); }, start: start };
})();
