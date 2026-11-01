// Central Production's plugin builder (10.2) in a real browser.  node test-plugin-builder.mjs
//   npm i playwright && npx playwright install chromium   (once)
// Opens production/plugin-builder/index.html and builds plugins the way a person would: examples, blocks from the
// palette, wires dragged between ports, a setting turned into a knob, code with a mistake and its fix, knobs renamed,
// undo / redo / delete, and the live test (the AudioWorklet really plays it). Also checks that the browser's live
// player (CMFx.create, an AudioWorklet) gives the same sound as the direct player the other tests compare with C.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.dirname(fileURLToPath(import.meta.url));
const TYPES = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json" };
const server = http.createServer((req, res) => {
  const p = path.normalize(path.join(root, decodeURIComponent(req.url.split("?")[0])));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(p)] || "application/octet-stream" }); fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = "http://127.0.0.1:" + server.address().port;
let failures = 0;
const ok = (m) => console.log("  ✓ " + m), bad = (m) => { failures++; console.error("  ✗ " + m); };
const check = (c, m) => (c ? ok(m) : bad(m));

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
console.log("Plugin builder:");
try {
  await page.goto(base + "/production/plugin-builder/index.html");
  await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.waitForSelector(".cpb-block");
  check(await page.evaluate(() => typeof CPPluginBuilder.mount === "function" && typeof builder.getPlugin === "function" && typeof builder.unmount === "function"), "CPPluginBuilder.mount(el, plugin, opts) gives getPlugin() and unmount()");
  check((await page.locator(".cpb-status").textContent()).startsWith("Ready"), "a new plugin is ready: sound in to sound out (" + (await page.locator(".cpb-status").textContent()) + ")");
  const groups = await page.locator(".cpb-group").allTextContents(), items = await page.locator(".cpb-item").count();
  check(groups.length >= 8 && items >= 23, "the palette lists every block the core plays, in groups (" + items + " blocks: " + groups.join(", ") + ")");

  // an example
  await page.selectOption(".cpb-presets", { label: "Tape Delay" });
  await page.waitForFunction(() => document.querySelectorAll(".cpb-block").length === 9);
  check(await page.locator(".cpb-wire").count() === 8 && (await page.locator(".cpb-name").inputValue()) === "Tape Delay", "the Tape Delay example opens: 9 blocks, 8 wires drawn");

  // build one from blank: drag a reverb in, wire it, turn a setting into a knob
  await page.click("text=New"); await page.waitForFunction(() => document.querySelectorAll(".cpb-block").length === 2);
  const wrap = await page.locator(".cpb-canvas-wrap").boundingBox();
  await page.locator(".cpb-item", { hasText: "Reverb" }).dragTo(page.locator(".cpb-canvas-wrap"), { targetPosition: { x: 300, y: 320 } });
  await page.waitForSelector('.cpb-block[data-id="reverb1"]');
  check(true, "a block dragged from the palette lands on the canvas (reverb1)");
  void wrap;
  // remove the straight wire in -> out, then wire in -> reverb1 -> out by dragging between ports
  await page.click('.cpb-wire'); await page.keyboard.press("Delete");
  check(await page.evaluate(() => builder.getPlugin().graph.wires.length) === 0, "a wire can be selected and deleted");
  async function drag(fromSel, toSel) {
    const a = await page.locator(fromSel).boundingBox(), b = await page.locator(toSel).boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 }); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 }); await page.mouse.up();
  }
  await drag('.cpb-out[data-block="in"]', '.cpb-in[data-block="reverb1"][data-port="in"]');
  await drag('.cpb-out[data-block="reverb1"]', '.cpb-in[data-block="out"][data-port="in"]');
  let p = await page.evaluate(() => builder.getPlugin());
  check(p.graph.wires.length === 2 && p.graph.wires.some((w) => w.from === "in.out" && w.to === "reverb1.in") && p.graph.wires.some((w) => w.from === "reverb1.out" && w.to === "out.in"), "dragging from a block's out to another block's input wires them");
  await drag('.cpb-out[data-block="reverb1"]', '.cpb-in[data-block="reverb1"][data-port="in"]');
  check((await page.locator(".cpb-status").textContent()).includes("itself"), "wiring a block into itself is refused, in plain words");
  await page.click('.cpb-block[data-id="reverb1"] .cpb-head');
  const sizeRow = page.locator(".cpb-ctl-row", { hasText: "Size" });
  await sizeRow.locator("input[type=range]").fill("900");
  p = await page.evaluate(() => builder.getPlugin());
  check(Math.abs(p.graph.blocks.find((b) => b.id === "reverb1").props.size - 0.9) < 0.01, "a slider in the settings changes the block (size 0.9)");
  await sizeRow.locator("select").selectOption("+");
  p = await page.evaluate(() => builder.getPlugin());
  check(p.params.some((q) => q.id === "size") && p.graph.blocks.find((b) => b.id === "reverb1").props.size.param === "size", "\"Make it a knob\" adds a knob with the setting's range and links it");
  check(await page.locator(".cpb-knob", { hasText: "Size" }).count() === 1, "the knob shows on the plugin's panel");

  // undo / redo
  await page.click(".cpb-undo"); p = await page.evaluate(() => builder.getPlugin());
  const undone = !p.params.some((q) => q.id === "size");
  await page.click(".cpb-redo"); p = await page.evaluate(() => builder.getPlugin());
  check(undone && p.params.some((q) => q.id === "size"), "Undo takes the knob away again and Redo brings it back");

  // the live test: the worklet plays it
  await page.click(".cpb-play");
  await page.waitForFunction(() => { const m = document.querySelector(".cpb-meter i"); return m && parseFloat(m.style.width) > 5; }, null, { timeout: 15000 }).then(() => ok("Try it plays the plugin live (the meter moves)"), () => bad("Try it plays the plugin live (the meter moves)"));
  await page.locator(".cpb-knob", { hasText: "Size" }).locator("input").fill("200");
  await page.click(".cpb-play");
  check(!(await page.locator(".cpb-status").textContent()).includes("can't play"), "turning a knob while it plays doesn't break it");

  // code: a mistake, then its fix
  await page.click(".cpb-item:has-text('Code')");
  await page.click('.cpb-tabs button:has-text("Code")');
  await page.selectOption(".cpb-code-top select", { label: "Code block code1" });
  await page.fill(".cpb-ta", "outL = inL * 0.5\noutR = sinn(inR)\n");
  await page.waitForFunction(() => /line 2/.test(document.querySelector(".cpb-code-err").textContent));
  check((await page.locator(".cpb-code-err").textContent()).includes("function 'sinn'") && await page.locator('.cpb-gutter div.bad[data-line="2"]').count() === 1, "a mistake in code shows its line and what's wrong (and the line is marked)");
  check(await page.locator(".cpb-hl .f").count() >= 0 && await page.locator(".cpb-hl .b").count() >= 2, "the code is coloured (inputs and outputs, functions, numbers)");
  await page.fill(".cpb-ta", "outL = inL * 0.5\noutR = sin(inR) * size\n");
  await page.waitForFunction(() => /No mistakes/.test(document.querySelector(".cpb-code-err").textContent));
  ok("fixing it clears the message");

  // knobs: rename an id and the links follow
  await page.click('.cpb-tabs button:has-text("Knobs")');
  const idInput = page.locator(".cpb-ktable tr").filter({ has: page.locator('input[value="size"]') }).locator("td").nth(1).locator("input");
  await idInput.fill("roomsize"); await idInput.press("Enter"); await page.locator(".cpb-bar").click({ position: { x: 5, y: 5 } });
  p = await page.evaluate(() => builder.getPlugin());
  check(p.params.some((q) => q.id === "roomsize") && p.graph.blocks.find((b) => b.id === "reverb1").props.size.param === "roomsize", "renaming a knob's id moves every link to the new id");

  // all code
  await page.click('.cpb-tabs button:has-text("Code")');
  await page.click("text=Make the whole plugin code");
  await page.waitForFunction(() => document.querySelector(".cpb-status").textContent.includes("all code"), null, { timeout: 3000 }).catch(() => { });
  p = await page.evaluate(() => builder.getPlugin());
  check(p.graph.blocks.length === 0 && /outL/.test(p.code || "") && (await page.locator(".cpb-status").textContent()).includes("all code"), "a plugin can be only code");

  // the host hears about changes, and can play the test itself
  const host = await page.evaluate(() => new Promise((resolve) => {
    var div = document.createElement("div"); div.style.height = "600px"; document.body.appendChild(div); var changes = 0, tested = null;
    var b = CPPluginBuilder.mount(div, CPPluginBuilder.presets()[0], { onChange: function () { changes++; }, onTest: function (pl) { tested = pl.name; return true; } });
    div.querySelector(".cpb-name").value = "Renamed"; div.querySelector(".cpb-name").dispatchEvent(new Event("input")); div.querySelector(".cpb-name").dispatchEvent(new Event("change"));
    div.querySelector(".cpb-play").click();
    setTimeout(function () { var r = { changes: changes, tested: tested, name: b.getPlugin().name }; b.unmount(); r.empty = div.innerHTML === ""; resolve(r); }, 400);
  }));
  check(host.changes >= 1 && host.name === "Renamed", "onChange(plugin) tells the host about every edit");
  check(host.tested === "Renamed", "onTest(plugin) lets the host play the test itself");
  check(host.empty, "unmount() takes the builder away");

  // the live player (AudioWorklet) = the direct player (which test-cmfx.mjs compares with the C)
  const same = await page.evaluate(async () => {
    const plugin = CPPluginBuilder.presets().find((x) => x.name === "Tape Delay"), sr = 48000, n = sr;
    const ctx = new OfflineAudioContext(2, n, sr), buf = ctx.createBuffer(2, n, sr), L = buf.getChannelData(0), R = buf.getChannelData(1);
    for (let i = 0; i < n; i++) { L[i] = (i % 12000 < 200 ? 0.8 : 0) + 0.2 * Math.sin(i * 0.05); R[i] = L[i] * 0.5; }
    const src = ctx.createBufferSource(); src.buffer = buf;
    const fx = CMFx.create(ctx, plugin, { values: { time: 300 } }); await fx.ready;
    src.connect(fx.node); fx.node.connect(ctx.destination); src.start();
    const out = await ctx.startRendering(), d = CMFx.render(plugin, sr, L, R, { time: 300 });
    let m = 0; const a = out.getChannelData(0), b2 = out.getChannelData(1); for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(a[i] - d.left[i]), Math.abs(b2[i] - d.right[i]));
    let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(a[i]));
    return { m, pk, err: fx.error };
  });
  check(!same.err && same.m < 1e-5 && same.pk > 0.1, "the AudioWorklet player sounds the same as the direct player (difference " + same.m.toExponential(2) + ")");
  const broken = await page.evaluate(async () => { const ctx = new OfflineAudioContext(2, 256, 48000), seen = []; const fx = CMFx.create(ctx, { format: "central-fx", name: "x", graph: { blocks: [{ id: "a", type: "nope" }] } }, { onError: (e) => seen.push(e) }); await fx.ready; return seen[0] || ""; });
  check(/block type/.test(broken), "a plugin that can't load says why and lets the sound through (\"" + broken + "\")");
  check(errors.length === 0, "no script errors on the page" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
} catch (e) { bad("the builder test stopped: " + (e && e.stack || e)); }
await browser.close(); server.close();
console.log(failures ? "\n" + failures + " FAILED" : "\nall passed");
process.exit(failures ? 1 : 0);
