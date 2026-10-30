// Download links on our own address (10.0). The apps and sound libraries are built and kept on GitHub, which stays the
// back end: the website's links are /download/<app>/<platform> and /download/library/<id>, and the website sends the
// browser on to the right file of the newest release. Nobody sees a GitHub page. The release's file list is read from
// the GitHub API and kept 10 minutes; when GitHub can't be reached, the last list read is used, and with none at all
// the visitor gets a short "try again in a minute" page from us. /install.sh is the Linux one-line installer, served
// from here so the line people paste has our address in it.
import { config } from "./config.js";
import { libraries } from "./libraries.js";

const API = () => (process.env.CC_UPDATE_API || "https://api.github.com").replace(/\/+$/, "");
const REPO = () => process.env.CC_UPDATE_REPO || "MotionAudio/Central-Apps";
const PAGES = () => (process.env.CC_PAGES_URL || "https://motionaudio.github.io/Central-Apps").replace(/\/+$/, "");
const FRESH_MS = 10 * 60e3;
let rel = { at: 0, assets: null, version: null };
let installSh = { at: 0, text: null };

// each app's files in a release: [platform, test on the file name]
export const APP_FILES = {
  "control": { name: "Central Control", files: { windows: /^CentralControl-.*-win-x64\.exe$/, mac: /^CentralControl-.*-mac-arm64\.dmg$/, "mac-intel": /^CentralControl-.*-mac-x64\.dmg$/, linux: /^CentralControl-.*-x86_64\.AppImage$/, "linux-deb": /^CentralControl-.*-amd64\.deb$/ } },
  "usage": { name: "Central Usage", files: { windows: /^CentralUsage-.*-win-x64\.exe$/, mac: /^CentralUsage-.*-mac-arm64\.dmg$/, "mac-intel": /^CentralUsage-.*-mac-x64\.dmg$/, linux: /^CentralUsage-.*-x86_64\.AppImage$/, "linux-deb": /^CentralUsage-.*-amd64\.deb$/, android: /^CentralUsage-.*\.apk$/ } },
  "pedal-control": { name: "Central Pedal Control", files: { windows: /^central-pedal-control-.*-win-x64\.exe$/, mac: /^central-pedal-control-.*-mac-arm64\.dmg$/, "mac-intel": /^central-pedal-control-.*-mac-x64\.dmg$/, linux: /^central-pedal-control-.*-x86_64\.AppImage$/, "linux-deb": /^central-pedal-control-.*-amd64\.deb$/, android: /^central-pedal-control-.*\.apk$/ } },
  "services": { name: "Central Services", files: { windows: /^central-services-.*-win-x64\.exe$/, mac: /^central-services-.*-mac-arm64\.dmg$/, "mac-intel": /^central-services-.*-mac-x64\.dmg$/, linux: /^central-services-.*-x86_64\.AppImage$/, "linux-deb": /^central-services-.*-amd64\.deb$/, android: /^central-services-.*\.apk$/ } },
};
// key kinds and the app names the rest of the site uses
export const APP_OF_KIND = { A: "control", U: "usage", P: "pedal-control" };
export const PLATFORM_NAMES = { windows: "Windows", mac: "Mac (Apple silicon)", "mac-intel": "Mac (Intel)", linux: "Linux (AppImage)", "linux-deb": "Ubuntu / Debian (.deb)", android: "Android" };
// our own link for an app on a platform
export const appLink = (app, platform) => config.publicUrl + "/download/" + app + "/" + platform;
export const libraryLink = (id) => config.publicUrl + "/download/library/" + encodeURIComponent(id);
export const installLine = (app) => "curl -fsSL " + config.publicUrl + "/install.sh | bash -s " + app;
export const platformsOf = (app) => Object.keys((APP_FILES[app] || {}).files || {});

