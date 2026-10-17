"""Central Pedal - where songs come from.

* Planning Center Services (api.planningcenteronline.com): upcoming plans, their songs with
  key, BPM, meter, arrangement sequence, lyrics, the chord chart, and the arrangement's
  attachments (stems / mp3s / PDF charts). A Personal Access Token (app id + secret) is used,
  kept in /data/pad-pedal/sources.json.
* Track packs: a MultiTracks.com or Loop Community download (zip or folder) on a USB stick,
  the Wi-Fi uploads or the library - unpacked into the library with the stems' roles guessed.
"""
import base64
import json
import os
import re
import shutil
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

AUDIO = (".wav", ".mp3", ".flac", ".ogg", ".oga", ".m4a", ".aac", ".aif", ".aiff", ".opus")
CHARTS = (".pdf", ".txt", ".cho", ".chopro", ".crd", ".pro", ".onsong", ".png", ".jpg", ".jpeg")
KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
FLAT = {"Db": "C#", "Eb": "D#", "Gb": "F#", "Ab": "G#", "Bb": "A#", "Cb": "B", "Fb": "E"}

# stem roles as the tracks player uses them (click / guide go to the in-ear output)
ROLES = [
    ("click", re.compile(r"click|metronome|\bclk\b", re.I)),
    ("guide", re.compile(r"guide|\bcues?\b|\bmd\b|director|talkback|count", re.I)),
    ("drums", re.compile(r"drum|kick|snare|\bperc|loop|\bbeat|\bkit\b|\btom|cymbal|hat", re.I)),
    ("bass", re.compile(r"bass|\bsub\b|808", re.I)),
    ("keys", re.compile(r"key|piano|synth|pad|organ|rhodes|\bep\b|\bb3\b|strings|\bstr\b", re.I)),
    ("guitar", re.compile(r"gtr|guitar|acoustic|\beg\s*\d*\b|\bag\s*\d*\b|elec|\bdobro|mandolin|banjo", re.I)),
    ("vocals", re.compile(r"vox|vocal|bgv|choir|lead|\bvoc\b|harmony|\balto\b|tenor|soprano", re.I)),
]
FULL_MIX = re.compile(r"(^|[\s_-])(full\s*mix|original\s*mix|master|rehearsal\s*mix|custom\s*mix|demo|reference|mixdown)([\s_.-]|$)", re.I)


def role_of(name):
    base = os.path.splitext(os.path.basename(name))[0]
    for role, rx in ROLES:
        if rx.search(base):
            return role
    return "music"


def norm_key(k):
    if not k:
        return None
    m = re.match(r"^\s*([A-Ga-g])([#b♯♭]?)\s*(m|min|minor)?", str(k))
    if not m:
        return None
    root = m.group(1).upper() + m.group(2).replace("♯", "#").replace("♭", "b")
    root = FLAT.get(root, root)
    return root if root in KEYS else None


def meta_from_name(name):
    """'Way Maker - Leeland - 68bpm - E' / 'Goodness of God (Ab) 63 BPM' / 'SongName_Key-G_BPM-72'."""
    base = os.path.splitext(os.path.basename(name.rstrip("/")))[0]
    bpm = None
    m = re.search(r"(\d{2,3}(?:\.\d)?)\s*_?bpm|bpm[\s_:-]*(\d{2,3})", base, re.I)
    if m:
        bpm = float(m.group(1) or m.group(2))
    key = None
    m = re.search(r"(?:key[\s_:-]*|\(|\[|\s-\s|_)([A-G][#b]?m?)(?:\)|\]|\s|_|$)", base + " ")
    if m:
        key = norm_key(m.group(1))
    title = re.sub(r"[\(\[][^\)\]]*[\)\]]", " ", base)
    title = re.split(r"\s+-\s+\d|\s*_key|\s*_bpm|\s+\d{2,3}\s*bpm", title, flags=re.I)[0]
    title = re.sub(r"\b(multitracks?|stems?|prime|loop\s*community|wav|mp3)\b", " ", title, flags=re.I)
    title = re.sub(r"[_]+", " ", title)
    title = re.sub(r"\s+-\s+.*$", "", title).strip(" -_") or base
    return {"title": title.strip(), "bpm": bpm, "key": key}


