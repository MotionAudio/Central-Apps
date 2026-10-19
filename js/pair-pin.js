/* Central Pedal - the pairing PIN: the main admin's 4 digits, typed the first time the Central Pedal starts.
 * The main admin's Central Control is the center: every device pairs with it, this Central Pedal too (driver: CenterLink).
 * Once paired, every Central Control is told where the Central Pedal is (songs, charts, lyrics, tracks) and connects
 * to it with the same PIN.
 * It is not the main admin's PIN - that one (in Central Control) is for changing roles, and the two must differ.
 * Settings → Wi-Fi & devices can change it (devices already paired are asked for the new one). */
(function () {
  "use strict";
  var PP = window.PP, F = window.PPFeatures; if (!PP || !F) return;
  var esc = PP.escapeHtml;
  function $(s, r) { return (r || document).querySelector(s); }
  function bridge() { return window.__pedalBridge; }
  function connected() { return !!(bridge() && bridge().connected); }
  var info = null, waiting = null, shownErr = "";

  function dialog(first, err) {
    var d = $("#pinDialog");
    if (!d) {
      d = document.createElement("dialog"); d.id = "pinDialog"; d.className = "pin-dialog";
      document.body.appendChild(d);
      // the first time it can't be skipped (Escape or a back gesture brings it straight back)
      d.addEventListener("cancel", function (e) { if (d.dataset.first === "1") e.preventDefault(); });
      d.addEventListener("close", function () { if (d.dataset.first === "1") setTimeout(function () { if (!d.open && d.dataset.first === "1") d.showModal(); }, 0); });
      d.addEventListener("click", function (e) {
        var k = e.target.closest("[data-pk]"); if (!k) return;
        var v = k.dataset.pk, box = $("#pinValue", d);
        if (v === "ok") { submit(); return; }
        if (v === "cancel") { d.close(); return; }
        if (v === "del") box.value = box.value.slice(0, -1);
        else if (box.value.length < 4) box.value += v;
        $("#pinErr", d).textContent = "";
        paintDots();
      });
      d.addEventListener("input", function (e) { if (e.target.id === "pinValue") { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 4); paintDots(); } });
      d.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); submit(); } });
    }
    d.dataset.first = first ? "1" : "0";
    d.innerHTML = '<h2>' + (first ? "Pair this Central Pedal" : err ? "Pair with the main admin" : "Change the pairing PIN") + '</h2>' +
      (first ? '<p class="muted">Type your <b>main admin\'s pairing PIN</b> - the 4 digits picked when the main admin was set up (main admin → Settings → This computer). This Central Pedal pairs with the main admin\'s computer, and every device gets its songs, charts, lyrics and tracks.</p><p class="muted small">No main admin yet? Pick the PIN here and set the main admin up with the same 4 digits.</p>'
        : err ? '<p class="muted">' + esc(err) + '</p><p class="muted small">The pairing PIN is in Central Control on the main admin\'s computer: Settings → This computer.</p>'
        : '<p class="muted">4 digits. Devices paired now and online switch over by themselves; the others ask for it. It is <b>not</b> the main admin\'s role PIN - pick a different one.</p>') +
      '<input id="pinValue" class="pin-value" inputmode="numeric" autocomplete="off" maxlength="4" aria-label="Pairing PIN"><div class="pin-dots" id="pinDots"></div>' +
      '<div class="pin-pad">' + ["1", "2", "3", "4", "5", "6", "7", "8", "9", "del", "0", "ok"].map(function (k) { return '<button data-pk="' + k + '" class="' + (k === "ok" ? "primary" : "") + '">' + (k === "del" ? "⌫" : k === "ok" ? "Save" : k) + "</button>"; }).join("") + "</div>" +
      '<p class="warn" id="pinErr"></p>' + (first ? "" : '<div class="row"><button data-pk="cancel">Cancel</button></div>');
    if (!d.open) d.showModal();
    setTimeout(function () { var i = $("#pinValue", d); if (i) i.focus(); }, 50);
    paintDots();
    return d;
  }
  function paintDots() { var d = $("#pinDialog"), v = d ? $("#pinValue", d).value : ""; if (d) $("#pinDots", d).innerHTML = [0, 1, 2, 3].map(function (i) { return '<i class="' + (i < v.length ? "on" : "") + '"></i>'; }).join(""); }
  function submit() {
    var d = $("#pinDialog"); if (!d) return;
    var pin = $("#pinValue", d).value;
    if (!/^\d{4}$/.test(pin)) { $("#pinErr", d).textContent = "The PIN is 4 digits."; return; }
    if (!connected()) { $("#pinErr", d).textContent = "Not connected to the Central Pedal."; return; }
    waiting = pin; bridge().send({ type: "pairCode", pin: pin });
  }
  F.on("pairCodeReply", function (m) {
    var d = $("#pinDialog");
    if (!m.ok) { if (d) $("#pinErr", d).textContent = m.error || "Not saved."; return; }
    waiting = null; if (d) { d.dataset.first = "0"; d.close(); }
    PP.setStatus("Pairing PIN saved: " + m.code + (m.changed ? " - devices already paired will ask for it" : ""));
    if (info) { info.code = m.code; info.codeChosen = true; }
    render();
  });
  F.on("hello", function (m) {
    info = m; render();
    if (m.pedalControl) return;   // (Central Pedal Control: an editor, it does not pair with the main admin)
    var c = m.center || {};
    // the main admin refused the PIN (or unpaired this Central Pedal): ask for the right one
    if (m.codeChosen !== false && (c.state === "wrongPin" || c.state === "removed") && c.error !== shownErr) { shownErr = c.error; var dd = $("#pinDialog"); if (!dd || !dd.open) dialog(false, c.error); return; }
    if (c.state === "paired") { shownErr = ""; var dp = $("#pinDialog"); if (dp && dp.open && dp.dataset.first !== "1" && dp.querySelector("h2") && /main admin/.test(dp.querySelector("h2").textContent)) dp.close(); }
    if (m.codeChosen === false) { if (window.PPLicense) window.PPLicense.whenReady(function () { if (info && info.codeChosen === false) dialog(true); }); else dialog(true); }   // (after the license setup: the internet first)
    else { var d = $("#pinDialog"); if (d && d.open && d.dataset.first === "1") { d.dataset.first = "0"; d.close(); PP.setStatus("Paired: the main admin set the pairing PIN (" + m.code + ")"); } }
  });
  function render() {
    var sec = $("#pinSection"); if (!sec) return;
    var code = info && info.code, c = (info && info.center) || {};
    var st = { paired: "✓ paired with the main admin" + (c.name ? " <b>" + esc(c.name) + "</b>" : "") + (c.address ? " (" + esc(c.address) + ")" : ""), connecting: "connecting to the main admin…", searching: "looking for the main admin's computer on this network…", wrongPin: "⚠ " + esc(c.error || "the main admin did not accept the PIN"), needPin: "type the main admin's pairing PIN", removed: "⚠ " + esc(c.error || "unpaired by the main admin") }[c.state] || "";
    sec.innerHTML = '<h3>Pairing PIN</h3>' + (connected() && code ? '<p>Pairing PIN <b class="code">' + esc(code) + '</b>' + (c.state === "paired" ? ' <span class="muted small">(set on the main admin - it changes here by itself)</span>' : "") + '</p>' +
      (st ? '<p class="small">Main admin: ' + st + "</p>" : "") +
      (window.PPPedalJob ? window.PPPedalJob.section() : "") +
      '<p class="muted">Different from the main admin\'s role PIN in Central Control (that one changes roles).</p><button id="pinChange">' + (c.state === "paired" ? "Type a different PIN…" : "Change the PIN…") + '</button>' : '<p class="muted">Set on the Central Pedal itself.</p>');
    var b = $("#pinChange"); if (b) b.addEventListener("click", function () { dialog(false); });
  }
  render();
  window.PPPairPin = { open: function () { dialog(false); }, info: function () { return info; } };
})();
