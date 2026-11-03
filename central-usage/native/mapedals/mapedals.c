/* Central Pedals (10.3): the DSP of Motion Audio's own pedals. See mapedals.h.
 * One table (DEFS) names every pedal, its knobs and which DSP it runs; mp_run does the work.
 * Real-time rules: buffers are taken in mp_new; mp_run never allocates, waits or calls the OS. */
#include "mapedals.h"
#include <math.h>
#include <stdlib.h>
#include <string.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif
#define DN 1e-18f   /* keeps feedback paths out of denormals */

enum { K_DRIVE, K_AMP, K_COMP, K_BASSPRE, K_ACPRE, K_ACSIM, K_CHORUS, K_FLANGER, K_PHASER, K_ROTARY, K_TREM, K_RING,
       K_OCTUP, K_OCTDOWN, K_PITCH, K_FILTER, K_DELAY, K_REVDELAY, K_VERB, K_SPRING, K_VOLUME, K_GEQ, K_PEQ, K_GATE,
       K_BOOST, K_MUTE };

/* ------------------------------------------------------------------ the pedals */
#define C(s, n, a, b, d) { s, n, a, b, d, 0, "" }
#define CU(s, n, a, b, d, u) { s, n, a, b, d, 0, u }
#define CI(s, n, a, b, d) { s, n, a, b, d, 1, "" }
static const MpDef DEFS[] = {
  /* ---- drive (voice: the DRIVES table below) */
  { "ma_clear_drive", "Clear Drive", "boost", K_DRIVE, 0, 3, { C("drive", "Drive", 0, 1, 0.4f), C("tone", "Tone", 0, 1, 0.55f), C("level", "Level", 0, 1, 0.55f) } },
  { "ma_mid_drive", "Mid Hump Drive", "boost", K_DRIVE, 1, 3, { C("drive", "Drive", 0, 1, 0.5f), C("tone", "Tone", 0, 1, 0.5f), C("level", "Level", 0, 1, 0.55f) } },
  { "ma_blues_drive", "Low-Gain Blues", "boost", K_DRIVE, 2, 3, { C("drive", "Drive", 0, 1, 0.35f), C("tone", "Tone", 0, 1, 0.5f), C("level", "Level", 0, 1, 0.55f) } },
  { "ma_gold_drive", "Gold Horse Drive", "boost", K_DRIVE, 3, 3, { C("drive", "Gain", 0, 1, 0.35f), C("tone", "Treble", 0, 1, 0.55f), C("level", "Output", 0, 1, 0.55f) } },
  { "ma_brit_dist", "British Distortion", "dist", K_DRIVE, 4, 3, { C("drive", "Distortion", 0, 1, 0.55f), C("tone", "Tone", 0, 1, 0.5f), C("level", "Level", 0, 1, 0.5f) } },
  { "ma_hg_dist", "High-Gain Distortion", "dist", K_DRIVE, 5, 4, { C("drive", "Gain", 0, 1, 0.65f), C("tone", "Tone", 0, 1, 0.5f), C("mid", "Mids", 0, 1, 0.35f), C("level", "Level", 0, 1, 0.45f) } },
  { "ma_ge_fuzz", "Germanium Fuzz", "fuzz", K_DRIVE, 6, 4, { C("drive", "Fuzz", 0, 1, 0.7f), C("tone", "Tone", 0, 1, 0.5f), C("bias", "Bias", 0, 1, 0.5f), C("level", "Volume", 0, 1, 0.5f) } },
  { "ma_si_fuzz", "Silicon Fuzz", "fuzz", K_DRIVE, 7, 3, { C("drive", "Fuzz", 0, 1, 0.7f), C("tone", "Tone", 0, 1, 0.5f), C("level", "Volume", 0, 1, 0.45f) } },
  { "ma_oct_fuzz", "Octave Fuzz", "fuzz", K_DRIVE, 8, 4, { C("drive", "Fuzz", 0, 1, 0.7f), C("octave", "Octave", 0, 1, 0.7f), C("tone", "Tone", 0, 1, 0.5f), C("level", "Volume", 0, 1, 0.45f) } },
  { "ma_bass_drive", "Bass Drive", "boost", K_DRIVE, 9, 4, { C("drive", "Drive", 0, 1, 0.5f), C("blend", "Blend", 0, 1, 0.6f), C("tone", "Tone", 0, 1, 0.5f), C("level", "Level", 0, 1, 0.55f) } },
  { "ma_boost", "Clean Boost", "boost", K_BOOST, 0, 3, { CU("gain", "Boost", 0, 20, 8, "dB"), CU("bass", "Bass", -6, 6, 0, "dB"), CU("treble", "Treble", -6, 6, 0, "dB") } },
  /* ---- amps (voice: AMPS) */
  { "ma_amp_clean", "American Clean Amp", "amp", K_AMP, 0, 7, { C("gain", "Gain", 0, 1, 0.3f), C("bass", "Bass", 0, 1, 0.5f), C("mid", "Middle", 0, 1, 0.45f), C("treble", "Treble", 0, 1, 0.6f), C("presence", "Bright", 0, 1, 0.5f), C("master", "Master", 0, 1, 0.5f), CI("cab", "Cabinet", 0, 1, 1) } },
  { "ma_amp_crunch", "British Crunch Amp", "amp", K_AMP, 1, 7, { C("gain", "Gain", 0, 1, 0.55f), C("bass", "Bass", 0, 1, 0.5f), C("mid", "Middle", 0, 1, 0.6f), C("treble", "Treble", 0, 1, 0.55f), C("presence", "Presence", 0, 1, 0.5f), C("master", "Master", 0, 1, 0.5f), CI("cab", "Cabinet", 0, 1, 1) } },
  { "ma_amp_hg", "High-Gain Amp", "amp", K_AMP, 2, 7, { C("gain", "Gain", 0, 1, 0.65f), C("bass", "Bass", 0, 1, 0.55f), C("mid", "Middle", 0, 1, 0.4f), C("treble", "Treble", 0, 1, 0.55f), C("presence", "Presence", 0, 1, 0.55f), C("master", "Master", 0, 1, 0.45f), CI("cab", "Cabinet", 0, 1, 1) } },
  { "ma_amp_bass", "Bass Amp", "amp", K_AMP, 3, 7, { C("gain", "Gain", 0, 1, 0.3f), C("bass", "Bass", 0, 1, 0.55f), C("mid", "Middle", 0, 1, 0.5f), C("treble", "Treble", 0, 1, 0.45f), C("presence", "Growl", 0, 1, 0.3f), C("master", "Master", 0, 1, 0.5f), CI("cab", "Cabinet", 0, 1, 1) } },
  /* ---- compressors */
  { "ma_studio_comp", "Clean VCA Compressor", "comp", K_COMP, 0, 6, { CU("threshold", "Threshold", -50, 0, -20, "dB"), C("ratio", "Ratio", 1, 20, 4), CU("attack", "Attack", 0.1f, 100, 10, "ms"), CU("release", "Release", 20, 1000, 150, "ms"), CU("makeup", "Makeup", 0, 24, 4, "dB"), C("blend", "Blend", 0, 1, 1) } },
  { "ma_opto_comp", "Optical Compressor", "comp", K_COMP, 1, 3, { C("peak", "Peak reduction", 0, 1, 0.45f), CU("gain", "Gain", 0, 24, 6, "dB"), C("blend", "Blend", 0, 1, 1) } },
  { "ma_squash_comp", "Squash Compressor", "comp", K_COMP, 2, 3, { C("sens", "Sensitivity", 0, 1, 0.5f), C("level", "Output", 0, 1, 0.5f), C("blend", "Blend", 0, 1, 1) } },
  { "ma_bass_pre", "Bass Preamp", "amp", K_BASSPRE, 0, 6, { C("drive", "Drive", 0, 1, 0.2f), CU("bass", "Bass", -12, 12, 3, "dB"), CU("lowmid", "Low mid", -12, 12, -2, "dB"), CU("highmid", "High mid", -12, 12, 2, "dB"), CU("treble", "Treble", -12, 12, 1, "dB"), C("level", "Level", 0, 1, 0.55f) } },
  /* ---- acoustic */
  { "ma_ac_pre", "Acoustic Preamp", "acoustic", K_ACPRE, 0, 7, { CU("bass", "Bass", -12, 12, 0, "dB"), CU("mid", "Middle", -12, 12, -2, "dB"), CU("midfreq", "Mid freq", 200, 4000, 800, "Hz"), CU("treble", "Treble", -12, 12, 2, "dB"), CU("notch", "Notch", 60, 400, 120, "Hz"), C("notchon", "Notch depth", 0, 1, 0), C("level", "Level", 0, 1, 0.5f) } },
  { "ma_ac_sim", "Acoustic Body (piezo to mic)", "acoustic", K_ACSIM, 0, 4, { C("body", "Body", 0, 1, 0.6f), C("top", "Top", 0, 1, 0.55f), C("mix", "Mix", 0, 1, 1), C("level", "Level", 0, 1, 0.5f) } },
  /* ---- modulation */
  { "ma_chorus", "Dimension Chorus", "mod", K_CHORUS, 0, 4, { CU("rate", "Rate", 0.05f, 5, 0.6f, "Hz"), C("depth", "Depth", 0, 1, 0.5f), C("tone", "Tone", 0, 1, 0.6f), C("mix", "Mix", 0, 1, 0.5f) } },
  { "ma_tri_chorus", "Tri Chorus", "mod", K_CHORUS, 1, 4, { CU("rate", "Rate", 0.05f, 5, 0.9f, "Hz"), C("depth", "Depth", 0, 1, 0.6f), C("tone", "Tone", 0, 1, 0.55f), C("mix", "Mix", 0, 1, 0.5f) } },
  { "ma_flanger", "Regen Flanger", "mod", K_FLANGER, 0, 5, { CU("rate", "Rate", 0.02f, 5, 0.25f, "Hz"), C("depth", "Depth", 0, 1, 0.7f), C("manual", "Manual", 0, 1, 0.4f), C("feedback", "Regen", -0.95f, 0.95f, 0.6f), C("mix", "Mix", 0, 1, 0.5f) } },
  { "ma_phaser", "Four-Stage Phaser", "mod", K_PHASER, 0, 4, { CU("rate", "Speed", 0.05f, 8, 0.5f, "Hz"), C("depth", "Depth", 0, 1, 0.8f), C("feedback", "Feedback", 0, 0.9f, 0.3f), C("mix", "Mix", 0, 1, 0.5f) } },
  { "ma_vibe", "Uni Vibe", "mod", K_PHASER, 1, 4, { CU("rate", "Speed", 0.1f, 10, 1.2f, "Hz"), C("depth", "Intensity", 0, 1, 0.75f), CI("mode", "Vibrato", 0, 1, 0), C("level", "Volume", 0, 1, 0.5f) } },
  { "ma_rotary", "Rotary Cabinet", "mod", K_ROTARY, 0, 4, { CI("fast", "Fast", 0, 1, 0), C("drive", "Drive", 0, 1, 0.25f), C("balance", "Horn / drum", 0, 1, 0.6f), C("mix", "Mix", 0, 1, 1) } },
  { "ma_harm_trem", "Harmonic Tremolo", "trem", K_TREM, 0, 4, { CU("rate", "Speed", 0.3f, 12, 4, "Hz"), C("depth", "Intensity", 0, 1, 0.7f), CU("xover", "Split", 200, 2000, 700, "Hz"), C("level", "Volume", 0, 1, 0.5f) } },
  { "ma_square_trem", "Square Tremolo", "trem", K_TREM, 1, 4, { CU("rate", "Speed", 0.3f, 15, 5, "Hz"), C("depth", "Depth", 0, 1, 0.8f), C("shape", "Shape", 0, 1, 0.8f), C("level", "Volume", 0, 1, 0.5f) } },
  { "ma_ring", "Wobble Ring Modulator", "mod", K_RING, 0, 4, { CU("freq", "Frequency", 20, 2000, 300, "Hz"), C("lfo", "Wobble", 0, 1, 0), C("tone", "Tone", 0, 1, 0.6f), C("mix", "Mix", 0, 1, 0.6f) } },
  /* ---- pitch and filters */
  { "ma_octave_up", "Octave Up", "pitch", K_OCTUP, 0, 3, { C("octave", "Octave", 0, 1, 0.7f), C("dry", "Dry", 0, 1, 0.7f), C("tone", "Tone", 0, 1, 0.5f) } },
  { "ma_octave_down", "Sub Octave", "pitch", K_OCTDOWN, 0, 4, { C("oct1", "Octave 1", 0, 1, 0.7f), C("oct2", "Octave 2", 0, 1, 0), C("dry", "Dry", 0, 1, 0.7f), C("tone", "Tone", 0, 1, 0.45f) } },
  { "ma_harmonizer", "Harmonizer", "pitch", K_PITCH, 0, 3, { CU("interval", "Interval", -12, 12, 7, "st"), CU("detune", "Detune", -50, 50, 0, "ct"), C("mix", "Mix", 0, 1, 0.5f) } },
  { "ma_whammy", "Whammy", "pitch", K_PITCH, 1, 3, { C("position", "Position", 0, 1, 0), CU("range", "Range", -24, 24, 12, "st"), C("mix", "Mix", 0, 1, 1) } },
  { "ma_env_filter", "Quack Envelope Filter", "wah", K_FILTER, 0, 5, { C("sens", "Sensitivity", 0, 1, 0.6f), C("range", "Range", 0, 1, 0.7f), C("res", "Resonance", 0, 1, 0.6f), CI("mode", "Mode", 0, 2, 1), C("mix", "Mix", 0, 1, 1) } },
  { "ma_autowah", "Rhythm Auto Wah", "wah", K_FILTER, 1, 4, { CU("rate", "Rate", 0.1f, 8, 1.5f, "Hz"), C("depth", "Depth", 0, 1, 0.8f), C("res", "Resonance", 0, 1, 0.6f), C("mix", "Mix", 0, 1, 1) } },
  { "ma_wah", "Wah Pedal", "wah", K_FILTER, 2, 3, { C("position", "Position", 0, 1, 0.5f), C("res", "Resonance", 0, 1, 0.6f), C("level", "Level", 0, 1, 0.5f) } },
  { "ma_synth_filter", "Fuzz Synth Filter", "wah", K_FILTER, 3, 5, { C("sens", "Sensitivity", 0, 1, 0.6f), CU("decay", "Decay", 20, 1500, 300, "ms"), C("res", "Resonance", 0, 1, 0.7f), C("fuzz", "Fuzz", 0, 1, 0.8f), C("mix", "Mix", 0, 1, 1) } },
  /* ---- delays */
  { "ma_analog_delay", "Analog Delay", "delay", K_DELAY, 0, 5, { CU("time", "Time", 20, 600, 330, "ms"), C("feedback", "Repeats", 0, 0.95f, 0.45f), C("mix", "Mix", 0, 1, 0.35f), C("mod", "Modulation", 0, 1, 0.3f), C("tone", "Tone", 0, 1, 0.4f) } },
  { "ma_tape_delay", "Tape Echo", "delay", K_DELAY, 1, 5, { CU("time", "Time", 50, 1000, 380, "ms"), C("feedback", "Repeats", 0, 1.05f, 0.45f), C("mix", "Mix", 0, 1, 0.35f), C("mod", "Wow & flutter", 0, 1, 0.35f), C("tone", "Tone", 0, 1, 0.45f) } },
  { "ma_digital_delay", "Clean Digital Delay", "delay", K_DELAY, 2, 5, { CU("time", "Time", 1, 2000, 400, "ms"), C("feedback", "Feedback", 0, 0.95f, 0.35f), C("mix", "Mix", 0, 1, 0.3f), CU("lowcut", "Low cut", 20, 1000, 80, "Hz"), C("tone", "High cut", 0, 1, 0.8f) } },
  { "ma_dotted_delay", "Dotted Eighth Delay", "delay", K_DELAY, 3, 5, { CU("bpm", "Tempo", 50, 200, 72, "bpm"), C("feedback", "Repeats", 0, 0.95f, 0.4f), C("mix", "Mix", 0, 1, 0.35f), C("mod", "Modulation", 0, 1, 0.2f), C("tone", "Tone", 0, 1, 0.6f) } },
  { "ma_multihead", "Multi-Head Echo", "delay", K_DELAY, 4, 5, { CU("time", "Repeat rate", 50, 600, 200, "ms"), CI("heads", "Heads", 1, 7, 7), C("feedback", "Intensity", 0, 0.95f, 0.45f), C("mix", "Echo level", 0, 1, 0.35f), C("tone", "Tone", 0, 1, 0.45f) } },
  { "ma_reverse_delay", "Backwards Delay", "delay", K_REVDELAY, 0, 3, { CU("time", "Time", 100, 1500, 600, "ms"), C("feedback", "Feedback", 0, 0.9f, 0.3f), C("mix", "Mix", 0, 1, 0.5f) } },
  /* ---- reverbs (voice: plate, hall, shimmer, swell, freeze) */
  { "ma_spring", "Spring Reverb", "reverb", K_SPRING, 0, 4, { C("dwell", "Dwell", 0, 1, 0.5f), C("decay", "Decay", 0, 1, 0.5f), C("tone", "Tone", 0, 1, 0.5f), C("mix", "Mix", 0, 1, 0.3f) } },
  { "ma_plate", "Studio Plate", "reverb", K_VERB, 0, 4, { CU("decay", "Decay", 0.3f, 6, 1.8f, "s"), CU("predelay", "Pre-delay", 0, 100, 10, "ms"), C("tone", "Tone", 0, 1, 0.65f), C("mix", "Mix", 0, 1, 0.25f) } },
  { "ma_hall", "Hall Reverb", "reverb", K_VERB, 1, 4, { CU("decay", "Decay", 0.5f, 12, 3.2f, "s"), CU("predelay", "Pre-delay", 0, 150, 25, "ms"), C("tone", "Tone", 0, 1, 0.5f), C("mix", "Mix", 0, 1, 0.3f) } },
  { "ma_shimmer", "Octave Shimmer", "reverb", K_VERB, 2, 4, { CU("decay", "Decay", 1, 20, 6, "s"), C("shimmer", "Shimmer", 0, 1, 0.5f), C("tone", "Tone", 0, 1, 0.55f), C("mix", "Mix", 0, 1, 0.4f) } },
  { "ma_swell_verb", "Auto-Swell Reverb", "reverb", K_VERB, 3, 4, { CU("swell", "Swell", 50, 2000, 500, "ms"), CU("decay", "Decay", 1, 20, 7, "s"), C("tone", "Tone", 0, 1, 0.5f), C("mix", "Mix", 0, 1, 0.5f) } },
  { "ma_freeze", "Freeze Sustainer", "reverb", K_VERB, 4, 4, { CI("freeze", "Freeze", 0, 1, 0), CU("decay", "Decay", 1, 20, 5, "s"), C("tone", "Tone", 0, 1, 0.5f), C("mix", "Mix", 0, 1, 0.5f) } },
  /* ---- utility */
  { "ma_volume", "Volume and Swell Pedal", "util", K_VOLUME, 0, 2, { C("volume", "Volume", 0, 1, 1), C("min", "Minimum", 0, 1, 0) } },
  { "ma_geq7", "7-Band Graphic EQ", "eq", K_GEQ, 0, 8, { CU("b100", "100", -15, 15, 0, "dB"), CU("b200", "200", -15, 15, 0, "dB"), CU("b400", "400", -15, 15, 0, "dB"), CU("b800", "800", -15, 15, 0, "dB"), CU("b1k6", "1.6k", -15, 15, 0, "dB"), CU("b3k2", "3.2k", -15, 15, 0, "dB"), CU("b6k4", "6.4k", -15, 15, 0, "dB"), CU("level", "Level", -15, 15, 0, "dB") } },
  { "ma_peq", "Parametric EQ", "eq", K_PEQ, 0, 7, { CU("lowcut", "Low cut", 20, 400, 40, "Hz"), CU("low", "Low", -15, 15, 0, "dB"), CU("midfreq", "Mid freq", 150, 6000, 800, "Hz"), CU("mid", "Mid", -15, 15, 0, "dB"), C("q", "Mid width (Q)", 0.3f, 8, 1), CU("high", "High", -15, 15, 0, "dB"), CU("level", "Level", -15, 15, 0, "dB") } },
  { "ma_gate", "Noise Gate", "comp", K_GATE, 0, 3, { CU("threshold", "Threshold", -90, -10, -55, "dB"), CU("release", "Release", 5, 500, 80, "ms"), CU("range", "Range", -90, 0, -80, "dB") } },
  { "ma_mute", "Tuner Mute", "util", K_MUTE, 0, 1, { CI("mute", "Mute", 0, 1, 1) } },
};
#define NDEFS ((int)(sizeof DEFS / sizeof DEFS[0]))

