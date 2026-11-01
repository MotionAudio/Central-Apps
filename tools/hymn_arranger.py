"""Central Tracks hymns (10.2): each hymn's own band, feel and mix. Used by tools/make-hymns.py.

A hymn names its style in hymns/hymns.json ("style"); STYLES says, for each of the eight stems the apps know (Drums,
Bass, Keys, Pad, Electric, Strings, plus the Click and Guide make-hymns.py makes itself), which instruments play in it
and how (a "player"), and how the stem is mixed (level, pan, EQ, compression, echo, the room). The players follow the
hymn's chords and form: each section's energy (0 the quietest .. 3 everything) decides who plays and how hard, the
last bars of a section lean into a bigger one (fills, swells, a crescendo), and the time and touch are a player's,
not a machine's (a little early or late, louder on the strong beats, never twice the same).

  arrangement(hymn, secs, seed) -> {stem: [(sound name, Midi)]}     the parts, ready to render
  SOUNDS[name]                  -> (bank, preset words, fallbacks, GM program)   what make-hymns.py renders each with
  mix_stem(stem, x, style)      -> (dry, send)                      a stem's EQ, compression and echo
  reverb_ir(kind, side)                                               the style's room, left or right

Everything is deterministic: the same hymn renders the same way every time."""
import math

import numpy as np

import midi_render as M

SR = 44100

# ---------------------------------------------------------------- the instruments (the built libraries' presets)
_PADS = "Central Keys Pads"
_GB = "Central Instrument Guitars and Basses"
_PADS_FALLBACK = [(_PADS, ["Worship Pad"]), (_PADS, ["Warm Pad"]), (_PADS, ["Pad"])]
# name -> (bank, preset words, [(fallback bank, words)], GM program; "drums" = a kit: GM bank 128 on channel 10)
SOUNDS = {
    "concert_grand": ("Central Keys Grand Pianos", ["Concert Grand"], [("Central Keys Grand Pianos", ["Grand"])], 0),
    "studio_grand": ("Central Keys Grand Pianos", ["Studio Grand"], [("Central Keys Grand Pianos", ["Concert Grand"])], 1),
    "soft_grand": ("Central Keys Grand Pianos", ["Soft Grand"], [("Central Keys Grand Pianos", ["Concert Grand"])], 0),
    "upright_piano": ("Central Keys Pianos", ["Upright Piano"], [("Central Keys Grand Pianos", ["Studio Grand"])], 3),
    "fm_piano": ("Central Keys Pianos", ["FM Piano"], [("Central Keys Grand Pianos", ["FM Piano"])], 4),
    "pipe_organ": ("Central Keys Organs", ["Pipe Organ"], [("Central Keys Organs", ["Organ"])], 19),
    "quiet_organ": ("Central Keys Organs", ["Quiet Organ"], [("Central Keys Organs", ["Organ"])], 16),
    "organ_swell": ("Central Keys Organs", ["Organ Swell"], [("Central Keys Organs", ["Quiet Organ"])], 19),
    "positive_organ": ("Central Keys Organs", ["Positive Organ"], [("Central Keys Organs", ["Quiet Organ"])], 17),
    "concert_harp": ("Central Instrument Harps", ["Concert Harp"], [("Central Instrument Harps", ["Folk Harp"])], 46),
    "vibraphone": ("Central Keys Mallets", ["Vibraphone"], [], 11),
    "tubular_bells": ("Central Keys Mallets", ["Tubular Bells"], [("Central Keys Mallets", ["Bells"])], 14),
    "jazz_bass": (_GB, ["Jazz Bass"], [], 33),
    "upright_bass": (_GB, ["Upright Bass"], [(_GB, ["Jazz Bass"])], 32),
    "bowed_bass": (_GB, ["Upright Bass", "bowed"], [("VSCO Strings", ["Contrabass"]), (_GB, ["Upright Bass"])], 43),
    "acoustic_bass": (_GB, ["Acoustic Bass"], [(_GB, ["Upright Bass"])], 32),
    "contrabass": ("VSCO Strings", ["Contrabass"], [(_GB, ["Upright Bass", "bowed"])], 43),
    "sub_bass": ("Central Keys Synths", ["Sub Bass"], [("Central Keys Synths", ["Synth Bass"])], 38),
    "clean_guitar": (_GB, ["Electric Guitar Clean"], [(_GB, ["Electric Guitar"])], 27),
    "hollowbody": (_GB, ["Hollowbody"], [(_GB, ["Electric Guitar Clean"])], 25),
    "archtop": (_GB, ["Archtop"], [(_GB, ["Hollowbody"])], 26),
    "warm_pad": (_PADS, ["Warm Pad"], _PADS_FALLBACK, 89),
    "worship_pad": (_PADS, ["Worship Pad"], _PADS_FALLBACK, 89),
    "air_pad": (_PADS, ["Air Pad"], _PADS_FALLBACK, 91),
    "shimmer_pad": (_PADS, ["Shimmer Pad"], _PADS_FALLBACK, 94),
    "swell_pad": (_PADS, ["Swell Pad"], _PADS_FALLBACK, 95),
    "choir_aah": (_PADS, ["Choir Aah"], [(_PADS, ["Choir"])] + _PADS_FALLBACK, 52),
    "choir_ooh": (_PADS, ["Choir Ooh"], [(_PADS, ["Choir"])] + _PADS_FALLBACK, 53),
    "super_saw": ("Central Keys Synths", ["Super Saw"], [("Central Keys Synths", ["String Machine"])], 81),
    "string_machine": ("Central Keys Synths", ["String Machine"], [(_PADS, ["String Pad"])], 50),
    "worship_strings": ("VSCO Strings", ["Worship Strings"], [(_PADS, ["String Pad"])], 48),
    "string_swell": ("VSCO Strings", ["String Swell"], [("VSCO Strings", ["Worship Strings"]), (_PADS, ["String Pad"])], 49),
    "cello_pad": ("VSCO Strings", ["Cello Pad"], [("VSCO Strings", ["Cellos"]), (_PADS, ["String Pad"])], 42),
    "violins": ("VSCO Strings", ["Violins"], [("VSCO Strings", ["Worship Strings"]), (_PADS, ["String Pad"])], 40),
    "solo_violin": ("VSCO Strings", ["Solo Violin"], [("VSCO Strings", ["Violins"]), (_PADS, ["String Pad"])], 40),
    "pizzicato": ("VSCO Strings", ["Violin Pizzicato"], [("Central Instrument Harps", ["Concert Harp"])], 45),
    "brass_swell": ("VSCO Brass", ["Brass Swell"], [("Central Keys Synths", ["Synth Brass"])], 61),
    "brass_section": ("VSCO Brass", ["Brass Section"], [("Central Keys Synths", ["Synth Brass"])], 61),
    "french_horn": ("VSCO Brass", ["French Horn"], [("VSCO Brass", ["Brass Swell"]), ("Central Keys Synths", ["Synth Brass"])], 60),
    "flute": ("VSCO Woodwinds", ["Flute"], [("Central Instrument Winds", ["Alto Recorder"])], 73),
    "woodwind_choir": ("VSCO Woodwinds", ["Woodwind Choir"], [("VSCO Woodwinds", ["Flute"]), ("Central Instrument Winds", ["Recorder Consort"])], 71),
    "sax_section": ("Central Instrument Saxophones", ["Sax Section"], [("VSCO Brass", ["Brass Section"])], 65),
    "harmonica": ("Central Instrument Winds", ["Harmonica"], [], 22),
    "studio_kit": ("Central Instrument Drum Kits", ["Studio Kit"], [("Central Instrument Drum Kits", ["Kit"])], "drums"),
    "rock_kit": ("Central Instrument Drum Kits", ["Rusty Rock Kit"], [("Central Instrument Drum Kits", ["Studio Kit"])], "drums"),
    "brush_kit": ("Central Instrument Drum Kits", ["Brushes Kit"], [("Central Instrument Drum Kits", ["Studio Kit"])], "drums"),
    "hand_percussion": ("Central Instrument Percussion", ["Hand Percussion"], [], "drums"),
    "orchestral_percussion": ("Central Instrument Percussion", ["Orchestral Percussion"], [], "drums"),
}

