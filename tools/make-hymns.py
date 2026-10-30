#!/usr/bin/env python3
"""Central Pedal - Central Tracks hymns (10.0): public-domain hymns in our own modern worship arrangements, rendered into
multitrack stems with our own sound libraries, plus everything the apps need to play them as a song: sections, lyrics,
chords and a chord chart.

Each hymn in hymns/hymns.json becomes (in <out>/<id>/ and, flat, in <out>/release/ for the GitHub release):
  Drums, Bass, Keys, Pad, Electric, Strings   the band, one mono MP3 each (128 kbit/s)
  Click, Guide                                a click and spoken section cues (the apps mute these two: they make their
                                              own, which follow tempo and key changes; they're there for other players)
  song.json                                   key, tempo, meter, sections (bar + lyrics), chords (bar + beat), chord chart
  <id>-mix.mp3, <id>-preview.mp3              the whole song mixed, and a 45-second preview from the second verse
and <out>/release/hymns-index.json (what the website lists in Central Tracks) + SHA256SUMS.

The arrangement is made here from the hymn's chords and form: each section has an energy (0 keys and pad, 1 + bass and
light drums, 2 the band, 3 everything with strings and cymbals), the parts follow the chords with simple voice leading,
fills lead into bigger sections, and the song ends on a held chord. No melody stem: the people sing the melody.

    python3 tools/make-hymns.py --sounds DIR [--orchestra DIR] --out DIR [--only ID] [--base-url URL] [--seconds N]
    python3 tools/make-hymns.py --gm FILE.sf2 --out DIR ...       (a test with any General MIDI SoundFont)
    python3 tools/make-hymns.py --check                            (the data only: bar counts, lyrics, chords)
    python3 tools/make-hymns.py --write-builtin server/src/hymns-builtin.json

--sounds: the SoundFonts tools/build-libraries.sh built (Central Instrument Drum Kits / Guitars and Basses, Central Keys
Grand Pianos / Pads); --orchestra: where sounds-vsco.py wrote VSCO Strings (else the strings stem uses the String Pad).
Needs fluidsynth, ffmpeg and python3-numpy. Deterministic: the same hymn renders the same way every time."""
import hashlib
import json
import math
import os
import re
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import midi_render as M  # noqa: E402

DATA = os.path.join(ROOT, "hymns", "hymns.json")
CUES = os.path.join(ROOT, "cues")
DEFAULT_BASE = "https://github.com/MotionAudio/central-apps/releases/download/central-tracks"
SR = 44100
ARTIST = "Motion Audio"
NOTES = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11}
QUALITIES = {"": (0, 4, 7), "m": (0, 3, 7), "7": (0, 4, 7, 10), "maj7": (0, 4, 7, 11), "m7": (0, 3, 7, 10), "sus4": (0, 5, 7), "sus": (0, 5, 7),
             "sus2": (0, 2, 7), "2": (0, 2, 4, 7), "add9": (0, 4, 7, 14), "6": (0, 4, 7, 9), "m6": (0, 3, 7, 9), "dim": (0, 3, 6), "aug": (0, 4, 8)}
CHORD_RE = re.compile(r"^([A-G][#b]?)([^/]*)(?:/([A-G][#b]?))?$")

# stem -> (bank, preset words) in the built libraries; (GM program, channel) for --gm tests
STEMS = {
    "Drums": ("Central Instrument Drum Kits", ["Studio Kit"], (0, 9)),
    "Bass": ("Central Instrument Guitars and Basses", ["Jazz Bass"], (33, 0)),
    "Keys": ("Central Keys Grand Pianos", ["Concert Grand"], (0, 0)),
    "Pad": ("Central Keys Pads", ["Worship Pad"], (89, 0)),
    "Electric": ("Central Instrument Guitars and Basses", ["Electric Guitar Clean"], (27, 0)),
    "Strings": ("VSCO Strings", ["Worship Strings"], (48, 0)),
}
STRINGS_FALLBACK = ("Central Keys Pads", ["String Pad"])
ROLES = {"Drums": "drums", "Bass": "bass", "Keys": "keys", "Pad": "keys", "Electric": "guitar", "Strings": "music", "Click": "click", "Guide": "guide"}
# loudness of each stem (RMS dBFS over the parts where it plays): summed at unity they make a balanced mix with headroom
LEVELS = {"Drums": -18.0, "Bass": -23.0, "Keys": -22.0, "Pad": -25.0, "Electric": -26.0, "Strings": -25.0, "Click": -22.0, "Guide": -18.0}
PANS = {"Drums": 0.0, "Bass": 0.0, "Keys": -0.1, "Pad": 0.0, "Electric": 0.35, "Strings": -0.3}
REVERB = {"Keys": 0.18, "Pad": 0.25, "Electric": 0.3, "Strings": 0.3, "Drums": 0.06}
CUE_WORDS = {"intro": "intro", "interlude": "interlude", "instrumental": "instrumental", "tag": "tag", "outro": "outro", "ending": "ending",
             "chorus": "chorus", "refrain": "refrain", "bridge": "bridge", "turnaround": "turnaround"}