int mp_count(void) { return NDEFS; }
const MpDef *mp_def(int i) { return i >= 0 && i < NDEFS ? &DEFS[i] : NULL; }
const MpDef *mp_find(const char *id) { if (!id) return NULL; for (int i = 0; i < NDEFS; i++) if (!strcmp(DEFS[i].id, id)) return &DEFS[i]; return NULL; }
int mp_ctl_index(const MpDef *d, const char *sym) { if (!d || !sym) return -1; for (int k = 0; k < d->nctl; k++) if (!strcmp(d->ctl[k].sym, sym)) return k; return -1; }

/* ------------------------------------------------------------------ building blocks */
typedef struct { float b0, b1, b2, a1, a2, z1, z2; } Bq;
enum { LP, HP, BP, PK, LS, HS, AP, NOTCH };
static void bq_set(Bq *f, int t, double fs, double fc, double db, double q) {
  if (fc > fs * 0.45) fc = fs * 0.45; if (fc < 5) fc = 5; if (q < 0.05) q = 0.05;
  double A = pow(10, db / 40), w = 2 * M_PI * fc / fs, c = cos(w), s = sin(w), al = s / (2 * q), b0, b1, b2, a0, a1, a2;
  switch (t) {
    case LP: b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; break;
    case HP: b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; break;
    case BP: b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; break;
    case NOTCH: b0 = 1; b1 = -2 * c; b2 = 1; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; break;
    case AP: b0 = 1 - al; b1 = -2 * c; b2 = 1 + al; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; break;
    case PK: b0 = 1 + al * A; b1 = -2 * c; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * c; a2 = 1 - al / A; break;
    case LS: { double sq = 2 * sqrt(A) * al; b0 = A * ((A + 1) - (A - 1) * c + sq); b1 = 2 * A * ((A - 1) - (A + 1) * c); b2 = A * ((A + 1) - (A - 1) * c - sq);
               a0 = (A + 1) + (A - 1) * c + sq; a1 = -2 * ((A - 1) + (A + 1) * c); a2 = (A + 1) + (A - 1) * c - sq; break; }
    default: { double sq = 2 * sqrt(A) * al; b0 = A * ((A + 1) + (A - 1) * c + sq); b1 = -2 * A * ((A - 1) + (A + 1) * c); b2 = A * ((A + 1) + (A - 1) * c - sq);
               a0 = (A + 1) - (A - 1) * c + sq; a1 = 2 * ((A - 1) - (A + 1) * c); a2 = (A + 1) - (A - 1) * c - sq; break; }
  }
  f->b0 = (float)(b0 / a0); f->b1 = (float)(b1 / a0); f->b2 = (float)(b2 / a0); f->a1 = (float)(a1 / a0); f->a2 = (float)(a2 / a0);
}
static inline float bq(Bq *f, float x) { float y = f->b0 * x + f->z1; f->z1 = f->b1 * x - f->a1 * y + f->z2; f->z2 = f->b2 * x - f->a2 * y; return y; }
static void bq_clear(Bq *f) { f->z1 = f->z2 = 0; }

