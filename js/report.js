/* Central Pedal - the service report. While the app runs it writes down what happens - songs loaded, played,
 * stopped or played to the end, the sections that played, jumps, Vamp, Safe Stop, the service lock, audio dropouts,
 * and the Pi's temperature and power every minute while playing - and the driver keeps it per day
 * (<data>/service-log/YYYY-MM-DD.jsonl). LIVE → 📋 Report shows a day: what played and when, how long, what was
 * skipped or stopped early, dropouts, the hottest temperature (°F), and every event; Download saves it as text. */
(function () {
  "use strict";
  var PP = window.PP, F = window.PPFeatures; if (!PP || !F) return;
  var engine = PP.engine, esc = PP.escapeHtml;
  function $(s, r) { return (r || document).querySelector(s); }
  function T() { return window.PPTracks; }
  function project() { return PP.project(); }
  function bridge() { return window.__pedalBridge; }
  function connected() { return !!(bridge() && bridge().connected); }
  function fmt(t) { t = Math.max(0, Math.round(t || 0)); var m = Math.floor(t / 60), s = t % 60; return m + ":" + (s < 10 ? "0" : "") + s; }
  function f(c) { return Math.round(c * 9 / 5 + 32); }   // °F

  // ------------------------------------------------------------- writing it down
  var queue = [], flushTimer = 0;
  function song() { var p = project(); return p.songs[p.songIndex] || null; }
  function songInfo() { var s = song(); return s ? { song: s.name, key: s.key || "", bpm: s.bpm || 0, n: project().songIndex + 1 } : {}; }
  function log(kind, extra) {
    queue.push(Object.assign({ kind: kind, t: Date.now() / 1000 }, songInfo(), extra || {}));
    if (queue.length > 600) queue.splice(0, queue.length - 600);
    clearTimeout(flushTimer); flushTimer = setTimeout(flush, 400);
  }
  function flush() { if (!queue.length || !connected()) return; if (F.sendToDriver({ type: "serviceLog", action: "add", events: queue.slice(0, 200) }) !== false) queue.splice(0, 200); if (queue.length) flushTimer = setTimeout(flush, 400); }

  function secName(s, pos) { if (!s || !T()) return ""; var x = T().sectionAt(s, Math.max(0, pos || 0)); return x && x.sec ? x.sec.name || "" : ""; }
  var last = { playing: false, section: -1, loop: -1, pos: 0, wall: 0, ended: false, songId: null }, ctxLast = null, statsLast = null, healthAt = 0;
  function watch() {
    var t = T(); if (!t) return;
    var st = t.state, s = song(), now = performance.now(), sid = s ? s.id || s.name : null;
    if (sid !== last.songId) { last = { playing: st.playing, section: st.section, loop: st.loop, pos: st.pos, wall: now, ended: st.ended, songId: sid }; return; }
    if (st.playing && !last.playing) log("play", { pos: round(st.pos), section: secName(s, st.pos) });
    else if (!st.playing && last.playing) log(st.ended ? "end" : "stop", { pos: round(st.pos), section: secName(s, last.pos) });
    var jumped = false;
    if (st.playing && last.playing && last.wall) {
      var expect = (now - last.wall) / 1000 * (t.state.rate || 1), moved = st.pos - last.pos;
      if (moved < -1.5 || moved - expect > 2.5) { jumped = true; log("jump", { from: round(last.pos), pos: round(st.pos), section: secName(s, st.pos) }); }
    }
    if (st.playing && st.section !== last.section && st.section >= 0 && !jumped) log("section", { section: secName(s, st.pos), pos: round(st.pos) });
    if (st.loop !== last.loop) log("vamp", { on: st.loop >= 0, section: st.loop >= 0 ? secName(s, st.pos) : "" });
    last = { playing: st.playing, section: st.section, loop: st.loop, pos: st.pos, wall: now, ended: st.ended, songId: sid };
    // audio dropouts: the sound card's clock stops while the wall clock goes on (an underrun)
    var ctx = engine.ctx, busy = st.playing || engine.voices().length > 0;
    if (ctx && ctx.state === "running") {
      if (ctxLast && busy) {
        var dWall = (now - ctxLast.wall) / 1000, dCtx = ctx.currentTime - ctxLast.ctx;
        if (dWall < 2 && dWall - dCtx > 0.08) log("dropout", { ms: Math.round((dWall - dCtx) * 1000), pos: round(st.pos) });
        var ps = ctx.playbackStats; if (ps && statsLast != null && ps.underrunEvents > statsLast) log("dropout", { count: ps.underrunEvents - statsLast, pos: round(st.pos) });
      }
      ctxLast = { wall: now, ctx: ctx.currentTime }; statsLast = ctx.playbackStats ? ctx.playbackStats.underrunEvents : null;
    } else ctxLast = null;
    if ((busy || (window.PPLive && window.PPLive.locked())) && now - healthAt > 60000) { healthAt = now; log("health"); }
  }
  function round(x) { return Math.round((x || 0) * 10) / 10; }
  if (F.onSong) F.onSong(function (s, i) { if (s) log("song", { song: s.name, key: s.key || "", bpm: s.bpm || 0, n: i + 1 }); });
  F.on("hello", function () { setTimeout(flush, 300); });
  setInterval(function () { try { watch(); } catch (error) { console.warn("report", error); } }, 250);

  // ------------------------------------------------------------- reading it back
  function build(events) {
    var songs = [], cur = null, out = { songs: songs, events: events, playing: 0, stops: 0, safeStops: 0, panics: 0, dropouts: 0, jumps: 0, vamps: 0, hottest: null, power: 0, lockFrom: null, lockTo: null, first: null, last: null };
    function close(ev, how) { if (!cur) return; cur.seconds += Math.max(0, ev.t - cur.since); cur.how = how; cur.endPos = ev.pos; out.playing += Math.max(0, ev.t - cur.since); cur = null; }
    events.forEach(function (ev) {
      if (ev.tempC != null && (out.hottest == null || ev.tempC > out.hottest)) out.hottest = ev.tempC;
      if (ev.underVoltage) out.power++;
      switch (ev.kind) {
        case "play":
          if (cur && cur.song !== ev.song) close(ev, "changed song");
          if (!cur) {
            var prev = songs[songs.length - 1];
            if (prev && prev.song === ev.song && prev.how !== "played to the end") cur = prev; else { cur = { song: ev.song, key: ev.key, bpm: ev.bpm, n: ev.n, start: ev.t, seconds: 0, sections: [], jumps: 0, vamps: 0, dropouts: 0, how: "" }; songs.push(cur); }
            cur.since = ev.t; if (ev.section) addSec(cur, ev.section);
          }
          if (out.first == null) out.first = ev.t; break;
        case "section": if (cur) addSec(cur, ev.section); break;
        case "jump": out.jumps++; if (cur) { cur.jumps++; addSec(cur, ev.section); } break;
        case "vamp": if (ev.on) { out.vamps++; if (cur) cur.vamps++; } break;
        case "stop": out.stops++; close(ev, "stopped at " + fmt(ev.pos)); out.last = ev.t; break;
        case "end": close(ev, "played to the end"); out.last = ev.t; break;
        case "safeStop": out.safeStops++; if (cur) cur.safe = true; break;
        case "panic": out.panics++; break;
        case "dropout": out.dropouts += ev.count || 1; if (cur) cur.dropouts += ev.count || 1; break;
        case "lock": if (out.lockFrom == null) out.lockFrom = ev.t; break;
        case "unlock": out.lockTo = ev.t; break;
        case "song": if (cur && cur.song !== ev.song) close(ev, "changed song"); break;
      }
    });
    if (cur) { var e = events[events.length - 1]; close(e, "still playing"); }
    songs.forEach(function (x) { if (x.safe && /^stopped/.test(x.how)) x.how = "safe stop at " + fmt(x.endPos); });
    return out;
  }
  function addSec(cur, name) { if (!name) return; if (cur.sections[cur.sections.length - 1] !== name) cur.sections.push(name); }
  function clock(t) { var d = new Date(t * 1000); return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }); }
  function clockShort(t) { var d = new Date(t * 1000); return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
  function describe(ev) {
    var s = ev.song ? "“" + ev.song + "”" : "";
    switch (ev.kind) {
      case "song": return "Loaded " + s + (ev.key ? " (" + ev.key + ", " + ev.bpm + " BPM)" : "");
      case "play": return "▶ Play " + s + (ev.pos > 0.5 ? " from " + fmt(ev.pos) : "") + (ev.section ? " · " + ev.section : "");
      case "stop": return "■ Stopped " + s + " at " + fmt(ev.pos) + (ev.section ? " (" + ev.section + ")" : "");
      case "end": return "✓ " + s + " played to the end";
      case "section": return "· " + ev.section;
      case "jump": return "↷ Jumped " + fmt(ev.from) + " → " + fmt(ev.pos) + (ev.section ? " (" + ev.section + ")" : "");
      case "vamp": return ev.on ? "⟲ Vamp on " + (ev.section || "") : "⟲ Vamp off";
      case "safeStop": return "■ Safe Stop";
      case "panic": return "✕ Cut everything (panic)";
      case "lock": return "🔒 Service lock on";
      case "unlock": return "🔓 Unlocked";
      case "dropout": return "⚠ Audio dropout" + (ev.ms ? " (" + ev.ms + " ms)" : "") + (ev.count > 1 ? " ×" + ev.count : "");
      case "health": return "Pi " + (ev.tempC != null ? f(ev.tempC) + "°F" : "") + (ev.underVoltage ? " · LOW POWER" : "") + (ev.throttled ? " · slowed down" : "");
      case "ready": return "Ready check: " + (ev.summary || "");
      case "segue": return "Segue into " + s;
      default: return ev.kind;
    }
  }
  function text(day, r) {
    var lines = ["Service report - " + day, ""];
    lines.push("Songs played: " + r.songs.length + "   Playing time: " + fmt(r.playing) + (r.first ? "   From " + clockShort(r.first) + " to " + clockShort(r.last || r.first) : ""));
    lines.push("Stopped early: " + r.songs.filter(function (x) { return !/end|still/.test(x.how); }).length + "   Safe stops: " + r.safeStops + "   Jumps: " + r.jumps + "   Vamps: " + r.vamps + "   Audio dropouts: " + r.dropouts + (r.hottest != null ? "   Hottest: " + f(r.hottest) + "°F" : "") + (r.power ? "   LOW POWER seen " + r.power + "×" : ""));
    lines.push("");
    r.songs.forEach(function (x, i) { lines.push((i + 1) + ". " + clockShort(x.start) + "  " + x.song + (x.key ? " (" + x.key + ", " + x.bpm + " BPM)" : "") + " - " + fmt(x.seconds) + " - " + x.how + (x.dropouts ? " - " + x.dropouts + " dropout(s)" : "")); if (x.sections.length) lines.push("     " + x.sections.join(" → ")); });
    lines.push("", "Everything:");
    r.events.forEach(function (ev) { if (ev.kind !== "health" || ev.underVoltage) lines.push(clock(ev.t) + "  " + describe(ev)); });
    return lines.join("\n");
  }

  var days = [], dayNow = "", report = null, box = null;
  function open() {
    flush();
    if (!box) { box = document.createElement("div"); box.id = "lvReport"; box.className = "lv-ready lv-report"; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "Service report"); document.body.appendChild(box); box.addEventListener("click", onClick); box.addEventListener("change", onChange); }
    box.classList.remove("hidden");
    box.innerHTML = '<div class="lv-ready-box"><p class="muted">Loading the report…</p></div>';
    if (!connected()) { box.innerHTML = '<div class="lv-ready-box"><div class="row spread"><h2>Service report</h2><button data-rp="close">Close</button></div><p class="muted">The report is kept by the Central Pedal - connect to it first.</p></div>'; return; }
    setTimeout(function () { F.sendToDriver({ type: "serviceLog", action: "days" }); }, 450);
  }
  F.on("serviceLogDays", function (m) {
    days = m.days || []; if (!box || box.classList.contains("hidden")) return;
    if (!days.length) { report = null; dayNow = ""; draw(); return; }
    if (!dayNow || !days.some(function (d) { return d.day === dayNow; })) { var withSongs = days.filter(function (d) { return d.songs > 0; })[0]; dayNow = (withSongs || days[0]).day; }
    F.sendToDriver({ type: "serviceLog", action: "get", day: dayNow });
  });
  F.on("serviceLogDay", function (m) { if (m.day !== dayNow) return; report = build(m.events || []); draw(); });
  function dayLabel(d) { var p = d.split("-"), dt = new Date(+p[0], +p[1] - 1, +p[2]); return dt.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" }); }
  function draw() {
    if (!box) return;
    var r = report, head = '<div class="row spread"><h2>📋 Service report</h2><span class="row">' +
      (days.length ? '<select data-rp="day" aria-label="Day">' + days.map(function (d) { return '<option value="' + d.day + '"' + (d.day === dayNow ? " selected" : "") + ">" + esc(dayLabel(d.day)) + (d.songs ? " · " + d.songs + " plays" : "") + "</option>"; }).join("") + "</select>" : "") +
      (r ? '<button data-rp="download">⬇ Download</button>' : "") + '<button data-rp="close">Close</button></span></div>';
    if (!r) { box.innerHTML = '<div class="lv-ready-box">' + head + '<p class="muted">Nothing written down yet. From now on every service is.</p></div>'; return; }
    var early = r.songs.filter(function (x) { return !/end|still/.test(x.how); }).length;
    var tile = function (big, small, cls) { return '<div class="rp-tile ' + (cls || "") + '"><b>' + big + "</b><small>" + small + "</small></div>"; };
    box.innerHTML = '<div class="lv-ready-box">' + head +
      '<div class="rp-tiles">' + tile(r.songs.length, "songs played") + tile(fmt(r.playing), "playing time") + tile(r.first ? clockShort(r.first) + "–" + clockShort(r.last || r.first) : "–", "first to last") +
      tile(early, "stopped early", early ? "warn" : "") + tile(r.safeStops, "safe stops") + tile(r.dropouts, "audio dropouts", r.dropouts ? "bad" : "good") +
      tile(r.hottest != null ? f(r.hottest) + "°F" : "–", "hottest", r.hottest >= 80 ? "bad" : r.hottest >= 70 ? "warn" : "") + (r.power ? tile(r.power + "×", "low power", "bad") : "") + "</div>" +
      (r.songs.length ? '<table class="rp-songs"><thead><tr><th>#</th><th>Time</th><th>Song</th><th>Played</th><th>How it ended</th></tr></thead><tbody>' + r.songs.map(function (x, i) {
        return "<tr><td>" + (i + 1) + "</td><td>" + clockShort(x.start) + "</td><td><b>" + esc(x.song || "") + "</b>" + (x.key ? ' <small>' + esc(x.key) + " · " + x.bpm + " BPM</small>" : "") +
          (x.sections.length ? '<div class="rp-secs">' + x.sections.map(esc).join(" → ") + "</div>" : "") + "</td><td>" + fmt(x.seconds) + "</td><td class=\"" + (/end/.test(x.how) ? "ok" : /safe|stopped|changed/.test(x.how) ? "warn" : "") + '">' + esc(x.how) +
          (x.jumps ? "<small> · " + x.jumps + " jump" + (x.jumps > 1 ? "s" : "") + "</small>" : "") + (x.vamps ? "<small> · vamp ×" + x.vamps + "</small>" : "") + (x.dropouts ? '<small class="bad"> · ' + x.dropouts + " dropout" + (x.dropouts > 1 ? "s" : "") + "</small>" : "") + "</td></tr>";
      }).join("") + "</tbody></table>" : '<p class="muted">No songs were played this day.</p>') +
      '<details class="rp-all"><summary>Everything that happened (' + r.events.length + ")</summary><ol>" + r.events.filter(function (ev) { return ev.kind !== "health" || ev.underVoltage || ev.throttled; }).map(function (ev) { return '<li class="k-' + ev.kind + '"><time>' + clock(ev.t) + "</time> " + esc(describe(ev)) + "</li>"; }).join("") + "</ol></details></div>";
  }
  function onChange(e) { if (e.target.dataset.rp === "day") { dayNow = e.target.value; report = null; box.querySelector(".rp-tiles") && (box.querySelector(".rp-tiles").style.opacity = ".4"); F.sendToDriver({ type: "serviceLog", action: "get", day: dayNow }); } }
  function onClick(e) {
    var b = e.target.closest && e.target.closest("[data-rp]"); if (!b || b.tagName === "SELECT") { if (e.target === box) box.classList.add("hidden"); return; }
    if (b.dataset.rp === "close") box.classList.add("hidden");
    else if (b.dataset.rp === "download" && report) {
      var blob = new Blob([text(dayNow, report)], { type: "text/plain" }), a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = "service-report-" + dayNow + ".txt"; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }
  }

  window.PPReport = { log: log, open: open, build: build, text: function () { return report ? text(dayNow, report) : ""; }, flush: flush, pending: function () { return queue.length; } };
})();
