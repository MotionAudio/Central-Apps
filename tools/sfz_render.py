"""Central Pedal - reads an SFZ instrument (as the sfzinstruments / Karoryfer libraries write them: #define, #include,
<control> <global> <master> <group> <region>, set_ccN defaults, key switches, round robins, velocity layers, several
microphones layered) and renders it into plain notes for a SoundFont: for each sampled key and velocity layer, every
region that would sound at the instrument's default settings (first round robin, default controllers, default key
switch, attack triggers only) is mixed into one mono sample, at its own level. Used by tools/sounds-sfz.py.

Only what decides which samples sound and how loud is read (key / velocity ranges, pitch_keycenter, tune, transpose,
pitch_keytrack, volume, amplitude, amplitude_onccN, gain_onccN / volume_onccN, offset, end, loccN / hiccN, sw_*,
seq_position, lorand, trigger, ampeg_release); the rest (filters, LFOs, pan) is left to the pedal's own effects."""
import math
import os
import posixpath
import re

NOTE = {"c": 0, "d": 2, "e": 4, "f": 5, "g": 7, "a": 9, "b": 11}
HEADER = re.compile(r"<(\w+)>")
OPCODE = re.compile(r"([A-Za-z_][\w]*)=")


def note_number(v, default=None):
    """An SFZ key: a number, or a note name (c4 = 60, c#4 / db4)."""
    if v is None:
        return default
    s = str(v).strip().lower()
    if re.match(r"^-?\d+$", s):
        return int(s)
    m = re.match(r"^([a-g])(#|b)?(-?\d+)$", s)
    if not m:
        return default
    return 12 * (int(m.group(3)) + 1) + NOTE[m.group(1)] + (1 if m.group(2) == "#" else -1 if m.group(2) == "b" else 0)


def num(v, default=0.0):
    try:
        return float(str(v).strip())
    except (TypeError, ValueError):
        return default


