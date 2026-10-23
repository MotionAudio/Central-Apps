/* Play any sound - the analysis and the synth mode. See playany.h.
 *
 * Signal flow (per input sample):
 *   input -> DC block -> [synth mode] band split -> squarer per band (+ sub octave) -> resonant low-pass that
 *                                     follows the playing -> swell / gate -> synth output
 *         -> anti-alias low-pass -> decimate to ~12 kHz (~6 kHz for bass) -> ring buffer
 *              per sample: onset detector (level rise + high-frequency burst)
 *              per hop (~1.3 ms): pitch (MPM normalised square difference, windowed from the onset so a
 *                                 note is found ~1.5-2 periods after the pluck), note on / off / bend
 *              per 4 hops (~5 ms): spectrum (FFT) -> peaks -> harmonic grouping = how many notes sound
 *   AUTO: a clear single pitch -> NOTE; no clear pitch by ~1.5 periods of the lowest note, or 2+ harmonic
 *         series in the spectrum -> CHORD (synth). */
#include "playany.h"
#include <math.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif
#define RB 8192                 /* ring of decimated samples (power of two) */
#define MAXTAU 1100             /* longest period (decimated samples) */
#define NFFT_MAX 1024
#define MAXPEAKS 48
#define NBANDS 6
#ifndef PA_EARLY
#define PA_EARLY 0.6f
#endif
#ifndef PA_LP
#define PA_LP 2000
#endif
#ifndef PA_AA
#define PA_AA 0.3
#endif
#ifndef PA_KMAX
#define PA_KMAX 0.85f
#endif

typedef struct { float b0, b1, b2, a1, a2, z1, z2; } Bq;
static inline float bq(Bq *f, float x) { float y = f->b0 * x + f->z1; f->z1 = f->b1 * x - f->a1 * y + f->z2; f->z2 = f->b2 * x - f->a2 * y; return y; }
static void bq_lp(Bq *f, double fs, double fc, double q) {
  double w = 2 * M_PI * fc / fs, c = cos(w), al = sin(w) / (2 * q), a0 = 1 + al;
  f->b0 = (float)((1 - c) / 2 / a0); f->b1 = (float)((1 - c) / a0); f->b2 = f->b0; f->a1 = (float)(-2 * c / a0); f->a2 = (float)((1 - al) / a0);
}
static void bq_hp(Bq *f, double fs, double fc, double q) {
  double w = 2 * M_PI * fc / fs, c = cos(w), al = sin(w) / (2 * q), a0 = 1 + al;
  f->b0 = (float)((1 + c) / 2 / a0); f->b1 = (float)(-(1 + c) / a0); f->b2 = f->b0; f->a1 = (float)(-2 * c / a0); f->a2 = (float)((1 - al) / a0);
}
static void bq_bp(Bq *f, double fs, double fc, double q) {   /* constant 0 dB peak */
  double w = 2 * M_PI * fc / fs, c = cos(w), al = sin(w) / (2 * q), a0 = 1 + al;
  f->b0 = (float)(al / a0); f->b1 = 0; f->b2 = (float)(-al / a0); f->a1 = (float)(-2 * c / a0); f->a2 = (float)((1 - al) / a0);
}
static float coef(double ms, double fs) { return ms <= 0 ? 0 : (float)exp(-1.0 / (ms * 0.001 * fs)); }
static inline float follow(float env, float x, float att, float rel) { return x > env ? x + (env - x) * att : x + (env - x) * rel; }
static inline float ftanh(float x) { if (x > 3) return 1; if (x < -3) return -1; float x2 = x * x; return x * (27 + x2) / (27 + 9 * x2); }
static float midi_hz(float m) { return 440.0f * powf(2.0f, (m - 69) / 12.0f); }
static float hz_midi(float f) { return 69 + 12 * log2f(f / 440.0f); }

static const struct { float att, rel, cut, envAmt, res, sub, level; } TONES[PA_TONES] = {
  /* pluck (pianos, keys, plucked) */ { 1.0f, 260, 520, 4200, 0.35f, 0.15f, 1.0f },
  /* pad (strings, choir, pads)    */ { 70, 600, 1500, 700, 0.25f, 0.20f, 1.1f },
  /* lead (brass, saw, square)     */ { 2.0f, 140, 850, 3600, 0.55f, 0.00f, 0.9f },
  /* bass                          */ { 1.5f, 90, 360, 1500, 0.40f, 0.70f, 1.1f },
  /* organ                         */ { 2.0f, 50, 2600, 0, 0.10f, 0.35f, 0.8f },
};

