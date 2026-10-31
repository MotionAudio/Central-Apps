// Motion Audio website: store, Central Tracks library, publishing and accounts, all through the /v1 API.
"use strict";
const $ = (s) => document.querySelector(s);
const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const TIER = { 1: 5, 2: 10, 3: 15, 4: 20, 5: 30 };
const starHtml = (n) => `<span class="stars" aria-label="${n} of 5 stars">${"★".repeat(n)}<span class="off">${"★".repeat(5 - n)}</span></span>`;

let token = null; try { token = localStorage.getItem("ma-token"); } catch {}
let me = null, cfg = { payments: false }, tracks = [];
const cart = {};

async function api(method, path, body) {
  const h = { "Content-Type": "application/json" }; if (token) h.Authorization = "Bearer " + token;
  const r = await fetch("/v1" + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && token && path !== "/login") { setToken(null); }
  if (!r.ok && r.status !== 402) { const e = new Error(j.error || "The server answered " + r.status + "."); e.status = r.status; throw e; }
  return Object.assign(j, { _status: r.status });
}
function setToken(t) { token = t; try { t ? localStorage.setItem("ma-token", t) : localStorage.removeItem("ma-token"); } catch {} if (window.SiteContent && window.SiteContent.checkEditor) window.SiteContent.checkEditor(); }

function toast(m) { document.querySelectorAll(".toast").forEach((t) => t.remove()); const d = document.createElement("div"); d.className = "toast"; d.setAttribute("role", "status"); d.textContent = m; document.body.appendChild(d); setTimeout(() => d.remove(), 3200); }   // (one at a time: a new one replaces the last)
function modal(html) {
  $("#modalHost").innerHTML = `<div class="modal-bg"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  $("#modalHost .modal-bg").addEventListener("click", (e) => { if (e.target.classList.contains("modal-bg") || e.target.closest("[data-close]")) closeModal(); });
}
function closeModal() { $("#modalHost").innerHTML = ""; }
function go(url) { location.href = url; }
function paymentsSoon() { modal(`<h3>Almost ready</h3><p class="muted" style="margin:0">We're finishing setting up checkout. Please check back soon, or write to us and we'll sort out your order by hand.</p><button class="btn" data-close>OK</button>`); }
// this browser's id: an admin's code is asked once per device (then trusted 30 days)
function deviceId() {
  try { let d = localStorage.getItem("ma-device"); if (!d) { d = "web-" + Array.from(crypto.getRandomValues(new Uint8Array(12)), (x) => x.toString(16).padStart(2, "0")).join(""); localStorage.setItem("ma-device", d); } return d; } catch { return ""; }
}
// the main admin and admins: email, password, then a code sent to their phone (the first time, they add the phone)
function finishSignIn(r) {
  if (!r || r.token || !r.step) return Promise.resolve(r);
  return new Promise((resolve, reject) => {
    let st = r, done = false;
    const draw = (err) => {
      if (st.step === "phone") modal(`<h3>Add your phone</h3><p class="muted" style="margin:0">Because you look after your church's account, a new device needs a code from your phone too. It keeps your church safe. Which mobile number should we text?</p>
        <form id="tsForm" style="background:none;border:0;padding:0"><label>Mobile number<input id="tsPhone" type="tel" autocomplete="tel" placeholder="555-123-4567" required></label>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn">Send the code</button><button class="btn ghost" type="button" data-close>Cancel</button></div><div class="err">${esc(err || "")}</div></form>`);
      else modal(`<h3>Enter the code${st.both ? "s" : ""}</h3><p class="muted" style="margin:0">We ${st.by === "email" ? "emailed" : "texted"} a 6-digit code to <b>${esc(st.to)}</b>${st.both ? " and emailed another to you (adding a phone takes both)" : ""}. They work for 10 minutes.</p>
        <form id="tsForm" style="background:none;border:0;padding:0"><label>${st.both ? "Code from the text" : "Code"}<input id="tsCode" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required style="font:600 1.3rem var(--mono);letter-spacing:.2em"></label>
        ${st.both ? `<label>Code from the email<input id="tsECode" inputmode="numeric" maxlength="7" required style="font:600 1.3rem var(--mono);letter-spacing:.2em"></label>` : ""}
        <label style="display:flex;gap:.4rem;align-items:center;font-size:.92rem"><input type="checkbox" id="tsTrust" checked style="width:auto"> Trust this device for 30 days</label>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn">Sign in</button><button class="btn ghost" type="button" id="tsAgain">Send again</button><button class="btn ghost" type="button" data-close>Cancel</button></div><div class="err">${esc(err || "")}</div></form>`);
      const host = $("#modalHost .modal-bg");
      host.addEventListener("click", (e) => { if (!done && (e.target === host || e.target.closest("[data-close]"))) { done = true; reject(new Error("Signing in was cancelled.")); } });
      if ($("#tsAgain")) $("#tsAgain").onclick = async () => { try { st = Object.assign(st, await api("POST", "/login/resend", { ticket: st.ticket })); draw("A new code is on its way."); } catch (e) { draw(e.message); } };
      $("#tsForm").onsubmit = async (e) => {
        e.preventDefault();
        try {
          if (st.step === "phone") { st = Object.assign(st, await api("POST", "/login/phone", { ticket: st.ticket, phone: $("#tsPhone").value })); return draw(); }
          const t = await api("POST", "/login/code", { ticket: st.ticket, code: $("#tsCode").value, emailCode: $("#tsECode") ? $("#tsECode").value : undefined, trust: $("#tsTrust").checked });
          done = true; closeModal(); resolve(Object.assign({}, r, { token: t.token, step: undefined }));
        } catch (err) { draw(err.message); }
      };
      const f = $("#tsPhone") || $("#tsCode"); if (f) f.focus();
    };
    draw();
  });
}
// what goes wrong on these pages is reported (at most 10 a page; the same one once)
(function () {
  const sent = new Set(); let n = 0;
  function report(message, stack) {
    const k = String(message).slice(0, 200); if (!message || sent.has(k) || n >= 10) return; sent.add(k); n++;
    try { fetch("/v1/errors", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: "website", message: String(message).slice(0, 500), stack: String(stack || "").slice(0, 4000), url: location.pathname + location.hash.split("-")[0], platform: navigator.userAgent }) }).catch(() => {}); } catch {}
  }
  addEventListener("error", (e) => report(e.message || "Script error", e.error && e.error.stack));
  addEventListener("unhandledrejection", (e) => { const x = e.reason || {}; if (x.status) return; report("Unhandled: " + (x.message || String(x)), x.stack); });   // (answers from the server with an error are shown, not reported)
})();
function supportForm(note) {
  modal(`<h3>Talk to us</h3><p class="muted" style="margin:0">${esc(note || "Tell us what's going on. A real person on our team reads every message and writes back by email.")}${cfg.supportEmail ? ` Or email <a href="mailto:${esc(cfg.supportEmail)}">${esc(cfg.supportEmail)}</a>.` : ""}</p>
    <form id="spForm" style="background:none;border:0;padding:0"><label>Your name<input id="spName" value="${esc(me ? me.name : "")}"></label><label>Your email<input id="spEmail" type="email" required value="${esc(me ? me.email : "")}"></label>
    <label>About<input id="spSubject" placeholder="Pairing, keys, billing…"></label><label>What's going on?<textarea id="spMsg" rows="5" required></textarea></label>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn">Send</button><button class="btn ghost" type="button" data-close>Cancel</button></div><div class="err" id="spErr"></div></form>`);
  $("#spForm").onsubmit = async (e) => {
    e.preventDefault();
    try { const r = await api("POST", "/support", { name: $("#spName").value, email: $("#spEmail").value, subject: $("#spSubject").value, message: $("#spMsg").value, app: "Website", platform: navigator.userAgent.slice(0, 120) }); modal(`<h3>Thanks</h3><p style="margin:0">${esc(r.message)}</p><button class="btn" data-close>OK</button>`); }
    catch (err) { $("#spErr").textContent = err.message; }
  };
}
function needSignIn(why) { location.hash = "account"; renderAccount(why || "Sign in or make an account to continue."); }

// ---------------------------------------------------------------- the payment form (Stripe, on this page)
// Checkout Studio's embedded form (ui_mode "form"): the server starts a Checkout Session and answers its client secret;
// Stripe's form opens in a window here. When it's paid, Stripe sends the browser back to the page (#order-done-…).
const APPEARANCE = { theme: "stripe", labels: "auto", inputs: "spaced", variables: { borderRadius: "6px", colorBackground: "#ffffff", colorPrimary: "#12161C", colorText: "#12161C", colorTextSecondary: "#434C59", colorDanger: "#B42318", colorSuccess: "#1E7A4C", fontFamily: '"Helvetica Neue", Arial, system-ui, sans-serif', fontSizeBase: "16px", spacingUnit: "4px" } };
let stripeJs = null;
async function stripeReady() { for (let i = 0; i < 60 && !window.Stripe; i++) await new Promise((r) => setTimeout(r, 100)); return window.Stripe; }
async function openCheckout(title, sub, getSecret) {
  if (!cfg.payments || !cfg.publishableKey) return paymentsSoon();
  modal(`<div class="pay-head"><h3>${esc(title)}</h3>${sub ? `<p class="muted" style="margin:0">${sub}</p>` : ""}</div><div id="checkout-form"><p class="muted">Loading the secure payment form…</p></div><div class="err" id="payErr"></div>
    <div class="pay-foot"><span class="muted">Payments by <b>Stripe</b>. We never see your card.</span><button class="btn ghost small" data-close>Cancel</button></div>`);
  $(".modal").classList.add("pay");
  const fail = (e) => { const el = $("#payErr"); if (el) el.textContent = (e && e.message) || "Payment didn't go through. Try again."; };
  if (!(await stripeReady())) return fail(new Error("The payment form couldn't load. Check your connection, or turn off a blocker for this site, then try again."));
  stripeJs = stripeJs || window.Stripe(cfg.publishableKey);
  try {
    const clientSecret = getSecret().then((r) => { if (!r.clientSecret) throw new Error(r.error || "Couldn't start checkout."); return r.clientSecret; });
    clientSecret.catch(fail);
    const checkout = stripeJs.initCheckoutFormSdk({ clientSecret, appearance: APPEARANCE });
    const form = checkout.createForm({ layout: "expanded" });
    $("#checkout-form").innerHTML = ""; form.mount("#checkout-form");
    const res = await checkout.loadActions();
    if (res.type !== "success") return fail(res.error || new Error("Couldn't load the payment form."));
    form.on("confirm", async (event) => {
      try { const r = await res.actions.confirm({ formConfirmEvent: event }); if (r && r.type === "error") fail(r.error); } catch (err) { fail(err); }
    });
  } catch (e) { fail(e); }
}

