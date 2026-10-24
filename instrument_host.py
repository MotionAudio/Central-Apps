"""
Central Pedal - the native instrument host (imported by pedal-driver.py).

Guitar: a PipeWire filter-chain (real LV2 / LADSPA plugins, each wrapped in a
bypass mixer) running as its own `pipewire -c` client process, fed from the USB
audio interface and linked straight to the chosen output channel of the
combined sink. Keys: FluidSynth (free SoundFont banks + the user's own) with a
small MIDI "router" (transpose, touch curve, sustain) in front of it, through
the same kind of effects chain. Controls change live with pw-cli set-param;
on/off never rebuilds the chain.

The app only ever sends: apply {config}, set {uid, sym, value}, bypass {uid, on},
input {input}, level {levelDb}, keys {keys}, note {note, on, velocity}, playany {playAny}, status.

Play any sound (config.playAny = {on, patch, mode, dry, sensitivity, volume}): the guitar / bass / acoustic plays
any keys sound. The analysis is a plugin (central-usage/native/playany: central-playany.so, LADSPA + LV2) inside the
guitar chain: single notes go to FluidSynth as MIDI notes on PLAYANY_CHANNEL, where the chosen sound is loaded (its
sound goes straight to the instrument's output); chords play the plugin's own synth mode. The dry guitar is mixed
in at the dry blend. On / off, the mode and the blend change live; the chain is only rebuilt the first time.
"""
import json
import logging
import math
import os
import re
import shutil
import socket
import struct
import subprocess
import threading
import time

log = logging.getLogger("instrument")

SF2_DIRS = ["/opt/pad-pedal/sounds", "/usr/share/sounds/sf2", "/usr/share/sounds/sf3", "/usr/share/soundfonts"]
FLUID_PORT = 9800
CONVOLVER_URI = "builtin:convolver"
MAX_KEY_LAYERS = 8
PLAYANY_CHANNEL = 10           # FluidSynth channel of play any sound (the keys layers use 0..7; 9 is drums in GM)
PLAYANY_LABEL = "central_playany"
PLAYANY_MODES = {"auto": 0, "notes": 1, "synth": 2}


def playany_tone(name):
    """The synth mode's voice for a sound's name (the same words as pa_tone_for_name in playany.c)."""
    s = (name or "").lower()
    for tone, words in ((3, ("bass", "sub", "808")), (4, ("organ", "hammond", "b3", "drawbar", "accordion", "harmonium")),
                        (1, ("pad", "string", "choir", "voice", "vox", "warm", "halo", "ambient", "atmos", "swell", "cello", "viol", "orchestra", "ensemble", "aah", "ooh")),
                        (2, ("lead", "brass", "saw", "square", "trumpet", "horn", "sax", "trombone", "synth", "chiptune", "fifths"))):
        if any(w in s for w in words):
            return tone
    return 0


def playany_settings(pa, kind):
    """config.playAny -> the plugin's controls and the mix: {controls: {...}, dry, volume, on, mode, patch}."""
    pa = pa if isinstance(pa, dict) else {}
    on = bool(pa.get("on")) and kind in ("electric", "acoustic", "bass")
    mode = PLAYANY_MODES.get(str(pa.get("mode") or "auto"), 0)
    def num(key, default, lo, hi):
        try:
            return max(lo, min(hi, float(pa.get(key, default))))
        except (TypeError, ValueError):
            return default
    dry, sens, volume = num("dry", 0.0, 0.0, 1.0), num("sensitivity", 0.5, 0.0, 1.0), num("volume", 1.0, 0.0, 1.5)
    patch = pa.get("patch") if isinstance(pa.get("patch"), dict) else {}
    bass = kind == "bass"
    controls = {"Active": 1 if on else 0, "Mode": mode, "Sensitivity": round(sens, 3), "Tone": playany_tone(patch.get("name") or patch.get("file") or ""),
                "Synth level": round(volume, 3), "Low note": 23 if bass else 40, "High note": 67 if bass else 88, "Channel": PLAYANY_CHANNEL,
                "Port": FLUID_PORT if mode != 2 else 0, "Bend": 0 if pa.get("bend") is False else 1}
    return {"on": on, "mode": mode, "dry": dry if on else 1.0, "volume": volume, "controls": controls, "patch": patch}


def mix_gains(on, mix, level_db):
    """The mixer behind every pedal: wet = pedal * mix * level, dry = input * (1 - mix) * level; off = input only."""
    level = db_to_lin(level_db or 0)
    mix = max(0.0, min(1.0, 1.0 if mix is None else float(mix)))
    if not on:
        return 0.0, 1.0
    return mix * level, (1.0 - mix) * level
KEYS_PORT_NAME = "Central Pedal Keys"


def db_to_lin(db):
    return math.pow(10.0, float(db or 0) / 20.0)


# The Studio EQ (builtin:studioeq): a chain of PipeWire's own biquad filters - low cut, low shelf, three bells, high
# shelf, high cut - and an output gain. The computer rig (cu-rig) runs the same filters.
STUDIO_EQ_URI = "builtin:studioeq"
STUDIO_EQ_BANDS = [("hp", "bq_highpass"), ("ls", "bq_lowshelf"), ("p1", "bq_peaking"), ("p2", "bq_peaking"), ("p3", "bq_peaking"), ("hs", "bq_highshelf"), ("lp", "bq_lowpass")]


def studio_eq_value(controls, sym, default):
    try:
        return float(controls.get(sym, default))
    except (TypeError, ValueError):
        return default


def studio_eq_graph(base, controls):
    """Nodes and links of one Studio EQ (one channel). Returns (nodes, links, input port, output port)."""
    v = lambda sym, d: studio_eq_value(controls, sym, d)
    settings = {
        "hp": {"Freq": max(10.0, min(1000.0, v("hp_freq", 20))), "Q": 0.707},
        "ls": {"Freq": max(20.0, min(1000.0, v("ls_freq", 100))), "Q": 0.707, "Gain": max(-18.0, min(18.0, v("ls_gain", 0)))},
        "hs": {"Freq": max(1000.0, min(20000.0, v("hs_freq", 8000))), "Q": 0.707, "Gain": max(-18.0, min(18.0, v("hs_gain", 0)))},
        "lp": {"Freq": max(1000.0, min(20000.0, v("lp_freq", 20000))), "Q": 0.707},
    }
    for b, f, g in (("p1", 250, 0), ("p2", 1000, 0), ("p3", 4000, 0)):
        settings[b] = {"Freq": max(20.0, min(20000.0, v(b + "_freq", f))), "Q": max(0.1, min(10.0, v(b + "_q", 1))), "Gain": max(-18.0, min(18.0, v(b + "_gain", g)))}
    nodes, links, prev = [], [], None
    for band, label in STUDIO_EQ_BANDS:
        ctl = " ".join('"%s" = %s' % (k, ("%.4f" % val).rstrip("0").rstrip(".")) for k, val in settings[band].items())
        nodes.append('{ type = builtin name = %s%s label = %s control = { %s } }' % (base, band, label, ctl))
        if prev:
            links.append('{ output = "%s:Out" input = "%s%s:In" }' % (prev, base, band))
        prev = base + band
    nodes.append('{ type = builtin name = %sog label = mixer control = { "Gain 1" = %.5f } }' % (base, db_to_lin(max(-24.0, min(24.0, v("out_gain", 0))))))
    links.append('{ output = "%s:Out" input = "%sog:In 1" }' % (prev, base))
    return nodes, links, "%shp:In" % base, "%sog:Out" % base


def studio_eq_params(base, sym, value):
    """A Studio EQ knob -> the PipeWire control(s) it moves (for one channel's nodes named base...)."""
    m = re.match(r"^(hp|ls|p1|p2|p3|hs|lp)_(freq|gain|q)$", sym or "")
    if m:
        return {"%s%s:%s" % (base, m.group(1), {"freq": "Freq", "gain": "Gain", "q": "Q"}[m.group(2)]): float(value)}
    if sym == "out_gain":
        return {"%sog:Gain 1" % base: db_to_lin(max(-24.0, min(24.0, float(value))))}
    return {}


def run(cmd, timeout=10, env=None, check=False):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=env)
        if check and r.returncode != 0:
            raise RuntimeError((r.stderr or r.stdout or "").strip()[:200])
        return r
    except subprocess.TimeoutExpired:
        raise RuntimeError("%s timed out" % cmd[0])


# ---------------------------------------------------------------- SoundFont reading / writing
def sf2_presets(path):
    """[{bank, prog, name}] from the phdr chunk, without loading the samples."""
    out = []
    try:
        with open(path, "rb") as handle:
            if handle.read(4) != b"RIFF":
                return out
            handle.read(4)
            if handle.read(4) != b"sfbk":
                return out
            while True:
                head = handle.read(8)
                if len(head) < 8:
                    break
                cid, size = head[:4], struct.unpack("<I", head[4:])[0]
                if cid == b"LIST":
                    ltype = handle.read(4)
                    if ltype == b"pdta":
                        end = handle.tell() + size - 4
                        while handle.tell() < end:
                            sub = handle.read(8)
                            if len(sub) < 8:
                                break
                            sid, ssize = sub[:4], struct.unpack("<I", sub[4:])[0]
                            if sid == b"phdr":
                                data = handle.read(ssize)
                                for i in range(0, len(data) - 38, 38):
                                    name = data[i:i + 20].split(b"\0")[0].decode("latin-1").strip()
                                    prog, bank = struct.unpack("<HH", data[i + 20:i + 24])
                                    if name and name.upper() != "EOP":
                                        out.append({"bank": bank, "prog": prog, "name": name})
                                return out
                            handle.seek(ssize + (ssize & 1), 1)
                        return out
                    handle.seek(size - 4 + (size & 1), 1)
                else:
                    handle.seek(size + (size & 1), 1)
    except OSError:
        pass
    return out