VEL = [52, 64, 80, 96]   # (by energy)


def say(*a):
    print(*a, flush=True)


# ---------------------------------------------------------------- data
def parse_chord(sym):
    m = CHORD_RE.match(sym.strip())
    if not m or m.group(1) not in NOTES or m.group(2) not in QUALITIES:
        raise ValueError("chord %r" % sym)
    root = NOTES[m.group(1)]
    return {"sym": sym, "root": root, "ivs": QUALITIES[m.group(2)], "bass": NOTES[m.group(3)] if m.group(3) else root}


def parse_bar(text, meter):
    """'G' or 'G D@3' -> [(chord, beat 1-based)]"""
    parts = text.split()
    out = []
    for i, p in enumerate(parts):
        sym, _, at = p.partition("@")
        beat = float(at) if at else (1.0 if i == 0 else 1 + i * meter / len(parts))
        out.append((parse_chord(sym), beat))
    return out


def progression(hymn, spec):
    name, _, rng = spec.partition(":")
    bars = hymn["chords"][name]
    if rng:
        a, b = (int(x) for x in rng.split("-"))
        bars = bars[a - 1:b]
    return [parse_bar(b, hymn["meter"]) for b in bars]


def lyric_bars(hymn, name):
    """(pickup, [bar texts])"""
    parts = hymn["lyrics"][name].split("|")
    return parts[0], parts[1:]


def join_text(pieces):
    out = ""
    for p in pieces:
        p = p.strip()
        if not p:
            continue
        if out.endswith("~"):
            out = out[:-1] + p
        else:
            out += (" " if out else "") + p
    return out


def lyrics_text(pickup, bars):
    """The section's lyrics, one line per line ("/" ends a line)."""
    text = join_text([pickup] + bars).replace("^", "").replace("~", "")
    return "\n".join(re.sub(r"\s+", " ", ln).strip() for ln in text.split("/") if ln.strip())


def layout(hymn):
    """[{name, start (bar, 1-based), bars: [[(chord, beat)]], energy, lyrics: (pickup, [texts]) or None}]"""
    out, bar = [], 1
    for sec in hymn["form"]:
        bars = progression(hymn, sec["chords"])
        lyr = lyric_bars(hymn, sec["lyrics"]) if sec.get("lyrics") else None
        out.append({"name": sec["name"], "start": bar, "bars": bars, "energy": int(sec.get("energy", 1)), "lyrics": lyr})
        bar += len(bars)
    return out


def check(hymns):
    """Problems in the data (an empty list: fine)."""
    bad = []
    for h in hymns:
        for key in ("id", "title", "words", "music", "key", "bpm", "meter", "chords", "form", "public_domain"):
            if key not in h:
                bad.append("%s: no %s" % (h.get("id"), key))
        pd = h.get("public_domain") or {}
        if not (pd.get("words", 9999) < 1929 and pd.get("music", 9999) < 1929 and pd.get("writers_died", 9999) < 1955):
            bad.append("%s: not clearly public domain (published before 1929, writers dead 70+ years)" % h.get("id"))
        try:
            secs = layout(h)
        except (ValueError, KeyError) as e:
            bad.append("%s: %s" % (h.get("id"), e))
            continue
        for s in secs:
            if s["lyrics"]:
                pickup, texts = s["lyrics"]
                if len(texts) != len(s["bars"]):
                    bad.append("%s %s: %d lyric bars for %d bars" % (h["id"], s["name"], len(texts), len(s["bars"])))
                for i, (t, chords) in enumerate(zip(texts, s["bars"])):
                    if t.count("^") > len(chords) - 1:
                        bad.append("%s %s bar %d: %d ^ marks for %d chords" % (h["id"], s["name"], i + 1, t.count("^"), len(chords)))
            for chords in s["bars"]:
                for _, beat in chords:
                    if not 1 <= beat <= h["meter"]:
                        bad.append("%s %s: a chord on beat %s" % (h["id"], s["name"], beat))
    return bad


