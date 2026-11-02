"""Central Tracks (10.2) - a multisample player: plays notes on real sampled instruments straight from their SFZ
programs, the way a hardware or software sampler would - every velocity layer, the round robins (so no two hits are
the same sample), all the microphones a kit was recorded with (close, overheads, room) at the levels we choose, the
key switches and controllers at their defaults (or ours), the amplitude envelopes, pan, choke groups (an open hi-hat
cut by the closed one) and one voice per key where the program asks for it (a piano's repeated note).

Unlike tools/sfz_render.py (which bakes one mono sample per key and layer into a SoundFont), nothing is thrown away:
a piano note at velocity 61 plays the 61 layer of that key, stereo, as recorded.

  inst = Instrument("piano", cache)                    an instrument from INSTRUMENTS (its samples fetched on demand)
  x = inst.play([(start s, length s, key, velocity, {cc: value} or None)], seconds)     stereo float32 at SR

Every source here is free to use in sold recordings - see SOURCES (licence and credit) and CREDITS below.
Needs numpy and soundfile (FLAC / WAV)."""
import math
import os
import posixpath
import re
import threading
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np

import sfz_render as R

SR = 44100

# source -> (GitHub repository, pinned commit, licence, credit). Licences checked against each repository's LICENSE.
SOURCES = {
    "salamander": ("sfzinstruments/SalamanderGrandPiano", "3382bf9496bba2486f5ab0de55a264d1dfc38404", "CC-BY 3.0",
                   "Salamander Grand Piano V3 by Alexander Holm (CC-BY 3.0, archive.org/details/SalamanderGrandPianoV3); SFZ mapping by kinwie, sfzinstruments"),
    "virtuosity": ("sfzinstruments/virtuosity_drums", "9f04cf9a734527edfbb0a4eee1f674e45bbf71bc", "CC0 1.0",
                   "Virtuosity Drums - Austin McMahon, recorded at Virtuosity Musical Instruments, Boston (CC0 1.0, sfzinstruments)"),
    "growly": ("sfzinstruments/karoryfer.growlybass", "4f483268fc66b5a6d5781d421c0d11b8d08d3fc6", "CC0 1.0",
               "Growlybass - Karoryfer Samples (Squier Jazz Bass, CC0 1.0)"),
    "bngg": ("sfzinstruments/karoryfer.black-and-green-guitars", "b3b3249d37dc977a1a297bd2dc053e6d9b6b805c", "CC0 1.0",
             "Black And Green Guitars - Karoryfer Samples (Gretsch Anniversary, Hofner Club; Brian Wood; CC0 1.0)"),
    "vsco": ("sgossner/VSCO-2-CE", "6dd651d55dde97fd4028699be9d4481f26917891", "CC0 1.0",
             "Versilian Studios Chamber Orchestra 2 Community Edition (VSCO 2 CE, CC0 1.0)"),
}

# name -> source, program, controllers we set, velocity tracking (0..1, None: the program's own), samples kept (s),
# regions left out (a pattern on the sample path), release (s, None: the program's own), level (dB)
INSTRUMENTS = {
    "piano": dict(src="salamander", program="Salamander Grand Piano V3.sfz", cc={7: 100, 10: 64, 64: 0}, veltrack=0.78, keep=9.0, release=0.45, db=0.0),
    "drums": dict(src="virtuosity", program="Programs/02-full-kit.sfz",
                  # (the mics: kick and snare close mics, overheads and the room up; the mid pair and the vintage mic off)
                  cc={1: 31, 4: 127, 101: 127, 102: 80, 103: 120, 104: 70, 105: 110, 106: 127, 107: 0, 109: 105, 110: 127, 111: 0, 113: 0},
                  veltrack=None, keep=4.5, release=None, db=0.0),
    "bass": dict(src="growly", program="growlybass_clean.sfz", cc={}, veltrack=None, keep=6.0, release=0.12, db=0.0, exclude=r"(?i)scrape|noise"),
    "gretsch": dict(src="bngg", program="Programs/04-green_twang.sfz", cc={}, veltrack=None, keep=7.0, release=0.3, db=0.0, exclude=r"(?i)noise|feedback|rel_|release"),
    "hofner": dict(src="bngg", program="Programs/07-black_twang.sfz", cc={}, veltrack=None, keep=7.0, release=0.3, db=0.0, exclude=r"(?i)noise|feedback|rel_|release"),
    "violins": dict(src="vsco", program="ViolinEnsSusVib.sfz", cc={}, veltrack=0.6, keep=8.0, release=0.6, db=0.0),
    "violas": dict(src="vsco", program="ViolaEnsSusVib.sfz", cc={}, veltrack=0.6, keep=8.0, release=0.6, db=0.0),
    "cellos": dict(src="vsco", program="CelloEnsSusVib.sfz", cc={}, veltrack=0.6, keep=8.0, release=0.7, db=0.0),
    "basses": dict(src="vsco", program="ContrabassSusVB.sfz", cc={}, veltrack=0.6, keep=8.0, release=0.7, db=0.0),
}


