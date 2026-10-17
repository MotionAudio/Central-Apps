/* Central Control - the Instrument tab: acoustic guitar, electric guitar or
 * piano / keys through a native, low-latency plugin chain on the Pi (PipeWire +
 * LV2 / LADSPA: Guitarix, Calf, Dragonfly, Zam, mda, swh, TAP, CAPS...) and
 * FluidSynth / free sample banks for keys. This file is the control surface:
 * boards, pedals with graphics, knobs, patches, input / output, tuner, Auto.
 * The driver (pedal-driver.py, InstrumentHost) runs the audio. */
(function () {
  "use strict";
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
  function chainFor(k) { var c = cfg(); k = k || kind(); if (k === "off") return []; if (!c.chains[k]) loadBoard(k, DEFAULT_BOARD[k]); return c.chains[k] || []; }
  function allBoards() { return PED.boards.concat(cfg().custom); }
  function loadBoard(k, boardId) {
    var c = cfg(), board = allBoards().filter(function (b) { return b.id === boardId; })[0]; if (!board) return;
    c.boards[k] = boardId;
    c.chains[k] = board.chain.map(function (item) { var pedal = PED.byId(item[0]); if (!pedal) return null; var values = Object.assign({}, pedal.opts.values || {}); Object.keys(item[1] || {}).forEach(function (label) { values[pedal.knobs[label] || label] = item[1][label]; }); return { uid: uid(), pedal: pedal.id, on: true, values: values }; }).filter(Boolean);
  }
  var CATS = [[/rhodes|wurli|e\.? ?piano|elec.*piano|\bep\b|fm[ _-]?piano|\bdx|tine|clav/i, "Electric pianos"], [/harp|guitar|nylon|banjo|sitar|koto|dulcimer|shamisen/i, "Guitars & harp"], [/grand|concert|steinway|yamaha|piano|upright|honky|salamander|ydp/i, "Pianos"], [/organ|drawbar|hammond|b3|church|pipe|rotary|accordion|harmonica/i, "Organs"], [/\bbass\b|bass ?yr|lately/i, "Bass"], [/brass|trumpet|horn|trombone|sax|tuba|oboe|flute|clarinet|bassoon|recorder|pan ?flute|whistle|ocarina/i, "Brass & winds"], [/pad|choir|voice|vox|aah|ooh|halo|atmos|sweep|new age|warm|bowed|space|dream/i, "Pads & choirs"], [/string|violin|cello|viola|orch|ensemble|tremolo str|pizz/i, "Strings"], [/bell|glock|vibra|marimba|celest|music box|tubular|kalimba|chime|xylo|timpani|steel dr|glass|hang\b|crystal/i, "Bells & mallets"], [/lead|square|saw|calliope|chiff|charang|fifth|synth|poly|wave/i, "Synths & leads"], [/steel/i, "Guitars & harp"]];
  function categoryOf(name) { for (var i = 0; i < CATS.length; i++) if (CATS[i][0].test(name)) return CATS[i][1]; return "Other"; }
  function flattenKeys(banks) { var out = [], order = CATS.map(function (c) { return c[1]; }); banks.forEach(function (b) { (b.presets || []).forEach(function (pr) { var nm = pr.name || b.name; out.push({ id: b.file + "#" + pr.bank + ":" + pr.prog, file: b.file, bank: pr.bank, prog: pr.prog, name: nm, bankName: b.name + (b.user ? " (yours)" : ""), category: categoryOf(nm + " " + (b.presets.length < 4 ? b.name : "")), user: !!b.user }); }); });
    out.sort(function (a, b) { var ca = a.user ? -1 : order.indexOf(a.category), cb = b.user ? -1 : order.indexOf(b.category); if (ca < 0 && !a.user) ca = 99; if (cb < 0 && !b.user) cb = 99; return ca - cb || a.name.localeCompare(b.name); }); return out; }
  var catalog = { plugins: {}, keys: [], inputs: [], midi: [], ready: false }, status = { running: false }, selected = null, showAdd = false, addCat = "all", addQuery = "", keysCat = "all", keysQuery = "", tunerOn = false;

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
  function fmt(ctl, v) { if (ctl.toggled) return v >= 0.5 ? "on" : "off"; if (ctl.scale.length) { var sp = ctl.scale.filter(function (s) { return Math.abs(s[0] - v) < 1e-6; })[0]; if (sp) return sp[1]; } var a = Math.abs(v), t = a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2); return t + (ctl.unit ? " " + ctl.unit.replace(/^db$/, "dB").replace(/^hz$/, "Hz") : ""); }
  function resolvedChain(k) {
    return chainFor(k).map(function (item) { var pedal = PED.byId(item.pedal); if (!pedal) return null; var values = {}; controlsOf(pedal).forEach(function (ctl) { values[ctl.sym] = valueOf(item, ctl); }); return { uid: item.uid, id: pedal.id, name: pedal.name, uri: pedal.uri, on: item.on !== false, values: values, mix: item.mix == null ? 1 : item.mix, levelDb: item.levelDb || 0, file: item.file || null }; }).filter(Boolean);
  }
  function hostConfig() {
    var c = cfg(), k = kind();
    return { kind: k, input: { device: c.input.device || "auto", channel: c.input.channel || "L", gainDb: c.input.gain || 0, gateOn: c.input.gate > -90, gateDb: c.input.gate != null ? c.input.gate : -70 }, chain: resolvedChain(k),
      keys: hostKeys(c), levelDb: c.output.level || 0, routing: project().routing || {}, looper: !!(window.PPLooper && window.PPLooper.armed()) };
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
      layers: ls.slice(0, MAX_LAYERS).map(function (l) { return { patch: l.patch, on: l.on !== false, volume: l.volume == null ? 1 : l.volume, pan: l.pan || 0, octave: l.octave || 0, lo: l.lo == null ? 0 : l.lo, hi: l.hi == null ? 127 : l.hi, velLo: l.velLo || 1, velHi: l.velHi || 127 }; }) };
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
    var cat = PED.CATEGORIES[pedal.category] || { color: "#777" }, ctls = controlsOf(pedal).filter(function (c) { return !c.extra; }).slice(0, 6), w = 150, h = 190, cols = Math.min(3, Math.max(1, ctls.length));
    var knobs = ctls.map(function (ctl, i) { var cx = cols === 1 ? w / 2 : 26 + (w - 52) * ((i % cols) / (cols - 1)), cy = 52 + Math.floor(i / cols) * 46; return "<g>" + dial(norm(ctl, valueOf(item, ctl)), cx, cy, 15) + '<text x="' + cx + '" y="' + (cy + 27) + '" class="pk-lbl">' + esc(ctl.label.length > 9 ? ctl.label.slice(0, 8) + "…" : ctl.label) + "</text></g>"; }).join("");
    var on = item.on !== false;
    return '<svg class="pedal' + (sel ? " selected" : "") + (on ? "" : " off") + '" viewBox="0 0 ' + w + " " + h + '" data-uid="' + item.uid + '" role="button" tabindex="0" aria-label="' + esc(pedal.name) + '">' +
      '<defs><linearGradient id="g' + item.uid + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + cat.color + '"/><stop offset="1" stop-color="' + cat.color + '" stop-opacity=".55"/></linearGradient></defs>' +
      '<rect x="3" y="3" width="' + (w - 6) + '" height="' + (h - 6) + '" rx="12" fill="url(#g' + item.uid + ')" stroke="' + (sel ? "#fff" : "rgba(0,0,0,.5)") + '" stroke-width="' + (sel ? 3 : 1.5) + '"/>' +
      '<rect x="3" y="3" width="' + (w - 6) + '" height="' + (h - 6) + '" rx="12" fill="rgba(0,0,0,.08)"/>' +
      (on ? '<circle cx="' + (w - 18) + '" cy="18" r="9" fill="#ff4040" opacity=".3"/>' : "") + '<circle cx="' + (w - 18) + '" cy="18" r="5" fill="' + (on ? "#ff4040" : "#4a1a1a") + '" stroke="#200"/>' +
      '<text x="12" y="23" class="pk-n">' + (idx + 1) + "</text>" + knobs +
      '<rect x="12" y="' + (h - 52) + '" width="' + (w - 24) + '" height="22" rx="5" fill="rgba(255,255,255,.9)"/><text x="' + (w / 2) + '" y="' + (h - 37) + '" class="pk-name">' + esc(pedal.name.length > 20 ? pedal.name.slice(0, 19) + "…" : pedal.name) + "</text>" +
      '<g class="pk-sw" data-sw="' + item.uid + '"><circle cx="' + (w / 2) + '" cy="' + (h - 17) + '" r="10" fill="#d8d8d8" stroke="#333" stroke-width="1.5"/><circle cx="' + (w / 2) + '" cy="' + (h - 17) + '" r="4.5" fill="#222"/></g></svg>';
  }

  // ------------------------------------------------------------- rendering
  function render() {
    var root = $("#instrumentRoot"); if (!root) return;
    var c = cfg(), k = kind(), chain = chainFor(k);
    if (selected && !chain.some(function (i) { return i.uid === selected; })) selected = null;
    var boards = allBoards().filter(function (b) { return b.kind === k; });
    root.innerHTML =
      '<div class="in-head"><div class="in-kinds">' + KINDS.map(function (q) { return '<button class="pf-btn in-kind' + (k === q[0] ? " on" : "") + '" data-kind="' + q[0] + '"><small>' + esc(q[2]) + "</small><b>" + esc(q[1]) + "</b></button>"; }).join("") + '</div><div class="in-status">' + statusLine() + "</div></div>" +
      (k === "off" ? '<p class="muted in-off">Pick an instrument. A guitar goes into any USB audio interface plugged into the Pi (¼″ jack); a keyboard into a USB MIDI port. Its sound leaves on output 4 by default (Settings → Output routing) - the pads and tracks are never in its way.</p>' :
        '<div class="in-bar"><label>Board<select id="inBoard">' + boards.map(function (b) { return '<option value="' + b.id + '"' + (c.boards[k] === b.id ? " selected" : "") + ">" + esc(b.name) + "</option>"; }).join("") + '<option value="__custom">Save this board as…</option></select></label>' +
        (k !== "keys" ?
          '<label>Input<select id="inInput"><option value="auto">Auto (USB interface)</option>' + catalog.inputs.map(function (i) { return '<option value="' + esc(i.id) + '"' + (c.input.device === i.id ? " selected" : "") + ">" + esc(i.name) + "</option>"; }).join("") + '</select></label><label>Input channel<select id="inChannel">' + [["L", "Left / input 1"], ["R", "Right / input 2"], ["stereo", "Both (stereo)"]].map(function (o) { return '<option value="' + o[0] + '"' + (c.input.channel === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></label>" +
          '<label>Input gain <span class="control-line"><input type="range" id="inGain" min="-20" max="40" step="1" value="' + c.input.gain + '"><output>' + c.input.gain + ' dB</output></span></label><label>Noise gate <span class="control-line"><input type="range" id="inGate" min="-90" max="-20" step="1" value="' + c.input.gate + '"><output>' + c.input.gate + " dB</output></span></label>" :
          '<label>MIDI keyboard<select id="inMidi"><option value="auto">Auto (any USB MIDI)</option>' + catalog.midi.map(function (m) { return '<option value="' + esc(m) + '"' + (c.keys.midi === m ? " selected" : "") + ">" + esc(m) + "</option>"; }).join("") + '</select></label><label>Transpose <span class="control-line"><input type="range" id="inTranspose" min="-12" max="12" step="1" value="' + (c.keys.transpose || 0) + '"><output>' + (c.keys.transpose || 0) + '</output></span></label><label>Velocity<select id="inVel">' + [["soft", "Soft touch"], ["normal", "Normal"], ["hard", "Hard"], ["fixed", "Fixed (organ)"]].map(function (o) { return '<option value="' + o[0] + '"' + (c.keys.velocity === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></label>") +
        '<label>Output level <span class="control-line"><input type="range" id="inOut" min="-40" max="12" step="1" value="' + c.output.level + '"><output>' + c.output.level + ' dB</output></span></label>' +
        '<div class="in-meter"><small>IN</small><div class="vu-bar"><i id="inVu" style="width:100%"></i></div><b id="inTuner">–</b></div><button class="pf-btn" id="inAuto" title="Sets input gain and gate from what you play and detects the instrument"><small>SET UP</small><b>AUTO</b></button><button class="pf-btn' + (tunerOn ? " on" : "") + '" id="inTunerBtn" title="Full-screen tuner for the instrument input"><small>' + (cfg().tunerMute === false ? "LIVE" : "MUTE &amp;") + '</small><b>TUNE</b></button></div>' +
        (k === "keys" ? keysPanel(c) : "") +
        '<div class="in-boardwrap"><div class="pb-chain" id="pbChain">' + chain.map(function (item, i) { var pedal = PED.byId(item.pedal); return pedal ? '<div class="pb-slot" data-slot="' + item.uid + '">' + pedalSvg(item, pedal, i, selected === item.uid) + '<div class="pb-tools"><button data-move="' + item.uid + ':-1" title="Move left">◀</button><button data-del="' + item.uid + '" title="Remove">✕</button><button data-move="' + item.uid + ':1" title="Move right">▶</button></div></div>' : ""; }).join("") + '<button class="pb-add" id="pbAdd">＋<small>Add pedal</small></button></div></div>' +
        (selected ? detailPanel(chain.filter(function (i) { return i.uid === selected; })[0]) : '<p class="muted">Tap a pedal to edit its knobs; tap its footswitch to bypass it. Footswitches on the board can do the same (Configure tab → "Pedal 1…8 on / off").</p>') +
        (showAdd ? addPanel() : "") + (window.PPLooper ? window.PPLooper.html() : "") +
        '<div class="in-foot muted">' + (connected() ? (status.pluginCount ? status.pluginCount + " plugins installed on this Pi · " : "") + (status.latencyMs != null ? "about " + status.latencyMs + " ms in to out · " : "") + (status.error ? '<b class="warn">' + esc(status.error) + "</b>" : "native chain " + (status.running ? "running" : "idle")) : "On the Central Control itself the chain runs natively on the Pi; on a computer this is a preview of the board.") + "</div>");
    if (k !== "off" && k !== "keys") startMeter(); else stopMeter();
  }
  function statusLine() {
    var k = kind(); if (k === "off") return '<span class="dot off"></span> Instrument off';
    var s = status, r = project().routing || {}, outCh = r.buses && r.buses.instrument ? r.buses.instrument.ch : 4;
    var txt = !connected() ? "Preview (not on the Pi)" : s.available === false ? "Not available on this system" : s.error ? "Problem: " + (s.error.length > 90 ? s.error.slice(0, 88) + "…" : s.error) : !s.running ? "Starting…" : (k === "keys" ? (s.midiInputs && s.midiInputs.length ? "Keyboard: " + s.midiInputs.join(", ") : "No MIDI keyboard found - plug one into the Pi") + " · " + (s.keysEngine || "") : (s.input ? "In: " + s.input : "No USB audio interface found - plug one in")) + " · out channel " + outCh;
    return '<span class="dot' + (connected() && s.running && !s.error ? "" : " off") + '"></span> ' + esc(txt);
  }
  function detailPanel(item) {
    var pedal = PED.byId(item.pedal); if (!pedal) return ""; var ctls = controlsOf(pedal), cat = PED.CATEGORIES[pedal.category] || {};
    return '<section class="in-detail" style="--pc:' + (cat.color || "#777") + '"><div class="row spread"><div><h3>' + esc(pedal.name) + '</h3><p class="muted">' + esc(cat.name || "") + (ctls[0] && ctls[0].guess ? " · exact ranges appear on the Pi" : "") + '</p></div><div class="se-row"><label class="toggle"><input type="checkbox" data-on="' + item.uid + '"' + (item.on !== false ? " checked" : "") + "> On</label>" +
      (pedal.opts.expression ? '<label class="toggle"><input type="checkbox" data-expr="' + item.uid + '"' + (cfg().expression === item.uid ? " checked" : "") + "> Expression pedal moves " + esc((expressionCtl(pedal) || {}).label || "it") + "</label>" : "") +
      (pedal.opts.tempo || pedal.opts.tempoBpm ? '<button data-sync="' + item.uid + '">♩ Sync to song tempo</button>' : "") + '<button data-reset="' + item.uid + '">Reset</button></div></div>' +
      '<div class="in-mixlevel"><label>Mix <small>(dry ↔ pedal)</small><span class="control-line"><input type="range" min="0" max="100" step="1" data-pmix="' + item.uid + '" value="' + Math.round((item.mix == null ? 1 : item.mix) * 100) + '"><output>' + Math.round((item.mix == null ? 1 : item.mix) * 100) + '%</output></span></label><label>Level<span class="control-line"><input type="range" min="-30" max="12" step="0.5" data-plevel="' + item.uid + '" value="' + (item.levelDb || 0) + '"><output>' + (item.levelDb || 0) + ' dB</output></span></label></div>' +
      (pedal.opts.irFile ? '<div class="in-ir"><label>Impulse response<select data-irfile="' + item.uid + '"><option value="">— choose an IR —</option>' + (status.irs || []).map(function (f) { return '<option value="' + esc(f.file) + '"' + (item.file === f.file ? " selected" : "") + ">" + esc(f.name) + "</option>"; }).join("") + '</select></label><button data-iradd="' + item.uid + '">+ Add IR from USB…</button><span class="muted small">A .wav cabinet or acoustic-body impulse (mono, 48 kHz best).</span></div>' : "") +
      '<div class="in-controls">' + ctls.map(function (ctl) { var v = valueOf(item, ctl), key = item.uid + "|" + esc(ctl.sym); if (ctl.toggled) return '<label class="toggle"><input type="checkbox" data-ctl="' + key + '"' + (v >= 0.5 ? " checked" : "") + "> " + esc(ctl.label) + "</label>"; if (ctl.enum && ctl.scale.length) return "<label>" + esc(ctl.label) + '<select data-ctl="' + key + '">' + ctl.scale.map(function (s) { return '<option value="' + s[0] + '"' + (Math.abs(s[0] - v) < 1e-6 ? " selected" : "") + ">" + esc(s[1]) + "</option>"; }).join("") + "</select></label>"; return "<label>" + esc(ctl.label) + '<span class="control-line"><input type="range" min="0" max="1000" step="1" value="' + Math.round(norm(ctl, v) * 1000) + '" data-ctl="' + key + '"><output>' + esc(fmt(ctl, v)) + "</output></span></label>"; }).join("") + "</div></section>";
  }
  function addPanel() {
    var cats = Object.keys(PED.CATEGORIES), q = addQuery.toLowerCase();
    var list = PED.pedals.filter(function (p) { return (addCat === "all" || p.category === addCat) && (!q || (p.name + " " + (PED.CATEGORIES[p.category] || {}).name).toLowerCase().indexOf(q) > -1); });
    return '<section class="in-add"><div class="row spread"><h3>Add a pedal <small class="muted">' + PED.pedals.length + " to choose from</small></h3><input id=\"pbSearch\" placeholder=\"Search pedals…\" value=\"" + esc(addQuery) + '"><button id="pbAddClose">Close</button></div><div class="st-nav">' + ['<button class="st-chip' + (addCat === "all" ? " on" : "") + '" data-cat="all">All</button>'].concat(cats.map(function (cid) { return '<button class="st-chip' + (addCat === cid ? " on" : "") + '" data-cat="' + cid + '">' + esc(PED.CATEGORIES[cid].name) + "</button>"; })).join("") + '</div><div class="pb-list">' + list.map(function (p) { var ok = !catalog.ready || catalog.plugins[p.uri] || p.opts.ladspa || p.opts.builtin; return '<button class="pb-item' + (ok ? "" : " missing") + '" data-add="' + p.id + '" style="--pc:' + (PED.CATEGORIES[p.category] || {}).color + '"><i></i><b>' + esc(p.name) + "</b><small>" + esc((PED.CATEGORIES[p.category] || {}).name) + (ok ? "" : " · not installed") + "</small></button>"; }).join("") + "</div></section>";
  }
  function keysPanel(c) {
    var cats = {}; catalog.keys.forEach(function (p) { cats[p.category] = (cats[p.category] || 0) + 1; });
    var q = keysQuery.toLowerCase(), list = catalog.keys.filter(function (p) { return (keysCat === "all" || p.category === keysCat) && (!q || (p.name + " " + p.bank).toLowerCase().indexOf(q) > -1); }).slice(0, 400), cur = (layers(c)[layerSel] || {}).patch;
    var kbd = "", whites = 0; for (var n = 48; n <= 84; n++) if ([1, 3, 6, 8, 10].indexOf(n % 12) < 0) { kbd += '<button class="kk white" data-note="' + n + '" style="left:' + (whites * 30) + 'px">' + (n % 12 === 0 ? "C" + (n / 12 - 1) : "") + "</button>"; whites++; }
    whites = 0; for (n = 48; n <= 84; n++) { if ([1, 3, 6, 8, 10].indexOf(n % 12) < 0) whites++; else kbd += '<button class="kk black" data-note="' + n + '" style="left:' + (whites * 30 - 9) + 'px"></button>'; }
    return '<section class="in-keys"><div class="row spread"><div><h3>Sounds</h3><p class="muted">' + (catalog.keys.length ? catalog.keys.length + " sounds: grand and upright pianos, electric pianos, organs, pads, strings, leads, bells… Add your own: .sf2 SoundFonts or a folder of WAVs named by note (C4.wav, F#3.wav…) from a USB stick, or send an .sf2 from a phone or computer (Settings → Companion devices → Upload)." : connected() ? "No sound banks found yet." : "The sound list comes from the Pi.") + '</p></div><div class="row"><input id="keysSearch" placeholder="Search sounds…" value="' + esc(keysQuery) + '"><button id="keysAdd" title="Add a .sf2 SoundFont or a folder of WAV samples from a USB stick or SD card">+ Add sounds…</button></div></div>' +
      '<div class="st-nav">' + ['<button class="st-chip' + (keysCat === "all" ? " on" : "") + '" data-kcat="all">All</button>'].concat(Object.keys(cats).sort().map(function (cid) { return '<button class="st-chip' + (keysCat === cid ? " on" : "") + '" data-kcat="' + esc(cid) + '">' + esc(cid) + " <small>" + cats[cid] + "</small></button>"; })).join("") + "</div>" +
      '<div class="keys-list">' + (list.length ? list.map(function (p) { return '<button class="keys-item' + (cur && cur.id === p.id ? " on" : "") + '" data-patch="' + esc(p.id) + '"><b>' + esc(p.name) + "</b><small>" + esc(p.bankName) + "</small></button>"; }).join("") : '<p class="muted">Nothing matches.</p>') + "</div>" +
      layersPanel(c) +
      '<div class="keys-extra"><label>Synth volume <span class="control-line"><input type="range" id="keysVolume" min="0" max="100" value="' + Math.round((c.keys.volume != null ? c.keys.volume : 0.8) * 100) + '"><output>' + Math.round((c.keys.volume != null ? c.keys.volume : 0.8) * 100) + '</output></span></label><label class="toggle"><input type="checkbox" id="keysSustain"' + (c.keys.sustain !== false ? " checked" : "") + '> Sustain pedal</label><span class="muted">Reverb, delay, chorus, compression: add them as pedals below.</span></div>' +
      '<div class="keys-kbd" id="keysKbd">' + kbd + "</div></section>";
  }

  var layerSel = 0;
  var NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  function noteName(n) { return NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 1); }
  function noteSelect(attr, idx, val) { var o = ""; for (var n = 0; n <= 127; n += 1) o += '<option value="' + n + '"' + (n === val ? " selected" : "") + ">" + noteName(n) + "</option>"; return '<select data-' + attr + '="' + idx + '">' + o + "</select>"; }
  function layersPanel(c) {
    var ls = layers(c); if (layerSel >= ls.length) layerSel = 0;
    return '<div class="kl-wrap"><div class="row spread"><h3>Layers <small class="muted">' + ls.length + " of " + MAX_LAYERS + ' · tap a layer, then a sound to put on it</small></h3><div class="se-row"><button id="klAdd"' + (ls.length >= MAX_LAYERS ? " disabled" : "") + '>+ Layer</button><button id="klSplit" title="Layer 1 below middle C, layer 2 above">Split at C4</button></div></div><div class="kl-list">' +
      ls.map(function (l, i) {
        return '<div class="kl-row' + (i === layerSel ? " sel" : "") + (l.on === false ? " off" : "") + '" data-kl="' + i + '"><button class="kl-on' + (l.on !== false ? " on" : "") + '" data-klon="' + i + '">' + (i + 1) + '</button><button class="kl-name" data-klsel="' + i + '"><b>' + esc(l.patch ? l.patch.name : "choose a sound") + '</b><small>' + noteName(l.lo == null ? 0 : l.lo) + "–" + noteName(l.hi == null ? 127 : l.hi) + (l.octave ? " · " + (l.octave > 0 ? "+" : "") + l.octave + " oct" : "") + "</small></button>" +
          '<label>Vol<span class="control-line"><input type="range" min="0" max="100" data-klvol="' + i + '" value="' + Math.round((l.volume == null ? 1 : l.volume) * 100) + '"><output>' + Math.round((l.volume == null ? 1 : l.volume) * 100) + '</output></span></label>' +
          '<label>Pan<input type="range" min="-100" max="100" data-klpan="' + i + '" value="' + Math.round((l.pan || 0) * 100) + '"></label>' +
          '<label>Oct<select data-kloct="' + i + '">' + [-2, -1, 0, 1, 2].map(function (o) { return '<option value="' + o + '"' + ((l.octave || 0) === o ? " selected" : "") + ">" + (o > 0 ? "+" : "") + o + "</option>"; }).join("") + "</select></label>" +
          "<label>From" + noteSelect("kllo", i, l.lo == null ? 0 : l.lo) + "</label><label>To" + noteSelect("klhi", i, l.hi == null ? 127 : l.hi) + "</label>" +
          '<label>Vel<span class="kl-vel"><input type="number" min="1" max="127" data-klvlo="' + i + '" value="' + (l.velLo || 1) + '">–<input type="number" min="1" max="127" data-klvhi="' + i + '" value="' + (l.velHi || 127) + '"></span></label>' +
          (ls.length > 1 ? '<button class="danger" data-kldel="' + i + '" title="Remove this layer">✕</button>' : "") + "</div>";
      }).join("") + "</div></div>";
  }
  function keysLive() { keysSoon(); }

  // ---- scenes: what an instrument scene stores and recalls
  function captureRig(full) {
    var c = cfg(), k = kind(), r = { kind: k, levelDb: c.output.level || 0, pedals: chainFor(k).map(function (it) { return { uid: it.uid, on: it.on !== false, mix: it.mix == null ? 1 : it.mix, levelDb: it.levelDb || 0 }; }) };
    if (k === "keys") r.layers = layers(c).map(function (l) { return { id: l.id, on: l.on !== false, volume: l.volume == null ? 1 : l.volume }; });
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
      if (sw) { var it = chain.filter(function (i) { return i.uid === sw.dataset.sw; })[0]; if (it) { it.on = it.on === false; send({ type: "instrument", action: "bypass", uid: it.uid, on: it.on }); PP.persistSoon(); render(); } return; }
      var svg = e.target.closest("svg.pedal"); if (svg) { selected = selected === svg.dataset.uid ? null : svg.dataset.uid; showAdd = false; render(); return; }
      var b = e.target.closest("button"); if (!b) return;
      if (b.dataset.kind) { c.kind = b.dataset.kind; selected = null; showAdd = false; apply("kind"); render(); return; }
      if (b.dataset.move) { var parts = b.dataset.move.split(":"), i = chain.findIndex(function (q) { return q.uid === parts[0]; }), j = i + Number(parts[1]); if (i >= 0 && j >= 0 && j < chain.length) { var tmp = chain[i]; chain[i] = chain[j]; chain[j] = tmp; apply("order"); render(); } return; }
      if (b.dataset.del) { c.chains[k] = chain.filter(function (q) { return q.uid !== b.dataset.del; }); if (selected === b.dataset.del) selected = null; apply("remove"); render(); return; }
      if (b.id === "pbAdd") { showAdd = true; selected = null; render(); var s = $("#pbSearch"); if (s) s.focus(); return; }
      if (b.id === "pbAddClose") { showAdd = false; render(); return; }
      if (b.dataset.cat) { addCat = b.dataset.cat; render(); return; }
      if (b.dataset.kcat) { keysCat = b.dataset.kcat; render(); return; }
      if (b.dataset.add) { var pedal = PED.byId(b.dataset.add); if (pedal) { var item = { uid: uid(), pedal: pedal.id, on: true, values: Object.assign({}, pedal.opts.values || {}) }, ampIdx = chain.findIndex(function (q) { var p = PED.byId(q.pedal); return p && (p.category === "amp" || p.category === "cab"); }); if (ampIdx >= 0 && ["amp", "cab", "reverb", "delay"].indexOf(pedal.category) < 0) chain.splice(ampIdx, 0, item); else chain.push(item); selected = item.uid; showAdd = false; apply("add"); render(); } return; }
      if (b.dataset.reset) { var it2 = chain.filter(function (q) { return q.uid === b.dataset.reset; })[0]; if (it2) { it2.values = {}; apply("reset"); render(); } return; }
      if (b.dataset.sync) { var it3 = chain.filter(function (q) { return q.uid === b.dataset.sync; })[0], p3 = it3 && PED.byId(it3.pedal); if (p3) { var bpm = project().tempo.bpm; if (p3.opts.tempoBpm) it3.values[p3.opts.tempoBpm] = bpm; else if (p3.opts.tempo) { var ctl = controlsOf(p3).filter(function (q) { return q.sym === p3.opts.tempo; })[0], ms = 60000 / bpm * 0.75; it3.values[p3.opts.tempo] = ctl ? clamp(ctl.max > 50 ? ms : ms / 1000, ctl.min, ctl.max) : ms; } apply("sync"); render(); PP.setStatus("Delay set to a dotted eighth at " + Math.round(bpm) + " BPM"); } return; }
      if (b.dataset.patch) { var p = catalog.keys.filter(function (q) { return q.id === b.dataset.patch; })[0]; if (p) { var ls0 = layers(c), lay = ls0[layerSel] || ls0[0]; lay.patch = { id: p.id, file: p.file, bank: p.bank, prog: p.prog, name: p.name }; send({ type: "instrument", action: "keys", keys: hostConfig().keys }); PP.persistSoon(); render(); } return; }
      if (b.id === "klAdd") { var ls1 = layers(c); if (ls1.length < MAX_LAYERS) { ls1.push({ id: uid(), patch: null, on: true, volume: 0.8, pan: 0, octave: 0, lo: 0, hi: 127, velLo: 1, velHi: 127 }); layerSel = ls1.length - 1; keysLive(); render(); PP.setStatus("Layer " + ls1.length + " added: tap a sound for it"); } return; }
      if (b.id === "klSplit") { var ls2 = layers(c); if (ls2.length < 2) ls2.push({ id: uid(), patch: null, on: true, volume: 0.9, pan: 0, octave: 0, lo: 0, hi: 127, velLo: 1, velHi: 127 }); ls2[0].lo = 0; ls2[0].hi = 59; ls2[1].lo = 60; ls2[1].hi = 127; layerSel = 1; keysLive(); render(); PP.setStatus("Split: layer 1 below C4, layer 2 from C4 up"); return; }
      if (b.dataset.klsel != null) { layerSel = Number(b.dataset.klsel); render(); return; }
      if (b.dataset.klon != null) { var l3 = layers(c)[Number(b.dataset.klon)]; if (l3) { l3.on = l3.on === false; keysLive(); render(); } return; }
      if (b.dataset.kldel != null) { var ls4 = layers(c); ls4.splice(Number(b.dataset.kldel), 1); layerSel = 0; keysLive(); render(); return; }
      if (b.dataset.iradd) { addIr(b.dataset.iradd); return; }
      if (b.id === "inAuto") { autoSetup(); return; }
      if (b.id === "inTunerBtn") { toggleTuner(); return; }
      if (b.id === "keysAdd") { addSounds(); return; }
    });
    root.addEventListener("input", function (e) {
      var el = e.target, c = cfg(), k = kind(), out = el.parentNode && el.parentNode.querySelector("output");
      if (el.dataset.ctl) { var parts = el.dataset.ctl.split("|"), item = chainFor(k).filter(function (q) { return q.uid === parts[0]; })[0], pedal = item && PED.byId(item.pedal); if (!pedal) return; var ctl = controlsOf(pedal).filter(function (q) { return q.sym === parts[1]; })[0]; if (!ctl) return; var v = el.type === "checkbox" ? (el.checked ? 1 : 0) : el.tagName === "SELECT" ? Number(el.value) : denorm(ctl, Number(el.value) / 1000); item.values[ctl.sym] = v; if (out) out.textContent = fmt(ctl, v); send({ type: "instrument", action: "set", uid: item.uid, sym: ctl.sym, value: v }); PP.persistSoon(); var svg = root.querySelector('svg.pedal[data-uid="' + item.uid + '"]'); if (svg) svg.outerHTML = pedalSvg(item, pedal, chainFor(k).indexOf(item), true); return; }
      if (el.id === "inGain") { c.input.gain = Number(el.value); if (out) out.textContent = el.value + " dB"; inputSoon(); }
      else if (el.id === "inGate") { c.input.gate = Number(el.value); if (out) out.textContent = el.value + " dB"; inputSoon(); }
      else if (el.id === "inOut") { c.output.level = Number(el.value); if (out) out.textContent = el.value + " dB"; send({ type: "instrument", action: "level", levelDb: c.output.level }); PP.persistSoon(); }
      else if (el.id === "inTranspose") { c.keys.transpose = Number(el.value); if (out) out.textContent = el.value; keysSoon(); }
      else if (el.dataset.pmix || el.dataset.plevel) { var pu = el.dataset.pmix || el.dataset.plevel, pit = chainFor(k).filter(function (q) { return q.uid === pu; })[0]; if (!pit) return; if (el.dataset.pmix) { pit.mix = Number(el.value) / 100; if (out) out.textContent = el.value + "%"; } else { pit.levelDb = Number(el.value); if (out) out.textContent = el.value + " dB"; } send({ type: "instrument", action: "pedalmix", uid: pit.uid, mix: pit.mix == null ? 1 : pit.mix, levelDb: pit.levelDb || 0 }); PP.persistSoon(); }
      else if (el.dataset.klvol != null) { var lv = layers(c)[Number(el.dataset.klvol)]; if (lv) { lv.volume = Number(el.value) / 100; if (out) out.textContent = el.value; keysLive(); } }
      else if (el.dataset.klpan != null) { var lp = layers(c)[Number(el.dataset.klpan)]; if (lp) { lp.pan = Number(el.value) / 100; keysLive(); } }
      else if (el.id === "keysVolume") { c.keys.volume = Number(el.value) / 100; if (out) out.textContent = el.value; keysSoon(); }
      else if (el.id === "pbSearch") { addQuery = el.value; var list = $(".pb-list"); if (list) { var d = document.createElement("div"); d.innerHTML = addPanel(); list.outerHTML = d.querySelector(".pb-list").outerHTML; } }
      else if (el.id === "keysSearch") { keysQuery = el.value; var kl = $(".keys-list"); if (kl) { var d2 = document.createElement("div"); d2.innerHTML = keysPanel(c); kl.outerHTML = d2.querySelector(".keys-list").outerHTML; } }
    });
    root.addEventListener("change", function (e) {
      var el = e.target, c = cfg(), k = kind();
      if (el.id === "inBoard") { if (el.value === "__custom") { PP.ask("Name for this board", { value: "My " + (k === "keys" ? "keys" : "board"), ok: "Save board" }).then(function (name) { if (name) { var id = "custom-" + uid(); c.custom.push({ id: id, name: name, kind: k, chain: chainFor(k).map(function (it) { return [it.pedal, Object.assign({}, it.values)]; }) }); c.boards[k] = id; PP.persistSoon(); } render(); }); return; } loadBoard(k, el.value); selected = null; apply("board"); render(); }
      else if (el.id === "inInput") { c.input.device = el.value; var inp = catalog.inputs.filter(function (i) { return i.id === el.value; })[0]; c.input.deviceId = inp ? inp.browserId : null; stopMeter(); apply("input"); render(); }
      else if (el.id === "inChannel") { c.input.channel = el.value; apply("input"); }
      else if (el.id === "inMidi") { c.keys.midi = el.value; keysSoon(); }
      else if (el.id === "inVel") { c.keys.velocity = el.value; keysSoon(); }
      else if (el.id === "keysSustain") { c.keys.sustain = el.checked; keysSoon(); }
      else if (el.dataset.on) { var it = chainFor(k).filter(function (q) { return q.uid === el.dataset.on; })[0]; if (it) { it.on = el.checked; send({ type: "instrument", action: "bypass", uid: it.uid, on: it.on }); PP.persistSoon(); render(); } }
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
      var before = JSON.stringify([status.running, status.error, status.kind, (status.inputs || []).length, (status.keysCatalog || []).length, !!status.plugins]);
      status = m;
      if (m.plugins) catalog.plugins = m.plugins;
      catalog.inputs = (m.inputs || []).map(function (i) { return { id: i.name, name: (i.desc || i.name) + (i.channels ? " · " + i.channels + " in" : "") }; });
      catalog.midi = m.midiInputs || []; catalog.keys = flattenKeys(m.keysCatalog || []); catalog.ready = true;
      if (pendingPatchFile) { var np = catalog.keys.filter(function (p) { return p.file === pendingPatchFile; })[0]; if (np) { pendingPatchFile = null; var cc = cfg(); cc.keys.patch = { id: np.id, file: np.file, bank: np.bank, prog: np.prog, name: np.name }; keysQuery = ""; keysCat = "all"; if (kind() === "keys") send({ type: "instrument", action: "keys", keys: hostConfig().keys }); PP.persistSoon(); } }
      var s = $(".in-status"); if (s) s.innerHTML = statusLine();
      if (onTab() && before !== JSON.stringify([m.running, m.error, m.kind, (m.inputs || []).length, (m.keysCatalog || []).length, !!m.plugins])) render();
    });
    F.on("hello", function () { send({ type: "instrument", action: "status" }); setTimeout(function () { if (kind() !== "off") apply("connect"); }, 600); });
  }
  function show() { send({ type: "instrument", action: "status" }); render(); }
  function hide() { if (tunerOn) toggleTuner(false); stopMeter(); }
  // ---- control-surface actions (Configure tab)
  function togglePedal(index) { var it = chainFor(kind())[index]; if (!it) return false; it.on = it.on === false; send({ type: "instrument", action: "bypass", uid: it.uid, on: it.on }); PP.persistSoon(); if (onTab()) render(); return true; }
  function pedalOn(index) { var it = chainFor(kind())[index]; return it ? it.on !== false : false; }
  function stepBoard(delta) { var c = cfg(), k = kind(); if (k === "off") return; var boards = allBoards().filter(function (b) { return b.kind === k; }); if (!boards.length) return; var i = boards.findIndex(function (b) { return b.id === c.boards[k]; }), j = (i + delta + boards.length) % boards.length; loadBoard(k, boards[j].id); selected = null; apply("board"); PP.setStatus("Board: " + boards[j].name); if (onTab()) render(); }
  // Keys sounds from a USB stick / SD card: an .sf2 file is copied into the Pi's sound folder, a folder of WAVs
  // named by note is turned into a SoundFont by the Pi. Either way the sound list refreshes and the new sound is picked.
  function addSounds() {
    if (!connected()) { PP.setStatus("Adding sounds works on the Central Control itself (or send an .sf2 to it over Wi-Fi)."); return; }
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
    if (!connected()) { PP.setStatus("Adding IRs works on the Central Control itself."); return; }
    var F2 = window.PPFeatures; if (!F2 || !F2.openUsb) return;
    F2.openUsb(async function (picked) {
      var last = null;
      for (var i = 0; i < (picked.files || []).length; i++) {
        try { var r = await fetch("http://127.0.0.1:8766/instrument/ir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: picked.files[i] }) }), j = await r.json(); if (r.ok && j.file) last = j.file; else PP.setStatus("Could not add: " + (j.error || r.status)); } catch (err) { PP.setStatus("Could not add the IR: " + (err && err.message)); }
      }
      if (last) { var it = chainFor(kind()).filter(function (q) { return q.uid === itemUid; })[0]; if (it) { it.file = last; apply("ir"); } send({ type: "instrument", action: "status" }); PP.setStatus("IR added"); }
    }, { kind: "ir" });
  }
  function stepPatch(delta) { var c = cfg(); if (!catalog.keys.length) return; var i = c.keys.patch ? catalog.keys.findIndex(function (p) { return p.id === c.keys.patch.id; }) : -1, j = (i + delta + catalog.keys.length) % catalog.keys.length, p = catalog.keys[j]; c.keys.patch = { id: p.id, file: p.file, bank: p.bank, prog: p.prog, name: p.name }; send({ type: "instrument", action: "keys", keys: hostConfig().keys }); PP.persistSoon(); PP.setStatus("Sound: " + p.name); if (onTab()) render(); }
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
      if (e.target.id === "tnMute") { cfg().tunerMute = e.target.checked; PP.persistSoon(); if (tunerOn) send({ type: "instrument", action: "level", levelDb: e.target.checked ? -120 : (cfg().output.level || 0) }); el.querySelector("small").textContent = e.target.checked ? "TUNER · instrument muted" : "TUNER · instrument still playing"; }
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
  }
  // the 3.5" screen shows the tuner too while it is up (a few times a second)
  var miniAt = 0;
  function miniTuner(note, cents) { var now = performance.now(); if (now - miniAt < 200) return; miniAt = now; send({ type: "tunerView", on: tunerOn, note: note || "–", cents: note ? cents : null }); }
  // the tuner lives on the Instrument tab: a footswitch brings that tab up; leaving the tab turns the tuner off
  function toggleTuner(force) {
    var want = typeof force === "boolean" ? force : !tunerOn; if (want === tunerOn) return tunerOn;
    if (want && window.PPShell && window.PPShell.currentTab() !== "instrument") window.PPShell.showTab("instrument");
    tunerOn = want;
    if (cfg().tunerMute !== false || !tunerOn) send({ type: "instrument", action: "level", levelDb: tunerOn ? -120 : (cfg().output.level || 0) });
    var box = tunerBox(); box.classList.toggle("on", tunerOn); tunerSmooth = null;
    box.querySelector("small").textContent = cfg().tunerMute !== false ? "TUNER · instrument muted" : "TUNER · instrument still playing";
    miniAt = 0; send({ type: "tunerView", on: tunerOn, note: "–", cents: null });
    if (tunerOn) startMeter(); else if (!onTab()) stopMeter();
    if (onTab()) render(); if (window.PPActions) window.PPActions.sendLeds(); return tunerOn;
  }
  wire();
  function pedalNames() { return chainFor(kind()).map(function (it, i) { var p = PED.byId(it.pedal); return { index: i, name: p ? p.name : it.pedal, on: it.on !== false }; }); }
  function state() { var c = cfg(); return { kind: c.kind, tuner: tunerOn, board: c.boards[c.kind], patch: c.keys.patch, get levelDb() { return c.output.level || 0; }, set levelDb(v) { c.output.level = v; if (onTab()) { var el = $("#inOut"); if (el) { el.value = v; var o = el.parentNode.querySelector("output"); if (o) o.textContent = v + " dB"; } } } }; }
  function setKind(k) { var c = cfg(); c.kind = k; selected = null; apply("kind"); PP.setStatus("Instrument: " + (KINDS.filter(function (q) { return q[0] === k; })[0] || ["", k])[1]); if (onTab()) render(); }
  window.PPInstrument = { show: show, hide: hide, render: render, config: cfg, kind: kind, state: state, setKind: setKind, autoSetup: autoSetup, togglePedal: togglePedal, pedalOn: pedalOn, pedalNames: pedalNames, stepBoard: stepBoard, stepPatch: stepPatch, stepKind: stepKind, expression: expression, toggleTuner: toggleTuner, tunerToggle: toggleTuner, tunerOn: function () { return tunerOn; }, apply: apply, hostConfig: hostConfig, catalog: function () { return catalog; }, chain: chainFor, resolvedChain: resolvedChain, controlsOf: controlsOf, captureRig: captureRig, applyRig: applyRig, layers: layers, maxLayers: MAX_LAYERS, status: function () { return status; } };
})();
