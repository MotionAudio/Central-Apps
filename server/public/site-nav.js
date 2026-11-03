// The site's header (10.3): the Apps and Sounds menus, the Menu button on phones, and which page you're on.
(function () {
  "use strict";
  var nav = document.getElementById("siteNav"), tog = document.getElementById("navToggle");
  if (!nav) return;
  var dds = Array.prototype.slice.call(nav.querySelectorAll(".dd"));
  function close(except) { dds.forEach(function (d) { if (d !== except) { d.classList.remove("open"); d.querySelector(".dd-btn").setAttribute("aria-expanded", "false"); } }); }
  var fine = window.matchMedia && matchMedia("(hover: hover) and (min-width: 981px)").matches;
  dds.forEach(function (d) {
    var b = d.querySelector(".dd-btn"), t = 0;
    b.addEventListener("click", function (e) { e.stopPropagation(); var open = !d.classList.contains("open"); close(d); d.classList.toggle("open", open); b.setAttribute("aria-expanded", String(open)); });
    if (fine) {
      d.addEventListener("mouseenter", function () { clearTimeout(t); close(d); d.classList.add("open"); b.setAttribute("aria-expanded", "true"); });
      d.addEventListener("mouseleave", function () { t = setTimeout(function () { d.classList.remove("open"); b.setAttribute("aria-expanded", "false"); }, 160); });
    }
    d.addEventListener("keydown", function (e) {
      var links = Array.prototype.slice.call(d.querySelectorAll(".dd-panel a")), i = links.indexOf(document.activeElement);
      if (e.key === "ArrowDown") { e.preventDefault(); if (!d.classList.contains("open")) b.click(); (links[i + 1] || links[0]).focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); (links[i - 1] || links[links.length - 1]).focus(); }
      else if (e.key === "Escape") { close(); b.focus(); }
    });
  });
  document.addEventListener("click", function (e) { if (!e.target.closest(".dd")) close(); });
  if (tog) tog.addEventListener("click", function () { var open = !nav.classList.contains("open"); nav.classList.toggle("open", open); tog.setAttribute("aria-expanded", String(open)); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && nav.classList.contains("open")) { nav.classList.remove("open"); if (tog) { tog.setAttribute("aria-expanded", "false"); tog.focus(); } } });
  nav.addEventListener("click", function (e) { var a = e.target.closest("a"); if (a && nav.classList.contains("open")) { nav.classList.remove("open"); if (tog) tog.setAttribute("aria-expanded", "false"); } });
  // the page you're on
  var here = location.pathname.replace(/index\.html$/, "");
  Array.prototype.slice.call(nav.querySelectorAll(".nav-main a[href]")).forEach(function (a) {
    var h = a.getAttribute("href"); if (h.indexOf("#") > -1) return;
    if (h === here) { a.setAttribute("aria-current", "page"); var dd = a.closest(".dd"); if (dd) dd.querySelector(".dd-btn").classList.add("on"); }
    else if (h !== "/" && !a.closest(".dd") && here.indexOf(h) === 0) a.classList.add("on");
  });
})();
