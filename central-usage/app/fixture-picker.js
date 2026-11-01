/* Central Control - real lights on the Fixtures page (10.2):
 *   "Find a real light…"  search thousands of lights by maker and model (fixture-catalog.js), pick the mode, the DMX
 *                         universe and address, and add them; the lighting engine then drives each channel the way
 *                         that light needs (fixture-map.js)
 *   "Make a profile…"     a light that isn't in the library: list its channels in order and pick each one's job, with
 *                         the values that matter (shutter open, strobe slow → fast, the colour wheel's slots). Try it on
 *                         a light, save it (the church's other computers get it with the rig), export / import it as an
 *                         Open Fixture Library file, or share it on the website
 *   ⚙ on each light       what that light is: name, profile, group and its own groups, movable or not, pan / tilt
 *                         limits, upside down, max intensity, dimmer curve, colour calibration, whether the auto
 *                         lights and the AI may use it (lights-programmer.js applies them)
 *   Central Utility looks  the lighting looks of the Central Utility library, added to your presets
 * Everything lives in the rig (rig.library, rig.fixtures, rig.looks), which the church's main admin computers share. */
(function (global) {
  "use strict";
  var L = function () { return global.CULights; }, C = function () { return global.CUFixtureCatalog; };
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }
  var GROUP_NAME = { front: "Front / key", back: "Back / colour", beam: "Beams / movers", house: "House / audience", fx: "Strobes / blinders", haze: "Haze / fog" };
  function modal(id, cls) {
    var el = document.getElementById(id);
    if (!el) { el = document.createElement("div"); el.id = id; el.className = "fp-modal " + (cls || ""); el.hidden = true; document.body.appendChild(el); el.addEventListener("click", function (e) { if (e.target === el) closeModal(el); }); }
    return el;
  }
  function closeModal(el) { el.hidden = true; el.innerHTML = ""; }
  document.addEventListener("keydown", function (e) { if (e.key !== "Escape") return; document.querySelectorAll(".fp-modal:not([hidden])").forEach(closeModal); });
  function guessGroup(e) {
    var t = String(e.type || "").toLowerCase(), ch = e.ch || [];
    if (/hazer|smoke|fog/.test(t) || (ch.indexOf("haze") >= 0 && ch.indexOf("r") < 0)) return "haze";
    if (/strobe|blinder/.test(t)) return "fx";
    if (e.mover || /moving|scanner/.test(t)) return "beam";
    return "back";
  }

  // ---------------------------------------------------------------- find a real light
  var pick = { q: "", hits: [], fx: null, mode: 0, busy: false, err: "" };
  async function openFinder() {
    var el = modal("fpFind"); el.hidden = false;
    el.innerHTML = '<div class="fp-box" role="dialog" aria-label="Find a real light"><div class="fp-head"><h3>Find a real light</h3><button data-fp="close">✕</button></div><p class="muted">Loading the fixture library…</p></div>';
    wireClose(el);
    try { await C().load(); } catch (err) { el.querySelector(".fp-box").innerHTML = '<div class="fp-head"><h3>Find a real light</h3><button data-fp="close">✕</button></div><p class="err">The fixture library couldn\'t be opened: ' + esc(err.message) + "</p>"; return; }
    drawFinder(); var q = $("#fpQ"); if (q) q.focus();
  }
  function wireClose(el) { if (el._wired) return; el._wired = true; el.addEventListener("click", function (e) { if (e.target.closest('[data-fp="close"]')) closeModal(el); }); }
  function drawFinder() {
    var el = modal("fpFind"), info = C().info(), X = L();
    pick.hits = pick.q.trim().length >= 2 ? C().search(pick.q, 60) : [];
    var fx = pick.fx, entry = fx ? C().entry(fx, pick.mode) : null, uni = num(($("#lxAddUni") || {}).value, 1), addr = num(($("#lxAddAddr") || {}).value, 1);
    el.innerHTML = '<div class="fp-box fp-find" role="dialog" aria-label="Find a real light"><div class="fp-head"><h3>Find a real light</h3><span class="muted small">' + info.fixtures.toLocaleString() + " lights from " + info.makers + ' makers (Open Fixture Library and QLC+)</span><button data-fp="close" title="Close">✕</button></div>' +
      '<div class="fp-search"><input id="fpQ" type="search" placeholder="Maker and model, like &quot;chauvet slimpar&quot; or &quot;mac aura&quot;" value="' + esc(pick.q) + '" autocomplete="off"></div>' +
      '<div class="fp-cols"><div class="fp-hits">' + (pick.hits.length ? pick.hits.map(function (h, i) { return '<button data-fp-hit="' + i + '" class="' + (h.fx === fx ? "sel" : "") + '"><b>' + esc(h.fx.n) + "</b><small>" + esc(h.maker) + (h.fx.t ? " · " + esc(h.fx.t) : "") + " · " + h.fx.md.length + " mode" + (h.fx.md.length > 1 ? "s" : "") + "</small></button>"; }).join("") :
        '<p class="muted small">' + (pick.q.trim().length >= 2 ? "Nothing matches. Try only the maker, or part of the model. Not there? Make a profile for it." : "Type at least two letters.") + "</p>") + "</div>" +
      '<div class="fp-detail">' + (!fx ? '<p class="muted">Pick a light to see its modes.</p>' :
        "<h4>" + esc(entry.maker + " " + entry.model) + "</h4>" + '<p class="muted small">' + esc([entry.type, entry.beam ? "beam " + entry.beam.join("-") + "°" : "", entry.watts ? entry.watts + " W" : "", entry.mover ? "pan " + entry.panDeg + "° · tilt " + entry.tiltDeg + "°" : ""].filter(Boolean).join(" · ")) + " · from the " + esc(entry.source) + "</p>" +
        '<label>Mode<select id="fpMode">' + fx.md.map(function (m, i) { return '<option value="' + i + '"' + (i === pick.mode ? " selected" : "") + ">" + esc(m.n) + " (" + m.c.split(" ").length + " ch)</option>"; }).join("") + "</select></label>" +
        '<p class="fp-chans small">' + esc(C().describe(entry)) + "</p>" +
        '<div class="fp-row"><label>How many<input id="fpCount" type="number" min="1" max="48" value="1"></label><label>Universe<input id="fpUni" type="number" min="1" max="64" value="' + uni + '"></label><label>First address<input id="fpAddr" type="number" min="1" max="512" value="' + addr + '"></label>' +
        '<label>Group<select id="fpGroup">' + (X.GROUPS || []).map(function (g) { return '<option value="' + g[0] + '"' + (g[0] === guessGroup(entry) ? " selected" : "") + ">" + esc(g[1]) + "</option>"; }).join("") + '</select></label><label>Name<input id="fpName" value="' + esc(entry.model) + '"></label></div>' +
        '<p class="muted small" id="fpAddrNote">' + addrNote(entry) + "</p>" +
        '<div class="fp-row"><button class="primary" data-fp="add">Add to the rig</button><button data-fp="lib" title="Keep the profile in your fixture library without adding lights">Only keep the profile</button></div>') + "</div></div>" +
      (pick.err ? '<p class="err">' + esc(pick.err) + "</p>" : "") + "</div>";
    wireClose(el); wireFinder(el);
  }
  function addrNote(entry) {
    var n = num(($("#fpCount") || {}).value, 1), a = num(($("#fpAddr") || {}).value, num(($("#lxAddAddr") || {}).value, 1)), last = a + n * entry.ch.length - 1;
    return n + " × " + entry.ch.length + " channels: addresses " + a + " to " + last + (last > 512 ? " - that's past 512, so start lower or use another universe" : "") + ". Set the same mode and address on each light.";
  }
  function wireFinder(el) {
    if (el._fw) return; el._fw = true;
    el.addEventListener("input", function (e) {
      if (e.target.id === "fpQ") { pick.q = e.target.value; var pos = e.target.selectionStart; clearTimeout(el._t); el._t = setTimeout(function () { drawFinder(); var q = $("#fpQ"); if (q) { q.focus(); q.setSelectionRange(pos, pos); } }, 120); }
      if (e.target.id === "fpCount" || e.target.id === "fpAddr") { var n = $("#fpAddrNote"); if (n && pick.fx) n.textContent = addrNote(C().entry(pick.fx, pick.mode)); }
    });
    el.addEventListener("change", function (e) { if (e.target.id === "fpMode") { pick.mode = Number(e.target.value) || 0; drawFinder(); } });
    el.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      if (b.dataset.fpHit != null) { pick.fx = pick.hits[Number(b.dataset.fpHit)].fx; pick.mode = 0; pick.err = ""; drawFinder(); return; }
      if (b.dataset.fp === "add" || b.dataset.fp === "lib") {
        var entry = C().entry(pick.fx, pick.mode), X = L(); X.addToLibrary([entry]);
        if (b.dataset.fp === "lib") { pick.err = ""; closeModal(el); return; }
        addLights(entry.id, num($("#fpCount").value, 1), num($("#fpUni").value, 1), num($("#fpAddr").value, 1), $("#fpGroup").value, $("#fpName").value.trim() || entry.model);
        closeModal(el);
      }
    });
  }
  // through the Fixtures page's own Add row, so the lights are placed and numbered the same way as any other
  function addLights(profileId, n, uni, addr, group, name) {
    var X = L(); X.fillAddProfiles();
    var set = function (id, v) { var i = document.getElementById(id); if (i) i.value = v; };
    set("lxAddProfile", profileId); set("lxAddCount", clamp(n, 1, 48)); set("lxAddUni", clamp(uni, 1, 64)); set("lxAddAddr", clamp(addr, 1, 512)); set("lxAddGroup", group); set("lxAddName", name);
    var btn = document.getElementById("lxAddBtn"); if (btn) btn.click();
    set("lxAddName", "");
  }

  // ---------------------------------------------------------------- make your own profile
  var prof = null;
  function blankProfile() { return { maker: "", model: "", mode: "", ch: ["dim", "r", "g", "b"], cv: {} }; }
  function openMaker(entry) {
    prof = entry ? JSON.parse(JSON.stringify({ id: entry.id, maker: entry.maker, model: entry.model, mode: entry.mode, ch: entry.ch.slice(), cv: entry.cv || {} })) : blankProfile();
    var el = modal("fpMake"); el.hidden = false; drawMaker();
  }
  function jobOptions(sel) { return C().JOBS.map(function (j) { return '<option value="' + j[0] + '"' + (j[0] === sel ? " selected" : "") + ">" + esc(j[1]) + "</option>"; }).join(""); }
  function valueFields(j, v, i) {
    v = v || {};
    var n = function (k, label, d, title) { return '<label' + (title ? ' title="' + esc(title) + '"' : "") + ">" + label + '<input type="number" min="0" max="255" data-pv="' + i + ":" + k + '" value="' + (v[k] != null ? v[k] : d) + '"></label>'; };
    if (j === "strobe") return n("o", "Open at", 0, "The value where the shutter is open and not strobing") + n("x", "Closed at", "", "Where the shutter is closed (empty if it has none)") + '<label>Strobe from<input type="number" min="0" max="255" data-pv="' + i + ':s0" value="' + (v.s ? v.s[0] : 10) + '"></label><label>to (fastest)<input type="number" min="0" max="255" data-pv="' + i + ':s1" value="' + (v.s ? v.s[1] : 255) + '"></label>';
    if (j === "wheel") return n("o", "Open (white) at", 0) + '<label class="fp-slots">Colour slots<input data-pv="' + i + ':sl" value="' + esc((v.sl || []).map(function (s) { return s[0] + " " + s[1]; }).join(", ")) + '" placeholder="10 #ff0000, 20 #0000ff, 30 #00ff00"></label>';
    if (j === "gobo" || j === "prism" || j === "frost" || j === "iris") return n("o", j === "prism" ? "Out at" : j === "frost" ? "Off at" : "Open at", 0);
    if (j === "zero" || j === "speed" || j === "ctemp" || j === "focus") return n("d", "Resting value", "", "What it sits at when nothing uses it");
    return "";
  }
  function drawMaker() {
    var el = modal("fpMake"), p = prof, rigFx = L().rig().fixtures;
    el.innerHTML = '<div class="fp-box fp-make" role="dialog" aria-label="Make a profile"><div class="fp-head"><h3>' + (p.id ? "Edit a profile" : "Make a profile") + '</h3><button data-fp="close" title="Close">✕</button></div>' +
      '<p class="muted small">For a light that isn\'t in the library: put its channels in the order its manual lists them, and say what each one does. The lights page then drives it like any other light.</p>' +
      '<div class="fp-row"><label>Maker<input data-pm="maker" value="' + esc(p.maker) + '" placeholder="Brand"></label><label>Model<input data-pm="model" value="' + esc(p.model) + '" placeholder="Model"></label><label>Mode<input data-pm="mode" value="' + esc(p.mode) + '" placeholder="' + p.ch.length + '-channel"></label></div>' +
      '<ol class="fp-chlist">' + p.ch.map(function (j, i) { return '<li><span class="fp-chn">' + (i + 1) + '</span><select data-pj="' + i + '">' + jobOptions(j) + '</select><span class="fp-vals">' + valueFields(j, p.cv[i], i) + '</span><span class="fp-chbtn"><button data-pmv="' + i + ':-1" title="Move up"' + (i ? "" : " disabled") + '>↑</button><button data-pmv="' + i + ':1" title="Move down"' + (i < p.ch.length - 1 ? "" : " disabled") + '>↓</button><button data-pdel="' + i + '" title="Remove this channel">✕</button></span></li>'; }).join("") + "</ol>" +
      '<div class="fp-row"><button data-fp="addch">+ Channel</button><button data-fp="import">Import a file (Open Fixture Library or QLC+)…</button><button data-fp="export"' + (p.ch.length ? "" : " disabled") + '>Export as an Open Fixture Library file</button><button data-fp="share" title="Share it with other churches on the Motion Audio website">Share on the website</button></div>' +
      '<div class="fp-row"><label>Try it on<select id="fpTry"><option value="">a light in the rig…</option>' + rigFx.map(function (f) { return '<option value="' + esc(f.id) + '">' + esc(f.name) + " (universe " + (f.universe || 1) + ", address " + (f.address || 1) + ")</option>"; }).join("") + '</select></label><button data-fp="try">Use it on that light and flash it</button></div>' +
      '<div class="fp-foot"><span class="muted small" id="fpMakeNote">' + esc(p.note || "") + '</span><button data-fp="close">Cancel</button><button class="primary" data-fp="save">Save the profile</button></div></div>';
    wireClose(el); wireMaker(el);
  }
  function readMaker(el) {
    var p = prof;
    el.querySelectorAll("[data-pm]").forEach(function (i) { p[i.dataset.pm] = i.value.trim(); });
    el.querySelectorAll("[data-pv]").forEach(function (inp) {
      var parts = inp.dataset.pv.split(":"), i = Number(parts[0]), k = parts[1], v = p.cv[i] = p.cv[i] || {}, s = inp.value.trim();
      if (k === "sl") { v.sl = s ? s.split(",").map(function (x) { var m = /^\s*(\d{1,3})\s+(#[0-9a-f]{6})\s*$/i.exec(x); return m ? [clamp(Number(m[1]), 0, 255), m[2].toLowerCase()] : null; }).filter(Boolean) : []; if (!v.sl.length) delete v.sl; }
      else if (k === "s0" || k === "s1") { v.s = v.s || [10, 255]; v.s[k === "s0" ? 0 : 1] = clamp(num(s, k === "s0" ? 10 : 255), 0, 255); }
      else if (s === "") delete v[k]; else v[k] = clamp(num(s, 0), 0, 255);
      if (!Object.keys(v).length) delete p.cv[i];
    });
  }
  function entryOf(p) {
    var maker = p.maker || "My lights", model = p.model || "My light", mode = p.mode || p.ch.length + "-channel", mover = p.ch.indexOf("pan") >= 0 || p.ch.indexOf("tilt") >= 0;
    var cv = {}; Object.keys(p.cv).forEach(function (k) { if (Number(k) < p.ch.length) cv[k] = p.cv[k]; });
    return { id: p.id || "lib:mine-" + (maker + "-" + model + "-" + mode).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80), maker: maker, model: model, mode: mode,
      name: maker + " " + model + " — " + mode + " (" + p.ch.length + " ch)", ch: p.ch.slice(), cv: cv, mover: mover, source: "Made here", mine: true };
  }
  function wireMaker(el) {
    if (el._mw) return; el._mw = true;
    el.addEventListener("change", function (e) {
      if (e.target.dataset.pj != null) { readMaker(el); var i = Number(e.target.dataset.pj); prof.ch[i] = e.target.value; delete prof.cv[i]; drawMaker(); }
    });
    el.addEventListener("click", async function (e) {
      var b = e.target.closest("button"); if (!b || !prof) return; readMaker(el);
      var move = function (from, to) { var j = prof.ch.splice(from, 1)[0]; prof.ch.splice(to, 0, j); var cvs = []; Object.keys(prof.cv).forEach(function (k) { cvs[k] = prof.cv[k]; }); var v = cvs.splice(from, 1)[0]; cvs.splice(to, 0, v); prof.cv = {}; cvs.forEach(function (x, k) { if (x) prof.cv[k] = x; }); };
      if (b.dataset.pmv) { var pr = b.dataset.pmv.split(":"), i = Number(pr[0]), d = Number(pr[1]); move(i, i + d); return drawMaker(); }
      if (b.dataset.pdel != null) { var k = Number(b.dataset.pdel); move(k, prof.ch.length - 1); prof.ch.pop(); delete prof.cv[prof.ch.length]; return drawMaker(); }
      var a = b.dataset.fp;
      if (a === "addch") { prof.ch.push("zero"); return drawMaker(); }
      if (a === "save") { if (!prof.ch.length) return; var en = entryOf(prof), X = L(); X.rig().library = (X.rig().library || []).filter(function (x) { return x.id !== en.id; }); X.addToLibrary([en]); X.renderFixtures(); prof.id = en.id; prof.note = "Saved. It's in the Type list when you add lights, and the church's other computers get it with the rig."; return drawMaker(); }
      if (a === "try") { var fid = $("#fpTry").value; if (!fid) return; var en2 = entryOf(prof), X2 = L(); X2.rig().library = (X2.rig().library || []).filter(function (x) { return x.id !== en2.id; }); X2.addToLibrary([en2]); prof.id = en2.id; var f = X2.rig().fixtures.filter(function (x) { return x.id === fid; })[0]; if (f) { f.profile = en2.id; X2.saveRig(); X2.renderFixtures(); if (X2.identify) X2.identify(fid); } prof.note = "It's on " + (f ? f.name : "that light") + " now: it flashes for a few seconds. Check each part answers, then save."; return drawMaker(); }
      if (a === "export") { var en3 = entryOf(prof), text = JSON.stringify(C().toOfl(en3), null, 2), name = (en3.maker + "-" + en3.model).toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".json"; if (global.CU && global.CU.fixtures && global.CU.fixtures.save) await global.CU.fixtures.save(name, text); else { var aEl = document.createElement("a"); aEl.href = URL.createObjectURL(new Blob([text], { type: "application/json" })); aEl.download = name; aEl.click(); } return; }
      if (a === "import") { var files = await importFiles(); if (!files.length) return; try { var es = /\.json$/i.test(files[0].name) || /^\s*\{/.test(files[0].text) ? C().fromOfl(files[0].text, files[0].name) : global.CUFixtureLib.parseQxf(files[0].text); var e0 = es[0]; prof = { maker: e0.maker, model: e0.model, mode: e0.mode, ch: e0.ch.slice(), cv: e0.cv || {}, note: "Imported " + files[0].name + (es.length > 1 ? " (its first mode; save, then import again for the others)" : "") + "." }; } catch (err) { prof.note = "Couldn't read that file: " + err.message; } return drawMaker(); }
      if (a === "share") { var site = (global.PPLicense && global.PPLicense.server && global.PPLicense.server()) || "https://motionaudio.org"; var url = site.replace(/\/$/, "") + "/create/?kind=fixture"; if (global.CU && global.CU.openExternal) global.CU.openExternal(url); else global.open(url, "_blank"); prof.note = "Export the file, then upload it on the website's Make & sell page as a fixture profile."; return drawMaker(); }
    });
  }
  async function importFiles() {
    if (global.CU && global.CU.fixtures && global.CU.fixtures.open) return await global.CU.fixtures.open();
    return await new Promise(function (res) { var i = document.createElement("input"); i.type = "file"; i.accept = ".json,.qxf"; i.onchange = async function () { var f = i.files[0]; if (!f) return res([]); res([{ name: f.name, text: await f.text() }]); }; i.click(); });
  }

  // ---------------------------------------------------------------- a light's own settings
  function openSettings(id) {
    var X = L(), f = X.rig().fixtures.filter(function (x) { return x.id === id; })[0]; if (!f) return;
    var el = modal("fpSet"), p = X.profileOf(f), P = global.CULightsProg, mov = f.movable === true || f.movable === false ? String(f.movable) : "auto", pr = f.panRange || [0, 1], tr = f.tiltRange || [0, 1], cal = f.calib || {};
    el.hidden = false;
    el.innerHTML = '<div class="fp-box fp-set" role="dialog" aria-label="Light settings"><div class="fp-head"><h3>' + esc(f.name) + '</h3><button data-fp="close" title="Close">✕</button></div>' +
      '<p class="muted small">' + esc(p.name || "Profile") + " · universe " + (f.universe || 1) + ", address " + (f.address || 1) + " to " + ((f.address || 1) + (p.ch || []).length - 1) + "</p>" +
      '<div class="fp-row"><label>Name<input data-fs="name" value="' + esc(f.name) + '"></label><label>Universe<input type="number" min="1" max="64" data-fs="universe" value="' + (f.universe || 1) + '"></label><label>Address<input type="number" min="1" max="512" data-fs="address" value="' + (f.address || 1) + '"></label></div>' +
      '<div class="fp-row"><label>Group<select data-fs="group">' + (X.GROUPS || []).map(function (g) { return '<option value="' + g[0] + '"' + (g[0] === f.group ? " selected" : "") + ">" + esc(g[1]) + "</option>"; }).join("") + '</select></label><label>Its own groups<input data-fs="tags" value="' + esc((f.tags || []).join(", ")) + '" placeholder="Stage left, Choir, Drum riser"></label></div>' +
      "<h4>What it is</h4>" +
      '<div class="fp-row"><label>Moves (pan and tilt)<select data-fs="movable"><option value="auto"' + (mov === "auto" ? " selected" : "") + ">As its profile says (" + (p.mover ? "it moves" : "it doesn't") + ')</option><option value="true"' + (mov === "true" ? " selected" : "") + '>Yes, it moves</option><option value="false"' + (mov === "false" ? " selected" : "") + ">No, it's fixed</option></select></label>" +
      '<label>Hung<select data-fs="upsideDown"><option value="">The right way up</option><option value="1"' + (f.upsideDown ? " selected" : "") + ">Upside down (on a truss)</option></select></label>" +
      '<label class="toggle"><input type="checkbox" data-fs="auto"' + (f.auto === false ? "" : " checked") + "> The auto lights and the AI can use it</label></div>" +
      (P && P.movable(f) ? '<div class="fp-row"><label>Pan from<input type="number" min="0" max="100" data-fs="pan0" value="' + Math.round(pr[0] * 100) + '">%</label><label>to<input type="number" min="0" max="100" data-fs="pan1" value="' + Math.round(pr[1] * 100) + '">%</label><label>Tilt from<input type="number" min="0" max="100" data-fs="tilt0" value="' + Math.round(tr[0] * 100) + '">%</label><label>to<input type="number" min="0" max="100" data-fs="tilt1" value="' + Math.round(tr[1] * 100) + '">%</label>' +
        '<label class="toggle"><input type="checkbox" data-fs="invertPan"' + (f.invertPan ? " checked" : "") + '> Mirror pan</label><label class="toggle"><input type="checkbox" data-fs="invertTilt"' + (f.invertTilt ? " checked" : "") + "> Mirror tilt</label></div>" :
        '<p class="muted small">It doesn\'t move, so it has no position settings and the auto lights won\'t try to move it.</p>') +
      "<h4>Brightness and colour</h4>" +
      '<div class="fp-row"><label>Brightest it goes<input type="range" min="0.1" max="1" step="0.05" data-fs="maxDim" value="' + (f.maxDim != null ? f.maxDim : 1) + '"><output>' + Math.round((f.maxDim != null ? f.maxDim : 1) * 100) + '%</output></label><label>Dimmer curve<select data-fs="curve">' + [["linear", "Straight (as it is)"], ["square", "Square (smoother at the bottom)"], ["smooth", "S-curve"], ["led", "LED (gamma 2.2)"]].map(function (c) { return '<option value="' + c[0] + '"' + ((f.curve || "linear") === c[0] ? " selected" : "") + ">" + c[1] + "</option>"; }).join("") + "</select></label></div>" +
      '<div class="fp-row fp-cal"><span>Colour calibration</span>' + ["r", "g", "b"].map(function (k) { return '<label>' + { r: "Red", g: "Green", b: "Blue" }[k] + '<input type="range" min="0.5" max="1.5" step="0.05" data-fs="cal' + k + '" value="' + (cal[k] != null ? cal[k] : 1) + '"><output>' + Math.round((cal[k] != null ? cal[k] : 1) * 100) + "%</output></label>"; }).join("") + '<button data-fs-act="calreset">Reset</button></div>' +
      '<div class="fp-foot"><button data-fs-act="find" title="Flash it so you can spot it">Find it</button>' + (/^lib:mine-/.test(f.profile || "") ? '<button data-fs-act="editprof">Edit its profile</button>' : "") + '<span style="flex:1"></span><button class="primary" data-fp="close">Done</button></div></div>';
    el.dataset.fx = id; wireClose(el); wireSettings(el);
  }
  function wireSettings(el) {
    if (el._sw) return; el._sw = true;
    var apply = function (t) {
      var X = L(), f = X.rig().fixtures.filter(function (x) { return x.id === el.dataset.fx; })[0]; if (!f) return; var k = t.dataset.fs, v = t.type === "checkbox" ? t.checked : t.value;
      if (k === "name") f.name = String(v).slice(0, 60) || f.name;
      else if (k === "universe") f.universe = clamp(Math.round(num(v, 1)), 1, 64);
      else if (k === "address") f.address = clamp(Math.round(num(v, 1)), 1, 512);
      else if (k === "group") f.group = v;
      else if (k === "tags") { f.tags = String(v).split(",").map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 8); if (!f.tags.length) delete f.tags; }
      else if (k === "movable") { if (v === "auto") delete f.movable; else f.movable = v === "true"; openSettings(f.id); }
      else if (k === "upsideDown") { if (v) f.upsideDown = true; else delete f.upsideDown; }
      else if (k === "auto") { if (v) delete f.auto; else f.auto = false; }
      else if (k === "invertPan" || k === "invertTilt") f[k] = !!v;
      else if (/^(pan|tilt)[01]$/.test(k)) { var key = k.slice(0, -1) + "Range", r = f[key] || [0, 1]; r[Number(k.slice(-1))] = clamp(num(v, 0) / 100, 0, 1); f[key] = r; if (r[0] === 0 && r[1] === 1) delete f[key]; }
      else if (k === "maxDim") { f.maxDim = clamp(num(v, 1), 0.1, 1); if (f.maxDim >= 1) delete f.maxDim; }
      else if (k === "curve") { if (v === "linear") delete f.curve; else f.curve = v; }
      else if (/^cal[rgb]$/.test(k)) { f.calib = f.calib || {}; f.calib[k.slice(3)] = clamp(num(v, 1), 0.5, 1.5); if (["r", "g", "b"].every(function (c) { return f.calib[c] == null || f.calib[c] === 1; })) delete f.calib; }
      var out = t.parentNode && t.parentNode.querySelector("output"); if (out) out.textContent = Math.round(num(v, 1) * 100) + "%";
      X.saveRig(); X.dirty(); if (k !== "maxDim" && !/^cal/.test(k)) X.renderFixtures(); if (global.CULights3D && (k === "upsideDown" || k === "group")) global.CULights3D.rebuild();
    };
    el.addEventListener("change", function (e) { if (e.target.dataset.fs) apply(e.target); });
    el.addEventListener("input", function (e) { if (e.target.dataset.fs && e.target.type === "range") apply(e.target); });
    el.addEventListener("click", function (e) {
      var b = e.target.closest("[data-fs-act]"); if (!b) return; var X = L(), f = X.rig().fixtures.filter(function (x) { return x.id === el.dataset.fx; })[0]; if (!f) return;
      if (b.dataset.fsAct === "find" && X.identify) X.identify(f.id);
      if (b.dataset.fsAct === "calreset") { delete f.calib; X.saveRig(); openSettings(f.id); }
      if (b.dataset.fsAct === "editprof") { var en = (X.rig().library || []).filter(function (x) { return x.id === f.profile; })[0]; closeModal(el); if (en) openMaker(en); }
    });
  }

  // ---------------------------------------------------------------- Central Utility's lighting looks
  async function utilityLooks() {
    var LIB = global.CU && global.CU.libraries; if (!LIB || !LIB.list) return { looks: [], installed: false };
    var list = []; try { list = await LIB.list(); } catch (_) { }
    var looks = []; (list || []).forEach(function (r) { (r.looks || []).forEach(function (l) { looks.push(Object.assign({ library: r.id, tier: r.plan }, l)); }); });
    return { looks: looks, installed: (list || []).some(function (r) { return r.plan === "utility"; }) };
  }
  function hasUtility() { var Li = global.PPLicense; return !Li || !Li.hasPlan || Li.hasPlan("utility"); }
  async function addUtilityLooks(btn) {
    var X = L();
    if (!hasUtility()) { alert("The Central Utility looks come with Central Utility ($50 a year), All plans or a church bundle. Add its package key in Settings → Packages."); return 0; }
    var u = await utilityLooks();
    if (!u.looks.length) { alert(u.installed ? "The Central Utility library has no lighting looks yet." : "Download the Central Utility library first: Settings → Packages → Libraries → Central Utility Library → Download."); return 0; }
    var have = {}, n = 0; X.rig().looks.forEach(function (l) { have[l.id] = true; });
    u.looks.forEach(function (x) { var l = JSON.parse(JSON.stringify(x.look)); l.id = l.id || "utility-" + Math.random().toString(36).slice(2, 8); if (have[l.id]) return; l.utility = true; l.tier = "utility"; X.rig().looks.push(l); n++; });
    X.dirty(); X.saveRig(); if (X.renderLooks) X.renderLooks();
    if (btn) btn.textContent = n ? "Added " + n + " looks" : "Central Utility looks are in";
    return n;
  }

  // ---------------------------------------------------------------- the buttons on the Fixtures and Presets pages
  function decorate() {
    var add = document.getElementById("lxAddBtn");
    if (add && !document.getElementById("fpFindBtn")) {
      var a = document.createElement("button"); a.id = "fpFindBtn"; a.type = "button"; a.textContent = "Find a real light…"; a.title = "Search thousands of real lights by maker and model";
      var m = document.createElement("button"); m.id = "fpMakeBtn"; m.type = "button"; m.textContent = "Make a profile…"; m.title = "A light that isn't in the library: list its channels";
      var u = document.createElement("button"); u.id = "fpUpdBtn"; u.type = "button"; u.className = "linkish small"; u.textContent = "Update the fixture library"; u.title = "Download the newest list of lights";
      add.parentNode.insertBefore(a, add.nextSibling); a.parentNode.insertBefore(m, a.nextSibling); m.parentNode.insertBefore(u, m.nextSibling);
      a.addEventListener("click", openFinder); m.addEventListener("click", function () { openMaker(null); });
      u.addEventListener("click", async function () {
        var F = global.CU && global.CU.fixtures; if (!F || !F.update) { alert("Updating the fixture library works in the Central Control and Central Usage apps."); return; }
        u.disabled = true; u.textContent = "Checking…"; var r = await F.update(); u.disabled = false;
        if (!r.ok) { u.textContent = "Update the fixture library"; alert(r.error); return; }
        if (r.fresh) { C().reset(); u.textContent = "Updated: " + r.fixtures.toLocaleString() + " lights"; } else u.textContent = "It's up to date (" + r.fixtures.toLocaleString() + " lights)";
      });
    }
    var table = document.getElementById("lxFixTable");
    if (table) table.querySelectorAll("tr[data-fx]").forEach(function (tr) {
      if (tr.querySelector("[data-fp-set]")) return; var td = tr.lastElementChild; if (!td) return;
      var b = document.createElement("button"); b.type = "button"; b.dataset.fpSet = tr.dataset.fx; b.title = "What this light is: moves or not, limits, curve, calibration"; b.textContent = "⚙"; b.className = "fp-setbtn"; td.insertBefore(b, td.firstChild);
    });
    var looks = document.getElementById("lxLookList");
    if (looks && !document.getElementById("fpUtilLooks") && looks.parentNode) {
      var ub = document.createElement("button"); ub.id = "fpUtilLooks"; ub.type = "button"; ub.className = "fp-util"; ub.textContent = "Add the Central Utility looks"; ub.title = "24 more lighting looks with Central Utility";
      looks.parentNode.insertBefore(ub, looks.nextSibling); ub.addEventListener("click", function () { addUtilityLooks(ub); });
    }
    var edit = document.getElementById("lxLookEdit");
    if (edit && L() && !edit.querySelector("[data-fp-proglook]") && global.CULightsProg) {
      var row = edit.querySelector(".row"); if (row) { var pb = document.createElement("button"); pb.type = "button"; pb.dataset.fpProglook = "1"; pb.textContent = "Program lights"; pb.title = "Set each light of this preset on its own (on top of the groups)"; row.appendChild(pb); }
    }
  }
  // a Central Utility look without the plan: shown locked, and pressing it says how to get it (scenes already
  // programmed with it keep playing - a lapsed plan never darkens a service)
  function utilityLook(id) { var X = L(); if (!X || !X.rig) return null; return X.rig().looks.filter(function (l) { return l.id === id && l.tier === "utility"; })[0] || null; }
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-look]"); if (!b || hasUtility() || !utilityLook(b.dataset.look)) return;
    e.preventDefault(); e.stopPropagation();
    alert('"' + utilityLook(b.dataset.look).name + '" is a Central Utility look. It opens with Central Utility ($50 a year), All plans or a church bundle: add the package key in Settings → Packages.');
  }, true);
  function markLocked() {
    if (hasUtility()) { document.querySelectorAll(".fp-locked").forEach(function (x) { x.classList.remove("fp-locked"); }); return; }
    document.querySelectorAll("#view-lights [data-look], #view-lights [data-edit-look]").forEach(function (x) { var id = x.dataset.look || x.dataset.editLook; x.classList.toggle("fp-locked", !!utilityLook(id)); if (utilityLook(id)) x.title = "Central Utility - add its package key in Settings → Packages"; });
  }
  document.addEventListener("click", function (e) {
    var s = e.target.closest("[data-fp-set]"); if (s) { e.preventDefault(); openSettings(s.dataset.fpSet); return; }
    var pl = e.target.closest("[data-fp-proglook]"); if (pl && global.CULightsProg) { var X = L(), nm = (document.querySelector('#lxLookEdit [data-lk="name"]') || {}).value, look = X.rig().looks.filter(function (l) { return l.name === nm; })[0]; if (look) global.CULightsProg.openLook(look); }
  });
  function watch() {
    var view = document.getElementById("view-lights") || document.body;
    new MutationObserver(function () { clearTimeout(watch.t); watch.t = setTimeout(function () { decorate(); markLocked(); }, 30); }).observe(view, { childList: true, subtree: true });
    decorate();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch); else setTimeout(watch, 0);

  global.CUFixturePicker = { openFinder: openFinder, openMaker: openMaker, openSettings: openSettings, addLights: addLights, addUtilityLooks: addUtilityLooks, hasUtility: hasUtility, entryOf: entryOf,
    state: function () { return { pick: pick, prof: prof }; }, setProfile: function (p) { prof = p; drawMaker(); }, search: function (q) { pick.q = q; drawFinder(); } };
})(window);