// ---------------------------------------------------------------- store
// prices and what's in each pack come from the server (/config: the staff price page changes them); these are the words
// around them. A pack: 1 main admin + admins (A keys, Central Control), users (U keys, Central Usage), 1 Central Pedal
// Control (P key) and Central Services slots.
const packs = [
  { id: "pack-lite", name: "Lite", who: "A small team getting started" },
  { id: "pack-regular", name: "Regular", who: "A full band and a production team", feature: true },
  { id: "pack-plus", name: "Plus", who: "Bigger teams, more than one service" },
  { id: "pack-ultra", name: "Ultra", who: "Large churches and production companies", addon: "ultra-plus10" },
];
const products = [
  { id: "pedal", tag: "Built pedal", name: "Central Pedal", per: "one-time", icon: "central-pedal", desc: "This is the heart of it. Your pads, multitracks and click play from the floor, and every other app follows along.", pts: ["Built and tested by us, footswitches and knobs included", "Its software is already on it (no key needed), plus a P key for Central Pedal Control", "Ships to the US and Canada"] },
  { id: "admin", tag: "A key", name: "Central Control", per: "per admin computer", icon: "central-control", pts: ["For whoever runs the desk: lights, slides, lyrics, cameras, in-ears, tracks and the mix, all in one place. Windows, macOS and Linux."] },
  { id: "user", tag: "U key", name: "Central Usage", per: "per musician", icon: "central-usage", pts: ["For each musician: their chart, the lyrics, their instrument and their own in-ear mix, at church and at home. Works on everything.", "On a computer, bring the plugins you already own: VST3, Audio Units, CLAP and LV2."] },
  { id: "pedal-control", tag: "P key", name: "Central Pedal Control", per: "per device", icon: "central-pedal-control", pts: ["Build your songs, pads and setlists at home, then send it all to the pedal. Windows, macOS, Linux, iPad, iPhone and Android."] },
  { id: "services-slot", tag: "Slot", name: "Central Services", per: "per person, once", icon: "central-services", pts: ["Who's serving, who's away and what you're playing, on everyone's phone. Each person on your teams takes a slot; take someone off and theirs is free for the next."] },
];
const P_ = (id) => (cfg.products && cfg.products[id]) || null;
const priceOf = (id) => (P_(id) ? P_(id).cents / 100 : 0);
const dollars = (n) => "$" + (Number.isInteger(n) ? n : n.toFixed(2));
// the sale on the website now (or, for staff, the one they're previewing): what an item costs with it
const saleOn = (id) => !!(cfg.sale && P_(id) && (!P_(id).hardware || cfg.sale.includePedal));
const salePrice = (id) => Math.round(priceOf(id) * (100 - cfg.sale.percent)) / 100;
const T = (key, text) => (window.SiteContent ? window.SiteContent.html(key, esc(text)) : esc(text));
const ed = (key) => `data-edit="${key}"`;
const priceTag = (id, per) => `<div class="price">${saleOn(id) ? `<s>${dollars(priceOf(id))}</s> <span class="now">${dollars(salePrice(id))}</span>` : `<span data-price="${id}">${dollars(priceOf(id))}</span>`}<small>${esc(per)}</small></div>`;
const addBtn = (p, cls, label) => `<button class="btn${cls || ""}" data-add="${p.id}">${label || (cart[p.id] ? "Add another" : "Add to cart")}</button>`;
function pedalCard(p) {   // the built pedal: the wide row at the top of the store
  const k = "prod." + p.id;
  return `<div class="pedal-row"><div class="art on-stage"><img src="${window.SiteContent ? window.SiteContent.img(k + ".img", "/brand/glyph-central-pedal.svg") : "/brand/glyph-central-pedal.svg"}" alt="Central Pedal" data-edit-img="${k}.img"></div>
    <div class="body"><div class="label" ${ed(k + ".tag")}>${T(k + ".tag", p.tag)}</div><h3 style="font-size:1.7rem" ${ed(k + ".name")}>${T(k + ".name", p.name)}</h3>
    <p style="color:var(--ink-2)" ${ed(k + ".desc")}>${T(k + ".desc", p.desc)}</p>
    <ul ${ed(k + ".pts")}>${window.SiteContent && window.SiteContent.has(k + ".pts") ? window.SiteContent.html(k + ".pts") : p.pts.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    <div class="buyline">${priceTag(p.id, p.per)}${addBtn(p)}</div></div></div>`;
}
// a pack: a spec sheet - the counts down the left, what they are on the right
function packSpec(id) {
  const p = P_(id) || {}, k = p.keys || {}, rows = [];
  if (k.A) rows.push([k.A, "Central Control", k.A > 1 ? "1 main admin + " + (k.A - 1) + " admin" + (k.A > 2 ? "s" : "") : "1 main admin"]);
  if (k.U) rows.push([k.U, "Central Usage", "users: each musician and singer"]);
  if (k.P) rows.push([k.P, "Central Pedal Control", k.P > 1 ? "keys" : "to get the pedal ready"]);
  if (p.slots) rows.push([p.slots, "Central Services", "slots: one per person on your teams"]);
  return `<dl class="spec">${rows.map((r) => `<div><dt>${r[0]}</dt><dd><b>${esc(r[1])}</b><span>${esc(r[2])}</span></dd></div>`).join("")}</dl>`;
}
function packCard(p) {
  const k = "pack." + p.id, a = p.addon && P_(p.addon) && !P_(p.addon).hidden ? P_(p.addon) : null;
  return `<div class="tier${p.feature ? " feature" : ""}">
    <div class="tier-head"><h3 ${ed(k + ".name")}>${T(k + ".name", p.name)}</h3>${p.feature ? `<span class="pick" ${ed(k + ".pick")}>${T(k + ".pick", "Most picked")}</span>` : ""}</div>
    <p class="who" ${ed(k + ".who")}>${T(k + ".who", p.who)}</p>${priceTag(p.id, "one-time")}
    ${packSpec(p.id)}
    ${a ? `<div class="addon"><div><b>+${a.slots} Central Services slots</b><span>${saleOn(p.addon) ? `<s>${dollars(priceOf(p.addon))}</s> ${dollars(salePrice(p.addon))}` : dollars(priceOf(p.addon))}, with this pack</span></div>${addBtn({ id: p.addon }, " ghost small", cart[p.addon] ? "Added" : "Add")}</div>` : ""}
    ${addBtn(p, p.feature ? "" : " ghost")}</div>`;
}
function rowCard(p) {   // an app on its own: a row of the price list
  const k = "prod." + p.id;
  return `<div class="pl-row"><img src="/brand/${p.icon}.svg" alt=""><div class="what"><span class="label" ${ed(k + ".tag")}>${T(k + ".tag", p.tag)}</span><h3 ${ed(k + ".name")}>${T(k + ".name", p.name)}</h3></div>
    <p class="desc" ${ed(k + ".desc")}>${T(k + ".desc", p.pts.join(" "))}</p>${priceTag(p.id, p.per)}${addBtn(p, " ghost")}</div>`;
}
function renderSale() {   // the strip under the header while a sale is on
  const el = $("#saleBar"), x = cfg.sale; if (!el) return;
  el.hidden = !x;
  if (x) el.innerHTML = `<div class="wrap"><b>${esc(x.name)}: ${x.percent}% off</b><span>${esc(x.banner || "Everything but the built pedal.")}${x.endsAt ? " Until " + new Date(x.endsAt).toLocaleDateString(undefined, { month: "long", day: "numeric" }) + "." : ""}</span>${x.preview ? `<span class="pv">Preview: only staff see this</span>` : ""}<a href="#store">Shop the sale</a></div>`;
}
function renderRack() {
  if (!cfg.products) return;
  if (window.SiteContent && window.SiteContent.editing()) return;   // (not while the page is being edited)
  const shown = (p) => P_(p.id) && !P_(p.id).hidden;
  renderSale();
  $("#pedalBuy").innerHTML = products.filter((p) => p.id === "pedal" && shown(p)).map(pedalCard).join("");
  $("#packs").innerHTML = packs.filter(shown).map(packCard).join("");
  $("#packs").hidden = !$("#packs").innerHTML;
  $("#packs").style.setProperty("--n", packs.filter(shown).length);
  $("#rack").innerHTML = products.filter((p) => p.id !== "pedal" && shown(p)).map(rowCard).join("");
  renderPlanPrice(); renderPlans();
}
// ---------------------------------------------------------------- sound plans (yearly, as package keys)
// Your own plans (one package key, emailed to you) or a church bundle (a key for each person, given out on Teams).
// They're yearly, so they check out on their own, apart from the store's one-time things.
const planCart = { plans: [], bundle: 0 };
// (9.8) Central Pads comes with every other plan ($40 on its own): with another plan in the cart it's included, not charged
const planIds = () => cfg.planIds || ["keys", "plugins", "instrument", "pedals", "pads"];
const mainPlanIds = () => planIds().filter((id) => id !== "pads");
const planName = (id) => (id === "all" ? (cfg.planAll || {}).name || "All sound plans" : (cfg.plans[id] || {}).name || id);
const planListText = (ids) => (mainPlanIds().every((id) => ids.includes(id)) ? "All sound plans (with Central Pads)" : planIds().filter((id) => ids.includes(id)).map(planName).join(", ") + (ids.some((id) => id !== "pads") ? " (with Central Pads)" : ""));
const padsIncluded = () => planCart.plans.some((id) => id !== "pads");
const chargedPlans = () => planCart.plans.filter((id) => !(id === "pads" && padsIncluded()));
const ownPlanCents = () => (planCart.plans.includes("all") ? cfg.planAll.cents : chargedPlans().reduce((a, id) => a + ((cfg.plans[id] || {}).cents || 0), 0));
const longDate = (d) => new Date(d).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
const firstYear = (c) => (cfg.sale ? Math.round((c * (100 - cfg.sale.percent)) / 100) : c);   // (a sale is off a plan's first year)
function renderPlans() {
  if (!cfg.plans || !$("#planCards")) return;
  const inCart = (id) => planCart.plans.includes(id) || planCart.plans.includes("all"), ids = planIds(), padsWith = (id) => id === "pads" && padsIncluded();
  $("#planCards").style.setProperty("--n", ids.length);
  $("#planCards").innerHTML = ids.map((id) => {
    const p = cfg.plans[id], k = "plan." + id;
    return `<div class="tier"><div class="tier-head"><h3 ${ed(k + ".name")}>${T(k + ".name", p.name)}</h3></div><p class="who" ${ed(k + ".what")}>${T(k + ".what", p.what)}</p>
      <div class="price">${cfg.sale ? `<s>${dollars(p.cents / 100)}</s> <span class="now">${dollars(firstYear(p.cents) / 100)}</span><small>the first year</small>` : `<span data-price="plan-${id}">${dollars(p.cents / 100)}</span><small>a year</small>`}</div>${id === "pads" ? `<p class="muted" style="margin:0;font-size:.85rem" ${ed("plan.pads.note")}>${T("plan.pads.note", "Included in every other plan.")}</p>` : ""}<button class="btn ghost" data-plan="${id}"${inCart(id) || padsWith(id) ? " disabled" : ""}>${padsWith(id) ? "Included" : inCart(id) ? "In your cart" : "Add to cart"}</button></div>`;
  }).join("");
  const sum = mainPlanIds().reduce((a, id) => a + cfg.plans[id].cents, 0), all = planCart.plans.includes("all");
  $("#planAll").innerHTML = `<div class="plan-all"><div><b ${ed("plan.all.name")}>${T("plan.all.name", "All plans")}</b><span ${ed("plan.all.what")}>${T("plan.all.what", "Central Keys, Central Plugins, Central Instrument, Central Pedals and Central Pads on one package key.")}</span></div>
    <div class="price">${sum > firstYear(cfg.planAll.cents) ? `<s>${dollars(sum / 100)}</s> ` : ""}<span class="now">${dollars(firstYear(cfg.planAll.cents) / 100)}</span><small>${cfg.sale ? "the first year" : "a year"}</small></div><button class="btn" data-plan="all"${all ? " disabled" : ""}>${all ? "In your cart" : "Add to cart"}</button></div>`;
  const usd = (c) => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
  $("#planBundles").innerHTML = Object.entries(cfg.planBundles || {}).map(([n, c]) => `<div class="bundle-row"><b>${n} people</b><span class="muted">${usd(Math.round(c / n))} a person</span><div class="price">${cfg.sale ? `<s>${usd(c)}</s> <span class="now">${usd(firstYear(c))}</span><small>the first year</small>` : `${usd(c)}<small>a year</small>`}</div>
    <button class="btn small ghost" data-bundle="${n}"${planCart.bundle === Number(n) ? " disabled" : ""}>${planCart.bundle === Number(n) ? "In your cart" : "Add to cart"}</button></div>`).join("");
}
$("#store").addEventListener("click", (e) => {
  const p = e.target.closest("[data-plan]"), b = e.target.closest("[data-bundle]");
  if (p && !p.disabled) { const id = p.dataset.plan; planCart.plans = id === "all" ? ["all"] : planCart.plans.filter((x) => x !== "all" && !(id !== "pads" && x === "pads")).concat(id); updateCartBtn(); renderPlans(); toast(id !== "pads" && id !== "all" ? "Added to cart (with Central Pads)" : "Added to cart"); }
  if (b && !b.disabled) { planCart.bundle = Number(b.dataset.bundle); updateCartBtn(); renderPlans(); toast("Added to cart (one bundle at a time)"); }
});
// the plans' part of the cart
function planCartHtml() {
  // (a typed code wins; otherwise the sale that's on - the first year, as in the store they don't stack)
  const byCode = promo && promo.percent && promo.plans !== false, pc = byCode ? promo.percent : promo && promo.percent ? 0 : cfg.sale ? cfg.sale.percent : 0;
  const why = byCode ? promo.code : cfg.sale ? cfg.sale.name : "";
  const own = ownPlanCents(), b = planCart.bundle, bc = b ? (cfg.planBundles || {})[b] || 0 : 0;
  const off = (c) => Math.round((c * pc) / 100);
  const rows = chargedPlans().map((id) => `<div><span>${esc(planName(id))} <button class="qbtn" data-plrm="${id}" aria-label="Take it out">×</button></span><span>${money((id === "all" ? cfg.planAll.cents : cfg.plans[id].cents) / 100)} a year</span></div>`).join("") +
    (padsIncluded() && !planCart.plans.includes("all") && cfg.plans.pads ? `<div><span class="muted">${esc(planName("pads"))}</span><span class="muted">included</span></div>` : "");
  const cheaper = !planCart.plans.includes("all") && chargedPlans().length > 1 && own >= cfg.planAll.cents;
  return `<div class="cart-plans"><div><b>Sound plans</b> <span class="muted" style="font-size:.88rem">· yearly, renewing · a package key by email, to paste in Settings → Packages</span></div>
    ${rows ? `<div class="lines">${rows}${pc ? `<div class="saved"><span>${esc(why)} · ${pc}% off the first year</span><span>−${money(off(own) / 100)}</span></div>` : ""}<div class="total"><span>Your plans, the first year</span><span>${money((own - off(own)) / 100)}</span></div></div>
      ${cheaper ? `<p class="ok-note" style="margin:0">All plans is ${dollars(cfg.planAll.cents / 100)} a year, no more than these. <button class="btn small ghost" id="plAll">Switch to all plans</button></p>` : ""}
      <div><button class="btn" id="plGo">${me ? "Check out your plans" : "Sign in"}</button></div>` : ""}
    ${b ? `<div class="lines"><div><span>Sound plans for ${b} people <button class="qbtn" data-plrm="bundle" aria-label="Take it out">×</button></span><span>${money(bc / 100)} a year</span></div>${pc ? `<div class="saved"><span>${esc(why)} · ${pc}% off the first year</span><span>−${money(off(bc) / 100)}</span></div>` : ""}</div>
      <p class="muted" style="margin:0;font-size:.9rem">${b} package keys with all the plans (Central Pads too)${me && me.church ? ", for " + esc(me.church.name) : ""}. You give them out on the Teams page.</p><div><button class="btn" id="bnGo">${me ? "Check out the bundle" : "Sign in"}</button></div>` : ""}</div>`;
}
function wirePlanCart() {
  document.querySelectorAll("[data-plrm]").forEach((x) => (x.onclick = () => { const id = x.dataset.plrm; if (id === "bundle") planCart.bundle = 0; else planCart.plans = planCart.plans.filter((p) => p !== id); updateCartBtn(); renderPlans(); openCart(); }));
  if ($("#plAll")) $("#plAll").onclick = () => { planCart.plans = ["all"]; updateCartBtn(); renderPlans(); openCart(); };
  const code = () => (promo && promo.percent && promo.plans !== false ? promo.code : undefined);
  if ($("#plGo")) $("#plGo").onclick = async () => {
    if (!me) { closeModal(); return needSignIn("Sign in or make an account, then open the cart again."); }
    const body = { plans: planCart.plans, code: code() };
    try { await api("POST", "/checkout/plans/check", body); } catch (e) { $("#coErr").textContent = e.message; return; }
    openCheckout("Sound plans", esc(planListText(planCart.plans.includes("all") ? planIds() : planCart.plans)) + " · " + money(ownPlanCents() / 100) + " a year, tax included, renewing. Your package key comes by email.", () => api("POST", "/checkout/plans", body));
  };
  if ($("#bnGo")) $("#bnGo").onclick = async () => {
    if (!me) { closeModal(); return needSignIn("Sign in with your church's account, then open the cart again."); }
    const body = { seats: planCart.bundle, code: code() };
    try { await api("POST", "/checkout/plan-bundle/check", body); } catch (e) { $("#coErr").textContent = e.message; return; }
    openCheckout("Sound plans for " + planCart.bundle + " people", money(cfg.planBundles[planCart.bundle] / 100) + " a year, tax included, renewing" + (me.church ? " · for " + esc(me.church.name) : "") + ". Give the package keys out on the Teams page.", () => api("POST", "/checkout/plan-bundle", body));
  };
}
// Central Tracks Unlimited: its price from the price list
const subPrice = () => (cfg.subscription && cfg.subscription.cents ? cfg.subscription.cents / 100 : 77);
function renderPlanPrice() {
  const el = $("#planPrice"); if (el) el.innerHTML = `<span data-price="subscription">${dollars(subPrice())}</span><small> / month</small>`;
  const note = $("#exPoolNote"); if (note) note.textContent = "This counts the pool as if 100 churches subscribed that month (a " + money(subPrice() * 100 * 0.5) + " pool).";
  if (typeof renderSub === "function") renderSub(); if (typeof calc === "function") calc();
}
const cartCount = () => Object.values(cart).reduce((a, b) => a + b, 0) + planCart.plans.length + (planCart.bundle ? 1 : 0);
const storeCount = () => Object.values(cart).reduce((a, b) => a + b, 0);
function updateCartBtn() { const n = cartCount(); $("#cartBtn").innerHTML = `Cart <span class="count">${n}</span>`; $("#cartBtn").classList.toggle("has", n > 0); }
function onAdd(e) {
  const a = e.target.closest("[data-add]"); if (!a || a.disabled) return;
  const id = a.dataset.add, base = P_(id) && P_(id).addonFor;
  if (base && (cart[id] || 0) >= (cart[base] || 0) + ownedOf(base) - ownedOf(id)) return toast(cart[id] ? "One for each " + nameOf(base) + "." : "Add " + nameOf(base) + " first: these slots go with it.");
  cart[id] = (cart[id] || 0) + 1; updateCartBtn(); renderRack(); toast("Added to cart");
}
$("#rack").addEventListener("click", onAdd); $("#packs").addEventListener("click", onAdd); $("#pedalBuy").addEventListener("click", onAdd);
let promo = null;   // the code in the cart: { code, percent } or { code, trial, days }
let forWho = null;  // the store items: "me" (Just me) or "church" (a church or team)
$("#cartBtn").onclick = () => openCart();
const nameOf = (id) => (P_(id) ? P_(id).name : id);
const ownedOf = (id) => (me && me.church && me.church.owned ? me.church.owned[id] || 0 : 0);
function fitAddons() {   // an add-on can't outnumber its pack (in the cart, or bought before)
  for (const k of Object.keys(cart)) { const b = P_(k) && P_(k).addonFor; if (!b) continue; const room = (cart[b] || 0) + ownedOf(b) - ownedOf(k); if (cart[k] > room) { if (room > 0) cart[k] = room; else delete cart[k]; } }
}
function openCart(note) {
  const ids = Object.keys(cart).filter((k) => cart[k] > 0 && P_(k));
  const hasPlans = planCart.plans.length > 0 || !!planCart.bundle;
  if (!ids.length && !hasPlans && !(promo && promo.trial)) return modal(`<h3>Your cart is empty</h3><p class="muted" style="margin:0">Pick a pack, the pedal, a few keys or sound plans from the store. Got a free trial code? Type it here and you're off:</p>
    <div class="codeline"><label>Code<input id="pcCode" placeholder="Discount or trial code" autocapitalize="characters"></label><button class="btn ghost" id="pcApply">Apply</button></div><div class="err" id="pcErr"></div><button class="btn" data-close>Close</button>`), wirePromo();
  let total = 0, saved = 0;
  const cut = (id) => (promo && promo.percent ? (P_(id).hardware ? 0 : promo.percent) : saleOn(id) ? cfg.sale.percent : 0);
  const lines = ids.map((id) => {
    const s = priceOf(id) * cart[id], pc = cut(id), d = pc ? Math.round(s * pc) / 100 : 0; total += s - d; saved += d;
    return `<div><span>${esc(nameOf(id))} <span class="qty"><button class="qbtn" data-q="${id}" data-d="-1" aria-label="One fewer">−</button>${cart[id]}<button class="qbtn" data-q="${id}" data-d="1" aria-label="One more">+</button></span></span><span>${d ? `<s class="muted">${money(s)}</s> ` : ""}${money(s - d)}</span></div>`;
  }).join("");
  const why = promo && promo.percent ? esc(promo.code) + " · " + esc(promo.label) : cfg.sale ? esc(cfg.sale.name) + " · " + cfg.sale.percent + "% off" : "";
  const trial = promo && promo.trial, storePart = ids.length || trial;
  // who it's for: "Just me" (the keys are yours at once: Purchases and an email) or a church or team (handed
  // out on the Teams page). Packs and Central Services slots are for a church or team.
  const churchOnly = ids.some((id) => P_(id).pack || P_(id).addonFor || P_(id).slots);
  if (!forWho && me) forWho = me.church && isStaffRole(me.church.role) ? "church" : "me";
  if (churchOnly) forWho = "church";
  const forMe = forWho === "me" && !trial, needChurch = me && !me.church && !forMe;
  const whoHtml = ids.length && !trial && me ? `<div class="choice"><b style="font-size:.95rem">Who is it for?</b>
    <label><input type="radio" name="coFor" value="me"${forMe ? " checked" : ""}${churchOnly ? " disabled" : ""}> <span>Just me <span class="muted" style="font-size:.88rem">· the keys are yours</span></span></label>
    <label><input type="radio" name="coFor" value="church"${forMe ? "" : " checked"}> <span>A church or team <span class="muted" style="font-size:.88rem">· you hand the keys out on the Teams page</span></span></label>
    ${churchOnly ? `<span class="muted" style="font-size:.85rem">Packs and Central Services slots are for a church or team.</span>` : ""}</div>` : "";
  modal(`<h3>Cart</h3>${ids.length ? `<div class="lines">${lines}${saved ? `<div class="saved"><span>${why}</span><span>−${money(saved)}</span></div>` : ""}<div class="total"><span>Total <span class="muted" style="font-weight:400;font-size:.85rem">tax included</span></span><span>${money(total)}</span></div></div>` : ""}
    ${hasPlans ? planCartHtml() : ""}
    <div class="codeline"><label>Discount or trial code<input id="pcCode" value="${esc(promo ? promo.code : "")}" placeholder="Code" autocapitalize="characters"></label><button class="btn ghost" id="pcApply">${promo ? "Change" : "Apply"}</button>${promo ? `<button class="btn ghost" id="pcClear">Remove</button>` : ""}</div>
    <div class="${note && /^✓/.test(note) ? "ok-note" : "err"}" id="pcErr">${esc(note || "")}</div>
    ${trial ? `<div class="card" style="border-color:var(--brass)"><b>${esc(promo.label)}</b><span class="muted" style="font-size:.9rem">Everything for ${promo.days} days, no payment: as many admin, user and Pedal Control keys as you like, Central Services, Central Tracks Unlimited and all four sound plans (package keys by email). Then the trial keys stop and the apps ask for a key you bought (your songs and settings stay). One free trial per church.</span></div>` : ""}
    ${whoHtml}
    ${!storePart ? "" : !me ? `<p class="muted" style="margin:0">Sign in or make an account first: your keys go to your account, or your church's.</p>` : forMe ? `<p class="muted" style="margin:0;font-size:.9rem">The keys are yours${me.church ? ", not " + esc(me.church.name) + "'s" : ""}: as soon as you've paid they're under your account icon → <b>Purchases</b>, with the downloads and how to install each app. We email them to you too.</p>` : trial && me && !me.church ? `<label>Your church or production's name<input id="coChurch" placeholder="Grace Church"></label>` : needChurch ? `<label>Your church or production's name<input id="coChurch" placeholder="Grace Church"></label><p class="muted" style="margin:0;font-size:.9rem">This makes your church's account, with you as its main admin. Your admins and users join it with its codes.</p>` : `<p class="muted" style="margin:0;font-size:.9rem">The keys go to <b>${esc(me.church.name)}</b>.</p>`}
    <div style="display:flex;gap:.5rem;flex-wrap:wrap">${storePart ? `<button class="btn" id="checkout">${me ? (hasPlans ? "Check out the store items" : "Check out") : "Sign in"}</button>` : ""}<button class="btn ghost" id="clear">Empty cart</button></div><div class="err" id="coErr"></div>`);
  $("#clear").onclick = () => { for (const k in cart) delete cart[k]; planCart.plans = []; planCart.bundle = 0; updateCartBtn(); renderRack(); closeModal(); };
  wirePlanCart();
  if (!$("#checkout")) return wirePromo();
  document.querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => {
    const id = b.dataset.q; cart[id] = Math.max(0, Math.min(50, (cart[id] || 0) + Number(b.dataset.d))); if (!cart[id]) delete cart[id];
    fitAddons(); updateCartBtn(); renderRack(); openCart();
  }));
  wirePromo();
  document.querySelectorAll('[name="coFor"]').forEach((r) => (r.onchange = () => { forWho = r.value; openCart(); }));
  if (trial) { $("#checkout").textContent = me ? "Start the free trial" : "Sign in to start the trial"; }
  $("#checkout").onclick = async () => {
    if (!me) { closeModal(); return needSignIn("Sign in or make an account, then open the cart again."); }
    if ($("#coChurch") && !$("#coChurch").value.trim()) { $("#coErr").textContent = "Give your church or production a name."; return; }
    $("#checkout").disabled = true;
    if (trial) {
      try {
        const t = await api("POST", "/trial", { code: promo.code, church: $("#coChurch") ? $("#coChurch").value.trim() : undefined });
        promo = null; await refreshMe();
        return modal(`<h3>Your free trial has started!</h3><p style="margin:0"><b>${esc(t.church)}</b> has everything until <b>${new Date(t.until).toLocaleDateString()}</b>: unlimited keys, Central Services, Central Tracks Unlimited and all four sound plans.</p>
          ${t.packageKey ? `<p style="margin:0">Your sound plans package key (it's in your email too): <code style="user-select:all;font-weight:600">${esc(t.packageKey)}</code>. In any app: <b>Settings → Packages → Add a package</b>, and paste it. Give your team theirs on the <b>Teams</b> card.</p>` : ""}
          <p style="margin:0">Make keys as you need them: on the <b>Teams</b> card add your admins, users and Pedal Control people (each gets an email with their key), or press <b>+ Admin key</b>, <b>+ User key</b> or <b>+ Pedal Control key</b> on your church's page.</p>
          <p class="muted" style="margin:0;font-size:.9rem">Get the apps on the <a href="#downloads" data-close>Downloads</a> page.</p><a class="btn" href="#account" data-close>Go to my church</a>`);
      } catch (e) { $("#coErr").textContent = e.message; $("#checkout").disabled = false; return; }
    }
    const body = { items: cart, for: forMe ? "me" : "church", church: needChurch && $("#coChurch") ? $("#coChurch").value.trim() : undefined, code: promo && promo.percent ? promo.code : undefined };
    try { await api("POST", "/checkout/store/check", body); } catch (e) { $("#coErr").textContent = e.message; $("#checkout").disabled = false; return; }
    openCheckout("Check out", `${storeCount()} item${storeCount() === 1 ? "" : "s"} · ${money(total)} · for ${forMe ? "you" : esc(me.church ? me.church.name : body.church)}`, () => api("POST", "/checkout/store", body));
  };
}
function wirePromo() {
  const apply = async () => {
    const c = ($("#pcCode").value || "").trim().toUpperCase(); if (!c) return;
    try {
      const d = await api("GET", "/discount/" + encodeURIComponent(c));
      if (d.used) throw new Error(d.trial ? "Your church already had its free trial." : "Your church already used " + d.code + ".");
      promo = d; openCart("✓ " + d.code + ": " + d.label);
    } catch (e) { $("#pcErr").className = "err"; $("#pcErr").textContent = e.message; }
  };
  if ($("#pcApply")) $("#pcApply").onclick = apply;
  if ($("#pcCode")) $("#pcCode").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); apply(); } };
  if ($("#pcClear")) $("#pcClear").onclick = () => { promo = null; openCart(); };
}

// ---------------------------------------------------------------- subscription + library
function renderSub() {
  const on = !!(me && me.subscribed);
  $("#subStatus").textContent = on ? "Subscribed · unlimited adds" : "Not subscribed";
  $("#subStatus").classList.toggle("on", on);
  $("#subBtn").textContent = on ? "Manage subscription" : "Subscribe for " + dollars(subPrice()) + " a month";
}
$("#subBtn").onclick = async () => {
  if (!me) return needSignIn("Sign in to subscribe to Central Tracks Unlimited.");
  if (!cfg.payments) return paymentsSoon();
  if (me.subscribed) { try { go((await api("POST", "/billing")).url); } catch (e) { toast(e.message); } return; }
  const forChurch = me.church && isMainRole(me.church.role);
  openCheckout("Central Tracks Unlimited", dollars(subPrice()) + " a month, tax included" + (forChurch ? " · for everyone in " + esc(me.church.name) : "") + ". Cancel any time.", () => api("POST", "/checkout/subscription"));
};
let searchTimer = 0;
async function loadTracks() {
  try { tracks = (await api("GET", "/tracks?q=" + encodeURIComponent($("#q").value.trim()) + "&kind=" + encodeURIComponent($("#kindF").value))).tracks; }
  catch (e) { tracks = []; $("#tbody").innerHTML = `<tr><td colspan="6" class="muted">${esc(e.message)}</td></tr>`; return; }
  renderTracks();
}
function renderTracks() {
  if (!tracks.length) { $("#tbody").innerHTML = `<tr><td colspan="6" class="muted">${$("#q").value || $("#kindF").value ? "No tracks match that search." : "No tracks yet. Be the first to publish one."}</td></tr>`; return; }
  const sub = !!(me && me.subscribed);
  $("#tbody").innerHTML = tracks.map((t) => {
    const act = t.owned ? `<span class="added">${t.mine ? "Yours" : "In storage"}</span>`
      : sub ? `<button class="btn small" data-store="${esc(t.id)}">Add to storage</button>`
      : `<button class="btn small ghost" data-buy="${esc(t.id)}">Buy ${money(t.price)}</button>`;
    return `<tr><td><div style="font-weight:600">${esc(t.title)}${t.demo ? ` <button class="btn small ghost demo-btn" data-demo="${esc(t.id)}" aria-label="Play the demo of ${esc(t.title)}">▶ Demo</button>` : ""}</div><div class="muted" style="font-size:.85rem">${esc(t.artist)}</div></td>
      <td><span class="kind">${esc(t.kind)}</span></td><td>${starHtml(t.stars)}</td><td class="num">${esc(t.key || "—")}</td><td class="num">${t.bpm || "—"}</td><td class="act">${act}</td></tr>`;
  }).join("");
}
$("#q").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadTracks, 250); });
$("#kindF").onchange = loadTracks;
let demoAudio = null;   // a Sound, Board or Click's demo clip (anyone can listen)
async function playDemo(btn) {
  if (demoAudio) { demoAudio.pause(); const was = demoAudio.dataset.id; document.querySelectorAll("[data-demo]").forEach((x) => (x.textContent = "▶ Demo")); demoAudio = null; if (was === btn.dataset.demo) return; }
  try {
    const r = await api("GET", "/tracks/" + encodeURIComponent(btn.dataset.demo) + "/demo");
    demoAudio = new Audio(r.url); demoAudio.dataset.id = btn.dataset.demo; btn.textContent = "■ Stop";
    demoAudio.onended = () => { btn.textContent = "▶ Demo"; demoAudio = null; };
    await demoAudio.play();
  } catch (e) { btn.textContent = "▶ Demo"; toast(e.message || "The demo couldn't play."); }
}
$("#tbody").addEventListener("click", async (e) => {
  const dm = e.target.closest("[data-demo]"); if (dm) return playDemo(dm);
  const s = e.target.closest("[data-store]"), b = e.target.closest("[data-buy]");
  if (!s && !b) return;
  if (!me) return needSignIn("Sign in to add or buy tracks.");
  const id = (s || b).dataset.store || (s || b).dataset.buy, t = tracks.find((x) => x.id === id);
  if (s) {
    try { const r = await api("POST", "/tracks/" + id + "/add"); if (r._status === 402) return buyModal(t); t.owned = true; renderTracks(); toast("It's in your storage. Open Central Tracks in the app to download it."); } catch (err) { toast(err.message); }
  } else buyModal(t);
});
function buyModal(t) {
  modal(`<h3>Buy track</h3><div class="lines"><div><span><b>${esc(t.title)}</b> <span class="muted">· ${esc(t.artist)} · ${esc(t.kind)}</span></span><span>${money(t.price)}</span></div></div>
    <p class="muted" style="margin:0">Or subscribe for ${dollars(subPrice())} a month and add every track.</p>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn" id="buyGo">Buy for ${money(t.price)}</button><button class="btn ghost" data-close>Cancel</button></div><div class="err" id="buyErr"></div>`);
  $("#buyGo").onclick = () => {
    if (t.owned) { closeModal(); return toast("It's already in your storage."); }
    openCheckout("Buy " + t.title, money(t.price) + ", tax included. It goes straight to your storage.", () => api("POST", "/tracks/" + t.id + "/purchase?web=1"));
  };
}
// the apps send people here to buy a track (#buy-<id>)
async function buyFromLink(id) {
  if (!me) { try { sessionStorage.setItem("ma-after-signin", "#buy-" + id); } catch {} return needSignIn("Sign in to buy this track. It goes straight to your storage."); }
  try { const t = (await api("GET", "/tracks/" + encodeURIComponent(id))).track; if (t.owned) return modal(`<h3>${esc(t.title)}</h3><p style="margin:0">It's in your storage already. Open Central Tracks in the app to download it.</p><button class="btn" data-close>OK</button>`); buyModal(t); }
  catch (e) { modal(`<h3>Buy track</h3><p class="err" style="margin:0">${esc(e.message)}</p><button class="btn" data-close>OK</button>`); }
}

// ---------------------------------------------------------------- publishing
let grade = 0;
function renderTiers() { $("#tiers").innerHTML = [1, 2, 3, 4, 5].map((n) => `<div class="${n === grade ? "on" : ""}">${n}★<br>$${TIER[n]}</div>`).join(""); }
function setPrice() { $("#pPrice").value = grade ? money(TIER[grade]) : ""; $("#pubBtn").disabled = !grade; calc(); }
function calc() {
  const per = (grade ? TIER[grade] : 0) * 0.75; $("#perBuy").textContent = money(per);
  $("#exTotal").textContent = money(per * (+$("#exBuys").value || 0) + subPrice() * 100 * 0.5 * Math.min(100, Math.max(0, +$("#exAdds").value || 0)) / 100);
}
["#exBuys", "#exAdds"].forEach((s) => $(s).addEventListener("input", calc));

// quick estimate in the browser; the server sets the final grade
async function estimateGrade(file) {
  const buf = await file.arrayBuffer(), checks = []; let score = 5;
  const isWav = /\.wav$/i.test(file.name) || file.type.includes("wav"), v = new DataView(buf);
  let bits = 0, fileRate = 0;
  if (isWav && buf.byteLength > 44) { for (let i = 12; i < Math.min(buf.byteLength - 24, 400); i++) if (v.getUint32(i) === 0x666d7420) { fileRate = v.getUint32(i + 12, true); bits = v.getUint16(i + 22, true); break; } }
  else {
    let o = 0; if (buf.byteLength > 10 && v.getUint8(0) === 0x49 && v.getUint8(1) === 0x44 && v.getUint8(2) === 0x33) o = 10 + ((v.getUint8(6) & 127) << 21 | (v.getUint8(7) & 127) << 14 | (v.getUint8(8) & 127) << 7 | (v.getUint8(9) & 127));
    const T = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
    for (let i = o; i < Math.min(buf.byteLength - 4, o + 65536); i++) { const b1 = v.getUint8(i + 1); if (v.getUint8(i) === 0xFF && (b1 & 0xE0) === 0xE0) { const ver = (b1 >> 3) & 3, ri = (v.getUint8(i + 2) >> 2) & 3; if (T[ver] && ri < 3) { fileRate = T[ver][ri]; break; } } }
  }
  const ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, 44100);
  const ab = await ctx.decodeAudioData(buf.slice(0));
  const sr = fileRate || ab.sampleRate, dur = ab.duration, ch = ab.numberOfChannels, kbps = Math.round(file.size * 8 / dur / 1000);
  const add = (ok, txt, pen) => { checks.push({ ok, txt }); if (!ok) score -= pen; };
  if (isWav) add(bits === 0 || bits >= 16, `WAV · ${bits || "?"}-bit · lossless`, 1);
  else add(kbps >= 192, `Compressed · about ${kbps} kbps${kbps < 192 ? " (192+ recommended)" : ""}`, kbps < 128 ? 2 : 1);
  add(sr >= 44100, `${Math.round(sr / 100) / 10} kHz sample rate`, 1);
  const data = []; for (let c = 0; c < ch; c++) data.push(ab.getChannelData(c));
  const n = data[0].length, step = Math.max(1, Math.floor(n / 2e6)), fr = Math.floor(ab.sampleRate * 0.05), frames = [];
  let clip = 0, cnt = 0, acc = 0, fc = 0;
  for (let i = 0; i < n; i += step) { let x = 0; for (let c = 0; c < ch; c++) x += data[c][i]; x /= ch; if (Math.abs(x) >= 0.999) clip++; cnt++; acc += x * x; fc += step; if (fc >= fr) { frames.push(Math.sqrt(acc / (fc / step))); acc = 0; fc = 0; } }
  const db = (x) => 20 * Math.log10(Math.max(x, 1e-9)), clipPct = clip / cnt * 100;
  add(clipPct < 0.1, `Clipping ${clipPct < 0.01 ? "none" : clipPct.toFixed(2) + "% of samples"}`, clipPct > 1 ? 2 : 1);
  const sorted = frames.slice().sort((a, b) => a - b), loud = db(sorted[Math.floor(sorted.length * 0.9)] || 0), floor = db(sorted[Math.floor(sorted.length * 0.1)] || 0);
  add(loud > -30, `Level ${loud.toFixed(0)} dBFS (loud parts)${loud <= -30 ? " · too quiet" : ""}`, 1);
  if (loud - floor < 20) add(true, "Sustained throughout · no quiet gaps to check for noise", 0);
  else add(floor < -50, `Noise in quiet parts ${floor.toFixed(0)} dBFS${floor >= -50 ? " · hiss or hum" : ""}`, 1);
  checks.unshift({ ok: true, txt: `${Math.floor(dur / 60)}:${String(Math.round(dur % 60)).padStart(2, "0")} · ${ch === 1 ? "mono" : "stereo"}` });
  return { stars: Math.max(1, Math.min(5, score)), checks };
}
function showChecks(list, key) { $("#gChecks").innerHTML = list.map((c) => `<div class="${c.ok ? "" : "bad"}">${c.ok ? "✓" : "✗"} ${esc(c[key])}</div>`).join(""); }
$("#pFile").addEventListener("change", async (e) => {
  const f = e.target.files[0]; if (!f) return; grade = 0; renderTiers(); setPrice();
  $("#gLabel").textContent = "Quality grade · estimate"; $("#gStars").textContent = "Grading…"; $("#gChecks").innerHTML = "<div>Listening to " + esc(f.name) + "…</div>";
  try { const g = await estimateGrade(f); grade = g.stars; $("#gStars").innerHTML = starHtml(grade); showChecks(g.checks, "txt"); }
  catch { $("#gStars").textContent = "☆☆☆☆☆"; $("#gChecks").innerHTML = '<div class="bad">Could not read that file as audio. Upload an MP3 or WAV.</div>'; }
  renderTiers(); setPrice();
});
function guessRole(name) {
  const n = name.toLowerCase();
  return /click|metronome/.test(n) ? "click" : /guide|cue/.test(n) ? "guide" : /drum|perc|loop|kick|snare/.test(n) ? "drums" : /bass/.test(n) ? "bass" : /key|synth|pad|piano|organ/.test(n) ? "keys" : /gtr|guitar/.test(n) ? "guitar" : /vox|vocal|bgv|choir/.test(n) ? "vocals" : "music";
}
function uploadFile(file, onProgress) {  // signed link → straight to storage, with progress
  return api("POST", "/uploads", { name: file.name, type: file.type || "application/octet-stream", size: file.size }).then((u) => new Promise((ok, bad) => {
    const x = new XMLHttpRequest(); x.open("PUT", u.url); x.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    x.upload.onprogress = (ev) => ev.lengthComputable && onProgress(ev.loaded / ev.total);
    x.onload = () => (x.status < 300 ? ok({ key: u.key, name: file.name }) : bad(new Error("Upload failed (" + x.status + ").")));
    x.onerror = () => bad(new Error("Upload failed. Check your connection and try again."));
    x.send(file);
  }));
}
// Sound, Board and Click: the file the apps install, plus a short demo clip (graded: its stars set the price)
const ITEM_WHAT = { Sound: ["The sound itself: an .sf2, or a zip of samples", ".sf2,.zip"], Board: ["The pedal board preset (.json)", ".json"], Click: ["The click and count-in set: a zip of WAVs", ".zip"] };
const isItem = () => !!ITEM_WHAT[$("#pKind").value];
$("#pKind").addEventListener("change", () => {
  const w = ITEM_WHAT[$("#pKind").value];
  $("#pItemL").hidden = !w; $("#pStemsL").hidden = !!w; $("#pItem").required = !!w;
  if (w) { $("#pItemT").textContent = w[0]; $("#pItem").accept = w[1]; }
  $("#pFileT").textContent = w ? "A short demo clip (MP3 or WAV, under 2 minutes): we grade it, and its stars set the price" : "Full mix (MP3 or WAV), the file we grade";
});
$("#pubForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!me) return needSignIn("Sign in to publish tracks.");
  const mix = $("#pFile").files[0], stems = isItem() ? [] : Array.from($("#pStems").files || []), item = isItem() ? $("#pItem").files[0] : null, msg = $("#pubMsg");
  if (!mix) return; if (isItem() && !item) { msg.textContent = "Choose the " + $("#pKind").value.toLowerCase() + " file itself, and a short demo clip."; return; }
  if (!$("#pRights").checked) { msg.textContent = "Confirm you have the rights to sell this."; return; }
  if (me.idRequired && me.idStatus !== "verified") { msg.textContent = "Verify your ID first (once, about 2 minutes): Verify my ID, next to the form."; $("#idBox").scrollIntoView({ behavior: "smooth", block: "center" }); return; }
  $("#pubBtn").disabled = true; msg.textContent = "";
  try {
    const all = [mix, ...stems, ...(item ? [item] : [])], total = all.reduce((a, f) => a + f.size, 0); let done = 0;
    const up = [];
    for (const f of all) { const r = await uploadFile(f, (p) => { msg.textContent = "Uploading " + Math.round(((done + p * f.size) / total) * 100) + "%…"; }); done += f.size; up.push(r); }
    msg.textContent = "Grading on the server…";
    const r = await api("POST", "/publish", { title: $("#pTitle").value, artist: $("#pArtist").value, kind: $("#pKind").value, key: $("#pKey").value, bpm: +$("#pBpm").value || 0, rights: true,
      mix: up[0], stems: item ? [] : up.slice(1).map((s) => ({ ...s, role: guessRole(s.name) })), item: item ? up[up.length - 1] : undefined });
    grade = r.grade.stars; $("#gLabel").textContent = "Quality grade · final"; $("#gStars").innerHTML = starHtml(grade); showChecks(r.grade.checks, "text"); renderTiers(); calc();
    $("#pPrice").value = money(r.track.price);
    msg.textContent = (r.waiting ? "Sent for review: " + r.track.title + " · " + grade + "★ for now (the reviewer sets the final stars and price) · we'll email you when it's live" : "Published: " + r.track.title + " · " + grade + "★ · " + money(r.track.price)) + (me.payoutsReady ? "" : " · set up payouts to get paid");
    toast(r.waiting ? "Sent! A reviewer checks every upload before it goes into Central Tracks." : "You're published! Your track is in Central Tracks.");   // (10.1: when staff hold new uploads for review) e.target.reset(); $("#pKind").dispatchEvent(new Event("change")); grade = 0; $("#pubBtn").disabled = true; loadTracks(); refreshMe();
  } catch (err) { msg.textContent = err.message; $("#pubBtn").disabled = false; }
});
$("#payoutBtn").onclick = async () => {
  if (!cfg.payments) return paymentsSoon();
  try { go((await api("POST", "/connect")).url); } catch (e) { toast(e.message); }
};
$("#idBtn").onclick = async () => {
  if (!cfg.payments) return paymentsSoon();
  try { const r = await api("POST", "/identity"); if (r.verified) { toast("You're verified."); return refreshMe(); } go(r.url); } catch (e) { toast(e.message); }
};
function renderPayout() {
  const t = $("#payoutText"), b = $("#payoutBtn"), it = $("#idText"), ib = $("#idBtn"), box = $("#idBox");
  const needId = !!(me && me.idRequired), idOk = !!(me && me.idStatus === "verified");
  box.hidden = !needId;
  if (needId) {
    it.textContent = idOk ? "✓ Verified. You can publish." : me.idStatus === "processing" ? "Stripe is checking your ID. It usually takes a minute or two." : me.idStatus === "requires_input" ? "Stripe couldn't confirm your ID. Try again with a clear photo." : "Once, before your first upload: a photo of your ID and a selfie, through Stripe. It keeps Central Tracks honest.";
    ib.hidden = idOk || me.idStatus === "processing"; ib.textContent = me.idStatus === "requires_input" ? "Try again" : "Verify my ID";
  }
  if (!me) { t.textContent = "Sign in to publish. Earnings are paid monthly to your bank through Stripe."; b.hidden = true; return; }
  if (me.payoutsReady) { t.textContent = "Payouts are set up. Earnings over $10 are paid on the 1st of each month."; b.hidden = true; return; }
  t.textContent = (me.payoutsStarted ? "Finish setting up payouts" : "Set up payouts") + " so we can send your earnings. Stripe asks for your bank and tax details."; b.hidden = false;
  b.textContent = me.payoutsStarted ? "Finish payout setup" : "Set up payouts";
}

