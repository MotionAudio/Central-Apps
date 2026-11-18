#!/usr/bin/env python3
"""Central Starter's samples (10.8): one-shots for the Samples browser in Central Production and the Studio, free in every
app, and three free drum kits made from them.

Where they come from (all CC0 1.0 - no conditions, checked in each source's own notes):
  * Sonic Pi's samples (github.com/sonic-pi-net/sonic-pi, etc/samples at SONIC_COMMIT): "from freesound.org and placed in
    the public domain via the Creative Commons 0 License" (its README lists each one's freesound page), and Arovane's,
    also CC0. Drums, electronic hits, hi-hats, tabla, bass hits, guitar, effects and atmospheres.
  * The Versilian Community Sample Library (VCSL, github.com/sgossner/VCSL at tools/sounds-vcsl.py's COMMIT, CC0 1.0):
    hand and orchestral percussion that the paid kits don't use (agogo, anvil, brake drum, darbuka, guiro, slit drum,
    a cymbal swell...).
  * Two made here, by Motion Audio: a hand clap and a rim click (noise and tone, shaped - no one's recording).

Each sample is trimmed (the silence before it goes, a short fade after it), levelled (hits peak at -1 dBFS, long sounds
at -3) and written as 24-bit FLAC. A pitched one says its note, so a drop on an instrument track plays in tune.

    python3 tools/make-samples.py <download cache> <out folder> [--sounds DIR] [--loops DIR] [--list]
Writes <out>/<set>/<file>.flac and <out>/<set>/index.json ([{name, group, file, note?, seconds}]) for each set below,
and, with --sounds, "<sounds>/Central Starter Kits - central-starter-kits.sf2": an Acoustic Kit, an Electronic Kit and
Tabla & Hand Drums, on the General MIDI keys; with --loops, "<loops>/starter-beats/": Sonic Pi's beat loops as WAVs, each
with its tempo, and their index.json (tools/build-libraries.py packs them like tools/make-loops.py's). --list prints what would be made, with no download.
Needs python3-numpy, ffmpeg and the internet (raw.githubusercontent.com). Deterministic: the same files every build
(files already there are kept)."""
import importlib.util
import json
import math
import os
import subprocess
import sys
import urllib.parse

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
_s = importlib.util.spec_from_file_location("sounds_vsco", os.path.join(os.path.dirname(HERE), "sounds-vsco.py"))
V = importlib.util.module_from_spec(_s)
_s.loader.exec_module(V)
_s2 = importlib.util.spec_from_file_location("sounds_vcsl", os.path.join(HERE, "sounds-vcsl.py"))
VC = importlib.util.module_from_spec(_s2)
_s2.loader.exec_module(VC)

SONIC_COMMIT = "a5313655d4fa5c2167de3789bf9bea73259f655e"   # sonic-pi-net/sonic-pi (dev), etc/samples: CC0 1.0
SONIC_RAW = "https://raw.githubusercontent.com/sonic-pi-net/sonic-pi/%s/etc/samples/" % SONIC_COMMIT
KITS_NAME = "Central Starter Kits"
KITS_FILE = "%s - %s.sf2" % (KITS_NAME, KITS_NAME.lower().replace(" ", "-"))
SR_OUT = 48000