# ---------------------------------------------------------------------------
# track packs (MultiTracks.com, Loop Community, any zip / folder of stems)
# ---------------------------------------------------------------------------
def scan_pack(path):
    """What is in a pack: stems (with a guessed role), charts, and title / key / BPM from the names."""
    entries = []
    if os.path.isdir(path):
        for base, _dirs, files in os.walk(path):
            for f in sorted(files):
                if not f.startswith(".") and f.lower().endswith(AUDIO + CHARTS):
                    full = os.path.join(base, f)
                    entries.append({"name": f, "member": os.path.relpath(full, path), "size": os.path.getsize(full)})
    elif zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as zf:
            for info in zf.infolist():
                f = os.path.basename(info.filename)
                if info.is_dir() or f.startswith(".") or "__MACOSX" in info.filename or not f.lower().endswith(AUDIO + CHARTS):
                    continue
                entries.append({"name": f, "member": info.filename, "size": info.file_size})
    else:
        raise ValueError("not a folder or a zip file")
    stems = [e for e in entries if e["name"].lower().endswith(AUDIO)]
    charts = [e for e in entries if e["name"].lower().endswith(CHARTS)]
    for e in stems:
        e["role"] = role_of(e["name"])
        e["fullMix"] = bool(FULL_MIX.search(os.path.splitext(e["name"])[0]))
    # a pack of stems usually also carries a full mix: leave it out unless it is the only file
    real = [e for e in stems if not e["fullMix"]]
    for e in stems:
        e["use"] = (not e["fullMix"]) or not real
    meta = meta_from_name(os.path.basename(path.rstrip("/")))
    if not meta["bpm"] or not meta["key"]:
        for e in entries:  # sometimes only the files carry it ("Click 72bpm.wav", "Chart - G.pdf")
            m2 = meta_from_name(e["name"])
            meta["bpm"] = meta["bpm"] or m2["bpm"]
            if not meta["key"] and e["name"].lower().endswith(CHARTS):
                meta["key"] = m2["key"]
    vendor = "MultiTracks.com" if re.search(r"multitracks", path, re.I) else "Loop Community" if re.search(r"loop\s*community|prime", path, re.I) else ""
    return {"path": path, "title": meta["title"], "key": meta["key"], "bpm": meta["bpm"], "vendor": vendor, "stems": stems, "charts": charts}


def import_pack(path, dest_dir, members=None):
    """Copy / unpack the chosen stems and charts into dest_dir (the song's library folder)."""
    info = scan_pack(path)
    want = set(members) if members else set(e["member"] for e in info["stems"] if e["use"]) | set(e["member"] for e in info["charts"])
    os.makedirs(dest_dir, exist_ok=True)
    out = []

    def target_for(name):
        t = os.path.join(dest_dir, re.sub(r"[^\w .,()&'+#-]", "_", name)[:120])
        base, ext = os.path.splitext(t)
        n = 2
        while os.path.exists(t):
            t = "%s (%d)%s" % (base, n, ext)
            n += 1
        return t

    if os.path.isdir(path):
        for e in info["stems"] + info["charts"]:
            if e["member"] in want:
                t = target_for(e["name"])
                shutil.copyfile(os.path.join(path, e["member"]), t)
                out.append(dict(e, path=t))
    else:
        with zipfile.ZipFile(path) as zf:
            for e in info["stems"] + info["charts"]:
                if e["member"] in want:
                    t = target_for(e["name"])
                    with zf.open(e["member"]) as src, open(t + ".part", "wb") as dst:
                        shutil.copyfileobj(src, dst, 1 << 20)
                    os.replace(t + ".part", t)
                    out.append(dict(e, path=t))
    info["files"] = [f for f in out if f["name"].lower().endswith(AUDIO)]
    info["chartFiles"] = [f for f in out if f["name"].lower().endswith(CHARTS)]
    return info