typedef struct { float *d; int mask, w; } Dl;
static int dl_init(Dl *l, int maxLen) { int n = 1; while (n < maxLen + 4) n <<= 1; l->d = calloc((size_t)n, sizeof(float)); l->mask = n - 1; l->w = 0; return l->d != NULL; }
static inline void dl_put(Dl *l, float x) { l->d[l->w] = x; l->w = (l->w + 1) & l->mask; }
static inline float dl_at(const Dl *l, int back) { return l->d[(l->w - 1 - back) & l->mask]; }   /* back = 0: the newest sample */
static inline float dl_frac(const Dl *l, float back) {   /* fractional delay, linear */
  if (back < 0) back = 0; if (back > (float)(l->mask - 2)) back = (float)(l->mask - 2);
  int i = (int)back; float f = back - (float)i; return dl_at(l, i) * (1 - f) + dl_at(l, i + 1) * f;
}
static inline float dl_cubic(const Dl *l, float back) {   /* fractional delay, 4-point (pitch shift and chorus) */
  if (back < 1) back = 1; if (back > (float)(l->mask - 3)) back = (float)(l->mask - 3);
  int i = (int)back; float f = back - (float)i, y0 = dl_at(l, i - 1), y1 = dl_at(l, i), y2 = dl_at(l, i + 1), y3 = dl_at(l, i + 2);
  float c1 = 0.5f * (y2 - y0), c2 = y0 - 2.5f * y1 + 2 * y2 - 0.5f * y3, c3 = 0.5f * (y3 - y0) + 1.5f * (y1 - y2);
  return ((c3 * f + c2) * f + c1) * f + y1;
}

static inline float sat(float x) { if (x > 3) return 1; if (x < -3) return -1; float x2 = x * x; return x * (27 + x2) / (27 + 9 * x2); }   /* tanh-like */
static inline float clampf(float v, float a, float b) { return v < a ? a : v > b ? b : v; }
static inline float db2(float db) { return powf(10.f, db / 20.f); }
static inline float onepole(float *z, float x, float a) { *z += a * (x - *z); return *z; }
static float coef(double fs, double ms) { return ms <= 0 ? 1.f : (float)(1 - exp(-1000.0 / (ms * fs))); }

/* pitch shifter: two taps sliding through a delay line, crossfaded (ratio 2 = an octave up) */
typedef struct { float ph; } Ps;
static inline float ps_run(Ps *p, const Dl *l, float ratio, float win) {
  p->ph += (1 - ratio) / win; p->ph -= floorf(p->ph);
  float a = p->ph, b = a + 0.5f; if (b >= 1) b -= 1;
  float wa = 0.5f - 0.5f * cosf(2 * (float)M_PI * a), wb = 1 - wa;
  return dl_cubic(l, 2 + a * win) * wa + dl_cubic(l, 2 + b * win) * wb;
}

/* the reverb: a feedback delay network of 8 lines with damping, input diffusers and a pre-delay */
#define NL 8
typedef struct { Dl line[NL]; int len[NL]; float g[NL], lp[NL], damp; Dl ap[4]; int apLen[4]; Dl pre; float mod; } Verb;
static int verb_init(Verb *v, double fs, float scale) {
  static const int base[NL] = { 1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116 };   /* (samples at 44.1 kHz, Freeverb-ish primes) */
  static const int apb[4] = { 142, 107, 379, 277 };
  for (int i = 0; i < NL; i++) { v->len[i] = (int)(base[i] * scale * fs / 44100.0); if (!dl_init(&v->line[i], v->len[i] + 64)) return 0; }
  for (int i = 0; i < 4; i++) { v->apLen[i] = (int)(apb[i] * fs / 44100.0); if (!dl_init(&v->ap[i], v->apLen[i] + 2)) return 0; }
  return dl_init(&v->pre, (int)(fs * 0.2) + 2);
}
static void verb_free(Verb *v) { for (int i = 0; i < NL; i++) free(v->line[i].d); for (int i = 0; i < 4; i++) free(v->ap[i].d); free(v->pre.d); }
static void verb_decay(Verb *v, double fs, float t60, float tone) {
  for (int i = 0; i < NL; i++) v->g[i] = t60 >= 1e6f ? 1.f : (float)pow(10, -3.0 * v->len[i] / (t60 * fs));
  v->damp = clampf(0.08f + 0.9f * tone, 0.05f, 1.f);
}
static void verb_clear(Verb *v) {
  for (int i = 0; i < NL; i++) { memset(v->line[i].d, 0, (size_t)(v->line[i].mask + 1) * sizeof(float)); v->lp[i] = 0; }
  for (int i = 0; i < 4; i++) memset(v->ap[i].d, 0, (size_t)(v->ap[i].mask + 1) * sizeof(float));
  memset(v->pre.d, 0, (size_t)(v->pre.mask + 1) * sizeof(float));
}
/* one sample in, one out; fb: an extra signal into the feedback (the shimmer's pitch shifter); outFb: what to shift */
static inline float verb_run(Verb *v, float x, int preSamples, float fbIn, float *outFb) {
  dl_put(&v->pre, x); float s = dl_at(&v->pre, preSamples);
  for (int i = 0; i < 4; i++) { float d = dl_at(&v->ap[i], v->apLen[i] - 1); float y = -0.6f * s + d; dl_put(&v->ap[i], s + 0.6f * y); s = y; }
  float o[NL];
  for (int i = 0; i < NL; i++) { float r = dl_at(&v->line[i], v->len[i] - 1); v->lp[i] += v->damp * (r - v->lp[i]); o[i] = v->lp[i] * v->g[i]; }
  /* Hadamard 8 (scaled): three butterfly stages */
  for (int h = 1; h < NL; h <<= 1) for (int i = 0; i < NL; i += h << 1) for (int j = i; j < i + h; j++) { float a = o[j], b = o[j + h]; o[j] = a + b; o[j + h] = a - b; }
  const float k = 0.35355339f;   /* 1 / sqrt(8) */
  float out = 0;
  for (int i = 0; i < NL; i++) { float in = o[i] * k + (i & 1 ? -s : s) * 0.35f + (i < 2 ? fbIn : 0); dl_put(&v->line[i], in + DN); out += (i & 1 ? -1 : 1) * dl_at(&v->line[i], v->len[i] / 2); }
  if (outFb) *outFb = out;
  return out * 0.35f;
}