# ---------------------------------------------------------------- what's in it
# (source, file, name, group, options) - source "sp" (Sonic Pi), "vcsl" (folder/file in VCSL), "made" (synthesised here)
# options: note (a MIDI note: it's pitched), long (a long sound: -3 dBFS), max (seconds kept), rev (reversed)
S, VS, M = "sp", "vcsl", "made"
ID, ME, AE = "Idiophones/Struck Idiophones/", "Membranophones/Struck Membranophones/", "Aerophones/"
SETS = [
    ("starter-drums", "Drum hits", [
        (S, "bd_808", "808 Kick", "Kicks", {}), (S, "bd_boom", "Boom Kick", "Kicks", {}), (S, "bd_fat", "Fat Kick", "Kicks", {}),
        (S, "bd_haus", "House Kick", "Kicks", {}), (S, "bd_klub", "Club Kick", "Kicks", {}), (S, "bd_pure", "Pure Kick", "Kicks", {}),
        (S, "bd_tek", "Tight Kick", "Kicks", {}), (S, "bd_zum", "Deep Kick", "Kicks", {}), (S, "bd_ada", "Punchy Kick", "Kicks", {}),
        (S, "bd_jazz", "Jazz Kick", "Kicks", {}), (S, "drum_heavy_kick", "Heavy Kick", "Kicks", {}), (S, "drum_bass_hard", "Acoustic Kick", "Kicks", {}),
        (S, "drum_bass_soft", "Acoustic Kick (soft)", "Kicks", {}), (S, "elec_soft_kick", "Soft Electronic Kick", "Kicks", {}),
        (S, "elec_hollow_kick", "Hollow Kick", "Kicks", {}), (VS, ME + "Bass Drum 1/BDrumNew_hit_v7_rr1_Sum.wav", "Concert Bass Drum", "Kicks", {"max": 3.0}),
        (S, "drum_snare_hard", "Acoustic Snare", "Snares", {}), (S, "drum_snare_soft", "Acoustic Snare (soft)", "Snares", {}),
        (S, "sn_generic", "Snare", "Snares", {}), (S, "sn_dub", "Dub Snare", "Snares", {}), (S, "sn_dolf", "Crack Snare", "Snares", {}),
        (S, "sn_zome", "Room Snare", "Snares", {}), (S, "elec_snare", "Electronic Snare", "Snares", {}), (S, "elec_hi_snare", "High Snare", "Snares", {}),
        (S, "elec_mid_snare", "Mid Snare", "Snares", {}), (S, "elec_lo_snare", "Low Snare", "Snares", {}), (S, "elec_filt_snare", "Filtered Snare", "Snares", {}),
        (VS, ME + "Snare Drum, Modern 1/Snare2_HitSN_v5_rr1_Mid.wav", "Concert Snare", "Snares", {}),
        (S, "drum_roll", "Snare Roll", "Snares", {"long": True}),
        (M, "clap", "Hand Clap", "Claps and snaps", {}), (M, "clap_wide", "Big Clap", "Claps and snaps", {}), (M, "rim", "Rim Click", "Claps and snaps", {}),
        (S, "perc_snap", "Finger Snap", "Claps and snaps", {}), (S, "perc_snap2", "Snap", "Claps and snaps", {}),
        (S, "drum_cymbal_closed", "Closed Hat", "Hi-hats", {}), (S, "drum_cymbal_pedal", "Pedal Hat", "Hi-hats", {}), (S, "drum_cymbal_open", "Open Hat", "Hi-hats", {}),
        (S, "hat_cab", "Tight Hat", "Hi-hats", {}), (S, "hat_tap", "Tap Hat", "Hi-hats", {}), (S, "hat_snap", "Snappy Hat", "Hi-hats", {}),
        (S, "hat_metal", "Metal Hat", "Hi-hats", {}), (S, "hat_raw", "Raw Hat", "Hi-hats", {}), (S, "hat_zild", "Bright Hat", "Hi-hats", {}),
        (S, "hat_star", "Shimmer Hat", "Hi-hats", {}), (S, "hat_gem", "Soft Hat", "Hi-hats", {}), (S, "hat_bdu", "Electronic Hat", "Hi-hats", {}),
        (S, "drum_cymbal_hard", "Crash", "Cymbals", {"long": True}), (S, "drum_cymbal_soft", "Crash (soft)", "Cymbals", {"long": True}),
        (S, "drum_splash_hard", "Splash", "Cymbals", {}), (S, "drum_splash_soft", "Splash (soft)", "Cymbals", {}),
        (S, "ride_via", "Ride", "Cymbals", {"long": True}), (S, "ride_tri", "Ride (dark)", "Cymbals", {"long": True}), (S, "elec_cymbal", "Electronic Cymbal", "Cymbals", {}),
        (VS, ID + "Suspended Cymbal 2/susCymb2_hit_bell_f1.wav", "Ride Bell", "Cymbals", {"max": 4.0}),
        (VS, ID + "Clash Cymbals 2/cymbal_crash2_fff1.wav", "Orchestral Crash", "Cymbals", {"long": True, "max": 6.0}),
        (S, "drum_tom_hi_hard", "High Tom", "Toms", {}), (S, "drum_tom_mid_hard", "Mid Tom", "Toms", {}), (S, "drum_tom_lo_hard", "Low Tom", "Toms", {}),
        (S, "drum_tom_hi_soft", "High Tom (soft)", "Toms", {}), (S, "drum_tom_mid_soft", "Mid Tom (soft)", "Toms", {}), (S, "drum_tom_lo_soft", "Low Tom (soft)", "Toms", {}),
        (S, "elec_fuzz_tom", "Fuzz Tom", "Toms", {}),
        (S, "bd_sone", "Round Kick", "Kicks", {}), (S, "bd_zome", "Dusty Kick", "Kicks", {}), (S, "bd_gas", "Thud Kick", "Kicks", {}),
        (S, "bd_chip", "Chip Kick", "Kicks", {}), (S, "bd_mehackit", "Short Kick", "Kicks", {}),
        (S, "hat_gnu", "Crisp Hat", "Hi-hats", {}), (S, "hat_hier", "Ticky Hat", "Hi-hats", {}), (S, "hat_len", "Long Hat", "Hi-hats", {}),
        (S, "hat_psych", "Phased Hat", "Hi-hats", {}), (S, "hat_sci", "Sizzle Hat", "Hi-hats", {}), (S, "hat_zap", "Zap Hat", "Hi-hats", {}),
    ]),
    ("starter-percussion", "Percussion", [
        (S, "drum_cowbell", "Cowbell", "Percussion", {}), (S, "elec_triangle", "Electronic Triangle", "Percussion", {}),
        (S, "elec_wood", "Wood Block", "Percussion", {}), (S, "elec_tick", "Tick", "Percussion", {}), (S, "elec_pop", "Pop", "Percussion", {}),
        (S, "elec_bong", "Bong", "Percussion", {}), (S, "elec_blip", "Blip", "Percussion", {}), (S, "elec_plip", "Plip", "Percussion", {}),
        (VS, ID + "Agogo Bells/Agogo_High_v3_rr1_Mid.wav", "Agogo (high)", "Percussion", {}), (VS, ID + "Agogo Bells/Agogo_Low_v2_rr1_Mid.wav", "Agogo (low)", "Percussion", {}),
        (VS, ID + "Anvil/Anvil_Hit1_v3_rr1_Mid.wav", "Anvil", "Percussion", {"max": 3.0}), (VS, ID + "Brake Drum/BrakeDrum1_Hammer_v3_rr1_Mid.wav", "Brake Drum", "Percussion", {"max": 3.0}),
        (VS, ID + "Guiro/Guiro_Med_rr1_Mid.wav", "Guiro", "Percussion", {}), (VS, ID + "Guiro/Guiro_Hit_rr1_Mid.wav", "Guiro Hit", "Percussion", {}),
        (VS, ID + "Ratchet/Ratchet1_Fast_rr1_Mid.wav", "Ratchet", "Percussion", {}), (VS, ID + "Slapstick/slapstick_rr1.wav", "Slapstick", "Percussion", {}),
        (VS, ID + "Vibraslap/Legacy/vibraslap_rr1.wav", "Vibraslap", "Percussion", {}), (VS, ID + "Flexatone/flexatone_fast.wav", "Flexatone", "Percussion", {}),
        (VS, ID + "Tambourine 2/Tamb2_Hit_v2_rr2_Mid.wav", "Tambourine", "Percussion", {}), (VS, ID + "Tambourine 2/Tamb2_Shake_rr3_Mid.wav", "Tambourine Shake", "Percussion", {}),
        (VS, ID + "Tambourine 2/Tamb2_Roll_v2_rr1_Mid.wav", "Tambourine Roll", "Percussion", {"long": True}),
        (VS, ID + "Triangles/Legacy/2/triangle2_hit_mp.wav", "Triangle", "Percussion", {"max": 5.0}), (VS, ID + "Triangles/Legacy/1/triangle1_roll.wav", "Triangle Roll", "Percussion", {"long": True}),
        (VS, ID + "Finger Cymbals/Fing_Cymb.wav", "Finger Cymbals", "Percussion", {"max": 5.0}),
        (VS, ME + "Darbuka/Darbuka_1_hit_vl2_rr1.wav", "Darbuka (dum)", "World percussion", {}), (VS, ME + "Darbuka/Darbuka_3_hit_vl2_rr1.wav", "Darbuka (tek)", "World percussion", {}),
        (VS, ID + "Slit Drum/LogDrumHi_MedM_v3_rr1_Sum.wav", "Log Drum (high)", "World percussion", {}), (VS, ID + "Slit Drum/LogDrumLo_MedM_v3_rr1_Sum.wav", "Log Drum (low)", "World percussion", {}),
        (S, "tabla_na", "Tabla Na", "World percussion", {}), (S, "tabla_tun1", "Tabla Tun", "World percussion", {}), (S, "tabla_ghe1", "Tabla Ghe", "World percussion", {}),
        (S, "tabla_te1", "Tabla Te", "World percussion", {}), (S, "tabla_ke1", "Tabla Ke", "World percussion", {}), (S, "tabla_dhec", "Tabla Dhec", "World percussion", {}),
        (S, "tabla_tas1", "Tabla Tas", "World percussion", {}), (S, "tabla_re", "Tabla Re", "World percussion", {}),
        (VS, ID + "Hand Bells, Nepalese/HB_2.wav", "Nepalese Bell", "Bells and chimes", {"long": True, "max": 6.0}),
        (VS, ID + "Bell Tree/Stroke/BellTree_Stroke_4_Mid.wav", "Bell Tree", "Bells and chimes", {"long": True}),
        (VS, ID + "Mark Trees/Legacy/windchimes_slowDesc1.wav", "Wind Chimes", "Bells and chimes", {"long": True}),
        (S, "perc_bell", "Bell", "Bells and chimes", {"long": True}), (S, "perc_bell2", "Small Bell", "Bells and chimes", {}),
        (S, "elec_chime", "Chime", "Bells and chimes", {}), (S, "elec_bell", "Electronic Bell", "Bells and chimes", {}), (S, "elec_ping", "Ping", "Bells and chimes", {}),
        (S, "elec_twang", "Twang", "Percussion", {}), (S, "elec_flip", "Flip", "Percussion", {}), (S, "elec_beep", "Beep", "Percussion", {}),
        (S, "elec_blip2", "Blip 2", "Percussion", {}), (S, "elec_twip", "Twip", "Percussion", {}), (S, "elec_blup", "Blup", "Percussion", {}),
        (S, "glitch_perc1", "Glitch 1", "Percussion", {}), (S, "glitch_perc2", "Glitch 2", "Percussion", {}), (S, "glitch_perc3", "Glitch 3", "Percussion", {}),
        (S, "glitch_perc4", "Glitch 4", "Percussion", {}), (S, "glitch_perc5", "Glitch 5", "Percussion", {}), (S, "perc_door", "Door Knock", "Percussion", {}),
        (S, "tabla_ghe2", "Tabla Ghe 2", "World percussion", {}), (S, "tabla_ghe4", "Tabla Ghe 3", "World percussion", {}), (S, "tabla_tas2", "Tabla Tas 2", "World percussion", {}),
        (S, "tabla_te2", "Tabla Te 2", "World percussion", {}), (S, "tabla_te_ne", "Tabla Tene", "World percussion", {}), (S, "tabla_tun2", "Tabla Tun 2", "World percussion", {}),
        (S, "tabla_ke2", "Tabla Ke 2", "World percussion", {}), (S, "tabla_na_o", "Tabla Na (open)", "World percussion", {}), (S, "tabla_na_s", "Tabla Na (short)", "World percussion", {}),
    ]),
    ("starter-sounds", "Sounds and effects", [
        (S, "bass_hit_c", "Bass Hit", "Bass hits", {"note": 24}), (S, "bass_hard_c", "Hard Bass", "Bass hits", {"note": 36}),
        (S, "bass_thick_c", "Thick Bass", "Bass hits", {"note": 36}), (S, "bass_drop_c", "Bass Drop", "Bass hits", {"note": 36}),
        (S, "bass_woodsy_c", "Woody Bass", "Bass hits", {"note": 36}), (S, "bass_voxy_hit_c", "Vocal Bass Hit", "Bass hits", {"note": 36}),
        (S, "bass_trance_c", "Trance Bass", "Bass hits", {"note": 36}),
        (S, "guit_harmonics", "Guitar Harmonics", "Guitar", {"long": True}), (S, "guit_e_fifths", "Guitar Fifths (E)", "Guitar", {"long": True, "note": 52}),
        (S, "guit_em9", "Guitar Em9", "Guitar", {"long": True}), (S, "guit_e_slide", "Guitar Slide (E)", "Guitar", {"long": True}),
        (VS, ID + "Suspended Cymbal 2/susCymb2_cresc_4s.wav", "Cymbal Swell", "Effects", {"long": True, "max": 9.0}),
        (VS, ID + "Suspended Cymbal 2/susCymb2_cresc_4s.wav", "Reverse Cymbal", "Effects", {"long": True, "rev": True}),
        (S, "misc_cineboom", "Cinematic Boom", "Effects", {"long": True}), (S, "perc_impact1", "Impact", "Effects", {"long": True}),
        (S, "perc_impact2", "Impact (dark)", "Effects", {"long": True}), (S, "ambi_swoosh", "Swoosh", "Effects", {"long": True}),
        (S, "ambi_dark_woosh", "Dark Whoosh", "Effects", {"long": True}), (S, "perc_swoosh", "Air Swoosh", "Effects", {"long": True}),
        (S, "perc_swash", "Swash", "Effects", {"long": True}), (S, "vinyl_backspin", "Vinyl Backspin", "Effects", {"long": True}),
        (S, "vinyl_rewind", "Rewind", "Effects", {"long": True}), (S, "vinyl_scratch", "Scratch", "Effects", {}),
        (VS, "Membranophones/Other Membranophones/Ocean Drum/OceanDrum_Sus_2_Mid.wav", "Ocean Drum", "Atmospheres", {"long": True}),
        (S, "ambi_drone", "Drone", "Atmospheres", {"long": True}), (S, "ambi_glass_hum", "Glass Hum", "Atmospheres", {"long": True}),
        (S, "ambi_glass_rub", "Glass Rub", "Atmospheres", {"long": True}), (S, "ambi_lunar_land", "Lunar", "Atmospheres", {"long": True}),
        (S, "ambi_soft_buzz", "Soft Buzz", "Atmospheres", {"long": True}), (S, "ambi_choir", "Choir Breath", "Atmospheres", {"long": True}),
        (S, "ambi_piano", "Ambient Piano", "Atmospheres", {"long": True}), (S, "vinyl_hiss", "Vinyl Hiss", "Atmospheres", {"long": True}),
        (S, "ambi_sauna", "Warm Room", "Atmospheres", {"long": True}),
    ]),
]
# (10.8) loops for the Loops tab: Sonic Pi's (CC0), whole and untouched, each with its tempo (worked out from its length
# and bars) - (file, name, bars, bpm)
LOOPS_SET, LOOPS_NAME = "starter-beats", "Beats and breaks"
LOOPS = [
    ("loop_amen", "Amen Break", 1, 136.9), ("loop_amen_full", "Amen Break (4 bars)", 4, 140.0), ("loop_breakbeat", "Breakbeat", 1, 126.0),
    ("loop_compus", "Compus Beat", 4, 148.0), ("loop_garzul", "Garzul Groove", 4, 120.0), ("loop_mika", "Mika Groove", 4, 120.0),
    ("loop_safari", "Safari Percussion", 4, 119.9), ("loop_tabla", "Tabla Groove", 4, 89.9), ("loop_perc1", "Percussion Loop 1", 1, 97.0),
    ("loop_perc2", "Percussion Loop 2", 1, 97.0), ("loop_electric", "Electric Loop", 1, 97.0), ("loop_mehackit1", "Beat Loop 1", 1, 97.0),
    ("loop_mehackit2", "Beat Loop 2", 1, 97.0), ("arovane_beat_a", "Arovane Beat A", 8, 130.0), ("arovane_beat_b", "Arovane Beat B", 8, 130.0),
    ("arovane_beat_c", "Arovane Beat C", 4, 130.0), ("arovane_beat_d", "Arovane Beat D", 4, 86.7), ("arovane_beat_e", "Arovane Beat E", 4, 86.7),
]
SOURCES = {
    "sp": {"text": "Sonic Pi's samples (from freesound.org, placed in the public domain) - sonic-pi-net/sonic-pi, etc/samples", "license": "CC0 1.0",
           "url": "https://github.com/sonic-pi-net/sonic-pi/tree/%s/etc/samples" % SONIC_COMMIT},
    "vcsl": {"text": "Versilian Community Sample Library (VCSL) - Versilian Studios", "license": "CC0 1.0",
             "url": "https://github.com/sgossner/VCSL/tree/%s" % VC.COMMIT},
    "made": {"text": "Made by Motion Audio (tools/make-samples.py: synthesised, no recording)", "license": "Motion Audio - free, in every app",
             "url": "https://github.com/MotionAudio/central-apps/blob/main/tools/make-samples.py"},
}

