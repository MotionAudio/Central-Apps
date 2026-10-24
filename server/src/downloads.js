// Your downloads (9.5): for each app you have a key for, where to download it, how to install it on your computer or
// phone, and the key; a built pedal (where it ships, and its phone setup); your sound plan package keys. The website
// shows it (#downloads) and a "Just me" buyer gets the same by email after paying.
import { q, one } from "./db.js";
import { config, PLANS, PLAN_IDS, RENEWAL } from "./config.js";
import { sendMail, escHtml } from "./mail.js";
import { keyState, packageRows, pretty as prettyPackage } from "./plans.js";
import { fmt } from "./versions.js";

const APPS_URL = "https://motionaudio.github.io/Central-Apps/";
const INSTALL = "/help/install.html";
const pretty = (k) => { const c = String(k || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); return c.length === 16 ? c.match(/.{4}/g).join("-") : String(k); };
// how to install each app (the words of help/install.html, short)
const APPS = {
  A: { name: "Central Control", icon: "central-control", anchor: "control", linux: "control", runsOn: "Windows, Mac and Linux", androidOk: false,
    phone: null, devices: "one computer" },
  U: { name: "Central Usage", icon: "central-usage", anchor: "usage", linux: "usage", runsOn: "Windows, Mac, Linux and Android", androidOk: true,
    phone: "iPhone and iPad: in Safari, from the main admin's computer - on the church Wi-Fi open http://<main admin's address>:8095/cu/, then Share → Add to Home Screen.", devices: "two devices" },
  P: { name: "Central Pedal Control", icon: "central-pedal-control", anchor: "pedal-control", linux: "pedal-control", runsOn: "Windows, Mac, Linux and Android", androidOk: true,
    phone: "iPad: on the pedal's Wi-Fi open http://padpedal.local:8080/control/ in Safari, then Share → Add to Home Screen.", devices: "two devices" },
};
function steps(a) {
  const out = {
    windows: ["Download the .exe from the download page (Windows 10 or 11, 64-bit).", "Open it. Windows says \"Windows protected your PC\": click More info, then Run anyway. It installs and opens by itself."],
    mac: ["Download the .dmg for your Mac (Apple Silicon for M1 and newer, Intel for older Macs), open it and drag the app into Applications.", "Open the app once and click Done when the Mac can't verify it. Then System Settings → Privacy & Security → Open Anyway, and allow the microphone when it asks."],
    linux: ["Open Terminal (Ctrl+Alt+T on Ubuntu), paste the line below and press Enter. Type your password when it asks.", "Open " + a.name + " from your app menu. Run the same line again any time to update."],
  };
  if (a.androidOk) out.android = ["On the phone or tablet, open the download page and tap Download for Android.", "Open the .apk and allow installs from your browser when Android asks, then Install."];
  return out;
}
export const PEDAL_SETUP = [
  "Plug in the power and your outputs. A screen on HDMI 1 is optional.",
  "On your phone, connect to the Wi-Fi \"Central Pedal Setup\". The setup page opens by itself (or go to http://10.42.0.1).",
  "Pick the church Wi-Fi and type its password.",
  "Type a 4-digit code: with Central Control, the main admin's code; otherwise any 4 digits. Central Pedal Control uses the same code to Upload your songs.",
  "Press Upload. The pedal joins the Wi-Fi and is ready.",
];
const address = (s) => { if (!s) return null; const a = s.address || {}; return [s.name, a.line1, a.line2, [a.city, a.state, a.postal_code].filter(Boolean).join(" "), a.country].filter(Boolean).join(", "); };
const planNames = (plans) => (PLAN_IDS.every((id) => plans.includes(id)) ? "All four sound plans" : PLAN_IDS.filter((id) => plans.includes(id)).map((id) => PLANS[id].name).join(", "));

