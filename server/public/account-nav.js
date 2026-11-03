// The Account page in sections (10.2): a sidebar of sections, each with its cards, so things are easy to find.
// app.js and worship.js draw the cards into "#acctBody .acct" as before; this moves each card into its section by its
// id as it appears. The first section (Overview) is that same ".acct", so code that adds cards next to #meCard still
// works. Also adds the cards the website didn't have: Billing, Shorts connections and Projects.
(function () {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s);
  const escH = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // section id → its title and the cards it holds (by id); staff only shows for staff
  const SECTIONS = [
    ["overview", "Overview", ["acctSummary", "meCard"]],
    ["purchases", "Purchases & downloads", ["keysCard"]],
    ["packages", "Packages & keys", ["pkgCard"]],
    ["team", "Your church & team", ["churchCard", "teamsCard"]],
    ["services", "Central Services", ["slotsCard"]],
    ["worship", "Planning Center & CCLI", ["pcoCard", "ccliCard"]],
    ["shorts", "Shorts connections", ["shortsCard"]],
    ["projects", "Projects", ["projectsCard"]],
    ["tracks", "Central Tracks & publishing", ["tracksCard", "libCard", "pubCard", "connectBox"]],
    ["billing", "Billing", ["billingCard"]],
    ["staff", "Staff", ["staffCard", "reviewCard", "opsCard", "saleCard", "pricesCard", "codesCard", "relCard", "editorsCard", "defKeysCard"]],
  ];
  const home = {}; SECTIONS.forEach(([k, , ids]) => ids.forEach((id) => (home[id] = k)));
  // app.js's own helpers (it's a classic script, so its top-level names are shared with this one)
  const call = (m, p, b) => api(m, p, b);   // eslint-disable-line no-undef
  const signedIn = () => (typeof me !== "undefined" ? me : null);   // eslint-disable-line no-undef

  function shell() {
    const body = $("#acctBody"), first = body && $(".acct", body);
    if (!first || first.dataset.sectioned) return first;
    first.dataset.sectioned = "1";
    const wrap = document.createElement("div"); wrap.className = "acct-shell";
    const side = document.createElement("nav"); side.className = "acct-side"; side.setAttribute("aria-label", "Account sections");
    const main = document.createElement("div"); main.className = "acct-main";
    body.insertBefore(wrap, first); wrap.append(side, main);
    for (const [k, title] of SECTIONS) {
      const sec = document.createElement("div"); sec.className = "acct-sec"; sec.setAttribute("role", "region"); sec.setAttribute("aria-label", title); sec.id = "acct-" + k; sec.hidden = true;
      sec.innerHTML = '<h3 class="acct-sec-h">' + escH(title) + "</h3>";
      if (k === "overview") { first.classList.add("acct-cards"); sec.appendChild(first); }
      else { const g = document.createElement("div"); g.className = "acct acct-cards"; sec.appendChild(g); }
      main.appendChild(sec);
    }
    return first;
  }
  function place() {
    const first = shell(); if (!first) return;
    // a card that turned up: into its section (unknown ones stay in Overview)
    document.querySelectorAll("#acctBody .card").forEach((c) => {
      const k = home[c.id]; if (!k || k === "overview") return;
      const g = $("#acct-" + k + " .acct-cards"); if (g && c.parentNode !== g) g.appendChild(c);
    });
    // the payouts box Stripe draws has no id: it belongs with publishing
    first.querySelectorAll(":scope > div:not(.card):not([id])").forEach((d) => { if (/payout|connect/i.test(d.className || "") || d.querySelector("iframe")) { d.id = "connectBox"; const g = $("#acct-tracks .acct-cards"); if (g) g.appendChild(d); } });
    // only sections with something in them, and their links
    const side = $(".acct-side"); if (!side) return;
    const links = [];
    for (const [k, title] of SECTIONS) {
      const sec = $("#acct-" + k), has = !!(sec && sec.querySelector(".card"));
      if (sec) sec.hidden = !has;
      if (has) links.push('<a href="#acct-' + k + '" data-sec="' + k + '">' + escH(title) + "</a>");
    }
    const html = links.join("");
    if (side.dataset.html !== html) { side.innerHTML = html; side.dataset.html = html; }
  }
  // the sidebar: jumps without changing the page's #account address, and marks where you are
  document.addEventListener("click", (e) => {
    const a = e.target.closest(".acct-side a[data-sec]"); if (!a) return;
    e.preventDefault(); const sec = $("#acct-" + a.dataset.sec); if (sec) sec.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  });
  let spy = null;
  function watchSections() {
    if (spy || !("IntersectionObserver" in window)) return;
    spy = new IntersectionObserver((ents) => {
      ents.forEach((en) => { if (en.isIntersecting) document.querySelectorAll(".acct-side a").forEach((a) => a.classList.toggle("on", "acct-" + a.dataset.sec === en.target.id)); });
    }, { rootMargin: "-90px 0px -65% 0px" });
    document.querySelectorAll(".acct-sec").forEach((s) => spy.observe(s));
  }

  // ---- the cards this page adds -----------------------------------------------------------------------------------
  function summaryCard(u) {
    const ch = u.church, role = ch ? ({ church: "Church account", owner: "Main admin", admin: "Admin", user: "Musician" }[ch.role] || ch.role) : "Personal account";
    return '<h3>Hello' + (u.name ? ", " + escH(u.name) : "") + "</h3>" +
      '<div class="sum-row"><span>' + escH(u.email) + "</span>" + (ch ? '<span class="chip">' + escH(ch.name || "Your church") + "</span>" : "") + '<span class="chip">' + escH(role) + "</span>" + (u.subscribed ? '<span class="chip on">Central Tracks Unlimited</span>' : "") + "</div>" +
      '<div class="sum-links"><a class="btn small" href="#downloads">Download the apps</a><a class="btn small ghost" href="#purchases">Purchases and keys</a>' + (ch ? '<a class="btn small ghost" href="/services/">Open Central Services</a>' : "") + '<a class="btn small ghost" href="/production/">Open Central Production</a></div>';
  }
  function billingCard(u) {
    const main = u.church && (u.church.role === "church" || u.church.role === "owner");
    return "<h3>Billing</h3>" +
      '<p class="muted" style="margin:0">Cards, receipts and renewals are handled by Stripe. Every price includes tax.</p>' +
      '<div class="sum-links">' + (main ? '<button class="btn small" type="button" data-bill="church">Church card and receipts</button>' : "") +
      '<button class="btn small ghost" type="button" data-bill="me">My plans and subscriptions</button></div><div class="err" id="billErr"></div>';
  }
  async function shortsCard(el) {
    let r = null; try { r = await call("GET", "/social/status"); } catch (e) { el.innerHTML = "<h3>Shorts connections</h3><p class=\"muted\" style=\"margin:0\">" + escH(e.message) + "</p>"; return; }
    const names = { youtube: "YouTube", facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok" };
    const rows = Object.entries(r.platforms || {}).map(([k, p]) => '<div class="conn"><b>' + names[k] + "</b>" +
      (p.connected ? '<span class="chip on">Connected' + (p.account ? " · " + escH(p.account) : "") + "</span>" : p.available ? '<span class="chip">Not connected</span>' : '<span class="chip off">Coming soon</span>') + "</div>").join("");
    el.innerHTML = "<h3>Shorts connections</h3><p class=\"muted\" style=\"margin:0\">Where Central Control posts your church's approved shorts. Connect or disconnect in Central Control → Shorts → Settings; this shows what's connected.</p>" + '<div class="conns">' + rows + "</div>";
  }
  async function projectsCard(el) {
    let r = null; try { r = await call("GET", "/projects"); } catch (e) { el.innerHTML = "<h3>Projects</h3><p class=\"muted\" style=\"margin:0\">" + escH(e.message) + "</p>"; return; }
    const mb = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + " GB" : Math.max(0, Math.round((n || 0) / 1e6)) + " MB");
    const list = r.projects || [];
    el.innerHTML = '<h3>Projects <span class="muted">· ' + mb(r.used) + " of " + mb(r.limit) + " used</span></h3>" +
      (list.length ? '<div class="proj">' + list.slice(0, 12).map((p) => '<a href="/production/#open-' + encodeURIComponent(p.id) + '"><b>' + escH(p.name) + '</b><span class="muted">' + escH(p.type || "project") + " · " + new Date(p.updated || p.updatedAt || Date.now()).toLocaleDateString() + "</span></a>").join("") + "</div>" + (list.length > 12 ? '<p class="muted" style="margin:0">And ' + (list.length - 12) + " more in Central Production.</p>" : "")
        : '<p class="muted" style="margin:0">Nothing saved to your account yet. Projects you save in Central Production (the app or the website) show up here.</p>') +
      '<div class="sum-links"><a class="btn small" href="/production/">Open Central Production</a></div>';
  }
  function addCards() {
    const u = signedIn(), first = $("#acctBody .acct"); if (!u || !first) return;
    const add = (id, cls, html) => { if ($("#" + id)) return null; const d = document.createElement("div"); d.className = cls; d.id = id; d.innerHTML = html; first.insertBefore(d, first.firstChild && first.firstChild.classList && first.firstChild.classList.contains("confirm-card") ? first.firstChild.nextSibling : first.firstChild); return d; };
    add("acctSummary", "card wide acct-summary", summaryCard(u));
    const b = add("billingCard", "card wide", billingCard(u));
    if (b) b.addEventListener("click", async (e) => {
      const t = e.target.closest("[data-bill]"); if (!t) return;
      try { location.href = (await call("POST", t.dataset.bill === "church" ? "/church/billing" : "/billing")).url; }
      catch (err) { const m = $("#billErr"); if (m) m.textContent = err.message; }
    });
    const s = add("shortsCard", "card", "<h3>Shorts connections</h3><div class=\"muted\">Loading…</div>"); if (s && u.church && u.church.role !== "user") shortsCard(s); else if (s) s.remove();
    const p = add("projectsCard", "card", "<h3>Projects</h3><div class=\"muted\">Loading…</div>"); if (p) projectsCard(p);
  }

  let busy = false;
  const mo = new MutationObserver(() => { if (busy) return; busy = true; requestAnimationFrame(() => { try { addCards(); place(); watchSections(); } finally { busy = false; } }); });
  function start() { const b = $("#acctBody"); if (!b) return; mo.observe(b, { childList: true, subtree: true }); addCards(); place(); watchSections(); }
  window.MAAccountNav = { refresh() { addCards(); place(); } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