# the kits (General MIDI keys): key -> [(sample name, coarse tune)] soft to hard, or a list of names
KITS = [
    ("Acoustic Kit", {
        35: ["Heavy Kick"], 36: ["Acoustic Kick (soft)", "Acoustic Kick"], 37: ["Rim Click"], 38: ["Acoustic Snare (soft)", "Acoustic Snare"],
        39: ["Hand Clap"], 40: ["Snare"], 41: [("Low Tom (soft)", -3), ("Low Tom", -3)], 43: ["Low Tom (soft)", "Low Tom"],
        45: [("Mid Tom (soft)", -2), ("Mid Tom", -2)], 47: ["Mid Tom (soft)", "Mid Tom"], 48: ["High Tom (soft)", "High Tom"], 50: [("High Tom (soft)", 2), ("High Tom", 2)],
        42: ["Closed Hat"], 44: ["Pedal Hat"], 46: ["Open Hat"], 49: ["Crash (soft)", "Crash"], 57: ["Orchestral Crash"], 55: ["Splash (soft)", "Splash"],
        51: ["Ride"], 59: ["Ride (dark)"], 53: ["Ride Bell"], 52: ["Orchestral Crash"], 54: ["Tambourine"], 56: ["Cowbell"], 69: ["Tambourine Shake"],
        81: ["Triangle"], 75: ["Wood Block"],
    }),
    ("Electronic Kit", {
        35: ["Boom Kick"], 36: ["808 Kick"], 37: ["Tick"], 38: ["Dub Snare"], 39: ["Big Clap"], 40: ["High Snare"],
        41: [("Fuzz Tom", -5)], 43: [("Fuzz Tom", -2)], 45: ["Fuzz Tom"], 47: [("Fuzz Tom", 3)], 48: [("Fuzz Tom", 5)], 50: [("Fuzz Tom", 7)],
        42: ["Tight Hat"], 44: ["Tap Hat"], 46: ["Metal Hat"], 49: ["Electronic Cymbal"], 51: ["Shimmer Hat"], 54: ["Snappy Hat"],
        56: ["Bong"], 75: ["Pop"], 76: ["Blip"], 77: ["Plip"], 81: ["Electronic Triangle"],
    }),
    ("Tabla & Hand Drums", {
        60: ["Tabla Na"], 61: ["Tabla Tun"], 62: ["Tabla Te"], 63: ["Tabla Ke"], 64: ["Tabla Ghe"], 65: ["Tabla Dhec"], 66: ["Tabla Tas"], 67: ["Tabla Re"],
        36: ["Darbuka (dum)"], 38: ["Darbuka (tek)"], 47: ["Log Drum (low)"], 48: ["Log Drum (high)"],
    }),
]
CHOKE = {42: 1, 44: 1, 46: 1}   # (the hi-hats cut each other off)


