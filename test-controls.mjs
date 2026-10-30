// Controls you teach the apps (js/control-surface.js) and the colours (js/theme.js) - plain Node, no browser.
//   node test-controls.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const S = require("./js/control-surface.js");
const T = require("./js/theme.js");

let failed = 0;
async function check(name, fn) { try { await fn(); console.log("  ✓ " + name); } catch (e) { failed++; console.log("  ✗ " + name + "\n      " + String(e.message || e).split("\n").join("\n      ")); } }
const cc = (n, v, ch = 1, port = "nanoKONTROL2 MIDI 1") => S.parse([0xB0 | (ch - 1), n, v], port);

console.log("Controls you teach the app:");
await check("MIDI messages: note on / off (and note on at 0 = off), CC, program change, pitch wheel", () => {
  assert.deepEqual(S.parse([0x91, 60, 100], "X"), { msg: "note", channel: 2, number: 60, value: 100, port: "X" });
  assert.equal(S.parse([0x90, 60, 0]).msg, "noteoff"); assert.equal(S.parse([0x80, 60, 0]).msg, "noteoff");
  assert.equal(S.parse([0xB0, 7, 64]).msg, "cc"); assert.equal(S.parse([0xC3, 5]).channel, 4);
  assert.deepEqual(S.parse([0xE0, 0x7F, 0x7F]).value, 16383);
});
await check("a button: one press of a note, a CC (on high or on low - a footswitch that sends 0 when pressed) or a program change", () => {
  let L = S.learner("button"); assert.equal(L.prompt(), "Press it once.");
  let r = L.feed({ midi: S.parse([0x90, 36, 90], "FCB1010") }); assert.equal(r.state, "done");
  assert.deepEqual(r.spec, { kind: "button", midi: { msg: "note", number: 36, channel: 1, port: "FCB1010" } });
  L = S.learner("button"); r = L.feed({ midi: cc(64, 0) }); assert.equal(r.spec.midi.onHigh, false);
  assert.deepEqual(S.match(r.spec, cc(64, 0)), { event: "press" }); assert.deepEqual(S.match(r.spec, cc(64, 127)), { event: "release" });
  L = S.learner("button"); r = L.feed({ midi: S.parse([0xC0, 4], "") }); assert.deepEqual(S.match(r.spec, S.parse([0xC0, 4])), { event: "tap" });
  assert.equal(S.match(r.spec, S.parse([0xC0, 5])), null);
});
await check("a button can be a key on the computer's keyboard (Shift / Ctrl count; Shift on its own doesn't)", () => {
  const L = S.learner("button", { keys: true });
  assert.equal(L.feed({ key: { key: "Shift", code: "ShiftLeft", shiftKey: true } }).state, "wait");
  const r = L.feed({ key: { key: "n", code: "KeyN", ctrlKey: true } }); assert.equal(r.state, "done");
  assert.deepEqual(r.spec.key, { code: "KeyN", ctrl: true, shift: false, alt: false, meta: false });
  assert.deepEqual(S.matchKey(r.spec, { code: "KeyN", ctrlKey: true }, true), { event: "press" });
  assert.equal(S.matchKey(r.spec, { code: "KeyN" }, true), null, "without Ctrl it's another key");
  assert.deepEqual(S.matchKey(r.spec, { code: "KeyN" }, false), { event: "release" }, "letting go needs no Ctrl");
  assert.equal(S.keyLabel(r.spec.key), "Ctrl+N"); assert.equal(S.describe(r.spec), "Key Ctrl+N");
  assert.equal(S.learner("button").feed({ key: { key: "a", code: "KeyA" } }).state, "wait", "keys only when the app allows them");
});
await check("a knob: all the way left, then all the way right - the ends it reached become 0 and 1 (and it finishes by itself once it stays put)", async () => {
  const L = S.learner("knob", { stillMs: 30 }); assert.equal(L.step(), "left"); assert.match(L.prompt(), /all the way to the left/);
  const done = new Promise((res) => L.onAuto(function (r) { if (r.state === "next") { L.feed({ midi: cc(21, 40) }); L.feed({ midi: cc(21, 90) }); L.feed({ midi: cc(21, 118) }); } else res(r); }));
  assert.equal(L.feed({ midi: cc(21, 60) }).state, "moving"); L.feed({ midi: cc(22, 3) }); L.feed({ midi: cc(21, 12) }); L.feed({ midi: cc(21, 4) });
  const r = await done; assert.equal(r.state, "done");
  assert.deepEqual(r.spec.midi, { msg: "cc", number: 21, channel: 1, port: "nanoKONTROL2 MIDI 1", lo: 4, hi: 118 });
  assert.deepEqual(S.match(r.spec, cc(21, 4)), { value: 0 }); assert.deepEqual(S.match(r.spec, cc(21, 118)), { value: 1 }); assert.deepEqual(S.match(r.spec, cc(21, 127)), { value: 1 });
  assert.ok(Math.abs(S.match(r.spec, cc(21, 61)).value - 0.5) < 0.01); assert.equal(S.match(r.spec, cc(22, 61)), null, "another knob");
});
await check("a slider that sends 127 at the bottom works the right way round; a slider that hardly moved is asked to go further", () => {
  const L = S.learner("slider"); assert.equal(L.step(), "down");
  L.feed({ midi: cc(7, 127) }); assert.equal(L.next().state, "next"); assert.match(L.prompt(), /all the way up/);
  L.feed({ midi: cc(7, 120) }); const h = L.next(); assert.equal(h.state, "hint"); assert.match(h.text, /further/);
  L.feed({ midi: cc(7, 0) }); const r = L.next(); assert.equal(r.state, "done"); assert.equal(r.spec.midi.lo, 127); assert.equal(r.spec.midi.hi, 0);
  assert.deepEqual(S.match(r.spec, cc(7, 0)), { value: 1 }); assert.deepEqual(S.match(r.spec, cc(7, 127)), { value: 0 });
});
await check("several devices: a control only answers its own device (the Pi's long ALSA names and short ones are the same device); older controls still work", () => {
  const spec = { kind: "button", midi: { msg: "note", number: 60, channel: 1, port: "nanoKONTROL2:nanoKONTROL2 MIDI 1 20:0" } };
  assert.ok(S.match(spec, S.parse([0x90, 60, 99], "nanoKONTROL2 MIDI 1")));
  assert.equal(S.match(spec, S.parse([0x90, 60, 99], "Launchpad X")), null);
  assert.equal(S.match(spec, S.parse([0x91, 60, 99], "nanoKONTROL2 MIDI 1")), null, "another channel");
  const old = { kind: "knob", midi: { type: "cc", number: 1, channel: 0 } };
  assert.deepEqual(S.match(old, S.parse([0xB5, 1, 127], "Any")), { value: 1 });
});
await check("the controller's lights: a learned note / CC button gets its LED (once per change)", () => {
  const sent = []; S.setLedOut((port, data) => { sent.push([port, data]); return true; });
  const spec = { kind: "button", midi: { msg: "note", number: 41, channel: 2, port: "APC mini" } };
  S.feedback(spec, true, "x"); S.feedback(spec, true, "x"); S.feedback(spec, false, "x");
  assert.deepEqual(sent, [["APC mini", [0x91, 41, 127]], ["APC mini", [0x91, 41, 0]]]);
  assert.equal(S.feedbackData({ midi: { msg: "pc", number: 3 } }, true), null);
});