def credits(used):
    """[(credit, licence)] for the instruments used."""
    seen, out = set(), []
    for name in used:
        src = INSTRUMENTS[name]["src"]
        if src not in seen:
            seen.add(src)
            out.append((SOURCES[src][3], SOURCES[src][2]))
    return out


# ---------------------------------------------------------------- fetching and decoding
_lock = threading.Lock()


def _url(src, path):
    repo, commit = SOURCES[src][:2]
    return "https://raw.githubusercontent.com/%s/%s/%s" % (repo, commit, urllib.parse.quote(path))


def fetch(src, path, cache):
    local = os.path.join(cache, src, path)
    if os.path.isfile(local) and os.path.getsize(local) > 0:
        return local
    os.makedirs(os.path.dirname(local), exist_ok=True)
    last = None
    for _ in range(4):
        try:
            with urllib.request.urlopen(_url(src, path), timeout=120) as r, open(local + ".part", "wb") as f:
                while True:
                    blk = r.read(1 << 20)
                    if not blk:
                        break
                    f.write(blk)
            os.replace(local + ".part", local)
            return local
        except Exception as e:  # noqa: BLE001 - (a flaky connection: try again)
            last = e
    raise RuntimeError("couldn't download %s %s: %s" % (src, path, last))


def decode(path, keep):
    """(stereo float32 (frames, 2), sample rate), cut to `keep` seconds."""
    import soundfile as sf
    with sf.SoundFile(path) as f:
        sr = f.samplerate
        x = f.read(frames=int(keep * sr), dtype="float32", always_2d=True)
    if x.shape[1] == 1:
        x = np.repeat(x, 2, axis=1)
    return x[:, :2].copy(), sr


def hermite(x, pos):
    """x (frames, 2) read at fractional positions (4-point Hermite: a much cleaner pitch shift than straight lines)."""
    i = np.floor(pos).astype(np.int64)
    f = (pos - i)[:, None].astype(np.float32)
    n = len(x)
    xp = np.concatenate([x[:1], x, x[-1:], x[-1:]], axis=0)
    i1 = np.clip(i + 1, 0, n + 2)
    y0, y1, y2, y3 = xp[np.clip(i1 - 1, 0, n + 2)], xp[i1], xp[np.clip(i1 + 1, 0, n + 2)], xp[np.clip(i1 + 2, 0, n + 2)]
    c1 = 0.5 * (y2 - y0)
    c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3
    c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2)
    return ((c3 * f + c2) * f + c1) * f + y1


