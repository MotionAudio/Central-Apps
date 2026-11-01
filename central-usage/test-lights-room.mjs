// The room under Room & seats (app/lights-room-math.js) without a window: the usual room shapes, the seats laid out
// in them (counts, aisles, facing the stage, a balcony, curved rows), and the light on the seats (a house light over
// the audience lights the seats under it; a light on the stage only spills; nothing on = dark).
//   node test-lights-room.mjs
import { createRequire } from "node:module"; import assert from "node:assert";
const require = createRequire(import.meta.url), RM = require("./app/lights-room-math.js");
let failures = 0; async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e && e.message || e).split("\n").slice(0, 6).join("\n      ")); } }
const stage = { width: 10, depth: 6, deck: 0.6, room: 26, shape: "rect" };
const hall = (tpl, seats, extra) => Object.assign({}, RM.template(tpl, stage), { seats: Object.assign({ count: seats, sections: 3, aisle: 1.2, seatW: 0.55, rowD: 0.95, gap: 2 }, extra || {}) });

console.log("The room and its seats:");
await check("the four room shapes are closed outlines around the stage, with an area that makes sense", () => {
  for (const t of ["rect", "fan", "rounded", "wide"]) { const h = RM.template(t, stage), poly = RM.outline(h), a = RM.area(poly); assert.ok(poly.length >= 4 && a > 150 && a < 3000, t + " area " + a); assert.ok(RM.inside(poly, 0, 5), t + ": the middle of the room is inside"); assert.ok(!RM.inside(poly, 0, 200), t); }
  assert.ok(RM.outline(RM.template("rounded", stage)).length > 4, "a curved wall is broken into pieces");
});
await check("ask for 300 seats: exactly 300, all in front of the stage, inside the room and clear of its walls, facing the stage", () => {
  const h = hall("rect", 300), r = RM.layoutSeats(h, stage), poly = RM.outline(h);
  assert.equal(r.placed, 300); assert.equal(r.seats.length, 300); assert.ok(r.rows > 3);
  assert.ok(r.seats.every((s) => s.z > 1.5 && RM.inside(poly, s.x, s.z)), "inside and past the gap");
  assert.ok(r.seats.every((s) => Math.abs(Math.cos(s.yaw) + 1) < 0.01), "straight rows face the stage");
});
await check("aisles: with 3 sections no seat sits in the two aisles, and seats are in 3 sections", () => {
  const r = RM.layoutSeats(hall("rect", 400), stage); const secs = new Set(r.seats.map((s) => s.sec)); assert.equal(secs.size, 3);
  const xs = [...new Set(r.seats.filter((s) => s.row === 3).map((s) => +s.x.toFixed(2)))].sort((a, b) => a - b), gaps = xs.slice(1).map((v, i) => v - xs[i]);
  assert.equal(gaps.filter((g) => g > 1.0).length, 2, "two wide gaps in a row " + JSON.stringify(gaps.map((g) => +g.toFixed(2))));
});
await check("a fan-shaped room: curved rows, every seat turned towards the stage", () => {
  const r = RM.layoutSeats(hall("fan", 600), stage); assert.equal(r.placed, 600);
  const off = r.seats.filter((s) => { const toStage = Math.atan2(0 - s.x, -2.1 - s.z); return Math.abs(Math.atan2(Math.sin(s.yaw - toStage), Math.cos(s.yaw - toStage))) > 0.05; }); assert.equal(off.length, 0, off.length + " turned away");
  assert.ok(new Set(r.seats.map((s) => s.yaw.toFixed(2))).size > 10, "not all the same way");
});
await check("more seats than fit: it says how many fit; a balcony takes more, raised and stepped", () => {
  const a = RM.layoutSeats(hall("rect", 5000), stage); assert.ok(a.placed < 5000 && a.placed > 300, "fits " + a.placed);
  const h = hall("rect", 5000); h.balcony = { on: true, depth: 7, height: 4 }; const b = RM.layoutSeats(h, stage);
  const bal = b.seats.filter((s) => s.bal); assert.ok(b.placed > a.placed && bal.length > 50, a.placed + " -> " + b.placed);
  assert.ok(bal.every((s) => s.y >= 4) && new Set(bal.map((s) => s.y)).size > 2, "raised and stepped");
});
await check("rows asked for are kept to (4 rows → no 5th row)", () => { const r = RM.layoutSeats(hall("rect", 2000, { rows: 4 }), stage); assert.equal(r.rows, 4); assert.ok(Math.max(...r.seats.map((s) => s.row)) === 4); });