// everything for one person (onlyOrder: just what that order gave - the email after a purchase)
export async function downloadsFor(user, onlyOrder) {
  const email = String(user.email || "").toLowerCase();
  const keys = await q(`SELECT l.*, (SELECT COUNT(*) FROM license_devices d WHERE d.key=l.key)::int AS devices, COALESCE(c.personal, FALSE) AS personal FROM licenses l LEFT JOIN churches c ON c.id=l.church_id
    WHERE (l.user_id=$1 OR l.assigned_email=$2) AND NOT l.revoked AND (l.expires_at IS NULL OR l.expires_at > now())` + (onlyOrder ? " AND l.order_id=$3" : "") + " ORDER BY l.kind, l.created_at", onlyOrder ? [user.id, email, onlyOrder] : [user.id, email]);
  const apps = ["P", "A", "U"].filter((k) => keys.some((l) => l.kind === k)).map((k) => {
    const a = APPS[k];
    return { kind: k, name: a.name, icon: a.icon, download: APPS_URL + "#" + a.anchor, runsOn: a.runsOn, devices: a.devices, phone: a.phone,
      steps: steps(a), linuxCommand: "curl -fsSL " + APPS_URL + "install.sh | bash -s " + a.linux, guide: config.publicUrl + INSTALL,
      keys: keys.filter((l) => l.kind === k).map((l) => ({ key: pretty(l.key), trial: l.trial, expiresAt: l.expires_at, inUse: l.devices,
        updatesUntil: k === "P" ? "forever" : fmt(l.updates_until), own: !!(l.personal && l.user_id === user.id), renewable: !!(l.personal && l.user_id === user.id && k !== "P" && !l.trial) })) };
  });
  const orders = await q("SELECT id, shipping, status, created_at FROM orders WHERE user_id=$1 AND status IN ('paid','review') AND (items ? 'pedal')" + (onlyOrder ? " AND id=$2" : "") + " ORDER BY created_at DESC", onlyOrder ? [user.id, onlyOrder] : [user.id]);
  const pedals = orders.map((o) => ({ ordered: o.created_at, shipsTo: address(o.shipping), held: o.status === "review" }));
  let packages = [];
  if (!onlyOrder) {
    const rows = await packageRows(email, user.id);
    packages = rows.filter((k) => keyState(k).ok).map((k) => ({ key: prettyPackage(k.key), plans: planNames(k.plans), until: k.ends, trial: k.trial, church: k.sub_kind === "bundle" || k.trial ? k.church : null }));
  }
  return { apps, pedals, renewalCents: RENEWAL.cents, pedalSetup: PEDAL_SETUP, packages, appsUrl: APPS_URL, guide: config.publicUrl + INSTALL };
}