struct PlayAny {
  double fs, fa; int D;
  int mode, tone, chan, bend; float sens, synthGain;
  int lowNote, highNote;
  /* derived */
  int tauMin, tauMax, hop, nfft, specEvery;
  float gate, onsetRatio, cNote, cSustain, cChord, early;
  /* input conditioning + decimation */
  Bq dc, aa[2]; int dcount; float lpA, lpZ;
  float rb[RB]; long long t;          /* t: decimated samples so far */
  /* onset detector (decimated rate) */
  float hA[512], hD[512]; int lag;   /* the level and the high-frequency level ~8 ms ago */
  float ampF, dF, xPrev, aAmpF, rAmpF, aDF, rDF, aEnv, rEnv, env;
  long long lastOnset, t0;            /* t0: the onset the current analysis windows start from */
  /* pitch */
  float nsdf[MAXTAU + 2], lin[2 * MAXTAU + 64];
  float freq, clarity, mLast, noteHz, prevT, prevT2; long long prevAt; int variant, noteVariant, monoRun, virt; float mAvg; int sinceConf, moving; long long offAt;
  int hopCount;
  /* note state */
  int state, lastState, pending, note, vel, bendVal, cand, candCount, bendTick; float notePeak, onsetPeak; long long belowSince, pendingSince, idleAt;
  /* spectrum */
  float pre[NFFT_MAX / 2]; int hasPre;
  float win[NFFT_MAX], re[NFFT_MAX], im[NFFT_MAX], cs[NFFT_MAX / 2], sn[NFFT_MAX / 2];
  int voices, chordFrames; float second;
  /* synth (input rate) */
  Bq band[NBANDS]; float benv[NBANDS], benvA, benvR; int flip; float subEnv;
  float envIn, eA, eR, swell, swA, swR, gateOpen;
  float ic1, ic2, svfA1, svfA2, svfA3, svfK; int svfTick;
  float sGain, sGainStep;   /* the synth's on/off ramp */
  /* events */
  PaEvent *ev; int nev, maxEv, off;
};

/* ------------------------------------------------------------------ setup */
static void derive(PlayAny *p) {
  float s = p->sens;
  p->gate = powf(10.0f, (-42 - 28 * s) / 20);      /* -42 dBFS (s = 0) .. -70 dBFS (s = 1) */
  p->onsetRatio = 2.6f - 1.0f * s;
  p->cNote = 0.90f - 0.06f * s;                     /* clarity needed to start a note */
  p->cSustain = 0.70f - 0.10f * s;                  /* ...to keep following it */
  p->cChord = 0.62f;                                /* below this by the deadline: a chord */
  p->early = PA_EARLY;                              /* a note is decided after (1 + early) periods */
  double fLow = midi_hz((float)p->lowNote) / 1.06, fHigh = midi_hz((float)p->highNote) * 1.06;
  int D = (int)floor(p->fs / (p->highNote <= 72 ? 6000.0 : 12000.0) + 0.5); if (D < 1) D = 1;
  p->D = D; p->fa = p->fs / D;
  p->tauMax = (int)ceil(p->fa / fLow) + 2; if (p->tauMax > MAXTAU) p->tauMax = MAXTAU;
  p->tauMin = (int)floor(p->fa / fHigh) - 1; if (p->tauMin < 2) p->tauMin = 2;
  p->hop = p->tauMax / 10; if (p->hop < 12) p->hop = 12; if (p->hop > 32) p->hop = 32;
  p->nfft = p->fa / fLow > 120 ? 1024 : 512; if (p->nfft > NFFT_MAX) p->nfft = NFFT_MAX;
  while (p->nfft / 2 > 0 && p->nfft > 2 * p->tauMax * 4) p->nfft /= 2;
  if (p->nfft < 256) p->nfft = 256;
  p->specEvery = (int)(0.005 * p->fa / p->hop + 0.5); if (p->specEvery < 1) p->specEvery = 1;
  for (int i = 0; i < p->nfft; i++) p->win[i] = 0.5f - 0.5f * cosf((float)(2 * M_PI * i / (p->nfft - 1)));
  for (int i = 0; i < p->nfft / 2; i++) { p->cs[i] = cosf((float)(2 * M_PI * i / p->nfft)); p->sn[i] = -sinf((float)(2 * M_PI * i / p->nfft)); }
  double fa = p->fa;
  bq_hp(&p->dc, p->fs, 30, 0.707);
  double aaf = PA_AA * fa; if (aaf > 0.45 * p->fs) aaf = 0.45 * p->fs;
  bq_lp(&p->aa[0], p->fs, aaf, 0.5412); bq_lp(&p->aa[1], p->fs, aaf, 1.3066);
  p->lpA = PA_LP > 0 ? (float)(1 - exp(-2 * M_PI * PA_LP / fa)) : 0;
  p->aAmpF = coef(0.3, fa); p->rAmpF = coef(15, fa);
  p->aDF = coef(0.4, fa); p->rDF = coef(8, fa);
  p->aEnv = coef(1, fa); p->rEnv = coef(80, fa);
  p->lag = (int)(0.008 * fa); if (p->lag > 511) p->lag = 511; if (p->lag < 8) p->lag = 8;
  /* synth */
  static const float centers[NBANDS] = { 110, 175, 280, 440, 700, 1100 };
  float shift = p->lowNote < 36 ? 0.5f : 1.0f;
  for (int b = 0; b < NBANDS; b++) bq_bp(&p->band[b], p->fs, centers[b] * shift, 0.9);
  p->benvA = coef(0.4, p->fs); p->benvR = coef(18, p->fs);
  p->eA = coef(0.3, p->fs); p->eR = coef(60, p->fs);
  p->swA = coef(TONES[p->tone].att, p->fs); p->swR = coef(TONES[p->tone].rel, p->fs);
  p->sGainStep = (float)(1.0 / (0.004 * p->fs));
  p->svfK = 2 - 2 * TONES[p->tone].res;
}
PlayAny *pa_new(double fs) {
  PlayAny *p = calloc(1, sizeof *p); if (!p) return NULL;
  p->fs = fs > 8000 ? fs : 48000; p->mode = PA_AUTO; p->tone = PA_TONE_PLUCK; p->bend = 1; p->sens = 0.5f; p->synthGain = 1;
  p->lowNote = 40; p->highNote = 88;
  derive(p); pa_reset(p); return p;
}
void pa_free(PlayAny *p) { free(p); }
void pa_reset(PlayAny *p) {
  memset(p->rb, 0, sizeof p->rb); p->t = 0; p->dcount = 0;
  p->dc.z1 = p->dc.z2 = 0; p->lpZ = 0; for (int i = 0; i < 2; i++) p->aa[i].z1 = p->aa[i].z2 = 0;
  p->ampF = p->dF = p->xPrev = p->env = 0; p->lastOnset = -100000; p->t0 = -100000; memset(p->hA, 0, sizeof p->hA); memset(p->hD, 0, sizeof p->hD);
  p->freq = 0; p->clarity = 0; p->mLast = 0; p->sinceConf = 1000; p->moving = 0; p->noteHz = 0; p->prevT = 0; p->prevT2 = 0; p->prevAt = -100000; p->offAt = -100000; p->hopCount = 0;
  p->state = PA_IDLE; p->lastState = PA_IDLE; p->pending = 0; p->note = -1; p->vel = 0; p->bendVal = 8192; p->cand = -1; p->candCount = 0; p->bendTick = 0;
  p->notePeak = p->onsetPeak = 0; p->belowSince = -1; p->pendingSince = 0; p->idleAt = -100000;
  p->voices = 0; p->chordFrames = 0; p->second = 0; p->hasPre = 0;
  for (int b = 0; b < NBANDS; b++) { p->band[b].z1 = p->band[b].z2 = 0; p->benv[b] = 0; }
  p->flip = 0; p->subEnv = 0; p->envIn = 0; p->swell = 0; p->gateOpen = 0; p->ic1 = p->ic2 = 0; p->svfTick = 0; p->sGain = p->mode == PA_SYNTH ? 1 : 0;
}
void pa_set_mode(PlayAny *p, int m) { p->mode = m == PA_NOTES || m == PA_SYNTH ? m : PA_AUTO; }
void pa_set_sensitivity(PlayAny *p, float s) { p->sens = s < 0 ? 0 : s > 1 ? 1 : s; derive(p); }
void pa_set_range(PlayAny *p, int lo, int hi) {
  if (lo < 21) lo = 21; if (hi > 100) hi = 100; if (hi < lo + 12) hi = lo + 12;
  if (lo == p->lowNote && hi == p->highNote) return;
  p->lowNote = lo; p->highNote = hi; derive(p); pa_reset(p);
}
void pa_set_tone(PlayAny *p, int t) { p->tone = t >= 0 && t < PA_TONES ? t : PA_TONE_PLUCK; derive(p); }
void pa_set_channel(PlayAny *p, int c) { p->chan = c & 15; }
void pa_set_bend(PlayAny *p, int on) { p->bend = on ? 1 : 0; }
void pa_set_synth_level(PlayAny *p, float g) { p->synthGain = g < 0 ? 0 : g > 4 ? 4 : g; }