# ---------------------------------------------------------------- the styles
# Each stem: [(sound, player, options)]. Options: min / max (the energies it plays at), only ("instrumental": intros,
# interludes, outros and tags), db (the layer's level against the stem's other layers) and the player's own (oct, vel, ...).
# mix: level (dB RMS where it plays), pan (-1 left .. 1 right), eq (hp Hz, low dB, mid (Hz, dB), presence dB, air dB),
# comp (ratio), echo (beats, feedback, wet), send (into the room).
STYLES = {
    "soul-ballad": {
        "about": "a slow soul ballad: electric piano in rolling triplets, a soft organ underneath, brushes, a warm bass, guitar swells, and strings and a choir for the last verse",
        "feel": "triplet", "color": "add9", "room": "hall",
        "stems": {
            "Keys": [("fm_piano", "keys_triplets", {})],
            "Pad": [("organ_swell", "pad_hold", {"vel": -6}), ("choir_ooh", "pad_hold", {"min": 3, "lo": 55, "vel": -8, "db": -3})],
            "Bass": [("jazz_bass", "bass_ballad", {})],
            "Drums": [("brush_kit", "drums_compound", {"max": 2, "kit": "brushes"}), ("studio_kit", "drums_compound", {"min": 3})],
            "Electric": [("hollowbody", "guitar_swells", {"min": 1})],
            "Strings": [("cello_pad", "strings_line", {"min": 1, "lo": 43, "hi": 60, "db": -2}), ("worship_strings", "strings_legato", {"min": 3})],
        },
        "mix": {"Drums": (-20, 0.0, (40, 1, None, 0, 1), 2, None, 0.10), "Bass": (-22, 0.0, (35, 2, (700, -2), 0, -3), 3, None, 0.04),
                "Keys": (-20, -0.15, (80, -1, (400, -1), 1, 1), 2, None, 0.22), "Pad": (-25, 0.1, (120, -2, (1500, -2), 0, -2), 1, None, 0.30),
                "Electric": (-27, 0.4, (150, -3, None, 1, 0), 1, (0.75, 0.35, 0.35), 0.35), "Strings": (-25, -0.35, (90, 0, None, 0, -1), 1, None, 0.32)},
    },
    "gospel-shuffle": {
        "about": "an upbeat gospel shuffle: piano and organ, a walking bass, shuffle drums with tambourine, chicken-picked guitar, and string and horn stabs",
        "feel": "shuffle", "color": "six", "room": "room",
        "stems": {
            "Keys": [("studio_grand", "keys_gospel", {})],
            "Pad": [("positive_organ", "pad_hold", {"vel": -4, "lo": 55})],
            "Bass": [("jazz_bass", "bass_walk", {})],
            "Drums": [("studio_kit", "drums_shuffle", {}), ("hand_percussion", "perc_tambourine", {"min": 2, "db": -9})],
            "Electric": [("clean_guitar", "guitar_chicken", {"min": 1})],
            "Strings": [("violins", "stabs", {"min": 2, "vel": -8, "db": -2}), ("brass_section", "stabs", {"min": 3, "lo": 55, "hi": 72})],
        },
        "mix": {"Drums": (-17, 0.0, (45, 2, (400, -2), 1, 1), 3, None, 0.06), "Bass": (-21, 0.0, (35, 3, (800, -1), 1, -4), 3, None, 0.02),
                "Keys": (-20, -0.2, (70, 0, (500, -2), 2, 1), 2, None, 0.10), "Pad": (-25, 0.25, (110, -2, (900, 1), 0, -3), 1, None, 0.12),
                "Electric": (-25, 0.45, (200, -4, (2500, 3), 2, 0), 2, None, 0.08), "Strings": (-24, -0.4, (180, -3, None, 2, 0), 2, None, 0.16)},
    },
    "folk-waltz": {
        "about": "a country-folk waltz: upright piano oom-pah-pah, a strummed hollowbody guitar, an acoustic bass, brushes, and a fiddle answering in the gaps",
        "feel": "straight", "color": None, "room": "room",
        "stems": {
            "Keys": [("upright_piano", "keys_waltz", {})],
            "Pad": [("warm_pad", "pad_hold", {"min": 1, "vel": -10})],
            "Bass": [("acoustic_bass", "bass_two", {})],
            "Drums": [("brush_kit", "drums_waltz", {"kit": "brushes"})],
            "Electric": [("hollowbody", "guitar_strum", {})],
            "Strings": [("solo_violin", "fiddle", {"min": 1}), ("violins", "strings_legato", {"min": 3, "vel": -10, "db": -4})],
        },
        "mix": {"Drums": (-22, 0.0, (40, 0, None, 0, 2), 2, None, 0.10), "Bass": (-22, 0.0, (35, 2, (600, -2), 1, -4), 3, None, 0.04),
                "Keys": (-21, -0.25, (90, -2, (300, -2), 1, 0), 2, None, 0.12), "Pad": (-28, 0.0, (150, -3, None, 0, -3), 1, None, 0.25),
                "Electric": (-21, 0.35, (110, -2, (250, -3), 1, 2), 2, None, 0.10), "Strings": (-24, -0.45, (220, -2, None, 1, 0), 1, None, 0.25)},
    },
    "celtic": {
        "about": "a Celtic lilt: harp in rolling triplets, a flute over the intro and interludes, a bowed bass, rolling toms, archtop arpeggios with echo, and swelling strings",
        "feel": "triplet", "color": "add9", "room": "church",
        "stems": {
            "Keys": [("concert_harp", "harp", {})],
            "Pad": [("air_pad", "pad_open", {})],
            "Bass": [("bowed_bass", "bass_bowed", {"max": 1}), ("upright_bass", "bass_compound", {"min": 2})],
            "Drums": [("rock_kit", "drums_celtic", {"min": 1}), ("orchestral_percussion", "perc_swells", {"min": 2, "db": -4})],
            "Electric": [("archtop", "guitar_arps", {"min": 2})],
            "Strings": [("flute", "lead_line", {"only": "instrumental", "db": 1}), ("string_swell", "strings_legato", {"min": 1, "vel": -6, "db": -2})],
        },
        "mix": {"Drums": (-20, 0.0, (40, 1, (500, -2), 0, 0), 2, None, 0.16), "Bass": (-23, 0.0, (35, 1, None, 0, -4), 2, None, 0.08),
                "Keys": (-21, -0.25, (80, -1, None, 1, 2), 1, None, 0.28), "Pad": (-27, 0.0, (150, -3, None, 0, 1), 1, None, 0.35),
                "Electric": (-27, 0.4, (180, -3, None, 1, 1), 1, (0.75, 0.4, 0.4), 0.3), "Strings": (-23, -0.3, (100, 0, None, 1, 0), 1, None, 0.35)},
    },
    "hymn-rock": {
        "about": "a hymn-rock anthem: driving drums and bass, rock piano, pulsing electric guitar, a synth bed, and strings and brass on the last verse",
        "feel": "straight", "color": None, "room": "plate",
        "stems": {
            "Keys": [("studio_grand", "keys_rock", {})],
            "Pad": [("super_saw", "pad_hold", {"min": 1, "vel": -10, "lo": 52})],
            "Bass": [("jazz_bass", "bass_rock", {}), ("sub_bass", "bass_ballad", {"min": 3, "oct": -12, "vel": -12, "roots": True, "db": -7})],
            "Drums": [("rock_kit", "drums_rock", {})],
            "Electric": [("clean_guitar", "guitar_rock", {"min": 1})],
            "Strings": [("string_swell", "strings_legato", {"min": 2, "vel": -6}), ("brass_swell", "brass", {"min": 3, "db": -2})],
        },
        "mix": {"Drums": (-16, 0.0, (45, 2, (350, -3), 2, 2), 3, None, 0.07), "Bass": (-20, 0.0, (40, 3, (750, -1), 2, -4), 4, None, 0.02),
                "Keys": (-21, -0.2, (90, -1, (450, -2), 2, 1), 2, None, 0.10), "Pad": (-26, 0.0, (180, -3, None, 0, 1), 2, None, 0.20),
                "Electric": (-22, 0.45, (120, -2, (2000, 2), 2, 0), 3, (0.5, 0.25, 0.18), 0.10), "Strings": (-24, -0.4, (110, -1, None, 1, 0), 2, None, 0.22)},
    },
    "piano-strings": {
        "about": "quiet piano and strings: a grand piano carries it, cellos and violins come in verse by verse, a bowed bass, guitar swells far back, and timpani only at the very top",
        "feel": "straight", "color": "add9", "room": "hall",
        "stems": {
            "Keys": [("concert_grand", "keys_ballad", {})],
            "Pad": [("warm_pad", "pad_hold", {"min": 1, "vel": -12})],
            "Bass": [("bowed_bass", "bass_bowed", {"min": 1, "max": 2}), ("upright_bass", "bass_ballad", {"min": 3})],
            "Drums": [("orchestral_percussion", "perc_swells", {"min": 2})],
            "Electric": [("clean_guitar", "guitar_swells", {"min": 2, "vel": -8})],
            "Strings": [("cello_pad", "strings_line", {"min": 1, "lo": 43, "hi": 60, "db": -1}), ("violins", "strings_line", {"min": 2, "lo": 72, "hi": 86, "vel": -6, "db": -4}),
                        ("worship_strings", "strings_legato", {"min": 3, "vel": -4, "db": -2})],
        },
        "mix": {"Drums": (-23, 0.0, (35, 1, None, 0, 1), 1, None, 0.25), "Bass": (-24, 0.0, (35, 1, None, 0, -4), 2, None, 0.10),
                "Keys": (-19, -0.1, (60, 0, (350, -1), 0, 1), 1, None, 0.25), "Pad": (-29, 0.0, (150, -3, None, -1, -3), 1, None, 0.3),
                "Electric": (-29, 0.5, (200, -4, None, 0, 0), 1, (0.75, 0.4, 0.4), 0.4), "Strings": (-22, -0.3, (70, 0, None, 1, 0), 1, None, 0.32)},
    },
    "cathedral": {
        "about": "a cathedral hymn: pipe organ and choir, then strings, woodwinds and a brass choir with timpani for the last verse",
        "feel": "straight", "color": None, "room": "church",
        "stems": {
            "Keys": [("pipe_organ", "organ", {})],
            "Pad": [("choir_aah", "pad_hold", {"min": 1, "lo": 53})],
            "Bass": [("contrabass", "bass_bowed", {"min": 1})],
            "Drums": [("orchestral_percussion", "perc_swells", {"min": 2, "timpani": True})],
            "Electric": [("tubular_bells", "bells", {"min": 2})],
            "Strings": [("worship_strings", "strings_legato", {"min": 1, "vel": -4}), ("woodwind_choir", "strings_line", {"min": 2, "lo": 67, "hi": 81, "vel": -10, "db": -5}),
                        ("brass_section", "brass", {"min": 3, "db": -1})],
        },
        "mix": {"Drums": (-22, 0.0, (35, 1, None, 0, 0), 1, None, 0.30), "Bass": (-24, 0.0, (30, 1, None, 0, -4), 1, None, 0.15),
                "Keys": (-19, 0.0, (40, 0, (500, -1), 0, -1), 1, None, 0.30), "Pad": (-25, 0.2, (140, -2, None, 1, 0), 1, None, 0.4),
                "Electric": (-30, 0.3, (300, -4, None, 0, 0), 1, None, 0.45), "Strings": (-22, -0.3, (80, 0, None, 1, 0), 1, None, 0.35)},
    },
    "gospel-68": {
        "about": "a rolling 6/8-style gospel ballad (written in 9/8): piano in triplets, a soft organ, a bass that lifts at the end of each beat, drums with tambourine, guitar fills and strings",
        "feel": "triplet", "color": "six", "room": "hall",
        "stems": {
            "Keys": [("studio_grand", "keys_triplets", {"piano": True})],
            "Pad": [("quiet_organ", "pad_hold", {"vel": -6, "lo": 55})],
            "Bass": [("jazz_bass", "bass_compound", {"min": 1})],
            "Drums": [("studio_kit", "drums_compound", {"min": 1}), ("hand_percussion", "perc_tambourine", {"min": 2, "db": -9})],
            "Electric": [("clean_guitar", "guitar_swells", {"min": 1, "fills": True})],
            "Strings": [("worship_strings", "strings_legato", {"min": 2, "vel": -6}), ("sax_section", "strings_line", {"min": 3, "lo": 58, "hi": 72, "vel": -12, "db": -6})],
        },
        "mix": {"Drums": (-19, 0.0, (40, 2, (400, -2), 1, 1), 3, None, 0.10), "Bass": (-21, 0.0, (35, 3, (800, -2), 0, -4), 3, None, 0.04),
                "Keys": (-20, -0.2, (70, 0, (450, -2), 1, 1), 2, None, 0.18), "Pad": (-26, 0.25, (120, -2, None, 0, -3), 1, None, 0.2),
                "Electric": (-26, 0.4, (150, -3, None, 1, 0), 1, (0.5, 0.3, 0.25), 0.3), "Strings": (-24, -0.4, (100, -1, None, 1, 0), 1, None, 0.3)},
    },
    "country-train": {
        "about": "a bright country gospel: a train beat on brushes, boom-chick bass, honky-tonk upright piano, a strummed guitar, harmonica in the intro and interlude, and a fiddle",
        "feel": "straight", "color": None, "room": "room",
        "stems": {
            "Keys": [("upright_piano", "keys_honky", {})],
            "Pad": [("harmonica", "lead_line", {"only": "instrumental", "lo": 64, "hi": 84})],
            "Bass": [("acoustic_bass", "bass_two", {})],
            "Drums": [("brush_kit", "drums_train", {})],
            "Electric": [("hollowbody", "guitar_strum", {"sixteenths": True})],
            "Strings": [("solo_violin", "fiddle", {"min": 2})],
        },
        "mix": {"Drums": (-20, 0.0, (40, 1, None, 1, 2), 2, None, 0.06), "Bass": (-21, 0.0, (35, 2, (650, -2), 1, -4), 3, None, 0.02),
                "Keys": (-21, -0.3, (100, -2, (350, -2), 2, 1), 2, None, 0.08), "Pad": (-24, 0.15, (200, -3, (1500, 2), 1, 0), 2, None, 0.18),
                "Electric": (-20, 0.35, (110, -2, (250, -3), 1, 2), 2, None, 0.08), "Strings": (-24, -0.45, (220, -2, None, 1, 0), 1, None, 0.18)},
    },
}
DEFAULT_STYLE = "piano-strings"