def slug(s):
    return "".join(c if c.isalnum() else "-" for c in s.lower()).strip("-").replace("--", "-")


def file_of(name):
    return slug(name) + ".flac"


# ---------------------------------------------------------------- audio
def decode(path):
    """Any audio file -> (float32 [frames, channels], sample rate), through ffmpeg, at SR_OUT."""
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels", "-of", "csv=p=0", path],
                           capture_output=True, text=True).stdout.strip()
    ch = 2 if probe == "2" else 1
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", str(ch), "-ar", str(SR_OUT), "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, "<f4").astype(np.float32).reshape(-1, ch), SR_OUT


def tidy(x, sr, opts):
    """Trims, fades, levels: hits peak at -1 dBFS, long sounds at -3."""
    if opts.get("rev"):
        x = x[::-1].copy()
    mono = np.max(np.abs(x), axis=1)
    peak = float(mono.max()) or 1.0
    on = np.nonzero(mono > peak * 10 ** (-48 / 20))[0]
    start = max(0, int(on[0]) - int(0.001 * sr)) if len(on) else 0
    loud = np.nonzero(mono > peak * 10 ** (-60 / 20))[0]
    end = int(loud[-1]) + int(0.02 * sr) if len(loud) else len(x)
    if opts.get("max"):
        end = min(end, start + int(opts["max"] * sr))
    if opts.get("rev"):   # (a reverse swell ends on its loudest point, the hit it grows into)
        end = int(np.argmax(mono)) + int(0.004 * sr)
        start = max(0, end - int(6.0 * sr))
    y = x[start:min(end, len(x))].copy()
    f = min(len(y) // 4, int((0.25 if opts.get("long") else 0.03) * sr))
    if f > 1 and not opts.get("rev"):
        y[-f:] *= np.linspace(1, 0, f, dtype=np.float32)[:, None] ** 2
    if opts.get("rev"):
        g = min(len(y) // 4, int(0.05 * sr))
        y[:g] *= np.linspace(0, 1, g, dtype=np.float32)[:, None]
    target = 10 ** ((-3 if opts.get("long") else -1) / 20)
    p = float(np.max(np.abs(y))) or 1.0
    return (y * (target / p)).astype(np.float32)


def write_flac(path, y, sr):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(sr), "-ac", str(y.shape[1]), "-i", "-", "-c:a", "flac", "-sample_fmt", "s32",
                    "-bits_per_raw_sample", "24", "-compression_level", "8", "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact", path + ".part.flac"],
                   input=y.astype("<f4").tobytes(), check=True)
    os.replace(path + ".part.flac", path)


