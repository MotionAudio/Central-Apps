// (10.2) A Planning Center plan -> a run sheet draft (the order of service, with lengths and who's on), handed to
// pco.setRunSheetMaker. Run sheets live on the main admin's computer (Central Control's Service tab), so this only
// shapes the plan: the app turns it into a run sheet with each part's usual cues (runsheet-gen.js) when it imports.
//   { name, date, time, items: [{ kind, title, minutes, note, key, ccli }], team: { leader, speaker, tech: [] } }

const KIND_WORDS = [
  ["countdown", /count\s*down|pre[-\s]?service|walk[-\s]?in/i],
  ["welcome", /welcome|greeting|call to worship|opening/i],
  ["announcements", /announce|notices|news|bulletin/i],
  ["scripture", /scripture|reading|bible|psalm|gospel reading|lesson/i],
  ["prayer", /prayer|pray/i],
  ["offering", /offering|giving|tithe|offertory/i],
  ["video", /video|clip|film|media|bumper/i],
  ["sermon", /sermon|message|preach|teaching|homily|talk/i],
  ["communion", /communion|lord'?s supper|eucharist|table/i],
  ["baptism", /baptism|baptis/i],
  ["closing", /closing|benediction|dismissal|sending|send[-\s]?off|blessing/i]
];
function kindOf(item) {
  if (item.type === "song") return "song";
  if (item.type === "media") return "video";
  const t = String(item.title || "") + " " + String(item.description || "");
  for (const [kind, re] of KIND_WORDS) if (re.test(t)) return kind;
  return "other";
}
function hhmm(d) { return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }

export function runSheetFromPlan({ plan, items, team }) {
  plan = plan || {}; items = Array.isArray(items) ? items : []; team = Array.isArray(team) ? team : [];
  const at = plan.sortDate ? new Date(plan.sortDate) : null, ok = at && !isNaN(at);
  const out = [];
  for (const it of items.slice(0, 120)) {
    if (it.type === "header") continue;   // (a header is a heading in Planning Center, not a part of the service)
    if (it.position && it.position !== "during") continue;   // (pre- and post-service items aren't run)
    const kind = kindOf(it), mins = it.length > 0 ? Math.round(it.length / 60 * 100) / 100 : 0;
    out.push({ kind, title: String(it.title || "").slice(0, 120), minutes: mins, note: String(it.description || "").slice(0, 400), key: it.key || "", ccli: it.ccli || null });
  }
  const role = (re) => team.filter((p) => re.test(String(p.position || p.role || "") + " " + String(p.team || "")) && String(p.status || "").toUpperCase() !== "D").map((p) => String(p.name || "").trim()).filter(Boolean);
  const leader = role(/worship leader|leader|vocals? lead/i)[0] || "", speaker = role(/pastor|preach|speaker|teacher|minister/i)[0] || "";
  const tech = role(/tech|production|sound|audio|lights?|lighting|video|camera|slides|propresenter|media|stream|broadcast/i);
  return {
    name: [plan.serviceTypeName, plan.title].filter(Boolean).join(" · ") || plan.dates || "Planning Center plan",
    date: ok ? ymd(at) : "", time: ok ? hhmm(at) : "", plan: plan.id || null,
    items: out, team: { leader, speaker, tech: Array.from(new Set(tech)).slice(0, 12) }
  };
}
