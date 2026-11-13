// The Account page's Pedal builds (rev E): the owner's private uploads of the pedal's software, SD card images and the
// two boards' firmware (server/src/builds.js). The file goes straight from this browser to the file storage through a
// signed link, with how far it's got; then the server checks it arrived whole and works out its SHA-256.
// app.js's helpers are shared (classic scripts): api, me, esc, toast…
/* global api, me, esc, toast */
(function () {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s);
  const user = () => (typeof me !== "undefined" ? me : null);
  const size = (n) => (n >= 1e9 ? (n / 1e9).toFixed(2) + " GB" : n >= 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1e3)) + " KB");
  const when = (d) => new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  const secs = (s) => (s >= 90 ? Math.round(s / 60) + " min" : Math.max(1, Math.round(s)) + " s");
  let data = null, xhr = null, picked = null, poll = null;

  async function load(el) {
    try { data = await api("GET", "/admin/builds"); } catch (e) { el.innerHTML = '<h3>Pedal builds</h3><div class="err">' + esc(e.message) + "</div>"; return; }
    draw(el);
    clearTimeout(poll);
    if (data.builds.some((b) => b.state === "ready" && !b.sha256)) poll = setTimeout(() => { if (!xhr && document.body.contains(el)) load(el); }, 4000);
  }

  function row(b) {
    const ready = b.state === "ready";
    return `<tr data-id="${b.id}"><td><b>${esc(b.version)}</b>${b.ship ? ' <span class="chip plan">Ships</span>' : ""}<div class="muted bld-name">${esc(b.name)}</div></td>
      <td>${ready ? size(b.bytes) : '<span class="muted">didn\'t finish</span>'}</td>
      <td>${esc(when(b.at))}${b.by ? '<div class="muted">' + esc(b.by) + "</div>" : ""}</td>
      <td>${ready ? (b.sha256 ? `<code class="bld-sha" title="SHA-256 ${esc(b.sha256)}" data-sha="${esc(b.sha256)}">${esc(b.sha256.slice(0, 12))}…</code>` : '<span class="muted">checking…</span>') : ""}</td>
      <td><div class="bld-acts">${ready ? `<button class="btn small" type="button" data-dl>Download</button>${b.ship ? "" : '<button class="btn small ghost" type="button" data-ship>Ship this one</button>'}<button class="btn small ghost" type="button" data-notes>Notes</button>` : ""}<button class="btn small ghost" type="button" data-del>Delete</button></div></td></tr>
      <tr class="bld-notes" data-for="${b.id}"${b.notes ? "" : " hidden"}><td colspan="5">${b.notes ? '<p class="muted">' + esc(b.notes) + "</p>" : ""}</td></tr>`;
  }

  function draw(el) {
    const d = data, kinds = d.kinds;
    const groups = kinds.map((k) => {
      const list = d.builds.filter((b) => b.kind === k.id);
      if (!list.length) return "";
      return `<div class="bld-group"><h4>${esc(k.name)} <span class="muted">· ${list.length} build${list.length === 1 ? "" : "s"}</span></h4>
        <table class="ktable bld-table"><tr><th>Version</th><th>Size</th><th>Uploaded</th><th>SHA-256</th><th></th></tr>${list.map(row).join("")}</table></div>`;
    }).join("");
    el.innerHTML = `<h3>Pedal builds <span class="chip plan">Private</span></h3>
      <p class="muted" style="margin:0;font-size:.9rem">The Central Pedal's software, SD card images and firmware. Only you can see these: they're kept in ${esc(d.storage)}, not on GitHub, and a download link works for an hour. One upload can be up to ${(d.maxBytes / 1e9).toFixed(1)} GB, so compress an image with xz first.</p>
      <form class="bld-up" id="bldForm" novalidate>
        <label>What it is<select id="bldKind">${kinds.map((k) => `<option value="${esc(k.id)}">${esc(k.name)}</option>`).join("")}</select></label>
        <label>Version<input id="bldVer" placeholder="1.0.0" autocomplete="off" spellcheck="false"></label>
        <label class="wide"><span>What changed <span class="muted">(optional)</span></span><textarea id="bldNotes" rows="2" placeholder="What's new, what's fixed, which boards it's for"></textarea></label>
        <label class="bld-drop wide" id="bldDrop"><input type="file" id="bldFile"><b id="bldPick">Choose a file, or drop it here</b><span class="muted" id="bldHint"></span></label>
        <div class="bld-go wide"><button class="btn small" type="submit" id="bldSend">Upload</button><button class="btn small ghost" type="button" id="bldStop" hidden>Stop</button>
          <div class="bld-bar" id="bldBar" hidden><i></i></div><span class="muted" id="bldProg" aria-live="polite"></span></div>
        <div class="err wide" id="bldErr"></div>
      </form>
      ${groups || '<p class="muted" style="margin:0">Nothing uploaded yet.</p>'}`;
    const kind = $("#bldKind", el), hint = () => { const k = kinds.find((x) => x.id === kind.value); $("#bldHint", el).textContent = k ? k.hint : ""; };
    kind.onchange = hint; hint();
    const file = $("#bldFile", el), drop = $("#bldDrop", el);
    const pick = (f) => {
      picked = f || null;
      $("#bldPick", el).textContent = picked ? picked.name + " · " + size(picked.size) : "Choose a file, or drop it here";
      drop.classList.toggle("has", !!picked);
      const ver = $("#bldVer", el), m = picked && picked.name.match(/(?:^|[-_ v])(\d+\.\d+(?:\.\d+)?(?:-(?:alpha|beta|rc)\.?\d*)?)(?![\d])/i);
      if (m && !ver.value) ver.value = m[1];
      if (picked && /\.uf2$/i.test(picked.name) && kind.value === "pedal") { kind.value = /control|fsw|foot/i.test(picked.name) ? "controls-fw" : "audio-fw"; hint(); }
      if (picked && /\.img(\.\w+)?$/i.test(picked.name) && kind.value === "pedal") { kind.value = "image"; hint(); }
    };
    file.onchange = () => pick(file.files[0]);
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); if (e.dataTransfer.files[0]) pick(e.dataTransfer.files[0]); });
    $("#bldForm", el).onsubmit = (e) => { e.preventDefault(); send(el); };
    $("#bldStop", el).onclick = () => { if (xhr) xhr.abort(); };
    el.querySelectorAll(".bld-sha").forEach((c) => (c.onclick = async () => { try { await navigator.clipboard.writeText(c.dataset.sha); toast("SHA-256 copied"); } catch (_) { prompt("SHA-256:", c.dataset.sha); } }));
    el.querySelectorAll("tr[data-id]").forEach((tr) => {
      const id = tr.dataset.id, b = data.builds.find((x) => String(x.id) === id);
      const on = (sel, fn) => { const x = $(sel, tr); if (x) x.onclick = fn; };
      on("[data-dl]", async () => {
        try { const r = await api("GET", "/admin/builds/" + id + "/link"); const a = document.createElement("a"); a.href = r.url; a.download = r.name; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove(); toast("Downloading " + r.name); }
        catch (e) { toast(e.message); }
      });
      on("[data-ship]", async () => { try { await api("POST", "/admin/builds/" + id, { ship: true }); toast(b.kindName + " " + b.version + " is the one to ship"); load(el); } catch (e) { toast(e.message); } });
      on("[data-del]", async () => {
        if (!confirm("Delete " + b.name + " (" + b.version + ")? The file is removed from storage too.")) return;
        try { await api("POST", "/admin/builds/" + id + "/delete", {}); toast("Deleted"); load(el); } catch (e) { toast(e.message); }
      });
      on("[data-notes]", () => {
        const nr = $('tr[data-for="' + id + '"]', el); nr.hidden = false;
        nr.firstElementChild.innerHTML = `<div class="bld-edit"><textarea rows="3" aria-label="What changed in ${esc(b.version)}">${esc(b.notes || "")}</textarea><button class="btn small" type="button">Save</button></div>`;
        const ta = $("textarea", nr); ta.focus();
        $("button", nr).onclick = async () => { try { await api("POST", "/admin/builds/" + id, { notes: ta.value }); toast("Saved"); load(el); } catch (e) { toast(e.message); } };
      });
    });
  }

  // the file straight to storage, with how far it's got
  function put(url, f, onp) {
    return new Promise((ok, no) => {
      const x = (xhr = new XMLHttpRequest());
      x.open("PUT", url);
      x.setRequestHeader("Content-Type", "application/octet-stream");
      x.upload.onprogress = (e) => { if (e.lengthComputable) onp(e.loaded, e.total); };
      x.onload = () => (x.status >= 200 && x.status < 300 ? ok() : no(new Error("The storage turned it away (" + x.status + "). Try again.")));
      x.onerror = () => no(new Error("The upload stopped. Check the connection and try again."));
      x.onabort = () => no(new Error("Stopped."));
      x.send(f);
    });
  }
  async function send(el) {
    const err = $("#bldErr", el), prog = $("#bldProg", el), bar = $("#bldBar", el), go = $("#bldSend", el), stop = $("#bldStop", el);
    err.textContent = "";
    if (!picked) { err.textContent = "Choose the file first."; return; }
    const ver = $("#bldVer", el).value.trim();
    if (!ver) { err.textContent = "Type the version, like 1.0.0."; $("#bldVer", el).focus(); return; }
    if (picked.size > data.maxBytes) { err.textContent = "That's " + size(picked.size) + ". One upload can be up to " + (data.maxBytes / 1e9).toFixed(1) + " GB: compress it first."; return; }
    let made = null;
    go.disabled = true; stop.hidden = false; bar.hidden = false; bar.firstElementChild.style.width = "0%";
    const t0 = performance.now();
    addEventListener("beforeunload", hold);
    try {
      made = await api("POST", "/admin/builds", { kind: $("#bldKind", el).value, version: ver, name: picked.name, size: picked.size, notes: $("#bldNotes", el).value });
      prog.textContent = "Starting…";
      await put(made.uploadUrl, picked, (n, t) => {
        const s = (performance.now() - t0) / 1000, rate = n / Math.max(s, 0.1), left = (t - n) / Math.max(rate, 1);
        bar.firstElementChild.style.width = ((n / t) * 100).toFixed(1) + "%";
        prog.textContent = Math.floor((n / t) * 100) + "% · " + size(n) + " of " + size(t) + (n < t && s > 2 ? " · about " + secs(left) + " left" : "");
      });
      prog.textContent = "Checking it arrived…";
      await api("POST", "/admin/builds/" + made.build.id + "/done", {});
      toast(picked.name + " uploaded");
      picked = null;
      await load(el);
    } catch (e) {
      err.textContent = e.message;
      if (made) api("POST", "/admin/builds/" + made.build.id + "/delete", {}).catch(() => { });
      go.disabled = false; stop.hidden = true; bar.hidden = true; prog.textContent = "";
    } finally { xhr = null; removeEventListener("beforeunload", hold); }
  }
  function hold(e) { e.preventDefault(); e.returnValue = ""; }

  // ---------------------------------------------------------------- on the page (Account → Pedal builds), the owner only
  function addCard() {
    const u = user(), first = $("#acctBody .acct");
    if (!u || !u.builds || !first || $("#buildsCard")) return;
    const d = document.createElement("div"); d.className = "card wide"; d.id = "buildsCard"; d.innerHTML = '<h3>Pedal builds</h3><div class="muted">Loading…</div>';
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
