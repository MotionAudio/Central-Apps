"""Central Tracks hymns (10.2): a modern worship band plays each hymn - the way the multitracks churches buy are made.

The form (hymns/hymns.json "form", each section with a "role"):
  intro      pad and an ambient guitar or a piano motif
  verse      sparse: piano and pad, a soft kick pulse at most
  verse2     the band comes in lightly: a rim click, hats, the bass on long notes
  pre        it builds: floor toms, eighth-note bass, the guitar's dotted-eighth line, a swell into what's next
  chorus     the full band ("All in"): the groove, a driven rhythm guitar, the bass locked to the kick
  interlude  the band, a little lighter, under the motif
  drop       "Down": piano, pad and a guitar swell only
  bridge     starts down and builds: toms, a riser and a reversed cymbal, strings swelling into...
  final      the biggest chorus ("All in"): everything, strings on top
  tag        the last line again, half-time, coming down
  outro      pad, the motif and the last chord ringing

The instruments are real recordings played note by note (tools/sampler.py): the Salamander grand piano, the
Virtuosity drum kit (close mics, overheads, room), the Growlybass, the Gretsch and Hofner guitars (Black And Green
Guitars) through our own amp, delays and shimmer, and the VSCO 2 string sections; the synth pad is ours
(tools/pad_voices.py). The drummer plays like one: ghost notes, fills into sections, the snare a hair behind the
beat, cymbal swells; the bass locks to the kick.

Each stem is EQ'd for its place (the kick and bass apart, the guitars and keys clear of the singers' range),
compressed, sent to a plate or a hall, its delays in time with the song; the stems are level-matched (sum them at
unity: a balanced mix) and unmastered; the mix gets bus glue and a limiter, at about -14 LUFS.

  render(hymn, secs, opt) -> {stem: stereo float32 (frames, 2)}, mix (frames, 2)
With opt["gm"] (tests, offline): the same parts on a General MIDI SoundFont instead of the sampled instruments."""
import math
import os

import numpy as np

import hymn_arranger as HA
import midi_render as M
import pad_dsp as PD
import pad_voices as PV
import sampler as SM

SR = 44100
STEMS = ("Drums", "Percussion", "Bass", "Keys", "Synth", "Electric 1", "Electric 2", "Strings")
ROLE_E = {"intro": 0.2, "verse": 0.3, "verse2": 0.5, "pre": 0.55, "chorus": 0.85, "interlude": 0.65, "drop": 0.3, "bridge": 0.5,
          "final": 1.0, "tag": 0.6, "outro": 0.2}
# each hymn's flavour: the groove, the pad, the motif's rhythm (beats), how wide and how bright, and how the players
# play it - keys: chords (pushes) / pulse (driving eighths) / arp (broken chords) / gospel (anticipations) / sparse;
# Electric 1: dotted (dotted-eighth lines) / quarter / arp16 / swell (volume swells only);
# Electric 2: eighths (power chords) / strum (open chords, down-up) / chug (palm-muted) / whole (ringing chords);
# bells: the motif an octave up (Christmas)
FLAVORS = {
    "ballad-68": dict(groove="six-eight", pad="Worship", motif=(0, 1, 1.5, 2), tone="warm", strings=1.0, keys="chords", amb="dotted", drv="strum"),
    "folk-68": dict(groove="six-eight", pad="Warm", motif=(0, 0.5, 1.5, 2.5), tone="bright", strings=0.7, keys="pulse", amb="quarter", drv="strum"),
    "celtic-68": dict(groove="six-eight-toms", pad="Air", motif=(0, 0.5, 1, 1.5, 2, 2.5), tone="warm", strings=1.0, keys="arp", amb="arp16", drv="eighths"),
    "anthem-half": dict(groove="half-time", pad="Cinematic", motif=(0, 1.5, 3), tone="warm", strings=1.0, keys="chords", amb="dotted", drv="eighths"),
    "anthem-drive": dict(groove="drive", pad="Analog", motif=(0, 0.75, 1.5, 2.5, 3), tone="bright", strings=0.6, keys="pulse", amb="dotted", drv="eighths"),
    "piano-anthem": dict(groove="half-time", pad="Warm", motif=(0, 1, 2, 2.5, 3), tone="warm", strings=1.2, keys="arp", amb="swell", drv="whole"),
    "cathedral-anthem": dict(groove="half-time-toms", pad="Heaven", motif=(0, 2, 3), tone="warm", strings=1.3, keys="chords", amb="swell", drv="eighths"),
    "gospel-98": dict(groove="nine-eight", pad="Worship", motif=(0, 1 / 3, 1, 2), tone="warm", strings=1.0, keys="gospel", amb="quarter", drv="whole"),
    "country-drive": dict(groove="train", pad="Analog", motif=(0, 0.5, 1, 2, 2.5), tone="bright", strings=0.6, keys="pulse", amb="quarter", drv="chug"),
    # 10.3
    "anthem-ride": dict(groove="ride", pad="Cinematic", motif=(0, 1, 1.5, 3), tone="bright", strings=1.1, keys="chords", amb="dotted", drv="eighths"),
    "piano-ballad": dict(groove="half-time", pad="Warm", motif=(0, 1.5, 2, 3), tone="warm", strings=1.1, keys="arp", amb="swell", drv="whole"),
    "gospel-68-up": dict(groove="six-eight", pad="Worship", motif=(0, 0.5, 1, 2), tone="bright", strings=0.8, keys="gospel", amb="quarter", drv="strum"),
    "fortress": dict(groove="half-time-toms", pad="Cinematic", motif=(0, 2, 3), tone="warm", strings=1.3, keys="chords", amb="swell", drv="chug"),
    "hall-ballad": dict(groove="half-time", pad="Heaven", motif=(0, 2), tone="warm", strings=1.3, keys="sparse", amb="swell", drv="whole"),
    "soft-pulse": dict(groove="six-four", pad="Air", motif=(0, 1.5, 3, 4.5), tone="warm", strings=1.0, keys="arp", amb="dotted", drv="whole"),
    "christmas-anthem": dict(groove="ride", pad="Heaven", motif=(0, 1, 2, 3), tone="bright", strings=1.3, keys="chords", amb="arp16", drv="eighths", bells=True),
    "christmas-68": dict(groove="six-eight", pad="Air", motif=(0, 0.5, 1.5, 2.5), tone="warm", strings=1.2, keys="arp", amb="dotted", drv="strum", bells=True),
    "christmas-waltz": dict(groove="waltz", pad="Warm", motif=(0, 1, 2), tone="bright", strings=1.2, keys="pulse", amb="quarter", drv="strum", bells=True),
    "lullaby": dict(groove="waltz", pad="Air", motif=(0, 1, 2), tone="warm", strings=1.0, keys="sparse", amb="swell", drv="whole", bells=True),
    "easter-anthem": dict(groove="drive", pad="Analog", motif=(0, 0.5, 1.5, 2, 3), tone="bright", strings=1.2, keys="pulse", amb="dotted", drv="eighths"),
}
# the mix's dynamics: each section's level (dB) on every stem - quiet verses, a build, and the final chorus the peak
DYN = {"intro": -4.0, "verse": -3.0, "verse2": -2.0, "pre": -1.5, "chorus": -0.5, "interlude": -1.0, "drop": -3.5, "bridge": -2.5,
       "final": 1.0, "tag": -1.5, "outro": -3.5}