def made(name, sr=SR_OUT):
    """The two sounds made here: a hand clap (three quick bursts of band-passed noise and a short room) and a rim click."""
    rng = np.random.default_rng(7 if name == "clap" else 11 if name == "clap_wide" else 3)
    if name.startswith("clap"):
        n = int(0.6 * sr)
        noise = rng.standard_normal(n).astype(np.float32)
        y = np.zeros(n, np.float32)
        t = np.arange(n) / sr
        bursts = (0.0, 0.011, 0.023) if name == "clap" else (0.0, 0.009, 0.019, 0.031)
        for i, b in enumerate(bursts):
            k = int(b * sr)
            e = np.exp(-(t[:n - k]) / 0.006)
            y[k:] += noise[:n - k] * e * (0.8 + 0.1 * i)
        k = int(bursts[-1] * sr)
        y[k:] += noise[:n - k] * np.exp(-t[:n - k] / (0.09 if name == "clap" else 0.16)) * 0.55
        y = band(y, sr, 900, 3, 2) + 0.35 * band(y, sr, 2600, 2, 2)
        if name == "clap_wide":   # (wide: the right side a moment later)
            d = int(0.004 * sr)
            return np.stack([y, np.concatenate([np.zeros(d, np.float32), y[:-d]])], axis=1), sr
        return y[:, None], sr
    n = int(0.25 * sr)   # rim click
    t = np.arange(n) / sr
    tone = 0.6 * np.sin(2 * math.pi * 1720 * t) * np.exp(-t / 0.012) + 0.45 * np.sin(2 * math.pi * 455 * t) * np.exp(-t / 0.03)
    click = rng.standard_normal(n) * np.exp(-t / 0.004) * 0.7
    return (tone + band(click.astype(np.float32), sr, 3500, 1.5, 1)).astype(np.float32)[:, None], sr


