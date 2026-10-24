#!/usr/bin/env python3
"""Central Pedal - builds the orchestra SoundFonts (strings, brass, woodwinds) from VS Chamber Orchestra 2: Community
Edition (Versilian Studios, CC0 1.0 - https://github.com/sgossner/VSCO-2-CE). Run by get-sounds.sh (next to it).

The library comes as SFZ + WAV (stereo, 44.1 kHz, no loops). FluidSynth - the keys engine on the Pi and on computers -
plays SoundFonts, so each instrument becomes SoundFont zones the same way the SFZ maps them (key / velocity ranges,
root key, tune, level), mixed to mono and looped: every sustained note gets a loop found by correlation and smoothed
with a crossfade, so it holds as long as the key is down, and the sample is cut after the loop (small files). Plucked
sounds (pizzicato) keep their natural decay. Then the finished presets are added (Worship Strings, Cello Pad, Brass
Swell, Flute Lead...) as layers of those instruments with their own envelopes.

    python3 sounds-vsco.py <download cache folder> <sounds folder>
Needs python3-numpy and the internet (raw.githubusercontent.com). Writes:
    "VSCO Strings - VSCO-Strings.sf2", "VSCO Brass - VSCO-Brass.sf2", "VSCO Woodwinds - VSCO-Woodwinds.sf2"
The raw WAVs are deleted once their bank is built (the card keeps only the SoundFonts)."""
import math
import os
import re
import struct
import sys
import time
import urllib.parse
import urllib.request
import wave

import numpy as np

COMMIT = "6dd651d55dde97fd4028699be9d4481f26917891"   # VSCO-2-CE, branch SFZ (the SFZ files + the samples)
RAW = "https://raw.githubusercontent.com/sgossner/VSCO-2-CE/" + COMMIT + "/"
PEAK = 0.97       # no note's peak above this (after its SFZ level)
LEVEL_RMS = 0.2   # each instrument's typical held note (so the instruments sit even with each other and with the other banks)
XFADE = 0.25      # seconds of crossfade at a loop's end
MAX_LOOP_END = 3.2  # seconds: where a sustained sample's loop ends at the latest (the rest is never heard)

# instrument id -> (sfz file, kind): "sus" gets a loop, "pluck" keeps its decay
INSTR = {
    "vln": ("ViolinEnsSusVib.sfz", "sus"), "vla": ("ViolaEnsSusVib.sfz", "sus"), "vc": ("CelloEnsSusVib.sfz", "sus"),
    "cb": ("ContrabassSusVB.sfz", "sus"), "svln": ("SViolinVib.sfz", "sus"), "pizz": ("ViolinEnsPizz.sfz", "pluck"),
    "hn": ("FHornSus.sfz", "sus"), "tpt": ("TrumpetSus.sfz", "sus"), "tbn": ("TromboneSus.sfz", "sus"), "tba": ("TubaSus.sfz", "sus"),
    "fl": ("FluteSusVib.sfz", "sus"), "cl": ("ClarinetSus.sfz", "sus"), "ob": ("OboeSusVib.sfz", "sus"), "bsn": ("BassoonSus.sfz", "sus"),
}
# bank -> presets: (name, [(instrument, key lo, key hi, attack s or None, release s or None, level dB)])
BANKS = [
    ("VSCO Strings", "VSCO-Strings", [
        ("Violins", [("vln", 0, 127, None, None, 0)]),
        ("Violas", [("vla", 0, 127, None, None, 0)]),
        ("Cellos", [("vc", 0, 127, None, None, 0)]),
        ("Contrabass", [("cb", 0, 127, None, None, 0)]),
        ("Solo Violin", [("svln", 0, 127, None, None, 0)]),
        ("Violin Pizzicato", [("pizz", 0, 127, None, None, 0)]),
        ("Worship Strings", [("vc", 0, 59, 0.35, 1.6, -2), ("vla", 48, 71, 0.35, 1.6, -3), ("vln", 60, 127, 0.35, 1.6, -2)]),
        ("Cello Pad", [("vc", 0, 127, 0.8, 2.6, 0), ("cb", 0, 52, 0.8, 2.6, -6)]),
        ("String Swell", [("cb", 0, 47, 1.4, 2.2, -4), ("vc", 0, 64, 1.4, 2.2, -2), ("vla", 48, 76, 1.4, 2.2, -3), ("vln", 55, 127, 1.4, 2.2, -2)]),
    ]),
    ("VSCO Brass", "VSCO-Brass", [
        ("French Horn", [("hn", 0, 127, None, None, 0)]),
        ("Trumpet", [("tpt", 0, 127, None, None, 0)]),
        ("Trombone", [("tbn", 0, 127, None, None, 0)]),
        ("Tuba", [("tba", 0, 127, None, None, 0)]),
        ("Brass Swell", [("hn", 0, 127, 0.7, 1.4, -1), ("tbn", 0, 64, 0.7, 1.4, -4)]),
        ("Brass Section", [("tba", 0, 45, None, 0.6, -2), ("tbn", 40, 64, None, 0.6, -2), ("hn", 50, 72, None, 0.6, -2), ("tpt", 60, 127, None, 0.6, -3)]),
    ]),
    ("VSCO Woodwinds", "VSCO-Woodwinds", [
        ("Flute", [("fl", 0, 127, None, None, 0)]),
        ("Clarinet", [("cl", 0, 127, None, None, 0)]),
        ("Oboe", [("ob", 0, 127, None, None, 0)]),
        ("Bassoon", [("bsn", 0, 127, None, None, 0)]),
        ("Flute Lead", [("fl", 0, 127, 0.03, 0.35, 1)]),
        ("Woodwind Choir", [("bsn", 0, 53, 0.25, 1.2, -2), ("cl", 50, 70, 0.25, 1.2, -3), ("ob", 58, 80, 0.25, 1.2, -4), ("fl", 66, 127, 0.25, 1.2, -3)]),
    ]),
]