/* ------------------------------------------------------------------ voicings */
typedef struct { float hp, midF, midDb, midQ, gMin, gMax; int clip; float lpLo, lpHi, cleanMix, outDb; } Voicing;
enum { CLIP_SOFT, CLIP_ASYM, CLIP_HARD, CLIP_GE, CLIP_SI, CLIP_OCT };
static const Voicing DRIVES[] = {
  /* hp    midF  midDb Q    gain dB     clip       lp lo..hi      clean  out */
  { 40,   900,  0,  0.7f, 0, 30,  CLIP_SOFT,  2500, 9000,  0.25f, 0 },      /* 0 clear: transparent, keeps some clean */
  { 720,  720,  9,  0.9f, 6, 40,  CLIP_SOFT,  1500, 6000,  0,     2 },      /* 1 mid hump: cuts the lows before clipping */
  { 120,  600,  3,  0.7f, 0, 22,  CLIP_ASYM,  1800, 6500,  0.1f,  1 },      /* 2 low-gain blues */
  { 160,  1000, 4,  0.6f, 3, 34,  CLIP_ASYM,  2500, 10000, 0.45f, 2 },      /* 3 gold: clean blend under the drive */
  { 90,   700,  2,  0.7f, 14, 44, CLIP_HARD,  1600, 7000,  0,     -2 },     /* 4 british distortion */
  { 110,  650,  0,  0.8f, 24, 58, CLIP_HARD,  2000, 8000,  0,     -4 },     /* 5 high gain (mids knob scoops here) */
  { 50,   500,  2,  0.6f, 14, 44, CLIP_GE,    900,  5000,  0,     -2 },     /* 6 germanium fuzz */
  { 70,   900,  3,  0.6f, 26, 56, CLIP_SI,    1200, 6500,  0,     -4 },     /* 7 silicon fuzz */
  { 140,  1200, 3,  0.7f, 20, 50, CLIP_OCT,   1500, 7000,  0,     -3 },     /* 8 octave fuzz */
  { 60,   700,  2,  0.8f, 6, 36,  CLIP_SOFT,  1200, 6000,  0,     0 },      /* 9 bass drive: the blend knob keeps the lows clean */
};
typedef struct { float hp, gMin, gMax, stage2, bassF, midF, trebF, presF, cabLp; int bass; } AmpV;
static const AmpV AMPS[] = {
  { 70,  -6, 18, 0.0f, 100, 500, 3200, 5500, 5200, 0 },   /* American clean: lots of headroom, scooped mids, bright */
  { 90,  6,  32, 0.5f, 110, 750, 2800, 4500, 4800, 0 },   /* British crunch: mid-forward, two stages */
  { 110, 14, 48, 1.0f, 90,  650, 3000, 5000, 4600, 0 },   /* high gain: two hot stages, tight lows */
  { 30,  -6, 20, 0.0f, 60,  500, 2500, 900,  3500, 1 },   /* bass amp: deep lows, "growl" adds an upper-mid push */
};

/* ------------------------------------------------------------------ state */
struct MpFx {
  const MpDef *d; double fs; float v[MP_MAXCTL], cur[MP_MAXCTL]; volatile int dirty;
  Bq f[12]; Dl dl, dl2; Ps ps[3]; Verb *verb;
  float env, env2, gr, gain, lfo, lfo2, lfo3, lp[8], hp, z[16], tgt[8], sm[8];
  int ff, ff2, cnt, pos, segLen, prevPos; float sign, wow, flutter, swellGain, lastIn; unsigned rnd;
};

static float val(const MpFx *x, const char *sym, float def) { int k = mp_ctl_index(x->d, sym); return k < 0 ? def : x->cur[k]; }

MpFx *mp_new(const MpDef *d, double fs) { return mp_new_side(d, fs, 0); }
MpFx *mp_new_side(const MpDef *d, double fs, int side) {
  if (!d) return NULL; MpFx *x = calloc(1, sizeof *x); if (!x) return NULL;
  x->d = d; x->fs = fs > 1000 ? fs : 48000; x->rnd = side ? 91919 : 22222;
  if (side) { x->lfo = 0.25f; x->lfo2 = 0.4f; }   /* (the right side's LFOs a quarter turn on: a wider chorus, phaser, rotary) */
  for (int k = 0; k < d->nctl; k++) x->v[k] = x->cur[k] = d->ctl[k].def;
  int ok = 1;
  switch (d->kind) {
    case K_CHORUS: case K_FLANGER: case K_ROTARY: ok = dl_init(&x->dl, (int)(x->fs * 0.05)); break;
    case K_PITCH: ok = dl_init(&x->dl, (int)(x->fs * 0.1)); break;
    case K_DELAY: ok = dl_init(&x->dl, (int)(x->fs * (d->voice == 4 ? 2.0 : 2.1))); break;
    case K_REVDELAY: ok = dl_init(&x->dl, (int)(x->fs * 3.2)); break;
    case K_SPRING: ok = dl_init(&x->dl, (int)(x->fs * 0.08)) && dl_init(&x->dl2, (int)(x->fs * 0.02)); break;
    case K_VERB:
      x->verb = calloc(1, sizeof(Verb)); ok = x->verb && verb_init(x->verb, x->fs, (d->voice == 0 ? 0.7f : d->voice == 1 ? 1.6f : 2.0f) * (side ? 1.07f : 1.f));
      if (ok && d->voice == 2) ok = dl_init(&x->dl, (int)(x->fs * 0.1));
      break;
    default: break;
  }
  if (!ok) { mp_free(x); return NULL; }
  x->dirty = 1; x->gain = 1; x->swellGain = 0;
  for (int i = 0; i < 8; i++) x->sm[i] = -1;   /* (first block: jump straight to the targets) */
  return x;
}
void mp_free(MpFx *x) { if (!x) return; free(x->dl.d); free(x->dl2.d); if (x->verb) { verb_free(x->verb); free(x->verb); } free(x); }
void mp_set(MpFx *x, int k, float value) {
  if (!x || k < 0 || k >= x->d->nctl) return; const MpCtl *c = &x->d->ctl[k];
  if (!isfinite(value)) return; value = clampf(value, c->min, c->max); if (c->integer) value = floorf(value + 0.5f);
  x->v[k] = value; x->dirty = 1;
}
float mp_get(const MpFx *x, int k) { return x && k >= 0 && k < x->d->nctl ? x->v[k] : 0; }
void mp_reset(MpFx *x) {
  if (!x) return;
  for (int i = 0; i < 12; i++) bq_clear(&x->f[i]);
  if (x->dl.d) memset(x->dl.d, 0, (size_t)(x->dl.mask + 1) * sizeof(float));
  if (x->dl2.d) memset(x->dl2.d, 0, (size_t)(x->dl2.mask + 1) * sizeof(float));
  if (x->verb) verb_clear(x->verb);
  x->env = x->env2 = x->gr = 0; memset(x->lp, 0, sizeof x->lp); memset(x->z, 0, sizeof x->z);
}

/* a smoothed value (level and mix knobs: no zipper noise) */
static inline float smooth(MpFx *x, int i, float target) { if (x->sm[i] < -0.5f) x->sm[i] = target; x->sm[i] += 0.002f * (target - x->sm[i]); return x->sm[i]; }
static inline float noise(MpFx *x) { x->rnd = x->rnd * 1664525u + 1013904223u; return (float)(x->rnd >> 9) / 4194304.f - 1.f; }

