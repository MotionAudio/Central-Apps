/* Central Control (10.2) - the pre-service check.
 *
 * Every computer (and phone) on the team answers the center's "check yourself" with what it can see from where it is:
 *   its key and sound plans · the sound (a short test tone on the audio host, if the main admin allows it, else the
 *   meters) and the inputs (which mics show signal) · the lights' DMX output · the cameras and NDI · the screens and
 *   outputs · the live stream's destinations · free disk space for the recording · its Wi-Fi · a newer version.
 * The center adds what it knows itself (who's online, versions, batteries, clocks, the Central Pedal) - center.js.
 * The main admin's computer also checks today's run sheet: is there one, and are its songs in the track player's
 * setlist with their tracks and lyrics.
 *
 * On the main admin's Service tab → Pre-service check: every line green, amber or red with what to do, "Check again",
 * the settings (how long before each service it runs by itself, the test tone, the phone alert) and the past checks.
 * When an automatic check finds something red, the main admin's computer shows a notice and asks the Motion Audio
 * website to email the church's main admins (once the website is open), which Central Services shows too. */
(function () {
  "use strict";
  var CU = window.CentralUsage, NAT = window.CU; if (!CU) return;
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var GROUPS = [["devices", "Devices"], ["keys", "Keys and plans"], ["sound", "Sound"], ["inputs", "Inputs and mics"], ["lights", "Lights"], ["cameras", "Cameras"], ["screens", "Screens"], ["stream", "Live stream"], ["recording", "Recording"], ["songs", "Songs and run sheet"], ["network", "Network"], ["power", "Power"], ["time", "Clocks"], ["other", "Other"]];
  var P = { state: null, result: null, viewing: null, running: false };

  // ------------------------------------------------------------- what the meters have seen (for the sound and inputs checks)
  var seen = { main: 0, inputs: {} };   // the last time each one showed signal (ms)
  function dB(v) { return v > 0 ? 20 * Math.log10(v) : -120; }
  function watchMeters() {
    var X = window.CUMix; if (!X || !X.on || watchMeters.on) return; watchMeters.on = true;
    X.on("meters", function (m) {
      var now = Date.now();
      if (m.main && Math.max(m.main[0] || 0, m.main[1] || 0) > 0.003) seen.main = now;   // (above about -50 dB)
      (m.in || []).forEach(function (v, i) { if (v > 0.003) seen.inputs[i] = now; });
    });
  }
  setTimeout(watchMeters, 1500);

  // ------------------------------------------------------------- this computer's own checks
  function doing(job) { var r = CU.role(); if (r !== "admin" && r !== "main") return false; var j = CU.jobs(); return j[0] === "general" || j.indexOf(job) >= 0; }
  function isHost() { var c = CU.config() || {}; return CU.mode() === "admin" && c.host && c.host.enabled && window.CUMix && window.CUMix.kind === "local"; }
  function gb(n) { return Math.round(n / 1073741824 * 10) / 10; }
  function ago(ms) { var s = Math.round((Date.now() - ms) / 1000); return s < 60 ? s + " s ago" : Math.round(s / 60) + " min ago"; }
  async function selfCheck(req) {
    var items = [], me = CU.config && CU.config() && CU.config().name || (CU.edition() === "usage" ? "This device" : "This computer");
    function add(group, key, label, status, detail, fix) { items.push({ group: group, key: key, label: label, status: status, detail: detail || "", fix: fix || "" }); }
    // the key and the sound plans
    var L = window.PPLicense;
    if (L && L.state) {
      var st = L.state() || {}, ok = L.licensed && L.licensed();
      if (!ok) add("keys", "key", me + ": key", "bad", st.blocked ? "This key was switched off" : st.key ? "The key isn't working" : "No key", "Settings → Key on " + me + ": add the church's key.");
      else {
        var exp = st.expiresAt ? new Date(st.expiresAt).getTime() : 0, days = exp ? Math.ceil((exp - Date.now()) / 86400000) : null;
        add("keys", "key", me + ": key", days != null && days <= 14 ? "warn" : "ok", (st.isDefault ? "Built-in default key" : "Key works") + (st.production ? " · " + st.production : "") + (days != null ? " · trial ends in " + days + " days" : ""), days != null && days <= 14 ? "Buy a key on the Motion Audio website before the trial ends." : "");
      }
      var pks = (L.packages && L.packages()) || [], plans = {};
      pks.forEach(function (p) { Object.keys(p.plans || {}).forEach(function (id) { var t = new Date(p.plans[id]).getTime(); if (!plans[id] || t > plans[id]) plans[id] = t; }); });
      var ids = Object.keys(plans);
      if (ids.length) {
        var soon = ids.filter(function (id) { return plans[id] - Date.now() < 14 * 86400000; }), gone = ids.filter(function (id) { return plans[id] < Date.now(); });
        add("keys", "plans", me + ": sound plans", gone.length ? "bad" : soon.length ? "warn" : "ok", ids.map(function (id) { return (L.planName ? L.planName(id) : id) + " until " + new Date(plans[id]).toLocaleDateString(); }).join(" · "),
          gone.length ? "Renew " + gone.map(function (id) { return L.planName ? L.planName(id) : id; }).join(", ") + " on the website: its sounds are locked." : soon.length ? "Renew " + soon.map(function (id) { return L.planName ? L.planName(id) : id; }).join(", ") + " soon." : "");
      }
    }
    // free disk space, Wi-Fi, a newer version (the app)
    var sys = null; try { if (NAT && NAT.sysCheck) { var rs = NAT.recorder && NAT.recorder.state ? await NAT.recorder.state().catch(function () { return null; }) : null; sys = await NAT.sysCheck({ dir: rs && (rs.dir || (rs.state && rs.state.dir)) || "" }); } } catch (_) { sys = null; }
    if (sys && sys.disk) {
      var free = sys.disk.free, recHere = isHost();
      var need = recHere ? 20 * 1073741824 : 2 * 1073741824;   // (a multitrack recording of a service: about 10-20 GB)
      add("recording", "disk", me + ": disk space", free < need / 4 ? "bad" : free < need ? "warn" : "ok", gb(free) + " GB free" + (recHere ? " where recordings go" : ""), free < need ? "Free up space on " + me + (recHere ? ": a service's multitrack recording needs 10 to 20 GB." : ".") : "");
    }
    if (sys && sys.net) {
      var n = sys.net;
      if (n.wired) add("network", "net", me + ": network", "ok", "Wired (Ethernet)");
      else if (n.wifi && n.signal != null) add("network", "net", me + ": Wi-Fi", n.signal < 35 ? "bad" : n.signal < 55 ? "warn" : "ok", (n.ssid ? n.ssid + " · " : "") + "signal " + n.signal + "%", n.signal < 55 ? "Move " + me + " closer to the Wi-Fi, or use a network cable." : "");
    } else if (navigator.connection && navigator.connection.effectiveType && CU.web) add("network", "net", me + ": network", /2g|slow/.test(navigator.connection.effectiveType) ? "warn" : "ok", navigator.connection.effectiveType);
    if (sys && sys.update && sys.update.available) add("devices", "update", me + ": update", "warn", "Version " + sys.update.latest + " is out (this is " + sys.app + ")", "Settings → Updates → Install on " + me + " (not during the service).");
    // sound and inputs: on the audio host
    if (isHost()) {
      watchMeters();
      var X = window.CUMix, ms = X.state || { inputs: [] }, used = [];
      ms.inputs.forEach(function (x, i) { if (x.src && x.src.kind === "in" && x.fader > -90 && !x.mute) used.push(i); });
      if (req && req.tone && NAT && NAT.mixer && NAT.mixer.testTone && used.length) {
        var i0 = used[0], before = seen.main;
        await NAT.mixer.testTone({ on: true, ch: ms.inputs[i0].src.ch, level: 0.06 }); await sleep(1200); await NAT.mixer.testTone({ on: false, ch: ms.inputs[i0].src.ch });
        var heard = seen.main > before && Date.now() - seen.main < 3000;
        add("sound", "tone", "Test tone to the main outputs", heard ? "ok" : "bad", heard ? "A 1 kHz tone through “" + (ms.inputs[i0].name || "Input " + (i0 + 1)) + "” reached the main outputs" : "The tone didn't reach the main outputs", heard ? "" : "Check the main fader isn't down and the main outputs are set on the I/O tab.");
      } else if (seen.main && Date.now() - seen.main < 10 * 60000) add("sound", "main", "Main outputs", "ok", "Sound went out " + ago(seen.main));
      else add("sound", "main", "Main outputs", "warn", "No sound has gone out yet", "Play something, or turn on “Play a test tone” and Check again.");
      if (ms.main && ms.main.mute) add("sound", "mainmute", "Main outputs", "bad", "The main mix is muted", "Unmute the main mix on the Online mix tab.");
      var mics = ms.inputs.map(function (x, i) { return { x: x, i: i }; }).filter(function (o) { return o.x.src && o.x.src.kind === "in" && o.x.group !== "tracks" && o.x.fader > -90; });
      if (mics.length) {
        var live = mics.filter(function (o) { return seen.inputs[o.i] && Date.now() - seen.inputs[o.i] < 5 * 60000; }), quiet = mics.filter(function (o) { return live.indexOf(o) < 0; });
        add("inputs", "inputs", "Inputs with signal", !live.length ? "warn" : quiet.length ? "warn" : "ok", live.length + " of " + mics.length + " have signal" + (quiet.length ? " · silent: " + quiet.slice(0, 8).map(function (o) { return o.x.name || "Input " + (o.i + 1); }).join(", ") : ""),
          quiet.length ? "Turn on the wireless mics and have each person say a few words, then Check again." : "");
      }
    }
    // lights
    if (doing("lights") && NAT && NAT.dmx && CU.runs("lights") !== false) {
      try {
        var d1 = await NAT.dmx.status(); await sleep(600); var d2 = await NAT.dmx.status();
        var fixtures = window.CULights && window.CULights.rig ? (window.CULights.rig().fixtures || []).length : 0;
        if (!d1 || d1.mode === "off") add("lights", "dmx", "Lights output (DMX)", fixtures ? "bad" : "warn", "No DMX output is set up" + (fixtures ? " (" + fixtures + " lights in the rig)" : ""), "Lighting → Outputs: pick the USB-DMX interface or Art-Net / sACN.");
        else if (d2.error) add("lights", "dmx", "Lights output (DMX)", "bad", d2.error, "Check the DMX interface's cable, or the Art-Net node's network.");
        else add("lights", "dmx", "Lights output (DMX)", d2.frames > d1.frames ? "ok" : "warn", (d2.target || d2.mode) + (d2.frames > d1.frames ? " · sending" : " · not sending") + " · " + fixtures + " lights", d2.frames > d1.frames ? "" : "Open the Lighting tab so the lights are sent.");
      } catch (_) { }
    }
    // cameras and NDI
    var V = window.CUVideoTab;
    if (doing("cameras") && V && V.state && V.state.cfg) {
      var srcs = (V.state.cfg.sources || []).filter(function (s) { return s.id !== (V.state.init && V.state.init.slidesId); });
      if (srcs.length) {
        var s0 = JSON.parse(JSON.stringify(V.seen || {})); await sleep(1500); var s1 = V.seen || {};
        var on = srcs.filter(function (s) { return (s1[s.id] || 0) > (s0[s.id] || 0); }), off = srcs.filter(function (s) { return on.indexOf(s) < 0; });
        add("cameras", "cams", "Cameras", off.length ? (on.length ? "warn" : "bad") : "ok", on.length + " of " + srcs.length + " live" + (off.length ? " · no picture: " + off.map(function (s) { return s.name; }).join(", ") : ""), off.length ? "Check each camera without a picture is on, and its cable or network (NDI / SRT)." : "");
      } else add("cameras", "cams", "Cameras", "info", "No cameras set up on " + me);
      var dests = V.state.cfg.destinations || [], onD = dests.filter(function (x) { return x.on; });
      if (doing("stream") || doing("cameras")) {
        if (!dests.length) add("stream", "stream", "Live stream", "info", "No stream destinations set up");
        else {
          var noKey = onD.filter(function (x) { return x.kind !== "srt" && !x.key; });
          add("stream", "stream", "Live stream", noKey.length ? "bad" : onD.length ? "ok" : "warn", onD.length + " of " + dests.length + " destinations on" + (noKey.length ? " · no stream key: " + noKey.map(function (x) { return x.name || x.kind; }).join(", ") : ""),
            noKey.length ? "Video → Stream: paste the stream key from YouTube / Facebook." : onD.length ? "" : "Video → Stream: switch on where today's stream goes.");
        }
      }
    }
    // screens and outputs: the computer running lyrics / slides
    if ((doing("lyrics") || doing("slides")) && NAT && NAT.slides && NAT.slides.screens) {
      try {
        var scr = await NAT.slides.screens(), outs = NAT.slides.outputs ? await NAT.slides.outputs() : {};
        add("screens", "screens", me + ": screens", scr.length < 2 ? "warn" : "ok", scr.length + " screen" + (scr.length === 1 ? "" : "s") + " connected" + (outs && outs.screen ? " · lyrics / slides output on" : " · output off") + (outs && outs.ndi && outs.ndi.on ? " · NDI on" : ""),
          scr.length < 2 ? "Connect the projector or TV (HDMI) to " + me + "." : outs && !outs.screen && !(outs.ndi && outs.ndi.on) ? "Slides → turn on the output to the screen." : "");
        var C = window.CUConfidence; if (C && C.status) { var cs = C.status(); add("screens", "confidence", "Band's screen (confidence monitor)", cs.on ? "ok" : "info", cs.text); }
      } catch (_) { }
    }
    // today's run sheet and its songs (the main admin)
    if (CU.role() === "main") songChecks(req && req.service, add);
    return items;
  }
  function songChecks(sv, add) {
    var S = window.CUServices && window.CUServices.state(), d = CU.state.display, list = (d && d.songs) || [];
    if (!sv) { add("songs", "sheet", "Run sheet", (S && S.services.length) ? "info" : "warn", (S && S.services.length) ? "No service in the next hours" : "No run sheet yet", (S && S.services.length) ? "" : "Service tab → New run sheet."); return; }
    var at = window.CUCountdown ? window.CUCountdown.nextStart(sv, Date.now()) : 0;
    add("songs", "sheet", "Run sheet", "ok", sv.name + (at ? " · starts " + new Date(at).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "") + " · " + sv.items.length + " items");
    var wants = sv.items.filter(function (it) { return it.kind === "song" && (it.song || (it.cues && it.cues.song)); });
    if (!wants.length) return;
    if (!CU.state.connected) { add("songs", "player", "Track player", "bad", "Not connected", "Open the player window, or switch on the Central Pedal that plays the tracks."); return; }
    var missing = [], noTracks = [], noLyrics = [];
    wants.forEach(function (it) { var ref = it.song || it.cues.song, q = list.filter(function (x) { return x.id === ref || x.name === ref; })[0]; if (!q) missing.push(it.title); else { if (q.hasTracks === false) noTracks.push(q.name); if (q.hasLyrics === false) noLyrics.push(q.name); } });
    add("songs", "songs", "Songs on the track player", missing.length ? "bad" : noTracks.length ? "warn" : "ok", (wants.length - missing.length) + " of " + wants.length + " in the setlist" + (missing.length ? " · missing: " + missing.join(", ") : "") + (noTracks.length ? " · no tracks: " + noTracks.join(", ") : ""),
      missing.length ? "Load the setlist on the track player, or download the missing songs." : noTracks.length ? "Download the tracks for those songs (Central Tracks), or play them live." : "");
    if (noLyrics.length) add("songs", "lyrics", "Lyrics", "warn", "No lyrics: " + noLyrics.join(", "), "Add lyrics in the song editor, or “Listen & write” from the vocal.");
    else add("songs", "lyrics", "Lyrics", "ok", "Every song has lyrics");
  }
  CU.on("message", function (m) {
    if (m.type === "precheckRequest") { selfCheck(m).then(function (items) { CU.send({ type: "precheck", action: "report", id: m.id, items: items }); }).catch(function (e) { CU.send({ type: "precheck", action: "report", id: m.id, items: [{ group: "other", key: "error", label: "This computer's check", status: "warn", detail: String(e && e.message || e), fix: "" }] }); }); return; }
    if (CU.role() !== "main") return;
    if (m.type === "precheck") { P.state = m; if (m.full) P.history = m.history; if (m.last && (!P.result || P.result.id !== m.last.id)) P.result = m.last; P.running = !!m.running; paint(); CU.fire("precheck", counts()); }
    else if (m.type === "precheckResult") { P.result = m.result; P.viewing = null; P.running = false; P.history = null; paint(); CU.fire("precheck", counts()); if (m.alert && m.result.auto) alertTeam(m.result); else if (m.alert && document.hidden) notify(m.result); }
    else if (m.type === "precheckReply" && !m.ok && window.CURoles) window.CURoles.toast(m.error || "Not done.");
  });
  function counts() { var r = P.result; return r ? r.counts : null; }
  CU.on("center", function (on) { if (on && CU.role() === "main") setTimeout(function () { CU.send({ type: "precheck", action: "get" }); }, 1200); });

  // ------------------------------------------------------------- the alert: a notice here, and the church's main admins by email
  function summary(r) { var bad = r.items.filter(function (x) { return x.status === "bad"; }); return bad.slice(0, 6).map(function (x) { return "• " + x.label + ": " + x.detail + (x.fix ? " - " + x.fix : ""); }).join("\n"); }
  function notify(r) {
    try { if (window.Notification && Notification.permission !== "denied") { var go = function () { new Notification("Pre-service check: " + r.counts.bad + " problem" + (r.counts.bad === 1 ? "" : "s"), { body: summary(r).slice(0, 240) }); }; if (Notification.permission === "granted") go(); else Notification.requestPermission().then(function (p) { if (p === "granted") go(); }); } } catch (_) { }
  }
  async function alertTeam(r) {
    notify(r);
    var L = window.PPLicense, base = L && L.server && L.server();
    if (!base) return;   // (the website isn't open yet: the notice on this computer is all)
    try {
      var st = L.state() || {};
      await fetch(base + "/v1/church/alert", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: st.key, device: L.deviceId(), kind: "precheck",
        subject: "Pre-service check: " + r.counts.bad + " problem" + (r.counts.bad === 1 ? "" : "s") + (r.service ? " before " + r.service.name : ""), text: summary(r), service: r.service ? r.service.name : "", at: r.at }) });
    } catch (_) { }
  }

  // ------------------------------------------------------------- the main admin's view
  var el = null;
  function render(root) { el = root || el; if (!el) return; paint(); }
  function line(x) {
    return '<li class="pc-line ' + x.status + '"><i class="pc-dot" aria-label="' + ({ ok: "good", warn: "check this", bad: "problem", info: "note" }[x.status] || "") + '"></i><div><b>' + esc(x.label) + '</b> <span class="pc-detail">' + esc(x.detail) + "</span>" +
      (x.fix ? '<div class="pc-fix">' + esc(x.fix) + "</div>" : "") + (x.from && x.from !== "center" ? '<small class="muted">from ' + esc(x.from) + "</small>" : "") + "</div></li>";
  }
  function paint() {
    if (!el || !document.body.contains(el)) return;
    var a = document.activeElement; if (el.contains(a) && a.tagName === "INPUT" && a.type === "number") return;
    var st = P.state || {}, set = st.settings || { auto: true, lead: 30, tone: false, alert: true }, r = P.viewing || P.result;
    var h = '<div class="pc"><div class="pc-head card"><div class="pc-sum">' +
      (P.running ? '<b class="pc-big">Checking everything…</b><span class="muted">asking every computer, phone and pedal</span>' :
        r ? '<b class="pc-big ' + (r.counts.bad ? "bad" : r.counts.warn ? "warn" : "ok") + '">' + (r.counts.bad ? r.counts.bad + " problem" + (r.counts.bad === 1 ? "" : "s") : r.counts.warn ? r.counts.warn + " to check" : "All good") + "</b><span class=\"muted\">" + (P.viewing ? "A past check: " : "Checked ") + new Date(r.at).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" }) + (r.auto ? " (by itself)" : "") + (r.service ? " · for " + esc(r.service.name) : "") + " · " + r.counts.ok + " good, " + r.counts.warn + " to check, " + r.counts.bad + " problems</span>" :
          '<b class="pc-big">Not checked yet</b><span class="muted">Press Check now about half an hour before the service.</span>') +
      '</div><div class="row"><button class="primary" data-pc="run"' + (P.running ? " disabled" : "") + ">" + (r ? "Check again" : "Check now") + "</button>" + (P.viewing ? '<button data-pc="latest">Back to the latest</button>' : "") + "</div>" +
      '<div class="row pc-set"><label class="toggle"><input type="checkbox" data-pcs="auto"' + (set.auto ? " checked" : "") + '> Run by itself</label><label><input type="number" min="5" max="180" data-pcs="lead" value="' + set.lead + '" style="width:64px"> minutes before each service</label>' +
      '<label class="toggle" title="A short, quiet 1 kHz beep through the mixer to the main outputs"><input type="checkbox" data-pcs="tone"' + (set.tone ? " checked" : "") + "> Play a test tone</label>" +
      '<label class="toggle"><input type="checkbox" data-pcs="alert"' + (set.alert ? " checked" : "") + "> Alert me when something's red</label></div></div>";
    if (r) {
      var order = ["bad", "warn", "ok", "info"];
      GROUPS.forEach(function (g) {
        var list = r.items.filter(function (x) { return (x.group || "other") === g[0] || (g[0] === "other" && !GROUPS.some(function (q) { return q[0] === x.group; })); });
        if (!list.length) return;
        list.sort(function (x, y) { return order.indexOf(x.status) - order.indexOf(y.status); });
        var worst = list[0].status;
        h += '<section class="pc-group ' + worst + '"><h4>' + esc(g[1]) + "</h4><ul>" + list.map(line).join("") + "</ul></section>";
      });
    }
    var hist = (st.history || []).slice(0, 12);
    if (hist.length > 1) h += '<section class="pc-hist card"><h4>Past checks</h4><div class="pc-hlist">' + hist.map(function (x) { return '<button class="mini' + (r && r.id === x.id ? " on" : "") + '" data-pc-h="' + esc(x.id) + '"><span class="pc-mini ' + (x.counts.bad ? "bad" : x.counts.warn ? "warn" : "ok") + '"></span>' + new Date(x.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) + (x.auto ? " · auto" : "") + "</button>"; }).join("") + "</div></section>";
    el.innerHTML = h + "</div>";
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest(".pc button"); if (!b) return;
    if (b.dataset.pc === "run") { P.running = true; P.viewing = null; paint(); CU.send({ type: "precheck", action: "run" }); return; }
    if (b.dataset.pc === "latest") { P.viewing = null; paint(); return; }
    if (b.dataset.pcH) {
      var id = b.dataset.pcH, full = (P.history || []).filter(function (x) { return x.id === id; })[0];
      if (full) { P.viewing = full; paint(); return; }
      CU.send({ type: "precheck", action: "get", full: true });
      var once = function (m) { if (m.type === "precheck" && m.full) { P.viewing = (m.history || []).filter(function (x) { return x.id === id; })[0] || null; paint(); } };
      CU.on("message", once);   // (a few listeners pile up over a long day: harmless)
    }
  });
  document.addEventListener("change", function (e) {
    var t = e.target; if (!t.dataset || !t.dataset.pcs || !t.closest(".pc")) return;
    var s = {}; s[t.dataset.pcs] = t.type === "checkbox" ? t.checked : Number(t.value);
    CU.send({ type: "precheck", action: "settings", settings: s });
  });
  window.CUPrecheck = { render: render, refresh: function () { CU.send({ type: "precheck", action: "get" }); }, counts: counts, selfCheck: selfCheck, result: function () { return P.result; }, songChecks: songChecks };
})();
