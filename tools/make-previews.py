#!/usr/bin/env python3
"""Central Pedal - 30-second previews of what's in the sound libraries, so people can hear a pad, a loop or an
instrument before they download or buy it (10.2). tools/build-libraries.py calls this for every library it packs; the
previews are made from the sounds that build just made, so a new or redesigned sound gets a new preview by itself.

  a pad style            its loops in a short progression through two keys (D: D A B G, then C G), crossfaded
  a set of loops         each loop of the set in turn, back to back; and each groove / style alone (its tempos or keys)
  an instrument preset   a phrase written for its kind - chords and arpeggios across its range for keys, held chords for
                         pads, strings and organs, a line for basses, a melody for leads and winds, a groove for kits,
                         the hits themselves for the transitions - played through the SoundFont with FluidSynth
  a keys preset          its sound's phrase with the preset's reverb or delay (roughly - the app plays the real pedals)
  an impulse response    a guitar (or bass, or acoustic) played through it
Pedal boards aren't previewed: what they do depends on the player's own guitar.

Every preview is an MP3 (128 kb/s, 44.1 kHz, stereo), 30 seconds, faded in and out, at the same loudness.

    python3 tools/make-previews.py --sounds DIR --out DIR [--pads DIR] [--loops DIR] [--irs DIR] [--only LIBRARY]
      (the same folders as build-libraries.py; normally build-libraries.py runs this itself)
Needs python3-numpy, fluidsynth (the instruments) and ffmpeg (the MP3s)."""
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import midi_render as M  # noqa: E402

SECONDS = 30
SR = 44100
KBPS = 128
PAD_KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
PAD_PROGRESSION = ["D", "A", "B", "G", "C", "G"]   # (I V vi IV in D, then a lift to C and home to G)
GAP = 34.0   # seconds between two presets' phrases in one FluidSynth run (30 s, then air for the last notes to ring out)


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", str(s).lower()).strip("-") or "item"


def preview_name(lib_id, kind, name, preset=None):
    """The preview's file name (flat: it's a release asset next to the zips): the library, the kind, the name - and for
    an instrument its SoundFont (without the library's own words) and the preset."""
    short = re.sub(r"-library$", "", lib_id)
    if preset is None:
        return "preview--%s--%s--%s.mp3" % (short, kind, slug(name))
    bank = slug(name)
    if bank.startswith(short + "-"):
        bank = bank[len(short) + 1:]
    return "preview--%s--%s--%s--%s.mp3" % (short, kind, bank, slug(str(preset)[:19]))   # (a SoundFont keeps 19-20 characters of a preset name)


def unique_name(lib_id, kind, name, preset, used):
    """preview_name, made unique in its library (two presets can share their first 19 characters): -2, -3..."""
    fn, n = preview_name(lib_id, kind, name, preset), 2
    base = fn[:-4]
    while fn in used:
        fn, n = "%s-%d.mp3" % (base, n), n + 1
    used.add(fn)
    return fn


# ---------------------------------------------------------------------------------------------------- audio helpers
def read_wav(path):
    with wave.open(path) as w:
        ch, sw, sr, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        raw = w.readframes(n)
    if sw == 2:
        x = np.frombuffer(raw, "<i2").astype(np.float32) / 32768.0
    elif sw == 3:
        b = np.frombuffer(raw, np.uint8).reshape(-1, 3)
        x = ((b[:, 0].astype(np.int32) | (b[:, 1].astype(np.int32) << 8) | (b[:, 2].astype(np.int32) << 16)) << 8 >> 8).astype(np.float32) / 8388608.0
    elif sw == 4:
        x = np.frombuffer(raw, "<i4").astype(np.float32) / 2147483648.0
    else:
        raise ValueError("%s: unsupported WAV" % path)
    x = x.reshape(-1, ch)
    if ch == 1:
        x = np.repeat(x, 2, axis=1)
    elif ch > 2:
        x = x[:, :2]
    return resample(x, sr)


def resample(x, sr):
    if sr == SR or len(x) < 2:
        return x.astype(np.float32)
    n = int(round(len(x) * SR / sr))
    t = np.linspace(0, len(x) - 1, n)
    return np.stack([np.interp(t, np.arange(len(x)), x[:, c]) for c in range(x.shape[1])], axis=1).astype(np.float32)


