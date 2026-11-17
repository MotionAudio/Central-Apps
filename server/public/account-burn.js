// The Account page's Device codes (the owner and the people they add as Burners; server/src/burn.js):
//   - the Central Burner app for Ubuntu, from the newest release on GitHub
//   - the newest zip on GitHub for each thing it burns
//   - every device code: what it is, its chip, what it was burned with, when it last checked for updates
//   - (the owner) who can burn, and freeing a scrapped board's code
// app.js's helpers are shared (classic scripts): api, me, esc, toast…
/* global api, me, esc, toast */
(function () {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s);
  const user = () => (typeof me !== "undefined" ? me : null);
  const size = (n) => (n >= 1e9 ? (n / 1e9).toFixed(2) + " GB" : n >= 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1e3)) + " KB");
  const when = (d) => (d ? new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "");
  let devs = null, sw = null, swErr = "", burners = null, search = "";

  async function load(el) {
    const owner = !!(user() && user().owner);
    const [d, s, b] = await Promise.all([
      api("GET", "/burn/devices?q=" + encodeURIComponent(search)).catch((e) => ({ error: e.message })),
      sw ? Promise.resolve(sw) : api("GET", "/burn/software").catch((e) => ({ error: e.message })),
      owner ? api("GET", "/admin/burners").catch((e) => ({ error: e.message })) : Promise.resolve(null),
    ]);
    if (d.error) { el.innerHTML = '<h3>Device codes</h3><div class="err">' + esc(d.error) + "</div>"; return; }
    devs = d; burners = b && !b.error ? b.burners : null;
    if (s.error) { swErr = s.error; sw = null; } else { sw = s; swErr = ""; }
    draw(el);
  }

  function devRow(x) {
    return `<tr data-code="${esc(x.code)}"${x.freed ? ' class="muted"' : ""}><td><code class="burn-code" title="Copy">${esc(x.code)}</code>${x.freed ? ' <span class="chip off">Freed</span>' : ""}</td>
      <td>${esc(x.kindName)}${x.useName ? '<div class="muted">' + esc(x.useName) + "</div>" : ""}</td>
      <td>${x.boardRev ? esc(x.boardRev) : '<span class="muted">-</span>'}${x.batch ? '<div class="muted">' + esc(x.batch) + "</div>" : ""}</td>
      <td><code class="muted" title="${esc(x.chip)}">${esc(x.chip.length > 16 ? x.chip.slice(0, 16) + "…" : x.chip)}</code></td>
      <td>${x.software ? esc(x.software) : '<span class="muted">-</span>'}${x.burns > 1 ? '<div class="muted">' + x.burns + " burns</div>" : ""}</td>
      <td>${x.burnedAt ? esc(when(x.burnedAt)) + (x.burnedBy ? '<div class="muted">' + esc(x.burnedBy) + "</div>" : "") : '<span class="muted">not finished</span>'}</td>
      <td>${x.lastSeen ? esc(when(x.lastSeen)) + (x.lastVersion ? '<div class="muted">' + esc(x.lastVersion) + "</div>" : "") : x.kind === "pedal" || x.kind === "control" ? '<span class="muted">' + (x.registeredAt ? "checked in, no update check yet" : "not online yet") + "</span>" : '<span class="muted">-</span>'}</td>
      <td>${devs.owner && !x.freed ? '<button class="btn small ghost" type="button" data-free>Free</button>' : ""}</td></tr>`;
  }

  function draw(el) {
    const owner = !!devs.owner, c = devs.counts || {};
    const app = sw && sw.slots.find((x) => x.slot === "burner");
    const zips = sw ? sw.slots.filter((x) => x.slot !== "burner") : [];
    el.innerHTML = `<h3>Device codes <span class="chip plan">Private</span></h3>
      <p class="muted" style="margin:0;font-size:.9rem">Every pedal, control box, input box and output box gets its own code when it's burned with the Central Burner app: P, C, I or O and 15 to 25 random numbers. The app picks a random code nobody has, the code is written into the device's one-time chip for good, and it's kept here with the board revision and batch. A pedal or control box writes its code into its chip at its first start, checks in the first time it's online, and only gets updates from that chip.</p>
      <div class="burn-stats">${["pedal", "control", "input", "output"].map((k) => `<div><b>${c[k] || 0}</b><span class="muted">${{ pedal: "pedals", control: "control boxes", input: "input boxes", output: "output boxes" }[k]}</span></div>`).join("")}</div>
      <h4>The Central Burner app</h4>
      ${app && app.asset ? `<p style="margin:0">For Ubuntu. <button class="btn small" type="button" data-get="${app.asset}">Download ${esc(app.name)}</button> <span class="muted">${size(app.bytes)} · ${esc(app.version)}</span></p>
        <p class="muted" style="margin:.3rem 0 0;font-size:.88rem">Install it with <code>sudo apt install ./${esc(app.name)}</code>, then sign in with your Motion Audio account.</p>`
        : `<p class="muted" style="margin:0">${swErr ? esc(swErr) : "No Central Burner .deb on GitHub yet."}</p>`}
      <h4>Newest zips on GitHub</h4>
      ${zips.length ? `<table class="ktable"><tr><th>For</th><th>Zip</th><th>Version</th><th></th></tr>${zips.map((z) => `<tr><td>${esc(z.slotName)}</td><td>${z.asset ? esc(z.name) + '<div class="muted">' + size(z.bytes) + " · " + esc(when(z.published)) + "</div>" : '<span class="muted">none yet</span>'}</td><td>${z.asset ? esc(z.version) : ""}</td><td>${z.asset ? `<button class="btn small ghost" type="button" data-get="${z.asset}">Download</button>` : ""}</td></tr>`).join("")}</table>
        <p class="muted" style="margin:.3rem 0 0;font-size:.85rem">From the releases of ${esc(sw.repo)}. Name the files <code>central-pedal-1.0.0.zip</code>, <code>central-io-pedal-1.0.0.zip</code>, <code>central-io-inears-…</code>, <code>central-io-wave-…</code>, <code>central-input-…</code>, <code>central-output-…</code> and <code>central-burner-1.0.0-amd64.deb</code>.</p>`
        : swErr ? '<p class="err">' + esc(swErr) + "</p>" : ""}
      ${owner ? `<h4>Who can burn</h4>
        <p class="muted" style="margin:0;font-size:.88rem">You always can. Add the staff who burn devices; they sign in to the app with their own Motion Audio account.</p>
        <form class="burn-add" id="burnAdd"><input type="email" id="burnEmail" placeholder="their@email.com" autocomplete="off" aria-label="Email of someone who can burn"><button class="btn small" type="submit">Add</button></form>
        ${burners && burners.length ? `<table class="ktable">${burners.map((b) => `<tr><td>${esc(b.email)}${b.name ? '<div class="muted">' + esc(b.name) + "</div>" : ""}</td><td>${b.hasAccount ? "" : '<span class="muted">no account yet</span>'}</td><td style="text-align:right"><button class="btn small ghost" type="button" data-unburn="${esc(b.email)}">Remove</button></td></tr>`).join("")}</table>` : '<p class="muted" style="margin:.3rem 0 0">Nobody else yet.</p>'}` : ""}
      <h4>Codes</h4>
      <form class="burn-search" id="burnFind"><input type="search" id="burnQ" value="${esc(search)}" placeholder="Find a code, chip, zip, revision or batch" aria-label="Find a device code"></form>
      ${devs.devices.length ? `<div class="burn-scroll"><table class="ktable burn-table"><tr><th>Code</th><th>Device</th><th>Board</th><th>Chip</th><th>Burned with</th><th>Burned</th><th>Last update check</th><th></th></tr>${devs.devices.map(devRow).join("")}</table></div>`
        : '<p class="muted" style="margin:0">' + (search ? "Nothing matches." : "No devices burned yet.") + "</p>"}`;

    el.querySelectorAll("[data-get]").forEach((btn) => (btn.onclick = async () => {
      try { const r = await api("GET", "/burn/software/" + btn.dataset.get + "/link"); const a = document.createElement("a"); a.href = r.url; a.download = r.name; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove(); toast("Downloading " + r.name); }
      catch (e) { toast(e.message); }
    }));
    el.querySelectorAll(".burn-code").forEach((c) => (c.onclick = async () => { try { await navigator.clipboard.writeText(c.textContent); toast("Code copied"); } catch (_) { prompt("Code:", c.textContent); } }));
    el.querySelectorAll("tr[data-code] [data-free]").forEach((btn) => (btn.onclick = async () => {
      const code = btn.closest("tr").dataset.code;
      const why = prompt("Free " + code + "? That board stops getting updates, and if it's burned again it gets a new code. This code is never given out again.\n\nWhy (scrapped, lost…)?", "");
      if (why === null) return;
      try { await api("POST", "/burn/devices/" + encodeURIComponent(code) + "/free", { why }); toast(code + " freed"); load(el); } catch (e) { toast(e.message); }
    }));
    el.querySelectorAll("[data-unburn]").forEach((btn) => (btn.onclick = async () => {
      if (!confirm("Remove " + btn.dataset.unburn + "? They can't use the Central Burner any more.")) return;
      try { await api("POST", "/admin/burners/delete", { email: btn.dataset.unburn }); toast("Removed"); load(el); } catch (e) { toast(e.message); }
    }));
    const add = $("#burnAdd", el);
    if (add) add.onsubmit = async (e) => {
      e.preventDefault();
      const email = $("#burnEmail", el).value.trim(); if (!email) return;
      try { await api("POST", "/admin/burners", { email }); toast(email + " can burn devices now"); load(el); } catch (er) { toast(er.message); }
    };
    let t = null;
    $("#burnFind", el).onsubmit = (e) => e.preventDefault();
    $("#burnQ", el).oninput = (e) => { clearTimeout(t); t = setTimeout(() => { search = e.target.value.trim(); load(el).then(() => { const i = $("#burnQ", el); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }); }, 300); };
  }

  // ---------------------------------------------------------------- on the page (Account → Device codes)
  function addCard() {
    const u = user(), first = $("#acctBody .acct");
    if (!u || !u.burn || !first || $("#burnCard")) return;
    const d = document.createElement("div"); d.className = "card wide"; d.id = "burnCard"; d.innerHTML = '<h3>Device codes</h3><div class="muted">Loading…</div>';
    first.appendChild(d); load(d);
  }
  function start() {
    const b = $("#acctBody"); if (!b) return;
    let busy = false;
    new MutationObserver(() => { if (busy) return; busy = true; requestAnimationFrame(() => { try { addCard(); if (window.MAAccountNav) window.MAAccountNav.refresh(); } finally { busy = false; } }); }).observe(b, { childList: true, subtree: true });
    addCard();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