class Sfz:
    """An SFZ program. fetch(path) -> text, for paths relative to the repository; root: the program's path."""

    def __init__(self, fetch, root):
        self.fetch = fetch
        self.root = root
        self.base = posixpath.dirname(root)
        self.defines = {}
        self.control = {}
        self.cc = {}
        self.regions = []
        self._levels = {"global": {}, "master": {}, "group": {}}
        self._cur = None
        self._depth = 0
        self._read(root)

    # ----- reading
    def _text(self, path):
        t = self.fetch(path)
        t = re.sub(r"/\*.*?\*/", " ", t, flags=re.S)
        return t

    def _subst(self, line):
        if "$" not in line:
            return line
        for k in sorted(self.defines, key=len, reverse=True):
            line = line.replace(k, self.defines[k])
        return line

    def _read(self, path):
        self._depth += 1
        if self._depth > 30:
            raise ValueError("SFZ includes nested too deep")
        for raw in self._text(path).splitlines():
            line = raw.split("//")[0].strip()
            if not line:
                continue
            m = re.match(r'^#define\s+(\$\w+)\s+(.+)$', line)
            if m:
                self.defines[m.group(1)] = m.group(2).strip()
                continue
            m = re.match(r'^#include\s+"([^"]+)"', line)
            if m:
                inc = posixpath.normpath(posixpath.join(self.base, self._subst(m.group(1)).replace("\\", "/")))
                self._read(inc)
                continue
            self._line(self._subst(line))
        self._depth -= 1

    def _line(self, line):
        pos = 0
        for hm in list(HEADER.finditer(line)) + [None]:
            end = hm.start() if hm else len(line)
            self._opcodes(line[pos:end])
            if hm:
                self._header(hm.group(1).lower())
                pos = hm.end()

    def _header(self, name):
        if name == "global":
            self._levels = {"global": {}, "master": {}, "group": {}}
            self._cur = self._levels["global"]
        elif name == "master":
            self._levels["master"], self._levels["group"] = {}, {}
            self._cur = self._levels["master"]
        elif name == "group":
            self._levels["group"] = {}
            self._cur = self._levels["group"]
        elif name == "region":
            r = {}
            r.update(self._levels["global"])
            r.update(self._levels["master"])
            r.update(self._levels["group"])
            self.regions.append(r)
            self._cur = r
        elif name == "control":
            self._cur = self.control
        else:   # (<curve>, <effect>, <midi>...: not needed here)
            self._cur = {}

    def _opcodes(self, text):
        if self._cur is None or not text.strip():
            return
        ms = list(OPCODE.finditer(text))
        for i, m in enumerate(ms):
            val = text[m.end(): ms[i + 1].start() if i + 1 < len(ms) else len(text)].strip()
            key = m.group(1)
            if self._cur is self.control and key.startswith("set_cc"):
                self.cc[int(re.sub(r"\D", "", key) or 0)] = num(val)
            self._cur[key] = val

    # ----- which regions sound
    def default_cc(self, n, overrides=None):
        if overrides and n in overrides:
            return overrides[n]
        return self.cc.get(n, 0.0)

    def sample_path(self, r):
        s = (r.get("sample") or "").replace("\\", "/")
        if not s or s.startswith("*"):   # (*sine, *silence...: generated, not a file)
            return None
        dp = (self.control.get("default_path") or "").replace("\\", "/")
        return posixpath.normpath(posixpath.join(self.base, dp, s))

    def key_range(self, r):
        k = note_number(r.get("key"))
        lo = note_number(r.get("lokey"), k if k is not None else 0)
        hi = note_number(r.get("hikey"), k if k is not None else 127)
        center = note_number(r.get("pitch_keycenter"), k if k is not None else 60)
        return lo, hi, center

    def switches(self):
        """The default key switch (sw_default, else the lowest switch any region needs)."""
        d = None
        for r in self.regions:
            if r.get("sw_default"):
                d = note_number(r["sw_default"])
                break
        if d is None:
            sws = [note_number(r.get("sw_last")) for r in self.regions if r.get("sw_last") is not None]
            sws = [s for s in sws if s is not None]
            d = min(sws) if sws else None
        return d

    def active(self, cc=None, exclude=None):
        """The regions that sound at the default settings."""
        sw = self.switches()
        out = []
        for r in self.regions:
            if (r.get("trigger") or "attack") not in ("attack", "first"):
                continue
            if num(r.get("seq_position"), 1) != 1 or num(r.get("lorand"), 0) > 0.001:
                continue
            if any(k.startswith("on_locc") or k.startswith("on_hicc") for k in r):
                continue
            if r.get("sw_last") is not None and sw is not None and note_number(r["sw_last"]) != sw:
                continue
            if r.get("sw_down") is not None or r.get("sw_up") is not None:
                continue
            ok = True
            for k, v in r.items():
                m = re.match(r"^(lo|hi)cc(\d+)$", k)
                if m:
                    val = self.default_cc(int(m.group(2)), cc)
                    if (m.group(1) == "lo" and val < num(v)) or (m.group(1) == "hi" and val > num(v)):
                        ok = False
                        break
            if not ok:
                continue
            p = self.sample_path(r)
            if not p or (exclude and re.search(exclude, p)):
                continue
            out.append(r)
        return out

    def gain(self, r, cc=None):
        """A region's level (linear), from volume, amplitude and the default controllers."""
        db = num(r.get("volume"), 0.0) + num(r.get("global_volume"), 0.0) + num(r.get("master_volume"), 0.0) + num(r.get("group_volume"), 0.0)
        amp = num(r.get("amplitude"), 100.0) / 100.0
        for k, v in r.items():
            m = re.match(r"^amplitude_(?:on)?cc(\d+)$", k)
            if m:
                amp *= num(v) / 100.0 * self.default_cc(int(m.group(1)), cc) / 127.0
            m = re.match(r"^(?:gain|volume)_(?:on)?cc(\d+)$", k)
            if m:
                db += num(v) * self.default_cc(int(m.group(1)), cc) / 127.0
        return amp * 10 ** (db / 20.0)

    def layers(self, regions, key):
        """The velocity layers at a key: [(lovel, hivel)], from the regions that cover it."""
        edges = set()
        for r in regions:
            lo, hi, _ = self.key_range(r)
            if lo <= key <= hi:
                edges.add((int(num(r.get("lovel"), 1)), int(num(r.get("hivel"), 127))))
        if not edges:
            return []
        # (overlapping ranges from several mics: split at every boundary)
        cuts = sorted({lo for lo, _ in edges} | {hi + 1 for _, hi in edges})
        out = []
        for a, b in zip(cuts, cuts[1:]):
            if any(lo <= a and b - 1 <= hi for lo, hi in edges):
                out.append((a, b - 1))
        return out


def render_note(sfz, regions, key, vel, load, cc=None, sr_out=None):
    """Mixes every region sounding at (key, velocity) into one mono note. load(path) -> (samples float32, sr).
    Returns (samples, sr, release seconds) or None when nothing sounds there."""
    import numpy as np
    parts, rel = [], []
    for r in regions:
        lo, hi, center = sfz.key_range(r)
        if not (lo <= key <= hi and num(r.get("lovel"), 1) <= vel <= num(r.get("hivel"), 127)):
            continue
        x, sr = load(sfz.sample_path(r))
        off = int(num(r.get("offset"), 0))
        end = int(num(r.get("end"), 0))
        if end > 0:
            x = x[:end + 1]
        x = x[off:]
        track = num(r.get("pitch_keytrack"), 100.0) / 100.0
        cents = (key - center) * 100.0 * track + num(r.get("tune"), 0.0) + 100.0 * num(r.get("transpose"), 0.0)
        ratio = 2 ** (cents / 1200.0)
        target = sr_out or sr
        step = ratio * sr / target
        if abs(step - 1.0) > 1e-6:
            n = int(len(x) / step)
            x = np.interp(np.arange(n) * step, np.arange(len(x)), x).astype(np.float32)
        parts.append(x * sfz.gain(r, cc))
        rel.append(num(r.get("ampeg_release"), 0.3))
        sr_out = target
    if not parts:
        return None
    n = max(len(p) for p in parts)
    mix = np.zeros(n, np.float32)
    for p in parts:
        mix[:len(p)] += p
    return mix, sr_out, max(rel) if rel else 0.3
