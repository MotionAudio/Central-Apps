// The Help Center (10.3): /help/ (guides by category, one search over the guides and the questions, Contact support),
// /help/article.html?a=<slug> (a guide, "Was this helpful?") and /help/ticket.html#<token> (a support ticket: read
// and answer). Motion Audio staff and the website's editors write, edit, reorder and delete the guides right here:
// headings, text, steps, pictures (uploaded) and videos (uploaded, or a YouTube link).
/* global api, me, toast, esc, needSignIn */
(function () {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const h = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // a little formatting in the text: **bold**, and [a link](https://… or /…)
  const inline = (s) => h(s).replace(/\*\*([^*]{1,200})\*\*/g, "<b>$1</b>").replace(/\[([^\]]{1,120})\]\(((?:https:\/\/|\/)[^\s)"'<>]{1,300})\)/g, '<a href="$2">$1</a>');
  const PAGE = document.body.dataset.page;
  const artHref = (a) => "/help/article.html?a=" + encodeURIComponent(a.slug);
  let data = { categories: [], articles: [], canEdit: false };

  async function loadArticles(all) {
    try { data = await api("GET", "/help/articles" + (all ? "?all=1" : "")); } catch (e) { data = { categories: [], articles: [], canEdit: false, error: e.message }; }
    return data;
  }

  // ------------------------------------------------------------------ /help/
  function drawCats() {
    const el = $("#hcCats"); if (!el) return;
    if (data.error) { el.innerHTML = '<p class="err">' + h(data.error) + "</p>"; return; }
    const by = {}; data.articles.filter((a) => a.published !== false).forEach((a) => (by[a.category] = by[a.category] || []).push(a));
    el.innerHTML = data.categories.filter((c) => by[c]).map((c) => '<div class="hc-cat"><h3>' + h(c) + "</h3><ul>" + by[c].map((a) => '<li><a href="' + artHref(a) + '">' + h(a.title) + "</a></li>").join("") + "</ul></div>").join("") || '<p class="muted">No guides yet.</p>';
  }
  // one search over the guides and the questions: every word has to be there; the title counts most
  function search(q) {
    const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
    const sec = $("#results"), out = $("#hcResults"); if (!sec || !out) return;
    if (!words.length) { sec.hidden = true; out.innerHTML = ""; $$(".faq-group, [data-faq]").forEach((x) => (x.hidden = false)); return; }
    const score = (title, rest) => { const t = title.toLowerCase(), r = rest.toLowerCase(); let s = 0; for (const w of words) { if (t.includes(w)) s += 3; else if (r.includes(w)) s += 1; else return 0; } return s; };
    const arts = data.articles.filter((a) => a.published !== false).map((a) => ({ a, s: score(a.title, a.summary + " " + a.category + " " + (a.text || "")) })).filter((x) => x.s).sort((x, y) => y.s - x.s);
    const faqs = $$("[data-faq]").map((d) => ({ d, q: $("summary", d).textContent, ans: $("p", d).textContent, g: d.closest("[data-faq-group]").dataset.faqGroup })).map((x) => Object.assign(x, { s: score(x.q, x.ans + " " + x.g) })).filter((x) => x.s).sort((x, y) => y.s - x.s);
    sec.hidden = false;
    $("#hcResTitle").textContent = arts.length + faqs.length ? (arts.length + faqs.length) + " result" + (arts.length + faqs.length === 1 ? "" : "s") + " for “" + q.trim() + "”" : "Nothing found for “" + q.trim() + "”";
    out.innerHTML = arts.map((x) => '<a href="' + artHref(x.a) + '" data-result="guide"><small>Guide · ' + h(x.a.category) + "</small><br><b>" + h(x.a.title) + '</b><br><span class="muted">' + h(x.a.summary) + "</span></a>").join("") +
      faqs.map((x) => '<div class="r" data-result="faq"><small>Question · ' + h(x.g) + "</small><br><b>" + h(x.q) + '</b><p class="muted" style="margin:.3rem 0 0">' + h(x.ans) + "</p></div>").join("") +
      (arts.length + faqs.length ? "" : '<div class="r">Try other words, or <a href="#contact">ask us</a>: a real person answers.</div>');
  }
  async function helpPage() {
    await loadArticles(true);
    drawCats();
    const qi = $("#hcQ"); let t = 0;
    if (qi) {
      qi.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { search(qi.value); try { history.replaceState(null, "", qi.value.trim() ? "?q=" + encodeURIComponent(qi.value.trim()) : location.pathname); } catch (_) { } }, 120); });
      const q0 = new URLSearchParams(location.search).get("q"); if (q0) { qi.value = q0; search(q0); }
    }
    if (data.canEdit) { const b = $("#hcEdit"); b.hidden = false; b.onclick = () => editorList(); }
    contactForm();
  }
  document.addEventListener("ma-me", () => { if (PAGE === "help" && !data.canEdit && typeof me !== "undefined" && me) loadArticles(true).then(() => { drawCats(); if (data.canEdit) { const b = $("#hcEdit"); b.hidden = false; b.onclick = () => editorList(); } }); prefill(); });

  // ------------------------------------------------------------------ Contact support
  function prefill() { const u = typeof me !== "undefined" ? me : null; if (!u) return; const n = $("#ctName"), e = $("#ctEmail"); if (n && !n.value) n.value = u.name || ""; if (e && !e.value) e.value = u.email || ""; }
  function contactForm() {
    const f = $("#contactForm"); if (!f) return;
    prefill();
    f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const err = $("#ctErr"), btn = $("#ctSend"); err.textContent = "";
      const email = $("#ctEmail").value.trim(), msg = $("#ctMsg").value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = "Type your email, so we can answer you."; $("#ctEmail").focus(); return; }
      if (msg.length < 5) { err.textContent = "Tell us what's going on."; $("#ctMsg").focus(); return; }
      btn.disabled = true;
      try {
        const r = await api("POST", "/support", { name: $("#ctName").value, email, subject: $("#ctSubject").value || $("#ctApp").value, message: msg, app: $("#ctApp").value, platform: navigator.userAgent.slice(0, 120), website: $("#ctWebsite").value });
        $$("label, .hp, #ctSend", f).forEach((x) => (x.hidden = true));
        const d = $("#ctDone"); d.hidden = false;
        d.innerHTML = '<p class="ok-note" style="margin:0"><b>Sent.</b> ' + h(r.message || "We'll answer by email.") + "</p>" + (r.link ? '<p style="margin:.6rem 0 0"><a href="' + h(r.link.replace(/^https?:\/\/[^/]+/, "")) + '">Follow your ticket</a>: our answer shows there too, and you can answer us there.</p>' : "");
      } catch (e) { err.textContent = e.message; btn.disabled = false; }
    });
  }

  // ------------------------------------------------------------------ an article
  function blockHtml(b) {
    if (b.t === "h") return "<h2>" + h(b.text) + "</h2>";
    if (b.t === "p") return "<p>" + inline(b.text) + "</p>";
    if (b.t === "steps") return '<ol class="steps">' + b.items.map((x) => "<li>" + inline(x) + "</li>").join("") + "</ol>";
    if (b.t === "img") return '<img src="' + h(b.url) + '" alt="' + h(b.alt || "") + '" loading="lazy">';
    if (b.t === "video" && b.youtube) return '<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/' + h(b.youtube) + '" title="Video" allow="encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>';
    if (b.t === "video") return '<div class="video"><video src="' + h(b.url) + '" controls preload="metadata"></video></div>';
    return "";
  }
  async function articlePage() {
    const slug = new URLSearchParams(location.search).get("a") || location.hash.slice(1);
    let a;
    try { a = (await api("GET", "/help/articles/" + encodeURIComponent(slug))).article; } catch (e) { $("#artTitle").textContent = "We couldn't find that guide"; $("#artBody").innerHTML = '<p>' + h(e.message) + ' <a href="/help/">All guides</a>.</p>'; return; }
    document.title = a.title + " | Motion Audio Help Center";
    const md = document.querySelector('meta[name="description"]'); if (md && a.summary) md.setAttribute("content", a.summary);
    $("#artTitle").textContent = a.title; $("#artSum").textContent = a.summary || ""; $("#artCat").textContent = a.category;
    $("#artBody").innerHTML = a.body.map(blockHtml).join("") + (a.published === false ? '<p class="err">Not published: only editors see this.</p>' : "");
    const hp = $("#artHelp"); hp.hidden = false;
    hp.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-helpful]"); if (!b) return;
      $$("[data-helpful]", hp).forEach((x) => (x.disabled = true));
      try { await api("POST", "/help/articles/" + encodeURIComponent(a.slug) + "/helpful", { yes: b.dataset.helpful === "1" }); } catch (_) { }
      $("#artThanks").innerHTML = b.dataset.helpful === "1" ? "Thanks! Glad it helped." : 'Thanks for telling us. <a href="/help/#contact">Tell us what was missing</a> and we\'ll fix the guide.';
    });
    await loadArticles(true);
    if (data.canEdit) { $("#artEdit").innerHTML = '<p style="margin-top:1rem"><button class="btn ghost small" type="button" id="artEditBtn">Edit this guide</button></p><div id="hcEditor"></div>'; $("#artEditBtn").onclick = () => editArticle(a); }
  }
  document.addEventListener("ma-me", () => { if (PAGE === "help-article" && !$("#artEditBtn") && typeof me !== "undefined" && me) loadArticles(true).then(() => { if (data.canEdit && !$("#artEditBtn")) { const slug = new URLSearchParams(location.search).get("a"); api("GET", "/help/articles/" + encodeURIComponent(slug)).then((r) => { $("#artEdit").innerHTML = '<p style="margin-top:1rem"><button class="btn ghost small" type="button" id="artEditBtn">Edit this guide</button></p><div id="hcEditor"></div>'; $("#artEditBtn").onclick = () => editArticle(r.article); }).catch(() => { }); } }); });

  // ------------------------------------------------------------------ the editor (staff and the website's editors)
  function editorBox() { const el = $("#hcEditor"); el.hidden = false; el.scrollIntoView({ behavior: "smooth", block: "start" }); return el; }
  function editorList() {
    const el = editorBox();
    const list = data.articles.slice().sort((x, y) => (x.position || 0) - (y.position || 0) || x.id - y.id);
    el.innerHTML = '<div class="pg-head" style="margin:1.5rem 0 .8rem"><h3>Guides: write, edit, put in order</h3><p class="muted">Changes show on the website straight away. Use the arrows to put guides in order; the order shows within each category.</p></div>' +
      '<div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.8rem"><button class="btn small" type="button" id="edNew">New guide</button><button class="btn ghost small" type="button" id="edClose">Done</button></div>' +
      '<div class="ed-list">' + list.map((a, i) => '<div class="ed-art" data-id="' + a.id + '"><button class="btn small ghost" type="button" data-mv="-1" aria-label="Move up"' + (i ? "" : " disabled") + '>↑</button><button class="btn small ghost" type="button" data-mv="1" aria-label="Move down"' + (i < list.length - 1 ? "" : " disabled") + '>↓</button><span><b>' + h(a.title) + '</b> <span class="muted">· ' + h(a.category) + (a.published === false ? " · draft" : "") + '</span></span><a class="btn small ghost" href="' + artHref(a) + '">View</a><button class="btn small ghost" type="button" data-ed="' + a.id + '">Edit</button><button class="btn small ghost" type="button" data-del="' + a.id + '">Delete</button></div>').join("") + "</div><div class=\"err\" id=\"edErr\"></div>";
    $("#edClose").onclick = () => { el.hidden = true; };
    $("#edNew").onclick = () => editArticle({ title: "", category: data.categories[0], summary: "", body: [{ t: "p", text: "" }], published: true });
    el.onclick = async (e) => {
      const mv = e.target.closest("[data-mv]"), ed = e.target.closest("[data-ed]"), del = e.target.closest("[data-del]");
      if (mv) {
        const id = Number(mv.closest("[data-id]").dataset.id), ids = list.map((x) => x.id), i = ids.indexOf(id), j = i + Number(mv.dataset.mv);
        if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]];
        try { await api("POST", "/help/articles-order", { ids }); await loadArticles(true); drawCats(); editorList(); } catch (err) { $("#edErr").textContent = err.message; }
      }
      if (ed) { try { const a = list.find((x) => x.id === Number(ed.dataset.ed)); editArticle((await api("GET", "/help/articles/" + encodeURIComponent(a.slug))).article); } catch (err) { $("#edErr").textContent = err.message; } }
      if (del) {
        const a = list.find((x) => x.id === Number(del.dataset.del));
        if (!confirm("Delete “" + a.title + "”? It can't be brought back.")) return;
        try { await api("POST", "/help/articles/" + a.id + "/delete", {}); toast("Deleted."); await loadArticles(true); drawCats(); editorList(); } catch (err) { $("#edErr").textContent = err.message; }
      }
    };
  }
  const KIND = { h: "Heading", p: "Text", steps: "Steps (one per line)", img: "Picture", video: "Video" };
  function blockEditor(b, i, n) {
    const tools = '<div class="bar"><span>' + KIND[b.t] + '</span><button class="btn small ghost" type="button" data-bmv="-1"' + (i ? "" : " disabled") + ' aria-label="Move up">↑</button><button class="btn small ghost" type="button" data-bmv="1"' + (i < n - 1 ? "" : " disabled") + ' aria-label="Move down">↓</button><button class="btn small ghost" type="button" data-brm aria-label="Remove">✕</button></div>';
    let f = "";
    if (b.t === "h") f = '<input data-f="text" value="' + h(b.text || "") + '" placeholder="A heading">';
    if (b.t === "p") f = '<textarea data-f="text" rows="4" placeholder="Text. **bold** and [a link](https://…) work.">' + h(b.text || "") + "</textarea>";
    if (b.t === "steps") f = '<textarea data-f="items" rows="5" placeholder="One step per line">' + h((b.items || []).join("\n")) + "</textarea>";
    if (b.t === "img") f = (b.url ? '<img src="' + h(b.url) + '" alt="" style="max-width:240px;border-radius:6px">' : "") + '<div style="display:flex;gap:.4rem;flex-wrap:wrap;align-items:center"><button class="btn small ghost" type="button" data-pic>' + (b.url ? "Change picture" : "Choose a picture") + '</button><input data-f="url" value="' + h(b.url || "") + '" placeholder="/img/apps/… or uploaded" style="flex:1;min-width:12rem"></div><input data-f="alt" value="' + h(b.alt || "") + '" placeholder="What the picture shows (for people who can\'t see it)">';
    if (b.t === "video") f = '<input data-f="url" value="' + h(b.youtube ? "https://youtu.be/" + b.youtube : b.url || "") + '" placeholder="A YouTube link, or upload a video"><div style="display:flex;gap:.4rem;align-items:center"><button class="btn small ghost" type="button" data-vid>Upload a video (MP4, WebM, MOV)</button><span class="muted" data-vidp style="font-size:.85rem"></span></div>';
    return '<div class="ed-block" data-i="' + i + '">' + tools + f + "</div>";
  }
  function editArticle(a) {
    const el = editorBox(); let blocks = (a.body || []).map((b) => Object.assign({}, b));
    const read = () => { $$(".ed-block", el).forEach((d) => { const b = blocks[Number(d.dataset.i)]; $$("[data-f]", d).forEach((x) => { if (x.dataset.f === "items") b.items = x.value.split("\n").map((s) => s.trim()).filter(Boolean); else b[x.dataset.f] = x.value; }); if (b.t === "video") delete b.youtube; }); };
    const draw = () => {
      el.innerHTML = '<div class="pg-head" style="margin:1.5rem 0 .8rem"><h3>' + (a.id ? "Edit “" + h(a.title) + "”" : "A new guide") + '</h3></div><form id="edForm" class="contact" style="grid-template-columns:1fr" onsubmit="return false"><div style="display:grid;gap:.8rem;background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:1.2rem">' +
        '<label>Title<input id="edTitle" value="' + h(a.title) + '" required maxlength="160"></label>' +
        '<label>Category<select id="edCat">' + data.categories.map((c) => "<option" + (c === a.category ? " selected" : "") + ">" + h(c) + "</option>").join("") + "</select></label>" +
        '<label>Summary (one line, shown in lists and search)<input id="edSum" value="' + h(a.summary || "") + '" maxlength="400"></label>' +
        '<label style="display:flex;gap:.5rem;align-items:center;font-weight:400"><input type="checkbox" id="edPub"' + (a.published !== false ? " checked" : "") + ' style="width:auto;min-height:0"> Published (visitors can see it)</label>' +
        '<div class="ed-blocks" style="display:grid;gap:.6rem">' + blocks.map((b, i) => blockEditor(b, i, blocks.length)).join("") + "</div>" +
        '<div style="display:flex;gap:.4rem;flex-wrap:wrap"><span class="muted" style="align-self:center;font-size:.9rem">Add:</span>' + Object.keys(KIND).map((k) => '<button class="btn small ghost" type="button" data-add-block="' + k + '">' + KIND[k].split(" (")[0] + "</button>").join("") + "</div>" +
        '<div style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn" type="button" id="edSave">Save</button><button class="btn ghost" type="button" id="edCancel">Cancel</button></div><div class="err" id="edErr"></div></div></form>';
    };
    draw();
    el.onclick = async (e) => {
      const t = e.target;
      if (t.closest("[data-add-block]")) { read(); const k = t.closest("[data-add-block]").dataset.addBlock; blocks.push(k === "steps" ? { t: k, items: [] } : { t: k, text: "" }); draw(); return; }
      if (t.closest("[data-bmv]")) { read(); const i = Number(t.closest(".ed-block").dataset.i), j = i + Number(t.closest("[data-bmv]").dataset.bmv); [blocks[i], blocks[j]] = [blocks[j], blocks[i]]; draw(); return; }
      if (t.closest("[data-brm]")) { read(); blocks.splice(Number(t.closest(".ed-block").dataset.i), 1); draw(); return; }
      if (t.closest("[data-pic]")) {
        read(); const i = Number(t.closest(".ed-block").dataset.i), inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/png,image/jpeg,image/webp,image/gif";
        inp.onchange = () => { const file = inp.files[0]; if (!file) return; const rd = new FileReader(); rd.onload = async () => { try { const r = await api("POST", "/admin/content/image", { name: file.name, data: rd.result }); blocks[i].url = r.url; if (!blocks[i].alt) blocks[i].alt = file.name.replace(/\.\w+$/, ""); draw(); } catch (err) { $("#edErr").textContent = err.message; } }; rd.readAsDataURL(file); };
        inp.click(); return;
      }
      if (t.closest("[data-vid]")) {
        read(); const box = t.closest(".ed-block"), i = Number(box.dataset.i), inp = document.createElement("input"); inp.type = "file"; inp.accept = "video/mp4,video/webm,video/quicktime,video/x-m4v";
        inp.onchange = async () => {
          const file = inp.files[0]; if (!file) return; const p = $("[data-vidp]", box);
          try {
            const u = await api("POST", "/help/media/video", { type: file.type, size: file.size, name: file.name });
            await new Promise((ok, bad) => { const x = new XMLHttpRequest(); x.open("PUT", u.uploadUrl); x.setRequestHeader("Content-Type", file.type); x.upload.onprogress = (ev) => { if (ev.lengthComputable) p.textContent = "Uploading " + Math.round((ev.loaded / ev.total) * 100) + "%"; }; x.onload = () => (x.status < 300 ? ok() : bad(new Error("The upload didn't finish (" + x.status + ")."))); x.onerror = () => bad(new Error("The upload didn't finish. Check your connection.")); x.send(file); });
            blocks[i].url = u.url; draw();
          } catch (err) { p.textContent = ""; $("#edErr").textContent = err.message; }
        };
        inp.click(); return;
      }
      if (t.closest("#edCancel")) { if (PAGE === "help") editorList(); else el.innerHTML = ""; return; }
      if (t.closest("#edSave")) {
        read();
        const body = { id: a.id, slug: a.slug, title: $("#edTitle").value.trim(), category: $("#edCat").value, summary: $("#edSum").value.trim(), published: $("#edPub").checked, body: blocks };
        if (!body.title) { $("#edErr").textContent = "Give the guide a title."; return; }
        try {
          const r = await api("POST", "/help/articles", body); toast("Saved.");
          if (PAGE === "help-article") { location.href = artHref(r.article); return; }
          await loadArticles(true); drawCats(); editorList();
        } catch (err) { $("#edErr").textContent = err.message; }
      }
    };
  }

  // ------------------------------------------------------------------ a ticket
  async function ticketPage() {
    const tok = location.hash.slice(1), body = $("#tkBody");
    if (!/^[\w-]{20,40}$/.test(tok)) { body.innerHTML = '<p>This page needs the link from our email. <a href="/#account-help">Your tickets</a> are under Account → Help &amp; tickets.</p>'; return; }
    let t;
    try { t = (await api("GET", "/support/ticket/" + encodeURIComponent(tok))).ticket; } catch (e) { body.innerHTML = '<p class="err">' + h(e.message) + '</p><p><a href="/help/#contact">Contact support</a></p>'; return; }
    const when = (d) => new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const STATUS = { open: "Open: we'll answer soon", waiting: "Waiting for you", closed: "Closed" };
    $("#tkTitle").textContent = t.subject || "Your ticket"; $("#tkSub").innerHTML = '<span class="tstat ' + h(t.status) + '">' + h(STATUS[t.status] || t.status) + "</span> · ticket #" + t.id;
    body.innerHTML = '<div class="msg"><small>' + h(t.name || "You") + " · " + when(t.created) + "</small>" + h(t.message) + "</div>" +
      t.replies.map((r) => '<div class="msg' + (r.from_staff ? " staff" : "") + '"><small>' + h(r.from_staff ? (r.author || "Motion Audio support") + " · Motion Audio" : r.author || "You") + " · " + when(r.created_at) + "</small>" + h(r.message) + "</div>").join("") +
      '<form id="tkForm" class="contact" style="grid-template-columns:1fr" onsubmit="return false"><div style="display:grid;gap:.6rem;background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:1rem"><label>' + (t.status === "closed" ? "Write again (this opens the ticket again)" : "Your answer") + '<textarea id="tkMsg" rows="4" required></textarea></label><div style="display:flex;gap:.5rem;align-items:center"><button class="btn" id="tkSend" type="button">Send</button><span class="err" id="tkErr"></span></div></div></form>';
    $("#tkSend").onclick = async () => {
      const m = $("#tkMsg").value.trim(); if (m.length < 2) { $("#tkErr").textContent = "Write your answer first."; return; }
      $("#tkSend").disabled = true;
      try { await api("POST", "/support/ticket/" + encodeURIComponent(tok) + "/reply", { message: m }); toast("Sent. We'll answer by email and here."); ticketPage(); } catch (e) { $("#tkErr").textContent = e.message; $("#tkSend").disabled = false; }
    };
  }

  if (PAGE === "help") helpPage();
  else if (PAGE === "help-article") articlePage();
  else if (PAGE === "help-ticket") { ticketPage(); addEventListener("hashchange", ticketPage); }
  window.MAHelp = { search: (q) => search(q) };
})();
