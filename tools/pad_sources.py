#!/usr/bin/env python3
"""Central Pedal - real recordings our pads are made from (10.2), all CC0 1.0 (public domain, no conditions):

  piano    Grand Piano, Steinway B          VCSL - Versilian Community Sample Library (Versilian Studios), CC0 1.0
  chimes   Hand Chimes                      VCSL, CC0 1.0
  vibes    Vibraphone (soft mallets)        VCSL, CC0 1.0
  psaltery Psaltery, bowed                  VCSL, CC0 1.0
  harp     Concert Harp                     VCSL, CC0 1.0
  organ    Pipe Organ                       VCSL, CC0 1.0
  violins  Violin ensemble, sustained       VSCO 2: Community Edition (Versilian Studios), CC0 1.0
  cellos   Cello ensemble, sustained        VSCO 2: Community Edition, CC0 1.0
 10.3, more: from VCSL - tubular bells, glockenspiel, marimba, kalimba, Dan Tranh (tremolo), ocarina, tenor recorder,
  chromatic harmonica, tenor sax, FM piano (TX81Z), Renaissance organ, Kawai grand, mbira, wine glasses, sleigh bells;
  from VSCO 2 CE - french horn, trumpet, trombone, flute, clarinet, oboe, bassoon, violas, contrabasses. All CC0 1.0.

(Salamander Grand Piano is CC-BY 3.0 and would need credit on every sound; the Steinway from VCSL is CC0 and just as
good for textures, so it's used instead. Nothing here is ShareAlike or NonCommercial.)

  Sources(cache).notes(name) -> [(MIDI note, mono float32 at 32 kHz)]  a few notes across the range, downloaded once
Downloads a handful of files from raw.githubusercontent.com (pinned commits) and keeps them, ready to use, in
<cache>/pad-sources. Needs numpy."""
import importlib.util
import os
import urllib.parse

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SR = 32000


def _load(name, rel):
    s = importlib.util.spec_from_file_location(name, os.path.join(HERE, rel))
    m = importlib.util.module_from_spec(s)
    s.loader.exec_module(m)
    return m


VCSL_URL = "https://github.com/sgossner/VCSL/tree/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e"
VSCO_URL = "https://github.com/sgossner/VSCO-2-CE/tree/6dd651d55dde97fd4028699be9d4481f26917891"
CREDIT = {
    "vcsl": ("Versilian Community Sample Library (VCSL) - Versilian Studios", "CC0 1.0", VCSL_URL),
    "vsco": ("VS Chamber Orchestra 2: Community Edition (VSCO 2 CE) - Versilian Studios", "CC0 1.0", VSCO_URL),
}
# name -> (where, VCSL instrument id or VSCO sfz, notes wanted)
WANT = {
    "piano": ("vcsl", "stw", (36, 48, 60, 72, 84)),
    "chimes": ("vcsl", "chm", (60, 72, 84)),
    "vibes": ("vcsl", "vibs", (53, 65, 77)),
    "psaltery": ("vcsl", "psb", (60, 72)),
    "harp": ("vcsl", "chp", (43, 55, 67, 79)),
    "organ": ("vcsl", "org", (48, 60, 72)),
    "violins": ("vsco", "ViolinEnsSusVib.sfz", (60, 72, 84)),
    "cellos": ("vsco", "CelloEnsSusVib.sfz", (36, 48, 60)),
    # 10.3, more (all CC0 1.0 too)
    "tubular": ("vcsl", "tbl", (60, 72)), "glock": ("vcsl", "glk", (72, 84, 96)), "marimba": ("vcsl", "mar", (48, 60, 72)),
    "kalimba": ("vcsl", "kal", (60, 72)), "zither": ("vcsl", "dantrem", (55, 67)), "ocarina": ("vcsl", "oca", (60, 72, 84)),
    "recorder": ("vcsl", "trec", (55, 67)), "harmonica": ("vcsl", "hm64", (60, 72)), "sax": ("vcsl", "sax", (48, 60)),
    "fmpiano": ("vcsl", "fmp", (48, 60, 72)), "posorgan": ("vcsl", "pos", (48, 60, 72)), "kawai": ("vcsl", "kaw", (48, 60, 72)),
    "mbira": ("vcsl", "mbira", (55, 67)), "wine": ("vcsl", "wine", (63, 74)),
    "sleigh": ("vcsl-raw", ("Idiophones/Struck Idiophones/Sleigh Bells", "sleighbell1_shake1.wav"), (60,)),
    "horn": ("vsco", "FHornSus.sfz", (41, 53, 65)), "trumpet": ("vsco", "TrumpetSus.sfz", (60, 72)), "trombone": ("vsco", "TromboneSus.sfz", (41, 53)),
    "flute": ("vsco", "FluteSusVib.sfz", (72, 84)), "clarinet": ("vsco", "ClarinetSus.sfz", (50, 62)), "oboe": ("vsco", "OboeSusVib.sfz", (62, 74)),
    "bassoon": ("vsco", "BassoonSus.sfz", (36, 48)), "violas": ("vsco", "ViolaEnsSusVib.sfz", (55, 67)), "basses": ("vsco", "ContrabassSusVB.sfz", (28, 40)),
}
SUSTAINED = {"violins", "cellos", "organ", "psaltery", "horn", "trumpet", "trombone", "flute", "clarinet", "oboe", "bassoon", "violas", "basses", "ocarina",
             "recorder", "harmonica", "sax", "posorgan", "zither", "wine"}
UNPITCHED = {"sleigh"}   # (played as recorded, never moved to a note)
CUSTOM = {   # VCSL instruments the sound libraries don't use themselves
    "wine": dict(folder="Idiophones/Friction Idiophones/Wine Glasses", inc=r"_Fast_1_[Mm]ain\.wav$", kind="sus", shift=0),
}


