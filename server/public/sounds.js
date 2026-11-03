// The sound pages (10.3): each picked item gets its 30-second preview from the libraries (/v1/libraries), the plan's
// whole library can be heard in a fold, and Central Tracks Unlimited lists our hymns with their previews.
(function () {
  "use strict";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const get = (p) => fetch("/v1" + p).then((r) => (r.ok ? r.json() : Promise.reject(new Error("The server answered " + r.status))));
  const P = () => window.PPPreview;

  function previews(libs) {
    document.querySelectorAll("[data-pick]").forEach((el) => {
      let k; try { k = JSON.parse(el.dataset.pick); } catch (_) { return; }
      const pv = P() && P().forItem(libs, k.kind, k.name, k.preset == null ? undefined : k.preset);
      const old = el.querySelector(".pvb"); if (!old) return;
      const label = (k.preset || k.name).replace(/^Plugins: /, "");
      if (!pv) { old.title = "The preview isn't published yet"; return; }
      const tmp = document.createElement("div"); tmp.innerHTML = P().button(pv, "Play", "btn ghost pvb");
      const b = tmp.firstElementChild; b.setAttribute("aria-label", "Hear 30 seconds of " + label);
      old.replaceWith(b);
    });
    document.querySelectorAll("[data-listall]").forEach((el) => {
      const lib = libs.find((l) => l.plan === el.dataset.listall);
      el.innerHTML = lib && P() ? P().listHtml(lib) : "";
    });
  }
  if (document.querySelector("[data-pick],[data-listall]")) get("/libraries").then((r) => previews((r && r.libraries) || [])).catch(() => {});

  // Central Tracks Unlimited: our hymns (Motion Audio's own multitracks), with their previews
  const hl = document.getElementById("hymnList");
  if (hl) get("/tracks?kind=Multitrack").then((r) => {
    const list = (r.tracks || []).filter((t) => t.preview || t.demo);
    const ours = list.filter((t) => /motion audio/i.test(t.artist || "")), show = (ours.length ? ours : list).slice(0, 24);
    if (!show.length) { hl.innerHTML = '<p class="muted">The hymns are on their way. <a href="/#tracks">Search the whole library</a>.</p>'; return; }
    hl.innerHTML = show.map((t) => `<div class="hymn">${t.preview && P() ? P().button({ url: t.preview }, "Play", "btn ghost pvb") : '<span class="pvb"></span>'}<div><b>${esc(t.title)}</b><div class="muted">${esc(t.artist || "")}${t.key ? " · " + esc(t.key) : ""}${t.bpm ? " · " + t.bpm + " BPM" : ""}</div></div><span class="chip plan">Unlimited</span></div>`).join("") +
      `<p class="muted" style="margin-top:.6rem">${list.length > show.length ? "And " + (list.length - show.length) + " more. " : ""}<a href="/#tracks">Search the whole library</a>.</p>`;
    hl.querySelectorAll("[data-pv]").forEach((b) => { const t = b.closest(".hymn").querySelector("b"); b.setAttribute("aria-label", "Hear 30 seconds of " + (t ? t.textContent : "this hymn")); });
  }).catch((e) => { hl.innerHTML = '<p class="muted">' + esc(e.message) + "</p>"; });
})();