# ---------------------------------------------------------------------------
# Planning Center Services
# ---------------------------------------------------------------------------
class PlanningCenter:
    def __init__(self, settings_path, base="https://api.planningcenteronline.com"):
        self.settings_path = settings_path
        self.base = base.rstrip("/")

    # credentials -----------------------------------------------------------
    def settings(self):
        try:
            with open(self.settings_path) as handle:
                return json.load(handle)
        except Exception:
            return {}

    def save(self, app_id, secret):
        s = self.settings()
        s["pco"] = {"appId": (app_id or "").strip(), "secret": (secret or "").strip()}
        os.makedirs(os.path.dirname(self.settings_path), exist_ok=True)
        with open(self.settings_path + ".part", "w") as handle:
            json.dump(s, handle)
        os.replace(self.settings_path + ".part", self.settings_path)
        try:
            os.chmod(self.settings_path, 0o600)
        except OSError:
            pass

    def forget(self):
        s = self.settings()
        s.pop("pco", None)
        with open(self.settings_path, "w") as handle:
            json.dump(s, handle)

    def configured(self):
        p = self.settings().get("pco") or {}
        return bool(p.get("appId") and p.get("secret"))

    # http ------------------------------------------------------------------
    def get(self, path, params=None, raw=False, method="GET"):
        p = self.settings().get("pco") or {}
        if not p.get("appId"):
            raise ValueError("Planning Center is not connected - add your Personal Access Token in Settings")
        url = path if path.startswith("http") else self.base + path
        if params:
            url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
        req = urllib.request.Request(url, method=method, data=b"" if method == "POST" else None)
        req.add_header("Authorization", "Basic " + base64.b64encode((p["appId"] + ":" + p["secret"]).encode()).decode())
        req.add_header("User-Agent", "CentralControl/6 (worship playback)")
        try:
            with urllib.request.urlopen(req, timeout=25) as resp:
                body = resp.read()
        except urllib.error.HTTPError as error:
            if error.code == 401:
                raise ValueError("Planning Center refused the token (check the app id and secret)")
            raise ValueError("Planning Center: HTTP %d" % error.code)
        except urllib.error.URLError as error:
            raise ValueError("Planning Center is not reachable (%s) - is the Central Pedal online?" % getattr(error, "reason", error))
        return body if raw else json.loads(body.decode() or "{}")

    def get_all(self, path, params=None, limit=200):
        params = dict(params or {}, per_page=100)
        out, included, url, n = [], [], path, 0
        while url and n < 10:
            j = self.get(url, params if n == 0 else None)
            out += j.get("data") or []
            included += j.get("included") or []
            url = (j.get("links") or {}).get("next")
            n += 1
            if len(out) >= limit:
                break
        return out, included

    # what the app shows ----------------------------------------------------
    def me(self):
        j = self.get("/services/v2")
        org = (j.get("data") or {}).get("attributes") or {}
        return {"organization": org.get("name") or "Planning Center"}

    def service_types(self):
        data, _ = self.get_all("/services/v2/service_types", {"order": "sequence"})
        return [{"id": d["id"], "name": (d.get("attributes") or {}).get("name") or "Service"} for d in data]

    def plans(self, service_type):
        data, _ = self.get_all("/services/v2/service_types/%s/plans" % urllib.parse.quote(str(service_type)), {"filter": "future", "order": "sort_date"}, limit=20)
        out = []
        for d in data[:20]:
            a = d.get("attributes") or {}
            out.append({"id": d["id"], "title": a.get("title") or a.get("series_title") or "", "dates": a.get("dates") or a.get("short_dates") or "", "sortDate": a.get("sort_date"), "items": a.get("items_count")})
        return out

    def items(self, service_type, plan):
        data, included = self.get_all("/services/v2/service_types/%s/plans/%s/items" % (urllib.parse.quote(str(service_type)), urllib.parse.quote(str(plan))), {"include": "song,arrangement,key"})
        inc = {(i.get("type"), i.get("id")): i.get("attributes") or {} for i in included}
        out = []
        for d in data:
            a = d.get("attributes") or {}
            if a.get("item_type") != "song":
                continue
            rel = d.get("relationships") or {}
            sid = ((rel.get("song") or {}).get("data") or {}).get("id")
            aid = ((rel.get("arrangement") or {}).get("data") or {}).get("id")
            kid = ((rel.get("key") or {}).get("data") or {}).get("id")
            song, arr, key = inc.get(("Song", sid), {}), inc.get(("Arrangement", aid), {}), inc.get(("Key", kid), {})
            meter = arr.get("meter") or ""
            out.append({
                "id": d["id"], "songId": sid, "arrangementId": aid,
                "title": song.get("title") or a.get("title") or "Song", "author": song.get("author") or "", "ccli": song.get("ccli_number"),
                "key": norm_key(a.get("key_name") or key.get("starting_key") or key.get("name") or arr.get("chord_chart_key")),
                "bpm": arr.get("bpm"), "meter": meter, "bpb": int(meter.split("/")[0]) if re.match(r"^\d+/\d+$", meter or "") else None,
                "arrangement": arr.get("name") or "", "sequence": arr.get("sequence") or [], "length": arr.get("length"),
                "hasChart": bool(arr.get("chord_chart")), "hasLyrics": bool(arr.get("lyrics")),
            })
        return out

    def arrangement(self, song_id, arrangement_id):
        j = self.get("/services/v2/songs/%s/arrangements/%s" % (song_id, arrangement_id))
        return (j.get("data") or {}).get("attributes") or {}

    def attachments(self, song_id, arrangement_id):
        data, _ = self.get_all("/services/v2/songs/%s/arrangements/%s/attachments" % (song_id, arrangement_id))
        out = []
        for d in data:
            a = d.get("attributes") or {}
            name = a.get("filename") or a.get("display_name") or ""
            if name.lower().endswith(AUDIO + (".pdf",)) and a.get("downloadable", True) is not False:
                out.append({"id": d["id"], "name": name, "size": a.get("file_size"), "type": a.get("content_type") or "", "role": role_of(name), "fullMix": bool(FULL_MIX.search(name))})
        return out

    def download(self, attachment_id, target):
        j = self.get("/services/v2/attachments/%s/open" % attachment_id, method="POST")
        url = ((j.get("data") or {}).get("attributes") or {}).get("attachment_url")
        if not url:
            raise ValueError("Planning Center did not give a download link")
        req = urllib.request.Request(url, headers={"User-Agent": "CentralControl/6"})
        with urllib.request.urlopen(req, timeout=120) as resp, open(target + ".part", "wb") as out:
            shutil.copyfileobj(resp, out, 1 << 20)
        os.replace(target + ".part", target)
        return target