# ---------------------------------------------------------------- chart and song file
def chordpro_section(sec):
    pickup, texts = sec["lyrics"]
    out, prev = "", None

    def put(piece):
        nonlocal out
        if not piece:
            return
        if out.endswith("~"):
            out = out[:-1] + piece.lstrip()
        elif out and not out.endswith((" ", "\n")) and not piece.startswith(" "):
            out += " " + piece
        else:
            out += piece
    put(pickup.strip())
    for text, chords in zip(texts, sec["bars"]):
        text = text.strip()
        m = re.match(r"^/\s*", text)
        if m:                          # (a line break before the bar's words: the break first, then the chord)
            out = out.rstrip() + "/"
            text = text[m.end():]
        segs = text.split("^")
        bar = ""
        for j, (ch, _) in enumerate(chords):   # (the bar's own spacing kept: "we adore ^Thee" -> "we adore [D]Thee")
            label = "" if ch["sym"] == prev else "[%s]" % ch["sym"]
            prev = ch["sym"]
            bar += label + (segs[j] if j < len(segs) else "")
        bar += "".join(segs[len(chords):])
        put(bar.strip())
    lines = [re.sub(r"\s+", " ", ln.replace("~", "")).strip() for ln in out.split("/")]
    return [ln for ln in lines if ln]


def bar_line(bars):
    return "| " + " | ".join(" ".join(ch["sym"] for ch, _ in b) for b in bars) + " |"


def chart_text(hymn, secs):
    out = ["{title: %s}" % hymn["title"], "{key: %s}" % hymn["key"], "{tempo: %d}" % hymn["bpm"], "{time: %d/4}" % hymn["meter"], ""]
    for s in secs:
        out.append(s["name"])
        if s["lyrics"]:
            out.extend(chordpro_section(s))
        else:
            for i in range(0, len(s["bars"]), 4):
                out.append(bar_line(s["bars"][i:i + 4]))
        out.append("")
    return "\n".join(out).rstrip() + "\n"


def song_file(hymn, secs, duration, stems):
    chords, prev = [], None
    for s in secs:
        for i, b in enumerate(s["bars"]):
            for ch, beat in b:
                if ch["sym"] == prev:
                    continue
                prev = ch["sym"]
                label = ch["sym"].split("/")[0]
                chords.append({"label": label, "bass": ch["sym"].split("/")[1] if "/" in ch["sym"] else None, "bar": s["start"] + i, "beat": beat})
    return {
        "format": 1, "kind": "central-tracks-song", "title": hymn["title"], "artist": ARTIST, "key": hymn["key"], "bpm": hymn["bpm"], "bpb": hymn["meter"],
        "duration": round(duration, 2),
        "sections": [{"name": s["name"], "bar": s["start"], "bars": len(s["bars"]), "lyrics": lyrics_text(*s["lyrics"]) if s["lyrics"] else ""} for s in secs],
        "chords": chords, "chartText": chart_text(hymn, secs),
        "stems": [{"name": n, "role": ROLES[n], "mute": n in ("Click", "Guide")} for n in stems],
        "credits": {"words": hymn["words"], "music": hymn["music"], "arrangement": "Arranged and recorded by Motion Audio. The words and tune are in the public domain; this arrangement and recording are Motion Audio's."},
    }


