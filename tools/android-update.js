/* Updates for the Android apps (Central Usage, Central Pedal Control, Central Services), installed from the APK on the
 * download page. Every time the app opens it looks at the GitHub releases (window.APP_UPDATE, written by
 * tools/add-android-update.js when the APK is built). A newer APK found: after a 10-second notice the app opens its
 * download, and Android shows "Update" - Android only lets a person install an app, so that one tap is theirs.
 * The new APK is signed with the same key and has the same app id, so Android keeps everything the app saved: songs,
 * setlists, settings, the license key and the sign-in. ("Not now" skips it until the app opens again.)
 * iPhone and iPad apps update from the App Store, so this does nothing there (or in a browser).
 * AppUpdate.gate(fn): runs fn once the look is done (at most 5 s) and nobody is updating - Central Usage's start
 * screen waits on it before it opens the main admin's page. */
(function () {
  "use strict";
  var cfg = window.APP_UPDATE || {};
  var cap = window.Capacitor, android = !!(cap && cap.getPlatform && cap.getPlatform() === "android");
  var waiting = [], settled = false, found = null;

  function nums(v) { var n = String(v || "").match(/\d+/g) || []; return [0, 1, 2].map(function (i) { return Number(n[i] || 0); }); }
  function newer(a, b) { var x = nums(a), y = nums(b); for (var i = 0; i < 3; i++) { if (x[i] !== y[i]) return x[i] > y[i]; } return false; }
  function settle() { if (settled) return; settled = true; var w = waiting; waiting = []; w.forEach(function (fn) { try { fn(); } catch (_) { } }); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  // the newest APK of this app in the last releases
  function look() {
    var re = new RegExp(cfg.asset), ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, 8000);
    return fetch("https://api.github.com/repos/" + cfg.repo + "/releases?per_page=10", { cache: "no-store", signal: ctl.signal, headers: { Accept: "application/vnd.github+json" } })
      .then(function (r) { clearTimeout(t); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (list) {
        var best = null;
        (list || []).forEach(function (rel) {
          if (rel.draft || rel.prerelease) return;
          (rel.assets || []).forEach(function (a) { var m = re.exec(a.name); if (m && (!best || newer(m[1], best.version))) best = { version: m[1], url: a.browser_download_url, notes: rel.body || "" }; });
        });
        return best && newer(best.version, cfg.version) ? best : null;
      });
  }

  function show(u) {
    var box = document.createElement("div"), left = 10, timer = null;
    box.id = "appUpdate";
    box.setAttribute("role", "dialog");
    box.style.cssText = "position:fixed;inset:0;z-index:99999;display:grid;place-items:center;background:rgba(5,10,20,.72);font:15px/1.45 system-ui,-apple-system,sans-serif;padding:16px";
    function paint(started) {
      box.innerHTML = '<div style="background:#111a2b;color:#e8eefc;border:1px solid #2a3a58;border-radius:14px;padding:18px;max-width:420px;width:100%;display:grid;gap:10px">' +
        '<b style="font-size:1.1rem">' + esc(cfg.name) + " " + esc(u.version) + " is ready</b>" +
        (started ? "<span>The download is opening. When it finishes, tap <b>Update</b> (or <b>Install</b>). Your songs, setlists, settings and key stay.</span>"
          : "<span>Updating in <b>" + left + " s</b> (this one is " + esc(cfg.version) + "). Your songs, setlists, settings and key stay.</span>") +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' + (started ? '<button data-u="go" style="' + btn(true) + '">Download again</button><button data-u="no" style="' + btn() + '">Done</button>'
          : '<button data-u="go" style="' + btn(true) + '">Update now</button><button data-u="no" style="' + btn() + '">Not now</button>') + "</div></div>";
    }
    function btn(primary) { return "font:inherit;border-radius:10px;padding:9px 14px;border:1px solid #2a3a58;" + (primary ? "background:#4f8cff;color:#fff;border-color:#4f8cff" : "background:transparent;color:#e8eefc"); }
    function go() { clearInterval(timer); paint(true); try { location.href = u.url; } catch (_) { } }   // Android opens it in the browser, which downloads it
    function close() { clearInterval(timer); box.remove(); settle(); }
    box.addEventListener("click", function (e) { var b = e.target.closest("[data-u]"); if (!b) return; if (b.dataset.u === "go") go(); else close(); });
    paint(false); document.body.appendChild(box);
    timer = setInterval(function () { left--; if (left <= 0) go(); else paint(false); }, 1000);
  }

  window.AppUpdate = {
    gate: function (fn) { if (settled) fn(); else waiting.push(fn); },
    get found() { return found; },
    newer: newer,
  };
  if (!android || !cfg.version || !cfg.repo || !cfg.asset) { settle(); return; }
  var cap5 = setTimeout(settle, 5000);   // no answer in 5 s (no internet yet): the app goes on, and looks again next time
  function start() {
    look().then(function (u) {
      clearTimeout(cap5); found = u;
      if (!u) return settle();
      if (document.body) show(u); else document.addEventListener("DOMContentLoaded", function () { show(u); });
    }).catch(function () { clearTimeout(cap5); settle(); });
  }
  start();
})();
