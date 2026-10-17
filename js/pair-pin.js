/* Central Control - the pairing PIN: 4 digits the person picks the first time the Central Control starts.
 * Every other device (Central Usage, phones, the remote, other Central Controls) pairs with it.
 * It is not the main admin's PIN - that one (in Central Usage) is for changing roles, and the two must differ.
 * Settings → Wi-Fi & devices can change it (devices already paired are asked for the new one). */
(function () {
  "use strict";
  var PP = window.PP, F = window.PPFeatures; if (!PP || !F) return;
  var esc = PP.escapeHtml;
  function $(s, r) { return (r || document).querySelector(s); }
  function bridge() { return window.__pedalBridge; }
  function connected() { return !!(bridge() && bridge().connected); }
  var info = null, waiting = null;

  function dialog(first) {
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
    d.innerHTML = '<h2>' + (first ? "Pick a pairing PIN" : "Change the pairing PIN") + '</h2>' +
      '<p class="muted">4 digits. Central Usage, phones, the remote and your other Central Controls use it to pair with this one. ' + (first ? "" : "Devices already paired will ask for the new PIN. ") + 'It is <b>not</b> the main admin\'s PIN (that one changes roles) - pick a different one.</p>' +
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
    if (!connected()) { $("#pinErr", d).textContent = "Not connected to the Central Control."; return; }
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
    if (m.codeChosen === false) dialog(true);
  });
  function render() {
    var sec = $("#pinSection"); if (!sec) return;
    var code = info && info.code;
    sec.innerHTML = '<h3>Pairing PIN</h3>' + (connected() && code ? '<p>Devices pair with this Central Control using <b class="code">' + esc(code) + '</b>.</p><p class="muted">Different from the main admin\'s PIN in Central Usage (that one changes roles).</p><button id="pinChange">Change the PIN…</button>' : '<p class="muted">Set on the Central Control itself.</p>');
    var b = $("#pinChange"); if (b) b.addEventListener("click", function () { dialog(false); });
  }
  render();
  window.PPPairPin = { open: function () { dialog(false); }, info: function () { return info; } };
})();
