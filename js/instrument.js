/* Central Pedal - the Instrument tab: acoustic guitar, electric guitar or
 * piano / keys through a native, low-latency plugin chain on the Pi (PipeWire +
 * LV2 / LADSPA: Guitarix, Calf, Dragonfly, Zam, mda, swh, TAP, CAPS...) and
 * FluidSynth / free sample banks for keys. This file is the control surface:
 * boards, pedals with graphics, knobs, patches, input / output, tuner, Auto.
 * The driver (pedal-driver.py, InstrumentHost) runs the audio. */
(function () {
  "use strict";
  // the instrument's start-up errors, in words a musician can act on (the raw text stays under Details)
  function errText(e) {
    e = String(e || "");
    if (/host is down|can't connect|cannot connect|pipewire|pw\.conf|module-filter/i.test(e)) return "The sound system isn't running, so the instrument can't start. Restart the pedal; if it keeps happening, send us the start-up report (Settings → System).";
    if (/no (usb )?(audio )?interface|no such device|input.*not found|capture/i.test(e)) return "No audio input found. Plug your guitar into a USB audio interface on the pedal, then pick it under Input.";
    if (/plugin|lv2|not installed/i.test(e)) return "One of the pedals on this board isn't installed on this Central Pedal. Take it off the board or pick another board.";
    return "The instrument couldn't start. Try another board, or restart the pedal.";
  }
  var PP = window.PP, F = window.PPFeatures, PED = window.PPPedals; if (!PP || !F || !PED) return;
  var esc = PP.escapeHtml, clamp = PP.clamp;
  function $(s, r) { return (r || document).querySelector(s); }
  function project() { return PP.project(); }
  function bridge() { return window.__pedalBridge; }
  function connected() { return !!(bridge() && bridge().connected); }
  function send(m) { return bridge() && bridge().send ? bridge().send(m) : false; }
  function uid() { return Math.random().toString(36).slice(2, 9); }
  function onTab() { return window.PPShell && window.PPShell.currentTab() === "instrument"; }

  // ------------------------------------------------------------- state
  var KINDS = [["electric", "Electric guitar", "¼″ jack on the USB interface"], ["acoustic", "Acoustic guitar", "¼″ jack on the USB interface"], ["bass", "Bass guitar", "¼″ jack on the USB interface"], ["keys", "Piano & keys", "USB MIDI keyboard"], ["off", "Off", "instrument output silent"]];
  var DEFAULT_BOARD = { electric: "clean-worship", acoustic: "acoustic-natural", bass: "bass-di", keys: "keys-stage" };
  function defaults() { return { kind: "off", input: { device: "auto", channel: "L", gain: 0, gate: -70 }, output: { level: 0 }, chains: {}, boards: {}, keys: { patch: null, transpose: 0, velocity: "normal", sustain: true, midi: "auto", reverb: 20, chorus: 0 }, expression: null, custom: [] }; }
  function cfg() { var p = project(); if (!p.instrument || !p.instrument.chains) p.instrument = Object.assign(defaults(), p.instrument || {}); var c = p.instrument, d = defaults(); ["chains", "boards", "keys", "input", "output", "custom"].forEach(function (k) { if (!c[k]) c[k] = d[k]; }); return c; }
  function kind() { return cfg().kind; }
  function chainFor(k) { var c = cfg(); k = k || kind(); if (k === "off") return []; if (!c.chains[k]) loadBoard(k, firstBoard(k)); return c.chains[k] || []; }
  function firstBoard(k) { var want = DEFAULT_BOARD[k], all = allBoards().filter(function (b) { return b.kind === k; }), def = all.filter(function (b) { return b.id === want; })[0]; if (def && !boardLocked(def)) return want; var open = all.filter(function (b) { return !boardLocked(b); })[0]; return open ? open.id : want; }
  function allBoards() { return PED.boards.concat(cfg().custom); }
  function loadBoard(k, boardId) {
    var c = cfg(), board = allBoards().filter(function (b) { return b.id === boardId; })[0]; if (!board) return;
    c.boards[k] = boardId;
    if (k === "keys" && board.sound) pickBoardSound(c, board);
    c.chains[k] = board.chain.map(function (item) { if (item[0] === "plug" && item[2] && item[2].plugin) return { uid: uid(), pedal: "plug", plugin: item[2].plugin, stateFrom: item[2].stateFrom || null, on: true, values: {} }; var pedal = PED.byId(item[0]); if (!pedal) return null; var values = Object.assign({}, pedal.opts.values || {}); Object.keys(item[1] || {}).forEach(function (label) { values[pedal.knobs[label] || label] = item[1][label]; }); var out = { uid: uid(), pedal: pedal.id, on: true, values: values }, x = item[2] || {}; if (pedal.opts.irFile && (x.file || x.ir)) { out.file = x.file || irByName(x.ir) || null; if (x.ir) out.irName = x.ir; } return out; }).filter(Boolean);
  }
  function pickBoardSound(c, board) {   // ("Worship Grand" brings a grand piano, "Ambient Keys" a pad: the first unlocked sound that matches)
    if (!catalog.keys.length) return false; var parts = String(board.sound).toLowerCase().split("|"), snd = null;
    for (var i = 0; i < parts.length && !snd; i++) snd = catalog.keys.filter(function (q) { return !tierLocked(q.tier) && (q.name + " " + q.bankName).toLowerCase().indexOf(parts[i]) > -1; })[0] || null;
    if (!snd) return false; var np = { id: snd.id, file: snd.file, bank: snd.bank, prog: snd.prog, name: snd.name }; layers(c)[0].patch = np; c.keys.patch = np; return true;
  }
  var CATS = [[/rhodes|wurli|e\.? ?piano|elec.*piano|\bep\b|fm[ _-]?piano|\bdx|tine|clav/i, "Electric pianos"], [/harp|guitar|nylon|banjo|sitar|koto|dulcimer|shamisen/i, "Guitars & harp"], [/grand|concert|steinway|yamaha|piano|upright|honky|salamander|ydp/i, "Pianos"], [/organ|drawbar|hammond|b3|church|pipe|rotary|accordion|harmonica/i, "Organs"], [/\bbass\b|bass ?yr|lately/i, "Bass"], [/brass|trumpet|horn|trombone|sax|tuba|oboe|flute|clarinet|bassoon|recorder|pan ?flute|whistle|ocarina/i, "Brass & winds"], [/pad|choir|voice|vox|aah|ooh|halo|atmos|sweep|new age|warm|bowed|space|dream/i, "Pads & choirs"], [/string|violin|cello|viola|orch|ensemble|tremolo str|pizz/i, "Strings"], [/bell|glock|vibra|marimba|celest|music box|tubular|kalimba|chime|xylo|timpani|steel dr|glass|hang\b|crystal/i, "Bells & mallets"], [/lead|square|saw|calliope|chiff|charang|fifth|synth|poly|wave/i, "Synths & leads"], [/steel/i, "Guitars & harp"]];
  function categoryOf(name) { for (var i = 0; i < CATS.length; i++) if (CATS[i][0].test(name)) return CATS[i][1]; return "Other"; }
  function flattenKeys(banks) { var out = [], order = CATS.map(function (c) { return c[1]; }); banks.forEach(function (b) { (b.presets || []).forEach(function (pr) { var nm = pr.name || b.name; out.push({ id: b.file + "#" + pr.bank + ":" + pr.prog, file: b.file, bank: pr.bank, prog: pr.prog, name: nm, bankName: b.name + (b.user && !b.tier ? " (yours)" : ""), category: categoryOf(nm + " " + (b.presets.length < 4 ? b.name : "")), user: !!b.user && !b.tier, bankTier: b.tier || null }); }); });
    out.forEach(function (e) { e.tier = PED.soundTier ? PED.soundTier(e) : "free"; });
    out.sort(function (a, b) { var ca = a.user ? -1 : order.indexOf(a.category), cb = b.user ? -1 : order.indexOf(b.category); if (ca < 0 && !a.user) ca = 99; if (cb < 0 && !b.user) cb = 99; return ca - cb || a.name.localeCompare(b.name); }); return out; }
  // the input's channels to pick from: 1 and 2 (and both), or every input of a bigger USB interface and its pairs
  function inputChannelOptions(inp) {
    var dev = catalog.inputs.filter(function (i) { return i.id === inp.device; })[0] || (inp.device === "auto" || !inp.device ? catalog.inputs.filter(function (i) { return i.usb; })[0] : null);
    var n = Math.max(2, Math.min(32, (dev && dev.channels) || 2)), out = [["L", "Input 1 (left)"], ["R", "Input 2 (right)"], ["stereo", "Inputs 1 + 2 (stereo)"]];
    for (var i = 3; i <= n; i++) out.push([String(i), "Input " + i]);
    for (var p = 3; p < n; p += 2) out.push([p + "-" + (p + 1), "Inputs " + p + " + " + (p + 1) + " (stereo)"]);
    if (inp.channel && !out.some(function (o) { return o[0] === String(inp.channel); })) out.push([String(inp.channel), "Input " + inp.channel + " (not on this device)"]);
    return out;
  }
  var catalog = { plugins: {}, keys: [], inputs: [], midi: [], ready: false }, status = { running: false }, selected = null, showAdd = false, addCat = "all", addQuery = "", keysCat = "all", keysQuery = "", tunerOn = false;

  // ------------------------------------------------------------- the plans (Central Keys / Plugins / Instrument / Pedals)
  // Locked things stay in sight with a lock and the plan that opens them. A saved board with a locked pedal keeps it, bypassed
  // (the engine skips it) until the plan is active again; a keys layer with a locked sound stays, muted. Stepping skips them.
  function tierLocked(tier) { return !!(PED.has && !PED.has(tier)); }
  function itemLocked(item) { if (!item || isPlug(item)) return false; var p = PED.byId(item.pedal); return !!(p && PED.pedalLocked && PED.pedalLocked(p)) || irLocked(item); }
  // impulse responses: a library's IRs keep its plan (status.irs[].tier); a board from a library names its IR ("ir": name)
  function irOf(item) { var f = item && (item.file || irByName(item.irName)); return f ? (status.irs || []).filter(function (x) { return x.file === f; })[0] || null : null; }
  function irByName(name) { if (!name) return null; var n = String(name).toLowerCase(), hit = (status.irs || []).filter(function (x) { return String(x.name || "").toLowerCase() === n || String(x.file || "").toLowerCase().split(/[\\/]/).pop() === n + ".wav"; })[0]; return hit ? hit.file : null; }
  function irLocked(item) { var ir = irOf(item); return !!(ir && ir.tier && tierLocked(ir.tier)); }
  function soundOf(patch) { if (!patch || patch.plugin) return null; for (var i = 0; i < catalog.keys.length; i++) if (catalog.keys[i].id === patch.id) return catalog.keys[i]; return null; }
  function soundLocked(patch) { var so = soundOf(patch); return !!(so && tierLocked(so.tier)); }
  function boardLocked(b) { return !!(b && PED.boardLocked && PED.boardLocked(b)); }
  function boardMissing(b) { return PED.missing ? PED.missing(b.plans || PED.boardPlans(b)) : []; }
  function lockText(t) { return PED.lockText ? PED.lockText(t) : ""; }
  function planName(t) { return (PED.PLANS && PED.PLANS[t] || {}).name || "a plan"; }
  var LOCK = '<svg class="lock-ico" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="8" rx="1.6" fill="currentColor"/><path d="M5.2 7V5.2a2.8 2.8 0 0 1 5.6 0V7" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
  function lockCss() {
    if (document.getElementById("lockCss")) return; var st = document.createElement("style"); st.id = "lockCss";
    st.textContent = ".lock-ico{width:1em;height:1em;vertical-align:-.12em;margin-right:.3em}.pb-item.locked,.keys-item.locked{opacity:.6}.pb-item.locked small,.keys-item.locked small{color:var(--accent,#e2c27e)}" +
      ".lock-note{border:1px solid var(--accent,#e2c27e);border-radius:10px;padding:8px 10px;margin:0 0 8px;background:rgba(226,194,126,.08)}.kl-lock{display:block;color:var(--accent,#e2c27e);font-size:12px}";
    document.head.appendChild(st);
  }
  function lockedSay(text) { PP.setStatus(text); }
  function lockedLine(t, what) { return lockText(t) + ": " + what; }
  window.addEventListener("pp-plans", function () { if (kind() !== "off") apply("plans"); if (onTab()) render(); });

  // ------------------------------------------------------------- the musician's own plugins (VST3, CLAP, Audio Units, LV2: on computers, through the rig's plugin host)
  // A plugin pedal is { uid, pedal: "plug", plugin: { format, id, path, name, vendor }, on, mix, levelDb }; its settings live in the plugin
  // (saved by the host under its uid). A keys layer plays a plugin instrument when its patch is { plugin: {...}, name }.
  var PLUG_CAT = { name: "Your plugins", color: "#7b6cd9" };
  var plugs = { list: [], failed: [], folders: [], formats: "", scanned: false, scan: null, params: {}, paramsAt: {}, open: {} }, addTab = "pedals";
  function plugHost() { return status.engine === "cu-rig" && !!status.pluginFormats; }
  function isPlug(item) { return !!(item && item.plugin); }
  function plugPedal(item) { var pl = item.plugin || {}; return { id: "plug", name: pl.name || "Plugin", category: "plugins", uri: "plug:" + pl.format + ":" + pl.id, knobs: {}, opts: {}, plugin: pl }; }
  function pedalOf(item) { return item ? (item.plugin ? plugPedal(item) : PED.byId(item.pedal)) : null; }
  function catOf(pedal) { return pedal && pedal.category === "plugins" ? PLUG_CAT : PED.CATEGORIES[pedal && pedal.category] || { color: "#777" }; }
  function fmtName(f) { return { vst3: "VST3", clap: "CLAP", au: "Audio Unit", lv2: "LV2" }[f] || String(f || "").toUpperCase(); }
  function plugRef(p) { return { format: p.format, id: p.id, path: p.path || "", name: p.name, vendor: p.vendor || "" }; }
  function slotInfo(id) { return (status.pluginSlots || {})[id] || null; }
  function slotError(id) { return (status.pluginErrors || {})[id] || null; }
  function scanPlugins(force) { plugs.scan = { done: 0, total: 0, current: "" }; send({ type: "instrument", action: "plugins", scan: true, force: !!force, folders: cfg().pluginFolders || [] }); if (onTab()) render(); }

  // ------------------------------------------------------------- plugin port info (generated from the OS image: js/plugin-ports.js; the Pi's live scan wins when present)
  var PORTS = window.PP_PLUGIN_PORTS || {}, KNOBS = window.PP_PEDAL_KNOBS || {};
  function portsOf(pedal) { var live = catalog.plugins[pedal.uri], gen = PORTS[pedal.uri]; var list = (live && live.controls) || (gen && gen.controls) || null; return list ? list.filter(function (p) { return p.dir !== "out"; }) : null; }
  // plugin port names arrive as symbols sometimes ("HOSTBPM", "wet_dry"): make them readable
  function niceLabel(l) { l = String(l || "").replace(/[_]+/g, " ").trim(); if (l.length > 3 && l === l.toUpperCase() && /[A-Z]{4}/.test(l)) l = l.charAt(0) + l.slice(1).toLowerCase(); return l.replace(/\bbpm\b/i, "BPM").replace(/\beq\b/i, "EQ").replace(/\blfo\b/i, "LFO").replace(/\bhostbpm\b/i, "Host BPM").replace(/\bhowpass\b/i, "Low pass"); }
  function controlsOf(pedal) {
    var ports = portsOf(pedal), out = [], knobs = KNOBS[pedal.id] || Object.keys(pedal.knobs).map(function (l) { return [l, pedal.knobs[l]]; });
    function add(label, p, extra) { out.push({ label: niceLabel(label), sym: p.sym, min: p.min != null ? p.min : 0, max: p.max != null ? p.max : 1, def: p.def, toggled: !!p.toggled, integer: !!p.integer, enum: !!(p.enum || (p.scale && p.scale.length > 1)), scale: p.scale || [], log: !!p.log, unit: p.unit, extra: !!extra }); }
    if (ports) {
      knobs.forEach(function (k) { var port = ports.filter(function (p) { return p.sym === k[1]; })[0]; if (port && !out.some(function (o) { return o.sym === port.sym; })) add(k[0], port, false); });
      ports.forEach(function (p) { if (out.some(function (o) { return o.sym === p.sym; })) return; if (/^(bypass|enable|enabled|on|active|latency|level_in|level_out|BYPASS|HIGHGAIN|RESET|MIDI_ON|VERIFY)$/i.test(p.sym) && pedal.id !== "volume") return; add(p.name, p, true); });
    } else knobs.forEach(function (k) { out.push({ label: k[0], sym: k[1], min: 0, max: 1, def: 0.5, scale: [], guess: true }); });
    return out;
  }
  function expressionCtl(pedal) { if (!pedal.opts.expression) return null; var ctls = controlsOf(pedal), want = pedal.opts.expression; return ctls.filter(function (c) { return c.sym === want || c.label === want || (pedal.knobs[c.label] === want); })[0] || ctls[0] || null; }
  function valueOf(item, ctl) { var v = item.values[ctl.sym]; if (v == null) v = ctl.def != null ? ctl.def : (ctl.min + ctl.max) / 2; return v; }
  function norm(ctl, v) { if (ctl.max === ctl.min) return 0; if (ctl.log && ctl.min > 0) return clamp(Math.log(v / ctl.min) / Math.log(ctl.max / ctl.min), 0, 1); return clamp((v - ctl.min) / (ctl.max - ctl.min), 0, 1); }
  function denorm(ctl, n) { n = clamp(n, 0, 1); var v = ctl.log && ctl.min > 0 ? ctl.min * Math.pow(ctl.max / ctl.min, n) : ctl.min + (ctl.max - ctl.min) * n; if (ctl.integer || ctl.enum) v = Math.round(v); if (ctl.toggled) v = n >= 0.5 ? 1 : 0; return v; }
  function fmt(ctl, v) { if (ctl.toggled) return v >= 0.5 ? "on" : "off"; if (ctl.sym === "Ratio" && ctl.min === 0 && ctl.max === 1 && !ctl.unit) return v >= 0.995 ? "∞ : 1" : (1 / (1 - v)).toFixed(1) + " : 1";   /* x42 darc: 0 = 1:1, 1 = limiting */ if (ctl.scale.length) { var sp = ctl.scale.filter(function (s) { return Math.abs(s[0] - v) < 1e-6; })[0]; if (sp) return sp[1]; } var a = Math.abs(v), t = a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2); return t + (ctl.unit ? " " + ctl.unit.replace(/^db$/, "dB").replace(/^hz$/, "Hz") : ""); }
  function resolvedChain(k) {
    return chainFor(k).map(function (item) { if (isPlug(item)) return plugHost() ? { uid: item.uid, id: "plug", name: item.plugin.name, plugin: item.plugin, stateFrom: item.stateFrom || undefined, on: item.on !== false, mix: item.mix == null ? 1 : item.mix, levelDb: item.levelDb || 0 } : null; var pedal = PED.byId(item.pedal); if (!pedal) return null; var values = {}; controlsOf(pedal).forEach(function (ctl) { values[ctl.sym] = valueOf(item, ctl); }); return { uid: item.uid, id: pedal.id, name: pedal.name, uri: pedal.uri, on: item.on !== false && !itemLocked(item), locked: itemLocked(item) || undefined, values: values, mix: item.mix == null ? 1 : item.mix, levelDb: item.levelDb || 0, file: item.file || irByName(item.irName) || null }; }).filter(Boolean);
  }
  function hostConfig() {
    var c = cfg(), k = kind();
    return { kind: k, input: { device: c.input.device || "auto", channel: c.input.channel || "L", gainDb: c.input.gain || 0, gateOn: c.input.gate > -90, gateDb: c.input.gate != null ? c.input.gate : -70 }, chain: resolvedChain(k),
      keys: hostKeys(c), levelDb: outLevel(), routing: project().routing || {}, looper: !!(window.PPLooper && window.PPLooper.armed()), playAny: hostPlayAny(c, k) };
  }
  // ---- play any sound: a guitar, bass or acoustic plays any keys sound. Single notes (lead lines) are tracked and play the
  // chosen sound; chords play a guitar-synth sound (no note detection, so it follows at once). Auto switches between them.
  var GUITARS = { electric: 1, acoustic: 1, bass: 1 }, PA_MODES = [["auto", "Auto", "notes for lead lines, synth for chords"], ["notes", "Notes", "every note plays the sound"], ["synth", "Synth", "a guitar synth that follows chords"]];
  function paCfg(c) { c = c || cfg(); if (!c.playAny) c.playAny = { on: false, patch: null, mode: "auto", dry: 0, sensitivity: 0.5, volume: 1 }; return c.playAny; }
  function hostPlayAny(c, k) {
    if (!GUITARS[k || kind()]) return undefined;
    var pa = paCfg(c), patch = pa.patch && !pa.patch.plugin ? { file: pa.patch.file, bank: pa.patch.bank, prog: pa.patch.prog, name: pa.patch.name } : null;
    if (patch && soundLocked(pa.patch)) patch = null;   // (a sound from a plan that ended: the synth still works, the notes stay quiet)
    return { on: !!pa.on && !paLocked(), patch: patch, mode: pa.mode || "auto", dry: pa.dry == null ? 0 : pa.dry, sensitivity: pa.sensitivity == null ? 0.5 : pa.sensitivity, volume: pa.volume == null ? 1 : pa.volume };
  }
  var paTimer = 0;
  function paSend(now) { clearTimeout(paTimer); var go = function () { var hp = hostPlayAny(cfg(), kind()); if (hp) send({ type: "instrument", action: "playany", playAny: hp }); PP.persistSoon(); if (window.PPActions) window.PPActions.sendLeds(); }; if (now) go(); else paTimer = setTimeout(go, 80); }
  function paLocked() { return tierLocked("instrument"); }   // (play any sound is part of Central Instrument)
  function playAnyOn() { return GUITARS[kind()] && !paLocked() ? !!paCfg().on : false; }
  function setPlayAny(o) {
    if (o && o.on && paLocked()) { PP.setStatus("Play any sound: " + lockText("instrument")); o = Object.assign({}, o, { on: false }); }
    var pa = paCfg(); Object.keys(o || {}).forEach(function (key) { pa[key] = o[key]; });
    if (pa.on && !pa.patch && catalog.keys.length) { var p = catalog.keys.filter(function (q) { return /grand|piano/i.test(q.name); })[0] || catalog.keys[0]; pa.patch = { id: p.id, file: p.file, bank: p.bank, prog: p.prog, name: p.name }; }
    paSend(o && (o.on != null || o.mode != null || o.patch)); if (onTab()) render(); return pa;
  }
  function togglePlayAny() {
    if (!GUITARS[kind()]) { PP.setStatus("Play any sound works with an electric, acoustic or bass guitar"); return false; }
    if (paLocked()) { PP.setStatus("Play any sound: " + lockText("instrument")); return false; }
    var pa = setPlayAny({ on: !paCfg().on }); PP.setStatus("Play any sound " + (pa.on ? "on: " + (pa.mode === "synth" ? "guitar synth" : (pa.patch ? pa.patch.name : "a piano")) : "off")); return pa.on;
  }
  function stepPlayAnyMode(d) { var pa = paCfg(), i = PA_MODES.findIndex(function (m) { return m[0] === (pa.mode || "auto"); }), m = PA_MODES[(i + (d || 1) + PA_MODES.length) % PA_MODES.length]; setPlayAny({ mode: m[0] }); PP.setStatus("Play any sound: " + m[1] + " (" + m[2] + ")"); }
  function paSoundOptions(cur) {
    var groups = {}, order = [];
    catalog.keys.forEach(function (p) { var g = p.user ? "Yours" : p.category; if (!groups[g]) { groups[g] = []; order.push(g); } groups[g].push(p); });
    return (cur || !catalog.keys.length ? "" : '<option value="">— choose a sound —</option>') + order.map(function (g) { return '<optgroup label="' + esc(g) + '">' + groups[g].map(function (p) { return '<option value="' + esc(p.id) + '"' + (cur && cur.id === p.id ? " selected" : "") + ">" + esc(p.name) + "</option>"; }).join("") + "</optgroup>"; }).join("");
  }
  function playAnyPanel(c) {
    var pa = paCfg(c), st = status.playAny || {}, locked = paLocked(), avail = (!connected() || st.available !== false) && !locked, mode = pa.mode || "auto";
    return '<section class="in-playany' + (pa.on ? " on" : "") + '"><div class="row spread"><div><h3>Play any sound</h3><p class="muted">Your ' + (kind() === "bass" ? "bass" : "guitar") + " plays any sound: single notes play the sound you pick (piano, bass, synth, strings…); chords play a guitar synth that follows them at once.</p></div>" +
      '<div class="se-row"><span class="pa-now muted small" data-panow>' + (pa.on ? "" : "") + '</span><button class="pf-btn pa-on' + (pa.on ? " on" : "") + '" id="paOn"' + (avail ? "" : " disabled") + '><small>PLAY ANY SOUND</small><b>' + (pa.on ? "ON" : "OFF") + "</b></button></div></div>" +
      (locked ? '<p class="warn small pa-lock">🔒 ' + esc(lockText("instrument")) + "</p>" : avail ? "" : '<p class="warn small">Not available on this system yet (its plugin is missing).</p>') +
      '<div class="in-bar pa-bar"><label>Sound<select id="paSound">' + (catalog.keys.length ? paSoundOptions(pa.patch) : '<option value="">' + (connected() ? "No sounds found yet" : "The sound list comes from the Pi") + "</option>") + "</select></label>" +
      '<label>Mode<span class="seg pa-modes">' + PA_MODES.map(function (m) { return '<button class="' + (mode === m[0] ? "on" : "") + '" data-pamode="' + m[0] + '" title="' + esc(m[2]) + '">' + m[1] + "</button>"; }).join("") + "</span></label>" +
      '<label>Dry guitar <span class="control-line"><input type="range" id="paDry" min="0" max="100" step="1" value="' + Math.round((pa.dry || 0) * 100) + '"><output>' + Math.round((pa.dry || 0) * 100) + "%</output></span></label>" +
      '<label>Sensitivity <span class="control-line"><input type="range" id="paSens" min="0" max="100" step="1" value="' + Math.round((pa.sensitivity == null ? 0.5 : pa.sensitivity) * 100) + '"><output>' + Math.round((pa.sensitivity == null ? 0.5 : pa.sensitivity) * 100) + "</output></span></label>" +
      '<label>Level <span class="control-line"><input type="range" id="paVol" min="0" max="150" step="1" value="' + Math.round((pa.volume == null ? 1 : pa.volume) * 100) + '"><output>' + Math.round((pa.volume == null ? 1 : pa.volume) * 100) + "%</output></span></label></div>" +
      '<p class="muted small">Footswitch: Configure → "Play any sound on / off". Play cleanly for the best tracking: higher Sensitivity hears softer playing, lower ignores string noise.</p></section>';
  }
  // ---- keys layers: up to 8 sounds at once (piano + pad + strings…), each with its own volume, pan, octave, key range and velocity range
  var MAX_LAYERS = 8;
  function layers(c) {
    c = c || cfg(); if (!Array.isArray(c.keys.layers) || !c.keys.layers.length) c.keys.layers = [{ id: uid(), patch: c.keys.patch || null, on: true, volume: 1, pan: 0, octave: 0, lo: 0, hi: 127, velLo: 1, velHi: 127 }];
    return c.keys.layers;
  }
  function hostKeys(c) {
    var ls = layers(c); c.keys.patch = ls[0] && ls[0].patch || c.keys.patch;
    return { patch: c.keys.patch, volume: c.keys.volume != null ? c.keys.volume : 0.8, transpose: c.keys.transpose || 0, velocity: c.keys.velocity || "normal", sustain: c.keys.sustain !== false,
      layers: ls.slice(0, MAX_LAYERS).filter(function (l) { return !(l.patch && l.patch.plugin) || plugHost(); }).map(function (l) { return { uid: l.id, patch: l.patch && l.patch.plugin ? null : l.patch, plugin: l.patch && l.patch.plugin ? l.patch.plugin : undefined, on: l.on !== false && !soundLocked(l.patch), volume: l.volume == null ? 1 : l.volume, pan: l.pan || 0, octave: l.octave || 0, lo: l.lo == null ? 0 : l.lo, hi: l.hi == null ? 127 : l.hi, velLo: l.velLo || 1, velHi: l.velHi || 127 }; }) };
  }
  function apply(reason) { send({ type: "instrument", action: "apply", config: hostConfig() }); PP.persistSoon(); if (window.PPActions) window.PPActions.sendLeds(); }
  var applyTimer = 0; function applySoon() { clearTimeout(applyTimer); applyTimer = setTimeout(function () { apply(); }, 250); }
  var inputTimer = 0; function inputSoon() { clearTimeout(inputTimer); inputTimer = setTimeout(function () { send({ type: "instrument", action: "input", input: hostConfig().input }); PP.persistSoon(); }, 120); }
  var keysTimer = 0; function keysSoon() { clearTimeout(keysTimer); keysTimer = setTimeout(function () { send({ type: "instrument", action: "keys", keys: hostConfig().keys }); PP.persistSoon(); }, 120); }

  // ------------------------------------------------------------- pedal graphics (SVG stompboxes with live knob positions)
  function dial(n, x, y, r) {
    var rad = function (d) { return d * Math.PI / 180; }, a1 = -135 + 270 * clamp(n, 0, 1), px = x + r * 0.72 * Math.sin(rad(a1)), py = y - r * 0.72 * Math.cos(rad(a1));
    var arc = function (s, e, rr) { var sx = x + rr * Math.sin(rad(s)), sy = y - rr * Math.cos(rad(s)), ex = x + rr * Math.sin(rad(e)), ey = y - rr * Math.cos(rad(e)); return "M" + sx.toFixed(1) + " " + sy.toFixed(1) + " A" + rr + " " + rr + " 0 " + (e - s > 180 ? 1 : 0) + " 1 " + ex.toFixed(1) + " " + ey.toFixed(1); };
    return '<path d="' + arc(-135, 135, r) + '" class="pk-track"/><path d="' + arc(-135, a1 + 0.01, r) + '" class="pk-val"/><circle cx="' + x + '" cy="' + y + '" r="' + (r * 0.62) + '" class="pk-cap"/><line x1="' + x + '" y1="' + y + '" x2="' + px.toFixed(1) + '" y2="' + py.toFixed(1) + '" class="pk-ptr"/>';
  }
  function pedalSvg(item, pedal, idx, sel) {
    if (pedal.plugin) return plugSvg(item, pedal, idx, sel);
    var cat = PED.CATEGORIES[pedal.category] || { color: "#777" }, ctls = controlsOf(pedal).filter(function (c) { return !c.extra; }).slice(0, 6), w = 150, h = 190, cols = Math.min(3, Math.max(1, ctls.length));
    var knobs = ctls.map(function (ctl, i) { var cx = cols === 1 ? w / 2 : 26 + (w - 52) * ((i % cols) / (cols - 1)), cy = 52 + Math.floor(i / cols) * 46; return "<g>" + dial(norm(ctl, valueOf(item, ctl)), cx, cy, 15) + '<text x="' + cx + '" y="' + (cy + 27) + '" class="pk-lbl">' + esc(ctl.label.length > 9 ? ctl.label.slice(0, 8) + "…" : ctl.label) + "</text></g>"; }).join("");
    var lk = itemLocked(item), on = item.on !== false && !lk, plan = lk ? PED.PLANS[pedal.tier] || {} : null;
    return '<svg class="pedal' + (sel ? " selected" : "") + (on ? "" : " off") + (lk ? " locked" : "") + '" viewBox="0 0 ' + w + " " + h + '" data-uid="' + item.uid + '" role="button" tabindex="0" aria-label="' + esc(pedal.name) + '">' +
      '<defs><linearGradient id="g' + item.uid + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + cat.color + '"/><stop offset="1" stop-color="' + cat.color + '" stop-opacity=".55"/></linearGradient></defs>' +
      '<rect x="3" y="3" width="' + (w - 6) + '" height="' + (h - 6) + '" rx="12" fill="url(#g' + item.uid + ')" stroke="' + (sel ? "#fff" : "rgba(0,0,0,.5)") + '" stroke-width="' + (sel ? 3 : 1.5) + '"/>' +
      '<rect x="3" y="3" width="' + (w - 6) + '" height="' + (h - 6) + '" rx="12" fill="rgba(0,0,0,.08)"/>' +
      (on ? '<circle cx="' + (w - 18) + '" cy="18" r="9" fill="#ff4040" opacity=".3"/>' : "") + '<circle cx="' + (w - 18) + '" cy="18" r="5" fill="' + (on ? "#ff4040" : "#4a1a1a") + '" stroke="#200"/>' +
      '<text x="12" y="23" class="pk-n">' + (idx + 1) + "</text>" + knobs +
      '<rect x="12" y="' + (h - 52) + '" width="' + (w - 24) + '" height="22" rx="5" fill="rgba(255,255,255,.9)"/><text x="' + (w / 2) + '" y="' + (h - 37) + '" class="pk-name">' + esc(pedal.name.length > 20 ? pedal.name.slice(0, 19) + "…" : pedal.name) + "</text>" +
      '<g class="pk-sw" data-sw="' + item.uid + '"><circle cx="' + (w / 2) + '" cy="' + (h - 17) + '" r="10" fill="#d8d8d8" stroke="#333" stroke-width="1.5"/><circle cx="' + (w / 2) + '" cy="' + (h - 17) + '" r="4.5" fill="#222"/></g>' +
      (lk ? '<rect x="3" y="3" width="' + (w - 6) + '" height="' + (h - 58) + '" rx="12" fill="rgba(8,10,14,.66)"/><g transform="translate(' + (w / 2 - 13) + ',34)" fill="#e2c27e"><rect x="1" y="11" width="24" height="17" rx="3"/><path d="M6 11V8a7 7 0 0 1 14 0v3" fill="none" stroke="#e2c27e" stroke-width="3"/></g>' +
        '<text x="' + (w / 2) + '" y="92" text-anchor="middle" fill="#ece7dd" font-size="12" font-weight="700">' + esc(plan.name || "Locked") + '</text><text x="' + (w / 2) + '" y="108" text-anchor="middle" fill="#ece7dd" font-size="10" opacity=".85">bypassed · ' + esc(plan.price || "") + "</text>" : "") + "</svg>";
  }


  // a plugin pedal: its format on the corner, a little screen (loading / ready / a problem), the plugin's name and maker
  function plugSvg(item, pedal, idx, sel) {
    var pl = pedal.plugin, w = 150, h = 190, on = item.on !== false, info = slotInfo(item.uid), err = slotError(item.uid), host = plugHost();
    var state = !host ? "here: preview" : err ? "didn’t load" : info ? (info.instrument ? "instrument" : "ready") : "loading…";
    var vendor = String(pl.vendor || ""), nm = pedal.name;
    return '<svg class="pedal plug' + (sel ? " selected" : "") + (on ? "" : " off") + (err ? " err" : "") + '" viewBox="0 0 ' + w + " " + h + '" data-uid="' + item.uid + '" role="button" tabindex="0" aria-label="' + esc(nm + " (" + fmtName(pl.format) + " plugin)") + '">' +
      '<defs><linearGradient id="g' + item.uid + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8d80e6"/><stop offset="1" stop-color="#4b3f9e"/></linearGradient></defs>' +
      '<rect x="3" y="3" width="' + (w - 6) + '" height="' + (h - 6) + '" rx="12" fill="url(#g' + item.uid + ')" stroke="' + (sel ? "#fff" : "rgba(0,0,0,.5)") + '" stroke-width="' + (sel ? 3 : 1.5) + '"/>' +
      (on ? '<circle cx="' + (w - 18) + '" cy="18" r="9" fill="#ff4040" opacity=".3"/>' : "") + '<circle cx="' + (w - 18) + '" cy="18" r="5" fill="' + (on ? "#ff4040" : "#4a1a1a") + '" stroke="#200"/>' +
      '<text x="12" y="23" class="pk-n">' + (idx + 1) + '</text><rect x="28" y="11" width="' + (fmtName(pl.format).length * 6.4 + 10) + '" height="16" rx="4" fill="rgba(0,0,0,.28)"/><text x="33" y="23" class="pk-fmt">' + esc(fmtName(pl.format)) + "</text>" +
      '<rect x="16" y="36" width="' + (w - 32) + '" height="62" rx="7" fill="#101218" stroke="rgba(255,255,255,.18)"/>' +
      '<path d="M24 67 C 36 46, 46 46, 56 67 S 76 88, 86 67 S 106 46, 116 67 S 124 80, 126 76" fill="none" stroke="' + (err ? "#ef6b63" : on && info ? "#c9c1ff" : "#5b5675") + '" stroke-width="2.2" stroke-linecap="round"/>' +
      '<text x="' + (w / 2) + '" y="92" class="pk-state">' + esc(state) + "</text>" +
      '<text x="' + (w / 2) + '" y="' + (h - 62) + '" class="pk-vendor">' + esc(vendor.length > 24 ? vendor.slice(0, 23) + "…" : vendor) + "</text>" +
      '<rect x="12" y="' + (h - 52) + '" width="' + (w - 24) + '" height="22" rx="5" fill="rgba(255,255,255,.92)"/><text x="' + (w / 2) + '" y="' + (h - 37) + '" class="pk-name">' + esc(nm.length > 20 ? nm.slice(0, 19) + "…" : nm) + "</text>" +
      '<g class="pk-sw" data-sw="' + item.uid + '"><circle cx="' + (w / 2) + '" cy="' + (h - 17) + '" r="10" fill="#d8d8d8" stroke="#333" stroke-width="1.5"/><circle cx="' + (w / 2) + '" cy="' + (h - 17) + '" r="4.5" fill="#222"/></g></svg>';
  }
  function plugDetail(item, pedal) {
    var pl = pedal.plugin, info = slotInfo(item.uid), err = slotError(item.uid), host = plugHost(), ps = plugs.params[item.uid] || null, open = !!(plugs.open[item.uid] || (info && info.open));
    var mix = item.mix == null ? 1 : item.mix;
    return '<section class="in-detail plug-detail" style="--pc:' + PLUG_CAT.color + '"><div class="row spread"><div><h3>' + esc(pedal.name) + '</h3><p class="muted">' + esc([pl.vendor, fmtName(pl.format) + " plugin"].filter(Boolean).join(" · ")) + '</p></div><div class="se-row"><label class="toggle"><input type="checkbox" data-on="' + item.uid + '"' + (item.on !== false ? " checked" : "") + "> On</label>" +
      (host && info && info.editor ? '<button class="primary" data-plugwin="' + item.uid + '">' + (open ? "Close its window" : "Open its window") + "</button>" : "") + "</div></div>" +
      (err ? '<p class="plug-warn">This plugin didn’t load: ' + esc(err) + ". Is it still installed? Try Scan again under Add pedal → Your plugins.</p>" : "") +
      (!host ? '<p class="muted">Plugins play on the computer they’re installed on, in the Instrument tab of Central Control or Central Usage. It stays on this board.</p>' : !info && !err ? '<p class="muted">Loading ' + esc(pedal.name) + "… big instruments can take a few seconds.</p>" : "") +
      '<div class="in-mixlevel"><label>Mix <small>(dry ↔ plugin)</small><span class="control-line"><input type="range" min="0" max="100" step="1" data-pmix="' + item.uid + '" value="' + Math.round(mix * 100) + '"><output>' + Math.round(mix * 100) + '%</output></span></label><label>Level<span class="control-line"><input type="range" min="-30" max="12" step="0.5" data-plevel="' + item.uid + '" value="' + (item.levelDb || 0) + '"><output>' + (item.levelDb || 0) + " dB</output></span></label></div>" +
      (host && info ? '<div class="plug-params" data-ppfor="' + item.uid + '">' + plugParamsHtml(item.uid, ps) + "</div>" : "") +
      (host && info ? '<p class="muted small">Its settings, including everything you change in its own window, are saved with it on this computer.</p>' : "") + "</section>";
  }
  function plugParamsHtml(id, ps) {
    if (!ps) return '<p class="muted small">Reading its controls…</p>';
    if (!ps.length) return '<p class="muted small">It has no controls to show here' + (slotInfo(id) && slotInfo(id).editor ? ": use its window." : ".") + "</p>";
    return '<h4>Quick controls <small class="muted">the first ' + ps.length + " of its controls</small></h4><div class=\"in-controls\">" + ps.map(function (q) { return "<label>" + esc(q.name) + '<span class="control-line"><input type="range" min="0" max="1000" step="1" value="' + Math.round(q.value * 1000) + '" data-pp="' + id + "|" + q.id + '"><output>' + esc(tidyNum(q.text)) + "</output></span></label>"; }).join("") + "</div>";
  }
  function tidyNum(t) { return String(t || "").replace(/-?\d+\.\d{3,}/g, function (n) { var v = Number(n), a = Math.abs(v); return String(Number(v.toFixed(a >= 100 ? 0 : a >= 10 ? 1 : 2))); }); }   // ("80.000000 %" -> "80 %")
  function askParams(id, now) { var t = Date.now(); if (!now && plugs.paramsAt[id] && t - plugs.paramsAt[id] < 1500) return; plugs.paramsAt[id] = t; send({ type: "instrument", action: "pluginParams", uid: id, max: 24 }); }
  // "Your plugins" in Add pedal: the effects this computer has, by format, with the folders we look in and what didn't load
  function plugPanel(kindWanted) {
    var q = addQuery.toLowerCase(), fmts = {}, all = plugs.list.filter(function (p) { return p.kind === kindWanted; });
    all.forEach(function (p) { fmts[p.format] = (fmts[p.format] || 0) + 1; });
    var list = all.filter(function (p) { return (addCat === "all" || addCat === "fmt:" + p.format) && (!q || (p.name + " " + p.vendor).toLowerCase().indexOf(q) > -1); });
    var sc = plugs.scan, folders = cfg().pluginFolders || [];
    return '<div class="plug-top"><span class="plug-scan muted">' + (sc ? "Looking for plugins… " + (sc.total ? sc.done + " of " + sc.total + (sc.current ? " · " + esc(sc.current) : "") : "") : plugs.scanned ? all.length + " " + (kindWanted === "instrument" ? "instruments" : "effects") + " on this computer" : "") + '</span><button id="plugScan"' + (sc ? " disabled" : "") + ">Scan again</button></div>" +
      '<div class="st-nav">' + ['<button class="st-chip' + (addCat === "all" ? " on" : "") + '" data-cat="all">All</button>'].concat(Object.keys(fmts).sort().map(function (f) { return '<button class="st-chip' + (addCat === "fmt:" + f ? " on" : "") + '" data-cat="fmt:' + f + '">' + fmtName(f) + " <small>" + fmts[f] + "</small></button>"; })).join("") + "</div>" +
      '<div class="pb-list plug-list">' + (list.length ? list.map(function (p) { return '<button class="pb-item plug-item" data-addplug="' + esc(p.key) + '"><b>' + esc(p.name) + "</b><small>" + esc([p.vendor, fmtName(p.format)].filter(Boolean).join(" · ")) + "</small></button>"; }).join("") :
        '<p class="muted">' + (sc || !plugs.scanned ? "Looking…" : all.length ? "Nothing matches." : "No " + (kindWanted === "instrument" ? "instrument" : "effect") + " plugins found yet. Install them the usual way (they go into the standard plug-in folders), or add the folder they’re in below, then Scan again.") + "</p>") + "</div>" +
      '<details class="plug-folders"><summary>Where we look <small class="muted">' + (plugs.folders.length + folders.length) + " folders" + (plugs.failed.length ? " · " + plugs.failed.length + " didn’t load" : "") + "</small></summary>" +
      '<ul class="plain">' + plugs.folders.map(function (f) { return "<li>" + esc(f) + (folders.indexOf(f) >= 0 ? ' <button class="link" data-plugfolderdel="' + esc(f) + '">remove</button>' : "") + "</li>"; }).join("") + "</ul>" +
      '<div class="row"><input id="plugFolder" placeholder="Another folder, e.g. D:\\Plugins\\VST3"><button id="plugFolderAdd">Add folder</button></div>' +
      (plugs.failed.length ? '<p class="muted small">These didn’t load, so they’re left out (each one is opened on its own, so it can’t stop the others):</p><ul class="plain small">' + plugs.failed.map(function (f) { return "<li><b>" + esc(f.name) + "</b> (" + fmtName(f.format) + "): " + esc(f.error) + "</li>"; }).join("") + "</ul>" : "") +
      (plugs.formats ? '<p class="muted small">This computer plays ' + plugs.formats.split(",").map(fmtName).join(", ") + " plugins.</p>" : "") + "</details>";
  }

  // ------------------------------------------------------------- the Studio EQ's curve (the same filters the engine runs)
  function bqResp(type, f0, gainDb, q, f, fs) {
    var A = Math.pow(10, gainDb / 40), w0 = 2 * Math.PI * f0 / fs, cw = Math.cos(w0), sw = Math.sin(w0), al = sw / (2 * q), s2 = 2 * Math.sqrt(A) * al, b0, b1, b2, a0, a1, a2;
    if (type === "hp") { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
    else if (type === "lp") { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
    else if (type === "ls") { b0 = A * ((A + 1) - (A - 1) * cw + s2); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s2); a0 = (A + 1) + (A - 1) * cw + s2; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s2; }
    else if (type === "hs") { b0 = A * ((A + 1) + (A - 1) * cw + s2); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s2); a0 = (A + 1) - (A - 1) * cw + s2; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s2; }
    else { b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; }
    var w = 2 * Math.PI * f / fs, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2b = Math.sin(2 * w);
    var nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2b), dr = a0 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2b);
    return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
  }
  function eqDb(v, f) {
    var fs = 48000, g = function (k, d) { var x = Number(v[k]); return isFinite(x) ? x : d; }, db = 0;
    if (g("hp_freq", 20) > 20.5) db += bqResp("hp", g("hp_freq", 20), 0, 0.707, f, fs);
    db += bqResp("ls", g("ls_freq", 100), g("ls_gain", 0), 0.707, f, fs);
    ["p1", "p2", "p3"].forEach(function (b, i) { db += bqResp("pk", g(b + "_freq", [250, 1000, 4000][i]), g(b + "_gain", 0), g(b + "_q", 1), f, fs); });
    db += bqResp("hs", g("hs_freq", 8000), g("hs_gain", 0), 0.707, f, fs);
    if (g("lp_freq", 20000) < 19999) db += bqResp("lp", g("lp_freq", 20000), 0, 0.707, f, fs);
    return db + g("out_gain", 0);
  }
  var eqRaf = 0;
  function drawEqCurves() {
    cancelAnimationFrame(eqRaf); eqRaf = requestAnimationFrame(function () {
      document.querySelectorAll("canvas[data-eqc]").forEach(function (cv) {
        var item = chainFor(kind()).filter(function (q) { return q.uid === cv.dataset.eqc; })[0]; if (!item) return;
        var dpr = window.devicePixelRatio || 1, W = cv.clientWidth || 600, H = cv.clientHeight || 180; cv.width = W * dpr; cv.height = H * dpr;
        var x = cv.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H);
        var css = getComputedStyle(document.documentElement), acc = css.getPropertyValue("--accent").trim() || "#e2c27e", F = '"Archivo", system-ui, sans-serif';
        var fx = function (f) { return Math.log(f / 20) / Math.log(1000) * W; }, dy = function (db) { return H / 2 - db / 24 * (H / 2 - 10); };
        x.font = "500 10px " + F;
        [50, 100, 200, 500, 1000, 2000, 5000, 10000].forEach(function (f) { var px = Math.round(fx(f)) + 0.5; x.fillStyle = "rgba(236,231,221,.07)"; x.fillRect(px, 0, 1, H); x.fillStyle = "rgba(236,231,221,.35)"; x.fillText(f >= 1000 ? f / 1000 + "k" : String(f), px + 3, H - 4); });
        [-18, -12, -6, 0, 6, 12, 18].forEach(function (db) { var py = Math.round(dy(db)) + 0.5; x.fillStyle = db === 0 ? "rgba(236,231,221,.22)" : "rgba(236,231,221,.06)"; x.fillRect(0, py, W, 1); if (db) { x.fillStyle = "rgba(236,231,221,.3)"; x.fillText((db > 0 ? "+" : "") + db, 3, py - 2); } });
        var pts = []; for (var i = 0; i <= 200; i++) { var f = 20 * Math.pow(1000, i / 200); pts.push([fx(f), dy(Math.max(-24, Math.min(24, eqDb(item.values || {}, f))))]); }
        x.beginPath(); x.moveTo(0, dy(0)); pts.forEach(function (p) { x.lineTo(p[0], p[1]); }); x.lineTo(W, dy(0)); x.closePath();
        var g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, acc + "55"); g.addColorStop(0.5, acc + "10"); g.addColorStop(1, acc + "55"); x.fillStyle = g; x.fill();
        x.beginPath(); pts.forEach(function (p, i) { i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]); }); x.strokeStyle = acc; x.lineWidth = 2; x.shadowColor = acc; x.shadowBlur = 6; x.stroke(); x.shadowBlur = 0;
        // a dot on each band
        var v = item.values || {}, num = function (k, d) { var n = Number(v[k]); return isFinite(n) ? n : d; };
        [["ls", num("ls_freq", 100)], ["p1", num("p1_freq", 250)], ["p2", num("p2_freq", 1000)], ["p3", num("p3_freq", 4000)], ["hs", num("hs_freq", 8000)]].forEach(function (b) { var px = fx(b[1]), py = dy(Math.max(-24, Math.min(24, eqDb(v, b[1])))); x.beginPath(); x.arc(px, py, 4.5, 0, 7); x.fillStyle = "#111317"; x.fill(); x.lineWidth = 2; x.strokeStyle = acc; x.stroke(); });
      });
    });
  }
  document.addEventListener("input", function (e) { if (e.target && e.target.closest && e.target.closest("#instrumentRoot")) drawEqCurves(); });
  // ------------------------------------------------------------- rendering
  function render() {
    var root = $("#instrumentRoot"); if (!root) return; lockCss();
    var c = cfg(), k = kind(), chain = chainFor(k);
    if (selected && !chain.some(function (i) { return i.uid === selected; })) selected = null;
    var boards = allBoards().filter(function (b) { return b.kind === k; });
    root.innerHTML =
      '<div class="in-head"><div class="in-kinds">' + KINDS.map(function (q) { return '<button class="pf-btn in-kind' + (k === q[0] ? " on" : "") + '" data-kind="' + q[0] + '"><small>' + esc(q[2]) + "</small><b>" + esc(q[1]) + "</b></button>"; }).join("") + '</div><div class="in-status">' + statusLine() + "</div></div>" +
      (k === "off" ? '<p class="muted in-off">Pick an instrument. A guitar goes into any USB audio interface plugged into the Pi (¼″ jack); a keyboard into a USB MIDI port. Its sound leaves on output 4 by default (Settings → Output routing) - the pads and tracks are never in its way.</p>' :
        '<div class="in-bar"><label>Board<select id="inBoard">' + boards.map(function (b) { var lk = boardLocked(b); return '<option value="' + b.id + '"' + (c.boards[k] === b.id ? " selected" : "") + (lk && c.boards[k] !== b.id ? " disabled" : "") + ">" + esc(b.name) + (lk ? " · locked: " + esc(boardMissing(b).map(planName).join(" + ")) : "") + "</option>"; }).join("") + '<option value="__custom">Save this board as…</option></select></label>' +
        (k !== "keys" ?
          '<label>Input<select id="inInput"><option value="auto">Auto (USB interface)</option>' + catalog.inputs.map(function (i) { return '<option value="' + esc(i.id) + '"' + (c.input.device === i.id ? " selected" : "") + ">" + esc(i.name) + "</option>"; }).join("") + '</select></label><label>Input channel<select id="inChannel">' + inputChannelOptions(c.input).map(function (o) { return '<option value="' + o[0] + '"' + (c.input.channel === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></label>" +
          '<label>Input gain <span class="control-line"><input type="range" id="inGain" min="-20" max="40" step="1" value="' + c.input.gain + '"><output>' + c.input.gain + ' dB</output></span></label><label>Noise gate <span class="control-line"><input type="range" id="inGate" min="-90" max="-20" step="1" value="' + c.input.gate + '"><output>' + c.input.gate + " dB</output></span></label>" :
          '<label>MIDI keyboard<select id="inMidi"><option value="auto">Auto (any USB MIDI)</option>' + catalog.midi.map(function (m) { return '<option value="' + esc(m) + '"' + (c.keys.midi === m ? " selected" : "") + ">" + esc(m) + "</option>"; }).join("") + '</select></label><label>Transpose <span class="control-line"><input type="range" id="inTranspose" min="-12" max="12" step="1" value="' + (c.keys.transpose || 0) + '"><output>' + (c.keys.transpose || 0) + '</output></span></label><label>Velocity<select id="inVel">' + [["soft", "Soft touch"], ["normal", "Normal"], ["hard", "Hard"], ["fixed", "Fixed (organ)"]].map(function (o) { return '<option value="' + o[0] + '"' + (c.keys.velocity === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></label>") +
        '<label>Output level <span class="control-line"><input type="range" id="inOut" min="-40" max="12" step="1" value="' + c.output.level + '"><output>' + c.output.level + ' dB</output></span></label>' +
        '<div class="in-meter"><small>IN</small><div class="vu-bar"><i id="inVu" style="width:100%"></i></div><b id="inTuner">–</b></div><button class="pf-btn" id="inAuto" title="Sets input gain and gate from what you play and detects the instrument"><small>SET UP</small><b>AUTO</b></button><button class="pf-btn' + (tunerOn ? " on" : "") + '" id="inTunerBtn" title="Full-screen tuner for the instrument input"><small>' + (cfg().tunerMute === false ? "LIVE" : "MUTE &amp;") + '</small><b>TUNE</b></button></div>' +
        (k === "keys" ? keysPanel(c) : "") + (GUITARS[k] ? playAnyPanel(c) : "") +
        '<div class="in-boardwrap"><div class="pb-chain" id="pbChain">' + chain.map(function (item, i) { var pedal = pedalOf(item); return pedal ? '<div class="pb-slot" data-slot="' + item.uid + '">' + pedalSvg(item, pedal, i, selected === item.uid) + '<div class="pb-tools"><button data-move="' + item.uid + ':-1" title="Move left">◀</button><button data-del="' + item.uid + '" title="Remove">✕</button><button data-move="' + item.uid + ':1" title="Move right">▶</button></div></div>' : ""; }).join("") + '<button class="pb-add" id="pbAdd">＋<small>Add pedal</small></button></div></div>' +
        (selected ? detailPanel(chain.filter(function (i) { return i.uid === selected; })[0]) : '<p class="muted">Tap a pedal to edit its knobs; tap its footswitch to bypass it. Footswitches on the board can do the same (Configure tab → "Pedal 1…8 on / off").</p>') +
        (showAdd ? addPanel() : "") + (window.PPLooper ? window.PPLooper.html() : "") +
        '<div class="in-foot muted">' + (connected() ? (status.pluginCount ? status.pluginCount + " plugins installed on this Pi · " : "") + (status.latencyMs != null ? "about " + Math.round(status.latencyMs) + " ms in to out · " : "") + (status.error ? '<b class="warn">' + esc(errText(status.error)) + '</b> <details class="in-err"><summary>Details</summary><code>' + esc(status.error) + "</code></details>" : (status.running ? "the instrument is running" : "the instrument is resting")) : "On the Central Pedal the board runs on the pedal itself. Here on a computer you can set it up and hear a preview.") +
        (status.engineAlt === "rig" ? ' · <button class="link" id="engineSwitch" data-engine="rig">Use your own plugins (VST3, CLAP, LV2): switch to the computer engine</button>' : status.engineAlt === "pedal" ? ' · <button class="link" id="engineSwitch" data-engine="pedal">Switch to the Central Pedal engine (its own LV2 pedals; your plugins rest)</button>' : "") + "</div>");
    if (k !== "off" && k !== "keys") startMeter(); else stopMeter();
    drawEqCurves();
    var selIt = selected && chain.filter(function (i) { return i.uid === selected; })[0]; if (selIt && isPlug(selIt) && slotInfo(selIt.uid) && !plugs.params[selIt.uid]) askParams(selIt.uid, true);
  }
  function statusLine() {
    var k = kind(); if (k === "off") return '<span class="dot off"></span> Instrument off';
    var s = status, r = project().routing || {}, outCh = r.buses && r.buses.instrument ? r.buses.instrument.ch : 4;
    var txt = !connected() ? "Preview (not on the Pi)" : s.available === false ? "Not available on this system" : s.error ? errText(s.error) : !s.running ? "Starting…" : (k === "keys" ? (s.midiInputs && s.midiInputs.length ? "Keyboard: " + s.midiInputs.join(", ") : "No MIDI keyboard found - plug one into the Pi") + " · " + (s.keysEngine || "") : (s.input ? "In: " + s.input : "No USB audio interface found - plug one in")) + " · out channel " + outCh;
    return '<span class="dot' + (connected() && s.running && !s.error ? "" : " off") + '"></span> ' + esc(txt);
  }
  function detailPanel(item) {
    var pedal = pedalOf(item); if (!pedal) return ""; if (pedal.plugin) return plugDetail(item, pedal); var ctls = controlsOf(pedal), cat = PED.CATEGORIES[pedal.category] || {};
    return '<section class="in-detail" style="--pc:' + (cat.color || "#777") + '">' + (itemLocked(item) ? '<p class="lock-note">' + LOCK + esc(lockText(pedal.tier)) + ". It stays on this board, bypassed, and plays again as soon as the plan is active.</p>" : "") + '<div class="row spread"><div><h3>' + esc(pedal.name) + '</h3><p class="muted">' + esc(cat.name || "") + (ctls[0] && ctls[0].guess ? " · exact ranges appear on the Pi" : "") + '</p></div><div class="se-row"><label class="toggle"><input type="checkbox" data-on="' + item.uid + '"' + (item.on !== false ? " checked" : "") + "> On</label>" +
      (pedal.opts.expression ? '<label class="toggle"><input type="checkbox" data-expr="' + item.uid + '"' + (cfg().expression === item.uid ? " checked" : "") + "> Expression pedal moves " + esc((expressionCtl(pedal) || {}).label || "it") + "</label>" : "") +
      (pedal.opts.tempo || pedal.opts.tempoBpm ? '<button data-sync="' + item.uid + '">♩ Sync to song tempo</button>' : "") + '<button data-reset="' + item.uid + '">Reset</button></div></div>' +
      '<div class="in-mixlevel"><label>Mix <small>(dry ↔ pedal)</small><span class="control-line"><input type="range" min="0" max="100" step="1" data-pmix="' + item.uid + '" value="' + Math.round((item.mix == null ? 1 : item.mix) * 100) + '"><output>' + Math.round((item.mix == null ? 1 : item.mix) * 100) + '%</output></span></label><label>Level<span class="control-line"><input type="range" min="-30" max="12" step="0.5" data-plevel="' + item.uid + '" value="' + (item.levelDb || 0) + '"><output>' + (item.levelDb || 0) + ' dB</output></span></label></div>' +
      (pedal.opts.irFile ? '<div class="in-ir"><label>Impulse response<select data-irfile="' + item.uid + '"><option value="">— choose an IR —</option>' + (status.irs || []).map(function (f) { var lk = !!(f.tier && tierLocked(f.tier)); return '<option value="' + esc(f.file) + '"' + (item.file === f.file ? " selected" : lk ? " disabled" : "") + ">" + (lk ? "🔒 " : "") + esc(f.name) + (lk ? " · " + esc(lockText(f.tier)) : "") + "</option>"; }).join("") + '</select></label><button data-iradd="' + item.uid + '">+ Add IR from USB…</button><span class="muted small">A .wav cabinet or acoustic-body impulse (mono, 48 kHz best).</span></div>' : "") +
      (pedal.opts.graph === "eq" ? '<canvas class="eq-curve" data-eqc="' + item.uid + '" aria-label="EQ curve"></canvas>' : "") +
      (pedal.category === "studio" && pedal.opts.graph !== "eq" && status.engine === "cu-rig" ? '<div class="gr-meter" data-gr="' + item.uid + '"><span>Gain reduction</span><b><i></i></b><output>0.0 dB</output></div>' : "") +
      '<div class="in-controls">' + ctls.map(function (ctl) { var v = valueOf(item, ctl), key = item.uid + "|" + esc(ctl.sym); if (ctl.toggled) return '<label class="toggle"><input type="checkbox" data-ctl="' + key + '"' + (v >= 0.5 ? " checked" : "") + "> " + esc(ctl.label) + "</label>"; if (ctl.enum && ctl.scale.length) return "<label>" + esc(ctl.label) + '<select data-ctl="' + key + '">' + ctl.scale.map(function (s) { return '<option value="' + s[0] + '"' + (Math.abs(s[0] - v) < 1e-6 ? " selected" : "") + ">" + esc(s[1]) + "</option>"; }).join("") + "</select></label>"; return "<label>" + esc(ctl.label) + '<span class="control-line"><input type="range" min="0" max="1000" step="1" value="' + Math.round(norm(ctl, v) * 1000) + '" data-ctl="' + key + '"><output>' + esc(fmt(ctl, v)) + "</output></span></label>"; }).join("") + "</div></section>";
  }
  function addPanel() {
    var host = plugHost(), nPlug = plugs.list.filter(function (p) { return p.kind === "effect"; }).length;
    var tabs = host ? '<div class="add-tabs"><button class="st-chip' + (addTab !== "plugins" ? " on" : "") + '" data-addtab="pedals">Built-in pedals <small>' + PED.pedals.length + '</small></button><button class="st-chip' + (addTab === "plugins" ? " on" : "") + '" data-addtab="plugins">Your plugins <small>' + (plugs.scanned ? nPlug : "…") + "</small></button></div>" : "";
    if (host && addTab === "plugins") return '<section class="in-add"><div class="row spread"><h3>Add a pedal</h3>' + tabs + '<input id="pbSearch" placeholder="Search your plugins…" value="' + esc(addQuery) + '"><button id="pbAddClose">Close</button></div>' + plugPanel("effect") + "</section>";
    var cats = Object.keys(PED.CATEGORIES), q = addQuery.toLowerCase();
    var list = PED.pedals.filter(function (p) { return (addCat === "all" || p.category === addCat) && (!q || (p.name + " " + (PED.CATEGORIES[p.category] || {}).name).toLowerCase().indexOf(q) > -1); });
    return '<section class="in-add"><div class="row spread"><h3>Add a pedal' + (host ? "" : ' <small class="muted">' + PED.pedals.length + " to choose from</small>") + "</h3>" + tabs + "<input id=\"pbSearch\" placeholder=\"Search pedals…\" value=\"" + esc(addQuery) + '"><button id="pbAddClose">Close</button></div><div class="st-nav">' + ['<button class="st-chip' + (addCat === "all" ? " on" : "") + '" data-cat="all">All</button>'].concat(cats.map(function (cid) { return '<button class="st-chip' + (addCat === cid ? " on" : "") + '" data-cat="' + cid + '">' + esc(PED.CATEGORIES[cid].name) + "</button>"; })).join("") + '</div><div class="pb-list">' + list.map(function (p) { var ok = !catalog.ready || catalog.plugins[p.uri] || p.opts.ladspa || p.opts.builtin; var lk = PED.pedalLocked && PED.pedalLocked(p); return '<button class="pb-item' + (ok ? "" : " missing") + (lk ? " locked" : "") + '" data-add="' + p.id + '" style="--pc:' + (PED.CATEGORIES[p.category] || {}).color + '"><i></i><b>' + (lk ? LOCK : "") + esc(p.name) + "</b><small>" + (lk ? esc(lockText(p.tier)) : esc((PED.CATEGORIES[p.category] || {}).name) + (ok ? "" : " · not installed")) + "</small></button>"; }).join("") + "</div></section>";
  }
  function keysPanel(c) {
    var cats = {}; catalog.keys.forEach(function (p) { cats[p.category] = (cats[p.category] || 0) + 1; });
    var q = keysQuery.toLowerCase(), list = catalog.keys.filter(function (p) { return (keysCat === "all" || p.category === keysCat) && (!q || (p.name + " " + p.bank).toLowerCase().indexOf(q) > -1); }).slice(0, 400), cur = (layers(c)[layerSel] || {}).patch;
    var host = plugHost(), instr = host ? plugs.list.filter(function (p) { return p.kind === "instrument"; }) : [], plist = keysCat === "__plug" ? instr.filter(function (p) { return !q || (p.name + " " + p.vendor).toLowerCase().indexOf(q) > -1; }) : null;
    var kbd = "", whites = 0; for (var n = 48; n <= 84; n++) if ([1, 3, 6, 8, 10].indexOf(n % 12) < 0) { kbd += '<button class="kk white" data-note="' + n + '" style="left:' + (whites * 30) + 'px">' + (n % 12 === 0 ? "C" + (n / 12 - 1) : "") + "</button>"; whites++; }
    whites = 0; for (n = 48; n <= 84; n++) { if ([1, 3, 6, 8, 10].indexOf(n % 12) < 0) whites++; else kbd += '<button class="kk black" data-note="' + n + '" style="left:' + (whites * 30 - 9) + 'px"></button>'; }
    return '<section class="in-keys"><div class="row spread"><div><h3>Sounds</h3><p class="muted">' + (catalog.keys.length ? catalog.keys.length + " sounds: grand and upright pianos, electric pianos, organs, pads, strings, leads, bells… Add your own: .sf2 SoundFonts or a folder of WAVs named by note (C4.wav, F#3.wav…) from a USB stick, or send an .sf2 from a phone or computer (Settings → Companion devices → Upload)." : connected() ? "No sound banks found yet." : "The sound list comes from the Pi.") + '</p></div><div class="row"><input id="keysSearch" placeholder="Search sounds…" value="' + esc(keysQuery) + '"><button id="keysAdd" title="Add a .sf2 SoundFont or a folder of WAV samples from a USB stick or SD card">+ Add sounds…</button></div></div>' +
      '<div class="st-nav">' + (host ? '<button class="st-chip plug-chip' + (keysCat === "__plug" ? " on" : "") + '" data-kcat="__plug">Your instruments <small>' + (plugs.scanned ? instr.length : "…") + "</small></button>" : "") + ['<button class="st-chip' + (keysCat === "all" ? " on" : "") + '" data-kcat="all">All</button>'].concat(Object.keys(cats).sort().map(function (cid) { return '<button class="st-chip' + (keysCat === cid ? " on" : "") + '" data-kcat="' + esc(cid) + '">' + esc(cid) + " <small>" + cats[cid] + "</small></button>"; })).join("") + "</div>" +
      (plist ? '<div class="keys-list">' + (plist.length ? plist.map(function (p) { return '<button class="keys-item plug-item' + (cur && cur.id === "plug:" + p.key ? " on" : "") + '" data-kplug="' + esc(p.key) + '"><b>' + esc(p.name) + "</b><small>" + esc([p.vendor, fmtName(p.format)].filter(Boolean).join(" · ")) + "</small></button>"; }).join("") : '<p class="muted">' + (plugs.scan || !plugs.scanned ? "Looking for your instrument plugins…" : instr.length ? "Nothing matches." : "No instrument plugins found on this computer yet (Kontakt, Keyscape, Pianoteq, Vital…). Install them the usual way, then Scan again in Add pedal → Your plugins.") + "</p>") + "</div>" :
      '<div class="keys-list">' + (list.length ? list.map(function (p) { var lk = tierLocked(p.tier); return '<button class="keys-item' + (cur && cur.id === p.id ? " on" : "") + (lk ? " locked" : "") + '" data-patch="' + esc(p.id) + '"><b>' + (lk ? LOCK : "") + esc(p.name) + "</b><small>" + esc(lk ? lockText(p.tier) : p.bankName) + "</small></button>"; }).join("") : '<p class="muted">Nothing matches.</p>') + "</div>") +
      layersPanel(c) +
      '<div class="keys-extra"><label>Synth volume <span class="control-line"><input type="range" id="keysVolume" min="0" max="100" value="' + Math.round((c.keys.volume != null ? c.keys.volume : 0.8) * 100) + '"><output>' + Math.round((c.keys.volume != null ? c.keys.volume : 0.8) * 100) + '</output></span></label><label class="toggle"><input type="checkbox" id="keysSustain"' + (c.keys.sustain !== false ? " checked" : "") + '> Sustain pedal</label><span class="muted">Reverb, delay, chorus, compression: add them as pedals below.</span></div>' +
      '<div class="keys-kbd" id="keysKbd">' + kbd + "</div></section>";
  }

  var layerSel = 0, ppTimer = 0;
  var NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  function noteName(n) { return NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 1); }
  function noteSelect(attr, idx, val) { var o = ""; for (var n = 0; n <= 127; n += 1) o += '<option value="' + n + '"' + (n === val ? " selected" : "") + ">" + noteName(n) + "</option>"; return '<select data-' + attr + '="' + idx + '">' + o + "</select>"; }
  function layersPanel(c) {
    var ls = layers(c); if (layerSel >= ls.length) layerSel = 0;
    return '<div class="kl-wrap"><div class="row spread"><h3>Layers <small class="muted">' + ls.length + " of " + MAX_LAYERS + ' · tap a layer, then a sound to put on it</small></h3><div class="se-row"><button id="klAdd"' + (ls.length >= MAX_LAYERS ? " disabled" : "") + '>+ Layer</button><button id="klSplit" title="Layer 1 below middle C, layer 2 above">Split at C4</button></div></div><div class="kl-list">' +
      ls.map(function (l, i) {
        return '<div class="kl-row' + (i === layerSel ? " sel" : "") + (l.on === false ? " off" : "") + '" data-kl="' + i + '"><button class="kl-on' + (l.on !== false ? " on" : "") + '" data-klon="' + i + '">' + (i + 1) + '</button><button class="kl-name" data-klsel="' + i + '"><b>' + (soundLocked(l.patch) ? LOCK : "") + esc(l.patch ? l.patch.name : "choose a sound") + '</b>' + (soundLocked(l.patch) ? '<span class="kl-lock">muted · ' + esc(lockText(soundOf(l.patch).tier)) + "</span>" : "") + '<small>' + noteName(l.lo == null ? 0 : l.lo) + "–" + noteName(l.hi == null ? 127 : l.hi) + (l.octave ? " · " + (l.octave > 0 ? "+" : "") + l.octave + " oct" : "") + "</small></button>" +
          '<label>Vol<span class="control-line"><input type="range" min="0" max="100" data-klvol="' + i + '" value="' + Math.round((l.volume == null ? 1 : l.volume) * 100) + '"><output>' + Math.round((l.volume == null ? 1 : l.volume) * 100) + '</output></span></label>' +
          '<label>Pan<input type="range" min="-100" max="100" data-klpan="' + i + '" value="' + Math.round((l.pan || 0) * 100) + '"></label>' +
          '<label>Oct<select data-kloct="' + i + '">' + [-2, -1, 0, 1, 2].map(function (o) { return '<option value="' + o + '"' + ((l.octave || 0) === o ? " selected" : "") + ">" + (o > 0 ? "+" : "") + o + "</option>"; }).join("") + "</select></label>" +
          "<label>From" + noteSelect("kllo", i, l.lo == null ? 0 : l.lo) + "</label><label>To" + noteSelect("klhi", i, l.hi == null ? 127 : l.hi) + "</label>" +
          '<label>Vel<span class="kl-vel"><input type="number" min="1" max="127" data-klvlo="' + i + '" value="' + (l.velLo || 1) + '">–<input type="number" min="1" max="127" data-klvhi="' + i + '" value="' + (l.velHi || 127) + '"></span></label>' +
          (l.patch && l.patch.plugin && plugHost() ? (slotError(l.id) ? '<span class="plug-warn small" title="' + esc(slotError(l.id)) + '">didn’t load</span>' : slotInfo(l.id) ? (slotInfo(l.id).editor ? '<button data-klwin="' + l.id + '">' + ((plugs.open[l.id] || slotInfo(l.id).open) ? "Close window" : "Its window") + "</button>" : "") : '<span class="muted small">loading…</span>') : "") +
          (ls.length > 1 ? '<button class="danger" data-kldel="' + i + '" title="Remove this layer">✕</button>' : "") + "</div>";
      }).join("") + "</div></div>";
  }
  function keysLive() { keysSoon(); }

  // ---- scenes: what an instrument scene stores and recalls
  function captureRig(full) {
    var c = cfg(), k = kind(), r = { kind: k, levelDb: c.output.level || 0, pedals: chainFor(k).map(function (it) { return { uid: it.uid, on: it.on !== false, mix: it.mix == null ? 1 : it.mix, levelDb: it.levelDb || 0 }; }) };
    if (k === "keys") r.layers = layers(c).map(function (l) { return { id: l.id, on: l.on !== false, volume: l.volume == null ? 1 : l.volume }; });
    if (GUITARS[k] && c.playAny) r.playAny = JSON.parse(JSON.stringify(c.playAny));
    if (full) { r.board = c.boards[k] || null; r.chain = JSON.parse(JSON.stringify(chainFor(k))); if (k === "keys") r.keys = JSON.parse(JSON.stringify(c.keys)); r.input = JSON.parse(JSON.stringify(c.input)); }
    return r;
  }
  // smooth when the same pedals are on the board (only on / off / mix / levels change); a different board restarts the chain
  function applyRig(r) {
    if (!r) return;
    var c = cfg(), k = r.kind || kind();
    if (k !== kind()) { c.kind = k; if (r.chain) c.chains[k] = JSON.parse(JSON.stringify(r.chain)); if (r.board) c.boards[k] = r.board; if (r.keys) c.keys = JSON.parse(JSON.stringify(r.keys)); if (r.input) c.input = Object.assign(c.input, r.input); selected = null; apply("scene"); if (onTab()) render(); return; }
    if (k === "off") return;
    var same = !r.chain || (JSON.stringify(chainFor(k).map(function (i) { return i.uid + i.pedal; })) === JSON.stringify(r.chain.map(function (i) { return i.uid + i.pedal; })));
    if (!same) { c.chains[k] = JSON.parse(JSON.stringify(r.chain)); if (r.board) c.boards[k] = r.board; if (r.keys) c.keys = JSON.parse(JSON.stringify(r.keys)); selected = null; apply("scene"); if (onTab()) render(); return; }
    if (r.playAny && GUITARS[k] && JSON.stringify(r.playAny) !== JSON.stringify(c.playAny || null)) { c.playAny = JSON.parse(JSON.stringify(r.playAny)); paSend(true); }
    var byUid = {}; (r.pedals || []).forEach(function (p) { byUid[p.uid] = p; });
    chainFor(k).forEach(function (it) { var p = byUid[it.uid]; if (!p) return; it.on = p.on; it.mix = p.mix; it.levelDb = p.levelDb; });
    var msg = { type: "instrument", action: "scene", pedals: r.pedals || [] };
    if (r.levelDb != null) { c.output.level = r.levelDb; msg.levelDb = r.levelDb; }
    if (k === "keys" && (r.layers || r.keys)) {
      if (r.keys && JSON.stringify(r.keys.layers || []) !== JSON.stringify(c.keys.layers || [])) c.keys = JSON.parse(JSON.stringify(r.keys));
      var byId = {}; (r.layers || []).forEach(function (l) { byId[l.id] = l; });
      layers(c).forEach(function (l) { var q = byId[l.id]; if (q) { l.on = q.on; l.volume = q.volume; } });
      msg.keys = hostKeys(c);
    }
    send(msg); PP.persistSoon(); if (onTab()) render(); if (window.PPActions) window.PPActions.sendLeds();
  }

  // ------------------------------------------------------------- input meter + tuner (the app listens to the interface in parallel, for the display only)
  var meterStream = null, meterCtx = null, analyser = null, meterRaf = 0, meterData = null, lastTune = 0, lastLevel = -90, lastPeak = 0;
  async function startMeter() {
    if (meterStream || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    try {
      var c = cfg(), constraints = { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } };
      if (c.input.deviceId) constraints.audio.deviceId = { exact: c.input.deviceId };
      meterStream = await navigator.mediaDevices.getUserMedia(constraints);
      meterCtx = meterCtx || new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" });
      var src = meterCtx.createMediaStreamSource(meterStream); analyser = meterCtx.createAnalyser(); analyser.fftSize = 4096; analyser.smoothingTimeConstant = 0.6; src.connect(analyser); meterData = new Float32Array(analyser.fftSize);
      if (meterCtx.state !== "running") meterCtx.resume();
      meterLoop();
    } catch (_) { meterStream = null; }
  }
  function stopMeter() { cancelAnimationFrame(meterRaf); if (meterStream) { meterStream.getTracks().forEach(function (t) { t.stop(); }); meterStream = null; analyser = null; } }
  function meterLoop() {
    meterRaf = requestAnimationFrame(meterLoop);
    var vu = $("#inVu"), tn = $("#inTuner"), big = tunerOn ? tunerBox() : null; if (!analyser || (!vu && !big)) return;
    analyser.getFloatTimeDomainData(meterData); var s = 0, pk = 0; for (var i = 0; i < meterData.length; i++) { var a = Math.abs(meterData[i]); s += a * a; if (a > pk) pk = a; }
    var db = 20 * Math.log10(Math.sqrt(s / meterData.length) + 1e-7); if (vu) vu.style.width = (100 - clamp((db + 60) / 60 * 100, 0, 100)) + "%"; lastLevel = db; lastPeak = pk;
    if (big && performance.now() - lastTune > 90) { var f2 = detectPitch(meterData, meterCtx.sampleRate); tunerShow(f2); }
    if (tunerOn && tn && performance.now() - lastTune > 120) { lastTune = performance.now(); var f = detectPitch(meterData, meterCtx.sampleRate); if (f) { var midi = 69 + 12 * Math.log2(f / 440), n = Math.round(midi), cents = Math.round((midi - n) * 100), names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"]; tn.innerHTML = names[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1) + ' <span class="' + (Math.abs(cents) < 5 ? "ok" : cents < 0 ? "flat" : "sharp") + '">' + (cents > 0 ? "+" : "") + cents + "¢</span>"; } else tn.textContent = "–"; }
  }
  function detectPitch(buf, rate) { // normalised autocorrelation
    var n = Math.min(buf.length, 2048), e = 0; for (var i = 0; i < n; i++) e += buf[i] * buf[i]; if (Math.sqrt(e / n) < 0.004) return null;
    var maxLag = Math.floor(rate / 28), minLag = Math.floor(rate / 1200), best = -1, bestV = 0;
    for (var lag = minLag; lag <= maxLag; lag++) { var sum = 0; for (i = 0; i < n - lag; i++) sum += buf[i] * buf[i + lag]; var v = sum / e; if (v > bestV) { bestV = v; best = lag; } }
    if (bestV < 0.5 || best <= minLag) return null;
    var y0 = 0, y2 = 0; for (i = 0; i < n - best - 1; i++) { y0 += buf[i] * buf[i + best - 1]; y2 += buf[i] * buf[i + best + 1]; } var y1 = bestV * e, den = y0 - 2 * y1 + y2, shift = den ? 0.5 * (y0 - y2) / den : 0;
    return rate / (best + shift);
  }
  // AUTO: a second of silence for the gate, three seconds of playing for the gain, then guess acoustic / electric from the spectrum
  async function autoSetup() {
    var c = cfg();
    if (kind() === "keys") { c.keys.velocity = "normal"; c.keys.sustain = true; if (!c.keys.patch && catalog.keys.length) c.keys.patch = catalog.keys.filter(function (p) { return /grand/i.test(p.name); })[0] || catalog.keys[0]; apply("auto"); render(); PP.setStatus("Keys: velocity Normal, sustain on" + (c.keys.patch ? ", sound: " + c.keys.patch.name : "") + "."); return; }
    await startMeter(); if (!analyser) { PP.setStatus("No audio input available here."); return; }
    var btn = $("#inAuto"); if (btn) btn.disabled = true;
    PP.setStatus("AUTO: stay quiet for a second…"); await new Promise(function (r) { setTimeout(r, 1000); }); var noise = lastLevel;
    PP.setStatus("AUTO: now play normally for three seconds…");
    var levels = [], peaks = []; for (var i = 0; i < 30; i++) { await new Promise(function (r) { setTimeout(r, 100); }); levels.push(lastLevel); peaks.push(lastPeak); }
    var loud = levels.slice().sort(function (a, b) { return b - a; }), p90 = loud[Math.floor(loud.length * 0.1)] || -30, peakDb = 20 * Math.log10(Math.max.apply(null, peaks) + 1e-7);
    c.input.gain = clamp(Math.round(c.input.gain + (-12 - peakDb)), -20, 40); c.input.gate = clamp(Math.round(Math.max(noise + 8, -85)), -90, -20);
    var freq = new Float32Array(analyser.frequencyBinCount); analyser.getFloatFrequencyData(freq); var binHz = meterCtx.sampleRate / analyser.fftSize, lo = 0, hi = 0;
    for (var k = 0; k < freq.length; k++) { var f = k * binHz, v = Math.pow(10, freq[k] / 20); if (f > 200 && f < 800) lo += v; else if (f > 4000 && f < 9000) hi += v; }
    var guess = kind() === "bass" ? "bass" : hi / (lo + 1e-9) > 0.12 ? "acoustic" : "electric";
    if (p90 < -55) PP.setStatus("AUTO: I heard almost nothing - check the cable and the interface's input knob."); else PP.setStatus("AUTO: gain " + (c.input.gain >= 0 ? "+" : "") + c.input.gain + " dB, gate " + c.input.gate + " dB, sounds like " + (guess === "acoustic" ? "an acoustic" : guess === "bass" ? "a bass" : "an electric") + " guitar" + (guess !== kind() ? " (switched)" : "") + ".");
    if (guess !== kind()) { c.kind = guess; selected = null; }
    apply("auto"); render();
  }

  // ------------------------------------------------------------- events
  function wire() {
    var root = $("#instrumentRoot"); if (!root) return;
    root.addEventListener("click", function (e) {
      var sw = e.target.closest(".pk-sw"), c = cfg(), k = kind(), chain = chainFor(k);
      if (sw) { var it = chain.filter(function (i) { return i.uid === sw.dataset.sw; })[0]; if (it && itemLocked(it)) { lockedSay(lockedLine(PED.byId(it.pedal).tier, "this pedal stays bypassed until the plan is active.")); return; } if (it) { it.on = it.on === false; send({ type: "instrument", action: "bypass", uid: it.uid, on: it.on }); PP.persistSoon(); render(); } return; }
      var svg = e.target.closest("svg.pedal"); if (svg) { selected = selected === svg.dataset.uid ? null : svg.dataset.uid; showAdd = false; render(); return; }
      var b = e.target.closest("button"); if (!b) return;
      if (b.dataset.kind) { c.kind = b.dataset.kind; selected = null; showAdd = false; apply("kind"); render(); return; }
      if (b.dataset.move) { var parts = b.dataset.move.split(":"), i = chain.findIndex(function (q) { return q.uid === parts[0]; }), j = i + Number(parts[1]); if (i >= 0 && j >= 0 && j < chain.length) { var tmp = chain[i]; chain[i] = chain[j]; chain[j] = tmp; apply("order"); render(); } return; }
      if (b.dataset.del) { c.chains[k] = chain.filter(function (q) { return q.uid !== b.dataset.del; }); if (selected === b.dataset.del) selected = null; apply("remove"); render(); return; }
      if (b.id === "pbAdd") { showAdd = true; selected = null; render(); var s = $("#pbSearch"); if (s) s.focus(); return; }
      if (b.id === "pbAddClose") { showAdd = false; render(); return; }
      if (b.dataset.cat) { addCat = b.dataset.cat; render(); return; }
      // the musician's own plugins
      if (b.dataset.addtab) { addTab = b.dataset.addtab; addCat = "all"; if (addTab === "plugins" && !plugs.scanned && !plugs.scan) scanPlugins(false); render(); var s2 = $("#pbSearch"); if (s2) s2.focus(); return; }
      if (b.dataset.addplug) { var pp = plugs.list.filter(function (q) { return q.key === b.dataset.addplug; })[0]; if (pp) { var pit = { uid: uid(), pedal: "plug", plugin: plugRef(pp), on: true, values: {} }; chain.push(pit); selected = pit.uid; showAdd = false; apply("add"); render(); PP.setStatus("Loading " + pp.name + "…"); } return; }
      if (b.dataset.plugwin || b.dataset.klwin) { var wid = b.dataset.plugwin || b.dataset.klwin, si = slotInfo(wid), isOpen = !!(plugs.open[wid] || (si && si.open)); send({ type: "instrument", action: "pluginEditor", uid: wid, open: !isOpen }); plugs.open[wid] = !isOpen; render(); return; }
      if (b.id === "plugScan") { scanPlugins(true); return; }
      if (b.id === "plugFolderAdd") { var fin = $("#plugFolder"), fv = fin && fin.value.trim(); if (fv) { var fl = c.pluginFolders = c.pluginFolders || []; if (fl.indexOf(fv) < 0) fl.push(fv); PP.persistSoon(); scanPlugins(false); } return; }
      if (b.dataset.plugfolderdel) { c.pluginFolders = (c.pluginFolders || []).filter(function (f) { return f !== b.dataset.plugfolderdel; }); PP.persistSoon(); scanPlugins(false); return; }
      if (b.dataset.kplug) { var kp = plugs.list.filter(function (q) { return q.key === b.dataset.kplug; })[0]; if (kp) { var lsK = layers(c), layK = lsK[layerSel] || lsK[0]; layK.patch = { id: "plug:" + kp.key, name: kp.name, plugin: plugRef(kp) }; send({ type: "instrument", action: "keys", keys: hostConfig().keys }); PP.persistSoon(); render(); PP.setStatus("Loading " + kp.name + "…"); } return; }
      if (b.id === "engineSwitch") { send({ type: "instrument", action: "engine", engine: b.dataset.engine }); PP.setStatus("Switching the instrument engine…"); return; }
      if (b.dataset.kcat) { keysCat = b.dataset.kcat; render(); return; }
      if (b.dataset.add && PED.pedalLocked && PED.pedalLocked(b.dataset.add)) { lockedSay(lockedLine(PED.byId(b.dataset.add).tier, PED.byId(b.dataset.add).name + " opens with that plan.")); return; }
      if (b.dataset.add) { var pedal = PED.byId(b.dataset.add); if (pedal) { var item = { uid: uid(), pedal: pedal.id, on: true, values: Object.assign({}, pedal.opts.values || {}) }, ampIdx = chain.findIndex(function (q) { var p = PED.byId(q.pedal); return p && (p.category === "amp" || p.category === "cab"); }); if (ampIdx >= 0 && ["amp", "cab", "reverb", "delay"].indexOf(pedal.category) < 0) chain.splice(ampIdx, 0, item); else chain.push(item); selected = item.uid; showAdd = false; apply("add"); render(); } return; }
      if (b.dataset.reset) { var it2 = chain.filter(function (q) { return q.uid === b.dataset.reset; })[0]; if (it2 && !isPlug(it2)) { var rp = PED.byId(it2.pedal); it2.values = Object.assign({}, rp && rp.opts.values || {}); apply("reset"); render(); } return; }
      if (b.dataset.sync) { var it3 = chain.filter(function (q) { return q.uid === b.dataset.sync; })[0], p3 = it3 && PED.byId(it3.pedal); if (p3) { var bpm = project().tempo.bpm; if (p3.opts.tempoBpm) it3.values[p3.opts.tempoBpm] = bpm; else if (p3.opts.tempo) { var ctl = controlsOf(p3).filter(function (q) { return q.sym === p3.opts.tempo; })[0], ms = 60000 / bpm * 0.75; it3.values[p3.opts.tempo] = ctl ? clamp(ctl.max > 50 ? ms : ms / 1000, ctl.min, ctl.max) : ms; } apply("sync"); render(); PP.setStatus("Delay set to a dotted eighth at " + Math.round(bpm) + " BPM"); } return; }
      if (b.dataset.patch) { var p = catalog.keys.filter(function (q) { return q.id === b.dataset.patch; })[0]; if (p && tierLocked(p.tier)) { lockedSay(lockedLine(p.tier, p.name + " opens with that plan.")); return; } if (p) { var ls0 = layers(c), lay = ls0[layerSel] || ls0[0]; lay.patch = { id: p.id, file: p.file, bank: p.bank, prog: p.prog, name: p.name }; send({ type: "instrument", action: "keys", keys: hostConfig().keys }); PP.persistSoon(); render(); } return; }
      if (b.id === "klAdd") { var ls1 = layers(c); if (ls1.length < MAX_LAYERS) { ls1.push({ id: uid(), patch: null, on: true, volume: 0.8, pan: 0, octave: 0, lo: 0, hi: 127, velLo: 1, velHi: 127 }); layerSel = ls1.length - 1; keysLive(); render(); PP.setStatus("Layer " + ls1.length + " added: tap a sound for it"); } return; }
      if (b.id === "klSplit") { var ls2 = layers(c); if (ls2.length < 2) ls2.push({ id: uid(), patch: null, on: true, volume: 0.9, pan: 0, octave: 0, lo: 0, hi: 127, velLo: 1, velHi: 127 }); ls2[0].lo = 0; ls2[0].hi = 59; ls2[1].lo = 60; ls2[1].hi = 127; layerSel = 1; keysLive(); render(); PP.setStatus("Split: layer 1 below C4, layer 2 from C4 up"); return; }
      if (b.dataset.klsel != null) { layerSel = Number(b.dataset.klsel); render(); return; }
      if (b.dataset.klon != null) { var l3 = layers(c)[Number(b.dataset.klon)]; if (l3) { l3.on = l3.on === false; keysLive(); render(); } return; }
      if (b.dataset.kldel != null) { var ls4 = layers(c); ls4.splice(Number(b.dataset.kldel), 1); layerSel = 0; keysLive(); render(); return; }
      if (b.dataset.iradd) { addIr(b.dataset.iradd); return; }
      if (b.id === "paOn") { togglePlayAny(); return; }
      if (b.dataset.pamode) { setPlayAny({ mode: b.dataset.pamode }); return; }
      if (b.id === "inAuto") { autoSetup(); return; }
      if (b.id === "inTunerBtn") { toggleTuner(); return; }
      if (b.id === "keysAdd") { addSounds(); return; }
    });
    root.addEventListener("input", function (e) {
      var el = e.target, c = cfg(), k = kind(), out = el.parentNode && el.parentNode.querySelector("output");
      if (el.dataset.pp) { var pq = el.dataset.pp.split("|"); send({ type: "instrument", action: "pluginSet", uid: pq[0], id: Number(pq[1]), value: Number(el.value) / 1000 }); clearTimeout(ppTimer); ppTimer = setTimeout(function () { askParams(pq[0], true); }, 120); return; }
      if (el.dataset.ctl) { var parts = el.dataset.ctl.split("|"), item = chainFor(k).filter(function (q) { return q.uid === parts[0]; })[0], pedal = item && PED.byId(item.pedal); if (!pedal) return; var ctl = controlsOf(pedal).filter(function (q) { return q.sym === parts[1]; })[0]; if (!ctl) return; var v = el.type === "checkbox" ? (el.checked ? 1 : 0) : el.tagName === "SELECT" ? Number(el.value) : denorm(ctl, Number(el.value) / 1000); item.values[ctl.sym] = v; if (out) out.textContent = fmt(ctl, v); send({ type: "instrument", action: "set", uid: item.uid, sym: ctl.sym, value: v }); PP.persistSoon(); var svg = root.querySelector('svg.pedal[data-uid="' + item.uid + '"]'); if (svg) svg.outerHTML = pedalSvg(item, pedal, chainFor(k).indexOf(item), true); return; }
      if (el.id === "inGain") { c.input.gain = Number(el.value); if (out) out.textContent = el.value + " dB"; inputSoon(); }
      else if (el.id === "inGate") { c.input.gate = Number(el.value); if (out) out.textContent = el.value + " dB"; inputSoon(); }
      else if (el.id === "inOut") { c.output.level = Number(el.value); if (out) out.textContent = el.value + " dB"; send({ type: "instrument", action: "level", levelDb: outLevel() }); PP.persistSoon(); }
      else if (el.id === "inTranspose") { c.keys.transpose = Number(el.value); if (out) out.textContent = el.value; keysSoon(); }
      else if (el.dataset.pmix || el.dataset.plevel) { var pu = el.dataset.pmix || el.dataset.plevel, pit = chainFor(k).filter(function (q) { return q.uid === pu; })[0]; if (!pit) return; if (el.dataset.pmix) { pit.mix = Number(el.value) / 100; if (out) out.textContent = el.value + "%"; } else { pit.levelDb = Number(el.value); if (out) out.textContent = el.value + " dB"; } send({ type: "instrument", action: "pedalmix", uid: pit.uid, mix: pit.mix == null ? 1 : pit.mix, levelDb: pit.levelDb || 0 }); PP.persistSoon(); }
      else if (el.dataset.klvol != null) { var lv = layers(c)[Number(el.dataset.klvol)]; if (lv) { lv.volume = Number(el.value) / 100; if (out) out.textContent = el.value; keysLive(); } }
      else if (el.dataset.klpan != null) { var lp = layers(c)[Number(el.dataset.klpan)]; if (lp) { lp.pan = Number(el.value) / 100; keysLive(); } }
      else if (el.id === "paDry" || el.id === "paSens" || el.id === "paVol") { var pv = Number(el.value) / 100, pk = el.id === "paDry" ? "dry" : el.id === "paSens" ? "sensitivity" : "volume"; paCfg(c)[pk] = pv; if (out) out.textContent = el.id === "paSens" ? el.value : el.value + "%"; paSend(false); }
      else if (el.id === "keysVolume") { c.keys.volume = Number(el.value) / 100; if (out) out.textContent = el.value; keysSoon(); }
      else if (el.id === "pbSearch") { addQuery = el.value; var list = $(".pb-list"); if (list) { var d = document.createElement("div"); d.innerHTML = addPanel(); list.outerHTML = d.querySelector(".pb-list").outerHTML; } }
      else if (el.id === "keysSearch") { keysQuery = el.value; var kl = $(".keys-list"); if (kl) { var d2 = document.createElement("div"); d2.innerHTML = keysPanel(c); kl.outerHTML = d2.querySelector(".keys-list").outerHTML; } }
    });
    root.addEventListener("change", function (e) {
      var el = e.target, c = cfg(), k = kind();
      if (el.id === "inBoard") { if (el.value === "__custom") { PP.ask("Name for this board", { value: "My " + (k === "keys" ? "keys" : "board"), ok: "Save board" }).then(function (name) { if (name) { var id = "custom-" + uid(); c.custom.push({ id: id, name: name, kind: k, chain: chainFor(k).map(function (it) { if (isPlug(it)) { var snap = "s" + uid(); send({ type: "instrument", action: "pluginCopyState", from: it.uid, to: snap }); return ["plug", {}, { plugin: it.plugin, stateFrom: snap }]; } return [it.pedal, Object.assign({}, it.values)]; }) }); c.boards[k] = id; PP.persistSoon(); } render(); }); return; } loadBoard(k, el.value); selected = null; apply("board"); render(); }
      else if (el.id === "inInput") { c.input.device = el.value; var inp = catalog.inputs.filter(function (i) { return i.id === el.value; })[0]; c.input.deviceId = inp ? inp.browserId : null; stopMeter(); apply("input"); render(); }
      else if (el.id === "inChannel") { c.input.channel = el.value; apply("input"); }
      else if (el.id === "inMidi") { c.keys.midi = el.value; keysSoon(); }
      else if (el.id === "paSound") { var ps = catalog.keys.filter(function (q) { return q.id === el.value; })[0]; if (ps) { setPlayAny({ patch: { id: ps.id, file: ps.file, bank: ps.bank, prog: ps.prog, name: ps.name } }); PP.setStatus("Play any sound: " + ps.name); } }
      else if (el.id === "inVel") { c.keys.velocity = el.value; keysSoon(); }
      else if (el.id === "keysSustain") { c.keys.sustain = el.checked; keysSoon(); }
      else if (el.dataset.on) { var it = chainFor(k).filter(function (q) { return q.uid === el.dataset.on; })[0]; if (it && itemLocked(it)) { el.checked = false; lockedSay(lockedLine(PED.byId(it.pedal).tier, "this pedal stays bypassed until the plan is active.")); return; } if (it) { it.on = el.checked; send({ type: "instrument", action: "bypass", uid: it.uid, on: it.on }); PP.persistSoon(); render(); } }
      else if (el.dataset.kloct != null || el.dataset.kllo != null || el.dataset.klhi != null || el.dataset.klvlo != null || el.dataset.klvhi != null) {
        var li = Number(el.dataset.kloct != null ? el.dataset.kloct : el.dataset.kllo != null ? el.dataset.kllo : el.dataset.klhi != null ? el.dataset.klhi : el.dataset.klvlo != null ? el.dataset.klvlo : el.dataset.klvhi), ly = layers(c)[li]; if (!ly) return; var v = Number(el.value);
        if (el.dataset.kloct != null) ly.octave = v; else if (el.dataset.kllo != null) ly.lo = v; else if (el.dataset.klhi != null) ly.hi = v; else if (el.dataset.klvlo != null) ly.velLo = clamp(v, 1, 127); else ly.velHi = clamp(v, 1, 127);
        keysLive(); render(); }
      else if (el.dataset.irfile) { var ir = chainFor(k).filter(function (q) { return q.uid === el.dataset.irfile; })[0]; if (ir) { ir.file = el.value || null; apply("ir"); PP.setStatus(el.value ? "IR: " + el.options[el.selectedIndex].text : "IR removed"); } }
      else if (el.dataset.expr) { c.expression = el.checked ? el.dataset.expr : null; apply("expression"); }
      else if (el.dataset.ctl && (el.type === "checkbox" || el.tagName === "SELECT")) el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    root.addEventListener("pointerdown", function (e) { var kk = e.target.closest(".kk"); if (!kk) return; kk.classList.add("down"); send({ type: "instrument", action: "note", on: true, note: Number(kk.dataset.note), velocity: 100 }); });
    function keyUp(e) { var kk = e.target.closest && e.target.closest(".kk"); if (!kk) return; kk.classList.remove("down"); send({ type: "instrument", action: "note", on: false, note: Number(kk.dataset.note), velocity: 0 }); }
    root.addEventListener("pointerup", keyUp); root.addEventListener("pointercancel", keyUp); root.addEventListener("pointerleave", keyUp, true);
    F.on("instrumentStatus", function (m) {
      var sig = function (x) { return JSON.stringify([x.running, x.error, x.kind, (x.inputs || []).length, (x.keysCatalog || []).length, !!x.plugins, x.engine, x.engineAlt, Object.keys(x.pluginSlots || {}).sort(), x.pluginErrors || {}, x.playAny && x.playAny.available]); };
      var before = sig(status), hadEngine = status.available !== undefined, prevEngine = status.engine;
      status = m;
      if (hadEngine && prevEngine !== m.engine) setTimeout(function () { if (kind() !== "off") apply("engine"); }, 300);   // (switched engines: give the new one the board)
      if (plugHost() && !plugs.asked) { plugs.asked = true; send({ type: "instrument", action: "plugins", scan: true, folders: cfg().pluginFolders || [] }); }
      if (m.pluginSlots) Object.keys(plugs.open).forEach(function (id) { var si = m.pluginSlots[id]; if (si) plugs.open[id] = !!si.open; });
      if (m.plugins) catalog.plugins = m.plugins;
      catalog.inputs = (m.inputs || []).map(function (i) { return { id: i.name, name: (i.desc || i.name) + (i.channels ? " · " + i.channels + " in" : ""), channels: i.channels || 2, usb: /usb/i.test(i.name) }; });
      catalog.midi = m.midiInputs || []; catalog.keys = flattenKeys(m.keysCatalog || []); catalog.ready = true;
      if (pendingPatchFile) { var np = catalog.keys.filter(function (p) { return p.file === pendingPatchFile; })[0]; if (np) { pendingPatchFile = null; var cc = cfg(); cc.keys.patch = { id: np.id, file: np.file, bank: np.bank, prog: np.prog, name: np.name }; keysQuery = ""; keysCat = "all"; if (kind() === "keys") send({ type: "instrument", action: "keys", keys: hostConfig().keys }); PP.persistSoon(); } }
      var s = $(".in-status"); if (s) s.innerHTML = statusLine();
      if (onTab() && before !== sig(m)) render();
    });
    // the Studio compressor / limiter / de-esser's gain reduction (the computer's built-in rig reports it)
    F.on("instrumentMeters", function (m) {
      var pn = document.querySelector("[data-panow]"); if (pn) { var q = m.playAny; pn.textContent = !q ? "" : q.state === "note" && q.note >= 0 ? "Now: notes · " + noteName(q.note) : q.state === "synth" ? "Now: synth (chord)" : "Now: listening"; }
      document.querySelectorAll("[data-gr]").forEach(function (el) { var g = m.gr && m.gr[el.dataset.gr] || 0; el.querySelector("i").style.width = Math.min(100, g / 24 * 100) + "%"; el.querySelector("output").textContent = (g > 0.05 ? "−" + g.toFixed(1) : "0.0") + " dB"; });
    });
    setInterval(function () { if (onTab() && (document.querySelector("[data-gr]") || (playAnyOn() && document.querySelector("[data-panow]")))) send({ type: "instrument", action: "meters" }); }, 120);
    F.on("instrumentNotice", function (m) { if (m.text) PP.setStatus(m.text); });
    F.on("pluginList", function (m) { plugs.list = m.plugins || []; plugs.failed = m.failed || []; plugs.folders = m.folders || []; plugs.formats = m.formats || ""; if (m.scanning) { if (!plugs.scan) plugs.scan = { done: 0, total: 0 }; } else { plugs.scanned = true; plugs.scan = null; } if (onTab()) render(); });
    F.on("pluginScan", function (m) { plugs.scan = m; var el = $(".plug-scan"); if (el) el.textContent = "Looking for plugins… " + (m.total ? m.done + " of " + m.total + (m.current ? " · " + m.current : "") : ""); });
    F.on("pluginParams", function (m) {
      plugs.params[m.uid] = m.params || []; var box = document.querySelector('.plug-params[data-ppfor="' + m.uid + '"]'); if (!box) return;
      var a = document.activeElement, dragging = a && box.contains(a) && a.matches('input[type="range"]');
      if (!dragging) { box.innerHTML = plugParamsHtml(m.uid, m.params || []); return; }
      (m.params || []).forEach(function (q) { var inp = box.querySelector('[data-pp="' + m.uid + "|" + q.id + '"]'); if (!inp) return; var o = inp.parentNode.querySelector("output"); if (o) o.textContent = tidyNum(q.text); if (inp !== a) inp.value = Math.round(q.value * 1000); });
    });
    F.on("pluginEditor", function (m) { plugs.open[m.uid] = !!m.open; if (m.error) PP.setStatus(m.error); if (onTab()) render(); });
    setInterval(function () { if (!onTab() || !selected || !plugHost()) return; var it = chainFor(kind()).filter(function (q) { return q.uid === selected; })[0]; if (it && isPlug(it) && slotInfo(it.uid)) askParams(it.uid); }, 2000);   // (its own window may have moved them)
    F.on("hello", function () { send({ type: "instrument", action: "status" }); setTimeout(function () { if (kind() !== "off") apply("connect"); }, 600); });
  }
  function show() { send({ type: "instrument", action: "status" }); render(); }
  function hide() { if (tunerOn) toggleTuner(false); stopMeter(); }
  // ---- control-surface actions (Configure tab)
  function togglePedal(index) { var it = chainFor(kind())[index]; if (!it) return false; if (itemLocked(it)) { PP.setStatus(lockedLine(PED.byId(it.pedal).tier, "this pedal stays bypassed until the plan is active.")); return false; } it.on = it.on === false; send({ type: "instrument", action: "bypass", uid: it.uid, on: it.on }); PP.persistSoon(); if (onTab()) render(); return true; }
  function pedalOn(index) { var it = chainFor(kind())[index]; return it ? it.on !== false && !itemLocked(it) : false; }
  function stepBoard(delta) { var c = cfg(), k = kind(); if (k === "off") return; var all = allBoards().filter(function (b) { return b.kind === k; }), boards = all.filter(function (b) { return !boardLocked(b) || b.id === c.boards[k]; }); if (!all.length) return;
    if (!boards.some(function (b) { return !boardLocked(b); })) { PP.setStatus("Every other board here needs a plan"); return; }
    var i = boards.findIndex(function (b) { return b.id === c.boards[k]; }), j = (i + delta + boards.length) % boards.length; for (var n = 0; n < boards.length && boardLocked(boards[j]); n++) j = (j + (delta < 0 ? -1 : 1) + boards.length) % boards.length; loadBoard(k, boards[j].id); selected = null; apply("board"); PP.setStatus("Board: " + boards[j].name); if (onTab()) render(); }
  // Keys sounds from a USB stick / SD card: an .sf2 file is copied into the Pi's sound folder, a folder of WAVs
  // named by note is turned into a SoundFont by the Pi. Either way the sound list refreshes and the new sound is picked.
  function addSounds() {
    if (!connected()) { PP.setStatus("Adding sounds works on the Central Pedal itself (or send an .sf2 to it over Wi-Fi)."); return; }
    var F = window.PPFeatures;
    if (!F || !F.openUsb) return;
    F.openUsb(async function (picked) {
      var base = "http://127.0.0.1:8766", jobs = [], i;
      if (picked.folder) jobs.push({ url: base + "/instrument/wavbank", body: { path: picked.folder, name: picked.folder.split("/").filter(Boolean).pop() || "WAV bank" } });
      for (i = 0; i < (picked.files || []).length; i++) jobs.push({ url: base + "/instrument/sf2", body: { path: picked.files[i] } });
      var added = 0, last = null;
      for (i = 0; i < jobs.length; i++) {
        PP.setStatus("Adding sound " + (i + 1) + " of " + jobs.length + "…");
        try {
          var r = await fetch(jobs[i].url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(jobs[i].body) }), j = await r.json();
          if (r.ok && !j.error) { added++; last = j.file; } else PP.setStatus("Could not add: " + (j.error || r.status));
        } catch (err) { PP.setStatus("Could not add the sound: " + (err && err.message)); }
      }
      if (added) {
        pendingPatchFile = last; send({ type: "instrument", action: "status" });
        PP.setStatus("Added " + added + " sound" + (added === 1 ? "" : "s") + ".");
      }
    }, { kind: "sf2" });
  }
  var pendingPatchFile = null;
  // IRs from a USB stick: the Pi copies the .wav into /data/pad-pedal/sounds/ir
  function addIr(itemUid) {
    if (!connected()) { PP.setStatus("Adding IRs works on the Central Pedal itself."); return; }
    var F2 = window.PPFeatures; if (!F2 || !F2.openUsb) return;
    F2.openUsb(async function (picked) {
      var last = null;
      for (var i = 0; i < (picked.files || []).length; i++) {
        try { var r = await fetch("http://127.0.0.1:8766/instrument/ir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: picked.files[i] }) }), j = await r.json(); if (r.ok && j.file) last = j.file; else PP.setStatus("Could not add: " + (j.error || r.status)); } catch (err) { PP.setStatus("Could not add the IR: " + (err && err.message)); }
      }
      if (last) { var it = chainFor(kind()).filter(function (q) { return q.uid === itemUid; })[0]; if (it) { it.file = last; apply("ir"); } send({ type: "instrument", action: "status" }); PP.setStatus("IR added"); }
    }, { kind: "ir" });
  }
  function stepPatch(delta) { var c = cfg(), open = catalog.keys.filter(function (q) { return !tierLocked(q.tier); }); if (!open.length) { if (catalog.keys.length) PP.setStatus("These sounds open with " + planName("keys") + " or " + planName("instrument")); return; } var curId = (layers(c)[0].patch || c.keys.patch || {}).id;
    var i = curId ? open.findIndex(function (p) { return p.id === curId; }) : -1; if (i < 0 && curId) { var at = catalog.keys.findIndex(function (p) { return p.id === curId; }); i = open.filter(function (p) { return catalog.keys.indexOf(p) < at; }).length - (delta > 0 ? 1 : 0); }
    var j = ((i + delta) % open.length + open.length) % open.length, p = open[j]; c.keys.patch = { id: p.id, file: p.file, bank: p.bank, prog: p.prog, name: p.name }; layers(c)[0].patch = c.keys.patch; send({ type: "instrument", action: "keys", keys: hostConfig().keys }); PP.persistSoon(); PP.setStatus("Sound: " + p.name); if (onTab()) render(); }
  function stepKind(delta) { var order = ["electric", "acoustic", "bass", "keys", "off"], c = cfg(), j = (order.indexOf(c.kind) + delta + order.length) % order.length; c.kind = order[j]; selected = null; apply("kind"); PP.setStatus("Instrument: " + KINDS[j][1]); if (onTab()) render(); }
  function expression(value) { var c = cfg(); if (!c.expression) return; var it = chainFor(kind()).filter(function (q) { return q.uid === c.expression; })[0], pedal = it && PED.byId(it.pedal); if (!pedal) return; var ctl = expressionCtl(pedal); if (!ctl) return; var v = denorm(ctl, value); it.values[ctl.sym] = v; send({ type: "instrument", action: "set", uid: it.uid, sym: ctl.sym, value: v }); }
  // the big tuner: full screen over everything (footswitch or the Tuner button); the instrument is muted while it is up
  var NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"], tunerSmooth = null;
  function tunerBox() {
    var el = document.getElementById("tunerOverlay"); if (el) return el;
    el = document.createElement("div"); el.id = "tunerOverlay"; el.className = "tuner-overlay";
    el.innerHTML = '<div class="tn-card"><small>TUNER · instrument muted</small><b class="tn-note">–</b><div class="tn-scale"><i class="tn-needle"></i><span class="tn-mid"></span></div><div class="tn-cents">play one string</div><div class="tn-ref"><span>A4 =</span> <input id="tnRef" type="number" min="425" max="455" step="1"> Hz</div><label class="toggle tn-mute"><input type="checkbox" id="tnMute"> Mute the instrument while tuning</label><button class="primary" id="tnClose">Done (tuner off)</button></div>';
    document.body.appendChild(el);
    el.querySelector("#tnRef").value = cfg().tunerRef || 440;
    el.querySelector("#tnMute").checked = cfg().tunerMute !== false;
    el.addEventListener("click", function (e) { if (e.target.id === "tnClose") toggleTuner(); });
    el.addEventListener("change", function (e) {
      if (e.target.id === "tnRef") { cfg().tunerRef = clamp(Number(e.target.value) || 440, 425, 455); PP.persistSoon(); }
      if (e.target.id === "tnMute") { cfg().tunerMute = e.target.checked; PP.persistSoon(); if (tunerOn) send({ type: "instrument", action: "level", levelDb: e.target.checked ? -120 : outLevel() }); el.querySelector("small").textContent = e.target.checked ? "TUNER · instrument muted" : "TUNER · instrument still playing"; }
    });
    return el;
  }
  function tunerShow(f) {
    var el = tunerBox(), note = el.querySelector(".tn-note"), needle = el.querySelector(".tn-needle"), cl = el.querySelector(".tn-cents");
    if (!f) { el.classList.remove("intune"); miniTuner(null); return; }
    var ref = cfg().tunerRef || 440, midi = 69 + 12 * Math.log2(f / ref);
    tunerSmooth = tunerSmooth == null || Math.abs(tunerSmooth - midi) > 0.6 ? midi : tunerSmooth * 0.7 + midi * 0.3;
    var n = Math.round(tunerSmooth), cents = Math.round((tunerSmooth - n) * 100);
    note.textContent = NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
    needle.style.left = (50 + clamp(cents, -50, 50)) + "%";
    cl.textContent = Math.abs(cents) < 3 ? "in tune" : (cents > 0 ? "+" + cents + "¢ sharp - tune down" : cents + "¢ flat - tune up");
    el.classList.toggle("intune", Math.abs(cents) < 3); el.classList.toggle("sharp", cents >= 3); el.classList.toggle("flat", cents <= -3);
    miniTuner(note.textContent, cents);
    tunerHooks.forEach(function (fn) { try { fn(note.textContent, cents); } catch (_) { } });
  }
  var tunerHooks = [];
  // the 3.5" screen shows the tuner too while it is up (a few times a second)
  var miniAt = 0;
  function miniTuner(note, cents) { var now = performance.now(); if (now - miniAt < 200) return; miniAt = now; send({ type: "tunerView", on: tunerOn, note: note || "–", cents: note ? cents : null }); }
  // the tuner lives on the Instrument tab: a footswitch brings that tab up; leaving the tab turns the tuner off
  function toggleTuner(force) {
    var want = typeof force === "boolean" ? force : !tunerOn; if (want === tunerOn) return tunerOn;
    if (want && window.PPShell && ["instrument", "live"].indexOf(window.PPShell.currentTab()) < 0) window.PPShell.showTab("instrument");   // (the LIVE screen shows its own tuner)
    tunerOn = want;
    if (cfg().tunerMute !== false || !tunerOn) send({ type: "instrument", action: "level", levelDb: tunerOn ? -120 : outLevel() });
    var box = tunerBox(); box.classList.toggle("on", tunerOn); tunerSmooth = null;
    box.querySelector("small").textContent = cfg().tunerMute !== false ? "TUNER · instrument muted" : "TUNER · instrument still playing";
    miniAt = 0; send({ type: "tunerView", on: tunerOn, note: "–", cents: null });
    if (tunerOn) startMeter(); else if (!onTab()) stopMeter();
    if (onTab()) render(); if (window.PPActions) window.PPActions.sendLeds(); return tunerOn;
  }
  wire();
  // the small touch screen's Instrument tab: the EQ, compressor and studio pedals' knobs (0-1), and setting one
  var MINI_CATS = { eq: 1, comp: 1, studio: 1 };
  function miniKnobs() {
    var out = [];
    chainFor(kind()).forEach(function (it) {
      var p = pedalOf(it); if (!p || it.plugin || !MINI_CATS[p.category]) return;
      controlsOf(p).forEach(function (ctl) { if (ctl.extra || ctl.toggled || ctl.enum) return; out.push({ uid: it.uid, sym: ctl.sym, pedal: p.name, label: ctl.label, value: Math.round(norm(ctl, valueOf(it, ctl)) * 1000) / 1000, text: fmt(ctl, valueOf(it, ctl)), on: it.on !== false && !itemLocked(it), locked: itemLocked(it) ? lockText(p.tier) : undefined }); });
    });
    return out.slice(0, 24);
  }
  function setInput(field, value) {   // the small screen's Settings: input gain (dB) and channel (L / R)
    var c = cfg();
    if (field === "gain") c.input.gain = clamp(Math.round(Number(value) || 0), -20, 40);
    else if (field === "channel") c.input.channel = value === "R" ? "R" : "L";
    else return false;
    inputSoon(); if (onTab()) render(); return true;
  }
  function setKnob(uid, sym, n) {
    var it = chainFor(kind()).filter(function (q) { return q.uid === uid; })[0], p = it && PED.byId(it.pedal); if (!p) return false;
    var ctl = controlsOf(p).filter(function (c) { return c.sym === sym; })[0]; if (!ctl) return false;
    var v = denorm(ctl, n); it.values[ctl.sym] = v; send({ type: "instrument", action: "set", uid: it.uid, sym: ctl.sym, value: v }); PP.persistSoon(); if (onTab()) render(); return true;
  }
  function pedalNames() { return chainFor(kind()).map(function (it, i) { var p = pedalOf(it), cat = p && PED.CATEGORIES[p.category], lk = itemLocked(it); return { index: i, name: p ? p.name : it.pedal, on: it.on !== false && !lk, color: cat ? cat.color : null, locked: lk ? lockText(p.tier) : undefined }; }); }
  function lockInfo() {   // (the current board / sound, when a plan has ended: for the small screens)
    var c = cfg(), k = kind(), b = allBoards().filter(function (x) { return x.id === c.boards[k]; })[0], pt = (layers(c)[0] || {}).patch || c.keys.patch, so = soundOf(pt);
    return { board: b && boardLocked(b) ? lockText(boardMissing(b)) : null, patch: so && tierLocked(so.tier) ? lockText(so.tier) : null };
  }
  function outLevel() { return window.PPActions && window.PPActions.muted && window.PPActions.muted("instrument") ? -90 : (cfg().output.level || 0); }   // (Bus levels & mutes: the instrument muted from a button)
  function state() { var c = cfg(); return { kind: c.kind, tuner: tunerOn, board: c.boards[c.kind], patch: c.keys.patch, get levelDb() { return c.output.level || 0; }, set levelDb(v) { c.output.level = v; if (onTab()) { var el = $("#inOut"); if (el) { el.value = v; var o = el.parentNode.querySelector("output"); if (o) o.textContent = v + " dB"; } } } }; }
  // a board from Central Tracks (or a file): { name, kind, chain: [[pedalId, { knob: value }], …] } becomes one of "your boards"
  function addBoard(data, fallbackName, quiet) {
    var b = data && data.board ? data.board : data; if (!b || !Array.isArray(b.chain)) throw new Error("that isn't a board (no pedals in it)");
    var k = ["electric", "acoustic", "bass", "keys"].indexOf(b.kind) >= 0 ? b.kind : "electric";
    var chain = b.chain.map(function (it) { var id = Array.isArray(it) ? it[0] : it && (it.pedal || it.id), vals = Array.isArray(it) ? it[1] : it && it.values, extra = Array.isArray(it) ? it[2] : it && it.extra; if (!PED.byId(id)) return null; var v = {}; Object.keys(vals || {}).forEach(function (key) { var n = Number(vals[key]); if (isFinite(n)) v[String(key).slice(0, 40)] = n; }); var x = {}; if (extra && typeof extra.ir === "string") x.ir = extra.ir.slice(0, 80); if (extra && typeof extra.file === "string") x.file = extra.file.slice(0, 400); return Object.keys(x).length ? [id, v, x] : [id, v]; }).filter(Boolean).slice(0, 24);
    if (!chain.length) throw new Error("none of that board's pedals are in this version");
    var c = cfg(), board = { id: "custom-" + uid(), name: String(b.name || fallbackName || "Board").slice(0, 60), kind: k, chain: chain, from: "central-tracks" };
    if (typeof b.sound === "string") board.sound = b.sound.slice(0, 80);
    // from a sound library: it keeps the library's plan (as well as its pedals' plans), and is replaced when the library updates
    var lib = data && data.library ? data : b;
    if (lib.library && /^[a-z0-9-]{3,60}$/.test(lib.library)) {
      board.from = "library"; board.library = lib.library; board.libraryVersion = String(lib.libraryVersion || "");
      var tier = ["keys", "instrument", "plugins", "pedals"].indexOf(lib.tier) >= 0 ? lib.tier : null, plans = PED.boardPlans ? PED.boardPlans(board) : [];
      if (tier && plans.indexOf(tier) < 0) plans.unshift(tier);
      board.plans = plans; board.tier = plans[0] || "free";
      if (board.sound) board.soundPlan = tier || "keys";
    }
    c.custom.push(board); if (!quiet) { PP.persistSoon(); if (onTab()) render(); } return board;
  }
  // the sound libraries installed here (Settings → Packages → Libraries): their presets and boards become "your boards",
  // each keeping its library's plan. A new version replaces them; a removed library takes them away. (Once added, a
  // board you delete stays deleted until the library's next version.)
  function syncLibraries(list) {
    if (!Array.isArray(list)) return 0;
    var c = cfg(), want = {}, changed = 0; c.libs = c.libs && typeof c.libs === "object" ? c.libs : {};
    list.forEach(function (l) { if (l && /^[a-z0-9-]{3,60}$/.test(l.id || "")) want[l.id] = l; });
    Object.keys(c.libs).forEach(function (id) { if (!want[id] || want[id].version !== c.libs[id]) { var n = c.custom.length; c.custom = c.custom.filter(function (x) { return x.library !== id; }); changed += n - c.custom.length; delete c.libs[id]; } });
    Object.keys(want).forEach(function (id) {
      var l = want[id]; if (c.libs[id] === l.version) return;
      c.custom = c.custom.filter(function (x) { return x.library !== id; });
      (l.presets || []).concat(l.boards || []).forEach(function (b) { try { addBoard(Object.assign({}, b, { library: id, tier: l.plan, libraryVersion: l.version }), null, true); changed++; } catch (_) { } });
      c.libs[id] = l.version; changed++;
    });
    if (changed) { PP.persistSoon(); if (onTab()) render(); }
    return changed;
  }
  function removeLibraryBoards(libId) { var c = cfg(), n = c.custom.length; c.custom = c.custom.filter(function (x) { return x.library !== libId; }); if (c.libs) delete c.libs[libId]; if (c.custom.length !== n) { PP.persistSoon(); if (onTab()) render(); } return n - c.custom.length; }
  function setKind(k) { var c = cfg(); c.kind = k; selected = null; apply("kind"); PP.setStatus("Instrument: " + (KINDS.filter(function (q) { return q[0] === k; })[0] || ["", k])[1]); if (onTab()) render(); }
  window.PPInstrument = { addBoard: addBoard, syncLibraries: syncLibraries, removeLibraryBoards: removeLibraryBoards, loadBoard: function (k, id) { loadBoard(k, id); }, lockInfo: lockInfo, show: show, hide: hide, render: render, config: cfg, kind: kind, state: state, setKind: setKind, autoSetup: autoSetup, togglePedal: togglePedal, pedalOn: pedalOn, pedalNames: pedalNames, miniKnobs: miniKnobs, setKnob: setKnob, setInput: setInput, stepBoard: stepBoard, stepPatch: stepPatch, stepKind: stepKind, expression: expression, toggleTuner: toggleTuner, tunerToggle: toggleTuner, tunerOn: function () { return tunerOn; }, apply: apply, hostConfig: hostConfig, catalog: function () { return catalog; }, chain: chainFor, resolvedChain: resolvedChain, controlsOf: controlsOf, captureRig: captureRig, applyRig: applyRig, layers: layers, maxLayers: MAX_LAYERS, status: function () { return status; }, boardName: function () { var c = cfg(), k = kind(), b = allBoards().filter(function (x) { return x.id === c.boards[k]; })[0]; return b ? b.name : ""; }, kinds: function () { return KINDS; }, onTuner: function (fn) { tunerHooks.push(fn); }, togglePlayAny: togglePlayAny, playAnyOn: playAnyOn, setPlayAny: setPlayAny, stepPlayAnyMode: stepPlayAnyMode, playAny: function () { return paCfg(); } };
})();