class ProPresenter:
    """ProPresenter 7 (7.9+) over its network API (ProPresenter → Settings → Network → Enable network, port).
    Sections can show a slide of the active presentation (or the next slide); a song can bring up its
    presentation from the library by name. All calls are short GETs on a worker thread: a slow or missing
    ProPresenter never holds up the music."""

    def __init__(self, path):
        self.path = path
        self.cfg = {"enabled": False, "host": "", "port": 1025, "openSong": True}
        self.last = {"ok": None, "error": None, "version": None, "at": 0}
        self.libraries = {}
        try:
            with open(path) as fh:
                self.cfg.update(json.load(fh))
        except (OSError, ValueError):
            pass
        self.queue = []
        self.cv = threading.Condition()
        threading.Thread(target=self._worker, daemon=True).start()

    def save(self, cfg):
        for k in ("enabled", "host", "port", "openSong"):
            if k in cfg:
                self.cfg[k] = cfg[k]
        self.cfg["port"] = int(self.cfg.get("port") or 1025)
        self.cfg["host"] = str(self.cfg.get("host") or "").strip()
        tmp = self.path + ".part"
        with open(tmp, "w") as fh:
            json.dump(self.cfg, fh)
        os.replace(tmp, self.path)
        self.libraries = {}
        return self.status()

    def status(self):
        return dict(self.cfg, type="propresenterStatus", ok=self.last["ok"], error=self.last["error"], version=self.last["version"])

    def base(self):
        return "http://%s:%d" % (self.cfg["host"], int(self.cfg.get("port") or 1025))

    def get(self, path, timeout=2.5):
        req = urllib.request.Request(self.base() + path, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read()
        try:
            return json.loads(body.decode() or "null")
        except ValueError:
            return None

    def test(self):
        try:
            v = self.get("/version")
            self.last = {"ok": True, "error": None, "version": (v or {}).get("host_description") or (v or {}).get("api_version") or "ProPresenter", "at": time.time()}
        except Exception as error:
            self.last = {"ok": False, "error": str(error)[:160], "version": None, "at": time.time()}
        return self.status()

    # ----- what the show does -------------------------------------------------
    def slide(self, slide):
        if slide == "next":
            return self.get("/v1/trigger/next")
        index = max(0, int(slide) - 1)        # the musician counts slides from 1, the API from 0
        return self.get("/v1/presentation/active/%d/trigger" % index)

    def find_presentation(self, name):
        want = re.sub(r"[^a-z0-9]+", "", (name or "").lower())
        if not want:
            return None
        if not self.libraries:
            for lib in self.get("/v1/libraries") or []:
                if not isinstance(lib, dict):
                    continue
                lid = lib.get("uuid") or (lib.get("id") or {}).get("uuid")
                if lid:
                    data = self.get("/v1/library/%s" % lid) or {}
                    items = data.get("items") if isinstance(data, dict) else data
                    self.libraries[lid] = [(it.get("uuid") or (it.get("id") or {}).get("uuid"), (it.get("name") or (it.get("id") or {}).get("name") or "")) for it in (items or []) if isinstance(it, dict)]
        best = None
        for lid, items in self.libraries.items():
            for pid, pname in items:
                slug = re.sub(r"[^a-z0-9]+", "", pname.lower())
                if slug == want:
                    return lid, pid
                if not best and (want in slug or slug in want) and len(slug) > 3:
                    best = (lid, pid)
        return best

    def open_song(self, name):
        hit = self.find_presentation(name)
        if not hit:
            raise RuntimeError("no presentation called \"%s\" in the ProPresenter libraries" % name)
        return self.get("/v1/library/%s/%s/trigger" % hit)

    def submit(self, job):
        if not self.cfg.get("enabled") or not self.cfg.get("host"):
            return False
        with self.cv:
            self.queue.append(job)
            self.cv.notify()
        return True

    def _worker(self):
        while True:
            with self.cv:
                while not self.queue:
                    self.cv.wait()
                job = self.queue.pop(0)
            try:
                if job.get("action") == "section" and job.get("slide") not in (None, ""):
                    self.slide(job["slide"])
                elif job.get("action") == "song" and self.cfg.get("openSong"):
                    self.open_song(job.get("presentation") or job.get("song") or "")
                self.last.update(ok=True, error=None, at=time.time())
            except Exception as error:
                self.last.update(ok=False, error=str(error)[:160], at=time.time())


def version_tuple(v):
    nums = re.findall(r"\d+", str(v or ""))[:3]
    return tuple(int(n) for n in nums) + (0,) * (3 - len(nums)) if nums else (0, 0, 0)


# ---------------------------------------------------------------- name lookups when the system's DNS is broken
# "[Errno -3] Temporary failure in name resolution": the Pi has a network but its DNS server does not answer
# (a router without DNS, a stale resolv.conf, a captive network). The updater then asks public DNS servers itself.
PUBLIC_DNS = ("1.1.1.1", "8.8.8.8", "9.9.9.9")


def dns_query_a(host, server, timeout=3.0):
    """One DNS A-record query over UDP. Returns a list of IPv4 addresses (follows the answer's CNAMEs)."""
    import random
    import socket
    import struct
    qid = random.randint(0, 0xFFFF)
    q = struct.pack(">HHHHHH", qid, 0x0100, 1, 0, 0, 0) + b"".join(bytes([len(p)]) + p.encode("idna") for p in host.rstrip(".").split(".")) + b"\x00" + struct.pack(">HH", 1, 1)
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(timeout)
    try:
        sock.sendto(q, (server, 53))
        data, _ = sock.recvfrom(4096)
    finally:
        sock.close()
    rid, flags, qd, an = struct.unpack(">HHHH", data[:8])
    if rid != qid or flags & 0x000F:
        return []

    def skip_name(i):
        while True:
            n = data[i]
            if n == 0:
                return i + 1
            if n & 0xC0 == 0xC0:
                return i + 2
            i += n + 1
    i = 12
    for _ in range(qd):
        i = skip_name(i) + 4
    out = []
    for _ in range(an):
        i = skip_name(i)
        rtype, _cls, _ttl, rdlen = struct.unpack(">HHIH", data[i:i + 10])
        i += 10
        if rtype == 1 and rdlen == 4:
            out.append(".".join(str(b) for b in data[i:i + 4]))
        i += rdlen
    return out


class _PublicDns:
    """While active, a host the system can't look up is looked up at the public DNS servers instead."""
    def __enter__(self):
        import socket
        self.socket, self.orig = socket, socket.getaddrinfo
        orig = self.orig

        def getaddrinfo(host, port, *args, **kwargs):
            try:
                return orig(host, port, *args, **kwargs)
            except socket.gaierror:
                if not host or re.match(r"^[\d.]+$", str(host)):
                    raise
                for server in PUBLIC_DNS:
                    try:
                        ips = dns_query_a(str(host), server)
                    except OSError:
                        continue
                    if ips:
                        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, int(port or 443))) for ip in ips]
                raise
        socket.getaddrinfo = getaddrinfo
        return self

    def __exit__(self, *exc):
        self.socket.getaddrinfo = self.orig
        return False