/* ------------------------------------------------------------------ preparing (coefficients from the knobs) */
static void prepare(MpFx *x) {
  memcpy(x->cur, x->v, sizeof x->cur); x->dirty = 0;
  const MpDef *d = x->d; double fs = x->fs;
  switch (d->kind) {
    case K_DRIVE: {
      const Voicing *v = &DRIVES[d->voice]; float tone = val(x, "tone", 0.5f);
      bq_set(&x->f[0], HP, fs, v->hp, 0, 0.707);
      bq_set(&x->f[1], PK, fs, v->midF, d->voice == 5 ? v->midDb + (val(x, "mid", 0.35f) - 0.5f) * 18 : v->midDb, v->midQ);
      bq_set(&x->f[2], LP, fs, v->lpLo * powf(v->lpHi / v->lpLo, tone), 0, 0.707);
      bq_set(&x->f[3], LP, fs, v->lpHi * 1.3, 0, 0.6);   /* (the second pole of the post filter) */
      bq_set(&x->f[4], HP, fs, 25, 0, 0.707);             /* (DC after the asymmetric clippers) */
      bq_set(&x->f[5], LP, fs, d->voice == 9 ? 140 + 260 * val(x, "tone", 0.5f) : 300, 0, 0.707);   /* bass drive: the clean lows */
      bq_set(&x->f[6], BP, fs, 1200, 0, 0.8);             /* octave fuzz: the ring around the octave */
      x->tgt[0] = db2(v->gMin + (v->gMax - v->gMin) * val(x, "drive", 0.5f));
      x->tgt[1] = db2(-30 + 36 * val(x, "level", 0.5f) + v->outDb);
      break; }
    case K_AMP: {
      const AmpV *a = &AMPS[d->voice];
      float b = val(x, "bass", 0.5f), m = val(x, "mid", 0.5f), t = val(x, "treble", 0.5f), p = val(x, "presence", 0.5f);
      bq_set(&x->f[0], HP, fs, a->hp, 0, 0.707);
      bq_set(&x->f[1], LP, fs, a->bass ? 5000 : 7000, 0, 0.707);   /* between the stages */
      bq_set(&x->f[2], LS, fs, a->bassF, (b - 0.5f) * 24, 0.7);
      bq_set(&x->f[3], PK, fs, a->midF, (m - 0.5f) * 20, 0.7);
      bq_set(&x->f[4], HS, fs, a->trebF, (t - 0.5f) * 22, 0.7);
      bq_set(&x->f[5], PK, fs, a->presF, (p - 0.3f) * (a->bass ? 14 : 12), a->bass ? 0.9 : 1.0);
      /* the cabinet: a speaker's shape (high-pass, a low bump, a scoop, the cone's peak, then the roll-off) */
      bq_set(&x->f[6], HP, fs, a->bass ? 40 : 75, 0, 0.8);
      bq_set(&x->f[7], PK, fs, a->bass ? 90 : 110, 4, 1.3);
      bq_set(&x->f[8], PK, fs, a->bass ? 700 : 450, -4, 1.0);
      bq_set(&x->f[9], PK, fs, a->bass ? 1800 : 2400, 4, 1.4);
      bq_set(&x->f[10], LP, fs, a->cabLp, 0, 0.7);
      bq_set(&x->f[11], LP, fs, a->cabLp * 1.25, 0, 0.6);
      x->tgt[0] = db2(a->gMin + (a->gMax - a->gMin) * val(x, "gain", 0.5f));
      x->tgt[1] = db2(-24 + 30 * val(x, "master", 0.5f));
      break; }
    case K_COMP: x->tgt[1] = val(x, "blend", 1); break;
    case K_BASSPRE:
      bq_set(&x->f[0], HP, fs, 28, 0, 0.707); bq_set(&x->f[1], LS, fs, 80, val(x, "bass", 0), 0.7); bq_set(&x->f[2], PK, fs, 400, val(x, "lowmid", 0), 0.9);
      bq_set(&x->f[3], PK, fs, 1800, val(x, "highmid", 0), 0.9); bq_set(&x->f[4], HS, fs, 4500, val(x, "treble", 0), 0.7); bq_set(&x->f[5], LP, fs, 3000, 0, 0.707);
      x->tgt[0] = db2(18 * val(x, "drive", 0.2f)); x->tgt[1] = db2(-18 + 30 * val(x, "level", 0.5f)); break;
    case K_ACPRE:
      bq_set(&x->f[0], HP, fs, 60, 0, 0.707); bq_set(&x->f[1], LS, fs, 120, val(x, "bass", 0), 0.7); bq_set(&x->f[2], PK, fs, val(x, "midfreq", 800), val(x, "mid", 0), 0.8);
      bq_set(&x->f[3], HS, fs, 5000, val(x, "treble", 0), 0.7); bq_set(&x->f[4], NOTCH, fs, val(x, "notch", 120), 0, 4 + 20 * (1 - val(x, "notchon", 0)));
      x->tgt[1] = db2(-18 + 30 * val(x, "level", 0.5f)); x->tgt[2] = val(x, "notchon", 0); break;
    case K_ACSIM: {
      float body = val(x, "body", 0.6f), top = val(x, "top", 0.55f);
      bq_set(&x->f[0], HP, fs, 80, 0, 0.707); bq_set(&x->f[1], PK, fs, 105, 3 + 6 * body, 1.6); bq_set(&x->f[2], PK, fs, 220, 2 + 4 * body, 1.4);
      bq_set(&x->f[3], PK, fs, 450, -4, 1.0); bq_set(&x->f[4], PK, fs, 1500, -5, 0.8); bq_set(&x->f[5], HS, fs, 4500, -2 + 12 * top, 0.7); bq_set(&x->f[6], PK, fs, 9000, 6 * top, 1.0);
      x->tgt[1] = db2(-18 + 30 * val(x, "level", 0.5f)); break; }
    case K_CHORUS: bq_set(&x->f[0], LP, fs, 1500 * powf(8, val(x, "tone", 0.6f)), 0, 0.707); break;
    case K_TREM: bq_set(&x->f[0], LP, fs, val(x, "xover", 700), 0, 0.707); bq_set(&x->f[1], HP, fs, val(x, "xover", 700), 0, 0.707); break;
    case K_RING: bq_set(&x->f[0], LP, fs, 800 * powf(12, val(x, "tone", 0.6f)), 0, 0.707); break;
    case K_OCTUP: bq_set(&x->f[0], HP, fs, 120, 0, 0.707); bq_set(&x->f[1], LP, fs, 1200 * powf(6, val(x, "tone", 0.5f)), 0, 0.707); bq_set(&x->f[2], LP, fs, 1000, 0, 0.707); break;
    case K_OCTDOWN: bq_set(&x->f[0], LP, fs, 500, 0, 0.707); bq_set(&x->f[1], LP, fs, 280, 0, 0.707); bq_set(&x->f[2], LP, fs, 200 * powf(10, val(x, "tone", 0.45f)), 0, 0.707); bq_set(&x->f[3], LP, fs, 150 * powf(10, val(x, "tone", 0.45f)), 0, 0.707); break;
    case K_DELAY: {
      float tone = val(x, "tone", 0.5f);
      float lo = d->voice == 0 ? 1200 : d->voice == 1 ? 1600 : d->voice == 4 ? 1400 : 2500;
      bq_set(&x->f[0], LP, fs, lo * powf(d->voice == 2 ? 8 : 5, tone), 0, 0.707);
      bq_set(&x->f[1], HP, fs, d->voice == 2 ? val(x, "lowcut", 80) : 90, 0, 0.707);
      break; }
    case K_SPRING: {
      for (int i = 0; i < 6; i++) bq_set(&x->f[i], AP, fs, 300 + 400 * i * (0.5f + val(x, "dwell", 0.5f)), 0, 0.4);   /* the dispersion: the "boing" */
      bq_set(&x->f[6], LP, fs, 2000 * powf(3, val(x, "tone", 0.5f)), 0, 0.707); bq_set(&x->f[7], HP, fs, 180, 0, 0.707); break; }
    case K_VERB: {
      float decay = val(x, "decay", 3), tone = val(x, "tone", 0.5f);
      if (d->voice == 4 && val(x, "freeze", 0) > 0.5f) decay = 1e7f;
      verb_decay(x->verb, fs, decay, tone);
      if (d->voice == 4 && val(x, "freeze", 0) > 0.5f) x->verb->damp = 1;   /* (frozen: nothing fades) */
      bq_set(&x->f[0], HP, fs, 120, 0, 0.707); break; }
    case K_GEQ: {
      static const float fr[7] = { 100, 200, 400, 800, 1600, 3200, 6400 }; static const char *s[7] = { "b100", "b200", "b400", "b800", "b1k6", "b3k2", "b6k4" };
      for (int i = 0; i < 7; i++) bq_set(&x->f[i], PK, fs, fr[i], val(x, s[i], 0), 1.1);
      x->tgt[1] = db2(val(x, "level", 0)); break; }
    case K_PEQ:
      bq_set(&x->f[0], HP, fs, val(x, "lowcut", 40), 0, 0.707); bq_set(&x->f[1], LS, fs, 120, val(x, "low", 0), 0.7);
      bq_set(&x->f[2], PK, fs, val(x, "midfreq", 800), val(x, "mid", 0), val(x, "q", 1)); bq_set(&x->f[3], HS, fs, 5000, val(x, "high", 0), 0.7);
      x->tgt[1] = db2(val(x, "level", 0)); break;
    case K_BOOST: bq_set(&x->f[0], LS, fs, 150, val(x, "bass", 0), 0.7); bq_set(&x->f[1], HS, fs, 3500, val(x, "treble", 0), 0.7); x->tgt[1] = db2(val(x, "gain", 8)); break;
    default: break;
  }
}

