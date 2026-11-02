#!/usr/bin/env python3
"""Central Pedal - Central Tracks hymns (10.0): public-domain hymns in our own modern worship arrangements, rendered into
multitrack stems with our own sound libraries, plus everything the apps need to play them as a song: sections, lyrics,
chords and a chord chart.

Each hymn in hymns/hymns.json becomes (in <out>/<id>/ and, flat, in <out>/release/ for the GitHub release):
  Drums, Percussion, Bass, Keys, Synth,       the band (tools/worship_band.py), one stereo MP3 each (192 kbit/s); the
  Electric 1, Electric 2, Strings             release names them <id>--Electric-1.mp3 and so on
  Click, Guide                                a click and spoken section cues (the apps mute these two: they make their
                                              own, which follow tempo and key changes; they're there for other players)
  song.json                                   key, tempo, meter, sections (bar + lyrics), chords (bar + beat), chord chart
  <id>-mix.mp3, <id>-preview.mp3              the whole song mixed, and a 30-second preview of its best part (10.2: the
                                               chorus - the second one, once the song has built - else its loudest 30 seconds)
and <out>/release/hymns-index.json (what the website lists in Central Tracks) + SHA256SUMS, and CREDITS.txt (the
sampled instruments' credits: the Salamander piano is CC-BY, so the credit goes where the tracks are).

10.2: each hymn has its own arrangement - its own key, tempo, feel, band and mix ("style" in hymns.json; the styles,
their players and their mixes are in tools/hymn_arranger.py): a soul ballad, a gospel shuffle, a folk waltz, a Celtic
lilt, hymn-rock, piano and strings, a cathedral organ and orchestra, a 6/8-style gospel ballad and a country train
beat. The parts follow the hymn's chords and form: each section has an energy (0 the quietest .. 3 everything) that
decides who plays and how hard, the last bars of a section lean into a bigger one, the timing and touch are human, and
the song ends on a held chord. No melody stem: the people sing the melody.

    python3 tools/make-hymns.py --sounds DIR [--orchestra DIR] --out DIR [--only ID] [--base-url URL] [--seconds N]
    python3 tools/make-hymns.py --gm FILE.sf2 --out DIR ...       (a test with any General MIDI SoundFont)
    python3 tools/make-hymns.py --check                            (the data only: bar counts, lyrics, chords)
    python3 tools/make-hymns.py --write-builtin server/src/hymns-builtin.json

--sounds: the SoundFonts tools/build-libraries.sh built (Central Keys and Central Instrument banks); --orchestra: where
sounds-vsco.py wrote VSCO Strings, Brass and Woodwinds (without it each falls back to the nearest library sound).
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
import hymn_arranger as HA  # noqa: E402
import worship_band as WB  # noqa: E402

DATA = os.path.join(ROOT, "hymns", "hymns.json")
CUES = os.path.join(ROOT, "hymns", "guide")   # (10.2: spoken by Piper's LJSpeech voice - tools/make-guide-cues.py)
DEFAULT_BASE = "https://github.com/MotionAudio/central-apps/releases/download/central-tracks"
SR = 44100
ARTIST = "Motion Audio"
NOTES = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11}
QUALITIES = {"": (0, 4, 7), "m": (0, 3, 7), "7": (0, 4, 7, 10), "maj7": (0, 4, 7, 11), "m7": (0, 3, 7, 10), "sus4": (0, 5, 7), "sus": (0, 5, 7),
             "sus2": (0, 2, 7), "2": (0, 2, 4, 7), "add9": (0, 4, 7, 14), "6": (0, 4, 7, 9), "m6": (0, 3, 7, 9), "dim": (0, 3, 6), "aug": (0, 4, 8)}
CHORD_RE = re.compile(r"^([A-G][#b]?)([^/]*)(?:/([A-G][#b]?))?$")

# the stems, the way churches expect them (no acoustic guitar: no sampled one we may sell recordings of is good enough yet)
STEM_ORDER = ("Click", "Guide") + WB.STEMS
ROLES = {"Drums": "drums", "Percussion": "drums", "Bass": "bass", "Keys": "keys", "Synth": "keys", "Electric 1": "guitar", "Electric 2": "guitar",
         "Strings": "music", "Click": "click", "Guide": "guide"}
LEVELS = {"Click": -20.0, "Guide": -16.0}
MIX_LUFS = -14.0
PREVIEW_SECONDS = 30


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
    """"verse", "verse:9-16" (its bars 9 to 16) or "intro*2" (twice)."""
    spec, _, times = spec.partition("*")
    name, _, rng = spec.partition(":")
    bars = hymn["chords"][name]
    if rng:
        a, b = (int(x) for x in rng.split("-"))
        bars = bars[a - 1:b]
    return [parse_bar(b, hymn["meter"]) for b in bars] * int(times or 1)


def lyric_bars(hymn, name):
    """(pickup, [bar texts]) - "Verse 5@9-16": that verse's bars 9 to 16 (the line before them ends at bar 8)."""
    name, _, rng = name.partition("@")
    parts = hymn["lyrics"][name].split("|")
    pickup, texts = parts[0], parts[1:]
    if rng:
        a, b = (int(x) for x in rng.split("-"))
        before = texts[a - 2] if a >= 2 else pickup
        # (a word sung on the bar before - the pickup into the line - comes along: what follows the last "/")
        if "/" in before:
            pickup = before.split("/")[-1].strip()
        else:     # (a whole bar of pickup: the line before it ended a bar earlier)
            pickup = before.strip() if a >= 3 and texts[a - 3].rstrip().endswith("/") else ""
        texts = texts[a - 1:b]
        if texts and texts[-1].strip() and not texts[-1].rstrip().endswith("/"):
            texts[-1] = texts[-1].rstrip() + " /"
    return pickup, texts


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
        out.append({"name": sec["name"], "start": bar, "bars": bars, "energy": int(sec.get("energy", 1)), "lyrics": lyr, "role": sec.get("role")})
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
        "credits": {"words": hymn["words"], "music": hymn["music"], "arrangement": "Arranged and recorded by Motion Audio. The words and tune are in the public domain; this arrangement and recording are Motion Audio's.",
                    "instruments": [c for c, _ in WB.SM.credits(["piano", "drums", "bass", "gretsch", "hofner", "violins"])] + ["Synth pad: Motion Audio (tools/pad_voices.py)", "Guide voice: Piper LJSpeech (MIT; LJ Speech, public domain)"]},
    }


