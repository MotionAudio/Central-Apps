"""Central Tracks (10.3): reads a four-part hymn score in ABC (as the Open Hymnal Project writes them) into what
tools/make-hymns.py needs: the melody's bars, each verse's words on those bars (as the score aligns them, syllable
by syllable), the refrain, and a chord for each part of each bar - worked out from the four voices of the hymnal's
own harmony.

  h = AbcHymn(text)
  h.key, h.meter, h.bars (melody bars: start, length), h.sections -> [{"kind": "verse"|"refrain", "bars": [i...],
      "lines": [[bar indexes of each system line]], "texts": [per verse: (pickup, [bar texts])]}]
  h.chords(bar) -> "G" or "G D@3"

Lyric markup in the bar texts is hymns.json's: "~" a word going on into the next bar, "^" where the bar's second chord
falls, "/" the end of a line."""
import re
from fractions import Fraction

NOTE_RE = re.compile(r"(\^{1,2}|_{1,2}|=)?([A-Ga-gzxZ])([,']*)(\d*(?:/\d*)*)")
KEYS = {  # major key -> its sharps (+) or flats (-) in order
    "C": 0, "G": 1, "D": 2, "A": 3, "E": 4, "B": 5, "F#": 6, "C#": 7, "F": -1, "Bb": -2, "Eb": -3, "Ab": -4, "Db": -5, "Gb": -6, "Cb": -7}
MINOR = {"Am": "C", "Em": "G", "Bm": "D", "F#m": "A", "C#m": "E", "Dm": "F", "Gm": "Bb", "Cm": "Eb", "Fm": "Ab"}
SHARP_ORDER, FLAT_ORDER = "FCGDAEB", "BEADGCF"
LETTER = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
QUAL = [("", (0, 4, 7)), ("m", (0, 3, 7)), ("7", (0, 4, 7, 10)), ("dim", (0, 3, 6))]


def length(s, unit):
    """An ABC length suffix ("2", "/", "3/4", "//") in quarter notes."""
    if not s:
        return unit
    num, _, rest = s.partition("/")
    n = Fraction(int(num) if num else 1)
    if "/" in s:
        dens = s.split("/")[1:]
        for d in dens:
            n /= int(d) if d else 2
    return n * unit


class Voice:
    """One voice's notes: [{t, dur, midi or None (rest), tied_from, bar}]."""
    def __init__(self):
        self.notes = []
        self.bar_starts = [Fraction(0)]
        self.t = Fraction(0)
        self.acc = {}
        self.tie_next = False
        self.tuplet = None
        self.broken = None
        self.lines = []          # (first note index, last note index + 1) of each music line


