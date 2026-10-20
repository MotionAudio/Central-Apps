// The website's own words, pictures and sections (window.SiteContent), and edit mode for Motion Audio staff and the
// editors they add: change any text right on the page, swap pictures, hide sections, add new ones (text, questions,
// quotes, a picture), and - staff - change prices. Saved to /v1/admin/content (and /v1/admin/prices).
(function () {
  "use strict";
  var content = { text: {}, images: {}, hidden: [], blocks: [] }, loaded = false, editing = false, who = null, originals = {}, prices = null, priceEdits = {};
  var token = null; try { token = localStorage.getItem("ma-token"); } catch (_) { }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  async function api(method, path, body) {
    var h = { "Content-Type": "application/json" }; try { token = localStorage.getItem("ma-token"); } catch (_) { } if (token) h.Authorization = "Bearer " + token;
    var r = await fetch("/v1" + path, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined }), j = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(j.error || "The server answered " + r.status + ".");
    return j;
  }
  function note(msg, bad) { var d = document.createElement("div"); d.className = "toast" + (bad ? " bad" : ""); d.textContent = msg; document.body.appendChild(d); setTimeout(function () { d.remove(); }, 3200); }

  // ---------------------------------------------------------------- showing the saved content
  var SC = window.SiteContent = {
    has: function (k) { return Object.prototype.hasOwnProperty.call(content.text, k); },
    html: function (k, fallback) { return SC.has(k) ? content.text[k] : (fallback == null ? "" : fallback); },
    img: function (k, fallback) { return content.images[k] || fallback; },
    editing: function () { return editing; },
    ready: null, apply: apply
  };
  function apply(root) {
    $$("[data-edit]", root).forEach(function (el) { var k = el.dataset.edit; if (SC.has(k) && !(editing && el.isContentEditable)) el.innerHTML = content.text[k]; });
    $$("[data-edit-img]", root).forEach(function (el) { var u = content.images[el.dataset.editImg]; if (u) el.src = u; });
    $$("[data-section]").forEach(function (el) { var off = content.hidden.indexOf(el.dataset.section) > -1; el.hidden = off && !editing; el.classList.toggle("is-hidden", off); });
    renderBlocks();
  }
  SC.ready = fetch("/v1/content").then(function (r) { return r.json(); }).then(function (c) {
    content = { text: c.text || {}, images: c.images || {}, hidden: c.hidden || [], blocks: c.blocks || [] }; loaded = true;
    apply(document); document.dispatchEvent(new CustomEvent("sitecontent"));
  }).catch(function () { });

  // ---------------------------------------------------------------- added sections
  var KINDS = { text: "Text", faq: "Questions and answers", quotes: "Quotes", picture: "Picture" };
  function blockHtml(b) {
    var E = editing, ce = E ? ' contenteditable="true"' : "", items = b.items || [];
    var title = '<h2 data-bf="title"' + ce + ">" + (b.title || (E ? "A heading" : "")) + "</h2>";
    var body = '<div class="xb-body" data-bf="body"' + ce + ">" + (b.body || (E ? "<p>Write here.</p>" : "")) + "</div>";
    var inner = "";
    if (b.type === "faq") inner = title + '<div class="faq">' + items.map(function (it, i) {
      return E ? '<div class="faq-item" data-i="' + i + '"><div class="q" data-bf="q"' + ce + ">" + (it.q || "A question") + '</div><div class="a" data-bf="a"' + ce + ">" + (it.a || "The answer.") + '</div><button class="btn ghost small" data-xb="rm-item">Remove</button></div>'
        : "<details><summary>" + it.q + '</summary><div class="a">' + it.a + "</div></details>";
    }).join("") + "</div>" + (E ? '<button class="btn ghost small" data-xb="add-item">+ Add a question</button>' : "");
    else if (b.type === "quotes") inner = title + '<div class="quotes">' + items.map(function (it, i) {
      return '<figure class="quote" data-i="' + i + '"><blockquote data-bf="q"' + ce + ">" + (it.q || (E ? "Paste a real quote from a church you work with." : "")) + '</blockquote><figcaption data-bf="who"' + ce + ">" + esc(it.who || (E ? "Name, church" : "")) + "</figcaption>" + (E ? '<button class="btn ghost small" data-xb="rm-item">Remove</button>' : "") + "</figure>";
    }).join("") + "</div>" + (E ? '<button class="btn ghost small" data-xb="add-item">+ Add a quote</button>' : "");
    else if (b.type === "picture") inner = title + '<div class="xb-pic">' + (b.image ? '<img src="' + esc(b.image) + '" alt="" data-bf="image">' : E ? '<div class="xb-empty">No picture yet</div>' : "") + (E ? '<button class="btn small" data-xb="pic">' + (b.image ? "Replace picture" : "Choose a picture") + "</button>" : "") + "</div>" + body;
    else inner = title + body;
    return '<section class="xblock' + (b.type === "quotes" || b.type === "faq" ? " band" : "") + '" data-block="' + esc(b.id) + '" data-section="' + esc(b.id) + '" data-kind="' + b.type + '"><div class="wrap xb-wrap">' +
      (E ? '<div class="xb-tools"><span class="label">' + KINDS[b.type] + '</span><button class="btn ghost small" data-xb="up">Move up</button><button class="btn ghost small" data-xb="down">Move down</button><button class="btn ghost small danger-text" data-xb="del">Delete section</button></div>' : "") +
      inner + "</div></section>";
  }
  function renderBlocks() {
    $$("[data-block]").forEach(function (el) { el.remove(); });
    content.blocks.forEach(function (b) {
      var after = document.querySelector('[data-section="' + b.after + '"]:not([data-block])') || document.querySelector('[data-section="' + b.after + '"]');
      if (!after) { var main = document.querySelector("main.doc") || document.querySelector("#account"); after = main; }
      if (!after) return;
      var holder = document.createElement("div"); holder.innerHTML = blockHtml(b); var el = holder.firstChild;
      var anchor = after.closest("section, .hero, main") || after;
      // blocks after the same section keep their order
      var next = anchor.nextElementSibling; while (next && next.dataset && next.dataset.block && content.blocks.some(function (x) { return x.id === next.dataset.block && x.after === b.after; })) next = next.nextElementSibling;
      anchor.parentNode.insertBefore(el, next);
      var off = content.hidden.indexOf(b.id) > -1; el.hidden = off && !editing; el.classList.toggle("is-hidden", off);
    });
  }
  function readBlocks() {   // the added sections as they are on the page now
    $$("[data-block]").forEach(function (el) {
      var b = content.blocks.filter(function (x) { return x.id === el.dataset.block; })[0]; if (!b) return;
      var t = $('[data-bf="title"]', el), bd = $(':scope > .xb-wrap > [data-bf="body"]', el);
      if (t) b.title = t.innerHTML; if (bd) b.body = bd.innerHTML;
      if (b.type === "faq") b.items = $$(".faq-item", el).map(function (it) { return { q: $('[data-bf="q"]', it).innerHTML, a: $('[data-bf="a"]', it).innerHTML }; });
      if (b.type === "quotes") b.items = $$(".quote", el).map(function (it) { return { q: $('[data-bf="q"]', it).innerHTML, who: $('[data-bf="who"]', it).textContent }; });
    });
  }

  // ---------------------------------------------------------------- edit mode
  function bar() {
    var b = $("#editBar"); if (b) return b;
    b = document.createElement("div"); b.id = "editBar"; b.setAttribute("role", "toolbar");
    b.innerHTML = '<b>Editing this page</b><span class="muted" id="ebInfo">Click any words to change them. Hover a section to hide it or add one after it.</span><span class="eb-sp"></span>' +
      '<button class="btn ghost small" data-eb="discard">Discard changes</button><button class="btn small" data-eb="save">Save changes</button><button class="btn ghost small" data-eb="done">Done</button>';
    document.body.appendChild(b); return b;
  }
  function enter() {
    editing = true; document.body.classList.add("editing"); bar().hidden = false; $("#editBtn").hidden = true;
    originals = {}; priceEdits = {};
    $$("[data-edit]").forEach(function (el) { originals[el.dataset.edit] = el.innerHTML; el.contentEditable = "true"; el.spellcheck = true; });
    if (who && who.staff) {
      api("GET", "/admin/prices").then(function (r) { prices = r.prices; $$("[data-price]").forEach(function (el) { el.contentEditable = "true"; el.dataset.orig = el.textContent; el.title = "Type a new price"; }); }).catch(function () { });
    }
    $$("[data-section]").forEach(sectionTools);
    apply(document); renderBlocks();
    $$("[data-edit-img]").forEach(imgTools);
  }
  function leave() {
    editing = false; document.body.classList.remove("editing"); bar().hidden = true; $("#editBtn").hidden = false;
    $$("[contenteditable]").forEach(function (el) { el.removeAttribute("contenteditable"); });
    $$(".sec-tools, .img-tools, .add-here").forEach(function (el) { el.remove(); });
    apply(document); document.dispatchEvent(new CustomEvent("sitecontent"));
  }
  function sectionTools(sec) {
    if (sec.querySelector(":scope > .sec-tools") || sec.dataset.block) return;
    var id = sec.dataset.section, off = content.hidden.indexOf(id) > -1, t = document.createElement("div"); t.className = "sec-tools";
    t.innerHTML = '<button class="btn small ghost" data-st="toggle">' + (off ? "Show this section" : "Hide this section") + '</button><button class="btn small ghost" data-st="add">+ Add a section after</button>';
    t.dataset.for = id; sec.style.position = sec.style.position || "relative"; sec.insertBefore(t, sec.firstChild);
  }
  function imgTools(img) {
    if (img.nextElementSibling && img.nextElementSibling.classList.contains("img-tools")) return;
    var t = document.createElement("button"); t.className = "btn small img-tools"; t.type = "button"; t.textContent = "Replace picture"; t.dataset.imgKey = img.dataset.editImg;
    img.parentNode.style.position = "relative"; img.parentNode.appendChild(t);
  }
  function pickImage() {
    return new Promise(function (resolve, reject) {
      var f = document.createElement("input"); f.type = "file"; f.accept = "image/png,image/jpeg,image/webp,image/gif";
      f.onchange = function () { var file = f.files[0]; if (!file) return reject(new Error("No picture chosen.")); var rd = new FileReader(); rd.onload = function () { api("POST", "/admin/content/image", { name: file.name, data: rd.result }).then(function (r) { resolve(r.url); }, reject); }; rd.readAsDataURL(file); };
      f.click();
    });
  }
  function addMenu(afterId) {
    var host = document.createElement("div"); host.className = "modal-bg";
    host.innerHTML = '<div class="modal"><h3>Add a section</h3><p class="muted" style="margin:0">It goes right after this one. You can move it, hide it or delete it later.</p><div class="add-kinds">' +
      Object.keys(KINDS).map(function (k) { return '<button class="btn ghost" data-kind="' + k + '"><b>' + KINDS[k] + "</b><small>" + { text: "A heading and some words", faq: "Questions people ask, with your answers", quotes: "What churches you work with say (real quotes only)", picture: "A photo with a caption" }[k] + "</small></button>"; }).join("") +
      '</div><button class="btn ghost" data-kind="">Cancel</button></div>';
    document.body.appendChild(host);
    host.addEventListener("click", function (e) {
      var b = e.target.closest("[data-kind]"); if (!b && e.target !== host) return; host.remove(); if (!b || !b.dataset.kind) return;
      readBlocks();
      var k = b.dataset.kind, nb = { id: "b" + Math.random().toString(36).slice(2, 9), type: k, after: afterId, title: "", body: "", image: "", items: k === "faq" || k === "quotes" ? [{ q: "", a: "", who: "" }] : [] };
      content.blocks.push(nb); renderBlocks(); var el = document.querySelector('[data-block="' + nb.id + '"]'); if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); var h = el.querySelector("h2"); if (h) h.focus(); }
    });
  }
  async function save(andLeave) {
    readBlocks();
    var text = Object.assign({}, content.text);
    $$("[data-edit]").forEach(function (el) { var k = el.dataset.edit; if (originals[k] != null && el.innerHTML !== originals[k]) text[k] = el.innerHTML.trim(); });
    try {
      var r = await api("POST", "/admin/content", { content: { text: text, images: content.images, hidden: content.hidden, blocks: content.blocks } });
      content = r.content;
      var changed = Object.keys(priceEdits);
      if (changed.length && prices) {
        changed.forEach(function (id) { var c = Math.round(priceEdits[id] * 100); if (id === "subscription") prices.SUBSCRIPTION.cents = c; else if (prices.PRODUCTS[id]) prices.PRODUCTS[id].cents = c; });
        await api("POST", "/admin/prices", { prices: prices }); priceEdits = {};
        note("Saved, prices too. They're live now.");
        if (window.refreshConfig) window.refreshConfig();
      } else note("Saved. Everyone sees it now.");
      $$("[data-edit]").forEach(function (el) { originals[el.dataset.edit] = el.innerHTML; });
      if (andLeave) leave(); else { renderBlocks(); }
    } catch (e) { note(e.message, true); }
  }
  document.addEventListener("click", function (e) {
    var eb = e.target.closest("[data-eb]");
    if (eb) { var a = eb.dataset.eb; if (a === "save") save(false); else if (a === "done") { if (dirty() && confirm("Save your changes first?")) save(true); else leave(); } else if (a === "discard" && confirm("Throw away the changes you haven't saved?")) location.reload(); return; }
    if (!editing) return;
    var st = e.target.closest("[data-st]");
    if (st) { e.preventDefault(); var id = st.parentNode.dataset.for;
      if (st.dataset.st === "toggle") { var i = content.hidden.indexOf(id); if (i > -1) content.hidden.splice(i, 1); else content.hidden.push(id); var sec = document.querySelector('[data-section="' + id + '"]'); sec.classList.toggle("is-hidden", i < 0); st.textContent = i > -1 ? "Hide this section" : "Show this section"; note(i > -1 ? "It'll show once you save." : "Hidden once you save. It stays here, dimmed, while you edit."); }
      else addMenu(id); return; }
    var it = e.target.closest(".img-tools");
    if (it) { e.preventDefault(); pickImage().then(function (url) { content.images[it.dataset.imgKey] = url; var img = it.parentNode.querySelector('[data-edit-img="' + it.dataset.imgKey + '"]'); if (img) img.src = url; note("New picture in. Save to keep it."); }).catch(function (er) { note(er.message, true); }); return; }
    var xb = e.target.closest("[data-xb]");
    if (xb) { e.preventDefault(); readBlocks(); var el = xb.closest("[data-block]"), b = content.blocks.filter(function (x) { return x.id === el.dataset.block; })[0], k = content.blocks.indexOf(b), act = xb.dataset.xb;
      if (act === "del") { if (!confirm("Delete this section?")) return; content.blocks.splice(k, 1); }
      else if (act === "up" || act === "down") { var j = k + (act === "up" ? -1 : 1); if (j >= 0 && j < content.blocks.length) { content.blocks[k] = content.blocks[j]; content.blocks[j] = b; } }
      else if (act === "add-item") b.items.push({ q: "", a: "", who: "" });
      else if (act === "rm-item") { var item = xb.closest("[data-i]"); b.items.splice(Number(item.dataset.i), 1); }
      else if (act === "pic") { pickImage().then(function (url) { b.image = url; renderBlocks(); }).catch(function (er) { note(er.message, true); }); return; }
      renderBlocks(); return; }
    // while editing, links and buttons on the page don't go anywhere (so a click puts the cursor in the words)
    if (e.target.closest("a, button") && !e.target.closest("#editBar, .modal, .modal-bg, #editBtn")) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  // prices: numbers only; remember the change
  document.addEventListener("input", function (e) {
    var el = e.target.closest && e.target.closest("[data-price]"); if (!el || !editing) return;
    var n = parseFloat(el.textContent.replace(/[^0-9.]/g, "")); if (Number.isFinite(n)) { priceEdits[el.dataset.price] = n; el.classList.remove("bad-price"); } else el.classList.add("bad-price");
  });
  // pasting: plain words, not someone else's styles
  document.addEventListener("paste", function (e) { if (!editing || !e.target.closest || !e.target.closest("[contenteditable]")) return; e.preventDefault(); var t = (e.clipboardData || window.clipboardData).getData("text/plain"); document.execCommand("insertText", false, t); });
  document.addEventListener("keydown", function (e) { if (editing && (e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); save(false); } });
  function dirty() { readBlocks(); return Object.keys(priceEdits).length > 0 || $$("[data-edit]").some(function (el) { return originals[el.dataset.edit] != null && el.innerHTML !== originals[el.dataset.edit]; }); }
  window.addEventListener("beforeunload", function (e) { if (editing && dirty()) { e.preventDefault(); e.returnValue = ""; } });
  // when the store re-draws itself, its new words become editable too
  new MutationObserver(function () { if (!editing) return; $$("[data-edit]:not([contenteditable])").forEach(function (el) { if (originals[el.dataset.edit] == null) originals[el.dataset.edit] = el.innerHTML; el.contentEditable = "true"; }); $$("[data-edit-img]").forEach(imgTools); }).observe(document.documentElement, { childList: true, subtree: true });

  // ---------------------------------------------------------------- the Edit page button (editors only)
  async function checkEditor() {
    try { token = localStorage.getItem("ma-token"); } catch (_) { }
    var btn = $("#editBtn");
    if (!token) { if (btn) btn.hidden = true; return; }
    try { who = await api("GET", "/editor"); } catch (_) { who = null; }
    if (!who || !who.editor) { if (btn) btn.hidden = true; return; }
    if (!btn) { btn = document.createElement("button"); btn.id = "editBtn"; btn.className = "btn"; btn.type = "button"; btn.innerHTML = "&#9998; Edit this page"; btn.onclick = function () { SC.ready.then(enter); }; document.body.appendChild(btn); }
    btn.hidden = editing;
  }
  SC.checkEditor = checkEditor;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", checkEditor); else checkEditor();
  window.addEventListener("storage", function (e) { if (e.key === "ma-token") checkEditor(); });
})();