console.log("\nColours:");
await check("every preset gives every colour, readable text on the accent, and our Studio look is the first (the default)", () => {
  assert.equal(T.PRESETS[0].id, "studio");
  for (const p of T.PRESETS) {
    const t = T.derive(p.base, "control");
    for (const k of ["bg", "bg2", "panel", "panel2", "panel3", "line", "line2", "text", "muted", "dim", "accent", "accentHi", "accentText", "blue", "danger", "chord", "ok", "well", "top1", "good", "warn", "bad", "live", "meterLow", "meterMid", "meterHigh"]) assert.match(t[k], /^#[0-9a-f]{6}$/, p.id + " " + k);
    assert.ok(T.contrast(t.accent, t.accentText) >= 4.5, p.id + ": text on the accent " + T.contrast(t.accent, t.accentText).toFixed(1));
    assert.ok(T.contrast(t.bg, t.text) >= 7, p.id + ": text on the background");
  }
  const pd = T.derive(T.PRESETS[6].base, "pedal"); assert.equal(pd.bg, "#f2f5f8"); assert.equal(pd.playhead, "#000000"); assert.ok(pd.field && pd.meterMid);
});
await check("colour helpers", () => {
  assert.equal(T.hex("#ABC"), "#aabbcc"); assert.equal(T.hex("nope"), null); assert.equal(T.mix("#000000", "#ffffff", 0.5), "#808080");
  assert.equal(T.readableOn("#ffee00"), "#1a1408"); assert.equal(T.readableOn("#101010"), "#ffffff"); assert.ok(T.isLight("#f2f5f8") && !T.isLight("#111317"));
});

console.log(failed ? "\n" + failed + " CHECK(S) FAILED" : "\nALL CONTROLS AND COLOURS CHECKS PASSED");
process.exit(failed ? 1 : 0);