int pa_tone_for_name(const char *name) {
  char s[128]; size_t k = 0; if (!name) return PA_TONE_PLUCK;
  for (; name[k] && k + 1 < sizeof s; k++) s[k] = (char)tolower((unsigned char)name[k]); s[k] = 0;
  static const char *pad[] = { "pad", "string", "choir", "voice", "vox", "warm", "halo", "ambient", "atmos", "swell", "cello", "viol", "orchestra", "ensemble", "aah", "ooh", NULL };
  static const char *lead[] = { "lead", "brass", "saw", "square", "trumpet", "horn", "sax", "trombone", "synth", "chiptune", "fifths", NULL };
  static const char *bass[] = { "bass", "sub", "808", NULL };
  static const char *organ[] = { "organ", "hammond", "b3", "drawbar", "accordion", "harmonium", NULL };
  for (int i = 0; bass[i]; i++) if (strstr(s, bass[i])) return PA_TONE_BASS;
  for (int i = 0; organ[i]; i++) if (strstr(s, organ[i])) return PA_TONE_ORGAN;
  for (int i = 0; pad[i]; i++) if (strstr(s, pad[i])) return PA_TONE_PAD;
  for (int i = 0; lead[i]; i++) if (strstr(s, lead[i])) return PA_TONE_LEAD;
  return PA_TONE_PLUCK;
}
int pa_latency_hint(const PlayAny *p, int note) {
  float tau = (float)(p->fa / midi_hz((float)note));
  return (int)(((1 + p->early) * tau + p->hop) * p->D);
}
void pa_info(const PlayAny *p, PaInfo *in) {
  in->state = p->state; in->note = p->note; in->freq = p->freq; in->clarity = p->clarity; in->voices = p->voices;
  in->levelDb = p->env > 1e-6f ? 20 * log10f(p->env) : -120;
}

