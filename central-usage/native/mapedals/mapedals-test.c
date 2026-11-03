/* Tests for Central Pedals: every pedal alone stays finite and audible, each family does what it says, and what each
 * one costs (CPU per pedal at the rig's block of 128).   make -C central-usage/native test-mapedals
 * --cpu prints the cost table; --json prints the pedal table (tools/make-pedal-plugins.js reads it). */
#include "mapedals.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#define FS 48000
#define BLK 128
static int fails = 0, checks = 0;
#define CHECK(cond, ...) do { checks++; if (!(cond)) { fails++; printf("FAIL: "); printf(__VA_ARGS__); printf("\n"); } } while (0)

static float *buf(int n) { float *b = calloc((size_t)n, sizeof(float)); if (!b) exit(2); return b; }
static void sine(float *b, int n, double f, double a) { for (int i = 0; i < n; i++) b[i] = (float)(a * sin(2 * M_PI * f * i / FS)); }
static void pluck(float *b, int n) {   /* a guitar-ish line: notes every half second, harmonics, decaying */
  static const double notes[] = { 82.4, 110, 146.8, 196, 246.9, 329.6, 220, 164.8 };
  for (int i = 0; i < n; i++) {
    int k = i / (FS / 2); double t = (double)(i % (FS / 2)) / FS, f = notes[k % 8], s = 0;
    for (int h = 1; h <= 6; h++) s += sin(2 * M_PI * f * h * t) / (h * h);
    b[i] = (float)(0.4 * s * exp(-t * 4));
  }
}
static void run(MpFx *x, const float *in, float *out, int n) { for (int i = 0; i < n; i += BLK) mp_run(x, in + i, out + i, n - i < BLK ? n - i : BLK); }
static double rms(const float *b, int n) { double s = 0; for (int i = 0; i < n; i++) s += (double)b[i] * b[i]; return sqrt(s / (n > 0 ? n : 1)); }
static double db(double v) { return 20 * log10(v + 1e-12); }
static double goertzel(const float *b, int n, double f) {   /* the amplitude of one frequency */
  double w = 2 * M_PI * f / FS, c = 2 * cos(w), s1 = 0, s2 = 0;
  for (int i = 0; i < n; i++) { double s0 = b[i] * (0.5 - 0.5 * cos(2 * M_PI * i / n)) + c * s1 - s2; s2 = s1; s1 = s0; }
  return sqrt(s1 * s1 + s2 * s2 - c * s1 * s2) * 4 / n;
}
static MpFx *make(const char *id) { const MpDef *d = mp_find(id); if (!d) { printf("FAIL: no pedal %s\n", id); fails++; exit(1); } return mp_new(d, FS); }
static void set(MpFx *x, const char *id, const char *sym, float v) { int k = mp_ctl_index(mp_find(id), sym); if (k < 0) { printf("FAIL: %s has no %s\n", id, sym); fails++; return; } mp_set(x, k, v); }
static void tryset(MpFx *x, const char *id, const char *sym, float v) { int k = mp_ctl_index(mp_find(id), sym); if (k >= 0) mp_set(x, k, v); }
static void noise(float *b, int n, double a) { for (int i = 0; i < n; i++) b[i] = (float)(a * ((rand() / (double)RAND_MAX) * 2 - 1)); }
static double band(const float *b, int n, double f, double w) { double e = 0; for (double g = f - w; g <= f + w; g += 2) { double a = goertzel(b, n, g); e += a * a; } return sqrt(e); }
/* brightness: the share of energy above 1.5 kHz, in dB (a filter's or a cabinet's tone) */
static double bright(const float *b, int n) { double hi = 0, all = 0; for (double f = 80; f < 12000; f *= 1.09) { double a = goertzel(b, n, f); a *= a; all += a; if (f > 1500) hi += a; } return db(sqrt(hi / (all + 1e-30))); }
static int finite_all(const float *b, int n) { for (int i = 0; i < n; i++) if (!isfinite(b[i])) return 0; return 1; }
static double maxabs(const float *b, int n) { double m = 0; for (int i = 0; i < n; i++) if (fabs(b[i]) > m) m = fabs(b[i]); return m; }
/* how much the level wobbles: the spread of 10 ms block RMS values (after the first 0.3 s) */
static double wobble(const float *b, int n) {
  int w = FS / 100; double lo = 1e9, hi = 0; for (int i = FS * 3 / 10; i + w <= n; i += w) { double r = rms(b + i, w); if (r < lo) lo = r; if (r > hi) hi = r; } return db(hi) - db(lo);
}

