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
// ---- Stripe embedded payment form (Checkout Studio: ui_mode "form")
const APPEARANCE = { theme: "stripe", labels: "auto", inputs: "spaced", variables: { borderRadius: "4px", colorBackground: "#ffffff", colorDanger: "#df1b41", colorPrimary: "#0570de", colorSuccess: "#00c853", colorText: "#30313d", fontFamily: "default", fontSizeBase: "16px", spacingUnit: "4px" } };
let stripeJs = null;
async function openCheckout(title, getSecret) {
  if (!cfg.payments || !cfg.publishableKey || !window.Stripe) return paymentsSoon();
  stripeJs = stripeJs || Stripe(cfg.publishableKey);
  modal(`<h3>${esc(title)}</h3><div id="checkout-form"><p class="muted">Loading the secure payment form…</p></div><div class="err" id="payErr"></div><button class="btn ghost small" data-close style="justify-self:start">Cancel</button>`);
  document.querySelector(".modal").classList.add("pay");
  try {
    const clientSecret = getSecret().then((r) => { if (!r.clientSecret) throw new Error("Couldn't start checkout."); return r.clientSecret; });
    clientSecret.catch((e) => { const el = $("#payErr"); if (el) el.textContent = e.message; });
    const checkout = stripeJs.initCheckoutFormSdk({ clientSecret, appearance: APPEARANCE });
    $("#checkout-form").innerHTML = "";
    const form = checkout.createForm({ layout: "expanded" });
    form.mount("#checkout-form");
    const res = await checkout.loadActions();
    if (res.type === "success") form.on("confirm", async (event) => {
      try { const r = await res.actions.confirm({ formConfirmEvent: event }); if (r && r.type === "error") $("#payErr").textContent = r.error.message; }
      catch (err) { $("#payErr").textContent = err.message || "Payment didn't go through. Try again."; }
    });
    else $("#payErr").textContent = (res.error && res.error.message) || "Couldn't load the payment form.";
  } catch (e) { const el = $("#payErr"); if (el) el.textContent = e.message; }
}
function needSignIn(why) { location.hash = "account"; renderAccount(why || "Sign in or make an account to continue."); }

