"""Central Pedal - installs the sound libraries (9.8): one zip per sound plan (Central Keys, Central Instrument,
Central Plugins, Central Pedals, Central Pads) from the website's list (/v1/libraries -> a download) or from a file.

Anyone can download a library; what it holds only opens with its plan. So every item keeps its library's plan:
  * sounds (.sf2) go into the keys sounds (the instrument host's own folder - the Pi's FluidSynth or the computers'
    built-in rig) with a line in that folder's tiers.txt ("<bank>|<plan>|<license>|<library id>"), which both hosts
    read: the app shows the sound locked without the plan;
  * impulse responses (.wav) go into the IR folder, with the same kind of tiers.txt line;
  * presets and boards are handed to the app (PPInstrument.addBoard), which keeps the library's plan on them;
  * clicks are kept in <data>/libraries/<id>/clicks;
  * pads (Central Pads: one loop per style and key) are kept in <data>/libraries/<id>/pads/<style>/<key>.wav - the pad
    pedal lists them (/libraries/pads) and plays the file of the song's key (/libraries/pad?...);
  * loops (10.0: drum loops at a tempo, ambient loops in a key) are kept in <data>/libraries/<id>/loops/<set>/<file> -
    the texture channels list them (/libraries/loops) and play them (/libraries/loop?...).
  * (10.1) community plugins (kind "plugin": a bundle zip from Make & sell, checked and reviewed by Motion Audio) are
    unpacked into <data>/libraries/community-plugins/<id>/ - only while this device's "Allow community plugins" switch is
    on (off by default), every program file checked against the sha256 the review recorded. The plugin hosts load that
    folder walled off (community_sandbox.py), never in the live chain's own process. revoke() takes away anything on the
    website's revoke list (an item Motion Audio pulled, or a program file it blocked).
An item of a kind this version doesn't know (from a newer library) is left out; the rest installs.
A download is checked against the sha256 the list gives before anything is unpacked (a mismatch is refused), and every
item against the sha256 in the library's manifest.json. Installing a newer version replaces the older one; Remove takes
everything a library added away again. What's installed is kept in <data>/libraries/<id>.json."""
import hashlib
import io
import json
import logging
import os
import re
import shutil
import tempfile
import time
import urllib.parse
import urllib.request
import zipfile

log = logging.getLogger("pedal-driver.libraries")

PLANS = ("keys", "instrument", "plugins", "pedals", "pads")
KINDS = ("sound", "board", "preset", "ir", "click", "pad", "loop", "plugin")
PLUGIN_FORMATS = ("lv2", "vst3", "clap", "component")
MAX_PLUGIN = 300 * 1024 * 1024    # a community plugin bundle, unpacked
PAD_KEYS = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
MAX_DOWNLOAD = 2 * 1024 ** 3        # a library zip
MAX_ITEM = 700 * 1024 * 1024        # one file inside it
MAX_TOTAL = 2 * 1024 ** 3           # everything inside it, unpacked
ID_RE = re.compile(r"^[a-z0-9-]{3,60}$")
VERSION_RE = re.compile(r"^\d+(\.\d+){0,3}$")
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
# 10.0.1: while the website isn't open, the list (with each zip's size and sha256) comes straight from the published
# "libraries" release; the page asks the driver for it (GitHub's download redirect has no CORS header)
INDEX_URL = os.environ.get("CC_LIBRARIES_INDEX", "https://github.com/MotionAudio/Central-Apps/releases/download/libraries/libraries-index.json")
_index_cache = {}