# GM programs for the offline test render
GM = {"piano": 0, "bass": 33, "gretsch": 27, "hofner": 29, "violins": 48, "violas": 48, "cellos": 48, "basses": 48}
K, S, X, HH, PEDAL, RIDE, BELL, CRASH, CRASH2, LT, HT, TAMB, SHAKE, XSTICK, CHINA = 36, 38, 37, 42, 44, 51, 53, 49, 57, 41, 48, 54, 70, 88, 55
JINGLE = 83
OPEN, CLOSED = {4: 0}, {4: 127}


def _pc(name):
    return HA._pc(name)


class Song:
    def __init__(self, hymn, secs, seed):
        self.h = hymn
        self.bpm, self.m = hymn["bpm"], hymn["meter"]
        self.beat = 60.0 / self.bpm
        self.key = _pc(hymn["key"])
        self.fl = dict(keys="chords", amb="dotted", drv="eighths", bells=False)
        self.fl.update(FLAVORS.get(hymn.get("style"), FLAVORS["ballad-68" if self.m == 3 else "soft-pulse" if self.m == 6 else "anthem-half"]))
        if self.m == 6:
            self.fl["groove"] = "six-four"
        self.sub = 3 if self.fl["groove"] == "nine-eight" else 2
        # where the backbeats fall, and the chord pushes
        self.backbeats = {4: [1, 3], 6: [3]}.get(self.m, [1, 2] if self.fl["groove"] == "waltz" else [1.5] if self.sub == 2 else [2])
        self.pushes = {4: [0, 1.5, 2.5], 6: [0, 1.5, 3, 4.5]}.get(self.m, [0, 1, 2] if self.fl["groove"] == "waltz" or self.sub == 3 else [0, 1.5])
        self.accent = 3 if (self.m == 3 and self.fl["groove"] != "waltz") else 2       # (eighths per accent)
        self.rng = np.random.default_rng(seed)
        self.bars = []
        for si, s in enumerate(secs):
            role = s.get("role") or "verse"
            nxt = secs[si + 1] if si + 1 < len(secs) else None
            for i, b in enumerate(s["bars"]):
                n = len(s["bars"])
                e = ROLE_E.get(role, 0.5)
                if role == "bridge":           # (down for its first half, then building)
                    e = 0.3 if i < n / 2 else 0.5 + 0.45 * (i - n / 2 + 1) / max(1, n / 2)
                if role == "pre":
                    e = 0.45 + 0.3 * (i + 1) / n
                self.bars.append({"i": s["start"] - 1 + i, "sec": s, "si": si, "role": role, "pos": i, "n": n, "chords": b, "e": e,
                                  "first": i == 0, "last": i == n - 1, "next_role": (nxt.get("role") or "verse") if nxt else None,
                                  "final": nxt is None and i == n - 1, "half": role == "bridge" and i >= n / 2})
        self.seconds = (self.bars[-1]["i"] + 1) * self.m * self.beat if self.bars else 0
        for k, b in enumerate(self.bars):
            b["next_e"] = self.bars[k + 1]["e"] if k + 1 < len(self.bars) else 0.0

    # time
    def t(self, bar, beat=0.0):
        return (bar["i"] * self.m + beat) * self.beat

    def loose(self, ms):
        return float(self.rng.normal(0, ms / 1000.0))

    def segs(self, bar):
        out = []
        cs = bar["chords"]
        for j, (ch, beat) in enumerate(cs):
            end = cs[j + 1][1] if j + 1 < len(cs) else self.m + 1
            out.append((ch, beat - 1, end - beat))
        return out

    def pcs(self, ch, color=True):
        out = []
        for iv in ch["ivs"]:
            pc = (ch["root"] + iv) % 12
            if pc not in out:
                out.append(pc)
        major = 4 in ch["ivs"] and 7 in ch["ivs"]
        rel = (ch["root"] - self.key) % 12
        if color and major and rel in (0, 5, 7) and len(out) == 3:      # (worship colour: the add9 on I, IV and V)
            out.append((ch["root"] + 2) % 12)
        return out

    @staticmethod
    def near(pc, lo, hi, prev=None):
        c = [n for n in range(lo, hi + 1) if n % 12 == pc]
        if not c:
            return lo + (pc - lo) % 12
        return min(c, key=lambda n: abs(n - (prev if prev is not None else (lo + hi) / 2)))

    def voicing(self, ch, lo, hi, count, prev, center):
        pcs = self.pcs(ch)
        cands = []
        for start in range(lo, hi + 1):
            if start % 12 not in pcs:
                continue
            seq = pcs[pcs.index(start % 12):] + pcs[:pcs.index(start % 12)]
            notes = [start]
            for pc in seq[1:count]:
                n = notes[-1] + 1
                while n % 12 != pc:
                    n += 1
                notes.append(n)
            if notes[-1] <= hi and len(notes) == min(count, len(pcs)):
                cands.append(notes)
        if not cands:
            return [self.near(ch["root"], lo, hi)]
        if prev and len(prev) == len(cands[0]):
            return min(cands, key=lambda v: sum(abs(a - b) for a, b in zip(v, prev)) + 0.2 * abs(np.mean(v) - center))
        return min(cands, key=lambda v: abs(np.mean(v) - center))

    def vel(self, bar, base, spread=5, add=0):
        return int(max(15, min(125, base + 40 * bar["e"] + add + self.rng.integers(-spread, spread + 1))))


# ---------------------------------------------------------------- the parts: notes [(start s, length s, key, vel, cc)]
def drums(song):
    kit, kicks = [], {}
    m, fl = song.m, song.fl["groove"]
    for b in song.bars:
        role, e = b["role"], b["e"]
        hits = []
        t0 = song.t(b)
        if b["final"]:
            if e > 0.35:
                hits += [(0, K, 110, None), (0, CRASH, 112, None), (0, CRASH2, 100, None)]
            for at, k, v, cc in hits:
                kit.append((t0 + at * song.beat, 3.0, k, v, cc))
            continue
        quiet = role in ("intro", "outro", "drop") or (role == "verse") or (role == "bridge" and not b["half"])
        if quiet:
            if role == "verse" and b["pos"] >= b["n"] / 2:                      # (a felt kick on the one, later in the verse)
                hits.append((0, K, 44 + int(10 * b["pos"] / b["n"]), None))
            elif role == "bridge":                                              # (the floor tom, a heartbeat)
                hits += [(0, LT, 50 + 4 * b["pos"], None)] + ([(m / 2, LT, 40, None)] if m in (4, 6) else [])
        else:
            hits += groove(song, b, fl)
        # fills into a bigger section, and the build's last bar
        big_next = b["last"] and b["next_role"] in ("chorus", "final", "interlude", "pre") and b["next_e"] > e - 0.05 and not quiet
        if (b["last"] and role in ("pre", "bridge")) or big_next:
            cut = m - (2 if role in ("pre", "bridge") or b["next_role"] == "final" else 1)
            hits = [x for x in hits if x[0] < cut or x[1] in (HH, RIDE, SHAKE)]
            steps = int((m - cut) * 4)
            seq = [S, S, HT, HT, LT, LT, S, S, HT, HT, LT, LT][-steps:]
            for k, note in enumerate(seq):
                hits.append((cut + k / 4, note, int(70 + 45 * k / max(1, steps - 1)), None))
        elif b["last"] and role in ("chorus", "final") and b["next_role"] in ("drop", "bridge", "tag", "outro", "interlude"):
            hits = [x for x in hits if x[0] < m - 1] + [(m - 1, S, 96, None), (m - 0.5, HT, 90, None)]
        for at, k, v, cc in hits:
            late = 0.010 if k in (S, X, XSTICK) else 0.0
            j = 0.002 if k == K else 0.006
            tt = t0 + at * song.beat + late + song.loose(j * 1000)
            kit.append((max(0.0, tt), 0.3, k, v, cc))
            if k == K:
                kicks.setdefault(b["i"], []).append(at)
    return kit, kicks