# ---------------------------------------------------------------- arrangement
class Arranger:
    def __init__(self, hymn, secs, seed):
        self.h, self.secs = hymn, secs
        self.m = hymn["meter"]
        self.rng = np.random.default_rng(seed)
        self.bars = []   # (bar index 0-based, section, chords [(chord, beat)], first?, last?, next energy)
        for si, s in enumerate(secs):
            nxt = secs[si + 1]["energy"] if si + 1 < len(secs) else -1
            for i, b in enumerate(s["bars"]):
                self.bars.append({"i": s["start"] - 1 + i, "sec": s, "si": si, "chords": b, "first": i == 0, "last": i == len(s["bars"]) - 1, "next": nxt,
                                  "final": si == len(secs) - 1 and i == len(s["bars"]) - 1})

    def jitter(self, beats=0.012):
        return float(self.rng.normal(0, beats))

    def vel(self, e, spread=6, add=0):
        return int(max(20, min(127, VEL[e] + add + self.rng.integers(-spread, spread + 1))))

    def segments(self, bar):
        """[(chord, start beat in the song (0-based), length in beats)] for one bar"""
        out = []
        cs = bar["chords"]
        for j, (ch, beat) in enumerate(cs):
            end = cs[j + 1][1] if j + 1 < len(cs) else self.m + 1
            out.append((ch, bar["i"] * self.m + beat - 1, end - beat))
        return out

    @staticmethod
    def voicings(ch, lo, hi, count):
        pcs = []
        for iv in ch["ivs"]:
            pc = (ch["root"] + iv) % 12
            if pc not in pcs:
                pcs.append(pc)
        pcs = pcs[:count]
        out = []
        for start in range(lo, hi + 1):
            if start % 12 not in pcs:
                continue
            k = pcs.index(start % 12)
            seq = pcs[k:] + pcs[:k]
            notes = [start]
            for pc in seq[1:]:
                n = notes[-1] + 1
                while n % 12 != pc:
                    n += 1
                notes.append(n)
            if notes[-1] <= hi:
                out.append(notes)
        return out

    def voice(self, ch, lo, hi, count, prev, center):
        cands = self.voicings(ch, lo, hi, count) or [[lo + (ch["root"] - lo) % 12]]
        if prev and len(prev) == len(cands[0]):
            return min(cands, key=lambda v: sum(abs(a - b) for a, b in zip(v, prev)) + 0.1 * abs(np.mean(v) - center))
        return min(cands, key=lambda v: abs(np.mean(v) - center))

    def bass_note(self, ch, prev):
        cands = [n for n in range(28, 52) if n % 12 == ch["bass"]]
        return min(cands, key=lambda n: abs(n - (prev or 38)) + (0 if n >= 31 else 4))

    # -- parts (each returns a Midi on channel ch)
    def drums(self, prog, channel, bank=0):
        mid = M.Midi(self.h["bpm"])
        if channel != 9:
            mid.program(channel, prog, bank)
        K, S, X, HC, HP, HO, RIDE, CRASH = 36, 38, 37, 42, 44, 46, 51, 49
        TOMS = [50, 47, 43, 41]
        m = self.m
        for b in self.bars:
            e = b["sec"]["energy"]
            t0 = b["i"] * m
            if b["final"]:
                if e >= 1 or b["sec"]["energy"] >= 0:
                    mid.note(t0, 1, CRASH, 100, channel)
                    mid.note(t0, 1, K, 105, channel)
                continue
            if e == 0:
                continue
            hits = []
            if m == 4:
                if e == 1:
                    hits += [(0, K, 70), (2, X, 55)] + [(q, HC, 45) for q in (0, 1, 2, 3)]
                elif e == 2:
                    hits += [(0, K, 92), (1.5, K, 70), (2, K, 85), (1, S, 95), (3, S, 98)] + [(q / 2, HC, 70 if q % 2 == 0 else 52) for q in range(8)]
                else:
                    hits += [(0, K, 108), (1.5, K, 85), (2, K, 100), (2.5, K, 70), (1, S, 112), (3, S, 115)] + [(q / 2, RIDE, 82 if q % 2 == 0 else 64) for q in range(8)]
            else:
                if e == 1:
                    hits += [(0, K, 70), (1, HP, 45), (2, HP, 45)]
                elif e == 2:
                    hits += [(0, K, 92), (1.5, K, 66), (2, S, 92)] + [(q / 2, HC, 70 if q % 2 == 0 else 50) for q in range(6)]
                else:
                    hits += [(0, K, 108), (1.5, K, 85), (2, S, 112)] + [(q / 2, RIDE, 84 if q % 2 == 0 else 62) for q in range(6)]
            if b["first"] and e >= 2:
                hits.append((0, CRASH, 100 if e == 3 else 84))
            fill = b["last"] and b["next"] >= 2 and b["next"] >= e and e >= 1
            if fill:   # the last beat: snare and toms in 16ths, the kick under the last one
                cut = m - 1
                hits = [hh for hh in hits if hh[0] < cut]
                seq = [S, S, TOMS[0], TOMS[1]] if e == 1 else [S, TOMS[0], TOMS[1], TOMS[3]]
                for k, note in enumerate(seq):
                    hits.append((cut + k / 4, note, 80 + 8 * k))
            for at, note, v in hits:
                mid.note(t0 + at + self.jitter(0.006), 0.25, note, max(1, min(127, v + int(self.rng.integers(-5, 6)))), channel)
        return mid

    def bass(self, prog, channel, bank=0):
        mid = M.Midi(self.h["bpm"])
        mid.program(channel, prog, bank)
        prev = None
        for b in self.bars:
            e = b["sec"]["energy"]
            if e == 0 and not b["final"]:
                continue
            for ch, at, ln in self.segments(b):
                n = self.bass_note(ch, prev)
                prev = n
                if b["final"]:
                    mid.note(at, self.m * 2, n, 90, channel)
                elif e == 1:
                    mid.note(at + self.jitter(), ln - 0.15, n, self.vel(1), channel)
                elif e == 2:
                    if ln >= 3 and self.m == 4:
                        mid.note(at, 1.4, n, self.vel(2, add=4), channel)
                        mid.note(at + 1.5, 0.45, n, self.vel(2, add=-8), channel)
                        mid.note(at + 2, ln - 2.15, n, self.vel(2), channel)
                    elif ln >= 3:
                        mid.note(at, 1.9, n, self.vel(2, add=4), channel)
                        fifth = n + 7 if n + 7 <= 52 else n - 5
                        mid.note(at + 2, 0.9, fifth, self.vel(2, add=-6), channel)
                    else:
                        mid.note(at, ln - 0.1, n, self.vel(2), channel)
                else:
                    steps = int(ln * 2)
                    for k in range(steps):
                        note = n + 12 if (k == steps - 1 and steps >= 6) else n
                        mid.note(at + k / 2 + self.jitter(0.005), 0.42, note, self.vel(3, add=6 if k % 2 == 0 else -6), channel)
        return mid

    def keys(self, prog, channel, bank=0):
        mid = M.Midi(self.h["bpm"])
        mid.program(channel, prog, bank)
        prev = None
        for b in self.bars:
            e = b["sec"]["energy"]
            for ch, at, ln in self.segments(b):
                rh = self.voice(ch, 60, 79, 3, prev, 69)
                prev = rh
                lh = [n for n in range(36, 49) if n % 12 == ch["bass"]][0]
                mid.cc(at, 64, 0, channel)
                mid.cc(at + 0.02, 64, 127, channel)
                if b["final"]:
                    for n in [lh, lh + 12] + rh:
                        mid.note(at, self.m * 2, n, 80, channel)
                    continue
                if e <= 1:      # broken chord in eighths: bass, then up and down the chord
                    arp = [lh, lh + 7 if lh + 7 < rh[0] else lh + 12] + rh + rh[-2:0:-1]
                    steps = int(ln * 2)
                    for k in range(steps):
                        mid.note(at + k / 2 + self.jitter(0.008), 1.0, arp[k % len(arp)], self.vel(e, add=-4 if k % 2 else 2), channel)
                elif e == 2:
                    mid.note(at, ln, lh, self.vel(2), channel)
                    mid.note(at, ln, lh + 12, self.vel(2, add=-10), channel)
                    hits = [0, 2] if self.m == 4 else [0, 1.5]
                    for hpos in hits:
                        if hpos < ln:
                            for n in rh:
                                mid.note(at + hpos + self.jitter(0.006), min(1.8, ln - hpos), n, self.vel(2, add=-6 if hpos else 0), channel)
                else:
                    mid.note(at, ln, lh, self.vel(3), channel)
                    mid.note(at, ln, lh - 12 if lh - 12 >= 28 else lh + 12, self.vel(3, add=-8), channel)
                    for qn in range(int(ln)):
                        for n in rh + [rh[0] + 12]:
                            mid.note(at + qn + self.jitter(0.005), 0.9, n, self.vel(3, add=4 if qn == 0 else -8), channel)
        mid.cc(self.bars[-1]["i"] * self.m + self.m * 2 + 1, 64, 0, channel)
        return mid

    def pad(self, prog, channel, bank=0):
        mid = M.Midi(self.h["bpm"])
        mid.program(channel, prog, bank)
        prev, held, held_at, held_v = None, None, 0, 60
        for b in self.bars:
            e = b["sec"]["energy"]
            for ch, at, ln in self.segments(b):
                v = self.voice(ch, 52, 74, 4, prev, 63)
                if v != held:
                    if held:
                        for n in held:
                            mid.note(held_at, at - held_at + 0.05, n, held_v, channel)
                    held, held_at, held_v = v, at, 58 + 8 * e
                prev = v
        end = self.bars[-1]["i"] * self.m + self.m * 3
        for n in held or []:
            mid.note(held_at, end - held_at, n, held_v, channel)
        return mid

    def strings(self, prog, channel, bank=0):
        mid = M.Midi(self.h["bpm"])
        mid.program(channel, prog, bank)
        prev = None
        for b in self.bars:
            e = b["sec"]["energy"]
            if e < 2 and not b["final"]:
                prev = None
                continue
            for ch, at, ln in self.segments(b):
                v = self.voice(ch, 50, 76, 4, prev, 64)
                prev = v
                notes = v + ([v[-1] + 12] if e == 3 else [])
                length = self.m * 2 if b["final"] else ln + 0.02
                for n in notes:
                    mid.note(at, length, n, self.vel(e, add=-10), channel)
        return mid

    def electric(self, prog, channel, bank=0):
        mid = M.Midi(self.h["bpm"])
        mid.program(channel, prog, bank)
        prev = None
        for b in self.bars:
            e = b["sec"]["energy"]
            if e < 2 or b["final"]:
                continue
            for ch, at, ln in self.segments(b):
                v = self.voice(ch, 62, 81, 3, prev, 71)
                prev = v
                pattern = [v[0], v[1], v[2], v[1]] if e == 2 else [v[0], v[2], v[1] + 12 if v[1] + 12 <= 86 else v[1], v[2]]
                for k in range(int(ln * 2)):
                    mid.note(at + k / 2 + self.jitter(0.006), 0.9, pattern[k % 4], self.vel(e, add=-12 if k % 2 else -4), channel)
        return mid


