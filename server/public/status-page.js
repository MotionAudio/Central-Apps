// /status/ (10.3): each service up, slow or down, the last 24 hours in half-hour bars, and staff's incident notes.
// Staff post and resolve notes, and run the checks now, from here (and from Account → Staff).
/* global api, me, toast */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const h = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const WORD = { up: "Working", degraded: "Slow", down: "Down", off: "Not set up", none: "No checks yet" };
  const ago = (d) => { const m = Math.round((Date.now() - new Date(d)) / 60000); return m < 1 ? "just now" : m < 60 ? m + " min ago" : Math.round(m / 60) + " h ago"; };
  async function load() {
    let d;
    try { d = await api("GET", "/status"); } catch (e) { $("#stOverall").innerHTML = '<span class="dot"></span><span>We couldn\'t reach the status checks. ' + h(e.message) + "</span>"; return; }
    d.services.forEach((s) => { if (s.state === "unknown") s.state = "none"; s.name = s.label; });
    const live = d.services.filter((s) => s.state !== "off" && s.state !== "none");
    const worst = live.some((s) => s.state === "down") ? "down" : live.some((s) => s.state === "degraded") ? "degraded" : live.length ? "up" : "none";
    $("#stOverall").className = "overall s-" + worst;
    $("#stOverall").innerHTML = '<span class="dot"></span><span>' + (worst === "up" ? "Everything is working" : worst === "degraded" ? "Something is slow" : worst === "down" ? "Something is down" : "Waiting for the first checks") + "</span>";
    $("#stIncidents").innerHTML = (d.incidents || []).map((i) => ({ id: i.id, title: i.title, message: i.message, created: i.created_at, resolved: i.state === "resolved" })).map((i) => '<div class="incident' + (i.resolved ? " resolved" : "") + '"><b>' + h(i.title) + (i.resolved ? " · resolved" : "") + '</b><span class="muted" style="font-size:.85rem">' + new Date(i.created).toLocaleString() + "</span>" + (i.message ? "<p>" + h(i.message) + "</p>" : "") +
      (canStaff() && !i.resolved ?'<div><button class="btn small ghost" type="button" data-resolve="' + i.id + '">Mark resolved</button></div>' : "") + "</div>").join("");
    $("#stList").innerHTML = d.services.map((s) => '<div class="svc s-' + h(s.state) + '" data-svc="' + h(s.id) + '"><div class="svc-top"><span class="dot" aria-hidden="true"></span><b>' + h(s.name) + '</b><span class="st">' + h(WORD[s.state] || s.state) + (s.ms != null && s.state !== "off" ? ' <span class="muted" style="font-weight:400">· ' + s.ms + " ms</span>" : "") + "</span></div>" +
      (s.note ? '<p class="muted" style="font-size:.9rem;margin:0">' + h(s.note) + "</p>" : "") +
      '<div class="hist" role="img" aria-label="' + h(s.name) + ', the last 24 hours">' + s.history.map((b) => '<i class="bar-' + h(b || "none") + '" title="' + h(WORD[b || "none"]) + '"></i>').join("") + "</div>" +
      '<div class="hist-legend"><span>24 hours ago</span><span>' + (s.uptime != null ? s.uptime + "% working, 14 days" : "") + "</span><span>Now</span></div></div>").join("");
    $("#stWhen").textContent = d.checked ? "Last checked " + ago(d.checked) + ". Checked every " + (d.everyMin || 3) + " minutes." : "";
    staffTools();
  }
  const canStaff = () => typeof me !== "undefined" && me && me.admin;
  function staffTools() {
    const el = $("#stStaff"); if (!el) return;
    if (!canStaff()) { el.innerHTML = ""; return; }
    if (el.dataset.on) return; el.dataset.on = "1";
    el.innerHTML = '<div class="fact" style="margin-top:1.5rem;max-width:900px"><h3>Staff: post a note</h3><p class="muted">Tell people what\'s going on. It shows at the top of this page until you mark it resolved.</p>' +
      '<label>Title<input id="inTitle" maxlength="140" placeholder="Downloads are slow"></label><label>What\'s happening<textarea id="inMsg" rows="3"></textarea></label>' +
      '<div style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn small" type="button" id="inPost">Post the note</button><button class="btn small ghost" type="button" id="inCheck">Check everything now</button></div><div class="err" id="inErr"></div></div>';
    $("#inPost").onclick = async () => { try { await api("POST", "/admin/status/incident", { title: $("#inTitle").value, message: $("#inMsg").value }); $("#inTitle").value = $("#inMsg").value = ""; toast("Posted."); load(); } catch (e) { $("#inErr").textContent = e.message; } };
    $("#inCheck").onclick = async () => { try { await api("POST", "/admin/status/check", {}); toast("Checked."); load(); } catch (e) { $("#inErr").textContent = e.message; } };
  }
  document.addEventListener("click", async (e) => { const b = e.target.closest("[data-resolve]"); if (!b) return; try { await api("POST", "/admin/status/incident/" + b.dataset.resolve + "/resolve", {}); load(); } catch (err) { toast(err.message); } });
  document.addEventListener("ma-me", () => load());
  load(); setInterval(load, 60000);
})();