def groove(song, b, fl):
    """One bar of the groove for the section's role (positions in beats)."""
    m, role, e = song.m, b["role"], b["e"]
    r = song.rng
    hits = []
    ghost = lambda at: (at, S, int(r.integers(24, 38)), None)
    if fl == "waltz":                                  # 3/4 in three: the one, and the backbeats on two and three
        if role == "verse2":
            hits += [(0, K, 70, None), (1, XSTICK, 58, None), (2, XSTICK, 62, None)] + [(i, HH, 50 if i else 60, CLOSED) for i in range(3)]
        elif role == "pre":
            hits += [(0, K, 80, None), (1, LT, 66, None), (2, LT, 72, None)] + [(i / 2, HH, 50 if i % 2 else 62, CLOSED) for i in range(6)]
        elif role == "tag":
            hits += [(0, K, 82, None), (2, XSTICK, 66, None)] + [(i, HH, 52, CLOSED) for i in range(3)]
        else:
            big = role == "final"
            hits += [(0, K, 104, None), (1, S, 84, None), (2, S, 106, None)] + ([(1.5, K, 76, None)] if big else [])
            hits += [(i / 2, RIDE if big else HH, (84 if i % 2 == 0 else 58) if big else (70 if i % 2 == 0 else 48), CLOSED) for i in range(6)]
            hits += [ghost(2.5)] if r.random() < 0.4 else []
        if b["first"] and role in ("chorus", "final", "interlude"):
            hits.append((0, CRASH, 104 if role == "final" else 92, None))
        elif role == "final" and b["pos"] % 2 == 0:
            hits.append((0, CRASH2, 96, None))
        return hits
    if (m == 3 and song.sub == 2) or m == 6:           # 6/8 felt in two (the eighths are half beats); 6/4 the same, twice as long
        sc = 2 if m == 6 else 1
        hat = RIDE if role == "final" else HH
        if role in ("verse2",):
            hits += [(0, K, 70, None), (1.5, XSTICK, 64, None)] + [(i / 2, HH, 46 if i % 3 else 58, CLOSED) for i in range(6)]
        elif role == "pre":
            hits += [(0, K, 80, None), (1.5, LT, 74, None), (2.5, LT, 64, None)] + [(i / 2, HH, 52 if i % 3 else 66, CLOSED) for i in range(6)]
        elif fl == "six-eight-toms" and role in ("chorus", "interlude", "final"):
            # the toms carry it - and in the final they stay, under the full kit and the ride: the biggest section
            big = role == "final"
            hits += [(0, K, 104 if big else 100, None), (1.5, S, 112 if big else 104, None)]
            hits += [(i / 2, LT if i % 3 == 0 else HT, (90 if big else 82) if i % 3 == 0 else (66 if big else 58), None) for i in range(6)]
            hits += [(i / 2, RIDE, 86 if i % 3 == 0 else 62, OPEN if i == 2 else CLOSED) for i in range(6)] + [(2.5, K, 82, None)] if big else [(0, RIDE, 70, None)]
        else:
            open_on = role == "final"
            hits += [(0, K, 102, None), (1.5, S, 108, None), (2.5, K, 80, None)]
            hits += [(i / 2, hat, (86 if i % 3 == 0 else 60) if hat == RIDE else (74 if i % 3 == 0 else 52), OPEN if (open_on and i == 2) else CLOSED) for i in range(6)]
            hits += [ghost(1.0)] if r.random() < 0.5 else []
            if role == "tag":
                hits = [(0, K, 84, None), (1.5, XSTICK, 70, None)] + [(i / 2, HH, 50, CLOSED) for i in range(6)]
        if b["first"] and role in ("chorus", "final", "interlude"):
            hits.append((0, CRASH, 104 if role == "final" else 92, None))
        elif role == "final" and b["pos"] % 2 == 0:
            hits.append((0, CRASH2, 96, None))
        if sc != 1:                                    # (6/4: the same groove, each eighth a quarter)
            hits = [(at * sc, k, v, cc) for at, k, v, cc in hits]
            if role in ("chorus", "final", "interlude"):
                hits += [(at + 0.5, HH if role != "final" else RIDE, 44, CLOSED) for at in range(6) if at % 3]
        return hits
    if m == 3:                                         # 9/8: three big beats, each in triplets
        if role in ("verse2", "pre"):
            hits += [(0, K, 74, None), (2, XSTICK if role == "verse2" else LT, 66, None)] + [(q + t / 3, HH, 54 if t == 0 else 38, CLOSED) for q in range(3) for t in range(3)]
        else:
            hat = RIDE if role == "final" else HH
            hits += [(0, K, 100, None), (1 + 2 / 3, K, 74, None), (2, S, 106, None)] + [(q + t / 3, hat, 78 if t == 0 else 50, CLOSED) for q in range(3) for t in range(3)]
            hits += [(at, S, int(r.integers(24, 36)), None) for at in (1 / 3, 2 + 2 / 3) if r.random() < 0.5]
        if b["first"] and role in ("chorus", "final", "interlude"):
            hits.append((0, CRASH, 100, None))
        return hits
    # 4/4
    sixteen = lambda base, acc: [(i / 4, HH, acc if i % 4 == 0 else base if i % 2 == 0 else base - 16, CLOSED) for i in range(16)]
    if role == "verse2":
        hits += [(0, K, 72, None), (2, K, 64, None), (1, XSTICK, 66, None), (3, XSTICK, 68, None)] + [(i / 2, HH, 48 if i % 2 else 58, CLOSED) for i in range(8)]
    elif role == "pre":
        hits += [(q, K, 66 + int(30 * e), None) for q in range(4)] + [(i / 2, LT, 50 + int(40 * e) - (12 if i % 2 else 0), None) for i in range(8)]
    elif role == "tag":
        hits += [(0, K, 86, None), (2, S, 92, None)] + [(i / 2, HH, 56 if i % 2 else 66, CLOSED) for i in range(8)]
    else:
        half = fl.startswith("half-time") and role in ("chorus", "interlude")
        if half:
            hits += [(0, K, 102, None), (1.5, K, 76, None), (2, S, 110, None), (3.5, K, 70, None)]
            hits += [ghost(2.75)] if r.random() < 0.6 else []
            if fl == "half-time-toms":
                hits += [(i / 2, LT if i % 4 == 0 else HT, 70 if i % 4 == 0 else 50, None) for i in range(8)]
            else:
                hits += [(i / 2, HH, 70 if i % 2 == 0 else 50, CLOSED if i != 7 else OPEN) for i in range(8)]
        elif fl == "train":
            hits += [(0, K, 96, None), (2, K, 92, None)] + [(i / 4, S, 104 if i in (4, 12) else 58 if i % 2 == 0 else 34, None) for i in range(16)]
        elif fl == "ride" and role in ("chorus", "interlude"):
            # four on the floor under the ride's bell and bow: wide and open, saving the crashes for the final
            hits += [(q, K, 98 if q % 2 == 0 else 84, None) for q in range(4)] + [(1, S, 108, None), (3, S, 110, None)]
            hits += [(i / 2, RIDE if i % 2 else BELL, 72 if i % 2 else 64, None) for i in range(8)]
            hits += [ghost(at) for at in (1.75, 3.75) if r.random() < 0.4]
        else:
            hits += [(0, K, 104, None), (1.5, K, 82, None), (2, K, 96, None), (1, S, 110, None), (3, S, 112, None)]
            if fl == "drive" or role == "final":
                hits += [(2.5, K, 74, None)]
                hits += [(i / 2, RIDE if role == "final" else HH, 84 if i % 2 == 0 else 62, CLOSED) for i in range(8)]
            else:
                hits += sixteen(44, 70)
            hits += [ghost(at) for at in (0.75, 2.75, 3.25) if r.random() < 0.45]
        if role == "final":
            hits += [(3.5, HH, 66, OPEN)]
            if fl == "half-time-toms":                 # (the toms that carried the chorus stay in the final, under the full kit)
                hits += [(q, LT, 78 if q % 2 == 0 else 62, None) for q in range(4)]
            if b["pos"] >= b["n"] - 2 and not b["last"]:   # (the last line pushes: sixteenth hats)
                hits += [(i / 4 + 0.25, HH, 46, CLOSED) for i in range(0, 16, 2)]
    if b["first"] and role in ("chorus", "final", "interlude"):
        hits.append((0, CRASH, 106 if role == "final" else 94, None))
    elif role == "final" and b["pos"] % 2 == 0:
        hits.append((0, CRASH2, 98, None))
    return hits