static void test_every_pedal(void) {
  int n = FS * 4; float *in = buf(n), *out = buf(n); pluck(in, n);
  for (int i = 0; i < mp_count(); i++) {
    const MpDef *d = mp_def(i); MpFx *x = mp_new(d, FS); CHECK(x != NULL, "%s: mp_new", d->id); if (!x) continue;
    if (!strcmp(d->id, "ma_whammy")) set(x, d->id, "position", 1);
    run(x, in, out, n);
    double r = rms(out, n);
    CHECK(finite_all(out, n), "%s: not finite at its defaults", d->id);
    if (strcmp(d->id, "ma_mute")) CHECK(db(r) > -40 && db(r) < 6, "%s: level %.1f dBFS at its defaults (in %.1f)", d->id, db(r), db(rms(in, n)));
    CHECK(maxabs(out, n) <= 4.0, "%s: peaks past the limit", d->id);
    /* every knob at its lowest, then its highest, then random settings: still finite, never runs away */
    for (int pass = 0; pass < 6; pass++) {
      for (int k = 0; k < d->nctl; k++) {
        const MpCtl *c = &d->ctl[k]; float v = pass == 0 ? c->min : pass == 1 ? c->max : c->min + (c->max - c->min) * (float)rand() / (float)RAND_MAX;
        mp_set(x, k, v);
      }
      run(x, in, out, FS); CHECK(finite_all(out, FS), "%s: not finite (setting pass %d)", d->id, pass);
      CHECK(maxabs(out, FS) <= 4.0, "%s: past the limit (setting pass %d)", d->id, pass);
    }
    /* silence in, after the tails: no denormal hum, no DC creeping up */
    for (int k = 0; k < d->nctl; k++) mp_set(x, k, d->ctl[k].def);
    memset(in + FS, 0, sizeof(float) * FS);
    run(x, in, out, FS); float *sil = buf(FS * 8); float *so = buf(FS * 8); run(x, sil, so, FS * 8);
    if (strcmp(d->id, "ma_freeze")) CHECK(db(rms(so + FS * 7, FS)) < -60, "%s: silence in, %.1f dBFS out after 8 s", d->id, db(rms(so + FS * 7, FS)));
    free(sil); free(so); pluck(in, n);
    mp_free(x);
  }
  free(in); free(out);
}

