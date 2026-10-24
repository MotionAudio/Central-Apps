"""Central Pedal - installs the sound libraries (9.8): one zip per sound plan (Central Keys, Central Instrument,
Central Plugins, Central Pedals) from the website's list (/v1/libraries -> a download) or from a file.

Anyone can download a library; what it holds only opens with its plan. So every item keeps its library's plan:
  * sounds (.sf2) go into the keys sounds (the instrument host's own folder - the Pi's FluidSynth or the computers'
    built-in rig) with a line in that folder's tiers.txt ("<bank>|<plan>|<license>|<library id>"), which both hosts
    read: the app shows the sound locked without the plan;
  * impulse responses (.wav) go into the IR folder, with the same kind of tiers.txt line;
  * presets and boards are handed to the app (PPInstrument.addBoard), which keeps the library's plan on them;
  * clicks are kept in <data>/libraries/<id>/clicks.
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
import urllib.request
import zipfile

log = logging.getLogger("pedal-driver.libraries")

PLANS = ("keys", "instrument", "plugins", "pedals")
KINDS = ("sound", "board", "preset", "ir", "click")
MAX_DOWNLOAD = 2 * 1024 ** 3        # a library zip
MAX_ITEM = 700 * 1024 * 1024        # one file inside it
MAX_TOTAL = 2 * 1024 ** 3           # everything inside it, unpacked
ID_RE = re.compile(r"^[a-z0-9-]{3,60}$")
VERSION_RE = re.compile(r"^\d+(\.\d+){0,3}$")
SHA_RE = re.compile(r"^[0-9a-f]{64}$")


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
        return [{k: r.get(k) for k in ("id", "plan", "version", "title", "summary", "installedAt", "counts", "boards", "presets", "source")} for r in self.installed()]

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
            if not isinstance(it, dict) or it.get("kind") not in KINDS or not isinstance(it.get("file"), str) or it["file"] not in names:
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
               "installedAt": time.strftime("%Y-%m-%dT%H:%M:%S"), "source": source if source == "file" else "website", "sounds": [], "irs": [], "clicks": [],
               "boards": [], "presets": [], "tier": tier}
        sound_lines, ir_lines = [], []
        sounds, irs = [], []
        for it in man["items"]:
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
        rec["counts"] = {"sound": len(rec["sounds"]), "ir": len(rec["irs"]), "board": len(rec["boards"]), "preset": len(rec["presets"]), "click": len(rec["clicks"])}
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
        if not keep_record:
            try:
                os.remove(self.record_path(lib_id))
            except OSError:
                pass
        return {"ok": True, "id": lib_id, "boards": len(rec.get("boards") or []) + len(rec.get("presets") or [])}