def percussion(song):
    """Shaker and tambourine (on the kit's own percussion), and the swells into big sections."""
    notes, swells = [], []
    for b in song.bars:
        role = b["role"]
        t0 = song.t(b)
        if role in ("chorus", "final", "interlude") or (role == "bridge" and b["half"]):
            div = song.sub * (2 if song.m == 4 and role == "final" else 1)
            for q in range(song.m):
                for k in range(div):
                    notes.append((t0 + (q + k / div) * song.beat + song.loose(6), 0.2, SHAKE, (74 if k == 0 else 50) + (8 if role == "final" else 0), None))
            if role == "final":
                for bb in song.backbeats:
                    notes.append((t0 + bb * song.beat + 0.006, 0.2, TAMB, 86, None))
            if song.fl.get("bells") and role in ("chorus", "final"):       # (Christmas: sleigh bells on the beats)
                for q in range(song.m):
                    notes.append((t0 + q * song.beat + song.loose(5), 0.4, JINGLE, (70 if q == 0 else 56) + (8 if role == "final" else 0), None))
        if b["last"] and b["next_role"] in ("chorus", "final") and b["next_e"] > b["e"]:
            swells.append(song.t(b, song.m))          # (a reversed cymbal ending on the next downbeat)
    return notes, swells


def bass(song, kicks):
    out, prev = [], None
    for b in song.bars:
        role = b["role"]
        if role in ("intro", "verse", "outro") or (role == "drop") or (role == "bridge" and not b["half"]):
            if b["final"]:
                ch = b["chords"][0][0]
                out.append((song.t(b), song.m * 2.5 * song.beat, song.near(ch["bass"], 28, 43, prev), 84, None))
            continue
        for ch, at, ln in song.segs(b):
            n = song.near(ch["bass"], 28, 43, prev)
            prev = n
            t0 = song.t(b, at)
            if b["final"]:
                out.append((t0, song.m * 2.5 * song.beat, n, 92, None))
                continue
            if role in ("verse2", "tag"):
                out.append((t0 + song.loose(4), ln * song.beat - 0.05, n, song.vel(b, 60), None))
            elif role == "pre" or (role == "bridge" and b["half"]):
                step = 0.5 if song.sub == 2 else 1 / 3
                for k in range(int(ln / step)):
                    out.append((t0 + k * step * song.beat + song.loose(4), step * song.beat * 0.8, n, song.vel(b, 58, add=6 if k % 2 == 0 else 0), None))
            else:                                       # locked to the kick
                ks = sorted(set(round(x, 3) for x in kicks.get(b["i"], []) if at - 1e-6 <= x < at + ln))
                if not ks or ks[0] > at + 1e-6:
                    ks = [at] + ks
                for j, kt in enumerate(ks):
                    end = ks[j + 1] if j + 1 < len(ks) else at + ln
                    oct_ = 12 if (role == "final" and j == len(ks) - 1 and len(ks) > 2 and n + 12 <= 50) else 0
                    out.append((song.t(b, kt) + song.loose(3), max(0.1, (end - kt) * song.beat - 0.04), n + oct_, song.vel(b, 66, add=8 if j == 0 else 0), None))
    return out