// ---------------------------------------------------------------- store (whatever is active in the Stripe Dashboard)
let products = [], subPrice = 77, sale = { active: false }, previewSale = false;
const STRIPES = ["var(--blue)", "var(--accent)", "var(--violet)", "var(--chord)", "var(--pink)", "var(--cyan)"];
const KIND_LABEL = { "main-admin": "Main Admin", admin: "admin", user: "user", "pedal-control": "Pedal Control", license: "license", usage: "Central Usage", control: "Central Control", pedal: "Central Pedal", schedule: "Central Schedule" };
async function loadStore() {
  try { const r = await api("GET", "/store"); products = r.products; if (r.subscription) { $("#subPrice").textContent = r.subscription.price; subPrice = r.subscription.price; } renderSub(); }
  catch { products = []; }
  renderRack();
}
const onSale = (p) => sale.active && (p.codes || sale.includePedal);
const salePrice = (p) => Math.round(p.price * (100 - sale.percent)) / 100;
function priceHtml(p) { return onSale(p) ? `<span class="was">${money(p.price)}</span>${money(salePrice(p))}` : money(p.price); }
function incl(p) {
  const chips = Object.entries(p.keys || {}).map(([k, n]) => `<span class="chip">${n} ${esc(KIND_LABEL[k] || k)}${n > 1 && !/Admin|Control/.test(KIND_LABEL[k] || "") ? "s" : ""}</span>`);
  if (p.services) chips.push(`<span class="chip">${p.services} Services account${p.services > 1 ? "s" : ""}</span>`);
  return chips.length ? `<div class="incl">${chips.join("")}</div>` : "";
}
function card(p, i) {
  const addon = products.find((a) => a.addonFor === p.priceId);
  const addonHtml = addon ? `<label class="addon"><input type="checkbox" data-addon="${esc(addon.priceId)}" data-base="${esc(p.priceId)}"${cart[addon.priceId] ? " checked" : ""}> <span>${esc(addon.name.replace(/^.*?:\s*/, ""))} for ${money(onSale(addon) ? salePrice(addon) : addon.price)} each</span></label>` : "";
  return `<div class="prod${p.id === "pack-plus" ? " best" : ""}" style="--c:${STRIPES[i % STRIPES.length]}">
    ${p.image ? `<img src="${esc(p.image)}" alt="" style="border-radius:10px;aspect-ratio:4/3;object-fit:cover;width:100%">` : ""}
    <div class="tag">${p.ships ? "Ships to you" : /^pack-/.test(p.id) ? "Pack" + (p.id === "pack-plus" ? " · most picked" : "") : "Add-on"}</div><h3>${esc(p.name)}</h3>
    <div class="price">${priceHtml(p)}</div>
    ${incl(p)}
    ${p.description ? `<p class="muted" style="margin:0;font-size:.93rem;flex:1">${esc(p.description)}</p>` : '<div style="flex:1"></div>'}
    ${addonHtml}
    <button class="btn go" data-add="${esc(p.priceId)}">Add to cart</button></div>`;
}
function renderRack() {
  if (!products.length) { $("#rack").innerHTML = '<p class="muted">The store opens soon.</p>'; $("#rackMore").innerHTML = ""; $("#rackHw").innerHTML = ""; return; }
  const packs = products.filter((p) => /^pack-/.test(p.id)), hw = products.filter((p) => p.ships), more = products.filter((p) => !p.ships && !p.addonFor && !/^pack-/.test(p.id));
  $("#rack").innerHTML = packs.map(card).join("") || '<p class="muted">No packs right now.</p>';
  $("#rackMore").innerHTML = more.map((p, i) => card(p, i + 2)).join("");
  $("#rackHw").innerHTML = hw.map((p, i) => card(p, i + 3)).join("");
}
const cartCount = () => Object.values(cart).reduce((a, b) => a + b, 0);
function updateCartBtn() { $("#cartBtn").textContent = "Cart · " + cartCount(); }
function fixAddons() {  // an add-on can't outnumber its pack
  products.filter((a) => a.addonFor && cart[a.priceId]).forEach((a) => { cart[a.priceId] = Math.min(cart[a.priceId], cart[a.addonFor] || 0); if (!cart[a.priceId]) delete cart[a.priceId]; });
}
$("#store").addEventListener("click", (e) => {
  const a = e.target.closest("[data-add]"); if (!a) return;
  cart[a.dataset.add] = (cart[a.dataset.add] || 0) + 1;
  const box = a.closest(".prod").querySelector("[data-addon]");
  if (box && box.checked) cart[box.dataset.addon] = cart[a.dataset.add];
  updateCartBtn(); toast("Added to cart");
});
$("#store").addEventListener("change", (e) => {
  const b = e.target.closest("[data-addon]"); if (!b) return;
  if (b.checked) { if (!cart[b.dataset.base]) cart[b.dataset.base] = 1; cart[b.dataset.addon] = cart[b.dataset.base]; toast("Added to cart with the pack"); }
  else delete cart[b.dataset.addon];
  updateCartBtn();
});
let cartCode = "";
$("#cartBtn").onclick = () => {
  fixAddons();
  const ids = Object.keys(cart).filter((k) => cart[k] > 0);
  if (!ids.length) return modal(`<h3>Your cart is empty</h3><p class="muted" style="margin:0">Pick a pack, keys or a pedal from the store.</p><button class="btn" data-close>Close</button>`);
  let total = 0;
  const lines = ids.map((id) => { const p = products.find((x) => x.priceId === id); if (!p) { delete cart[id]; return ""; } const each = onSale(p) ? salePrice(p) : p.price, sub = each * cart[id]; total += sub;
    return `<div><span>${esc(p.name)}<br><span class="qty"><button class="btn ghost small" data-q="${esc(id)}" data-d="-1" aria-label="One less">−</button> ${cart[id]} <button class="btn ghost small" data-q="${esc(id)}" data-d="1" aria-label="One more">+</button></span></span><span>${money(sub)}</span></div>`; }).join("");
  modal(`<h3>Cart</h3><div class="lines">${lines}<div class="total"><span>Total${sale.active ? " · " + esc(sale.name || "sale") + " prices" : ""}</span><span>${money(total)}</span></div></div>
    <label>Discount code (optional)<input id="codeIn" value="${esc(cartCode)}" placeholder="BETATEST" autocomplete="off" style="text-transform:uppercase"></label>
    <p class="muted" style="margin:0;font-size:.88rem">Prices include tax. Codes work on software, not the pedal itself; a code replaces the sale price. You'll pay securely with Stripe, and your keys appear right after checkout.</p>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn go" id="checkout">Check out</button><button class="btn ghost" id="clear">Empty cart</button></div><div class="err" id="coErr"></div>`);
  document.querySelectorAll(".modal [data-q]").forEach((b) => b.onclick = () => { const id = b.dataset.q; cart[id] = Math.max(0, (cart[id] || 0) + Number(b.dataset.d)); if (!cart[id]) delete cart[id]; cartCode = $("#codeIn").value; fixAddons(); updateCartBtn(); renderRack(); $("#cartBtn").click(); });
  $("#clear").onclick = () => { for (const k in cart) delete cart[k]; updateCartBtn(); renderRack(); closeModal(); };
  $("#checkout").onclick = async () => {
    if (!me) { closeModal(); return needSignIn("Sign in or make an account first. Your keys and Central Services accounts belong to your church's account."); }
    cartCode = $("#codeIn").value.trim().toUpperCase();
    openCheckout("Check out", () => api("POST", "/checkout/store", { items: cart, code: cartCode }));
  };
};