def click_stem(hymn, nbars, length):
    m, beat = hymn["meter"], 60.0 / hymn["bpm"]
    x = np.zeros(length, np.float32)
    t = np.arange(int(0.03 * SR)) / SR
    hi = (np.sin(2 * np.pi * 1600 * t) * np.exp(-t / 0.008)).astype(np.float32)
    lo = (np.sin(2 * np.pi * 1000 * t) * np.exp(-t / 0.008)).astype(np.float32) * 0.7
    for b in range(nbars):
        for k in range(m):
            i = int(round((b * m + k) * beat * SR))
            snd = hi if k == 0 else lo
            if i + len(snd) <= length:
                x[i:i + len(snd)] += snd
    return x


def cue_word(name):
    n = name.lower()
    m = re.match(r"^verse\s*(\d+)$", n)
    if m:
        return "verse-%s" % m.group(1) if int(m.group(1)) <= 4 else "verse"
    for k, w in CUE_WORDS.items():
        if n.startswith(k):
            return w
    return None


def guide_stem(hymn, secs, length):
    """Each section's name, spoken on the first beat of the bar before it."""
    bar = 60.0 / hymn["bpm"] * hymn["meter"]
    x = np.zeros(length, np.float32)
    for s in secs[1:]:
        word = cue_word(s["name"])
        path = os.path.join(CUES, (word or "") + ".wav")
        if not word or not os.path.isfile(path):
            continue
        w = M.read_wav(path).mean(axis=1)
        sr_in = 16000
        with open(path, "rb") as f:
            hdr = f.read(44)
        try:
            sr_in = int.from_bytes(hdr[24:28], "little")
        except Exception:  # noqa: BLE001
            pass
        w = np.interp(np.arange(int(len(w) * SR / sr_in)) * sr_in / SR, np.arange(len(w)), w).astype(np.float32)
        i = int(round((s["start"] - 2) * bar * SR))
        if 0 <= i and i + len(w) <= length:
            x[i:i + len(w)] += w
    return x