def keys(song):
    out, prev = [], None
    motif = song.fl["motif"]
    style = song.fl["keys"]
    step = 1 / 3 if song.sub == 3 else 0.5             # (the eighth, or the triplet in 9/8)

    def add(t, ln, n, v):
        out.append((max(0.0, t + song.loose(5)), ln, n - 12 if n > 96 else n, v, None))

    for b in song.bars:
        role = b["role"]
        for ch, at, ln in song.segs(b):
            t0 = song.t(b, at)
            rh = song.voicing(ch, 60, 79, 4, prev, 69)
            prev = rh
            lh = song.near(ch["bass"], 36, 47)
            dur = ln * song.beat
            if len(rh) < 3:                             # (a dyad or a single note: filled out with octaves)
                rh = sorted(set(rh + [n + 12 for n in rh] + [n + 24 for n in rh]))[:3]
            arp = [lh, lh + 7, rh[0] + 12 if rh[0] < 64 else rh[0], rh[1], rh[2], rh[-1]]
            if b["final"]:
                for k, n in enumerate([lh - 12 if lh >= 36 else lh, lh] + rh + [rh[-1] + 12]):
                    out.append((t0 + k * 0.012, song.m * 3 * song.beat, n, 76, None))
                continue
            if role in ("intro", "drop", "outro", "interlude") or (role == "bridge" and not b["half"]):
                # the motif: a few chord notes high up, the hook of the song (an octave higher again: bells, at Christmas)
                up = 12 if song.fl.get("bells") and role != "drop" else 0
                top = [n + 12 + up for n in rh[1:]] + [rh[0] + 24 + up]
                for k, mt in enumerate(m for m in motif if at <= m < at + ln):
                    add(song.t(b, mt), 1.5 * song.beat, top[(k + b["pos"]) % len(top)], song.vel(b, 46 - up // 3, add=-4 * (k % 2)))
                if role != "interlude":
                    out.append((t0, dur + 0.3, lh, song.vel(b, 40), None))
                    for n in rh[:3]:
                        out.append((t0 + 0.02, dur + 0.3, n, song.vel(b, 30), None))
            elif role == "verse":
                if style == "arp":                      # (broken chords, rising and falling)
                    seq = arp + arp[-2:0:-1]
                    for k in range(int(round(ln / step))):
                        add(t0 + k * step * song.beat, step * song.beat * 2.5, seq[k % len(seq)], song.vel(b, 40, add=4 if k == 0 else -2 * (k % 2)))
                    continue
                out.append((t0, dur + 0.4, lh, song.vel(b, 48), None))
                out.append((t0 + 0.01, dur + 0.4, lh + 7, song.vel(b, 38), None))
                for k, n in enumerate(rh):
                    out.append((t0 + 0.03 + 0.015 * k, dur + 0.4, n, song.vel(b, 42, add=-2 * k), None))
                if ln >= 2 and style != "sparse":
                    out.append((song.t(b, at + ln / 2), dur / 2, rh[-1] + (2 if (rh[-1] + 2) % 12 in song.pcs(ch) else 0), song.vel(b, 36), None))
            elif role in ("verse2", "pre", "tag") or (role == "bridge" and b["half"]):
                out.append((t0, dur, lh, song.vel(b, 50), None))
                if style == "arp":
                    for k in range(int(round(ln / step))):
                        add(t0 + k * step * song.beat, step * song.beat * 2, arp[2:][k % 4], song.vel(b, 42, add=4 if k == 0 else 0))
                    continue
                q_step = step if style == "pulse" else (2 if style == "sparse" and ln >= 2 else 1)
                for q in np.arange(0, ln, q_step):
                    for n in rh:
                        add(song.t(b, at + q), q_step * song.beat * 0.9, n, song.vel(b, 40 if style != "pulse" else 34, add=6 if q == 0 else 0))
                if style == "gospel" and ln >= 2:         # (a grace into the top note)
                    add(t0 + 0.5 * song.beat - 0.06, 0.08, rh[-1] - 1, song.vel(b, 30))
            else:                                       # chorus / final: octaves below, then the flavour's right hand
                big = role == "final"
                out.append((t0, dur, lh, song.vel(b, 58), None))
                out.append((t0, dur, lh - 12 if lh - 12 >= 24 else lh + 12, song.vel(b, 52), None))
                top = rh + ([rh[-1] + 12] if big else [])
                if style == "pulse":                    # driving eighth chords
                    for k in range(int(round(ln / step))):
                        acc = k % song.accent == 0
                        for n in top:
                            add(song.t(b, at + k * step), step * song.beat * 0.8, n, song.vel(b, 40, add=8 if acc else -4))
                elif style == "arp":                    # a held chord and an eighth line over it
                    for n in rh:
                        add(t0 + 0.02, dur, n, song.vel(b, 40))
                    line = [rh[1] + 12, rh[2] + 12, rh[-1] + 12, rh[2] + 12]
                    for k in range(int(round(ln / step))):
                        add(song.t(b, at + k * step), step * song.beat * 1.5, line[k % 4], song.vel(b, 38 if not big else 46, add=4 if k % 2 == 0 else -4))
                elif style == "sparse":                 # a big chord and a high answer on the backbeat
                    for n in top:
                        add(t0 + 0.02, dur, n, song.vel(b, 48))
                    bb = [p for p in song.backbeats if at <= p < at + ln]
                    for p in bb[:1]:
                        add(song.t(b, p), 1.2 * song.beat, rh[-1] + 12, song.vel(b, 38))
                else:                                   # chords on the pushes; gospel also anticipates the next bar
                    for p in song.pushes:
                        if p < ln:
                            for n in top:
                                add(song.t(b, at + p), min(ln - p, 1.5) * song.beat, n, song.vel(b, 46, add=6 if p == 0 else -2))
                    if style == "gospel" and at + ln >= song.m:  # (the and of the last beat, struck short)
                        for n in top:
                            add(song.t(b, song.m - step), 0.8 * step * song.beat, n, song.vel(b, 44))
    return out


def guitar_ambient(song):
    """Electric 1: swells, and dotted-eighth delay lines (the delay is in the mix; these are the picked notes)."""
    picked, swells, prev = [], [], None
    for b in song.bars:
        role = b["role"]
        for ch, at, ln in song.segs(b):
            t0 = song.t(b, at)
            v = song.voicing(ch, 64, 83, 3, prev, 74)
            prev = v
            if b["final"]:
                swells += [(t0, song.m * 3 * song.beat, n, 80, None) for n in v[1:]]
                continue
            style = song.fl["amb"]
            if role in ("intro", "drop", "outro", "verse") or (role == "bridge" and not b["half"]) or \
                    (style == "swell" and role in ("verse2", "pre", "interlude", "tag", "chorus")):
                if role == "verse" and b["pos"] % 2:
                    continue
                hi = 12 if style == "swell" and role in ("chorus", "interlude") else 0
                swells += [(t0, ln * song.beat + 0.6, n + hi, 84, None) for n in v[1:]]
            elif role in ("verse2", "pre", "interlude", "tag", "chorus"):
                big = role in ("chorus", "interlude")
                oct_ = v[0] + 12 if v[0] + 12 <= 88 else v[0]
                if style == "quarter":                  # quarter notes, the delay filling the gaps
                    pat, step = ([oct_, v[2], v[1], v[2]] if big else [v[2], v[1], v[2], v[0]]), 1.0
                elif style == "arp16":                  # a rolling sixteenth arpeggio (eighths in the builds)
                    pat, step = ([v[0], v[1], v[2], oct_, v[2], v[1]] if big else [v[0], v[1], v[2], v[1]]), (0.25 if big else 0.5)
                else:                                   # dotted: eighth lines into the dotted-eighth delay
                    pat = [v[2], v[1], oct_, v[1]] if big else [v[2], v[1], v[2], v[0]]
                    step = 0.5
                step = step if song.sub == 2 else 1 / 3
                for k in range(int(round(ln / step))):
                    picked.append((t0 + k * step * song.beat + song.loose(5), step * song.beat * (0.55 if step < 1 else 0.8), pat[k % len(pat)],
                                   song.vel(b, 62 if step >= 0.5 else 54, add=6 if k % 2 == 0 else -6), None))
            else:                                       # final and the build: tremolo-picked sixteenths, high
                hi = v[2] + 12 if v[2] + 12 <= 90 else v[2]
                for k in range(int(round(ln * 4))):
                    picked.append((t0 + k * 0.25 * song.beat + song.loose(4), 0.22 * song.beat, hi if k % 8 < 6 else v[1] + 12, song.vel(b, 52, add=8 if k % 4 == 0 else 0), None))
    return picked, swells


def guitar_drive(song):
    """Electric 2: the driven rhythm guitar - eighths on power chords in the big sections, ringing chords in the builds."""
    out = []
    for b in song.bars:
        role = b["role"]
        if role not in ("chorus", "final", "interlude", "pre") and not (role == "bridge" and b["half"]):
            continue
        for ch, at, ln in song.segs(b):
            r = song.near(ch["root"], 40, 51)
            shape = [r, r + 7, r + 12] + ([r + 16 if 4 in ch["ivs"] else r + 15] if role != "final" else [r + 19])
            t0 = song.t(b, at)
            if b["final"]:
                out += [(t0 + k * 0.008, song.m * 2.5 * song.beat, n, 96, None) for k, n in enumerate(shape)]
                continue
            if role == "pre" or (role == "bridge" and b["half"] and b["pos"] < b["n"] - 2):
                out += [(t0 + k * 0.009, ln * song.beat, n, song.vel(b, 60), None) for k, n in enumerate(shape)]
                continue
            style = song.fl["drv"]
            if role == "final" and style in ("whole", "chug"):
                style = "strum" if style == "whole" else "eighths"    # (the final always drives)
            step = 0.5 if song.sub == 2 else 1 / 3
            if style == "whole":                        # ringing chords, struck again halfway
                for p in sorted({0.0, *([ln / 2] if ln >= 2 else [])}):
                    out += [(t0 + p * song.beat + k * 0.012, (ln - p) * song.beat, n, song.vel(b, 58, add=6 if p == 0 else -4), None) for k, n in enumerate(shape)]
                continue
            if style == "strum":                        # open chord, a down-up pattern: down on the beats, ups between
                third = (ch["root"] + (4 if 4 in ch["ivs"] else 3)) % 12
                op = sorted({r, r + 7, r + 12, song.near(third, r + 13, r + 20), r + 19 if r + 19 <= 72 else r + 7})
                pat = {2: [1, 0, 1, 1, 0, 1, 1, 1], 3: [1, 0, 1, 1, 0, 1]}[song.accent]
                for k in range(int(round(ln / step))):
                    if not pat[k % len(pat)]:
                        continue
                    down = k % 2 == 0
                    strings_ = op if down else op[::-1][:3]
                    for j, n in enumerate(strings_):
                        out.append((t0 + k * step * song.beat + j * 0.011 + song.loose(4), step * song.beat * 1.8, n,
                                    song.vel(b, 58 if down else 46, add=8 if k % song.accent == 0 else 0), None))
                continue
            for k in range(int(round(ln / step))):
                acc = k % song.accent == 0
                if style == "chug":                     # palm-muted root and fifth, the full chord on the accents
                    notes_ = shape[:3] if (acc and k % (2 * song.accent) == 0) else shape[:2]
                    ln_ = step * song.beat * (0.9 if len(notes_) == 3 else 0.3)
                else:
                    notes_, ln_ = shape[:3], step * song.beat * (0.9 if acc else 0.6)
                for j, n in enumerate(notes_):
                    out.append((t0 + k * step * song.beat + j * 0.006 + song.loose(4), ln_, n, song.vel(b, 62 if style != "chug" else 58, add=8 if acc else -6), None))
    return out


def strings(song):
    out = {"violins": [], "violas": [], "cellos": []}
    pv = None
    for b in song.bars:
        role = b["role"]
        on = role in ("final", "tag") or (role == "bridge" and b["half"]) or (role == "chorus" and song.fl["strings"] >= 1.2)
        if not on:
            continue
        for ch, at, ln in song.segs(b):
            t0 = song.t(b, at)
            v = song.voicing(ch, 60, 84, 3, pv, 74)
            pv = v
            length = (song.m * 3 if b["final"] else ln) * song.beat + 0.15
            vel = song.vel(b, 60)
            out["violins"] += [(t0, length, v[-1], vel, None), (t0, length, v[-2], vel - 6, None)]
            if role == "final" and v[-1] + 12 <= 93:          # (the final: the violins an octave up on top)
                out["violins"].append((t0, length, v[-1] + 12, vel - 4, None))
            out["violas"].append((t0, length, song.near(song.pcs(ch, False)[1 % len(song.pcs(ch, False))], 55, 67), vel - 6, None))
            out["cellos"].append((t0, length, song.near(ch["bass"], 36, 50), vel, None))
    return out


# ---------------------------------------------------------------- sound: DSP
def fft_conv(x, ir):
    """x (frames, 2) through a stereo impulse response (frames, 2)."""
    n = len(x) + len(ir) - 1
    size = HA.fast_len(n)
    out = np.zeros_like(x)
    for c in range(2):
        out[:, c] = np.fft.irfft(np.fft.rfft(x[:, c], size) * np.fft.rfft(ir[:, c], size), size)[:len(x)]
    return out


def eq(x, **kw):
    n = len(x)
    size = HA.fast_len(n)
    h = HA.eq_curve(np.fft.rfftfreq(size, 1 / SR), **kw)
    return np.stack([np.fft.irfft(np.fft.rfft(x[:, c], size) * h, size)[:n] for c in range(2)], axis=1).astype(np.float32)


def bell(x, f, db, q=1.0):
    n = len(x)
    size = HA.fast_len(n)
    fr = np.maximum(np.fft.rfftfreq(size, 1 / SR), 1.0)
    g = 10 ** (db * np.exp(-0.5 * (np.log2(fr / f) / (0.5 / q)) ** 2) / 20)
    return np.stack([np.fft.irfft(np.fft.rfft(x[:, c], size) * g, size)[:n] for c in range(2)], axis=1).astype(np.float32)


def glue(x, ratio):
    """Stereo compression from the sum (the image stays put)."""
    if ratio <= 1:
        return x
    mono = x.mean(axis=1)
    comp = HA.compress(mono, ratio)
    g = np.divide(comp, mono, out=np.ones_like(mono), where=np.abs(mono) > 1e-6)
    g = np.clip(g, 0.25, 1.0)
    # (smooth the gain: no zipper)
    k = int(0.005 * SR)
    g = np.convolve(g, np.ones(k) / k, mode="same")
    return (x * g[:, None]).astype(np.float32)


def stereo_ir(kind):
    return np.stack([HA.reverb_ir(kind, 0), HA.reverb_ir(kind, 1)], axis=1)


def delay(x, seconds, feedback, mix, pingpong=True, taps=8, dark=4500.0):
    """A tempo-synced delay (ping-pong): the repeats wander left and right, each a little darker."""
    d = int(seconds * SR)
    ir = np.zeros((d * taps + 1, 2), np.float32)
    for k in range(1, taps + 1):
        g = mix * feedback ** (k - 1)
        if pingpong:
            ir[d * k, k % 2] += g
        else:
            ir[d * k, :] += g
    wet = fft_conv(x, ir)
    wet = eq(wet, hp=250, air=-6)
    fr_n = HA.fast_len(len(wet))
    lp = 1 / np.sqrt(1 + (np.fft.rfftfreq(fr_n, 1 / SR) / dark) ** 2)
    wet = np.stack([np.fft.irfft(np.fft.rfft(wet[:, c], fr_n) * lp, fr_n)[:len(wet)] for c in range(2)], axis=1)
    return (x + wet).astype(np.float32)


def octave_up(x):
    """A granular octave up (for the shimmer): 60 ms grains read at double speed, overlapped."""
    g = int(0.06 * SR)
    hop = g // 2
    win = np.hanning(g).astype(np.float32)
    out = np.zeros_like(x)
    for s in range(0, len(x) - 2 * g, hop):
        src = x[s:s + 2 * g:2]
        if len(src) < g:
            break
        out[s:s + g] += src[:g] * win[:, None]
    return out


def drive(x, amount):
    pre = eq(x, hp=110, mid=(800, 4.0))
    y = np.tanh(pre * amount) / np.tanh(amount)
    y = eq(y, hp=90, mid=(2400, 2.5), presence=-2.0, air=-14.0)          # (the cabinet: no fizz above 6 kHz)
    return y.astype(np.float32)


def amp_clean(x):
    y = np.tanh(x * 2.2) / np.tanh(2.2)
    return eq(y, hp=120, mid=(1800, 1.5), air=-6).astype(np.float32)


def width(x, amount):
    mid = (x[:, 0] + x[:, 1]) / 2
    side = (x[:, 0] - x[:, 1]) / 2 * amount
    return np.stack([mid + side, mid - side], axis=1).astype(np.float32)


def haas(x, ms):
    d = int(ms / 1000 * SR)
    y = x.copy()
    y[d:, 1] = x[:-d, 1] if d else x[:, 1]
    return y


def gain_curve(song, n, level_of):
    """A per-sample gain from a per-bar level (smoothed over a beat)."""
    g = np.zeros(n, np.float32)
    for b in song.bars:
        a = int(song.t(b) * SR)
        e = int(song.t(b, song.m) * SR)
        g[a:min(n, e)] = level_of(b)
    if song.bars:
        g[int(song.t(song.bars[-1], song.m) * SR):] = level_of(song.bars[-1])
    k = max(1, int(song.beat * SR))
    return np.convolve(g, np.ones(k) / k, mode="same").astype(np.float32)


def section_db(b):
    """A bar's level (dB): DYN for its role; a pre and the bridge's second half ramp up, the final's last line lifts."""
    role, x = b["role"], (b["pos"] + 1) / max(1, b["n"])
    db = DYN.get(role, -1.0)
    if role == "pre":
        db = -2.0 + 1.5 * x
    elif role == "bridge":
        db = -3.0 if not b["half"] else -3.0 + 3.0 * (2 * x - 1)
    elif role == "final" and b["n"] >= 4 and b["pos"] >= b["n"] - 4:
        db += 0.5
    return db


def dynamics(song, n):
    """The per-sample gain for the section levels, eased over a beat (so builds rise and drops fall musically)."""
    return gain_curve(song, n, lambda b: 10 ** (section_db(b) / 20.0))


def swell_curve(n, starts, attack):
    """Volume swells: each note fades in from nothing over `attack` seconds (a volume pedal)."""
    g = np.ones(n, np.float32)
    for t in sorted(set(starts)):
        a = int(t * SR)
        m = int(attack * SR)
        if a < n:
            seg = np.linspace(0, 1, m) ** 1.6
            g[a:min(n, a + m)] = np.minimum(g[a:min(n, a + m)], seg[:min(n, a + m) - a]) if a > 0 else seg[:min(n, m)]
    return g


def reverse_cymbal(crash, at_times, n, seconds):
    out = np.zeros((n, 2), np.float32)
    rev = crash[::-1]
    m = min(len(rev), int(seconds * SR))
    rev = rev[-m:] * np.linspace(0, 1, m)[:, None] ** 2
    for t in at_times:
        e = int(t * SR)
        a = e - m
        if a >= 0 and e <= n:
            out[a:e] += rev
    return out


def riser(song, n):
    """Noise rising into the final section (the bridge's last two bars)."""
    out = np.zeros((n, 2), np.float32)
    rng = np.random.default_rng(5)
    for k, b in enumerate(song.bars):
        if b["role"] == "bridge" and b["last"]:
            a = int(song.t(song.bars[k - 1] if k else b) * SR)
            e = int(song.t(b, song.m) * SR)
            m = e - a
            noise = rng.normal(0, 1, (m, 2)).astype(np.float32)
            # (a band-pass sweeping up: done in slices)
            parts = 24
            y = np.zeros_like(noise)
            for p in range(parts):
                s0, s1 = p * m // parts, (p + 1) * m // parts
                f = 400 * (10000 / 400) ** (p / parts)
                seg = noise[s0:s1]
                y[s0:s1] = bell(seg, f, 18, q=1.2) * 0.12
            y *= (np.linspace(0, 1, m) ** 2.2)[:, None]
            if a < n:
                out[a:min(n, e)] += y[:min(n, e) - a]
    return out


# ---------------------------------------------------------------- playing the parts
class Player:
    def __init__(self, opt, seed):
        self.opt = opt
        self.cache = opt.get("samples") or os.path.join(os.path.expanduser("~"), ".cache", "central-samples")
        self.insts = {}
        self.seed = seed

    def play(self, name, notes, seconds, seed=0):
        n = int(round(seconds * SR))
        if not notes:
            return np.zeros((n, 2), np.float32)
        if self.opt.get("gm"):
            x = self.gm(name, notes, seconds)
        else:
            key = (name, seed)
            if key not in self.insts:
                self.insts[key] = SM.Instrument(name, self.cache, seed=self.seed + seed)
            x = self.insts[key].play(notes, seconds)
        if not self.opt.get("gm"):
            self.insts.pop((name, seed), None) if name != "drums" or seed else None    # (done with it: its samples freed)
        return x[:n] if len(x) >= n else np.pad(x, ((0, n - len(x)), (0, 0)))

    def gm(self, name, notes, seconds):
        import tempfile
        mid = M.Midi(60)
        drums = name == "drums"
        ch = 9 if drums else 0
        if not drums:
            mid.program(0, GM.get(name, 0), 0)
        for t, ln, k, v, cc in notes:
            mid.note(t, ln, int(k), int(v), ch)
        with tempfile.TemporaryDirectory() as tmp:
            p = os.path.join(tmp, "x.mid")
            mid.save(p)
            y = M.render(self.opt["gm"], p, sr=SR, gain=0.5)
        out = np.zeros((int(seconds * SR) + 1, 2), np.float32)
        out[:min(len(out), len(y))] = y[:len(out)]
        return out


def pads(song, n, style):
    """The synth pad: our pad style held on each chord, crossfading on the changes, louder as the song grows."""
    loops = {}
    out = np.zeros((n, 2), np.float32)
    rng = np.random.default_rng(3)
    lp = PD.Loop(6.0)
    spans = []
    for b in song.bars:
        for ch, at, ln in song.segs(b):
            pcs = song.pcs(ch)
            root = song.near(ch["root"], 45, 56)
            notes = tuple(sorted({root, root + 7, song.near(pcs[1], root + 3, root + 16), song.near(pcs[-1], root + 10, root + 24)}))
            a = song.t(b, at)
            if spans and spans[-1][2] == notes:
                spans[-1][1] = a + ln * song.beat
            else:
                spans.append([a, a + ln * song.beat, notes])
    spans[-1][1] += song.m * 3 * song.beat
    for a, e, notes in spans:
        if notes not in loops:
            x = PV.render(style, lp, notes[0], rng, notes=[(m, 1.0 if i == 0 else 0.7) for i, m in enumerate(notes)])
            idx = np.arange(int(len(x) * SR / PD.SR)) * PD.SR / SR
            loops[notes] = np.stack([np.interp(idx, np.arange(len(x)), x[:, c]) for c in range(2)], axis=1).astype(np.float32)
        loop = loops[notes]
        fade = int(0.8 * SR)
        i0, i1 = max(0, int(a * SR) - fade // 2), min(n, int(e * SR) + fade // 2)
        m = i1 - i0
        if m <= 0:
            continue
        seg = np.tile(loop, (m // len(loop) + 1, 1))[:m].copy()
        f = min(fade, m // 2)
        seg[:f] *= np.linspace(0, 1, f)[:, None]
        seg[-f:] *= np.linspace(1, 0, f)[:, None]
        out[i0:i1] += seg
    return out


# stem -> (level dB RMS where it plays, plate/hall send, the room)
LEVELS = {"Drums": -16.5, "Percussion": -27.0, "Bass": -19.5, "Keys": -20.5, "Synth": -23.5, "Electric 1": -24.0, "Electric 2": -23.0, "Strings": -24.0}


def level(x, db):
    mono = x.mean(axis=1)
    r = HA_active_rms(mono)
    if r <= 0:
        return x
    return (x * (10 ** (db / 20.0) / r)).astype(np.float32)


def HA_active_rms(x):
    frames = len(x) // 4410
    if frames == 0:
        return 0.0
    r = np.sqrt(np.mean(x[:frames * 4410].reshape(frames, 4410) ** 2, axis=1))
    loud = r[r > max(1e-5, np.max(r) * 0.08)]
    return float(np.sqrt(np.mean(loud ** 2))) if len(loud) else 0.0


def render(hymn, secs, opt, seed=7, log=print):
    song = Song(hymn, secs, seed)
    n = int((song.seconds + 6.0) * SR)
    if opt.get("seconds"):
        n = min(n, int(float(opt["seconds"]) * SR))
    secs_len = n / SR
    P = Player(opt, seed)
    plate, hall = stereo_ir("plate"), stereo_ir("hall")
    beat = song.beat
    stems = {}

    kit, kicks = drums(song)
    d = P.play("drums", kit, secs_len)
    d = eq(d, hp=32, low=2.0, mid=(380, -3.5), presence=1.5, air=2.0)
    d = d * 0.7 + glue(d, 4.0) * 0.55                                # (parallel compression: punch and body)
    d = d + 0.10 * fft_conv(d, plate)
    stems["Drums"] = d

    perc, swell_at = percussion(song)
    p = P.play("drums", perc, secs_len, seed=1)
    crash = P.play("drums", [(0.0, 3.0, CRASH, 100, None)], 4.0, seed=2)
    p = eq(p, hp=300, air=1.5)
    p = level(p + 0.18 * fft_conv(p, hall), LEVELS["Percussion"])          # (the shaker and tambourine set the stem's level...)
    rc = reverse_cymbal(crash, swell_at, n, 2.2 * beat * song.m / 2 + 1.0)
    rs = riser(song, n)
    peak = lambda y: float(np.max(np.abs(y))) or 1.0
    p = p + rc * (0.22 / peak(rc)) + rs * (0.16 / peak(rs))              # (...and the swells sit on top at a set level)
    stems["Percussion"] = width(p, 1.3)

    b = P.play("bass", bass(song, kicks), secs_len)
    b = eq(b, hp=35, low=2.5, mid=(250, -2.5), presence=1.0, air=-8)
    b = glue(b, 4.0)
    b = 0.8 * b + 0.2 * np.tanh(b * 4) / 4 * 2                        # (a little grit, so it speaks on small speakers)
    stems["Bass"] = width(b, 0.0)

    k = P.play("piano", keys(song), secs_len)
    k = eq(k, hp=70, mid=(320, -2.0), presence=-1.5, air=1.5)
    k = bell(k, 2600, -2.0)                                           # (room for the singers)
    k = glue(k, 2.0)
    k = k + 0.22 * fft_conv(k, hall)
    stems["Keys"] = width(k, 1.2)

    sy = pads(song, n, song.fl["pad"])
    sy = sy * gain_curve(song, n, lambda bb: {"intro": 1.0, "outro": 1.0, "verse": 0.8, "drop": 0.9, "bridge": 0.9 if not bb["half"] else 1.0}.get(bb["role"], 0.75))[:, None]
    sy = eq(sy, hp=140, mid=(1800, -3.0))
    stems["Synth"] = width(sy, 1.4)

    picked, sw = guitar_ambient(song)
    g1 = P.play("gretsch", picked, secs_len)
    gs = P.play("gretsch", sw, secs_len, seed=3)
    gs = gs * swell_curve(n, [t for t, *_ in sw], 0.9 * beat * 2)[:, None]
    g1 = amp_clean(g1 + gs * 3.0)
    g1 = delay(g1, 0.75 * beat, 0.42, 0.65)                           # (the dotted eighth)
    g1 = delay(g1, 2.0 * beat, 0.3, 0.25, pingpong=False)             # (and a long half-note echo behind it)
    sh = octave_up(g1 * 0.5)
    g1 = g1 + 0.35 * fft_conv(g1, hall) + 0.22 * fft_conv(sh, stereo_ir("church"))
    g1 = bell(g1, 2800, -3.0)
    stems["Electric 1"] = width(g1, 1.5)

    dv = guitar_drive(song)
    left = P.play("hofner", dv, secs_len)
    right = P.play("gretsch", [(t + 0.011, ln, kk, v, c) for t, ln, kk, v, c in dv], secs_len, seed=5)
    amount = 5.0 if song.fl["tone"] == "warm" else 7.0
    g2 = np.stack([drive(left, amount)[:, 0], drive(right, amount)[:, 1]], axis=1)
    g2 = bell(g2, 2500, -2.5)
    g2 = g2 + 0.12 * fft_conv(g2, plate)
    stems["Electric 2"] = g2

    st = strings(song)
    s = np.zeros((n, 2), np.float32)
    for name, notes in st.items():
        s += P.play(name, notes, secs_len)
    if np.any(s):
        s = eq(s, hp=70, mid=(2500, -2.0), air=1.0)
        s = s + 0.3 * fft_conv(s, hall)
    stems["Strings"] = width(s, 1.3)

    for name in STEMS:
        x = stems[name][:n]
        if len(x) < n:
            x = np.pad(x, ((0, n - len(x)), (0, 0)))
        if name != "Percussion":
            stems[name] = level(x, LEVELS[name] + (10 * math.log10(song.fl["strings"]) if name == "Strings" else 0))
        else:
            stems[name] = x
    # the dynamics: every stem rides the same section levels, so the final chorus is the loudest part of the song
    dyn = dynamics(song, n)
    for name in STEMS:
        stems[name] = (stems[name] * dyn[:, None]).astype(np.float32)
        log("    %-10s peak %.2f" % (name, float(np.max(np.abs(stems[name])))))
    top = max(float(np.max(np.abs(stems[k]))) for k in STEMS)
    if top > 0.9:                        # (all the stems down together: no clipping, the balance kept)
        for k in STEMS:
            stems[k] = (stems[k] * (0.9 / top)).astype(np.float32)
    mix = sum(stems[k] for k in STEMS)
    return stems, mix, song