async function release() {
  if (rel.assets && Date.now() - rel.at < FRESH_MS) return rel;
  try {
    const r = await fetch(API() + "/repos/" + REPO() + "/releases/latest", { headers: { Accept: "application/vnd.github+json", "User-Agent": "motion-audio" }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error("GitHub answered " + r.status);
    const j = await r.json();
    const assets = (j.assets || []).filter((a) => a && a.name && a.browser_download_url).map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size || 0 }));
    if (!assets.length) throw new Error("no files");
    rel = { at: Date.now(), assets, version: String(j.tag_name || "").replace(/^v/, "") };
  } catch (e) {
    if (!rel.assets) throw e;   // (no list yet: the caller says "try again")
    rel.at = Date.now() - FRESH_MS + 60e3;   // (GitHub didn't answer: the last list, asked again in a minute)
  }
  return rel;
}
export function forgetRelease() { rel = { at: 0, assets: null, version: null }; installSh = { at: 0, text: null }; }

// { url, name, size, version } for an app's file, or null (no such app / platform, or not in this release)
export async function resolveApp(app, platform) {
  const a = APP_FILES[app]; const test = a && a.files[platform]; if (!test) return null;
  const r = await release();
  const f = r.assets.find((x) => test.test(x.name));
  return f ? Object.assign({ version: r.version }, f) : null;
}
// the newest version and, for each app, the platforms in it (the Downloads page shows only those)
export async function available() {
  try {
    const r = await release();
    return { version: r.version, apps: Object.fromEntries(Object.entries(APP_FILES).map(([id, a]) => [id, Object.keys(a.files).filter((p) => r.assets.some((x) => a.files[p].test(x.name)))])) };
  } catch (_) { return { version: null, apps: Object.fromEntries(Object.keys(APP_FILES).map((id) => [id, platformsOf(id)])) }; }
}

const sorry = (what) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Download - Motion Audio</title>
<style>body{margin:0;font:16px/1.5 "Helvetica Neue",Arial,system-ui,sans-serif;color:#12161C;background:#F6F7F9;display:grid;place-items:center;min-height:100vh}main{max-width:30rem;padding:2rem;background:#fff;border-radius:10px;box-shadow:0 1px 3px rgba(18,22,28,.12)}a{color:#12161C}</style></head>
<body><main><h1 style="font-size:1.3rem;margin:0 0 .5rem">${what}</h1><p>Please try again in a minute. If it keeps happening, write to us from the Help page and we'll send you the file.</p><p><a href="/#downloads">Back to Downloads</a></p></main></body></html>`;

export function routes(app, { wrap }) {
  app.get("/download/library/:id", wrap(async (req, res) => {
    const id = String(req.params.id || "");
    let l = null;
    try { const d = await libraries(); l = d.libraries.find((x) => x.id === id || x.plan === id) || null; } catch (_) { }
    if (!l) return res.status(404).type("html").send(sorry("We couldn't find that sound library."));
    if (!l.ready) return res.status(503).type("html").send(sorry("That sound library isn't ready yet."));
    res.set("Cache-Control", "no-store"); res.redirect(302, l.url);
  }));
  app.get("/download/:app/:platform", wrap(async (req, res) => {
    const appId = String(req.params.app || ""), platform = String(req.params.platform || "");
    if (!APP_FILES[appId] || !APP_FILES[appId].files[platform]) return res.status(404).type("html").send(sorry("We don't have that download."));
    let f = null;
    try { f = await resolveApp(appId, platform); } catch (_) { return res.status(503).type("html").send(sorry("The download didn't start.")); }
    if (!f) return res.status(404).type("html").send(sorry(APP_FILES[appId].name + " for " + (PLATFORM_NAMES[platform] || platform) + " isn't in this release."));
    res.set("Cache-Control", "no-store"); res.redirect(302, f.url);
  }));
  app.get("/install.sh", wrap(async (req, res) => {   // (the Linux one-liner: the script itself lives with the releases)
    if (!installSh.text || Date.now() - installSh.at > FRESH_MS) {
      try {
        const r = await fetch(PAGES() + "/install.sh", { headers: { "User-Agent": "motion-audio" }, signal: AbortSignal.timeout(8000) });
        if (!r.ok) throw new Error(String(r.status));
        installSh = { at: Date.now(), text: await r.text() };
      } catch (_) { if (!installSh.text) return res.status(503).type("text/plain").send("echo 'The installer could not be fetched. Try again in a minute.' >&2; exit 1\n"); }
    }
    res.type("text/x-shellscript").set("Cache-Control", "no-store").send(installSh.text);
  }));
  app.get("/v1/downloads/available", wrap(async (req, res) => { res.set("Cache-Control", "public, max-age=120"); res.json(await available()); }));
}