// ---------------------------------------------------------------- account
function signInForm(note) {
  return `<div class="acct"><div class="card"><h3>Welcome back</h3>${note ? `<p class="muted" style="margin:0">${esc(note)}</p>` : ""}
    <form id="inForm" style="background:none;border:0;padding:0"><label>Email<input id="inEmail" type="email" autocomplete="username" required></label>
    <label>Password<input id="inPass" type="password" autocomplete="current-password" required></label><div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center"><button class="btn">Sign in</button><button class="btn ghost small" type="button" id="forgotBtn">Forgot password?</button></div><div class="err" id="inErr"></div></form></div>
    <div class="card"><h3>New here? Make an account</h3><p class="muted" style="margin:0">It's free. You'll use it to order, set up your team, publish tracks and sign in to the apps.</p>
    <form id="upForm" style="background:none;border:0;padding:0"><label id="upNameL">Your name<input id="upName" autocomplete="name"></label><label><span id="upEmailT">Your email</span><input id="upEmail" type="email" autocomplete="email" required></label>
    <label>Password (8+ characters)<input id="upPass" type="password" autocomplete="new-password" minlength="8" required></label>
    <div class="choice"><b style="font-size:.95rem">Your church</b>
      <label><input type="radio" name="upCh" value="join" checked> Join my church as <select id="upRole" style="width:auto"><option value="user">a user</option><option value="admin">an admin</option></select></label>
      <label><input type="radio" name="upCh" value="make"> Set up a new church: this is the church's own account</label>
      <label><input type="radio" name="upCh" value="none"> Not now (Central Tracks only)</label></div>
    <label id="upCodeL">Church code (from your main admin)<input id="upCode" placeholder="8 letters and digits"></label>
    <label id="upChurchL" hidden>Church or production name<input id="upChurch" placeholder="Grace Church"></label>
    <p class="muted" id="upChurchHelp" hidden style="margin:0;font-size:.88rem">Use the church's own email, like office@yourchurch.org, not your personal one. This account buys and pays for the church and adds your main admins, admins and users. It doesn't use a Central Services slot. You'll join as a main admin with your own account.</p>
    <p class="muted" style="margin:0;font-size:.85rem">Making an account means you agree to the <a href="/terms" target="_blank">Terms</a> and the <a href="/privacy" target="_blank">Privacy policy</a>.</p>
    <button class="btn">Make account</button><div class="err" id="upErr"></div></form></div></div>`;
}
async function renderAccount(note) {
  const body = $("#acctBody");
  $("#signOut").hidden = !me; $("#acctLink").textContent = me ? "Account" : "Sign in";
  $("#acctLink").hidden = !!me; if ($("#acctMenu")) { $("#acctMenu").hidden = !me; $("#acctWho").textContent = me ? (me.name ? me.name + " · " : "") + me.email : ""; }
  if (!me) {
    $("#acctTitle").textContent = "Sign in";
    body.innerHTML = signInForm(note);
    $("#inForm").onsubmit = async (e) => { e.preventDefault(); try { setToken((await finishSignIn(await api("POST", "/login", { email: $("#inEmail").value, password: $("#inPass").value, device: deviceId() }))).token); await refreshMe(); toast("Welcome back!"); } catch (err) { $("#inErr").textContent = err.message; } };
    $("#forgotBtn").onclick = () => forgotPassword($("#inEmail").value);
    const chWay = () => (document.querySelector('[name="upCh"]:checked') || {}).value;
    document.querySelectorAll('[name="upCh"]').forEach((r) => (r.onchange = () => { const mk = chWay() === "make"; $("#upCodeL").hidden = chWay() !== "join"; $("#upChurchL").hidden = !mk; $("#upChurchHelp").hidden = !mk; $("#upNameL").hidden = mk; $("#upEmailT").textContent = mk ? "The church's email" : "Your email"; }));
    $("#upForm").onsubmit = async (e) => {
      e.preventDefault(); const w = chWay();
      if (w === "join" && !$("#upCode").value.trim()) { $("#upErr").textContent = "Enter your church's code, or pick another choice."; return; }
      if (w === "make" && !$("#upChurch").value.trim()) { $("#upErr").textContent = "Give your church or production a name."; return; }
      try {
        const r = await finishSignIn(await api("POST", "/signup", { name: w === "make" ? $("#upChurch").value.trim() : $("#upName").value, email: $("#upEmail").value, password: $("#upPass").value, device: deviceId(),
          churchCode: w === "join" ? $("#upCode").value.trim() : undefined, churchRole: $("#upRole").value, churchName: w === "make" ? $("#upChurch").value.trim() : undefined }));
        setToken(r.token); await refreshMe(); toast(r.churchError ? r.churchError : "Welcome! Check your email for a link to confirm your account." + (r.church ? " " + r.church + " is set up." + (w === "make" ? " Next: invite your main admins under Your church." : "") : ""));
      } catch (err) { $("#upErr").textContent = err.message; }
    };
    return;
  }
  $("#acctTitle").textContent = me.name ? "Hi, " + me.name : "Your account";
  body.innerHTML = `<div class="acct">${me.emailConfirmed ? "" : `<div class="card wide confirm-card"><h3>Confirm your email</h3><p style="margin:0">We sent a link to <b>${esc(me.email)}</b>. Your receipts, keys, invites and password resets go there, so checkout waits until it's confirmed.</p><div style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn small" id="cfAgain">Send it again</button></div></div>`}
    <div class="card wide dl-link"><h3>Your keys and downloads</h3><p class="muted" style="margin:0">Your keys (they're in your email too), and every app with how to install it.</p><div id="myRenew"></div><div style="display:flex;gap:.5rem;flex-wrap:wrap"><a class="btn small" href="#purchases">Purchases</a><a class="btn small ghost" href="#downloads">Open Downloads</a></div></div>
    <div class="card wide" id="churchCard"><h3>Your church</h3><div class="muted">Loading…</div></div>
    ${me.church && me.church.role !== "user" ? `<div class="card wide" id="teamsCard"><h3>Teams</h3><div class="muted">Loading…</div></div>` : ""}
    <div class="card"><h3>Central Tracks</h3><div class="status ${me.subscribed ? "on" : ""}" style="font:500 .85rem var(--mono)">${me.subscribed ? "Unlimited, " + dollars(subPrice()) + " a month" : "Not subscribed"}</div>
      <p class="muted" style="margin:0;font-size:.92rem">In Central Pedal or Central Pedal Control: <b>+ Add songs → Central Tracks</b>. Set the server to <code style="user-select:all">${esc(location.origin)}</code> and sign in with ${esc(me.email)}.</p>
      <a class="btn ghost small" href="#downloads" style="justify-self:start">Download the apps</a></div>
    <div class="card wide" id="pkgCard"><h3>Sound plans</h3><div class="muted">Loading…</div></div>
    ${me.church ? `<div class="card" id="slotsCard"><h3>Central Services</h3><div class="muted">Loading…</div></div>` : ""}
    <div class="card"><h3>Your storage</h3><div id="myLib" class="muted">Loading…</div></div>
    <div class="card"><h3>Publishing</h3><div id="myPub" class="muted">Loading…</div></div>
    ${me.admin ? `<div class="card wide" id="staffCard"><h3>Keys · Motion Audio staff</h3><div class="muted">Loading…</div></div>` : ""}
    ${me.reviewer ? `<div class="card wide" id="reviewCard"><h3>Review site · Motion Audio staff</h3><div class="muted">Loading…</div></div>` : ""}
    ${me.admin ? `<div class="card wide" id="opsCard"><h3>Errors, support, backups · Motion Audio staff</h3><div class="muted">Loading…</div></div>` : ""}
    <div class="card wide" id="meCard"></div></div>`;
  renderChurch(); renderTeams(); renderMe(); renderSlots(); renderPackages(); renderMyRenewals(); if (me.reviewer) renderReviewCard(); if (me.admin) { renderSaleStaff(); renderStaff(); renderOps(); renderPrices(); renderCodes(); renderReleases(); renderEditors(); renderDefaultKeys(); }
  if ($("#cfAgain")) $("#cfAgain").onclick = async () => { try { const x = await api("POST", "/account/confirm/resend"); toast(x.already ? "You're already confirmed." : "Sent! Check your inbox, and your spam folder just in case."); } catch (e) { toast(e.message); } };
  try {
    const lib = (await api("GET", "/library")).tracks;
    $("#myLib").innerHTML = lib.length ? lib.map((t) => `<div><b>${esc(t.title)}</b> <span class="muted">· ${esc(t.kind)}</span></div>`).join("") : "Nothing yet. Add or buy tracks from Central Tracks.";
    const p = await api("GET", "/publisher");
    $("#myPub").innerHTML = `<div><b>${money(p.unpaid)}</b> waiting to be paid · ${money(p.paid)} paid so far</div><div class="muted" style="font-size:.9rem">${p.addsThisMonth} subscriber adds this month · your pool share is worked out on the 1st</div>` +
      (p.tracks.length ? p.tracks.map((t) => `<div>${starHtml(t.stars)} <b>${esc(t.title)}</b> <span class="muted">· ${money(t.price)} · ${t.sales} sold · ${t.adds} subscriber adds${t.status !== "live" ? " · " + esc(t.status) : ""}</span></div>`).join("") : '<div>No tracks published yet. <a href="#publish">Publish one</a>.</div>');
  } catch (err) { $("#myPub").textContent = err.message; }
  if (me.payoutsStarted && cfg.publishableKey) mountConnect();
}
// the payout settings and Stripe's notices, on this page (Connect embedded components)
function loadScript(src) { return new Promise((ok, bad) => { if (document.querySelector(`script[src="${src}"]`)) return ok(); const x = document.createElement("script"); x.src = src; x.onload = ok; x.onerror = bad; document.head.appendChild(x); }); }
let connectUi = null;
async function mountConnect() {
  const box = document.createElement("div"); box.className = "card wide"; box.id = "connectCard";
  box.innerHTML = '<h3>Payout settings</h3><p class="muted" style="margin:0;font-size:.92rem">Your bank account and payouts, kept by Stripe. Notices appear here if Stripe needs something from you.</p><div id="cBanner"></div><div id="cPayouts"></div><div id="cManage"></div>';
  const old = $("#connectCard"); if (old) old.remove();
  $("#acctBody .acct").appendChild(box);
  try {
    await loadScript("https://connect-js.stripe.com/v1.0/connect.js");
    for (let i = 0; i < 50 && !(window.StripeConnect && window.StripeConnect.init); i++) await new Promise((r) => setTimeout(r, 100));
    connectUi = connectUi || window.StripeConnect.init({ publishableKey: cfg.publishableKey, fetchClientSecret: async () => (await api("POST", "/connect/session")).clientSecret,
      appearance: { variables: { colorPrimary: "#12161C", colorText: "#12161C", borderRadius: "6px", fontFamily: '"Helvetica Neue", Arial, system-ui, sans-serif' } } });
    $("#cBanner").appendChild(connectUi.create("notification-banner"));
    $("#cPayouts").appendChild(connectUi.create("payouts"));
    $("#cManage").appendChild(connectUi.create("account-management"));
  } catch { const b = box.querySelector("#cBanner"); if (b) b.innerHTML = '<p class="muted">Payout settings couldn\'t load. Refresh the page to try again.</p>'; }
}
// ---------------------------------------------------------------- Your downloads (#downloads)
// One card per app you have a key for: download, how to install it on this computer (others folded away), the key.
// A built pedal: where it ships and its phone setup. Sound plans: the package keys.
const PLATFORM = (() => { const u = navigator.userAgent || ""; return /iPhone|iPad|iPod/.test(u) || (/Macintosh/.test(u) && navigator.maxTouchPoints > 1) ? "ipad" : /Android/.test(u) ? "android" : /Windows/.test(u) ? "windows" : /Mac/.test(u) ? "mac" : /Linux|X11|CrOS/.test(u) ? "linux" : "windows"; })();
const PLATFORM_NAME = { windows: "Windows", mac: "Mac", linux: "Linux (Ubuntu and others)", android: "Android", ipad: "iPhone and iPad" };
function dlSection(on) { const s = $("#downloads"); if (!s) return null; s.hidden = !on; return $("#dlBody"); }
const copyBtn = (text, label) => `<button class="btn small ghost" data-copy="${esc(text)}">${label || "Copy"}</button>`;
function wireCopies(root) { root.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast("Copied"); } catch (_) { prompt("Copy this:", b.dataset.copy); } })); }
function stepsHtml(a, p) {
  if (p === "ipad") return a.phone ? `<p style="margin:.3rem 0 0;font-size:.93rem">${esc(a.phone)}</p>` : `<p class="muted" style="margin:0">${esc(a.name)} runs on ${esc(a.runsOn)}: open this page on one of those to install it.</p>`;
  if (p === "android" && !a.steps.android) return `<p class="muted" style="margin:0">${esc(a.name)} runs on ${esc(a.runsOn)}: open this page on one of those to install it.</p>`;
  return `<ol class="steps">${a.steps[p].map((s) => `<li>${esc(s)}</li>`).join("")}</ol>${p === "linux" ? `<div class="cmd"><code>${esc(a.linuxCommand)}</code>${copyBtn(a.linuxCommand)}</div>` : ""}`;
}
// (10.0) the download buttons: our own links (/download/<app>/<platform>), the one for this computer first
const PLAT_ORDER = { windows: ["windows"], mac: ["mac", "mac-intel"], linux: ["linux-deb", "linux"], android: ["android"], ipad: [] };
const PLAT_LABEL = { windows: "Windows", mac: "Mac (Apple silicon)", "mac-intel": "Mac (Intel)", linux: "Linux (AppImage)", "linux-deb": "Ubuntu / Debian", android: "Android" };
function dlLink(a) { const l = a.links || {}; const p = (PLAT_ORDER[PLATFORM] || []).find((x) => l[x]); return p ? l[p] : null; }
function otherFiles(a) {
  const l = a.links || {}, mine = dlLink(a), rest = Object.keys(l).filter((p) => l[p] !== mine);
  return rest.length ? `<p class="muted" style="margin:0;font-size:.88rem">Other computers: ${rest.map((p) => `<a href="${esc(l[p])}">${esc(PLAT_LABEL[p] || p)}</a>`).join(" · ")}</p>` : "";
}
function dlButtons(a) {
  const u = PLATFORM !== "ipad" && !(PLATFORM === "android" && !a.steps.android) ? dlLink(a) : null;
  return (u ? `<a class="btn" href="${esc(u)}">Download ${esc(a.name)}${PLATFORM === "mac" ? " for Mac" : PLATFORM === "windows" ? " for Windows" : ""}</a>` : "") + otherFiles(a);
}
// ---------------------------------------------------------------- Purchases (#purchases): the account icon → Purchases
// Everything you bought, newest first: what it is, the keys (Copy), a Download button for each app or sound library it
// covers, how to install it, and when it renews. Keys your church gave you are there too.
function puSection(on) { const s = $("#purchases"); if (!s) return null; s.hidden = !on; return $("#puBody"); }
async function showPurchases(thanks) {
  const el = puSection(true); if (!el) return;
  if (!me) { el.innerHTML = `<div class="sec-head"><h2>Purchases</h2><p>Sign in to see what you've bought, your keys and your downloads.</p></div><a class="btn" href="#account">Sign in</a>`; return; }
  el.innerHTML = `<h2>Purchases</h2><p class="muted">Loading…</p>`; $("#purchases").scrollIntoView({ behavior: "smooth" });
  let d; try { d = await api("GET", "/purchases"); } catch (e) { el.innerHTML = `<h2>Purchases</h2><p class="err">${esc(e.message)}</p>`; return; }
  const date = (x) => (x ? new Date(x).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "");
  const keyRow = (k) => `<div class="pu-key"><code>${esc(k.key)}</code>${copyBtn(k.key)}${k.who ? `<span class="muted" style="font-size:.88rem">for ${esc(k.who)}</span>` : ""}${k.inUse ? `<span class="muted" style="font-size:.88rem">· on ${k.inUse} device${k.inUse === 1 ? "" : "s"}</span>` : ""}${k.updatesUntil && k.updatesUntil !== "forever" ? `<span class="muted" style="font-size:.88rem">· updates through ${esc(k.updatesUntil)}</span>` : ""}${k.expiresAt ? `<span class="muted" style="font-size:.88rem">· free until ${esc(date(k.expiresAt))}</span>` : ""}</div>`;
  const appPart = (a) => `<div class="pu-part"><h4><img src="/brand/${esc(a.icon)}.svg" alt="">${esc(a.name)} <span class="muted" style="font-weight:400;font-size:.88rem">${esc(a.runsOn)}</span></h4>
    ${a.keys.map(keyRow).join("")}<p class="muted" style="margin:0;font-size:.9rem">Type the key the first time ${esc(a.name)} opens (${esc(a.devices)} per key).</p>
    <div class="pu-btns">${dlButtons(a)}</div>
    <details><summary>How to install it</summary><div style="margin-top:.4rem">${stepsHtml(a, PLATFORM)}</div>${Object.keys(PLATFORM_NAME).filter((p) => p !== PLATFORM && (p !== "android" || a.steps.android) && (p !== "ipad" || a.phone)).map((p) => `<div style="margin-top:.5rem"><b style="font-size:.92rem">${esc(PLATFORM_NAME[p])}</b>${stepsHtml(a, p)}</div>`).join("")}</details></div>`;
  const pkgPart = (p) => `<div class="pu-part"><h4>Package key${p.packages.length > 1 ? "s" : ""}</h4>${p.oneKey ? `<p style="margin:0">${esc(p.oneKey)}</p>` : ""}
    ${p.packages.map((k) => `<div class="pu-key"><code>${esc(k.key)}</code>${copyBtn(k.key)}<span class="muted" style="font-size:.88rem">${esc(k.plans)}${k.who ? " · for " + esc(k.who) : ""}${k.until ? " · until " + esc(date(k.until)) : ""}</span></div>`).join("")}
    <p class="muted" style="margin:0;font-size:.9rem">In any app: <b>Settings → Packages → Add a package</b>, and paste the key. Then <b>Libraries → Install</b>, or download the library here and use <b>Install from a file…</b></p>
    ${p.libraries.length ? `<div class="pu-btns">${p.libraries.map((l) => `<a class="btn ghost small" href="${esc(l.link)}">Download ${esc(l.name)}</a>`).join("")}</div>` : ""}</div>`;
  const pedalPart = (p) => `<div class="pu-part"><h4><img src="/brand/central-pedal.svg" alt="">Central Pedal</h4><p style="margin:0">${p.held ? "We're checking the order before it ships." : p.shipsTo ? "It ships to " + esc(p.shipsTo) + "." : "It ships to the address you gave."} It arrives ready, with its software on the card, and needs no key. The first time it starts, set it up from your phone:</p><ol class="steps">${p.setup.map((s) => `<li>${esc(s)}</li>`).join("")}</ol></div>`;
  const card = (p) => `<div class="pu-card" data-pu="${esc(p.id)}"><div class="pu-head"><div><h3>${esc(p.title)}</h3><div class="pu-meta">${[p.date ? date(p.date) : "", p.church ? esc(p.church) : "", p.total ? dollars(p.total) + (p.type === "subscription" ? " a month" : p.type === "plan" ? " a year" : "") : "", p.slots ? p.slots + " Central Services slots" : ""].filter(Boolean).join(" · ")}</div></div>
      <span class="pu-status${p.status === "active" || p.status === "paid" ? "" : " off"}">${esc(p.status === "paid" || p.status === "active" ? (p.type === "order" ? "Paid" : "Active") : p.status === "review" ? "Being checked" : p.status === "refunded" ? "Refunded" : p.status === "canceled" ? "Ended" : p.status)}</span></div>
    ${p.renewText ? `<p class="muted" style="margin:0;font-size:.92rem">${esc(p.renewText)}${p.renews ? " Next renewal: " + esc(date(p.renews)) + "." : ""}</p>` : ""}
    ${p.pedal ? pedalPart(p.pedal) : ""}${(p.apps || []).map(appPart).join("")}${(p.packages || []).length ? pkgPart(p) : ""}</div>`;
  el.innerHTML = `<div class="sec-head"><h2>Purchases</h2><p>${esc(thanks || "Everything you've bought, with its keys and downloads. Keys your church gave you are here too.")}</p></div>
    ${d.purchases.length ? `<div class="pu-list">${d.purchases.map(card).join("")}</div>` : `<p class="muted">Nothing here yet. Keys your church gives you come by email and show up here; things you buy for yourself too. <a href="#store">Visit the store</a>.</p>`}
    <p class="muted" style="font-size:.9rem;margin-top:1rem">Every app is free to download on the <a href="#downloads">Downloads</a> page. <a href="${esc(d.guide)}">How to install</a> covers Windows, Mac, Linux, Android and iPad.</p>`;
  wireCopies(el);
}
// the account icon's menu (signed in)
(function () {
  const icon = $("#acctIcon"), drop = $("#acctDrop"); if (!icon || !drop) return;
  const close = () => { drop.hidden = true; icon.setAttribute("aria-expanded", "false"); };
  icon.addEventListener("click", (e) => { e.stopPropagation(); const open = drop.hidden; drop.hidden = !open; icon.setAttribute("aria-expanded", String(open)); if (open) { const f = drop.querySelector("a"); if (f) f.focus(); } });
  drop.addEventListener("click", (e) => { if (e.target.closest("a,button")) close(); });
  document.addEventListener("click", (e) => { if (!e.target.closest("#acctMenu")) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !drop.hidden) { close(); icon.focus(); } });
  const out = $("#acctOut"); if (out) out.addEventListener("click", () => { const so = $("#signOut"); if (so) so.click(); });
})();
async function showDownloads(thanks) {
  const el = dlSection(true); if (!el) return;
  el.innerHTML = `<h2>Downloads</h2><p class="muted">Loading…</p>`; $("#downloads").scrollIntoView({ behavior: "smooth" });
  let pub, d = null;
  const libsP = api("GET", "/libraries").catch(() => null);   // (the sound libraries: the rest of the page doesn't wait on them)
  try { pub = await api("GET", "/downloads/apps"); if (me) d = await api("GET", "/downloads"); } catch (e) { el.innerHTML = `<h2>Downloads</h2><p class="err">${esc(e.message)}</p>`; return; }
  const libs = await libsP;
  const renewal = (d && d.renewalCents) || 2000;
  const others = (a) => Object.keys(PLATFORM_NAME).filter((p) => p !== PLATFORM && (p !== "android" || a.steps.android) && (p !== "ipad" || a.phone));
  const keyNote = (a) => `<div class="dl-keys"><span class="muted" style="font-size:.9rem">${esc(a.name)} asks for its key (it starts with <b>${esc(a.kind)}</b>) the first time it opens. Buy one in the <a href="#store">store</a>, or your church sends you yours by email. Your keys are always on your Account page and in your email.</span></div>`;
  const appCard = (a) => `<div class="dl-card"><div class="dl-head"><img src="/brand/${esc(a.icon)}.svg" alt=""><div><h3>${esc(a.name)}</h3><span class="muted">${esc(a.runsOn)}${a.phone ? " · " + (a.kind === "U" ? "iPhone and iPad in Safari" : "iPad in Safari") : ""}</span></div></div>
    ${a.keys.length ? `<div class="dl-keys">${a.keys.map((k) => `<div class="dl-key"><code>${esc(k.key)}</code>${copyBtn(k.key)}${k.inUse ? ` <span class="muted">· on ${k.inUse} device${k.inUse === 1 ? "" : "s"}</span> <button class="btn small ghost" data-dlrel="${esc(k.key)}">Release</button>` : ""}
      ${k.updatesUntil && k.updatesUntil !== "forever" ? `<span class="muted" style="font-size:.88rem;flex-basis:100%">Updates through ${esc(k.updatesUntil)}${k.renewable ? ` · <button class="btn small ghost" data-renewme="${esc(k.key)}">Renew: ten more releases, ${dollars(renewal / 100)}</button>` : ""}</span>` : ""}</div>`).join("")}
      <span class="muted" style="font-size:.9rem">Type ${a.keys.length > 1 ? "a key" : "it"} when the app first opens (${esc(a.devices)} per key).</span></div>` : keyNote(a)}
    ${dlButtons(a)}
    <div><b style="font-size:.92rem">On ${esc(PLATFORM_NAME[PLATFORM])}</b>${stepsHtml(a, PLATFORM)}</div>
    <details><summary>Other computers and phones</summary>${others(a).map((p) => `<div style="margin-top:.5rem"><b style="font-size:.92rem">${esc(PLATFORM_NAME[p])}</b>${stepsHtml(a, p)}</div>`).join("")}<p style="margin:.5rem 0 0"><a href="${esc(a.guide)}">The full install guide</a></p></details></div>`;
  const pedalCard = (p) => `<div class="dl-card"><div class="dl-head"><img src="/brand/central-pedal.svg" alt=""><div><h3>Central Pedal</h3><span class="muted">${p.held ? "Being checked before it ships" : p.shipsTo ? "Ships to " + esc(p.shipsTo) : "Ships to the address you gave"}</span></div></div>
    <p style="margin:0">It arrives with its card in and its software on it, and needs no key. The first time it starts, set it up from your phone:</p><ol class="steps">${pub.pedalSetup.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
    <p class="muted" style="margin:0;font-size:.9rem">It comes with a P key for Central Pedal Control (its card is here too), to get your songs ready at home.</p><p class="muted" style="margin:0;font-size:.9rem">No internet at church? <a href="/download/pedal/usb">Download the pedal update</a>, copy it to a USB stick, and on the pedal use Settings → Update software from USB….</p></div>`;
  const pedalPublic = `<div class="dl-card"><div class="dl-head"><img src="/brand/central-pedal.svg" alt=""><div><h3>Central Pedal</h3><span class="muted">Raspberry Pi 4 · needs no key</span></div></div>
    <p style="margin:0">It arrives with its card in and its software on it, and needs no key. The first time it starts, set it up from your phone:</p><ol class="steps">${pub.pedalSetup.map((s) => `<li>${esc(s)}</li>`).join("")}</ol><p class="muted" style="margin:0;font-size:.9rem">No internet at church? <a href="/download/pedal/usb">Download the pedal update</a>, copy it to a USB stick, and on the pedal use Settings → Update software from USB….</p></div>`;
  const sv = pub.services;
  const servicesCard = `<div class="dl-card"><div class="dl-head"><img src="/brand/${esc(sv.icon)}.svg" alt=""><div><h3>${esc(sv.name)}</h3><span class="muted">${esc(sv.runsOn)}</span></div></div>
    <div class="dl-keys"><span class="muted" style="font-size:.9rem">${esc(sv.note)}</span></div>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap">${PLATFORM !== "ipad" && dlLink(sv) ? `<a class="btn" href="${esc(dlLink(sv))}">Download ${esc(sv.name)}</a>` : ""}<a class="btn ghost" href="${esc(sv.web)}">Open it in the browser</a></div>${otherFiles(sv)}</div>`;
  const pkgCard = d && d.packages.length ? `<div class="dl-card"><div class="dl-head"><div><h3>Sound plans</h3><span class="muted">Package keys</span></div></div>
    <div class="dl-keys">${d.packages.map((k) => `<div class="dl-key"><code>${esc(k.key)}</code>${copyBtn(k.key)} <span class="muted">· ${esc(k.plans)}${k.church ? " · from " + esc(k.church) : ""} · until ${esc(longDate(k.until))}</span></div>`).join("")}</div>
    <p style="margin:0">In any app (Central Pedal, Central Pedal Control, Central Control, Central Usage): <b>Settings → Packages → Add a package</b>, and paste the key. It works on ${cfg.packageDevices || 3} of your devices at a time, each a different app (say Central Usage, Central Control and a Central Pedal).</p></div>` : "";
  const libSection = librariesHtml(libs, d);
  const mine = d ? d.apps : [], kinds = mine.map((a) => a.kind), rest = pub.apps.filter((a) => kinds.indexOf(a.kind) < 0);
  const yours = d && (mine.length || d.pedals.length || d.packages.length);
  const all = `<div class="dl-grid">${d && d.pedals.length ? "" : pedalPublic}${rest.map(appCard).join("")}${servicesCard}</div>`;
  el.innerHTML = `<div class="sec-head"><h2>Downloads</h2><p>${esc(thanks || (me ? "Your apps and keys first, then every other app." : "Download any of the apps. Each one asks for its key the first time it opens: after you buy, your keys are on your Account page and in your email. Central Pedal and Central Services need no key."))}</p></div>
    ${!me ? `<p style="margin:0 0 1rem"><a class="btn small" href="#account">Sign in to see your keys here</a></p>` : ""}
    ${yours ? `<h3 class="dl-h">Yours</h3><div class="dl-grid">${d.pedals.map(pedalCard).join("")}${mine.map(appCard).join("")}${pkgCard}</div><h3 class="dl-h">Every other app</h3>` : me ? `<p class="muted">No keys here yet. Keys your church gives you come by email; keys you buy for yourself ("Just me") show up here and in your email. <a href="#store">Visit the store</a>.</p>` : ""}
    ${all}
    ${libSection}
    <p class="muted" style="font-size:.9rem"><a href="${esc(pub.guide)}">How to install</a> covers Windows, Mac, Linux, Android and iPad.${me ? ' Your keys, with what each one is for, are under <a href="#purchases">Purchases</a>.' : ""}</p><div class="err" id="dlErr"></div>`;
  wireCopies(el);
  el.querySelectorAll("[data-renewme]").forEach((b) => (b.onclick = () => renewMine([b.dataset.renewme], renewal)));
  el.querySelectorAll("[data-dlrel]").forEach((b) => (b.onclick = async () => {
    if (!confirm("Release this key from its devices? They stop working until the key is typed again.")) return;
    try { await api("POST", "/church/release", { key: b.dataset.dlrel }); toast("Released. Type it on the device you want."); showDownloads(); } catch (e) { $("#dlErr").textContent = e.message; }
  }));
}
// the sound libraries (one per plan): anyone can download them, the plan's package key opens them in the apps.
// Signed in: which ones your plans open.
const libSize = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + " GB" : n >= 1e6 ? Math.round(n / 1e6) + " MB" : Math.max(1, Math.round(n / 1e3)) + " KB");
function librariesHtml(libs, d) {
  if (!libs || !Array.isArray(libs.libraries) || !libs.libraries.length) return "";
  const have = d ? new Set((d.packages || []).flatMap((k) => k.planIds || [])) : null;
  const list = (title, arr) => (arr && arr.length ? `<div style="margin-top:.4rem"><b style="font-size:.9rem">${esc(title)}</b><div class="muted" style="font-size:.88rem">${arr.map(esc).join(" · ")}</div></div>` : "");
  const card = (l) => {
    const price = dollars((l.planCents || 0) / 100), c = l.contents || {};
    const sounds = (c.sounds || []).map((s) => `<div style="margin-top:.4rem"><b style="font-size:.9rem">${esc(s.name)}</b> <span class="muted" style="font-size:.82rem">${esc(s.license || "")}</span><div class="muted" style="font-size:.88rem">${(s.presets || []).map(esc).join(" · ")}</div></div>`).join("");
    const opened = have ? (have.has(l.plan) ? `<span class="ok" style="font-size:.9rem">✓ Your ${esc(l.planName)} plan opens this library.</span>` : `<span class="muted" style="font-size:.9rem">Not in your plans yet. <a href="#plans">Get ${esc(l.planName)}</a></span>`) : "";
    return `<div class="dl-card lib-card" data-lib="${esc(l.id)}"><div class="dl-head"><div><h3>${esc(l.title)}</h3><span class="muted">Version ${esc(l.version)} · ${l.approximate ? "about " : ""}${esc(libSize(l.size || 0))}</span></div></div>
      ${l.summary ? `<p style="margin:0">${esc(l.summary)}</p>` : ""}
      <details><summary>What's in it</summary>${sounds}${list("Presets", c.presets)}${list("Boards", c.boards)}${list("Impulse responses (IR loader)", c.irs)}${list("Pads (every key)", c.pads)}${(l.credits || []).length ? `<p class="muted" style="font-size:.82rem;margin:.6rem 0 0">${l.credits.map(esc).join("<br>")}</p>` : ""}</details>
      <div class="dl-keys"><span class="muted" style="font-size:.9rem">Needs ${esc(l.planName)} (${esc(price)} a year${l.plan === "pads" ? ", or any other plan: they all include it" : ""}) - your package key comes by email and is on your Account page. In any app: <b>Settings → Packages</b>, add the key, then <b>Libraries → Install</b> (or download it here and use <b>Install from a file…</b>).</span>${opened ? "<br>" + opened : ""}</div>
      ${l.ready ? `<a class="btn" href="/download/library/${encodeURIComponent(l.id)}">Download ${esc(l.title)}</a>` : `<span class="muted" style="font-size:.9rem">Coming soon: this library is being built.</span>`}</div>`;
  };
  return `<h3 class="dl-h" id="libraries">Sound libraries</h3><p class="muted" style="margin:-.3rem 0 .8rem">Sounds, pads, presets, boards and impulse responses for each sound plan. Anyone can download them; they open with the plan's package key (Central Pads opens with any plan).</p><div class="dl-grid">${libs.libraries.map(card).join("")}</div>`;
}
// renewing your own ("Just me") Central Control or Central Usage keys: ten more releases each, billed to you
function renewMine(keys, cents) {
  openCheckout("Renew " + keys.length + " key" + (keys.length === 1 ? "" : "s"), "Ten more releases of updates for each, " + dollars((cents || 2000) / 100) + " a key, billed to you. The app keeps working either way.", () => api("POST", "/checkout/renew", { keys, for: "me" }));
}
// the Account page's Your keys card: every key you have (apps and sound plans), to copy; your own you can renew
async function renderMyRenewals() {
  const el = $("#myRenew"); if (!el) return;
  let d; try { d = await api("GET", "/downloads"); } catch (_) { return; }
  const keys = d.apps.flatMap((a) => a.keys.map((k) => Object.assign({ app: a.name }, k))), pk = d.packages || [];
  if (!keys.length && !pk.length) { el.innerHTML = `<p class="muted" style="margin:0;font-size:.9rem">No keys yet. Keys you buy show up here and in your email; your church sends you yours by email.</p>`; return; }
  el.innerHTML = `<div style="display:grid;gap:.3rem">${keys.map((k) => `<div class="tm"><span><b>${esc(k.app)}</b> <code>${esc(k.key)}</code>${k.updatesUntil && k.updatesUntil !== "forever" ? ` <span class="muted">· updates through ${esc(k.updatesUntil)}</span>` : ""}</span><span>${copyBtn(k.key)}${k.renewable ? ` <button class="btn small ghost" data-renewme="${esc(k.key)}">Renew (${dollars(d.renewalCents / 100)})</button>` : ""}</span></div>`).join("")}${pk.map((k) => `<div class="tm"><span><b>${esc(k.plans)}</b> <code>${esc(k.key)}</code> <span class="muted">· until ${esc(longDate(k.until))}</span></span><span>${copyBtn(k.key)}</span></div>`).join("")}</div>`;
  wireCopies(el);
  el.querySelectorAll("[data-renewme]").forEach((b) => (b.onclick = () => renewMine([b.dataset.renewme], d.renewalCents)));
}
// a church's purchase: next, add your people (each gets their app, how to install it and their key by email)
function showNext(o) {
  const el = dlSection(true); if (!el) return;
  const kinds = {}; for (const l of o.licenses || []) kinds[l.kind] = (kinds[l.kind] || 0) + 1;
  const kindText = Object.entries(kinds).map(([k, n]) => n + " " + ({ A: "Central Control (A)", U: "Central Usage (U)", P: "Central Pedal Control (P)" }[k] || k) + " key" + (n === 1 ? "" : "s")).join(", ");
  el.innerHTML = `<div class="sec-head"><h2>Thank you! Next: add your people</h2><p>${esc(o.church || "Your church")} has what you bought. Stripe has emailed the receipt.</p></div>
    <div class="dl-grid"><div class="dl-card"><h3>What you bought</h3><ul style="margin:0">${(o.itemNames || []).map((x) => `<li>${x.n > 1 ? x.n + " × " : ""}${esc(x.name)}</li>`).join("")}</ul>
      ${kindText ? `<p class="muted" style="margin:0">${esc(kindText)}${o.slots ? " · " + o.slots + " Central Services slots" : ""}</p>` : ""}${o.shipping ? `<p class="muted" style="margin:0">The pedal ships to the address you gave.</p>` : ""}</div>
    <div class="dl-card"><h3>Add your people on the Teams page</h3><p style="margin:0">Add your admins, users and Pedal Control people with their name and email. Each one gets an email with a link to make their account, their app's download link, how to install it, and their own key.</p>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn" id="goTeams">Open Teams</button><a class="btn ghost" href="#downloads">Your own downloads</a></div></div></div>`;
  $("#downloads").scrollIntoView({ behavior: "smooth" });
  $("#goTeams").onclick = () => { location.hash = "account"; setTimeout(() => { const t = $("#teamsCard"); if (t) t.scrollIntoView({ behavior: "smooth" }); }, 700); };
}
// ---------------------------------------------------------------- sound plans: my package keys
async function renderPackages() {
  const el = $("#pkgCard"); if (!el) return;
  let r; try { r = await api("GET", "/packages/mine"); } catch (e) { el.innerHTML = `<h3>Sound plans</h3><div class="err">${esc(e.message)}</div>`; return; }
  const how = `<p class="muted" style="margin:0;font-size:.9rem">On each device (Central Pedal, Central Pedal Control, Central Control or Central Usage): <b>Settings → Packages → Add a package</b>, and paste the key. A key works on ${cfg.packageDevices || 3} of your devices at a time, each a different app (say Central Usage, Central Control and a Central Pedal; never two of the same).</p>`;
  if (!r.packages.length) { el.innerHTML = `<h3>Sound plans</h3><p class="muted" style="margin:0">No sound plans yet. <a href="#plans">See the plans</a>: you get a package key by email, then paste it in any app's Settings → Packages.</p>`; return; }
  el.innerHTML = `<h3>Sound plans</h3><div class="pkgs">${r.packages.map((p) => `<div class="pkg${p.ok ? "" : " ended"}">
      <div class="pkg-top"><code style="user-select:all">${esc(p.key)}</code><button class="btn small ghost" data-pkcopy="${esc(p.key)}">Copy</button></div>
      <div><b>${esc(planListText(p.plans))}</b> <span class="muted">· ${p.from === "church" ? "from " + esc(p.church || "your church") : p.from === "trial" ? "free trial" : "yours"}</span></div>
      <div class="${p.ok ? "muted" : "err"}" style="font-size:.9rem">${p.ok ? (p.renews ? "Renews " : "Until ") + esc(longDate(p.end)) + (p.pastDue ? " · the last payment didn't go through: update your card" : "") : esc(p.error)}</div>
      ${p.devices.length ? p.devices.map((d) => `<div class="tm"><span>${esc(d.name)} <span class="muted">· ${esc(d.app)}</span></span><button class="btn small ghost" data-pkrel="${esc(p.key)}" data-pkdev="${esc(d.id)}">Release</button></div>`).join("") : `<div class="muted" style="font-size:.88rem">Not on a device yet.</div>`}</div>`).join("")}</div>
    ${how}${r.packages.some((p) => p.from === "own") ? `<div><button class="btn small ghost" id="pkBill">Renewal and card</button> <a class="btn small ghost" href="#plans">More plans</a></div>` : ""}<div class="err" id="pkMineErr"></div>`;
  el.querySelectorAll("[data-pkcopy]").forEach((b) => (b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.pkcopy); toast("Key copied"); } catch (_) { prompt("Copy this key:", b.dataset.pkcopy); } }));
  el.querySelectorAll("[data-pkrel]").forEach((b) => (b.onclick = async () => {
    if (!confirm("Release this package from that device? Its sounds stop there until the key is added again.")) return;
    try { await api("POST", "/packages/release", { key: b.dataset.pkrel, device: b.dataset.pkdev }); toast("Released. You can add it on another device now."); renderPackages(); } catch (e) { $("#pkMineErr").textContent = e.message; }
  }));
  if ($("#pkBill")) $("#pkBill").onclick = async () => { try { go((await api("POST", "/billing")).url); } catch (e) { $("#pkMineErr").textContent = e.message; } };
}
// ---------------------------------------------------------------- Teams: the church's package keys (bundles, the free trial)
async function renderTeamPackages() {
  const el = $("#teamPkgs"); if (!el) return;
  let r; try { r = await api("GET", "/church/packages"); } catch (e) { el.innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
  const head = `<h4>Sound plan package keys <span class="muted">${r.trialUntil ? "free trial: one for anyone, until " + esc(longDate(r.trialUntil)) : r.total ? r.given + " of " + r.total + " given · " + r.free + " free" : "none yet"}</span></h4>`;
  if (!r.keys.length && !r.trialUntil) { el.innerHTML = `<section class="team">${head}<p class="muted" style="margin:0">A bundle gives you a package key with all the sound plans (Central Pads too) for each person, a year. <a href="#plans">See the bundles</a>.</p></section>`; return; }
  const given = r.keys.filter((k) => k.holder), canGive = (r.free > 0 || r.trialUntil) && r.people.length;
  el.innerHTML = `<section class="team">${head}
    <p class="muted" style="margin:0;font-size:.9rem">Give someone a key: they get it by email and paste it in Settings → Packages on their devices (${cfg.packageDevices || 3} at a time, each a different app). Take it back and their copy stops working; a new key takes its place for the next person.</p>
    ${given.map((k) => `<div class="tm tmem"><div class="tmwho"><div class="tmname"><b>${esc(k.holder.name || k.holder.email)}</b>${k.trial ? ' <span class="muted">· trial</span>' : ""}</div><div class="tmsub muted">${esc(k.holder.email)} · <code>${esc(k.key)}</code> · ${k.devices.length ? k.devices.map((d) => esc(d.name)).join(", ") : "not added yet"}</div></div>
      <div class="tacts"><button class="btn small ghost" data-pkres="${esc(k.key)}">Resend</button><button class="btn small ghost" data-pkback="${esc(k.key)}" data-pkname="${esc(k.holder.name || k.holder.email)}">Take back</button></div></div>`).join("")}
    ${canGive ? `<div class="codeline"><label>Give a package key to<select id="pkWho">${r.people.map((p) => `<option value="${esc(p.email)}">${esc(p.name ? p.name + " · " + p.email : p.email)}</option>`).join("")}</select></label><button class="btn small" id="pkGive">Give and email it</button></div>`
      : r.free > 0 ? `<p class="muted" style="margin:0">Add people to a team first, then give them a key.</p>` : `<p class="muted" style="margin:0">All given. <a href="#plans">Add another bundle</a>, or take one back.</p>`}
    <div class="err" id="pkErr" style="white-space:pre-line"></div></section>`;
  if ($("#pkGive")) $("#pkGive").onclick = async () => {
    const who = r.people.find((p) => p.email === $("#pkWho").value);
    try { const x = await api("POST", "/church/packages/give", { email: who.email, name: who.name }); toast(x.sent ? "Done: " + (who.name || who.email) + "'s key is on its way by email." : "Given. Email isn't set up yet: their key is " + x.key); renderTeamPackages(); } catch (e) { $("#pkErr").textContent = e.message; }
  };
  el.querySelectorAll("[data-pkres]").forEach((b) => (b.onclick = async () => { try { const x = await api("POST", "/church/packages/resend", { key: b.dataset.pkres }); toast(x.sent ? "Sent again." : "Email isn't set up yet."); } catch (e) { $("#pkErr").textContent = e.message; } }));
  el.querySelectorAll("[data-pkback]").forEach((b) => (b.onclick = async () => {
    if (!confirm("Take " + b.dataset.pkname + "'s package key back? It stops working on their devices, and a new key is ready for someone else.")) return;
    try { await api("POST", "/church/packages/take-back", { key: b.dataset.pkback }); toast("Taken back. A new key is free to give."); renderTeamPackages(); } catch (e) { $("#pkErr").textContent = e.message; }
  }));
}
// ---------------------------------------------------------------- Central Services: the church's slots
async function renderSlots() {
  const el = $("#slotsCard"); if (!el) return;
  let p; try { p = await api("GET", "/services/slots"); } catch (e) { el.innerHTML = `<h3>Central Services</h3><div class="err">${esc(e.message)}</div>`; return; }
  const staff = me.church && isStaffRole(me.church.role), pct = p.slots ? Math.min(100, Math.round((p.used / p.slots) * 100)) : 0;
  el.innerHTML = `<h3>Central Services</h3>
    ${p.trial ? `<div class="slots-big"><b>Free trial</b><span>as many people as you like until ${new Date(p.trial).toLocaleDateString()}</span></div>` : `<div class="slots-big"><b>${p.used}<small> of ${p.slots}</small></b><span>slots in use · ${p.free} free</span></div><div class="meterbar${pct >= 100 ? " full" : ""}"><i style="width:${pct}%"></i></div>`}
    <p class="muted" style="margin:0;font-size:.92rem">Each person on your teams takes a slot, except the church account. Take someone off a team and their slot is free for the next person. Slots are bought once: ${dollars(priceOf("services-slot") || 5)} each.</p>
    ${staff ? `<div class="codeline"><label>More slots<input id="slN" type="number" min="1" max="50" value="5" style="width:90px"></label><button class="btn small" id="slAdd">Add to cart</button><a class="btn small ghost" href="/services/">Open Central Services</a></div>` : `<a class="btn small ghost" href="/services/" style="justify-self:start">Open Central Services</a>`}`;
  if ($("#slAdd")) $("#slAdd").onclick = () => { const n = Math.max(1, Math.min(50, Math.floor(+$("#slN").value || 0))); cart["services-slot"] = (cart["services-slot"] || 0) + n; updateCartBtn(); renderRack(); openCart(); };
}
// ---------------------------------------------------------------- Motion Audio staff: every code, and who used it
async function renderCodes() {
  let host = $("#codesCard"); if (!host) { $("#acctBody .acct").insertAdjacentHTML("beforeend", `<div class="card wide" id="codesCard"></div>`); host = $("#codesCard"); }
  let r; try { r = await api("GET", "/admin/codes"); } catch (e) { host.innerHTML = `<h3>Codes</h3><div class="err">${esc(e.message)}</div>`; return; }
  const when = (d) => new Date(d).toLocaleDateString();
  host.innerHTML = `<h3>Codes · Motion Audio staff</h3><p class="muted" style="margin:0;font-size:.9rem">Every discount and free trial code, and the churches that used it. Change or add codes on the Prices card.</p>
    <table class="ktable"><tr><th>Code</th><th>What it does</th><th>On</th><th>Used</th></tr>
    ${r.codes.map((c) => `<tr><td><code>${esc(c.code)}</code></td><td>${c.kind === "trial" ? "Everything free for " + c.days + " days" : c.percent + "% off, not the pedal"}${c.label ? ` <span class="muted">· ${esc(c.label)}</span>` : ""}</td><td>${c.on ? "✓" : '<span class="muted">off</span>'}</td>
      <td>${c.used ? `<details><summary>${c.used} ${c.used === 1 ? "church" : "churches"}${c.kind === "trial" ? " · " + c.active + " in a trial now" : ""}</summary>${c.uses.map((u) => `<div style="font-size:.88rem">${esc(u.church)} <span class="muted">· ${c.kind === "trial" ? (u.active ? "until " : "ended ") + when(u.until) : when(u.used_at) + (u.total_cents != null ? " · paid " + money(u.total_cents / 100) : "")}</span></div>`).join("")}</details>` : '<span class="muted">not yet</span>'}</td></tr>`).join("")}
    ${r.deleted.map((d) => `<tr><td><code>${esc(d.code)}</code></td><td class="muted">deleted</td><td></td><td>${d.uses.length} ${d.uses.length === 1 ? "church" : "churches"}</td></tr>`).join("")}</table>`;
}
// ---------------------------------------------------------------- Motion Audio staff: a sale (save, preview, put it live)
let previewing = false;
async function renderSaleStaff() {
  let host = $("#saleCard"); if (!host) { $("#acctBody .acct").insertAdjacentHTML("beforeend", `<div class="card wide" id="saleCard"></div>`); host = $("#saleCard"); }
  let r; try { r = await api("GET", "/admin/sale"); } catch (e) { host.innerHTML = `<h3>Sale</h3><div class="err">${esc(e.message)}</div>`; return; }
  const d = r.draft || {}, live = r.live, day = (x) => (x ? new Date(x).toISOString().slice(0, 10) : "");
  const same = live && d && ["name", "percent", "banner", "endsAt", "includePedal"].every((k) => (live[k] || null) === (d[k] || null));
  host.innerHTML = `<h3>Sale · Motion Audio staff</h3>
    <p class="muted" style="margin:0;font-size:.9rem">A sale shows a strip under the header and takes its % off everything in the store (not the pedal, unless you tick it). A typed code still wins. <b>Save</b> keeps it to yourself; <b>Preview</b> shows the site as customers will see it, to you only; <b>Put it live</b> shows everyone.</p>
    <div class="sale-state ${live ? "on" : ""}">${live ? `<b>Live now:</b> ${esc(live.name)}, ${live.percent}% off${live.endsAt ? " until " + new Date(live.endsAt).toLocaleDateString() : ""}${same ? "" : ' <span class="muted">· your saved changes aren\'t live yet</span>'}` : "No sale is live."}</div>
    <form id="saForm" class="sale-form"><label>Name<input id="saName" value="${esc(d.name || "")}" placeholder="Easter sale" maxlength="60" required></label><label>% off<input id="saPct" type="number" min="1" max="90" value="${esc(d.percent || 20)}" required></label>
      <label class="wide2">The line on the strip<input id="saBanner" value="${esc(d.banner || "")}" maxlength="160" placeholder="20% off every pack and key until Sunday"></label><label>Ends (optional)<input id="saEnds" type="date" value="${day(d.endsAt)}"></label>
      <label class="chk"><input type="checkbox" id="saPedal"${d.includePedal ? " checked" : ""}> <span>The built pedal too</span></label>
      <div class="sale-btns"><button class="btn small">Save</button><button class="btn small ghost" type="button" id="saPrev"${r.draft ? "" : " disabled"}>${previewing ? "Stop preview" : "Preview"}</button><button class="btn small ghost" type="button" id="saLive"${r.draft && !same ? "" : " disabled"}>Put it live</button>${live ? `<button class="btn small ghost" type="button" id="saEnd">End the sale</button>` : ""}</div></form><div class="err" id="saErr"></div>`;
  $("#saForm").onsubmit = async (e) => {
    e.preventDefault();
    try { await api("POST", "/admin/sale", { name: $("#saName").value, percent: +$("#saPct").value, banner: $("#saBanner").value, endsAt: $("#saEnds").value ? new Date($("#saEnds").value + "T23:59:00").toISOString() : null, includePedal: $("#saPedal").checked }); toast("Saved. Only you can see it (Preview)."); if (previewing) await window.refreshConfig(); renderSaleStaff(); }
    catch (err) { $("#saErr").textContent = err.message; }
  };
  $("#saPrev").onclick = async () => { previewing = !previewing; await window.refreshConfig(); renderSaleStaff(); if (previewing) { location.hash = "store"; toast("Previewing: only you see this sale"); } };
  $("#saLive").onclick = async () => { if (!confirm("Put this sale live for everyone?")) return; try { await api("POST", "/admin/sale/live", {}); previewing = false; await window.refreshConfig(); toast("The sale is live"); renderSaleStaff(); } catch (err) { $("#saErr").textContent = err.message; } };
  if ($("#saEnd")) $("#saEnd").onclick = async () => { if (!confirm("End the sale now?")) return; try { await api("POST", "/admin/sale/live", { end: true }); await window.refreshConfig(); toast("The sale has ended"); renderSaleStaff(); } catch (err) { $("#saErr").textContent = err.message; } };
}
// ---------------------------------------------------------------- Motion Audio staff: releases, and "Release to all devices"
async function renderReleases() {
  let host = $("#relCard"); if (!host) { $("#acctBody .acct").insertAdjacentHTML("beforeend", `<div class="card wide" id="relCard"></div>`); host = $("#relCard"); }
  let r; try { r = await api("GET", "/admin/releases"); } catch (e) { host.innerHTML = `<h3>Releases</h3><div class="err">${esc(e.message)}</div>`; return; }
  host.innerHTML = `<h3>Releases · Motion Audio staff</h3><p class="muted" style="margin:0;font-size:.9rem">Current: <b>${esc(r.current)}</b>. <b>Release to all devices</b> lets every app install that version, even ones whose key's updates ended before it (for an emergency fix). Apps pick it up when they next open (or within 6 hours).</p>
    ${r.releases.length ? `<table class="ktable"><tr><th>Version</th><th>Published</th><th>To all devices</th></tr>${r.releases.map((x) => `<tr><td><b>${esc(x.version)}</b> <span class="muted">${esc(x.name || "")}</span></td><td>${x.published ? new Date(x.published).toLocaleDateString() : ""}</td>
      <td>${x.everyone ? `<span style="color:var(--accent)">✓ every device</span> <button class="btn small ghost" data-ev="${esc(x.version)}" data-on="0">Stop</button>` : `<button class="btn small ghost" data-ev="${esc(x.version)}" data-on="1">Release to all devices</button>`}</td></tr>`).join("")}</table>` : `<p class="muted" style="margin:0">Couldn't read the releases from GitHub right now.</p>`}
    <div style="display:flex;gap:.4rem;flex-wrap:wrap;align-items:end"><label>Or a version<input id="evVer" placeholder="9.4.1" style="width:110px"></label><button class="btn small ghost" id="evAdd">Release to all devices</button></div><div class="err" id="evErr"></div>`;
  const send = async (version, on) => {
    if (on && !confirm("Release " + version + " to every device, even those whose updates ended before it?")) return;
    try { await api("POST", "/admin/releases", { version, everyone: on }); toast(on ? version + " goes to every device" : version + " back to normal"); renderReleases(); } catch (e) { $("#evErr").textContent = e.message; }
  };
  host.querySelectorAll("[data-ev]").forEach((b) => (b.onclick = () => send(b.dataset.ev, b.dataset.on === "1")));
  $("#evAdd").onclick = () => { const v = $("#evVer").value.trim(); if (v) send(v, true); };
}
// ---------------------------------------------------------------- Motion Audio staff: the price page
async function renderPrices() {
  let host = $("#pricesCard"); if (!host) { $("#acctBody .acct").insertAdjacentHTML("beforeend", `<div class="card wide" id="pricesCard"></div>`); host = $("#pricesCard"); }
  let r; try { r = await api("GET", "/admin/prices"); } catch (e) { host.innerHTML = `<h3>Prices</h3><div class="err">${esc(e.message)}</div>`; return; }
  const P = r.prices, $$ = (n) => host.querySelectorAll(n), d = (c) => (c / 100).toFixed(2);
  const inp = (path, v, w) => `<input data-pp="${path}" value="${esc(v)}" style="width:${w || 90}px">`;
  host.innerHTML = `<h3>Prices · Motion Audio staff</h3><p class="muted" style="margin:0;font-size:.9rem">Dollars. Changes take effect as soon as you save.${r.updatedAt ? " Last saved " + new Date(r.updatedAt).toLocaleString() + " by " + esc(r.updatedBy) + "." : ""}</p>
    <details open><summary>Store and packs</summary><p class="muted" style="margin:.3rem 0;font-size:.85rem">Prices include tax. P, A and U are the keys each one comes with (a pack's A keys are its main admin and admins); Slots are Central Services slots.</p><table class="ktable"><tr><th>Product</th><th>Price</th><th>P</th><th>A</th><th>U</th><th>Slots</th><th>Hidden</th></tr>
      ${Object.entries(P.PRODUCTS).map(([id, p]) => `<tr><td>${esc(p.name)}${p.hardware ? ' <span class="muted">(hardware)</span>' : ""}${p.addonFor ? ' <span class="muted">(with ' + esc((P.PRODUCTS[p.addonFor] || {}).name || p.addonFor) + ")</span>" : ""}</td><td>$${inp("PRODUCTS." + id + ".cents", d(p.cents))}</td>${["P", "A", "U"].map((k) => `<td>${inp("PRODUCTS." + id + ".keys." + k, (p.keys || {})[k] || 0, 50)}</td>`).join("")}<td>${inp("PRODUCTS." + id + ".slots", p.slots || 0, 55)}</td><td><input type="checkbox" data-pph="${id}" style="width:auto"${p.hidden ? " checked" : ""}></td></tr>`).join("")}</table></details>
    <details><summary>Renewal and monthly</summary><div style="display:grid;gap:.4rem">
      <label>Renewal per key $${inp("RENEWAL.cents", d(P.RENEWAL.cents))}</label>
      <label>Central Tracks Unlimited per month $${inp("SUBSCRIPTION.cents", d(P.SUBSCRIPTION.cents))}</label></div></details>
    <details><summary>Discount codes</summary><table class="ktable"><tr><th>Code</th><th>What</th><th>On</th><th></th></tr>
      ${Object.entries(P.DISCOUNTS).map(([c, x]) => `<tr><td><code>${esc(c)}</code></td><td>${x.trial ? `free trial, ${inp("DISCOUNTS." + c + ".days", x.days, 55)} days` : `${inp("DISCOUNTS." + c + ".percent", x.percent, 55)}% off (not the pedal) <label style="display:inline-flex;gap:.25rem;align-items:center;font-size:.85rem"><input type="checkbox" data-ppplans="${esc(c)}" style="width:auto"${x.plans !== false ? " checked" : ""}> and a sound plan's first year</label>`} <span class="muted">${esc(x.label)}</span></td><td><input type="checkbox" data-ppon="${esc(c)}" style="width:auto"${x.on !== false ? " checked" : ""}></td><td><button class="btn small ghost" data-ppdel="${esc(c)}">Delete</button></td></tr>`).join("")}</table>
      <div style="display:flex;gap:.4rem;flex-wrap:wrap;align-items:end"><label>New code<input id="ppCode" style="width:120px;text-transform:uppercase"></label><label>Kind<select id="ppKind" style="width:auto"><option value="percent">% off (not the pedal)</option><option value="trial">free trial (days)</option></select></label><label>Amount<input id="ppAmt" style="width:70px" placeholder="10"></label><button class="btn small ghost" id="ppAdd">Add</button></div></details>
    <details><summary>Sound plans (a year)</summary><p class="muted" style="margin:.3rem 0;font-size:.85rem">Each plan comes as a package key. A church bundle is all the plans for that many people. Central Pads comes with every plan.</p><div style="display:grid;gap:.4rem">
      ${Object.entries(P.PLANS || {}).map(([id, p]) => `<label>${esc(p.name)} $${inp("PLANS." + id + ".cents", d(p.cents))}</label>`).join("")}
      <label>${esc((P.PLAN_ALL || {}).name || "All plans")} $${inp("PLAN_ALL.cents", d((P.PLAN_ALL || {}).cents || 0))}</label>
      ${Object.entries(P.PLAN_BUNDLES || {}).map(([n, c]) => `<label>Bundle for ${esc(n)} people $${inp("PLAN_BUNDLES." + n, d(c))}</label>`).join("")}</div></details>
    <details><summary>Central Tracks star prices</summary>${[1, 2, 3, 4, 5].map((n) => `<label style="display:inline-grid;margin-right:.5rem">${n}★ $${inp("STAR_PRICE_CENTS." + n, d(P.STAR_PRICE_CENTS[n]), 60)}</label>`).join("")}</details>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn" id="ppSave">Save prices</button><button class="btn ghost" id="ppReset">Back to the starting prices</button></div><div class="err" id="ppErr"></div>`;
  const draft = JSON.parse(JSON.stringify(P));
  const setPath = (o, path, v) => { const k = path.split("."); let x = o; for (let i = 0; i < k.length - 1; i++) { x[k[i]] = x[k[i]] || {}; x = x[k[i]]; } x[k[k.length - 1]] = v; };
  const collect = () => {
    $$("[data-pp]").forEach((i) => { const path = i.dataset.pp, money = /cents|STAR_PRICE|PLAN_BUNDLES/.test(path); setPath(draft, path, money ? Math.round(parseFloat(i.value || "0") * 100) : Number(i.value || 0)); });
    $$("[data-pph]").forEach((c) => { draft.PRODUCTS[c.dataset.pph].hidden = c.checked; });
    $$("[data-ppon]").forEach((c) => { draft.DISCOUNTS[c.dataset.ppon].on = c.checked; });
    $$("[data-ppplans]").forEach((c) => { if (c.checked) delete draft.DISCOUNTS[c.dataset.ppplans].plans; else draft.DISCOUNTS[c.dataset.ppplans].plans = false; });
    return draft;
  };
  $$("[data-ppdel]").forEach((b) => (b.onclick = () => { if (confirm("Delete " + b.dataset.ppdel + "?")) { collect(); delete draft.DISCOUNTS[b.dataset.ppdel]; save(); } }));
  $("#ppAdd").onclick = () => {
    const c = ($("#ppCode").value || "").trim().toUpperCase(), n = Number($("#ppAmt").value); if (!c || !n) { $("#ppErr").textContent = "A code and an amount."; return; }
    collect(); draft.DISCOUNTS[c] = $("#ppKind").value === "trial" ? { trial: true, days: n, label: n + "-day free trial" } : { percent: n, label: n + "% off" }; save();
  };
  async function save() { try { await api("POST", "/admin/prices", { prices: draft }); cfg = await api("GET", "/config"); renderRack(); toast("Prices saved"); renderPrices(); } catch (e) { $("#ppErr").textContent = e.message; } }
  $("#ppSave").onclick = () => { collect(); save(); };
  $("#ppReset").onclick = async () => { if (!confirm("Go back to the starting prices and codes?")) return; try { await api("POST", "/admin/prices", { reset: true }); cfg = await api("GET", "/config"); renderRack(); toast("Back to the starting prices"); renderPrices(); } catch (e) { $("#ppErr").textContent = e.message; } };
}
// ---------------------------------------------------------------- your account: phone, policies, support, delete
function renderMe() {
  const el = $("#meCard"); if (!el) return;
  el.innerHTML = `<h3>Your account</h3>
    <div><b>${esc(me.email)}</b> ${me.emailConfirmed ? '<span class="muted">· confirmed</span>' : '<span class="err">· not confirmed yet</span>'}</div>
    <div>Phone for sign-in codes: ${me.phone ? `<b>${esc(me.phone)}</b>${me.phoneConfirmed ? "" : ' <span class="muted">(confirmed at your next sign-in)</span>'}` : '<span class="muted">none</span>'} ${me.twoStep ? '<span class="muted">· as an admin, each new device signs in with a code</span>' : ""}</div>
    <details><summary>Change phone</summary><form id="phForm" style="background:none;border:0;padding:0;display:flex;gap:.5rem;flex-wrap:wrap;align-items:end"><label>New mobile number<input id="phNew" type="tel" required></label><label>Your password<input id="phPw" type="password" autocomplete="current-password" required></label><button class="btn small">Save</button></form></details>
    <p style="margin:0;font-size:.92rem"><a href="/privacy" target="_blank">Privacy policy</a> · <a href="/terms" target="_blank">Terms</a> · <a href="/refunds" target="_blank">Refunds</a> · <a href="#support">Contact support</a></p>
    <details class="danger"><summary>Delete my account</summary><p class="muted" style="margin:.3rem 0">This removes your name, email and phone, frees your keys, and takes you out of your church. ${me.church && me.church.role === "church" ? "<b>This is the church account:</b> make someone a main admin first (People, below in Your church)." : me.church && me.church.role === "owner" ? "<b>You're a main admin:</b> if you're the only one, make someone else a main admin first (People, below in Your church)." : ""} It can't be undone.</p>
      <form id="delForm" style="background:none;border:0;padding:0;display:flex;gap:.5rem;flex-wrap:wrap;align-items:end"><label>Your password<input id="delPw" type="password" autocomplete="current-password" required></label><button class="btn small danger-btn">Delete my account</button></form></details>
    <div class="err" id="meErr"></div>`;
  $("#phForm").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api("POST", "/account/phone", { phone: $("#phNew").value, password: $("#phPw").value });
      if (!r.step) { toast("Saved"); return refreshMe(); }
      const ask = (err) => {
        modal(`<h3>Confirm the new number</h3><p class="muted" style="margin:0">We texted a code to <b>${esc(r.to)}</b>.</p><form id="pcForm" style="background:none;border:0;padding:0"><label>Code<input id="pcCode" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required></label><div style="display:flex;gap:.5rem"><button class="btn">Confirm</button><button class="btn ghost" type="button" data-close>Cancel</button></div><div class="err">${esc(err || "")}</div></form>`);
        $("#pcForm").onsubmit = async (e2) => { e2.preventDefault(); try { await api("POST", "/account/phone/confirm", { ticket: r.ticket, code: $("#pcCode").value }); closeModal(); toast("New phone saved. Your devices will text it a code next time you sign in."); await refreshMe(); } catch (err2) { ask(err2.message); } };
      };
      ask();
    } catch (err) { $("#meErr").textContent = err.message; }
  };
  $("#delForm").onsubmit = async (e) => {
    e.preventDefault();
    if (!confirm("Delete your Motion Audio account for good?")) return;
    const send = (closeChurch) => api("POST", "/account/delete", { password: $("#delPw").value, closeChurch });
    try { await send(false).catch(async (err) => { if (err.status === 409 && /also closes/.test(err.message) && confirm(err.message + " Delete and close it?")) return send(true); throw err; }); setToken(null); me = null; renderAll(); location.hash = ""; modal(`<h3>Your account is deleted</h3><p style="margin:0">Your details are gone and your keys are free. A confirmation is in your email.</p><button class="btn" data-close>OK</button>`); }
    catch (err) { $("#meErr").textContent = err.message; }
  };
}
// Motion Audio staff: errors from the website and the apps, support messages, the nightly backups
async function renderOps() {
  const el = $("#opsCard"); if (!el) return;
  let r, b; try { r = await api("GET", "/admin/errors"); b = await api("GET", "/admin/backups"); } catch (e) { el.innerHTML = `<h3>Errors, support, backups</h3><div class="err">${esc(e.message)}</div>`; return; }
  const open = r.errors.filter((x) => !x.resolved);
  el.innerHTML = `<h3>Errors, support, backups · Motion Audio staff</h3>
    <details ${open.length ? "open" : ""}><summary>Errors (${open.length} open)</summary>${r.errors.length ? r.errors.map((x) => `<div class="tm" style="${x.resolved ? "opacity:.55" : ""}"><div><b>${esc(x.source)} ${esc(x.version)}</b> <span class="muted">· ${x.count}× · last ${new Date(x.last_at).toLocaleString()}</span><div style="font:.85rem var(--mono);white-space:pre-wrap">${esc(x.message)}</div><details><summary class="muted" style="font-size:.85rem">Details</summary><pre style="font:.75rem var(--mono);white-space:pre-wrap">${esc(x.stack)}
${esc(JSON.stringify(x.detail, null, 1))}</pre></details></div>${x.resolved ? "" : `<button class="btn small ghost" data-fix="${x.id}">Fixed</button>`}</div>`).join("") : '<p class="muted">None.</p>'}</details>
    <details><summary>Support messages (${r.support.length})</summary>${r.support.map((x) => `<div class="tm"><div><b>#${x.id} ${esc(x.subject)}</b> <span class="muted">· ${esc(x.name || "")} &lt;${esc(x.email)}&gt; · ${esc(x.app)} ${esc(x.version)} · ${new Date(x.created_at).toLocaleString()}${x.sent ? "" : " · not emailed"}</span><div style="white-space:pre-wrap">${esc(x.message)}</div></div><a class="btn small ghost" href="mailto:${esc(x.email)}?subject=${encodeURIComponent("Re: [Support #" + x.id + "] " + x.subject)}">Reply</a></div>`).join("") || '<p class="muted">None.</p>'}</details>
    <details><summary>Backups (${b.backups.length})</summary><p class="muted" style="margin:.3rem 0;font-size:.9rem">Every night, kept 30 days, in the file storage under backups/. To restore: server/SETUP.md → Backups.</p>${b.backups.slice(0, 10).map((f) => `<div><code>${esc(f.key)}</code> <span class="muted">· ${(f.size / 1024).toFixed(0)} KB · ${new Date(f.modified).toLocaleString()}</span></div>`).join("")}<button class="btn small ghost" id="bkNow" style="margin-top:.4rem">Back up now</button></details>`;
  el.querySelectorAll("[data-fix]").forEach((x) => (x.onclick = async () => { try { await api("POST", "/admin/errors/" + x.dataset.fix + "/resolve"); renderOps(); } catch (e) { toast(e.message); } }));
  $("#bkNow").onclick = async () => { try { const k = await api("POST", "/admin/backups"); toast("Backed up · " + k.rows + " rows"); renderOps(); } catch (e) { toast(e.message); } };
}
// ---------------------------------------------------------------- the church: its keys, codes and people
async function renderChurch() {
  const el = $("#churchCard"); if (!el) return;
  let r; try { r = await api("GET", "/church"); } catch (e) { el.innerHTML = `<h3>Your church</h3><div class="err">${esc(e.message)}</div>`; return; }
  if (!r.church) {
    el.innerHTML = `<h3>Your church</h3><p class="muted" style="margin:0">This account isn't in a church yet. Admins and users join with the church's code. A new church gets its own account: make it with the church's email (like office@yourchurch.org), then invite your main admins.</p>
      <div class="acct"><form id="chMake" style="background:none;border:0;padding:0"><label>Make this the church's account: the church's name<input id="chName" placeholder="Grace Church"></label>
        <p class="muted" style="margin:0;font-size:.85rem">Only if ${esc(me.email)} is the church's own email: this account then pays for the church and adds everyone. It can't also be a person's account.</p>
        <div class="choice"><label><input type="radio" name="chOwn" value="me" checked> I'll invite the main admins later</label><label><input type="radio" name="chOwn" value="other"> Invite the first main admin now</label></div>
        <div id="chOther" hidden><label>Their name<input id="chOName"></label><label>Their own email (they get a link to make their account)<input id="chOEmail" type="email"></label></div><button class="btn small">Make the church's account</button></form>
      <form id="chJoin" style="background:none;border:0;padding:0"><label>Join with a code<input id="chCode" placeholder="from your main admin"></label><label>As <select id="chRole"><option value="user">a user</option><option value="admin">an admin</option></select></label><button class="btn small">Join</button></form></div><div class="err" id="chErr"></div>`;
    document.querySelectorAll('[name="chOwn"]').forEach((r) => (r.onchange = () => { $("#chOther").hidden = r.value !== "other" || !r.checked; }));
    $("#chMake").onsubmit = async (e) => {
      e.preventDefault(); const other = (document.querySelector('[name="chOwn"]:checked') || {}).value === "other";
      try {
        const j = await api("POST", "/church", { name: $("#chName").value, ownerEmail: other ? $("#chOEmail").value : undefined, ownerName: other ? $("#chOName").value : undefined });
        await refreshMe(); toast(j.invite ? (j.invite.sent ? "Done. We've emailed the main admin their invite." : "Done. Copy the main admin's link from the Teams card.") : "Your church is set up! Invite your main admins on the Teams card.");
      } catch (err) { $("#chErr").textContent = err.message; }
    };
    $("#chJoin").onsubmit = async (e) => { e.preventDefault(); try { const j = await api("POST", "/church/join", { code: $("#chCode").value, role: $("#chRole").value }); await refreshMe(); toast("You're in! Welcome to " + j.church + "."); } catch (err) { $("#chErr").textContent = err.message; } };
    return;
  }
  const c = r.church, staff = isStaffRole(c.role), main = isMainRole(c.role), roleName = { church: "the church account", owner: "a main admin", admin: "an admin", user: "a user" }[c.role];
  const mains = r.members.filter((m) => m.role === "owner").length, maxMain = cfg.mainAdminsMax || 2;
  const counts = Object.keys(r.counts).map((k) => `<div><span class="muted" style="font-size:.85rem">${k} · ${esc(r.counts[k].name)}</span><b>${r.counts[k].free}</b><span class="muted" style="font-size:.85rem">left · ${r.counts[k].inUse} in use · ${r.counts[k].total} in all</span></div>`).join("");
  const cur = r.current || "", behind = (k) => k.renewable && k.updatesUntil && Number(k.updatesUntil) < Number(cur) + 0.001;
  const upd = (k) => k.trial ? `<span class="muted">trial · ${k.expired ? "ended" : "until " + new Date(k.expiresAt).toLocaleDateString()}</span>` : k.updatesUntil === "forever" ? '<span class="muted">forever</span>' : `<span class="${behind(k) ? "err" : "muted"}">through ${esc(k.updatesUntil || "?")}</span>`;
  const rows = r.keys.map((k) => `<tr><td class="kk">${staff && k.renewable ? `<input type="checkbox" data-renew="${esc(k.key)}" aria-label="Renew this key">` : staff ? '<span class="kcb" aria-hidden="true"></span>' : ""}<b>${k.kind}</b></td><td><code>${esc(k.key)}</code></td><td>${k.revoked ? '<span class="err">revoked</span>' : k.expired ? '<span class="err">ended</span>' : k.inUse ? esc(k.device) + (k.app ? ` <span class="muted">· ${esc(k.app)}</span>` : "") : '<span class="muted">free</span>'}</td><td>${upd(k)}</td><td>${(staff || k.mine) && k.inUse ? `<button class="btn small ghost" data-rel="${esc(k.key)}">Release</button>` : ""}${k.mine ? ' <span class="muted" style="font-size:.85rem">yours</span>' : ""}</td></tr>`).join("");
  const T = r.trial || {};
  el.innerHTML = `<h3>${esc(c.name)} <span class="muted" style="font-weight:400;font-size:.9rem">· you're ${roleName}</span></h3>
    <div class="kcount">${counts}</div>
    ${c.adminCode || c.userCode ? `<p style="margin:.2rem 0">${c.adminCode ? `Admin code <code style="user-select:all">${esc(c.adminCode)}</code> · ` : ""}User code <code style="user-select:all">${esc(c.userCode)}</code> <span class="muted" style="font-size:.9rem">· people join with these when they make an account. Admins can all share one account; each user has their own.</span></p>` : ""}
    ${T.active ? `<div class="card" style="border-color:var(--accent);display:grid;gap:.4rem"><b>Free trial (${esc(T.code)}) until ${new Date(T.until).toLocaleDateString()}</b><span class="muted" style="font-size:.9rem">As many keys as you like, Central Services and Central Tracks Unlimited. Afterwards the trial keys stop and the apps ask for a key you bought; songs and settings stay.</span>
      ${staff ? `<div style="display:flex;gap:.4rem;flex-wrap:wrap"><button class="btn small ghost" data-mk="A">+ Admin key</button><button class="btn small ghost" data-mk="U">+ User key</button><button class="btn small ghost" data-mk="P">+ Pedal Control key</button></div>` : ""}</div>` : T.used ? `<p class="muted" style="margin:0;font-size:.9rem">Your free trial (${esc(T.code)}) has ended. <a href="#store">Get keys</a> to keep going.</p>` : ""}
    ${r.keys.length ? `<table class="ktable keytable"><tr><th></th><th>Key</th><th>On</th><th>Updates</th><th></th></tr>${rows}</table>
      ${staff && r.keys.some((k) => k.renewable) ? `<div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:end"><button class="btn small" id="renewBtn">Renew the ticked keys ($${((cfg.renewal || {}).cents || 2000) / 100} each)</button><label style="font-size:.85rem">Code<input id="renewCode" style="width:120px;text-transform:uppercase" placeholder="optional"></label><span class="muted" style="font-size:.85rem">Admin and user keys get ten releases of updates (bought at 9.0: through 10.0); renewing adds ten more. The apps keep working without it. Pedal Control keys: forever. Now: ${esc(cur)}.</span></div>` : ""}` : `<p class="muted" style="margin:0">No keys yet. <a href="#store">Get a pack or keys</a>, or start a free trial with a code in the cart.</p>`}
    <p class="muted" style="margin:0;font-size:.9rem">Release frees a key from a lost or broken device${staff ? "" : " (yours)"}. On a working device, use Settings → License → Release key in the app.</p>
    ${main ? `<div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center"><button class="btn small" id="billBtn">Billing: card &amp; receipts</button><span class="muted" style="font-size:.9rem">In ${esc(c.name)}'s name. It stays with the church when main admins change.</span></div>` : ""}
    ${c.role === "church" && !mains ? `<div class="card" style="border-color:var(--accent);display:grid;gap:.3rem"><b>Next: your main admins</b><span class="muted" style="font-size:.9rem">The main admin runs Central Control on the desk computer (the hub). Invite up to ${maxMain} on the Teams card below with their own email, or make one of your admins a main admin under People.</span></div>` : ""}
    ${r.members.length ? `<details ${main ? "open" : ""}><summary>People (${r.members.length}) · ${mains} of ${maxMain} main admins</summary>${main ? `<p class="muted" style="margin:.4rem 0 0;font-size:.88rem">${r.members.some((m) => m.role === "church") ? "The church account and up to " + maxMain + " main admins have the same controls: roles, people, billing and buying. Make one of your admins a main admin." : "A church can have " + maxMain + " main admins with the same controls. Make one of your admins a main admin, or hand yours over and stay an admin."}</p>` : ""}${r.members.map((m) => {
      const me1 = m.email === me.email, other = main && !me1 && m.role !== "church", label = { church: "church account", owner: "main admin", admin: "admin", user: "user" }[m.role];
      const acts = !other ? (me1 && m.role === "owner" && (mains > 1 || r.members.some((x) => x.role === "church")) ? `<button class="btn small ghost" data-main="${esc(m.email)}" data-on="0" data-mname="yourself">Step down to admin</button>` : "")
        : m.role === "owner" ? `<button class="btn small ghost" data-main="${esc(m.email)}" data-on="0" data-mname="${esc(m.name || m.email)}">Back to admin</button>`
        : `<select class="tmove" data-role="${esc(m.email)}" aria-label="Role"><option value="admin"${m.role === "admin" ? " selected" : ""}>Admin</option><option value="user"${m.role === "user" ? " selected" : ""}>User</option></select>`
          + (m.role === "admin" && mains < maxMain ? `<button class="btn small ghost" data-main="${esc(m.email)}" data-on="1" data-mname="${esc(m.name || m.email)}">Make main admin</button>` : "")
          + (m.role === "admin" && c.role === "owner" ? `<button class="btn small ghost" data-owner="${esc(m.email)}" data-oname="${esc(m.name || m.email)}">Hand over</button>` : "")
          + `<button class="btn small ghost" data-rm="${esc(m.email)}">Take out</button>`;
      return `<div class="tm"><div>${esc(m.name || m.email)}${me1 ? ' <span class="muted">(you)</span>' : ""} <span class="muted">· ${esc(m.email)} · </span><span class="${m.role === "owner" || m.role === "church" ? "role-main" : "muted"}">${label}</span></div>${acts ? `<div class="tacts">${acts}</div>` : ""}</div>`;
    }).join("")}
      ${main ? `<p style="margin:.4rem 0 0"><button class="btn small ghost" id="newCodes">New codes</button> <span class="muted" style="font-size:.9rem">if a code got out. People already in stay in.</span></p>` : ""}</details>` : ""}
    <div class="err" id="relErr"></div>`;
  el.querySelectorAll("[data-mk]").forEach((b) => (b.onclick = async () => { try { const x = await api("POST", "/church/trial-key", { kind: b.dataset.mk }); toast("New key " + x.key); renderChurch(); } catch (e) { $("#relErr").textContent = e.message; } }));
  if ($("#renewBtn")) $("#renewBtn").onclick = async () => {
    const keys = Array.from(el.querySelectorAll("[data-renew]:checked")).map((x) => x.dataset.renew);
    if (!keys.length) { $("#relErr").textContent = "Tick the keys to renew (only your church's full keys show a box: Pedal Control keys don't need it)."; return; }
    const code = $("#renewCode").value.trim() || undefined;
    openCheckout("Renew " + keys.length + " key" + (keys.length === 1 ? "" : "s"), "Ten more releases of updates for each, " + dollars(((cfg.renewal || {}).cents || 2000) / 100) + " a key" + (code ? " (code " + esc(code.toUpperCase()) + ")" : "") + ".", () => api("POST", "/checkout/renew", { keys, code }));
  };
  if ($("#billBtn")) $("#billBtn").onclick = async () => { try { go((await api("POST", "/church/billing")).url); } catch (e) { $("#relErr").textContent = e.message; } };
  el.querySelectorAll("[data-role]").forEach((sel) => (sel.onchange = async () => {
    try { await api("POST", "/church/role", { email: sel.dataset.role, role: sel.value }); toast(sel.dataset.role + " is now " + (sel.value === "admin" ? "an admin" : "a user")); renderChurch(); } catch (e) { $("#relErr").textContent = e.message; renderChurch(); }
  }));
  el.querySelectorAll("[data-main]").forEach((b) => (b.onclick = async () => {
    const on = b.dataset.on === "1", who = b.dataset.mname;
    if (!confirm(on ? "Make " + who + " a main admin? They get the same controls as you: roles, people and billing." : who === "yourself" ? "Step down to admin? The other main admin keeps the controls." : "Put " + who + " back to admin?")) return;
    try { await api("POST", "/church/main-admin", { email: b.dataset.main, on }); toast(on ? who + " is a main admin now" : who === "yourself" ? "You're an admin now" : who + " is an admin again"); await refreshMe(); } catch (e) { $("#relErr").textContent = e.message; }
  }));
  el.querySelectorAll("[data-owner]").forEach((b) => (b.onclick = () => {
    modal(`<h3>Hand your main admin role to ${esc(b.dataset.oname)}?</h3><p class="muted" style="margin:0">They get your controls (roles, people, billing) and you become an admin. ${esc(c.name)}'s billing and card stay with the church.</p>
      <form id="hoForm" style="background:none;border:0;padding:0"><label>Your password<input id="hoPw" type="password" autocomplete="current-password" required></label><div style="display:flex;gap:.5rem"><button class="btn">Hand it over</button><button class="btn ghost" type="button" data-close>Cancel</button></div><div class="err" id="hoErr"></div></form>`);
    $("#hoForm").onsubmit = async (e) => { e.preventDefault(); try { await api("POST", "/church/handover", { email: b.dataset.owner, password: $("#hoPw").value }); closeModal(); toast(b.dataset.oname + " is a main admin now, and you're an admin"); await refreshMe(); } catch (err) { $("#hoErr").textContent = err.message; } };
  }));
  el.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = async () => {
    if (!confirm("Take " + b.dataset.rm + " out of " + c.name + "?")) return;
    try { await api("POST", "/church/remove", { email: b.dataset.rm }); renderChurch(); } catch (e) { $("#relErr").textContent = e.message; }
  }));
  if ($("#newCodes")) $("#newCodes").onclick = async () => { if (!confirm("Make new admin and user codes? The old ones stop working.")) return; try { await api("POST", "/church/codes"); renderChurch(); } catch (e) { $("#relErr").textContent = e.message; } };
  el.querySelectorAll("[data-rel]").forEach((b) => (b.onclick = async () => {
    if (!confirm("Release " + b.dataset.rel + "? The device using it stops working until a key is entered again.")) return;
    try { await api("POST", "/church/release", { key: b.dataset.rel }); toast("Released. You can use that key on another device now."); renderChurch(); } catch (e) { $("#relErr").textContent = e.message; }
  }));
}
// ---------------------------------------------------------------- Teams: Admins, Users, Pedal Control
const SECT = [["admin", "Admins", "Central Control", "A"], ["user", "Users", "Central Usage", "U"], ["pedal", "Pedal Control", "Central Pedal Control", "P"]];
const adding = { admin: [], user: [], pedal: [] };
const isMainRole = (r) => r === "church" || r === "owner";   // (the church account and the main admins: the main admin's controls)
const isStaffRole = (r) => isMainRole(r) || r === "admin";
let teamNote = "";
async function renderTeams() {
  const el = $("#teamsCard"); if (!el) return;
  let r; try { r = await api("GET", "/church/team"); } catch (e) { el.innerHTML = `<h3>Teams</h3><div class="err">${esc(e.message)}</div>`; return; }
  const status = (m) => `<span class="tstat ${m.status.replace(" ", "")}">${{ invited: "invited", joined: "account made", "set up": "✓ app set up" }[m.status]}</span>`;
  const owner = (r.sections.owner || [])[0];
  el.innerHTML = `<h3>Teams</h3>
    <p class="muted" style="margin:0;font-size:.92rem">Add people to a team: each gets an email with a link to make their account, the download link for their app, and their key. ${r.mail ? "" : "<b>Email isn't set up yet</b> - copy each person's invite link and send it yourself."}</p>
    ${owner ? `<p style="margin:0">Main admin invite: <b>${esc(owner.name || owner.email)}</b> · ${esc(owner.email)} · ${owner.status === "invited" ? "waiting" : "✓ accepted"} <button class="btn small ghost" data-tresend="${owner.id}">Resend</button> <button class="btn small ghost" data-tcopy="${esc(owner.link)}">Copy link</button></p>` : ""}
    <div class="teams">${SECT.map(([id, title, app, kind]) => `<section class="team"><h4>${title} <span class="muted">${app} · ${r.free[id]} ${kind} key${r.free[id] === 1 ? "" : "s"} left</span></h4>
      ${r.sections[id].length ? r.sections[id].map((m) => `<div class="tm tmem"><div class="tmwho"><div class="tmname"><b>${esc(m.name || m.email)}</b>${m.role ? ` <span class="muted">· ${esc(m.role)}</span>` : ""}</div>${status(m)}<div class="tmsub muted">${esc(m.email)}${m.key ? " · <code>" + esc(m.key) + "</code>" : ""}${m.reminders && m.status === "invited" ? ` · reminded ${m.reminders}×` : ""}</div></div>
        <div class="tacts">${m.status !== "set up" ? `<button class="btn small ghost" data-tresend="${m.id}">Resend</button>` : ""}
          <select class="tmove" data-tmove="${m.id}" data-tname="${esc(m.name || m.email)}" aria-label="Move to another team"><option value="">Move to…</option>${SECT.filter((x) => x[0] !== id).map((x) => `<option value="${x[0]}">${x[1]} (${x[2]})</option>`).join("")}</select>${!r.mail ? ` <button class="btn small ghost" data-tcopy="${esc(m.link)}">Copy link</button>` : ""} <button class="btn small ghost" data-tremove="${m.id}" data-tname="${esc(m.name || m.email)}">Remove</button></div></div>`).join("") : `<p class="muted" style="margin:0">Nobody yet.</p>`}
      ${adding[id].map((a, i) => `<div class="trow"><input placeholder="Name" data-ta="${id}" data-ti="${i}" data-tf="name" value="${esc(a.name)}"><input placeholder="Email" type="email" data-ta="${id}" data-ti="${i}" data-tf="email" value="${esc(a.email)}"><input placeholder="Role (e.g. Bass, Lights)" data-ta="${id}" data-ti="${i}" data-tf="role" value="${esc(a.role)}"></div>`).join("")}
      <div style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn small ghost" data-tadd="${id}">+ Add ${adding[id].length ? "another" : "members"}</button>${adding[id].length ? `<button class="btn small" data-tdone="${id}">Done</button>` : ""}</div></section>`).join("")}</div>
    <div id="teamPkgs"></div>
    ${me.church.role === "church" && !owner ? `<details open><summary style="font-size:.92rem">Invite a main admin (with their own email)</summary><form id="ownForm" style="background:none;border:0;padding:0;display:flex;gap:.5rem;flex-wrap:wrap;align-items:end"><label>Name<input id="ownName"></label><label>Email<input id="ownEmail" type="email"></label><button class="btn small">Send the invite</button></form></details>` : ""}
    ${me.church.role === "owner" && !owner ? `<details><summary style="font-size:.92rem">Invite someone new to take over as main admin</summary><form id="ownForm" style="background:none;border:0;padding:0;display:flex;gap:.5rem;flex-wrap:wrap;align-items:end"><label>Name<input id="ownName"></label><label>Email<input id="ownEmail" type="email"></label><button class="btn small">Send the invite</button></form></details>` : ""}
    <div class="${/^✓/.test(teamNote) ? "" : "err"}" id="teamMsg" style="white-space:pre-line">${esc(teamNote)}</div>`;
  el.querySelectorAll("[data-ta]").forEach((inp) => (inp.oninput = () => { adding[inp.dataset.ta][+inp.dataset.ti][inp.dataset.tf] = inp.value; }));
  el.querySelectorAll("[data-tadd]").forEach((b) => (b.onclick = () => { adding[b.dataset.tadd].push({ name: "", email: "", role: "" }); teamNote = ""; renderTeams(); }));
  el.querySelectorAll("[data-tdone]").forEach((b) => (b.onclick = async () => {
    const id = b.dataset.tdone, list = adding[id].filter((a) => a.email.trim());
    if (!list.length) { adding[id] = []; return renderTeams(); }
    b.disabled = true;
    try {
      const res = (await api("POST", "/church/team", { section: id, members: list })).results;
      const okN = res.filter((x) => x.ok).length, bad = res.filter((x) => !x.ok);
      teamNote = (okN ? "✓ " + okN + " added" + (res.some((x) => x.ok && x.sent) ? " · their emails are on the way" : " · email isn't set up: use Copy link") : "") + (bad.length ? "\n" + bad.map((x) => x.email + ": " + x.error).join("\n") : "");
      adding[id] = list.filter((a) => bad.some((x) => x.email === a.email.trim().toLowerCase()));   // (the ones that didn't work stay to fix)
    } catch (e) { teamNote = e.message; }
    renderTeams(); renderChurch();
  }));
  el.querySelectorAll("[data-tresend]").forEach((b) => (b.onclick = async () => { try { const x = await api("POST", "/church/team/resend", { id: b.dataset.tresend }); toast(x.sent ? "Sent again." : "Email isn't set up yet, so use Copy link."); renderTeams(); } catch (e) { toast(e.message); } }));
  el.querySelectorAll("[data-tcopy]").forEach((b) => (b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.tcopy); toast("Invite link copied"); } catch (_) { prompt("Copy this invite link:", b.dataset.tcopy); } }));
  el.querySelectorAll("[data-tmove]").forEach((sel) => (sel.onchange = async () => {
    const to = sel.value, t = SECT.find((x) => x[0] === to); if (!t) return;
    if (!confirm("Move " + sel.dataset.tname + " to " + t[1] + "? They get a " + t[3] + " key for " + t[2] + " by email, and their old key is free again (its app asks for a key at its next check).")) { sel.value = ""; return; }
    try { const x = await api("POST", "/church/team/move", { id: sel.dataset.tmove, section: to }); teamNote = "✓ Moved to " + t[1] + " · new key " + x.key + (x.sent ? " · their email is on the way" : " · email isn't set up: use Copy link"); }
    catch (e) { teamNote = e.message; }
    renderTeams(); renderChurch();
  }));
  el.querySelectorAll("[data-tremove]").forEach((b) => (b.onclick = async () => {
    if (!confirm("Remove " + b.dataset.tname + "? Their key is free again right away, and their app stops asking for it at its next check.")) return;
    try { await api("POST", "/church/team/remove", { id: b.dataset.tremove }); toast("Removed. Their key is free for someone else."); renderTeams(); renderChurch(); } catch (e) { toast(e.message); }
  }));
  if ($("#ownForm")) $("#ownForm").onsubmit = async (e) => { e.preventDefault(); try { const x = await api("POST", "/church/owner", { name: $("#ownName").value, email: $("#ownEmail").value }); toast(x.sent ? "Invite sent!" : "Email isn't set up yet, so copy the link from the Teams card."); renderTeams(); } catch (err) { teamNote = err.message; renderTeams(); } };
  renderTeamPackages();
}
// ---------------------------------------------------------------- forgot password: an emailed link (an hour, once)
function forgotPassword(email, back) {
  modal(`<h3>Forgot your password?</h3><p class="muted" style="margin:0">It happens to all of us. Type your account's email and we'll send you a link to set a new one.</p>
    <form id="fpForm" style="background:none;border:0;padding:0"><label>Email<input id="fpEmail" type="email" autocomplete="username" required value="${esc(email || "")}"></label>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn">Send the link</button><button class="btn ghost" type="button" data-close>Cancel</button></div><div class="err" id="fpErr"></div></form>`);
  $("#fpForm").onsubmit = async (e) => {
    e.preventDefault();
    try { const r = await api("POST", "/password/forgot", { email: $("#fpEmail").value }); modal(`<h3>Check your email</h3><p style="margin:0">${esc(r.message)}</p><p class="muted" style="margin:0;font-size:.9rem">Nothing after a few minutes? Look in spam, or try again.</p><button class="btn" data-close>OK</button>`); }
    catch (err) { $("#fpErr").textContent = err.message; }
  };
  if (back) sessionStorage.setItem("ma-after-reset", back);
}
async function showReset(tok) {
  let info; try { info = await api("GET", "/password/reset/" + encodeURIComponent(tok)); }
  catch (e) { return modal(`<h3>Set a new password</h3><p class="err" style="margin:0">${esc(e.message)}</p><div style="display:flex;gap:.5rem"><button class="btn" id="rsAgain">Send a new link</button><button class="btn ghost" data-close>Close</button></div>`), ($("#rsAgain").onclick = () => forgotPassword("")); }
  modal(`<h3>Set a new password</h3><p class="muted" style="margin:0">For <b>${esc(info.email)}</b>. Every other device signed in with this account signs in again with the new password.</p>
    <form id="rsForm" style="background:none;border:0;padding:0"><input type="email" autocomplete="username" value="${esc(info.email)}" hidden>
    <label>New password (8+ characters)<input id="rsPass" type="password" minlength="8" autocomplete="new-password" required></label>
    <label>The same again<input id="rsPass2" type="password" minlength="8" autocomplete="new-password" required></label>
    <button class="btn">Save the new password</button><div class="err" id="rsErr"></div></form>`);
  $("#rsForm").onsubmit = async (e) => {
    e.preventDefault();
    if ($("#rsPass").value !== $("#rsPass2").value) { $("#rsErr").textContent = "The two passwords aren't the same."; return; }
    try {
      const r = await finishSignIn(await api("POST", "/password/reset", { token: tok, password: $("#rsPass").value, device: deviceId() }));
      setToken(r.token); await refreshMe(); closeModal(); toast("New password saved, and you're signed in.");
      const back = sessionStorage.getItem("ma-after-reset"); sessionStorage.removeItem("ma-after-reset");
      history.replaceState(null, "", back || "#account"); if (back) handleHash();
    } catch (err) { $("#rsErr").textContent = err.message; }
  };
}

// the link in an invite email: make the account (or sign in), then the app and the key
async function showInvite(token) {
  let inv; try { inv = await api("GET", "/invite/" + encodeURIComponent(token)); } catch (e) { return modal(`<h3>Invite</h3><p class="err">${esc(e.message)}</p><button class="btn" data-close>OK</button>`); }
  const next = (r) => modal(`<h3>Welcome to ${esc(r.church || inv.church)}</h3>
    ${inv.section === "owner" ? `<p style="margin:0">You're its main admin. Your church's page and the Teams card are under Account.</p>` : `<ol style="margin:0;padding-left:1.2rem;display:grid;gap:.4rem">
      <li>Download <b>${esc(inv.app)}</b> on your device: <a href="${esc(inv.download)}" target="_blank" rel="noopener">get it here</a></li>
      <li>Open it and connect to Wi-Fi.</li><li>Enter your key: <code style="font:600 1.05rem var(--mono);user-select:all">${esc(inv.key || "")}</code></li><li>Sign in with this account. Done.</li></ol>`}
    <button class="btn" data-close>OK</button>`);
  if (me) {
    try { const r = await api("POST", "/invite/accept", { token }); await refreshMe(); return next(r); } catch (e) { return modal(`<h3>Invite</h3><p class="err">${esc(e.message)}</p><button class="btn" data-close>OK</button>`); }
  }
  modal(`<h3>${esc(inv.church)}</h3><p class="muted" style="margin:0">${inv.section === "owner" ? "You're invited to be the main admin." : "You're invited to " + esc(inv.app) + (inv.role ? " as " + esc(inv.role) : "") + "."} Make your account${inv.used ? "" : " (or sign in if you have one)"}:</p>
    <form id="ivForm" style="background:none;border:0;padding:0"><label>Name<input id="ivName" value="${esc(inv.name || "")}"></label><label>Email<input id="ivEmail" type="email" value="${esc(inv.email)}"></label>
    <label>Password (8+ characters)<input id="ivPass" type="password" minlength="8" autocomplete="new-password"></label>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn">Make my account</button><button class="btn ghost" type="button" id="ivIn">I have an account: sign in</button><button class="btn ghost small" type="button" id="ivForgot">Forgot password?</button></div><div class="err" id="ivErr"></div></form>`);
  $("#ivForgot").onclick = () => forgotPassword($("#ivEmail").value, "#invite-" + token);
  $("#ivForm").onsubmit = async (e) => {
    e.preventDefault();
    try { const r = await finishSignIn(await api("POST", "/signup", { name: $("#ivName").value, email: $("#ivEmail").value, password: $("#ivPass").value, invite: token, device: deviceId() })); setToken(r.token); await refreshMe(); next({ church: r.church }); }
    catch (err) { $("#ivErr").textContent = err.message; }
  };
  $("#ivIn").onclick = async () => {
    try { setToken((await finishSignIn(await api("POST", "/login", { email: $("#ivEmail").value, password: $("#ivPass").value, device: deviceId() }))).token); await refreshMe(); const r = await api("POST", "/invite/accept", { token }); await refreshMe(); next(r); }
    catch (err) { $("#ivErr").textContent = err.message; }
  };
}
// (10.1) the review site: its own address, only shown here to staff and review admins (never on a public page)
async function renderReviewCard() {
  const el = $("#reviewCard"); if (!el) return;
  try {
    const r = await api("GET", "/review/link");
    el.innerHTML = `<h3>Review site · Motion Audio staff</h3><p class="muted" style="margin:0">Listen to, check and grade everything people upload (samples, loops, pads, instruments, boards, plugins and Central Tracks), approve or reject it, and take things down.${me.admin ? " As the main admin you also choose the review admins, the creators' share of each sound plan and the payout settings there." : ""} Keep this address to yourself: it isn't linked anywhere public.</p><div class="row" style="display:flex;gap:.5rem;flex-wrap:wrap"><a class="btn small" href="${esc(r.url)}">Open the review site</a></div>`;
  } catch (e) { el.innerHTML = `<h3>Review site · Motion Audio staff</h3><p class="muted" style="margin:0">${esc(e.message)}</p>`; }
}
async function renderStaff(qs) {
  const el = $("#staffCard"); if (!el) return;
  let list = []; try { list = (await api("GET", "/admin/keys?q=" + encodeURIComponent(qs || ""))).keys; } catch (e) { el.innerHTML = `<h3>Keys</h3><div class="err">${esc(e.message)}</div>`; return; }
  el.innerHTML = `<h3>Keys · Motion Audio staff</h3>
    <form id="mkForm" style="background:none;border:0;padding:0;display:flex;gap:.5rem;flex-wrap:wrap;align-items:end">
      <label>Kind<select id="mkKind"><option value="P">P · pedal / Pedal Control</option><option value="A">A · admin</option><option value="U">U · user</option></select></label>
      <label>How many<input id="mkN" type="number" min="1" max="100" value="1" style="width:90px"></label>
      <label>For church (code or id, optional)<input id="mkChurch"></label><label>Note<input id="mkNote" placeholder="pedal #12, replacement…"></label><button class="btn small">Make keys</button></form>
    <div class="keys" id="mkOut"></div>
    <label>Find a key or a church<input id="mkQ" value="${esc(qs || "")}"></label>
    <table class="ktable"><tr><th>Key</th><th>Church</th><th>On</th><th>Note</th><th></th></tr>${list.map((k) => `<tr><td><code>${esc(k.key)}</code></td><td>${esc(k.church)}</td><td>${k.revoked ? '<span class="err">revoked</span>' : k.inUse ? esc(k.device) : '<span class="muted">free</span>'}</td><td class="muted">${esc(k.note || "")}</td>
      <td>${k.inUse ? `<button class="btn small ghost" data-sk="release" data-k="${esc(k.key)}">Release</button>` : ""}<button class="btn small ghost" data-sk="${k.revoked ? "restore" : "revoke"}" data-k="${esc(k.key)}">${k.revoked ? "Restore" : "Revoke"}</button></td></tr>`).join("")}</table>`;
  $("#mkForm").onsubmit = async (e) => { e.preventDefault(); try { const r = await api("POST", "/admin/keys", { kind: $("#mkKind").value, count: +$("#mkN").value || 1, church: $("#mkChurch").value.trim() || undefined, note: $("#mkNote").value }); renderStaff(qs).then(() => { $("#mkOut").innerHTML = r.keys.map((k) => `<div><b>${esc(k)}</b></div>`).join(""); }); } catch (err) { toast(err.message); } };
  let t = 0; $("#mkQ").oninput = (e) => { clearTimeout(t); t = setTimeout(() => renderStaff(e.target.value), 300); };
  el.querySelectorAll("[data-sk]").forEach((b) => (b.onclick = async () => { try { await api("POST", "/admin/keys/" + encodeURIComponent(b.dataset.k) + "/" + b.dataset.sk); renderStaff(qs); } catch (e) { toast(e.message); } }));
}
$("#signOut").onclick = () => { setToken(null); me = null; renderAll(); toast("You're signed out. See you soon."); };

async function refreshMe() {
  if (!token) { me = null; } else { try { me = await api("GET", "/me"); } catch { me = null; } }
  renderAll();
  if (me) { let back = null; try { back = sessionStorage.getItem("ma-after-signin"); sessionStorage.removeItem("ma-after-signin"); } catch {} if (back && /^\/[\w-]+\/$/.test(back)) { location.href = back; return; } if (back) { history.replaceState(null, "", back); handleHash(); } }   // (signed in to buy a track the apps sent; 10.1: or back to Make & sell, the studio or the review site)
}
function renderAll() { renderSub(); renderPayout(); renderAccount(); loadTracks(); renderRack(); }

// ---------------------------------------------------------------- returning from Stripe
async function handleHash() {
  const h = location.hash.slice(1);
  if (h === "downloads") { if ($("#purchases")) $("#purchases").hidden = true; return showDownloads(); }
  if (h === "purchases") { if ($("#downloads")) $("#downloads").hidden = true; return showPurchases(); }
  if (!h.startsWith("order-done-") && $("#downloads")) $("#downloads").hidden = true;   // (the Downloads view shows only when it's asked for)
  if ($("#purchases")) $("#purchases").hidden = true;
  if (h.startsWith("invite-")) return showInvite(h.slice(7));
  if (h.startsWith("reset-")) return showReset(h.slice(6));
  if (h.startsWith("confirm-")) { try { const r = await api("POST", "/account/confirm", { token: h.slice(8) }); history.replaceState(null, "", "#account"); await refreshMe(); modal(`<h3>Email confirmed</h3><p style="margin:0">${esc(r.email)} is confirmed. Thanks!</p><button class="btn" data-close>OK</button>`); } catch (e) { modal(`<h3>Confirm your email</h3><p class="err" style="margin:0">${esc(e.message)}</p><button class="btn" data-close>OK</button>`); } return; }
  if (h === "support") { history.replaceState(null, "", location.pathname); return supportForm(); }
  if (h.startsWith("order-done-")) {
    const session = h.slice(11); for (const k in cart) delete cart[k]; updateCartBtn();
    modal(`<h3>Thank you!</h3><p class="muted" style="margin:0">Your order is in. We're getting your keys ready…</p>`);
    for (let i = 0; i < 15; i++) {
      const o = await api("GET", "/orders/" + encodeURIComponent(session)).catch(() => ({ pending: true }));
      if (!o.pending) {
        closeModal(); await refreshMe().catch(() => {});
        history.replaceState(null, "", o.personal ? "#purchases" : location.pathname);
        return o.personal ? showPurchases("Thank you! Here's what you just bought: your keys, the downloads and how to install them. We emailed it to you too, and it's always here under your account icon → Purchases.") : showNext(o);   // ("Just me": your downloads; a church: next, add your people)
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    modal(`<h3>Thank you!</h3><p class="muted" style="margin:0">Your payment went through. Your keys are on their way: refresh this page in a minute and you'll see them.</p><button class="btn" data-close>OK</button>`);
  } else if (h === "plans-done") {
    const bundle = !!planCart.bundle; planCart.plans = []; planCart.bundle = 0; updateCartBtn(); renderPlans(); history.replaceState(null, "", "#account");
    modal(`<h3>Thank you!</h3><p style="margin:0">${bundle ? "Your church's package keys are on the <b>Teams</b> card: give one to each person, and they get it by email." : "Your package key is on its way by email. It's also under your account icon → <a href=\"#purchases\" data-close>Purchases</a>, with the plan's sound library to download."}</p>
      <p class="muted" style="margin:0">On each device: <b>Settings → Packages → Add a package</b>, and paste the key. It works on ${cfg.packageDevices || 3} of your devices at a time, each a different app, and renews every year.</p><button class="btn" data-close>OK</button>`);
    setTimeout(refreshMe, 2500);
  } else if (h === "subscribed") { toast("Welcome to Central Tracks Unlimited! Add anything you like."); setTimeout(refreshMe, 2500); }
  else if (h.startsWith("bought-")) { toast("Thanks! It's in your storage now."); setTimeout(loadTracks, 2500); }
  else if (h === "renewed") { toast("Renewed. You've got ten more releases of updates."); setTimeout(refreshMe, 2500); }
  else if (h.startsWith("buy-")) { history.replaceState(null, "", "#tracks"); return buyFromLink(h.slice(4)); }
  else if (h === "id-done") { history.replaceState(null, "", "#publish"); toast("Thanks! Stripe is checking your ID. It usually takes a minute or two."); setTimeout(refreshMe, 4000); }
  else if (h === "payouts-done" || h === "payouts-refresh") { history.replaceState(null, "", "#publish"); if (h === "payouts-refresh") { try { go((await api("POST", "/connect")).url); } catch (e) { toast(e.message); } } else { toast("Payout setup saved."); refreshMe(); } }
}

// ---------------------------------------------------------------- staff: the default keys (on for now; off when every church has its own)
async function renderDefaultKeys() {
  let host = $("#defKeysCard"); if (!host) { $("#acctBody .acct").insertAdjacentHTML("beforeend", `<div class="card wide" id="defKeysCard"></div>`); host = $("#defKeysCard"); }
  let r; try { r = await api("GET", "/admin/default-keys"); } catch (e) { host.innerHTML = `<h3>Default keys</h3><div class="err">${esc(e.message)}</div>`; return; }
  const names = { P: "Central Pedal Control", A: "Central Control", U: "Central Usage", S: "Sound plans (all of them, a package key)" };
  host.innerHTML = `<h3>Default keys · Motion Audio staff</h3>
    <p class="muted" style="margin:0;font-size:.92rem">One shared key per app, so the apps work before every church has its own: any number of devices, updates always, no Central Tracks Unlimited. Switch them off and the apps ask for a real key at their next check (they're told it was a temporary key).</p>
    <div class="slots-big"><b>${r.on ? "On" : "Off"}</b><span>${r.on ? "the default keys work" : "the default keys don't work"}</span></div>
    <table class="ktable"><tr><th>App</th><th>Key</th></tr>${Object.entries(r.keys).map(([k, v]) => `<tr><td>${esc(names[k] || k)}</td><td><code style="user-select:all">${esc(v)}</code></td></tr>`).join("")}</table>
    ${r.demo ? `<p style="margin:.4rem 0 0"><b>${esc(r.demo.church)}</b>: keys for showing the apps to a church. The same switch turns them off, and its demo account only works while they're on.</p>
    <table class="ktable"><tr><th>For</th><th>Key</th></tr>${Object.entries(r.demo.keys).map(([k, v]) => `<tr><td>${esc(names[k] || k)}</td><td><code style="user-select:all">${esc(v)}</code></td></tr>`).join("")}${Object.entries(r.demo.packages).map(([k, plans]) => `<tr><td>${esc(plans.map((id) => (cfg.plans && cfg.plans[id] ? cfg.plans[id].name : id)).join(", "))}</td><td><code style="user-select:all">${esc(k)}</code></td></tr>`).join("")}</table>` : ""}
    <div><button class="btn small${r.on ? " ghost" : ""}" id="dkToggle">${r.on ? "Switch them off" : "Switch them on"}</button></div><div class="err" id="dkErr"></div>`;
  $("#dkToggle").onclick = async () => {
    if (r.on && !confirm("Switch the default keys off? Every app using one asks for a real key at its next check.")) return;
    try { await api("POST", "/admin/default-keys", { on: !r.on }); toast(r.on ? "Default keys are off" : "Default keys are on"); renderDefaultKeys(); } catch (e) { $("#dkErr").textContent = e.message; }
  };
}
// ---------------------------------------------------------------- staff: who can edit the website
async function renderEditors() {
  let host = $("#editorsCard"); if (!host) { $("#acctBody .acct").insertAdjacentHTML("beforeend", `<div class="card wide" id="editorsCard"></div>`); host = $("#editorsCard"); }
  let r; try { r = await api("GET", "/admin/editors"); } catch (e) { host.innerHTML = `<h3>Website editors</h3><div class="err">${esc(e.message)}</div>`; return; }
  host.innerHTML = `<h3>Website editors</h3><p class="muted" style="margin:0;font-size:.92rem">You and the rest of the Motion Audio staff can always edit the website: sign in, then press <b>Edit this page</b> at the bottom left. Add other people here to let them change the words, pictures and sections too. Prices stay with staff.</p>
    <div>${r.emails.length ? r.emails.map((e) => `<div class="tm"><span>${esc(e)}</span><button class="btn small ghost" data-ered="${esc(e)}">Remove</button></div>`).join("") : '<span class="muted">No one else yet.</span>'}</div>
    <form id="edForm" style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:end"><label style="flex:1 1 220px">Their email (the one they sign in with)<input id="edEmail" type="email" required></label><button class="btn small">Add editor</button></form><div class="err" id="edErr"></div>`;
  const save = async (emails) => { try { await api("POST", "/admin/editors", { emails }); renderEditors(); toast("Saved"); } catch (e) { $("#edErr").textContent = e.message; } };
  host.querySelectorAll("[data-ered]").forEach((b) => (b.onclick = () => save(r.emails.filter((x) => x !== b.dataset.ered))));
  $("#edForm").onsubmit = (e) => { e.preventDefault(); save(r.emails.concat($("#edEmail").value.trim())); };
}
// ---------------------------------------------------------------- hero: pad swells
// Overlapping pad envelopes in brass: they swell in once when the page opens, then breathe slowly.
(function () {
  const c = $("#wave"); if (!c) return; const x = c.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches, t0 = performance.now();
  const swells = [{ c: 0.30, w: 0.62, a: 0.92 }, { c: 0.62, w: 0.70, a: 0.70 }, { c: 0.86, w: 0.48, a: 0.48 }, { c: 0.10, w: 0.40, a: 0.36 }];
  const bell = (u, sw) => { const d = (u - sw.c) / (sw.w / 2); return Math.abs(d) >= 1 ? 0 : Math.pow(Math.cos(d * Math.PI / 2), 2.2); };
  let raf = 0;
  function draw(now) {
    const dpr = devicePixelRatio || 1, w = (c.width = c.clientWidth * dpr), h = (c.height = c.clientHeight * dpr), t = ((now || t0) - t0) / 1000;
    const attack = reduce ? 1 : Math.min(1, t / 2.2), ease = 1 - Math.pow(1 - attack, 3), base = h - dpr;
    x.clearRect(0, 0, w, h);
    swells.forEach((sw, i) => {
      const breath = reduce ? 1 : 1 + Math.sin(t * 0.55 + i * 1.7) * 0.05, s2 = { c: sw.c + (reduce ? 0 : Math.sin(t * 0.12 + i) * 0.015), w: sw.w };
      const path = () => { x.beginPath(); for (let px = 0; px <= w + 3 * dpr; px += 3 * dpr) { const y = base - bell(px / w, s2) * sw.a * breath * ease * (h - 12 * dpr); px ? x.lineTo(px, y) : x.moveTo(px, y); } };
      if (i === 0) {   // the lead swell gets a soft fill under it
        path(); x.lineTo(w, base); x.lineTo(0, base); x.closePath();
        const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "rgba(226,194,126,.16)"); g.addColorStop(1, "rgba(226,194,126,0)"); x.fillStyle = g; x.fill();
      }
      path(); x.lineWidth = (i === 0 ? 2.2 : 1.3) * dpr; x.strokeStyle = i === 0 ? "#E2C27E" : "rgba(226,194,126," + (0.55 - i * 0.1) + ")"; x.stroke();
    });
    x.fillStyle = "#343A44"; x.fillRect(0, base, w, dpr);
    if (!reduce && !document.hidden) raf = requestAnimationFrame(draw);
  }
  draw(); addEventListener("resize", () => { if (reduce) draw(); });
  document.addEventListener("visibilitychange", () => { cancelAnimationFrame(raf); if (!document.hidden) raf = requestAnimationFrame(draw); });
})();

renderTiers(); setPrice();
window.refreshConfig = () => api("GET", "/config" + (previewing ? "?preview=1" : "")).then((c) => { cfg = c; renderRack(); }).catch(() => {});
window.refreshConfig();
document.addEventListener("sitecontent", () => renderRack());
refreshMe().then(handleHash);
addEventListener("hashchange", handleHash);