def tile(x, n):
    """x repeated (it's a seamless loop) to n frames."""
    if len(x) == 0:
        return np.zeros((n, 2), np.float32)
    reps = int(math.ceil(n / len(x)))
    return np.concatenate([x] * reps)[:n]


def crossfade_join(parts, xf):
    """The parts one after another, each crossfading into the next over xf frames."""
    out = parts[0].copy()
    for p in parts[1:]:
        f = min(xf, len(out), len(p))
        if f > 0:
            ramp = np.linspace(0, 1, f, dtype=np.float32)[:, None]
            # (equal power: the level holds through the change)
            out[-f:] = out[-f:] * np.cos(ramp * math.pi / 2) + p[:f] * np.sin(ramp * math.pi / 2)
        out = np.concatenate([out, p[f:]])
    return out


def room_ir(seconds=2.2, seed=3):
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = rng.normal(0, 1, (n, 2)).astype(np.float32) * np.exp(-6.9 * t / seconds)[:, None]
    ir[:int(0.012 * SR)] = 0   # (a little pre-delay)
    k = np.ones(8) / 8   # (soften the top)
    ir = np.stack([np.convolve(ir[:, c], k, "same") for c in range(2)], axis=1)
    return ir / np.sqrt(np.sum(ir ** 2) / 2)


def convolve(x, ir):
    n = len(x) + len(ir) - 1
    size = 1 << (n - 1).bit_length()
    out = np.zeros((n, 2), np.float32)
    for c in range(2):
        out[:, c] = np.fft.irfft(np.fft.rfft(x[:, c], size) * np.fft.rfft(ir[:, c % ir.shape[1]], size), size)[:n]
    return out


def reverb(x, wet=0.2, seconds=2.2):
    if wet <= 0:
        return x
    y = convolve(x, room_ir(seconds))[:len(x)] * 0.12
    return x + wet * y


def finish(x, target_db=-16.0):
    """30 seconds exactly, faded in and out, at one loudness (RMS, with the peak held under -1 dBFS)."""
    n = SECONDS * SR
    x = np.asarray(x, np.float32)
    if x.ndim == 1:
        x = np.stack([x, x], axis=1)
    x = np.pad(x, ((0, max(0, n - len(x))), (0, 0)))[:n].copy()
    fi, fo = int(0.03 * SR), int(2.5 * SR)
    x[:fi] *= np.linspace(0, 1, fi)[:, None]
    x[-fo:] *= np.linspace(1, 0, fo)[:, None] ** 1.5
    loud = x[np.abs(x).max(axis=1) > 1e-4]
    rms = float(np.sqrt(np.mean(loud ** 2))) if len(loud) else 0.0
    if rms > 1e-6:
        x *= 10 ** (target_db / 20) / rms
    # the peaks (a snare, a pluck) held under -1 dBFS by a soft knee rather than by turning the whole preview down
    peak = float(np.max(np.abs(x))) or 1.0
    if peak > 1.78:
        x *= 1.78 / peak
    knee, ceil = 0.6, 0.89
    a = np.abs(x)
    over = a > knee
    x[over] = np.sign(x[over]) * (knee + (ceil - knee) * np.tanh((a[over] - knee) / (ceil - knee)))
    return x


def silent(x):
    return float(np.max(np.abs(x))) < 1e-3 if len(x) else True


def write_mp3(x, path):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, "p.wav")
        pcm = np.clip(np.round(x * 32767), -32768, 32767).astype("<i2")
        with wave.open(wav, "wb") as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(pcm.tobytes())
        r = subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", wav, "-codec:a", "libmp3lame", "-b:a", "%dk" % KBPS, "-ar", str(SR),
                            "-metadata", "comment=Motion Audio preview", path + ".part.mp3"], capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError("ffmpeg: " + r.stderr[-300:])
    os.replace(path + ".part.mp3", path)
    return path


# ---------------------------------------------------------------------------------------------------- pads and loops
def pad_audio(pads_dir, style, file_of):
    """A pad style: its loop in each key of the progression, crossfaded."""
    xf = int(1.5 * SR)
    seg = int((SECONDS + (len(PAD_PROGRESSION) - 1) * 1.5) / len(PAD_PROGRESSION) * SR)
    parts = []
    for key in PAD_PROGRESSION:
        src = os.path.join(pads_dir, file_of(style, key))
        if not os.path.isfile(src):
            src = next((os.path.join(pads_dir, file_of(style, k)) for k in PAD_KEYS if os.path.isfile(os.path.join(pads_dir, file_of(style, k)))), None)
            if not src:
                return None
        parts.append(tile(read_wav(src), seg))
    return reverb(crossfade_join(parts, xf), 0.1)


