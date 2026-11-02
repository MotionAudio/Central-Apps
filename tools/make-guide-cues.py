#!/usr/bin/env python3
"""Central Tracks (10.2): the guide track's spoken cues ("Verse 2", "Chorus", "All in", "Build", "Down", "Tag"...),
spoken once by an offline voice and kept in hymns/guide/ (tools/make-hymns.py puts them before each section).

The voice is Piper's LJSpeech (high): the voice model is MIT-licensed (huggingface.co/rhasspy/piper-voices) and it
was trained on the LJ Speech recordings, which are in the public domain - so the cues are free to use in sold audio.

    pip install piper-tts
    python3 tools/make-guide-cues.py MODEL.onnx            (en_US-ljspeech-high.onnx and its .onnx.json next to it)"""
import io
import os
import sys
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "hymns", "guide")
WORDS = {
    "intro": "Intro.", "verse": "Verse.", "verse-1": "Verse one.", "verse-2": "Verse two.", "verse-3": "Verse three.", "verse-4": "Verse four.",
    "verse-5": "Verse five.", "chorus": "Chorus.", "refrain": "Refrain.", "bridge": "Bridge.", "interlude": "Interlude.", "tag": "Tag.",
    "outro": "Outro.", "ending": "Ending.", "all-in": "All in!", "build": "Build.", "down": "Down.", "big": "Big!", "last-time": "Last time.",
    "band-in": "Band in.", "hold": "Hold.",
}
SR = 22050


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    from piper import PiperVoice
    voice = PiperVoice.load(argv[0])
    os.makedirs(OUT, exist_ok=True)
    for name, text in WORDS.items():
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            voice.synthesize_wav(text, w)
        buf.seek(0)
        with wave.open(buf) as w:
            sr = w.getframerate()
            x = np.frombuffer(w.readframes(w.getnframes()), "<i2").astype(np.float32) / 32768
        # (trim the silence round it, a clear level)
        idx = np.nonzero(np.abs(x) > 0.02)[0]
        if len(idx):
            x = x[max(0, idx[0] - int(0.01 * sr)):idx[-1] + int(0.05 * sr)]
        x = x / (np.max(np.abs(x)) or 1) * 0.89
        with wave.open(os.path.join(OUT, name + ".wav"), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(sr)
            w.writeframes((x * 32767).astype("<i2").tobytes())
        print("  %-10s %.2f s" % (name, len(x) / sr))
    with open(os.path.join(OUT, "CREDITS.txt"), "w") as f:
        f.write("The guide cues are spoken by Piper's LJSpeech voice (high): the voice model is MIT-licensed "
                "(https://huggingface.co/rhasspy/piper-voices), trained on the LJ Speech dataset, which is in the public domain "
                "(https://keithito.com/LJ-Speech-Dataset/). Made by tools/make-guide-cues.py.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