def band(x, sr, fc, q, passes):
    """A band-pass (RBJ biquad), run `passes` times."""
    w = 2 * math.pi * fc / sr
    al = math.sin(w) / (2 * q)
    b0, b2, a0, a1, a2 = al, -al, 1 + al, -2 * math.cos(w), 1 - al
    y = x.astype(np.float64)
    for _ in range(passes):
        out = np.zeros_like(y)
        x1 = x2 = y1 = y2 = 0.0
        for i in range(len(y)):
            v = (b0 * y[i] + b2 * x2 - a1 * y1 - a2 * y2) / a0
            x2, x1, y2, y1 = x1, y[i], y1, v
            out[i] = v
        y = out
    return y.astype(np.float32)


def fetch(cache, src, rel):
    if src == "sp":
        return V.fetch(SONIC_RAW + rel + ".flac", os.path.join(cache, "sonic-pi", rel + ".flac"))
    rel = os.path.normpath(rel).replace(os.sep, "/")
    return V.fetch(VC.RAW + urllib.parse.quote(rel), os.path.join(cache, "vcsl-hits", rel))


# ---------------------------------------------------------------- building
def build_loops(cache, loops_dir, log=print):
    """The loops, as 24-bit WAVs at their own rate (the length exact, so they loop), and <loops>/<set>/index.json."""
    d = os.path.join(loops_dir, LOOPS_SET)
    os.makedirs(d, exist_ok=True)
    index = []
    for rel, name, bars, bpm in LOOPS:
        f = os.path.join(d, file_of(name).replace(".flac", ".wav"))
        src = fetch(cache, "sp", rel)
        if not os.path.isfile(f):
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-c:a", "pcm_s24le", "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact", f + ".part.wav"], check=True)
            os.replace(f + ".part.wav", f)
        secs = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], capture_output=True, text=True).stdout.strip() or 0)
        exact = round(bars * 240.0 / secs, 2) if secs else bpm   # (its tempo to the hundredth, from its own length)
        if abs(exact - bpm) > bpm * 0.01:
            raise RuntimeError("%s: %g BPM from its length, not about %g - check its bars" % (name, exact, bpm))
        index.append({"name": name, "file": os.path.basename(f), "bpm": exact, "meter": 4, "bars": bars, "seconds": round(secs, 3)})
    with open(os.path.join(d, "index.json"), "w", encoding="utf-8") as h:
        json.dump(index, h, indent=1)
    log("  %s: %d loops" % (LOOPS_NAME, len(index)))


