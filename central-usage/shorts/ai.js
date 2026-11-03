/* Shorts - the small AI model that comes with Central Control (Qwen2.5 0.5B through llama-server, the one the lights'
 * helper uses), asked two things: how strong a stretch of a sermon is as a short on its own, and a title and description
 * for each short. Its answers are held to a JSON shape. Without the model the plain rules in pick.js decide and the title
 * comes from the strongest line. */
"use strict";
const http = require("node:http");

function ask(port, system, user, schema, maxTokens) {
  const body = JSON.stringify({ messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: 0.2, max_tokens: maxTokens || 300, response_format: { type: "json_schema", json_schema: { name: "answer", schema } } });
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port, path: "/v1/chat/completions", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, (res) => {
      let s = ""; res.on("data", (c) => { s += c; });
      res.on("end", () => { try { const j = JSON.parse(s), c = j.choices[0]; if (c.finish_reason === "length") return resolve(null); resolve(JSON.parse((String(c.message.content).match(/\{[\s\S]*\}/) || ["null"])[0])); } catch (_) { resolve(null); } });
    });
    req.on("error", () => resolve(null)); req.setTimeout(90000, () => { req.destroy(); resolve(null); }); req.end(body);
  });
}

const RATE_SYS = "You help a church choose short video clips (30 to 60 seconds) from a sermon for social media. Rate how well a passage works ON ITS OWN for someone scrolling who never heard the rest: a clear, complete thought; a strong or quotable line; hope, challenge or a story's payoff. Low scores for announcements, logistics, passages that start mid-thought or need earlier context, or that trail off. Reply with JSON only.";
const RATE_SCHEMA = { type: "object", properties: { score: { type: "integer", minimum: 1, maximum: 10 }, line: { type: "string" } }, required: ["score"], additionalProperties: false };
/* candidates (pick.js) -> each gets .ai (0..1) and maybe .line (its best line); the score is blended */
async function rate(port, cands, onEach) {
  let done = 0;
  for (const c of cands) {
    const r = await ask(port, RATE_SYS, "Passage:\n\"" + String(c.text).slice(0, 1600) + "\"", RATE_SCHEMA, 120);
    if (r && typeof r.score === "number") { c.ai = Math.max(0, Math.min(1, (r.score - 1) / 9)); if (r.line) c.line = String(r.line).slice(0, 200); c.score = c.score * 0.45 + c.ai * 0.55; }
    if (onEach) onEach(++done, cands.length);
  }
  return cands;
}

const TITLE_SYS = "You write the title and description for a church's short vertical video (YouTube Shorts, Instagram Reels, TikTok, Facebook Reels). Title: under 70 characters, plain and honest, no clickbait, no emojis, no quotes around it. Description: one or two sentences inviting people to watch, under 220 characters. Up to 4 hashtags without spaces. Reply with JSON only.";
const TITLE_SCHEMA = { type: "object", properties: { title: { type: "string" }, description: { type: "string" }, hashtags: { type: "array", items: { type: "string" }, maxItems: 4 } }, required: ["title", "description"], additionalProperties: false };
/* examples: titles this church wrote or posted (learn.js) - the model writes in their style */
function fewShot(examples) {
  const ex = (examples || []).filter((e) => e && e.title).slice(-4);
  if (!ex.length) return "";
  return "\nTitles this church wrote for earlier shorts (match their style, length and tone, but don't copy them):\n" + ex.map((e) => "- " + String(e.title).slice(0, 90) + (e.before ? " (instead of: " + String(e.before).slice(0, 60) + ")" : "")).join("\n");
}
async function titles(port, clip, church, examples) {
  const what = clip.kind === "worship" ? "A moment of worship from the song \"" + (clip.song || "worship") + "\"" + (clip.text ? ", lyrics: \"" + clip.text.slice(0, 600) + "\"" : "") : "A sermon clip: \"" + String(clip.text || "").slice(0, 1400) + "\"";
  const r = await ask(port, TITLE_SYS, what + (church ? "\nChurch: " + church : "") + fewShot(examples), TITLE_SCHEMA, 260);
  return r && r.title ? { title: String(r.title).replace(/^["“]|["”]$/g, "").slice(0, 90), description: String(r.description || "").slice(0, 400), hashtags: (r.hashtags || []).map((h) => "#" + String(h).replace(/^#/, "").replace(/\s+/g, "")).slice(0, 4) } : null;
}

/* without the model: the strongest short sentence of the clip as its title */
function plainTitle(clip, church) {
  if (clip.kind === "worship") return { title: (clip.song || "Worship") + (clip.label ? " (" + clip.label.toLowerCase() + ")" : "") + " - live", description: "Worship" + (church ? " at " + church : "") + ".", hashtags: ["#worship", "#church"] };
  const sents = String(clip.line || clip.text || "").split(/(?<=[.?!])\s+/).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 4);
  const best = sents.sort((a, b) => Math.abs(a.split(/\s+/).length - 10) - Math.abs(b.split(/\s+/).length - 10))[0] || "From Sunday's message";
  return { title: best.length > 80 ? best.slice(0, 77).replace(/\s+\S*$/, "") + "…" : best, description: "From Sunday's message" + (church ? " at " + church : "") + ".", hashtags: ["#sermon", "#church"] };
}

module.exports = { ask, rate, titles, plainTitle, fewShot };