# the rooms: (decay s, pre-delay s, darkness (low-pass Hz), early reflections, return level)
ROOMS = {"hall": (2.6, 0.025, 6500, 0.4, 0.55), "church": (3.8, 0.035, 4500, 0.3, 0.6), "room": (1.1, 0.008, 7000, 0.7, 0.5),
         "plate": (1.9, 0.012, 9000, 0.2, 0.5)}

# General MIDI drum notes (the libraries' kits use the same places)
K, S, X, CLAP, HC, HP, HO, RIDE, BELL, CRASH, CRASH2 = 36, 38, 37, 39, 42, 44, 46, 51, 53, 49, 57
T1, T2, T3, T4 = 50, 47, 43, 41
TAMB, SHAKE = 54, 70
OBD, TIMP, SUSC, TRI, GONG = 35, 41, 52, 81, 57


def style_of(hymn):
    return STYLES.get(hymn.get("style") or DEFAULT_STYLE, STYLES[DEFAULT_STYLE])


# ---------------------------------------------------------------- the arranger
class Band:
    def __init__(self, hymn, secs, seed):
        self.h, self.secs = hymn, secs
        self.st = style_of(hymn)
        self.m, self.bpm = hymn["meter"], hymn["bpm"]
        self.feel = self.st["feel"]
        self.key = _pc(hymn["key"])
        self.rng = np.random.default_rng(seed)
        self.bars = []
        for si, s in enumerate(secs):
            nxt = secs[si + 1]["energy"] if si + 1 < len(secs) else -1
            kind = s["name"].lower().split()[0] if s["name"] else ""
            for i, b in enumerate(s["bars"]):
                self.bars.append({"i": s["start"] - 1 + i, "sec": s, "si": si, "chords": b, "first": i == 0, "last": i == len(s["bars"]) - 1,
                                  "pos": i, "n": len(s["bars"]), "next": nxt, "e": int(s["energy"]), "kind": kind,
                                  "inst": kind in ("intro", "interlude", "outro", "instrumental"),
                                  "final": si == len(secs) - 1 and i == len(s["bars"]) - 1})

    # -- time and touch
    def ms(self, x):
        return x / 1000.0 * self.bpm / 60.0

    def loose(self, sd_ms):
        return float(self.rng.normal(0, self.ms(sd_ms)))

    def subs(self):
        """Where a beat's eighths fall: straight halves, a shuffle's long-short, or three triplets."""
        return {"straight": (0.0, 0.5), "shuffle": (0.0, 2 / 3), "triplet": (0.0, 1 / 3, 2 / 3)}[self.feel]

    def rising(self, b):
        return b["next"] > b["e"]

    def vel(self, b, base, add=0, spread=5):
        """Louder with the section's energy, building through a section that leads into a bigger one."""
        ramp = (b["pos"] + 1) / b["n"] * 8 if self.rising(b) else 0
        return int(max(18, min(124, base + 10 * b["e"] + ramp + add + self.rng.integers(-spread, spread + 1))))

    def accent(self, beat):
        if beat == 0:
            return 6
        if self.m == 4 and beat == 2:
            return 2
        return -2

    def segments(self, bar):
        out = []
        cs = bar["chords"]
        for j, (ch, beat) in enumerate(cs):
            end = cs[j + 1][1] if j + 1 < len(cs) else self.m + 1
            out.append((ch, bar["i"] * self.m + beat - 1, end - beat))
        return out

    def next_chord(self, bi):
        if bi + 1 < len(self.bars):
            return self.bars[bi + 1]["chords"][0][0]
        return None

    # -- harmony
    def pcs(self, ch, color=None):
        """The chord's pitch classes, coloured the style's way on the home and four chords."""
        out = []
        for iv in ch["ivs"]:
            pc = (ch["root"] + iv) % 12
            if pc not in out:
                out.append(pc)
        major = 4 in ch["ivs"] and 7 in ch["ivs"] and len(ch["ivs"]) == 3
        rel = (ch["root"] - self.key) % 12
        color = color if color is not None else self.st.get("color")
        if color == "plain":
            return out
        if color == "add9" and major and rel in (0, 5, 7):
            out.append((ch["root"] + 2) % 12)
        elif color == "six" and major and rel in (0, 5):
            out.append((ch["root"] + 9) % 12)
        elif color == "six" and major and rel == 7:
            out.append((ch["root"] + 10) % 12)
        return out

    def voice(self, ch, lo, hi, count, prev, center, color=None):
        pcs = self.pcs(ch, color)
        if count == 2 and len(pcs) >= 3:      # (two notes: the third and the fifth, the sweetest pair)
            core = [pcs[1], pcs[2]]
        else:
            core = pcs[:count]
        cands = []
        for start in range(lo, hi + 1):
            if start % 12 not in core:
                continue
            k = core.index(start % 12)
            seq = core[k:] + core[:k]
            notes = [start]
            for pc in seq[1:]:
                n = notes[-1] + 1
                while n % 12 != pc:
                    n += 1
                notes.append(n)
            if notes[-1] <= hi:
                cands.append(notes)
        if not cands:
            return [lo + (ch["root"] - lo) % 12]
        if prev and len(prev) == len(cands[0]):
            return min(cands, key=lambda v: sum(abs(a - b) for a, b in zip(v, prev)) + 0.15 * abs(np.mean(v) - center))
        return min(cands, key=lambda v: abs(np.mean(v) - center))

    @staticmethod
    def low(pc, lo, hi, prev=None):
        cands = [n for n in range(lo, hi + 1) if n % 12 == pc]
        if not cands:
            return lo + (pc - lo) % 12
        return min(cands, key=lambda n: abs(n - (prev if prev is not None else (lo + hi) / 2)))

    def scale(self):
        return [(self.key + d) % 12 for d in (0, 2, 4, 5, 7, 9, 11)]

    def scale_step(self, n, direction):
        """The next note of the key's scale above (1) or below (-1) n."""
        sc = self.scale()
        k = n + direction
        while k % 12 not in sc:
            k += direction
        return k

    def step_toward(self, n, target):
        """The scale note between n and target (for a walk or an approach), or a half step below the target."""
        sc = self.scale()
        if target > n:
            for k in range(n + 1, target):
                if k % 12 in sc:
                    return k
        else:
            for k in range(n - 1, target, -1):
                if k % 12 in sc:
                    return k
        return target - 1

    # -- the parts
    def part(self, sound, player, opts, prog, channel, bank):
        mid = M.Midi(self.bpm)
        if channel != 9:
            mid.program(channel, prog, bank)
        play = getattr(self, "p_" + player)
        want = []
        for bi, b in enumerate(self.bars):
            ok = opts.get("min", 0) <= b["e"] <= opts.get("max", 3)
            if opts.get("only") == "instrumental":
                ok = b["inst"] or b["kind"] == "tag"
            if b["final"]:
                ok = ok or opts.get("only") != "instrumental"
            want.append(ok)
        play(mid, channel, want, opts)
        return mid

    def expression(self, mid, ch, want, floor=60):
        """CC11 across the song: each section's level, a crescendo through the bar before a bigger section."""
        for bi, b in enumerate(self.bars):
            if not want[bi]:
                continue
            lvl = floor + 16 * b["e"]
            t0 = b["i"] * self.m
            if b["last"] and self.rising(b):
                to = floor + 16 * b["next"]
                for k in range(8):
                    mid.cc(t0 + k * self.m / 8, 11, lvl + (to - lvl) * k / 7, ch)
            else:
                mid.cc(t0, 11, lvl, ch)

    # keys -------------------------------------------------------------------------------------------------------
    def p_keys_ballad(self, mid, ch, want, o):
        """A pianist's ballad: open left hand, a gentle right hand that moves more as the song grows."""
        prev = None
        for bi, b in enumerate(self.bars):
            if not want[bi]:
                continue
            e = b["e"]
            for c, at, ln in self.segments(b):
                rh = self.voice(c, 62, 79, 4 if e >= 2 else 3, prev, 70)
                prev = rh
                bass = self.low(c["bass"], 36, 47)
                mid.cc(at, 64, 0, ch)
                mid.cc(at + 0.03, 64, 127, ch)
                if b["final"]:
                    for k, n in enumerate([bass - 12 if bass - 12 >= 24 else bass, bass + 7] + rh):
                        mid.note(at + k * self.ms(18), self.m * 2, n, self.vel(b, 58, -4), ch)
                    continue
                if e == 0:   # left hand open fifth, right hand rolled once, then one note answering on the back half
                    mid.note(at, ln, bass, self.vel(b, 54), ch)
                    if ln >= 2:
                        mid.note(at + self.loose(10), ln, bass + 7, self.vel(b, 46), ch)
                    for k, n in enumerate(rh):
                        mid.note(at + 0.02 + k * self.ms(22), ln, n, self.vel(b, 50, -2 * k), ch)
                    if ln >= 3:
                        mid.note(at + ln / 2 + self.loose(12), ln / 2, rh[-1] + (2 if (rh[-1] + 2) % 12 in self.pcs(c) else 0), self.vel(b, 44), ch)
                elif e == 1:  # flowing eighths: the left hand rocks, the right hand on the beats
                    arp = [bass, bass + 7, bass + 12, bass + 7]
                    for k in range(int(ln * 2)):
                        mid.note(at + k / 2 + self.loose(8), 1.0, arp[k % 4], self.vel(b, 46, -4 if k % 2 else 0), ch)
                    for q in range(0, int(ln), 2 if self.m == 4 else 3):
                        for n in rh:
                            mid.note(at + q + self.loose(8), 1.8, n, self.vel(b, 46, self.accent(q % self.m)), ch)
                else:         # e2-3: octaves below, chords on the beats, a push into the next chord
                    mid.note(at, ln, bass, self.vel(b, 52), ch)
                    mid.note(at, ln, bass - 12 if bass - 12 >= 24 else bass + 12, self.vel(b, 46), ch)
                    for q in range(int(ln)):
                        notes = rh + ([rh[-1] + 12] if e == 3 and q == 0 else [])
                        for n in notes:
                            mid.note(at + q + self.loose(6), 0.9, n, self.vel(b, 44, self.accent((at + q) % self.m)), ch)
                    if ln >= 2 and e == 3:
                        for n in rh[1:]:
                            mid.note(at + ln - 0.5 + self.loose(6), 0.45, n, self.vel(b, 40), ch)
        self.pedal_off(mid, ch)

    def p_keys_triplets(self, mid, ch, want, o):
        """The 6/8 gospel and soul piano: chords pulsing in triplets, the left hand on the big beats."""
        prev = None
        for bi, b in enumerate(self.bars):
            if not want[bi]:
                continue
            e = b["e"]
            for c, at, ln in self.segments(b):
                rh = self.voice(c, 60, 78, 4, prev, 68)
                prev = rh
                bass = self.low(c["bass"], 36, 48)
                mid.cc(at, 64, 0, ch)
                mid.cc(at + 0.03, 64, 127, ch)
                if b["final"]:
                    for k, n in enumerate([bass, bass + 12] + rh + [rh[-1] + 12]):
                        mid.note(at + k * self.ms(25), self.m * 2, n, self.vel(b, 56), ch)
                    continue
                if e == 0:
                    mid.note(at, ln, bass, self.vel(b, 50), ch)
                    for k, n in enumerate(rh):
                        mid.note(at + k * self.ms(30), ln, n, self.vel(b, 46), ch)
                    continue
                mid.note(at, ln, bass, self.vel(b, 52), ch)
                if e >= 2:
                    mid.note(at, ln, bass - 12 if bass >= 36 else bass + 12, self.vel(b, 44), ch)
                for q in range(int(ln)):
                    for t in range(3):
                        pos = at + q + t / 3
                        if o.get("piano") and e == 1 and t:      # (lighter: an arpeggio up the chord instead of chords)
                            mid.note(pos + self.loose(6), 0.6, rh[(t + q) % len(rh)], self.vel(b, 40, -4), ch)
                            continue
                        notes = rh if t == 0 else rh[1:]
                        for n in notes:
                            mid.note(pos + self.loose(5), 0.3, n, self.vel(b, 42, 8 if t == 0 else -8), ch)
                    if e == 3 and q == int(ln) - 1 and b["last"]:   # (a run up into the next section)
                        for k, n in enumerate(sorted(rh)[:3]):
                            mid.note(at + q + (k + 1) / 4, 0.25, n + 12, self.vel(b, 50), ch)
        self.pedal_off(mid, ch)

    def p_keys_gospel(self, mid, ch, want, o):
        """Shuffle gospel piano: the left hand stride and walk-ups, the right hand stabbing on 2 and 4 and the pushes."""
        prev, sub = None, self.subs()[1]
        for bi, b in enumerate(self.bars):
            if not want[bi]:
                continue
            e = b["e"]
            nxt = self.next_chord(bi)
            for c, at, ln in self.segments(b):
                rh = self.voice(c, 60, 77, 4, prev, 68)
                prev = rh
                bass = self.low(c["bass"], 36, 48)
                if b["final"]:
                    for k, n in enumerate([bass - 12, bass] + rh + [rh[-1] + 12]):
                        mid.note(at + k * self.ms(20), self.m * 2, n, self.vel(b, 60), ch)
                    mid.cc(at, 64, 127, ch)
                    continue
                mid.cc(at, 64, 0, ch)
                if e == 0:
                    mid.cc(at + 0.03, 64, 127, ch)
                    mid.note(at, ln, bass, self.vel(b, 52), ch)
                    for k, n in enumerate(rh):
                        mid.note(at + k * self.ms(25), ln, n, self.vel(b, 48), ch)
                    continue
                for q in range(int(ln)):
                    beat = (at + q) % self.m
                    if beat in (0, 2):                     # left hand: octave on 1 and 3
                        mid.note(at + q, 0.9, bass, self.vel(b, 54, 4), ch)
                        mid.note(at + q, 0.9, bass + 12, self.vel(b, 46), ch)
                    else:                                  # right hand stab on 2 and 4
                        for n in rh:
                            mid.note(at + q + self.loose(5), 0.4, n, self.vel(b, 52, 6), ch)
                    if e >= 2 and beat in (1, 3):          # the push on the shuffle's "a"
                        for n in rh[1:]:
                            mid.note(at + q + sub + self.loose(5), 0.25, n, self.vel(b, 44, -4), ch)
                    if e == 3 and beat == 0 and self.rng.random() < 0.5:   # a blues grace note into the third
                        third = (c["root"] + 4) % 12
                        top = self.low(third, 72, 83)
                        mid.note(at + q + 0.5 - 0.08, 0.08, top - 1, self.vel(b, 44), ch)
                        mid.note(at + q + 0.5, 0.4, top, self.vel(b, 50), ch)
                if b["last"] and nxt is not None and e >= 1:    # walk up into the next section
                    target = self.low(nxt["bass"], 36, 48, bass)
                    w = self.step_toward(target - 3 if target - 3 > bass else bass, target)
                    mid.note(at + ln - 1 + sub, 1 - sub, w, self.vel(b, 50), ch)
        self.pedal_off(mid, ch)

    def p_keys_waltz(self, mid, ch, want, o):
        """Oom-pah-pah: bass on 1 (root, then the fifth every other bar), the chord on 2 and 3."""
        prev = None
        for bi, b in enumerate(self.bars):
            if not want[bi]:
                continue
            e = b["e"]
            for c, at, ln in self.segments(b):
                rh = self.voice(c, 57, 74, 3, prev, 65)
                prev = rh
                bass = self.low(c["bass"], 38, 50)
                if b["final"]:
                    for n in [bass - 12, bass] + rh + [rh[0] + 12]:
                        mid.note(at, self.m * 2, n, self.vel(b, 56), ch)
                    continue
                if e == 0:                                 # broken chord in eighths
                    arp = [bass, bass + 7, rh[0], rh[1], rh[2], rh[1]]
                    for k in range(int(ln * 2)):
                        mid.note(at + k / 2 + self.loose(8), 0.9, arp[k % 6], self.vel(b, 46, -4 if k % 2 else 2), ch)
                    continue
                for q in range(int(ln)):
                    beat = (at + q) % self.m
                    if beat == 0:
                        alt = bass + 7 if (b["i"] % 2 and e >= 2 and bass + 7 <= 55) else bass
                        mid.note(at + q, 0.95, alt, self.vel(b, 54, 4), ch)
                        if e >= 2:
                            mid.note(at + q, 0.95, alt - 12 if alt >= 36 else alt, self.vel(b, 44), ch)
                    else:
                        for n in rh + ([rh[0] + 12] if e == 3 else []):
                            mid.note(at + q + self.loose(6), 0.55, n, self.vel(b, 46, -2), ch)

    def p_keys_rock(self, mid, ch, want, o):
        prev = None
        for bi, b in enumerate(self.bars):
            if not want[bi]:
                continue
            e = b["e"]
            for c, at, ln in self.segments(b):
                rh = self.voice(c, 62, 79, 3, prev, 70)
                prev = rh
                bass = self.low(c["bass"], 36, 47)
                if b["final"]:
                    for n in [bass - 12, bass] + rh + [rh[-1] + 12]:
                        mid.note(at, self.m * 2, n, self.vel(b, 62), ch)
                    continue
                if e == 0:
                    mid.note(at, ln, bass, self.vel(b, 50), ch)
                    mid.note(at, ln, bass + 12, self.vel(b, 42), ch)
                    for n in rh:
                        mid.note(at + self.loose(8), ln, n, self.vel(b, 46), ch)
                    continue
                mid.note(at, ln, bass, self.vel(b, 52), ch)
                mid.note(at, ln, bass - 12 if bass >= 36 else bass + 12, self.vel(b, 46), ch)
                step = 1 if e == 1 else 0.5
                for k in range(int(ln / step)):
                    pos = at + k * step
                    beat = pos % self.m
                    for n in rh + ([rh[-1] + 12] if e == 3 else []):
                        mid.note(pos + self.loose(5), step * 0.7, n, self.vel(b, 42, self.accent(int(beat)) if beat == int(beat) else -8), ch)

    def p_keys_honky(self, mid, ch, want, o):
        """Honky-tonk piano: a boom-chick left hand and right-hand chords on the off-beats, a slide up now and then."""
        prev = None
        for bi, b in enumerate(self.bars):
            if not want[bi]:
                continue
            e = b["e"]
            for c, at, ln in self.segments(b):
                rh = self.voice(c, 64, 79, 3, prev, 71)
                prev = rh
                bass = self.low(c["bass"], 36, 48)
                if b["final"]:
                    for n in [bass - 12, bass] + rh + [rh[-1] + 12]:
                        mid.note(at, self.m * 2, n, self.vel(b, 62), ch)
                    continue
                for q in range(int(ln)):
                    mid.note(at + q, 0.45, bass if q % 2 == 0 else bass + 7, self.vel(b, 52, 4 if q % 2 == 0 else 0), ch)
                    for n in rh:
                        mid.note(at + q + 0.5 + self.loose(6), 0.35, n, self.vel(b, 46, -2), ch)
                    if e >= 2 and q == 0 and self.rng.random() < 0.35:   # a slide into the top note
                        top = rh[-1]
                        mid.note(at + q + 0.42, 0.06, top - 1, self.vel(b, 40), ch)
                        mid.note(at + q + 0.5, 0.4, top + 12, self.vel(b, 50), ch)

    def p_organ(self, mid, ch, want, o):
        """Hymn-book organ: four voices moving smoothly, the pedal on the bass, the octave added at the top."""
        prev = None
        self.expression(mid, ch, want, floor=70)
        for bi, b in enumerate(self.bars):
            if not want[bi]:
                continue
            e = b["e"]
            for c, at, ln in self.segments(b):
                v = self.voice(c, 55, 76, 3, prev, 66, color="plain")
                prev = v
                bass = self.low(c["bass"], 40, 52)
                length = self.m * 2 if b["final"] else ln - 0.03
                notes = v + [bass] + ([bass - 12] if e >= 1 else []) + ([v[-1] + 12] if e >= 3 else [])
                for n in notes:
                    mid.note(at, length, n, 80, ch)

    def p_harp(self, mid, ch, want, o):
        """Harp: triplet arpeggios rolling up and down two octaves, the bass on the beat."""
        for bi, b in enumerate(self.bars):
            if not want[bi]:
                continue
            e = b["e"]
            for c, at, ln in self.segments(b):
                pcs = self.pcs(c)
                bass = self.low(c["bass"], 38, 50)
                ladder = sorted({n for n in range(bass + 7, bass + 31) if n % 12 in pcs})
                if b["final"]:
                    for k, n in enumerate([bass] + ladder[:8]):
                        mid.note(at + k * 0.11, self.m * 2.5, n, self.vel(b, 54, -k), ch)
                    continue
                mid.note(at, ln + 1, bass, self.vel(b, 52), ch)
                per = 3 if e >= 1 else 1
                steps = int(ln * per)
                up = ladder[:7] + ladder[5:0:-1]
                for k in range(steps):
                    if e == 0 and k % 3 == 2:
                        continue
                    n = up[(k + b["i"]) % len(up)] if e < 3 else up[k % len(up)] + (12 if k % 6 == 3 else 0)
                    ring = min(2.5, ln - k / per + 0.2)       # (a harpist damps the strings as the chord changes)
                    mid.note(at + k / per + self.loose(8), ring, n, self.vel(b, 44, 6 if k % per == 0 else -4), ch)

    def pedal_off(self, mid, ch):
        mid.cc(self.bars[-1]["i"] * self.m + self.m * 2 + 1, 64, 0, ch)

    # bass -------------------------------------------------------------------------------------------------------
    def p_bass_ballad(self, mid, ch, want, o):
        prev, oct_ = None, o.get("oct", 0)
        for bi, b in enumerate(self.bars):
            if not want[bi]:
                continue
            e = b["e"]
            nxt = self.next_chord(bi)
            for j, (c, at, ln) in enumerate(self.segments(b)):
                n = self.low(c["bass"], 31, 50, prev) + oct_
                prev = n - oct_
                v = self.vel(b, 58, o.get("vel", 0))
                if b["final"]:
                    mid.note(at, self.m * 2, n, v, ch)
                    continue
                last_seg = j == len(b["chords"]) - 1
                if e >= 2 and last_seg and nxt is not None and ln >= 2 and not o.get("roots"):
                    mid.note(at + self.loose(6), ln - 0.5, n, v, ch)
                    to = self.low(nxt["bass"], 31, 50, n - oct_) + oct_
                    mid.note(at + ln - 0.5 + self.loose(6), 0.45, self.step_toward(n, to) if to != n else n, v - 10, ch)
                elif e == 3 and ln >= 3 and self.m == 4:
                    mid.note(at, 1.9, n, v, ch)
                    mid.note(at + 2 + self.loose(6), ln - 2.1, n, v - 6, ch)
                else:
                    mid.note(at + self.loose(6), ln - 0.08, n, v, ch)

    def p_bass_bowed(self, mid, ch, want, o):
        prev = None
        self.expression(mid, ch, want, floor=64)
        for bi, b in enumerate(self.bars):
            if not want[bi]:
                continue
            for c, at, ln in self.segments(b):
                n = self.low(c["bass"], 31, 47, prev)
                prev = n
                length = self.m * 2 if b["final"] else ln
                mid.note(at, length + 0.02, n, 74, ch)
            if b["final"]:
                break
        # (a held note: tie through the bars until the bass changes)
        self._tie(mid, ch)

    @staticmethod
    def _tie(mid, ch):
        """Notes of the same key back to back become one long note (a bowed or held line carries on)."""
        notes, others, opened = [], [], {}
        for t, order, msg in sorted(mid.events, key=lambda e: (e[0], e[1])):
            st = msg[0] & 0xF0
            if st == 0x90 and len(msg) == 3 and msg[2] > 0:
                opened.setdefault(msg[1], []).append((t, msg[2]))
            elif st in (0x80, 0x90) and len(msg) == 3:
                if opened.get(msg[1]):
                    on, vel = opened[msg[1]].pop(0)
                    notes.append([on, t, msg[1], vel])
            else:
                others.append((t, order, msg))
        notes.sort(key=lambda n: (n[2], n[0]))
        merged = []
        for n in notes:
            if merged and merged[-1][2] == n[2] and 0 <= n[0] - merged[-1][1] <= 4:
                merged[-1][1] = max(merged[-1][1], n[1])
            else:
                merged.append(n)
        mid.events = others + [(on, 5, bytes([0x90 | ch, k, v])) for on, off, k, v in merged] + [(off, 4, bytes([0x80 | ch, k, 0])) for on, off, k, v in merged]

    def p_bass_two(self, mid, ch, want, o):
        """The country two: root and fifth, a walk up the scale into the next chord at the end of a line."""
        prev = None
        for bi, b in enumerate(self.bars):
            if not want[bi]:
                continue
            e = b["e"]
            nxt = self.next_chord(bi)
            for j, (c, at, ln) in enumerate(self.segments(b)):
                n = self.low(c["bass"], 33, 48, prev)
                prev = n
                fifth = n + 7 if n + 7 <= 52 else n - 5
                if b["final"]:
                    mid.note(at, self.m * 2, n, self.vel(b, 64), ch)
                    continue
                if self.m == 3:
                    mid.note(at + self.loose(5), 0.9, n if (b["i"] % 2 == 0 or ln < 3) else fifth, self.vel(b, 60, 4), ch)
                    if e >= 2 and ln >= 3:
                        mid.note(at + 2 + self.loose(5), 0.4, fifth if b["i"] % 2 == 0 else n, self.vel(b, 50), ch)
                    continue
                beats = [(0, n), (2, fifth)] if ln >= 3 else [(0, n)]
                for q, note in beats:
                    if q < ln:
                        mid.note(at + q + self.loose(5), 0.9, note, self.vel(b, 60, 4 if q == 0 else 0), ch)
                walk = b["last"] and j == len(b["chords"]) - 1 and nxt is not None and ln >= 4 and e >= 1
                if walk:
                    to = self.low(nxt["bass"], 33, 48, n)
                    a = self.step_toward(n, to)
                    bb = self.step_toward(a, to) if a != to - 1 else a
                    mid.note(at + 2, 0.9, a, self.vel(b, 54), ch)
                    mid.note(at + 3, 0.9, bb, self.vel(b, 56), ch)
                elif e >= 2 and ln >= 4:
                    mid.note(at + 3.5 + self.loose(4), 0.4, n, self.vel(b, 46), ch)

    def p_bass_walk(self, mid, ch, want, o):
        """A walking bass in the shuffle: root, chord tones, a step into the next chord, triplet pickups."""
        prev, sub = None, self.subs()[1]
        for bi, b in enumerate(self.bars):
            if not want[bi]:
                continue
            e = b["e"]
            segs = self.segments(b)
            for j, (c, at, ln) in enumerate(segs):
                n = self.low(c["bass"], 31, 47, prev)
                prev = n
                if b["final"]:
                    mid.note(at, self.m * 2, n, self.vel(b, 64), ch)
                    continue
                if j + 1 < len(segs):
                    nc = segs[j + 1][0]
                else:
                    nc = self.next_chord(bi) or c
                to = self.low(nc["bass"], 31, 47, n)
                if e <= 1:
                    mid.note(at + self.loose(5), min(ln, 2) - 0.1, n, self.vel(b, 58, 4), ch)
                    if ln >= 3:
                        mid.note(at + 2 + self.loose(5), ln - 2.1, n + 7 if n + 7 <= 50 else n - 5, self.vel(b, 54), ch)
                    continue
                pcs = self.pcs(c, "plain")
                tones = [n, self.low(pcs[1], n, n + 12), self.low(pcs[2 % len(pcs)], n, n + 12)]
                line = [n] + tones[1:]
                walk = [line[k % len(line)] for k in range(max(0, int(ln) - 1))] + [self.step_toward(n, to) if to != n else n + 7]
                for q, note in enumerate(walk[:int(ln)]):
                    mid.note(at + q + self.loose(5), 0.85, note, self.vel(b, 58, 4 if q == 0 else 0), ch)
                    if e == 3 and q == 1 and self.rng.random() < 0.4:     # a triplet pickup
                        mid.note(at + q + sub, 0.25, note, self.vel(b, 46), ch)

    def p_bass_rock(self, mid, ch, want, o):
        prev = None
        for bi, b in enumerate(self.bars):
            if not want[bi]:
                continue
            e = b["e"]
            nxt = self.next_chord(bi)
            for j, (c, at, ln) in enumerate(self.segments(b)):
                n = self.low(c["bass"], 28, 45, prev)
                prev = n
                if b["final"]:
                    mid.note(at, self.m * 2, n, self.vel(b, 66), ch)
                    continue
                if e == 0:
                    mid.note(at, ln - 0.1, n, self.vel(b, 54), ch)
                    continue
                if e == 1:
                    for q in range(int(ln)):
                        mid.note(at + q + self.loose(4), 0.8, n, self.vel(b, 54, 4 if q == 0 else 0), ch)
                    continue
                steps = int(ln * 2)
                fill = b["last"] and j == len(b["chords"]) - 1 and nxt is not None and e >= 2
                to = self.low(nxt["bass"], 28, 45, n) if nxt is not None else n
                for k in range(steps):
                    note = n
                    if e == 3 and k == steps - 1 and not fill:
                        note = n + 12
                    if fill and k >= steps - 3:       # a run into the next section
                        note = [self.step_toward(n, to + (3 if to > n else -3)), self.step_toward(n, to), to - 1 if to > n else to + 1][k - (steps - 3)]
                    mid.note(at + k / 2 + self.loose(4), 0.42, note, self.vel(b, 56, 6 if k % 2 == 0 else -6), ch)

    def p_bass_compound(self, mid, ch, want, o):
        """In a triplet feel: the root on the beat, a lift on the last triplet of the bar into the next chord."""
        prev = None
        for bi, b in enumerate(self.bars):
            if not want[bi]:
                continue
            e = b["e"]
            nxt = self.next_chord(bi)
            for j, (c, at, ln) in enumerate(self.segments(b)):
                n = self.low(c["bass"], 31, 48, prev)
                prev = n
                if b["final"]:
                    mid.note(at, self.m * 2, n, self.vel(b, 62), ch)
                    continue
                mid.note(at + self.loose(5), min(ln, 2) - 1 / 3, n, self.vel(b, 58, 4), ch)
                if ln >= 2:
                    fifth = n + 7 if n + 7 <= 52 else n - 5
                    mid.note(at + ln - 1 + self.loose(5), 2 / 3 - 0.05, fifth if e >= 2 else n, self.vel(b, 50), ch)
                if j == len(b["chords"]) - 1 and nxt is not None and e >= 1:
                    to = self.low(nxt["bass"], 31, 48, n)
                    lift = self.scale_step(to, -1 if to >= n else 1) if to != n else n
                    mid.note(at + ln - 1 / 3 + self.loose(4), 1 / 3 - 0.03, lift, self.vel(b, 48), ch)

    # pads and sustained lines -----------------------------------------------------------------------------------
    def p_pad_hold(self, mid, ch, want, o):
        lo = o.get("lo", 50)
        prev, held, held_at, held_end = None, None, 0, 0
        self.expression(mid, ch, want, floor=58)
        v = 70 + o.get("vel", 0)
        for bi, b in enumerate(self.bars):
            if not want[bi]:
                if held:
                    for n in held:
                        mid.note(held_at, held_end - held_at + 0.05, n, v, ch)
                    held = None
                prev = None
                continue
            for c, at, ln in self.segments(b):
                voicing = self.voice(c, lo, lo + 22, 4, prev, lo + 11)
                if voicing != held:
                    if held:
                        for n in held:
                            mid.note(held_at, at - held_at + 0.05, n, v, ch)
                    held, held_at = voicing, at
                held_end = at + (self.m * 3 if b["final"] else ln)
                prev = voicing
        for n in held or []:
            mid.note(held_at, held_end - held_at, n, v, ch)

    def p_pad_open(self, mid, ch, want, o):
        """An open pad: root, fifth, octave and ninth, held over the bass notes that belong to the key."""
        self.expression(mid, ch, want, floor=56)
        held, held_at, held_end = None, 0, 0
        for bi, b in enumerate(self.bars):
            if not want[bi]:
                continue
            for c, at, ln in self.segments(b):
                r = self.low(c["root"], 45, 56)
                third = r + 12 + (3 if 3 in c["ivs"] and 4 not in c["ivs"] else 4)
                voicing = [r, r + 7, r + 12, r + 14 if (r + 14) % 12 in self.pcs(c, "add9") else third]
                if voicing != held:
                    if held:
                        for n in held:
                            mid.note(held_at, at - held_at + 0.1, n, 66, ch)
                    held, held_at = voicing, at
                held_end = at + (self.m * 3 if b["final"] else ln)
        for n in held or []:
            mid.note(held_at, held_end - held_at, n, 66, ch)

    def p_strings_legato(self, mid, ch, want, o):
        prev = None
        self.expression(mid, ch, want, floor=60)
        for bi, b in enumerate(self.bars):
            if not want[bi]:
                prev = None
                continue
            e = b["e"]
            for c, at, ln in self.segments(b):
                v = self.voice(c, 50, 76, 4, prev, 64)
                prev = v
                notes = v + ([v[-1] + 12] if e == 3 else []) + ([self.low(c["bass"], 36, 47)] if e >= 2 else [])
                length = self.m * 2.5 if b["final"] else ln + 0.04
                for n in notes:
                    mid.note(at, length, n, 70 + o.get("vel", 0) + 6 * e, ch)

    def p_strings_line(self, mid, ch, want, o):
        """One line moving through the chords: the nearest chord note, but never standing still for long."""
        lo, hi = o.get("lo", 55), o.get("hi", 72)
        prev = None
        self.expression(mid, ch, want, floor=60)
        for bi, b in enumerate(self.bars):
            if not want[bi]:
                prev = None
                continue
            for c, at, ln in self.segments(b):
                pcs = self.pcs(c, "plain")
                cands = [n for n in range(lo, hi + 1) if n % 12 in pcs]
                if not cands:
                    continue
                if prev is None:
                    n = min(cands, key=lambda k: abs(k - (lo + hi) / 2))
                else:
                    moves = [k for k in cands if k != prev] or cands
                    n = min(moves, key=lambda k: abs(k - prev) + (0.5 if abs(k - prev) > 4 else 0))
                prev = n
                length = self.m * 2.5 if b["final"] else ln + 0.03
                mid.note(at, length, n, 74 + o.get("vel", 0) + 5 * b["e"], ch)
                if ln >= 3 and not b["final"] and self.rng.random() < 0.35:    # a passing note of the key on the way
                    step = self.scale_step(n, 1 if n < (lo + hi) / 2 else -1)
                    mid.note(at + ln - 0.5, 0.53, step, 62 + o.get("vel", 0) + 5 * b["e"], ch)
        self._tie(mid, ch)

    def p_lead_line(self, mid, ch, want, o):
        """A simple tune of chord and scale notes for the intro and interludes (flute, harmonica)."""
        lo, hi = o.get("lo", 67), o.get("hi", 86)
        prev = None
        self.expression(mid, ch, want, floor=70)
        sc = self.scale()
        for bi, b in enumerate(self.bars):
            if not want[bi]:
                prev = None
                continue
            for c, at, ln in self.segments(b):
                pcs = self.pcs(c, "plain")
                cands = [n for n in range(lo, hi + 1) if n % 12 in pcs]
                if not cands:
                    continue
                n = min(cands, key=lambda k: abs(k - (prev if prev else (lo + hi) / 2)) + (3 if k == prev else 0))
                if b["final"]:
                    mid.note(at, self.m * 2, n, 78, ch)
                    continue
                if ln >= 3:      # a three-note figure: chord note, a neighbour, home again
                    up = 1 if self.rng.random() < 0.5 else -1
                    nb = n + up
                    while nb % 12 not in sc:
                        nb += up
                    mid.note(at + self.loose(8), ln - 1.5, n, 78, ch)
                    mid.note(at + ln - 1.5 + self.loose(8), 0.5, nb, 70, ch)
                    mid.note(at + ln - 1 + self.loose(8), 1.0, n, 74, ch)
                else:
                    mid.note(at + self.loose(8), ln, n, 76, ch)
                prev = n

    def p_fiddle(self, mid, ch, want, o):
        """A fiddle answering in the gaps: short phrases at the ends of lines, long notes in the instrumental parts."""
        prev = None
        sc = self.scale()
        for bi, b in enumerate(self.bars):
            if not want[bi]:
                continue
            for c, at, ln in self.segments(b):
                pcs = self.pcs(c, "plain")
                cands = [n for n in range(67, 88) if n % 12 in pcs]
                n = min(cands, key=lambda k: abs(k - (prev or 76)) + (2 if k == prev else 0))
                prev = n
                if b["final"]:
                    mid.note(at, self.m * 2, n, 70, ch)
                    continue
                fill = b["inst"] or (b["pos"] % 4 == 3) or (b["pos"] % 2 == 1 and b["e"] >= 3)
                if not fill:
                    continue
                if b["inst"] and ln >= 2:
                    mid.note(at + self.loose(10), ln * 0.6, n, self.vel(b, 60), ch)
                    tail = [n + d for d in (2, 0, -1, -3)]
                    tail = [k if k % 12 in sc else k - 1 for k in tail]
                    for k, t in enumerate(tail[:int(ln * 0.4 * 2)]):
                        mid.note(at + ln * 0.6 + k / 2 + self.loose(8), 0.45, t, self.vel(b, 54), ch)
                else:            # a little run down to the chord note in the last beats
                    run = [n + 4, n + 2, n]
                    run = [k if k % 12 in sc else k - 1 for k in run]
                    start = at + max(0.0, ln - 1.5)
                    for k, t in enumerate(run):
                        mid.note(start + k / 2 + self.loose(8), 0.5 if k < 2 else 1.0, t, self.vel(b, 52, -2 * k), ch)

    def p_stabs(self, mid, ch, want, o):
        """Short chords on the pushes (strings or horns): the downbeat of a section, the shuffle's "a" of 4."""
        lo, hi = o.get("lo", 62), o.get("hi", 79)
        prev = None
        sub = self.subs()[1]
        for bi, b in enumerate(self.bars):
            if not want[bi]:
                continue
            for c, at, ln in self.segments(b):
                v = self.voice(c, lo, hi, 3, prev, (lo + hi) / 2)
                prev = v
                if b["final"]:
                    for n in v:
                        mid.note(at, self.m * 2, n, 80, ch)
                    continue
                hits = [0] if b["first"] or b["pos"] % 2 == 0 else []
                if b["pos"] % 2 == 1 and ln >= 4:
                    hits.append(3 + sub)
                if b["e"] == 3 and ln >= 2:
                    hits.append(1)
                for hpos in hits:
                    if hpos < ln:
                        for n in v:
                            mid.note(at + hpos + self.loose(5), 0.3, n, self.vel(b, 64, o.get("vel", 0)), ch)

    def p_brass(self, mid, ch, want, o):
        """A brass choir: long chords that swell in (the bar's downbeat), louder on the last verse."""
        prev = None
        self.expression(mid, ch, want, floor=62)
        for bi, b in enumerate(self.bars):
            if not want[bi]:
                prev = None
                continue
            for c, at, ln in self.segments(b):
                v = self.voice(c, 52, 72, 3, prev, 62, color="plain")
                prev = v
                bass = self.low(c["bass"], 36, 48)
                length = self.m * 2 if b["final"] else ln
                for n in v + [bass]:
                    mid.note(at, length, n, 78, ch)
        self._tie(mid, ch)

    def p_bells(self, mid, ch, want, o):
        """Bells on the downbeat of each line in the big sections (a cathedral's tower, far back)."""
        for bi, b in enumerate(self.bars):
            if not want[bi]:
                continue
            c, at, ln = self.segments(b)[0]
            if b["final"]:
                mid.note(at, self.m * 3, self.low(c["root"], 64, 75), 70, ch)
                continue
            if b["pos"] % 4 == 0:
                mid.note(at, ln + 0.1, self.low(c["root"], 64, 75), self.vel(b, 50), ch)
                mid.note(at + 0.02, ln + 0.1, self.low(c["root"], 64, 75) + 7, self.vel(b, 40), ch)

    # guitar -----------------------------------------------------------------------------------------------------
    def p_guitar_swells(self, mid, ch, want, o):
        """Volume swells: a two-note shape faded in on each chord, echoing away (the echo is the mix's)."""
        prev = None
        for bi, b in enumerate(self.bars):
            if not want[bi]:
                continue
            for c, at, ln in self.segments(b):
                v = self.voice(c, 64, 83, 2, prev, 74)
                prev = v
                if b["final"]:
                    mid.cc(at, 11, 110, ch)
                    for n in v:
                        mid.note(at, self.m * 2, n, 76, ch)
                    continue
                if b["e"] < 3 and b["pos"] % 2 == 1 and not o.get("fills"):
                    continue
                for k in range(9):
                    mid.cc(at + k * 0.12, 11, int(127 * (k / 8) ** 1.7) if k else 0, ch)
                for n in v:
                    mid.note(at + 0.005, min(ln, 3.0), n, 80 + o.get("vel", 0), ch)
                if o.get("fills") and b["last"] and ln >= 2:      # a little answering figure at the end of a section
                    mid.cc(at + ln - 1, 11, 100, ch)
                    for k, n in enumerate((v[-1], v[0], v[-1] + 2 if (v[-1] + 2) % 12 in self.scale() else v[-1])):
                        mid.note(at + ln - 1 + k / 3, 0.3, n, 72, ch)

    def p_guitar_arps(self, mid, ch, want, o):
        """Picked arpeggios in eighths (triplets in a triplet feel), high on the neck, for the mix's echo to fill."""
        prev = None
        per = len(self.subs())
        for bi, b in enumerate(self.bars):
            if not want[bi]:
                continue
            for c, at, ln in self.segments(b):
                v = self.voice(c, 62, 81, 3, prev, 71)
                prev = v
                if b["final"]:
                    for n in v:
                        mid.note(at, self.m * 2, n, 70, ch)
                    continue
                pattern = [v[0], v[2], v[1], v[2] + (12 if v[2] + 12 <= 88 else 0), v[1], v[2]]
                for k in range(int(ln * per)):
                    mid.note(at + k / per + self.loose(6), 0.9, pattern[k % len(pattern)], self.vel(b, 52, 4 if k % per == 0 else -6), ch)

    def guitar_shape(self, c, prev):
        """A guitar's six-string chord shape: the bass note low, the chord stacked up the strings."""
        bass = self.low(c["bass"], 40, 52)
        v = self.voice(c, bass + 4, bass + 22, 4, prev, bass + 12)
        return [bass] + [n for n in v if n > bass][:5]

    def p_guitar_strum(self, mid, ch, want, o):
        """Strumming: downs on the beats, ups in between, the strings a few milliseconds apart."""
        prev = None
        for bi, b in enumerate(self.bars):
            if not want[bi]:
                continue
            e = b["e"]
            for c, at, ln in self.segments(b):
                shape = self.guitar_shape(c, prev)
                prev = shape[1:]
                if b["final"]:
                    self.strum(mid, ch, at, shape, True, 80, self.m * 2)
                    continue
                if self.m == 3:
                    pattern = [(0, True), (1, True), (1.5, False), (2, True), (2.5, False)] if e >= 1 else [(0, True)]
                elif o.get("sixteenths") and e >= 2:
                    pattern = [(q / 2, q % 2 == 0) for q in range(8)]
                else:
                    pattern = [(0, True), (1, True), (1.5, False), (2.5, False), (3, True), (3.5, False)] if e >= 1 else [(0, True), (2, True)]
                for pos, down in pattern:
                    if pos >= ln:
                        continue
                    v = self.vel(b, 52 if down else 42, self.accent(int(pos)) if down else 0)
                    self.strum(mid, ch, at + pos + self.loose(6), shape, down, v, 0.45 if not down else 0.9)

    def strum(self, mid, ch, at, shape, down, vel, length):
        strings = shape if down else list(reversed(shape[1:]))[:4]
        gap = self.ms(9 if down else 6)
        for k, n in enumerate(strings):
            mid.note(at + k * gap, length, n, max(20, vel - (2 * k if down else 3 * k)), ch)

    def p_guitar_chicken(self, mid, ch, want, o):
        """Chicken picking for the shuffle: short high two-note stabs on the off-beats, ghosted scratches between."""
        prev = None
        sub = self.subs()[1]
        for bi, b in enumerate(self.bars):
            if not want[bi]:
                continue
            for c, at, ln in self.segments(b):
                v = self.voice(c, 67, 84, 2, prev, 75)
                prev = v
                if b["final"]:
                    for n in v:
                        mid.note(at, self.m * 2, n, 72, ch)
                    continue
                for q in range(int(ln)):
                    beat = (at + q) % self.m
                    if beat in (1, 3):
                        for n in v:
                            mid.note(at + q + self.loose(4), 0.14, n, self.vel(b, 56, 4), ch)
                    if b["e"] >= 2:
                        mid.note(at + q + sub + self.loose(4), 0.06, v[0], self.vel(b, 30, -10), ch)

    def p_guitar_rock(self, mid, ch, want, o):
        """Rock rhythm guitar: palm-muted eighths in the verses, open power chords in the big sections."""
        for bi, b in enumerate(self.bars):
            if not want[bi]:
                continue
            e = b["e"]
            for c, at, ln in self.segments(b):
                r = self.low(c["root"], 40, 51)
                power = [r, r + 7, r + 12]
                if b["final"]:
                    for n in power + [r + 19]:
                        mid.note(at, self.m * 2, n, 84, ch)
                    continue
                if e == 3:
                    for n in power + [r + 16 if (r + 16) % 12 in self.pcs(c, "plain") else r + 15]:
                        mid.note(at + self.loose(5), ln - 0.05, n, self.vel(b, 64), ch)
                    for k in range(1, int(ln * 2)):
                        if k % 2 == 1:
                            for n in power[:2]:
                                mid.note(at + k / 2 + self.loose(4), 0.2, n, self.vel(b, 42, -6), ch)
                    continue
                for k in range(int(ln * 2)):
                    for n in power[:2]:
                        mid.note(at + k / 2 + self.loose(4), 0.18 if e == 1 else 0.3, n, self.vel(b, 50, 6 if k % 2 == 0 else -4), ch)

    # drums ------------------------------------------------------------------------------------------------------
    def drums(self, mid, ch, want, groove, fills=True, crash=True):
        """A drummer: groove(b, beat_list) -> hits for one bar; fills into bigger sections; crashes on arrivals."""
        for bi, b in enumerate(self.bars):
            if not want[bi]:
                continue
            e = b["e"]
            t0 = b["i"] * self.m
            if b["final"]:
                mid.note(t0, 1, CRASH, 104, ch)
                mid.note(t0, 1, K, 108, ch)
                continue
            if e == 0:
                continue
            hits = groove(b)
            if crash and b["first"] and e >= 2:
                hits.append((0, CRASH, 96 if e == 3 else 80))
            if fills and b["last"] and b["next"] >= max(e, 2):
                cut = self.m - 1
                hits = [hh for hh in hits if hh[0] < cut or hh[1] in (HC, HP, RIDE, TAMB, SHAKE)]
                hits += self.fill(e, cut)
            elif fills and b["pos"] % 8 == 7 and e >= 2 and self.rng.random() < 0.6:    # a small turn at the end of a phrase
                hits = [hh for hh in hits if hh[0] < self.m - 0.5]
                hits += [(self.m - 0.5, S, 70), (self.m - 0.25, S, 78)]
            for at, note, v in hits:
                late = self.ms(8) if note in (S, X, CLAP) else 0.0
                mid.note(t0 + at + late + self.loose(5 if note == K else 8), 0.25, note, max(1, min(127, v + int(self.rng.integers(-5, 6)) + (4 if self.rising(b) and b["pos"] >= b["n"] - 2 else 0))), ch)

    def fill(self, e, cut):
        options = [
            [(cut, S, 82), (cut + 0.25, T1, 86), (cut + 0.5, T2, 92), (cut + 0.75, T4, 100)],
            [(cut, S, 76), (cut + 0.25, S, 82), (cut + 0.5, T2, 90), (cut + 0.75, T4, 98)],
            [(cut + k / 3, n, 80 + 8 * k) for k, n in enumerate((S, T2, T4))],
            [(cut, T1, 84), (cut + 0.5, T2, 90), (cut + 0.75, S, 96)],
        ]
        if self.feel != "straight":
            return options[2]
        return options[int(self.rng.integers(0, 4 if e >= 2 else 2))]

    def p_drums_pop(self, mid, ch, want, o):
        def groove(b):
            e = b["e"]
            if self.m == 3:
                return [(0, K, 76 + 6 * e), (2, S, 70 + 8 * e)] + [(q / 2, HC, 60 if q % 2 == 0 else 44) for q in range(6)]
            if e == 1:
                return [(0, K, 72), (2, X, 58)] + [(q, HC, 48) for q in range(4)]
            if e == 2:
                return [(0, K, 92), (1.5, K, 70), (2, K, 84), (1, S, 96), (3, S, 98)] + [(q / 2, HC, 70 if q % 2 == 0 else 52) for q in range(8)]
            return [(0, K, 106), (1.5, K, 84), (2, K, 98), (2.5, K, 70), (1, S, 110), (3, S, 112)] + [(q / 2, RIDE, 82 if q % 2 == 0 else 64) for q in range(8)]
        self.drums(mid, ch, want, groove)

    def p_drums_rock(self, mid, ch, want, o):
        def groove(b):
            e = b["e"]
            if e == 1:      # floor-tom groove: the verse simmering
                return [(0, K, 84), (2, K, 78)] + [(q / 2, T4, 70 if q % 2 == 0 else 50) for q in range(8)]
            if e == 2:
                return [(0, K, 98), (1.5, K, 78), (2, K, 92), (2.5, K, 72), (1, S, 104), (3, S, 106)] + [(q / 2, HC, 76 if q % 2 == 0 else 56) for q in range(8)] + [(3.5, HO, 64)] * (b["pos"] % 4 == 3)
            return [(0, K, 110), (0.5, K, 80), (1.5, K, 90), (2, K, 104), (2.5, K, 86), (1, S, 116), (3, S, 118)] + [(q / 2, RIDE if q % 2 else CRASH2 if q == 0 and b["pos"] % 2 == 0 else RIDE, 88 if q % 2 == 0 else 70) for q in range(8)]
        self.drums(mid, ch, want, groove)

    def p_drums_shuffle(self, mid, ch, want, o):
        sub = self.subs()[1]

        def groove(b):
            e = b["e"]
            if e == 1:
                return [(0, K, 74), (2, K, 66)] + [(q + t, HC, 58 if t == 0 else 40) for q in range(4) for t in (0, sub)] + [(1, X, 56), (3, X, 58)]
            hats = RIDE if e == 3 else HC
            h = [(0, K, 98), (1 + sub, K, 70), (2, K, 90), (1, S, 106), (3, S, 110)] + [(q + t, hats, 80 if t == 0 else 52) for q in range(4) for t in (0, sub)]
            return h + [(q + sub, S, int(self.rng.integers(24, 36))) for q in (0, 2) if self.rng.random() < 0.6]
        self.drums(mid, ch, want, groove)

    def p_drums_waltz(self, mid, ch, want, o):
        def groove(b):
            e = b["e"]
            if o.get("kit") == "brushes" and e <= 2:
                return [(0, K, 58 + 4 * e), (1, S, 44 + 6 * e), (2, S, 56 + 6 * e)] + [(q + t / 3, S, int(self.rng.integers(20, 30))) for q in range(3) for t in range(3)]
            return [(0, K, 88), (1, HP, 54), (2, S, 82)] + [(q / 2, HC, 64 if q % 2 == 0 else 44) for q in range(6)]
        self.drums(mid, ch, want, groove)

    def p_drums_compound(self, mid, ch, want, o):
        """A triplet feel (9/8 or 12/8): the hats or brushes in triplets, the kick on 1, the backbeat on the last beat."""
        def groove(b):
            e = b["e"]
            back = self.m - 1 if self.m == 3 else (1, 3)
            backs = [back] if isinstance(back, int) else list(back)
            if o.get("kit") == "brushes":
                h = [(0, K, 54 + 4 * e)] + [(bb, S, 56 + 8 * e) for bb in backs]
                return h + [(q + t / 3, S, int(self.rng.integers(18, 30 + 3 * e))) for q in range(self.m) for t in range(3)]
            hats = RIDE if e == 3 else HC
            h = [(0, K, 84 + 6 * e), (self.m - 1 + 2 / 3, K, 60 + 4 * e)] + [(bb, S, 80 + 10 * e) for bb in backs]
            return h + [(q + t / 3, hats, 66 if t == 0 else 42) for q in range(self.m) for t in range(3)]
        self.drums(mid, ch, want, groove)

    def p_drums_celtic(self, mid, ch, want, o):
        def groove(b):
            e = b["e"]
            h = [(0, K, 84 + 6 * e)] + [(q + t / 3, T4 if t == 0 else T3, 74 + 6 * e if t == 0 else 50 + 4 * e) for q in range(self.m) for t in range(3)]
            if e >= 2:
                h += [(self.m - 1, S, 80 + 10 * e)]
            if e == 3:
                h += [(q, RIDE, 70) for q in range(self.m)]
            return h
        self.drums(mid, ch, want, groove)

    def p_drums_train(self, mid, ch, want, o):
        def groove(b):
            e = b["e"]
            h = [(0, K, 80 + 6 * e), (2, K, 76 + 6 * e)] + [(i / 4, S, (88 + 6 * e) if i in (4, 12) else (50 + 4 * e) if i % 2 == 0 else (28 + 3 * e)) for i in range(16)]
            if e == 3:
                h += [(q + 0.5, HP, 50) for q in range(4)]
            return h
        self.drums(mid, ch, want, groove)

    def p_perc_tambourine(self, mid, ch, want, o):
        """Tambourine on the backbeat, a shaker underneath (in the hymn's own subdivision)."""
        subs = self.subs()
        for bi, b in enumerate(self.bars):
            if not want[bi] or b["final"]:
                continue
            t0 = b["i"] * self.m
            backs = [self.m - 1] if self.m == 3 else [1, 3]
            for bb in backs:
                mid.note(t0 + bb + self.ms(6) + self.loose(6), 0.2, TAMB, self.vel(b, 58), ch)
            for q in range(self.m):
                for k, s in enumerate(subs):
                    mid.note(t0 + q + s + self.loose(7), 0.15, SHAKE, self.vel(b, 40, 6 if k == 0 else -6), ch)

    def p_perc_swells(self, mid, ch, want, o):
        """The orchestra's percussion: a suspended cymbal rolling up into each bigger section, timpani on its
        downbeat (and every bar of the last verse when asked), a bass drum and the cymbal on the final chord."""
        for bi, b in enumerate(self.bars):
            if not want[bi]:
                continue
            t0 = b["i"] * self.m
            if b["final"]:
                for k in range(12):
                    mid.note(t0 + k / 8, 0.2, TIMP, 60 + 4 * k, ch)
                mid.note(t0 + 1.5, 2, OBD, 110, ch)
                mid.note(t0 + 1.5, 3, SUSC, 100, ch)
                continue
            if b["first"] and b["e"] >= 2:
                mid.note(t0, 1, TIMP, 96, ch)
                mid.note(t0, 1, OBD, 90, ch)
            elif o.get("timpani") and b["e"] == 3 and b["pos"] % 2 == 0:
                mid.note(t0, 1, TIMP, 80, ch)
            if b["last"] and b["next"] >= 2 and b["next"] > b["e"] - 1:
                for k in range(self.m * 6):
                    mid.note(t0 + k / 6, 0.2, SUSC, int(22 + 70 * (k / (self.m * 6)) ** 1.6), ch)