// ---- the sale banner (live for everyone; an admin can preview a draft first)
async function loadSale() {
  try { sale = (await api("GET", "/site" + (previewSale ? "?preview=1" : ""))).sale || { active: false }; } catch { sale = { active: false }; }
  const bar = $("#saleBar");
  bar.hidden = !sale.active;
  if (sale.active) {
    document.documentElement.style.setProperty("--sale", sale.accent || "#e9505e");
    $("#saleText").textContent = (sale.banner || (sale.name ? sale.name + ": " : "") + sale.percent + "% off software") + (sale.endsAt ? " · ends " + new Date(sale.endsAt).toLocaleDateString() : "");
  }
  $("#salePv").hidden = !previewSale;
  renderRack();
}

// ---------------------------------------------------------------- subscription + library
function renderSub() {
  const on = !!(me && me.subscribed);
  $("#trialNote").hidden = !!(me && !me.trialAvailable);
  $("#subStatus").textContent = on ? "Subscribed · unlimited adds" : "Not subscribed";
  $("#subStatus").classList.toggle("on", on);
  $("#subBtn").textContent = on ? "Manage subscription" : "Subscribe for $" + subPrice + "/mo";
}
$("#subBtn").onclick = async () => {
  if (!me) return needSignIn("Sign in to subscribe to Central Tracks Unlimited.");
  if (!cfg.payments) return paymentsSoon();
  if (!me.subscribed) {
    modal(`<h3>Central Tracks Unlimited · $${subPrice}/month</h3><p class="muted" style="margin:0">Tax included. Cancel anytime from your account.</p>
      <label>Code (optional)<input id="subCode" placeholder="${me.trialAvailable ? "7FREE for a 7-day free trial" : "Discount code"}" autocomplete="off" style="text-transform:uppercase"></label>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn go" id="subGo">Continue to payment</button><button class="btn ghost" data-close>Cancel</button></div>`);
    $("#subGo").onclick = () => { const code = $("#subCode").value.trim().toUpperCase(); openCheckout("Central Tracks Unlimited" + (code === "7FREE" ? " · 7 days free" : ""), () => api("POST", "/checkout/subscription", { code })); };
    return;
  }
  try { go((await api("POST", "/billing")).url); } catch (e) { toast(e.message); }
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
      : sub ? `<button class="btn go small" data-store="${esc(t.id)}">Add to storage</button>`
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
    <p class="muted" style="margin:0">Or subscribe for $${subPrice}/month to add every track.</p>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn go" id="buyGo">Buy ${money(t.price)}</button><button class="btn ghost" data-close>Cancel</button></div><div class="err" id="buyErr"></div>`);
  $("#buyGo").onclick = () => openCheckout(t.title + " · " + money(t.price), () => api("POST", "/tracks/" + t.id + "/purchase?web=1"));
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
function renderId() {
  const need = !!(me && me.idRequired && cfg.payments && me.idStatus !== "verified");
  $("#idBox").hidden = !need;
  if (need) $("#idBtn").textContent = me.idStatus === "processing" ? "Checking your ID… (refresh in a minute)" : me.idStatus === "requires_input" ? "Try ID verification again" : "Verify my ID";
}
$("#idBtn").onclick = async () => { try { const r = await api("POST", "/identity"); if (r.url) go(r.url); else refreshMe(); } catch (e) { toast(e.message); } };
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
    <label>Password<input id="inPass" type="password" autocomplete="current-password" required></label><button class="btn go">Sign in</button><div class="err" id="inErr"></div></form></div>
    <div class="card"><h3>Make an account</h3><p class="muted" style="margin:0">Free. Use it to buy, subscribe, publish, and sign in to Central Tracks in the apps.</p>
    <form id="upForm" style="background:none;border:0;padding:0"><label>Name<input id="upName" autocomplete="name"></label><label>Email<input id="upEmail" type="email" autocomplete="email" required></label>
    <label>Password (8+ characters)<input id="upPass" type="password" autocomplete="new-password" minlength="8" required></label><button class="btn go">Make account</button><div class="err" id="upErr"></div></form></div></div>`;
}
async function renderAccount(note) {
  const body = $("#acctBody");
  $("#signOut").hidden = !me; $("#acctLink").textContent = me ? "Account" : "Sign in";
  if (!me) {
    $("#acctTitle").textContent = "Sign in";
    body.innerHTML = signInForm(note);
    $("#inForm").onsubmit = async (e) => { e.preventDefault(); try { setToken((await api("POST", "/login", { email: $("#inEmail").value, password: $("#inPass").value })).token); await refreshMe(); toast("Signed in"); } catch (err) { $("#inErr").textContent = err.message; } };
    $("#upForm").onsubmit = async (e) => { e.preventDefault(); try { setToken((await api("POST", "/signup", { name: $("#upName").value, email: $("#upEmail").value, password: $("#upPass").value })).token); await refreshMe(); toast("Account made · you're signed in"); } catch (err) { $("#upErr").textContent = err.message; } };
    return;
  }
  $("#acctTitle").textContent = me.name ? "Hi, " + me.name : "Your account";
  body.innerHTML = `<div class="acct"><div class="card"><h3>Central Tracks</h3><div class="status ${me.subscribed ? "on" : ""}" style="font:500 .85rem var(--mono)">${me.subscribed ? "Unlimited · $" + subPrice + "/month" : "Not subscribed"}</div>
      <p class="muted" style="margin:0;font-size:.92rem">In Central Pedal or Central Pedal Control: <b>+ Add songs → Central Tracks</b>. Set the server to <code style="user-select:all">${esc(location.origin)}</code> and sign in with ${esc(me.email)}.</p>
      <a class="btn ghost small" href="${APPS_URL}" target="_blank" rel="noopener" style="justify-self:start">Download the apps</a></div>
    <div class="card"><h3>Keys and accounts</h3><div id="myKeys" class="muted">Loading…</div></div>
    <div class="card"><h3>Your storage</h3><div id="myLib" class="muted">Loading…</div></div>
    <div class="card"><h3>Publishing</h3><div id="myPub" class="muted">Loading…</div></div></div>`;
  try {
    const k = await api("GET", "/my/licenses");
    $("#myKeys").innerHTML = `<div><b>${k.servicesAccounts}</b> Central Services accounts for your church</div>` + (k.licenses.length
      ? '<div class="keys">' + k.licenses.map((l) => `<div>${esc(l.kind)}${l.major ? " · updates for " + l.major + ".x" : ""}<br><b>${esc(l.key)}</b></div>`).join("") + "</div>"
      : '<div>No keys yet. <a href="#store">See the packs</a>.</div>');
  } catch (err) { $("#myKeys").textContent = err.message; }
  if (me.admin) renderAdmin();
  try {
    const lib = (await api("GET", "/library")).tracks;
    $("#myLib").innerHTML = lib.length ? lib.map((t) => `<div><b>${esc(t.title)}</b> <span class="muted">· ${esc(t.kind)}</span></div>`).join("") : "Nothing yet. Add or buy tracks from Central Tracks.";
    const p = await api("GET", "/publisher");
    $("#myPub").innerHTML = `<div><b>${money(p.unpaid)}</b> waiting to be paid · ${money(p.paid)} paid so far</div><div class="muted" style="font-size:.9rem">${p.addsThisMonth} subscriber adds this month · your pool share is worked out on the 1st</div>` +
      (p.tracks.length ? p.tracks.map((t) => `<div>${starHtml(t.stars)} <b>${esc(t.title)}</b> <span class="muted">· ${money(t.price)} · ${t.sales} sold · ${t.adds} subscriber adds${t.status !== "live" ? " · " + esc(t.status) : ""}</span></div>`).join("") : '<div>No tracks published yet. <a href="#publish">Publish one</a>.</div>');
  } catch (err) { $("#myPub").textContent = err.message; }
  if (me.payoutsStarted && cfg.publishableKey) mountConnect();
}
// Stripe Connect embedded components: the notification banner keeps payout details current as requirements change
function loadScript(src) { return new Promise((ok, bad) => { if (document.querySelector(`script[src="${src}"]`)) return ok(); const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = bad; document.head.appendChild(s); }); }
let connectUi = null;
async function mountConnect() {
  const box = document.createElement("div"); box.className = "card connect-box"; box.innerHTML = '<h3>Payout settings</h3><div id="cBanner"></div><div id="cPayouts"></div><div id="cManage"></div>';
  $("#acctBody .acct").appendChild(box);
  try {
    await loadScript("https://connect-js.stripe.com/v1.0/connect.js");
    for (let i = 0; i < 50 && !(window.StripeConnect && window.StripeConnect.init); i++) await new Promise((r) => setTimeout(r, 100));
    connectUi = connectUi || window.StripeConnect.init({ publishableKey: cfg.publishableKey, fetchClientSecret: async () => (await api("POST", "/connect/session")).clientSecret });
    $("#cBanner").appendChild(connectUi.create("notification-banner"));
    $("#cPayouts").appendChild(connectUi.create("payouts"));
    $("#cManage").appendChild(connectUi.create("account-management"));
  } catch { box.querySelector("#cBanner").innerHTML = '<p class="muted">Payout settings couldn\'t load. Refresh the page to try again.</p>'; }
}
$("#signOut").onclick = () => { setToken(null); me = null; renderAll(); toast("Signed out"); };

async function refreshMe() {
  if (!token) { me = null; } else { try { me = await api("GET", "/me"); } catch { me = null; } }
  renderAll();
}
function renderAll() { renderSub(); renderPayout(); renderId(); renderAccount(); loadTracks(); }

// ---------------------------------------------------------------- returning from Stripe
async function handleHash() {
  const h = location.hash.slice(1);
  if (h.startsWith("order-done-")) {
    const session = h.slice(11); for (const k in cart) delete cart[k]; updateCartBtn();
    modal(`<h3>Thank you!</h3><p class="muted" style="margin:0">Your order is confirmed. Getting your license keys…</p>`);
    for (let i = 0; i < 15; i++) {
      const o = await api("GET", "/orders/" + encodeURIComponent(session)).catch(() => ({ pending: true }));
      if (!o.pending) {
        modal(`<h3>Thank you!</h3><p class="muted" style="margin:0">Keep these license keys. Stripe has also emailed your receipt.</p>
          <div class="keys">${o.licenses.length ? o.licenses.map((l) => `<div>${esc(l.kind)}${l.major ? " · updates for " + l.major + ".x" : ""} <span class="muted">(${esc(l.product)})</span><br><b>${esc(l.key)}</b></div>`).join("") : "<div>No license keys with this order.</div>"}</div>
          <p class="muted" style="margin:0;font-size:.9rem">Get the apps at <a href="${APPS_URL}" target="_blank" rel="noopener">${APPS_URL}</a>. A built pedal ships to the address you gave.</p><button class="btn" data-close>Done</button>`);
        return;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    modal(`<h3>Thank you!</h3><p class="muted" style="margin:0">Your payment went through. Your license keys are on the way; refresh this page in a minute to see them.</p><button class="btn" data-close>OK</button>`);
  } else if (h.startsWith("buy-")) {
    if (!me) return needSignIn("Sign in to buy this track.");
    const t = tracks.find((x) => x.id === h.slice(4)) || (await api("GET", "/tracks").then((r) => r.tracks.find((x) => x.id === h.slice(4))).catch(() => null));
    if (t && !t.owned) buyModal(t); else if (t) toast("You already have " + t.title);
  } else if (h === "payouts-refresh") { try { go((await api("POST", "/connect")).url); } catch (e) { toast(e.message); } }
  else if (h === "payouts-done") { toast("Payout details saved"); setTimeout(refreshMe, 1500); }
  else if (h === "id-done") { toast("Thanks · Stripe is checking your ID"); setTimeout(refreshMe, 4000); }
  else if (h === "subscribed") { toast("Welcome to Central Tracks Unlimited"); setTimeout(refreshMe, 2500); }
  else if (h.startsWith("bought-")) { toast("Bought · it's in your storage"); setTimeout(loadTracks, 2500); }
}

// ---------------------------------------------------------------- admin: discount codes + the sale (preview, then publish)
async function renderAdmin() {
  const box = document.createElement("div"); box.className = "card admin"; box.style.gridColumn = "1 / -1";
  box.innerHTML = `<h3>Admin · codes and sales</h3>
    <div class="acct">
      <div class="formcard"><div class="label">Discount codes</div><div class="codes" id="codeList">Loading…</div>
        <form id="codeForm" style="display:grid;gap:.6rem">
          <div class="row2"><label>Code<input id="cCode" placeholder="EASTER25" required style="text-transform:uppercase"></label><label>% off<input id="cPct" type="number" min="1" max="100" value="25" required></label></div>
          <div class="row2"><label>How long<select id="cDur"><option value="once">One payment</option><option value="repeating">Several months (subscription)</option><option value="forever">Forever (subscription)</option></select></label><label>Months<input id="cMonths" type="number" min="1" value="3"></label></div>
          <div class="row2"><label>Ends (optional)<input id="cEnd" type="date"></label><label>Max uses (optional)<input id="cMax" type="number" min="1"></label></div>
          <label class="chk"><input type="checkbox" id="cPedal"> <span>Also discount the pedal itself</span></label>
          <button class="btn go">Make code</button><div class="err" id="cErr"></div></form></div>
      <div class="formcard"><div class="label">Sale (whole website)</div><div class="muted" id="saleState" style="font-size:.9rem"></div>
        <form id="saleForm" style="display:grid;gap:.6rem">
          <div class="row2"><label>Name<input id="sName" placeholder="4th of July" required></label><label>% off<input id="sPct" type="number" min="1" max="90" value="10" required></label></div>
          <label>Banner text<input id="sBanner" placeholder="🎆 4th of July: 10% off all software"></label>
          <div class="row2"><label>Banner colour<input id="sAccent" type="color" value="#c0392b"></label><label>Ends (optional)<input id="sEnd" type="datetime-local"></label></div>
          <label class="chk"><input type="checkbox" id="sPedal"> <span>Include the pedal itself</span></label>
          <div style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn">Save and preview</button><button type="button" class="btn go" id="salePublish">Put it live</button><button type="button" class="btn ghost" id="saleEnd">End sale</button></div>
          <div class="err" id="sErr"></div></form></div>
    </div>`;
  $("#acctBody .acct").appendChild(box);
  const loadCodes = async () => {
    const r = await api("GET", "/admin/codes");
    $("#codeList").innerHTML = r.codes.map((c) => `<div><span><code>${esc(c.code)}</code> <span class="muted">${esc(c.name || "")}${c.used != null ? " · used " + c.used + (c.max ? "/" + c.max : "") : ""}${c.active ? "" : " · off"}</span></span>${c.builtIn ? "" : `<button class="btn small ghost" data-code="${esc(c.id)}" data-on="${c.active ? 0 : 1}">${c.active ? "Turn off" : "Turn on"}</button>`}</div>`).join("");
  };
  loadCodes().catch((e) => { $("#codeList").textContent = e.message; });
  box.addEventListener("click", async (e) => { const b = e.target.closest("[data-code]"); if (!b) return; await api("POST", "/admin/codes/" + b.dataset.code, { active: b.dataset.on === "1" }); loadCodes(); });
  $("#codeForm").onsubmit = async (e) => {
    e.preventDefault(); $("#cErr").textContent = "";
    try { await api("POST", "/admin/codes", { code: $("#cCode").value, percent: $("#cPct").value, duration: $("#cDur").value, months: $("#cMonths").value, expires: $("#cEnd").value || undefined, max: $("#cMax").value || undefined, includePedal: $("#cPedal").checked }); toast("Code made"); e.target.reset(); loadCodes(); }
    catch (err) { $("#cErr").textContent = err.message; }
  };
  const st = await api("GET", "/admin/site"), d = st.draft;
  $("#sName").value = d.name || ""; $("#sPct").value = d.percent || 10; $("#sBanner").value = d.banner || ""; $("#sAccent").value = d.accent || "#c0392b"; $("#sPedal").checked = !!d.includePedal;
  if (d.endsAt) $("#sEnd").value = new Date(d.endsAt).toISOString().slice(0, 16);
  $("#saleState").textContent = st.live && st.live.active ? "Live now: " + st.live.name + ", " + st.live.percent + "% off." : "No sale is live.";
  $("#saleForm").onsubmit = async (e) => {
    e.preventDefault(); $("#sErr").textContent = "";
    try {
      await api("PUT", "/admin/site/sale", { name: $("#sName").value, percent: $("#sPct").value, banner: $("#sBanner").value, accent: $("#sAccent").value, includePedal: $("#sPedal").checked, endsAt: $("#sEnd").value || "" });
      previewSale = true; await loadSale(); toast("Preview on: only you see this sale. Scroll up to check it."); scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) { $("#sErr").textContent = err.message; }
  };
  $("#salePublish").onclick = async () => { try { await api("POST", "/admin/site/sale/publish"); previewSale = false; await loadSale(); toast("The sale is live for everyone"); renderAccount(); } catch (err) { $("#sErr").textContent = err.message; } };
  $("#saleEnd").onclick = async () => { await api("POST", "/admin/site/sale/end"); previewSale = false; await loadSale(); toast("Sale ended"); renderAccount(); };
}

// ---------------------------------------------------------------- hero waveform
(function () {
  const c = $("#wave"), x = c.getContext("2d"); let t = 0;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  function draw() {
    const w = (c.width = c.clientWidth * devicePixelRatio), h = (c.height = c.clientHeight * devicePixelRatio);
    const cs = getComputedStyle(document.documentElement), cols = [cs.getPropertyValue("--accent"), cs.getPropertyValue("--blue")];
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

renderRack(); renderTiers(); setPrice();
loadStore().then(loadSale);
api("GET", "/config").then((c) => { cfg = c; }).catch(() => {});
refreshMe().then(handleHash);
addEventListener("hashchange", handleHash);