console.log("\nThe light on the seats:");
const r = RM.layoutSeats(hall("rect", 500), stage);
const L = (o) => Object.assign({ r: 1, g: 1, b: 1, k: 1, spread: 70, surf: "floor", t: 6 }, o);
await check("nothing on: every seat dark, and the summary says so", () => { const lv = RM.lightOnSeats(r.seats, [], stage), s = RM.summary(r.seats, lv); assert.equal(s.most, "dark"); assert.match(s.text, /dark everywhere/); });
await check("a house light over the middle of the room pointing down lights the seats under it far more than those at the side", () => {
  const lv = RM.lightOnSeats(r.seats, [L({ x: 0, y: 7, z: 6, dx: 0, dy: -1, dz: 0 })], stage);
  const near = r.seats.map((s, i) => [Math.hypot(s.x, s.z - 6), RM.lum(lv, i)]).sort((a, b) => a[0] - b[0]);
  assert.ok(near[0][1] > 0.2 && near[0][1] > near[near.length - 1][1] * 3, JSON.stringify([near[0], near[near.length - 1]]));
});
await check("a coloured light makes the seats that colour (blue house light: blue seats)", () => { const lv = RM.lightOnSeats(r.seats, [L({ x: 0, y: 7, z: 6, dx: 0, dy: -1, dz: 0, r: 0, g: 0.1, b: 1 })], stage); let i = 0; for (; i < r.seats.length; i++) if (lv[i * 3 + 2] > 0.1) break; assert.ok(lv[i * 3 + 2] > lv[i * 3] * 5); });
await check("a front light aimed at the stage only spills onto the seats (much less than a house light)", () => {
  const onStage = RM.lightOnSeats(r.seats, [L({ x: 0, y: 5.5, z: 2.5, dx: 0, dy: -0.6, dz: -0.8, spread: 25, surf: "deck", t: 6 })], stage), house = RM.lightOnSeats(r.seats, [L({ x: 0, y: 7, z: 6, dx: 0, dy: -1, dz: 0 })], stage);
  const a = RM.summary(r.seats, onStage).avg, b = RM.summary(r.seats, house).avg; assert.ok(a > 0 && a < b / 3, a + " vs " + b);
});
await check("the summary names the darkest part of the room (a light on the left: the right side is darkest)", () => {
  const lv = RM.lightOnSeats(r.seats, [L({ x: -8, y: 6, z: 8, dx: 0, dy: -1, dz: 0, spread: 90 })], stage), s = RM.summary(r.seats, lv);
  assert.match(s.darkest, /right/); assert.match(s.brightest, /left/); assert.match(s.text, /Most seats/);
});
await check("quick enough for 5,000 seats and 60 lights (under 60 ms)", () => {
  const big = RM.layoutSeats(Object.assign({}, RM.template("wide", Object.assign({}, stage, { width: 30, room: 60 })), { seats: { count: 5000 } }), Object.assign({}, stage, { width: 30, room: 60 }));
  const ems = Array.from({ length: 60 }, (_, i) => L({ x: -15 + i * 0.5, y: 6, z: (i % 6) * 4, dx: 0, dy: -1, dz: 0, spread: 30 })); const t0 = Date.now(); RM.lightOnSeats(big.seats, ems, stage); const ms = Date.now() - t0;
  assert.ok(big.placed > 3000 && ms < 60, big.placed + " seats in " + ms + " ms");
});
console.log(failures ? "\n" + failures + " FAILED" : "\nall passed"); process.exit(failures ? 1 : 0);