def explain_network_error(error):
    text = str(error)
    if "Errno -3" in text or "Errno -2" in text or "Name or service not known" in text or "name resolution" in text:
        return "no internet here: the Central Pedal could not find github.com (DNS). Connect it to a Wi-Fi or network with internet (Settings → Wi-Fi), then Check now - or update from a USB stick"
    if "Errno 101" in text or "unreachable" in text:
        return "no internet here (network unreachable). Connect it to a Wi-Fi or network with internet, then Check now - or update from a USB stick"
    if "timed out" in text:
        return "the update server did not answer in time (slow or no internet) - it tries again by itself"
    return "could not reach the update server (%s)" % text[:120]


class Updater:
    """Looks for a newer release on GitHub (Releases of the repository set in Settings → Software updates).
    A release carries:  central-control-source.zip  (this Pi),  central-control-<v>-amd64.deb / .AppImage and
    central-usage-<v>-amd64.deb / .AppImage (the PC apps),  and SHA256SUMS  (sha256 of every file).
    It only ever looks and downloads; installing is the musician's tap (never while something is playing)."""

    API = "https://api.github.com"
    DEFAULT_REPO = "MotionAudio/Central-Apps"

    def __init__(self, path, current, download_dir, api=None):
        self.path = path
        self.current = current
        self.dir = download_dir
        self.api = api or self.API
        self.cfg = {"auto": True, "repo": "", "lastCheck": 0}
        try:
            with open(path) as fh:
                self.cfg.update(json.load(fh))
        except (OSError, ValueError):
            pass
        if not self.cfg.get("repo"):   # where the official releases are published (Settings → Software updates can change it)
            self.cfg["repo"] = os.environ.get("CC_UPDATE_REPO", self.DEFAULT_REPO)
        self.latest = None
        self.error = None
        self.busy = False

    def save(self, cfg):
        for k in ("auto", "repo"):
            if k in cfg:
                self.cfg[k] = cfg[k]
        self.cfg["repo"] = re.sub(r"^https?://github\.com/", "", str(self.cfg.get("repo") or "").strip()).strip("/") or self.DEFAULT_REPO   # empty = the official releases
        self._write()
        return self.status()

    def _write(self):
        tmp = self.path + ".part"
        with open(tmp, "w") as fh:
            json.dump(self.cfg, fh)
        os.replace(tmp, self.path)

    def status(self):
        lt = self.latest or {}
        newer = bool(lt and version_tuple(lt.get("version")) > version_tuple(self.current))
        return {"type": "updateStatus", "current": self.current, "repo": self.cfg.get("repo"), "auto": bool(self.cfg.get("auto")), "lastCheck": self.cfg.get("lastCheck") or 0,
                "available": newer, "latest": lt.get("version"), "notes": (lt.get("notes") or "")[:2000], "published": lt.get("published"), "hasPi": bool(lt.get("zip")), "error": self.error, "busy": self.busy}

    def _get(self, url, timeout=20, raw=False):
        req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json" if not raw else "application/octet-stream", "User-Agent": "CentralControl-updater"})
        with _PublicDns():   # the system's DNS first; the public DNS servers when it fails
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read() if raw else json.loads(resp.read().decode() or "null")

    def check(self):
        repo = self.cfg.get("repo")
        if not repo or "/" not in repo:
            self.error = "set the update source (owner/repo on GitHub) first"
            return self.status()
        try:
            rel = self._get("%s/repos/%s/releases/latest" % (self.api, repo))
            assets = {a.get("name"): a.get("browser_download_url") for a in (rel.get("assets") or [])}
            self.latest = {"version": (rel.get("tag_name") or rel.get("name") or "").lstrip("vV"), "notes": rel.get("body") or "", "published": rel.get("published_at"),
                           "zip": assets.get("central-control-source.zip"), "sums": assets.get("SHA256SUMS"), "assets": assets}
            self.error = None
        except Exception as error:
            self.error = explain_network_error(error)
        self.cfg["lastCheck"] = int(time.time())
        try:
            self._write()
        except OSError:
            pass
        return self.status()

    def due(self):
        # once a day; after a failed look (no internet yet - the Wi-Fi comes up after the app) again in 10 minutes
        wait = 600 if self.error else 20 * 3600
        return bool(self.cfg.get("auto")) and bool(self.cfg.get("repo")) and time.time() - (self.cfg.get("lastCheck") or 0) > wait

    def download(self):
        """Fetch central-control-source.zip of the latest release and check it against SHA256SUMS. Returns the path."""
        import hashlib
        lt = self.latest or {}
        if not lt.get("zip"):
            raise RuntimeError("that release has no central-control-source.zip")
        os.makedirs(self.dir, exist_ok=True)
        data = self._get(lt["zip"], timeout=300, raw=True)
        if lt.get("sums"):
            sums = self._get(lt["sums"], timeout=30, raw=True).decode(errors="ignore")
            want = None
            for line in sums.splitlines():
                parts = line.split()
                if len(parts) >= 2 and parts[-1].lstrip("*") == "central-control-source.zip":
                    want = parts[0].lower()
            if not want:
                raise RuntimeError("SHA256SUMS has no line for central-control-source.zip")
            if hashlib.sha256(data).hexdigest() != want:
                raise RuntimeError("the download is damaged (checksum does not match) - nothing was installed")
        path = os.path.join(self.dir, "central-control-source-%s.zip" % re.sub(r"[^0-9A-Za-z.]+", "", lt.get("version") or "new"))
        with open(path + ".part", "wb") as fh:
            fh.write(data)
        os.replace(path + ".part", path)
        return path