# ---------------------------------------------------------------- click and guide
def click_stem(hymn, nbars, length, sub=1):
    """A clean click: a short, bright tick on each beat (higher on the one), stereo-centred."""
    m, beat = hymn["meter"], 60.0 / hymn["bpm"]
    x = np.zeros(length, np.float32)
    n = int(0.018 * SR)
    t = np.arange(n) / SR
    env = np.exp(-t / 0.0035)
    tick = lambda f: ((np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * 2.01 * f * t)) * env).astype(np.float32)
    hi, lo = tick(2000) * 1.0, tick(1250) * 0.65
    for b in range(nbars):
        for k in range(m):
            i = int(round((b * m + k) * beat * SR))
            snd = hi if k == 0 else lo
            if i + n <= length:
                x[i:i + n] += snd
    return x


def _cue(word):
    path = os.path.join(CUES, word + ".wav")
    if not os.path.isfile(path):
        return None
    w = M.read_wav(path).mean(axis=1)
    with open(path, "rb") as f:
        sr_in = int.from_bytes(f.read(28)[24:28], "little") or 22050
    return np.interp(np.arange(int(len(w) * SR / sr_in)) * sr_in / SR, np.arange(len(w)), w).astype(np.float32)


def cue_words(sec, prev):
    """What the guide says before a section: its name, and what the band does ("All in", "Build", "Down")."""
    n = sec["name"].lower()
    m = re.match(r"^verse\s*(\d+)", n)
    name = "verse-%s" % m.group(1) if m and int(m.group(1)) <= 5 else next((w for w in ("chorus", "refrain", "bridge", "interlude", "tag", "outro") if n.startswith(w)), "verse" if n.startswith("verse") else None)
    if sec.get("role") == "outro":
        name = "outro"
    role, before = sec.get("role"), (prev or {}).get("role")
    mod = None
    if role == "final" and before != "final":
        mod = "all-in"
    elif role == "chorus" and before in ("verse", "verse2", "pre", "drop", "intro"):
        mod = "all-in"
    elif role in ("pre",):
        mod = "build"
    elif role == "drop" or (role == "bridge"):
        mod = "down"
    elif role == "verse2" and before in ("verse", "intro"):
        mod = "band-in"
    return [w for w in (name, mod) if w]


