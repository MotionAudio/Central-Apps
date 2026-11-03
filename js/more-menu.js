/* Central Pedal - "More ⋯" menus (10.2, docs/DESIGN-SYSTEM.md rule 2): the actions used less often sit in a small menu
 * beside the ones used every Sunday. Markup: <div class="more-wrap" id="…"><button class="more-btn">More ⋯</button>
 * <div class="more-pop" role="menu" hidden></div></div>. Buttons other scripts add later (with their own listeners)
 * are moved in with PPMore.adopt(menu, [selectors]); they keep their ids and listeners. */
(function () {
  "use strict";
  function $(s, r) { return (r || document).querySelector(s); }
  function close(wrap) { var pop = $(".more-pop", wrap), b = $(".more-btn", wrap); if (pop) pop.hidden = true; if (b) b.setAttribute("aria-expanded", "false"); }
  function closeAll(except) { document.querySelectorAll(".more-wrap").forEach(function (w) { if (w !== except) close(w); }); }
  document.addEventListener("click", function (e) {
    var btn = e.target.closest(".more-btn"), wrap = e.target.closest(".more-wrap");
    if (btn && wrap) { var pop = $(".more-pop", wrap), opening = pop.hidden; closeAll(wrap); pop.hidden = !opening; btn.setAttribute("aria-expanded", opening ? "true" : "false"); if (opening) { var first = $("button", pop); if (first) first.focus(); } return; }
    if (wrap && e.target.closest(".more-pop button")) { close(wrap); return; }   // (the item's own listener has run)
    if (!wrap) closeAll();
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeAll(); });
  // move buttons made by other scripts into a menu, now and whenever they appear
  function adopt(menuSel, sels) {
    function pull() {
      var pop = $(menuSel + " .more-pop"); if (!pop) return;
      sels.forEach(function (s) { var el = $(s); if (el && el.parentNode !== pop) { el.setAttribute("role", "menuitem"); pop.appendChild(el); } });
      var wrap = $(menuSel); if (wrap) wrap.hidden = !pop.children.length;
    }
    pull();
    var root = $(menuSel) && $(menuSel).parentNode;
    if (root && window.MutationObserver) new MutationObserver(pull).observe(root, { childList: true });
    document.addEventListener("DOMContentLoaded", pull);
  }
  function wire() { adopt("#trMore", ["#trPractice", "#trSplit"]); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire); else wire();
  window.PPMore = { adopt: adopt, closeAll: closeAll };
})();