# ---------------------------------------------------------------- audio
def reverb_ir(seconds=2.4, seed=3):
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = rng.normal(0, 1, n) * np.exp(-6.9 * t / seconds)
    spec = np.fft.rfft(ir)
    f = np.fft.rfftfreq(n, 1 / SR)
    ir = np.fft.irfft(spec / (1 + (f / 6000.0) ** 2), n)          # (a darker tail)
    ir[:int(0.02 * SR)] = 0                                         # (20 ms pre-delay)
    return (ir / np.sqrt(np.sum(ir ** 2))).astype(np.float32)


def convolve(x, ir):
    n = len(x) + len(ir) - 1
    size = 1 << (n - 1).bit_length()
    y = np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[:len(x)]
    return y.astype(np.float32)


def active_rms(x):
    frames = len(x) // 4410
    if frames == 0:
        return 0.0
    blocks = x[:frames * 4410].reshape(frames, 4410)
    r = np.sqrt(np.mean(blocks ** 2, axis=1))
    loud = r[r > max(1e-4, np.max(r) * 0.05)]
    return float(np.sqrt(np.mean(loud ** 2))) if len(loud) else 0.0


def level(x, target_db):
    r = active_rms(x)
    if r <= 0:
        return x
    y = x * (10 ** (target_db / 20.0) / r)
    peak = float(np.max(np.abs(y)))
    return y * (0.95 / peak) if peak > 0.95 else y


def mp3(wav_path, out, kbps, channels):
    r = subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", wav_path, "-ac", str(channels), "-codec:a", "libmp3lame", "-b:a", "%dk" % kbps, out], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError("ffmpeg: " + r.stderr[-300:])
    return out


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for blk in iter(lambda: f.read(1 << 20), b""):
            h.update(blk)
    return h.hexdigest()


def find_bank(dirs, bank):
    for d in dirs:
        if not d or not os.path.isdir(d):
            continue
        for fn in sorted(os.listdir(d)):   # ("<bank> - <slug>.sf2"; VSCO's banks are "VSCO-Strings - VSCO-Strings.sf2")
            if fn.lower().endswith(".sf2") and fn.split(" - ")[0].strip().lower().replace("-", " ") == bank.lower():
                return os.path.join(d, fn)
    return None