def say(*a):
    print("   ", *a, flush=True)


def fetch(url, path, tries=3):
    if os.path.isfile(path) and os.path.getsize(path) > 0:
        return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for n in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=60) as r, open(path + ".part", "wb") as out:
                while True:
                    b = r.read(1 << 16)
                    if not b:
                        break
                    out.write(b)
            os.replace(path + ".part", path)
            return path
        except Exception as error:  # noqa: BLE001
            if n == tries - 1:
                raise RuntimeError("download failed: %s (%s)" % (url, error))
            time.sleep(2 + 3 * n)


# ---------------------------------------------------------------- SFZ
def parse_sfz(text):
    """[{opcode: value}] per region, with <global> / <group> / <control> values inherited."""
    text = re.sub(r"//[^\n]*", "", text)
    regions, scopes, cur, section = [], {"control": {}, "global": {}, "group": {}}, None, None
    for tok in re.split(r"(<\w+>)", text):
        m = re.match(r"<(\w+)>", tok)
        if m:
            section = m.group(1)
            if section == "group":
                scopes["group"] = {}
            if section == "region":
                cur = {}
                regions.append((dict(scopes["global"], **scopes["group"]), cur))
            continue
        # opcode=value pairs; sample= may hold spaces up to the line's end
        for line in tok.splitlines():
            for key, val in re.findall(r"(\w+)=(.*?)(?=\s+\w+=|$)", line.strip()):
                target = cur if section == "region" else scopes.get(section)
                if target is not None:
                    target[key] = val.strip()
    out = []
    for inherited, own in regions:
        r = dict(inherited)
        r.update(own)
        out.append(r)
    return out, scopes["control"].get("default_path", "").replace("\\", "/")


# ---------------------------------------------------------------- audio
def read_wav(path):
    with wave.open(path, "rb") as w:
        ch, sw, sr, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        raw = w.readframes(n)
    if sw == 2:
        x = np.frombuffer(raw, "<i2").astype(np.float32) / 32768.0
    elif sw == 3:
        b = np.frombuffer(raw, np.uint8).reshape(-1, 3)
        v = (b[:, 0].astype(np.int32) | (b[:, 1].astype(np.int32) << 8) | (b[:, 2].astype(np.int32) << 16))
        v = np.where(v & 0x800000, v - 0x1000000, v)
        x = v.astype(np.float32) / 8388608.0
    elif sw == 4:
        x = np.frombuffer(raw, "<i4").astype(np.float32) / 2147483648.0
    else:
        raise ValueError("unsupported WAV")
    return x.reshape(-1, ch).mean(axis=1), sr