NOTE_RE = re.compile(r"([A-Ga-g])([#b]?)(-?\d)")
NOTE_BASE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def note_from_name(name):
    m = NOTE_RE.search(name)
    if not m:
        m2 = re.search(r"(?<!\d)(\d{2,3})(?!\d)", name)
        if m2 and 0 <= int(m2.group(1)) <= 127:
            return int(m2.group(1))
        return None
    n = NOTE_BASE[m.group(1).upper()] + (1 if m.group(2) == "#" else -1 if m.group(2) == "b" else 0) + (int(m.group(3)) + 1) * 12
    return n if 0 <= n <= 127 else None


def read_wav_mono16(path):
    """(samples: list of int16, rate) - 8/16/24/32-bit PCM and float WAVs, any channel count (summed)."""
    import wave
    try:
        with wave.open(path, "rb") as w:
            ch, sw, rate, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
            raw = w.readframes(n)
    except Exception:
        return None, 0
    if sw == 2:
        vals = struct.unpack("<%dh" % (len(raw) // 2), raw)
    elif sw == 1:
        vals = [(b - 128) << 8 for b in raw]
    elif sw == 3:
        vals = [struct.unpack("<i", raw[i:i + 3] + (b"\xff" if raw[i + 2] & 0x80 else b"\0"))[0] >> 8 for i in range(0, len(raw) - 2, 3)]
    elif sw == 4:
        vals = [v >> 16 for v in struct.unpack("<%di" % (len(raw) // 4), raw)]
    else:
        return None, 0
    if ch > 1:
        vals = [int(sum(vals[i:i + ch]) / ch) for i in range(0, len(vals) - ch + 1, ch)]
    return list(vals), rate


def lv2_dirs():
    """Where LV2 bundles live (LV2_PATH, else the usual places on Linux)."""
    if os.environ.get("LV2_PATH"):
        return [d for d in os.environ["LV2_PATH"].split(os.pathsep) if d]
    dirs = [os.path.expanduser("~/.lv2"), "/usr/local/lib/lv2", "/usr/lib/lv2"]
    try:
        dirs += [os.path.join("/usr/lib", d, "lv2") for d in os.listdir("/usr/lib") if d.endswith("-linux-gnu")]
    except OSError:
        pass
    return dirs


def installed_lv2_uris(dirs=None):
    """The plugin URIs the installed LV2 bundles declare (read from each bundle's manifest.ttl: full <uris> and
    prefixed names). An empty set means no LV2 bundles were found at all (then nothing is filtered)."""
    found = set()
    for base in (dirs if dirs is not None else lv2_dirs()):
        try:
            bundles = os.listdir(base)
        except OSError:
            continue
        for b in bundles:
            path = os.path.join(base, b, "manifest.ttl")
            try:
                with open(path, encoding="utf-8", errors="replace") as handle:
                    text = handle.read()
            except OSError:
                continue
            prefixes = dict(re.findall(r"@prefix\s+([\w-]*):\s*<([^>]*)>", text))
            found.update(re.findall(r"<([^>\s]+)>", text))
            for pfx, local in re.findall(r"(?<![\w<])([\w-]+):([\w#./-]+)", text):
                if pfx in prefixes:
                    found.add(prefixes[pfx] + local)
    return found


_TIERS_CACHE = {}
BANK_TIER_NAMES = ("free", "keys", "instrument", "plugins", "pedals")   # (a sound library can be any plan: Central Plugins has textures)


def bank_tiers(folder):
    """The plan each downloaded bank belongs to, from the tiers.txt get-sounds.sh writes next to the banks:
    one line per bank, "<file prefix>|<tier>|<license>|<name>" (tier: free, keys or instrument). Banks it doesn't list
    (General MIDI sets, the musician's own) have no tier here: the app sorts their sounds by what they are."""
    path = os.path.join(folder, "tiers.txt")
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return {}
    cached = _TIERS_CACHE.get(path)
    if cached and cached[0] == mtime:
        return cached[1]
    tiers = {}
    try:
        with open(path, encoding="utf-8", errors="replace") as handle:
            for line in handle:
                parts = line.strip().split("|")
                if len(parts) >= 2 and parts[0] and not parts[0].startswith("#") and parts[1] in BANK_TIER_NAMES:
                    tiers[parts[0]] = parts[1]
    except OSError:
        return {}
    _TIERS_CACHE[path] = (mtime, tiers)
    return tiers


def ir_tiers(folder):
    """{IR file name without .wav: plan} from the tiers.txt a sound library writes next to its impulse responses."""
    out = {}
    try:
        with open(os.path.join(folder, "tiers.txt"), encoding="utf-8", errors="replace") as handle:
            for line in handle:
                parts = line.strip().split("|")
                if len(parts) >= 2 and parts[0] and not parts[0].startswith("#") and parts[1] in ("free", "keys", "instrument", "plugins", "pedals"):
                    out[parts[0]] = parts[1]
    except OSError:
        pass
    return out


def build_sf2_from_wavs(folder, out_path, name=None):
    """Turn a folder of WAVs named by note (C4.wav, F#3.wav, 60.wav...) into a one-preset SoundFont."""
    samples = []
    for fn in sorted(os.listdir(folder)):
        if not fn.lower().endswith(".wav"):
            continue
        note = note_from_name(os.path.splitext(fn)[0])
        if note is None:
            continue
        data, rate = read_wav_mono16(os.path.join(folder, fn))
        if not data or rate < 8000:
            continue
        samples.append((note, data, rate, os.path.splitext(fn)[0][:19]))
    if not samples:
        return 0
    samples.sort(key=lambda s: s[0])
    name = (name or os.path.basename(folder))[:19]
    # sdta: all samples back to back, each followed by 46 zero samples
    smpl = bytearray()
    shdr = []
    for note, data, rate, sname in samples:
        start = len(smpl) // 2
        smpl += struct.pack("<%dh" % len(data), *data)
        smpl += b"\0" * 92
        end = start + len(data)
        shdr.append((sname, start, end, start, max(start, end - 1), rate, note))
    # instrument zones: each sample covers from the midpoint to the previous note up to the midpoint to the next
    igen = bytearray()
    ibag = bytearray()
    zones = 0
    for i, (note, data, rate, sname) in enumerate(samples):
        lo = 0 if i == 0 else (samples[i - 1][0] + note) // 2 + 1
        hi = 127 if i == len(samples) - 1 else (note + samples[i + 1][0]) // 2
        ibag += struct.pack("<HH", len(igen) // 4, 0)
        igen += struct.pack("<HBB", 43, lo, hi)              # keyRange
        igen += struct.pack("<Hh", 58, note)                 # overridingRootKey
        igen += struct.pack("<Hh", 38, -400)                 # releaseVolEnv: a short natural release
        igen += struct.pack("<HH", 53, i)                    # sampleID (always last)
        zones += 1
    ibag += struct.pack("<HH", len(igen) // 4, 0)            # terminal bag
    inst = struct.pack("<20sH", name.encode("latin-1", "replace").ljust(20, b"\0"), 0) + struct.pack("<20sH", b"EOI".ljust(20, b"\0"), zones)
    pgen = struct.pack("<HH", 41, 0)                         # instrument 0
    pbag = struct.pack("<HH", 0, 0) + struct.pack("<HH", 1, 0)
    phdr = struct.pack("<20sHHHIII", name.encode("latin-1", "replace").ljust(20, b"\0"), 0, 0, 0, 0, 0, 0) + struct.pack("<20sHHHIII", b"EOP".ljust(20, b"\0"), 0, 0, 1, 0, 0, 0)
    shdr_bytes = b"".join(struct.pack("<20sIIIIIBbHH", s[0].encode("latin-1", "replace").ljust(20, b"\0"), s[1], s[2], s[3], s[4], s[5], s[6], 0, 0, 1) for s in shdr)
    shdr_bytes += struct.pack("<20sIIIIIBbHH", b"EOS".ljust(20, b"\0"), 0, 0, 0, 0, 0, 0, 0, 0, 0)
    pmod = imod = b"\0" * 10

    def chunk(cid, data):
        return cid + struct.pack("<I", len(data)) + data + (b"\0" if len(data) & 1 else b"")

    def lst(ltype, *chunks):
        body = ltype + b"".join(chunks)
        return b"LIST" + struct.pack("<I", len(body)) + body

    info = lst(b"INFO", chunk(b"ifil", struct.pack("<HH", 2, 1)), chunk(b"isng", b"EMU8000\0"), chunk(b"INAM", (name + "\0").encode("latin-1", "replace")), chunk(b"IENG", b"Central Pedal\0"))
    sdta = lst(b"sdta", chunk(b"smpl", bytes(smpl)))
    pdta = lst(b"pdta", chunk(b"phdr", phdr), chunk(b"pbag", pbag), chunk(b"pmod", pmod), chunk(b"pgen", pgen + struct.pack("<HH", 0, 0)),
               chunk(b"inst", inst), chunk(b"ibag", bytes(ibag)), chunk(b"imod", imod), chunk(b"igen", bytes(igen) + struct.pack("<HH", 0, 0)), chunk(b"shdr", shdr_bytes))
    body = b"sfbk" + info + sdta + pdta
    with open(out_path, "wb") as handle:
        handle.write(b"RIFF" + struct.pack("<I", len(body)) + body)
    return len(samples)


# ---------------------------------------------------------------- PipeWire helpers
class PW:
    def __init__(self, env):
        self.env = env

    def dump(self):
        r = run(["pw-dump"], timeout=15, env=self.env)
        try:
            return json.loads(r.stdout or "[]")
        except ValueError:
            return []

    def nodes(self, objects=None):
        out = []
        for o in objects if objects is not None else self.dump():
            if o.get("type") == "PipeWire:Interface:Node":
                props = (o.get("info") or {}).get("props") or {}
                out.append({"id": o["id"], "name": props.get("node.name", ""), "desc": props.get("node.description") or props.get("node.nick") or props.get("node.name", ""),
                            "class": props.get("media.class", ""), "channels": props.get("audio.channels"), "props": props})
        return out

    def ports(self, objects=None):
        out = []
        for o in objects if objects is not None else self.dump():
            if o.get("type") == "PipeWire:Interface:Port":
                props = (o.get("info") or {}).get("props") or {}
                out.append({"id": o["id"], "node": props.get("node.id"), "name": props.get("port.name", ""), "dir": props.get("port.direction"), "alias": props.get("port.alias", "")})
        return out

    def links(self, objects=None):
        out = []
        for o in objects if objects is not None else self.dump():
            if o.get("type") == "PipeWire:Interface:Link":
                info = o.get("info") or {}
                out.append({"id": o["id"], "out_port": info.get("output-port-id"), "in_port": info.get("input-port-id"), "out_node": info.get("output-node-id"), "in_node": info.get("input-node-id")})
        return out

    def sources(self, objects=None):
        return [n for n in self.nodes(objects) if n["class"] in ("Audio/Source", "Audio/Duplex") or (n["class"] == "Audio/Source/Virtual")]

    def link(self, out_port_id, in_port_id):
        r = run(["pw-link", str(out_port_id), str(in_port_id)], env=self.env)
        return r.returncode == 0 or "exists" in (r.stderr or "")

    def unlink(self, link_id):
        run(["pw-link", "-d", str(link_id)], env=self.env)

    def set_params(self, node_id, params):
        if not params:
            return True
        parts = []
        for name, value in params.items():
            parts.append('"%s" %s' % (name.replace('"', ""), ("%.6f" % float(value)).rstrip("0").rstrip(".") if isinstance(value, float) else str(value)))
        r = run(["pw-cli", "set-param", str(node_id), "Props", "{ params = [ %s ] }" % " ".join(parts)], env=self.env)
        if r.returncode != 0:
            log.warning("set-param failed: %s", (r.stderr or r.stdout).strip()[:160])
        return r.returncode == 0


# ---------------------------------------------------------------- the host
class InstrumentHost:
    def __init__(self, driver, data_root, app_root):
        self.driver = driver
        self.data_root = data_root
        self.app_root = app_root
        self.dir = os.path.join(data_root, "instrument")
        os.makedirs(self.dir, exist_ok=True)
        self.sf2_user_dir = os.path.join(data_root, "sounds", "sf2")
        self.ir_dir = os.path.join(data_root, "sounds", "ir")
        os.makedirs(self.sf2_user_dir, exist_ok=True)
        self.plugins = self.load_plugins()
        self.lock = threading.RLock()
        self.config = {"kind": "off", "input": {}, "chain": [], "keys": {}, "levelDb": 0, "routing": {}}
        self.procs = {}
        self.node_ids = {}        # "guitar-in" / "guitar-out" / "keys-in" / "keys-out" -> node id
        self.error = None
        self.running = False
        self.input_desc = None
        self.keys_engine = None
        self.fluid_sf = {}        # path -> sfont id
        self.midi_router = None
        self.available = shutil.which("pw-cli") is not None and shutil.which("pw-dump") is not None
        env = dict(os.environ)
        if hasattr(os, "getuid"):
            env.setdefault("XDG_RUNTIME_DIR", "/run/user/%d" % os.getuid())
        self.env = env
        self.pw = PW(env)
        self.last_status = 0
        self.lv2 = None   # probed on first use: can this PipeWire's filter-chain load LV2 plugins?
        self.playany_so = None        # central-playany.so (found / built on first use)
        self.playany_in_chain = False  # the running guitar chain has the play-any plugin in it
        self.playany_fluid = False     # FluidSynth runs for play any sound (not for keys)

    def probe_lv2(self):
        """True when libpipewire-module-filter-chain can host LV2 (PipeWire >= 1.4 or a build with lilv)."""
        if self.lv2 is not None:
            return self.lv2
        uri = next((u for u in self.plugins if not self.plugins[u].get("ladspa")), None)
        result = False
        if uri and shutil.which("pipewire"):
            conf = os.path.join(self.dir, "probe.conf")
            with open(conf, "w") as handle:  # built while self.lv2 is still None, so the LV2 node is kept
                handle.write(self.chain_conf("probe", [{"uid": "probe", "uri": uri, "on": True, "values": {}}], 1, 0, None, 0))
            try:
                proc = subprocess.Popen(["pipewire", "-c", conf], env=self.env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                time.sleep(1.2)
                result = proc.poll() is None
                if proc.poll() is None:
                    proc.terminate()
                    try:
                        proc.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        proc.kill()
            except OSError:
                result = False
        self.lv2 = result
        log.info("filter-chain LV2 support: %s", "yes" if self.lv2 else "no (LADSPA pedals only)")
        return self.lv2

    # ----- play any sound: the plugin ---------------------------------------------
    def find_playany(self, build=True):
        """central-playany.so: shipped (bin/linux-<arch>/ in the Pi release, native/ in Central Control, the dev build),
        or built here from its C sources the first time (they need nothing but a C compiler)."""
        if self.playany_so and os.path.isfile(self.playany_so):
            return self.playany_so
        import platform
        arch = platform.machine() or "aarch64"
        roots = [self.app_root, os.path.dirname(self.app_root or "")]
        cands = [os.environ.get("CC_PLAYANY_SO") or ""]
        for r in roots:
            if r:
                cands += [os.path.join(r, "bin", "linux-" + arch, "central-playany.lv2", "central-playany.so"),
                          os.path.join(r, "central-usage", "native", "build", "central-playany.lv2", "central-playany.so"),
                          os.path.join(r, "central-playany.lv2", "central-playany.so"),
                          os.path.join(r, "native", "central-playany.lv2", "central-playany.so")]
        built = os.path.join(self.dir, "bin", "central-playany.so")
        cands.append(built)
        for c in cands:
            if c and os.path.isfile(c):
                self.playany_so = c
                return c
        if not build:
            return None
        src = next((d for d in (os.path.join(r, "central-usage", "native", "playany") for r in roots if r) if os.path.isfile(os.path.join(d, "playany.c"))), None)
        if not src:
            src = next((d for d in (os.path.join(r, "playany") for r in roots if r) if os.path.isfile(os.path.join(d, "playany.c"))), None)
        cc = shutil.which("cc") or shutil.which("gcc") or shutil.which("clang")
        if not src or not cc:
            return None
        os.makedirs(os.path.dirname(built), exist_ok=True)
        r = run([cc, "-O2", "-fPIC", "-shared", "-o", built + ".part", os.path.join(src, "playany-plugin.c"), os.path.join(src, "playany.c"), "-lm", "-lpthread"], timeout=120)
        if r.returncode != 0 or not os.path.isfile(built + ".part"):
            log.warning("play any sound: building the plugin failed: %s", (r.stderr or r.stdout or "").strip()[-300:])
            return None
        os.replace(built + ".part", built)
        log.info("play any sound: built %s", built)
        self.playany_so = built
        return built

    # ----- catalogue ---------------------------------------------------------
    def load_plugins(self):
        for path in (os.path.join(self.app_root, "instrument-plugins.json"), os.path.join(self.data_root, "instrument-plugins.json")):
            try:
                with open(path) as handle:
                    cat = json.load(handle)
            except (OSError, ValueError):
                continue
            # an LV2 pedal whose plugin package isn't on this computer yet (a Central Pedal updated from a zip before its
            # packages were installed) is left out: the chain skips it and the app shows it "not installed", instead of
            # PipeWire refusing the whole guitar chain
            have = installed_lv2_uris()
            if have:
                gone = [u for u, info in cat.items() if not info.get("ladspa") and not u.startswith(("ladspa:", "builtin:")) and u not in have]
                for u in gone:
                    cat.pop(u, None)
                if gone:
                    log.info("%d pedal plugin(s) not installed here (e.g. %s)", len(gone), gone[0])
            return cat
        return {}

    def plugin(self, uri):
        if uri == CONVOLVER_URI:   # the IR loader: PipeWire's own convolver (no plugin package needed)
            return {"builtin": "convolver", "audio": [{"dir": "in", "sym": "In"}, {"dir": "out", "sym": "Out"}], "controls": []}
        return self.plugins.get(uri)

    def ir_list(self):
        out = []
        if os.path.isdir(self.ir_dir):
            tiers = ir_tiers(self.ir_dir)   # (a sound library's IRs keep its plan)
            for fn in sorted(os.listdir(self.ir_dir)):
                if fn.lower().endswith((".wav", ".flac", ".aif", ".aiff")):
                    item = {"name": os.path.splitext(fn)[0].replace("_", " "), "file": os.path.join(self.ir_dir, fn)}
                    if tiers.get(os.path.splitext(fn)[0]):
                        item["tier"] = tiers[os.path.splitext(fn)[0]]
                    out.append(item)
        return out

    def keys_catalog(self):
        out = []
        seen = set()
        for d in SF2_DIRS + [self.sf2_user_dir]:
            if not os.path.isdir(d):
                continue
            tiers = bank_tiers(d)   # (the user folder too: the sound libraries write their banks' plans there - libraries.py)
            for fn in sorted(os.listdir(d)):
                if not fn.lower().endswith((".sf2", ".sf3")):
                    continue
                path = os.path.join(d, fn)
                real = os.path.realpath(path)
                if path in seen or real in seen:
                    continue
                seen.add(path); seen.add(real)
                presets = sf2_presets(path)
                if presets:
                    base = os.path.splitext(fn)[0]
                    bank_name = (base.split(" - ")[0] if " - " in base else base).replace("_", " ").replace("-", " ").strip()
                    bank_name = re.sub(r"\s+", " ", bank_name)
                    if bank_name.lower() in ("fluidr3 gm", "default gm"):
                        bank_name = "General MIDI (FluidR3)"
                    elif "musescore" in bank_name.lower():
                        bank_name = "MuseScore General (pianos, EPs, basses, strings)"
                    for pr in presets:
                        if pr["name"].strip().lower() in ("instrument", "preset", "untitled", "new preset", "default"):
                            pr["name"] = bank_name
                    tier = tiers.get(base.split(" - ")[0]) if " - " in base else None
                    bank = {"file": path, "name": bank_name, "presets": presets[:512], "user": d == self.sf2_user_dir and not tier}   # (a library's bank isn't "yours")
                    if tier:
                        bank["tier"] = tier   # (which plan opens it: free, keys or instrument - get-sounds.sh lists them)
                    out.append(bank)
        # two General MIDI banks (FluidR3 and the small TimGM6mb) would list every GM sound twice: keep the better one
        if any(b["name"] == "General MIDI (FluidR3)" for b in out):
            out = [b for b in out if not re.search(r"timgm", b["name"], re.I)]
        return out

    def add_sf2(self, name, data):
        name = re.sub(r"[^\w.\- ]+", "", os.path.basename(name)) or "bank.sf2"
        if not name.lower().endswith((".sf2", ".sf3")):
            name += ".sf2"
        path = os.path.join(self.sf2_user_dir, name)
        with open(path + ".part", "wb") as handle:
            handle.write(data)
        os.replace(path + ".part", path)
        presets = sf2_presets(path)
        if not presets:
            os.remove(path)
            raise ValueError("not a SoundFont (.sf2) file")
        return {"file": path, "presets": len(presets)}

    def add_ir(self, name, data):
        """An impulse response for the IR loader pedal (RIFF/WAVE or FLAC), kept in <data>/sounds/ir."""
        if not (data[:4] == b"RIFF" and data[8:12] == b"WAVE") and data[:4] != b"fLaC":
            raise ValueError("not a WAV / FLAC impulse response")
        if len(data) > 8 * 1024 * 1024:
            raise ValueError("that impulse is too long (8 MB at most)")
        os.makedirs(self.ir_dir, exist_ok=True)
        base = re.sub(r"[^\w.\- ]+", "", os.path.basename(name)) or "ir.wav"
        path = os.path.join(self.ir_dir, base)
        with open(path + ".part", "wb") as handle:
            handle.write(data)
        os.replace(path + ".part", path)
        return {"file": path}

    def add_wav_bank(self, name, folder):
        out = os.path.join(self.sf2_user_dir, re.sub(r"[^\w.\- ]+", "", name)[:40] + ".sf2")
        n = build_sf2_from_wavs(folder, out, name)
        if not n:
            raise ValueError("no WAV files named by note (C4.wav, F#3.wav, 60.wav…) in that folder")
        return {"file": out, "presets": 1, "samples": n}

    # ----- status ------------------------------------------------------------
    def status(self):
        inputs = []
        midi_inputs = []
        try:
            if self.available:
                objs = self.pw.dump()
                for n in self.pw.sources(objs):
                    if n["name"].startswith("alsa_input") or "usb" in n["name"].lower():
                        inputs.append({"name": n["name"], "desc": n["desc"], "channels": n["channels"]})
        except Exception as error:
            log.debug("pw status: %s", error)
        try:
            midi_inputs = list((self.driver.midi.ports() if self.driver and self.driver.midi else {}).get("inputs", []))
        except Exception:
            pass
        return {"type": "instrumentStatus", "available": self.available, "running": self.running, "kind": self.config.get("kind", "off"), "error": self.error,
                "input": self.input_desc, "inputs": inputs, "midiInputs": [m for m in midi_inputs if KEYS_PORT_NAME not in m], "keysCatalog": self.keys_catalog(), "keysEngine": self.keys_engine,
                "plugins": self.plugins_for_app(), "latencyMs": 128 / 48.0 if self.running else None,
                "irs": self.ir_list(), "maxKeyLayers": MAX_KEY_LAYERS, "looper": bool(self.config.get("looper")),
                "playAny": {"available": bool(self.find_playany(build=False) or (shutil.which("cc") or shutil.which("gcc"))), "on": bool(playany_settings(self.config.get("playAny"), self.config.get("kind"))["on"]) and self.playany_in_chain, "engine": "plugin"}}

    def plugins_for_app(self):
        """uri -> { controls: [...] } (only what the app needs)"""
        out = {}
        for uri, info in self.plugins.items():
            out[uri] = {"controls": [c for c in info.get("controls", [])], "ain": info.get("ain"), "aout": info.get("aout")}
        return out

    # ----- messages from the app --------------------------------------------
    def handle(self, message, reply):
        action = message.get("action")
        if action == "status":
            reply(self.status())
            return
        if action == "apply":
            self.config = message.get("config") or self.config
            threading.Thread(target=self._apply_safe, daemon=True).start()
            return
        if action == "set":
            self.set_control(message.get("uid"), message.get("sym"), message.get("value"))
            return
        if action == "bypass":
            self.bypass(message.get("uid"), bool(message.get("on")))
            return
        if action == "pedalmix":
            self.pedal_mix(message.get("uid"), on=message.get("on"), mix=message.get("mix"), level_db=message.get("levelDb"))
            return
        if action == "scene":   # several pedals at once (an instrument scene) + keys layers
            for p in message.get("pedals") or []:
                self.pedal_mix(p.get("uid"), on=p.get("on"), mix=p.get("mix"), level_db=p.get("levelDb"))
            if message.get("keys") is not None:
                self.config["keys"] = message.get("keys") or {}
                threading.Thread(target=self._keys_safe, daemon=True).start()
            if message.get("levelDb") is not None:
                self.config["levelDb"] = message.get("levelDb")
                self.apply_level()
            return
        if action == "looper":
            self.config["looper"] = bool(message.get("on"))
            threading.Thread(target=self._relink_safe, daemon=True).start()
            return
        if action == "input":
            self.config["input"] = message.get("input") or {}
            self.apply_input_gain()
            return
        if action == "level":
            self.config["levelDb"] = message.get("levelDb") or 0
            self.apply_level()
            return
        if action == "keys":
            self.config["keys"] = message.get("keys") or {}
            threading.Thread(target=self._keys_safe, daemon=True).start()
            return
        if action == "note":
            self.note(int(message.get("note", 60)), bool(message.get("on")), int(message.get("velocity", 100)))
            return
        if action == "routing":
            self.config["routing"] = message.get("routing") or {}
            threading.Thread(target=self._relink_safe, daemon=True).start()
            return
        if action == "playany":
            self.config["playAny"] = message.get("playAny") or {}
            threading.Thread(target=self._playany_safe, daemon=True).start()

    def _apply_safe(self):
        with self.lock:
            try:
                self.error = None
                self.apply()
            except Exception as error:
                self.error = str(error)[:200]
                log.warning("instrument apply failed: %s", error)
            self.emit_status()

    def _keys_safe(self):
        with self.lock:
            try:
                if self.config.get("kind") == "keys":
                    self.apply_keys_settings()
            except Exception as error:
                self.error = str(error)[:200]
            self.emit_status()

    def _playany_safe(self):
        with self.lock:
            try:
                self.apply_playany()
            except Exception as error:
                self.error = str(error)[:200]
                log.warning("play any sound: %s", error)
            self.emit_status()

    def _relink_safe(self):
        with self.lock:
            try:
                self.link_output()
            except Exception as error:
                log.warning("relink failed: %s", error)

    # ----- the looper tap: a virtual microphone ("Central Pedal loop") that carries the instrument's sound
    # to the app, where the looper records it in time with the song and plays it back on the instrument output
    LOOP_CONF = """context.properties = { log.level = 2 }
context.spa-libs = { audio.convert.* = audioconvert/libspa-audioconvert support.* = support/libspa-support }
context.modules = [
  { name = libpipewire-module-protocol-native }
  { name = libpipewire-module-client-node }
  { name = libpipewire-module-adapter }
  { name = libpipewire-module-loopback
    args = {
      node.description = "Central Pedal loop"
      capture.props = { node.name = "padpedal-loop-in" media.class = Audio/Sink audio.channels = 2 audio.position = [ FL FR ] node.autoconnect = false }
      playback.props = { node.name = "padpedal-loop-src" node.description = "Central Pedal loop" media.class = Audio/Source audio.channels = 2 audio.position = [ FL FR ] }
    }
  }
]
"""

    def link_loop(self, objs=None):
        if not self.config.get("looper") or not self.running:
            proc = self.procs.pop("loop", None)
            if proc and proc.poll() is None:
                proc.terminate()
            return
        if not (self.procs.get("loop") and self.procs["loop"].poll() is None):
            path = os.path.join(self.dir, "loop.conf")
            with open(path, "w") as handle:
                handle.write(self.LOOP_CONF)
            self.procs["loop"] = subprocess.Popen(["pipewire", "-c", path], env=self.env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        node_out = self.node_ids.get(self.chain_name() + "-out")
        for _ in range(30):
            objs = self.pw.dump()
            sink = [n for n in self.pw.nodes(objs) if n["name"] == "padpedal-loop-in"]
            if sink and self.ports_of(sink[0]["id"], "in", objs):
                break
            time.sleep(0.15)
        else:
            raise RuntimeError("looper tap did not appear")
        ins = [p for p in self.ports_of(sink[0]["id"], "in", objs) if "monitor" not in p["name"]]
        outs = self.ports_of(node_out, "out", objs) if node_out else []
        if not outs or not ins:
            return
        for i, p in enumerate(ins[:2]):
            self.pw.link(outs[min(i, len(outs) - 1)]["id"], p["id"])

    def emit_status(self):
        if self.driver:
            self.driver.emit(self.status())

    # ----- building the chain ------------------------------------------------
    def chain_conf(self, name, items, channels, gain_db, gate, level_db, stereo_in=False, playany=None):
        """A filter-chain config. Mono (channels=1) or stereo (2) graph. Each pedal sits behind a bypass mixer.
        playany: {so, controls, dry, volume} puts play any sound in: the plugin hears the input (after the input gain,
        before the gate), and a mixer per channel at the end mixes the guitar (at the dry blend) with its synth mode."""
        nodes, links = [], []
        chans = ["L", "R"][:channels]
        # input gain: a mixer per channel
        for ch in chans:
            nodes.append('{ type = builtin name = gin%s label = mixer control = { "Gain 1" = %.5f } }' % (ch, db_to_lin(gain_db)))
        prev = {ch: "gin%s:Out" % ch for ch in chans}
        if playany:
            ctl = " ".join('"%s" = %s' % (k, ("%.4f" % float(v)).rstrip("0").rstrip(".")) for k, v in playany["controls"].items())
            nodes.append('{ type = ladspa name = pany plugin = "%s" label = "%s" control = { %s } }' % (playany["so"].replace('"', ""), PLAYANY_LABEL, ctl))
            if channels == 1:
                links.append('{ output = "ginL:Out" input = "pany:In" }')
            else:   # a stereo input: the plugin hears both sides
                nodes.append('{ type = builtin name = pasum label = mixer control = { "Gain 1" = 0.5 "Gain 2" = 0.5 } }')
                links.append('{ output = "ginL:Out" input = "pasum:In 1" }')
                links.append('{ output = "ginR:Out" input = "pasum:In 2" }')
                links.append('{ output = "pasum:Out" input = "pany:In" }')
        if gate and gate.get("on") and self.lv2 and self.plugin("http://calf.sourceforge.net/plugins/Gate"):
            for ch in chans:
                nodes.append('{ type = lv2 name = gate%s plugin = "http://calf.sourceforge.net/plugins/Gate" control = { "threshold" = %.5f "range" = 0.0001 "attack" = 2 "release" = 120 } }' % (ch, db_to_lin(gate.get("db", -65))))
                links.append('{ output = "%s" input = "gate%s:in_l" }' % (prev[ch], ch))
                links.append('{ output = "%s" input = "gate%s:in_r" }' % (prev[ch], ch))
                prev[ch] = "gate%s:out_l" % ch
        for it in items:
            if not it.get("on", True) and it.get("skip"):
                continue
            info = self.plugin(it.get("uri", ""))
            if not info:
                log.warning("pedal %s: plugin %s not installed, skipped", it.get("id"), it.get("uri"))
                continue
            if not info.get("ladspa") and not info.get("builtin") and self.lv2 is False:
                log.warning("pedal %s: this PipeWire cannot load LV2 plugins, skipped", it.get("id"))
                continue
            uid = re.sub(r"[^A-Za-z0-9]", "", str(it.get("uid", "p")))[:12] or "p"
            ains = [p for p in info.get("audio", []) if p["dir"] == "in"]
            aouts = [p for p in info.get("audio", []) if p["dir"] == "out"]
            if not ains or not aouts:
                continue
            controls = {}
            for c in info.get("controls", []):
                if c.get("def") is not None:
                    controls[c["sym"]] = c["def"]
            for sym, value in (it.get("values") or {}).items():
                controls[sym] = value
            ctl = " ".join('"%s" = %s' % (k.replace('"', ""), ("%.6f" % float(v)).rstrip("0").rstrip(".")) for k, v in controls.items() if isinstance(v, (int, float)))
            if info.get("builtin") == "studioeq":
                wet, dry = mix_gains(it.get("on", True), it.get("mix"), it.get("levelDb"))
                for ch in (["L"] if channels == 1 else chans):
                    base = uid if channels == 1 else uid + ch
                    eq_nodes, eq_links, eq_in, eq_out = studio_eq_graph(base, controls)
                    nodes.extend(eq_nodes)
                    links.extend(eq_links)
                    src = prev["L"] if channels == 1 else prev[ch]
                    links.append('{ output = "%s" input = "%s" }' % (src, eq_in))
                    nodes.append('{ type = builtin name = m%s label = mixer control = { "Gain 1" = %.4f "Gain 2" = %.4f } }' % (base, wet, dry))
                    links.append('{ output = "%s" input = "m%s:In 1" }' % (eq_out, base))
                    links.append('{ output = "%s" input = "m%s:In 2" }' % (src, base))
                    prev["L" if channels == 1 else ch] = "m%s:Out" % base
                continue
            if info.get("builtin") == "convolver":
                irf = str(it.get("file") or "").replace('"', "")
                if not irf or not os.path.exists(irf):
                    log.warning("IR pedal %s: no impulse file, skipped", it.get("id"))
                    continue
                node = '{ type = builtin name = %s label = convolver config = { filename = "%s" channel = 0 gain = %.4f } }' % (uid, irf, db_to_lin(it.get("irGainDb", 0)))
            elif info.get("ladspa"):
                node = '{ type = ladspa name = %s plugin = "%s" label = "%s" control = { %s } }' % (uid, re.sub(r"\.so$", "", info["ladspa"]), info.get("label", ""), ctl)
            else:
                node = '{ type = lv2 name = %s plugin = "%s" control = { %s } }' % (uid, it["uri"], ctl)
            nodes.append(node)
            wet, dry = mix_gains(it.get("on", True), it.get("mix"), it.get("levelDb"))
            if channels == 1:
                # mono graph: feed every plugin input, sum its outputs
                for p in ains:
                    links.append('{ output = "%s" input = "%s:%s" }' % (prev["L"], uid, p["sym"]))
                nodes.append('{ type = builtin name = m%s label = mixer control = { "Gain 1" = %.4f "Gain 2" = %.4f "Gain 3" = %.4f } }' % (uid, wet if len(aouts) == 1 else wet * 0.5, wet * 0.5 if len(aouts) > 1 else 0.0, dry))
                links.append('{ output = "%s:%s" input = "m%s:In 1" }' % (uid, aouts[0]["sym"], uid))
                if len(aouts) > 1:
                    links.append('{ output = "%s:%s" input = "m%s:In 2" }' % (uid, aouts[1]["sym"], uid))
                links.append('{ output = "%s" input = "m%s:In 3" }' % (prev["L"], uid))
                prev["L"] = "m%s:Out" % uid
            else:
                # stereo graph: stereo plugins get L/R, mono plugins are duplicated per channel
                if len(ains) >= 2 and len(aouts) >= 2:
                    links.append('{ output = "%s" input = "%s:%s" }' % (prev["L"], uid, ains[0]["sym"]))
                    links.append('{ output = "%s" input = "%s:%s" }' % (prev["R"], uid, ains[1]["sym"]))
                    for i, ch in enumerate(chans):
                        nodes.append('{ type = builtin name = m%s%s label = mixer control = { "Gain 1" = %.4f "Gain 2" = %.4f } }' % (uid, ch, wet, dry))
                        links.append('{ output = "%s:%s" input = "m%s%s:In 1" }' % (uid, aouts[i]["sym"], uid, ch))
                        links.append('{ output = "%s" input = "m%s%s:In 2" }' % (prev[ch], uid, ch))
                        prev[ch] = "m%s%s:Out" % (uid, ch)
                else:
                    nodes.pop()  # replace the single node by one per channel
                    for ch in chans:
                        nodes.append(node.replace("name = %s " % uid, "name = %s%s " % (uid, ch), 1))
                        links.append('{ output = "%s" input = "%s%s:%s" }' % (prev[ch], uid, ch, ains[0]["sym"]))
                        nodes.append('{ type = builtin name = m%s%s label = mixer control = { "Gain 1" = %.4f "Gain 2" = %.4f } }' % (uid, ch, wet, dry))
                        links.append('{ output = "%s%s:%s" input = "m%s%s:In 1" }' % (uid, ch, aouts[0]["sym"], uid, ch))
                        links.append('{ output = "%s" input = "m%s%s:In 2" }' % (prev[ch], uid, ch))
                        prev[ch] = "m%s%s:Out" % (uid, ch)
        if playany:   # the guitar at the dry blend + play any sound's synth mode
            for ch in chans:
                nodes.append('{ type = builtin name = pmix%s label = mixer control = { "Gain 1" = %.4f "Gain 2" = 1.0 } }' % (ch, playany["dry"]))
                links.append('{ output = "%s" input = "pmix%s:In 1" }' % (prev[ch], ch))
                links.append('{ output = "pany:Out" input = "pmix%s:In 2" }' % ch)
                prev[ch] = "pmix%s:Out" % ch
        # output level (+ mono sum when the output is a single channel)
        for ch in chans:
            nodes.append('{ type = builtin name = gout%s label = mixer control = { "Gain 1" = %.5f } }' % (ch, db_to_lin(level_db)))
            links.append('{ output = "%s" input = "gout%s:In 1" }' % (prev[ch], ch))
        inputs = " ".join('"gin%s:In 1"' % ch for ch in chans)
        outputs = " ".join('"gout%s:Out"' % ch for ch in chans)
        positions = "[ MONO ]" if channels == 1 else "[ FL FR ]"
        return """context.properties = { log.level = 2 }
context.spa-libs = { audio.convert.* = audioconvert/libspa-audioconvert support.* = support/libspa-support }
context.modules = [
  { name = libpipewire-module-rt args = { nice.level = -11 rt.prio = 83 } flags = [ ifexists nofail ] }
  { name = libpipewire-module-protocol-native }
  { name = libpipewire-module-client-node }
  { name = libpipewire-module-adapter }
  { name = libpipewire-module-filter-chain
    args = {
      node.description = "Central Pedal %(name)s"
      media.name = "Central Pedal %(name)s"
      node.latency = 128/48000
      filter.graph = {
        nodes = [
%(nodes)s
        ]
        links = [
%(links)s
        ]
        inputs = [ %(inputs)s ]
        outputs = [ %(outputs)s ]
      }
      capture.props = { node.name = "padpedal-%(name)s-in" node.autoconnect = false audio.channels = %(ch)d audio.position = %(pos)s node.passive = false }
      playback.props = { node.name = "padpedal-%(name)s-out" node.autoconnect = false audio.channels = %(ch)d audio.position = %(pos)s }
    }
  }
]
""" % {"name": name, "nodes": "\n".join("          " + n for n in nodes), "links": "\n".join("          " + l for l in links), "inputs": inputs, "outputs": outputs, "ch": channels, "pos": positions}

    def start_chain(self, name, conf_text):
        path = os.path.join(self.dir, name + ".conf")
        with open(path, "w") as handle:
            handle.write(conf_text)
        self.stop_chain(name)
        logf = open(os.path.join(self.dir, name + ".log"), "w")
        proc = subprocess.Popen(["pipewire", "-c", path], env=self.env, stdout=logf, stderr=subprocess.STDOUT)
        self.procs[name] = proc
        # wait for the nodes
        for _ in range(40):
            time.sleep(0.15)
            if proc.poll() is not None:
                logf.flush()
                with open(os.path.join(self.dir, name + ".log")) as handle:
                    tail = handle.read()[-400:]
                raise RuntimeError("chain failed to start: " + re.sub(r"\s+", " ", tail))
            ids = {}
            for n in self.pw.nodes():
                if n["name"] == "padpedal-%s-in" % name:
                    ids["in"] = n["id"]
                elif n["name"] == "padpedal-%s-out" % name:
                    ids["out"] = n["id"]
            if "in" in ids and "out" in ids:
                self.node_ids[name + "-in"] = ids["in"]
                self.node_ids[name + "-out"] = ids["out"]
                return ids
        raise RuntimeError("chain nodes did not appear")

    def stop_chain(self, name):
        proc = self.procs.pop(name, None)
        if proc and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()
        self.node_ids.pop(name + "-in", None)
        self.node_ids.pop(name + "-out", None)

    def stop_all(self):
        for name in list(self.procs):
            self.stop_chain(name)
        self.stop_keys()
        self.playany_in_chain = False
        self.running = False
        self.input_desc = None

    # ----- apply -----------------------------------------------------------
    def apply(self):
        kind = self.config.get("kind", "off")
        if not self.available:
            raise RuntimeError("PipeWire tools not found on this system")
        if kind == "off":
            self.stop_all()
            return
        self.probe_lv2()
        inp = self.config.get("input") or {}
        chain = self.config.get("chain") or []
        if kind in ("electric", "acoustic", "bass"):
            pa = self.playany_for_chain()
            if not (pa and pa["on"] and pa["mode"] != 2 and self.playany_fluid):   # (FluidSynth stays only when it plays for play any sound)
                self.stop_keys()
            stereo = inp.get("channel") == "stereo"
            conf = self.chain_conf("guitar", chain, 2 if stereo else 1, inp.get("gainDb", 0), {"on": inp.get("gateOn", True), "db": inp.get("gateDb", -65)}, self.config.get("levelDb", 0), playany=pa)
            self.start_chain("guitar", conf)
            self.playany_in_chain = bool(pa)
            self.link_input()
            if pa and pa["on"] and pa["mode"] != 2:
                self.playany_sound(pa)
            self.link_output()
            self.running = True
        elif kind == "keys":
            self.stop_chain("guitar")
            self.playany_in_chain = False
            if self.playany_fluid:   # FluidSynth was started for play any sound: the keys start it their own way
                self.stop_keys()
            self.start_keys()
            conf = self.chain_conf("keys", chain, 2, 0, None, self.config.get("levelDb", 0))
            self.start_chain("keys", conf)
            self.link_keys()
            self.link_output()
            self.running = True

    # ----- play any sound -------------------------------------------------------
    def playany_for_chain(self):
        """The play-any settings for building the guitar chain, or None (never turned on for this instrument, or the
        plugin is missing). Once it is in the chain it stays (switched off by its Active control), so on / off is live."""
        pa_cfg = self.config.get("playAny")
        if not isinstance(pa_cfg, dict) or not (pa_cfg.get("on") or self.playany_in_chain):
            return None
        so = self.find_playany()
        if not so:
            if pa_cfg.get("on"):
                self.error = "play any sound: its plugin is missing on this pedal (update the software)"
            return None
        pa = playany_settings(pa_cfg, self.config.get("kind"))
        pa["so"] = so
        return pa

    def playany_sound(self, pa):
        """FluidSynth plays the chosen sound on PLAYANY_CHANNEL (started for it when the keys aren't running)."""
        if not (self.procs.get("fluid") and self.procs["fluid"].poll() is None):
            self.start_keys(router=False)
            self.playany_fluid = True
        patch = pa.get("patch") or {}
        path = patch.get("file")
        if not path or not os.path.exists(path):
            patch = self.default_patch() or {}
            path = patch.get("file")
        if not path:
            raise RuntimeError("play any sound: no SoundFont banks installed")
        if path not in self.fluid_sf:
            out = self.fluid("load \"%s\"" % path)
            m = re.search(r"loaded SoundFont has ID (\d+)", out)
            self.fluid_sf[path] = int(m.group(1)) if m else len(self.fluid_sf) + 1
        ch = PLAYANY_CHANNEL
        self.fluid("select %d %d %d %d" % (ch, self.fluid_sf[path], int(patch.get("bank", 0)), int(patch.get("prog", 0))))
        self.fluid("cc %d 7 127" % ch)
        self.fluid("cc %d 10 64" % ch)
        self.fluid("gain %.3f" % (0.8 * float(pa.get("volume", 1.0)) * db_to_lin(self.config.get("levelDb", 0))))

    def apply_playany(self):
        """play any sound changed (the footswitch, the Instrument tab): live when the plugin is already in the chain."""
        kind = self.config.get("kind")
        if kind not in ("electric", "acoustic", "bass") or not self.running:
            return
        pa = self.playany_for_chain()
        if pa and not self.playany_in_chain:   # the first time: the chain is rebuilt with the plugin in it
            self.apply()
            return
        if not pa:
            return
        node = self.node_ids.get("guitar-in")
        if node:
            params = {"pany:%s" % k: v for k, v in pa["controls"].items()}
            params.update({"pmixL:Gain 1": pa["dry"], "pmixR:Gain 1": pa["dry"]})
            self.pw.set_params(node, params)
        if pa["on"] and pa["mode"] != 2:
            self.playany_sound(pa)
            self.link_output()
        elif self.playany_fluid:   # notes off: FluidSynth isn't needed any more
            try:
                self.fluid("cc %d 123 0" % PLAYANY_CHANNEL)
            except OSError:
                pass

    def chain_name(self):
        return "keys" if self.config.get("kind") == "keys" else "guitar"

    def ports_of(self, node_id, direction, objects=None):
        return sorted([p for p in self.pw.ports(objects) if p["node"] == node_id and p["dir"] == direction], key=lambda p: p["name"])

    def unlink_node(self, node_id, side, objects=None):
        for l in self.pw.links(objects):
            if (side == "in" and l["in_node"] == node_id) or (side == "out" and l["out_node"] == node_id):
                self.pw.unlink(l["id"])

    def pick_source(self, objects):
        want = (self.config.get("input") or {}).get("device") or "auto"
        sources = [n for n in self.pw.sources(objects) if not n["name"].startswith("padpedal")]
        if want != "auto":
            for n in sources:
                if n["name"] == want or want.lower() in n["name"].lower():
                    return n
        usb = [n for n in sources if "usb" in n["name"].lower()]
        if usb:
            return usb[0]
        alsa = [n for n in sources if n["name"].startswith("alsa_input")]
        return alsa[0] if alsa else None

    def link_input(self):
        objs = self.pw.dump()
        src = self.pick_source(objs)
        node_in = self.node_ids.get("guitar-in")
        if not node_in:
            return
        self.unlink_node(node_in, "in", objs)
        if not src:
            self.input_desc = None
            raise RuntimeError("no audio input found - plug a USB audio interface into the Pi")
        outs = [p for p in self.ports_of(src["id"], "out", objs) if "monitor" not in p["name"]]
        ins = self.ports_of(node_in, "in", objs)
        ins = [p for p in ins if "monitor" not in p["name"]]
        if not outs or not ins:
            raise RuntimeError("input device has no ports yet")
        chan = (self.config.get("input") or {}).get("channel") or "L"
        if chan == "stereo" and len(ins) >= 2:
            self.pw.link(outs[0]["id"], ins[0]["id"])
            self.pw.link((outs[1] if len(outs) > 1 else outs[0])["id"], ins[1]["id"])
        else:
            pick = outs[1] if chan == "R" and len(outs) > 1 else outs[0]
            self.pw.link(pick["id"], ins[0]["id"])
        self.input_desc = "%s (%s)" % (src["desc"], "both" if chan == "stereo" else "input 2" if chan == "R" else "input 1")

    def output_channel(self):
        r = self.config.get("routing") or {}
        try:
            ch = int(((r.get("buses") or {}).get("instrument") or {}).get("ch", 4))
        except (TypeError, ValueError):
            ch = 4
        bus = (r.get("buses") or {}).get("instrument") or {}
        return ch, bool(bus["st"]) if isinstance(bus.get("st"), bool) else r.get("mode") == "stereo"   # (each output mono or a stereo pair)

    def sink_ports(self, objs):
        sink = None
        for n in self.pw.nodes(objs):
            if n["name"] == "padpedal_out":
                sink = n
                break
        if not sink:  # no combined sink (not the Central Pedal OS): use the default sink
            for n in self.pw.nodes(objs):
                if n["class"] == "Audio/Sink":
                    sink = n
                    break
        if not sink:
            return []
        return [p for p in self.ports_of(sink["id"], "in", objs)]

    def link_output(self):
        name = self.chain_name()
        node_out = self.node_ids.get(name + "-out")
        if not node_out:
            return
        objs = self.pw.dump()
        self.unlink_node(node_out, "out", objs)
        ch, stereo = self.output_channel()
        if ch <= 0:
            return
        sink_in = self.sink_ports(objs)
        outs = self.ports_of(node_out, "out", objs)
        if not sink_in or not outs:
            raise RuntimeError("output sink not ready")
        # sink ports are ordered by channel position in our combined sink: index = channel - 1
        order = ["FL", "FR", "FC", "LFE", "RL", "RR", "SL", "SR"] + ["AUX%d" % i for i in range(0, 32)]
        sink_in.sort(key=lambda p: order.index(p["name"].split("_")[-1]) if p["name"].split("_")[-1] in order else 99)
        targets = [sink_in[ch - 1]] if ch - 1 < len(sink_in) else []
        if stereo and ch < len(sink_in):
            targets.append(sink_in[ch])
        if not targets:
            raise RuntimeError("output channel %d does not exist on this device" % ch)
        self.link_to(outs, targets)
        if self.playany_fluid and name == "guitar":   # play any sound's notes (FluidSynth) go to the same channel(s)
            synth = next((n for n in self.pw.nodes(objs) if n["name"] == "padpedal-keys-synth"), None)
            if synth:
                self.unlink_node(synth["id"], "out", objs)
                self.link_to(self.ports_of(synth["id"], "out", objs), targets)
        try:
            self.link_loop()
        except Exception as error:
            log.warning("looper tap: %s", error)

    def link_to(self, outs, targets):
        if not outs or not targets:
            return
        if len(outs) == 1:
            for t in targets:
                self.pw.link(outs[0]["id"], t["id"])
        elif len(targets) == 1:   # stereo to a mono channel: both sides into it (the sink mixes)
            self.pw.link(outs[0]["id"], targets[0]["id"])
            self.pw.link(outs[1]["id"], targets[0]["id"])
        else:
            self.pw.link(outs[0]["id"], targets[0]["id"])
            self.pw.link(outs[1]["id"], targets[1]["id"])

    # ----- live changes ------------------------------------------------------
    def chain_node(self):
        return self.node_ids.get(self.chain_name() + "-in")

    def set_control(self, uid, sym, value):
        node = self.chain_node()
        if not node or not uid or sym is None:
            return
        uid = re.sub(r"[^A-Za-z0-9]", "", str(uid))[:12]
        stereo = self.config.get("kind") == "keys" or (self.config.get("input") or {}).get("channel") == "stereo"
        item = next((it for it in (self.config.get("chain") or []) if re.sub(r"[^A-Za-z0-9]", "", str(it.get("uid", "")))[:12] == uid), None)
        if item and item.get("uri") == STUDIO_EQ_URI:   # the Studio EQ: its knobs move PipeWire's own filters
            params = {}
            for base in ([uid + "L", uid + "R"] if stereo else [uid]):
                params.update(studio_eq_params(base, sym, value))
            if params:
                self.pw.set_params(node, params)
            item.setdefault("values", {})[sym] = value
            return
        params = {"%s:%s" % (uid, sym): float(value)}
        if stereo:  # mono plugins were duplicated per channel
            params["%sL:%s" % (uid, sym)] = float(value)
            params["%sR:%s" % (uid, sym)] = float(value)
        self.pw.set_params(node, params)
        for it in self.config.get("chain") or []:
            if it.get("uid") == uid or re.sub(r"[^A-Za-z0-9]", "", str(it.get("uid", "")))[:12] == uid:
                it.setdefault("values", {})[sym] = value

    def bypass(self, uid, on):
        self.pedal_mix(uid, on=bool(on))

    def pedal_mix(self, uid, on=None, mix=None, level_db=None):
        """Switch a pedal and / or change its wet-dry mix and its level, live (no restart)."""
        node = self.chain_node()
        if not uid:
            return
        uid = re.sub(r"[^A-Za-z0-9]", "", str(uid))[:12]
        item = None
        for it in self.config.get("chain") or []:
            if re.sub(r"[^A-Za-z0-9]", "", str(it.get("uid", "")))[:12] == uid:
                item = it
                if on is not None:
                    it["on"] = bool(on)
                if mix is not None:
                    it["mix"] = max(0.0, min(1.0, float(mix)))
                if level_db is not None:
                    it["levelDb"] = max(-60.0, min(12.0, float(level_db)))
        if not node or item is None:
            return
        info = self.plugin(item.get("uri", ""))
        aouts = len([p for p in (info or {}).get("audio", []) if p["dir"] == "out"]) if info else 1
        wet, dry = mix_gains(item.get("on", True), item.get("mix"), item.get("levelDb"))
        params = {"m%s:Gain 1" % uid: wet if aouts == 1 else wet * 0.5, "m%s:Gain 2" % uid: wet * 0.5 if aouts > 1 else 0.0, "m%s:Gain 3" % uid: dry,
                  "m%sL:Gain 1" % uid: wet, "m%sL:Gain 2" % uid: dry, "m%sR:Gain 1" % uid: wet, "m%sR:Gain 2" % uid: dry}
        self.pw.set_params(node, params)

    def apply_input_gain(self):
        node = self.node_ids.get("guitar-in")
        inp = self.config.get("input") or {}
        if node:
            g = db_to_lin(inp.get("gainDb", 0))
            self.pw.set_params(node, {"ginL:Gain 1": g, "ginR:Gain 1": g, "gateL:threshold": db_to_lin(inp.get("gateDb", -65)), "gateR:threshold": db_to_lin(inp.get("gateDb", -65))})

    def apply_level(self):
        node = self.chain_node()
        if node:
            g = db_to_lin(self.config.get("levelDb", 0))
            self.pw.set_params(node, {"goutL:Gain 1": g, "goutR:Gain 1": g})
        if self.playany_fluid:
            try:
                pa = playany_settings(self.config.get("playAny"), self.config.get("kind"))
                self.fluid("gain %.3f" % (0.8 * pa["volume"] * db_to_lin(self.config.get("levelDb", 0))))
            except OSError:
                pass

    # ----- keys (FluidSynth) -------------------------------------------------
    def start_keys(self, router=True):
        """FluidSynth. router=False: for play any sound (no keyboard, no keys layers)."""
        if self.procs.get("fluid") and self.procs["fluid"].poll() is None:
            return
        if not shutil.which("fluidsynth"):
            raise RuntimeError("fluidsynth is not installed")
        # a FluidSynth left behind by an earlier run would hold the shell port
        try:
            with socket.create_connection(("127.0.0.1", FLUID_PORT), timeout=0.5):
                pass
            subprocess.run(["pkill", "-f", "^fluidsynth .*shell[.]port[= ]%d" % FLUID_PORT], capture_output=True)
            time.sleep(0.5)
        except OSError:
            pass
        env = dict(self.env)
        env["PIPEWIRE_PROPS"] = '{ node.name = "padpedal-keys-synth" node.autoconnect = false media.role = Music }'
        logf = open(os.path.join(self.dir, "fluidsynth.log"), "w")
        cmd = ["fluidsynth", "-a", "pipewire", "-m", "alsa_seq", "-i", "-s", "-o", "shell.port=%d" % FLUID_PORT, "-o", "midi.portname=Central Pedal Synth",
               "-o", "audio.period-size=128", "-o", "audio.periods=3", "-o", "synth.sample-rate=48000", "-o", "synth.gain=0.8", "-o", "synth.reverb.active=no", "-o", "synth.chorus.active=no", "-o", "synth.polyphony=128"]
        # stdin stays open (a pipe we never write to): with -s fluidsynth still reads the shell and quits on EOF
        self.procs["fluid"] = subprocess.Popen(cmd, env=env, stdout=logf, stderr=subprocess.STDOUT, stdin=subprocess.PIPE)
        self.fluid_sf = {}
        for _ in range(60):
            time.sleep(0.2)
            if self.procs["fluid"].poll() is not None:
                raise RuntimeError("fluidsynth exited (see instrument/fluidsynth.log)")
            try:
                self.fluid("echo ok")
                break
            except OSError:
                continue
        self.keys_engine = "FluidSynth"
        if router:
            self.start_midi_router()
            self.apply_keys_settings()

    def stop_keys(self):
        proc = self.procs.pop("fluid", None)
        if proc and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()
        self.stop_chain("keys")
        self.keys_engine = None
        self.playany_fluid = False
        self.stop_midi_router()

    def fluid(self, command):
        with socket.create_connection(("127.0.0.1", FLUID_PORT), timeout=3) as s:
            s.sendall((command + "\n").encode())
            s.settimeout(1.0)
            out = b""
            try:
                while True:
                    chunk = s.recv(4096)
                    if not chunk:
                        break
                    out += chunk
                    if b"\n" in chunk and len(out) > 2:
                        break
            except socket.timeout:
                pass
            return out.decode(errors="ignore")

    def key_layers(self, keys=None):
        """The keys layers: up to 8 sounds at once, each on its own FluidSynth channel with its own volume,
        pan, octave, key range (split) and velocity range. A config without layers is one layer (the old patch)."""
        keys = keys if keys is not None else (self.config.get("keys") or {})
        layers = [l for l in (keys.get("layers") or []) if isinstance(l, dict)][:MAX_KEY_LAYERS]
        if not layers:
            layers = [{"patch": keys.get("patch") or {}, "volume": 1.0, "on": True}]
        return layers

    def default_patch(self):
        cat = self.keys_catalog()
        if not cat:
            return None
        best = [b for b in cat if "salamander" in b["name"].lower() or "grand" in b["name"].lower()] or cat
        return {"file": best[0]["file"], "bank": best[0]["presets"][0]["bank"], "prog": best[0]["presets"][0]["prog"], "name": best[0]["presets"][0]["name"]}

    def apply_keys_settings(self):
        keys = self.config.get("keys") or {}
        layers = self.key_layers(keys)
        fallback = None
        try:
            for ch in range(MAX_KEY_LAYERS):
                layer = layers[ch] if ch < len(layers) else None
                if not layer or layer.get("on") is False:
                    self.fluid("cc %d 7 0" % ch)
                    self.fluid("cc %d 123 0" % ch)  # all notes off
                    continue
                patch = layer.get("patch") or {}
                path = patch.get("file")
                if not path or not os.path.exists(path):
                    fallback = fallback or self.default_patch()
                    if not fallback:
                        raise RuntimeError("no SoundFont banks installed")
                    patch = fallback
                    path = patch["file"]
                if path not in self.fluid_sf:
                    out = self.fluid("load \"%s\"" % path)
                    m = re.search(r"loaded SoundFont has ID (\d+)", out)
                    self.fluid_sf[path] = int(m.group(1)) if m else len(self.fluid_sf) + 1
                self.fluid("select %d %d %d %d" % (ch, self.fluid_sf[path], int(patch.get("bank", 0)), int(patch.get("prog", 0))))
                self.fluid("cc %d 7 %d" % (ch, int(round(max(0.0, min(1.0, float(layer.get("volume", 1.0)))) * 127))))
                self.fluid("cc %d 10 %d" % (ch, int(64 + max(-1.0, min(1.0, float(layer.get("pan", 0) or 0))) * 63)))
            self.fluid("gain %.3f" % (float(keys.get("volume", 0.8)) * 1.2))
        except OSError as error:
            raise RuntimeError("fluidsynth not responding: %s" % error)
        if self.midi_router:
            self.midi_router.configure(keys, layers)

    def link_keys(self):
        objs = self.pw.dump()
        synth = None
        for _ in range(20):
            for n in self.pw.nodes(objs):
                if n["name"] == "padpedal-keys-synth":
                    synth = n
            if synth:
                break
            time.sleep(0.2)
            objs = self.pw.dump()
        node_in = self.node_ids.get("keys-in")
        if not synth or not node_in:
            raise RuntimeError("keys synth did not appear in PipeWire")
        self.unlink_node(synth["id"], "out", objs)
        outs = self.ports_of(synth["id"], "out", objs)
        ins = [p for p in self.ports_of(node_in, "in", objs) if "monitor" not in p["name"]]
        for i, p in enumerate(ins[:2]):
            self.pw.link(outs[min(i, len(outs) - 1)]["id"], p["id"])
        self.input_desc = "MIDI keyboard"

    def note(self, note, on, velocity):
        try:
            for ch, layer in enumerate(self.key_layers()):
                if layer.get("on") is False:
                    continue
                n = note + 12 * int(layer.get("octave", 0) or 0) + int(layer.get("transpose", 0) or 0)
                if not (int(layer.get("lo", 0)) <= note <= int(layer.get("hi", 127))) or not 0 <= n <= 127:
                    continue
                self.fluid(("noteon %d %d %d" % (ch, n, velocity)) if on else ("noteoff %d %d" % (ch, n)))
        except OSError:
            pass

    # the MIDI router: keyboard -> (transpose, touch curve, sustain) -> FluidSynth
    def start_midi_router(self):
        if self.midi_router:
            return
        try:
            self.midi_router = MidiRouter(self.driver)
            self.midi_router.start()
        except Exception as error:
            log.info("MIDI router not available (%s): the keyboard talks to FluidSynth directly", error)
            self.midi_router = None
            try:
                run(["aconnect", "-x"], env=self.env)
            except Exception:
                pass
            self.connect_keyboard_direct()

    def stop_midi_router(self):
        if self.midi_router:
            self.midi_router.stop()
            self.midi_router = None

    def connect_keyboard_direct(self):
        """Fallback without mido: aconnect every hardware MIDI input to FluidSynth."""
        try:
            r = run(["aconnect", "-i"], env=self.env)
            clients = re.findall(r"client (\d+): '([^']+)'", r.stdout)
            r2 = run(["aconnect", "-o"], env=self.env)
            fluid = re.findall(r"client (\d+): '([^']*FLUID[^']*|[^']*luid[^']*)'", r2.stdout)
            if not fluid:
                return
            for cid, name in clients:
                if "Through" in name or "System" in name or "FLUID" in name:
                    continue
                run(["aconnect", "%s:0" % cid, "%s:0" % fluid[0][0]], env=self.env)
        except Exception:
            pass


class MidiRouter:
    """Reads the keyboard through the driver's MIDI (mido), applies transpose / touch / sustain,
    and plays FluidSynth through a virtual ALSA port that FluidSynth is connected to."""

    def __init__(self, driver):
        import mido
        self.mido = mido
        self.driver = driver
        self.out = mido.open_output(KEYS_PORT_NAME, virtual=True)
        self.transpose = 0
        self.velocity = "normal"
        self.sustain = True
        self.held = {}
        self.layers = [{"on": True}]
        self.running = False

    def configure(self, keys, layers=None):
        self.transpose = int(keys.get("transpose", 0) or 0)
        self.velocity = keys.get("velocity", "normal")
        self.sustain = keys.get("sustain", True) is not False
        self.layers = layers or [{"on": True}]

    def targets(self, note, velocity):
        """(channel, note) for every layer this key plays: key range = split, velocity range = velocity switching."""
        out = []
        for ch, layer in enumerate(self.layers[:MAX_KEY_LAYERS]):
            if layer.get("on") is False:
                continue
            if not (int(layer.get("lo", 0)) <= note <= int(layer.get("hi", 127))):
                continue
            if velocity is not None and not (int(layer.get("velLo", 1)) <= velocity <= int(layer.get("velHi", 127))):
                continue
            n = note + 12 * int(layer.get("octave", 0) or 0) + int(layer.get("transpose", 0) or 0)
            if 0 <= n <= 127:
                out.append((ch, n))
        return out

    def start(self):
        self.running = True
        if self.driver and self.driver.midi:
            self.driver.midi.add_listener(self.on_message)
        # connect our virtual port to FluidSynth (ALSA sequencer)
        for _ in range(20):
            try:
                r = run(["aconnect", "-l"])
                mine = re.search(r"client (\d+): '%s" % re.escape(KEYS_PORT_NAME), r.stdout)
                fluid = re.search(r"client (\d+): '[^']*(FLUID|Central Pedal Synth)[^']*'", r.stdout)
                if mine and fluid:
                    run(["aconnect", "%s:0" % mine.group(1), "%s:0" % fluid.group(1)])
                    return
            except Exception:
                pass
            time.sleep(0.3)

    def stop(self):
        self.running = False
        if self.driver and self.driver.midi:
            self.driver.midi.remove_listener(self.on_message)
        try:
            self.out.close()
        except Exception:
            pass

    def curve(self, v):
        if self.velocity == "soft":
            return int(min(127, 127 * math.pow(v / 127.0, 0.6)))
        if self.velocity == "hard":
            return int(min(127, 127 * math.pow(v / 127.0, 1.5)))
        if self.velocity == "fixed":
            return 100
        return v

    def on_message(self, msg, port_name):
        if not self.running or KEYS_PORT_NAME in (port_name or ""):
            return
        try:
            if msg.type in ("note_on", "note_off"):
                note = msg.note + self.transpose
                if not 0 <= note <= 127:
                    return
                key = (msg.channel, msg.note)
                if msg.type == "note_on" and msg.velocity > 0:
                    vel = self.curve(msg.velocity)
                    sent = self.targets(note, vel)
                    self.held[key] = sent   # the note-off goes to exactly the layers the note-on went to
                    for ch, n in sent:
                        self.out.send(self.mido.Message("note_on", channel=ch, note=n, velocity=vel))
                else:
                    for ch, n in self.held.pop(key, self.targets(note, None)):
                        self.out.send(self.mido.Message("note_off", channel=ch, note=n, velocity=0))
            elif msg.type == "control_change":
                if msg.control == 64 and not self.sustain:
                    return
                if msg.control in (7, 10):   # layer volume / pan belong to the layers, not the keyboard
                    return
                for ch in range(len(self.layers[:MAX_KEY_LAYERS])):
                    self.out.send(msg.copy(channel=ch))
            elif msg.type in ("pitchwheel", "aftertouch"):
                for ch in range(len(self.layers[:MAX_KEY_LAYERS])):
                    self.out.send(msg.copy(channel=ch))
        except Exception:
            pass
