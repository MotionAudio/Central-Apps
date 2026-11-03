// The website's Account page (10.2): Planning Center (connect the church's account, bring in a plan as a setlist, or
// import a plan from a file) and CCLI (the licence numbers, the copyright line on the lyric slides, and the report).
// Uses app.js's api(), me, esc() and toast().
(function () {
  "use strict";
  const W = { pco: null, plans: null, types: null, type: "", msg: "", err: "", busy: false, setlists: [], cc: null, report: null, ccMsg: "", ccErr: "" };
  const el = (id) => document.getElementById(id);
  const ymd = (d) => d.toISOString().slice(0, 10);
  const sixMonthsAgo = () => { const d = new Date(); d.setMonth(d.getMonth() - 6); return ymd(d); };

  // ---------------------------------------------------------------- Planning Center
  async function loadPco() {
    try { W.pco = await api("GET", "/pco/status"); } catch (e) { W.pco = { error: e.message }; }
    try { W.setlists = ((await api("GET", "/setlists")).setlists || []).filter((s) => s.pco); } catch (_) { W.setlists = []; }
    if (W.pco && W.pco.connected && W.pco.canImport && !W.types) { try { W.types = (await api("GET", "/pco/service-types")).serviceTypes; if (W.types.length && !W.type) W.type = W.types[0].id; } catch (e) { W.err = e.message; } }
    if (W.type && W.pco && W.pco.connected && W.pco.canImport) await loadPlans();
    drawPco();
  }
  async function loadPlans() { try { W.plans = (await api("GET", "/pco/plans?serviceType=" + encodeURIComponent(W.type))).plans; } catch (e) { W.err = e.message; W.plans = []; } }
  function missingHtml(list) {
    if (!list || !list.length) return "";
    return '<ul class="pco-miss">' + list.map((m) => "<li><b>" + esc(m.title) + '</b> <span class="muted">· ' + esc(m.why) + (m.trackId ? ' <a href="#buy-' + esc(m.trackId) + '">See it</a>' : "") + "</span></li>").join("") + "</ul>";
  }
  function drawPco() {
    const card = el("pcoCard"); if (!card) return;
    const p = W.pco || {};
    let top;
    if (p.error) top = '<p class="err">' + esc(p.error) + "</p>";
    else if (!p.configured) top = '<p class="muted pco-why" style="margin:0">' + esc(p.why) + "</p>";
    else if (!p.connected) top = (p.problem ? '<p class="err">' + esc(p.problem) + "</p>" : "") + (p.canConnect ? '<p class="muted pco-why" style="margin:0">Sign in with your church\'s Planning Center account. Your plans then come in as setlists, and follow along when they change.</p><button class="btn small" data-pco="connect">Connect Planning Center</button>' : '<p class="muted pco-why" style="margin:0">A main admin connects your church\'s Planning Center account. You can still import a plan from a file.</p>');
    else {
      top = '<p class="pco-why" style="margin:0">Connected to <b>' + esc(p.organization || "Planning Center") + "</b>" + (p.connectedBy ? ' <span class="muted">by ' + esc(p.connectedBy) + "</span>" : "") + "</p>" +
        (p.canImport && W.types ? '<div class="row" style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:end"><label>Service type<select data-pco="type">' + W.types.map((t) => '<option value="' + esc(t.id) + '"' + (t.id === W.type ? " selected" : "") + ">" + esc(t.name) + "</option>").join("") + "</select></label></div>" +
          (W.plans ? (W.plans.length ? '<table class="ktable"><tr><th>Plan</th><th>Items</th><th></th></tr>' + W.plans.map((x) => "<tr><td>" + esc(x.dates || x.title) + (x.title && x.dates ? ' <span class="muted">· ' + esc(x.title) + "</span>" : "") + "</td><td>" + (x.items || "") + '</td><td><button class="btn small' + (x.setlistId ? " ghost" : "") + '" data-pco-import="' + esc(x.id) + '"' + (W.busy ? " disabled" : "") + ">" + (x.setlistId ? "Update the setlist" : "Make a setlist") + "</button></td></tr>").join("") + "</table>" : '<p class="muted">No upcoming plans in this service type.</p>') : '<p class="muted">Loading the plans…</p>') : "") +
        (p.canConnect ? '<button class="btn ghost small" data-pco="disconnect">Disconnect</button>' : "");
    }
    const file = p.canImport !== false ? '<details' + (!p.connected ? " open" : "") + '><summary>Import a plan from a file</summary><p class="muted" style="margin:.3rem 0">In Planning Center, export the plan as a CSV (or copy the order of service into a text file, one item per line, like "4:30 Amazing Grace - G"). The songs come in with their keys, and the order of service and team with them.</p><input type="file" accept=".csv,.txt,.json,.tsv" data-pco="file"></details>' : "";
    const sets = W.setlists.length ? "<h4>Setlists from Planning Center</h4>" + W.setlists.slice(0, 12).map((s) => "<div>" + esc(s.name) + ' <span class="muted">· ' + (s.pco.source === "file" ? "from a file" : "follows the plan") + " · " + s.count + " song" + (s.count === 1 ? "" : "s") + "</span>" + (s.pco.source === "api" && p.connected ? ' <button class="btn ghost small" data-pco-refresh="' + esc(s.id) + '">Check for changes</button>' : "") + "</div>").join("") : "";
    card.innerHTML = "<h3>Planning Center</h3>" + top + file + (W.msg ? '<div class="pco-msg">' + W.msg + "</div>" : "") + (W.err ? '<p class="err">' + esc(W.err) + "</p>" : "") + sets;
  }
  function done(r, verb) {
    W.msg = "<p>" + verb + " <b>" + esc(r.setlist.name) + "</b>: " + r.songs + " song" + (r.songs === 1 ? "" : "s") + (r.matched ? ", " + r.matched + " ready to play" : "") + ". The apps show it under Load setlist.</p>" + missingHtml(r.missing);
    W.err = "";
  }
  document.addEventListener("click", async (e) => {
    const b = e.target.closest && e.target.closest("#pcoCard [data-pco], #pcoCard [data-pco-import], #pcoCard [data-pco-refresh]"); if (!b || b.tagName === "SELECT" || b.tagName === "INPUT") return;
    W.err = "";
    try {
      if (b.dataset.pco === "connect") { const r = await api("POST", "/pco/connect", { from: "web" }); location.href = r.url; return; }
      if (b.dataset.pco === "disconnect") { if (!confirm("Disconnect Planning Center? Setlists already made stay; they stop following their plans.")) return; await api("POST", "/pco/disconnect"); W.types = null; W.plans = null; toast("Planning Center is disconnected."); }
      if (b.dataset.pcoImport) { W.busy = true; drawPco(); const r = await api("POST", "/pco/import", { serviceType: W.type, plan: b.dataset.pcoImport }); done(r, "Made"); W.busy = false; }
      if (b.dataset.pcoRefresh) { const r = await api("POST", "/pco/refresh", { setlistId: b.dataset.pcoRefresh }); W.msg = "<p>" + (r.changed ? "The plan changed, so the setlist did too." : "Nothing changed in Planning Center.") + "</p>" + missingHtml(r.missing); }
    } catch (err) { W.err = err.message; W.busy = false; }
    await loadPco();
  });
  document.addEventListener("change", async (e) => {
    const t = e.target; if (!t.closest || !t.closest("#pcoCard")) return;
    if (t.dataset.pco === "type") { W.type = t.value; W.plans = null; drawPco(); await loadPlans(); drawPco(); }
    if (t.dataset.pco === "file" && t.files && t.files[0]) {
      const f = t.files[0]; W.err = "";
      try { if (f.size > 240000) throw new Error("That file is too big for a plan."); const r = await api("POST", "/pco/import-file", { name: f.name, text: await f.text() }); done(r, "Made"); }
      catch (err) { W.err = err.message; }
      await loadPco();
    }
  });

  // ---------------------------------------------------------------- CCLI
  async function loadCcli() { try { W.cc = await api("GET", "/ccli/settings"); } catch (e) { W.cc = { error: e.message }; } drawCcli(); }
  function drawCcli() {
    const card = el("ccliCard"); if (!card) return;
    const c = W.cc || {}, ed = c.canEdit, cr = c.credit || {};
    if (c.error) { card.innerHTML = '<h3>CCLI</h3><p class="err">' + esc(c.error) + "</p>"; return; }
    const dis = ed ? "" : " disabled";
    const rep = W.report ? (W.report.songs.length ? '<table class="ktable"><tr><th>Song</th><th>CCLI #</th><th>Shown</th><th>Printed</th><th>Recorded</th><th>Streamed</th></tr>' + W.report.songs.map((s) => "<tr><td>" + esc(s.title) + (s.authors ? '<br><span class="muted">' + esc(s.authors) + "</span>" : "") + "</td><td>" + (s.ccli ? esc(s.ccli) : '<span class="muted">none</span>') + "</td><td>" + (s.display || "") + "</td><td>" + (s.print || "") + "</td><td>" + (s.record || "") + "</td><td>" + (s.stream || "") + "</td></tr>").join("") + "</table>" +
      (W.report.missingCcli ? '<p class="muted">' + W.report.missingCcli + " song" + (W.report.missingCcli === 1 ? " has" : "s have") + " no CCLI number. Public-domain songs don't need one.</p>" : "") : '<p class="muted">Nothing was used from ' + esc(W.report.from) + " to " + esc(W.report.to) + ".</p>") : "";
    card.innerHTML = '<h3>CCLI</h3><p class="muted" style="margin:0">Your licence numbers go on the lyric slides with each song\'s copyright, and every song shown, streamed, recorded or printed is noted for your report.</p>' +
      '<div style="display:flex;gap:.5rem;flex-wrap:wrap"><label>CCLI licence number<input data-cc="license" inputmode="numeric" maxlength="12" value="' + esc(c.license || "") + '"' + dis + ' placeholder="e.g. 1234567"></label><label>Streaming licence number<input data-cc="streaming" inputmode="numeric" maxlength="12" value="' + esc(c.streaming || "") + '"' + dis + ' placeholder="if you stream"></label></div>' +
      '<label class="toggle"><input type="checkbox" data-cc="on"' + (cr.on !== false ? " checked" : "") + dis + "> Show the copyright line on the lyric screens</label>" +
      '<label>On<select data-cc="where"' + dis + ">" + [["first", "each song's first slide"], ["last", "each song's last slide"], ["every", "every slide"]].map((o) => '<option value="' + o[0] + '"' + ((cr.where || "first") === o[0] ? " selected" : "") + ">" + o[1] + "</option>").join("") + "</select></label>" +
      '<label>How it reads<input data-cc="template" value="' + esc(cr.template || "") + '"' + dis + '></label><p class="muted" style="margin:0;font-size:.85rem">{title}, {authors}, {copyright}, {ccli}, {license} and {streaming}. A part with nothing to show is left out.</p>' +
      (ed ? '<button class="btn small" data-cc="save">Save</button>' : '<p class="muted" style="margin:0">A main admin changes these.</p>') +
      '<h4>Report</h4><div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:end"><label>From<input type="date" data-cc="from" value="' + esc(W.from || sixMonthsAgo()) + '"></label><label>To<input type="date" data-cc="to" value="' + esc(W.to || ymd(new Date())) + '"></label><button class="btn small" data-cc="report">Show the report</button><button class="btn ghost small" data-cc="csv">Download the file for CCLI</button></div>' + rep +
      (c.partner && !c.partner.enabled ? '<p class="muted" style="font-size:.85rem">' + esc(c.partner.why) + "</p>" : "") +
      (W.ccMsg ? "<p>" + esc(W.ccMsg) + "</p>" : "") + (W.ccErr ? '<p class="err">' + esc(W.ccErr) + "</p>" : "");
  }
  document.addEventListener("change", (e) => { const t = e.target; if (!t.closest || !t.closest("#ccliCard")) return; if (t.dataset.cc === "from") W.from = t.value; if (t.dataset.cc === "to") W.to = t.value; });
  document.addEventListener("click", async (e) => {
    const b = e.target.closest && e.target.closest("#ccliCard button[data-cc]"); if (!b) return;
    const card = el("ccliCard"), v = (k) => { const x = card.querySelector('[data-cc="' + k + '"]'); return x ? (x.type === "checkbox" ? x.checked : x.value) : undefined; };
    W.ccErr = ""; W.ccMsg = ""; W.from = v("from") || W.from; W.to = v("to") || W.to;
    try {
      if (b.dataset.cc === "save") { W.cc = Object.assign(W.cc, await api("POST", "/ccli/settings", { license: v("license"), streaming: v("streaming"), credit: { on: v("on"), where: v("where"), template: v("template") } })); W.ccMsg = "Saved. The apps use it from their next check."; }
      if (b.dataset.cc === "report") W.report = await api("GET", "/ccli/report?from=" + encodeURIComponent(W.from || sixMonthsAgo()) + "&to=" + encodeURIComponent(W.to || ymd(new Date())));
      if (b.dataset.cc === "csv") {
        const r = await fetch("/v1/ccli/report?format=csv&from=" + encodeURIComponent(W.from || sixMonthsAgo()) + "&to=" + encodeURIComponent(W.to || ymd(new Date())), { headers: { Authorization: "Bearer " + token } });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "The report didn't download.");
        const a = document.createElement("a"); a.href = URL.createObjectURL(await r.blob()); a.download = "ccli-report-" + (W.from || sixMonthsAgo()) + "-to-" + (W.to || ymd(new Date())) + ".csv"; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        W.ccMsg = "Saved the file. Enter the songs and their counts on CCLI's reporting page.";
      }
    } catch (err) { W.ccErr = err.message; }
    drawCcli();
  });

  // ---------------------------------------------------------------- on the Account page
  function render() {
    const acct = document.querySelector("#acctBody .acct"); if (!acct || !me) return;
    const showPco = !me.church || me.church.role !== "user";
    if (showPco && !el("pcoCard")) { const d = document.createElement("div"); d.className = "card wide"; d.id = "pcoCard"; d.innerHTML = '<h3>Planning Center</h3><div class="muted">Loading…</div>'; acct.insertBefore(d, el("meCard")); }
    if (!el("ccliCard")) { const d = document.createElement("div"); d.className = "card wide"; d.id = "ccliCard"; d.innerHTML = '<h3>CCLI</h3><div class="muted">Loading…</div>'; acct.insertBefore(d, el("meCard")); }
    if (showPco) loadPco(); loadCcli();
  }
  // back from Planning Center's sign-in
  function back() {
    const m = /^#account-pco-(connected|failed)$/.exec(location.hash); if (!m) return;
    history.replaceState(null, "", "#account");
    setTimeout(() => { toast(m[1] === "connected" ? "Planning Center is connected. Pick a plan to make a setlist." : "Planning Center didn't connect. Try again, or import a plan from a file."); const a = el("account"); if (a) a.scrollIntoView(); }, 600);
  }
  back(); addEventListener("hashchange", back);
  window.MAWorship = { render };
  if (typeof me !== "undefined" && me) render();   // (the Account page drew before this file loaded)
})();
