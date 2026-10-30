// Sound libraries (9.8): one zip per sound plan (Central Keys, Central Instrument, Central Plugins, Central Pedals), built
// by the apps repository's CI (.github/workflows/libraries.yml) and kept at LIBRARIES_BASE_URL - today the GitHub release
// "libraries", later Cloudflare R2. Like the apps, anyone can download them; what's inside only opens with the plan's
// package key (the apps check it). GET /v1/libraries (no sign-in) lists them for the website's Downloads page and for the
// apps' Settings → Packages → Libraries: id, plan, title, version, size, sha256, url and what's inside.
//
// The list is the published libraries-index.json at LIBRARIES_BASE_URL (read again every 10 minutes). Until it is
// published, or when it can't be reached, the built-in list (libraries-builtin.json, from libraries/libraries.json) is
// shown instead: the same libraries with an estimated size and no sha256 ("ready: false" - the apps don't install those).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, PLANS, PLAN_IDS } from "./config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FRESH_MS = 10 * 60e3, RETRY_MS = 60e3;
let cache = { at: 0, ttl: 0, data: null, base: "" };

function builtin() {
  try { return JSON.parse(fs.readFileSync(path.join(here, "libraries-builtin.json"), "utf8")).libraries || []; } catch (_) { return []; }
}
const SHA = /^[0-9a-f]{64}$/;
const str = (v, n) => String(v == null ? "" : v).slice(0, n);
// a longer text cut at the last whole word, with an ellipsis (never mid-word)
const words = (v, n) => { const t = String(v == null ? "" : v); if (t.length <= n) return t; const cut = t.slice(0, n), sp = cut.lastIndexOf(" "); return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:(-]+$/, "") + "…"; };
const names = (a, n) => (Array.isArray(a) ? a : []).slice(0, n).map((x) => str(x, 80));
// one library as the website and the apps get it (only known fields, plain values: the index comes from outside)
function clean(e, base, own) {
  if (!e || typeof e !== "object" || !/^[a-z0-9-]{3,60}$/.test(e.id || "") || !PLAN_IDS.includes(e.plan)) return null;
  const file = /^[\w.-]{3,120}\.zip$/.test(e.file || "") ? e.file : e.id + "-" + str(e.version, 20) + ".zip";
  const url = !own && typeof e.url === "string" && /^https:\/\/[^\s"'<>]+$/.test(e.url) ? e.url : base + "/" + file;   // (the built-in list: at LIBRARIES_BASE_URL)
  const c = e.contents || {};
  const sha256 = SHA.test(e.sha256 || "") ? e.sha256 : null;
  return {
    id: e.id, plan: e.plan, planName: PLANS[e.plan].name, planCents: PLANS[e.plan].cents, title: str(e.title, 80) || PLANS[e.plan].name + " Library",
    version: /^\d+(\.\d+){0,3}$/.test(String(e.version || "")) ? String(e.version) : "1.0", summary: words(e.summary, 1200),
    file, size: Math.max(0, Math.round(Number(e.size) || 0)), approximate: !!e.approximate || !sha256, sha256, url, ready: !!sha256,
    contents: {
      sounds: (Array.isArray(c.sounds) ? c.sounds : []).slice(0, 40).map((s) => ({ name: str(s && s.name, 80), presets: names(s && s.presets, 200), license: str(s && s.license, 60) })),
      presets: names(c.presets, 200), boards: names(c.boards, 200), irs: names(c.irs, 200), pads: names(c.pads, 60), loops: names(c.loops, 60),
    },
    credits: names(e.credits, 20),
  };
}
function listFrom(raw, base, own) { return (Array.isArray(raw) ? raw : []).map((e) => clean(e, base, own)).filter(Boolean); }

// the list (cached): the published index, else the built-in list
export async function libraries() {
  const base = config.librariesBaseUrl;
  if (cache.data && cache.base === base && Date.now() - cache.at < cache.ttl) return cache.data;
  let data;
  try {
    const r = await fetch(base + "/libraries-index.json", { headers: { Accept: "application/json", "User-Agent": "motion-audio" }, signal: AbortSignal.timeout(6000), redirect: "follow" });
    if (!r.ok) throw new Error("index " + r.status);
    const j = await r.json();
    const list = listFrom(j && j.libraries, base);
    if (!list.length) throw new Error("an empty index");
    data = { source: "index", base, libraries: list };
    cache = { at: Date.now(), ttl: FRESH_MS, data, base };
  } catch (_) {
    data = { source: "built-in", base, libraries: listFrom(builtin(), base, true) };
    cache = { at: Date.now(), ttl: RETRY_MS, data, base };
  }
  return data;
}
export function forgetCache() { cache = { at: 0, ttl: 0, data: null, base: "" }; }

export function routes(api, { wrap }) {
  api.get("/libraries", wrap(async (req, res) => {
    const d = await libraries();
    res.set("Cache-Control", "public, max-age=120");
    res.json({ source: d.source, plans: Object.fromEntries(PLAN_IDS.map((id) => [id, { name: PLANS[id].name, cents: PLANS[id].cents }])), libraries: d.libraries });
  }));
}
