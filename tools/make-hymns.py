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

DATA = os.path.join(ROOT, "hymns", "hymns.json")
CUES = os.path.join(ROOT, "cues")
DEFAULT_BASE = "https://github.com/MotionAudio/central-apps/releases/download/central-tracks"
SR = 44100
ARTIST = "Motion Audio"
NOTES = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11}
QUALITIES = {"": (0, 4, 7), "m": (0, 3, 7), "7": (0, 4, 7, 10), "maj7": (0, 4, 7, 11), "m7": (0, 3, 7, 10), "sus4": (0, 5, 7), "sus": (0, 5, 7),
             "sus2": (0, 2, 7), "2": (0, 2, 4, 7), "add9": (0, 4, 7, 14), "6": (0, 4, 7, 9), "m6": (0, 3, 7, 9), "dim": (0, 3, 6), "aug": (0, 4, 8)}
CHORD_RE = re.compile(r"^([A-G][#b]?)([^/]*)(?:/([A-G][#b]?))?$")

STEM_ORDER = ("Drums", "Bass", "Keys", "Pad", "Electric", "Strings")   # (each hymn's band, feel and mix: tools/hymn_arranger.py)
ROLES = {"Drums": "drums", "Bass": "bass", "Keys": "keys", "Pad": "keys", "Electric": "guitar", "Strings": "music", "Click": "click", "Guide": "guide"}
# the click and guide's loudness (RMS dBFS where they sound); the band's levels, pans and rooms are the style's
LEVELS = {"Click": -22.0, "Guide": -18.0}
CUE_WORDS = {"intro": "intro", "interlude": "interlude", "instrumental": "instrumental", "tag": "tag", "outro": "outro", "ending": "ending",
             "chorus": "chorus", "refrain": "refrain", "bridge": "bridge", "turnaround": "turnaround"}


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
        "credits": {"words": hymn["words"], "music": hymn["music"], "arrangement": "Arranged and recorded by Motion Audio. The words and tune are in the public domain; this arrangement and recording are Motion Audio's.",
                    "style": HA.style_of(hymn)["about"]},
    }


# ---------------------------------------------------------------- click and guide
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


def master(mix):
    """The mix bus: a little glue (the loud parts eased down), loudness to about -16 dBFS, a soft ceiling under -1 dBFS."""
    mono = mix.mean(axis=1)
    glued = HA.compress(mono, 1.6)
    g = np.divide(glued, mono, out=np.ones_like(mono), where=np.abs(mono) > 1e-6)
    g = np.clip(g, 0.5, 1.0)
    mix = mix * g[:, None]
    r = active_rms(mix.mean(axis=1))
    if r > 0:
        mix = mix * (10 ** (-16 / 20.0) / r)
    knee = 0.7
    over = np.abs(mix) > knee
    mix[over] = np.sign(mix[over]) * (knee + (0.89 - knee) * np.tanh((np.abs(mix[over]) - knee) / (0.89 - knee)))
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


def render_hymn(hymn, opt, out_dir, srcs):
    secs = layout(hymn)
    nbars = sum(len(s["bars"]) for s in secs)
    bar_s = 60.0 / hymn["bpm"] * hymn["meter"]
    length = int((nbars + 2) * bar_s * SR + 3 * SR)
    if opt.get("seconds"):
        length = min(length, int(float(opt["seconds"]) * SR))
    duration = length / SR
    seed = int(hashlib.sha1(hymn["id"].encode()).hexdigest()[:8], 16)
    d = os.path.join(out_dir, hymn["id"])
    os.makedirs(d, exist_ok=True)
    style = HA.style_of(hymn)
    room = style.get("room", "hall")
    ir_l, ir_r = HA.reverb_ir(room, 0), HA.reverb_ir(room, 1)
    parts = HA.arrangement(hymn, secs, seed, srcs)
    stems, dry, sends = {}, {}, {}
    for stem in STEM_ORDER:
        x = np.zeros(length, np.float32)
        for k, (sound, mid, sf2, db) in enumerate(parts.get(stem, [])):
            mp = os.path.join(d, "%s-%d.mid" % (stem, k))
            mid.save(mp)
            y = M.render(sf2, mp, sr=SR, gain=0.45).mean(axis=1)
            r = active_rms(y)                      # (each layer at the same loudness, then its place in the stem)
            if r > 0:
                y = y * (10 ** ((-20 + db) / 20.0) / r)
            x[:min(length, len(y))] += y[:length]
        y, send = HA.mix_stem(stem, x, style, hymn["bpm"])
        target = HA.level_db(style, stem)
        y = level(y, target)
        dry[stem], sends[stem] = y, send
        stems[stem] = level(y + send * convolve(y, ir_l), target)      # (the stem the apps play: its share of the room in it)
        say("    %-8s %d layer(s), peak %.2f" % (stem, len(parts.get(stem, [])), float(np.max(np.abs(stems[stem])))))
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
    bus = np.zeros(length, np.float32)
    for stem, x in dry.items():   # (the mix: the dry stems panned, one stereo room for all of them)
        p = HA.pan(style, stem)
        mix[:, 0] += x * math.cos((p + 1) * math.pi / 4)
        mix[:, 1] += x * math.sin((p + 1) * math.pi / 4)
        bus += sends[stem] * x
    back = HA.room_return(room)
    wet_l, wet_r = convolve(bus, ir_l, ir_r)
    mix[:, 0] += back * wet_l
    mix[:, 1] += back * wet_r
    mix = master(mix)
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