/* ------------------------------------------------------------------ events */
static void emit(PlayAny *p, int st, int d1, int d2) {
  if (p->nev >= p->maxEv || !p->ev) return;
  p->ev[p->nev++] = (PaEvent){ p->off, (uint8_t)(st | p->chan), (uint8_t)(d1 & 127), (uint8_t)(d2 & 127) };
}
static void note_off(PlayAny *p) { if (p->note >= 0) { emit(p, 0x80, p->note, 0); p->offAt = p->t; } p->note = -1; }
static void bend_to(PlayAny *p, int v) { if (v < 0) v = 0; if (v > 16383) v = 16383; if (v == p->bendVal) return; p->bendVal = v; emit(p, 0xE0, v & 127, v >> 7); }
static void note_on(PlayAny *p, int n, int vel) {
  note_off(p); if (p->bendVal != 8192) bend_to(p, 8192);
  if (n < 0 || n > 127) return; if (vel < 1) vel = 1; if (vel > 127) vel = 127;
  emit(p, 0x90, n, vel); p->note = n; p->vel = vel; p->cand = -1; p->candCount = 0; p->mAvg = (float)n;
}
int pa_all_notes_off(PlayAny *p, PaEvent *ev, int maxEv) {
  p->ev = ev; p->nev = 0; p->maxEv = maxEv; p->off = 0; note_off(p); if (p->bendVal != 8192) bend_to(p, 8192); p->ev = NULL;
  if (p->state == PA_NOTE) p->state = PA_IDLE; return p->nev;
}
static int velocity_of(PlayAny *p, float peak) {
  float db = peak > 1e-7f ? 20 * log10f(peak) : -140, g = 20 * log10f(p->gate), x = (db - g) / (-8 - g);
  if (x < 0) x = 0; if (x > 1) x = 1;
  return 28 + (int)(99 * powf(x, 0.8f));
}

static inline float ring_at(const PlayAny *p, double t) {   /* the decimated signal at a fractional time */
  long long i = (long long)floor(t); float f = (float)(t - (double)i);
  return (1 - f) * p->rb[i & (RB - 1)] + f * p->rb[(i + 1) & (RB - 1)];
}
/* ------------------------------------------------------------------ pitch: MPM normalised square difference over the newest samples */
/* x: the newest n samples (n from the onset: the window never reaches back past it). Returns the period
 * (decimated samples, 0 = none) and its clarity (the NSDF peak, 0..1). */
static float mpm(PlayAny *p, const float *x, int n, int early, float *clarityOut) {
  *clarityOut = 0;
  int Wcap = p->tauMax; if (Wcap < 64) Wcap = 64;
  float ratio = early ? p->early : 1.0f;
  int tauTop = (int)(n / (1 + ratio)); if (tauTop > p->tauMax) tauTop = p->tauMax;
  if (tauTop < p->tauMin + 2) return 0;
  /* nsdf(tau) = 2 sum x_j x_{j+tau} / sum (x_j^2 + x_{j+tau}^2), over the newest W(tau) pairs */
  for (int tau = 1; tau <= tauTop + 1 && tau <= MAXTAU; tau++) {
    int W = n - tau; if (W > Wcap) W = Wcap; if (W < 8) { p->nsdf[tau] = 0; continue; }
    const float *a = x + (n - tau - W), *b = a + tau; float r = 0, m = 0;
    for (int j = 0; j < W; j++) { r += a[j] * b[j]; m += a[j] * a[j] + b[j] * b[j]; }
    p->nsdf[tau] = m > 1e-12f ? 2 * r / m : 0;
  }
  /* key maxima: the highest point of every positive lobe after the first negative-going zero crossing */
  float kmT[64], kmV[64]; int nk = 0, tau = 1;
  while (tau <= tauTop && p->nsdf[tau] > 0) tau++;        /* the zero-lag lobe */
  float best = 0; int bestT = 0, inLobe = 0;
  for (; tau <= tauTop; tau++) {
    float v = p->nsdf[tau];
    if (v > 0 && !inLobe) { inLobe = 1; best = v; bestT = tau; }
    else if (inLobe && v > best) { best = v; bestT = tau; }
    if (inLobe && (v <= 0 || tau == tauTop)) {
      int complete = v <= 0 || bestT < tauTop - 1;
      if (complete && bestT >= p->tauMin && nk < 64) {   /* (its height between the lags: high notes are only ~10 lags long) */
        float y0 = p->nsdf[bestT - 1], y2 = p->nsdf[bestT + 1], den = y0 - 2 * best + y2, d = fabsf(den) > 1e-9f ? 0.5f * (y0 - y2) / den : 0;
        if (d > 0.5f) d = 0.5f; if (d < -0.5f) d = -0.5f;
        kmT[nk] = (float)bestT; kmV[nk] = best - 0.25f * (y0 - y2) * d; nk++;
      }
      inLobe = 0;
    }
  }
  if (!nk) return 0;
  float top = 0; for (int i = 0; i < nk; i++) if (kmV[i] > top) top = kmV[i];
  int pick = 0; for (int i = 0; i < nk; i++) if (kmV[i] >= (kmT[i] < 30 ? 0.75f : PA_KMAX) * top) { pick = i; break; }   /* (short lags: sampled coarsely, their peaks read low) */
  int T = (int)kmT[pick]; float y0 = p->nsdf[T - 1], y1 = p->nsdf[T], y2 = p->nsdf[T + 1], den = y0 - 2 * y1 + y2;
  float d = fabsf(den) > 1e-9f ? 0.5f * (y0 - y2) / den : 0; if (d > 0.5f) d = 0.5f; if (d < -0.5f) d = -0.5f;
  *clarityOut = y1 - 0.25f * (y0 - y2) * d;
  return T + d;
}
/* The pitch of what was played since the onset. The notes before it may still ring (a lead line across strings):
 * besides the signal as it is (variant 0), it is also analysed with them cancelled by comb filters at their
 * periods, y[t] = x[t] - g x[t - T] (variant 1: the note before, 2: the two before) - the new note keeps its own
 * period through the filters. The clearest wins (a re-plucked same note is clearest as it is). While a note sounds,
 * only the variant it was found with is followed. */
