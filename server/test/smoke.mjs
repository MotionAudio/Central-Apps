// End-to-end check against a running server: node test/smoke.mjs [baseUrl] [path/to/audio.wav]
import fs from "node:fs";
const base = process.argv[2] || "http://localhost:8080", wav = process.argv[3];
const j = async (method, path, body, tok) => { const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) process.exitCode = 1; };
const email = "pub" + Date.now() + "@test.dev";
const s = await j("POST", "/v1/signup", { email, password: "password123", name: "Pub" }); ok(s.body.token, "sign up");
const pub = s.body.token;
ok((await j("POST", "/v1/login", { email, password: "nope-nope" })).status === 401, "wrong password refused");
const up = await j("POST", "/v1/uploads", { name: "mix.wav", type: "audio/wav", size: fs.statSync(wav).size }, pub); ok(up.body.url, "upload link");
const put = await fetch(up.body.url, { method: "PUT", body: fs.readFileSync(wav), headers: { "Content-Type": "audio/wav" } }); ok(put.ok, "file uploaded");
ok((await j("POST", "/v1/publish", { title: "T", artist: "A", kind: "Pad", mix: { key: up.body.key, name: "mix.wav" } }, pub)).status === 400, "publish without rights refused");
const p = await j("POST", "/v1/publish", { title: "Smoke Pad", artist: "Pub", kind: "Pad", key: "E", bpm: 70, rights: true, mix: { key: up.body.key, name: "mix.wav" } }, pub);
ok(p.body.track && p.body.grade, "published · " + (p.body.grade ? p.body.grade.stars + "★ $" + p.body.track.price : JSON.stringify(p.body)));
const id = p.body.track && p.body.track.id;
const list = await j("GET", "/v1/tracks?q=smoke"); ok(list.body.tracks.some((t) => t.id === id), "listed in search");
const b = await j("POST", "/v1/signup", { email: "buyer" + Date.now() + "@test.dev", password: "password123" }); const buyer = b.body.token;
const add1 = await j("POST", "/v1/tracks/" + id + "/add", null, buyer); ok(add1.status === 402, "non-subscriber gets 402 (buy first)");
console.log("BUYER_EMAIL=" + (await j("GET", "/v1/me", null, buyer)).body.email + " TRACK=" + id);
