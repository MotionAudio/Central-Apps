/* The browser studio's Publish (10.1): renders the timeline here (CUStudio.bounce, the same offline render as the app's
 * exports) into WAV loops, or turns a track's effects into a pedal board preset, and sends it into the Make & sell upload
 * flow (Maker.send -> /v1/creator/items...): it waits for review like any other upload. */
(function () {
  "use strict";
  var S = window.CUStudio, UI = window.CUStudioUI, M = window.Maker, CU = window.CentralUsage;
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  var kind = "loop";

  // open the Studio (what the app does when its Studio tab is shown)
  CU._tab.forEach(function (fn) { try { fn("studio"); } catch (e) { console.warn(e); } });

  function proj() { return S.project(); }
  function selTrack() { var p = proj(); return S.track(UI && UI.ui.sel) || p.tracks[0] || null; }
  function bars() { return Math.round((S.arrangementEnd() / S.beatsPerBar()) * 100) / 100; }
  function seconds() { return S.arrangementEnd() * 60 / proj().bpm; }

  // a bounce as a seamless loop: exactly the timeline's length, with the effects' tail (reverb, delay) wrapped round to
  // the start - the way a loop plays when it repeats (the render starts 0.05 s in and runs 3 s past the end)
  function asLoop(buf) {
    var rate = buf.sampleRate, start = Math.round(0.05 * rate), n = Math.round(seconds() * rate), ch = buf.numberOfChannels;
    var out = new AudioBuffer({ length: n, numberOfChannels: ch, sampleRate: rate });
    for (var c = 0; c < ch; c++) {
      var src = buf.getChannelData(c), dst = out.getChannelData(c);
      for (var i = 0; i < n; i++) dst[i] = src[start + i] || 0;
      for (var j = start + n, k = 0; j < src.length; j++, k++) dst[k % n] += src[j];
      for (var m = 0; m < n; m++) dst[m] = Math.max(-1, Math.min(1, dst[m]));
    }
    return out;
  }
  function wavBlob(buf) { return new Blob([S.wav(buf, 24)], { type: "audio/wav" }); }
  function safe(s) { return String(s || "Loop").replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "Loop"; }

  // a track's effects -> the pedal board's pedals (the free ones every Central Pedals board has)
  function boardOf(t) {
    var fx = t.fx || {}, chain = [];
    if (!fx.on) return null;
    if (fx.gate && fx.gate.on) chain.push(["calfgate", {}]);
    if (fx.comp && fx.comp.on) chain.push(["calfcomp", { Ratio: Math.round((fx.comp.ratio || 3) * 10) / 10 }]);
    if (fx.eq && fx.eq.on && (fx.eq.low || fx.eq.mid || fx.eq.high || fx.eq.lowCut)) chain.push(["calfeq5", {}]);
    if (fx.delay && fx.delay.on) chain.push(["digdelay", { Feedback: Math.round(fx.delay.feedback || 35), Mix: Math.round(fx.delay.send || 30) }]);
    if (fx.reverb && fx.reverb.on) chain.push(["dfly-hall", { Decay: { room: 1.3, hall: 3.0, plate: 2.1, cathedral: 5.2 }[fx.reverb.type] || 2.4 }]);
    if (!chain.length) return null;
    return { name: safe($("#pName").value || t.name), kind: t.kind === "drums" ? null : "keys", chain: chain, studio: { preset: fx.preset || "", from: "Motion Audio browser studio" } };
  }

  function info() {
    var el = $("#pInfo"), t = selTrack(), end = S.arrangementEnd();
    if (kind === "board") { el.textContent = t ? "From the track “" + t.name + "” (pick another track in the studio to change it)" + (boardOf(t) ? ": " + boardOf(t).chain.map(function (c) { return c[0]; }).join(" → ") + "." : ": switch on some of its effects first (Effects tab).") : "Add a track first."; return; }
    el.textContent = end ? "The timeline: " + bars() + " bars at " + proj().bpm + " BPM in " + proj().key + " (" + seconds().toFixed(1) + " s)" + (kind === "loopset" ? ", one loop per track on it." : ".") : "The timeline is empty: record or draw clips and put them on the timeline first.";
  }
  $$("#pubKinds [data-k]").forEach(function (b) { b.onclick = function () { kind = b.dataset.k; $$("#pubKinds [data-k]").forEach(function (x) { x.classList.toggle("on", x === b); }); info(); }; });
  S.on("change", function () { info(); if (!$("#pName").value) $("#pName").placeholder = proj().name; });
  $("#toPub").onclick = function () { info(); };
  setTimeout(function () { $("#pName").placeholder = proj().name; info(); }, 50);

  $("#publish").onsubmit = function (e) {
    e.preventDefault();
    var err = $("#pErr"), state = $("#pState"), prog = $("#pProg"), btn = $("#pSend"); err.textContent = "";
    if (!M.signedIn()) { err.textContent = "Sign in to publish. Save the song first (Song ▾ → Save): it stays in this browser."; var b = document.createElement("button"); b.type = "button"; b.textContent = "Sign in"; b.className = "small"; b.style.marginLeft = ".6rem"; b.onclick = function () { M.signIn("/studio/"); }; err.appendChild(b); return; }
    if (!$("#pRights").checked) { err.textContent = "Confirm that you made it, or have the rights to share and sell everything in it."; return; }
    var title = ($("#pName").value || proj().name || "").trim();
    var meta = { title: title, description: $("#pDesc").value, tags: $("#pTags").value, rights: true, studio: true };
    var step = function (p, what) { prog.hidden = false; $("i", prog).style.width = Math.round(p * 100) + "%"; state.textContent = what; };
    btn.disabled = true;
    var work;
    if (kind === "board") {
      var bd = boardOf(selTrack());
      if (!bd) { btn.disabled = false; err.textContent = "Switch on some effects on the track first (Effects tab)."; return; }
      work = Promise.resolve([{ role: "source", name: safe(title) + ".json", blob: new Blob([JSON.stringify(bd, null, 1)], { type: "application/json" }) }])
        .then(function (files) { return M.send(Object.assign(meta, { kind: "board", pack: "pedals" }), files, step); });
    } else {
      if (!S.arrangementEnd()) { btn.disabled = false; err.textContent = "The timeline is empty: put clips on it first."; return; }
      if (seconds() > 120) { btn.disabled = false; err.textContent = "A loop can be up to two minutes: shorten the timeline (this one is " + Math.round(seconds()) + " s)."; return; }
      step(0, "Rendering…");
      var p = proj(), used = p.tracks.filter(function (t) { return p.arrangement.some(function (it) { return it.track === t.id; }); });
      work = S.bounce().then(function (mix) {
        var mixBlob = wavBlob(asLoop(mix)), files = [];
        if (kind === "loop") { files.push({ role: "source", name: safe(title) + ".wav", blob: mixBlob }); return finish(files, mixBlob); }
        return used.reduce(function (pr, t, i) { return pr.then(function () { step(i / used.length, "Rendering " + t.name + "…"); return S.bounce({ tracks: [t.id], ignoreMute: true }).then(function (b) { files.push({ role: "source", name: String(i + 1).padStart(2, "0") + " " + safe(t.name) + ".wav", blob: wavBlob(asLoop(b)) }); }); }); }, Promise.resolve())
          .then(function () { return finish(files, mixBlob); });
      });
      var finish = function (files, mixBlob) {
        files.push({ role: "demo", name: safe(title) + " (demo).wav", blob: mixBlob });
        return M.send(Object.assign(meta, { kind: "loop", pack: "pads", key: p.key, bpm: p.bpm, bars: Math.round(bars()) }), files, step);
      };
    }
    work.then(function (item) {
      prog.hidden = true; state.textContent = ""; btn.disabled = false;
      err.innerHTML = '<span class="okmsg">Sent: “' + item.title.replace(/[<&]/g, "") + '” is waiting for review. We\'ll email you when it\'s live. <a href="/create/#items">See it in Make &amp; sell</a></span>';
    }).catch(function (x) { prog.hidden = true; state.textContent = ""; btn.disabled = false; err.textContent = x.message + (x.itemId ? "\nIt's saved in Make & sell → My items." : ""); });
  };
})();