def sources(opt):
    """stem -> (sf2 path, bank, program, channel)"""
    out = {}
    for stem, (bank, words, gm) in STEMS.items():
        if opt.get("gm"):
            out[stem] = (opt["gm"], 128 if gm[1] == 9 else 0, gm[0], gm[1])
            continue
        path = find_bank([opt.get("sounds"), opt.get("orchestra")], bank)
        if not path and stem == "Strings":
            bank, words = STRINGS_FALLBACK
            path = find_bank([opt.get("sounds")], bank)
        if not path:
            raise SystemExit("no %s SoundFont in %s (build the libraries first)" % (bank, opt.get("sounds")))
        pr = M.find_preset(path, *words)
        if not pr:
            raise SystemExit("no preset %r in %s" % (words, path))
        out[stem] = (path, pr[0], pr[1], 0)
    return out


def render_hymn(hymn, opt, out_dir, srcs):
    secs = layout(hymn)
    nbars = sum(len(s["bars"]) for s in secs)
    bar_s = 60.0 / hymn["bpm"] * hymn["meter"]
    length = int((nbars + 2) * bar_s * SR + 3 * SR)
    if opt.get("seconds"):
        length = min(length, int(float(opt["seconds"]) * SR))
    duration = length / SR
    seed = int(hashlib.sha1(hymn["id"].encode()).hexdigest()[:8], 16)
    arr = Arranger(hymn, secs, seed)
    d = os.path.join(out_dir, hymn["id"])
    os.makedirs(d, exist_ok=True)
    ir = reverb_ir()
    stems = {}
    for stem in ("Drums", "Bass", "Keys", "Pad", "Electric", "Strings"):
        sf2, bank, prog, channel = srcs[stem]
        mid = getattr(arr, stem.lower())(prog, channel, bank)
        mp = os.path.join(d, stem + ".mid")
        mid.save(mp)
        x = M.render(sf2, mp, sr=SR).mean(axis=1)
        x = np.pad(x, (0, max(0, length - len(x))))[:length]
        if stem in REVERB:
            x = x + REVERB[stem] * convolve(x, ir)
        stems[stem] = level(x, LEVELS[stem])
        say("    %-8s %.1f s, peak %.2f" % (stem, len(x) / SR, float(np.max(np.abs(stems[stem])))))
    stems["Click"] = level(click_stem(hymn, nbars, length), LEVELS["Click"])
    stems["Guide"] = level(guide_stem(hymn, secs, length), LEVELS["Guide"])
    files = []
    for stem, x in stems.items():
        wav = os.path.join(d, stem + ".wav")
        M.write_wav(wav, x, SR)
        out = mp3(wav, os.path.join(d, stem + ".mp3"), 64 if stem in ("Click", "Guide") else 128, 1)
        os.remove(wav)
        files.append({"name": stem + ".mp3", "role": ROLES[stem], "mute": stem in ("Click", "Guide"), "path": out})
    # the mix (stereo, the stems panned) and a 45-second preview from the second verse
    mix = np.zeros((length, 2), np.float32)
    for stem, x in stems.items():
        if stem in ("Click", "Guide"):
            continue
        p = PANS.get(stem, 0.0)
        mix[:, 0] += x * math.cos((p + 1) * math.pi / 4)
        mix[:, 1] += x * math.sin((p + 1) * math.pi / 4)
    mix = np.tanh(mix * 1.2) / 1.2
    mix *= 0.89 / (float(np.max(np.abs(mix))) or 1.0)
    wav = os.path.join(d, "mix.wav")
    M.write_wav(wav, mix, SR)
    mix_mp3 = mp3(wav, os.path.join(d, hymn["id"] + "-mix.mp3"), 160, 2)
    v2 = next((s for s in secs if s["name"].lower() == "verse 2"), secs[min(1, len(secs) - 1)])
    a = int((v2["start"] - 1) * bar_s * SR)
    clip = mix[a:a + 45 * SR].copy()
    fade = int(2 * SR)
    if len(clip) > 2 * fade:
        clip[:fade] *= np.linspace(0, 1, fade)[:, None]
        clip[-fade:] *= np.linspace(1, 0, fade)[:, None]
    M.write_wav(wav, clip, SR)
    prev_mp3 = mp3(wav, os.path.join(d, hymn["id"] + "-preview.mp3"), 128, 2)
    os.remove(wav)
    song = song_file(hymn, secs, duration, list(stems))
    song_path = os.path.join(d, "song.json")
    with open(song_path, "w") as f:
        json.dump(song, f, indent=1, ensure_ascii=False)
    for f in os.listdir(d):
        if f.endswith(".mid"):
            os.remove(os.path.join(d, f))
    return {"files": files, "song": song_path, "mix": mix_mp3, "preview": prev_mp3, "duration": duration}


def release_name(hid, name):
    return "%s--%s" % (hid, re.sub(r"[^A-Za-z0-9.-]+", "-", name))