def loops_audio(loops):
    """Loops back to back, each for its share of the 30 seconds: [(path, bars or None)]. A groove plays whole bars (a long
    one is cut at a bar line, a short one repeats); a loop without bars (an ambient bed) is cut and crossfaded."""
    loops = [(f, b) for f, b in loops if os.path.isfile(f)]
    if not loops:
        return None
    share = SECONDS * SR / len(loops)
    parts, xf = [], int(0.02 * SR)
    for f, bars in loops:
        x = read_wav(f)
        if len(x) == 0:
            continue
        if bars:
            bar = len(x) / bars
            n = max(1, int(round(share / bar)))
            x = tile(x, int(round(n * bar)))
        elif len(x) > share:
            x = x[:int(share)]
            xf = int(1.0 * SR)
        parts.append(x)
    if not parts:
        return None
    out = crossfade_join(parts, xf)
    while len(out) < SECONDS * SR:   # (a short set goes round again)
        out = crossfade_join([out] + parts, xf)
    return out


# ---------------------------------------------------------------------------------------------------- instrument phrases
CHORDS = [(2, [2, 6, 9]), (9, [9, 1, 4]), (11, [11, 2, 6]), (7, [7, 11, 2])]   # (D, A, Bm, G: root and pitch classes)


def voicing(pcs, center, count=4):
    """Notes of the chord around center (the lowest pitch class at the bottom), count of them."""
    out, k = [], center - 7
    while len(out) < count and k < 128:
        if k % 12 in pcs and k >= center - 7:
            out.append(k)
        k += 1
    return out


def kind_of(name):
    n = name.lower()
    if re.search(r"transition|riser|swell.*cymbal", n):
        return "hits"
    if re.search(r"\bkit\b|drum", n):
        return "kit"
    if re.search(r"percussion", n):
        return "perc"
    if re.search(r"bass(?!oon)", n) and not re.search(r"bass.?drum", n):
        return "bass"
    if re.search(r"pad|choir|string|swell|drone|organ|tremolo|bowed|brass|machine|hum|consort|section", n):
        return "sustain"
    if re.search(r"lead|sax|recorder|ocarina|harmonica|flute|whistle|saxello|clarinet|oboe|trumpet|violin|cello", n):
        return "melody"
    if re.search(r"glock|xylo|chime|bell|celesta|music box", n):
        return "high"
    return "keys"


def register(name, kind):
    n = name.lower()
    if kind == "bass":
        return 40
    if re.search(r"baritone|bari|upright bass|tuba|cello|sub", n):
        return 48
    if re.search(r"tenor", n):
        return 55
    if kind == "high" or re.search(r"glock|xylo|ocarina|alto recorder|piccolo|kalimba|mbira", n):
        return 72
    return 60