class AbcHymn:
    def __init__(self, text):
        self.text = text
        self.head = {}
        self.unit = Fraction(1)
        body = []
        in_body = False
        for raw in text.splitlines():
            line = raw.split("%")[0].rstrip() if not raw.startswith("%%") else ""
            if not line.strip():
                continue
            m = re.match(r"^([A-Za-z]):\s*(.*)$", line)
            if m and not in_body:
                self.head.setdefault(m.group(1), []).append(m.group(2).strip())
                if m.group(1) == "K":
                    in_body = True
                continue
            body.append(line)
        self.key = self.head["K"][-1].split()[0]
        num, den = (int(x) for x in self.head["M"][-1].split()[0].split("/"))
        self.meter_sig = (num, den)
        self.meter = Fraction(num * 4, den)                 # (quarter notes per bar)
        L = self.head.get("L", ["1/4"])[-1].split()[0]
        a, b = (int(x) for x in L.split("/"))
        self.unit = Fraction(4 * a, b)
        self.sig = self._signature(self.key)
        self.voices = {}
        self.wlines = []          # (melody line index, [w strings])
        self.mel_name = "S1V1" if any(re.search(r"V:\s*S1V1\b", ln) for ln in body) else "S1"
        cur = None
        for line in body:
            m = re.match(r"^\[V:\s*(\S+)\]\s*(.*)$", line) or re.match(r"^V:\s*(\S+)\s*()$", line)
            if m:
                cur = m.group(1)
                v = self.voices.setdefault(cur, Voice())
                if m.group(2):
                    self._music(v, m.group(2))
                continue
            if line.startswith("w:"):
                if cur == self.mel_name and self.wlines:
                    self.wlines[-1][1].append(line[2:].strip())
                continue
            if line.startswith("W:") or (len(line) > 1 and line[1] == ":" and line[0].isalpha()):
                continue
            if cur:
                self._music(self.voices[cur], line)
        self.melody = self.voices[self.mel_name]
        self._bars()
        self._words()

    # ---------------------------------------------------------------- reading the music
    @staticmethod
    def _signature(key):
        k = MINOR.get(key, key)
        k = k.replace("maj", "")
        n = KEYS.get(k, 0)
        sig = {}
        for i in range(abs(n)):
            sig[(SHARP_ORDER if n > 0 else FLAT_ORDER)[i]] = 1 if n > 0 else -1
        return sig

    def _music(self, v, s):
        start_note = len(v.notes)
        if v is self.voices.get(self.mel_name):
            self.wlines.append((len(v.lines), []))
        i, n = 0, len(s)
        while i < n:
            c = s[i]
            if c == "!" or c == "+":
                j = s.find(c, i + 1)
                i = j + 1 if j > 0 else n
                continue
            if c == '"':
                j = s.find('"', i + 1)
                i = j + 1 if j > 0 else n
                continue
            if c == "{":
                j = s.find("}", i + 1)
                i = j + 1 if j > 0 else n
                continue
            if c == "[" and i + 2 < n and s[i + 1].isalpha() and s[i + 2] == ":":
                j = s.find("]", i)
                i = j + 1 if j > 0 else n
                continue
            if c == "[" and i + 1 < n and (s[i + 1] in "^_=" or s[i + 1].isalpha()):
                j = s.find("]", i)
                inner = s[i + 1:j]
                ms = list(NOTE_RE.finditer(inner))
                k = j + 1
                m2 = re.match(r"\d*(?:/\d*)*", s[k:])
                outer = m2.group(0) if m2 else ""
                if ms:
                    first = ms[0]
                    dur = length(first.group(4), self.unit) * (length(outer, Fraction(1)) if outer else 1)
                    self._note(v, first, dur, more=ms[1:])
                i = k + (len(outer) if outer else 0)
                continue
            if c in "|:" or (c == "]" ) or (c == "[" and i + 1 < n and s[i + 1] in "|1234"):
                j = i
                while j < n and s[j] in "|:][" + "1234" and not (s[j] in "1234" and j > i and s[j - 1] not in "|["):
                    j += 1
                if "|" in s[i:j] or "]" in s[i:j]:
                    if v.t > v.bar_starts[-1]:
                        v.bar_starts.append(v.t)
                    v.acc = {}
                i = max(j, i + 1)
                continue
            if c == "(":
                m3 = re.match(r"\((\d)", s[i:])
                if m3:
                    p = int(m3.group(1))
                    v.tuplet = [Fraction(2 if p == 3 else (3 if p == 2 else p - 1), p), p]
                    i += 2
                    continue
                i += 1
                continue
            if c == "-":
                v.tie_next = True
                i += 1
                continue
            if c in "<>":
                v.broken = c
                i += 1
                continue
            m = NOTE_RE.match(s, i)
            if m and m.group(2):
                self._note(v, m, length(m.group(4), self.unit))
                i = m.end()
                continue
            i += 1
        v.lines.append((start_note, len(v.notes)))

    def _pitch(self, v, m):
        acc, letter, octv = m.group(1), m.group(2), m.group(3)
        if letter in "zxZ":
            return None
        base = LETTER[letter.upper()] + (72 if letter.islower() else 60)
        base += 12 * octv.count("'") - 12 * octv.count(",")
        key = (letter.upper(), base)
        if acc:
            a = {"^": 1, "^^": 2, "_": -1, "__": -2, "=": 0}[acc]
            v.acc[key] = a
        else:
            a = v.acc.get(key, self.sig.get(letter.upper(), 0))
        return base + a

    def _note(self, v, m, dur, more=()):
        acc, letter, octv = m.group(1), m.group(2), m.group(3)
        if v.tuplet:
            dur *= v.tuplet[0]
            v.tuplet[1] -= 1
            if v.tuplet[1] <= 0:
                v.tuplet = None
        if v.broken and v.notes:
            prev = v.notes[-1]
            if v.broken == ">":
                prev["dur"] *= Fraction(3, 2)
                v.t += prev["dur"] / 3
                dur *= Fraction(1, 2)
            else:
                prev["dur"] *= Fraction(1, 2)
                v.t -= prev["dur"]
                dur *= Fraction(3, 2)
            v.broken = None
        midis = [x for x in [self._pitch(v, m)] + [self._pitch(v, mm) for mm in more] if x is not None]
        midi = max(midis) if midis else None
        tied = v.tie_next and midi is not None and v.notes and v.notes[-1]["midi"] == midi
        v.tie_next = False
        v.notes.append({"t": v.t, "dur": dur, "midi": midi, "midis": midis, "tied_from": bool(tied), "line": len(v.lines)})
        v.t += dur

    # ---------------------------------------------------------------- bars
    def _bars(self):
        st = self.melody.bar_starts + ([self.melody.t] if self.melody.t > self.melody.bar_starts[-1] else [])
        self.bar_starts = st
        for nt in self.melody.notes:
            nt["bar"] = max(i for i, b in enumerate(st[:-1]) if b <= nt["t"]) if nt["t"] < st[-1] else len(st) - 2
        self.nbars = len(st) - 1
        self.pickup = (st[1] - st[0]) < self.meter if self.nbars > 1 else False

    def bar_len(self, i):
        return self.bar_starts[i + 1] - self.bar_starts[i]

    # ---------------------------------------------------------------- words
    @staticmethod
    def tokens(w):
        """ABC lyric line -> [(text, joins_next)] plus markers "_" (hold), "*" (skip a note), "|" (next bar)."""
        out, cur, i = [], "", 0
        w = w.replace("\\-", "\u2011")
        while i < len(w):
            c = w[i]
            if c in " \t":
                if cur:
                    out.append((cur, False))
                    cur = ""
            elif c == "-":
                if cur:
                    out.append((cur, True))
                    cur = ""
                elif out and isinstance(out[-1], tuple) and out[-1][1]:
                    out.append("_")       # (a second hyphen: the syllable is held over another note)
                else:
                    out.append("_")
            elif c in "_*|":
                if cur:
                    out.append((cur, False))
                    cur = ""
                out.append(c)
            elif c == "~":
                cur += " "
            else:
                cur += c
            i += 1
        if cur:
            out.append((cur, False))
        return [(t[0].replace("\u2011", "-"), t[1]) if isinstance(t, tuple) else t for t in out]

    def _align(self, line_idx, w, skip_ties):
        """[(note index, text, joins_next)] for one lyric line on one music line of the melody."""
        a, b = self.melody.lines[line_idx]
        notes = [k for k in range(a, b) if self.melody.notes[k]["midi"] is not None and not (skip_ties and self.melody.notes[k]["tied_from"])]
        out, p, bad = [], 0, 0
        for tok in self.tokens(w):
            if tok == "|":
                if p < len(notes):
                    cur_bar = self.melody.notes[notes[p - 1]]["bar"] if p else -1
                    while p < len(notes) and self.melody.notes[notes[p]]["bar"] <= cur_bar:
                        p += 1
                continue
            if p >= len(notes):
                bad += 1
                continue
            if tok in ("_", "*"):
                p += 1
                continue
            out.append((notes[p], tok[0], tok[1]))
            p += 1
        bad += max(0, len(notes) - p - 2)
        return out, bad

    def _words(self):
        """Each system's lyric lines aligned (whichever way ties count that fits the words better)."""
        best = None
        for skip in (True, False):
            al, bad = [], 0
            for li, ws in self.wlines:
                rows = []
                for w in ws:
                    r, b = self._align(li, w, skip)
                    rows.append(r)
                    bad += b
                al.append((li, rows))
            if best is None or bad < best[0]:
                best = (bad, al)
        self.misfit = best[0]
        self.aligned = best[1]       # [(music line, [per lyric line: [(note, text, joins)]])]

    # ---------------------------------------------------------------- sections
    def sections(self):
        """Verse and refrain sections (a refrain: systems with one lyric line where the verses have several)."""
        nverses = max((len(rows) for _, rows in self.aligned), default=0)
        segs = []
        for li, rows in self.aligned:
            kind = "verse" if len(rows) == nverses or nverses == 1 else ("refrain" if len(rows) == 1 else "verse")
            if segs and segs[-1]["kind"] == kind:
                segs[-1]["lines"].append(li)
            else:
                segs.append({"kind": kind, "lines": [li]})
        out = []
        for s in segs:
            notes = [n for li in s["lines"] for n in range(*self.melody.lines[li])]
            out.append({"kind": s["kind"], "lines": s["lines"], "first_note": notes[0] if notes else 0, "last_note": notes[-1] if notes else 0})
        # bars: a bar belongs to the section that owns its downbeat
        for k, s in enumerate(out):
            n0 = self.melody.notes[s["first_note"]]
            b0 = n0["bar"] if n0["t"] == self.bar_starts[n0["bar"]] else n0["bar"] + 1
            s["bar0"] = b0
        for k, s in enumerate(out):
            s["bar1"] = out[k + 1]["bar0"] if k + 1 < len(out) else self.nbars
            if k == 0 and self.pickup:
                s["bar0"] = max(s["bar0"], 1)
        self.nverses = nverses
        return out

    def verse_texts(self, sec, verse):
        """(pickup, [bar texts]) of one verse (or the refrain: verse 0) over a section's bars."""
        syl = []
        for li, rows in self.aligned:
            if li in sec["lines"]:
                row = rows[min(verse, len(rows) - 1)]
                syl += row
        return self._bar_texts(syl, sec["bar0"], sec["bar1"])

    def _bar_texts(self, syl, b0, b1):
        bars = {b: [] for b in range(b0, b1)}
        pickup = []
        for k, (ni, text, joins) in enumerate(syl):
            nt = self.melody.notes[ni]
            b = nt["bar"]
            if b < b0:
                pickup.append((ni, text, joins))
            elif b < b1:
                bars[b].append((ni, text, joins))
        out = []
        for b in range(b0, b1):
            out.append(self._join(bars[b], b))
        ptext = self._join(pickup, None).replace(" /", "").strip()
        if out and not out[-1].rstrip().endswith("/"):
            out[-1] = out[-1].rstrip() + " /"
        return ptext, out

    def _join(self, items, bar):
        s = ""
        prev_join = False
        change = self.change_at.get(bar) if bar is not None else None
        marked = False
        for k, (ni, text, joins) in enumerate(items):
            nt = self.melody.notes[ni]
            piece = text
            if change is not None and not marked and bar is not None and nt["t"] - self.bar_starts[bar] >= change - Fraction(1, 64):
                piece = "^" + piece
                marked = True
            if s and not prev_join:
                s += " "
            s += piece
            # (a line ends on punctuation sung on a long note - a breath)
            if re.search(r"[.,;:!?]['\"]?$", text) and not joins and (nt["dur"] >= Fraction(3, 2) or k == len(items) - 1 and nt["dur"] >= 1 or re.search(r"[.;:!?]$", text)):
                s += " /"
            prev_join = joins
        if items and items[-1][2]:
            s += "~"
        return s

    # ---------------------------------------------------------------- harmony
    def harmonize(self, sharps=None):
        """A chord for each bar (and where its second chord starts), from the four voices."""
        names = FLAT_NAMES if (sharps is False or (sharps is None and self._flat_key())) else SHARP_NAMES
        tonic = LETTER[MINOR.get(self.key, self.key)[0]] + (1 if "#" in self.key else -1 if "b" in self.key[1:] else 0)
        scale = {(tonic + d) % 12 for d in (0, 2, 4, 5, 7, 9, 11)}
        self.change_at = {}
        self.bar_chords = []
        voices = [v for k, v in self.voices.items()]
        step = Fraction(3, 2) if self.meter_sig[1] == 8 else Fraction(1)
        for b in range(self.nbars):
            t0, t1 = self.bar_starts[b], self.bar_starts[b + 1]
            slots = []
            t = t0
            while t < t1:
                e = min(t1, t + step)
                w = [0.0] * 12
                bass = None
                for v in voices:
                    for nt in v.notes:
                        if not nt["midis"]:
                            continue
                        a, z = max(t, nt["t"]), min(e, nt["t"] + nt["dur"])
                        for mp in nt["midis"]:
                            if z > a:
                                w[mp % 12] += float(z - a) * (1.2 if nt["t"] <= t else 1.0)
                            if nt["t"] <= t < nt["t"] + nt["dur"] and (bass is None or mp < bass):
                                bass = mp
                slots.append((t - t0, self._fit(w, bass, scale), e - t))
                t = e
            if not slots:
                self.bar_chords.append(None)
                continue
            first = slots[0][1]
            change, best = None, 0.0
            for k in range(1, len(slots)):
                ch = slots[k][1]
                if ch and ch != first and all(s[1] == ch or s[1] is None for s in slots[k:]):
                    rest = sum(float(s[2]) for s in slots[k:])
                    if rest > best:
                        change, best = slots[k], rest
            if first is None:
                first = next((s[1] for s in slots if s[1]), None)
            if change and change[0] > 0:
                self.change_at[b] = change[0]
            self.bar_chords.append((first, change[1] if change else None, change[0] if change else None))
        self.names = names
        self.scale = scale

    def _flat_key(self):
        k = MINOR.get(self.key, self.key)
        return KEYS.get(k, 0) < 0

    @staticmethod
    def _fit(w, bass, scale):
        tot = sum(w)
        if tot <= 0:
            return None
        best = None
        for root in range(12):
            for q, ivs in QUAL:
                tones = {(root + i) % 12 for i in ivs}
                inn = sum(w[p] for p in tones)
                out = tot - inn
                score = inn - 1.6 * out
                if w[root] <= 0:
                    score -= 2.0
                if bass is not None and bass % 12 == root:
                    score += 0.6 * tot / 4
                if q == "7" and w[(root + 10) % 12] < 0.25:
                    score -= 1.0
                if q == "dim":
                    score -= 0.4
                if root not in scale:
                    score -= 0.5
                if best is None or score > best[0]:
                    best = (score, root, q)
        return (best[1], best[2])

    def chord_name(self, ch):
        root, q = ch
        return self.names[root] + q

    def chords(self, b):
        c = self.bar_chords[b]
        if not c or not c[0]:
            return None
        s = self.chord_name(c[0])
        if c[1] and c[2] is not None and c[2] > 0:
            beat = c[2] + 1                     # (in quarter notes, as hymns.json counts beats)
            s += " %s@%s" % (self.chord_name(c[1]), int(beat) if beat == int(beat) else float(beat))
        return s
