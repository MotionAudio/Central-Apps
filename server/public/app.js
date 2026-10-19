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
function needSignIn(why) { location.hash = "account"; renderAccount(why || "Sign in or make an account to continue."); }

// ---------------------------------------------------------------- store
// prices come from the server (/config); these are the words around them
const packs = [
  { id: "pack-small", tag: "Church pack", name: "Small church", pts: ["Central Pedal, built, with its software", "Central Pedal Control", "2 admins (Central Control)", "6 users (Central Usage)", "More users $10 each, admins $50"] },
  { id: "pack-medium", tag: "Church pack", name: "Medium church", feature: true, pts: ["Central Pedal, built, with its software", "Central Pedal Control", "4 admins (Central Control)", "12 users (Central Usage)", "More users $10 each, admins $50"] },
  { id: "pack-large", tag: "Church pack", name: "Large church", pts: ["Central Pedal, built, with its software", "Central Pedal Control", "7 admins (Central Control)", "20 users (Central Usage)", "More users $10 each, admins $50"] },
];
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
    <ul>${p.pts.map((x) => `<li>${x}</li>`).join("")}</ul>
    <button class="btn" data-add="${p.id}"${p.packOnly && !hasPack() ? " disabled title=\"Buy a church pack first\"" : ""}>Add to cart</button></div>`;
}
function renderRack() {
  if (!cfg.products) return;
  $("#packs").innerHTML = packs.map(card).join("");
  $("#rack").innerHTML = products.filter((p) => !p.packOnly || hasPack()).map(card).join("");
}
const cartCount = () => Object.values(cart).reduce((a, b) => a + b, 0);
function updateCartBtn() { $("#cartBtn").textContent = "Cart · " + cartCount(); }
function onAdd(e) { const a = e.target.closest("[data-add]"); if (!a || a.disabled) return; cart[a.dataset.add] = (cart[a.dataset.add] || 0) + 1; updateCartBtn(); renderRack(); toast("Added to cart"); }
$("#rack").addEventListener("click", onAdd); $("#packs").addEventListener("click", onAdd);
$("#cartBtn").onclick = () => {
  const ids = Object.keys(cart).filter((k) => cart[k] > 0);
  if (!ids.length) return modal(`<h3>Your cart is empty</h3><p class="muted" style="margin:0">Add a pack, the pedal or keys from the store.</p><button class="btn" data-close>Close</button>`);
  let total = 0;
  const lines = ids.map((id) => { const p = ALL.find((x) => x.id === id), s = priceOf(id) * cart[id]; total += s; return `<div><span>${p.name}${p.packOnly ? " (pack price)" : ""} × ${cart[id]}</span><span>${money(s)}</span></div>`; }).join("");
  const needChurch = me && !me.church;
  modal(`<h3>Cart</h3><div class="lines">${lines}<div class="total"><span>Total</span><span>${money(total)}</span></div></div>
    ${!me ? `<p class="muted" style="margin:0">Sign in or make an account first: your keys go to your church's account.</p>` : needChurch ? `<label>Your church or production's name<input id="coChurch" placeholder="Grace Church"></label><p class="muted" style="margin:0;font-size:.9rem">This makes your church's account, with you as its main admin. Your admins and users join it with its codes.</p>` : `<p class="muted" style="margin:0;font-size:.9rem">The keys go to <b>${esc(me.church.name)}</b>.</p>`}
    <p class="muted" style="margin:0;font-size:.9rem">You'll pay securely with Stripe. Your keys appear right after checkout and on your church's page.</p>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn" id="checkout">${me ? "Check out" : "Sign in"}</button><button class="btn ghost" id="clear">Empty cart</button></div><div class="err" id="coErr"></div>`);
  $("#clear").onclick = () => { for (const k in cart) delete cart[k]; updateCartBtn(); renderRack(); closeModal(); };
  $("#checkout").onclick = async () => {
    if (!me) { closeModal(); return needSignIn("Sign in or make an account, then open the cart again."); }
    if (needChurch && !$("#coChurch").value.trim()) { $("#coErr").textContent = "Give your church or production a name."; return; }
    if (!cfg.payments) return paymentsSoon();
    $("#checkout").disabled = true;
    try { go((await api("POST", "/checkout/store", { items: cart, church: needChurch ? $("#coChurch").value.trim() : undefined })).url); } catch (e) { $("#coErr").textContent = e.message; $("#checkout").disabled = false; }
  };
};

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
    <label>Password<input id="inPass" type="password" autocomplete="current-password" required></label><button class="btn">Sign in</button><div class="err" id="inErr"></div></form></div>
    <div class="card"><h3>Make an account</h3><p class="muted" style="margin:0">Free. Use it to buy, subscribe, publish, and sign in to Central Tracks in the apps.</p>
    <form id="upForm" style="background:none;border:0;padding:0"><label>Name<input id="upName" autocomplete="name"></label><label>Email<input id="upEmail" type="email" autocomplete="email" required></label>
    <label>Password (8+ characters)<input id="upPass" type="password" autocomplete="new-password" minlength="8" required></label>
    <div class="choice"><b style="font-size:.95rem">Your church</b>
      <label><input type="radio" name="upCh" value="join" checked> Join my church as <select id="upRole" style="width:auto"><option value="user">a user</option><option value="admin">an admin</option></select></label>
      <label><input type="radio" name="upCh" value="make"> I'm the main admin: make our church's account</label>
      <label><input type="radio" name="upCh" value="none"> Not now (Central Tracks only)</label></div>
    <label id="upCodeL">Church code (from your main admin)<input id="upCode" placeholder="8 letters and digits"></label>
    <label id="upChurchL" hidden>Church or production name<input id="upChurch" placeholder="Grace Church"></label>
    <button class="btn">Make account</button><div class="err" id="upErr"></div></form></div></div>`;
}
async function renderAccount(note) {
  const body = $("#acctBody");
  $("#signOut").hidden = !me; $("#acctLink").textContent = me ? "Account" : "Sign in";
  if (!me) {
    $("#acctTitle").textContent = "Sign in";
    body.innerHTML = signInForm(note);
    $("#inForm").onsubmit = async (e) => { e.preventDefault(); try { setToken((await api("POST", "/login", { email: $("#inEmail").value, password: $("#inPass").value })).token); await refreshMe(); toast("Signed in"); } catch (err) { $("#inErr").textContent = err.message; } };
    const chWay = () => (document.querySelector('[name="upCh"]:checked') || {}).value;
    document.querySelectorAll('[name="upCh"]').forEach((r) => (r.onchange = () => { $("#upCodeL").hidden = chWay() !== "join"; $("#upChurchL").hidden = chWay() !== "make"; }));
    $("#upForm").onsubmit = async (e) => {
      e.preventDefault(); const w = chWay();
      if (w === "join" && !$("#upCode").value.trim()) { $("#upErr").textContent = "Enter your church's code, or pick another choice."; return; }
      if (w === "make" && !$("#upChurch").value.trim()) { $("#upErr").textContent = "Give your church or production a name."; return; }
      try {
        const r = await api("POST", "/signup", { name: $("#upName").value, email: $("#upEmail").value, password: $("#upPass").value,
          churchCode: w === "join" ? $("#upCode").value.trim() : undefined, churchRole: $("#upRole").value, churchName: w === "make" ? $("#upChurch").value.trim() : undefined });
        setToken(r.token); await refreshMe(); toast(r.churchError ? r.churchError : "Account made · you're signed in" + (r.church ? " · " + r.church : ""));
      } catch (err) { $("#upErr").textContent = err.message; }
    };
    return;
  }
  $("#acctTitle").textContent = me.name ? "Hi, " + me.name : "Your account";
  body.innerHTML = `<div class="acct"><div class="card"><h3>Central Tracks</h3><div class="status ${me.subscribed ? "on" : ""}" style="font:500 .85rem var(--mono)">${me.subscribed ? "Unlimited · $77/month" : "Not subscribed"}</div>
      <p class="muted" style="margin:0;font-size:.92rem">In Central Pedal or Central Pedal Control: <b>+ Add songs → Central Tracks</b>. Set the server to <code style="user-select:all">${esc(location.origin)}</code> and sign in with ${esc(me.email)}.</p>
      <a class="btn ghost small" href="${APPS_URL}" target="_blank" rel="noopener" style="justify-self:start">Download the apps</a></div>
    <div class="card wide" id="churchCard"><h3>Your church</h3><div class="muted">Loading…</div></div>
    ${me.admin ? `<div class="card wide" id="staffCard"><h3>Keys · Motion Audio staff</h3><div class="muted">Loading…</div></div>` : ""}
    <div class="card"><h3>Your storage</h3><div id="myLib" class="muted">Loading…</div></div>
    <div class="card"><h3>Publishing</h3><div id="myPub" class="muted">Loading…</div></div></div>`;
  renderChurch(); if (me.admin) renderStaff();
  try {
    const lib = (await api("GET", "/library")).tracks;
    $("#myLib").innerHTML = lib.length ? lib.map((t) => `<div><b>${esc(t.title)}</b> <span class="muted">· ${esc(t.kind)}</span></div>`).join("") : "Nothing yet. Add or buy tracks from Central Tracks.";
    const p = await api("GET", "/publisher");
    $("#myPub").innerHTML = `<div><b>${money(p.unpaid)}</b> waiting to be paid · ${money(p.paid)} paid so far</div><div class="muted" style="font-size:.9rem">${p.addsThisMonth} subscriber adds this month · your pool share is worked out on the 1st</div>` +
      (p.tracks.length ? p.tracks.map((t) => `<div>${starHtml(t.stars)} <b>${esc(t.title)}</b> <span class="muted">· ${money(t.price)} · ${t.sales} sold · ${t.adds} subscriber adds${t.status !== "live" ? " · " + esc(t.status) : ""}</span></div>`).join("") : '<div>No tracks published yet. <a href="#publish">Publish one</a>.</div>');
  } catch (err) { $("#myPub").textContent = err.message; }
}
// ---------------------------------------------------------------- the church: its keys, codes and people
async function renderChurch() {
  const el = $("#churchCard"); if (!el) return;
  let r; try { r = await api("GET", "/church"); } catch (e) { el.innerHTML = `<h3>Your church</h3><div class="err">${esc(e.message)}</div>`; return; }
  if (!r.church) {
    el.innerHTML = `<h3>Your church</h3><p class="muted" style="margin:0">Your account isn't in a church yet. The main admin makes it; admins and users join with its code.</p>
      <div class="acct"><form id="chMake" style="background:none;border:0;padding:0"><label>I'm the main admin: church or production name<input id="chName" placeholder="Grace Church"></label><button class="btn small">Make our church</button></form>
      <form id="chJoin" style="background:none;border:0;padding:0"><label>Join with a code<input id="chCode" placeholder="from your main admin"></label><label>As <select id="chRole"><option value="user">a user</option><option value="admin">an admin</option></select></label><button class="btn small">Join</button></form></div><div class="err" id="chErr"></div>`;
    $("#chMake").onsubmit = async (e) => { e.preventDefault(); try { await api("POST", "/church", { name: $("#chName").value }); await refreshMe(); toast("Your church's account is made"); } catch (err) { $("#chErr").textContent = err.message; } };
    $("#chJoin").onsubmit = async (e) => { e.preventDefault(); try { const j = await api("POST", "/church/join", { code: $("#chCode").value, role: $("#chRole").value }); await refreshMe(); toast("You joined " + j.church); } catch (err) { $("#chErr").textContent = err.message; } };
    return;
  }
  const c = r.church, staff = c.role === "owner" || c.role === "admin", roleName = { owner: "main admin", admin: "admin", user: "user" }[c.role];
  const counts = Object.keys(r.counts).map((k) => `<div><span class="muted" style="font-size:.85rem">${k} · ${esc(r.counts[k].name)}</span><b>${r.counts[k].free}</b><span class="muted" style="font-size:.85rem">left · ${r.counts[k].inUse} in use · ${r.counts[k].total} in all</span></div>`).join("");
  const rows = r.keys.map((k) => `<tr><td>${k.kind}</td><td><code>${esc(k.key)}</code></td><td>${k.revoked ? '<span class="err">revoked</span>' : k.inUse ? esc(k.device) + (k.app ? ` <span class="muted">· ${esc(k.app)}</span>` : "") : '<span class="muted">free</span>'}</td><td>${(staff || k.mine) && k.inUse ? `<button class="btn small ghost" data-rel="${esc(k.key)}">Release</button>` : ""}${k.mine ? ' <span class="muted" style="font-size:.85rem">yours</span>' : ""}</td></tr>`).join("");
  el.innerHTML = `<h3>${esc(c.name)} <span class="muted" style="font-weight:400;font-size:.9rem">· you're ${roleName}</span></h3>
    <div class="kcount">${counts}</div>
    ${c.adminCode || c.userCode ? `<p style="margin:.2rem 0">${c.adminCode ? `Admin code <code style="user-select:all">${esc(c.adminCode)}</code> · ` : ""}User code <code style="user-select:all">${esc(c.userCode)}</code> <span class="muted" style="font-size:.9rem">· people join with these when they make an account. Admins can all share one account; each user has their own.</span></p>` : ""}
    ${r.keys.length ? `<table class="ktable"><tr><th></th><th>Key</th><th>On</th><th></th></tr>${rows}</table>` : `<p class="muted" style="margin:0">No keys yet. <a href="#store">Get a church pack or keys</a>.</p>`}
    <p class="muted" style="margin:0;font-size:.9rem">Release frees a key from a lost or broken device${staff ? "" : " (yours)"}. On a working device, use Settings → License → Release key in the app.</p>
    ${r.members.length ? `<details><summary>People (${r.members.length})</summary>${r.members.map((m) => `<div>${esc(m.name || m.email)} <span class="muted">· ${esc(m.email)} · ${{ owner: "main admin", admin: "admin", user: "user" }[m.role]}</span>${c.role === "owner" && m.role !== "owner" ? ` <button class="btn small ghost" data-rm="${esc(m.email)}">Take out</button>` : ""}</div>`).join("")}
      ${c.role === "owner" ? `<p style="margin:.4rem 0 0"><button class="btn small ghost" id="newCodes">New codes</button> <span class="muted" style="font-size:.9rem">if a code got out. People already in stay in.</span></p>` : ""}</details>` : ""}
    <div class="err" id="relErr"></div>`;
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