def to_sr(x, sr):
    x = np.asarray(x, np.float64)
    if x.ndim == 2:
        x = x.mean(1)
    if sr != SR:
        x = np.interp(np.arange(int(len(x) * SR / sr)) * sr / SR, np.arange(len(x)), x)
    start = int(np.argmax(np.abs(x) > 0.003 * (np.max(np.abs(x)) or 1)))   # (the silence before the note)
    x = x[max(0, start - 64):]
    return (x / (np.max(np.abs(x)) or 1.0)).astype(np.float32)


def pitch_offset(x, note):
    """How far (cents, -60..60) a recorded note sits from its name: the offset whose harmonics hold the most energy."""
    seg = x[int(0.3 * SR):int(1.5 * SR)]
    if len(seg) < 8192:
        seg = x[:int(1.2 * SR)]
    S = np.abs(np.fft.rfft(seg * np.hanning(len(seg))))
    f = np.fft.rfftfreq(len(seg), 1 / SR)
    best = (-1.0, 0)
    for off in range(-60, 61, 5):
        f0 = 440.0 * 2 ** ((note - 69 + off / 100.0) / 12.0)
        score = float(np.sum(np.interp(f0 * np.arange(1, 9), f, S)))
        best = max(best, (score, off))
    return best[1]


def in_tune(name, note, x):
    """A recording moved onto its note's exact pitch when it sits more than 10 cents off (a pad in a key must be in tune).
    Bells and chimes are left as they are: their partials aren't harmonic, so their pitch can't be read this way."""
    if name in UNPITCHED or name in ("tubular", "chimes", "glock"):
        return x
    off = pitch_offset(np.asarray(x, np.float64), note)
    if abs(off) <= 10:   # (10 cents or less: left as it is - the 10.2 pads made from these recordings stay exactly as they were)
        return x
    ratio = 2 ** (-off / 1200.0)        # (read faster or slower: off cents back to the note)
    return np.interp(np.arange(int(len(x) / ratio)) * ratio, np.arange(len(x)), x).astype(np.float32)


class Sources:
    def __init__(self, cache):
        self.cache = cache
        self.dir = os.path.join(cache, "pad-sources")
        self.mem = {}

    def notes(self, name):
        if name in self.mem:
            return self.mem[name]
        path = os.path.join(self.dir, name + ".npz")
        if not os.path.isfile(path):
            os.makedirs(self.dir, exist_ok=True)
            got = self._fetch(name)
            np.savez_compressed(path + ".part.npz", **{"n%d" % n: x for n, x in got})
            os.replace(path + ".part.npz", path)
        z = np.load(path)
        out = sorted((int(k[1:]), in_tune(name, int(k[1:]), z[k])) for k in z.files)
        self.mem[name] = out
        return out

    def _fetch(self, name):
        where, what, want = WANT[name]
        if where == "vcsl-raw":   # (one recording, unpitched)
            VC = _load("sounds_vcsl", "sounds-vcsl.py")
            x, sr = VC.V.read_wav(VC.fetch_wav(self.cache, what[0], what[1]))
            return [(60, to_sr(x, sr))]
        if where == "vcsl":
            VC = _load("sounds_vcsl", "sounds-vcsl.py")
            VC.INSTR.update(CUSTOM)
            names = [l.strip() for l in open(os.path.join(HERE, "vcsl-names.txt"), encoding="utf-8") if l.strip()]
            plan = VC.plan_instrument(what, names)
            spec = VC.INSTR[what]
            loaded = []
            for w in want:   # the nearest recorded note to each wanted one, its middle dynamic layer
                n = min(plan, key=lambda k: abs(k - w))
                files = plan[n]
                rel = files[len(files) // 2]
                x, sr = VC.V.read_wav(VC.fetch_wav(self.cache, spec["folder"], rel))
                loaded.append((n, x, sr))
            shift = spec["shift"] if "shift" in spec else VC.octave_shift(loaded)
            out = {}
            for n, x, sr in loaded:
                out[n + shift] = to_sr(x, sr)
            return sorted(out.items())
        V = _load("sounds_vsco", "../sounds-vsco.py")
        sfz = V.fetch(V.RAW + urllib.parse.quote(what), os.path.join(self.cache, "vsco", what))
        with open(sfz, encoding="utf-8", errors="replace") as handle:
            regions, default_path = V.parse_sfz(handle.read())
        out = {}
        for w in want:
            r = min(regions, key=lambda r: (abs(int(r.get("pitch_keycenter", r.get("key", 60))) - w), abs(int(r.get("hivel", 127)) - 100)))
            n = int(r.get("pitch_keycenter", r.get("key", 60)))
            rel = (default_path + r["sample"].replace("\\", "/")).lstrip("/")
            local = os.path.join(self.cache, "vsco", rel)
            V.fetch(V.RAW + urllib.parse.quote(rel), local)
            x, sr = V.read_wav(local)
            out[n] = to_sr(x, sr)
        return sorted(out.items())


class Stand:
    """Stand-in recordings for tests (no internet): a ringing tone for each source, so the styles still build."""

    def notes(self, name):
        out = []
        t = np.arange(int(3.0 * SR)) / SR
        for n in WANT[name][2]:
            f = 440.0 * 2 ** ((n - 69) / 12.0)
            x = sum(np.sin(2 * np.pi * f * k * t) / k ** 1.3 * np.exp(-t * k / (3.0 if name in SUSTAINED else 1.2)) for k in range(1, 8))
            out.append((n, (x / np.max(np.abs(x))).astype(np.float32)))
        return out
