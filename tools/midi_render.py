"""Central Pedal - write MIDI files and play them through a SoundFont with FluidSynth (no realtime: straight to a WAV).
Used by tools/make-hymns.py (the Central Tracks hymn stems) and tools/make-loops.py (the drum and percussion loops).

  m = Midi(bpm=72, ppq=480)            notes in beats: m.note(start_beat, length_beats, key, velocity, channel=0)
  m.program(0, prog), m.cc(beat, 7, 100), m.tempo(beat, bpm)
  m.save(path)                          a type-0 Standard MIDI File
  sf2_presets(path)                     [(bank, program, name)] read from the SoundFont's own preset list
  render(sf2, mid, sr=48000)            float32 array (frames, 2), FluidSynth's reverb and chorus off
Needs the fluidsynth program (apt install fluidsynth) and python3-numpy."""
import os
import struct
import subprocess
import tempfile
import wave

import numpy as np


class Midi:
    def __init__(self, bpm=120.0, ppq=480):
        self.ppq = ppq
        self.events = []   # (tick, order, bytes)
        self.tempo(0, bpm)

    def tick(self, beat):
        return max(0, int(round(beat * self.ppq)))

    def tempo(self, beat, bpm):
        us = int(round(60e6 / bpm))
        self.events.append((self.tick(beat), 0, b"\xff\x51\x03" + us.to_bytes(3, "big")))

    def program(self, channel, prog, bank=0, beat=0):
        t = self.tick(beat)
        self.events.append((t, 1, bytes([0xB0 | channel, 0, bank & 0x7F])))
        self.events.append((t, 1, bytes([0xB0 | channel, 32, 0])))
        self.events.append((t, 2, bytes([0xC0 | channel, prog & 0x7F])))

    def cc(self, beat, number, value, channel=0):
        self.events.append((self.tick(beat), 3, bytes([0xB0 | channel, number & 0x7F, max(0, min(127, int(value)))])))

    def bend(self, beat, value, channel=0):
        v = max(0, min(16383, int(8192 + value)))
        self.events.append((self.tick(beat), 3, bytes([0xE0 | channel, v & 0x7F, v >> 7])))

    def note(self, start, length, key, velocity=90, channel=0):
        if not (0 <= key <= 127) or length <= 0:
            return
        on, off = self.tick(start), self.tick(start + length)
        if off <= on:
            off = on + 1
        self.events.append((on, 5, bytes([0x90 | channel, key, max(1, min(127, int(velocity)))])))
        self.events.append((off, 4, bytes([0x80 | channel, key, 0])))   # (an off before an on at the same tick)

    @staticmethod
    def _vlq(n):
        out = [n & 0x7F]
        n >>= 7
        while n:
            out.append(0x80 | (n & 0x7F))
            n >>= 7
        return bytes(reversed(out))

    def save(self, path):
        data, last = b"", 0
        for t, _, msg in sorted(self.events, key=lambda e: (e[0], e[1])):
            data += self._vlq(t - last) + msg
            last = t
        data += self._vlq(self.ppq) + b"\xff\x2f\x00"   # (a beat of air before the end)
        with open(path, "wb") as f:
            f.write(b"MThd" + struct.pack(">IHHH", 6, 0, 1, self.ppq) + b"MTrk" + struct.pack(">I", len(data)) + data)
        return path


def sf2_presets(path):
    """[(bank, program, name)] from the SoundFont's PHDR chunk."""
    with open(path, "rb") as f:
        raw = f.read()
    i = raw.find(b"phdr")
    if i < 0:
        return []
    size = struct.unpack("<I", raw[i + 4:i + 8])[0]
    out = []
    for k in range(size // 38 - 1):   # (the last record is EOP)
        rec = raw[i + 8 + k * 38:i + 8 + (k + 1) * 38]
        name = rec[:20].split(b"\0")[0].decode("latin-1").strip()
        prog, bank = struct.unpack("<HH", rec[20:24])
        out.append((bank, prog, name))
    return out


def find_preset(path, *words):
    """The first preset whose name holds every word (any case): (bank, program, name), or None."""
    for bank, prog, name in sf2_presets(path):
        if all(w.lower() in name.lower() for w in words):
            return bank, prog, name
    return None


def read_wav(path):
    with wave.open(path) as w:
        ch, sw, n = w.getnchannels(), w.getsampwidth(), w.getnframes()
        raw = w.readframes(n)
    if sw == 2:
        x = np.frombuffer(raw, "<i2").astype(np.float32) / 32768.0
    elif sw == 4:
        x = np.frombuffer(raw, "<i4").astype(np.float32) / 2147483648.0
    else:
        raise ValueError("unsupported WAV")
    return x.reshape(-1, ch)


def render(sf2, mid, sr=48000, gain=0.6):
    """The MIDI file played through the SoundFont: float32 (frames, 2)."""
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, "out.wav")
        cmd = ["fluidsynth", "-ni", "-q", "-g", str(gain), "-r", str(sr), "-o", "synth.reverb.active=0", "-o", "synth.chorus.active=0",
               "-o", "synth.polyphony=512", "-T", "wav", "-O", "s16", "-F", out, sf2, mid]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
        if r.returncode != 0 or not os.path.isfile(out):
            raise RuntimeError("fluidsynth failed: %s" % (r.stderr or r.stdout)[-400:])
        return read_wav(out)


def write_wav(path, x, sr=48000):
    """float (frames,) or (frames, ch) -> 16-bit WAV."""
    x = np.asarray(x, np.float32)
    if x.ndim == 1:
        x = x[:, None]
    pcm = np.clip(np.round(x * 32767), -32768, 32767).astype("<i2")
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with wave.open(path + ".part", "wb") as w:
        w.setnchannels(x.shape[1])
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    os.replace(path + ".part", path)
    return path
