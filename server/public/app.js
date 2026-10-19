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
const products = [
  { id: "pedal-sw", tag: "Software bundle", name: "Central Pedal + Central Pedal Control", price: 80, per: "one-time", pts: ["Central Pedal OS for your Raspberry Pi 4", "Central Pedal Control for macOS and iPad", "Edit songs and upload them to the pedal"] },
  { id: "control", tag: "License", name: "Central Control", price: 50, per: "per license", pts: ["Main admin and admins", "Lights, slides, lyrics, cameras, in-ears", "Running tracks and mixing", "Linux, Windows, macOS"] },
  { id: "usage", tag: "License", name: "Central Usage", price: 25, per: "per license", pts: ["For each musician", "Instrument, lyrics and chord charts", "macOS, iPadOS, iOS, Android, Windows"] },
  { id: "pedal-hw", tag: "Fully built", name: "Central Pedal, ready to play", price: 250, per: "one-time", feature: true, pts: ["Assembled pedal with buttons and knobs", "Software installed and tested", "Includes Central Pedal Control", "Ships to the US and Canada"] },
];
function renderRack() {
  $("#rack").innerHTML = products.map((p) => `<div class="prod${p.feature ? " feature" : ""}">
    <div class="tag">${p.tag}</div><h3>${p.name}</h3>
    <div class="price">$${p.price}<small> ${p.per}</small></div>
    <ul>${p.pts.map((x) => `<li>${x}</li>`).join("")}</ul>
    <button class="btn" data-add="${p.id}">Add to cart</button></div>`).join("");
}
const cartCount = () => Object.values(cart).reduce((a, b) => a + b, 0);
function updateCartBtn() { $("#cartBtn").textContent = "Cart · " + cartCount(); }
$("#rack").addEventListener("click", (e) => { const a = e.target.closest("[data-add]"); if (!a) return; cart[a.dataset.add] = (cart[a.dataset.add] || 0) + 1; updateCartBtn(); toast("Added to cart"); });
$("#cartBtn").onclick = () => {
  const ids = Object.keys(cart).filter((k) => cart[k] > 0);
  if (!ids.length) return modal(`<h3>Your cart is empty</h3><p class="muted" style="margin:0">Add a pedal or a license from the store.</p><button class="btn" data-close>Close</button>`);
  let total = 0;
  const lines = ids.map((id) => { const p = products.find((x) => x.id === id), s = p.price * cart[id]; total += s; return `<div><span>${p.name} × ${cart[id]}</span><span>${money(s)}</span></div>`; }).join("");
  modal(`<h3>Cart</h3><div class="lines">${lines}<div class="total"><span>Total</span><span>${money(total)}</span></div></div>
    <p class="muted" style="margin:0;font-size:.9rem">You'll pay securely with Stripe. License keys appear right after checkout.</p>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn" id="checkout">Check out</button><button class="btn ghost" id="clear">Empty cart</button></div><div class="err" id="coErr"></div>`);
  $("#clear").onclick = () => { for (const k in cart) delete cart[k]; updateCartBtn(); closeModal(); };
  $("#checkout").onclick = async () => {
    if (!cfg.payments) return paymentsSoon();
    $("#checkout").disabled = true;
    try { go((await api("POST", "/checkout/store", { items: cart })).url); } catch (e) { $("#coErr").textContent = e.message; $("#checkout").disabled = false; }
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
  $("#exTotal").textContent = money(per * (+$("#exBuys").value || 0) + 3 * (+$("#exAdds").value || 0));
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
    <label>Password (8+ characters)<input id="upPass" type="password" autocomplete="new-password" minlength="8" required></label><button class="btn">Make account</button><div class="err" id="upErr"></div></form></div></div>`;
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
  body.innerHTML = `<div class="acct"><div class="card"><h3>Central Tracks</h3><div class="status ${me.subscribed ? "on" : ""}" style="font:500 .85rem var(--mono)">${me.subscribed ? "Unlimited · $77/month" : "Not subscribed"}</div>
      <p class="muted" style="margin:0;font-size:.92rem">In Central Pedal or Central Pedal Control: <b>+ Add songs → Central Tracks</b>. Set the server to <code style="user-select:all">${esc(location.origin)}</code> and sign in with ${esc(me.email)}.</p>
      <a class="btn ghost small" href="${APPS_URL}" target="_blank" rel="noopener" style="justify-self:start">Download the apps</a></div>
    <div class="card"><h3>Your storage</h3><div id="myLib" class="muted">Loading…</div></div>
    <div class="card"><h3>Publishing</h3><div id="myPub" class="muted">Loading…</div></div></div>`;
  try {
    const lib = (await api("GET", "/library")).tracks;
    $("#myLib").innerHTML = lib.length ? lib.map((t) => `<div><b>${esc(t.title)}</b> <span class="muted">· ${esc(t.kind)}</span></div>`).join("") : "Nothing yet. Add or buy tracks from Central Tracks.";
    const p = await api("GET", "/publisher");
    $("#myPub").innerHTML = `<div><b>${money(p.unpaid)}</b> waiting to be paid · ${money(p.paid)} paid so far</div>` +
      (p.tracks.length ? p.tracks.map((t) => `<div>${starHtml(t.stars)} <b>${esc(t.title)}</b> <span class="muted">· ${money(t.price)} · ${t.sales} sold · ${t.adds} subscriber adds${t.status !== "live" ? " · " + esc(t.status) : ""}</span></div>`).join("") : '<div>No tracks published yet. <a href="#publish">Publish one</a>.</div>');
  } catch (err) { $("#myPub").textContent = err.message; }
}
$("#signOut").onclick = () => { setToken(null); me = null; renderAll(); toast("Signed out"); };

async function refreshMe() {
  if (!token) { me = null; } else { try { me = await api("GET", "/me"); } catch { me = null; } }
  renderAll();
}
function renderAll() { renderSub(); renderPayout(); renderAccount(); loadTracks(); }

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

renderRack(); renderTiers(); setPrice();
api("GET", "/config").then((c) => { cfg = c; }).catch(() => {});
refreshMe().then(handleHash);
addEventListener("hashchange", handleHash);
