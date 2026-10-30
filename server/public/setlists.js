// Motion Audio website: "Add songs" for a setlist (10.0). Central Pedal Control, Central Control or the pedal opens
// #setlist-<id>; the songs picked here go into that setlist and the app downloads them by itself.
// Uses app.js's api / me / modal / toast / esc / money / needSignIn / openCheckout (loaded before this file).
"use strict";
(function () {
  const SONG_KINDS = ["Multitrack", "Prime", "Pad"];
  const BUY_KEY = "ma-setlist-buy";
  let sl = null, found = [], busy = false, searchTimer = 0;

  function host() {
    let s = document.getElementById("setlistAdd");
    if (!s) {
      s = document.createElement("section"); s.id = "setlistAdd"; s.className = "band"; s.hidden = true;
      const before = document.getElementById("downloads") || document.querySelector("main section, body > section");
      if (before && before.parentNode) before.parentNode.insertBefore(s, before); else document.body.appendChild(s);
      s.addEventListener("click", onClick);
      s.addEventListener("input", (e) => { if (e.target.id === "slQ") { clearTimeout(searchTimer); searchTimer = setTimeout(search, 250); } });
    }
    return s;
  }
  const inList = (id) => !!(sl && sl.songs.some((x) => x.trackId === String(id)));
  function draw(msg) {
    const s = host(); if (!sl) return;
    const sub = !!(me && me.subscribed), team = sl.team || [];
    s.innerHTML = `<div class="wrap">
      <h2 style="margin:0">Add songs to ${esc(sl.name)}</h2>
      <p class="muted" style="margin:.3rem 0 1rem">${sl.songs.length} song${sl.songs.length === 1 ? "" : "s"} so far${team.length ? " · playing: " + esc(team.map((t) => t.name || t.email).join(", ")) : ""}.
        ${sub ? "You have Central Tracks Unlimited, so any song goes straight in." : "Songs you already own go straight in. Others you buy first, or subscribe to Central Tracks Unlimited and add any song."}</p>
      ${sl.songs.length ? `<ol class="sl-songs">${sl.songs.map((x) => `<li>${esc(x.title)}${x.key ? ` <span class="muted">· ${esc(x.key)}</span>` : ""}${x.trackId ? ` <button class="btn small ghost" data-sl-remove="${esc(x.trackId)}">Take out</button>` : ""}</li>`).join("")}</ol>` : ""}
      <label style="display:block;max-width:420px">Find a song<input id="slQ" type="search" placeholder="Song, artist or key" autocomplete="off"></label>
      <div class="tbl"><table class="tracks"><thead><tr><th>Song</th><th>Type</th><th class="num">Key</th><th class="num">BPM</th><th></th></tr></thead><tbody id="slBody">${rows()}</tbody></table></div>
      <p class="muted" style="margin-top:1rem">When you're done, go back to the app. The songs download there by themselves${sl.songs.length ? "" : " as soon as you add them"}.</p>
      <div class="err" id="slErr">${esc(msg || "")}</div></div>`;
    const q = document.getElementById("slQ"); if (q && q.dataset.v === undefined) q.dataset.v = "";
  }
  function rows() {
    if (!found.length) return `<tr><td colspan="5" class="muted">${busy ? "Looking…" : "No songs match that search."}</td></tr>`;
    const sub = !!(me && me.subscribed);
    return found.map((t) => {
      const act = inList(t.id) ? `<span class="added">In the setlist</span>`
        : t.owned || sub ? `<button class="btn small" data-sl-add="${esc(t.id)}">Add</button>`
        : `<button class="btn small ghost" data-sl-buy="${esc(t.id)}">Buy ${money(t.price)}</button>`;
      return `<tr><td><div style="font-weight:600">${esc(t.title)}</div><div class="muted" style="font-size:.85rem">${esc(t.artist)}</div></td><td><span class="kind">${esc(t.kind)}</span></td>
        <td class="num">${esc(t.key || "—")}</td><td class="num">${t.bpm || "—"}</td><td class="act">${act}</td></tr>`;
    }).join("");
  }
  async function search() {
    const term = (document.getElementById("slQ") || {}).value || "";
    busy = true; const b = document.getElementById("slBody"); if (b) b.innerHTML = rows();
    try { found = ((await api("GET", "/tracks?kind=" + SONG_KINDS.join(",") + "&q=" + encodeURIComponent(term.trim()))).tracks || []); }
    catch (e) { found = []; }
    busy = false; const b2 = document.getElementById("slBody"); if (b2) b2.innerHTML = rows();
  }
  async function add(id) {
    try {
      const r = await api("POST", "/setlists/" + encodeURIComponent(sl.id) + "/songs", { trackId: id });
      if (r._status === 402) return buy(id);
      sl = r.setlist; const t = found.find((x) => String(x.id) === String(id)); if (t) t.owned = true;
      draw(); toast("Added. It's downloading in the app now.");
    } catch (e) { draw(e.message); }
  }
  async function remove(id) {
    try { sl = (await api("POST", "/setlists/" + encodeURIComponent(sl.id) + "/songs/remove", { trackId: id })).setlist; draw(); }
    catch (e) { draw(e.message); }
  }
  function buy(id) {
    const t = found.find((x) => String(x.id) === String(id)); if (!t) return;
    try { sessionStorage.setItem(BUY_KEY, JSON.stringify({ setlist: sl.id, track: String(id), at: Date.now() })); } catch {}
    if (typeof buyModal === "function") return buyModal(t);
    location.hash = "buy-" + id;
  }
  function onClick(e) {
    const a = e.target.closest("[data-sl-add]"); if (a) return add(a.dataset.slAdd);
    const b = e.target.closest("[data-sl-buy]"); if (b) return buy(b.dataset.slBuy);
    const r = e.target.closest("[data-sl-remove]"); if (r) return remove(r.dataset.slRemove);
  }
  async function open(id) {
    const s = host();
    if (!me) { try { sessionStorage.setItem("ma-after-signin", "#setlist-" + id); } catch {} return needSignIn("Sign in to add songs to your setlist."); }
    document.querySelectorAll("body > section, main > section").forEach((x) => { if (x !== s && x.id !== "account") x.dataset.slHid = x.hidden ? "1" : "0"; });
    try { sl = (await api("GET", "/setlists/" + encodeURIComponent(id))).setlist; }
    catch (e) { sl = null; s.hidden = false; s.innerHTML = `<div class="wrap"><h2>Add songs</h2><p class="err">${esc(e.message)}</p></div>`; return; }
    s.hidden = false; found = []; draw(); search();
    s.scrollIntoView({ block: "start" });
  }
  // back from buying one: put it in the setlist (the payment may still be on its way - try for a little while)
  async function afterBuy() {
    let pending = null; try { pending = JSON.parse(sessionStorage.getItem(BUY_KEY) || "null"); } catch {}
    if (!pending || Date.now() - pending.at > 3600e3) return;
    try { sessionStorage.removeItem(BUY_KEY); } catch {}
    for (let i = 0; i < 12; i++) {
      try { const r = await api("POST", "/setlists/" + encodeURIComponent(pending.setlist) + "/songs", { trackId: pending.track }); if (r._status !== 402) break; } catch { break; }
      await new Promise((res) => setTimeout(res, 2500));
    }
    location.hash = "setlist-" + pending.setlist;
  }
  function onHash() {
    const h = location.hash.slice(1), s = document.getElementById("setlistAdd");
    if (h.startsWith("setlist-")) return open(h.slice(8));
    if (s && !s.hidden) s.hidden = true;
    if (h.startsWith("bought-")) afterBuy();
  }
  addEventListener("hashchange", onHash);
  // app.js signs in first and then calls handleHash() (also after "sign in to continue"): this page hears it too
  if (typeof handleHash === "function") {
    const orig = handleHash;
    window.handleHash = handleHash = function () { onHash(); return orig.apply(this, arguments); };   // eslint-disable-line no-func-assign
  }
  // opened straight on #setlist-<id>: wait until app.js knows who is signed in
  if (/^#(setlist|bought)-/.test(location.hash)) {
    const t0 = Date.now(), wait = setInterval(() => { if (!token || me || Date.now() - t0 > 8000) { clearInterval(wait); onHash(); } }, 100);
  }
  window.SetlistAdd = { open, state: () => sl };
})();
