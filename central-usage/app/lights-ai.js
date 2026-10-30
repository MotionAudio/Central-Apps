/* Central Control - "Tell it the show": plain words -> light cues on the song's timeline.
 *   "dimmers blue 20% red and shimmers 30% blue for the verse, then chorus full white, strobes on the hits"
 * Built-in engine (no internet, no model): finds the sections, the lights / groups, colours, levels,
 * effects, speeds, fades and "on the hits", and builds presets + cues from them.
 * A small local AI model (Settings) can turn freer sentences into the same steps; the engine checks them.
 *   CULightsAI.parse(text, ctx) -> { steps, notes }      steps: [{ section, targets: [...], hits, fade }]
 *   CULightsAI.build(steps, ctx) -> { looks, cues, notes, summary }
 *   CULightsAI.systemPrompt(ctx), CULightsAI.fromModel(json, ctx) -> steps */
(function (root) {
  "use strict";
  var COLORS = {
    red: "#ff1a0a", crimson: "#d10a2a", orange: "#ff7a00", amber: "#ff9a00", gold: "#ffb000", yellow: "#ffe100", lime: "#a8ff00", green: "#00e050", teal: "#00c8a0", cyan: "#00d8ff", aqua: "#00e8ff",
    blue: "#1f4dff", "deep blue": "#0a1fb0", "dark blue": "#0a1fb0", navy: "#06138a", "light blue": "#7ab8ff", "sky blue": "#5cc8ff", "ice blue": "#a8e4ff", indigo: "#3a1fff", purple: "#7a2bff", violet: "#9a2bff", lavender: "#b48cff", magenta: "#ff1ad8", pink: "#ff5fa8", "hot pink": "#ff1a8c", rose: "#ff4f7a",
    white: "#ffffff", "warm white": "#ffc78a", "cool white": "#e6f0ff", warm: "#ffb36b", cold: "#d8e8ff", uv: "#5a00ff"
  };
  var COLOR_WORDS = Object.keys(COLORS).sort(function (a, b) { return b.length - a.length; });
  var GROUP_WORDS = [["front", /^(front|fronts|key|keys|face|faces|stage ?wash|frontlight|front ?lights?)$/], ["back", /^(back|backs|backlight|backlights|back ?lights?|wash|washes|pars?|cans?|colou?r ?lights?|uplights?|dimmers?|bars?|light ?bars?|led ?bars?|battens?|strips?|pixel ?bars?)$/], ["beam", /^(beams?|movers?|moving ?heads?|moving ?lights?|heads?|spots?|spotlights?)$/], ["house", /^(house|houselights?|house ?lights?|audience|crowd|room)$/], ["fx", /^(strobes?|blinders?|fx|effects?)$/], ["haze", /^(haze|hazer|fog|fogger|smoke)$/]];
  var EFFECTS = [["strobe", /^strob(e|es|ing)$/], ["pulse", /^puls(e|es|ing)$/], ["chase", /^chas(e|es|ing)$/], ["sweep", /^sweep(s|ing)?$/], ["circle", /^circl(e|es|ing)$/], ["breathe", /^(breath(e|es|ing)?|slow ?fade|fading)$/], ["rainbow", /^rainbow$/], ["flicker", /^(flicker(s|ing)?|candle)$/], ["flash", /^flash(es|ing)?$/], ["alternate", /^(alternat(e|es|ing)|odd ?even)$/], ["wipe", /^(wipe|wipes|wiping|fill|filling)$/], ["bounce", /^(bounce|bouncing|knight ?rider|scanner)$/], ["sparkle", /^(sparkle|sparkles|sparkling|twinkle|twinkling|glitter)$/], ["figure8", /^(figure ?8|figure ?eight)$/], ["ballyhoo", /^ballyhoo$/], ["panwave", /^(pan ?wave|wave)$/], ["none", /^(still|steady|static|solid)$/]];
  var SECTION_RE = /\b(intro|verse|pre[- ]?chorus|chorus|bridge|tag|vamp|outro|ending|instrumental|interlude|breakdown|build|turnaround|refrain|whole song|all song|everything|all sections|start|end)(?:\s*(\d+))?\b/g;
  function norm(s) { return String(s || "").toLowerCase().replace(/[’']/g, "").replace(/\s+/g, " ").trim(); }
  function typeOfSection(name) { var n = norm(name); if (/pre ?chorus|build|lift/.test(n)) return "prechorus"; if (/chorus|refrain/.test(n)) return "chorus"; if (/verse/.test(n)) return "verse"; if (/bridge/.test(n)) return "bridge"; if (/tag|vamp/.test(n)) return "tag"; if (/intro|count/.test(n)) return "intro"; if (/outro|ending|end|coda/.test(n)) return "outro"; if (/instrumental|interlude|turn ?around|solo/.test(n)) return "instrumental"; if (/breakdown|quiet/.test(n)) return "breakdown"; return "other"; }
  function sectionKey(word) { var n = norm(word); if (/whole song|all song|everything|all sections|start/.test(n)) return "all"; if (n === "end") return "outro"; return typeOfSection(n); }

  // ---- words -> steps
  function parse(text, ctx) {
    var t = " " + norm(text).replace(/,/g, " , ").replace(/[;.!\n]+/g, " ; ") + " ", notes = [];
    // where are the sections mentioned
    var marks = [], m; SECTION_RE.lastIndex = 0;
    while ((m = SECTION_RE.exec(t))) { var before = t.slice(Math.max(0, m.index - 12), m.index); marks.push({ at: m.index, end: m.index + m[0].length, key: sectionKey(m[1]), num: m[2] ? Number(m[2]) : null, label: m[0].trim(), forward: /\b(for|in|during|on|over|through)( the)?\s*$/.test(before) }); }
    var chunks = [];
    if (!marks.length) chunks.push({ key: "all", num: null, text: t });
    else {
      var cursor = 0;
      marks.forEach(function (mk, i) {
        var next = marks[i + 1] ? marks[i + 1].at : t.length;
        if (mk.forward) { chunks.push({ key: mk.key, num: mk.num, label: mk.label, text: t.slice(cursor, mk.at) }); cursor = mk.end; }
        else { chunks.push({ key: mk.key, num: mk.num, label: mk.label, text: t.slice(mk.end, next) }); cursor = next; }
      });
      if (cursor < t.length && t.slice(cursor).replace(/[\s;,]|then|and/g, "")) { var last = chunks[chunks.length - 1]; last.text += " " + t.slice(cursor); }
    }
    var steps = [];
    chunks.forEach(function (ch) {
      var s = phrase(ch.text, ctx, notes); if (!s) return;
      s.section = ch.key; s.num = ch.num; s.label = ch.label || "the whole song"; steps.push(s);
    });
    return { steps: steps, notes: notes };
  }
  function findTarget(words, i, ctx) {   // a light (by name) or a group, 1-3 words starting at i -> { kind, id | group, n }
    for (var n = 3; n >= 1; n--) {
      if (i + n > words.length) continue;
      var w = words.slice(i, i + n).join(" "), single = w.replace(/s$/, "");
      var fx = (ctx.fixtures || []).filter(function (f) { var nm = norm(f.name); return nm === w || nm === single; });   // a light by its own name ("back 2")
      if (fx.length) return { kind: "fixtures", ids: fx.map(function (f) { return f.id; }), name: w, n: n };
      var gl = (ctx.groups || []).filter(function (g) { var lab = norm(g[1]); return lab === w || lab.split(/\s*\/\s*/).indexOf(w) >= 0 || lab.split(/\s*\/\s*/).indexOf(single) >= 0; })[0];
      if (gl) return { kind: "group", group: gl[0], name: w, n: n };
      if (n === 1 || n === 2) for (var k = 0; k < GROUP_WORDS.length; k++) if (GROUP_WORDS[k][1].test(w)) return { kind: "group", group: GROUP_WORDS[k][0], name: w, n: n };
      if (n === 1 && /^(all|everything|everyone|lights|rig)$/.test(w)) return { kind: "all", name: w, n: 1 };
      var fb = (ctx.fixtures || []).filter(function (f) { var base = norm(f.name).replace(/\s*\d+$/, ""); return base === w || base === single; });   // "shimmers" -> Shimmer 1, Shimmer 2
      if (fb.length) return { kind: "fixtures", ids: fb.map(function (f) { return f.id; }), name: w, n: n };
      if (n === 1 && single.length > 3) {   // by type: "shimmers" -> the fixtures whose type has "Shimmer" in it
        var byType = (ctx.fixtures || []).filter(function (f) { return norm(f.profileName).split(/[^a-z0-9]+/).indexOf(single) >= 0; });
        if (byType.length) return { kind: "fixtures", ids: byType.map(function (f) { return f.id; }), name: w, n: 1 };
      }
    }
    return null;
  }
  function phrase(text, ctx, notes) {
    var words = text.replace(/%/g, " % ").split(" ").filter(Boolean), targets = [], cur = null, hits = null, fade = null, any = false, mode = "set";
    function target(tg) { cur = { target: tg, colors: [], level: null, effect: null, speed: null, position: null }; targets.push(cur); }
    function needCur() { if (!cur) target({ kind: "all", name: "everything" }); return cur; }
    for (var i = 0; i < words.length; i++) {
      var w = words[i], two = w + " " + (words[i + 1] || ""), three = two + " " + (words[i + 2] || "");
      if (w === "then" || w === ";" ) { cur = null; continue; }
      if (w === "," || w === "and" || w === "with" || w === "the" || w === "a" || w === "to" || w === "at" || w === "in" || w === "set" || w === "go" || w === "make" || w === "of" || w === "lights" && cur) continue;
      // on the hits
      if (/^(on|at)$/.test(w) && /^(the )?(hits?|accents?|stabs?|big hits?)$/.test(words.slice(i + 1, i + 3).join(" ")) || /^hits?$/.test(w)) {
        hits = hits || { targets: [] };
        var moved = targets.splice(targets.indexOf(cur) >= 0 ? targets.indexOf(cur) : targets.length, 1); if (cur && moved.length) hits.targets.push(cur);
        cur = null; i += /^(on|at)$/.test(w) ? (words[i + 1] === "the" ? 2 : 1) : 0; any = true; continue;
      }
      // fade
      var fm = /^(fade|fading|over)$/.test(w) ? three.match(/^(?:fade|fading|over)(?: in)?(?: over)? (\d+(?:\.\d+)?) ?(beats?|bars?|seconds?|secs?|s)?/) : null;
      if (fm) { var amt = Number(fm[1]), unit = fm[2] || "beats"; fade = /bar/.test(unit) ? amt * (ctx.bpb || 4) : /^s|sec/.test(unit) ? amt * (ctx.bpm || 100) / 60 : amt; i += fm[0].split(" ").length - 1; any = true; continue; }
      if (/^(snap|instantly|instant|cut)$/.test(w)) { fade = 0; any = true; continue; }
      // a light or a group
      var tg = findTarget(words, i, ctx);
      if (tg) { target(tg); i += tg.n - 1; any = true; continue; }
      // colour (longest names first: "deep blue", "warm white")
      var col = null; for (var c = 0; c < COLOR_WORDS.length; c++) { var cw = COLOR_WORDS[c], len = cw.split(" ").length, cand = words.slice(i, i + len).join(" "); if (cand === cw) { col = cw; i += len - 1; break; } }
      if (col) { needCur().colors.push(COLORS[col]); any = true; continue; }
      // level: 30% / 30 percent / full / half / dim / off
      if (/^\d+(\.\d+)?$/.test(w) && (words[i + 1] === "%" || words[i + 1] === "percent")) { needCur().level = Math.max(0, Math.min(1, Number(w) / 100)); i++; any = true; continue; }
      var lv = { full: 1, max: 1, bright: 0.85, brighter: 0.9, half: 0.5, medium: 0.5, mid: 0.5, low: 0.25, dim: 0.25, dimmed: 0.25, soft: 0.35, off: 0, out: 0, dark: 0, blackout: 0 }[w];
      if (lv != null) { needCur().level = lv; any = true; continue; }
      // effect + speed
      var ef = null; for (var e = 0; e < EFFECTS.length; e++) if (EFFECTS[e][1].test(w) || EFFECTS[e][1].test(two.replace(" ", ""))) { ef = EFFECTS[e][0]; break; }
      if (ef) { needCur().effect = ef; any = true; continue; }
      if (/^(fast|quick|faster)$/.test(w)) { needCur().speed = 0.5; continue; }
      if (/^(slow|slowly|slower|gentle|gently)$/.test(w)) { needCur().speed = 4; continue; }
      var ev = three.match(/^every (\d+ )?(beats?|bars?|half beats?)/); if (ev) { var nn = Number(ev[1] || 1); needCur().speed = /bar/.test(ev[2]) ? nn * (ctx.bpb || 4) : /half/.test(ev[2]) ? 0.5 : nn; i += ev[0].split(" ").length - 1; continue; }
      // movers' position
      var pos = { up: [0.5, 0.02], ceiling: [0.5, 0.02], sky: [0.5, 0.02], audience: [0.5, 0.78], crowd: [0.5, 0.78], stage: [0.5, 0.25], down: [0.5, 0.97], floor: [0.5, 0.97], home: [0.5, 0.5], center: [0.5, 0.5], centre: [0.5, 0.5] }[w];
      if (pos && cur && (cur.target.kind === "group" && cur.target.group === "beam" || cur.target.kind === "fixtures")) { cur.position = pos; continue; }
      if (/^(cross|crossed)$/.test(w) && cur) { cur.position = [0.5, 0.6, "cross"]; continue; }
      if (/^(fan|fanned|spread)$/.test(w) && cur) { cur.position = [0.5, 0.55, "fan"]; continue; }
      if (w.length > 3 && !/^(for|then|from|into|onto|during|while|when|over|through|song|part|section|lights?|this|that|them|their|very|really|nice|some|more|less|like|look|looks|make|feel|color|colour)$/.test(w)) { if (notes.indexOf(w) < 0 && notes.length < 6) notes.push(w); }
    }
    if (!any) return null;
    return { targets: targets, hits: hits, fade: fade };
  }

  // ---- steps -> presets + cues
  function G(dim, color, o) { var g = { dim: dim, color: color || "#ffffff", w: 0, a: 0, uv: 0, strobe: 0, fx: "none", speed: 1, size: 0.6, pan: 0.5, tilt: 0.5 }; for (var k in o || {}) g[k] = o[k]; return g; }
  function groupState(t, base) {
    var col = t.colors[0] || (base && base.color) || "#ffffff", g = G(t.level != null ? t.level : base ? base.dim : 1, col);
    if (/^#ffffff$/i.test(col)) g.w = Math.min(1, g.dim);
    if (t.colors.length > 1) { g.fx = "alternate"; g.color2 = t.colors[1]; g.size = 0.9; }
    if (t.effect) { if (t.effect === "strobe") { g.strobe = 0.8; } else g.fx = t.effect; }
    if (t.speed) g.speed = t.speed;
    if (t.position) { g.pan = t.position[0]; g.tilt = t.position[1]; if (t.position[2] === "fan") g.fan = 0.5; if (t.position[2] === "cross") g.fan = -0.6; }
    return g;
  }
  function uid() { return Math.random().toString(36).slice(2, 9); }
  function build(steps, ctx) {
    var looks = [], cues = [], notes = [], secs = ctx.sections || [], groupsPresent = (ctx.groups || []).map(function (g) { return g[0]; }), used = {};
    function instances(step) {
      if (step.section === "all") return [{ bar: 1, start: 0, end: ctx.duration || 1e9, name: "Start" }];
      var list = secs.filter(function (s) { return (s.type || typeOfSection(s.name)) === step.section; });
      if (step.num != null) { var nth = list[step.num - 1]; list = nth ? [nth] : []; }
      return list;
    }
    steps.forEach(function (step) {
      var where = instances(step);
      if (!where.length) { notes.push("No " + step.label + " in this song" + (secs.length ? "" : " (it has no sections yet)") + "."); return; }
      var g = {}, fixtures = {}, label = step.label.replace(/^the /, "");
      (step.targets || []).forEach(function (t) {
        var st = groupState(t);
        if (t.target.kind === "all") groupsPresent.forEach(function (k) { if (k !== "haze" && k !== "house" && k !== "fx") g[k] = groupState(t); });
        else if (t.target.kind === "group") g[t.target.group] = st;
        else if (t.target.kind === "fixtures") t.target.ids.forEach(function (id) { fixtures[id] = { color: st.color, dim: st.dim, fx: st.fx, strobe: st.strobe }; });
      });
      var lookId = null;
      if (Object.keys(g).length) {
        var swatch = (step.targets[0] && step.targets[0].colors[0]) || "#88aaff", name = "Said: " + label.charAt(0).toUpperCase() + label.slice(1), n = 2; while (used[name]) name = "Said: " + label + " " + n++; used[name] = 1;
        var look = { id: "said-" + uid(), name: name, swatch: swatch, g: g, said: true }; looks.push(look); lookId = look.id;
      }
      var hl = null;
      if (step.hits && step.hits.targets) {
        var hg = {};
        step.hits.targets.forEach(function (t) { var st = groupState(t, { color: "#ffffff", dim: 1 }); if (t.target.kind === "group") hg[t.target.group] = st; else if (t.target.kind === "all") groupsPresent.forEach(function (k) { if (k !== "haze" && k !== "house") hg[k] = st; }); });
        if (!Object.keys(hg).length) hg = { fx: G(1, "#ffffff", { w: 1, strobe: 0.8 }), beam: G(1, "#ffffff", { w: 1 }) };
        hl = { id: "said-hit-" + uid(), name: "Said: hit (" + label + ")", swatch: "#ffffff", flash: true, g: hg, said: true }; looks.push(hl);
      }
      var hitCount = 0;
      where.forEach(function (s) {
        var bar = s.bar || (ctx.barBeatAt ? ctx.barBeatAt(s.start).bar : 1), fade = step.fade != null ? step.fade : 2;
        if (lookId) cues.push({ id: uid(), bar: Math.round(bar), beat: 1, look: lookId, fade: fade, kind: "look", label: s.name, said: true });
        if (Object.keys(fixtures).length) cues.push({ id: uid(), bar: Math.round(bar), beat: 1, kind: "fixture", fixtures: fixtures, fade: fade, label: s.name, said: true });
        if (hl) {
          var hitsIn = (ctx.hits || []).filter(function (h) { return h >= s.start - 0.05 && h < (s.end || 1e9); }); hitCount += hitsIn.length;
          hitsIn.forEach(function (h) { var bb = ctx.barBeatAt ? ctx.barBeatAt(h) : { bar: 1, beat: 1 }; cues.push({ id: uid(), bar: bb.bar, beat: Math.max(1, Math.round(bb.beat * 2) / 2), look: hl.id, kind: "flash", dur: 0.5, label: "Hit", said: true }); });
        }
      });
      if (hl && !hitCount) notes.push("The " + label + " has no hits detected (they come from the Central Pedal's analysis of the tracks).");
    });
    return { looks: looks, cues: cues, notes: notes, summary: steps.length ? steps.map(function (s) { return (s.label || s.section) + ": " + (s.targets || []).map(function (t) { return t.target.name + (t.colors.length ? " " + t.colors.length + " colour" + (t.colors.length > 1 ? "s" : "") : "") + (t.level != null ? " " + Math.round(t.level * 100) + "%" : "") + (t.effect ? " " + t.effect : ""); }).join(", ") + (s.hits ? " + hits" : ""); }).join(" · ") : "" };
  }
  // ---- the optional model: it answers with the same steps as JSON
  function systemPrompt(ctx) {
    return "You turn a church lighting operator's sentence into JSON steps for a lighting controller. Reply with JSON only: {\"steps\":[{\"section\":\"intro|verse|prechorus|chorus|bridge|tag|instrumental|breakdown|outro|all\",\"num\":null,\"targets\":[{\"target\":\"<a group: front (faces), back (washes), beam (movers), house, fx (strobes), haze, all - or a light name>\",\"colors\":[\"<a colour name: red, blue, amber, white, warm white...>\"],\"level\":0.0-1.0,\"effect\":\"none|pulse|chase|alternate|breathe|rainbow|wipe|bounce|sparkle|sweep|circle|figure8|flicker|flash|strobe\",\"speed\":beats}],\"hits\":{\"targets\":[same as targets]} or null,\"fade\":beats or null}]}. " +
      "Lights in the rig: " + (ctx.fixtures || []).map(function (f) { return f.name + " (" + f.group + ")"; }).join(", ") + ". Sections in the song: " + (ctx.sections || []).map(function (s) { return s.name; }).join(", ") + ".";
  }
  // (10.0) the shape of an answer, as a JSON schema: the AI helper's server turns it into a grammar, so even a small
  // model answers with these steps and these names (the groups, this rig's lights, the sections, the effects)
  var SECTIONS = ["intro", "verse", "prechorus", "chorus", "bridge", "tag", "instrumental", "breakdown", "outro", "all"];
  var FX_NAMES = ["none", "pulse", "chase", "alternate", "breathe", "rainbow", "wipe", "bounce", "sparkle", "sweep", "circle", "figure8", "flicker", "flash", "strobe"];
  function jsonSchema(ctx) {
    var names = ["front", "back", "beam", "house", "fx", "haze", "all"];
    (ctx.fixtures || []).forEach(function (f) { var n = norm(f.name); if (n && names.indexOf(n) < 0) names.push(n); });
    var target = { type: "object", properties: { target: { type: "string", enum: names.slice(0, 80) }, colors: { type: "array", items: { type: "string", enum: Object.keys(COLORS) }, maxItems: 2 },
      level: { type: "number", minimum: 0, maximum: 1 }, effect: { type: "string", enum: FX_NAMES }, speed: { type: "number", minimum: 0.25, maximum: 16 } }, required: ["target", "colors", "level", "effect"], additionalProperties: false };
    return { type: "object", properties: { steps: { type: "array", minItems: 1, maxItems: 8, items: { type: "object", properties: {
      section: { type: "string", enum: SECTIONS }, num: { type: ["integer", "null"] }, targets: { type: "array", minItems: 1, maxItems: 4, items: target },
      hits: { type: ["object", "null"], properties: { targets: { type: "array", items: target, maxItems: 3 } }, required: ["targets"], additionalProperties: false }, fade: { type: ["number", "null"] } },
      required: ["section", "targets"], additionalProperties: false } } }, required: ["steps"], additionalProperties: false };
  }
  // a colour the model gave: #rrggbb, or one of the names it was offered
  function colorOf(c) { if (/^#[0-9a-f]{6}$/i.test(c)) return c; var n = norm(c); return COLORS[n] || null; }
  function fromModel(json, ctx) {   // validate what the model said
    var steps = []; if (!json || !Array.isArray(json.steps)) return null;
    json.steps.slice(0, 20).forEach(function (s) {
      var sec = ["intro", "verse", "prechorus", "chorus", "bridge", "tag", "instrumental", "breakdown", "outro", "all"].indexOf(s.section) >= 0 ? s.section : null; if (!sec) return;
      function tgs(list) { return (Array.isArray(list) ? list : []).slice(0, 12).map(function (t) { var tg = findTarget(norm(t.target || "").split(" "), 0, ctx) || (/^all$/.test(t.target) ? { kind: "all", name: "all" } : null); if (!tg) return null; return { target: tg, colors: (t.colors || []).map(colorOf).filter(Boolean).slice(0, 2), level: typeof t.level === "number" && !(t.level <= 0 && (t.colors || []).length) ? Math.max(0, Math.min(1, t.level)) : null, effect: EFFECTS.some(function (e) { return e[0] === t.effect; }) || t.effect === "strobe" ? t.effect : null, speed: typeof t.speed === "number" ? Math.max(0.25, Math.min(16, t.speed)) : null, position: null }; }).filter(Boolean); }
      steps.push({ section: sec, num: typeof s.num === "number" ? s.num : null, label: sec === "all" ? "the whole song" : sec + (s.num ? " " + s.num : ""), targets: tgs(s.targets), hits: s.hits && s.hits.targets ? { targets: tgs(s.hits.targets) } : null, fade: typeof s.fade === "number" ? Math.max(0, Math.min(64, s.fade)) : null });
    });
    return steps.length ? steps : null;
  }
  root.CULightsAI = { parse: parse, build: build, systemPrompt: systemPrompt, jsonSchema: jsonSchema, fromModel: fromModel, COLORS: COLORS, typeOfSection: typeOfSection };
})(typeof window !== "undefined" ? window : this);
