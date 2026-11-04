/* The DAW's mixer: a strip per track, then the buses and the main mix. Each strip: its effects (inserts, in order - click
 * one to open it, drag the knobs, A adds an automation lane for a knob), sends to the buses, pan, the fader with a meter
 * that holds its peak (click the meter to clear a clip light), mute / solo / arm, and where it goes. */
(function () {
  "use strict";
  var D = window.CDaw, UI = window.CDawUI, U = UI.U, $ = UI.$, $$ = UI.$$, esc = UI.esc;
  var mx = { body: null, open: null };
  function P() { return D.project(); }
  function fmtDb(v) { return v <= -60 ? "−∞" : (v > 0 ? "+" : "") + v.toFixed(1); }
  function strip(t, master) {
    var p = P(), buses = p.tracks.filter(function (x) { return x.kind === "bus" && x.id !== (t && t.id); }), id = master ? "master" : t.id, ins = master ? p.master.inserts : t.inserts, vol = master ? p.master.volume : t.volume;
    var h = '<div class="cd-strip' + (master ? " master" : "") + (t && t.id === U.sel ? " sel" : "") + (t && t.kind === "bus" ? " bus" : "") + '" data-s="' + id + '" style="--tc:' + (master ? "#E2C27E" : t.color) + '">' +
      '<div class="cd-sname">' + (master ? "Main mix" : esc(t.name)) + "</div>" +
      '<div class="cd-ins">' + (ins || []).map(function (f, i) { var def = D.FX[f.type] || { name: f.type }, locked = def.pro && !D.pro(); return '<div class="cd-insert' + (f.on === false ? " off" : "") + (locked ? " locked" : "") + (mx.open === id + ":" + f.id ? " open" : "") + '" data-f="' + f.id + '"><button class="cd-pwr" data-fx="power" title="On / off">⏻</button><button class="cd-fxname" data-fx="open" title="' + (locked ? "Part of Central Plugins" : "Open it") + '">' + esc(f.type === "cmfx" ? (f.plugin && f.plugin.name) || "Plugin" : def.name) + '</button><button data-fx="menu" title="More">⋯</button></div>'; }).join("") +
        '<button class="cd-addfx" data-fx="add">+ Effect</button></div>';
    if (!master && t.kind !== "bus") h += '<div class="cd-sends">' + (t.sends || []).map(function (s) { var b = D.track(s.to); return b ? '<label class="cd-send" title="Send to ' + esc(b.name) + (s.pre ? " (before the fader)" : "") + '"><span>' + esc(b.name) + '</span><input type="range" min="-60" max="6" step="0.5" value="' + s.level + '" data-send="' + s.to + '"></label>' : ""; }).join("") + (buses.length ? '<button class="cd-addsend" data-addsend>+ Send</button>' : "") + "</div>";
    else h += '<div class="cd-sends"></div>';
    h += (master ? '<div class="cd-panrow"></div>' : '<label class="cd-panrow" title="Pan (double-click: centre)"><input type="range" min="-1" max="1" step="0.01" value="' + t.pan + '" data-pan><span>' + (Math.abs(t.pan) < 0.01 ? "C" : (t.pan < 0 ? "L" : "R") + Math.round(Math.abs(t.pan) * 100)) + "</span></label>") +
      '<div class="cd-faderrow"><input type="range" class="cd-fader" min="-60" max="6" step="0.1" value="' + vol + '" data-vol orient="vertical" title="Volume (double-click: 0 dB)"><canvas class="cd-meter" data-m="' + id + '" title="Click to clear the peak"></canvas><div class="cd-scale"><span>+6</span><span>0</span><span>−12</span><span>−24</span><span>−48</span></div></div>' +
      '<div class="cd-db">' + fmtDb(vol) + " dB</div>";
    if (!master) h += '<div class="cd-sbtns"><button class="cd-m' + (t.mute ? " on" : "") + '" data-sb="mute">M</button><button class="cd-s' + (t.solo ? " on" : "") + '" data-sb="solo">S</button>' + (t.kind !== "bus" ? '<button class="cd-r' + (t.arm ? " on" : "") + '" data-sb="arm">●</button>' : "") + "</div>" +
      '<select class="cd-out" data-out title="Where it goes"><option value="master">Main mix</option>' + buses.map(function (b) { return '<option value="' + b.id + '"' + (t.output === b.id ? " selected" : "") + ">" + esc(b.name) + "</option>"; }).join("") + "</select>";
    return h + "</div>";
  }
  function draw(body) {
    mx.body = body; $(".cd-dtitle", U.root).textContent = "";
    var p = P(), tracks = p.tracks.filter(function (t) { return t.kind !== "bus"; }), buses = p.tracks.filter(function (t) { return t.kind === "bus"; });
    body.innerHTML = '<div class="cd-mixer"><div class="cd-strips">' + tracks.map(function (t) { return strip(t); }).join("") + '<div class="cd-sep"></div>' + buses.map(function (t) { return strip(t); }).join("") + '<button class="cd-addbus" data-addbus title="A bus: a shared reverb or delay, or a group of tracks">+ Bus</button>' + strip(null, true) + '</div><div class="cd-fxpanel"></div></div>';
    wire(body); drawFx(body);
  }
  function wire(body) {
    $$(".cd-strip", body).forEach(function (s) {
      var id = s.dataset.s, master = id === "master";
      function T() { return master ? null : D.track(id); }
      s.onpointerdown = function (e) { if (!master && !e.target.closest("input,select")) { if (U.sel !== id) { U.sel = id; UI.parts.arrange && UI.parts.arrange.draw("select"); $$(".cd-strip", body).forEach(function (x) { x.classList.toggle("sel", x.dataset.s === id); }); } } };
      var vol = $("[data-vol]", s); vol.oninput = function () { var v = +vol.value; D.nudge("Volume", function (p) { if (master) p.master.volume = v; else D.track(id).volume = v; }); $(".cd-db", s).textContent = fmtDb(v) + " dB"; };
      vol.ondblclick = function () { D.edit("Volume", function (p) { if (master) p.master.volume = 0; else D.track(id).volume = 0; }); };
      var pan = $("[data-pan]", s); if (pan) { pan.oninput = function () { var v = +pan.value; D.nudge("Pan", function () { D.track(id).pan = v; }); pan.nextElementSibling.textContent = Math.abs(v) < 0.01 ? "C" : (v < 0 ? "L" : "R") + Math.round(Math.abs(v) * 100); }; pan.ondblclick = function () { D.edit("Pan", function () { D.track(id).pan = 0; }); }; }
      $$("[data-send]", s).forEach(function (r) { r.oninput = function () { var to = r.dataset.send, v = +r.value; D.nudge("Send level", function () { var x = D.track(id).sends.filter(function (q) { return q.to === to; })[0]; if (x) x.level = v; }); }; r.oncontextmenu = function (e) { e.preventDefault(); var to = r.dataset.send; UI.menu(null, [["Before the fader", function () { D.edit("Send", function () { var x = D.track(id).sends.filter(function (q) { return q.to === to; })[0]; x.pre = !x.pre; }); }], ["Remove the send", function () { D.edit("Remove send", function () { var t = D.track(id); t.sends = t.sends.filter(function (q) { return q.to !== to; }); }); }]], e.clientX, e.clientY); }; });
      var as = $("[data-addsend]", s); if (as) as.onclick = function () { var t = T(), buses = P().tracks.filter(function (x) { return x.kind === "bus" && !t.sends.some(function (q) { return q.to === x.id; }); }); if (!buses.length) return UI.say("It already sends to every bus. Add a bus first (+ Bus)."); UI.menu(as, buses.map(function (b) { return ["To " + b.name, function () { D.edit("Send", function () { D.track(id).sends.push({ to: b.id, level: -12, pre: false }); }); }]; })); };
      $$("[data-sb]", s).forEach(function (b) { b.onclick = function () { var k = b.dataset.sb; D.edit(k === "mute" ? "Mute" : k === "solo" ? "Solo" : "Arm", function () { var t = D.track(id); t[k] = !t[k]; }); }; });
      var out = $("[data-out]", s); if (out) out.onchange = function () { var v = out.value; D.edit("Output", function () { D.track(id).output = v; }); };
      var m = $(".cd-meter", s); m.onclick = function () { var lv = UI.level("m" + id, (master ? D.graph().master : D.graph().strips[id]).meter); lv.reset(); };
      $$("[data-fx]", s).forEach(function (b) { b.onclick = function () {
        var k = b.dataset.fx, f = b.closest("[data-f]") && b.closest("[data-f]").dataset.f;
        function list(p) { return master ? p.master.inserts : D.track(id).inserts; }
        if (k === "add") return addFx(b, function (fx) { D.edit("Add " + (D.fxDef(fx) || {}).name, function (p) { list(p).push(fx); }); mx.open = id + ":" + fx.id; });
        if (k === "power") return D.edit("Effect on / off", function (p) { var x = list(p).filter(function (q) { return q.id === f; })[0]; x.on = x.on === false; });
        if (k === "open") { mx.open = mx.open === id + ":" + f ? null : id + ":" + f; return draw(mx.body); }
        if (k === "menu") UI.menu(b, [["Move up", function () { D.edit("Move effect", function (p) { var l = list(p), i = l.findIndex(function (q) { return q.id === f; }); if (i > 0) l.splice(i - 1, 0, l.splice(i, 1)[0]); }); }], ["Move down", function () { D.edit("Move effect", function (p) { var l = list(p), i = l.findIndex(function (q) { return q.id === f; }); if (i < l.length - 1) l.splice(i + 1, 0, l.splice(i, 1)[0]); }); }],
          ["Reset its knobs", function () { D.edit("Reset effect", function (p) { var x = list(p).filter(function (q) { return q.id === f; })[0]; x.params = D.fxDefaults(x); }); }], null, ["Remove", function () { D.edit("Remove effect", function (p) { var l = list(p), i = l.findIndex(function (q) { return q.id === f; }); if (i >= 0) l.splice(i, 1); }); if (mx.open === id + ":" + f) mx.open = null; }]]);
      }; });
    });
    var ab = $("[data-addbus]", body); if (ab) ab.onclick = function () { D.edit("Add a bus", function (p) { var t = D.newTrack("bus", ["Reverb", "Delay", "Group"][p.tracks.filter(function (x) { return x.kind === "bus"; }).length % 3]); t.color = "#6E7680"; if (/Delay/.test(t.name)) t.inserts = [{ id: D.uid("f"), type: "delay", on: true, params: { time: 3, feedback: 0.35, mix: 1 } }]; if (/Group/.test(t.name)) t.inserts = []; p.tracks.push(t); }); };
  }
  function addFx(btn, done) {
    var items = Object.keys(D.FX).filter(function (k) { return k !== "cmfx"; }).map(function (k) { var def = D.FX[k], locked = def.pro && !D.pro(); return [def.name + (locked ? " (Central Plugins)" : def.pro ? "" : ""), function () { done({ id: D.uid("f"), type: k, on: true, params: D.fxDefaults(k) }); }, !locked]; });
    // Central FX plugins: the builder's examples, your own (made in Central Production) and installed community ones
    function cm(pl, tag) { return [pl.name + (tag ? " (" + tag + ")" : ""), function () { done({ id: D.uid("f"), type: "cmfx", on: true, params: D.fxDefaults({ type: "cmfx", plugin: pl }), plugin: pl }); }, !!window.CMFx]; }
    var ex = window.CPPluginPresets || [], src = window.CDawPlugins && window.CDawPlugins.list ? window.CDawPlugins.list() : [];
    Promise.resolve(src).catch(function () { return []; }).then(function (more) {
      more = (more || []).filter(function (x) { return x && x.plugin; });
      var mine = more.filter(function (x) { return x.from === "mine"; }), inst = more.filter(function (x) { return x.from !== "mine"; });
      if (mine.length) { items.push(null); mine.forEach(function (x) { items.push(cm(x.plugin, "yours")); }); }
      if (inst.length) { items.push(null); inst.forEach(function (x) { items.push(cm(x.plugin, x.author ? "by " + x.author : "installed")); }); }
      // (10.3) the Central FX collection, by family: the basic ones free, the better ones with Central Plugins
      var coll = window.CMFxCollection || [], fams = [];
      coll.forEach(function (pl) { if (fams.indexOf(pl.family) < 0) fams.push(pl.family); });
      fams.forEach(function (fam) {
        items.push(null);
        coll.filter(function (pl) { return pl.family === fam; }).forEach(function (pl) { var locked = pl.tier === "plugins" && !D.pro(); var it = cm(pl, locked ? "Central Plugins" : ""); if (locked) it[2] = false; items.push(it); });
      });
      if (ex.length) { items.push(null); ex.forEach(function (pl) { items.push(cm(pl, "example")); }); }
      if (D.native.host()) items.push(null, ["Your VST3 / CLAP plugins…", function () { nativeMenu(btn, done, false); }]);
      items.push(null, ["A plugin file (.cmfx.json)…", function () { var i = document.createElement("input"); i.type = "file"; i.accept = ".json"; i.onchange = function () { var file = i.files[0]; if (!file) return; file.text().then(function (txt) { var pl = JSON.parse(txt); if (pl.format !== "central-fx") throw new Error(); if (window.CMFx) { var r = window.CMFx.check(pl); if (!r.ok) return UI.say("That plugin has a problem: " + r.error, true); } cm(pl)[1](); }).catch(function () { UI.say("That isn't a Central FX plugin.", true); }); }; i.click(); }]);
      if (!window.CMFx) items.push(["(Central FX plugins need the plugin engine, which isn't in this build)", null, false]);
      UI.menu(btn, items);
    });
  }
  // (10.2) VST3 / CLAP plugins on this computer (the rig hosts them): pick one; "Look for plugins" scans for new ones
  function nativeMenu(btn, done, scan) {
    UI.say(scan ? "Looking for VST3 and CLAP plugins on this computer…" : "Getting your plugins…");
    D.native.host().list(scan).then(function (list) {
      var items = (list || []).filter(function (p) { return p.format !== "cmfx"; }).map(function (p) { return [p.name + (p.vendor ? " · " + p.vendor : "") + " (" + String(p.format).toUpperCase() + ")", function () { done({ id: D.uid("f"), type: "native", on: true, params: {}, plugin: { format: p.format, id: p.id, path: p.path, name: p.name, vendor: p.vendor || "", key: p.key || "" }, v: 0 }); UI.say(p.name + " is on the track. It plays live in playback, from a keyboard and while you monitor an armed audio track, and exports keep its automation."); }]; });
      if (!items.length) items.push(["(none found yet)", null, false]);
      items.push(null, ["Look for plugins again", function () { nativeMenu(btn, done, true); }]);
      UI.menu(btn, items);
    }).catch(function (e) { UI.say(e.message || String(e), true); });
  }
  function TP() { return window.PPPedals && window.PPPedals.tempo; }
  function drawFx(body) {
    var panel = $(".cd-fxpanel", body); if (!mx.open) { panel.hidden = true; return; }
    var parts = mx.open.split(":"), id = parts[0], fid = parts[1], master = id === "master", t = master ? null : D.track(id), list = master ? P().master.inserts : t && t.inserts, f = list && list.filter(function (x) { return x.id === fid; })[0];
    if (!f) { mx.open = null; panel.hidden = true; return; }
    if (f.type === "native" && !f.plist && D.native.host() && t && !mx.fetching) { mx.fetching = true; D.liveFx.params(t.id, f.id).then(function () { mx.fetching = false; if (mx.open === id + ":" + f.id) draw(mx.body); }).catch(function () { mx.fetching = false; }); }
    var def = D.fxDef(f), p = Object.assign(D.fxDefaults(f), f.params || {}), pro = D.pro(), locked = def.pro && !pro;
    panel.hidden = false;
    panel.innerHTML = '<div class="cd-fxhead"><b>' + esc(def.name) + "</b> · " + esc(master ? "Main mix" : t.name) + (locked ? ' <span class="cd-lock">Part of Central Plugins: add your package key in Settings to use it</span>' : !pro && def.params.some(function (q) { return q[6]; }) ? ' <span class="cd-lock">The basic version: Central Plugins opens the rest of its knobs</span>' : "") + '<button class="ghost" data-close>✕</button></div>' +
      '<div class="cd-knobs">' + def.params.map(function (q) {
        var off = locked || (q[6] && !pro), v = p[q[0]], key = "fx:" + f.id + ":" + q[0];
        if (f.type === "delay" && ((q[0] === "ms" && p.sync >= 0.5) || (q[0] === "note" && p.sync < 0.5))) return "";   // (10.4) the note when it follows the tempo, else its own time
        if (q[7]) return '<label class="cd-knob' + (off ? " off" : "") + '"><span>' + esc(q[1]) + '</span><select data-k="' + q[0] + '"' + (off ? " disabled" : "") + ">" + q[7].map(function (o, i) { return '<option value="' + i + '"' + (Math.round(v) === i ? " selected" : "") + ">" + esc(o) + "</option>"; }).join("") + "</select></label>";
        return '<label class="cd-knob' + (off ? " off" : "") + '"><span>' + esc(q[1]) + '</span><input type="range" min="' + q[2] + '" max="' + q[3] + '" step="' + ((q[3] - q[2]) / 400) + '" value="' + v + '" data-k="' + q[0] + '"' + (off ? " disabled" : "") + '><output>' + fmt(v, q) + "</output>" + (!master && !off && f.type !== "cmfx" ? '<button class="cd-autobtn" data-auto="' + key + '" title="Automate it">A</button>' : "") + "</label>";
      }).join("") + (f.type === "cmfx" && ((f.plugin && f.plugin.params) || []).some(function (q) { return (q.id === "tempo" || q.id === "bpm" || String(q.unit || "").toUpperCase() === "BPM"); }) ? '<label class="cd-sync"><input type="checkbox" data-synctempo' + (f.syncTempo !== false ? " checked" : "") + '> Sync to song tempo</label>' : "") + (f.type === "cmfx" && TP() && TP().pluginTime(f.plugin) ? '<label class="cd-knob cd-sync"><span>Sync to tempo</span><select data-syncnote><option value="">Off (its own time)</option>' + TP().NOTES.map(function (n) { return '<option value="' + n[0] + '"' + (f.syncNote === n[0] ? " selected" : "") + ">" + esc(n[1]) + "</option>"; }).join("") + "</select></label>" : "") + (f.type === "native" ? nativeInfo(t, f) : "") + (f.type === "cmfx" ? '<p class="cd-dim">' + (!window.CMFx ? "A Central FX plugin. It plays once the plugin engine is in this build." : !def.params.length ? "This plugin has no knobs." : "A Central FX plugin" + (f.plugin && f.plugin.author ? " by " + esc(f.plugin.author) : "") + ".") + "</p>" : "") + "</div>";
    panel.onclick = function (e) { if (e.target.closest("[data-close]")) { mx.open = null; draw(mx.body); }
      var nb = e.target.closest("[data-native]"); if (nb && t) {
        var k = nb.dataset.native;
        if (k === "freeze") D.native.freeze(t.id).then(function () { draw(mx.body); }).catch(function (er) { UI.say(er.message || String(er), true); });
        if (k === "unfreeze") { D.native.unfreeze(t.id); draw(mx.body); }
        if (k === "window") D.liveFx.openWindow(t.id, f.id).then(function (r) { if (r && r.error) UI.say(r.error, true); else if (r && r.ok) UI.say("Its window is open: what you change there is heard as it plays."); });
        if (k === "params") D.liveFx.params(t.id, f.id).then(function () { draw(mx.body); });
      } var a = e.target.closest("[data-auto]"); if (a) { var key = a.dataset.auto; D.edit("Automation lane", function () { var tt = D.track(id); if (tt.lanes.indexOf(key) < 0) tt.lanes.push(key); }); UI.say("An automation lane is under the track: click it to add points."); } };
    var sn = $("[data-syncnote]", panel); if (sn) sn.onchange = function () { var v = sn.value; D.edit(v ? "Sync to tempo" : "Own delay time", function (pp) { var l = master ? pp.master.inserts : D.track(id).inserts, x = l.filter(function (z) { return z.id === fid; })[0]; if (x) { if (v) x.syncNote = v; else delete x.syncNote; } }); };   // (10.4)
    var st = $("[data-synctempo]", panel); if (st) st.onchange = function () { var on = st.checked; D.edit(on ? "Sync to song tempo" : "Own tempo", function (pp) { var l = master ? pp.master.inserts : D.track(id).inserts, x = l.filter(function (z) { return z.id === fid; })[0]; if (x) x.syncTempo = on; }); };   // (10.3)
    $$("[data-k]", panel).forEach(function (inp) {
      var q = def.params.filter(function (x) { return x[0] === inp.dataset.k; })[0];
      inp.oninput = function () { var v = +inp.value; if (inp.nextElementSibling && inp.nextElementSibling.tagName === "OUTPUT") inp.nextElementSibling.textContent = fmt(v, q); D.nudge(def.name + " " + q[1], function (pp) { var l = master ? pp.master.inserts : D.track(id).inserts, x = l.filter(function (z) { return z.id === fid; })[0]; x.params = x.params || {}; x.params[q[0]] = v; }); };
      inp.onchange = inp.oninput;
      if (f.type === "delay" && q[0] === "sync") inp.onchange = function () { inp.oninput(); setTimeout(function () { draw(mx.body); }, 0); };   // (10.4: shows the note or the time)
    });
  }
  function nativeInfo(t, f) {
    if (!t) return '<p class="cd-dim">VST3 and CLAP plugins go on tracks (not the main mix).</p>';
    var st = D.native.state(t), host = !!D.native.host(), live = host && D.liveFx.tracks().some(function (x) { return x.id === t.id; }), fz = t.frozen;
    var lat = (D.liveFx.chains()[Object.keys(D.liveFx.chains()).filter(function (i) { return D.liveFx.chains()[i].sig && D.liveFx.chains()[i].sig.indexOf('"' + f.id + '"') >= 0; })[0]] || {}).lat;
    return '<div class="cd-native"><p><b>' + esc(f.plugin.name) + "</b> · " + esc(String(f.plugin.format).toUpperCase()) + (f.plugin.vendor ? " · " + esc(f.plugin.vendor) : "") + "</p>" +
      (host ? '<p class="cd-dim">' + (st === "frozen" ? "Frozen (saving CPU): playback uses the frozen sound until something changes or you unfreeze it." : "Plays live as the song plays" + (lat ? " · the track's plugins' delay (" + lat + " samples) is made up for" : "") + ". A knob turned here or in its window is heard about " + Math.round(D.liveFx.response().proc * 1000) + " ms later (Settings → Audio → Plugin response)." + (t.kind !== "audio" ? " A keyboard on this track plays through it too." : "")) +
          " While the track is armed and monitored, its input plays through it too.</p>" +
        '<div class="cd-line"><button data-native="window">Open its window</button>' + (f.plist ? "" : '<button data-native="params">Show its knobs</button>') +
        '<button data-native="freeze"' + (st === "freezing" ? " disabled" : "") + ' title="Optional: plays the track from a rendered copy to save CPU">' + (st === "frozen" ? "Freeze again" : "Freeze (saves CPU)") + "</button>" + (fz ? '<button data-native="unfreeze">Unfreeze</button>' : "") + "</div>"
        : '<p class="cd-dim">This VST3 / CLAP plugin plays in the Central Production and Central Usage apps on a computer. Here the track plays without it' + (st === "frozen" ? ", except its frozen sound, which plays as it was." : ". Central FX plugins play here live.") + "</p>") + "</div>";
  }
  function fmt(v, q) { var u = q[5]; return (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 100) / 100) + (u ? " " + u : ""); }
  function meters() {
    if (!mx.body || !mx.body.isConnected) return; var g = D.graph(); if (!g) return;
    $$(".cd-meter", mx.body).forEach(function (cv) { var id = cv.dataset.m, s = id === "master" ? g.master : g.strips[id]; if (s) UI.meterDraw(cv, UI.level("m" + id, s.meter), true); });
  }
  UI.parts.mixer = { draw: draw, meters: meters };
  // Central FX plugins for the insert picker: CDawPlugins.list() -> Promise [{ name, from: "mine"|"installed", author, plugin }].
  // The apps' installed ones come from CU.libraries.centralFx(); a host adds its own with CDawPlugins.add(fn -> Promise list).
  if (!window.CDawPlugins) window.CDawPlugins = { sources: [], add: function (fn) { this.sources.push(fn); },
    list: function () {
      var cu = window.CU && window.CU.libraries && window.CU.libraries.centralFx, all = this.sources.slice(); if (cu) all.unshift(function () { return window.CU.libraries.centralFx(); });
      return Promise.all(all.map(function (fn) { return Promise.resolve().then(fn).catch(function () { return []; }); })).then(function (r) { return [].concat.apply([], r); });
    } };
})();