def guide_stem(hymn, secs, length):
    """Each section's cue, spoken from the first beat of the bar before it - and "Build" again halfway through a bridge."""
    beat = 60.0 / hymn["bpm"]
    bar = beat * hymn["meter"]
    x = np.zeros(length, np.float32)

    def put(at, words):
        i = int(round(at * SR))
        for w in words:
            snd = _cue(w)
            if snd is None:
                continue
            if 0 <= i and i + len(snd) <= length:
                x[i:i + len(snd)] += snd
            i += len(snd) + int(0.12 * SR)
    for k, s in enumerate(secs):
        if k == 0:
            continue
        put((s["start"] - 2) * bar, cue_words(s, secs[k - 1]))
        if s.get("role") == "bridge" and len(s["bars"]) >= 4:
            put((s["start"] - 2 + len(s["bars"]) // 2) * bar, ["build"])
    return x


# ---------------------------------------------------------------- audio
_IR_SPECTRA = {}


def convolve(x, ir, *more):
    """x through the impulse response(s): one result per response (one FFT of x for all of them)."""
    size = HA.fast_len(len(x) + max(len(r) for r in (ir,) + more) - 1)
    spec = np.fft.rfft(x, size)
    out = []
    for r in (ir,) + more:
        key = (id(r), size)
        if key not in _IR_SPECTRA:
            _IR_SPECTRA.clear() if len(_IR_SPECTRA) > 8 else None
            _IR_SPECTRA[key] = np.fft.rfft(r, size)
        out.append(np.fft.irfft(spec * _IR_SPECTRA[key], size)[:len(x)].astype(np.float32))
    return out[0] if not more else out


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


def loudness(x):
    import pyloudnorm
    return pyloudnorm.Meter(SR).integrated_loudness(x.astype(np.float64))


def limit(x, ceiling=0.84, look=0.004, release=0.08):
    """A look-ahead peak limiter (the peaks found at 4x, so the true peak stays under the ceiling)."""
    from scipy.ndimage import maximum_filter1d
    from scipy.signal import lfilter, resample_poly
    peak = np.max(np.abs(resample_poly(x, 4, 1, axis=0)), axis=1).reshape(-1, 4).max(axis=1)[:len(x)] if len(x) else np.zeros(0)
    if len(peak) < len(x):
        peak = np.pad(peak, (0, len(x) - len(peak)))
    need = np.minimum(1.0, ceiling / np.maximum(peak, 1e-9))
    w = int(look * SR)
    need = -maximum_filter1d(-need, size=2 * w + 1)                       # (the gain reaches its low point before the peak)
    a = math.exp(-1.0 / (release * SR))
    gr = 1.0 - need
    smooth = lfilter([1 - a], [1, -a], gr)                               # (released slowly)
    gr = np.maximum(gr, smooth)
    return (x * (1.0 - gr)[:, None]).astype(np.float32)


def master(mix):
    """The mix bus: glue, about -14 LUFS, true peaks under -1 dBFS."""
    mix = WB.glue(mix, 1.8)
    mix = WB.eq(mix, hp=25, air=0.8)
    for _ in range(2):
        lufs = loudness(mix)
        if not np.isfinite(lufs):
            break
        mix = limit(mix * 10 ** ((MIX_LUFS - lufs) / 20.0))
    return mix.astype(np.float32)


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


class Sources:
    """sound name (hymn_arranger.SOUNDS) -> (sf2 path, bank, program, channel), found once and kept."""
    def __init__(self, opt):
        self.opt, self.cache = opt, {}

    def __call__(self, sound):
        if sound in self.cache:
            return self.cache[sound]
        bank, words, fallbacks, gm = HA.SOUNDS[sound]
        if self.opt.get("gm"):
            got = (self.opt["gm"], 128, 0, 9) if gm == "drums" else (self.opt["gm"], 0, gm, 0)
        else:
            got = None
            for b, w in [(bank, words)] + list(fallbacks):
                path = find_bank([self.opt.get("sounds"), self.opt.get("orchestra")], b)
                pr = M.find_preset(path, *w) if path else None
                if pr:
                    got = (path, pr[0], pr[1], 0)
                    break
            if not got:
                raise SystemExit("no %s %r SoundFont preset in %s (build the libraries first)" % (bank, words, self.opt.get("sounds")))
        self.cache[sound] = got
        return got


def sources(opt):
    return Sources(opt)


PREVIEW_SECONDS = 30


def preview_start(secs, bar_s, mix):
    """(10.2) Where the 30-second preview starts (a frame): the chorus or refrain - the second one when there are two, once
    the song has built - else the loudest 30 seconds of the mix. Held so the whole 30 seconds fit."""
    n = PREVIEW_SECONDS * SR
    last = max(0, len(mix) - n)
    choruses = [s for s in secs if re.match(r"(chorus|refrain)\b", s["name"].lower())]
    if choruses:
        pick = choruses[1] if len(choruses) > 1 else choruses[0]
        return min(last, max(0, int((pick["start"] - 1) * bar_s * SR)))
    mono = np.abs(np.asarray(mix, np.float32)).mean(axis=1) if np.ndim(mix) > 1 else np.abs(np.asarray(mix, np.float32))
    if len(mono) <= n:
        return 0
    step = SR
    energy = np.add.reduceat(mono ** 2, np.arange(0, len(mono), step))
    win = PREVIEW_SECONDS
    sums = np.convolve(energy, np.ones(win), "valid")
    return min(last, int(np.argmax(sums)) * step)


def render_hymn(hymn, opt, out_dir, srcs):
    secs = layout(hymn)
    nbars = sum(len(s["bars"]) for s in secs)
    bar_s = 60.0 / hymn["bpm"] * hymn["meter"]
    seed = int(hashlib.sha1(hymn["id"].encode()).hexdigest()[:8], 16) % (2 ** 31)
    d = os.path.join(out_dir, hymn["id"])
    os.makedirs(d, exist_ok=True)
    band, mix, _song = WB.render(hymn, secs, opt, seed=seed, log=say)
    length = len(mix)
    duration = length / SR
    stems = {"Click": level(click_stem(hymn, nbars, length), LEVELS["Click"]), "Guide": level(guide_stem(hymn, secs, length), LEVELS["Guide"])}
    stems.update(band)
    files = []
    for stem in STEM_ORDER:
        x = stems[stem]
        wav = os.path.join(d, stem + ".wav")
        M.write_wav(wav, x, SR)
        mono = stem in ("Click", "Guide")
        out = mp3(wav, os.path.join(d, stem + ".mp3"), 64 if mono else 192, 1 if mono else 2)
        os.remove(wav)
        files.append({"name": stem + ".mp3", "role": ROLES[stem], "mute": mono, "path": out})
    # the mix (the stems at unity, then glue and the limiter) and a 30-second preview of the best part (preview_start: the second chorus or refrain)
    mix = master(mix)
    say("    mix: %.1f LUFS, peak %.2f" % (loudness(mix), float(np.max(np.abs(mix)))))
    wav = os.path.join(d, "mix.wav")
    M.write_wav(wav, mix, SR)
    mix_mp3 = mp3(wav, os.path.join(d, hymn["id"] + "-mix.mp3"), 192, 2)
    a = preview_start(secs, bar_s, mix)
    clip = mix[a:a + PREVIEW_SECONDS * SR].copy()
    fade = int(1.5 * SR)
    if len(clip) > 2 * fade:
        clip[:int(0.05 * SR)] *= np.linspace(0, 1, int(0.05 * SR))[:, None]
        clip[-fade:] *= np.linspace(1, 0, fade)[:, None]
    M.write_wav(wav, clip, SR)
    prev_mp3 = mp3(wav, os.path.join(d, hymn["id"] + "-preview.mp3"), 160, 2)
    os.remove(wav)
    song = song_file(hymn, secs, duration, list(STEM_ORDER))
    song_path = os.path.join(d, "song.json")
    with open(song_path, "w") as f:
        json.dump(song, f, indent=1, ensure_ascii=False)
    return {"files": files, "song": song_path, "mix": mix_mp3, "preview": prev_mp3, "duration": duration}


def release_name(hid, name):
    return "%s--%s" % (hid, re.sub(r"[^A-Za-z0-9.-]+", "-", name))


def index_entry(hymn, base, built=None):
    secs = layout(hymn)
    nbars = sum(len(s["bars"]) for s in secs)
    dur = round((nbars + 2) * 60.0 / hymn["bpm"] * hymn["meter"] + 3, 1)
    names = [("%s.mp3" % s, ROLES[s]) for s in STEM_ORDER]

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
        "stems": [entry(n, r, paths.get(n), n in ("Click.mp3", "Guide.mp3")) for n, r in names], "style": hymn.get("style"),
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
        if a in ("--sounds", "--orchestra", "--samples", "--out", "--only", "--base-url", "--seconds", "--gm", "--write-builtin"):
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
    if not opt.get("out"):
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
    with open(os.path.join(rel, "CREDITS.txt"), "w") as f:   # (the Salamander piano is CC-BY: it must be credited where the tracks are)
        f.write("Central Tracks hymns - arranged and recorded by Motion Audio. The words and tunes are in the public domain.\n\nInstruments:\n")
        for credit, lic in WB.SM.credits(["piano", "drums", "bass", "gretsch", "violins"]):
            f.write("  - %s [%s]\n" % (credit, lic))
        f.write("  - Synth pads: Motion Audio (tools/pad_voices.py)\n  - Guide voice: Piper LJSpeech voice (MIT), trained on LJ Speech (public domain)\n")
    with open(os.path.join(rel, "SHA256SUMS"), "w") as f:
        for fn in sorted(os.listdir(rel)):
            if fn != "SHA256SUMS":
                f.write("%s  %s\n" % (sha256(os.path.join(rel, fn)), fn))
    total = sum(os.path.getsize(os.path.join(rel, fn)) for fn in os.listdir(rel))
    say("Done: %d hymns, %.0f MB in %s" % (len(index), total / 1e6, rel))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