def index_entry(hymn, base, built=None):
    secs = layout(hymn)
    nbars = sum(len(s["bars"]) for s in secs)
    dur = round((nbars + 2) * 60.0 / hymn["bpm"] * hymn["meter"] + 3, 1)
    names = [("%s.mp3" % s, ROLES[s]) for s in ("Drums", "Bass", "Keys", "Pad", "Electric", "Strings", "Click", "Guide")]

    def entry(name, role=None, path=None, mute=False):
        e = {"name": name, "file": release_name(hymn["id"], name), "url": base + "/" + release_name(hymn["id"], name)}
        if role:
            e["role"] = role
        if mute:
            e["mute"] = True
        if path and os.path.isfile(path):
            e["size"] = os.path.getsize(path)
            e["sha256"] = sha256(path)
        return e
    paths = {os.path.basename(f["path"]): f["path"] for f in (built or {}).get("files", [])}
    return {
        "id": hymn["id"], "title": hymn["title"], "artist": ARTIST, "kind": "Multitrack", "key": hymn["key"], "bpm": hymn["bpm"], "meter": hymn["meter"],
        "duration": round((built or {}).get("duration", dur), 1), "words": hymn["words"], "music": hymn["music"], "publicDomain": True,
        "sections": [s["name"] for s in secs],
        "stems": [entry(n, r, paths.get(n), n in ("Click.mp3", "Guide.mp3")) for n, r in names],
        "song": entry("song.json", "song", (built or {}).get("song")),
        "mix": entry(hymn["id"] + "-mix.mp3", None, (built or {}).get("mix")),
        "preview": entry(hymn["id"] + "-preview.mp3", None, (built or {}).get("preview")),
    }


def load(only=None):
    with open(DATA) as f:
        hymns = json.load(f)["hymns"]
    return [h for h in hymns if not only or h["id"] == only]


def main(argv):
    opt, i = {}, 0
    while i < len(argv):
        a = argv[i]
        if a in ("--sounds", "--orchestra", "--out", "--only", "--base-url", "--seconds", "--gm", "--write-builtin"):
            opt[a[2:].replace("-", "_")] = argv[i + 1]
            i += 2
        elif a == "--check":
            opt["check"] = True
            i += 1
        else:
            print(__doc__)
            return 2
    hymns = load(opt.get("only"))
    bad = check(hymns)
    if bad:
        print("\n".join(bad))
        return 1
    base = (opt.get("base_url") or DEFAULT_BASE).rstrip("/")
    if opt.get("check"):
        for h in hymns:
            secs = layout(h)
            print("%-22s %d sections, %d bars, %.0f s" % (h["id"], len(secs), sum(len(s["bars"]) for s in secs), sum(len(s["bars"]) for s in secs) * 60.0 / h["bpm"] * h["meter"]))
        return 0
    if opt.get("write_builtin"):
        with open(opt["write_builtin"], "w") as f:
            json.dump({"note": "Written by tools/make-hymns.py --write-builtin: the hymns' files are on the GitHub release 'central-tracks' (or HYMNS_BASE_URL). The website lists a hymn once that release's hymns-index.json is published.",
                       "hymns": [index_entry(h, DEFAULT_BASE) for h in hymns]}, f, indent=1, ensure_ascii=False)
            f.write("\n")
        print("wrote", opt["write_builtin"])
        return 0
    if not opt.get("out") or not (opt.get("sounds") or opt.get("gm")):
        print(__doc__)
        return 2
    srcs = sources(opt)
    rel = os.path.join(opt["out"], "release")
    os.makedirs(rel, exist_ok=True)
    index = []
    for h in hymns:
        say("%s (%s, %d BPM, %d/4)" % (h["title"], h["key"], h["bpm"], h["meter"]))
        built = render_hymn(h, opt, opt["out"], srcs)
        for f in built["files"] + [{"path": built["song"]}, {"path": built["mix"]}, {"path": built["preview"]}]:
            target = os.path.join(rel, release_name(h["id"], os.path.basename(f["path"])))
            with open(f["path"], "rb") as src, open(target, "wb") as dst:
                dst.write(src.read())
        index.append(index_entry(h, base, built))
    idx = {"format": 1, "base": base, "hymns": index}
    with open(os.path.join(rel, "hymns-index.json"), "w") as f:
        json.dump(idx, f, indent=1, ensure_ascii=False)
    with open(os.path.join(rel, "SHA256SUMS"), "w") as f:
        for fn in sorted(os.listdir(rel)):
            if fn != "SHA256SUMS":
                f.write("%s  %s\n" % (sha256(os.path.join(rel, fn)), fn))
    total = sum(os.path.getsize(os.path.join(rel, fn)) for fn in os.listdir(rel))
    say("Done: %d hymns, %.0f MB in %s" % (len(index), total / 1e6, rel))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
