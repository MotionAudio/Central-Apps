/* Central Pedal - Upload / Download between Central Pedal Control (the editor on a Mac or an iPad) and a Central
 * Pedal (the Raspberry Pi).
 *
 * In Central Pedal Control: ⇪ Upload sends what you pick - the songs (with their tracks), the pads and sounds,
 * the controls, the instrument, the setups, the look, and (if you want) the outputs and screens - to a Central
 * Pedal on the network, with its pairing PIN. ⇩ Download brings the same things back from it.
 * On the Central Pedal: an upload waits until you say Apply (and never while something plays); a download is
 * packed by the app there and fetched by the editor with a one-time token. */
(function () {
  "use strict";
  var PP = window.PP, F = window.PPFeatures; if (!PP || !F) return;
  var esc = PP.escapeHtml, MEDIA = "http://127.0.0.1:8766";
  function $(s, r) { return (r || document).querySelector(s); }
  function T() { return window.PPTracks; }
  function project() { return PP.project(); }
  function bridge() { return window.__pedalBridge; }
  function driverOn() { return !!(bridge() && bridge().connected); }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || "null"); localStorage.setItem(k, JSON.stringify(v)); } catch (_) { } return null; }
  var hello = null, lastNet = null; F.on("hello", function (m) { hello = m; markMode(); }); F.on("netAudio", function (m) { if (m && m.config) lastNet = m; });
  function isControl() { var info = bridge() && bridge().info; return !!((hello && hello.pedalControl) || (info && info.pedalControl) || (window.CCDesktop && window.CCDesktop.pedalControl) || window.CP_CONTROL || location.protocol === "capacitor:"); }
  function markMode() { if (isControl() && !/Control$/.test(document.title)) document.title = "Central Pedal Control"; document.body.classList.toggle("pedal-control", isControl()); var b = $("#cpTransfer"); if (b) b.classList.toggle("hidden", !isControl()); }

  // what can travel: each part is a set of the project's keys (+ the pad sounds' audio for "pads")
  var PARTS = [
    ["songs", "Songs and their tracks", "the setlist, every song's tracks, sections, chart, lyrics, mix and scenes; practice-mix and stem-splitter settings", true],
    ["pads", "Pads and sounds", "the 8 pads, your imported sounds, textures, volume / tone / reverb", true],
    ["controls", "Buttons, knobs, MIDI and Stream Deck", "what every footswitch, knob, slider, MIDI control and Stream Deck key does", true],
    ["instrument", "Instrument", "guitar / bass boards and pedals, keys sounds and layers", true],
    ["setups", "Saved setups", "your named setups and each song's setup", true],
    ["look", "Colours and projector look", "", true],
    ["netaudio", "Network audio and the backup player", "each track, the click, pads and the instrument on their own channels to the main admin over Wi-Fi / Ethernet; the backup player's settings", true],
    ["outputs", "Outputs and screens", "audio routing, MIDI out, what each screen shows - only if this computer's outputs match the pedal's", false]];
  var KEYS = { pads: ["pads", "textures", "performance", "tempo", "input", "library"], controls: ["mapping", "midi", "midiInputs", "streamDeck"], instrument: ["instrument"], setups: ["setups", "songSetups", "setupDefault"], look: ["theme", "projector"], outputs: ["routing", "audio", "midiOut", "display", "link"], netaudio: ["netAudio", "backup"], songs: ["name", "setlistId", "songIndex", "tracksMode", "practice", "stemSplit"] };

  // ------------------------------------------------------------- packing (both sides)
  function pcmToWav(rec) {
    var n = rec.length, ch = rec.R ? 2 : 1, rate = rec.rate || 48000, L = new Int16Array(rec.L), R = rec.R ? new Int16Array(rec.R) : null;
    var buf = new ArrayBuffer(44 + n * ch * 2), v = new DataView(buf), w = function (o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, "RIFF"); v.setUint32(4, 36 + n * ch * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * ch * 2, true);
    var out = new Int16Array(buf, 44); if (R) { for (var i = 0; i < n; i++) { out[2 * i] = L[i]; out[2 * i + 1] = R[i]; } } else out.set(L.subarray(0, n));
    return new Blob([buf], { type: "audio/wav" });
  }
  // the package: the picked parts of the project, the songs, and the list of files that go with them
  function pack(parts) {
    var p = project(), pkg = { version: 1, made: Date.now(), from: deviceName(), parts: parts.slice(), settings: {}, songs: [], samples: [], stems: [] };
    parts.forEach(function (part) { (KEYS[part] || []).forEach(function (k) { if (p[k] !== undefined) pkg.settings[k] = clone(p[k]); }); });
    if (parts.indexOf("netaudio") > -1 && !isControl()) { var na = lastNet || (F.systemStatus() || {}).netAudio; if (na && na.config) pkg.settings.netAudio = clone(na.config); }   // (on the pedal: what its driver does)
    if (parts.indexOf("pads") > -1) {
      var ids = {}; (p.pads || []).forEach(function (pad) { if (pad.sampleId) ids[pad.sampleId] = 1; }); (p.library || []).forEach(function (x) { if (x && x.id) ids[x.id] = 1; });
      pkg.samples = Object.keys(ids).map(function (id) { return { fid: "sm-" + id.replace(/[^A-Za-z0-9_-]/g, ""), sampleId: id }; });
    }
    if (parts.indexOf("songs") > -1) {
      pkg.songs = clone(p.songs || []);
      pkg.songs.forEach(function (s) {
        var t = s.tracks; if (!t || !t.stems) return;
        t.stems.forEach(function (st) {
          var safe = String(st.id).replace(/[^A-Za-z0-9_-]/g, "");
          if (st.files && st.files.length) st.files.forEach(function (f, k) { pkg.stems.push({ fid: "st-" + safe + "-" + k, song: s.id, stem: st.id, part: k, name: f.split("/").pop(), path: f }); });
          else pkg.stems.push({ fid: "st-" + safe, song: s.id, stem: st.id, name: (st.file ? st.file.split("/").pop() : st.name.replace(/[^\w .()-]/g, "") + ".wav"), path: st.file || null });
        });
      });
    }
    return pkg;
  }
  async function stemBlob(ref) {
    if (ref.path && driverOn()) { try { var r = await fetch(MEDIA + "/file?path=" + encodeURIComponent(ref.path)); if (r.ok) return await r.blob(); } catch (_) { } }
    var rec = T() && await T().getStem(ref.stem); return rec ? pcmToWav(rec) : null;   // (no original: the decoded audio)
  }
  function deviceName() { var n = store("cpc-name"); if (n) return n; var s = (navigator.platform || "").toLowerCase(); return /ipad|iphone/.test(navigator.userAgent.toLowerCase()) ? "iPad" : /mac/.test(s) ? "Mac" : "Central Pedal Control"; }

  // apply a package here (the Pi after an upload, the editor after a download); fetchFile(fid) gives a Blob
  async function apply(pkg, files, fetchFile, progress, opts) {
    opts = opts || {}; var p = project(), mode = opts.songs || pkg.songMode || "replace";
    progress = progress || function () { };
    // pad sounds into this device's sound store
    for (var i = 0; i < (pkg.samples || []).length; i++) {
      var sm = pkg.samples[i]; progress("Sound " + (i + 1) + " of " + pkg.samples.length, i / Math.max(1, pkg.samples.length) * 0.2);
      var b = await fetchFile(sm.fid); if (b) await PP.storeBlob(sm.sampleId, b);
    }
    // the tracks: on a device with a driver they go to its library (and are decoded when the song loads);
    // without one (iPad) they are decoded into this device's store right away
    var byStem = {};
    for (var j = 0; j < (pkg.stems || []).length; j++) {
      var ref = pkg.stems[j]; progress("Track " + (j + 1) + " of " + pkg.stems.length + ": " + ref.name, 0.2 + j / Math.max(1, pkg.stems.length) * 0.75);
      var path = files && files[ref.fid];
      if (!path) {
        var blob = await fetchFile(ref.fid); if (!blob) continue;
        if (driverOn()) { try { var r = await fetch(MEDIA + "/library?song=" + encodeURIComponent(ref.song) + "&name=" + encodeURIComponent(ref.name), { method: "PUT", body: blob }); var jj = await r.json(); path = jj && jj.path; } catch (_) { } }
        if (!path && T()) { (byStem[ref.stem] = byStem[ref.stem] || { blobs: [] }).blobs[ref.part || 0] = new File([blob], ref.name); }
      }
      if (path) { var e = byStem[ref.stem] = byStem[ref.stem] || { paths: [] }; (e.paths = e.paths || [])[ref.part || 0] = path; }
    }
    var drops = [], songs = (pkg.songs || []).map(function (s) {
      ((s.tracks && s.tracks.stems) || []).forEach(function (st) {
        var e = byStem[st.id]; if (!e) return;
        if (e.paths && e.paths.length) { if (st.files && st.files.length) { st.files = e.paths.slice(); delete st.file; } else st.file = e.paths[0]; }
        if (T()) drops.push(T().dropStem(st.id));   // (a stale decoded copy of an older upload)
      });
      return s;
    });
    await Promise.all(drops);
    // decoded right here when there is no driver to keep the files
    for (var sid in byStem) {
      var e2 = byStem[sid]; if (!e2.blobs || !T()) continue;
      try { var buf = e2.blobs.length > 1 ? await T().decodeSum(e2.blobs.filter(Boolean)) : await T().decodeFile(e2.blobs[0]); await T().putStem(sid, T().toPcm(buf)); } catch (error) { console.warn("decode", error); }
    }
    // network audio is the driver's: a Central Pedal sets it there (Central Pedal Control keeps it in the project)
    if (pkg.settings && pkg.settings.netAudio && driverOn() && !isControl()) F.sendToDriver({ type: "netAudio", action: "config", config: pkg.settings.netAudio });
    // the settings and the songs into the project
    Object.keys(pkg.settings || {}).forEach(function (k) { if (k === "songIndex" || k === "name" || k === "setlistId") return; p[k] = clone(pkg.settings[k]); });
    if ((pkg.parts || []).indexOf("songs") > -1) {
      if (mode === "replace") { p.songs = songs; if (pkg.settings.name) p.name = pkg.settings.name; if (pkg.settings.setlistId) p.setlistId = pkg.settings.setlistId; p.songIndex = songs.length ? Math.min(Math.max(0, pkg.settings.songIndex || 0), songs.length - 1) : -1; }
      else songs.forEach(function (s) { var i = p.songs.findIndex(function (q) { return q.id === s.id; }); if (i > -1) p.songs[i] = s; else p.songs.push(s); });
    }
    progress("Saving…", 1);
    PP.persistNow();
    if (driverOn()) { try { await fetch(MEDIA + "/project", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) }); } catch (_) { } }
    return { songs: songs.length, samples: (pkg.samples || []).length, stems: (pkg.stems || []).length };
  }

  // ------------------------------------------------------------- the editor: Upload / Download
  function pedals() { return store("cpc-pedals") || []; }
  function remember(host, name, pin, keep) { var list = pedals().filter(function (x) { return x.host !== host; }); list.unshift({ host: host, name: name || host, pin: keep ? pin : "" }); store("cpc-pedals", list.slice(0, 8)); }
  async function found() {
    var out = []; if (!driverOn()) return out;
    try { var st = await (await fetch(MEDIA + "/sync/status", { cache: "no-store" })).json(); (st.peers || st.devices || []).forEach(function (x) { if (x.address && x.kind !== "pc") out.push({ host: x.address + (x.port && x.port !== 8080 ? ":" + x.port : ""), name: x.name || x.address }); }); } catch (_) { }
    return out;
  }
  function base(host) { host = String(host || "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, ""); return "http://" + (/:\d+$/.test(host) ? host : host + ":8080"); }
  async function post(url, body, raw) {
    var r = await fetch(url, { method: "POST", headers: raw ? { "Content-Type": "application/octet-stream" } : { "Content-Type": "application/json" }, body: raw ? body : JSON.stringify(body) });
    var j = null; try { j = await r.json(); } catch (_) { }
    if (!r.ok) throw new Error((j && j.error) || ("The Central Pedal said " + r.status));
    return j || {};
  }

  var dlg = null, busy = false;
  function dialog() {
    if (dlg) return dlg;
    dlg = document.createElement("dialog"); dlg.id = "cpTransferDialog"; dlg.className = "cp-transfer"; document.body.appendChild(dlg);
    dlg.addEventListener("click", onClick); dlg.addEventListener("cancel", function (e) { if (busy) e.preventDefault(); });
    return dlg;
  }
  async function open(dir) {
    var d = dialog(), list = pedals(), more = await found();
    more.forEach(function (x) { if (!list.some(function (y) { return y.host === x.host; })) list.push(x); });
    var cur = list[0] || { host: "", pin: "" }, n = (project().songs || []).length;
    d.dataset.dir = dir;
    d.innerHTML = '<form method="dialog" class="cp-form"><div class="row spread"><h2>' + (dir === "up" ? "⇪ Upload to a Central Pedal" : "⇩ Download from a Central Pedal") + '</h2><button value="cancel" data-cp="close">Close</button></div>' +
      '<label>Central Pedal<input data-cp="host" list="cpHosts" placeholder="padpedal.local or 192.168.1.50" value="' + esc(cur.host || "") + '"><datalist id="cpHosts">' + list.map(function (x) { return '<option value="' + esc(x.host) + '">' + esc(x.name) + "</option>"; }).join("") + "</datalist></label>" +
      '<label>Its pairing PIN<input data-cp="pin" inputmode="numeric" maxlength="4" autocomplete="off" type="password" value="' + esc(cur.pin || "") + '"></label>' +
      '<label class="toggle"><input type="checkbox" data-cp="keep"' + (cur.pin ? " checked" : "") + "> Remember the PIN on this " + esc(deviceName()) + "</label>" +
      '<fieldset class="cp-parts"><legend>' + (dir === "up" ? "Send" : "Bring back") + "</legend>" + PARTS.map(function (x) { return '<label class="toggle"><input type="checkbox" data-part="' + x[0] + '"' + (x[3] ? " checked" : "") + "> <b>" + esc(x[1]) + "</b>" + (x[0] === "songs" && dir === "up" ? " (" + n + ")" : "") + (x[2] ? "<small>" + esc(x[2]) + "</small>" : "") + "</label>"; }).join("") + "</fieldset>" +
      '<label>Songs<select data-cp="songMode"><option value="replace">Replace the setlist ' + (dir === "up" ? "on the pedal" : "here") + '</option><option value="add">Add to it (same songs are updated)</option></select></label>' +
      '<div class="cp-progress hidden"><div class="cp-bar"><i></i></div><p class="small" data-cp="msg"></p></div>' +
      '<div class="row"><button class="primary" type="button" data-cp="go">' + (dir === "up" ? "⇪ Upload" : "⇩ Download") + "</button></div>" +
      (dir === "up" ? '<p class="muted small">The Central Pedal shows what arrived and applies it when you say so (never while it plays). Tracks travel as their original files; over Wi-Fi a big setlist takes a few minutes - a network cable is faster.</p>' : '<p class="muted small">What is here is replaced by the Central Pedal\'s.</p>') + "</form>";
    d.showModal();
  }
  function say(msg, frac, bad) { var d = dialog(), box = $(".cp-progress", d); PP.setStatus(msg); if (!box) return; box.classList.remove("hidden"); $("[data-cp=msg]", d).textContent = msg; $("[data-cp=msg]", d).classList.toggle("warn", !!bad); if (frac != null) $(".cp-bar i", d).style.width = Math.round(frac * 100) + "%"; }
  function picked() { return Array.prototype.slice.call(dialog().querySelectorAll("[data-part]:checked")).map(function (x) { return x.dataset.part; }); }
  async function onClick(e) {
    var b = e.target.closest && e.target.closest("[data-cp]"); if (!b) return;
    if (b.dataset.cp === "close") { if (busy) e.preventDefault(); return; }
    if (b.dataset.cp !== "go" || busy) return;
    e.preventDefault();
    var d = dialog(), host = $("[data-cp=host]", d).value.trim(), pin = $("[data-cp=pin]", d).value.trim(), parts = picked(), dir = d.dataset.dir, mode = $("[data-cp=songMode]", d).value;
    if (!host) return say("Type the Central Pedal's name or address (its Settings → Companion devices shows it).", null, true);
    if (!/^\d{4}$/.test(pin)) return say("The PIN is 4 digits.", null, true);
    if (!parts.length) return say("Pick something to " + (dir === "up" ? "send" : "bring back") + ".", null, true);
    busy = true; b.disabled = true;
    try {
      if (dir === "up") await upload(host, pin, parts, mode); else await download(host, pin, parts, mode);
      remember(host, null, pin, $("[data-cp=keep]", d).checked);
    } catch (error) { say(String(error && error.message || error), null, true); }
    finally { busy = false; b.disabled = false; }
  }
  async function upload(host, pin, parts, mode) {
    var url = base(host);
    say("Connecting to " + host + "…", 0);
    var begin = await post(url + "/api/pedal/begin", { code: pin, from: deviceName() });
    var tok = encodeURIComponent(begin.token), pkg = pack(parts); pkg.songMode = mode;
    var all = pkg.samples.map(function (x) { return { kind: "sample", ref: x }; }).concat(pkg.stems.map(function (x) { return { kind: "stem", ref: x }; })), sent = 0, skipped = [];
    for (var i = 0; i < all.length; i++) {
      var it = all[i], label = it.kind === "sample" ? "sound" : it.ref.name;
      say("Sending " + (i + 1) + " of " + all.length + ": " + label, i / Math.max(1, all.length));
      var blob = it.kind === "sample" ? await PP.getBlob(it.ref.sampleId) : await stemBlob(it.ref);
      if (!blob) { skipped.push(label); continue; }
      await post(url + "/api/pedal/file?token=" + tok + "&kind=" + it.kind + "&id=" + encodeURIComponent(it.ref.fid) + "&name=" + encodeURIComponent(it.ref.name || it.ref.fid) + "&song=" + encodeURIComponent(it.ref.song || ""), blob, true);
      sent++;
    }
    say("Sending the settings…", 1);
    pkg.stems.forEach(function (x) { delete x.path; });   // (paths on this computer mean nothing there)
    await post(url + "/api/pedal/commit?token=" + tok, pkg);
    say("✓ Sent to " + (begin.name || host) + ": " + (parts.indexOf("songs") > -1 ? pkg.songs.length + " songs, " : "") + sent + " files. Tap Apply on the Central Pedal." + (skipped.length ? " (Not found here: " + skipped.join(", ") + ")" : ""), 1);
  }
  async function download(host, pin, parts, mode) {
    var url = base(host);
    if (window.PPTracks && window.PPTracks.isPlaying()) throw new Error("Stop the tracks first.");
    say("Asking " + host + " to pack…", 0);
    var begin = await post(url + "/api/pedal/export", { code: pin, from: deviceName(), want: parts }), tok = encodeURIComponent(begin.token), st = null;
    for (var i = 0; i < 240; i++) {
      var r = await fetch(url + "/api/pedal/export?token=" + tok, { cache: "no-store" }); st = await r.json();
      if (!r.ok) throw new Error(st.error || "no answer"); if (st.ready) break;
      say("The Central Pedal is packing… (" + i + " s)", null); await new Promise(function (res) { setTimeout(res, 1000); });
    }
    if (!st || !st.ready) throw new Error("The Central Pedal did not answer - is its app running?");
    var pkg = st.package || {}; if (pkg.error) throw new Error(pkg.error);
    pkg.stems = pkg.stems || [];
    // files on the pedal: sounds by id, tracks by their library path there
    var fetchFile = async function (fid) { var ref = pkg.stems.filter(function (x) { return x.fid === fid; })[0], id = ref && ref.path ? ref.path : fid; var rr = await fetch(url + "/api/pedal/export-file?token=" + tok + "&id=" + encodeURIComponent(id)); return rr.ok ? await rr.blob() : null; };
    var res = await apply(pkg, null, fetchFile, function (m, f) { say(m, f); }, { songs: mode });
    say("✓ Brought back " + res.songs + " songs and " + (res.stems + res.samples) + " files. Restarting the screen…", 1);
    setTimeout(function () { location.reload(); }, 1200);
  }

  // ------------------------------------------------------------- the Central Pedal: an upload arrived / a download asked
  var pending = null, bar = null;
  F.on("pedalUpload", function (m) { pending = m; showBar(); });
  function showBar() {
    if (!pending) { if (bar) bar.remove(); bar = null; return; }
    if (!bar) { bar = document.createElement("div"); bar.className = "cp-arrived"; document.body.appendChild(bar); bar.addEventListener("click", onBar); }
    var sm = pending.summary || {}, playing = T() && T().isPlaying();
    bar.innerHTML = "<b>⇪ From " + esc(pending.from || "Central Pedal Control") + ":</b> " + (sm.songs && sm.songs.length ? sm.songs.length + " songs" : "") + (sm.settings && sm.settings.length ? (sm.songs && sm.songs.length ? " · " : "") + sm.settings.filter(function (x) { return x !== "songs"; }).map(function (x) { return (PARTS.filter(function (q) { return q[0] === x; })[0] || [x, x])[1]; }).join(", ") : "") +
      ' <span class="sp"></span>' + (playing ? '<span class="muted small">applies when you stop playing</span>' : "") + '<button class="primary" data-ar="apply"' + (playing ? " disabled" : "") + '>Apply now</button><button data-ar="later">Later</button><button data-ar="drop">Discard</button>';
  }
  setInterval(function () { if (pending && bar) { var dis = !!(T() && T().isPlaying()), btn = bar.querySelector('[data-ar="apply"]'); if (btn && btn.disabled !== dis) showBar(); } }, 1000);
  async function onBar(e) {
    var b = e.target.closest && e.target.closest("[data-ar]"); if (!b) return;
    if (b.dataset.ar === "later") { bar.classList.add("hidden"); setTimeout(function () { if (bar) bar.classList.remove("hidden"); }, 5 * 60000); return; }
    if (b.dataset.ar === "drop") { pending = null; showBar(); PP.setStatus("Upload discarded"); return; }
    if (T() && T().isPlaying()) return;
    if (window.PPLive && window.PPLive.locked()) { PP.setStatus("Unlock the service lock first"); return; }
    var tok = pending.token; b.disabled = true;
    try {
      var j = await (await fetch(MEDIA + "/pedal/package?token=" + encodeURIComponent(tok), { cache: "no-store" })).json();
      if (!j || !j.package) throw new Error("the upload is gone - send it again");
      var fetchFile = async function (fid) { var r = await fetch(MEDIA + "/pedal/file?token=" + encodeURIComponent(tok) + "&id=" + encodeURIComponent(fid)); return r.ok ? await r.blob() : null; };
      var res = await apply(j.package, j.files, fetchFile, function (m, f) { bar.innerHTML = "<b>⇪ Applying…</b> " + esc(m) + ' <span class="cp-bar"><i style="width:' + Math.round((f || 0) * 100) + '%"></i></span>'; });
      pending = null; bar.innerHTML = "<b>✓ Applied:</b> " + res.songs + " songs, " + (res.stems + res.samples) + " files. Restarting the screen…";
      setTimeout(function () { location.reload(); }, 1500);
    } catch (error) { bar.innerHTML = '<b class="warn">Could not apply:</b> ' + esc(error.message || String(error)) + ' <button data-ar="drop">Close</button>'; }
  }
  // a Download: pack here, hand the files to the driver, then the package
  F.on("pedalExport", async function (m) {
    var tok = encodeURIComponent(m.token), parts = (m.want && m.want.length ? m.want : PARTS.map(function (x) { return x[0]; })).filter(function (x) { return KEYS[x]; });
    try {
      var pkg = pack(parts);
      for (var i = 0; i < pkg.samples.length; i++) { var bl = await PP.getBlob(pkg.samples[i].sampleId); if (bl) await fetch(MEDIA + "/pedal/export-file?token=" + tok + "&id=" + encodeURIComponent(pkg.samples[i].fid), { method: "POST", body: bl }); }
      pkg.stems = pkg.stems.filter(function (x) { return !!x.path; });   // (tracks without their file in the library can't travel)
      await fetch(MEDIA + "/pedal/export-done?token=" + tok, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pkg) });
      PP.setStatus("Sent this Central Pedal's songs and settings to " + (m.from || "Central Pedal Control"));
    } catch (error) {
      fetch(MEDIA + "/pedal/export-done?token=" + tok, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: String(error.message || error) }) }).catch(function () { });
    }
  });

  // ------------------------------------------------------------- the nav buttons (Central Pedal Control only)
  function addButtons() {
    var right = $(".topnav .nav-right"); if (!right || $("#cpTransfer")) return;
    var box = document.createElement("span"); box.id = "cpTransfer"; box.className = "cp-nav hidden";
    box.innerHTML = '<button data-cpo="up" title="Send songs and settings to a Central Pedal">⇪ Upload</button><button data-cpo="down" title="Bring songs and settings back from a Central Pedal">⇩</button>';
    right.insertBefore(box, right.firstChild);
    box.addEventListener("click", function (e) { var b = e.target.closest("[data-cpo]"); if (b) open(b.dataset.cpo); });
    markMode();
  }
  addButtons();
  setTimeout(markMode, 1500);
  window.PPTransfer = { open: open, pack: pack, apply: apply, isControl: isControl, pcmToWav: pcmToWav, upload: upload, download: download, pending: function () { return pending; } };
})();