def phrase(name, kind):
    """[(start s, length s, key, velocity)] for 30 seconds of this kind of instrument (in D)."""
    c = register(name, kind)
    out = []
    if kind == "kit":
        bpm = 92
        b = 60.0 / bpm
        bars = int(SECONDS / (4 * b)) + 1
        for bar in range(bars):
            t0 = bar * 4 * b
            fill = bar % 4 == 3
            for i in range(8):
                if not (fill and i >= 4):
                    out.append((t0 + i * b / 2, 0.1, 42 if bar < 8 else 51, 78 if i % 2 == 0 else 54))
            for s, v in ((0, 104), (1.5, 82), (2, 96)):
                out.append((t0 + s * b, 0.1, 36, v))
            out.append((t0 + b, 0.1, 38, 100))
            if fill:
                for i, tom in enumerate((50, 50, 47, 47, 43, 43, 41, 38)):
                    out.append((t0 + 2 * b + i * b / 4, 0.1, tom, 84 + i * 3))
            else:
                out.append((t0 + 3 * b, 0.1, 38, 104))
            if bar % 4 == 0:
                out.append((t0, 0.1, 49, 100 if bar else 90))
        return out
    if kind == "perc":
        b = 60.0 / 100
        notes = list(range(36, 84, 3))
        for i in range(int(SECONDS / (b / 2))):
            k = notes[(i * 5 + (i // 8)) % len(notes)]
            out.append((i * b / 2, 0.15, k, 96 if i % 4 == 0 else 70 if i % 2 == 0 else 52))
        return out
    if kind == "hits":
        try:
            import importlib.util
            spec = importlib.util.spec_from_file_location("make_pads", os.path.join(HERE, "make-pads.py"))
            mp = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mp)
            keys = [k for k, _ in mp.TRANSITION_KEYS]
        except Exception:
            keys = [48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67]
        # (a riser into an impact, a reverse cymbal into a shimmer hit, a swell into a sub drop, a downlifter, wind)
        plan = [(0, 0, 4.0), (4.0, 7, 4.5), (9.0, 3, 3.0), (12.0, 11, 4.0), (16.5, 5, 4.5), (21.0, 8, 3.0), (24.0, 2, 3.0), (27.0, 10, 3.0)]
        return [(t, ln, keys[i % len(keys)], 110) for t, i, ln in plan]
    if kind == "sustain":
        bar = 60.0 / 72 * 4
        for i in range(int(SECONDS / bar) + 1):
            root, pcs = CHORDS[(i // 2) % 4] if i < 8 else CHORDS[i % 4]
            t = i * bar
            v = voicing(pcs, c + (5 if i >= 4 else 0), 4)
            for k in v:
                out.append((t, bar * 0.98, k, 70 + (i % 4) * 6))
            if i % 2 == 1:   # (a melody note on top every other bar)
                out.append((t + bar / 2, bar / 2, v[-1] + 2 if (v[-1] + 2) % 12 in (pcs + [4, 7]) else v[-1], 82))
        return out
    if kind == "bass":
        b = 60.0 / 88
        line = [0, 0, 7, 5]
        for bar in range(int(SECONDS / (4 * b)) + 1):
            root, _ = CHORDS[bar % 4]
            r = (c - 12) + ((root - (c - 12)) % 12)
            t0 = bar * 4 * b
            steps = [(0, 1.4, r, 100), (1.5, 0.45, r, 76), (2, 1.0, r + 7 if bar % 2 else r + 12, 92), (3, 0.9, r + line[bar % 4] if bar % 2 else r + 5, 84)]
            if bar >= 8:   # (up the neck for the last bars - its range)
                steps = [(s, ln, k + 12, v) for s, ln, k, v in steps]
            out += [(t0 + s * b, ln * b, k, v) for s, ln, k, v in steps]
        return out
    scale = [2, 4, 6, 7, 9, 11, 13, 14, 16, 18, 19, 21, 23, 25, 26]   # (D major, two octaves from D)
    base = c - 12 + ((2 - (c - 12)) % 12)
    if kind == "melody":
        b = 60.0 / 80
        tune = [0, 2, 4, 4, 5, 4, 2, 1, 2, 4, 7, 7, 8, 7, 4, 2, 4, 7, 9, 11, 9, 7, 8, 9, 11, 12, 11, 9, 7, 4, 2, 0, 1, 2, 4, 2, 0]
        lens = [1, 1, 1.5, 0.5, 1, 1, 1, 1, 2] * 5
        t = 0.0
        for i, d in enumerate(tune):
            ln = lens[i % len(lens)] * b
            if t + ln > SECONDS - 1.5:
                break
            out.append((t, ln * 0.95, base + scale[d % len(scale)] - 12 * (d >= len(scale)), 76 + (d % 5) * 6))
            t += ln
        out.append((t, SECONDS - t, base + scale[0], 70))
        return out
    # keys, plucked and mallets: arpeggios up through the range, then the chords with a melody on top
    b = 60.0 / 84
    t = 0.0
    for bar in range(4):
        root, pcs = CHORDS[bar % 4]
        arp = voicing(pcs, c - 12 + bar * 3, 8)
        for i, k in enumerate(arp):
            out.append((t + i * b / 2, b * (4 - i / 2), k, 64 + i * 4))
        t += 4 * b
    tune = [4, 2, 1, 2, 7, 4, 4, 2, 1, 0, 1, 2]
    for bar in range(int((SECONDS - t) / (4 * b)) + 1):
        root, pcs = CHORDS[bar % 4]
        lh = voicing(pcs, c - 10, 3)
        for k in lh:
            out.append((t, 4 * b * 0.95, k, 66))
        for j in range(3):
            d = tune[(bar * 3 + j) % len(tune)]
            out.append((t + j * b * 1.33, b * 1.3, base + 12 + scale[d], 84))
        t += 4 * b
    if kind == "high":
        out = [(s, min(ln, 1.6), k, v) for s, ln, k, v in out]
    return out


def instrument_audio(sf2, presets):
    """[audio or None, one per preset] - every preset of one SoundFont in a single FluidSynth run (a big piano bank loads once)."""
    presets = list(presets)
    if not presets:
        return []
    mid = M.Midi(bpm=60)   # (a beat is a second)
    for n, (bank, prog, name) in enumerate(presets):
        t0 = n * GAP
        drums = bank == 128
        ch = 9 if drums else 0
        mid.program(ch, prog, bank, beat=t0)
        mid.cc(t0, 7, 110, ch)
        mid.cc(t0, 91, 0, ch)
        kind = kind_of(name)
        for s, ln, k, v in phrase(name, kind if not drums else "kit"):
            if s < SECONDS:
                mid.note(t0 + s, min(ln, SECONDS - s), k, v, ch)
        mid.cc(t0 + SECONDS + 1, 123, 0, ch)   # (all notes off before the next one)
    with tempfile.TemporaryDirectory() as tmp:
        mp = os.path.join(tmp, "previews.mid")
        mid.save(mp)
        audio = M.render(sf2, mp, sr=SR, gain=0.5)
    out = []
    for n, (bank, prog, name) in enumerate(presets):
        a = int(n * GAP * SR)
        x = audio[a:a + SECONDS * SR]
        kind = "kit" if bank == 128 else kind_of(name)
        wet = {"kit": 0.12, "perc": 0.15, "hits": 0.1, "sustain": 0.25, "bass": 0.04, "melody": 0.22, "high": 0.25, "keys": 0.22}[kind]
        out.append(None if silent(x) else reverb(x, wet))
    return out


def preset_effects(x, chain):
    """A keys preset: its sound with the preset's reverb or delay, roughly (the app plays the real pedals)."""
    ids = " ".join(str(it[0]).lower() for it in chain or [] if isinstance(it, list) and it)
    knobs = {}
    for it in chain or []:
        if isinstance(it, list) and len(it) > 1 and isinstance(it[1], dict):
            knobs.update({k.lower(): v for k, v in it[1].items()})
    if re.search(r"delay|echo", ids):
        d = int(SR * 60 / 84 * 0.75)
        fb = 0.35
        y = x.copy()
        for k in range(1, 5):
            y[d * k:] += x[:len(x) - d * k] * (fb ** k) * (0.6 if k % 2 else 0.5)
        x = y
    if re.search(r"hall|rev|plate|room|shimmer|cloud|space", ids):
        decay = float(knobs.get("decay", 3.0) or 3.0)
        x = reverb(x, 0.35 if "shimmer" in ids else 0.28, max(1.2, min(6.0, decay)))
    return x


# ---------------------------------------------------------------------------------------------------- impulse responses
def ks_note(f, seconds, bright=0.5, seed=0):
    """A plucked string (Karplus-Strong, a period at a time)."""
    rng = np.random.default_rng(seed)
    n, p = int(seconds * SR), max(2, int(SR / f))
    buf = rng.uniform(-1, 1, p).astype(np.float32)
    damp = 0.996 - (1 - bright) * 0.004
    parts = []
    for _ in range(n // p + 1):
        parts.append(buf)
        buf = damp * 0.5 * (buf + np.roll(buf, -1))
    return np.concatenate(parts)[:n]


_SOURCES = {}


def mix_in(out, s, x):
    """x added into out from frame s (whatever of it fits)."""
    if s >= len(out):
        return
    k = min(len(x), len(out) - s)
    out[s:s + k] += x[:k]


def ir_source(name):
    n = name.lower()
    kind = "acoustic" if ("acoustic" in n or "body" in n) and "nylon" not in n else "nylon" if "nylon" in n else "bass" if "bass" in n else "electric"
    if kind not in _SOURCES:
        _SOURCES[kind] = _ir_source(kind)
    return _SOURCES[kind]


def _ir_source(n):
    """What to play through an IR: a crunchy guitar riff for a guitar cabinet, a bass line for a bass cabinet, strummed
    chords for an acoustic body. Dry and mono (frames,). n: acoustic, nylon, bass or electric."""
    out = np.zeros(SECONDS * SR, np.float32)
    if "acoustic" in n or "body" in n or "nylon" in n:
        shapes = [[50, 57, 62, 66], [45, 52, 57, 61, 64], [47, 54, 59, 62], [43, 50, 55, 59, 62]]
        b = 60.0 / 84
        t, i = 0.0, 0
        while t < SECONDS - 1:
            sh = shapes[(i // 4) % 4]
            down = i % 2 == 0
            for j, k in enumerate(sh if down else sh[::-1]):
                s = int((t + j * 0.012) * SR)
                x = ks_note(440 * 2 ** ((k - 69) / 12), 1.6, 0.75 if "nylon" not in n else 0.45, i * 7 + j) * (0.5 if down else 0.32)
                mix_in(out, s, x)
            t += b
            i += 1
        return out * 0.6
    if "bass" in n:
        b = 60.0 / 88
        roots = [38, 33, 35, 31]
        t, i = 0.0, 0
        while t < SECONDS - 1:
            k = roots[(i // 4) % 4] + (12 if i % 4 == 2 else 0)
            s = int(t * SR)
            x = ks_note(440 * 2 ** ((k - 69) / 12), b * 1.2, 0.35, i)
            mix_in(out, s, x)
            t += b
            i += 1
        return np.tanh(out * 1.5) * 0.7
    # an electric guitar riff (power chords and single notes), driven into the cabinet like an amp would
    b = 60.0 / 100
    riff = [(0, [50, 57, 62]), (0.75, [50, 57, 62]), (1.5, [53, 60, 65]), (2.5, [55, 62, 67]), (3.25, [52, 59, 64])]
    t = 0.0
    seed = 0
    while t < SECONDS - 1:
        for s0, ch in riff:
            s = int((t + s0 * b) * SR)
            for k in ch:
                x = ks_note(440 * 2 ** ((k - 69) / 12), b * 0.9, 0.8, seed)
                mix_in(out, s, x * 0.4)
                seed += 1
        t += 4 * b
    return np.tanh(out * 6.0) * 0.6


def ir_audio(irs_dir, name):
    path = os.path.join(irs_dir or "", name + ".wav")
    if not os.path.isfile(path):
        return None
    ir = read_wav(path)
    dry = ir_source(name)
    x = convolve(np.stack([dry, dry], axis=1), ir)[:SECONDS * SR]
    return reverb(x, 0.06)


# ---------------------------------------------------------------------------------------------------- one library
def sound_file(name):
    return "%s - %s.sf2" % (name, name.lower().replace(" ", "-"))


def make_library_previews(lib, items, out_dir, sounds_dir=None, pads_dir=None, loops_dir=None, irs_dir=None, file_of=None, log=print):
    """Makes the previews for a library and returns them: [{kind, name, preset?, file, size, sha256, seconds}].
    Also puts "preview": <file> on each item of the manifest it belongs to (items is the manifest's item list), and on a
    SoundFont "previews": [[preset, file], ...]."""
    lib_id = lib["id"]
    made, used = [], set()

    def add(kind, name, audio, preset=None, extra=None):
        fn = unique_name(lib_id, kind, name, preset, used)   # (taken even when there's nothing to hear: the names stay the ones the built-in list expects)
        if audio is None or silent(audio):
            log("      (no preview: %s %s%s - it came out silent or wasn't built)" % (kind, name, " / " + preset if preset else ""))
            return None
        path = os.path.join(out_dir, fn)
        write_mp3(finish(audio), path)
        e = {"kind": kind, "name": name, "file": fn, "size": os.path.getsize(path), "sha256": sha256_file(path), "seconds": SECONDS}
        if preset is not None:
            e["preset"] = preset
        if extra:
            e.update(extra)
        made.append(e)
        return fn

    # pads: one preview per style
    if file_of and pads_dir:
        for pad in lib.get("pads") or []:
            fn = add("pad", pad["name"], pad_audio(pads_dir, pad["name"], file_of))
            for it in items:
                if fn and it["kind"] == "pad" and it["name"] == pad["name"]:
                    it["preview"] = fn
    # loops: each set back to back, and each groove / style with its tempos or keys
    for ls in lib.get("loops") or []:
        listing = os.path.join(loops_dir or "", ls["set"], "index.json")
        if not os.path.isfile(listing):
            continue
        with open(listing, encoding="utf-8") as f:
            entries = json.load(f)
        only, skip = ls.get("only"), ls.get("except") or []   # (10.5: part of a set - see build-libraries.py loop_wanted)
        names = [n for n in dict.fromkeys(e["name"] for e in entries) if (n in only if only is not None else n not in skip)]
        if not names:
            continue
        at = lambda e: (os.path.join(loops_dir, ls["set"], e["file"]), e.get("bars"))
        add("loops", ls["name"], loops_audio([at(next(e for e in entries if e["name"] == nm)) for nm in names]), extra={"set": ls["set"]})
        for nm in names:
            fn = add("loop", nm, loops_audio([at(e) for e in entries if e["name"] == nm]), extra={"set": ls["set"]})
            for it in items:
                if fn and it["kind"] == "loop" and it.get("set") == ls["set"] and it["name"] == nm:
                    it["preview"] = fn
    # instruments: every preset of every SoundFont
    rendered = {}
    for s in lib.get("sounds") or []:
        sf2 = os.path.join(sounds_dir or "", sound_file(s["name"]))
        if not os.path.isfile(sf2):
            continue
        presets = [p for p in M.sf2_presets(sf2) if p[2] and p[2] != "EOP"]
        try:
            audio = instrument_audio(sf2, presets)
        except Exception as e:   # (no FluidSynth here: the rest of the previews still get made)
            log("      (no instrument previews for %s: %s)" % (s["name"], e))
            audio = [None] * len(presets)
        files = []
        for (bank, prog, pname), a in zip(presets, audio):
            rendered.setdefault((s["name"].lower(), pname.lower()), a)
            fn = add("sound", s["name"], a, preset=pname)
            if fn:
                files.append([pname, fn])
        for it in items:
            if it["kind"] == "sound" and it["name"] == s["name"] and files:
                it["previews"] = files
    # keys presets: the sound they play, with their reverb or delay
    for b in lib.get("presets") or []:
        if not b.get("sound"):
            continue
        want = [w.strip().lower() for w in str(b["sound"]).split("|")]
        hit = None
        for (bank_name, pname), audio in rendered.items():
            if audio is not None and pname == want[0] and (len(want) < 2 or want[1] == bank_name):
                hit = audio
                break
        if hit is None:
            hit = next((a for (bn, pn), a in rendered.items() if a is not None and want[0] in pn), None)
        fn = add("preset", b["name"], None if hit is None else preset_effects(hit, b.get("chain")))
        for it in items:
            if fn and it["kind"] == "preset" and it["name"] == b["name"]:
                it["preview"] = fn
    # impulse responses
    for ir in lib.get("irs") or []:
        fn = add("ir", ir["name"], ir_audio(irs_dir, ir["name"]))
        for it in items:
            if fn and it["kind"] == "ir" and it["name"] == ir["name"]:
                it["preview"] = fn
    return made


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for blk in iter(lambda: f.read(1 << 20), b""):
            h.update(blk)
    return h.hexdigest()


def main(argv):
    import importlib.util
    spec = importlib.util.spec_from_file_location("build_libraries", os.path.join(HERE, "build-libraries.py"))
    bl = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bl)
    opt, i = {}, 0
    while i < len(argv):
        if argv[i] in ("--sounds", "--out", "--pads", "--loops", "--irs", "--only") and i + 1 < len(argv):
            opt[argv[i][2:]] = argv[i + 1]
            i += 2
        else:
            print(__doc__)
            return 2
    if not opt.get("out"):
        print(__doc__)
        return 2
    for lib in bl.load_definitions():
        if opt.get("only") and lib["id"] != opt["only"]:
            continue
        print(lib["id"])
        made = make_library_previews(lib, [], opt["out"], opt.get("sounds"), opt.get("pads") or os.path.join(opt.get("sounds") or "", "pad-loops"),
                                     opt.get("loops") or os.path.join(opt.get("sounds") or "", "loops"), opt.get("irs"), bl.pad_loop_file)
        for e in made:
            print("    %s" % e["file"])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