def release_index(url=None, timeout=20, max_age=600):
    """The published libraries' list: [{id, plan, title, version, summary, file, size, sha256, url, ready}]."""
    url = url or INDEX_URL
    hit = _index_cache.get(url)
    if hit and time.time() - hit[0] < max_age:
        return hit[1]
    req = urllib.request.Request(url, headers={"User-Agent": "central-pedal"})
    with urllib.request.urlopen(req, timeout=timeout) as res:   # (urllib follows GitHub's redirect)
        raw = res.read(4 * 1024 * 1024 + 1)
        final = res.geturl() or url   # (the zips sit next to the index, where the redirect ended)
    if len(raw) > 4 * 1024 * 1024:
        raise ValueError("the library list is too big")
    j = json.loads(raw.decode("utf-8"))
    base = str(j.get("base") or final.rsplit("/", 1)[0]).rstrip("/")
    out = []
    for lib in j.get("libraries") or []:
        if not isinstance(lib, dict):
            continue
        sha = str(lib.get("sha256") or "").lower()
        if not ID_RE.match(str(lib.get("id") or "")) or lib.get("plan") not in PLANS or not SHA_RE.match(sha) or not lib.get("file"):
            continue
        out.append({"id": lib["id"], "plan": lib["plan"], "title": lib.get("title") or lib["id"], "version": str(lib.get("version") or ""),
                    "summary": lib.get("summary") or "", "file": lib["file"], "size": int(lib.get("size") or 0), "sha256": sha,
                    "url": base + "/" + urllib.parse.quote(str(lib["file"])), "ready": True})
    data = {"ok": True, "source": "release", "built": j.get("built") or "", "libraries": out}
    _index_cache[url] = (time.time(), data)
    return data


def version_key(v):
    return tuple(int(x) for x in str(v or "0").split(".") if x.isdigit())


def newer(a, b):
    """Is version a newer than b?"""
    return version_key(a) > version_key(b)


def safe_name(name, default="item"):
    base = os.path.basename(str(name or "").replace("\\", "/"))
    base = re.sub(r"[^\w.\- ]+", "", base).strip(" .")
    return base[:120] or default


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def tiers_lines_set(folder, owner, lines):
    """Replaces the tiers.txt lines a library owns (its id in the 4th field) in a folder with these."""
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, "tiers.txt")
    keep = []
    try:
        with open(path, encoding="utf-8", errors="replace") as handle:
            for line in handle:
                line = line.rstrip("\n")
                parts = line.split("|")
                if line and not (len(parts) >= 4 and parts[3] == owner):
                    keep.append(line)
    except OSError:
        pass
    body = "\n".join(keep + list(lines))
    with open(path + ".part", "w", encoding="utf-8") as handle:
        handle.write(body + ("\n" if body else ""))
    os.replace(path + ".part", path)
    try:   # (the hosts cache tiers.txt by its time: a change within the same second still shows)
        t = time.time()
        os.utime(path, (t, t))
    except OSError:
        pass


def read_tiers(folder, allowed=PLANS + ("free",)):
    """{file prefix: plan} from a folder's tiers.txt."""
    out = {}
    try:
        with open(os.path.join(folder, "tiers.txt"), encoding="utf-8", errors="replace") as handle:
            for line in handle:
                parts = line.strip().split("|")
                if len(parts) >= 2 and parts[0] and not parts[0].startswith("#") and parts[1] in allowed:
                    out[parts[0]] = parts[1]
    except OSError:
        pass
    return out


class LibraryError(ValueError):
    pass