def find_loop(x, sr):
    """(start, end) of a loop in the sustained part, or None for a sample too short to loop."""
    n = len(x)
    if n < int(1.3 * sr):
        return None
    attack = min(int(0.45 * sr), n // 5)
    end = min(int(MAX_LOOP_END * sr), n - int(0.12 * sr))
    # a note that fades early (the player let go): the loop ends while it still sounds full
    hop = int(0.05 * sr)
    env = np.sqrt(np.convolve(x * x, np.ones(hop) / hop, mode="valid"))[::hop]
    a_i, e_i = attack // hop, min(len(env), end // hop)
    if e_i > a_i + 4:
        full = float(np.max(env[a_i:e_i]))
        good = np.nonzero(env[a_i:e_i] >= 0.6 * full)[0]
        if len(good):
            end = min(end, (a_i + int(good[-1]) + 1) * hop)
    if end - attack < int(0.8 * sr):
        end = n - int(0.05 * sr)
    w = int(0.04 * sr)
    lo, hi = max(attack + w, end - int(1.8 * sr)), end - int(0.6 * sr)
    if hi <= lo:
        lo, hi = attack + w, end - int(0.3 * sr)
        if hi <= lo:
            return None
    ref = x[end - w:end]
    seg = x[lo - w:hi]
    # normalised correlation of the window before the end with every window before a candidate start
    num = np.correlate(seg, ref, mode="valid")
    energy = np.sqrt(np.convolve(seg * seg, np.ones(w), mode="valid")) * (np.sqrt(np.sum(ref * ref)) + 1e-12)
    score = num / (energy + 1e-12)
    # longer loops hold a vibrato better: a small bonus for length
    starts = np.arange(len(score)) + lo
    score = score + 0.03 * (end - starts) / sr
    best = int(starts[int(np.argmax(score))])
    return best, end


def render_sample(x, sr, kind, gain):
    """int16 data, loop start / end (sample offsets in the data) or None."""
    x = x * gain
    if float(np.max(np.abs(x))) > 0.8 * PEAK:   # a click or a loud bite: rounded off under PEAK instead of clipping
        x = (np.tanh(x / PEAK) * PEAK).astype(np.float32)
    loop = find_loop(x, sr) if kind == "sus" else None
    if loop:
        s, e = loop
        c = min(int(XFADE * sr), (e - s) // 2, s)
        y = x[:e + 32].copy()
        k = np.arange(c, dtype=np.float32) / c
        y[e - c:e] = x[e - c:e] * (1 - k) + x[s - c:s] * k       # the loop's end flows into its start
        y[e:e + 32] = x[s:s + 32]                                 # (what follows the end: the start again, for interpolation)
        data = y
    else:
        cut = min(len(x), int(3.5 * sr))
        data = x[:cut].copy()
        f = min(int(0.08 * sr), cut)
        data[cut - f:] *= np.linspace(1, 0, f, dtype=np.float32)
        s = e = None
    pcm = np.clip(np.round(data * 32767), -32768, 32767).astype("<i2")
    return pcm, s, e


# ---------------------------------------------------------------- SoundFont writing
GEN = {"keyRange": 43, "velRange": 44, "instrument": 41, "sampleID": 53, "sampleModes": 54, "overridingRootKey": 58,
       "fineTune": 52, "coarseTune": 51, "attackVolEnv": 34, "releaseVolEnv": 38, "initialAttenuation": 48,
       "reverbEffectsSend": 16, "chorusEffectsSend": 15}


def tc(seconds):
    return int(round(1200 * math.log2(max(0.001, seconds))))


def gen_bytes(op, value):
    if op in ("keyRange", "velRange"):
        return struct.pack("<HBB", GEN[op], value[0], value[1])
    return struct.pack("<Hh", GEN[op], int(value))


def chunk(cid, data):
    return cid + struct.pack("<I", len(data)) + data + (b"\0" if len(data) & 1 else b"")


def zstr(s):
    """An INFO text: zero-terminated, padded to an even length (the size counts the padding)."""
    b = s.encode("latin-1", "replace") + b"\0"
    return b + (b"\0" if len(b) & 1 else b"")


def name20(s):
    return s.encode("latin-1", "replace")[:19].ljust(20, b"\0")


VSCO_COPYRIGHT = "CC0 1.0 - VS Chamber Orchestra 2: CE by Versilian Studios"
VSCO_COMMENT = "Built for Central Pedal from VSCO 2: CE (github.com/sgossner/VSCO-2-CE), mono, looped."


def write_sf2(path, bank_name, samples, instruments, presets, copyright=VSCO_COPYRIGHT, comment=VSCO_COMMENT):
    """samples: [{name, pcm, sr, root, s, e}]; instruments: [{name, zones: [{gens...}]}]; presets: [{name, prog, zones}]
    (copyright / comment: the bank's ICOP / ICMT texts - tools/sounds-vcsl.py writes its own)"""
    smpl, shdr, pos = [], b"", 0
    for sm in samples:
        smpl.append(sm["pcm"].tobytes())
        smpl.append(b"\0" * 92)   # 46 zero points after each sample
        n = len(sm["pcm"])
        ls, le = (pos + sm["s"], pos + sm["e"]) if sm["s"] is not None else (pos + n - 8, pos + n - 1)
        shdr += name20(sm["name"]) + struct.pack("<IIIIIBbHH", pos, pos + n, ls, le, sm["sr"], sm["root"], 0, 0, 1)
        pos += n + 46
    shdr += name20("EOS") + struct.pack("<IIIIIBbHH", 0, 0, 0, 0, 0, 0, 0, 0, 0)

    inst, ibags, gi = b"", b"", 0
    igen, bi = b"", 0
    for ins in instruments:
        inst += name20(ins["name"]) + struct.pack("<H", bi)
        for z in ins["zones"]:
            ibags += struct.pack("<HH", gi, 0)
            for op, v in z:
                igen += gen_bytes(op, v)
                gi += 1
            bi += 1
    inst += name20("EOI") + struct.pack("<H", bi)
    ibags += struct.pack("<HH", gi, 0)
    igen += struct.pack("<HH", 0, 0)
    imod = struct.pack("<HHhHH", 0, 0, 0, 0, 0)

    phdr, pbags, pgen, gi, bi = b"", b"", b"", 0, 0
    for pr in presets:
        phdr += name20(pr["name"]) + struct.pack("<HHHIII", pr["prog"], 0, bi, 0, 0, 0)
        for z in pr["zones"]:
            pbags += struct.pack("<HH", gi, 0)
            for op, v in z:
                pgen += gen_bytes(op, v)
                gi += 1
            bi += 1
    phdr += name20("EOP") + struct.pack("<HHHIII", 0, 0, bi, 0, 0, 0)
    pbags += struct.pack("<HH", gi, 0)
    pgen += struct.pack("<HH", 0, 0)
    pmod = struct.pack("<HHhHH", 0, 0, 0, 0, 0)

    info = (b"INFO" + chunk(b"ifil", struct.pack("<HH", 2, 1)) + chunk(b"isng", zstr("EMU8000")) + chunk(b"INAM", zstr(bank_name))
            + chunk(b"ICOP", zstr(copyright)) + chunk(b"ICMT", zstr(comment)))
    sdta = b"sdta" + chunk(b"smpl", b"".join(smpl))
    pdta = b"pdta" + b"".join(chunk(c, d) for c, d in ((b"phdr", phdr), (b"pbag", pbags), (b"pmod", pmod), (b"pgen", pgen),
                                                    (b"inst", inst), (b"ibag", ibags), (b"imod", imod), (b"igen", igen), (b"shdr", shdr)))
    body = b"sfbk" + chunk(b"LIST", info) + chunk(b"LIST", sdta) + chunk(b"LIST", pdta)
    with open(path + ".part", "wb") as out:
        out.write(b"RIFF" + struct.pack("<I", len(body)) + body)
    os.replace(path + ".part", path)


# ---------------------------------------------------------------- building
def build_instrument(iid, cache, samples):
    """Downloads one instrument, renders its samples; returns its zones (generators without envelope) + its defaults."""
    sfz_name, kind = INSTR[iid]
    sfz = fetch(RAW + urllib.parse.quote(sfz_name), os.path.join(cache, "sfz", sfz_name))
    with open(sfz, encoding="utf-8", errors="replace") as handle:
        regions, default_path = parse_sfz(handle.read())
    loaded = []
    for r in regions:
        rel = (default_path + r["sample"].replace("\\", "/")).lstrip("/")
        local = os.path.join(cache, "wav", rel)
        fetch(RAW + urllib.parse.quote(rel), local)
        x, sr = read_wav(local)
        g = 10 ** (float(r.get("volume", 0) or 0) / 20.0)
        loaded.append((r, x, sr, g, local))
    # level: an instrument's quiet and loud ranges brought closer (each note by its loudest layer, 70 % of the way to
    # the instrument's typical note, the layers of a note keep their difference), then its typical held note to
    # LEVEL_RMS with no peak above PEAK
    win = (0.0, 0.3) if kind == "pluck" else (0.4, 2.4)   # (a plucked note is measured while it rings)
    body = [float(np.sqrt(np.mean(x[int(win[0] * sr):int(win[1] * sr)] ** 2))) * g + 1e-9 for _, x, sr, g, _ in loaded]
    roots = [int(r.get("pitch_keycenter", r.get("key", 60))) for r, *_ in loaded]
    loudest = {k: max(b for b, rk in zip(body, roots) if rk == k) for k in set(roots)}
    typical = float(np.median(list(loudest.values())))
    even = [min(4.0, max(0.25, (typical / loudest[rk]) ** 0.7)) for rk in roots]
    loaded = [(r, x, sr, g * e, local) for (r, x, sr, g, local), e in zip(loaded, even)]
    body = [b * e for b, e in zip(body, even)]
    norm = LEVEL_RMS / (float(np.median(body)) or 1.0)   # (a stray click above PEAK is softened in render_sample)
    zones = []
    for r, x, sr, g, local in loaded:
        pcm, s, e = render_sample(x, sr, kind, g * norm)
        root = int(r.get("pitch_keycenter", r.get("key", 60)))
        samples.append({"name": "%s%d_%d" % (iid, root, len(samples)), "pcm": pcm, "sr": sr, "root": root, "s": s, "e": e})
        lo, hi = int(r.get("lokey", r.get("key", 0))), int(r.get("hikey", r.get("key", 127)))
        vlo, vhi = int(r.get("lovel", 0)), int(r.get("hivel", 127))
        z = [("keyRange", (lo, hi)), ("velRange", (vlo, vhi)), ("overridingRootKey", root)]
        if r.get("tune"):
            z.append(("fineTune", int(float(r["tune"]))))
        if s is not None:
            z.append(("sampleModes", 1))
        z.append(("sampleID", len(samples) - 1))
        zones.append(z)
        try:
            os.remove(local)   # (the raw sample is not kept)
        except OSError:
            pass
    first = regions[0] if regions else {}
    return zones, float(first.get("ampeg_attack", 0.005) or 0.005), float(first.get("ampeg_release", 0.5) or 0.5), kind


def main(cache, target):
    os.makedirs(target, exist_ok=True)
    built = 0
    for bank_name, slug, presets in BANKS:
        out = os.path.join(target, "%s - %s.sf2" % (slug, slug))
        if os.path.isfile(out):
            built += 1
            continue
        say(bank_name + " (VSCO 2: CE, CC0)")
        samples, instruments, inst_index, base = [], [], {}, {}
        needed = sorted({layer[0] for _, layers in presets for layer in layers})
        for iid in needed:
            say("  " + INSTR[iid][0])
            base[iid] = build_instrument(iid, cache, samples)
        pr_out = []
        for prog, (pname, layers) in enumerate(presets):
            pz = []
            for iid, klo, khi, att, rel, db in layers:
                zones, a0, r0, kind = base[iid]
                a, r = att if att is not None else a0, rel if rel is not None else r0
                key = (iid, round(a, 3), round(r, 3))
                if key not in inst_index:
                    env = [("attackVolEnv", tc(a)), ("releaseVolEnv", tc(r))]
                    instruments.append({"name": "%s %s" % (iid, len(instruments)), "zones": [z[:2] + env + [("reverbEffectsSend", 150)] + z[2:] for z in zones]})
                    inst_index[key] = len(instruments) - 1
                z = [("keyRange", (klo, khi))]
                if db < 0:
                    z.append(("initialAttenuation", int(round(-db * 10 / 0.4))))   # (cB; FluidSynth takes 0.4 x the value)
                z.append(("instrument", inst_index[key]))
                pz.append(z)
            pr_out.append({"name": pname, "prog": prog, "zones": pz})
        write_sf2(out, bank_name, samples, instruments, pr_out)
        say("  -> %s (%.0f MB, %d samples)" % (os.path.basename(out), os.path.getsize(out) / 1e6, len(samples)))
        built += 1
    return built


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    n = main(sys.argv[1], sys.argv[2])
    print("    %d of %d orchestra banks ready" % (n, len(BANKS)))