static void test_families(void) {
  int n = FS; float *in = buf(n * 4), *out = buf(n * 4), *o2 = buf(n * 4);
  /* drives, fuzzes and amps add harmonics to a clean sine */
  const char *dirty[] = { "ma_clear_drive", "ma_mid_drive", "ma_blues_drive", "ma_gold_drive", "ma_brit_dist", "ma_hg_dist", "ma_ge_fuzz", "ma_si_fuzz", "ma_oct_fuzz", "ma_bass_drive", "ma_amp_crunch", "ma_amp_hg" };
  sine(in, n, 220, 0.3);
  for (unsigned i = 0; i < sizeof dirty / sizeof *dirty; i++) {
    MpFx *x = make(dirty[i]); tryset(x, dirty[i], "drive", 0.8f); tryset(x, dirty[i], "gain", 0.8f); run(x, in, out, n);
    double f = goertzel(out + n / 2, n / 2, 220), h = goertzel(out + n / 2, n / 2, 660) + goertzel(out + n / 2, n / 2, 440) + goertzel(out + n / 2, n / 2, 1100);
    CHECK(h / (f + 1e-9) > 0.05, "%s: harmonics/fundamental %.3f (should distort)", dirty[i], h / (f + 1e-9)); mp_free(x);
  }
  /* more drive, more harmonics */
  { MpFx *a = make("ma_brit_dist"), *b = make("ma_brit_dist"); set(a, "ma_brit_dist", "drive", 0.05f); set(b, "ma_brit_dist", "drive", 1); run(a, in, out, n); run(b, in, o2, n);
    double ha = goertzel(out + n / 2, n / 2, 660) / goertzel(out + n / 2, n / 2, 220), hb = goertzel(o2 + n / 2, n / 2, 660) / goertzel(o2 + n / 2, n / 2, 220);
    CHECK(hb > ha, "distortion: more drive should add harmonics (%.3f vs %.3f)", ha, hb); mp_free(a); mp_free(b); }
  /* the clean amp at low gain stays clean */
  { MpFx *x = make("ma_amp_clean"); set(x, "ma_amp_clean", "gain", 0); sine(in, n, 220, 0.1); run(x, in, out, n);
    double r = goertzel(out + n / 2, n / 2, 660) / goertzel(out + n / 2, n / 2, 220); CHECK(r < 0.05, "clean amp: 3rd harmonic %.3f at low gain", r); mp_free(x); }
  /* the amps' cabinet rolls off the fizz */
  { MpFx *a = make("ma_amp_crunch"), *b = make("ma_amp_crunch"); set(b, "ma_amp_crunch", "cab", 0); sine(in, n, 220, 0.3); run(a, in, out, n); run(b, in, o2, n);
    double fizz = db(band(out + n / 2, n / 2, 8000, 600) / band(out + n / 2, n / 2, 1000, 600)), fizz0 = db(band(o2 + n / 2, n / 2, 8000, 600) / band(o2 + n / 2, n / 2, 1000, 600));
    CHECK(fizz < fizz0 - 12, "amp: the cabinet should take off the fizz (8k vs 1k: %.1f dB, %.1f without)", fizz, fizz0); mp_free(a); mp_free(b); }
  /* compressors narrow the gap between loud and quiet */
  const char *comps[] = { "ma_studio_comp", "ma_opto_comp", "ma_squash_comp" };
  for (int c = 0; c < 3; c++) {
    for (int i = 0; i < n * 2; i++) in[i] = (float)((i / (FS / 2)) % 2 ? 0.02 : 0.6) * (float)sin(2 * M_PI * 330 * i / FS);
    MpFx *x = make(comps[c]); if (c == 0) set(x, comps[c], "threshold", -30); run(x, in, out, n * 2);
    double gapIn = db(rms(in + FS, FS / 2)) - db(rms(in + FS * 3 / 2, FS / 2)), gapOut = db(rms(out + FS, FS / 2)) - db(rms(out + FS * 3 / 2, FS / 2));
    CHECK(gapOut < gapIn - 6, "%s: loud-quiet gap %.1f dB in, %.1f dB out", comps[c], gapIn, gapOut); mp_free(x);
  }
  /* the gate shuts out hiss and lets playing through */
  { MpFx *x = make("ma_gate"); for (int i = 0; i < n; i++) in[i] = (float)(((rand() / (double)RAND_MAX) - 0.5) * 0.002); run(x, in, out, n);
    CHECK(db(rms(out + n / 2, n / 2)) < db(rms(in + n / 2, n / 2)) - 30, "gate: hiss %.1f dB in, %.1f out", db(rms(in, n)), db(rms(out + n / 2, n / 2)));
    sine(in, n, 220, 0.3); run(x, in, out, n); CHECK(fabs(db(rms(out + n / 2, n / 2)) - db(rms(in + n / 2, n / 2))) < 1, "gate: playing should pass"); mp_free(x); }
  /* tuner mute, volume pedal */
  { sine(in, n, 220, 0.3); MpFx *x = make("ma_mute"); run(x, in, out, n); CHECK(db(rms(out + n / 2, n / 2)) < -90, "tuner mute: not silent");
    set(x, "ma_mute", "mute", 0); run(x, in, out, n); CHECK(fabs(db(rms(out + n / 2, n / 2)) - db(rms(in, n))) < 0.5, "tuner mute: off should pass"); mp_free(x);
    x = make("ma_volume"); set(x, "ma_volume", "volume", 0); run(x, in, out, n); CHECK(db(rms(out + n / 2, n / 2)) < -90, "volume pedal: heel down should be silent");
    set(x, "ma_volume", "volume", 0.5f); run(x, in, out, n); double half = db(rms(out + n / 2, n / 2)) - db(rms(in, n)); CHECK(half < -6 && half > -20, "volume pedal: half way %.1f dB", half); mp_free(x); }
  /* EQs: a band boost boosts that band */
  { MpFx *x = make("ma_geq7"); set(x, "ma_geq7", "b800", 12); sine(in, n, 800, 0.1); run(x, in, out, n); double g = db(rms(out + n / 2, n / 2)) - db(rms(in + n / 2, n / 2));
    CHECK(g > 9 && g < 14, "graphic EQ: +12 at 800 Hz gives %.1f dB", g); sine(in, n, 6400, 0.1); run(x, in, out, n); g = db(rms(out + n / 2, n / 2)) - db(rms(in + n / 2, n / 2));
    CHECK(fabs(g) < 2, "graphic EQ: 6.4k should be untouched (%.1f dB)", g); mp_free(x);
    x = make("ma_peq"); set(x, "ma_peq", "midfreq", 2000); set(x, "ma_peq", "mid", -12); set(x, "ma_peq", "q", 2); sine(in, n, 2000, 0.1); run(x, in, out, n);
    g = db(rms(out + n / 2, n / 2)) - db(rms(in + n / 2, n / 2)); CHECK(g < -9, "parametric EQ: -12 at 2 kHz gives %.1f dB", g);
    set(x, "ma_peq", "lowcut", 300); sine(in, n, 60, 0.1); run(x, in, out, n); g = db(rms(out + n / 2, n / 2)) - db(rms(in + n / 2, n / 2)); CHECK(g < -12, "parametric EQ: low cut at 300 lets 60 Hz through (%.1f dB)", g); mp_free(x);
    x = make("ma_boost"); sine(in, n, 1000, 0.05); run(x, in, out, n); g = db(rms(out + n / 2, n / 2)) - db(rms(in + n / 2, n / 2)); CHECK(fabs(g - 8) < 1, "clean boost: +8 dB gives %.1f", g); mp_free(x); }
  /* the acoustic pedals change the tone, the notch cuts feedback */
  { MpFx *x = make("ma_ac_pre"); set(x, "ma_ac_pre", "notchon", 1); set(x, "ma_ac_pre", "notch", 150); sine(in, n, 150, 0.1); run(x, in, out, n);
    double g = db(rms(out + n / 2, n / 2)) - db(rms(in + n / 2, n / 2)); MpFx *y = make("ma_ac_pre"); run(y, in, o2, n); double g0 = db(rms(o2 + n / 2, n / 2)) - db(rms(in + n / 2, n / 2));
    CHECK(g < g0 - 12, "acoustic preamp: the notch should cut 150 Hz (%.1f vs %.1f dB)", g, g0); mp_free(x); mp_free(y);
    x = make("ma_ac_sim"); noise(in, n, 0.1); run(x, in, out, n); double air = db(band(out + n / 2, n / 2, 9000, 300) / band(out + n / 2, n / 2, 1500, 300)), air0 = db(band(in + n / 2, n / 2, 9000, 300) / band(in + n / 2, n / 2, 1500, 300));
    CHECK(air > air0 + 6, "acoustic sim: the air should open up over the piezo quack (9k vs 1.5k: %.1f dB, %.1f in)", air, air0); mp_free(x); }
  /* modulation moves: a steady sine comes out wobbling (or with new frequencies, for the ring modulator) */
  const char *mods[] = { "ma_chorus", "ma_tri_chorus", "ma_flanger", "ma_phaser", "ma_vibe", "ma_rotary", "ma_harm_trem", "ma_square_trem", "ma_autowah" };
  for (int m = 0; m < 9; m++) {
    for (int i = 0; i < n * 3; i++) in[i] = (float)(0.2 * (sin(2 * M_PI * 440 * i / FS) + 0.5 * sin(2 * M_PI * 1250 * i / FS)));
    MpFx *x = make(mods[m]); if (!strcmp(mods[m], "ma_rotary")) set(x, mods[m], "fast", 1); run(x, in, out, n * 3);
    double w = wobble(out + n, n * 2), w0 = wobble(in + n, n * 2);
    CHECK(w > w0 + 1.5, "%s: should move (level wobble %.1f dB)", mods[m], w); mp_free(x);
  }
  { MpFx *x = make("ma_square_trem"), *y = make("ma_harm_trem"); sine(in, n * 2, 440, 0.2); run(x, in, out, n * 2);
    CHECK(wobble(out + n, n) > 10, "square tremolo: deep chop (%.1f dB)", wobble(out + n, n)); mp_free(x); mp_free(y); }
  { MpFx *x = make("ma_ring"); set(x, "ma_ring", "mix", 1); set(x, "ma_ring", "freq", 300); sine(in, n, 440, 0.3); run(x, in, out, n);
    double c = goertzel(out + n / 2, n / 2, 440), sb = goertzel(out + n / 2, n / 2, 740) + goertzel(out + n / 2, n / 2, 140);
    CHECK(sb > 5 * c, "ring modulator: sidebands %.3f vs carrier %.3f", sb, c); mp_free(x); }
  /* pitch: the octaves and the harmonizer land on the right notes */
  { sine(in, n, 220, 0.3); MpFx *x = make("ma_octave_up"); set(x, "ma_octave_up", "dry", 0); run(x, in, out, n);
    CHECK(goertzel(out + n / 2, n / 2, 440) > 3 * goertzel(out + n / 2, n / 2, 220), "octave up: 440 %.3f vs 220 %.3f", goertzel(out + n / 2, n / 2, 440), goertzel(out + n / 2, n / 2, 220)); mp_free(x);
    x = make("ma_octave_down"); set(x, "ma_octave_down", "dry", 0); run(x, in, out, n);
    CHECK(goertzel(out + n / 2, n / 2, 110) > 2 * goertzel(out + n / 2, n / 2, 220), "octave down: 110 %.3f vs 220 %.3f", goertzel(out + n / 2, n / 2, 110), goertzel(out + n / 2, n / 2, 220));
    set(x, "ma_octave_down", "oct1", 0); set(x, "ma_octave_down", "oct2", 1); run(x, in, out, n);
    CHECK(goertzel(out + n / 2, n / 2, 55) > goertzel(out + n / 2, n / 2, 220), "octave down: two octaves should give 55 Hz"); mp_free(x);
    x = make("ma_harmonizer"); set(x, "ma_harmonizer", "interval", 7); set(x, "ma_harmonizer", "mix", 1); run(x, in, out, n);
    double fifth = 220 * pow(2, 7 / 12.0); CHECK(band(out + n / 2, n / 2, fifth, 40) > 0.1, "harmonizer: a fifth up (%.1f Hz) %.3f", fifth, band(out + n / 2, n / 2, fifth, 40)); mp_free(x);
    x = make("ma_whammy"); set(x, "ma_whammy", "position", 1); set(x, "ma_whammy", "range", 12); run(x, in, out, n);
    CHECK(band(out + n / 2, n / 2, 440, 40) > 3 * band(out + n / 2, n / 2, 220, 40), "whammy: toe down should be an octave up"); set(x, "ma_whammy", "position", 0); run(x, in, out, n);
    CHECK(goertzel(out + n / 2, n / 2, 220) > 0.25, "whammy: heel down should be the guitar"); mp_free(x); }
  /* filters: the wah's toe is brighter than its heel; the envelope filter opens when played harder */
  { noise(in, n, 0.2); MpFx *a = make("ma_wah"), *b = make("ma_wah"); set(a, "ma_wah", "position", 0); set(b, "ma_wah", "position", 1); run(a, in, out, n); run(b, in, o2, n);
    CHECK(bright(o2 + n / 2, n / 2) > bright(out + n / 2, n / 2) + 6, "wah: toe %.1f dB bright vs heel %.1f", bright(o2 + n / 2, n / 2), bright(out + n / 2, n / 2)); mp_free(a); mp_free(b);
    a = make("ma_env_filter"); b = make("ma_env_filter"); noise(in, n, 0.5); for (int i = 0; i < n; i++) o2[i] = in[i] * 0.02f; run(a, o2, out, n); float *o3 = buf(n); run(b, in, o3, n);
    CHECK(bright(o3 + n / 2, n / 2) > bright(out + n / 2, n / 2) + 3, "envelope filter: hard %.1f dB bright vs soft %.1f", bright(o3 + n / 2, n / 2), bright(out + n / 2, n / 2)); free(o3); mp_free(a); mp_free(b); pluck(in, n);
    a = make("ma_synth_filter"); run(a, in, out, n); CHECK(db(rms(out, n)) > -40, "synth filter: audible"); mp_free(a); }
  /* delays: an impulse comes back at the set time */
  struct { const char *id; double ms; } dl[] = { { "ma_digital_delay", 400 }, { "ma_analog_delay", 330 }, { "ma_tape_delay", 380 }, { "ma_dotted_delay", 60000.0 / 72 * 0.75 }, { "ma_multihead", 200 } };
  for (int k = 0; k < 5; k++) {
    memset(in, 0, sizeof(float) * n * 2); for (int i = 0; i < 48; i++) in[i] = (float)sin(M_PI * i / 48) * 0.8f;
    MpFx *x = make(dl[k].id); tryset(x, dl[k].id, "mod", 0); if (k == 4) set(x, dl[k].id, "heads", 1); run(x, in, out, n * 2);
    int from = 2000, best = from; for (int i = from; i < n * 2; i++) if (fabs(out[i]) > fabs(out[best])) best = i;
    double ms = (best - 24) * 1000.0 / FS; CHECK(fabs(ms - dl[k].ms) < 15, "%s: first repeat at %.0f ms (want %.0f)", dl[k].id, ms, dl[k].ms); mp_free(x);
  }
  { /* the reverse delay plays the note backwards: it swells up instead of decaying */
    memset(in, 0, sizeof(float) * n * 2); for (int i = 0; i < FS / 4; i++) in[i] = (float)(0.5 * exp(-i * 12.0 / FS) * sin(2 * M_PI * 330 * i / FS));
    MpFx *x = make("ma_reverse_delay"); set(x, "ma_reverse_delay", "feedback", 0); set(x, "ma_reverse_delay", "mix", 1); run(x, in, out, n * 2);
    int w = FS / 50, pk = 0; double best = 0; for (int i = FS / 2; i + w < n * 2; i += w) { double r = rms(out + i, w); if (r > best) { best = r; pk = i; } }
    double before = rms(out + pk - FS / 10, w), after = rms(out + pk + FS / 10, w);
    CHECK(before < best && after < best * 0.6 && best > 0.01, "reverse delay: should swell into a peak (%.3f before, %.3f peak, %.3f after)", before, best, after); mp_free(x); }
  /* reverbs: a tail that lasts about as long as asked, and the freeze holds */
  const char *verbs[] = { "ma_spring", "ma_plate", "ma_hall", "ma_shimmer", "ma_swell_verb", "ma_freeze" };
  for (int v = 0; v < 6; v++) {
    memset(in, 0, sizeof(float) * n * 4); for (int i = 0; i < FS / 10; i++) in[i] = (float)(0.5 * sin(2 * M_PI * 330 * i / FS));
    MpFx *x = make(verbs[v]); set(x, verbs[v], "mix", 1); run(x, in, out, n * 4);
    double t05 = rms(out + FS / 2, FS / 10), t3 = rms(out + FS * 3, FS / 10);
    CHECK(db(t05) > -50, "%s: no tail at 0.5 s (%.1f dB)", verbs[v], db(t05));
    CHECK(t3 < t05, "%s: the tail should fade (%.1f then %.1f dB)", verbs[v], db(t05), db(t3)); mp_free(x);
  }
  { MpFx *a = make("ma_plate"), *b = make("ma_hall"); set(a, "ma_plate", "mix", 1); set(b, "ma_hall", "mix", 1); set(a, "ma_plate", "decay", 1); set(b, "ma_hall", "decay", 6);
    run(a, in, out, n * 4); run(b, in, o2, n * 4); CHECK(rms(o2 + FS * 2, FS / 2) > rms(out + FS * 2, FS / 2) * 4, "reverb: a 6 s hall should outlast a 1 s plate"); mp_free(a); mp_free(b); }
  { MpFx *x = make("ma_freeze"); set(x, "ma_freeze", "mix", 1); sine(in, FS, 330, 0.3); memset(in + FS, 0, sizeof(float) * FS * 3); run(x, in, out, FS);
    set(x, "ma_freeze", "freeze", 1); run(x, in + FS, out + FS, FS * 3);
    double a1 = rms(out + FS + FS / 2, FS / 2), a3 = rms(out + FS * 3 + FS / 2, FS / 2);
    CHECK(a1 > 0.01 && a3 > a1 * 0.7, "freeze: should hold the sound (%.1f then %.1f dB)", db(a1), db(a3)); mp_free(x); }
  { /* shimmer adds an octave up into the tail */
    MpFx *a = make("ma_shimmer"), *b = make("ma_shimmer"); set(a, "ma_shimmer", "shimmer", 0); set(b, "ma_shimmer", "shimmer", 1); set(a, "ma_shimmer", "mix", 1); set(b, "ma_shimmer", "mix", 1);
    sine(in, FS / 2, 330, 0.3); memset(in + FS / 2, 0, sizeof(float) * FS * 3); run(a, in, out, FS * 3); run(b, in, o2, FS * 3);
    double ra = goertzel(out + FS * 2, FS / 2, 660) / (goertzel(out + FS * 2, FS / 2, 330) + 1e-9), rb = goertzel(o2 + FS * 2, FS / 2, 660) / (goertzel(o2 + FS * 2, FS / 2, 330) + 1e-9);
    CHECK(rb > ra * 2, "shimmer: the octave up should build in the tail (%.2f vs %.2f)", rb, ra); mp_free(a); mp_free(b); }
  { /* the swell fades each note in */
    pluck(in, n); MpFx *x = make("ma_swell_verb"); set(x, "ma_swell_verb", "mix", 0); set(x, "ma_swell_verb", "swell", 400); run(x, in, out, n);
    double early = rms(out + FS / 2, FS / 50), late = rms(out + FS / 2 + FS / 4, FS / 50), inEarly = rms(in + FS / 2, FS / 50), inLate = rms(in + FS / 2 + FS / 4, FS / 50);
    CHECK(late / (early + 1e-9) > inLate / (inEarly + 1e-9) * 2, "swell: notes should fade in"); mp_free(x); }
  free(in); free(out); free(o2);
}