// the email to a "Just me" buyer after paying: the same as the Downloads page, for what they just bought
export async function sendDownloadsEmail(userId, orderId) {
  const user = await one("SELECT id, email, name FROM users WHERE id=$1", [userId]); if (!user) return { sent: false };
  const d = await downloadsFor(user, orderId);
  if (!d.apps.length && !d.pedals.length) return { sent: false };
  const page = config.publicUrl + "/#downloads", t = [], h = [];
  t.push("Hi" + (user.name ? " " + user.name : "") + ",\n\nThanks for your order! Here's everything you need. It's on your Downloads page too: " + page + "\n");
  h.push('<div style="font:15px/1.5 system-ui,sans-serif;color:#10202e;max-width:560px"><p>Hi' + (user.name ? " " + escHtml(user.name) : "") + ',</p><p>Thanks for your order! Here\'s everything you need. It\'s on your <a href="' + escHtml(page) + '">Downloads page</a> too.</p>');
  for (const p of d.pedals) {
    t.push("CENTRAL PEDAL\n" + (p.shipsTo ? "It ships to " + p.shipsTo + "." : "We'll ship it to the address you gave.") + " When it arrives:\n" + d.pedalSetup.map((s, i) => "  " + (i + 1) + ". " + s).join("\n") + "\n");
    h.push("<h3 style=\"margin:1.2em 0 .3em\">Central Pedal</h3><p>" + (p.shipsTo ? "It ships to <b>" + escHtml(p.shipsTo) + "</b>." : "We'll ship it to the address you gave.") + " When it arrives:</p><ol>" + d.pedalSetup.map((s) => "<li>" + escHtml(s) + "</li>").join("") + "</ol>");
  }
  for (const a of d.apps) {
    const keys = a.keys.map((k) => k.key);
    t.push(a.name.toUpperCase() + " (" + a.runsOn + ")\nYour key" + (keys.length > 1 ? "s" : "") + ": " + keys.join(", ") + " - type it when the app first opens (" + a.devices + ").\nDownload: " + a.download +
      "\n  Windows: " + a.steps.windows.join(" ") + "\n  Mac: " + a.steps.mac.join(" ") + "\n  Linux: " + a.linuxCommand + (a.steps.android ? "\n  Android: " + a.steps.android.join(" ") : "") + (a.phone ? "\n  " + a.phone : "") + "\nThe full guide: " + a.guide + "\n");
    h.push("<h3 style=\"margin:1.2em 0 .3em\">" + escHtml(a.name) + "</h3><p>Your key" + (keys.length > 1 ? "s" : "") + ': <code style="font:600 17px ui-monospace,monospace">' + keys.map(escHtml).join("</code>, <code style=\"font:600 17px ui-monospace,monospace\">") + "</code><br>Type it when the app first opens (" + escHtml(a.devices) + ").</p>" +
      '<p><a href="' + escHtml(a.download) + '" style="display:inline-block;background:#12161C;color:#fff;padding:10px 18px;border-radius:6px;font-weight:600;text-decoration:none">Download ' + escHtml(a.name) + "</a> <span style=\"color:#555\">" + escHtml(a.runsOn) + "</span></p>" +
      "<ul><li><b>Windows:</b> " + escHtml(a.steps.windows.join(" ")) + "</li><li><b>Mac:</b> " + escHtml(a.steps.mac.join(" ")) + "</li><li><b>Linux:</b> <code>" + escHtml(a.linuxCommand) + "</code></li>" + (a.steps.android ? "<li><b>Android:</b> " + escHtml(a.steps.android.join(" ")) + "</li>" : "") + (a.phone ? "<li>" + escHtml(a.phone) + "</li>" : "") + "</ul>" +
      '<p style="color:#555">The full guide: <a href="' + escHtml(a.guide) + '">How to install</a></p>');
  }
  t.push("Talk soon,\nThe Motion Audio team\n"); h.push("<p>Talk soon,<br>The Motion Audio team</p></div>");
  return sendMail(user.email, "Your downloads and keys - Motion Audio", t.join("\n"), h.join(""));
}

// the public Downloads page: anyone can download every app; the keys come with a purchase (Account and email)
export function publicDownloads() {
  const apps = ["P", "A", "U"].map((k) => {
    const a = APPS[k];
    return { kind: k, name: a.name, icon: a.icon, download: APPS_URL + "#" + a.anchor, runsOn: a.runsOn, devices: a.devices, phone: a.phone,
      steps: steps(a), linuxCommand: "curl -fsSL " + APPS_URL + "install.sh | bash -s " + a.linux, guide: config.publicUrl + INSTALL, keys: [] };
  });
  const services = { name: "Central Services", icon: "central-services", download: APPS_URL + "#central-services", runsOn: "Windows, Mac, Linux, Android and any web browser",
    web: config.publicUrl + "/services/", note: "No key: sign in with your Motion Audio account. Your church gives you a slot." };
  return { apps, services, pedalSetup: PEDAL_SETUP, appsUrl: APPS_URL, guide: config.publicUrl + INSTALL };
}

export function routes(api, { wrap, requireUser }) {
  api.get("/downloads", requireUser, wrap(async (req, res) => res.json(await downloadsFor(req.user))));
  api.get("/downloads/apps", wrap(async (req, res) => res.json(publicDownloads())));   // (no sign-in: what anyone can download)
}