def _pc(name):
    return {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11}[name]


# ---------------------------------------------------------------- mixing
def eq(x, hp=None, low=0.0, mid=None, presence=0.0, air=0.0):
    """A whole-stem EQ (zero phase): a high-pass, a low shelf at 200 Hz, one bell, presence at 3 kHz, air at 10 kHz."""
    n = len(x)
    if n == 0:
        return x
    f = np.fft.rfftfreq(n, 1 / SR)
    f[0] = 1.0
    lf = np.log2(f)
    g = np.zeros_like(f)
    g += low / (1 + np.exp((lf - np.log2(200)) * 4))
    g += presence * np.exp(-0.5 * ((lf - np.log2(3000)) / 0.7) ** 2)
    g += air / (1 + np.exp(-(lf - np.log2(10000)) * 4))
    if mid:
        g += mid[1] * np.exp(-0.5 * ((lf - np.log2(mid[0])) / 0.6) ** 2)
    gain = 10 ** (g / 20)
    if hp:
        gain /= np.sqrt(1 + (hp / f) ** 4)
    return np.fft.irfft(np.fft.rfft(x) * gain, n).astype(np.float32)


def compress(x, ratio, block=0.01):
    """A gentle compressor (RMS over 10 ms blocks, smoothed): evens out a stem without squashing it."""
    if ratio <= 1 or len(x) == 0:
        return x
    bs = int(block * SR)
    nb = len(x) // bs
    if nb < 2:
        return x
    r = np.sqrt(np.mean(x[:nb * bs].reshape(nb, bs) ** 2, axis=1)) + 1e-9
    db = 20 * np.log10(r)
    loud = db[db > np.max(db) - 30]
    thr = float(np.percentile(loud, 60)) if len(loud) else -30.0
    want = np.where(db > thr, (db - thr) * (1 - 1 / ratio), 0.0)
    g = np.zeros(nb)
    cur = 0.0
    att, rel = 0.6, 0.06
    for i in range(nb):
        cur = cur + (want[i] - cur) * (att if want[i] > cur else rel)
        g[i] = cur
    gain = 10 ** (-np.interp(np.arange(len(x)) / bs, np.arange(nb) + 0.5, g) / 20)
    return (x * gain).astype(np.float32)


