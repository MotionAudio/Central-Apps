// Motion Audio website: store, Central Tracks library, publishing and accounts, all through the /v1 API.
"use strict";
const $ = (s) => document.querySelector(s);
const money = (n) => "$" + Number(n || 0).toFixed(2);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const TIER = { 1: 5, 2: 10, 3: 15, 4: 20, 5: 30 };
const starHtml = (n) => `<span class="stars" aria-label="${n} of 5 stars">${"★".repeat(n)}<span class="off">${"★".repeat(5 - n)}</span></span>`;
const APPS_URL = "https://motionaudio.github.io/Central-Apps/";

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
function setToken(t) { token = t; try { t ? localStorage.setItem("ma-token", t) : localStorage.removeItem("ma-token"); } catch {} }

function toast(m) { const d = document.createElement("div"); d.className = "toast"; d.textContent = m; document.body.appendChild(d); setTimeout(() => d.remove(), 2600); }
function modal(html) {
  $("#modalHost").innerHTML = `<div class="modal-bg"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  $("#modalHost .modal-bg").addEventListener("click", (e) => { if (e.target.classList.contains("modal-bg") || e.target.closest("[data-close]")) closeModal(); });
}
function closeModal() { $("#modalHost").innerHTML = ""; }
function go(url) { location.href = url; }
function paymentsSoon() { modal(`<h3>Payments open soon</h3><p class="muted" style="margin:0">Checkout isn't switched on yet. Check back shortly.</p><button class="btn" data-close>OK</button>`); }
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
      if (st.step === "phone") modal(`<h3>Add your phone</h3><p class="muted" style="margin:0">You're an admin, so signing in on a new device also takes a code sent to your phone. Which mobile number should get it?</p>
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
  modal(`<h3>Contact support</h3><p class="muted" style="margin:0">${esc(note || "Tell us what's going on. We answer by email.")}${cfg.supportEmail ? ` Or email <a href="mailto:${esc(cfg.supportEmail)}">${esc(cfg.supportEmail)}</a>.` : ""}</p>
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

// ---------------------------------------------------------------- store
// prices come from the server (/config); these are the words around them
const packs = [
  { id: "pack-small", tag: "Church pack", name: "Small church" },
  { id: "pack-medium", tag: "Church pack", name: "Medium church", feature: true },
  { id: "pack-large", tag: "Church pack", name: "Large church" },
];
function packPoints(id) {   // what's in a pack, from the server (the price page changes it)
  const k = (cfg.products && cfg.products[id] && cfg.products[id].keys) || {}, pts = [];
  if (k.P) pts.push(k.P === 1 ? "Central Pedal Control" : k.P + " Central Pedal Control keys");
  if (k.A) pts.push(k.A + " admin" + (k.A > 1 ? "s" : "") + " (Central Control)");
  if (k.U) pts.push(k.U + " user" + (k.U > 1 ? "s" : "") + " (Central Usage)");
  pts.push("The pedal itself is separate ($" + priceOf("pedal") + ")");
  if (cfg.products && cfg.products["user-pack"]) pts.push("More users $" + priceOf("user-pack") + " each, admins $" + priceOf("admin"));
  return pts;
}
const products = [
  { id: "pedal", tag: "Built pedal", name: "Central Pedal", per: "one-time", pts: ["Assembled pedal with buttons and knobs", "Its software installed, with its P key", "Ships to the US and Canada"] },
  { id: "pedal-control", tag: "P key", name: "Central Pedal Control", per: "per device", pts: ["Edit songs and settings, upload them to the pedal", "Windows, macOS, Linux, iPad, iPhone, Android"] },
  { id: "admin", tag: "A key", name: "Central Control (admin)", per: "per admin device", pts: ["Main admin and admins", "Lights, slides, lyrics, cameras, in-ears, tracks, mixing", "Windows, macOS, Linux"] },
  { id: "user", tag: "U key", name: "Central Usage (user)", per: "per user device", pts: ["For each musician", "Instrument, lyrics and chord charts", "Windows, macOS, Linux, iPad, iPhone, Android"] },
  { id: "user-pack", tag: "U key · pack price", name: "Central Usage (user)", per: "per user device", packOnly: true, pts: ["For churches with a church pack", "Same app as above, $10"] },
];
const ALL = packs.concat(products);
const priceOf = (id) => (cfg.products && cfg.products[id] ? cfg.products[id].cents / 100 : 0);
const hasPack = () => !!(me && me.church && me.church.hasPack) || packs.some((p) => cart[p.id] > 0);
function card(p) {
  return `<div class="prod${p.feature ? " feature" : ""}">
    <div class="tag">${p.tag}</div><h3>${p.name}</h3>
    <div class="price">$${priceOf(p.id)}<small> ${p.per || "one-time"}</small></div>
    <ul>${(p.pts || packPoints(p.id)).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    <button class="btn" data-add="${p.id}"${p.packOnly && !hasPack() ? " disabled title=\"Buy a church pack first\"" : ""}>Add to cart</button></div>`;
}
function renderRack() {
  if (!cfg.products) return;
  $("#packs").innerHTML = packs.filter((p) => cfg.products[p.id] && !cfg.products[p.id].hidden).map(card).join("");
  $("#rack").innerHTML = products.filter((p) => cfg.products[p.id] && (!p.packOnly || hasPack()) && !cfg.products[p.id].hidden).map(card).join("") + servicesCard();
}
// Central Services: a monthly plan by the church's size (started from Account; not in the cart)
function servicesCard() {
  const sp = cfg.servicesPlan; if (!sp) return "";
  const t = sp.tiers.slice().sort((a, b) => a.upTo - b.upTo), last = t[t.length - 1];
  return `<div class="prod"><div class="tag">Whole church · monthly</div><h3>Central Services</h3><div class="price">from $${t[0].cents / 100}<small> a month</small></div>
    <ul>${t.map((x) => `<li>Up to ${x.upTo} members: $${x.cents / 100}/month</li>`).join("")}<li>More than ${last.upTo}: $${(sp.extraCents / 100).toFixed(2)} a month for each one past ${last.upTo}</li><li>The schedule for every team, on every device</li></ul>
    <a class="btn" href="#account" id="svcStart">Start it in your account</a></div>`;
}
const cartCount = () => Object.values(cart).reduce((a, b) => a + b, 0);
function updateCartBtn() { $("#cartBtn").textContent = "Cart · " + cartCount(); }
function onAdd(e) { const a = e.target.closest("[data-add]"); if (!a || a.disabled) return; cart[a.dataset.add] = (cart[a.dataset.add] || 0) + 1; updateCartBtn(); renderRack(); toast("Added to cart"); }
$("#rack").addEventListener("click", onAdd); $("#packs").addEventListener("click", onAdd);
let promo = null;   // the code in the cart: { code, percent } or { code, trial, days }
$("#cartBtn").onclick = () => openCart();
function openCart(note) {
  const ids = Object.keys(cart).filter((k) => cart[k] > 0);
  if (!ids.length && !(promo && promo.trial)) return modal(`<h3>Your cart is empty</h3><p class="muted" style="margin:0">Add a pack, the pedal or keys from the store. Have a free trial code? Add anything, or type it here:</p>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:end"><label style="flex:1">Code<input id="pcCode" placeholder="Discount or trial code" style="text-transform:uppercase"></label><button class="btn ghost" id="pcApply">Apply</button></div><div class="err" id="pcErr"></div><button class="btn" data-close>Close</button>`), wirePromo();
  let total = 0, saved = 0;
  const lines = ids.map((id) => {
    const p = ALL.find((x) => x.id === id) || { name: id }, hw = cfg.products[id] && cfg.products[id].hardware, s = priceOf(id) * cart[id];
    const d = promo && promo.percent && !hw ? Math.round(s * promo.percent) / 100 : 0; total += s - d; saved += d;
    return `<div><span>${esc(p.name)}${p.packOnly ? " (pack price)" : ""} × ${cart[id]}</span><span>${d ? `<s class="muted">${money(s)}</s> ` : ""}${money(s - d)}</span></div>`;
  }).join("");
  const needChurch = me && !me.church, trial = promo && promo.trial;
  modal(`<h3>Cart</h3><div class="lines">${lines}${saved ? `<div><span>${esc(promo.code)} · ${esc(promo.label)}</span><span>−${money(saved)}</span></div>` : ""}<div class="total"><span>Total</span><span>${money(total)}</span></div></div>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:end"><label style="flex:1">Discount or trial code<input id="pcCode" value="${esc(promo ? promo.code : "")}" placeholder="Code" style="text-transform:uppercase"></label><button class="btn ghost" id="pcApply">${promo ? "Change" : "Apply"}</button>${promo ? `<button class="btn ghost" id="pcClear">Remove</button>` : ""}</div>
    <div class="${note && /^✓/.test(note) ? "" : "err"}" id="pcErr">${esc(note || "")}</div>
    ${trial ? `<div class="card" style="border-color:var(--accent)"><b>${esc(promo.label)}</b><span class="muted" style="font-size:.9rem">Everything for ${promo.days} days, no payment: as many admin, user and Pedal Control keys as you like, Central Services and Central Tracks Unlimited. Then the trial keys stop and the apps ask for a key you bought (your songs and settings stay). One free trial per church.</span></div>` : ""}
    ${!me ? `<p class="muted" style="margin:0">Sign in or make an account first: your keys go to your church's account.</p>` : needChurch ? `<label>Your church or production's name<input id="coChurch" placeholder="Grace Church"></label><p class="muted" style="margin:0;font-size:.9rem">This makes your church's account, with you as its main admin. Your admins and users join it with its codes.</p>` : `<p class="muted" style="margin:0;font-size:.9rem">The keys go to <b>${esc(me.church.name)}</b>.</p>`}
    <p class="muted" style="margin:0;font-size:.9rem">You'll pay securely with Stripe. Your keys appear right after checkout and on your church's page.</p>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn" id="checkout">${me ? "Check out" : "Sign in"}</button><button class="btn ghost" id="clear">Empty cart</button></div><div class="err" id="coErr"></div>`);
  $("#clear").onclick = () => { for (const k in cart) delete cart[k]; updateCartBtn(); renderRack(); closeModal(); };
  wirePromo();
  if (trial) { $("#checkout").textContent = me ? "Start the free trial" : "Sign in to start the trial"; }
  $("#checkout").onclick = async () => {
    if (!me) { closeModal(); return needSignIn("Sign in or make an account, then open the cart again."); }
    if (needChurch && !$("#coChurch").value.trim()) { $("#coErr").textContent = "Give your church or production a name."; return; }
    $("#checkout").disabled = true;
    if (trial) {
      try {
        const t = await api("POST", "/trial", { code: promo.code, church: needChurch ? $("#coChurch").value.trim() : undefined });
        promo = null; await refreshMe();
        return modal(`<h3>Your free trial is on</h3><p style="margin:0"><b>${esc(t.church)}</b> has everything until <b>${new Date(t.until).toLocaleDateString()}</b>: unlimited keys, Central Services and Central Tracks Unlimited.</p>
          <p style="margin:0">Make keys as you need them: on the <b>Teams</b> card add your admins, users and Pedal Control people (each gets an email with their key), or press <b>+ Admin key</b>, <b>+ User key</b> or <b>+ Pedal Control key</b> on your church's page.</p>
          <p class="muted" style="margin:0;font-size:.9rem">Get the apps at <a href="${APPS_URL}" target="_blank" rel="noopener">${APPS_URL}</a>.</p><a class="btn" href="#account" data-close>Go to my church</a>`);
      } catch (e) { $("#coErr").textContent = e.message; $("#checkout").disabled = false; return; }
    }
    if (!cfg.payments) return paymentsSoon();
    try { go((await api("POST", "/checkout/store", { items: cart, church: needChurch ? $("#coChurch").value.trim() : undefined, code: promo && promo.percent ? promo.code : undefined })).url); } catch (e) { $("#coErr").textContent = e.message; $("#checkout").disabled = false; }
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
  $("#subBtn").textContent = on ? "Manage subscription" : "Subscribe for $77/mo";
}
$("#subBtn").onclick = async () => {
  if (!me) return needSignIn("Sign in to subscribe to Central Tracks Unlimited.");
  if (!cfg.payments) return paymentsSoon();
  try { go((await api("POST", me.subscribed ? "/billing" : "/checkout/subscription")).url); } catch (e) { toast(e.message); }
};
let searchTimer = 0;
async function loadTracks() {
  try { tracks = (await api("GET", "/tracks?q=" + encodeURIComponent($("#q").value.trim()) + "&kind=" + encodeURIComponent($("#kindF").value))).tracks; }
  catch (e) { tracks = []; $("#tbody").innerHTML = `<tr><td colspan="7" class="muted">${esc(e.message)}</td></tr>`; return; }
  renderTracks();
}
function renderTracks() {
  if (!tracks.length) { $("#tbody").innerHTML = `<tr><td colspan="7" class="muted">${$("#q").value || $("#kindF").value ? "No tracks match that search." : "No tracks yet. Be the first to publish one."}</td></tr>`; return; }
  const sub = !!(me && me.subscribed);
  $("#tbody").innerHTML = tracks.map((t) => {
    const act = t.owned ? `<span class="added">${t.mine ? "Yours" : "In storage"}</span>`
      : sub ? `<button class="btn small" data-store="${esc(t.id)}">Add to storage</button>`
      : `<button class="btn small ghost" data-buy="${esc(t.id)}">Buy ${money(t.price)}</button>`;
    return `<tr><td><div style="font-weight:600">${esc(t.title)}</div><div class="muted" style="font-size:.85rem">${esc(t.artist)}</div></td>
      <td><span class="kind">${esc(t.kind)}</span></td><td>${starHtml(t.stars)}</td><td class="num">${esc(t.key || "—")}</td><td class="num">${t.bpm || "—"}</td><td class="num">${money(t.price)}</td><td>${act}</td></tr>`;
  }).join("");
}
$("#q").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadTracks, 250); });
$("#kindF").onchange = loadTracks;
$("#tbody").addEventListener("click", async (e) => {
  const s = e.target.closest("[data-store]"), b = e.target.closest("[data-buy]");
  if (!s && !b) return;
  if (!me) return needSignIn("Sign in to add or buy tracks.");
  const id = (s || b).dataset.store || (s || b).dataset.buy, t = tracks.find((x) => x.id === id);
  if (s) {
    try { const r = await api("POST", "/tracks/" + id + "/add"); if (r._status === 402) return buyModal(t); t.owned = true; renderTracks(); toast("Added to your storage · open Central Tracks in the app to download it"); } catch (err) { toast(err.message); }
  } else buyModal(t);
});
function buyModal(t) {
  modal(`<h3>Buy track</h3><div class="lines"><div><span>${esc(t.title)}</span><span>${money(t.price)}</span></div></div>
    <p class="muted" style="margin:0">Or subscribe for $77/month to add every track.</p>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn" id="buyGo">Buy ${money(t.price)}</button><button class="btn ghost" data-close>Cancel</button></div><div class="err" id="buyErr"></div>`);
  $("#buyGo").onclick = async () => {
    if (!cfg.payments) return paymentsSoon();
    try { const r = await api("POST", "/tracks/" + t.id + "/purchase"); if (r.url || r.checkoutUrl) go(r.url || r.checkoutUrl); else { closeModal(); loadTracks(); } } catch (e) { $("#buyErr").textContent = e.message; }
  };
}

// ---------------------------------------------------------------- publishing
let grade = 0;
function renderTiers() { $("#tiers").innerHTML = [1, 2, 3, 4, 5].map((n) => `<div class="${n === grade ? "on" : ""}">${n}★<br>$${TIER[n]}</div>`).join(""); }
function setPrice() { $("#pPrice").value = grade ? money(TIER[grade]) : ""; $("#pubBtn").disabled = !grade; calc(); }
function calc() {
  const per = (grade ? TIER[grade] : 0) * 0.75; $("#perBuy").textContent = money(per);
  $("#exTotal").textContent = money(per * (+$("#exBuys").value || 0) + 3850 * Math.min(100, Math.max(0, +$("#exAdds").value || 0)) / 100);
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
$("#pubForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!me) return needSignIn("Sign in to publish tracks.");
  const mix = $("#pFile").files[0], stems = Array.from($("#pStems").files || []), msg = $("#pubMsg");
  if (!mix) return; if (!$("#pRights").checked) { msg.textContent = "Confirm you have the rights to sell this track."; return; }
  $("#pubBtn").disabled = true; msg.textContent = "";
  try {
    const all = [mix, ...stems], total = all.reduce((a, f) => a + f.size, 0); let done = 0;
    const up = [];
    for (const f of all) { const r = await uploadFile(f, (p) => { msg.textContent = "Uploading " + Math.round(((done + p * f.size) / total) * 100) + "%…"; }); done += f.size; up.push(r); }
    msg.textContent = "Grading on the server…";
    const r = await api("POST", "/publish", { title: $("#pTitle").value, artist: $("#pArtist").value, kind: $("#pKind").value, key: $("#pKey").value, bpm: +$("#pBpm").value || 0, rights: true,
      mix: up[0], stems: up.slice(1).map((s) => ({ ...s, role: guessRole(s.name) })) });
    grade = r.grade.stars; $("#gLabel").textContent = "Quality grade · final"; $("#gStars").innerHTML = starHtml(grade); showChecks(r.grade.checks, "text"); renderTiers(); calc();
    $("#pPrice").value = money(r.track.price);
    msg.textContent = "Published: " + r.track.title + " · " + grade + "★ · " + money(r.track.price) + (me.payoutsReady ? "" : " · set up payouts to get paid");
    toast("Published to Central Tracks"); e.target.reset(); grade = 0; $("#pubBtn").disabled = true; loadTracks(); refreshMe();
  } catch (err) { msg.textContent = err.message; $("#pubBtn").disabled = false; }
});
$("#payoutBtn").onclick = async () => {
  if (!cfg.payments) return paymentsSoon();
  try { go((await api("POST", "/connect")).url); } catch (e) { toast(e.message); }
};
function renderPayout() {
  const t = $("#payoutText"), b = $("#payoutBtn");
  if (!me) { t.textContent = "Sign in to publish. Earnings are paid monthly to your bank through Stripe."; b.hidden = true; return; }
  if (me.payoutsReady) { t.textContent = "Payouts are set up. Earnings over $10 are paid on the 1st of each month."; b.hidden = true; return; }
  t.textContent = (me.payoutsStarted ? "Finish setting up payouts" : "Set up payouts") + " so we can send your earnings. Stripe asks for your bank and tax details."; b.hidden = false;
  b.textContent = me.payoutsStarted ? "Finish payout setup" : "Set up payouts";
}

// ---------------------------------------------------------------- account
function signInForm(note) {
  return `<div class="acct"><div class="card"><h3>Sign in</h3>${note ? `<p class="muted" style="margin:0">${esc(note)}</p>` : ""}
    <form id="inForm" style="background:none;border:0;padding:0"><label>Email<input id="inEmail" type="email" autocomplete="username" required></label>
    <label>Password<input id="inPass" type="password" autocomplete="current-password" required></label><div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center"><button class="btn">Sign in</button><button class="btn ghost small" type="button" id="forgotBtn">Forgot password?</button></div><div class="err" id="inErr"></div></form></div>
    <div class="card"><h3>Make an account</h3><p class="muted" style="margin:0">Free. Use it to buy, subscribe, publish, and sign in to Central Tracks in the apps.</p>
    <form id="upForm" style="background:none;border:0;padding:0"><label>Name<input id="upName" autocomplete="name"></label><label>Email<input id="upEmail" type="email" autocomplete="email" required></label>
    <label>Password (8+ characters)<input id="upPass" type="password" autocomplete="new-password" minlength="8" required></label>
    <div class="choice"><b style="font-size:.95rem">Your church</b>
      <label><input type="radio" name="upCh" value="join" checked> Join my church as <select id="upRole" style="width:auto"><option value="user">a user</option><option value="admin">an admin</option></select></label>
      <label><input type="radio" name="upCh" value="make"> I'm the main admin: make our church's account</label>
      <label><input type="radio" name="upCh" value="none"> Not now (Central Tracks only)</label></div>
    <label id="upCodeL">Church code (from your main admin)<input id="upCode" placeholder="8 letters and digits"></label>
    <label id="upChurchL" hidden>Church or production name<input id="upChurch" placeholder="Grace Church"></label>
    <p class="muted" style="margin:0;font-size:.85rem">Making an account means you agree to the <a href="/terms" target="_blank">Terms</a> and the <a href="/privacy" target="_blank">Privacy policy</a>.</p>
    <button class="btn">Make account</button><div class="err" id="upErr"></div></form></div></div>`;
}
async function renderAccount(note) {
  const body = $("#acctBody");
  $("#signOut").hidden = !me; $("#acctLink").textContent = me ? "Account" : "Sign in";
  if (!me) {
    $("#acctTitle").textContent = "Sign in";
    body.innerHTML = signInForm(note);
    $("#inForm").onsubmit = async (e) => { e.preventDefault(); try { setToken((await finishSignIn(await api("POST", "/login", { email: $("#inEmail").value, password: $("#inPass").value, device: deviceId() }))).token); await refreshMe(); toast("Signed in"); } catch (err) { $("#inErr").textContent = err.message; } };
    $("#forgotBtn").onclick = () => forgotPassword($("#inEmail").value);
    const chWay = () => (document.querySelector('[name="upCh"]:checked') || {}).value;
    document.querySelectorAll('[name="upCh"]').forEach((r) => (r.onchange = () => { $("#upCodeL").hidden = chWay() !== "join"; $("#upChurchL").hidden = chWay() !== "make"; }));
    $("#upForm").onsubmit = async (e) => {
      e.preventDefault(); const w = chWay();
      if (w === "join" && !$("#upCode").value.trim()) { $("#upErr").textContent = "Enter your church's code, or pick another choice."; return; }
      if (w === "make" && !$("#upChurch").value.trim()) { $("#upErr").textContent = "Give your church or production a name."; return; }
      try {
        const r = await finishSignIn(await api("POST", "/signup", { name: $("#upName").value, email: $("#upEmail").value, password: $("#upPass").value, device: deviceId(),
          churchCode: w === "join" ? $("#upCode").value.trim() : undefined, churchRole: $("#upRole").value, churchName: w === "make" ? $("#upChurch").value.trim() : undefined }));
        setToken(r.token); await refreshMe(); toast(r.churchError ? r.churchError : "Account made · check your email to confirm it" + (r.church ? " · " + r.church : ""));
      } catch (err) { $("#upErr").textContent = err.message; }
    };
    return;
  }
  $("#acctTitle").textContent = me.name ? "Hi, " + me.name : "Your account";
  body.innerHTML = `<div class="acct">${me.emailConfirmed ? "" : `<div class="card wide confirm-card"><h3>Confirm your email</h3><p style="margin:0">We sent a link to <b>${esc(me.email)}</b>. Your receipts, keys, invites and password resets go there, so checkout waits until it's confirmed.</p><div style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn small" id="cfAgain">Send it again</button></div></div>`}
    <div class="card"><h3>Central Tracks</h3><div class="status ${me.subscribed ? "on" : ""}" style="font:500 .85rem var(--mono)">${me.subscribed ? "Unlimited · $77/month" : "Not subscribed"}</div>
      <p class="muted" style="margin:0;font-size:.92rem">In Central Pedal or Central Pedal Control: <b>+ Add songs → Central Tracks</b>. Set the server to <code style="user-select:all">${esc(location.origin)}</code> and sign in with ${esc(me.email)}.</p>
      <a class="btn ghost small" href="${APPS_URL}" target="_blank" rel="noopener" style="justify-self:start">Download the apps</a></div>
    <div class="card wide" id="churchCard"><h3>Your church</h3><div class="muted">Loading…</div></div>
    ${me.church ? `<div class="card" id="planCard"><h3>Central Services</h3><div class="muted">Loading…</div></div>` : ""}
    ${me.church && me.church.role !== "user" ? `<div class="card wide" id="teamsCard"><h3>Teams</h3><div class="muted">Loading…</div></div>` : ""}
    ${me.admin ? `<div class="card wide" id="staffCard"><h3>Keys · Motion Audio staff</h3><div class="muted">Loading…</div></div>` : ""}
    <div class="card"><h3>Your storage</h3><div id="myLib" class="muted">Loading…</div></div>
    <div class="card"><h3>Publishing</h3><div id="myPub" class="muted">Loading…</div></div>
    ${me.admin ? `<div class="card wide" id="opsCard"><h3>Errors, support, backups · Motion Audio staff</h3><div class="muted">Loading…</div></div>` : ""}
    <div class="card wide" id="meCard"></div></div>`;
  renderChurch(); renderTeams(); renderMe(); renderPlan(); if (me.admin) { renderStaff(); renderOps(); renderPrices(); renderCodes(); renderReleases(); }
  if ($("#cfAgain")) $("#cfAgain").onclick = async () => { try { const x = await api("POST", "/account/confirm/resend"); toast(x.already ? "Already confirmed" : "Sent · check your inbox (and spam)"); } catch (e) { toast(e.message); } };
  try {
    const lib = (await api("GET", "/library")).tracks;
    $("#myLib").innerHTML = lib.length ? lib.map((t) => `<div><b>${esc(t.title)}</b> <span class="muted">· ${esc(t.kind)}</span></div>`).join("") : "Nothing yet. Add or buy tracks from Central Tracks.";
    const p = await api("GET", "/publisher");
    $("#myPub").innerHTML = `<div><b>${money(p.unpaid)}</b> waiting to be paid · ${money(p.paid)} paid so far</div><div class="muted" style="font-size:.9rem">${p.addsThisMonth} subscriber adds this month · your pool share is worked out on the 1st</div>` +
      (p.tracks.length ? p.tracks.map((t) => `<div>${starHtml(t.stars)} <b>${esc(t.title)}</b> <span class="muted">· ${money(t.price)} · ${t.sales} sold · ${t.adds} subscriber adds${t.status !== "live" ? " · " + esc(t.status) : ""}</span></div>`).join("") : '<div>No tracks published yet. <a href="#publish">Publish one</a>.</div>');
  } catch (err) { $("#myPub").textContent = err.message; }
}
// ---------------------------------------------------------------- Central Services: the church's monthly plan
async function renderPlan() {
  const el = $("#planCard"); if (!el) return;
  let p; try { p = await api("GET", "/services/plan"); } catch (e) { el.innerHTML = `<h3>Central Services</h3><div class="err">${esc(e.message)}</div>`; return; }
  const owner = me.church && me.church.role === "owner";
  el.innerHTML = `<h3>Central Services</h3>
    <div class="status ${p.active || p.trial ? "on" : ""}" style="font:500 .85rem var(--mono)">${p.active ? "On · $" + ((p.charging || p.cents) / 100).toFixed(2) + "/month" : p.trial ? "On · free trial until " + new Date(p.trial).toLocaleDateString() : "Off"}</div>
    <p class="muted" style="margin:0;font-size:.92rem">The schedule for every team. ${p.members} member${p.members === 1 ? "" : "s"} in your church: <b>$${(p.cents / 100).toFixed(2)} a month</b> (${p.tiers.map((t) => "up to " + t.upTo + " $" + t.cents / 100).join(", ")}, then $${(p.extraCents / 100).toFixed(2)} each). The price follows your church's size.</p>
    ${owner ? (p.active ? `<button class="btn small ghost" id="planManage" style="justify-self:start">Change or cancel (Billing)</button>` : `<button class="btn small" id="planStart" style="justify-self:start">Start Central Services · $${(p.cents / 100).toFixed(2)}/month</button>`) : `<p class="muted" style="margin:0;font-size:.85rem">The main admin starts it.</p>`}<div class="err" id="planErr"></div>`;
  if ($("#planStart")) $("#planStart").onclick = async () => { if (!cfg.payments) return paymentsSoon(); try { go((await api("POST", "/checkout/services")).url); } catch (e) { $("#planErr").textContent = e.message; } };
  if ($("#planManage")) $("#planManage").onclick = async () => { try { go((await api("POST", "/church/billing")).url); } catch (e) { $("#planErr").textContent = e.message; } };
}
// ---------------------------------------------------------------- Motion Audio staff: every code, and who used it
async function renderCodes() {
  let host = $("#codesCard"); if (!host) { $("#acctBody .acct").insertAdjacentHTML("beforeend", `<div class="card wide" id="codesCard"></div>`); host = $("#codesCard"); }
  let r; try { r = await api("GET", "/admin/codes"); } catch (e) { host.innerHTML = `<h3>Codes</h3><div class="err">${esc(e.message)}</div>`; return; }
  const when = (d) => new Date(d).toLocaleDateString();
  host.innerHTML = `<h3>Codes · Motion Audio staff</h3><p class="muted" style="margin:0;font-size:.9rem">Every discount and free trial code, and the churches that used it. Change or add codes on the Prices card.</p>
    <table class="ktable"><tr><th>Code</th><th>What it does</th><th>On</th><th>Used</th></tr>
    ${r.codes.map((c) => `<tr><td><code>${esc(c.code)}</code></td><td>${c.kind === "trial" ? "Everything free for " + c.days + " days" : c.percent + "% off the software"}${c.label && c.label !== c.percent + "% off the software" ? ` <span class="muted">· ${esc(c.label)}</span>` : ""}</td><td>${c.on ? "✓" : '<span class="muted">off</span>'}</td>
      <td>${c.used ? `<details><summary>${c.used} ${c.used === 1 ? "church" : "churches"}${c.kind === "trial" ? " · " + c.active + " in a trial now" : ""}</summary>${c.uses.map((u) => `<div style="font-size:.88rem">${esc(u.church)} <span class="muted">· ${c.kind === "trial" ? (u.active ? "until " : "ended ") + when(u.until) : when(u.used_at) + (u.total_cents != null ? " · paid " + money(u.total_cents / 100) : "")}</span></div>`).join("")}</details>` : '<span class="muted">not yet</span>'}</td></tr>`).join("")}
    ${r.deleted.map((d) => `<tr><td><code>${esc(d.code)}</code></td><td class="muted">deleted</td><td></td><td>${d.uses.length} ${d.uses.length === 1 ? "church" : "churches"}</td></tr>`).join("")}</table>`;
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
    <details open><summary>Store and packs</summary><table class="ktable"><tr><th>Product</th><th>Price</th><th>P</th><th>A</th><th>U</th><th>Hidden</th></tr>
      ${Object.entries(P.PRODUCTS).map(([id, p]) => `<tr><td>${esc(p.name)}${p.hardware ? ' <span class="muted">(hardware)</span>' : ""}</td><td>$${inp("PRODUCTS." + id + ".cents", d(p.cents))}</td>${["P", "A", "U"].map((k) => `<td>${inp("PRODUCTS." + id + ".keys." + k, (p.keys || {})[k] || 0, 50)}</td>`).join("")}<td><input type="checkbox" data-pph="${id}" style="width:auto"${p.hidden ? " checked" : ""}></td></tr>`).join("")}</table></details>
    <details><summary>Renewal and monthly</summary><div style="display:grid;gap:.4rem">
      <label>Renewal per key $${inp("RENEWAL.cents", d(P.RENEWAL.cents))}</label>
      <label>Central Tracks Unlimited per month $${inp("SUBSCRIPTION.cents", d(P.SUBSCRIPTION.cents))}</label>
      <div>Central Services per month: ${P.SERVICES_PLAN.tiers.map((t, i) => `up to ${inp("SERVICES_PLAN.tiers." + i + ".upTo", t.upTo, 55)} members $${inp("SERVICES_PLAN.tiers." + i + ".cents", d(t.cents), 70)}`).join(" · ")} · then $${inp("SERVICES_PLAN.extraCents", d(P.SERVICES_PLAN.extraCents), 60)} each</div></div></details>
    <details><summary>Discount codes</summary><table class="ktable"><tr><th>Code</th><th>What</th><th>On</th><th></th></tr>
      ${Object.entries(P.DISCOUNTS).map(([c, x]) => `<tr><td><code>${esc(c)}</code></td><td>${x.trial ? `free trial, ${inp("DISCOUNTS." + c + ".days", x.days, 55)} days` : `${inp("DISCOUNTS." + c + ".percent", x.percent, 55)}% off the software`} <span class="muted">${esc(x.label)}</span></td><td><input type="checkbox" data-ppon="${esc(c)}" style="width:auto"${x.on !== false ? " checked" : ""}></td><td><button class="btn small ghost" data-ppdel="${esc(c)}">Delete</button></td></tr>`).join("")}</table>
      <div style="display:flex;gap:.4rem;flex-wrap:wrap;align-items:end"><label>New code<input id="ppCode" style="width:120px;text-transform:uppercase"></label><label>Kind<select id="ppKind" style="width:auto"><option value="percent">% off the software</option><option value="trial">free trial (days)</option></select></label><label>Amount<input id="ppAmt" style="width:70px" placeholder="10"></label><button class="btn small ghost" id="ppAdd">Add</button></div></details>
    <details><summary>Central Tracks star prices</summary>${[1, 2, 3, 4, 5].map((n) => `<label style="display:inline-grid;margin-right:.5rem">${n}★ $${inp("STAR_PRICE_CENTS." + n, d(P.STAR_PRICE_CENTS[n]), 60)}</label>`).join("")}</details>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn" id="ppSave">Save prices</button><button class="btn ghost" id="ppReset">Back to the starting prices</button></div><div class="err" id="ppErr"></div>`;
  const draft = JSON.parse(JSON.stringify(P));
  const setPath = (o, path, v) => { const k = path.split("."); let x = o; for (let i = 0; i < k.length - 1; i++) { x[k[i]] = x[k[i]] || {}; x = x[k[i]]; } x[k[k.length - 1]] = v; };
  const collect = () => {
    $$("[data-pp]").forEach((i) => { const path = i.dataset.pp, money = /cents|extraCents|STAR_PRICE/.test(path) && !/upTo/.test(path); setPath(draft, path, money ? Math.round(parseFloat(i.value || "0") * 100) : Number(i.value || 0)); });
    $$("[data-pph]").forEach((c) => { draft.PRODUCTS[c.dataset.pph].hidden = c.checked; });
    $$("[data-ppon]").forEach((c) => { draft.DISCOUNTS[c.dataset.ppon].on = c.checked; });
    return draft;
  };
  $$("[data-ppdel]").forEach((b) => (b.onclick = () => { if (confirm("Delete " + b.dataset.ppdel + "?")) { collect(); delete draft.DISCOUNTS[b.dataset.ppdel]; save(); } }));
  $("#ppAdd").onclick = () => {
    const c = ($("#ppCode").value || "").trim().toUpperCase(), n = Number($("#ppAmt").value); if (!c || !n) { $("#ppErr").textContent = "A code and an amount."; return; }
    collect(); draft.DISCOUNTS[c] = $("#ppKind").value === "trial" ? { trial: true, days: n, label: n + "-day free trial" } : { percent: n, label: n + "% off the software" }; save();
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
    <details class="danger"><summary>Delete my account</summary><p class="muted" style="margin:.3rem 0">This removes your name, email and phone, frees your keys, and takes you out of your church. ${me.church && me.church.role === "owner" ? "<b>You're the main admin:</b> make someone else the main admin first (People, below in Your church)." : ""} It can't be undone.</p>
      <form id="delForm" style="background:none;border:0;padding:0;display:flex;gap:.5rem;flex-wrap:wrap;align-items:end"><label>Your password<input id="delPw" type="password" autocomplete="current-password" required></label><button class="btn small danger-btn">Delete my account</button></form></details>
    <div class="err" id="meErr"></div>`;
  $("#phForm").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api("POST", "/account/phone", { phone: $("#phNew").value, password: $("#phPw").value });
      if (!r.step) { toast("Saved"); return refreshMe(); }
      const ask = (err) => {
        modal(`<h3>Confirm the new number</h3><p class="muted" style="margin:0">We texted a code to <b>${esc(r.to)}</b>.</p><form id="pcForm" style="background:none;border:0;padding:0"><label>Code<input id="pcCode" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required></label><div style="display:flex;gap:.5rem"><button class="btn">Confirm</button><button class="btn ghost" type="button" data-close>Cancel</button></div><div class="err">${esc(err || "")}</div></form>`);
        $("#pcForm").onsubmit = async (e2) => { e2.preventDefault(); try { await api("POST", "/account/phone/confirm", { ticket: r.ticket, code: $("#pcCode").value }); closeModal(); toast("New phone saved · each device confirms with it at its next sign-in"); await refreshMe(); } catch (err2) { ask(err2.message); } };
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
    el.innerHTML = `<h3>Your church</h3><p class="muted" style="margin:0">Your account isn't in a church yet. The main admin makes it; admins and users join with its code.</p>
      <div class="acct"><form id="chMake" style="background:none;border:0;padding:0"><label>Make our church's account: its name<input id="chName" placeholder="Grace Church"></label>
        <div class="choice"><label><input type="radio" name="chOwn" value="me" checked> I'm the main admin</label><label><input type="radio" name="chOwn" value="other"> The main admin is someone else</label></div>
        <div id="chOther" hidden><label>Their name<input id="chOName"></label><label>Their email (they get a link to make their account)<input id="chOEmail" type="email"></label></div><button class="btn small">Make our church</button></form>
      <form id="chJoin" style="background:none;border:0;padding:0"><label>Join with a code<input id="chCode" placeholder="from your main admin"></label><label>As <select id="chRole"><option value="user">a user</option><option value="admin">an admin</option></select></label><button class="btn small">Join</button></form></div><div class="err" id="chErr"></div>`;
    document.querySelectorAll('[name="chOwn"]').forEach((r) => (r.onchange = () => { $("#chOther").hidden = r.value !== "other" || !r.checked; }));
    $("#chMake").onsubmit = async (e) => {
      e.preventDefault(); const other = (document.querySelector('[name="chOwn"]:checked') || {}).value === "other";
      try {
        const j = await api("POST", "/church", { name: $("#chName").value, ownerEmail: other ? $("#chOEmail").value : undefined, ownerName: other ? $("#chOName").value : undefined });
        await refreshMe(); toast(j.invite ? (j.invite.sent ? "Made · the main admin's invite is on its way" : "Made · copy the main admin's link from the Teams card") : "Your church's account is made");
      } catch (err) { $("#chErr").textContent = err.message; }
    };
    $("#chJoin").onsubmit = async (e) => { e.preventDefault(); try { const j = await api("POST", "/church/join", { code: $("#chCode").value, role: $("#chRole").value }); await refreshMe(); toast("You joined " + j.church); } catch (err) { $("#chErr").textContent = err.message; } };
    return;
  }
  const c = r.church, staff = c.role === "owner" || c.role === "admin", roleName = { owner: "main admin", admin: "admin", user: "user" }[c.role];
  const counts = Object.keys(r.counts).map((k) => `<div><span class="muted" style="font-size:.85rem">${k} · ${esc(r.counts[k].name)}</span><b>${r.counts[k].free}</b><span class="muted" style="font-size:.85rem">left · ${r.counts[k].inUse} in use · ${r.counts[k].total} in all</span></div>`).join("");
  const cur = r.current || "", behind = (k) => k.renewable && k.updatesUntil && Number(k.updatesUntil) < Number(cur) + 0.001;
  const upd = (k) => k.trial ? `<span class="muted">trial · ${k.expired ? "ended" : "until " + new Date(k.expiresAt).toLocaleDateString()}</span>` : k.updatesUntil === "forever" ? '<span class="muted">forever</span>' : `<span class="${behind(k) ? "err" : "muted"}">through ${esc(k.updatesUntil || "?")}</span>`;
  const rows = r.keys.map((k) => `<tr><td>${staff && k.renewable ? `<input type="checkbox" data-renew="${esc(k.key)}" style="width:auto" aria-label="Renew this key">` : ""} ${k.kind}</td><td><code>${esc(k.key)}</code></td><td>${k.revoked ? '<span class="err">revoked</span>' : k.expired ? '<span class="err">ended</span>' : k.inUse ? esc(k.device) + (k.app ? ` <span class="muted">· ${esc(k.app)}</span>` : "") : '<span class="muted">free</span>'}</td><td>${upd(k)}</td><td>${(staff || k.mine) && k.inUse ? `<button class="btn small ghost" data-rel="${esc(k.key)}">Release</button>` : ""}${k.mine ? ' <span class="muted" style="font-size:.85rem">yours</span>' : ""}</td></tr>`).join("");
  const T = r.trial || {};
  el.innerHTML = `<h3>${esc(c.name)} <span class="muted" style="font-weight:400;font-size:.9rem">· you're ${roleName}</span></h3>
    <div class="kcount">${counts}</div>
    ${c.adminCode || c.userCode ? `<p style="margin:.2rem 0">${c.adminCode ? `Admin code <code style="user-select:all">${esc(c.adminCode)}</code> · ` : ""}User code <code style="user-select:all">${esc(c.userCode)}</code> <span class="muted" style="font-size:.9rem">· people join with these when they make an account. Admins can all share one account; each user has their own.</span></p>` : ""}
    ${T.active ? `<div class="card" style="border-color:var(--accent);display:grid;gap:.4rem"><b>Free trial (${esc(T.code)}) until ${new Date(T.until).toLocaleDateString()}</b><span class="muted" style="font-size:.9rem">As many keys as you like, Central Services and Central Tracks Unlimited. Afterwards the trial keys stop and the apps ask for a key you bought; songs and settings stay.</span>
      ${staff ? `<div style="display:flex;gap:.4rem;flex-wrap:wrap"><button class="btn small ghost" data-mk="A">+ Admin key</button><button class="btn small ghost" data-mk="U">+ User key</button><button class="btn small ghost" data-mk="P">+ Pedal Control key</button></div>` : ""}</div>` : T.used ? `<p class="muted" style="margin:0;font-size:.9rem">Your free trial (${esc(T.code)}) has ended. <a href="#store">Get keys</a> to keep going.</p>` : ""}
    ${r.keys.length ? `<table class="ktable"><tr><th></th><th>Key</th><th>On</th><th>Updates</th><th></th></tr>${rows}</table>
      ${staff && r.keys.some((k) => k.renewable) ? `<div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:end"><button class="btn small" id="renewBtn">Renew the ticked keys ($${((cfg.renewal || {}).cents || 2000) / 100} each)</button><label style="font-size:.85rem">Code<input id="renewCode" style="width:120px;text-transform:uppercase" placeholder="optional"></label><span class="muted" style="font-size:.85rem">Admin and user keys get ten releases of updates (bought at 9.0: through 10.0); renewing adds ten more. The apps keep working without it. Pedal Control keys: forever. Now: ${esc(cur)}.</span></div>` : ""}` : `<p class="muted" style="margin:0">No keys yet. <a href="#store">Get a church pack or keys</a>, or start a free trial with a code in the cart.</p>`}
    <p class="muted" style="margin:0;font-size:.9rem">Release frees a key from a lost or broken device${staff ? "" : " (yours)"}. On a working device, use Settings → License → Release key in the app.</p>
    ${c.role === "owner" ? `<div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center"><button class="btn small" id="billBtn">Billing: card &amp; receipts</button><span class="muted" style="font-size:.9rem">In ${esc(c.name)}'s name. It stays with the church if the main admin changes.</span></div>` : ""}
    ${r.members.length ? `<details ${c.role === "owner" ? "open" : ""}><summary>People (${r.members.length})</summary>${r.members.map((m) => `<div class="tm"><div>${esc(m.name || m.email)} <span class="muted">· ${esc(m.email)} · ${{ owner: "main admin", admin: "admin", user: "user" }[m.role]}</span></div>${c.role === "owner" && m.role !== "owner" ? `<div class="tacts"><select class="tmove" data-role="${esc(m.email)}" aria-label="Role"><option value="admin"${m.role === "admin" ? " selected" : ""}>Admin</option><option value="user"${m.role === "user" ? " selected" : ""}>User</option></select><button class="btn small ghost" data-owner="${esc(m.email)}" data-oname="${esc(m.name || m.email)}">Make main admin</button><button class="btn small ghost" data-rm="${esc(m.email)}">Take out</button></div>` : ""}</div>`).join("")}
      ${c.role === "owner" ? `<p style="margin:.4rem 0 0"><button class="btn small ghost" id="newCodes">New codes</button> <span class="muted" style="font-size:.9rem">if a code got out. People already in stay in.</span></p>` : ""}</details>` : ""}
    <div class="err" id="relErr"></div>`;
  el.querySelectorAll("[data-mk]").forEach((b) => (b.onclick = async () => { try { const x = await api("POST", "/church/trial-key", { kind: b.dataset.mk }); toast("New key " + x.key); renderChurch(); } catch (e) { $("#relErr").textContent = e.message; } }));
  if ($("#renewBtn")) $("#renewBtn").onclick = async () => {
    const keys = Array.from(el.querySelectorAll("[data-renew]:checked")).map((x) => x.dataset.renew);
    if (!keys.length) { $("#relErr").textContent = "Tick the keys to renew (only your church's full keys show a box: Pedal Control keys don't need it)."; return; }
    if (!cfg.payments) return paymentsSoon();
    try { go((await api("POST", "/checkout/renew", { keys, code: $("#renewCode").value.trim() || undefined })).url); } catch (e) { $("#relErr").textContent = e.message; }
  };
  if ($("#billBtn")) $("#billBtn").onclick = async () => { try { go((await api("POST", "/church/billing")).url); } catch (e) { $("#relErr").textContent = e.message; } };
  el.querySelectorAll("[data-role]").forEach((sel) => (sel.onchange = async () => {
    try { await api("POST", "/church/role", { email: sel.dataset.role, role: sel.value }); toast(sel.dataset.role + " is now " + (sel.value === "admin" ? "an admin" : "a user")); renderChurch(); } catch (e) { $("#relErr").textContent = e.message; renderChurch(); }
  }));
  el.querySelectorAll("[data-owner]").forEach((b) => (b.onclick = () => {
    modal(`<h3>Make ${esc(b.dataset.oname)} the main admin?</h3><p class="muted" style="margin:0">They get your controls (roles, people, billing). You stay an admin. ${esc(c.name)}'s billing and card stay with the church.</p>
      <form id="hoForm" style="background:none;border:0;padding:0"><label>Your password<input id="hoPw" type="password" autocomplete="current-password" required></label><div style="display:flex;gap:.5rem"><button class="btn">Make them main admin</button><button class="btn ghost" type="button" data-close>Cancel</button></div><div class="err" id="hoErr"></div></form>`);
    $("#hoForm").onsubmit = async (e) => { e.preventDefault(); try { await api("POST", "/church/handover", { email: b.dataset.owner, password: $("#hoPw").value }); closeModal(); toast(b.dataset.oname + " is the main admin now"); await refreshMe(); } catch (err) { $("#hoErr").textContent = err.message; } };
  }));
  el.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = async () => {
    if (!confirm("Take " + b.dataset.rm + " out of " + c.name + "?")) return;
    try { await api("POST", "/church/remove", { email: b.dataset.rm }); renderChurch(); } catch (e) { $("#relErr").textContent = e.message; }
  }));
  if ($("#newCodes")) $("#newCodes").onclick = async () => { if (!confirm("Make new admin and user codes? The old ones stop working.")) return; try { await api("POST", "/church/codes"); renderChurch(); } catch (e) { $("#relErr").textContent = e.message; } };
  el.querySelectorAll("[data-rel]").forEach((b) => (b.onclick = async () => {
    if (!confirm("Release " + b.dataset.rel + "? The device using it stops working until a key is entered again.")) return;
    try { await api("POST", "/church/release", { key: b.dataset.rel }); toast("Released · it can be used on another device"); renderChurch(); } catch (e) { $("#relErr").textContent = e.message; }
  }));
}
// ---------------------------------------------------------------- Teams: Admins, Users, Pedal Control
const SECT = [["admin", "Admins", "Central Control", "A"], ["user", "Users", "Central Usage", "U"], ["pedal", "Pedal Control", "Central Pedal Control", "P"]];
const adding = { admin: [], user: [], pedal: [] };
let teamNote = "";
async function renderTeams() {
  const el = $("#teamsCard"); if (!el) return;
  let r; try { r = await api("GET", "/church/team"); } catch (e) { el.innerHTML = `<h3>Teams</h3><div class="err">${esc(e.message)}</div>`; return; }
  const status = (m) => `<span class="tstat ${m.status.replace(" ", "")}">${{ invited: "invited", joined: "account made", "set up": "✓ app set up" }[m.status]}</span>`;
  const owner = (r.sections.owner || [])[0];
  el.innerHTML = `<h3>Teams</h3>
    <p class="muted" style="margin:0;font-size:.92rem">Add people to a team: each gets an email with a link to make their account, the download link for their app, and their key. ${r.mail ? "" : "<b>Email isn't set up yet</b> - copy each person's invite link and send it yourself."}</p>
    ${owner ? `<p style="margin:0">Main admin invite: <b>${esc(owner.name || owner.email)}</b> · ${esc(owner.email)} · ${owner.status === "invited" ? "waiting" : "✓ accepted"} <button class="btn small ghost" data-tresend="${owner.id}">Resend</button> <button class="btn small ghost" data-tcopy="${esc(owner.link)}">Copy link</button></p>` : ""}
    <div class="teams">${SECT.map(([id, title, app, kind]) => `<section class="team"><h4>${title} <span class="muted">· ${app} · ${r.free[id]} ${kind} key${r.free[id] === 1 ? "" : "s"} left</span></h4>
      ${r.sections[id].length ? r.sections[id].map((m) => `<div class="tm"><div><b>${esc(m.name || m.email)}</b>${m.role ? ` <span class="muted">· ${esc(m.role)}</span>` : ""}<div class="muted" style="font-size:.85rem">${esc(m.email)}${m.key ? " · <code>" + esc(m.key) + "</code>" : ""}</div></div>
        <div class="tacts">${status(m)}${m.reminders && m.status === "invited" ? ` <span class="muted" style="font-size:.8rem">reminded ${m.reminders}×</span>` : ""}${m.status !== "set up" ? ` <button class="btn small ghost" data-tresend="${m.id}">Resend</button>` : ""}
          <select class="tmove" data-tmove="${m.id}" data-tname="${esc(m.name || m.email)}" aria-label="Move to another team"><option value="">Move to…</option>${SECT.filter((x) => x[0] !== id).map((x) => `<option value="${x[0]}">${x[1]} (${x[2]})</option>`).join("")}</select>${!r.mail ? ` <button class="btn small ghost" data-tcopy="${esc(m.link)}">Copy link</button>` : ""} <button class="btn small ghost" data-tremove="${m.id}" data-tname="${esc(m.name || m.email)}">Remove</button></div></div>`).join("") : `<p class="muted" style="margin:0">Nobody yet.</p>`}
      ${adding[id].map((a, i) => `<div class="trow"><input placeholder="Name" data-ta="${id}" data-ti="${i}" data-tf="name" value="${esc(a.name)}"><input placeholder="Email" type="email" data-ta="${id}" data-ti="${i}" data-tf="email" value="${esc(a.email)}"><input placeholder="Role (e.g. Bass, Lights)" data-ta="${id}" data-ti="${i}" data-tf="role" value="${esc(a.role)}"></div>`).join("")}
      <div style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn small ghost" data-tadd="${id}">+ Add ${adding[id].length ? "another" : "members"}</button>${adding[id].length ? `<button class="btn small" data-tdone="${id}">Done</button>` : ""}</div></section>`).join("")}</div>
    ${me.church.role === "owner" && !owner ? `<details><summary style="font-size:.92rem">Make someone else the main admin</summary><form id="ownForm" style="background:none;border:0;padding:0;display:flex;gap:.5rem;flex-wrap:wrap;align-items:end"><label>Name<input id="ownName"></label><label>Email<input id="ownEmail" type="email"></label><button class="btn small">Send the invite</button></form></details>` : ""}
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
  el.querySelectorAll("[data-tresend]").forEach((b) => (b.onclick = async () => { try { const x = await api("POST", "/church/team/resend", { id: b.dataset.tresend }); toast(x.sent ? "Sent again" : "Email isn't set up: use Copy link"); renderTeams(); } catch (e) { toast(e.message); } }));
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
    try { await api("POST", "/church/team/remove", { id: b.dataset.tremove }); toast("Removed · their key is free"); renderTeams(); renderChurch(); } catch (e) { toast(e.message); }
  }));
  if ($("#ownForm")) $("#ownForm").onsubmit = async (e) => { e.preventDefault(); try { const x = await api("POST", "/church/owner", { name: $("#ownName").value, email: $("#ownEmail").value }); toast(x.sent ? "Invite sent" : "Email isn't set up: copy the link from the Teams card"); renderTeams(); } catch (err) { teamNote = err.message; renderTeams(); } };
}
// ---------------------------------------------------------------- forgot password: an emailed link (an hour, once)
function forgotPassword(email, back) {
  modal(`<h3>Forgot password?</h3><p class="muted" style="margin:0">Type your account's email. We'll send a link to set a new password.</p>
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
      setToken(r.token); await refreshMe(); closeModal(); toast("New password saved · you're signed in");
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
$("#signOut").onclick = () => { setToken(null); me = null; renderAll(); toast("Signed out"); };

async function refreshMe() {
  if (!token) { me = null; } else { try { me = await api("GET", "/me"); } catch { me = null; } }
  renderAll();
}
function renderAll() { renderSub(); renderPayout(); renderAccount(); loadTracks(); renderRack(); }

// ---------------------------------------------------------------- returning from Stripe
async function handleHash() {
  const h = location.hash.slice(1);
  if (h.startsWith("invite-")) return showInvite(h.slice(7));
  if (h.startsWith("reset-")) return showReset(h.slice(6));
  if (h.startsWith("confirm-")) { try { const r = await api("POST", "/account/confirm", { token: h.slice(8) }); history.replaceState(null, "", "#account"); await refreshMe(); modal(`<h3>Email confirmed</h3><p style="margin:0">${esc(r.email)} is confirmed. Thanks!</p><button class="btn" data-close>OK</button>`); } catch (e) { modal(`<h3>Confirm your email</h3><p class="err" style="margin:0">${esc(e.message)}</p><button class="btn" data-close>OK</button>`); } return; }
  if (h === "support") { history.replaceState(null, "", location.pathname); return supportForm(); }
  if (h.startsWith("order-done-")) {
    const session = h.slice(11); for (const k in cart) delete cart[k]; updateCartBtn();
    modal(`<h3>Thank you!</h3><p class="muted" style="margin:0">Your order is confirmed. Getting your license keys…</p>`);
    for (let i = 0; i < 15; i++) {
      const o = await api("GET", "/orders/" + encodeURIComponent(session)).catch(() => ({ pending: true }));
      if (!o.pending) {
        modal(`<h3>Thank you!</h3><p class="muted" style="margin:0">Your keys are also on your church's page (Account). Stripe has emailed your receipt. Enter a key when an app first opens: P keys in Central Pedal and Central Pedal Control, A keys in Central Control, U keys in Central Usage.</p>
          <div class="keys">${o.licenses.map((l) => `<div>${esc(l.product)}<br><b>${esc(l.key)}</b></div>`).join("")}</div>
          <p class="muted" style="margin:0;font-size:.9rem">Get the apps at <a href="${APPS_URL}" target="_blank" rel="noopener">${APPS_URL}</a>. A built pedal ships to the address you gave.</p><button class="btn" data-close>Done</button>`);
        return;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    modal(`<h3>Thank you!</h3><p class="muted" style="margin:0">Your payment went through. Your license keys are on the way; refresh this page in a minute to see them.</p><button class="btn" data-close>OK</button>`);
  } else if (h === "subscribed") { toast("Welcome to Central Tracks Unlimited"); setTimeout(refreshMe, 2500); }
  else if (h.startsWith("bought-")) { toast("Bought · it's in your storage"); setTimeout(loadTracks, 2500); }
  else if (h === "renewed") { toast("Renewed · ten more releases of updates"); setTimeout(refreshMe, 2500); }
  else if (h === "services-on") { toast("Central Services is on"); setTimeout(refreshMe, 2500); }
}

// ---------------------------------------------------------------- hero waveform
(function () {
  const c = $("#wave"), x = c.getContext("2d"); let t = 0;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  function draw() {
    const w = (c.width = c.clientWidth * devicePixelRatio), h = (c.height = c.clientHeight * devicePixelRatio);
    const cs = getComputedStyle(document.documentElement), cols = [cs.getPropertyValue("--accent"), cs.getPropertyValue("--signal")];
    x.clearRect(0, 0, w, h);
    for (let L = 0; L < 3; L++) {
      x.beginPath(); x.lineWidth = (3 - L) * devicePixelRatio * 1.2; x.strokeStyle = cols[L % 2]; x.globalAlpha = 1 - L * 0.3;
      for (let i = 0; i <= w; i += 4) { const u = i / w, y = h / 2 + Math.sin(u * 6 + t * (1 + L * 0.3) + L) * h * 0.18 * Math.sin(u * Math.PI) + Math.sin(u * 17 - t * 1.7) * h * 0.04; i ? x.lineTo(i, y) : x.moveTo(i, y); }
      x.stroke();
    }
    x.globalAlpha = 1; t += 0.012; if (!reduce) requestAnimationFrame(draw);
  }
  draw(); addEventListener("resize", () => reduce && draw());
})();

renderTiers(); setPrice();
api("GET", "/config").then((c) => { cfg = c; renderRack(); }).catch(() => {});
refreshMe().then(handleHash);
addEventListener("hashchange", handleHash);