/* ------------------------------------------------------------------ the DSP */
static inline float clip(int type, float s, float bias, float *st) {
  switch (type) {
    case CLIP_SOFT: return sat(s);
    case CLIP_ASYM: return s > 0 ? sat(s) : sat(s * 0.6f) * 1.4f;   /* diodes that don't match: even harmonics */
    case CLIP_HARD: { float a = sat(s * 1.4f); return clampf(a * 1.1f, -0.95f, 0.95f); }
    case CLIP_GE: {   /* a germanium transistor: biased, soft, sags; low bias = gated sputter */
      float b = (bias - 0.5f) * 0.6f; float y = sat(s + b) - sat(b);
      *st += 0.0005f * (fabsf(y) - *st); return y * (1 - 0.35f * *st) * (bias < 0.25f && fabsf(s) < 0.05f ? 0.2f : 1); }
    case CLIP_SI: { float y = s > 0 ? sat(s * 1.5f) : sat(s * 0.9f); return clampf(y * 1.3f, -0.9f, 0.9f); }
    default: return sat(s);
  }
}
static void run_drive(MpFx *x, const float *in, float *out, int n) {
  const Voicing *v = &DRIVES[x->d->voice]; float bias = val(x, "bias", 0.5f), oct = val(x, "octave", 0), blend = val(x, "blend", 0);
  for (int i = 0; i < n; i++) {
    float g = smooth(x, 0, x->tgt[0]), lv = smooth(x, 1, x->tgt[1]);
    float s = bq(&x->f[1], bq(&x->f[0], in[i])) * g;
    if (v->clip == CLIP_OCT) { float r = fabsf(s); s = s * (1 - oct) + (r * 2 - x->z[1]) * oct; x->z[1] += 0.001f * (r * 2 - x->z[1]); }
    /* 2x oversampled clipping: the half-way sample and this one, averaged (less aliasing at little cost) */
    float mid = 0.5f * (s + x->lastIn); x->lastIn = s;
    float y = 0.5f * (clip(v->clip, mid, bias, &x->z[0]) + clip(v->clip, s, bias, &x->z[0]));
    if (v->clip == CLIP_OCT) y += 0.3f * oct * bq(&x->f[6], y);
    y = bq(&x->f[4], bq(&x->f[3], bq(&x->f[2], y)));
    if (v->cleanMix > 0) y = y * (1 - v->cleanMix) + in[i] * v->cleanMix * 3;
    if (x->d->voice == 9) { float lows = bq(&x->f[5], in[i]) * 2.5f; y = y * (0.2f + 0.8f * (1 - blend)) + lows * blend * 1.5f + y * blend * 0.6f; }
    out[i] = y * lv;
  }
}
static void run_amp(MpFx *x, const float *in, float *out, int n) {
  const AmpV *a = &AMPS[x->d->voice]; int cab = val(x, "cab", 1) > 0.5f;
  for (int i = 0; i < n; i++) {
    float g = smooth(x, 0, x->tgt[0]), m = smooth(x, 1, x->tgt[1]);
    float s = bq(&x->f[0], in[i]) * g;
    float y = s > 0 ? sat(s) : sat(s * 0.8f) * 1.15f;   /* the first valve: slightly asymmetric */
    if (a->stage2 > 0) { y = bq(&x->f[1], y) * (1 + 6 * a->stage2); y = sat(y); }
    y = bq(&x->f[5], bq(&x->f[4], bq(&x->f[3], bq(&x->f[2], y))));
    y = sat(y * 1.2f) * 0.85f;   /* the power stage */
    if (cab) y = bq(&x->f[11], bq(&x->f[10], bq(&x->f[9], bq(&x->f[8], bq(&x->f[7], bq(&x->f[6], y)))))) * 1.6f;
    out[i] = y * m;
  }
}
static void run_comp(MpFx *x, const float *in, float *out, int n) {
  double fs = x->fs; int v = x->d->voice; float thr, ratio, att, rel, makeup;
  if (v == 0) { thr = val(x, "threshold", -20); ratio = val(x, "ratio", 4); att = coef(fs, val(x, "attack", 10)); rel = coef(fs, val(x, "release", 150)); makeup = val(x, "makeup", 4); }
  else if (v == 1) { thr = -10 - 40 * val(x, "peak", 0.45f); ratio = 4; att = coef(fs, 10); rel = coef(fs, 60); makeup = val(x, "gain", 6); }   /* (opto: a fast release that gets slower, below) */
  else { thr = -12 - 36 * val(x, "sens", 0.5f); ratio = 8; att = coef(fs, 3); rel = coef(fs, 250); makeup = -12 + 36 * val(x, "level", 0.5f); }
  float mk = db2(makeup);
  for (int i = 0; i < n; i++) {
    float blend = smooth(x, 1, x->tgt[1]); float a = fabsf(in[i]);
    if (v == 1) { x->env += (a > x->env ? att : rel) * (a - x->env); x->env2 += 0.0001f * (x->env - x->env2); }   /* opto: the cell remembers a little (the slow second half of its release) */
    else x->env += (a > x->env ? att : rel) * (a - x->env);
    float lvl = 20 * log10f((v == 1 ? fmaxf(x->env, x->env2 * 0.35f) : x->env) + 1e-9f), over = lvl - thr, gdb = 0;
    float knee = v == 2 ? 10 : 6;
    if (over > knee / 2) gdb = over * (1 / ratio - 1); else if (over > -knee / 2) { float t = over + knee / 2; gdb = (1 / ratio - 1) * t * t / (2 * knee); }
    x->gr = gdb; float y = in[i] * db2(gdb) * mk; out[i] = y * blend + in[i] * (1 - blend);
  }
}
static void run_eqs(MpFx *x, const float *in, float *out, int n) {
  int k = x->d->kind; float mix = k == K_ACSIM ? val(x, "mix", 1) : 1;
  for (int i = 0; i < n; i++) {
    float s = in[i], lv = smooth(x, 1, x->tgt[1] > 0 ? x->tgt[1] : 1);
    if (k == K_BASSPRE) { float g = smooth(x, 0, x->tgt[0]); float drv = sat(s * g) / (g > 1 ? sqrtf(g) : 1); s = s * 0.5f + drv * 0.5f + bq(&x->f[5], drv - s) * 0.3f; for (int j = 0; j < 5; j++) s = bq(&x->f[j], s); }
    else if (k == K_ACPRE) { for (int j = 0; j < 4; j++) s = bq(&x->f[j], s); if (x->tgt[2] > 0.01f) s = bq(&x->f[4], s); }
    else if (k == K_ACSIM) { float d0 = s; for (int j = 0; j < 7; j++) s = bq(&x->f[j], s); s = s * mix + d0 * (1 - mix); }
    else if (k == K_GEQ) { for (int j = 0; j < 7; j++) s = bq(&x->f[j], s); }
    else if (k == K_PEQ) { for (int j = 0; j < 4; j++) s = bq(&x->f[j], s); }
    else if (k == K_BOOST) { s = bq(&x->f[1], bq(&x->f[0], s)); }
    out[i] = s * lv;
  }
}
static void run_chorus(MpFx *x, const float *in, float *out, int n) {
  float rate = val(x, "rate", 0.6f), depth = val(x, "depth", 0.5f), mix = val(x, "mix", 0.5f); int voices = x->d->voice == 1 ? 3 : 2; double fs = x->fs;
  float inc = rate / (float)fs, base = (float)fs * 0.009f, dep = (float)fs * 0.004f * depth;
  for (int i = 0; i < n; i++) {
    dl_put(&x->dl, in[i]); float w = 0;
    x->lfo += inc; if (x->lfo >= 1) x->lfo -= 1;
    for (int v = 0; v < voices; v++) { float ph = x->lfo + (float)v / voices + (v == 2 ? 0.07f : 0); float l = sinf(2 * (float)M_PI * ph) * (v == 1 && voices == 3 ? 0.8f : 1); w += dl_cubic(&x->dl, base * (1 + 0.25f * v) + dep * (0.5f + 0.5f * l)); }
    w = bq(&x->f[0], w / voices); float m = smooth(x, 1, mix);
    out[i] = in[i] * (1 - m * 0.5f) + w * m;
  }
}
static void run_flanger(MpFx *x, const float *in, float *out, int n) {
  float rate = val(x, "rate", 0.25f), depth = val(x, "depth", 0.7f), man = val(x, "manual", 0.4f), fb = val(x, "feedback", 0.6f), mix = val(x, "mix", 0.5f); double fs = x->fs;
  float inc = rate / (float)fs, lo = (float)fs * (0.0003f + 0.004f * man), sw = (float)fs * 0.004f * depth;
  for (int i = 0; i < n; i++) {
    x->lfo += inc; if (x->lfo >= 1) x->lfo -= 1; float tri = x->lfo < 0.5f ? x->lfo * 2 : 2 - x->lfo * 2;
    float d = lo + sw * tri; float w = dl_cubic(&x->dl, d);
    dl_put(&x->dl, sat(in[i] + w * fb) + DN); float m = smooth(x, 1, mix);
    out[i] = in[i] * (1 - m * 0.5f) + w * m;
  }
}
static void run_phaser(MpFx *x, const float *in, float *out, int n) {
  int vibe = x->d->voice == 1; float rate = val(x, "rate", 0.5f), depth = val(x, "depth", 0.8f), fb = vibe ? 0.15f : val(x, "feedback", 0.3f);
  float mix = vibe ? (val(x, "mode", 0) > 0.5f ? 1.f : 0.5f) : val(x, "mix", 0.5f), lvl = vibe ? db2(-12 + 24 * val(x, "level", 0.5f)) : 1; double fs = x->fs;
  static const float vibeSpread[4] = { 1.0f, 1.6f, 0.55f, 3.2f };   /* the vibe's stages sit apart, so its notches don't line up */
  for (int i = 0; i < n; i++) {
    x->lfo += rate / (float)fs; if (x->lfo >= 1) x->lfo -= 1;
    if ((x->cnt++ & 15) == 0) {   /* the sweep moves slowly: new coefficients every 16 samples */
      float l = vibe ? powf(0.5f + 0.5f * sinf(2 * (float)M_PI * x->lfo), 1.8f) : 0.5f + 0.5f * sinf(2 * (float)M_PI * x->lfo);   /* (the lamp and photocell: a lopsided sweep) */
      float fc = 200 * powf(10, depth * l * (vibe ? 1.1f : 1.0f)) + 60;
      for (int st = 0; st < 4; st++) { float f = fc * (vibe ? vibeSpread[st] : 1); float t = tanf((float)M_PI * clampf(f, 20, (float)fs * 0.45f) / (float)fs); x->tgt[2 + st] = (t - 1) / (t + 1); }
    }
    float s = in[i] + x->z[8] * fb;
    for (int st = 0; st < 4; st++) { float a = x->tgt[2 + st]; float y = a * s + x->z[st]; x->z[st] = s - a * y; s = y; }
    x->z[8] = s + DN; float m = smooth(x, 1, mix);
    out[i] = (in[i] * (1 - m) + s * m) * (vibe ? lvl * 1.3f : 1);
  }
}
static void run_rotary(MpFx *x, const float *in, float *out, int n) {
  double fs = x->fs; float fast = val(x, "fast", 0) > 0.5f, drive = val(x, "drive", 0.25f), bal = val(x, "balance", 0.6f), mix = val(x, "mix", 1);
  float hornT = fast ? 6.8f : 0.8f, drumT = fast ? 5.9f : 0.65f;
  for (int i = 0; i < n; i++) {
    x->z[0] += (hornT - x->z[0]) * 0.00004f; x->z[1] += (drumT - x->z[1]) * 0.00001f;   /* the motors take time to get there (the drum longer) */
    x->lfo += x->z[0] / (float)fs; if (x->lfo >= 1) x->lfo -= 1; x->lfo2 += x->z[1] / (float)fs; if (x->lfo2 >= 1) x->lfo2 -= 1;
    float s = sat(in[i] * (1 + 6 * drive)) / (1 + 2 * drive);
    float lo = onepole(&x->lp[0], s, 0.07f), hi = s - lo;
    dl_put(&x->dl, hi); float sh = sinf(2 * (float)M_PI * x->lfo), sd = sinf(2 * (float)M_PI * x->lfo2);
    float horn = dl_cubic(&x->dl, (float)fs * (0.0012f + 0.0004f * sh)) * (0.75f + 0.25f * sh);
    float drum = lo * (0.85f + 0.15f * sd);
    float y = horn * bal * 1.4f + drum * (1 - bal) * 1.4f; float m = smooth(x, 1, mix);
    out[i] = y * m + in[i] * (1 - m);
  }
}
static void run_trem(MpFx *x, const float *in, float *out, int n) {
  float rate = val(x, "rate", 4), depth = val(x, "depth", 0.7f), lvl = db2(-12 + 24 * val(x, "level", 0.5f)); int harm = x->d->voice == 0; float shape = val(x, "shape", 0.8f); double fs = x->fs;
  for (int i = 0; i < n; i++) {
    x->lfo += rate / (float)fs; if (x->lfo >= 1) x->lfo -= 1; float s = sinf(2 * (float)M_PI * x->lfo), y;
    if (harm) { float lo = bq(&x->f[0], in[i]), hi = bq(&x->f[1], in[i]); y = lo * (1 - depth * (0.5f + 0.5f * s)) + hi * (1 - depth * (0.5f - 0.5f * s)); }
    else { float sq = sat(s * (1 + 20 * shape)); float g = 1 - depth * (0.5f + 0.5f * sq); y = in[i] * g; }
    out[i] = y * lvl;
  }
}
static void run_ring(MpFx *x, const float *in, float *out, int n) {
  float f = val(x, "freq", 300), wob = val(x, "lfo", 0), mix = val(x, "mix", 0.6f); double fs = x->fs;
  for (int i = 0; i < n; i++) {
    x->lfo2 += 0.7f / (float)fs; if (x->lfo2 >= 1) x->lfo2 -= 1;
    float fr = f * (1 + wob * 0.5f * sinf(2 * (float)M_PI * x->lfo2));
    x->lfo += fr / (float)fs; if (x->lfo >= 1) x->lfo -= 1;
    float y = bq(&x->f[0], in[i] * sinf(2 * (float)M_PI * x->lfo)); float m = smooth(x, 1, mix);
    out[i] = y * m * 1.4f + in[i] * (1 - m);
  }
}
static void run_octup(MpFx *x, const float *in, float *out, int n) {
  float oct = val(x, "octave", 0.7f), dry = val(x, "dry", 0.7f);
  for (int i = 0; i < n; i++) {
    float s = bq(&x->f[2], in[i]); float r = fabsf(s); x->z[0] += 0.0005f * (r - x->z[0]);   /* a full-wave rectifier: the octave up, minus its DC */
    float y = bq(&x->f[1], bq(&x->f[0], (r - x->z[0]) * 2.2f));
    out[i] = in[i] * dry + y * oct * 1.5f;
  }
}
static void run_octdown(MpFx *x, const float *in, float *out, int n) {
  float o1 = val(x, "oct1", 0.7f), o2 = val(x, "oct2", 0), dry = val(x, "dry", 0.7f);
  for (int i = 0; i < n; i++) {
    float s = bq(&x->f[1], bq(&x->f[0], in[i])); float a = fabsf(in[i]); x->env += (a > x->env ? 0.01f : 0.0008f) * (a - x->env);
    /* the analog divider: a flip-flop toggles on each rising zero crossing of the low-passed input (half the frequency),
       a second one on the first (a quarter) - squared off, then shaped by the input's envelope and filtered round */
    float hyst = 0.02f * x->env + 1e-4f;
    if (s > hyst && x->sign <= 0) { x->sign = 1; x->ff = !x->ff; if (x->ff) x->ff2 = !x->ff2; } else if (s < -hyst) x->sign = -1;
    float sub1 = (x->ff ? 1.f : -1.f) * x->env, sub2 = (x->ff2 ? 1.f : -1.f) * x->env;
    float y = bq(&x->f[2], sub1) * o1 + bq(&x->f[3], sub2) * o2;
    out[i] = in[i] * dry + y * 1.6f;
  }
}
static void run_pitch(MpFx *x, const float *in, float *out, int n) {
  int wh = x->d->voice == 1; float semis = wh ? val(x, "position", 0) * val(x, "range", 12) : val(x, "interval", 7) + val(x, "detune", 0) / 100.f, mix = val(x, "mix", 0.5f);
  float ratio = powf(2.f, semis / 12.f), win = (float)x->fs * 0.035f;
  for (int i = 0; i < n; i++) {
    dl_put(&x->dl, in[i]); float y = ps_run(&x->ps[0], &x->dl, ratio, win); float m = smooth(x, 1, mix);
    if (wh) { m *= smooth(x, 2, clampf(fabsf(semis) * 2, 0, 1)); out[i] = y * m + in[i] * (1 - m); }   /* (heel down: the dry guitar, no shifter delay) */
    else out[i] = in[i] * (1 - m * 0.5f) + y * m;
  }
}
static void run_filter(MpFx *x, const float *in, float *out, int n) {
  int v = x->d->voice; double fs = x->fs; float res = val(x, "res", 0.6f), mix = val(x, "mix", 1), q = 0.7f + 9 * res * res; int mode = (int)val(x, "mode", 1);
  float sens = val(x, "sens", 0.6f), range = val(x, "range", 0.7f), rate = val(x, "rate", 1.5f), depth = val(x, "depth", 0.8f), pos = val(x, "position", 0.5f);
  float decay = coef(fs, val(x, "decay", 300)), fuzz = val(x, "fuzz", 0.8f), lvl = v == 2 ? db2(-12 + 24 * val(x, "level", 0.5f)) : 1;
  for (int i = 0; i < n; i++) {
    float s = in[i], fc;
    if (v == 0) { float a = fabsf(s) * (2 + 30 * sens); x->env += (a > x->env ? 0.02f : 0.0006f) * (a - x->env); fc = 200 * powf(15 * (0.3f + range), clampf(x->env, 0, 1)); }
    else if (v == 1) { x->lfo += rate / (float)fs; if (x->lfo >= 1) x->lfo -= 1; fc = 350 * powf(1 + 8 * depth, 0.5f + 0.5f * sinf(2 * (float)M_PI * x->lfo)); }
    else if (v == 2) { x->z[5] += 0.002f * (pos - x->z[5]); fc = 380 * powf(6, x->z[5]); q = 2.5f + 6 * res; }
    else {   /* synth: square the guitar up, then a filter that opens on each note and closes over the decay */
      float a = fabsf(s); float trig = a > 0.02f + 0.2f * (1 - sens) && x->env2 < 0.01f; if (trig) x->env = 1; x->env2 += (a - x->env2) * (a > x->env2 ? 0.05f : 0.001f);
      x->env -= decay * x->env; fc = 120 + 4000 * x->env * x->env; s = sat(s * (1 + 60 * fuzz)) * 0.5f + s * (1 - fuzz) * 2;
    }
    fc = clampf(fc, 40, (float)fs / 6.f);
    /* a state-variable filter (Chamberlin, stable to fs/6 with this f) */
    float f = 2 * sinf((float)M_PI * fc / (float)fs), damp = 1 / q;
    float lpv = x->z[0] + f * x->z[1], hpv = s - lpv - damp * x->z[1], bpv = f * hpv + x->z[1];
    x->z[0] = lpv + DN; x->z[1] = clampf(bpv, -8, 8) + DN;
    float y = v == 2 ? bpv * 2.5f + lpv * 0.15f : v == 1 ? bpv * 1.6f : v == 3 ? lpv : (mode == 0 ? lpv : mode == 2 ? hpv : bpv * 1.6f);
    float m = smooth(x, 1, mix); out[i] = (y * m + in[i] * (1 - m)) * lvl;
  }
}
static void run_delay(MpFx *x, const float *in, float *out, int n) {
  int v = x->d->voice; double fs = x->fs; float fb = val(x, "feedback", 0.4f), mix = val(x, "mix", 0.35f), mod = val(x, "mod", 0.2f);
  float ms = v == 3 ? 60000.f / val(x, "bpm", 72) * 0.75f : val(x, "time", 400); int heads = (int)val(x, "heads", 7);
  float target = (float)fs * ms / 1000.f;
  for (int i = 0; i < n; i++) {
    x->z[3] += (target - x->z[3]) * (x->z[3] == 0 ? 1.f : 0.0005f);   /* changing the time glides, like turning a real knob */
    float d = x->z[3];
    if (v == 0 || v == 3) { x->lfo += 0.6f / (float)fs; if (x->lfo >= 1) x->lfo -= 1; d += mod * (float)fs * 0.0018f * sinf(2 * (float)M_PI * x->lfo); }
    if (v == 1) { x->lfo += 0.5f / (float)fs; if (x->lfo >= 1) x->lfo -= 1; x->lfo2 += 6.3f / (float)fs; if (x->lfo2 >= 1) x->lfo2 -= 1;
                  x->wow += 0.00002f * (noise(x) - x->wow); d += mod * (float)fs * (0.003f * sinf(2 * (float)M_PI * x->lfo) + 0.0004f * sinf(2 * (float)M_PI * x->lfo2) + 0.02f * x->wow); }
    float w;
    if (v == 4) { static const int H[8][3] = { {0,0,0},{1,0,0},{0,1,0},{0,0,1},{1,1,0},{0,1,1},{1,0,1},{1,1,1} }; int h = heads < 1 ? 1 : heads > 7 ? 7 : heads;
                  w = 0; int k = 0; for (int t = 0; t < 3; t++) if (H[h][t]) { w += dl_frac(&x->dl, d * (t + 1)); k++; } w /= k ? (float)k * 0.7f : 1; }
    else w = dl_frac(&x->dl, d);
    float fbs = bq(&x->f[1], bq(&x->f[0], w)) * fb;
    if (v == 0 || v == 1 || v == 4) fbs = sat(fbs * 1.2f) / 1.1f;   /* analog and tape: the repeats grit up and can't run away */
    dl_put(&x->dl, in[i] + fbs + DN);
    float m = smooth(x, 1, mix); float wet = v == 2 ? w : bq(&x->f[0], w) * 0.5f + w * 0.5f;
    out[i] = in[i] * (1 - m * 0.5f) + wet * m;
  }
}
static void run_revdelay(MpFx *x, const float *in, float *out, int n) {
  double fs = x->fs; int len = (int)(fs * val(x, "time", 600) / 1000.f); float fb = val(x, "feedback", 0.3f), mix = val(x, "mix", 0.5f);
  if (len < 64) len = 64; if (len > (int)(fs * 1.5)) len = (int)(fs * 1.5);
  for (int i = 0; i < n; i++) {
    /* record into dl, play the last segment backwards (two overlapping readers, crossfaded) */
    if (x->cnt <= 0) { x->segLen = len; x->cnt = len; }
    int k = x->segLen - x->cnt;   /* 0..len-1 */
    float a = dl_at(&x->dl, 2 * k), b = dl_at(&x->dl, 2 * ((k + x->segLen / 2) % x->segLen));
    float ph = (float)k / (float)x->segLen, wa = sinf((float)M_PI * ph), pb = ph + 0.5f; if (pb >= 1) pb -= 1; float wb = sinf((float)M_PI * pb);
    float y = (a * wa + b * wb) * 0.8f; x->cnt--;
    dl_put(&x->dl, in[i] + y * fb + DN);
    float m = smooth(x, 1, mix); out[i] = in[i] * (1 - m * 0.5f) + y * m;
  }
}
static void run_spring(MpFx *x, const float *in, float *out, int n) {
  double fs = x->fs; float dwell = val(x, "dwell", 0.5f), decay = 0.55f + 0.4f * val(x, "decay", 0.5f), mix = val(x, "mix", 0.3f); int len = (int)(fs * 0.037);
  for (int i = 0; i < n; i++) {
    float s = sat(in[i] * (1 + 4 * dwell)) * 0.5f, r = dl_at(&x->dl, len) ;
    float z = s + r * decay;
    for (int j = 0; j < 6; j++) z = bq(&x->f[j], z);   /* the spring's dispersion: highs arrive first */
    z = bq(&x->f[7], bq(&x->f[6], z));
    dl_put(&x->dl, z + DN);
    dl_put(&x->dl2, z); float y = z * 0.6f + dl_at(&x->dl2, (int)(fs * 0.011)) * 0.4f;
    float m = smooth(x, 1, mix); out[i] = in[i] * (1 - m * 0.5f) + y * m * 1.6f;
  }
}
static void run_verb(MpFx *x, const float *in, float *out, int n) {
  int v = x->d->voice; double fs = x->fs; float mix = val(x, "mix", 0.3f), shim = val(x, "shimmer", 0.5f);
  int pre = (int)(fs * (v <= 1 ? val(x, "predelay", 20) / 1000.f : v == 2 ? 0.03f : 0.02f));
  int frozen = v == 4 && val(x, "freeze", 0) > 0.5f; float swellA = coef(fs, val(x, "swell", 500));
  for (int i = 0; i < n; i++) {
    float s = bq(&x->f[0], in[i]), fbIn = 0, outFb = 0;
    if (v == 3) {   /* the swell: notes fade in (an envelope that restarts on each pick attack) */
      float a = fabsf(in[i]); x->env += (a > x->env ? 0.02f : 0.0015f) * (a - x->env); x->env2 += 0.0004f * (a - x->env2);
      if (x->cnt > 0) x->cnt--;
      else if (x->env > x->env2 * 2.f + 0.01f) { x->swellGain = 0; x->cnt = (int)(fs * 0.12); }   /* a new note: the fast envelope jumps over the slow one */
      x->swellGain += swellA * (1 - x->swellGain); s *= x->swellGain;
    }
    if (v == 2) { fbIn = ps_run(&x->ps[0], &x->dl, 2.f, (float)fs * 0.05f) * shim * 0.25f; }
    float y = verb_run(x->verb, frozen ? 0.f : s, pre, fbIn, &outFb);
    if (v == 2) dl_put(&x->dl, outFb * 0.35f);
    float m = smooth(x, 1, mix);
    float dry = v == 3 ? in[i] * x->swellGain : in[i];
    out[i] = dry * (1 - m * 0.5f) + y * m * 1.4f;
  }
}
static void run_util(MpFx *x, const float *in, float *out, int n) {
  int k = x->d->kind; double fs = x->fs;
  if (k == K_VOLUME) { float vmin = val(x, "min", 0), vol = vmin + (1 - vmin) * val(x, "volume", 1); vol = vol * vol; for (int i = 0; i < n; i++) out[i] = in[i] * smooth(x, 1, vol); return; }
  if (k == K_MUTE) { float g = val(x, "mute", 1) > 0.5f ? 0.f : 1.f; for (int i = 0; i < n; i++) out[i] = in[i] * smooth(x, 1, g); return; }
  /* the gate: opens fast above the threshold, closes over the release, never below the range */
  float thr = db2(val(x, "threshold", -55)), rel = coef(fs, val(x, "release", 80)), floorG = db2(val(x, "range", -80));
  for (int i = 0; i < n; i++) {
    float a = fabsf(in[i]); x->env += (a > x->env ? 0.2f : 0.002f) * (a - x->env);
    float want = x->env > thr ? 1.f : x->env < thr * 0.7f ? floorG : x->gain;   /* (a little hysteresis) */
    x->gain += (want > x->gain ? 0.05f : rel) * (want - x->gain); out[i] = in[i] * x->gain;
  }
}