def echo(x, seconds, feedback, wet, repeats=7):
    """Echoes after the stem, each quieter and a little darker than the one before."""
    d = int(seconds * SR)
    if d <= 0 or len(x) == 0:
        return x
    out = x.astype(np.float32).copy()
    fr = np.fft.rfftfreq(len(x), 1 / SR)
    dark = 1 / np.sqrt(1 + (fr / 3500.0) ** 2)
    tail = x.astype(np.float32)
    for k in range(1, repeats + 1):
        if d * k >= len(x):
            break
        tail = np.fft.irfft(np.fft.rfft(tail) * dark, len(x)).astype(np.float32)
        out[d * k:] += wet * feedback ** (k - 1) * tail[:len(x) - d * k]
    return out


def reverb_ir(kind, side=0):
    decay, pre, dark, early, _ = ROOMS.get(kind, ROOMS["hall"])
    rng = np.random.default_rng(31 + side * 7 + len(kind))
    n = int(decay * SR)
    t = np.arange(n) / SR
    ir = rng.normal(0, 1, n) * np.exp(-6.9 * t / decay)
    fr = np.fft.rfftfreq(n, 1 / SR)
    ir = np.fft.irfft(np.fft.rfft(ir) / (1 + (fr / dark) ** 2), n)
    ir[:int(pre * SR)] = 0
    for k in range(6):              # early reflections: the walls
        at = int((pre * 0.5 + 0.004 + 0.007 * k + rng.uniform(0, 0.006)) * SR)
        if at < n:
            ir[at] += early * (0.8 ** k) * np.sqrt(np.sum(ir ** 2) / n) * 40
    return (ir / np.sqrt(np.sum(ir ** 2))).astype(np.float32)


