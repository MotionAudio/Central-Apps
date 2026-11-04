/* Central Production - Pedal board: a chain of pedals from the catalogue (drives, amps, cabs, modulation, delays,
 * reverbs, studio tools), in the order the sound goes through them, with their knobs. It's the same board format as the
 * Central Pedal's Instrument page, so it installs into your apps and publishes to Make & sell as a Pedal board. */
(function () {
  "use strict";
  var Z = window.CMProj, H = window.CPHost, P = window.PPPedals;
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return window.CP.esc(s); }
  var ui = { el: null, cat: "all", q: "", sel: null };
  var KINDS = [["electric", "Electric guitar"], ["acoustic", "Acoustic guitar"], ["bass", "Bass"], ["keys", "Keys"], ["vocal", "Vocals"], ["", "Anything"]];
  function D() { return window.CP.project().data; }
  function pedal(id) { return P && P.byId ? P.byId(id) : null; }
  function mount(el) {
    ui.el = el;
    if (!P) { el.innerHTML = '<div class="cp-card"><p class="err">The pedal catalogue didn\'t load.</p></div>'; return; }
    var cats = P.CATEGORIES;
    el.innerHTML = '<div class="cp-ed cp-board"><div class="cp-tools"><div class="cp-group"><label>For <select id="bdKind">' + KINDS.map(function (k) { return '<option value="' + k[0] + '">' + k[1] + "</option>"; }).join("") + '</select></label>' +
      '<label>Start from <select id="bdFrom"><option value="">An empty board</option>' + P.boards.map(function (b) { return '<option value="' + esc(b.id) + '">' + esc(b.name) + "</option>"; }).join("") + "</select></label></div>" +
      '<div class="cp-group"><span class="muted small" id="bdPlans"></span></div></div>' +
      '<div class="cp-board-grid"><div class="cp-card cp-cat"><input id="bdQ" placeholder="Find a pedal" value="' + esc(ui.q) + '"><div class="cp-chips" id="bdCats"><button data-cat="all" class="' + (ui.cat === "all" ? "on" : "") + '">All</button>' + Object.keys(cats).map(function (k) { return '<button data-cat="' + k + '" class="' + (ui.cat === k ? "on" : "") + '" style="--cc:' + cats[k].color + '">' + esc(cats[k].name) + "</button>"; }).join("") + '</div><div class="cp-pedals" id="bdList"></div></div>' +
      '<div class="cp-card"><b>The board</b> <span class="muted small">The sound goes left to right. Drag a pedal to move it.</span><div class="cp-chain" id="bdChain"></div><div id="bdKnobs"></div></div></div></div>';
    $("#bdKind", el).value = D().kind || "";
    $("#bdKind", el).onchange = function () { var v = this.value || null; window.CP.edit("Board kind", function (d) { d.kind = v; }); };
    $("#bdFrom", el).onchange = function () { var b = P.boards.filter(function (x) { return x.id === this.value; }, this)[0]; if (!b) return; window.CP.edit("Start from " + b.name, function (d) { d.chain = JSON.parse(JSON.stringify(b.chain)); d.kind = b.kind || d.kind; if (b.sound) d.sound = b.sound; }); this.value = ""; };
    $("#bdQ", el).oninput = function () { ui.q = this.value; list(); };
    $("#bdCats", el).onclick = function (e) { var b = e.target.closest("[data-cat]"); if (!b) return; ui.cat = b.dataset.cat; $$("[data-cat]", el).forEach(function (x) { x.classList.toggle("on", x === b); }); list(); };
    list(); draw();
  }
  function list() {
    var q = ui.q.trim().toLowerCase(), items = P.pedals.filter(function (p) { return (ui.cat === "all" || p.category === ui.cat) && (!q || (p.name + " " + p.id).toLowerCase().indexOf(q) >= 0); });
    var el = $("#bdList", ui.el);
    el.innerHTML = items.slice(0, 200).map(function (p) { var c = P.CATEGORIES[p.category] || {}, locked = P.pedalLocked(p); return '<button class="cp-pedal' + (locked ? " locked" : "") + '" data-add="' + esc(p.id) + '" style="--cc:' + (p.color || c.color || "#555") + '" title="' + esc(locked ? P.lockText(p.tier) : "Add it to the end of the board") + '"><i></i><b>' + esc(p.name) + "</b><span>" + esc(c.name || "") + (p.tier !== "free" ? " · " + esc((P.PLANS[p.tier] || {}).name || p.tier) : "") + "</span></button>"; }).join("") || '<p class="muted">No pedal matches.</p>';
    el.onclick = function (e) { var b = e.target.closest("[data-add]"); if (!b) return; var id = b.dataset.add; window.CP.edit("Add " + pedal(id).name, function (d) { if (d.chain.length >= 24) return; d.chain.push([id, {}]); }); ui.sel = D().chain.length - 1; if (D().chain.length >= 24) window.CP.toast("A board can have up to 24 pedals.", "bad"); };
  }
  function draw() {
    if (!ui.el || !P) return;
    var d = D(), chain = $("#bdChain", ui.el);
    chain.innerHTML = d.chain.length ? d.chain.map(function (it, i) { var p = pedal(it[0]) || { name: it[0], category: "util" }, c = P.CATEGORIES[p.category] || {}; return '<div class="cp-stomp' + (i === ui.sel ? " on" : "") + '" draggable="true" data-i="' + i + '" style="--cc:' + (p.color || c.color || "#555") + '"><b>' + esc(p.name) + '</b><span class="cp-led"></span><button class="ghost small" data-rm="' + i + '" title="Take it off the board">✕</button></div>'; }).join('<span class="cp-cable"></span>')
      : '<p class="muted">Add pedals from the list, or start from one of our boards.</p>';
    var need = P.boardPlans(d); $("#bdPlans", ui.el).textContent = need.length ? "Needs " + P.planText(need) + " to play" : "Every pedal on it is free";
    chain.onclick = function (e) { var rm = e.target.closest("[data-rm]"), s = e.target.closest("[data-i]"); if (rm) { var i = +rm.dataset.rm; window.CP.edit("Remove pedal", function (dd) { dd.chain.splice(i, 1); }); ui.sel = null; return; } if (s) { ui.sel = +s.dataset.i; draw(); } };
    var from = null;
    chain.ondragstart = function (e) { var s = e.target.closest("[data-i]"); if (s) { from = +s.dataset.i; e.dataTransfer.effectAllowed = "move"; } };
    chain.ondragover = function (e) { e.preventDefault(); };
    chain.ondrop = function (e) { e.preventDefault(); var s = e.target.closest("[data-i]"); if (from == null || !s) return; var to = +s.dataset.i; if (to === from) return; window.CP.edit("Move pedal", function (dd) { var x = dd.chain.splice(from, 1)[0]; dd.chain.splice(to, 0, x); }); ui.sel = to; from = null; };
    var kn = $("#bdKnobs", ui.el), it = d.chain[ui.sel];
    if (!it) { kn.innerHTML = '<p class="muted small">Pick a pedal on the board to set its knobs.</p>'; return; }
    var p = pedal(it[0]) || { knobs: {} }, knobs = Object.keys(p.knobs || {});
    kn.innerHTML = '<div class="cp-row"><b>' + esc(p.name || it[0]) + '</b><span class="muted small">Leave a knob empty to use the pedal\'s own setting.</span><button data-mv="-1">◀ Move</button><button data-mv="1">Move ▶</button></div><div class="cp-knobs">' +
      (knobs.length ? knobs.map(function (k) { var v = it[1][k]; return '<label>' + esc(k) + ' <input type="number" step="any" data-knob="' + esc(k) + '" value="' + (v == null ? "" : v) + '" placeholder="its own"></label>'; }).join("") : '<span class="muted">This pedal has no knobs to set here.</span>') +
      (P.tempo && P.tempo.pedal(p) ? '<label>Sync to tempo <select data-bdsync><option value="">Off (its own time)</option>' + P.tempo.NOTES.map(function (n) { return '<option value="' + n[0] + '"' + (it[2] && it[2].sync === n[0] ? " selected" : "") + ">" + esc(n[1]) + "</option>"; }).join("") + "</select></label>" : "") + "</div>";   // (10.4) a delay that follows the song's tempo
    var bs = $("[data-bdsync]", kn); if (bs) bs.onchange = function () { var v = bs.value, i = ui.sel; window.CP.edit(v ? "Sync to tempo" : "Own delay time", function (dd) { var x = dd.chain[i]; x[2] = Object.assign({}, x[2] || {}); if (v) x[2].sync = v; else delete x[2].sync; if (!Object.keys(x[2]).length) x.length = 2; }); };
    $$("[data-knob]", kn).forEach(function (inp) { inp.onchange = function () { var k = inp.dataset.knob, v = inp.value === "" ? null : +inp.value, i = ui.sel; window.CP.edit("Knob " + k, function (dd) { if (v == null) delete dd.chain[i][1][k]; else dd.chain[i][1][k] = v; }); }; });
    $$("[data-mv]", kn).forEach(function (b) { b.onclick = function () { var i = ui.sel, to = i + (+b.dataset.mv); if (to < 0 || to >= d.chain.length) return; window.CP.edit("Move pedal", function (dd) { var x = dd.chain.splice(i, 1)[0]; dd.chain.splice(to, 0, x); }); ui.sel = to; }; });
  }
  function file() {
    var d = D(); if (!d.chain.length) throw new Error("The board is empty: add some pedals first.");
    var b = { name: window.CP.project().name.slice(0, 60), kind: d.kind || null, chain: d.chain, made: "Central Production" }; if (d.sound) b.sound = d.sound;
    return { name: Z.slug(b.name, "board") + ".json", data: new TextEncoder().encode(JSON.stringify(b, null, 1)), board: b };
  }
  window.CP.type({
    id: "board", name: "Pedal board", blurb: "A chain of pedals, amps and effects for an instrument",
    long: "Put pedals from the catalogue in a row - drives, amps, cabinets, modulation, delays, reverbs, studio tools - and set their knobs. It's a board for the Central Pedal's Instrument page and Central Usage, and it publishes to Make & sell as a Pedal board.",
    create: function () { ui.sel = null; return { kind: "electric", chain: [], sound: null }; },
    mount: mount, unmount: function () { ui.el = null; }, changed: function () { draw(); },
    collect: function (project) { return { data: project.data, files: {} }; },
    exports: [["Export the board (.json)", function () { var f = file(); return H.exportFiles(window.CP.project().name, [{ name: f.name, data: f.data }]); }, "The pedal board preset format"]],
    publish: { store: "make", kind: "board", build: function () { return { board: file() }; } },
    install: function () { return { board: file() }; }
  });
})();