# ---------------------------------------------------------------- the instrument
class Instrument:
    def __init__(self, name, cache, seed=1):
        spec = INSTRUMENTS[name]
        self.name, self.spec, self.cache = name, spec, cache
        self.src = spec["src"]

        def text(path):
            with open(fetch(self.src, path, cache), encoding="utf-8", errors="replace") as h:
                t = h.read()
            # (an #include or #define in the middle of a line - Salamander writes them so: on a line of its own)
            return re.sub(r'(#include\s+"[^"]+"|#define\s+\$\w+\s+\S+)', lambda m: "\n" + m.group(1) + "\n", t)
        self.sfz = R.Sfz(text, spec["program"])
        for k, v in list(self.sfz.control.items()):        # (high-definition controllers, 0..1: as 0..127)
            m = re.match(r"^set_hdcc(\d+)$", k)
            if m:
                self.sfz.cc.setdefault(int(m.group(1)), R.num(v) * 127)
        self.cc = dict(self.sfz.cc)
        self.cc.update(spec.get("cc") or {})
        sw = self.sfz.switches()
        ex = spec.get("exclude")
        self.regions = []
        for r in self.sfz.regions:
            if (r.get("trigger") or "attack") not in ("attack", "first"):
                continue
            if r.get("sw_last") is not None and sw is not None and R.note_number(r["sw_last"]) != sw:
                continue
            if r.get("sw_down") is not None or r.get("sw_up") is not None:
                continue
            p = self.sfz.sample_path(r)
            if not p or (ex and re.search(ex, p)):
                continue
            lo, hi, center = self.sfz.key_range(r)
            conds = []
            for k, v in r.items():
                m = re.match(r"^(lo|hi)cc(\d+)$", k)
                if m:
                    conds.append((m.group(1), int(m.group(2)), R.num(v)))
            self.regions.append({"r": r, "path": p, "lo": lo, "hi": hi, "center": center, "lovel": R.num(r.get("lovel"), 1), "hivel": R.num(r.get("hivel"), 127),
                                 "seq": (int(R.num(r.get("seq_length"), 1)), int(R.num(r.get("seq_position"), 1))),
                                 "rand": (R.num(r.get("lorand"), 0.0), R.num(r.get("hirand"), 1.0)), "conds": conds,
                                 "group": r.get("group"), "off_by": r.get("off_by"), "one_shot": (r.get("loop_mode") or "") == "one_shot",
                                 "poly": r.get("note_polyphony")})
        self.by_key = {}
        for g in self.regions:
            for k in range(max(0, g["lo"]), min(127, g["hi"]) + 1):
                self.by_key.setdefault(k, []).append(g)
        self.rng = np.random.default_rng(seed)
        self.rr = {}
        self.audio = {}
        self.resampled = {}

    # -- which regions a note plays
    def pick(self, key, vel, cc):
        rnd = float(self.rng.random())
        count = self.rr.get(key, 0)
        self.rr[key] = count + 1
        out = []
        for g in self.by_key.get(key, ()):
            if not (g["lovel"] <= vel <= g["hivel"]):
                continue
            L, P = g["seq"]
            if L > 1 and (count % L) + 1 != P:
                continue
            lo, hi = g["rand"]
            if not (lo <= rnd < hi or (hi >= 1.0 and rnd >= lo)):
                continue
            ok = True
            for side, n, v in g["conds"]:
                val = cc.get(n, self.cc.get(n, 0.0))
                if (side == "lo" and val < v) or (side == "hi" and val > v):
                    ok = False
                    break
            if ok:
                out.append(g)
        return out

    def vel_gain(self, r, vel):
        pts = sorted((int(k.split("_")[-1]), R.num(v)) for k, v in r.items() if re.match(r"^amp_velcurve_\d+$", k))
        if pts and self.spec.get("veltrack") is None:
            xs = [0] + [p[0] for p in pts] + ([127] if pts[-1][0] < 127 else [])
            ys = [0.0] + [p[1] for p in pts] + ([1.0] if pts[-1][0] < 127 else [])
            return float(np.interp(vel, xs, ys))
        t = self.spec["veltrack"] if self.spec.get("veltrack") is not None else R.num(r.get("amp_veltrack"), 100.0) / 100.0
        return 1.0 - t * (1.0 - (vel / 127.0) ** 2)

    # -- the samples
    def load_all(self, paths):
        todo = [p for p in sorted(set(paths)) if p not in self.audio]
        if not todo:
            return
        with ThreadPoolExecutor(8) as ex:
            for p, local in zip(todo, ex.map(lambda p: fetch(self.src, p, self.cache), todo)):
                self.audio[p] = decode(local, self.spec["keep"])

    def at_rate(self, path, step):
        """The sample read at `step` source samples per output sample (pitch and rate together), cached."""
        k = (path, round(step, 6))
        if k not in self.resampled:
            x, _ = self.audio[path]
            n = int((len(x) - 2) / step)
            self.resampled[k] = hermite(x, np.arange(n) * step).astype(np.float32) if abs(step - 1) > 1e-6 else x
            if len(self.resampled) > 600:
                self.resampled.pop(next(iter(self.resampled)))
        return self.resampled[k]

    # -- playing
    def play(self, notes, seconds):
        """notes: [(start s, length s, key, velocity, {cc: value} or None)] -> stereo float32 (frames, 2) at SR."""
        n_out = int(seconds * SR) + 1
        out = np.zeros((n_out, 2), np.float32)
        voices = []
        for start, length, key, vel, cc in sorted(notes, key=lambda z: z[0]):
            vel = int(max(1, min(127, vel)))
            for g in self.pick(int(key), vel, cc or {}):
                voices.append({"g": g, "t": start, "len": length, "key": int(key), "vel": vel, "cut": None})
        # choke groups and one voice per key: an earlier voice is cut when its silencer starts
        by_time = sorted(range(len(voices)), key=lambda i: voices[i]["t"])
        live = []
        for i in by_time:
            v = voices[i]
            g = v["g"]
            for j in live:
                w = voices[j]
                if w["cut"] is not None and w["cut"] <= v["t"]:
                    continue
                if (g["group"] is not None and w["g"]["off_by"] == g["group"]) or (w["g"]["poly"] and w["key"] == v["key"] and w["g"]["group"] == g["group"] and v["t"] > w["t"]):
                    w["cut"] = v["t"]
            live.append(i)
            live = [j for j in live if voices[j]["t"] > v["t"] - 8.0]
        self.load_all([v["g"]["path"] for v in voices])
        rel_default = self.spec.get("release")
        gain_db = self.spec.get("db", 0.0)
        for v in voices:
            g, r = v["g"], v["g"]["r"]
            x, sr = self.audio[g["path"]]
            track = R.num(r.get("pitch_keytrack"), 100.0) / 100.0
            cents = (v["key"] - g["center"]) * 100.0 * track + R.num(r.get("tune"), 0.0) + 100.0 * R.num(r.get("transpose"), 0.0)
            step = 2 ** (cents / 1200.0) * sr / SR
            y = self.at_rate(g["path"], step)
            off = int(R.num(r.get("offset"), 0) / step)
            y = y[off:]
            attack = R.num(r.get("ampeg_attack"), 0.0)
            release = rel_default if rel_default is not None else R.num(r.get("ampeg_release"), 0.05)
            if g["one_shot"]:
                stop = len(y) / SR
            else:
                stop = v["len"] + release
            if v["cut"] is not None:
                stop = min(stop, v["cut"] - v["t"] + max(0.006, R.num(r.get("off_time"), 0.006)))
            m = min(len(y), int(stop * SR))
            if m <= 0:
                continue
            seg = y[:m].copy()
            env = np.ones(m, np.float32)
            a = int(attack * SR)
            if a > 1:
                env[:min(a, m)] = np.linspace(0, 1, a)[:min(a, m)]
            # the note's end (or its cut): a release fade
            end_at = m if g["one_shot"] and v["cut"] is None else min(m, int((v["len"] if not g["one_shot"] else stop) * SR))
            if v["cut"] is not None:
                end_at = min(end_at, int((v["cut"] - v["t"]) * SR))
            if end_at < m:
                tail = m - end_at
                env[end_at:] *= np.exp(-np.arange(tail) / max(1.0, release * SR / 5.0)).astype(np.float32)
            fade = min(256, m)
            env[-fade:] *= np.linspace(1, 0, fade)
            pan = R.num(r.get("pan"), 0.0) / 100.0
            gl = math.cos((pan + 1) * math.pi / 4) * math.sqrt(2)
            gr = math.sin((pan + 1) * math.pi / 4) * math.sqrt(2)
            amp = self.sfz.gain(r, self.cc) * self.vel_gain(r, v["vel"]) * 10 ** (gain_db / 20.0)
            seg *= (env * amp)[:, None]
            seg[:, 0] *= gl
            seg[:, 1] *= gr
            i0 = int(round(v["t"] * SR))
            i1 = min(n_out, i0 + m)
            if i1 > i0:
                out[i0:i1] += seg[:i1 - i0]
        return out
