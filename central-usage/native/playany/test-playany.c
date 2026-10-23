/* Unit test for playany.c with synthetic signals: sine tones, plucked strings (additive, with pluck position,
 * per-harmonic decay and string inharmonicity), lead lines, strummed chords, bends, legato, noise.
 * Measures pitch accuracy, lead-vs-chord detection and latency in samples, and fails (exit 1) when they are
 * worse than the targets. Build: cc -O2 -o test-playany test-playany.c playany.c -lm
 * Run: ./test-playany [-v]   (48 kHz; -r 44100 for another rate) */
#include "playany.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif
static double FS = 48000; static int verbose;
static unsigned rngS = 12345; static double rnd(void) { rngS = rngS * 1103515245u + 12345u; return ((rngS >> 8) & 0xFFFFFF) / (double)0x1000000; }
static double hz(double m) { return 440.0 * pow(2.0, (m - 69) / 12.0); }

/* a plucked string: harmonics h with amplitude ~ sin(pi h beta) / h^2 (pluck at beta of the length), each decaying
 * faster the higher it is, slightly sharp (inharmonicity B), and a short pick-noise burst */
static double bright;   /* > 0: a bridge pickup (the fundamental much weaker than the harmonics) */
static void pluck(float *buf, int len, int start, double f0, double amp, double beta, double B, double t60) {
  int H = (int)(0.45 * FS / f0); if (H > 40) H = 40;
  double norm = 0, A[41], F[41], R[41];
  for (int h = 1; h <= H; h++) {
    A[h] = fabs(sin(M_PI * h * beta)) / (h * h) * (1 + 0.6 * h / (1 + 0.05 * h * h)) * pow(h, bright);   /* (a magnetic pickup lifts the middle harmonics) */
    F[h] = h * f0 * sqrt(1 + B * h * h); R[h] = exp(-6.9 / ((t60 / (1 + 0.12 * h)) * FS)); norm += A[h];
  }
  for (int h = 1; h <= H; h++) {
    double ph = rnd() * 2 * M_PI, w = 2 * M_PI * F[h] / FS, a = amp * A[h] / norm;
    for (int i = start; i < len; i++) { buf[i] += (float)(a * sin(ph)); ph += w; a *= R[h]; if (a < 1e-7) break; }
  }
  for (int i = 0; i < (int)(0.002 * FS) && start + i < len; i++) buf[start + i] += (float)(amp * 0.15 * (rnd() * 2 - 1) * (1 - i / (0.002 * FS)));
}
static void sine(float *buf, int len, int start, int dur, double f0, double amp) {
  double ph = 0, w = 2 * M_PI * f0 / FS; int fade = (int)(0.003 * FS);
  for (int i = 0; i < dur && start + i < len; i++) { double e = i < 48 ? i / 48.0 : dur - i < fade ? (dur - i) / (double)fade : 1; buf[start + i] += (float)(amp * e * sin(ph)); ph += w; }
}

typedef struct { int t; PaEvent e; } TEv;
typedef struct { TEv ev[4096]; int n; int states[1 << 16]; PaInfo info[1 << 16]; int nStates; int firstChord; int chordSamples; } Run;
static float synthOut[48000 * 20];
/* runs the processor over buf in blocks of 128; records the events (absolute sample) and the state per block */
static void run(PlayAny *p, const float *buf, int len, Run *r, float *synth) {
  PaEvent ev[256]; r->n = 0; r->nStates = 0; r->firstChord = -1; r->chordSamples = 0;
  for (int i = 0; i < len; i += 128) {
    int k = len - i < 128 ? len - i : 128;
    int ne = pa_process(p, buf + i, synth ? synth + i : NULL, k, ev, 256);
    for (int j = 0; j < ne && r->n < 4096; j++) { r->ev[r->n].t = i + ev[j].offset; r->ev[r->n].e = ev[j]; r->n++; }
    PaInfo in; pa_info(p, &in);
    if (r->nStates < (1 << 16)) { r->info[r->nStates] = in; r->states[r->nStates++] = in.state; }
    if (in.state == PA_CHORD) { if (r->firstChord < 0) r->firstChord = i + k; r->chordSamples += k; }
  }
}
static int first_on(Run *r, int from, int *note) { for (int i = 0; i < r->n; i++) if (r->ev[i].t >= from && (r->ev[i].e.status & 0xF0) == 0x90 && r->ev[i].e.d2 > 0) { *note = r->ev[i].e.d1; return r->ev[i].t; } return -1; }
static int count_on(Run *r, int from, int to) { int c = 0; for (int i = 0; i < r->n; i++) if (r->ev[i].t >= from && r->ev[i].t < to && (r->ev[i].e.status & 0xF0) == 0x90 && r->ev[i].e.d2 > 0) c++; return c; }
static int sounding_at(Run *r, int t) { int note = -1; for (int i = 0; i < r->n && r->ev[i].t <= t; i++) { int s = r->ev[i].e.status & 0xF0; if (s == 0x90 && r->ev[i].e.d2 > 0) note = r->ev[i].e.d1; else if ((s == 0x80 || s == 0x90) && r->ev[i].e.d1 == note) note = -1; } return note; }
static int cmpi(const void *a, const void *b) { return *(const int *)a - *(const int *)b; }
static double pct(int *v, int n, double q) { if (!n) return 0; qsort(v, (size_t)n, sizeof *v, cmpi); int i = (int)(q * (n - 1) + 0.5); return v[i]; }