static float pitch(PlayAny *p, long long n, float *clarityOut, int early, int only) {
  int L = 2 * p->tauMax + 8; if ((long long)L > p->t) L = (int)p->t;
  if (n > L) n = L;
  *clarityOut = 0; if (n < 24) return 0;
  float *x = p->lin; long long s = p->t - n;
  float bestT = 0, bestC = -1; int bestV = 0;
  int vmax = p->prevT2 > 1 ? 2 : p->prevT > 1 ? 1 : 0;
  for (int v = 0; v <= vmax; v++) {
    if (only >= 0 && v != only) continue;
    for (int i = 0; i < n; i++) {
      long long j = s + i; float y = p->rb[j & (RB - 1)];
      if (v >= 1) y -= 0.98f * ring_at(p, (double)j - p->prevT);
      if (v == 2) y -= 0.98f * (ring_at(p, (double)j - p->prevT2) - 0.98f * ring_at(p, (double)j - p->prevT2 - p->prevT));
      x[i] = y;
    }
    float c, T = mpm(p, x, (int)n, early, &c);
    if (T > 0 && c + (v ? 0.03f : 0) > bestC) { bestC = c + (v ? 0.03f : 0); bestT = T; bestV = v; }
  }
  if (bestT <= 0) return 0;
  p->variant = bestV; *clarityOut = bestC - (bestV ? 0.03f : 0);
  return bestT;
}