class LibraryStore:
    def __init__(self, data_root, instrument=None, opener=None):
        self.root = os.path.join(data_root, "libraries")
        os.makedirs(self.root, exist_ok=True)
        self.instrument = instrument
        self.opener = opener or urllib.request.urlopen
        self.progress = {}   # id -> {"done": bytes, "total": bytes, "state": text}

    # ----- (10.1) community plugins: the device's switch -------------------------------
    def plugins_dir(self):
        return os.path.join(self.root, "community-plugins")

    def plugins_allowed(self):
        try:
            with open(os.path.join(self.root, "community-plugins.json"), encoding="utf-8") as handle:
                return json.load(handle).get("on") is True
        except (OSError, ValueError, AttributeError):
            return False

    def set_plugins_allowed(self, on):
        with open(os.path.join(self.root, "community-plugins.json"), "w", encoding="utf-8") as handle:
            json.dump({"on": bool(on), "changed": time.strftime("%Y-%m-%dT%H:%M:%S")}, handle)
        return self.plugins_allowed()

    def revoke(self, ids=(), hashes=()):
        """The website's revoke list: removes the community items it names (library ids "community-<n>") and any
        installed library holding a plugin program file whose sha256 it lists. Returns the ids taken away."""
        gone, bad, named = [], {str(h).lower() for h in hashes or () if SHA_RE.match(str(h).lower())}, set(ids or ())
        for rec in self.installed():
            hit = rec["id"] in named
            if not hit and bad:
                hit = any(b.get("sha256") in bad for pl in rec.get("plugins") or [] for b in pl.get("binaries") or [])
            if hit:
                try:
                    self.remove(rec["id"])
                    gone.append(rec["id"])
                except LibraryError:
                    pass
        if gone:
            log.warning("community items taken away (revoke list): %s", ", ".join(gone))
        return gone

    def _unpack_plugin(self, lib_id, it, data):
        """A plugin bundle zip -> <plugins dir>/<lib id>/<bundle>/: only regular files inside the bundle, no links,
        every program file matching the sha256 Motion Audio's review recorded."""
        if not self.plugins_allowed():
            raise LibraryError("community plugins are off on this device - switch on Allow community plugins first")
        fmt, bundle = str(it.get("format") or ""), safe_name(str(it.get("bundle") or ""), "")
        if fmt not in PLUGIN_FORMATS or not bundle:
            raise LibraryError("a plugin in that library isn't a plugin bundle")
        want = {str(b.get("name")): str(b.get("sha256") or "").lower() for b in it.get("binaries") or [] if isinstance(b, dict)}
        if not want:
            raise LibraryError("a plugin in that library has no checked program files")
        dest = os.path.join(self.plugins_dir(), lib_id)
        shutil.rmtree(dest, ignore_errors=True)
        os.makedirs(dest, exist_ok=True)
        real_dest = os.path.realpath(dest)
        total, seen = 0, {}
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                for info in zf.infolist():
                    name = info.filename
                    if info.is_dir():
                        continue
                    if (info.external_attr >> 16) & 0o170000 == 0o120000:
                        raise LibraryError("a plugin in that library has a link in it")
                    parts = [x for x in name.replace("\\", "/").split("/") if x]
                    if not parts or name.startswith("/") or any(x in (".", "..") for x in parts):
                        raise LibraryError("a plugin in that library has a file outside its folder")
                    total += info.file_size
                    if total > MAX_PLUGIN:
                        raise LibraryError("a plugin in that library is too big")
                    out = os.path.realpath(os.path.join(dest, *parts))
                    if not out.startswith(real_dest + os.sep):
                        raise LibraryError("a plugin in that library has a file outside its folder")
                    body = zf.read(info)
                    os.makedirs(os.path.dirname(out), exist_ok=True)
                    with open(out, "wb") as handle:
                        handle.write(body)
                    rel = "/".join(parts)
                    os.chmod(out, 0o755 if rel in want else 0o644)
                    seen[rel] = sha256_bytes(body)
        except zipfile.BadZipFile:
            shutil.rmtree(dest, ignore_errors=True)
            raise LibraryError("a plugin in that library can't be unpacked")
        except LibraryError:
            shutil.rmtree(dest, ignore_errors=True)
            raise
        for name, sha in want.items():
            if seen.get(name) != sha:
                shutil.rmtree(dest, ignore_errors=True)
                raise LibraryError("a plugin's program file doesn't match what Motion Audio checked - nothing was installed")
        return {"name": str(it.get("name") or bundle)[:80], "format": fmt, "platform": str(it.get("platform") or ""), "bundle": bundle,
                "path": os.path.join(dest, bundle), "binaries": [{"name": n, "sha256": h} for n, h in sorted(want.items())]}

    # ----- what's installed ------------------------------------------------------
    def record_path(self, lib_id):
        return os.path.join(self.root, lib_id + ".json")

    def record(self, lib_id):
        try:
            with open(self.record_path(lib_id), encoding="utf-8") as handle:
                return json.load(handle)
        except (OSError, ValueError):
            return None

    def installed(self):
        out = []
        for fn in sorted(os.listdir(self.root)):
            if fn.endswith(".json"):
                r = self.record(fn[:-5])
                if r and r.get("id"):
                    out.append(r)
        return out

    def listing(self):
        """What the app's Libraries panel shows: each installed library with its boards and presets (to add as boards)."""
        return [{k: r.get(k) for k in ("id", "plan", "version", "title", "summary", "installedAt", "counts", "boards", "presets", "source", "community", "plugins")} for r in self.installed()]

    def pads(self):
        """The installed pad styles (Central Pads): [{"id": "<library>/<style>", "name", "library", "tier", "keys": [..]}]."""
        out = []
        for r in self.installed():
            styles = {}
            for pd in r.get("pads") or []:
                st = styles.setdefault(pd["name"], {"id": "%s/%s" % (r["id"], pd["name"]), "name": pd["name"], "library": r["id"], "tier": r.get("plan"), "keys": []})
                if os.path.isfile(pd.get("file") or ""):
                    st["keys"].append(pd["key"])
            out.extend(s for s in styles.values() if s["keys"])
        return out

    def loops(self):
        """The installed loops (10.0), one entry per groove / style: [{"id": "<library>/<set>/<name>", "name", "group",
        "library", "tier", "files": [{"file": id, "bpm"?, "meter"?, "bars"?, "key"?}]}] - a file's id is its name in the
        library (what /libraries/loop takes)."""
        out = {}
        for r in self.installed():
            for lp in r.get("loops") or []:
                if not os.path.isfile(lp.get("file") or ""):
                    continue
                k = "%s/%s/%s" % (r["id"], lp.get("set"), lp.get("name"))
                e = out.setdefault(k, {"id": k, "name": lp.get("name"), "group": lp.get("group"), "set": lp.get("set"), "library": r["id"], "tier": r.get("plan"), "files": []})
                f = {"file": "%s/%s" % (lp.get("set"), os.path.basename(lp["file"]))}
                for x in ("bpm", "meter", "bars", "key", "seconds"):
                    if x in lp:
                        f[x] = lp[x]
                e["files"].append(f)
        return list(out.values())

    def loop_file(self, lib_id, file_id):
        """One loop's WAV (file_id "<set>/<file>") - only a file this library installed - or None."""
        if not ID_RE.match(str(lib_id or "")) or not re.match(r"^[\w.-]{1,60}/[\w.-]{1,120}$", str(file_id or "")):
            return None
        rec = self.record(lib_id) or {}
        base = os.path.realpath(os.path.join(self.root, lib_id, "loops"))
        for lp in rec.get("loops") or []:
            if "%s/%s" % (lp.get("set"), os.path.basename(lp.get("file") or "")) == file_id:
                real = os.path.realpath(lp.get("file") or "")
                return real if real.startswith(base + os.sep) and os.path.isfile(real) else None
        return None

    def pad_file(self, lib_id, style, key):
        """The loop of one pad style in one key - only a file this library installed - or None."""
        if not ID_RE.match(str(lib_id or "")) or key not in PAD_KEYS:
            return None
        rec = self.record(lib_id) or {}
        base = os.path.realpath(os.path.join(self.root, lib_id, "pads"))
        for pd in rec.get("pads") or []:
            if pd.get("name") == style and pd.get("key") == key:
                real = os.path.realpath(pd.get("file") or "")
                return real if real.startswith(base + os.sep) and os.path.isfile(real) else None
        return None

    # ----- install -------------------------------------------------------------------
    def download(self, url, sha256, lib_id="library", size_hint=0):
        """Downloads a library zip into a temporary file, checking its sha256 as it comes. Returns the file's path."""
        if not (isinstance(url, str) and re.match(r"^https?://", url)):
            raise LibraryError("not a download address")
        if not SHA_RE.match(str(sha256 or "")):
            raise LibraryError("this library isn't published yet (no checksum to check it against)")
        h = hashlib.sha256()
        fd, tmp = tempfile.mkstemp(prefix="library-", suffix=".zip", dir=self.root)
        done = 0
        self.progress[lib_id] = {"done": 0, "total": int(size_hint or 0), "state": "downloading"}
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "central-pedal"})
            with self.opener(req, timeout=60) as r, os.fdopen(fd, "wb") as out:
                total = int(r.headers.get("Content-Length") or 0) or int(size_hint or 0)
                self.progress[lib_id]["total"] = total
                while True:
                    block = r.read(1 << 16)
                    if not block:
                        break
                    done += len(block)
                    if done > MAX_DOWNLOAD:
                        raise LibraryError("that download is too big for a library")
                    h.update(block)
                    out.write(block)
                    self.progress[lib_id]["done"] = done
        except LibraryError:
            os.remove(tmp)
            raise
        except Exception as error:  # noqa: BLE001
            try:
                os.remove(tmp)
            except OSError:
                pass
            self.progress[lib_id]["state"] = "failed"
            raise LibraryError("the download didn't finish (%s) - check the internet and try again" % error)
        if h.hexdigest() != sha256.lower():
            os.remove(tmp)
            self.progress[lib_id]["state"] = "failed"
            raise LibraryError("the download doesn't match its checksum (it may be damaged or incomplete) - nothing was installed")
        self.progress[lib_id]["state"] = "installing"
        return tmp

    def install_url(self, url, sha256, lib_id="library", size_hint=0):
        tmp = self.download(url, sha256, lib_id, size_hint)
        try:
            return self.install_file(tmp, expected_sha256=sha256, source=url)
        finally:
            self.progress.pop(lib_id, None)
            try:
                os.remove(tmp)
            except OSError:
                pass

    def install_bytes(self, data, expected_sha256=None, source="file"):
        fd, tmp = tempfile.mkstemp(prefix="library-", suffix=".zip", dir=self.root)
        with os.fdopen(fd, "wb") as out:
            out.write(data)
        try:
            return self.install_file(tmp, expected_sha256=expected_sha256, source=source)
        finally:
            os.remove(tmp)

    def install_file(self, path, expected_sha256=None, source="file"):
        """Installs a library zip (checked against expected_sha256 when given). Returns the installed record."""
        if expected_sha256 is not None:
            if not SHA_RE.match(str(expected_sha256).lower()):
                raise LibraryError("no checksum to check the library against")
            h = hashlib.sha256()
            with open(path, "rb") as handle:
                for block in iter(lambda: handle.read(1 << 20), b""):
                    h.update(block)
            if h.hexdigest() != str(expected_sha256).lower():
                raise LibraryError("the library doesn't match its checksum (it may be damaged or incomplete) - nothing was installed")
        try:
            zf = zipfile.ZipFile(path)
        except (zipfile.BadZipFile, OSError):
            raise LibraryError("that isn't a library file (a .zip from the Downloads page)")
        with zf:
            man = self.read_manifest(zf)
            return self._install(zf, man, source)

    def read_manifest(self, zf):
        try:
            man = json.loads(zf.read("manifest.json").decode("utf-8"))
        except KeyError:
            raise LibraryError("that zip isn't a sound library (no manifest.json)")
        except (ValueError, UnicodeDecodeError):
            raise LibraryError("that library's manifest.json can't be read")
        if not isinstance(man, dict) or not ID_RE.match(str(man.get("id") or "")) or man.get("plan") not in PLANS or not VERSION_RE.match(str(man.get("version") or "")):
            raise LibraryError("that library's manifest.json is missing its id, plan or version")
        if int(man.get("format") or 1) > 1:
            raise LibraryError("that library needs a newer version of the app - update it first")
        items = man.get("items")
        if not isinstance(items, list) or not items:
            raise LibraryError("that library has nothing in it")
        total = 0
        names = set(zf.namelist())
        for it in items:
            if not isinstance(it, dict) or not isinstance(it.get("kind"), str) or not isinstance(it.get("file"), str) or it["file"] not in names:
                raise LibraryError("that library lists a file it doesn't have")
            info = zf.getinfo(it["file"])
            if info.file_size > MAX_ITEM:
                raise LibraryError("a file in that library is too big")
            total += info.file_size
        if total > MAX_TOTAL:
            raise LibraryError("that library is too big to unpack")
        return man

    def _install(self, zf, man, source):
        lib_id, tier = man["id"], man["plan"]   # (every item keeps the library's plan)
        inst = self.instrument
        old = self.record(lib_id)
        if old:
            self.remove(lib_id, keep_record=True)
        rec = {"id": lib_id, "plan": tier, "version": str(man["version"]), "title": str(man.get("title") or lib_id)[:80], "summary": str(man.get("summary") or "")[:400],
               "installedAt": time.strftime("%Y-%m-%dT%H:%M:%S"), "source": source if source == "file" else "website", "sounds": [], "irs": [], "clicks": [], "pads": [],
               "loops": [], "boards": [], "presets": [], "plugins": [], "tier": tier}
        if isinstance(man.get("community"), dict):   # (10.1: an item from Make & sell - who made it, for the label)
            rec["community"] = {"item": man["community"].get("item"), "creator": str(man["community"].get("creator") or "")[:80], "kind": str(man["community"].get("kind") or "")[:20]}
        sound_lines, ir_lines = [], []
        sounds, irs = [], []
        for it in man["items"]:
            if it["kind"] not in KINDS:   # (a kind a newer version knows: left out)
                continue
            data = zf.read(it["file"])
            if it.get("sha256") and sha256_bytes(data) != str(it["sha256"]).lower():
                raise LibraryError("%s in that library is damaged (its checksum doesn't match) - nothing was installed" % it.get("name", it["file"]))
            kind, lic = it["kind"], re.sub(r"[|\n\r]+", " ", str(it.get("license") or ""))[:60]
            if kind == "sound":
                if not inst:
                    raise LibraryError("this device has no instrument sounds to add to")
                name = safe_name(it["file"], lib_id + ".sf2")
                if not name.lower().endswith((".sf2", ".sf3")):
                    raise LibraryError("a sound in that library isn't a SoundFont")
                if " - " not in os.path.splitext(name)[0]:
                    name = "%s - %s.sf2" % (safe_name(it.get("name") or os.path.splitext(name)[0]), lib_id)
                prefix = os.path.splitext(name)[0].split(" - ")[0]
                sound_lines.append("%s|%s|%s|%s" % (prefix, tier, lic, lib_id))
                sounds.append((name, data))
            elif kind == "ir":
                if not inst:
                    raise LibraryError("this device has no IR loader")
                name = safe_name(it["file"], lib_id + ".wav")
                ir_lines.append("%s|%s|%s|%s" % (os.path.splitext(name)[0], tier, lic, lib_id))
                irs.append((name, data))
            elif kind in ("board", "preset"):
                try:
                    b = json.loads(data.decode("utf-8"))
                except (ValueError, UnicodeDecodeError):
                    raise LibraryError("a board in that library can't be read")
                if not isinstance(b, dict) or not isinstance(b.get("chain"), list):
                    raise LibraryError("a board in that library has no pedals")
                b = {"name": str(b.get("name") or it.get("name") or "Board")[:60], "kind": b.get("kind"), "chain": b["chain"][:24], "sound": b.get("sound") if isinstance(b.get("sound"), str) else None,
                     "library": lib_id, "tier": tier}
                rec["boards" if kind == "board" else "presets"].append(b)
            elif kind == "click":
                folder = os.path.join(self.root, lib_id, "clicks")
                os.makedirs(folder, exist_ok=True)
                p = os.path.join(folder, safe_name(it["file"], "click.wav"))
                with open(p, "wb") as handle:
                    handle.write(data)
                rec["clicks"].append({"name": str(it.get("name") or "")[:60], "file": p, "tier": tier})
            elif kind == "pad":
                key = str(it.get("key") or "")
                if key not in PAD_KEYS or not data[:4] == b"RIFF":
                    raise LibraryError("a pad in that library isn't a key's WAV loop")
                style = str(it.get("name") or "Pad")[:60]
                folder = os.path.join(self.root, lib_id, "pads", safe_name(style.replace(" ", "-"), "pad"))
                os.makedirs(folder, exist_ok=True)
                p = os.path.join(folder, key.replace("#", "s") + ".wav")
                with open(p, "wb") as handle:
                    handle.write(data)
                rec["pads"].append({"name": style, "key": key, "file": p, "tier": tier})
            elif kind == "loop":
                if not data[:4] == b"RIFF":
                    raise LibraryError("a loop in that library isn't a WAV file")
                lset = safe_name(str(it.get("set") or "loops"), "loops")
                folder = os.path.join(self.root, lib_id, "loops", lset)
                os.makedirs(folder, exist_ok=True)
                p = os.path.join(folder, safe_name(it["file"], "loop.wav"))
                with open(p, "wb") as handle:
                    handle.write(data)
                entry = {"name": str(it.get("name") or "Loop")[:60], "set": lset, "group": str(it.get("group") or "Loops")[:40], "file": p, "tier": tier}
                for k in ("bpm", "meter", "bars", "seconds"):
                    if isinstance(it.get(k), (int, float)) and 0 < it[k] < 1000:
                        entry[k] = it[k]
                if it.get("key") in PAD_KEYS:
                    entry["key"] = it["key"]
                rec["loops"].append(entry)
            elif kind == "plugin":
                rec["plugins"].append(self._unpack_plugin(lib_id, it, data))
        # the plan lines first (a host that looks at the folder as a sound arrives already sees it locked), then the files
        if sounds:
            tiers_lines_set(inst.sf2_user_dir, lib_id, sound_lines)
        if irs:
            tiers_lines_set(inst.ir_dir, lib_id, ir_lines)
        try:
            for name, data in sounds:
                rec["sounds"].append(inst.add_sf2(name, data)["file"])
            for name, data in irs:
                rec["irs"].append(inst.add_ir(name, data)["file"])
        except Exception as error:
            rec_partial = dict(rec)
            self._write_record(rec_partial)
            self.remove(lib_id)
            raise LibraryError("couldn't add the library's files (%s)" % error)
        rec["counts"] = {"sound": len(rec["sounds"]), "ir": len(rec["irs"]), "board": len(rec["boards"]), "preset": len(rec["presets"]), "click": len(rec["clicks"]),
                         "pad": len({x["name"] for x in rec["pads"]}), "loop": len({(x["set"], x["name"]) for x in rec["loops"]})}
        if rec["plugins"]:
            rec["counts"]["plugin"] = len(rec["plugins"])   # (10.1: community plugins)
        self._write_record(rec)
        log.info("library %s %s installed (%s)", lib_id, rec["version"], rec["counts"])
        return rec

    def _write_record(self, rec):
        path = self.record_path(rec["id"])
        with open(path + ".part", "w", encoding="utf-8") as handle:
            json.dump(rec, handle, indent=1)
        os.replace(path + ".part", path)

    # ----- remove --------------------------------------------------------------------
    def remove(self, lib_id, keep_record=False):
        if not ID_RE.match(str(lib_id or "")):
            raise LibraryError("no such library")
        rec = self.record(lib_id)
        if not rec:
            raise LibraryError("that library isn't installed")
        inst = self.instrument
        allowed = [os.path.realpath(d) for d in ([getattr(inst, "sf2_user_dir", ""), getattr(inst, "ir_dir", "")] if inst else []) if d]
        for p in (rec.get("sounds") or []) + (rec.get("irs") or []):
            real = os.path.realpath(p)
            if any(real.startswith(a + os.sep) for a in allowed):   # (only files in the sound / IR folders)
                try:
                    os.remove(real)
                except OSError:
                    pass
        if inst:
            tiers_lines_set(inst.sf2_user_dir, lib_id, [])
            tiers_lines_set(inst.ir_dir, lib_id, [])
            try:
                if hasattr(inst, "send"):
                    inst.send({"action": "rescan"})
            except Exception:  # noqa: BLE001
                pass
        shutil.rmtree(os.path.join(self.root, lib_id), ignore_errors=True)
        shutil.rmtree(os.path.join(self.plugins_dir(), lib_id), ignore_errors=True)
        if not keep_record:
            try:
                os.remove(self.record_path(lib_id))
            except OSError:
                pass
        return {"ok": True, "id": lib_id, "boards": len(rec.get("boards") or []) + len(rec.get("presets") or [])}