static int failures; static void check(int ok, const char *what) { printf("  %s  %s\n", ok ? "ok  " : "FAIL", what); if (!ok) failures++; }

static float buf[48000 * 20];
int main(int argc, char **argv) {
  for (int i = 1; i < argc; i++) { if (!strcmp(argv[i], "-v")) verbose = 1; else if (!strcmp(argv[i], "-vv")) verbose = 2; else if (!strcmp(argv[i], "-r") && i + 1 < argc) FS = atof(argv[++i]); else if (!strcmp(argv[i], "-s") && i + 1 < argc) rngS = (unsigned)atoi(argv[++i]); }
  printf("play any sound - DSP test at %.0f Hz\n", FS);
  static Run r;
  int note;
  /* ---------------------------------------------------------------- 1. single notes, guitar range */
  for (int kindI = 0; kindI < 4; kindI++) {
    const char *kind = kindI == 0 ? "sine" : kindI == 1 ? "pluck (guitar)" : kindI == 2 ? "pluck (bass)" : "pluck (bridge pickup, quiet: -26 dBFS)";
    bright = kindI == 3 ? 1.2 : 0;
    int lo = kindI == 2 ? 28 : 40, hi = kindI == 2 ? 67 : 88;
    int lat[200], nl = 0, firstOk = 0, finalOk = 0, total = 0, extra = 0, cents[200], nc = 0; (void)cents; (void)nc;
    int latLow[100], nLow = 0, latMid[100], nMid = 0, latHigh[100], nHigh = 0;
    for (int m = lo; m <= hi; m++) {
      PlayAny *p = pa_new(FS); if (kindI == 2) pa_set_range(p, 23, 67);
      int len = (int)(0.6 * FS), start = (int)(0.05 * FS); memset(buf, 0, sizeof(float) * len);
      if (kindI == 0) sine(buf, len, start, (int)(0.5 * FS), hz(m), 0.25);
      else if (kindI == 3) pluck(buf, len, start, hz(m), 0.05, 0.05 + 0.04 * rnd(), 8e-5, 1.6);
      else pluck(buf, len, start, hz(m), 0.3, 0.13 + 0.1 * rnd(), kindI == 2 ? 2e-5 : 8e-5, kindI == 2 ? 2.5 : 1.6);
      run(p, buf, len, &r, NULL);
      int t = first_on(&r, 0, &note); total++;
      if (t >= 0) { int l = t - start; lat[nl++] = l; if (m < lo + 12) latLow[nLow++] = l; else if (m < lo + 24) latMid[nMid++] = l; else latHigh[nHigh++] = l; }
      if (t >= 0 && note == m) firstOk++;
      int fin = sounding_at(&r, start + (int)(0.3 * FS)); if (fin == m) finalOk++;
      int ons = count_on(&r, 0, len); if (ons > 1) extra += ons - 1;
      if (verbose || (t >= 0 && note != m) || fin != m) printf("    %s m=%d: first %d at %+.1f ms, at 300 ms %d, note-ons %d\n", kind, m, t >= 0 ? note : -1, t >= 0 ? (t - start) * 1000 / FS : -1, fin, ons);
      pa_free(p);
    }
    bright = 0;
    printf("%s, notes %d..%d: first note right %d/%d, right at 300 ms %d/%d, extra note-ons %d\n", kind, lo, hi, firstOk, total, finalOk, total, extra);
    printf("    note-on latency (samples / ms): median %.0f / %.1f, 90%% %.0f / %.1f, max %.0f / %.1f\n", pct(lat, nl, 0.5), pct(lat, nl, 0.5) * 1000 / FS, pct(lat, nl, 0.9), pct(lat, nl, 0.9) * 1000 / FS, pct(lat, nl, 1), pct(lat, nl, 1) * 1000 / FS);
    printf("    by register (median ms): lowest octave %.1f, second octave %.1f, above %.1f\n", pct(latLow, nLow, 0.5) * 1000 / FS, pct(latMid, nMid, 0.5) * 1000 / FS, pct(latHigh, nHigh, 0.5) * 1000 / FS);
    char what[160];
    snprintf(what, sizeof what, "%s: first note right >= 95%%", kind); check(firstOk * 100 >= 95 * total, what);
    snprintf(what, sizeof what, "%s: note right at 300 ms >= %d%%", kind, kindI == 3 ? 95 : 98); check(finalOk * 100 >= (kindI == 3 ? 95 : 98) * total, what);
    if (kindI != 2) { snprintf(what, sizeof what, "%s: median note-on latency < 15 ms", kind); check(pct(lat, nl, 0.5) < 0.015 * FS, what); }
    if (kindI != 2) { snprintf(what, sizeof what, "%s: notes above the lowest octave: median latency < 10 ms", kind); check(pct(latMid, nMid, 0.5) < 0.010 * FS && pct(latHigh, nHigh, 0.5) < 0.010 * FS, what); }
  }
  /* ---------------------------------------------------------------- 2. lead lines in AUTO: notes, never the synth.
     realistic: a new note on the same string stops the one before (half the time); across strings the one before
     rings on under it. harsh: every note rings on under the next two or three (an arpeggio, really). */
  for (int harsh = 0; harsh < 2; harsh++) {
    int right = 0, total = 0, chordBlocks = 0, lines = 8;
    for (int L = 0; L < lines; L++) {
      int notes[16], at[16]; int step = (int)((0.16 + 0.06 * (L % 3)) * FS);
      PlayAny *p = pa_new(FS); int len = (int)(0.05 * FS) + 15 * step + (int)(0.4 * FS); memset(buf, 0, sizeof(float) * len);
      static float one[48000 * 20];
      for (int i = 0; i < 16; i++) { notes[i] = 47 + (int)(rnd() * 34); at[i] = (int)(0.05 * FS) + i * step; }
      for (int i = 0; i < 16; i++) {
        memset(one, 0, sizeof(float) * len);
        pluck(one, len, at[i], hz(notes[i]), 0.25 + 0.1 * rnd(), 0.15 + 0.1 * rnd(), 8e-5, 1.2);
        int cut = !harsh && i < 15 && rnd() < 0.5;   /* the next note is on this string: this one stops */
        for (int k = 0; k < len; k++) { float g = 1; if (cut && k > at[i + 1]) { double d = (k - at[i + 1]) / (0.004 * FS); g = (float)(d > 1 ? 0 : 1 - d); } buf[k] += one[k] * g; }
      }
      run(p, buf, len, &r, NULL);
      for (int i = 0; i < 16; i++) { int s = sounding_at(&r, at[i] + (int)(0.06 * FS)); total++; if (s == notes[i]) right++; else if (verbose) { printf("    %s line %d note %d: want %d, sounding %d (before: %d %d)\n", harsh ? "harsh" : "", L, i, notes[i], s, i > 1 ? notes[i - 2] : -1, i ? notes[i - 1] : -1);
          if (verbose > 1) for (int b = (at[i] - 600) / 128; b < (at[i] + (int)(0.07 * FS)) / 128 && b < r.nStates; b++) printf("      %+6.1f ms state %d note %d f %.1f (%.2f) cl %.2f voices %d\n", (b * 128 + 128 - at[i]) * 1000 / FS, r.info[b].state, r.info[b].note, r.info[b].freq, r.info[b].freq > 0 ? 69 + 12 * log2(r.info[b].freq / 440) : 0, r.info[b].clarity, r.info[b].voices); } }
      chordBlocks += r.chordSamples;
      pa_free(p);
    }
    printf("lead lines, %s (16 notes x %d): right note %d/%d, time in synth mode %.0f ms\n", harsh ? "every note ringing on under the next ones" : "half the notes on the same string, the rest ringing on", lines, right, total, chordBlocks * 1000 / FS);
    if (!harsh) {
      check(right * 100 >= 95 * total, "lead lines: right note >= 95%");
      check(chordBlocks < 0.02 * lines * 3.5 * FS, "lead lines: in synth mode < 2% of the time");
    }
  }
  /* ---------------------------------------------------------------- 3. chords in AUTO: synth mode, quickly */
  {
    static const int chords[][7] = {
      { 40, 47, 52, 56, 59, 64, 0 }, { 45, 52, 57, 61, 64, 0 }, { 50, 57, 62, 66, 0 }, { 43, 47, 50, 55, 59, 67, 0 }, { 48, 52, 55, 60, 64, 0 },
      { 40, 47, 52, 55, 59, 64, 0 }, { 45, 52, 57, 60, 64, 0 }, { 52, 59, 64, 68, 71, 76, 0 }, { 60, 64, 67, 0 }, { 57, 60, 64, 0 },
      { 40, 47, 52, 0 }, { 45, 52, 57, 0 }, { 55, 62, 67, 0 }, { 64, 68, 0 }, { 62, 65, 69, 72, 0 }, { 47, 54, 59, 63, 66, 0 } };
    const char *names[] = { "E", "A", "D", "G", "C", "Em", "Am", "E (7th fret)", "C triad", "Am triad", "E5 power", "A5 power", "G5 power", "third (E-G#)", "Dm7", "B" };
    int nch = (int)(sizeof chords / sizeof chords[0]), detected = 0, falseNotes = 0; int times[32], nt = 0;
    for (int c = 0; c < nch; c++) {
      PlayAny *p = pa_new(FS); int len = (int)(0.8 * FS), start = (int)(0.05 * FS); memset(buf, 0, sizeof(float) * len);
      int ns = 0; for (int s = 0; chords[c][s]; s++) { pluck(buf, len, start + s * (int)(0.008 * FS), hz(chords[c][s]), 0.2, 0.15 + 0.1 * rnd(), 8e-5, 2.0); ns++; }
      run(p, buf, len, &r, NULL);
      int ok = r.firstChord >= 0 && r.chordSamples > 0.5 * (len - start);
      if (ok) { detected++; times[nt++] = r.firstChord - start; }
      int fn = count_on(&r, 0, len); falseNotes += fn;
      if (!ok && verbose > 1) for (int b = start / 128; b < (start + (int)(0.12 * FS)) / 128; b++) printf("      %+6.1f ms state %d note %d f %.1f cl %.2f voices %d\n", (b * 128 + 128 - start) * 1000 / FS, r.info[b].state, r.info[b].note, r.info[b].freq, r.info[b].clarity, r.info[b].voices);
      printf("    %-14s %d notes: %s%s (after %.1f ms), note-ons %d\n", names[c], ns, ok ? "synth" : "NOT synth", "", r.firstChord >= 0 ? (r.firstChord - start) * 1000 / FS : -1, fn);
      pa_free(p);
    }
    printf("chords (strummed, 8 ms between strings): synth mode %d/%d, time to switch median %.1f ms, max %.1f ms, notes played meanwhile %d\n", detected, nch, pct(times, nt, 0.5) * 1000 / FS, pct(times, nt, 1) * 1000 / FS, falseNotes);
    check(detected * 100 >= 85 * nch, "chords: synth mode >= 85% (power chords and the 2-note third are the hard ones)");
    /* strumming again after a rest (the chord has died away): the synth is there at once */
    PlayAny *p = pa_new(FS); int len = (int)(2.0 * FS), s1 = (int)(0.05 * FS), s2 = (int)(1.2 * FS); memset(buf, 0, sizeof(float) * len);
    for (int s = 0; chords[0][s]; s++) pluck(buf, len, s1 + s * (int)(0.008 * FS), hz(chords[0][s]), 0.2, 0.2, 8e-5, 0.3);
    for (int s = 0; chords[1][s]; s++) pluck(buf, len, s2 + s * (int)(0.008 * FS), hz(chords[1][s]), 0.2, 0.2, 8e-5, 0.3);
    run(p, buf, len, &r, NULL);
    int idle = r.states[(s2 - 128) / 128] == PA_IDLE, at = -1; for (int b = s2 / 128; b < r.nStates; b++) if (r.states[b] == PA_CHORD) { at = b * 128 + 128 - s2; break; }
    printf("strumming again after a rest: idle before %s, synth after %.1f ms (the first strum: %.1f ms)\n", idle ? "yes" : "no", at * 1000 / FS, r.firstChord >= 0 ? (r.firstChord - s1) * 1000 / FS : -1);
    check(idle && at >= 0 && at <= 0.003 * FS, "strumming again after a rest: synth mode at once");
    pa_free(p);
  }
  /* ---------------------------------------------------------------- 4. synth mode latency + it plays chords */
  {
    int lats[16], nl = 0;
    static const double fs0[] = { 82.4, 110, 146.8, 196, 246.9, 329.6, 440, 659.3 };
    for (int i = 0; i < 8; i++) {
      PlayAny *p = pa_new(FS); pa_set_mode(p, PA_SYNTH); int len = (int)(0.4 * FS), start = (int)(0.05 * FS); memset(buf, 0, sizeof(float) * len); memset(synthOut, 0, sizeof(float) * len);
      pluck(buf, len, start, fs0[i], 0.3, 0.2, 8e-5, 1.5);
      run(p, buf, len, &r, synthOut);
      float pi = 0, po = 0; for (int k = 0; k < len; k++) { if (fabsf(buf[k]) > pi) pi = fabsf(buf[k]); if (fabsf(synthOut[k]) > po) po = fabsf(synthOut[k]); }
      int ti = -1, to = -1; for (int k = 0; k < len; k++) { if (ti < 0 && fabsf(buf[k]) > 0.1f * pi) ti = k; if (to < 0 && fabsf(synthOut[k]) > 0.1f * po) to = k; }
      lats[nl++] = to - ti;
      if (verbose) printf("    synth %.0f Hz: out peak %.2f, onset in %d out %d -> %d samples\n", fs0[i], po, ti, to, to - ti);
      pa_free(p);
    }
    printf("synth mode: onset-to-output latency median %.0f samples (%.2f ms), max %.0f (%.2f ms)\n", pct(lats, nl, 0.5), pct(lats, nl, 0.5) * 1000 / FS, pct(lats, nl, 1), pct(lats, nl, 1) * 1000 / FS);
    check(pct(lats, nl, 1) < 0.005 * FS, "synth mode: latency < 5 ms");
    PlayAny *p = pa_new(FS); pa_set_mode(p, PA_SYNTH); int len = (int)(0.6 * FS); memset(buf, 0, sizeof(float) * len);
    static const int E[] = { 40, 47, 52, 56, 59, 64 }; for (int s = 0; s < 6; s++) pluck(buf, len, (int)(0.05 * FS) + s * 400, hz(E[s]), 0.2, 0.2, 8e-5, 2);
    run(p, buf, len, &r, synthOut); double e = 0; for (int k = (int)(0.1 * FS); k < (int)(0.3 * FS); k++) e += synthOut[k] * synthOut[k];
    double rms = sqrt(e / (0.2 * FS)); printf("synth mode on an E chord: output %.1f dBFS RMS, note events %d\n", 20 * log10(rms + 1e-12), r.n);
    check(rms > 0.01 && r.n == 0, "synth mode: plays the chord, sends no notes");
    pa_free(p);
  }
  /* ---------------------------------------------------------------- 5. bends, legato, silence and noise */
  {
    PlayAny *p = pa_new(FS); int len = (int)(0.8 * FS); memset(buf, 0, sizeof(float) * len);
    double ph = 0; for (int i = (int)(0.05 * FS); i < (int)(0.75 * FS); i++) { double tt = (i - 0.05 * FS) / FS, m = 64 + (tt < 0.15 ? 0 : tt < 0.45 ? (tt - 0.15) / 0.3 * 1.8 : 1.8); ph += 2 * M_PI * hz(m) / FS; buf[i] = (float)(0.25 * sin(ph)); }
    run(p, buf, len, &r, NULL);
    int ons = count_on(&r, 0, len), bends = 0, lastBend = 8192; for (int i = 0; i < r.n; i++) if ((r.ev[i].e.status & 0xF0) == 0xE0) { bends++; lastBend = r.ev[i].e.d1 | r.ev[i].e.d2 << 7; }
    double bentTo = 64 + (lastBend - 8192) / 8191.0 * 2;
    printf("bend E4 up 1.8 semitones: note-ons %d, pitch bends %d, bent to %.2f\n", ons, bends, bentTo);
    check(ons == 1 && bends > 3 && fabs(bentTo - 65.8) < 0.15, "bend: one note, followed with pitch bend");
    pa_free(p);
    p = pa_new(FS); memset(buf, 0, sizeof(float) * len); ph = 0;
    for (int i = (int)(0.05 * FS); i < (int)(0.75 * FS); i++) { double m = i < 0.35 * FS ? 64 : 67; ph += 2 * M_PI * hz(m) / FS; buf[i] = (float)(0.25 * sin(ph)); }
    run(p, buf, len, &r, NULL);
    int n2; int t2 = first_on(&r, (int)(0.35 * FS), &n2);
    printf("legato E4 -> G4 (no new pluck): new note %d after %.1f ms\n", t2 >= 0 ? n2 : -1, t2 >= 0 ? (t2 - 0.35 * FS) * 1000 / FS : -1);
    check(t2 >= 0 && n2 == 67 && t2 - 0.35 * FS < 0.02 * FS, "legato: the new note within 20 ms");
    pa_free(p);
    p = pa_new(FS); memset(buf, 0, sizeof(float) * len); for (int i = 0; i < len; i++) buf[i] = (float)((rnd() * 2 - 1) * 0.0005);   /* -66 dBFS hiss */
    run(p, buf, len, &r, synthOut); printf("hiss at -66 dBFS: note-ons %d, synth mode %.0f ms\n", count_on(&r, 0, len), r.chordSamples * 1000 / FS);
    check(count_on(&r, 0, len) == 0 && r.chordSamples == 0, "hiss: nothing plays");
    pa_free(p);
    p = pa_new(FS); memset(buf, 0, sizeof(float) * len); pluck(buf, len, (int)(0.05 * FS), hz(52), 0.3, 0.2, 8e-5, 0.25);
    run(p, buf, len, &r, NULL); int offAt = -1; for (int i = 0; i < r.n; i++) if ((r.ev[i].e.status & 0xF0) == 0x80) offAt = r.ev[i].t;
    printf("a short note (E3, decays in 0.25 s): note-off after %.0f ms\n", offAt >= 0 ? (offAt - 0.05 * FS) * 1000 / FS : -1);
    check(offAt > 0 && offAt < 0.6 * FS, "the note ends when the string stops");
    pa_free(p);
  }
  /* ---------------------------------------------------------------- 6. how much CPU: 30 s of lead lines and chords (AUTO, synth output on) */
  {
    int len = (int)(30 * FS); float *big = calloc((size_t)len, sizeof(float)), *out = calloc((size_t)len, sizeof(float));
    for (int t = (int)(0.05 * FS), i = 0; t < len - (int)(0.5 * FS); t += (int)(0.2 * FS), i++) {
      if (i % 8 == 7) { static const int E[] = { 40, 47, 52, 56, 59, 64 }; for (int k = 0; k < 6; k++) pluck(big, len, t + k * (int)(0.008 * FS), hz(E[k]), 0.15, 0.2, 8e-5, 1.0); }
      else pluck(big, len, t, hz(47 + (int)(rnd() * 34)), 0.25, 0.2, 8e-5, 1.0);
    }
    PlayAny *p = pa_new(FS); PaEvent ev[256]; clock_t a = clock();
    for (int i = 0; i < len; i += 128) pa_process(p, big + i, out + i, len - i < 128 ? len - i : 128, ev, 256);
    double sec = (double)(clock() - a) / CLOCKS_PER_SEC;
    printf("CPU: 30 s of guitar in %.3f s here = %.1f%% of one core (%.0fx faster than real time)\n", sec, sec / 30 * 100, 30 / sec);
    pa_free(p); free(big); free(out);
  }
  /* ---------------------------------------------------------------- 7. tone names */
  check(pa_tone_for_name("Warm Pad") == PA_TONE_PAD && pa_tone_for_name("Fingered Bass") == PA_TONE_BASS && pa_tone_for_name("Grand Piano") == PA_TONE_PLUCK && pa_tone_for_name("Brass Section") == PA_TONE_LEAD && pa_tone_for_name("Drawbar Organ") == PA_TONE_ORGAN, "synth voices from sound names");
  printf("%s (%d failed)\n", failures ? "FAILED" : "all passed", failures);
  return failures ? 1 : 0;
}
