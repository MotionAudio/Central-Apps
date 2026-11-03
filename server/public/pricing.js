// /pricing/ (10.3): "Which plan do I need?" - a few questions, and what fits, with prices from the server and a button
// that puts exactly that in the cart. Uses app.js's shop (cfg, cart, addPlan, addBundle, openCart).
(function () {
  "use strict";
  const form = document.getElementById("planHelper"), out = document.getElementById("helperAnswer");
  if (!form || !out) return;
  const PLAN_NAME = { keys: "Central Keys", instrument: "Central Instrument", pads: "Central Pads", plugins: "Central Plugins", pedals: "Central Pedals", utility: "Central Utility" };
  const usd = (c) => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
  const val = (n) => { const x = form.querySelector('[name="' + n + '"]:checked'); return x ? x.value : ""; };
  const vals = (n) => Array.prototype.map.call(form.querySelectorAll('[name="' + n + '"]:checked'), (x) => x.value);
  /* global cfg, addPlan, addBundle, openCart, cart, updateCartBtn, renderRack, toast, viewCart, planCart */
  function pick() {
    const c = typeof cfg !== "undefined" ? cfg : null;
    if (!c || !c.plans) return null;
    const team = val("for") === "team", need = vals("need"), size = Number(val("size")) || 8, have = val("have") === "yes";
    const sound = need.filter((x) => x !== "utility" && x !== "pads");
    const mainIds = Object.keys(c.plans).filter((id) => id !== "pads");
    let plans = [], why = [];
    if (!need.length) return { empty: true };
    if (team) {
      // a team: a bundle covers everyone with every plan (cheaper per person than plans one at a time)
      const sizes = Object.keys(c.planBundles || {}).map(Number).sort((a, b) => a - b), n = sizes.find((s) => s >= size) || sizes[sizes.length - 1];
      const r = { team, size, bundle: n, bundleCents: (c.planBundles || {})[n] || 0, pack: null, why };
      why.push("A church bundle gives each of " + n + " people a package key with every sound plan, Central Pads and Central Utility, for a year.");
      if (!have) { const p = size <= 6 ? "pack-lite" : size <= 12 ? "pack-regular" : size <= 20 ? "pack-plus" : "pack-ultra"; if (c.products && c.products[p] && !c.products[p].hidden) { r.pack = p; why.push("The " + c.products[p].name + " church pack has the apps for a team that size: Central Control, Central Usage, Central Pedal Control and Central Services slots."); } }
      return r;
    }
    if (need.includes("pads") && !sound.length) plans.push("pads");
    plans = plans.concat(sound);
    if (need.includes("utility")) plans.push("utility");
    const sum = plans.reduce((a, id) => a + (id === "pads" && sound.length ? 0 : (c.plans[id] || {}).cents || 0), 0);
    const every = mainIds.every((id) => plans.includes(id) || (id === "utility" && false));
    if (c.planAll && (sum >= c.planAll.cents || every)) { why.push("Those add up to " + usd(sum) + " a year. All plans is " + usd(c.planAll.cents) + " and has every sound plan, Central Pads and Central Utility."); return { all: true, cents: c.planAll.cents, why, team }; }
    if (sound.length) why.push("Every sound plan includes Central Pads, so the pad pedal is covered.");
    if (need.includes("pedals")) why.push("Central Pedals runs your guitar through pedals and real cabinets in Central Usage and on the pedal.");
    if (need.includes("utility")) why.push("Central Utility has the backgrounds, slide themes, clicks and lighting looks.");
    return { plans, cents: sum, why, team };
  }
  function draw() {
    form.querySelectorAll("[data-team]").forEach((f) => (f.hidden = val("for") !== "team"));
    const r = pick();
    if (!r) { out.innerHTML = '<p class="muted">Loading the prices…</p>'; return; }
    if (r.empty) { out.innerHTML = '<p class="muted">Pick what you play or run, and we\'ll show what fits.</p>'; return; }
    let head, items, btn;
    if (r.team) {
      head = "For your team of " + r.size + (r.size >= 20 ? "+" : "");
      items = (r.pack ? "<li><b>" + esc(cfg.products[r.pack].name) + " church pack</b>: " + usd(cfg.products[r.pack].cents) + ", once</li>" : "") + "<li><b>Sound plans for " + r.bundle + " people</b>: " + usd(r.bundleCents) + " a year (" + usd(Math.round(r.bundleCents / r.bundle)) + " a person)</li>";
      btn = '<button class="btn" type="button" id="helperAdd">Add ' + (r.pack ? "both" : "it") + " to cart</button>";
    } else if (r.all) {
      head = "All plans"; items = "<li><b>All plans</b>: " + usd(r.cents) + " a year, one package key</li>"; btn = '<button class="btn" type="button" id="helperAdd">Add All plans to cart</button>';
    } else {
      head = r.plans.map((id) => PLAN_NAME[id] || id).join(" + ");
      items = r.plans.map((id) => "<li><b>" + esc(PLAN_NAME[id] || id) + "</b>: " + (id === "pads" && r.plans.some((x) => x !== "pads" && x !== "utility") ? "included" : usd(cfg.plans[id].cents) + " a year") + ' · <a href="/sounds/' + id + '/">hear it</a></li>').join("");
      btn = '<button class="btn" type="button" id="helperAdd">Add ' + (r.plans.length > 1 ? "them" : "it") + " to cart</button>";
    }
    out.innerHTML = '<span class="label">What fits</span><h3>' + esc(head) + "</h3><ul>" + items + "</ul>" + r.why.map((w) => '<p class="muted" style="font-size:.93rem">' + esc(w) + "</p>").join("") + '<div style="display:flex;gap:.5rem;flex-wrap:wrap">' + btn + '<a class="btn ghost" href="#plans">See every plan</a></div>';
    document.getElementById("helperAdd").onclick = () => {
      if (r.team) { if (r.pack && !cart[r.pack]) { cart[r.pack] = 1; updateCartBtn(); renderRack(); } addBundle(String(r.bundle), true); }
      else if (r.all) addPlan("all", true);
      else r.plans.forEach((id) => { if (!(id === "pads" && r.plans.some((x) => x !== "pads" && x !== "utility"))) addPlan(id, true); });
      openCart();
    };
  }
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  form.addEventListener("change", draw);
  window.onShopRender = draw;   // (app.js calls it when the prices arrive or the cart changes)
  draw();
})();