static void cpu_table(int print) {
  int n = FS * 4; float *in = buf(n), *out = buf(n); pluck(in, n); double worst = 0, total = 0;
  if (print) printf("%-20s %10s %10s\n", "pedal", "ns/sample", "% of 1 core");
  for (int i = 0; i < mp_count(); i++) {
    const MpDef *d = mp_def(i); MpFx *x = mp_new(d, FS); if (!strcmp(d->id, "ma_whammy")) mp_set(x, mp_ctl_index(d, "position"), 0.7f);
    struct timespec a, b; clock_gettime(CLOCK_MONOTONIC, &a); run(x, in, out, n); clock_gettime(CLOCK_MONOTONIC, &b);
    double ns = ((b.tv_sec - a.tv_sec) * 1e9 + (b.tv_nsec - a.tv_nsec)) / n, pct = ns * FS / 1e7;
    if (print) printf("%-20s %10.1f %10.2f\n", d->id, ns, pct);
    if (ns > worst) worst = ns; total += ns; mp_free(x);
  }
  if (print) printf("worst %.1f ns/sample (%.2f%% of a core at 48 kHz), average %.1f\n", worst, worst * FS / 1e7, total / mp_count());
  free(in); free(out);
}

static void json(void) {
  printf("[\n");
  for (int i = 0; i < mp_count(); i++) {
    const MpDef *d = mp_def(i);
    printf("  {\"id\": \"%s\", \"name\": \"%s\", \"cat\": \"%s\", \"controls\": [", d->id, d->name, d->cat);
    for (int k = 0; k < d->nctl; k++) { const MpCtl *c = &d->ctl[k];
      printf("%s{\"sym\": \"%s\", \"name\": \"%s\", \"min\": %g, \"max\": %g, \"def\": %g, \"integer\": %s, \"unit\": \"%s\"}", k ? ", " : "", c->sym, c->name, c->min, c->max, c->def, c->integer ? "true" : "false", c->unit); }
    printf("]}%s\n", i + 1 < mp_count() ? "," : "");
  }
  printf("]\n");
}

int main(int argc, char **argv) {
  if (argc > 1 && !strcmp(argv[1], "--json")) { json(); return 0; }
  if (argc > 1 && !strcmp(argv[1], "--cpu")) { cpu_table(1); return 0; }
  srand(7);
  /* the table itself: unique ids, defaults inside their ranges */
  for (int i = 0; i < mp_count(); i++) { const MpDef *d = mp_def(i);
    for (int j = 0; j < i; j++) CHECK(strcmp(d->id, mp_def(j)->id), "duplicate id %s", d->id);
    CHECK(strncmp(d->id, "ma_", 3) == 0, "%s: ids start with ma_", d->id);
    for (int k = 0; k < d->nctl; k++) { const MpCtl *c = &d->ctl[k]; CHECK(c->min < c->max && c->def >= c->min && c->def <= c->max, "%s.%s: default outside its range", d->id, c->sym);
      for (int m = 0; m < k; m++) CHECK(strcmp(c->sym, d->ctl[m].sym), "%s: control %s twice", d->id, c->sym); } }
  test_every_pedal();
  test_families();
  cpu_table(0);
  printf("Central Pedals: %d pedals, %d checks, %d failed\n", mp_count(), checks, fails);
  return fails ? 1 : 0;
}