def room_return(kind):
    return ROOMS.get(kind, ROOMS["hall"])[4]


def mix_stem(stem, x, style, bpm):
    """A stem's chain: EQ, compression, echo. Returns the processed (dry) stem and its send into the room."""
    m = style["mix"].get(stem)
    if not m:
        return x, 0.0
    _level, _pan, eqs, ratio, ech, send = m
    hp, low, mid, presence, air = eqs
    y = eq(x, hp, low, mid, presence, air)
    y = compress(y, ratio)
    if ech:
        beats, fb, wet = ech
        y = echo(y, beats * 60.0 / bpm, fb, wet)
    return y, send


def level_db(style, stem):
    m = style["mix"].get(stem)
    return m[0] if m else -24.0


def pan(style, stem):
    m = style["mix"].get(stem)
    return m[1] if m else 0.0


def arrangement(hymn, secs, seed, resolve):
    """{stem: [(sound, Midi, sf2 path, layer dB)]}. resolve(sound) -> (sf2, bank, program, channel)."""
    band = Band(hymn, secs, seed)
    out = {}
    for stem, layers in band.st["stems"].items():
        out[stem] = []
        for sound, player, opts in layers:
            sf2, bank, prog, channel = resolve(sound)
            out[stem].append((sound, band.part(sound, player, opts, prog, channel, bank), sf2, opts.get("db", 0.0)))
    return out
