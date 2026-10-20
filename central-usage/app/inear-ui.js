/* Central Control - the in-ear page for the people on stage (Central Control in User mode, and phones).
 * Pick a free mix (1-64), then set your own levels of the channels the sound desk routed to you.
 *   Local: your mix comes back over Wi-Fi to this device (headphones here) - a little delay
 *   Cloud: your levels go to the audio host, your mix leaves its audio interface (a wireless pack) - no delay
 * While someone at the desk talks into your mix (talkback), a small "🎙 <name> talking" note shows at the top.
 * CUInEarUI.mount(root, { url, code, name, id, sinkSelect: bool }) -> { destroy(), link } */
(function (root) {
  "use strict";
  var M = root.CUMixer, IE = root.CUInEar;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function db(v) { return v <= -90 ? "-∞" : (v > 0 ? "+" : "") + v.toFixed(1); }
  function mount(el, opt) {
    var view = null, link = null, player = null, listening = false, status = "connecting", refused = null, dragging = null, lastSent = {}, meters = null, structKey = "", latency = Number(store("lat", 90)), sink = store("sink", ""), talking = [];
    function store(k, d) { try { var v = localStorage.getItem("cu-ie-" + k); return v == null ? d : v; } catch (_) { return d; } }
    function save(k, v) { try { localStorage.setItem("cu-ie-" + k, v); } catch (_) { } }
    function mine() { return view && view.mixes.filter(function (q) { return q.mine; })[0]; }
    function op(o) { if (link) link.op(o); }
    function throttled(key, fn) { var now = Date.now(); if (lastSent[key] && now - lastSent[key].t < 40) { clearTimeout(lastSent[key].timer); lastSent[key].timer = setTimeout(fn, 40); lastSent[key].t = now; return; } lastSent[key] = { t: now }; fn(); }
    el.classList.add("ie-root");
    el.addEventListener("input", function (e) {
      var t = e.target, me = mine(); if (!me) return;
      if (t.dataset.ieSend != null) { var i = Number(t.dataset.ieSend), d = Math.round(M.faderToDb(Number(t.value)) * 10) / 10; t.closest(".ie-ch").querySelector(".ie-db").textContent = db(d); throttled("s" + i, function () { op({ op: "send", m: me.m, i: i, patch: { level: d } }); }); }
      else if (t.dataset.iePan != null) { var i2 = Number(t.dataset.iePan), p = Number(t.value); throttled("p" + i2, function () { op({ op: "send", m: me.m, i: i2, patch: { pan: p } }); }); }
      else if (t.dataset.ie === "level") { var d2 = Math.round(M.faderToDb(Number(t.value)) * 10) / 10; el.querySelector(".ie-mdb").textContent = db(d2); throttled("lvl", function () { op({ op: "mix", m: me.m, patch: { level: d2 } }); }); }
      else if (t.dataset.ie === "latency") { latency = Number(t.value); save("lat", latency); if (player) player.setLatency(latency); el.querySelector(".ie-latv").textContent = latency + " ms"; }
    });
    el.addEventListener("pointerdown", function (e) { if (e.target.type === "range") dragging = e.target; });
    document.addEventListener("pointerup", function () { dragging = null; });
    el.addEventListener("change", function (e) {
      var t = e.target, me = mine();
      if (t.dataset.ie === "sink") { sink = t.value; save("sink", sink); if (player) player.setSink(sink); }
      if (!me) return;
      if (t.dataset.ieOn != null) op({ op: "send", m: me.m, i: Number(t.dataset.ieOn), patch: { on: t.checked } });
    });
    el.addEventListener("click", function (e) {
      var b = e.target.closest("[data-ie-claim],[data-ie]"); if (!b) return; var me = mine();
      if (b.dataset.ieClaim != null) { op({ op: "claim", m: Number(b.dataset.ieClaim), name: opt.name }); return; }
      var a = b.dataset.ie;
      if (a === "release" && me) { stopListening(); op({ op: "release", m: me.m }); }
      else if (a === "mute" && me) op({ op: "mix", m: me.m, patch: { mute: !me.mute } });
      else if (a === "listen" && me) { if (listening) stopListening(); else startListening(); }
      else if (a === "retry") { refused = null; connect(); }
    });
    async function startListening() {
      var me = mine(); if (!me) return;
      if (!player) player = IE.player({ latency: latency, sinkId: sink });
      window.CUInEarStats = function () { return player && listening ? player.stats() : null; };   // for the main admin's Devices tab
      await player.start(); listening = true;
      link.listen(me.m, true, { rate: opt.rate || 48000 }); render();
    }
    function stopListening() { var me = mine(); if (listening && link && me) link.listen(me.m, false); listening = false; if (player) { player.stop(); player = null; } render(); }
    function connect() {
      if (link) link.close();
      link = IE.link({ url: opt.url, role: "user", code: opt.code, id: opt.id || IE.deviceId(), name: opt.name || "Someone" });
      link.on("status", function (s) { status = s; renderStatus(); });
      link.on("welcome", function (st) { view = st; render(); });
      link.on("view", function (st) { var before = mine(); view = st; var after = mine(); if (listening && (!after || (before && after.m !== before.m) || !after.local)) stopListening(); render(); });
      link.on("meters", function (m) { meters = m; drawMeters(); });
      link.on("refused", function (err) { refused = err; render(); });
      link.on("talking", function (names) { talking = names || []; showTalk(); });
      link.on("audio", function (pcm, frames, ch, rate) { if (player && listening) player.push(pcm, frames, ch, rate); });
    }
    function showTalk() {   // who is talking into my mix (talkback from the desk)
      var n = el.querySelector(".ie-talk");
      if (!talking.length) { if (n) n.remove(); return; }
      if (!n) { n = document.createElement("div"); n.className = "ie-talk"; n.setAttribute("role", "status"); el.insertBefore(n, el.firstChild); }
      n.textContent = "🎙 " + talking.join(", ") + " talking";
    }
    function renderStatus() { var s = el.querySelector(".ie-status"); if (s) s.textContent = status === "connected" ? "" : status; }
    function render() { renderBody(); showTalk(); }
    function renderBody() {
      if (refused && !view) { el.innerHTML = '<div class="ie-card"><p class="ie-bad">' + esc(refused) + '</p><button data-ie="retry">Try again</button></div>'; return; }
      if (!view) { el.innerHTML = '<div class="ie-card"><p class="muted">Connecting to the audio host…</p><span class="ie-status"></span></div>'; renderStatus(); return; }
      var me = mine(), key = JSON.stringify([me && me.m, me && me.local, me && me.wired, me && me.outL, me && me.outR, view.inputs.map(function (x) { return x.i + x.name; }), listening, view.mixes.map(function (q) { return q.owner + q.free; })]);
      if (key === structKey && me) { update(me); return; }
      structKey = key;
      if (!me) {
        el.innerHTML = '<div class="ie-card"><h3>Pick your mix</h3><p class="muted">Free mixes can be taken. Your levels stay with your mix.</p><span class="ie-status"></span><div class="ie-mixes">' +
          view.mixes.map(function (q) { return '<button class="ie-mix' + (q.free ? "" : " taken") + '"' + (q.free ? ' data-ie-claim="' + q.m + '"' : " disabled") + "><b>" + (q.m + 1) + "</b><span>" + esc(q.free ? q.name : q.owner ? q.owner : "reserved") + "</span><small>" + (q.wired && q.local ? "pack + device" : q.wired ? "pack" : q.local ? "this device" : "") + "</small></button>"; }).join("") + "</div></div>";
        renderStatus(); return;
      }
      var canSink = !!(window.HTMLMediaElement && "setSinkId" in HTMLMediaElement.prototype) && opt.sinkSelect !== false;
      el.innerHTML = '<div class="ie-card ie-head"><div><h3>Mix ' + (me.m + 1) + " · " + esc(me.name) + '</h3><span class="ie-status"></span></div><button data-ie="release">Leave this mix</button></div>' +
        '<div class="ie-card">' + (me.wired ? '<p class="ie-wired"><b>Wired</b> · ' + (me.outL >= 0 ? "your mix goes to your in-ear pack (Out " + (me.outL + 1) + (me.stereo && me.outR >= 0 ? "/" + (me.outR + 1) : "") + ")" : "the sound desk hasn't given this mix an output yet") + "</p>" : "") +
        (me.local ? '<div class="row"><button data-ie="listen" class="primary big">' + (listening ? "■ Stop listening" : "▶ Listen here") + '</button><label>Delay <input type="range" min="40" max="400" step="10" data-ie="latency" value="' + latency + '"><span class="ie-latv">' + latency + " ms</span></label>" + (canSink ? '<label>Headphones <select data-ie="sink"><option value="">This device\'s output</option></select></label>' : "") + '<span class="muted small ie-stats"></span></div>'
          : (me.wired ? "" : '<p class="ie-bad">Mix ' + (me.m + 1) + " doesn't go anywhere yet - ask the sound desk to send it to your pack or to this device.</p>")) + "</div>" +
        '<div class="ie-card"><div class="ie-master"><b>My level</b><input type="range" min="0" max="1" step="0.001" data-ie="level" value="' + M.dbToFader(me.level) + '"><span class="ie-mdb">' + db(me.level) + '</span><button data-ie="mute" class="' + (me.mute ? "danger on" : "") + '">' + (me.mute ? "Muted" : "Mute") + '</button><div class="ie-mm"><i></i><i></i></div></div>' +
        (view.inputs.length ? '<div class="ie-chs">' + view.inputs.map(function (x, k) { var sd = (me.sends || {})[x.i] || { level: -90, pan: 0, on: true }; return '<div class="ie-ch" data-k="' + k + '"><span class="ie-name"' + (x.color ? ' style="border-color:' + esc(x.color) + '"' : "") + ">" + esc(x.name) + '</span><div class="ie-meter"><i></i></div><input type="range" min="0" max="1" step="0.001" data-ie-send="' + x.i + '" value="' + M.dbToFader(sd.level) + '"><span class="ie-db">' + db(sd.level) + '</span><input type="range" class="ie-pan" min="-1" max="1" step="0.05" data-ie-pan="' + x.i + '" value="' + (sd.pan || 0) + '" title="Left / right"><label class="toggle" title="On / off"><input type="checkbox" data-ie-on="' + x.i + '"' + (sd.on !== false ? " checked" : "") + "></label></div>"; }).join("") + "</div>" : '<p class="muted">No channels are routed to the in-ears yet.</p>') + "</div>";
      renderStatus();
      if (canSink && navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) navigator.mediaDevices.enumerateDevices().then(function (list) { var sel = el.querySelector('[data-ie="sink"]'); if (!sel) return; list.filter(function (d) { return d.kind === "audiooutput" && d.deviceId !== "default"; }).forEach(function (d) { var o = document.createElement("option"); o.value = d.deviceId; o.textContent = d.label || "Output " + d.deviceId.slice(0, 6); if (d.deviceId === sink) o.selected = true; sel.appendChild(o); }); });
    }
    function update(me) {   // values only (somebody else - the desk - changed something), not the slider being moved
      el.querySelectorAll("[data-ie-send]").forEach(function (s) { if (s === dragging) return; var sd = (me.sends || {})[s.dataset.ieSend] || { level: -90 }; s.value = M.dbToFader(sd.level); s.closest(".ie-ch").querySelector(".ie-db").textContent = db(sd.level); });
      el.querySelectorAll("[data-ie-pan]").forEach(function (s) { if (s === dragging) return; var sd = (me.sends || {})[s.dataset.iePan] || { pan: 0 }; s.value = sd.pan || 0; });
      var lv = el.querySelector('[data-ie="level"]'); if (lv && lv !== dragging) { lv.value = M.dbToFader(me.level); el.querySelector(".ie-mdb").textContent = db(me.level); }
      var mb = el.querySelector('[data-ie="mute"]'); if (mb) { mb.textContent = me.mute ? "Muted" : "Mute"; mb.classList.toggle("danger", !!me.mute); mb.classList.toggle("on", !!me.mute); }
    }
    function bar(v) { var d = v > 0 ? 20 * Math.log10(v) : -90; return Math.max(0, Math.min(100, (d + 60) / 60 * 100)); }
    function drawMeters() {
      if (!meters) return;
      el.querySelectorAll(".ie-ch").forEach(function (row) { var v = meters.in && meters.in[Number(row.dataset.k)] || 0; row.querySelector(".ie-meter i").style.setProperty("--v", bar(v) + "%"); });
      var mm = el.querySelectorAll(".ie-mm i"); if (mm.length && meters.mine) { mm[0].style.setProperty("--v", bar(meters.mine[0]) + "%"); mm[1].style.setProperty("--v", bar(meters.mine[1]) + "%"); }
      var st = el.querySelector(".ie-stats"); if (st && player) { var s = player.stats(); st.textContent = s.bufferMs != null ? "buffer " + s.bufferMs + " ms" + (s.outputMs ? " + output " + s.outputMs + " ms" : "") + (s.underruns ? " · " + s.underruns + " gaps" : "") : ""; }
    }
    connect(); render();
    return { destroy: function () { stopListening(); if (link) link.close(); el.innerHTML = ""; }, link: function () { return link; }, talking: function () { return talking.slice(); } };
  }
  root.CUInEarUI = { mount: mount };
})(typeof window !== "undefined" ? window : this);
