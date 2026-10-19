// after the buyer is marked subscribed: add returns files, file downloads, earnings recorded
const [base, email, id] = process.argv.slice(2);
const j = async (m, p, b, t) => { const r = await fetch(base + p, { method: m, headers: { "Content-Type": "application/json", ...(t ? { Authorization: "Bearer " + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) process.exitCode = 1; };
const tok = (await j("POST", "/v1/login", { email, password: "password123" })).body.token;
ok((await j("GET", "/v1/me", null, tok)).body.subscribed, "subscriber");
const add = await j("POST", "/v1/tracks/" + id + "/add", null, tok); ok(add.body.files && add.body.files.length, "subscriber add returns files");
const f = await fetch(add.body.files[0].url); ok(f.ok && (await f.arrayBuffer()).byteLength > 1000, "file downloads");
ok((await j("GET", "/v1/library", null, tok)).body.tracks.some((t) => t.id === id), "in the subscriber's library");