void mp_run(MpFx *x, const float *in, float *out, int n) {
  if (!x || n <= 0) return;
  if (x->dirty) prepare(x);
  switch (x->d->kind) {
    case K_DRIVE: run_drive(x, in, out, n); break;
    case K_AMP: run_amp(x, in, out, n); break;
    case K_COMP: run_comp(x, in, out, n); break;
    case K_BASSPRE: case K_ACPRE: case K_ACSIM: case K_GEQ: case K_PEQ: case K_BOOST: run_eqs(x, in, out, n); break;
    case K_CHORUS: run_chorus(x, in, out, n); break;
    case K_FLANGER: run_flanger(x, in, out, n); break;
    case K_PHASER: run_phaser(x, in, out, n); break;
    case K_ROTARY: run_rotary(x, in, out, n); break;
    case K_TREM: run_trem(x, in, out, n); break;
    case K_RING: run_ring(x, in, out, n); break;
    case K_OCTUP: run_octup(x, in, out, n); break;
    case K_OCTDOWN: run_octdown(x, in, out, n); break;
    case K_PITCH: run_pitch(x, in, out, n); break;
    case K_FILTER: run_filter(x, in, out, n); break;
    case K_DELAY: run_delay(x, in, out, n); break;
    case K_REVDELAY: run_revdelay(x, in, out, n); break;
    case K_SPRING: run_spring(x, in, out, n); break;
    case K_VERB: run_verb(x, in, out, n); break;
    default: run_util(x, in, out, n); break;
  }
  for (int i = 0; i < n; i++) { float y = out[i]; if (!isfinite(y)) { mp_reset(x); for (int j = 0; j < n; j++) out[j] = 0; return; } out[i] = clampf(y, -4.f, 4.f); }
}