/* ------------------------------------------------------------------ spectrum: how many harmonic series (notes) sound */
static void fft(PlayAny *p, int N) {
  float *re = p->re, *im = p->im;
  for (int i = 1, j = 0; i < N; i++) { int bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { float t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (int len = 2; len <= N; len <<= 1) {
    int step = N / len;
    for (int i = 0; i < N; i += len) for (int k = 0; k < len / 2; k++) {
      float wr = p->cs[k * step], wi = p->sn[k * step], ur = re[i + k], ui = im[i + k];
      float vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi, vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
      re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
    }
  }
}
static void power_spectrum(PlayAny *p) {   /* the newest nfft samples -> p->re[k] = power (k < nfft/2) */
  int N = p->nfft; long long s = p->t - N;
  for (int i = 0; i < N; i++) { p->re[i] = (s + i >= 0 ? p->rb[(s + i) & (RB - 1)] : 0) * p->win[i]; p->im[i] = 0; }
  fft(p, N);
  for (int k = 0; k < N / 2; k++) p->re[k] = p->re[k] * p->re[k] + p->im[k] * p->im[k];
}
static void spectrum(PlayAny *p) {
  int N = p->nfft;
  power_spectrum(p);
  float binHz = (float)(p->fa / N), fLow = midi_hz((float)p->lowNote) * 0.94f, fTop = (float)(p->fa * 0.42);
  int k0 = (int)(fLow / binHz); if (k0 < 2) k0 = 2; int k1 = (int)(fTop / binHz); if (k1 > N / 2 - 2) k1 = N / 2 - 2;
  float *mag = p->re;   /* power, in place */
  float mx = 0; for (int k = k0; k <= k1; k++) if (mag[k] > mx) mx = mag[k];
  p->voices = 0; p->second = 0; p->virt = 0;
  if (mx <= 1e-12f) return;
  float pf[MAXPEAKS], pa[MAXPEAKS]; int np = 0; float floorP = mx * 3.2e-4f;   /* -35 dB */
  for (int k = k0; k <= k1; k++) {
    if (mag[k] > floorP && mag[k] > mag[k - 1] && mag[k] >= mag[k + 1]) {
      /* only what is new since the onset: notes from before it (still ringing, decaying) are not what is played now -
         a peak counts when it is at least 6 dB above the spectrum just before the onset */
      if (p->hasPre) { float pr = p->pre[k]; if (p->pre[k - 1] > pr) pr = p->pre[k - 1]; if (p->pre[k + 1] > pr) pr = p->pre[k + 1]; if (mag[k] < 4 * pr) continue; }
      float a = logf(mag[k - 1] + 1e-20f), b = logf(mag[k] + 1e-20f), c = logf(mag[k + 1] + 1e-20f), den = a - 2 * b + c;
      float d = fabsf(den) > 1e-9f ? 0.5f * (a - c) / den : 0; if (d > 0.5f) d = 0.5f; if (d < -0.5f) d = -0.5f;
      float pw = mag[k - 1] + mag[k] + mag[k + 1];
      if (np < MAXPEAKS) { pf[np] = (k + d) * binHz; pa[np] = pw; np++; }
      else { int w = 0; for (int i = 1; i < np; i++) if (pa[i] < pa[w]) w = i; if (pw > pa[w]) { pf[w] = (k + d) * binHz; pa[w] = pw; } }
    }
  }
  if (!np) return;
  float total = 0; for (int i = 0; i < np; i++) total += pa[i];
  int used[MAXPEAKS] = { 0 }; float gE[8]; int ng = 0;
  float trF = p->clarity >= 0.9f ? p->freq : 0;   /* the pitch tracker's clear pitch: its series first (a weak fundamental) */
  for (int round = 0; round < 8 && ng < 8; round++) {
    float left = 0, strongest = 0; for (int i = 0; i < np; i++) if (!used[i]) { left += pa[i]; if (pa[i] > strongest) strongest = pa[i]; }
    if (left < 0.10f * total) break;
    int lo = -1; for (int i = 0; i < np; i++) if (!used[i] && pa[i] >= 0.05f * strongest && (lo < 0 || pf[i] < pf[lo])) lo = i;
    if (lo < 0) break;
    float f0 = pf[lo];
    if (round == 0 && trF > 0) {
      for (int k = 1; k <= 4; k++) if (fabsf(f0 / k - trF) < 0.03f * trF) {
        /* (only when its own fundamental is there at all: a power chord also looks like one low note) */
        int kk = (int)(trF / binHz + 0.5f), isPeak = 0;   /* a real peak at the fundamental, at most 30 dB down */
        for (int q = kk - 1; q <= kk + 1; q++) if (q > 1 && q < N / 2 - 2 && mag[q] > mx * 1e-3f && mag[q] >= mag[q - 1] && mag[q] >= mag[q + 1] && mag[q] > 2 * mag[q - 2] && mag[q] > 2 * mag[q + 2]) isPeak = 1;
        if (isPeak) f0 = trF; else if (k > 1) p->virt = 1;   /* (no fundamental: a "virtual" pitch made by several notes) */
        break;
      }
    }
    float e = 0;
    for (int i = 0; i < np; i++) {
      if (used[i]) continue;
      int h = (int)(pf[i] / f0 + 0.5f); if (h < 1 || h > 32) continue;
      float tol = 0.022f * h * f0; if (tol < 0.6f * binHz) tol = 0.6f * binHz;
      if (fabsf(pf[i] - h * f0) <= tol) { used[i] = 1; e += pa[i]; }
    }
    if (e <= 0) { used[lo] = 1; e = pa[lo]; }
    if (e >= 0.06f * total) gE[ng++] = e;
  }
  float e1 = 0, e2 = 0; for (int i = 0; i < ng; i++) { if (gE[i] > e1) { e2 = e1; e1 = gE[i]; } else if (gE[i] > e2) e2 = gE[i]; }
  p->voices = ng; p->second = e1 > 0 ? e2 / e1 : 0;
}

/* ------------------------------------------------------------------ the per-hop decisions */
static void decide(PlayAny *p) {
  long long n = p->t - p->t0; float cl = 0;
  int early = p->pending;
  float T = pitch(p, early ? n : (n < 2 * p->tauMax + 8 ? n : 2 * p->tauMax + 8), &cl, early, p->state == PA_NOTE && !early ? p->noteVariant : -1);
  float f = T > 0 ? (float)(p->fa / T) : 0, m = f > 0 ? hz_midi(f) : 0;
  int inRange = f > 0 && m > p->lowNote - 0.6f && m < p->highNote + 0.6f;
  p->clarity = inRange ? cl : 0; if (inRange) p->freq = f;
  p->hopCount++;
  if (p->hopCount % p->specEvery == 0 && p->env > p->gate) {
    spectrum(p);
    long long post = p->t - p->t0; float postFrac = post >= p->nfft ? 1.0f : (float)post / p->nfft;
    int chordy = p->voices >= 2 && p->second >= 0.2f;
    if (postFrac >= 0.5f) p->chordFrames = chordy ? p->chordFrames + 1 : 0;
  }
  int notesOk = p->mode != PA_SYNTH, chordsOk = p->mode != PA_NOTES;
  float noteM = p->note >= 0 ? p->note + (p->bendVal - 8192) / 8191.0f * 2.0f : 0;

  if (p->pending) {
    long long waited = p->t - p->pendingSince;
    int conf = inRange && cl >= p->cNote;
    int chordNow = chordsOk && p->chordFrames >= 1;
    if (notesOk && conf && !chordNow) {
      int c = (int)floorf(m + 0.5f);
      if (c == p->cand) p->candCount++; else { p->cand = c; p->candCount = 1; }
      if (p->candCount >= 2 || cl >= 0.97f) {
        float pk = p->onsetPeak > p->ampF ? p->onsetPeak : p->ampF;
        note_on(p, c, velocity_of(p, pk)); p->noteHz = f; p->noteVariant = p->variant; p->pending = 0; p->state = PA_NOTE; p->notePeak = pk; p->mLast = m; p->sinceConf = 0;
        return;   /* (no bend yet: the first estimates, from a short window, wobble a little - bends follow once it is full) */
      }
    } else if (!conf) { p->cand = -1; p->candCount = 0; }
    long long deadline = (long long)(p->tauMax * (1 + p->early)) + 2 * p->hop;
    if (chordsOk && (chordNow || (!notesOk) || (waited >= deadline && (p->clarity < p->cChord || !inRange)))) {
      note_off(p); p->pending = 0; p->state = PA_CHORD; return;
    }
    if (waited >= deadline + 4 * p->hop) {   /* nothing clear in time: keep what was playing (or stop) */
      p->pending = 0;
      if (p->state == PA_NOTE && !(inRange && cl >= p->cSustain)) { note_off(p); p->state = chordsOk ? PA_CHORD : PA_IDLE; }
      else if (p->state == PA_IDLE && chordsOk) p->state = PA_CHORD;
    }
    return;
  }

  if (p->state == PA_CHORD && p->mode == PA_AUTO) {
    /* a single note after all (its attack was messy): a clear pitch and one harmonic series for ~8 ms, soon after the pluck */
    if (inRange && cl >= 0.95f && p->voices == 1 && p->second < 0.1f && p->t - p->lastOnset < (long long)(0.3 * p->fa)) {
      if (++p->monoRun >= 6) { int c = (int)floorf(m + 0.5f); p->monoRun = 0; note_on(p, c, velocity_of(p, p->onsetPeak)); p->noteHz = f; p->noteVariant = p->variant; p->state = PA_NOTE; p->notePeak = p->onsetPeak; p->mLast = m; }
    } else p->monoRun = 0;
    return;
  }
  if (p->state == PA_NOTE) {
    /* a chord after all (2+ notes in the spectrum, several frames running) */
    if (chordsOk && p->chordFrames >= 2) { note_off(p); p->state = PA_CHORD; return; }
    if (inRange && cl >= p->cSustain) {
      /* the estimate moving fast (> 0.2 semitone a hop) is the window sliding across a note change: wait for it
         to settle. Settled away from the note -> a new note (legato: hammer-on, pull-off, slide; or an octave
         correction). Moving slowly -> a bend or vibrato: pitch bend. */
      int c = (int)floorf(m + 0.5f);
      if (fabsf(m - p->mLast) > 0.2f) p->moving = 3; else if (p->moving > 0) p->moving--;
      p->mLast = m; p->sinceConf = 0; p->noteHz = f;
      if (p->moving) { p->cand = -1; p->candCount = 0; return; }
      if (fabsf(m - noteM) > 0.5f && c != p->note && !p->virt) {
        if (c == p->cand) p->candCount++; else { p->cand = c; p->candCount = 1; }
        if (p->candCount >= 2 && cl >= p->cNote) note_on(p, c, p->vel);
      } else if (p->bend && p->note >= 0 && n >= p->tauMax * 2) {
        p->cand = -1; p->candCount = 0;
        p->mAvg += (m - p->mAvg) * 0.35f;   /* (smoothed: the estimate wobbles a few cents hop to hop) */
        float dev = p->mAvg - p->note;
        if (fabsf(m - p->note) > 2.0f) note_on(p, c, p->vel);
        else if (++p->bendTick >= 3) { p->bendTick = 0; int bv = fabsf(dev) < 0.06f ? 8192 : 8192 + (int)lrintf(dev / 2.0f * 8191); if (abs(bv - p->bendVal) > 200 || (bv == 8192 && p->bendVal != 8192)) bend_to(p, bv); }
      }
      return;
    } else p->sinceConf++;
  }
}

/* ------------------------------------------------------------------ one decimated sample: onset + level, and a hop now and then */
static void analyse(PlayAny *p, float x) {
  /* the pitch analysis gets it a little darker (a bright high note is then found at its own period, not an octave
     down); the level and the onsets are measured on it as it is */
  if (p->lpA > 0) p->lpZ += (x - p->lpZ) * p->lpA; else p->lpZ = x;
  p->rb[p->t & (RB - 1)] = p->lpZ; p->t++;
  float a = fabsf(x), d = fabsf(x - p->xPrev); p->xPrev = x;
  p->ampF = follow(p->ampF, a, p->aAmpF, p->rAmpF); p->dF = follow(p->dF, d, p->aDF, p->rDF);
  p->env = follow(p->env, a, p->aEnv, p->rEnv);
  long long refr = (long long)(0.045 * p->fa);
  int h = (int)(p->t & 511), hl = (int)((p->t - p->lag) & 511); float prevA = p->hA[hl], prevD = p->hD[hl]; p->hA[h] = p->ampF; p->hD[h] = p->dF;
  /* a pluck: the level at least doubles within ~8 ms, or a burst of high frequencies (the pick) */
  int level = p->ampF > p->gate && p->ampF > 2.0f * prevA + p->gate * 0.3f;
  int burst = p->ampF > p->gate * 0.7f && p->dF > p->onsetRatio * prevD + p->gate * 0.02f && p->dF > 0.15f * p->ampF;
  if ((level || burst) && p->t - p->lastOnset > refr) {
    p->lastOnset = p->t; p->t0 = p->t - 3; p->onsetPeak = 0;
    power_spectrum(p); memcpy(p->pre, p->re, sizeof(float) * (size_t)(p->nfft / 2)); p->hasPre = 1;   /* what sounded just before */
    /* the note that was sounding (or just ended - its string may still ring): cancelled from the analysis */
    float nt = p->noteHz > 0 && (p->note >= 0 || p->t - p->offAt < (long long)(0.25 * p->fa)) ? (float)(p->fa / p->noteHz) : 0;
    p->prevT2 = p->prevT > 1 && nt > 1 && fabsf(p->prevT - nt) > 0.02f * nt && p->t - p->prevAt < (long long)(0.6 * p->fa) ? p->prevT : 0;
    p->prevT = nt; p->prevAt = p->t;
    if (p->mode != PA_SYNTH || p->state != PA_CHORD) { p->pending = 1; p->pendingSince = p->t; p->cand = -1; p->candCount = 0; p->chordFrames = 0; }
    /* strumming again after a short rest: the synth starts at once (a single note found in the next few ms takes over) */
    if (p->mode == PA_AUTO && p->state == PA_IDLE && p->lastState == PA_CHORD && p->t - p->idleAt < (long long)(2.0 * p->fa)) p->state = PA_CHORD;
  }
  if (p->t - p->lastOnset < (long long)(0.02 * p->fa) && p->ampF > p->onsetPeak) p->onsetPeak = p->ampF;
  if (p->state == PA_NOTE && p->ampF > p->notePeak) p->notePeak = p->ampF;
  /* the end of a note: quiet (below the gate, or 40 dB under its peak) for 20 ms */
  if (p->state != PA_IDLE) {
    float floorL = p->gate; if (p->state == PA_NOTE && p->notePeak * 0.01f > floorL) floorL = p->notePeak * 0.01f;
    if (p->env < floorL) { if (p->belowSince < 0) p->belowSince = p->t; else if (p->t - p->belowSince > (long long)(0.02 * p->fa)) { note_off(p); p->lastState = p->state; p->state = PA_IDLE; p->idleAt = p->t; p->pending = 0; p->belowSince = -1; } }
    else p->belowSince = -1;
  }
  if (p->mode == PA_SYNTH && p->env > p->gate) p->state = PA_CHORD;
  if (p->t % p->hop == 0 && (p->env > p->gate * 0.5f || p->state != PA_IDLE || p->pending)) decide(p);
}

/* ------------------------------------------------------------------ process */
int pa_process(PlayAny *p, const float *in, float *out, int n, PaEvent *ev, int maxEv) {
  p->ev = ev; p->nev = 0; p->maxEv = maxEv;
  const float subAmt = TONES[p->tone].sub, cut = TONES[p->tone].cut, envAmt = TONES[p->tone].envAmt, lvl = TONES[p->tone].level;
  for (int i = 0; i < n; i++) {
    p->off = i;
    float x = in ? in[i] : 0; if (!(x == x) || x > 4 || x < -4) x = 0;
    x = bq(&p->dc, x);
    /* --- analysis (decimated) */
    float y = x; if (p->D > 1) { y = bq(&p->aa[0], y); y = bq(&p->aa[1], y); }
    if (++p->dcount >= p->D) { p->dcount = 0; analyse(p, y); }
    /* --- synth mode */
    float a = fabsf(x); p->envIn = follow(p->envIn, a, p->eA, p->eR);
    int wantSynth = p->mode == PA_SYNTH || (p->mode == PA_AUTO && p->state == PA_CHORD);
    float target = wantSynth ? 1.0f : 0.0f;
    if (p->sGain < target) { p->sGain += p->sGainStep; if (p->sGain > target) p->sGain = target; } else if (p->sGain > target) { p->sGain -= p->sGainStep; if (p->sGain < target) p->sGain = target; }
    if (!out) continue;
    if (p->sGain <= 0 && p->swell <= 1e-5f) { out[i] = 0; p->swell = 0; continue; }
    float sum = 0, low = 0;
    for (int b = 0; b < NBANDS; b++) {   /* a square wave per band (per string region), as loud as the band */
      float xb = bq(&p->band[b], x), ab = fabsf(xb);
      p->benv[b] = follow(p->benv[b], ab, p->benvA, p->benvR);
      sum += ftanh(7.0f * xb / (p->benv[b] + 2e-4f)) * p->benv[b];
      if (b < 2) low += xb;
    }
    if (subAmt > 0) {   /* sub octave: a divide-by-two flip-flop on the lowest bands' zero crossings (with hysteresis) */
      float lb = p->benv[0] + p->benv[1], h = 0.25f * lb;
      if ((p->flip & 1) == 0 && low > h) p->flip = (p->flip + 1) & 3; else if ((p->flip & 1) == 1 && low < -h) p->flip = (p->flip + 1) & 3;
      p->subEnv = follow(p->subEnv, lb, p->benvA, p->benvR);
      sum += (p->flip < 2 ? 1.0f : -1.0f) * p->subEnv * subAmt;
    }
    /* the filter, following the playing */
    if (p->svfTick-- <= 0) {
      p->svfTick = 15;
      float e = p->envIn * 4; if (e > 1) e = 1;
      float fc = cut + envAmt * e; if (fc > 0.42f * (float)p->fs) fc = 0.42f * (float)p->fs; if (fc < 60) fc = 60;
      float g = tanf((float)M_PI * fc / (float)p->fs); p->svfA1 = 1 / (1 + g * (g + p->svfK)); p->svfA2 = g * p->svfA1; p->svfA3 = g * p->svfA2;
    }
    float v3 = sum - p->ic2, v1 = p->svfA1 * p->ic1 + p->svfA2 * v3, v2 = p->ic2 + p->svfA2 * p->ic1 + p->svfA3 * v3;
    p->ic1 = 2 * v1 - p->ic1; p->ic2 = 2 * v2 - p->ic2;
    /* swell (the voice's attack / release) and gate */
    if (p->envIn > p->gate * 1.6f) p->gateOpen = 1; else if (p->envIn < p->gate) p->gateOpen = 0;
    p->swell = follow(p->swell, p->gateOpen ? 1.0f : 0.0f, p->swA, p->swR);
    float o = v2 * p->swell * p->sGain * p->synthGain * lvl * 0.8f;
    out[i] = o > 1.5f ? 1.5f : o < -1.5f ? -1.5f : o;
  }
  p->ev = NULL; return p->nev;
}