def build(cache, out, sounds=None, log=print, loops=None):
    if loops:
        build_loops(cache, loops, log)
    pcm = {}
    for set_id, set_name, items in SETS:
        index = []
        for src, rel, name, group, opts in items:
            f = os.path.join(out, set_id, file_of(name))
            if src == M:
                x, sr = made(rel)
            else:
                x, sr = decode(fetch(cache, src, rel))
            y = tidy(x, sr, opts)
            if not os.path.isfile(f):
                write_flac(f, y, sr)
            pcm[name] = (y, sr)
            e = {"name": name, "group": group, "file": file_of(name), "seconds": round(len(y) / sr, 2)}
            if opts.get("note") is not None:
                e["note"] = opts["note"]
            index.append(e)
        with open(os.path.join(out, set_id, "index.json"), "w", encoding="utf-8") as h:
            json.dump(index, h, indent=1)
        log("  %s: %d samples, %.1f MB" % (set_name, len(index), sum(os.path.getsize(os.path.join(out, set_id, e["file"])) for e in index) / 1e6))
    if sounds:
        build_kits(pcm, sounds, log)


def build_kits(pcm, sounds, log=print):
    """The three kits as one SoundFont: each hit mono, its layers soft to hard across the velocity range."""
    os.makedirs(sounds, exist_ok=True)
    path = os.path.join(sounds, KITS_FILE)
    if os.path.isfile(path):
        return path
    V.GEN.setdefault("exclusiveClass", 57)
    samples, instruments, presets, ids = [], [], [], {}
    for prog, (kit, keys) in enumerate(KITS):
        zones = []
        for key, layers in sorted(keys.items()):
            ranges = VC.vel_ranges(len(layers))
            for li, layer in enumerate(layers):
                name, tune = (layer, 0) if isinstance(layer, str) else layer
                if name not in ids:
                    y, sr = pcm[name]
                    m = y.mean(axis=1) if y.shape[1] > 1 else y[:, 0]
                    m = m[:int(4.0 * sr)] * 0.9
                    samples.append({"name": slug(name)[:19], "pcm": np.clip(np.round(m * 32767), -32768, 32767).astype("<i2"), "sr": sr, "root": 60, "s": None, "e": None})
                    ids[name] = len(samples) - 1
                z = [("keyRange", (key, key)), ("velRange", ranges[li]), ("attackVolEnv", V.tc(0.001)), ("releaseVolEnv", V.tc(0.6))]
                if key in CHOKE and not kit.startswith("Tabla"):
                    z.append(("exclusiveClass", CHOKE[key]))
                z += [("overridingRootKey", key - tune), ("sampleID", ids[name])]
                zones.append(z)
        instruments.append({"name": slug(kit)[:19], "zones": zones})
        presets.append({"name": kit, "prog": prog, "zones": [[("keyRange", (0, 127)), ("instrument", prog)]]})
    V.write_sf2(path, KITS_NAME, samples, instruments, presets, copyright="CC0 1.0 - Sonic Pi's samples (freesound, public domain) and VCSL (Versilian Studios)",
                comment="Built for Central from CC0 drum and percussion samples (tools/make-samples.py), mono.")
    log("  -> %s (%.1f MB, %d samples)" % (KITS_FILE, os.path.getsize(path) / 1e6, len(samples)))
    return path


def names():
    """{set id: [sample names]} - what each set will hold, before anything is made (tools/build-libraries.py's lists)."""
    return {sid: [it[2] for it in items] for sid, _n, items in SETS}


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    if "--list" in argv:
        for sid, sname, items in SETS:
            print("%s (%s): %d" % (sname, sid, len(items)))
            for it in items:
                print("    %-22s %-18s %s" % (it[2], it[3], it[0] + ":" + it[1]))
        print("%s: %s" % (KITS_NAME, ", ".join(k[0] for k in KITS)))
        print("%s (%s): %s" % (LOOPS_NAME, LOOPS_SET, ", ".join("%s %g BPM" % (l[1], l[3]) for l in LOOPS)))
        return 0
    if len(args) < 2:
        print(__doc__)
        return 2
    sounds = loops = None
    if "--sounds" in argv:
        sounds = argv[argv.index("--sounds") + 1]
        args = [a for a in args if a != sounds]
    if "--loops" in argv:
        loops = argv[argv.index("--loops") + 1]
        args = [a for a in args if a != loops]
    print("Central Starter samples (Sonic Pi and VCSL, CC0; two made here) -> " + args[1])
    build(args[0], args[1], sounds, loops=loops)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
