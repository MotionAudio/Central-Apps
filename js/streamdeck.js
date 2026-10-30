/* Central Pedal - Elgato Stream Deck. Plug one into the Central Pedal (or the Mac running Central Pedal Control /
 * the main admin's player window) and its keys are more footswitches: each key does any action (the same list as the
 * Configure tab - press, and hold), with its own label, icon and colours, on as many pages as you want; a key lights
 * up while what it does is on (playing, looping, click on…). Brightness, hold time, page keys and the picture's
 * orientation are settings too (Settings → Stream Deck).
 * It talks to the Stream Deck over WebHID: the Central Pedal's Chromium is allowed by a policy (pad-pedal-system
 * boot-tune), the desktop apps allow it themselves; elsewhere "Connect a Stream Deck" asks once.
 * Keys are inputs "sd<page>-<key>" in the same mapping as the footswitches, so Configure / Learn show them too.
 * Central Control and Central Usage use this file too (controls.js gives it window.CCHost: their own actions,
 * mapping and storage); in the Central Pedal app the host is the app itself (below). */
(function () {
  "use strict";
  var PP = window.PP;
  var H = window.CCHost || (PP && window.PPFeatures && PP.project ? {
    store: function () { return PP.project(); }, persist: function () { H.persist(); }, status: function (t) { H.status(t); }, ask: function (a, b) { return H.ask(a, b); },
    esc: PP.escapeHtml, actions: function () { return window.PPActions; }, inputs: function () { return window.PPConfigure ? window.PPConfigure.inputs() : null; },
    rerender: function () { if (window.PPShell && window.PPShell.currentTab() === "settings") window.PPShell.renderSystemExtras(); },
    changed: function () { if (window.PPActions) window.PPActions.modeChanged(); },
    label: function (e) { if (e.action === "pad") { var pad = PP.project().pads[(e.args && e.args.index) || 0]; return pad ? pad.name : "Pad"; } if (e.action === "playPauseAll") return window.PPTracks && window.PPTracks.isPlaying() ? "Pause" : "Play"; return null; },
    sectionAttrs: 'data-st="midi"', note: 'Keys are also on the Configure tab ("Stream Deck key …"), next to the footswitches. Page keys: give a key "Stream Deck: next page". The settings travel with Upload (Buttons, knobs and MIDI).'
  } : null);
  if (!H) return;
  var esc = H.esc;
  function A() { return H.actions(); }
  function project() { return H.store(); }
  function $(s, r) { return (r || document).querySelector(s); }

  // the Stream Decks (USB product id) - gen2: JPEG pictures; mini: BMP
  var MODELS = {
    0x006d: { name: "Stream Deck (V2)", keys: 15, cols: 5, px: 72, proto: "gen2", flipH: true, flipV: true, rot: 0 },
    0x0080: { name: "Stream Deck MK.2", keys: 15, cols: 5, px: 72, proto: "gen2", flipH: true, flipV: true, rot: 0 },
    0x00a5: { name: "Stream Deck MK.2 (scissor)", keys: 15, cols: 5, px: 72, proto: "gen2", flipH: true, flipV: true, rot: 0 },
    0x006c: { name: "Stream Deck XL", keys: 32, cols: 8, px: 96, proto: "gen2", flipH: true, flipV: true, rot: 0 },
    0x008f: { name: "Stream Deck XL (V2)", keys: 32, cols: 8, px: 96, proto: "gen2", flipH: true, flipV: true, rot: 0 },
    0x0084: { name: "Stream Deck +", keys: 8, cols: 4, px: 120, proto: "gen2", flipH: false, flipV: false, rot: 0, plus: true },
    0x009a: { name: "Stream Deck Neo", keys: 8, cols: 4, px: 96, proto: "gen2", flipH: true, flipV: true, rot: 0 },
    0x0063: { name: "Stream Deck Mini", keys: 6, cols: 3, px: 80, proto: "mini", flipH: false, flipV: true, rot: 90 },
    0x0090: { name: "Stream Deck Mini MK.2", keys: 6, cols: 3, px: 80, proto: "mini", flipH: false, flipV: true, rot: 90 },
    0x0060: { name: "Stream Deck (original)", keys: 15, cols: 5, px: 72, proto: "v1", flipH: true, flipV: true, rot: 0 }
  };
  var VENDOR = 0x0fd9;

  // ------------------------------------------------------------- settings (in the project: they travel with Upload)
  function cfg() {
    var p = project(), c = p.streamDeck || (p.streamDeck = {});
    if (c.brightness == null) c.brightness = 70;
    if (c.holdMs == null) c.holdMs = 600;
    if (!Array.isArray(c.pages) || !c.pages.length) c.pages = [{ name: "Service" }];
    if (c.page == null || c.page >= c.pages.length) c.page = 0;
    if (!c.keys || typeof c.keys !== "object") c.keys = {};
    if (!c.colors) c.colors = { idle: "#23272e", on: "#e2c27e", blank: "#000000", text: "#ece7dd", textOn: "#1a1408" };
    if (c.rotation == null) c.rotation = "auto";   // auto | 0 | 90 | 180 | 270
    if (c.flip == null) c.flip = "auto";           // auto | none | h | v | both
    if (c.labels == null) c.labels = true;
    if (c.pageKeys == null) c.pageKeys = true;     // the last key of each page goes to the next page (when there are 2+)
    if (c.idleDim == null) c.idleDim = 0;           // minutes without a press -> dim (0 = never)
    return c;
  }
  function keyId(page, k) { return "sd" + (page + 1) + "-" + (k + 1); }
  function model() { return dev ? dev.model : null; }
  function keyCount() { var m = model(); return m ? m.keys : (cfg().lastKeys || 15); }
  function cols() { var m = model(); return m ? m.cols : (cfg().lastCols || 5); }

  var DEFAULTS = [
    ["playPauseAll", null, "Play", "▶"], ["safeStop", null, "Safe stop", "■"], ["prevSection", null, "Section", "◀"], ["nextSection", null, "Section", "▶"],
    ["repeatSection", null, "Vamp", "⟲"], ["prevSong", null, "Song", "⏮"], ["nextSong", null, "Song", "⏭"], ["toggleClick", null, "Click", "♩"],
    ["tap", null, "Tap", "◉"], ["tuner", null, "Tuner", "♪"], ["pad", { index: 0 }, "", "1"], ["pad", { index: 1 }, "", "2"], ["pad", { index: 2 }, "", "3"],
    ["pad", { index: 3 }, "", "4"], ["stop", null, "Pads", "◼"], ["pad", { index: 4 }, "", "5"], ["pad", { index: 5 }, "", "6"], ["pad", { index: 6 }, "", "7"],
    ["pad", { index: 7 }, "", "8"], ["keyDown", null, "Key", "−"], ["keyUp", null, "Key", "+"], ["startOver", null, "Start", "⏪"], ["toggleCues", null, "Cues", "🗣"],
    ["lyricsNext", null, "Lyrics", "⇣"], ["projectorBlank", null, "Blank", "▢"], ["looperMain", null, "Looper", "⏺"], ["looperStop", null, "Looper", "⏹"],
    ["freeze", null, "Freeze", "❄"], ["layer", null, "Layer", "≡"], ["texture1", null, "Texture", "T1"], ["texture2", null, "Texture", "T2"], ["readyCheck", null, "Ready", "✓"]];
  var MINI = [0, 1, 2, 3, 4, 6];   // (6 keys: play, safe stop, sections, vamp, next song)
  function defaultLayout(n, page) {
    var m = A() && A().mapping(), c = cfg();
    var defs = H.defaults || DEFAULTS, list = n <= 6 ? (H.defaults ? defs.slice(0, n) : MINI.map(function (i) { return defs[i]; })) : defs.slice(0, n);
    for (var k = 0; k < n; k++) {
      var id = keyId(page, k), d = list[k];
      if (!d) { m[id] = { action: "none" }; continue; }
      m[id] = { action: d[0] }; if (d[1]) m[id].args = d[1];
      if (d[0] === "playPauseAll") m[id].hold = { action: "stopAll" };
      c.keys[id] = { label: d[2], icon: d[3] };
    }
    H.persist();
  }
  function ensureInputs() {
    var inputs = H.inputs(), c = cfg(), n = keyCount(), m = A() && A().mapping(); if (!inputs || !m) return;
    var have = {}; inputs.forEach(function (i) { have[i.id] = i; });
    c.pages.forEach(function (pg, p) {
      var fresh = true;
      for (var k = 0; k < n; k++) { var id = keyId(p, k); if (m[id]) fresh = false; if (!have[id]) inputs.push({ id: id, name: "Stream Deck " + (c.pages.length > 1 ? (pg.name || "page " + (p + 1)) + " " : "") + "key " + (k + 1), kind: "button", streamdeck: true }); }
      if (fresh) defaultLayout(n, p);
    });
    // keys of a bigger Stream Deck, or of a page that was removed, stay in the project (their settings come back)
  }

  // ------------------------------------------------------------- the device
  var dev = null;   // { hid, model, states: [], holdTimers: {}, lastPic: {} }
  function supported() { return !!(navigator.hid && navigator.hid.getDevices); }
  async function openDevice(hid) {
    var m = MODELS[hid.productId]; if (!m) { H.status("This Stream Deck (" + hid.productName + ") is not one Central Pedal knows yet"); return; }
    try { if (!hid.opened) await hid.open(); } catch (error) { H.status("Could not open the Stream Deck: " + error.message); return; }
    dev = { hid: hid, model: m, states: new Array(m.keys).fill(false), holdTimers: {}, lastPic: {}, lastPress: Date.now(), dimmed: false };
    var c = cfg(); c.lastKeys = m.keys; c.lastCols = m.cols;
    hid.addEventListener("inputreport", onReport);
    try { await brightness(c.brightness); } catch (_) { }
    ensureInputs(); H.persist();
    redraw(true);
    H.status(m.name + " connected");
    rerender();
  }
  async function connectAllowed() {
    if (!supported()) return;
    try { var list = await navigator.hid.getDevices(); var d = list.filter(function (x) { return x.vendorId === VENDOR && MODELS[x.productId]; })[0]; if (d && (!dev || dev.hid !== d)) await openDevice(d); } catch (_) { }
  }
  async function requestDevice() {
    if (!supported()) { H.status("Stream Deck needs Chrome / Edge or the Central apps (WebHID)"); return; }
    try { var list = await navigator.hid.requestDevice({ filters: [{ vendorId: VENDOR }] }); if (list && list[0]) await openDevice(list[0]); } catch (error) { H.status("No Stream Deck picked"); }
  }
  if (supported()) {
    navigator.hid.addEventListener("connect", function () { setTimeout(connectAllowed, 300); });
    navigator.hid.addEventListener("disconnect", function (e) { if (dev && e.device === dev.hid) { dev = null; H.status("Stream Deck unplugged"); rerender(); } });
  }
  function bytes(n) { return new Uint8Array(n); }
  async function brightness(pct) {
    if (!dev) return; pct = Math.max(0, Math.min(100, Math.round(pct)));
    if (dev.model.proto === "gen2") { var b = bytes(31); b[0] = 0x08; b[1] = pct; await dev.hid.sendFeatureReport(0x03, b); }
    else { var m = bytes(16); m.set([0x55, 0xaa, 0xd1, 0x01, pct]); await dev.hid.sendFeatureReport(0x05, m); }
  }
  function onReport(e) {
    if (!dev || e.reportId !== 0x01) return;
    var d = e.data, m = dev.model, off = m.proto === "gen2" ? 3 : 0;
    if (m.plus && d.getUint8(0) !== 0x00) return;   // (Stream Deck +: dials and the touch strip report differently)
    for (var k = 0; k < m.keys; k++) {
      var idx = m.proto === "v1" ? v1Key(k) : k, down = d.byteLength > off + k && d.getUint8(off + k) !== 0;
      if (down !== dev.states[idx]) { dev.states[idx] = down; keyEvent(idx, down); }
    }
  }
  function v1Key(k) { var c = 5, row = Math.floor(k / c), col = k % c; return row * c + (c - 1 - col); }   // (the original reports its rows right to left)
  function keyEvent(k, down) {
    var c = cfg(), id = keyId(c.page, k), a = A(); if (!a) return;
    dev.lastPress = Date.now(); if (dev.dimmed) { dev.dimmed = false; brightness(c.brightness).catch(function () { }); }
    if (down) {
      a.onControl({ id: id, event: "press" });
      clearTimeout(dev.holdTimers[k]); dev.holdTimers[k] = setTimeout(function () { if (dev && dev.states[k]) a.onControl({ id: id, event: "hold" }); }, Math.max(150, c.holdMs));
    } else { clearTimeout(dev.holdTimers[k]); a.onControl({ id: id, event: "release" }); }
    setTimeout(function () { redraw(false); }, 30);
  }

  // ------------------------------------------------------------- the key pictures
  function stateOf(id) {
    var a = A(); if (!a) return "off"; var e = a.entryFor(id); if (!e) return "none";
    var act = a.ACTIONS[e.action]; if (!act || e.action === "none") return "none";
    try { return act.led ? act.led(e.args || {}) : "off"; } catch (_) { return "off"; }
  }
  function labelOf(id) {
    var a = A(), k = cfg().keys[id] || {}, e = a && a.entryFor(id); if (k.label != null && k.label !== "") return k.label;
    if (!e || !a.ACTIONS[e.action]) return "";
    var own = H.label ? H.label(e) : null; if (own) return own;
    return a.ACTIONS[e.action].label.replace(/^(Tracks|Instrument|Flow|Keys|Looper|Rehearse|Setlist|Scene|Lights|Slides|Mix|Tabs|Video|Talkback): /, "").split(/[(:,-]/)[0].trim().slice(0, 14);
  }
  function draw(id, size, blinkOn) {
    var c = cfg(), k = c.keys[id] || {}, st = stateOf(id), on = st === "on" || (st === "blink" && blinkOn), none = st === "none";
    var cv = document.createElement("canvas"); cv.width = cv.height = size; var g = cv.getContext("2d");
    g.fillStyle = none ? c.colors.blank : on ? (k.onColor || c.colors.on) : (k.color || c.colors.idle); g.fillRect(0, 0, size, size);
    if (!none) {
      var label = c.labels ? labelOf(id) : "", icon = k.icon || "";
      g.fillStyle = on ? (k.textOnColor || c.colors.textOn) : (k.textColor || c.colors.text); g.textAlign = "center"; g.textBaseline = "middle";
      if (icon) { g.font = "700 " + Math.round(size * (label ? 0.42 : 0.55)) + "px Inter, system-ui, sans-serif"; g.fillText(icon, size / 2, label ? size * 0.4 : size / 2); }
      if (label) { var fs = Math.round(size * (icon ? 0.17 : 0.22)); g.font = "700 " + fs + "px Inter, system-ui, sans-serif"; wrap(g, label, size / 2, icon ? size * 0.8 : size / 2, size * 0.92, fs); }
    }
    return { canvas: cv, key: [st, on, labelOf(id), k.icon, k.color, k.onColor, c.colors.idle, c.colors.on, c.labels].join("|") };
  }
  function wrap(g, text, x, y, w, fs) {
    var words = String(text).split(/\s+/), lines = [], line = "";
    words.forEach(function (wd) { var t = line ? line + " " + wd : wd; if (g.measureText(t).width > w && line) { lines.push(line); line = wd; } else line = t; });
    if (line) lines.push(line); lines = lines.slice(0, 2);
    var y0 = y - (lines.length - 1) * fs * 0.55; lines.forEach(function (l, i) { g.fillText(l, x, y0 + i * fs * 1.1, w); });
  }
  function orient(src) {
    var c = cfg(), m = dev.model, rot = c.rotation === "auto" ? m.rot : Number(c.rotation) || 0;
    var fh = c.flip === "auto" ? m.flipH : (c.flip === "h" || c.flip === "both"), fv = c.flip === "auto" ? m.flipV : (c.flip === "v" || c.flip === "both");
    var s = src.width, out = document.createElement("canvas"); out.width = out.height = s; var g = out.getContext("2d");
    g.translate(s / 2, s / 2); g.rotate(rot * Math.PI / 180); g.scale(fh ? -1 : 1, fv ? -1 : 1); g.drawImage(src, -s / 2, -s / 2);
    return out;
  }
  function jpeg(cv) { return new Promise(function (res) { cv.toBlob(function (b) { b.arrayBuffer().then(function (ab) { res(new Uint8Array(ab)); }); }, "image/jpeg", 0.9); }); }
  function bmp(cv) {   // 24-bit, bottom-up rows (the Mini)
    var s = cv.width, px = cv.getContext("2d").getImageData(0, 0, s, s).data, row = s * 3, pad = (4 - row % 4) % 4, size = 54 + (row + pad) * s, b = new Uint8Array(size), v = new DataView(b.buffer);
    b[0] = 0x42; b[1] = 0x4d; v.setUint32(2, size, true); v.setUint32(10, 54, true); v.setUint32(14, 40, true); v.setInt32(18, s, true); v.setInt32(22, s, true); v.setUint16(26, 1, true); v.setUint16(28, 24, true); v.setUint32(34, size - 54, true);
    var o = 54; for (var y = s - 1; y >= 0; y--) { for (var x = 0; x < s; x++) { var i = (y * s + x) * 4; b[o++] = px[i + 2]; b[o++] = px[i + 1]; b[o++] = px[i]; } o += pad; }
    return b;
  }
  var sending = Promise.resolve();
  async function sendImage(k, data) {
    var m = dev.model;
    if (m.proto === "gen2") {
      var MAX = 1024 - 8, page = 0, sent = 0;
      while (sent < data.length) {
        var n = Math.min(MAX, data.length - sent), r = bytes(1023);
        r.set([0x07, k, sent + n >= data.length ? 1 : 0, n & 0xff, n >> 8, page & 0xff, page >> 8]); r.set(data.subarray(sent, sent + n), 7);
        await dev.hid.sendReport(0x02, r); sent += n; page++;
      }
    } else if (m.proto === "mini") {
      var MAX2 = 1024 - 16, pg = 0, done = 0;
      while (done < data.length) {
        var n2 = Math.min(MAX2, data.length - done), r2 = bytes(1023);
        r2.set([0x01, pg, 0x00, done + n2 >= data.length ? 1 : 0, k + 1]); r2.set(data.subarray(done, done + n2), 15);
        await dev.hid.sendReport(0x02, r2); done += n2; pg++;
      }
    }   // (the original Stream Deck: keys work, pictures don't)
  }
  var blink = false;
  function redraw(force) {
    if (!dev) return; var c = cfg(), m = dev.model;
    for (var k = 0; k < m.keys; k++) {
      (function (k) {
        var id = keyId(c.page, k), pic = draw(id, m.px, blink);
        if (!force && dev.lastPic[k] === pic.key) return; dev.lastPic[k] = pic.key;
        sending = sending.then(async function () { if (!dev) return; var o = orient(pic.canvas); await sendImage(k, m.proto === "gen2" ? await jpeg(o) : bmp(o)); }).catch(function (error) { console.warn("stream deck", error); });
      })(k);
    }
  }
  setInterval(function () {
    blink = !blink; if (!dev) return; redraw(false);
    var c = cfg(); if (c.idleDim > 0 && !dev.dimmed && Date.now() - dev.lastPress > c.idleDim * 60000) { dev.dimmed = true; brightness(Math.min(10, c.brightness)).catch(function () { }); }
  }, 500);

  // ------------------------------------------------------------- pages (actions any key / pedal can do)
  function setPage(p) { var c = cfg(); c.page = (p + c.pages.length) % c.pages.length; H.persist(); if (dev) { dev.lastPic = {}; redraw(true); } H.status("Stream Deck: " + (c.pages[c.page].name || "page " + (c.page + 1))); rerender(); }
  function addActions() {
    var a = A(); if (!a || a.ACTIONS.sdPageNext) return;
    a.ACTIONS.sdPageNext = { id: "sdPageNext", label: "Stream Deck: next page", group: "Stream Deck", kind: "trigger", run: function () { setPage(cfg().page + 1); } };
    a.ACTIONS.sdPagePrev = { id: "sdPagePrev", label: "Stream Deck: previous page", group: "Stream Deck", kind: "trigger", run: function () { setPage(cfg().page - 1); } };
    a.ACTIONS.sdPage = { id: "sdPage", label: "Stream Deck: go to page N", group: "Stream Deck", kind: "trigger", arg: "scene", run: function (args) { setPage(Number(args && args.index) || 0); } };
    a.ACTIONS.sdBrightness = { id: "sdBrightness", label: "Stream Deck: brightness", group: "Stream Deck", kind: "continuous", run: function (_a, v) { cfg().brightness = Math.round(v * 100); brightness(cfg().brightness).catch(function () { }); H.persist(); } };
  }

  // ------------------------------------------------------------- Settings → Stream Deck
  var selKey = 0;
  function actionOptions(cur) {
    var a = A(), groups = {}; if (!a) return "";
    a.list().forEach(function (x) { if (x.kind !== "trigger" && x.kind !== "step" && x.id !== "none") return; (groups[x.group] = groups[x.group] || []).push(x); });
    return '<option value="none"' + (cur === "none" || !cur ? " selected" : "") + ">— nothing —</option>" + Object.keys(groups).map(function (gname) { return '<optgroup label="' + esc(gname) + '">' + groups[gname].map(function (x) { return '<option value="' + x.id + '"' + (x.id === cur ? " selected" : "") + ">" + esc(x.label) + "</option>"; }).join("") + "</optgroup>"; }).join("");
  }
  function settingsHtml() {
    var c = cfg(), n = keyCount(), cc = cols(), a = A(), id = keyId(c.page, Math.min(selKey, n - 1)), e = (a && a.entryFor(id)) || { action: "none" }, k = c.keys[id] || {}, act = a && a.ACTIONS[e.action];
    var grid = ""; for (var i = 0; i < n; i++) { var kid = keyId(c.page, i), st = stateOf(kid), kk = c.keys[kid] || {}; grid += '<button class="sd-key' + (i === selKey ? " sel" : "") + (st === "on" ? " on" : "") + '" data-sd="key" data-i="' + i + '" style="--c:' + esc(kk.color || c.colors.idle) + ";--o:" + esc(kk.onColor || c.colors.on) + '"><i>' + esc(kk.icon || "") + "</i><small>" + esc(labelOf(kid)) + "</small></button>"; }
    return '<section ' + (H.sectionAttrs || "") + ' class="sd' + (H.sectionClass ? " " + H.sectionClass : "") + '"><h3>Stream Deck</h3>' +
      '<p class="small">' + (dev ? "✓ <b>" + esc(dev.model.name) + "</b> (" + dev.model.keys + " keys)" : supported() ? '<span class="muted">No Stream Deck connected.</span> <button data-sd="connect">Connect a Stream Deck</button>' : '<span class="muted">This browser can\'t reach a Stream Deck (WebHID) - the Central Pedal and the Central apps can.</span>') + "</p>" +
      '<div class="row sd-pages">' + c.pages.map(function (pg, p) { return '<button data-sd="page" data-i="' + p + '"' + (p === c.page ? ' class="on"' : "") + ">" + esc(pg.name || "Page " + (p + 1)) + "</button>"; }).join("") + '<button data-sd="addPage" title="Add a page">＋</button>' + (c.pages.length > 1 ? '<button data-sd="renamePage">Rename</button><button data-sd="delPage">Remove page</button>' : '<button data-sd="renamePage">Rename</button>') + "</div>" +
      '<div class="sd-main"><div class="sd-grid" style="grid-template-columns:repeat(' + cc + ',1fr)">' + grid + "</div>" +
      '<div class="sd-edit"><b>Key ' + (selKey + 1) + "</b>" +
      '<label>Press<select data-sd="action">' + actionOptions(e.action) + "</select></label>" +
      (act && act.arg ? '<label>Which (number)<input type="number" min="1" max="99" data-sd="arg" value="' + (((e.args && e.args.index) || 0) + 1) + '"></label>' : "") +
      '<label>Hold<select data-sd="hold">' + actionOptions(e.hold && e.hold.action) + "</select></label>" +
      '<label>Label<input data-sd="label" maxlength="24" value="' + esc(k.label || "") + '" placeholder="' + esc(labelOf(id) || "(from the action)") + '"></label>' +
      '<label>Icon (an emoji or 1-2 letters)<input data-sd="icon" maxlength="4" value="' + esc(k.icon || "") + '"></label>' +
      '<label>Colour<input type="color" data-sd="color" value="' + esc(k.color || c.colors.idle) + '"></label>' +
      '<label>Colour when on<input type="color" data-sd="onColor" value="' + esc(k.onColor || c.colors.on) + '"></label>' +
      '<div class="row"><button data-sd="clearKey">Clear this key</button><button data-sd="resetPage">Default layout for this page</button></div></div></div>' +
      '<div class="sd-opts"><label>Brightness<span class="control-line"><input type="range" min="0" max="100" data-sd="brightness" value="' + c.brightness + '"><output>' + c.brightness + "%</output></span></label>" +
      '<label>Hold time (ms)<input type="number" min="150" max="3000" step="50" data-sd="holdMs" value="' + c.holdMs + '"></label>' +
      '<label>Dim after (minutes, 0 = never)<input type="number" min="0" max="240" data-sd="idleDim" value="' + c.idleDim + '"></label>' +
      '<label class="toggle"><input type="checkbox" data-sd="labels"' + (c.labels ? " checked" : "") + "> Show labels on the keys</label>" +
      '<label>Key colour<input type="color" data-sd="cIdle" value="' + esc(c.colors.idle) + '"></label><label>On colour<input type="color" data-sd="cOn" value="' + esc(c.colors.on) + '"></label>' +
      '<label>Picture rotation<select data-sd="rotation">' + ["auto", "0", "90", "180", "270"].map(function (x) { return '<option value="' + x + '"' + (String(c.rotation) === x ? " selected" : "") + ">" + (x === "auto" ? "Automatic" : x + "°") + "</option>"; }).join("") + "</select></label>" +
      '<label>Picture flip<select data-sd="flip">' + [["auto", "Automatic"], ["none", "None"], ["h", "Left ↔ right"], ["v", "Upside down"], ["both", "Both"]].map(function (x) { return '<option value="' + x[0] + '"' + (c.flip === x[0] ? " selected" : "") + ">" + x[1] + "</option>"; }).join("") + "</select></label></div>" +
      '<p class="muted small">' + esc(H.note || "") + "</p></section>";
  }
  function rerender() { H.rerender(); }
  function mapEntry() { var c = cfg(), id = keyId(c.page, selKey), m = A().mapping(); return { id: id, m: m, e: m[id] || (m[id] = { action: "none" }), k: c.keys[id] || (c.keys[id] = {}) }; }
  function changed() { H.persist(); if (dev) redraw(true); H.changed(); rerender(); }
  document.addEventListener("click", async function (e) {
    var b = e.target.closest && e.target.closest("[data-sd]"); if (!b || b.tagName === "SELECT" || b.tagName === "INPUT") return;
    var a = b.dataset.sd, c = cfg();
    if (a === "connect") return requestDevice();
    if (a === "key") { selKey = Number(b.dataset.i); return rerender(); }
    if (a === "page") return setPage(Number(b.dataset.i));
    if (a === "addPage") { c.pages.push({ name: "Page " + (c.pages.length + 1) }); ensureInputs(); return setPage(c.pages.length - 1); }
    if (a === "renamePage") { var nm = await H.ask("Name of this page", { value: c.pages[c.page].name || "" }); if (nm) { c.pages[c.page].name = nm.trim().slice(0, 20); changed(); } return; }
    if (a === "delPage") { if (!confirm("Remove the page \"" + (c.pages[c.page].name || "") + "\"?")) return; c.pages.splice(c.page, 1); c.page = 0; changed(); return; }
    if (a === "clearKey") { var me = mapEntry(); me.m[me.id] = { action: "none" }; delete c.keys[me.id]; return changed(); }
    if (a === "resetPage") { defaultLayout(keyCount(), c.page); return changed(); }
  });
  document.addEventListener("change", function (e) {
    var t = e.target; if (!t.dataset || !t.dataset.sd) return;
    var a = t.dataset.sd, c = cfg(), me = (a === "action" || a === "hold" || a === "arg" || a === "label" || a === "icon" || a === "color" || a === "onColor") ? mapEntry() : null;
    if (a === "action") { me.m[me.id] = { action: t.value }; if (me.e.hold) me.m[me.id].hold = me.e.hold; }
    else if (a === "hold") { if (t.value === "none") delete me.e.hold; else me.e.hold = { action: t.value }; }
    else if (a === "arg") me.e.args = { index: Math.max(0, (Number(t.value) || 1) - 1) };
    else if (a === "label") me.k.label = t.value;
    else if (a === "icon") me.k.icon = t.value;
    else if (a === "color") me.k.color = t.value;
    else if (a === "onColor") me.k.onColor = t.value;
    else if (a === "brightness") { c.brightness = Number(t.value); brightness(c.brightness).catch(function () { }); }
    else if (a === "holdMs") c.holdMs = Math.max(150, Number(t.value) || 600);
    else if (a === "idleDim") c.idleDim = Math.max(0, Number(t.value) || 0);
    else if (a === "labels") c.labels = t.checked;
    else if (a === "cIdle") c.colors.idle = t.value;
    else if (a === "cOn") c.colors.on = t.value;
    else if (a === "rotation") c.rotation = t.value === "auto" ? "auto" : Number(t.value);
    else if (a === "flip") c.flip = t.value;
    changed();
  });
  document.addEventListener("input", function (e) { var t = e.target; if (t.dataset && t.dataset.sd === "brightness") { var o = t.parentNode.querySelector("output"); if (o) o.textContent = t.value + "%"; brightness(Number(t.value)).catch(function () { }); } });

  addActions();
  setTimeout(function () { if (cfg().lastKeys) ensureInputs(); connectAllowed(); }, 800);   // (its keys show on Configure once a Stream Deck has been used here)
  window.PPStreamDeck = { settingsHtml: settingsHtml, connect: requestDevice, connected: function () { return dev ? dev.model.name : null; }, MODELS: MODELS, draw: draw, keyId: keyId, setPage: setPage, cfg: cfg, defaultLayout: defaultLayout, _open: openDevice, redraw: redraw, ensureInputs: ensureInputs };
})();
