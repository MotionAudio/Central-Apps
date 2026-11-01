/* Central Pedal / Central Pedal Control / Central Control - Planning Center plans as setlists (10.2), through the
 * church account (the website signs in to Planning Center for the church; server/src/pco.js).
 *
 *   Settings → Songs & CCLI → Planning Center   connect (a main admin, on a computer: it opens Planning Center's sign-in
 *                                               in the browser), pick a service type and a plan, Make a setlist
 *   Setlists → Load setlist                     the same plans, to make or update a setlist and open it
 *   Import a plan from a file                   a CSV exported from Planning Center, or a list (one item per line)
 *
 * The setlist keeps the plan's songs in order with their keys, the order of service and the team, and follows the plan
 * when it changes. (Central Pedal's own Planning Center link with a Personal Access Token - Add songs → Planning
 * Center - still works as before, for the songs' files and charts.) */
(function (root) {
  "use strict";
  if (!root || !root.document) return;
  var st = { status: null, types: null, type: "", plans: null, msg: "", err: "", busy: false, loading: false, loadedAt: 0, watch: 0, open: false };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function C() { return root.PPCcli || null; }
  function signedIn() { return !!(C() && C().account && C().account()); }
  function api(m, p, b) { return C().api(m, p, b); }
  function onComputer() { return /Electron/i.test(navigator.userAgent || ""); }

  async function load(force) {
    if (!signedIn() || st.loading) return; if (!force && st.loadedAt && Date.now() - st.loadedAt < 20000) return;
    st.loading = true;
    try {
      st.status = await api("GET", "/pco/status"); st.err = "";
      if (st.status.connected && st.status.canImport) {
        if (!st.types || force) { st.types = (await api("GET", "/pco/service-types")).serviceTypes || []; if (!st.type && st.types.length) st.type = st.types[0].id; }
        if (st.type) st.plans = (await api("GET", "/pco/plans?serviceType=" + encodeURIComponent(st.type))).plans || [];
      }
    } catch (e) { st.err = e.message; }
    st.loading = false; st.loadedAt = Date.now(); redraw();
  }
  function missingHtml(list) {
    if (!list || !list.length) return "";
    return '<ul class="plain pco-miss">' + list.map(function (m) { return "<li><b>" + esc(m.title) + '</b> <span class="muted small">· ' + esc(m.why) + "</span></li>"; }).join("") + "</ul>";
  }
  function plansHtml() {
    var s = st.status || {};
    if (!s.connected || !s.canImport) return "";
    var types = st.types || [];
    return (types.length > 1 ? '<label>Service type<select data-pco-type>' + types.map(function (t) { return '<option value="' + esc(t.id) + '"' + (t.id === st.type ? " selected" : "") + ">" + esc(t.name) + "</option>"; }).join("") + "</select></label>" : "") +
      (!st.plans ? '<p class="muted small">Loading the plans…</p>' : st.plans.length ? '<div class="sync-list">' + st.plans.map(function (p) {
        return '<div class="sync-row"><div><b>' + esc(p.dates || p.title) + "</b><small>" + esc([p.title !== p.dates ? p.title : "", p.items ? p.items + " items" : ""].filter(Boolean).join(" · ")) + "</small></div>" +
          '<button class="' + (p.setlistId ? "" : "primary") + '" data-pco-import="' + esc(p.id) + '"' + (st.busy ? " disabled" : "") + ">" + (p.setlistId ? "Update" : "Make a setlist") + "</button></div>";
      }).join("") + "</div>" : '<p class="muted small">No upcoming plans for this service type.</p>');
  }
  function fileHtml() {
    var s = st.status || {}; if (s.canImport === false) return "";
    return '<label class="pco-file">Import a plan from a file <input type="file" accept=".csv,.tsv,.txt,.json" data-pco-file></label><p class="muted small">In Planning Center, export the plan as a CSV, or write the order of service one item per line ("4:30 Amazing Grace - G").</p>';
  }
  function topHtml(withConnect) {
    var s = st.status;
    if (!signedIn()) return '<p class="muted">Sign in to your church account (Settings → License) to bring in Planning Center plans.</p>';
    if (!s) { setTimeout(function () { load(false); }, 0); return '<p class="muted small">Looking…</p>'; }
    if (!s.configured) return '<p class="muted small pco-why">' + esc(s.why) + "</p>";
    if (s.connected) return '<p class="small">Connected to <b>' + esc(s.organization || "Planning Center") + "</b>" + (s.connectedBy ? ' <span class="muted">by ' + esc(s.connectedBy) + "</span>" : "") + "</p>" +
      (withConnect && s.canConnect ? '<div class="row"><button data-pco="refresh">Check for new plans</button><button data-pco="disconnect">Disconnect</button></div>' : "");
    if (!s.canConnect) return (s.problem ? '<p class="small bad">' + esc(s.problem) + "</p>" : "") + '<p class="muted small">A main admin connects your church\'s Planning Center account.</p>';
    if (!onComputer()) return (s.problem ? '<p class="small bad">' + esc(s.problem) + "</p>" : "") + '<p class="muted small">Connect it on the website (Account → Planning Center) or in Central Control. The plans then show here.</p>';
    return (s.problem ? '<p class="small bad">' + esc(s.problem) + "</p>" : "") + '<p class="muted small">Sign in with your church\'s Planning Center account. Your plans then come in as setlists and follow along when they change.</p><div class="row"><button class="primary" data-pco="connect">Connect Planning Center</button></div>';
  }
  function body(withConnect) {
    return topHtml(withConnect) + plansHtml() + fileHtml() + (st.msg ? '<div class="small pco-msg">' + st.msg + "</div>" : "") + (st.err ? '<p class="small bad">' + esc(st.err) + "</p>" : "");
  }
  function settingsHtml(cls) { return '<section class="' + (cls || "") + '" data-st="pco" id="pcoSettings"><h3>Planning Center</h3>' + body(true) + "</section>"; }
  function inlineHtml() { if (!st.status && signedIn()) setTimeout(function () { load(false); }, 0); return '<div id="pcoInline" class="pco-inline"><h3>From Planning Center</h3>' + body(false) + "</div>"; }
  function redraw() {
    var a = document.getElementById("pcoSettings"); if (a) a.outerHTML = settingsHtml(a.className);
    var b = document.getElementById("pcoInline"); if (b) b.outerHTML = inlineHtml();
  }
  function done(r, how) {
    st.msg = "<p>" + how + " <b>" + esc(r.setlist.name) + "</b>: " + r.songs + " song" + (r.songs === 1 ? "" : "s") + (r.matched ? ", " + r.matched + " from Central Tracks" : "") + '. <button data-pco-open="' + esc(r.setlist.id) + '">Open it</button></p>' + missingHtml(r.missing);
    st.err = ""; if (root.PPSetlists && root.PPSetlists.reload) root.PPSetlists.reload();
  }
  document.addEventListener("click", async function (e) {
    var b = e.target.closest && e.target.closest("[data-pco],[data-pco-import],[data-pco-open]"); if (!b || b.tagName !== "BUTTON") return;
    st.err = "";
    try {
      if (b.dataset.pco === "connect") {
        var r = await api("POST", "/pco/connect", { from: "app" }); root.open(r.url, "_blank");
        st.msg = "<p>Finish signing in to Planning Center in your browser. The plans show here when it's done.</p>"; st.watch = Date.now() + 5 * 60e3; redraw(); return;
      }
      if (b.dataset.pco === "disconnect") { await api("POST", "/pco/disconnect"); st.types = null; st.plans = null; st.msg = "<p>Planning Center is disconnected. Setlists already made stay.</p>"; }
      if (b.dataset.pco === "refresh") { st.msg = ""; }
      if (b.dataset.pcoImport) { st.busy = true; redraw(); var j = await api("POST", "/pco/import", { serviceType: st.type, plan: b.dataset.pcoImport }); done(j, "Made"); }
      if (b.dataset.pcoOpen) { if (root.PPSetlists && root.PPSetlists.openCloud) { if (root.PPSetlists.open && !document.querySelector("#slDialog[open]")) root.PPSetlists.open("load"); root.PPSetlists.openCloud(b.dataset.pcoOpen); } else st.msg = "<p>Open it under Setlists → Load setlist.</p>"; }
    } catch (err) { st.err = err.message; }
    st.busy = false; await load(true);
  });
  document.addEventListener("change", async function (e) {
    var t = e.target; if (!t || !t.hasAttribute) return;
    if (t.hasAttribute("data-pco-type")) { st.type = t.value; st.plans = null; redraw(); try { st.plans = (await api("GET", "/pco/plans?serviceType=" + encodeURIComponent(st.type))).plans || []; } catch (err) { st.err = err.message; } redraw(); }
    if (t.hasAttribute("data-pco-file") && t.files && t.files[0]) {
      var f = t.files[0]; st.err = "";
      try { if (f.size > 240000) throw new Error("That file is too big for a plan."); var j = await api("POST", "/pco/import-file", { name: f.name, text: await f.text() }); done(j, "Made"); }
      catch (err) { st.err = err.message; }
      redraw();
    }
  });
  // after Connect: watch for the sign-in to finish (in the browser)
  setInterval(function () { if (st.watch > Date.now() && !(st.status && st.status.connected)) load(true); }, 4000);
  root.PPPlanningCenter = { settingsHtml: settingsHtml, inlineHtml: inlineHtml, load: load, state: function () { return st; } };
})(typeof window !== "undefined" ? window : null);
