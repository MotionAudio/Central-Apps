// The Account page's 10.3 cards (home page): My products (every product with its keys, the devices each is on with
// Release, the download, renewal or expiry, buy more), Help & tickets (your support tickets), and for Motion Audio
// staff: the Support desk (answer tickets; the answer goes by email), Status (the checks and incident notes) and
// How to edit the website. app.js's helpers are shared (classic scripts): api, me, esc, copyBtn, wireCopies, toast…
/* global api, me, esc, copyBtn, wireCopies, toast, dlLink, renewMine, longDate, dollars, planListText, cfg, PLATFORM */
(function () {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s);
  const SLUG = { P: "pedal-control", A: "control", U: "usage" };
  const date = (d) => (d ? new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "");
  const user = () => (typeof me !== "undefined" ? me : null);

  // ---------------------------------------------------------------- My products
  async function products(el) {
    let d, pk;
    try { [d, pk] = await Promise.all([api("GET", "/downloads"), api("GET", "/packages/mine").catch(() => ({ packages: [] }))]); }
    catch (e) { el.innerHTML = "<h3>My products</h3><div class=\"err\">" + esc(e.message) + "</div>"; return; }
    const u = user(), parts = [];
    for (const p of d.pedals || []) parts.push(`<div class="prod"><div class="prod-head"><img src="/brand/central-pedal.svg" alt=""><b>Central Pedal</b><span class="muted">ordered ${esc(date(p.ordered))}${p.held ? " · being checked before it ships" : p.shipsTo ? " · ships to " + esc(p.shipsTo) : ""}</span>
      <span class="acts"><a class="btn small ghost" href="/apps/pedal/">About it</a><button class="btn small ghost" type="button" data-add="pedal">Buy another</button></span></div>
      <p class="muted" style="margin:0;font-size:.9rem">No key: its software is on it and updates itself. <a href="/help/article.html?a=set-up-the-central-pedal">Set it up</a>.</p></div>`);
    for (const a of d.apps || []) {
      const dl = dlLink(a), renew = (k) => (k.renewable ? `<button class="btn small ghost" type="button" data-renew="${esc(k.key)}">Renew: ten more releases, ${dollars((d.renewalCents || 2000) / 100)}</button>` : "");
      const keys = a.keys.map((k) => `<div class="krow"><code>${esc(k.key)}</code>${copyBtn(k.key)}
        <span class="muted" style="font-size:.88rem">${k.trial ? "free trial" + (k.expiresAt ? " until " + esc(date(k.expiresAt)) : "") : k.expiresAt ? "until " + esc(date(k.expiresAt)) : k.updatesUntil === "forever" ? "yours for good, every update" : "updates through " + esc(k.updatesUntil)} · on ${k.inUse} device${k.inUse === 1 ? "" : "s"}</span>${renew(k)}
        ${(k.deviceNames || []).length ? `<div style="flex-basis:100%;display:grid;gap:.2rem">${k.deviceNames.map((n) => `<div class="dev"><span>${esc(n)}</span><button class="btn small ghost" type="button" data-rel="${esc(k.key)}" data-dev="${esc(n)}">Release</button></div>`).join("")}</div>` : k.inUse ? `<button class="btn small ghost" type="button" data-rel="${esc(k.key)}">Release all</button>` : ""}</div>`).join("");
      parts.push(`<div class="prod" data-app="${esc(a.kind)}"><div class="prod-head"><img src="/brand/${esc(a.icon)}.svg" alt=""><b>${esc(a.name)}</b><span class="muted">${esc(a.runsOn)} · ${esc(a.devices)} per key</span>
        <span class="acts">${dl ? `<a class="btn small" href="${esc(dl)}">Download</a>` : `<a class="btn small" href="/#downloads">Download</a>`}<a class="btn small ghost" href="/apps/${SLUG[a.kind]}/">Buy more</a></span></div>${keys}</div>`);
    }
    for (const p of pk.packages || []) {
      parts.push(`<div class="prod" data-pkg><div class="prod-head"><span class="sw" style="width:34px;height:34px;border-radius:8px;display:grid;place-items:center;background:var(--brass-hi);font-weight:700;font-size:.8rem">S</span><b>${esc(planListText(p.plans))}</b><span class="muted">${p.from === "church" ? "from " + esc(p.church || "your church") : p.from === "trial" ? "free trial" : "yours"} · ${p.ok ? (p.renews ? "renews " : "until ") + esc(date(p.end)) : esc(p.error || "ended")}</span>
        <span class="acts"><a class="btn small ghost" href="/#downloads">Download the libraries</a><a class="btn small ghost" href="/pricing/#plans">Buy more</a></span></div>
        <div class="krow"><code>${esc(p.key)}</code>${copyBtn(p.key)}<span class="muted" style="font-size:.88rem">on ${p.devices.length} of ${cfg.packageDevices || 3} devices, each a different app</span>
        ${p.devices.length ? `<div style="flex-basis:100%;display:grid;gap:.2rem">${p.devices.map((x) => `<div class="dev"><span>${esc(x.name)} <span class="muted">· ${esc(x.app)}</span></span><button class="btn small ghost" type="button" data-pkrel2="${esc(p.key)}" data-pkdev="${esc(x.id)}">Release</button></div>`).join("")}</div>` : ""}</div></div>`);
    }
    if (u && u.subscribed) parts.push(`<div class="prod"><div class="prod-head"><span class="sw" style="width:34px;height:34px;border-radius:8px;display:grid;place-items:center;background:var(--brass-hi);font-weight:700;font-size:.8rem">Tr</span><b>Central Tracks Unlimited</b><span class="muted">monthly · active</span><span class="acts"><a class="btn small ghost" href="/#tracks">Add tracks</a><button class="btn small ghost" type="button" data-bill>Manage</button></span></div></div>`);
    el.innerHTML = `<h3>My products</h3><p class="muted" style="margin:0;font-size:.92rem">Everything you own or your church gave you: the keys (they're in your email too), where each one is in use, the downloads, and when it renews.</p>
      ${parts.length ? `<div style="display:grid;gap:.7rem">${parts.join("")}</div>` : `<p style="margin:0">Nothing yet. <a href="/pricing/">See plans and prices</a>, or ask your church's main admin to give you a key.</p>`}<div class="err" id="prodErr"></div>`;
    wireCopies(el);
  }
  document.addEventListener("click", async (e) => {
    const card = e.target.closest("#productsCard"); if (!card) return;
    const rel = e.target.closest("[data-rel]"), pr = e.target.closest("[data-pkrel2]"), rn = e.target.closest("[data-renew]"), bill = e.target.closest("[data-bill]");
    const err = (m) => { const x = $("#prodErr"); if (x) x.textContent = m; };
    if (rel) {
      if (!confirm(rel.dataset.dev ? "Release " + rel.dataset.dev + "? The app there asks for a key the next time it opens." : "Release every device using this key?")) return;
      try { await api("POST", "/church/release", { key: rel.dataset.rel, device: rel.dataset.dev || undefined }); toast("Released. Type the key on the device you want."); products(card); } catch (x) { err(x.message); }
    }
    if (pr) {
      if (!confirm("Release this package from that device? Its sounds stop there until the key is added again.")) return;
      try { await api("POST", "/packages/release", { key: pr.dataset.pkrel2, device: pr.dataset.pkdev }); toast("Released."); products(card); } catch (x) { err(x.message); }
    }
    if (rn) renewMine([rn.dataset.renew]);
    if (bill) { try { location.href = (await api("POST", "/billing")).url; } catch (x) { err(x.message); } }
  });

  // ---------------------------------------------------------------- Help & tickets
  const STATUS = { open: "Open", waiting: "Waiting for you", closed: "Closed" };
  async function tickets(el) {
    let r; try { r = await api("GET", "/support/mine"); } catch (e) { el.innerHTML = "<h3>Help &amp; tickets</h3><div class=\"err\">" + esc(e.message) + "</div>"; return; }
    el.innerHTML = `<h3>Help &amp; tickets</h3>${r.tickets.length ? `<div style="display:grid;gap:.4rem">${r.tickets.map((t) => `<a class="tm" href="/help/ticket.html#${esc(t.token)}" style="text-decoration:none;color:inherit"><span><span class="tstat ${esc(t.status)}">${esc(STATUS[t.status] || t.status)}</span> <b>${esc(t.subject || "Support")}</b> <span class="muted">· #${t.id} · ${esc(date(t.updated))}${t.replies.length ? " · " + t.replies.length + " answer" + (t.replies.length === 1 ? "" : "s") : ""}</span></span><span class="muted">Open →</span></a>`).join("")}</div>`
      : `<p class="muted" style="margin:0">No tickets. When you write to us, it shows here with our answers.</p>`}
      <div style="display:flex;gap:.5rem;flex-wrap:wrap"><a class="btn small" href="/help/#contact">Contact support</a><a class="btn small ghost" href="/help/">Help Center</a><a class="btn small ghost" href="/status/">Status</a></div>`;
  }

  // ---------------------------------------------------------------- staff: the Support desk
  let deskStatus = "open", deskOpen = 0;
  async function desk(el) {
    let r; try { r = await api("GET", "/admin/support" + (deskStatus === "all" ? "" : "?status=" + deskStatus)); } catch (e) { el.innerHTML = "<h3>Support · Motion Audio staff</h3><div class=\"err\">" + esc(e.message) + "</div>"; return; }
    const c = r.counts || {}, tab = (k, label, n) => `<button class="btn small${deskStatus === k ? "" : " ghost"}" type="button" data-dtab="${k}">${label}${n != null ? " (" + n + ")" : ""}</button>`;
    const when = (d) => new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    el.innerHTML = `<h3>Support · Motion Audio staff</h3>
      <p class="muted" style="margin:0;font-size:.92rem">Every Contact support message is a ticket. Answer here: it goes to the person by email from ${esc(cfg.supportEmail || "support@")} with a link to answer on the website (the website can't receive email, so their answers come back here through that link; a reply to the email lands in the support inbox).${r.mailOn ? "" : " <b>Email isn't set up on this server:</b> answers only show on the website."}</p>
      <div style="display:flex;gap:.4rem;flex-wrap:wrap">${tab("open", "Open", c.open || 0)}${tab("waiting", "Waiting", c.waiting || 0)}${tab("closed", "Closed", c.closed || 0)}${tab("all", "All")}</div>
      ${r.tickets.length ? r.tickets.map((t) => `<details class="tk" data-tk="${t.id}"${deskOpen === t.id ? " open" : ""} style="border:1px solid var(--line);border-radius:var(--r-sm);padding:.6rem .8rem"><summary style="cursor:pointer"><span class="tstat ${esc(t.status)}">${esc(t.status)}</span> <b>${esc(t.subject || "(no subject)")}</b> <span class="muted">· #${t.id} · ${esc(t.name || "")} &lt;${esc(t.email)}&gt; · ${esc(t.app || "")} · ${esc(when(t.updated))}</span></summary>
        <div style="display:grid;gap:.5rem;margin-top:.6rem"><div class="msg"><small>${esc(t.name || t.email)} · ${esc(when(t.created))}${t.version ? " · " + esc(t.version) : ""}</small>${esc(t.message)}</div>
        ${t.replies.map((x) => `<div class="msg${x.from_staff ? " staff" : ""}"><small>${esc(x.author || (x.from_staff ? "Motion Audio" : t.email))} · ${esc(when(x.created_at))}</small>${esc(x.message)}</div>`).join("")}
        <label>Answer<textarea rows="4" data-ans></textarea></label>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center"><select data-st style="width:auto"><option value="waiting">then: waiting for them</option><option value="closed">then: closed</option><option value="open">then: still open</option></select><button class="btn small" type="button" data-send>Send answer</button><button class="btn small ghost" type="button" data-close-tk>${t.status === "closed" ? "Reopen" : "Close without answering"}</button><a class="btn small ghost" href="mailto:${esc(t.email)}?subject=${encodeURIComponent("Re: " + (t.subject || "Support"))}">Email them</a></div><div class="err" data-terr></div></div></details>`).join("") : `<p class="muted" style="margin:0">Nothing ${deskStatus === "all" ? "yet" : deskStatus}.</p>`}`;
  }
  document.addEventListener("click", async (e) => {
    const el = e.target.closest("#supportDeskCard"); if (!el) return;
    const tab = e.target.closest("[data-dtab]"); if (tab) { deskStatus = tab.dataset.dtab; return desk(el); }
    const tk = e.target.closest("[data-tk]"); if (!tk) return;
    const id = Number(tk.dataset.tk), errEl = $("[data-terr]", tk);
    if (e.target.closest("[data-send]")) {
      const msg = $("[data-ans]", tk).value.trim(); if (!msg) { errEl.textContent = "Write the answer first."; return; }
      try { const r = await api("POST", "/admin/support/" + id + "/reply", { message: msg, status: $("[data-st]", tk).value }); toast(r.sent ? "Sent by email." : "Saved. Email isn't set up, so they'll see it on the website."); deskOpen = id; desk(el); } catch (x) { errEl.textContent = x.message; }
    }
    if (e.target.closest("[data-close-tk]")) { try { await api("POST", "/admin/support/" + id + "/reply", { status: tk.querySelector(".tstat").textContent === "closed" ? "open" : "closed" }); desk(el); } catch (x) { errEl.textContent = x.message; } }
  });

  // ---------------------------------------------------------------- staff: status
  async function statusCard(el) {
    let r; try { r = await api("GET", "/status"); } catch (e) { el.innerHTML = "<h3>Status · Motion Audio staff</h3><div class=\"err\">" + esc(e.message) + "</div>"; return; }
    const W = { up: "working", degraded: "slow", down: "down", off: "not set up", unknown: "not checked yet" };
    el.innerHTML = `<h3>Status · Motion Audio staff</h3><div style="display:flex;gap:.4rem;flex-wrap:wrap">${r.services.map((s) => `<span class="chip">${esc(s.label)}: ${esc(W[s.state] || s.state)}</span>`).join("")}</div>
      <p class="muted" style="margin:0;font-size:.92rem">${(r.incidents || []).filter((i) => i.state === "open").length} open incident note(s). The public page shows these checks (every ${r.everyMin || 3} minutes) and your notes.</p>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap"><a class="btn small" href="/status/">Open the status page (post a note there)</a><button class="btn small ghost" type="button" data-runchk>Check everything now</button></div>`;
  }
  document.addEventListener("click", async (e) => { const b = e.target.closest("#statusCard [data-runchk]"); if (!b) return; try { await api("POST", "/admin/status/check", {}); statusCard($("#statusCard")); toast("Checked."); } catch (x) { toast(x.message); } });

  // ---------------------------------------------------------------- staff: how to edit the website
  async function editHow(el) {
    let review = ""; try { review = (await api("GET", "/review/link")).url; } catch (_) { }
    const item = (t, p, a) => `<div><b>${t}</b><p>${p}</p>${a || ""}</div>`;
    el.innerHTML = `<h3>How to edit the website · Motion Audio staff</h3>
      <div class="edit-how">
        ${item("Edit this page", "Any page: press <b>Edit this page</b> at the bottom left. Click words to change them, click a picture to swap it, hide a section or add one (text, questions, quotes, a picture). Press <b>Save</b>.", '<a class="btn small ghost" href="/">Go to the home page</a>')}
        ${item("Prices", "Here on your Account page: <b>Staff → Prices</b>. Change a price, hide something, or start a sale. Prices in edit mode on the Pricing page work too.", '<button class="btn small ghost" type="button" data-jump="#pricesCard">Go to Prices</button>')}
        ${item("Codes", "<b>Staff → Codes</b>: discount codes (a percent off, which items, how many uses, until when) and free-trial codes.", "")}
        ${item("Help articles", "On the Help page, press <b>Write and edit guides</b>: new guides, headings, text, steps, pictures and videos (upload one, or paste a YouTube link). Use the arrows to reorder. Each guide has <b>Edit this guide</b> too.", '<a class="btn small ghost" href="/help/#guides">Help guides</a>')}
        ${item("The review site", "Listen to and grade everything people upload, approve or reject it, and take things down. Keep the address to yourself.", review ? `<a class="btn small ghost" href="${esc(review)}">Open the review site</a>` : "")}
        ${item("Review admins and editors", "The main admin chooses the review admins on the review site's Settings. <b>Staff → Website editors</b> lets other people edit the website's words and pictures.", "")}
      </div>
      <p class="muted" style="margin:0;font-size:.88rem">Support tickets are on the <b>Support</b> card; the status page's notes on <b>Status</b>.</p>`;
  }

  // ---------------------------------------------------------------- put them on the page
  function add(first, id, cls, title, fill, after) {
    if ($("#" + id)) return;
    const d = document.createElement("div"); d.className = cls; d.id = id; d.innerHTML = "<h3>" + title + '</h3><div class="muted">Loading…</div>';
    first.appendChild(d); fill(d);
  }
  function addCards() {
    const u = user(), first = $("#acctBody .acct"); if (!u || !first) return;
    add(first, "productsCard", "card wide", "My products", products);
    add(first, "helpCard", "card wide", "Help &amp; tickets", tickets);
    if (u.admin) {
      add(first, "supportDeskCard", "card wide", "Support · Motion Audio staff", desk);
      add(first, "statusCard", "card wide", "Status · Motion Audio staff", statusCard);
      add(first, "editHowCard", "card wide", "How to edit the website · Motion Audio staff", editHow);
    }
    // #account-products and #account-help go straight to their section
    const want = { "#account-products": "#acct-products", "#account-help": "#acct-help" }[location.hash];
    if (want && !document.body.dataset.jumped) setTimeout(() => { const s = $(want); if (s && !s.hidden) { document.body.dataset.jumped = "1"; s.scrollIntoView({ block: "start" }); } }, 300);
  }
  addEventListener("hashchange", () => {
    delete document.body.dataset.jumped;
    // (coming back to them: fresh - a key may be on another device by now, a ticket may have an answer)
    if (location.hash === "#account-products" && $("#productsCard")) products($("#productsCard"));
    if (location.hash === "#account-help" && $("#helpCard")) tickets($("#helpCard"));
    addCards();
  });
  document.addEventListener("click", (e) => { const j = e.target.closest("[data-jump]"); if (!j) return; const t = $(j.dataset.jump); if (t) t.scrollIntoView({ behavior: "smooth", block: "start" }); });
  let busy = false;
  function start() {
    const b = $("#acctBody"); if (!b) return;
    new MutationObserver(() => { if (busy) return; busy = true; requestAnimationFrame(() => { try { addCards(); if (window.MAAccountNav) window.MAAccountNav.refresh(); } finally { busy = false; } }); }).observe(b, { childList: true, subtree: true });
    addCards();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
