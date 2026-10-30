/* Central Control - the countdown in the top bar, on every computer, personal to its role:
 *   before a service: "Sunday morning in 12:30 · Lights: Welcome at +0:00"
 *   during it:        "▶ Song 2 · 3:12 left · Lights: Sermon in 8:40" (or "you're on")
 * Its role's parts come from the Service tab (each item ticks the roles it uses): lighting, cameras, slides,
 * lyrics, mix, in-ears for admins (by their jobs), band for User 1 / User 2. Tap it for the whole run order.
 * A minute before its part it flashes and says so. The audio host also starts / stops recording a service that
 * has "Record it" on. */
(function () {
  "use strict";
  var CU = window.CentralUsage; if (!CU) return;
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var JOB_ROLES = { lights: ["lighting"], cameras: ["production"], tracks: ["mix"], stream: ["mix"], inears: ["inears"], slides: ["slides"], lyrics: ["lyrics"] };   // (10.0 jobs -> the service plan's roles)
  var NAMES = { lighting: "Lights", production: "Cameras", slides: "Slides", lyrics: "Lyrics", mix: "Mix", inears: "In-ears", band: "Band" };
  var warned = {}, lastRun = null, popOpen = false;
  function S() { return window.CUServices ? window.CUServices.state() : { services: [], run: null, offset: 0 }; }
  function fmt(sec) { return window.CUServices ? window.CUServices.fmt(sec) : String(Math.round(sec)); }
  function now() { return Date.now() + (S().offset || 0); }

  function myRoles() {
    var r = CU.role();
    if (r === "user1" || r === "user2") return ["band"];
    if (r === "admin" || r === "main") { var j = CU.jobs(); if (j[0] === "general") return ["lighting", "production", "slides", "lyrics", "mix", "inears"]; var out = []; j.forEach(function (x) { (JOB_ROLES[x] || []).forEach(function (y) { if (out.indexOf(y) < 0) out.push(y); }); }); return out; }
    return [];
  }
  function mine(it, roles) { return it.roles.filter(function (r) { return roles.indexOf(r) >= 0; }); }
  // the next time a service starts (its weekday and time, this week or next)
  function nextStart(sv, t) {
    var d = new Date(t), p = sv.time.split(":").map(Number), c = new Date(d.getFullYear(), d.getMonth(), d.getDate(), p[0], p[1], 0, 0);
    var add = (sv.day - d.getDay() + 7) % 7; c.setDate(c.getDate() + add);
    if (c.getTime() < t - 60000) c.setDate(c.getDate() + 7);
    return c.getTime();
  }
  // what to show: { text, cls, sv, at, mineIdx, curIdx }
  function compute() {
    var st = S(), roles = myRoles(), t = now();
    if (!st.services || !st.services.length || !CU.role()) return null;
    if (st.run) {
      var sv = st.services.filter(function (x) { return x.id === st.run.service; })[0]; if (!sv) return null;
      var i = st.run.item, it = sv.items[i] || {}, left = (it.minutes || 0) * 60 - (t - st.run.itemStart) / 1000;
      var o = { sv: sv, curIdx: i, running: true, left: left, cur: it };
      if (mine(it, roles).length) { o.mineIdx = i; o.until = 0; o.onNow = true; }
      else {
        var acc = Math.max(0, left);
        for (var j = i + 1; j < sv.items.length; j++) { if (mine(sv.items[j], roles).length) { o.mineIdx = j; o.until = acc; break; } acc += sv.items[j].minutes * 60; }
      }
      return o;
    }
    // not running: the soonest service that uses one of this computer's roles (or the soonest at all)
    var best = null;
    st.services.forEach(function (sv) {
      var at = nextStart(sv, t), uses = sv.roles.some(function (r) { return roles.indexOf(r) >= 0; });
      if (!best || (uses && !best.uses) || (uses === best.uses && at < best.at)) best = { sv: sv, at: at, uses: uses };
    });
    if (!best) return null;
    var o2 = { sv: best.sv, at: best.at, uses: best.uses, running: false }, acc2 = 0;
    for (var k = 0; k < best.sv.items.length; k++) { if (mine(best.sv.items[k], roles).length) { o2.mineIdx = k; o2.offset = acc2; break; } acc2 += best.sv.items[k].minutes * 60; }
    return o2;
  }
  function roleTag(it) { var m = mine(it, myRoles()).map(function (r) { return NAMES[r]; }); return m.length ? m.join(" + ") : ""; }
  function paint() {
    var el = $("#cdChip"); if (!el) return;
    var o = compute(); if (!o) { el.hidden = true; return; }
    var t = now(), txt = "", cls = "";
    if (o.running) {
      txt = "▶ " + esc(o.cur.title) + ' <b class="' + (o.left < 0 ? "over" : "") + '">' + fmt(o.left) + "</b>";
      if (o.onNow) { txt += ' · <span class="cd-you">you\'re on (' + esc(roleTag(o.cur)) + ")</span>"; cls = "on"; }
      else if (o.mineIdx != null) { var nx = o.sv.items[o.mineIdx]; txt += " · " + esc(roleTag(nx)) + ": " + esc(nx.title) + " in <b>" + fmt(o.until) + "</b>"; if (o.until <= 60) cls = "soon"; }
      else txt += ' · <span class="muted">nothing more for you</span>';
      alerts(o);
    } else {
      var secs = (o.at - t) / 1000, when = new Date(o.at), day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][when.getDay()];
      txt = "⏱ " + esc(o.sv.name) + (secs < 86400 ? " in <b>" + fmt(secs) + "</b>" : " · " + day + " " + esc(o.sv.time));
      if (!o.uses) txt += ' · <span class="muted">not needed</span>';
      else if (o.mineIdx != null && secs < 86400) { var it2 = o.sv.items[o.mineIdx]; txt += " · " + esc(roleTag(it2)) + ": " + esc(it2.title) + (o.offset ? " at +" + fmt(o.offset) : " first"); }
      if (secs < 300 && o.uses) cls = "soon";
    }
    if (el.innerHTML !== txt) el.innerHTML = txt;
    el.className = "cd-chip " + cls; el.hidden = false;
    if (popOpen) pop(true);
  }
  function alerts(o) {
    var key = o.sv.id + ":" + o.mineIdx;
    if (o.mineIdx != null && !o.onNow && o.until <= 60 && !warned[key]) { warned[key] = 1; toast("In 1 minute - " + roleTag(o.sv.items[o.mineIdx]) + ": " + o.sv.items[o.mineIdx].title); }
    if (o.onNow && !warned[key + "on"]) { warned[key + "on"] = 1; toast("You're on - " + roleTag(o.cur) + ": " + o.cur.title); }
  }
  function toast(t) { if (window.CURoles && window.CURoles.toast) window.CURoles.toast(t); }
  // the whole run order, this computer's parts marked
  function pop(refresh) {
    var o = compute(), p = $(".cd-pop");
    if (!o) { if (p) p.remove(); popOpen = false; return; }
    if (!p) { if (refresh) return; p = document.createElement("div"); p.className = "cd-pop"; document.body.appendChild(p); }
    var acc = 0, roles = myRoles();
    p.innerHTML = "<b>" + esc(o.sv.name) + "</b> <small class=\"muted\">" + (window.CUServices ? window.CUServices.DAYS[o.sv.day] : "") + " " + esc(o.sv.time) + "</small><table>" + o.sv.items.map(function (it, i) {
      var row = '<tr class="' + (o.running && i === o.curIdx ? "now " : "") + (mine(it, roles).length ? "mine" : "") + '"><td>+' + fmt(acc) + "</td><td>" + esc(it.title) + "</td><td>" + esc(roleTag(it)) + "</td><td>" + it.minutes + " min</td></tr>"; acc += it.minutes * 60; return row;
    }).join("") + "</table>";
    popOpen = true;
  }
  document.addEventListener("click", function (e) {
    if (e.target.closest && e.target.closest("#cdChip")) { if ($(".cd-pop")) { $(".cd-pop").remove(); popOpen = false; } else pop(false); return; }
    if (!(e.target.closest && e.target.closest(".cd-pop")) && $(".cd-pop")) { $(".cd-pop").remove(); popOpen = false; }
  });
  // recording a service: on the audio host, when a service with "Record it" starts / ends
  function recorder() { return (CU.recorder) || (window.CU && window.CU.recorder) || window.CURecorder || null; }
  CU.on("services", function (st) {
    var run = st.run, sv = run && st.services.filter(function (x) { return x.id === run.service; })[0], c = CU.config() || {}, rec = recorder();
    var host = c.host && c.host.enabled;
    if (rec && host) {
      if (sv && sv.record && (!lastRun || lastRun.service !== run.service || lastRun.startedAt !== run.startedAt)) { try { rec.start({ name: sv.name }); } catch (_) { } }
      if (!run && lastRun && lastRun.record) { try { rec.stop(); } catch (_) { } }
    }
    lastRun = run ? { service: run.service, startedAt: run.startedAt, record: !!(sv && sv.record) } : null;
    paint();
  });
  setInterval(paint, 1000);
  CU.on("role", paint);
  window.CUCountdown = { compute: compute, myRoles: myRoles, nextStart: nextStart, paint: paint };
})();
