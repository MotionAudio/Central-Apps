/* cu-rig - the instrument rig on Windows, macOS (and Linux without PipeWire / FluidSynth): the guitar /
 * bass / acoustic pedal board and the keys, with built-in effects and SoundFont keys, in one program.
 *
 * It speaks the same JSON messages as the Central Pedal's instrument host (instrument_host.py), one per
 * line on stdin, and answers with {"type":"instrumentStatus",...} lines on stdout:
 *   {"action":"status"} {"action":"apply","config":{kind, input, chain, keys, levelDb, routing}}
 *   {"action":"set",uid,sym,value} {"action":"bypass",uid,on} {"action":"pedalmix",uid,on,mix,levelDb}
 *   {"action":"scene",pedals,keys,levelDb} {"action":"input",input} {"action":"level",levelDb}
 *   {"action":"keys",keys} {"action":"note",note,on,velocity} {"action":"routing",routing}
 *   {"action":"midi","data":[status,d1,d2]}   (a MIDI keyboard; the app forwards it)
 *   {"action":"playany","playAny":{on, patch, mode, dry, sensitivity, volume}}   play any sound (playany/): the guitar plays a keys sound
 *
 * Every pedal of the catalogue is played by a built-in effect of its kind (drive, fuzz, compressor, gate,
 * EQ, wah, chorus / flanger / phaser / rotary, tremolo / vibrato, octave, delay, reverb, amp, cabinet,
 * impulse response, acoustic body), its knobs found by name (rig-map.json, made from js/pedals.js and
 * instrument-plugins.json by tools/make-rig-map.js). Keys: TinySoundFont plays .sf2 banks, up to 8 layers.
 *
 *   cu-rig --data <folder> [--sounds <bundled sf2 folder>] [--map rig-map.json] [--backend auto|null] [--block 128]
 */
#ifndef _WIN32
#define _GNU_SOURCE
#endif
#define _USE_MATH_DEFINES
#include <math.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include "plat.h"
#ifdef _WIN32
#define PATHSEP "\\"
#else
#include <dirent.h>
#include <sys/stat.h>
#define PATHSEP "/"
#endif

#define MA_NO_DECODING
#define MA_NO_ENCODING
#define MA_NO_GENERATION
#define MA_NO_RESOURCE_MANAGER
#define MA_NO_NODE_GRAPH
#define MA_NO_ENGINE
#define MINIAUDIO_IMPLEMENTATION
#include "vendor/miniaudio.h"
#define TSF_IMPLEMENTATION
#include "vendor/tsf.h"
#include "vendor/cJSON.h"
#include "plughost/plughost.h"
#include "playany/playany.h"

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif
#define MAXBLOCK 4096
#define MAXFX 24
#define MAXLAYERS 8
#define MAXBANKS 48

static double FS = 48000; static int BLOCK = 128;
static char dataDir[1024] = ".", soundsDir[1024] = "", mapPath[1024] = "", backendArg[16] = "auto";
static cJSON *rigMap;                         /* pedal id -> {cat, uri, knobs {sym: label}, controls {sym: [min, max, def, log, unit]}} */
static pl_mutex outLock;
static FILE *proto;                           /* the app's channel (our own copy of stdout: a plugin that prints goes to stderr) */
static void emit_raw(const char *s) { pl_mutex_lock(&outLock); fputs(s, proto); fputc('\n', proto); fflush(proto); pl_mutex_unlock(&outLock); }
static void emit_json(cJSON *j) { char *s = cJSON_PrintUnformatted(j); pl_mutex_lock(&outLock); fputs(s, proto); fputc('\n', proto); fflush(proto); pl_mutex_unlock(&outLock); free(s); }
static float db2lin(double db) { return db <= -119 ? 0 : (float)pow(10, db / 20); }
static float clampf(float v, float a, float b) { return v < a ? a : v > b ? b : v; }

/* ------------------------------------------------------------------ small DSP pieces */
typedef struct { float b0, b1, b2, a1, a2, z1, z2; } Bq;
static inline float bq(Bq *f, float x) { float y = f->b0 * x + f->z1; f->z1 = f->b1 * x - f->a1 * y + f->z2; f->z2 = f->b2 * x - f->a2 * y; return y; }
enum { BQ_HP, BQ_LS, BQ_PK, BQ_HS, BQ_LP, BQ_BP, BQ_NOTCH };
static void bq_set(Bq *f, int type, double freq, double gainDb, double q) {
  if (freq < 10) freq = 10; if (freq > FS * 0.45) freq = FS * 0.45; if (q < 0.1) q = 0.1;
  double A = pow(10, gainDb / 40), w = 2 * M_PI * freq / FS, cw = cos(w), sw = sin(w), al = sw / (2 * q), b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0, s = 2 * sqrt(A) * al;
  switch (type) {
    case BQ_HP: b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
    case BQ_LP: b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
    case BQ_BP: b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
    case BQ_NOTCH: b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
    case BQ_LS: b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s); a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s; break;
    case BQ_PK: b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; break;
    case BQ_HS: b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s); a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s; break;
  }
  f->b0 = (float)(b0 / a0); f->b1 = (float)(b1 / a0); f->b2 = (float)(b2 / a0); f->a1 = (float)(a1 / a0); f->a2 = (float)(a2 / a0);
}
typedef struct { float *d; int n, w; } Line;
static void line_init(Line *l, int n) { l->d = calloc((size_t)n, sizeof(float)); l->n = n; l->w = 0; }
static inline void line_put(Line *l, float x) { l->d[l->w] = x; l->w = (l->w + 1) % l->n; }
static inline float line_get(Line *l, float delay) {   /* delay in samples (fractional), 1 .. n-2 */
  if (delay < 1) delay = 1; if (delay > l->n - 2) delay = (float)(l->n - 2);
  float rp = (float)l->w - delay; while (rp < 0) rp += (float)l->n; int i0 = (int)rp; float fr = rp - (float)i0; int i1 = (i0 + 1) % l->n;
  return l->d[i0] + (l->d[i1] - l->d[i0]) * fr;
}
/* Freeverb (Jezar's): 8 combs + 4 allpasses per side */
typedef struct { float *buf; int n, i; float fb, damp, store; } Comb;
typedef struct { float *buf; int n, i; } Allp;
typedef struct { Comb c[2][8]; Allp a[2][4]; } Verb;
static const int combT[8] = { 1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617 }, allpT[4] = { 556, 441, 341, 225 };
static void verb_init(Verb *v) {
  double sc = FS / 44100.0;
  for (int s = 0; s < 2; s++) { for (int k = 0; k < 8; k++) { int n = (int)((combT[k] + s * 23) * sc); v->c[s][k].buf = calloc((size_t)n, sizeof(float)); v->c[s][k].n = n; } for (int k = 0; k < 4; k++) { int n = (int)((allpT[k] + s * 23) * sc); v->a[s][k].buf = calloc((size_t)n, sizeof(float)); v->a[s][k].n = n; } }
}
static void verb_free(Verb *v) { for (int s = 0; s < 2; s++) { for (int k = 0; k < 8; k++) free(v->c[s][k].buf); for (int k = 0; k < 4; k++) free(v->a[s][k].buf); } }
static inline float verb_run(Verb *v, int s, float x, float room, float damp) {
  float out = 0, in = x * 0.015f;
  for (int k = 0; k < 8; k++) { Comb *c = &v->c[s][k]; float y = c->buf[c->i]; c->store = y * (1 - damp) + c->store * damp; c->buf[c->i] = in + c->store * room; if (++c->i >= c->n) c->i = 0; out += y; }
  for (int k = 0; k < 4; k++) { Allp *a = &v->a[s][k]; float b = a->buf[a->i], y = -out + b; a->buf[a->i] = out + b * 0.5f; if (++a->i >= a->n) a->i = 0; out = y; }
  return out;
}

/* ------------------------------------------------------------------ pedals */
enum { R_DRIVE, R_TONE, R_BASS, R_MID, R_TREBLE, R_LEVEL, R_TIME, R_FEEDBACK, R_MIX, R_RATE, R_DEPTH, R_SIZE, R_DAMP, R_THR, R_RATIO, R_ATTACK, R_RELEASE, R_POS, R_DOWN, R_UP, R_PRESENCE, NROLES };
static const char *roleWords[NROLES] = {
  "drive gain dist distortion fuzz sustain boost overdrive od crunch saturation sat grit pregain pre preamp input",
  "tone filter colour color cutoff freq tilt brightness bright",
  "bass low lows lo body",
  "mid middle mids",
  "treble high highs hi top",
  "level volume output master vol out makeup",
  "time delay ms",
  "feedback repeats regen fb repeat",
  "mix blend wet dry e.level effect fx amount",
  "rate speed lfo",
  "depth intensity width",
  "decay size room length tail reverb",
  "damp damping",
  "threshold thr thresh sens sensitivity",
  "ratio compression comp squash",
  "attack",
  "release",
  "wah pedal position sweep resonance res",
  "octave sub down oct1 octave1 lower",
  "up oct2 octave2 upper",
  "presence"
};
enum { FX_NONE, FX_DRIVE, FX_DIST, FX_FUZZ, FX_COMP, FX_GATE, FX_EQ, FX_WAH, FX_CHORUS, FX_FLANGER, FX_PHASER, FX_ROTARY, FX_TREM, FX_VIBRATO, FX_OCTAVE, FX_DELAY, FX_REVERB, FX_AMP, FX_CAB, FX_IR, FX_ACOUSTIC, FX_UTIL, FX_SHIMMER, FX_SCOMP, FX_SLIMIT, FX_SEQ, FX_SDEESS, FX_PLUG };
typedef struct { char sym[48]; int role; float min, max, def; int log; char unit[12]; } Ctl;
typedef struct {
  char uid[24], id[64]; int type, on; float mix, levelDb, wet, dry;
  Ctl ctl[24]; int nctl; float val[24];                /* every control of the plugin and its current value */
  float p[NROLES]; float raw[NROLES]; char unit[NROLES][12]; int has[NROLES];
  /* state */
  Bq f[2][8]; Line line[2]; Verb *verb; float env[2], lfo, z[2][6], hold[2], att, rel; int sign[2]; float *ir; int irLen; float *hist[2]; int hpos[2]; float rmax[NROLES];
  /* the Studio effects (raw values by symbol) */ float sIn, sThr, sRatio, sMakeup, sOut, la[2][128]; int laPos[2], lhold[2]; float gr;
  /* a plugin of the musician's own (VST3, CLAP, AU, LV2) */ PhPlug *plug; char plugError[200];
  int dirty;
} Fx;
typedef struct { Fx fx[MAXFX]; int n; int stereoIn; float inGain, gateDb, gateEnv, gateGain; int gateOn; } Chain;

static int role_of(const char *label, const char *sym) {
  char l[96]; size_t k = 0; for (const char *p = label && *label ? label : sym; *p && k + 1 < sizeof l; p++) l[k++] = (char)tolower((unsigned char)*p); l[k] = 0;
  /* the whole label first, then each word */
  for (int pass = 0; pass < 2; pass++)
    for (int r = 0; r < NROLES; r++) {
      const char *w = roleWords[r];
      while (*w) {
        char word[32]; int n = 0; while (*w && *w != ' ' && n < 31) word[n++] = *w++; word[n] = 0; while (*w == ' ') w++;
        if (pass == 0 ? !strcmp(l, word) : (strstr(l, word) != NULL)) return r;
      }
    }
  return -1;
}
static int fx_type(const char *cat, const char *id, const char *uri) {
  char s[160]; snprintf(s, sizeof s, "%s %s", id ? id : "", uri ? uri : ""); for (char *p = s; *p; p++) *p = (char)tolower((unsigned char)*p);
  if (uri && !strcmp(uri, "builtin:convolver")) return FX_IR;
  if (strstr(s, "shimmer")) return FX_SHIMMER;
  if (!cat) cat = "";
  if (!strcmp(cat, "studio")) return strstr(s, "deess") ? FX_SDEESS : strstr(s, "limit") || strstr(s, "dpl#") ? FX_SLIMIT : strstr(s, "studioeq") || strstr(s, "-eq") ? FX_SEQ : FX_SCOMP;
  if (!strcmp(cat, "boost")) return FX_DRIVE;
  if (!strcmp(cat, "dist")) return FX_DIST;
  if (!strcmp(cat, "fuzz")) return FX_FUZZ;
  if (!strcmp(cat, "comp")) return strstr(s, "gate") ? FX_GATE : FX_COMP;
  if (!strcmp(cat, "eq")) return FX_EQ;
  if (!strcmp(cat, "wah")) return FX_WAH;
  if (!strcmp(cat, "mod")) return strstr(s, "flang") ? FX_FLANGER : (strstr(s, "phas") || strstr(s, "vibe")) ? FX_PHASER : (strstr(s, "rotary") || strstr(s, "leslie")) ? FX_ROTARY : FX_CHORUS;
  if (!strcmp(cat, "trem")) return strstr(s, "vib") ? FX_VIBRATO : FX_TREM;
  if (!strcmp(cat, "pitch")) return FX_OCTAVE;
  if (!strcmp(cat, "delay")) return FX_DELAY;
  if (!strcmp(cat, "reverb")) return FX_REVERB;
  if (!strcmp(cat, "amp")) return FX_AMP;
  if (!strcmp(cat, "cab")) return FX_CAB;
  if (!strcmp(cat, "acoustic")) return FX_ACOUSTIC;
  if (!strcmp(cat, "util")) return strstr(s, "gate") ? FX_GATE : FX_UTIL;
  return FX_NONE;
}
static void mix_gains(Fx *x) { float lv = db2lin(x->levelDb), m = clampf(x->mix, 0, 1); if (!x->on) { x->wet = 0; x->dry = 1; } else { x->wet = m * lv; x->dry = (1 - m) * lv; } }
static void fx_params(Fx *x) {   /* control values -> normalized roles */
  static const float defs[NROLES] = { 0.5f, 0.5f, 0.5f, 0.5f, 0.5f, 0.5f, 0.4f, 0.35f, 0.3f, 0.3f, 0.5f, 0.5f, 0.4f, 0.5f, 0.4f, 0.2f, 0.4f, 0.5f, 0.5f, 0.0f, 0.5f };
  for (int r = 0; r < NROLES; r++) { x->p[r] = defs[r]; x->has[r] = 0; x->raw[r] = 0; x->unit[r][0] = 0; }
  for (int k = 0; k < x->nctl; k++) {
    Ctl *c = &x->ctl[k]; if (c->role < 0 || x->has[c->role]) continue; float v = x->val[k], n;
    if (c->max > c->min) n = c->log && c->min > 0 && v > 0 ? (float)(log(v / c->min) / log(c->max / c->min)) : (v - c->min) / (c->max - c->min); else n = 0.5f;
    x->p[c->role] = clampf(n, 0, 1); x->raw[c->role] = v; x->rmax[c->role] = c->max; snprintf(x->unit[c->role], sizeof x->unit[c->role], "%s", c->unit); x->has[c->role] = 1;
  }
  x->dirty = 1;
}
static float ms_of(Fx *x, float lo, float hi) { if (x->has[R_TIME]) { if (!strcmp(x->unit[R_TIME], "ms")) return clampf(x->raw[R_TIME], 1, 4000); if (!strcmp(x->unit[R_TIME], "s")) return clampf(x->raw[R_TIME] * 1000, 1, 4000); } return lo + (hi - lo) * x->p[R_TIME]; }
static float hz_of(Fx *x, float lo, float hi) { if (x->has[R_RATE] && !strcmp(x->unit[R_RATE], "hz")) return clampf(x->raw[R_RATE], 0.02f, 20); return lo * powf(hi / lo, x->p[R_RATE]); }
static float db_of(Fx *x, int r, float lo, float hi) { if (x->has[r] && !strcmp(x->unit[r], "db")) return clampf(x->raw[r], lo, hi); return lo + (hi - lo) * x->p[r]; }

static float *load_ir(const char *path, int *len);
/* a control's own value (the Studio effects use real units: dB, seconds, Hz) */
static float sv(Fx *x, const char *sym, float def) { for (int k = 0; k < x->nctl; k++) if (!strcmp(x->ctl[k].sym, sym)) return x->val[k]; return def; }
static float coef_s(float sec) { return sec <= 0 ? 0 : expf(-1.0f / (sec * (float)FS)); }
static void fx_prepare(Fx *x) {   /* filters and buffers for the current parameters (control thread) */
  float tone = x->p[R_TONE], bass = x->p[R_BASS], mid = x->p[R_MID], treb = x->has[R_TREBLE] ? x->p[R_TREBLE] : tone;
  for (int s = 0; s < 2; s++) {
    Bq *f = x->f[s];
    switch (x->type) {
      case FX_DRIVE: case FX_DIST: case FX_FUZZ:
        bq_set(&f[0], BQ_HP, x->type == FX_FUZZ ? 60 : 120, 0, 0.707); bq_set(&f[1], BQ_LP, 700 * powf(12, tone), 0, 0.707); bq_set(&f[2], BQ_PK, 720, x->type == FX_DRIVE ? 4 : 2, 0.8); break;
      case FX_EQ: bq_set(&f[0], BQ_LS, 110, (bass - 0.5f) * 24, 0.707); bq_set(&f[1], BQ_PK, 800, (mid - 0.5f) * 24, 0.8); bq_set(&f[2], BQ_HS, 3500, (treb - 0.5f) * 24, 0.707); break;
      case FX_AMP:
        bq_set(&f[0], BQ_HP, 80, 0, 0.707); bq_set(&f[1], BQ_LS, 120, (bass - 0.5f) * 30, 0.707); bq_set(&f[2], BQ_PK, 650, (mid - 0.5f) * 24, 0.7);
        bq_set(&f[3], BQ_HS, 3000, (treb - 0.5f) * 30, 0.707); bq_set(&f[4], BQ_PK, 5000, (x->p[R_PRESENCE] - 0.5f) * 16, 1.0); bq_set(&f[5], BQ_LP, 9000, 0, 0.707); break;
      case FX_CAB:
        bq_set(&f[0], BQ_HP, 80, 0, 0.8); bq_set(&f[1], BQ_PK, 120, 3, 1.2); bq_set(&f[2], BQ_PK, 400, -4, 1.0); bq_set(&f[3], BQ_PK, 2500, 4, 1.2);
        bq_set(&f[4], BQ_LP, 5000, 0, 0.707); bq_set(&f[5], BQ_LP, 6500, 0, 0.6); break;
      case FX_ACOUSTIC:
        bq_set(&f[0], BQ_HP, 70, 0, 0.707); bq_set(&f[1], BQ_PK, 105, 4, 1.4); bq_set(&f[2], BQ_LS, 220, -3, 0.707); bq_set(&f[3], BQ_PK, 1100, -3, 1.0); bq_set(&f[4], BQ_HS, 6000, 3 + (treb - 0.5f) * 10, 0.707); break;
      case FX_WAH: break;
      case FX_OCTAVE: bq_set(&f[0], BQ_LP, 600, 0, 0.707); bq_set(&f[1], BQ_LP, 300, 0, 0.707); bq_set(&f[2], BQ_HP, 200, 0, 0.707); break;
      case FX_DELAY: bq_set(&f[0], BQ_LP, 1500 + 7000 * tone, 0, 0.707); break;
      case FX_COMP: case FX_GATE: case FX_UTIL: break;
      case FX_SEQ: {   /* Studio EQ: high-pass, low shelf, three bells, high shelf, low-pass */
        float hp = sv(x, "hp_freq", 20), lp = sv(x, "lp_freq", 20000);
        bq_set(&f[0], BQ_HP, clampf(hp, 10, 1000), 0, 0.707); bq_set(&f[6], BQ_LP, clampf(lp, 1000, 22000) > FS * 0.45 ? FS * 0.45 : clampf(lp, 1000, 22000), 0, 0.707);
        bq_set(&f[1], BQ_LS, clampf(sv(x, "ls_freq", 100), 20, 1000), clampf(sv(x, "ls_gain", 0), -18, 18), 0.707);
        bq_set(&f[2], BQ_PK, clampf(sv(x, "p1_freq", 250), 20, 20000), clampf(sv(x, "p1_gain", 0), -18, 18), clampf(sv(x, "p1_q", 1), 0.1f, 10));
        bq_set(&f[3], BQ_PK, clampf(sv(x, "p2_freq", 1000), 20, 20000), clampf(sv(x, "p2_gain", 0), -18, 18), clampf(sv(x, "p2_q", 1), 0.1f, 10));
        bq_set(&f[4], BQ_PK, clampf(sv(x, "p3_freq", 4000), 20, 20000), clampf(sv(x, "p3_gain", 0), -18, 18), clampf(sv(x, "p3_q", 1), 0.1f, 10));
        bq_set(&f[5], BQ_HS, clampf(sv(x, "hs_freq", 8000), 1000, 20000) > FS * 0.45 ? FS * 0.45 : clampf(sv(x, "hs_freq", 8000), 1000, 20000), clampf(sv(x, "hs_gain", 0), -18, 18), 0.707);
        x->sOut = db2lin(clampf(sv(x, "out_gain", 0), -24, 24)); x->sIn = hp > 20.5f ? 1 : 0; x->sThr = lp < 19999 ? 1 : 0; break; }
      case FX_SCOMP: {   /* Studio Compressor (the same controls as x42 darc on the Central Pedal) */
        float r = clampf(sv(x, "Ratio", 0.5f), 0, 0.95f);
        x->sIn = db2lin(clampf(sv(x, "inputgain", 0), -10, 30)); x->sThr = clampf(sv(x, "threshold", -30), -60, 0); x->sRatio = 1 / (1 - r);
        x->att = coef_s(clampf(sv(x, "attack", 0.01f), 0.0005f, 0.2f)); x->rel = coef_s(clampf(sv(x, "release", 0.3f), 0.01f, 5));
        x->sMakeup = -x->sThr * (1 - 1 / x->sRatio) * 0.35f; break; }
      case FX_SDEESS: {   /* De-esser (the MDA De-ess controls): threshold -60..0 dB, frequency 1-12 kHz, the highs -20..+20 dB */
        float fr = 1000 * powf(12, clampf(sv(x, "freq", 0.5f), 0, 1)); if (fr > FS * 0.45f) fr = FS * 0.45f;
        bq_set(&f[0], BQ_HP, fr, 0, 0.707); bq_set(&f[2], BQ_HP, fr, 0, 0.707); bq_set(&f[1], BQ_LP, fr, 0, 0.707); bq_set(&f[3], BQ_LP, fr, 0, 0.707);   /* Linkwitz-Riley: the two bands add back up flat */
        x->sThr = db2lin(-60 + 60 * clampf(sv(x, "thresh", 0.15f), 0, 1)); x->sOut = db2lin(-20 + 40 * clampf(sv(x, "hf_drive", 0.5f), 0, 1));
        x->att = coef_s(0.0008f); x->rel = coef_s(0.06f); break; }
      case FX_SLIMIT:   /* Studio Limiter (the same controls as x42 dpl): input gain, ceiling, release; 1.3 ms look-ahead */
        x->sIn = db2lin(clampf(sv(x, "gain", 0), -10, 30)); x->sThr = db2lin(clampf(sv(x, "threshold", -1), -20, 0)); x->rel = coef_s(clampf(sv(x, "release", 0.01f), 0.001f, 2) / 3); break;
      default: break;
    }
    if ((x->type == FX_DELAY || x->type == FX_CHORUS || x->type == FX_FLANGER || x->type == FX_VIBRATO || x->type == FX_ROTARY || x->type == FX_SHIMMER) && !x->line[s].d) line_init(&x->line[s], (int)(FS * 4.2));
  }
  if ((x->type == FX_REVERB || x->type == FX_SHIMMER) && !x->verb) { x->verb = calloc(1, sizeof(Verb)); verb_init(x->verb); }
  x->dirty = 0;
}
static void fx_free(Fx *x) { if (x->plug) ph_release(x->plug); for (int s = 0; s < 2; s++) { free(x->line[s].d); free(x->hist[s]); } if (x->verb) { verb_free(x->verb); free(x->verb); } free(x->ir); memset(x, 0, sizeof *x); }

static float lfo_rate(Fx *x) {
  switch (x->type) {
    case FX_ROTARY: return x->p[R_RATE] > 0.5f ? 6.5f : 0.8f;
    case FX_TREM: return hz_of(x, 0.5f, 12);
    case FX_PHASER: return hz_of(x, 0.05f, 4);
    case FX_FLANGER: return hz_of(x, 0.05f, 2);
    case FX_SHIMMER: return 0.3f;
    case FX_CHORUS: case FX_VIBRATO: return hz_of(x, 0.1f, 4);
    default: return 0;
  }
}
static inline float fx_sample(Fx *x, int s, float y) {
  Bq *f = x->f[s];
  switch (x->type) {
    case FX_DRIVE: { float g = db2lin(30 * x->p[R_DRIVE]); y = bq(&f[0], y); y = bq(&f[2], y) * g; y = tanhf(y) / (0.6f + 0.4f * tanhf(g * 0.3f)); return bq(&f[1], y) * db2lin((x->p[R_LEVEL] - 0.5f) * 24); }
    case FX_DIST: { float g = db2lin(12 + 36 * x->p[R_DRIVE]); y = bq(&f[0], y) * g; y = y > 0 ? tanhf(y) : tanhf(0.75f * y) / 0.75f; y = clampf(y, -1, 1) * 0.5f; return bq(&f[1], y) * db2lin((x->p[R_LEVEL] - 0.5f) * 24); }
    case FX_FUZZ: { float g = db2lin(20 + 40 * x->p[R_DRIVE]); y = bq(&f[0], y) * g; y = clampf(y, -1, 1); y = y - y * y * y / 3; return bq(&f[1], y) * 0.6f * db2lin((x->p[R_LEVEL] - 0.5f) * 24); }
    case FX_SEQ: {
      if (x->sIn > 0) y = bq(&f[0], y);
      y = bq(&f[5], bq(&f[4], bq(&f[3], bq(&f[2], bq(&f[1], y)))));
      if (x->sThr > 0) y = bq(&f[6], y);
      return y * x->sOut; }
    case FX_SDEESS: {   /* split at the frequency; the highs duck when they're over the threshold */
      float hi = bq(&f[2], bq(&f[0], y)), lo = bq(&f[3], bq(&f[1], y)), a = fabsf(hi);
      x->env[s] = a > x->env[s] ? x->att * x->env[s] + (1 - x->att) * a : x->rel * x->env[s] + (1 - x->rel) * a;
      float g = x->env[s] > x->sThr ? x->sThr / x->env[s] : 1; if (s == 0) x->gr = 20 * log10f(g + 1e-9f);
      return lo + hi * g * x->sOut; }
    case FX_SCOMP: {   /* feed-forward, soft knee (6 dB), smoothed in dB */
      float in = y * x->sIn, lev = 20 * log10f(fabsf(in) + 1e-9f), over = lev - x->sThr, W = 6, g;
      if (2 * over < -W) g = 0; else if (2 * fabsf(over) <= W) g = (1 / x->sRatio - 1) * (over + W / 2) * (over + W / 2) / (2 * W); else g = (1 / x->sRatio - 1) * over;
      x->env[s] = g < x->env[s] ? x->att * x->env[s] + (1 - x->att) * g : x->rel * x->env[s] + (1 - x->rel) * g;
      if (s == 0) x->gr = x->env[0];
      return in * db2lin(x->env[s] + x->sMakeup); }
    case FX_SLIMIT: {
      float in = y * x->sIn, a = fabsf(in), want = a > x->sThr ? x->sThr / a : 1;
      float *L = x->la[s]; int n = 64, p = x->laPos[s]; float out = L[p]; L[p] = in; x->laPos[s] = (p + 1) % n;
      if (x->env[s] <= 0 || x->env[s] > 1) x->env[s] = 1;
      if (want < x->env[s]) { x->env[s] = want; x->lhold[s] = n; } else if (x->lhold[s] > 0) x->lhold[s]--; else x->env[s] = 1 - x->rel * (1 - x->env[s]);
      if (s == 0) x->gr = 20 * log10f(x->env[0] + 1e-9f);
      out *= x->env[s]; return clampf(out, -x->sThr, x->sThr); }
    case FX_COMP: {
      float thr = db_of(x, R_THR, -50, 0), ratio = x->has[R_RATIO] && x->rmax[R_RATIO] > 2 ? clampf(x->raw[R_RATIO], 1, 30) : 1 + 11 * x->p[R_RATIO];
      if (!x->has[R_THR] && x->has[R_DRIVE]) thr = -10 - 40 * x->p[R_DRIVE];   /* "Sustain" */
      float a = fabsf(y); x->env[s] = a > x->env[s] ? x->att * x->env[s] + (1 - x->att) * a : x->rel * x->env[s] + (1 - x->rel) * a;
      float lev = 20 * log10f(x->env[s] + 1e-9f), over = lev - thr, gr = over > 0 ? over * (1 - 1 / ratio) : 0, makeup = -thr * (1 - 1 / ratio) * 0.5f;
      return y * db2lin(-gr + makeup + (x->has[R_LEVEL] ? (x->p[R_LEVEL] - 0.5f) * 12 : 0)); }
    case FX_GATE: {
      float thr = db_of(x, R_THR, -80, -20), a = fabsf(y); x->env[s] = a > x->env[s] ? a : x->env[s] * 0.9995f;
      float target = 20 * log10f(x->env[s] + 1e-9f) > thr ? 1.0f : 0.0f; x->hold[s] += (target - x->hold[s]) * (target > x->hold[s] ? 0.02f : 0.0005f); return y * x->hold[s]; }
    case FX_EQ: return bq(&f[2], bq(&f[1], bq(&f[0], y))) * (x->has[R_LEVEL] ? db2lin((x->p[R_LEVEL] - 0.5f) * 24) : 1);
    case FX_WAH: {
      float pos; if (x->has[R_POS]) pos = x->p[R_POS]; else { float a = fabsf(y); x->env[s] = a > x->env[s] ? x->env[s] + (a - x->env[s]) * 0.01f : x->env[s] * 0.9993f; pos = clampf(x->env[s] * 6, 0, 1); }
      float fc = 350 * powf(7, pos), g = tanf((float)M_PI * fc / (float)FS), k = 1.0f / 6.0f;   /* state-variable band-pass, Q 6 */
      float hp = (y - (2 * k + g) * x->z[s][0] - x->z[s][1]) / (1 + 2 * k * g + g * g), bp = g * hp + x->z[s][0]; x->z[s][0] = g * hp + bp; float lp = g * bp + x->z[s][1]; x->z[s][1] = g * bp + lp;
      return bp * 2.5f; }
    case FX_CHORUS: case FX_FLANGER: case FX_VIBRATO: case FX_ROTARY: {
      float l = sinf(2 * (float)M_PI * (x->lfo + (s ? 0.25f : 0))), d;
      if (x->type == FX_FLANGER) d = (float)(FS * (0.001 + 0.004 * x->p[R_DEPTH] * (0.5f + 0.5f * l)));
      else if (x->type == FX_VIBRATO) d = (float)(FS * (0.005 + 0.003 * x->p[R_DEPTH] * l));
      else if (x->type == FX_ROTARY) d = (float)(FS * (0.003 + 0.0015 * l));
      else d = (float)(FS * (0.012 + 0.006 * x->p[R_DEPTH] * l));
      float fb = x->type == FX_FLANGER ? 0.8f * x->p[R_FEEDBACK] : 0, del = line_get(&x->line[s], d);
      line_put(&x->line[s], y + del * fb);
      if (x->type == FX_VIBRATO) return del;
      if (x->type == FX_ROTARY) { float am = 1 - 0.35f * (0.5f + 0.5f * (s ? -l : l)); return (y * 0.5f + del * 0.7f) * am; }
      { float m = x->has[R_MIX] ? x->p[R_MIX] : 0.5f; return y * (1 - m * 0.5f) + del * m; } }
    case FX_PHASER: {
      float l = 0.5f + 0.5f * sinf(2 * (float)M_PI * (x->lfo + (s ? 0.25f : 0))), fc = 300 * powf(8, l * (0.4f + 0.6f * x->p[R_DEPTH])), t = tanf((float)M_PI * fc / (float)FS);
      float c = (t - 1) / (t + 1), v = y + x->z[s][5] * 0.5f * (x->has[R_FEEDBACK] ? x->p[R_FEEDBACK] * 1.6f : 1);
      for (int k = 0; k < 4; k++) { float o = c * v + x->z[s][k]; x->z[s][k] = v - c * o; v = o; }
      x->z[s][5] = v; return (y + v) * 0.6f; }
    case FX_TREM: { float l = 0.5f + 0.5f * sinf(2 * (float)M_PI * x->lfo); return y * (1 - x->p[R_DEPTH] * l); }
    case FX_OCTAVE: {
      float lp = bq(&f[1], bq(&f[0], y)); int sg = lp > 0; if (sg && !x->sign[s]) x->hold[s] = x->hold[s] > 0 ? -1.0f : 1.0f; x->sign[s] = sg;
      if (x->hold[s] == 0) x->hold[s] = 1;
      float a = fabsf(y); x->env[s] = a > x->env[s] ? x->env[s] + (a - x->env[s]) * 0.05f : x->env[s] * 0.9995f;
      float sub = x->hold[s] * x->env[s] * 1.2f, up = bq(&f[2], fabsf(y)) * 1.5f, dn = x->p[R_DOWN], upl = x->has[R_UP] ? x->p[R_UP] : 0;
      return y * (x->has[R_MIX] ? 1 - x->p[R_MIX] : 0.7f) + sub * dn + up * upl; }
    case FX_DELAY: {
      float d = ms_of(x, 60, 1200) * (float)FS / 1000, fb = clampf(x->p[R_FEEDBACK], 0, 0.95f), m = x->has[R_MIX] ? x->p[R_MIX] : 0.35f;
      float e = line_get(&x->line[s], d); line_put(&x->line[s], y + bq(&f[0], e) * fb); return y + e * m * 1.4f; }
    case FX_REVERB: case FX_SHIMMER: {
      float size = x->has[R_SIZE] && !strcmp(x->unit[R_SIZE], "s") ? clampf(x->raw[R_SIZE] / 8, 0, 1) : x->p[R_SIZE], room = 0.7f + 0.28f * size, damp = 0.2f + 0.6f * (x->has[R_DAMP] ? x->p[R_DAMP] : 0.4f), m = x->has[R_MIX] ? x->p[R_MIX] : 0.3f;
      float in2 = y;
      if (x->type == FX_SHIMMER) { float d = (float)(FS * 0.05) * (1 - fmodf(x->lfo * 37, 1)); in2 = y + line_get(&x->line[s], d) * 0.5f; line_put(&x->line[s], y); room = 0.93f; }
      float w = verb_run(x->verb, s, in2, room, damp); return y * (1 - m * 0.5f) + w * m * 3; }
    case FX_AMP: {
      float g = db2lin(40 * x->p[R_DRIVE]); y = bq(&f[0], y) * g; y = tanhf(y * 1.5f); y = bq(&f[1], y); y = bq(&f[2], y); y = bq(&f[3], y); y = bq(&f[4], y);
      y = tanhf(y * 1.2f) * 0.7f; return bq(&f[5], y) * db2lin((x->p[R_LEVEL] - 0.5f) * 24); }
    case FX_CAB: for (int k = 0; k < 6; k++) y = bq(&f[k], y); return y * 1.4f;
    case FX_IR: {
      if (!x->ir || !x->hist[s]) return y; float *h = x->hist[s]; int L2 = x->irLen, p = x->hpos[s]; h[p] = y; double acc = 0;
      for (int k = 0; k < L2; k++) { int idx = p - k; if (idx < 0) idx += L2; acc += h[idx] * x->ir[k]; }
      x->hpos[s] = (p + 1) % L2; return (float)acc; }
    case FX_ACOUSTIC: for (int k = 0; k < 5; k++) y = bq(&f[k], y); return y;
    case FX_UTIL: return y * db2lin(x->has[R_LEVEL] ? (x->p[R_LEVEL] - 0.5f) * 36 : x->has[R_DRIVE] ? (x->p[R_DRIVE] - 0.5f) * 36 : 0);
    default: return y;
  }
}
static float plugL[MAXBLOCK], plugR[MAXBLOCK];
static void fx_run(Fx *x, float *L, float *R, int n) {
  float wet = x->wet, dry = x->dry; if (wet == 0 && dry == 1) return;
  if (x->type == FX_PLUG) {
    if (!x->plug) return;
    ph_process(x->plug, L, R, plugL, plugR, n, NULL, 0);
    for (int i = 0; i < n; i++) { float a = plugL[i], b = plugR[i]; if (!isfinite(a)) a = 0; if (!isfinite(b)) b = 0; L[i] = a * wet + L[i] * dry; if (R != L) R[i] = b * wet + R[i] * dry; }
    return;
  }
  float rate = lfo_rate(x) / (float)FS;
  x->att = expf(-1.0f / (float)(FS * (0.001 + 0.05 * x->p[R_ATTACK]))); x->rel = expf(-1.0f / (float)(FS * (0.05 + 0.5 * x->p[R_RELEASE])));
  for (int i = 0; i < n; i++) {
    float l = L[i], yl = fx_sample(x, 0, l); if (!isfinite(yl)) yl = 0; L[i] = yl * wet + l * dry;
    if (R != L) { float r = R[i], yr = fx_sample(x, 1, r); if (!isfinite(yr)) yr = 0; R[i] = yr * wet + r * dry; }
    x->lfo += rate; if (x->lfo >= 1) x->lfo -= 1;
  }
}

/* ------------------------------------------------------------------ impulse responses (WAV) */
static float *load_ir(const char *path, int *len) {
  *len = 0; FILE *f = fopen(path, "rb"); if (!f) return NULL;
  fseek(f, 0, SEEK_END); long sz = ftell(f); fseek(f, 0, SEEK_SET); if (sz < 44 || sz > 16 << 20) { fclose(f); return NULL; }
  uint8_t *d = malloc((size_t)sz); if (fread(d, 1, (size_t)sz, f) != (size_t)sz) { fclose(f); free(d); return NULL; } fclose(f);
  if (memcmp(d, "RIFF", 4) || memcmp(d + 8, "WAVE", 4)) { free(d); return NULL; }
  int fmt = 1, chs = 1, bits = 16, rate = 48000; uint8_t *data = NULL; uint32_t dlen = 0;
  for (long p = 12; p + 8 <= sz;) {
    uint32_t n = d[p + 4] | d[p + 5] << 8 | d[p + 6] << 16 | (uint32_t)d[p + 7] << 24;
    if (!memcmp(d + p, "fmt ", 4) && n >= 16) { fmt = d[p + 8] | d[p + 9] << 8; chs = d[p + 10] | d[p + 11] << 8; rate = (int)(d[p + 12] | d[p + 13] << 8 | d[p + 14] << 16 | (uint32_t)d[p + 15] << 24); bits = d[p + 22] | d[p + 23] << 8; if (fmt == 0xFFFE && n >= 26) fmt = d[p + 32] | d[p + 33] << 8; }
    else if (!memcmp(d + p, "data", 4)) { data = d + p + 8; dlen = n; if (p + 8 + (long)n > sz) dlen = (uint32_t)(sz - p - 8); }
    p += 8 + n + (n & 1);
  }
  if (!data || chs < 1) { free(d); return NULL; }
  int bps = bits / 8, frames = (int)(dlen / (uint32_t)(bps * chs)); if (frames < 1) { free(d); return NULL; }
  int want = (int)((double)frames * FS / rate); if (want > 4096) want = 4096;   /* 85 ms at 48 kHz is plenty for a cabinet */
  float *out = calloc((size_t)want, sizeof(float)); double e = 0;
  for (int i = 0; i < want; i++) {
    double sp = (double)i * rate / FS; int i0 = (int)sp; if (i0 >= frames) break; const uint8_t *q = data + (size_t)i0 * bps * chs; float v = 0;
    if (fmt == 3 && bits == 32) memcpy(&v, q, 4); else if (bits == 16) v = (int16_t)(q[0] | q[1] << 8) / 32768.0f; else if (bits == 24) v = (float)((int32_t)((uint32_t)q[0] << 8 | (uint32_t)q[1] << 16 | (uint32_t)q[2] << 24) >> 8) / 8388608.0f; else if (bits == 32) v = (float)(int32_t)(q[0] | q[1] << 8 | q[2] << 16 | (uint32_t)q[3] << 24) / 2147483648.0f;
    out[i] = v; e += (double)v * v;
  }
  free(d); if (e <= 0) { free(out); return NULL; }
  float g = (float)(1.0 / sqrt(e)) * 0.7f; for (int i = 0; i < want; i++) out[i] *= g;
  *len = want; return out;
}

/* ------------------------------------------------------------------ keys: SoundFont banks + layers */
typedef struct { char file[1024]; tsf *t; } Bank;
static Bank banks[MAXBANKS]; static int nBanks;
typedef struct { int on, bankIx, bank, prog, octave, transpose, lo, hi, velLo, velHi; float volume, pan; PhPlug *plug; } Layer;   /* plug: a plugin instrument plays this layer instead of a SoundFont */
typedef struct { Layer l[MAXLAYERS]; int n; int transpose; int sustain; char velocity[12]; float volume; } Keys;
static Keys keysCfg; static _Atomic int keysDirty;
typedef struct { uint8_t a, b, c; } Ev;
#define EVRING 1024
static Ev evs[EVRING]; static _Atomic unsigned evW, evR;
static void push_ev(int a, int b, int c) { unsigned w = atomic_load(&evW); if (w - atomic_load(&evR) >= EVRING) return; evs[w % EVRING] = (Ev){ (uint8_t)a, (uint8_t)b, (uint8_t)c }; atomic_store(&evW, w + 1); }
static int bank_for(const char *file) {
  for (int i = 0; i < nBanks; i++) if (!strcmp(banks[i].file, file)) return i;
  if (nBanks >= MAXBANKS) return -1;
  tsf *t = tsf_load_filename(file); if (!t) return -1;
  tsf_set_output(t, TSF_STEREO_INTERLEAVED, (int)FS, 0); tsf_set_max_voices(t, 96);
  snprintf(banks[nBanks].file, sizeof banks[nBanks].file, "%s", file); banks[nBanks].t = t; return nBanks++;
}
static float curve(int v) {
  float x = v / 127.0f;
  if (!strcmp(keysCfg.velocity, "soft")) return powf(x, 0.6f); if (!strcmp(keysCfg.velocity, "hard")) return powf(x, 1.5f); if (!strcmp(keysCfg.velocity, "fixed")) return 100 / 127.0f; return x;
}
static void keys_apply_rt(void) {   /* audio thread: presets, volumes, pans of the layers */
  for (int b = 0; b < nBanks; b++) for (int ch = 0; ch < MAXLAYERS; ch++) { tsf_channel_set_volume(banks[b].t, ch, 0); }
  for (int i = 0; i < keysCfg.n; i++) {
    Layer *L = &keysCfg.l[i]; if (L->bankIx < 0) continue; tsf *t = banks[L->bankIx].t;
    if (tsf_channel_get_preset_bank(t, i) != L->bank || tsf_channel_get_preset_number(t, i) != L->prog) tsf_channel_set_bank_preset(t, i, L->bank, L->prog);
    tsf_channel_set_volume(t, i, L->on ? L->volume : 0); tsf_channel_set_pan(t, i, (L->pan + 1) / 2); tsf_channel_set_pitchrange(t, i, 2);
  }
}
#define LMIDI 256
static PhMidi layerMidi[MAXLAYERS][LMIDI]; static int layerMidiN[MAXLAYERS];
static void layer_midi(int i, int a, int b, int c) { if (layerMidiN[i] < LMIDI) layerMidi[i][layerMidiN[i]++] = (PhMidi){ { (uint8_t)a, (uint8_t)b, (uint8_t)c } }; }
static void keys_event_rt(Ev e) {
  int st = e.a & 0xF0, note = e.b, vel = e.c;
  for (int i = 0; i < keysCfg.n; i++) {   /* the plugin layers: the same split, octave and velocity range as SoundFont layers */
    Layer *L = &keysCfg.l[i]; if (!L->plug) continue; int key = note + keysCfg.transpose, n = key + 12 * L->octave + L->transpose;
    if (st == 0x90 && vel > 0) { if (L->on && key >= L->lo && key <= L->hi && vel >= L->velLo && vel <= L->velHi && n >= 0 && n <= 127) layer_midi(i, 0x90, n, vel); }
    else if (st == 0x80 || st == 0x90) { if (n >= 0 && n <= 127) layer_midi(i, 0x80, n, 0); }
    else if (st == 0xB0) { if (note != 64 || keysCfg.sustain) layer_midi(i, 0xB0, note, vel); }
    else if (st == 0xE0) layer_midi(i, 0xE0, note, vel);
  }
  if (st == 0x90 && vel > 0) {
    int key = note + keysCfg.transpose;
    for (int i = 0; i < keysCfg.n; i++) {
      Layer *L = &keysCfg.l[i]; if (!L->on || L->bankIx < 0) continue; if (key < L->lo || key > L->hi || vel < L->velLo || vel > L->velHi) continue;
      int n = key + 12 * L->octave + L->transpose; if (n < 0 || n > 127) continue; tsf_channel_note_on(banks[L->bankIx].t, i, n, curve(vel));
    }
  } else if (st == 0x80 || st == 0x90) {
    int key = note + keysCfg.transpose;
    for (int i = 0; i < keysCfg.n; i++) { Layer *L = &keysCfg.l[i]; if (L->bankIx < 0) continue; int n = key + 12 * L->octave + L->transpose; if (n >= 0 && n <= 127) tsf_channel_note_off(banks[L->bankIx].t, i, n); }
  } else if (st == 0xB0) {
    if (note == 64 && !keysCfg.sustain) return;
    for (int i = 0; i < keysCfg.n; i++) { Layer *L = &keysCfg.l[i]; if (L->bankIx >= 0) tsf_channel_midi_control(banks[L->bankIx].t, i, note, vel); }
  } else if (st == 0xE0) {
    for (int i = 0; i < keysCfg.n; i++) { Layer *L = &keysCfg.l[i]; if (L->bankIx >= 0) tsf_channel_set_pitchwheel(banks[L->bankIx].t, i, note | vel << 7); }
  }
}

/* ------------------------------------------------------------------ play any sound: the guitar (bass, acoustic) plays any keys sound
 * playany/playany.c follows the input: single notes become notes for a SoundFont (its own channel, PA_CH, of the
 * chosen bank), chords go to its synth mode. The control thread sets playNext; the audio thread takes it. */
#define PA_CH 15
typedef struct { int on, mode, tone, lo, hi, bankIx, bank, prog; float dry, sens, volume; } PlayCfg;
static PlayCfg playNext, playRt; static _Atomic int playDirty; static PlayAny *pa; static double paFs;
static float paIn[MAXBLOCK], paSynth[MAXBLOCK], paKeys[MAXBLOCK * 2]; static PaEvent paEv[256]; static PaInfo paInfoNow;
static void playany_rt_apply(void) {   /* audio thread */
  PlayCfg old = playRt; playRt = playNext;
  if (!pa) return;
  if (old.on && old.bankIx >= 0 && (!playRt.on || playRt.bankIx != old.bankIx)) tsf_channel_note_off_all(banks[old.bankIx].t, PA_CH);
  if (!playRt.on) { pa_reset(pa); return; }
  pa_set_mode(pa, playRt.mode); pa_set_sensitivity(pa, playRt.sens); pa_set_tone(pa, playRt.tone); pa_set_range(pa, playRt.lo, playRt.hi); pa_set_channel(pa, PA_CH);
  if (playRt.mode == PA_SYNTH && playRt.bankIx >= 0) tsf_channel_note_off_all(banks[playRt.bankIx].t, PA_CH);
  if (playRt.bankIx >= 0) { tsf *t = banks[playRt.bankIx].t; tsf_channel_set_bank_preset(t, PA_CH, playRt.bank, playRt.prog); tsf_channel_set_volume(t, PA_CH, 1); tsf_channel_set_pitchrange(t, PA_CH, 2); }
}
static void playany_event_rt(PaEvent e) {
  if (playRt.bankIx < 0) return; tsf *t = banks[playRt.bankIx].t; int st = e.status & 0xF0;
  if (st == 0x90 && e.d2) tsf_channel_note_on(t, PA_CH, e.d1, e.d2 / 127.0f);
  else if (st == 0x80 || st == 0x90) tsf_channel_note_off(t, PA_CH, e.d1);
  else if (st == 0xE0) tsf_channel_set_pitchwheel(t, PA_CH, e.d1 | e.d2 << 7);
}

/* ------------------------------------------------------------------ the running rig */
static char kind[16] = "off"; static Chain *chainLive; static Chain *graveyard[8]; static int nGrave;
static _Atomic(Chain *) chainNext;
static float levelGain = 1, inGain = 1; static int inChannel = 0;   /* 0 L, 1 R, 2 stereo */
static int outFirst = 0, outStereo = 1;
static ma_context ctx; static int ctxOk; static ma_device dev; static int devOpen; static char devIn[256] = "auto", devOut[256] = "", devError[256] = "", devName[256] = "";
static int capCh, playCh; static double cpuLoad; static float inPeak, outPeak;
static float bufL[MAXBLOCK], bufR[MAXBLOCK], keysBuf[MAXBLOCK * 2];
static float ttFreq, ttLevel; static double ttPh;   /* a test tone into the input (the test suite) */

static void data_cb(ma_device *d, void *out, const void *in, ma_uint32 n) {
  (void)d; uint64_t t0 = pl_now_ns(); float *fo = out; const float *fi = in;
  Chain *nx = atomic_exchange(&chainNext, NULL); if (nx) { if (chainLive && nGrave < 8) graveyard[nGrave++] = chainLive; chainLive = nx; }
  if (atomic_exchange(&keysDirty, 0)) keys_apply_rt();
  if (atomic_exchange(&playDirty, 0)) playany_rt_apply();
  int playing = playRt.on && pa && strcmp(kind, "keys") != 0;
  int isKeys = !strcmp(kind, "keys");
  for (ma_uint32 done = 0; done < n;) {
    int k = (int)(n - done > MAXBLOCK ? MAXBLOCK : n - done);
    if (isKeys) {
      unsigned r = atomic_load(&evR), w = atomic_load(&evW); while (r != w) { keys_event_rt(evs[r % EVRING]); r++; } atomic_store(&evR, r);
      memset(keysBuf, 0, sizeof(float) * k * 2);
      int used[MAXBANKS] = { 0 }; for (int i = 0; i < keysCfg.n; i++) if (keysCfg.l[i].bankIx >= 0) used[keysCfg.l[i].bankIx] = 1;
      for (int b = 0; b < nBanks; b++) if (used[b]) tsf_render_float(banks[b].t, keysBuf, k, 1);
      for (int li = 0; li < keysCfg.n; li++) {   /* plugin instruments, each with its layer's volume and pan */
        Layer *L = &keysCfg.l[li]; if (!L->plug) continue;
        ph_process(L->plug, NULL, NULL, plugL, plugR, k, layerMidi[li], layerMidiN[li]); layerMidiN[li] = 0;
        float v = L->on ? L->volume : 0, gl = v * (L->pan > 0 ? 1 - L->pan : 1), gr = v * (L->pan < 0 ? 1 + L->pan : 1);
        for (int i = 0; i < k; i++) { float a = plugL[i], b = plugR[i]; if (!isfinite(a)) a = 0; if (!isfinite(b)) b = 0; keysBuf[i * 2] += a * gl; keysBuf[i * 2 + 1] += b * gr; }
      }
      float g = keysCfg.volume * 1.2f; for (int i = 0; i < k; i++) { bufL[i] = keysBuf[i * 2] * g; bufR[i] = keysBuf[i * 2 + 1] * g; }
    } else if (fi && capCh > 0) {
      for (int i = 0; i < k; i++) {
        const float *fr = fi + (size_t)(done + i) * capCh; float l = fr[0], r = capCh > 1 ? fr[1] : fr[0];
        float v = inChannel == 1 ? r : l; bufL[i] = (inChannel == 2 ? l : v) * inGain; bufR[i] = (inChannel == 2 ? r : v) * inGain;
        float a = fabsf(bufL[i]); if (a > inPeak) inPeak = a;
      }
      if (ttLevel > 0) { double w = 2 * M_PI * ttFreq / FS; for (int i = 0; i < k; i++) { float v = ttLevel * (float)sin(ttPh); ttPh += w; bufL[i] += v; bufR[i] += v; } if (ttPh > 1e6) ttPh = fmod(ttPh, 2 * M_PI); }
      if (playing) {   /* play any sound: follow the input (before the gate - the note's tail tells when it ends) */
        for (int i = 0; i < k; i++) paIn[i] = inChannel == 2 ? 0.5f * (bufL[i] + bufR[i]) : bufL[i];
        int ne = pa_process(pa, paIn, paSynth, k, paEv, 256);
        for (int e = 0; e < ne; e++) playany_event_rt(paEv[e]);
        pa_info(pa, &paInfoNow);
      }
      Chain *c = chainLive;
      if (c && c->gateOn) {   /* the input gate */
        float thr = db2lin(c->gateDb);
        for (int i = 0; i < k; i++) { float a = fmaxf(fabsf(bufL[i]), fabsf(bufR[i])); c->gateEnv = a > c->gateEnv ? a : c->gateEnv * 0.9997f; float t = c->gateEnv > thr ? 1.0f : 0.0f; c->gateGain += (t - c->gateGain) * (t > c->gateGain ? 0.05f : 0.0008f); bufL[i] *= c->gateGain; bufR[i] *= c->gateGain; }
      }
    } else { memset(bufL, 0, sizeof(float) * k); memset(bufR, 0, sizeof(float) * k); }
    Chain *c = chainLive;
    if (c) for (int x = 0; x < c->n; x++) fx_run(&c->fx[x], bufL, bufR, k);
    if (playing && fi && capCh > 0) {   /* the guitar with its pedals at the dry blend, the chosen sound, the synth mode */
      int keysOn = playRt.bankIx >= 0; if (keysOn) tsf_render_float(banks[playRt.bankIx].t, paKeys, k, 0);
      float dry = playRt.dry, v = playRt.volume;
      for (int i = 0; i < k; i++) { float kl = keysOn ? paKeys[i * 2] : 0, kr = keysOn ? paKeys[i * 2 + 1] : 0; if (!isfinite(kl)) kl = 0; if (!isfinite(kr)) kr = 0; bufL[i] = bufL[i] * dry + (kl + paSynth[i]) * v; bufR[i] = bufR[i] * dry + (kr + paSynth[i]) * v; }
    }
    if (fo) {
      for (int i = 0; i < k; i++) {
        float l = bufL[i] * levelGain, r = bufR[i] * levelGain; float a = fmaxf(fabsf(l), fabsf(r)); if (a > outPeak) outPeak = a;
        float *fr = fo + (size_t)(done + i) * playCh; for (int q = 0; q < playCh; q++) fr[q] = 0;
        if (playCh == 1) fr[0] = (l + r) * 0.5f;
        else if (outStereo && outFirst + 1 < playCh) { fr[outFirst] = l; fr[outFirst + 1] = r; }
        else fr[outFirst < playCh ? outFirst : 0] += (l + r) * 0.5f;
      }
    }
    done += (ma_uint32)k;
  }
  double busy = (double)(pl_now_ns() - t0) / 1e9, period = n / FS; cpuLoad = cpuLoad * 0.95 + (period > 0 ? busy / period * 100 : 0) * 0.05;
}

static void clean_name(const char *in, char *out, size_t max) { size_t k = 0; for (const char *p = in; *p && k + 1 < max; p++) out[k++] = *p == '"' ? '\'' : *p; out[k] = 0; }
static int contains_ci(const char *hay, const char *needle) { if (!needle || !needle[0]) return 1; size_t n = strlen(needle); for (const char *p = hay; *p; p++) { size_t i = 0; while (i < n && p[i] && tolower((unsigned char)p[i]) == tolower((unsigned char)needle[i])) i++; if (i == n) return 1; } return 0; }
static int ctx_init(void) {
  if (ctxOk) return 1;
  ma_context_config cc = ma_context_config_init();
  ma_backend nullb[] = { ma_backend_null };
#ifdef _WIN32
  ma_backend list[] = { ma_backend_wasapi };
#elif defined(__APPLE__)
  ma_backend list[] = { ma_backend_coreaudio };
#else
  ma_backend list[] = { ma_backend_pulseaudio, ma_backend_alsa };
#endif
  int isNull = !strcmp(backendArg, "null");
  if (ma_context_init(isNull ? nullb : list, isNull ? 1 : (ma_uint32)(sizeof list / sizeof list[0]), &cc, &ctx) != MA_SUCCESS) return 0;
  ctxOk = 1; return 1;
}
static void dev_stop(void) { if (devOpen) { ma_device_uninit(&dev); devOpen = 0; } }
static int dev_start(int wantCapture) {
  dev_stop(); devError[0] = 0; devName[0] = 0;
  if (!ctx_init()) { snprintf(devError, sizeof devError, "no audio system"); return 0; }
  ma_device_info *pi, *ci; ma_uint32 np = 0, nc = 0; if (ma_context_get_devices(&ctx, &pi, &np, &ci, &nc) != MA_SUCCESS) { snprintf(devError, sizeof devError, "could not list the audio devices"); return 0; }
  const ma_device_id *capId = NULL, *playId = NULL;
  if (wantCapture) {
    if (!nc) { snprintf(devError, sizeof devError, "no audio input found - plug in an audio interface"); return 0; }
    int pick = -1; if (devIn[0] && strcmp(devIn, "auto")) for (ma_uint32 i = 0; i < nc; i++) if (contains_ci(ci[i].name, devIn)) { pick = (int)i; break; }
    if (pick < 0) { for (ma_uint32 i = 0; i < nc; i++) if (contains_ci(ci[i].name, "usb") || contains_ci(ci[i].name, "focusrite") || contains_ci(ci[i].name, "scarlett") || contains_ci(ci[i].name, "interface")) { pick = (int)i; break; } }
    if (pick < 0) for (ma_uint32 i = 0; i < nc; i++) if (ci[i].isDefault) { pick = (int)i; break; }
    if (pick < 0) pick = 0;
    capId = &ci[pick].id; clean_name(ci[pick].name, devName, sizeof devName);
  }
  if (np) { int pick = -1; if (devOut[0]) for (ma_uint32 i = 0; i < np; i++) if (contains_ci(pi[i].name, devOut)) { pick = (int)i; break; } if (pick >= 0) playId = &pi[pick].id; }
  ma_device_config cfg = ma_device_config_init(wantCapture ? ma_device_type_duplex : ma_device_type_playback);
  cfg.sampleRate = 48000; cfg.periodSizeInFrames = (ma_uint32)BLOCK; cfg.performanceProfile = ma_performance_profile_low_latency; cfg.dataCallback = data_cb; cfg.noClip = MA_FALSE;
  cfg.playback.pDeviceID = playId; cfg.playback.format = ma_format_f32; cfg.playback.channels = 0;
  if (wantCapture) { cfg.capture.pDeviceID = capId; cfg.capture.format = ma_format_f32; cfg.capture.channels = 0; }
  if (ma_device_init(&ctx, &cfg, &dev) != MA_SUCCESS) { snprintf(devError, sizeof devError, "the audio device could not be opened"); return 0; }
  FS = dev.sampleRate; capCh = wantCapture ? (int)dev.capture.channels : 0; playCh = (int)dev.playback.channels; if (playCh < 1) playCh = 2;
  if (!pa || paFs != FS) { if (pa) pa_free(pa); pa = pa_new(FS); paFs = FS; atomic_store(&playDirty, 1); }   /* (play any sound, at this rate) */
  if (outFirst >= playCh) outFirst = 0;
  devOpen = 1;
  if (ma_device_start(&dev) != MA_SUCCESS) { dev_stop(); snprintf(devError, sizeof devError, "the audio device could not start"); return 0; }
  return 1;
}

/* ------------------------------------------------------------------ catalogue: keys banks (SoundFont preset names), impulse responses, inputs */
static void path_join(char *out, size_t n, const char *a, const char *b) { snprintf(out, n, "%s%s%s", a, a[0] && a[strlen(a) - 1] != PATHSEP[0] && a[strlen(a) - 1] != '/' ? PATHSEP : "", b); }
typedef void (*file_fn)(const char *path, const char *name, void *arg);
static void list_dir(const char *dir, file_fn fn, void *arg) {
#ifdef _WIN32
  char pat[1100]; path_join(pat, sizeof pat, dir, "*"); WIN32_FIND_DATAA fd; HANDLE h = FindFirstFileA(pat, &fd); if (h == INVALID_HANDLE_VALUE) return;
  do { if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) continue; char p[1100]; path_join(p, sizeof p, dir, fd.cFileName); fn(p, fd.cFileName, arg); } while (FindNextFileA(h, &fd));
  FindClose(h);
#else
  DIR *d = opendir(dir); if (!d) return; struct dirent *e; char *names[512]; int n = 0;
  while ((e = readdir(d)) && n < 512) { if (e->d_name[0] == '.') continue; names[n++] = strdup(e->d_name); }
  closedir(d);
  for (int i = 0; i < n; i++) for (int j = i + 1; j < n; j++) if (strcmp(names[j], names[i]) < 0) { char *t = names[i]; names[i] = names[j]; names[j] = t; }
  for (int i = 0; i < n; i++) { char p[1100]; path_join(p, sizeof p, dir, names[i]); struct stat st; if (!stat(p, &st) && S_ISREG(st.st_mode)) fn(p, names[i], arg); free(names[i]); }
#endif
}
static int ends_ci(const char *s, const char *suf) { size_t a = strlen(s), b = strlen(suf); if (a < b) return 0; for (size_t i = 0; i < b; i++) if (tolower((unsigned char)s[a - b + i]) != tolower((unsigned char)suf[i])) return 0; return 1; }
static cJSON *sf2_presets(const char *path) {   /* the preset headers (phdr) only - no need to load the samples */
  FILE *f = fopen(path, "rb"); if (!f) return NULL; cJSON *out = NULL; uint8_t h[12];
  if (fread(h, 1, 12, f) != 12 || memcmp(h, "RIFF", 4) || memcmp(h + 8, "sfbk", 4)) { fclose(f); return NULL; }
  for (;;) {
    uint8_t c[8]; if (fread(c, 1, 8, f) != 8) break; uint32_t n = c[4] | c[5] << 8 | c[6] << 16 | (uint32_t)c[7] << 24;
    if (!memcmp(c, "LIST", 4)) { uint8_t t[4]; if (fread(t, 1, 4, f) != 4) break; if (memcmp(t, "pdta", 4)) { fseek(f, (long)n - 4 + (n & 1), SEEK_CUR); continue; }
      long end = ftell(f) + (long)n - 4;
      while (ftell(f) < end) {
        uint8_t s[8]; if (fread(s, 1, 8, f) != 8) break; uint32_t m = s[4] | s[5] << 8 | s[6] << 16 | (uint32_t)s[7] << 24;
        if (!memcmp(s, "phdr", 4)) {
          out = cJSON_CreateArray(); int cnt = (int)(m / 38);
          for (int i = 0; i < cnt - 1 && i < 512; i++) {   /* the last record is the terminator (EOP) */
            uint8_t r[38]; if (fread(r, 1, 38, f) != 38) break; char name[21]; memcpy(name, r, 20); name[20] = 0; for (char *p = name; *p; p++) if ((unsigned char)*p < 32) *p = ' ';
            size_t L = strlen(name); while (L && name[L - 1] == ' ') name[--L] = 0;
            cJSON *o = cJSON_CreateObject(); cJSON_AddStringToObject(o, "name", name); cJSON_AddNumberToObject(o, "prog", r[20] | r[21] << 8); cJSON_AddNumberToObject(o, "bank", r[22] | r[23] << 8); cJSON_AddItemToArray(out, o);
          }
          break;
        }
        fseek(f, (long)m + (m & 1), SEEK_CUR);
      }
      break;
    }
    fseek(f, (long)n + (n & 1), SEEK_CUR);
  }
  fclose(f); return out;
}
typedef struct { cJSON *arr; int user; } CatArg;
static cJSON *catCache;
static void add_bank(const char *path, const char *name, void *arg) {
  CatArg *a = arg; if (!ends_ci(name, ".sf2")) return;
  cJSON *pr = sf2_presets(path); if (!pr || !cJSON_GetArraySize(pr)) { cJSON_Delete(pr); return; }
  char nm[256]; snprintf(nm, sizeof nm, "%s", name); nm[strlen(nm) - 4] = 0; char *dash = strstr(nm, " - "); if (dash) *dash = 0;
  for (char *p = nm; *p; p++) if (*p == '_' || *p == '-') *p = ' ';
  { size_t L = strlen(nm); while (L && (isdigit((unsigned char)nm[L - 1]) || nm[L - 1] == ' ')) nm[--L] = 0;   /* "UprightPianoKW 20220221" -> "Upright Piano KW" */
    char pretty[300]; size_t k = 0; for (size_t i = 0; nm[i] && k + 2 < sizeof pretty; i++) { if (i && isupper((unsigned char)nm[i]) && islower((unsigned char)nm[i - 1])) pretty[k++] = ' '; pretty[k++] = nm[i]; } pretty[k] = 0;
    if (k) snprintf(nm, sizeof nm, "%s", pretty); }
  cJSON *b = cJSON_CreateObject(); cJSON_AddStringToObject(b, "file", path); cJSON_AddStringToObject(b, "name", nm); cJSON_AddItemToObject(b, "presets", pr); cJSON_AddBoolToObject(b, "user", a->user); cJSON_AddItemToArray(a->arr, b);
}
static void add_ir(const char *path, const char *name, void *arg) {
  if (!ends_ci(name, ".wav")) return; char nm[256]; snprintf(nm, sizeof nm, "%s", name); nm[strlen(nm) - 4] = 0; for (char *p = nm; *p; p++) if (*p == '_') *p = ' ';
  cJSON *o = cJSON_CreateObject(); cJSON_AddStringToObject(o, "name", nm); cJSON_AddStringToObject(o, "file", path); cJSON_AddItemToArray((cJSON *)arg, o);
}
static void user_dir(char *out, size_t n, const char *sub) { char a[1100]; path_join(a, sizeof a, dataDir, "sounds"); path_join(out, n, a, sub); }
static cJSON *keys_catalog(void) {
  char ud[1100]; user_dir(ud, sizeof ud, "sf2");
  if (!catCache) { catCache = cJSON_CreateArray(); CatArg a = { catCache, 0 }; if (soundsDir[0]) list_dir(soundsDir, add_bank, &a); a.user = 1; list_dir(ud, add_bank, &a); }
  return cJSON_Duplicate(catCache, 1);
}
static cJSON *default_patch(void) {
  cJSON *cat = keys_catalog(), *best = NULL, *b;
  cJSON_ArrayForEach(b, cat) { const char *nm = cJSON_GetStringValue(cJSON_GetObjectItem(b, "name")); if (nm && (contains_ci(nm, "grand") || contains_ci(nm, "piano"))) { best = b; break; } }
  if (!best) best = cJSON_GetArrayItem(cat, 0);
  cJSON *out = NULL; if (best) { cJSON *p0 = cJSON_GetArrayItem(cJSON_GetObjectItem(best, "presets"), 0); out = cJSON_CreateObject(); cJSON_AddStringToObject(out, "file", cJSON_GetStringValue(cJSON_GetObjectItem(best, "file"))); cJSON_AddNumberToObject(out, "bank", cJSON_GetNumberValue(cJSON_GetObjectItem(p0, "bank"))); cJSON_AddNumberToObject(out, "prog", cJSON_GetNumberValue(cJSON_GetObjectItem(p0, "prog"))); }
  cJSON_Delete(cat); return out;
}

/* ------------------------------------------------------------------ status */
static cJSON *plugErrors;   /* slot -> why its plugin did not load (for the app) */
static char lastError[256] = ""; static int running;
static void status(void) {
  cJSON *s = cJSON_CreateObject(); cJSON_AddStringToObject(s, "type", "instrumentStatus"); cJSON_AddBoolToObject(s, "available", 1); cJSON_AddBoolToObject(s, "running", running);
  cJSON_AddStringToObject(s, "kind", kind); if (lastError[0]) cJSON_AddStringToObject(s, "error", lastError); else cJSON_AddNullToObject(s, "error");
  if (running && devName[0] && strcmp(kind, "keys")) { char d[300]; snprintf(d, sizeof d, "%s (%s)", devName, inChannel == 2 ? "both" : inChannel == 1 ? "input 2" : "input 1"); cJSON_AddStringToObject(s, "input", d); }
  else if (running && !strcmp(kind, "keys")) cJSON_AddStringToObject(s, "input", "MIDI keyboard"); else cJSON_AddNullToObject(s, "input");
  cJSON *ins = cJSON_AddArrayToObject(s, "inputs");
  if (ctx_init()) { ma_device_info *pi, *ci; ma_uint32 np = 0, nc = 0; if (ma_context_get_devices(&ctx, &pi, &np, &ci, &nc) == MA_SUCCESS) for (ma_uint32 i = 0; i < nc; i++) { char nm[300]; clean_name(ci[i].name, nm, sizeof nm); cJSON *o = cJSON_CreateObject(); cJSON_AddStringToObject(o, "name", nm); cJSON_AddStringToObject(o, "desc", nm); cJSON_AddNumberToObject(o, "channels", 2); cJSON_AddItemToArray(ins, o); } }
  cJSON_AddArrayToObject(s, "midiInputs");
  cJSON_AddItemToObject(s, "keysCatalog", keys_catalog());
  cJSON_AddStringToObject(s, "keysEngine", "Built-in (TinySoundFont)");
  cJSON *pl = cJSON_AddObjectToObject(s, "plugins"), *e;
  if (rigMap) cJSON_ArrayForEach(e, rigMap) { cJSON *uri = cJSON_GetObjectItem(e, "uri"), *ctl = cJSON_GetObjectItem(e, "app"); if (cJSON_IsString(uri) && ctl && !cJSON_GetObjectItem(pl, uri->valuestring)) cJSON_AddItemToObject(pl, uri->valuestring, cJSON_Duplicate(ctl, 1)); }
  if (running) cJSON_AddNumberToObject(s, "latencyMs", BLOCK * 2 / FS * 1000 + 5); else cJSON_AddNullToObject(s, "latencyMs");
  cJSON *irs = cJSON_AddArrayToObject(s, "irs"); char ud[1100]; user_dir(ud, sizeof ud, "ir"); list_dir(ud, add_ir, irs);
  cJSON_AddNumberToObject(s, "maxKeyLayers", MAXLAYERS); cJSON_AddBoolToObject(s, "looper", 0);
  { cJSON *q = cJSON_AddObjectToObject(s, "playAny"); cJSON_AddBoolToObject(q, "available", 1); cJSON_AddBoolToObject(q, "on", playNext.on); cJSON_AddStringToObject(q, "engine", "cu-rig"); }
  cJSON_AddNumberToObject(s, "cpu", cpuLoad); cJSON_AddStringToObject(s, "engine", "cu-rig");
  /* the musician's own plugins */
  cJSON_AddStringToObject(s, "pluginFormats", ph_formats());
  { char *j = ph_slots_json(); cJSON *o = j ? cJSON_Parse(j) : NULL; free(j); cJSON_AddItemToObject(s, "pluginSlots", o ? o : cJSON_CreateObject()); }
  cJSON_AddItemToObject(s, "pluginErrors", plugErrors ? cJSON_Duplicate(plugErrors, 1) : cJSON_CreateObject());
  emit_json(s); cJSON_Delete(s);
}

/* ------------------------------------------------------------------ config -> chain */
static double num(cJSON *o, const char *k, double def) { cJSON *v = cJSON_GetObjectItem(o, k); return cJSON_IsNumber(v) ? v->valuedouble : cJSON_IsBool(v) ? (cJSON_IsTrue(v) ? 1 : 0) : def; }
static const char *str(cJSON *o, const char *k, const char *def) { cJSON *v = cJSON_GetObjectItem(o, k); return cJSON_IsString(v) ? v->valuestring : def; }
static void clean_uid(const char *in, char *out) { int k = 0; for (const char *p = in; *p && k < 12; p++) if (isalnum((unsigned char)*p)) out[k++] = *p; out[k] = 0; if (!k) strcpy(out, "p"); }
static cJSON *map_entry(const char *id, const char *uri) {
  if (!rigMap) return NULL; cJSON *e = id ? cJSON_GetObjectItem(rigMap, id) : NULL; if (e) return e;
  cJSON *it; if (uri) cJSON_ArrayForEach(it, rigMap) { if (!strcmp(str(it, "uri", ""), uri)) return it; }
  return NULL;
}
static void plug_error(const char *slot, const char *why) { if (!plugErrors) plugErrors = cJSON_CreateObject(); cJSON_DeleteItemFromObject(plugErrors, slot); if (why) cJSON_AddStringToObject(plugErrors, slot, why); }
static PhPlug *plug_from(const char *slot, cJSON *pl, cJSON *owner) {   /* {format, id, path} (+ the owner's stateFrom) -> a running plugin */
  char err[200] = ""; PhPlug *p = ph_get(slot, str(pl, "format", ""), str(pl, "id", ""), str(pl, "path", ""), str(owner, "stateFrom", ""), FS, MAXBLOCK, err, sizeof err);
  plug_error(slot, p ? NULL : err[0] ? err : "the plugin did not load"); return p;
}
static void fx_from(Fx *x, cJSON *it) {
  memset(x, 0, sizeof *x); clean_uid(str(it, "uid", "p"), x->uid); snprintf(x->id, sizeof x->id, "%s", str(it, "id", ""));
  cJSON *pl = cJSON_GetObjectItem(it, "plugin");
  if (cJSON_IsObject(pl)) {   /* the musician's own plugin: no knobs here, its state lives with the plugin host */
    x->type = FX_PLUG; x->on = cJSON_IsFalse(cJSON_GetObjectItem(it, "on")) ? 0 : 1; x->mix = (float)num(it, "mix", 1); x->levelDb = (float)num(it, "levelDb", 0); mix_gains(x);
    x->plug = plug_from(x->uid, pl, it); return;
  }
  const char *uri = str(it, "uri", ""); cJSON *m = map_entry(x->id, uri);
  x->type = fx_type(m ? str(m, "cat", "") : "", x->id, uri); x->on = cJSON_IsFalse(cJSON_GetObjectItem(it, "on")) ? 0 : 1; x->mix = (float)num(it, "mix", 1); x->levelDb = (float)num(it, "levelDb", 0); mix_gains(x);
  cJSON *ctls = m ? cJSON_GetObjectItem(m, "controls") : NULL, *knobs = m ? cJSON_GetObjectItem(m, "knobs") : NULL, *vals = cJSON_GetObjectItem(it, "values"), *c;
  if (ctls) cJSON_ArrayForEach(c, ctls) {
    if (x->nctl >= 24) break; Ctl *k = &x->ctl[x->nctl]; snprintf(k->sym, sizeof k->sym, "%s", c->string);
    k->min = (float)cJSON_GetNumberValue(cJSON_GetArrayItem(c, 0)); k->max = (float)cJSON_GetNumberValue(cJSON_GetArrayItem(c, 1)); k->def = (float)cJSON_GetNumberValue(cJSON_GetArrayItem(c, 2)); k->log = (int)cJSON_GetNumberValue(cJSON_GetArrayItem(c, 3));
    snprintf(k->unit, sizeof k->unit, "%s", cJSON_GetStringValue(cJSON_GetArrayItem(c, 4)) ? cJSON_GetStringValue(cJSON_GetArrayItem(c, 4)) : ""); for (char *p = k->unit; *p; p++) *p = (char)tolower((unsigned char)*p);
    const char *label = knobs ? cJSON_GetStringValue(cJSON_GetObjectItem(knobs, k->sym)) : NULL; k->role = role_of(label ? label : cJSON_GetStringValue(cJSON_GetArrayItem(c, 5)), k->sym);
    cJSON *v = vals ? cJSON_GetObjectItem(vals, k->sym) : NULL; x->val[x->nctl] = cJSON_IsNumber(v) ? (float)v->valuedouble : k->def; x->nctl++;
  }
  if (x->type == FX_IR) { const char *file = str(it, "file", ""); if (file[0]) { x->ir = load_ir(file, &x->irLen); if (x->ir) { x->hist[0] = calloc((size_t)x->irLen, sizeof(float)); x->hist[1] = calloc((size_t)x->irLen, sizeof(float)); } } }
  fx_params(x); fx_prepare(x);
}
static Chain *chain_from(cJSON *chain, cJSON *input, int keysKind) {
  Chain *c = calloc(1, sizeof *c); cJSON *it;
  if (chain) cJSON_ArrayForEach(it, chain) { if (c->n >= MAXFX) break; fx_from(&c->fx[c->n], it); c->n++; }
  if (!keysKind && input) { c->gateOn = cJSON_IsFalse(cJSON_GetObjectItem(input, "gateOn")) ? 0 : 1; c->gateDb = (float)num(input, "gateDb", -65); }
  return c;
}
static void chain_swap(Chain *c) {
  for (int i = 0; i < nGrave; i++) { Chain *g = graveyard[i]; for (int x = 0; x < g->n; x++) fx_free(&g->fx[x]); free(g); }   /* old ones: the audio thread is long past them */
  nGrave = 0;
  if (devOpen) { Chain *old = atomic_exchange(&chainNext, c); if (old) { for (int x = 0; x < old->n; x++) fx_free(&old->fx[x]); free(old); } }
  else { if (chainLive) { for (int x = 0; x < chainLive->n; x++) fx_free(&chainLive->fx[x]); free(chainLive); } chainLive = c; }
}
static Fx *find_fx(const char *uid) { char u[24]; clean_uid(uid, u); Chain *c = atomic_load(&chainNext); if (!c) c = chainLive; if (!c) return NULL; for (int i = 0; i < c->n; i++) if (!strcmp(c->fx[i].uid, u)) return &c->fx[i]; return NULL; }
static void routing(cJSON *r) {
  cJSON *ins = r ? cJSON_GetObjectItem(cJSON_GetObjectItem(r, "buses"), "instrument") : NULL; int ch = ins ? (int)num(ins, "ch", 1) : 1;
  outStereo = r && !strcmp(str(r, "mode", ""), "stereo") ? 1 : !r ? 1 : 1; outFirst = ch > 0 ? ch - 1 : 0; if (playCh && outFirst >= playCh) outFirst = 0;
  const char *dev2 = r ? str(r, "device", "") : ""; if (dev2[0]) snprintf(devOut, sizeof devOut, "%s", dev2);
}
static void keys_set(cJSON *k) {
  if (strstr(lastError, "SoundFont")) lastError[0] = 0;   /* (asked again for these layers below) */
  Keys nk; memset(&nk, 0, sizeof nk); nk.transpose = (int)num(k, "transpose", 0); nk.sustain = !cJSON_IsFalse(cJSON_GetObjectItem(k, "sustain")); snprintf(nk.velocity, sizeof nk.velocity, "%s", str(k, "velocity", "normal")); nk.volume = (float)num(k, "volume", 0.8);
  cJSON *layers = cJSON_GetObjectItem(k, "layers"), *ly; cJSON *one = NULL;
  if (!cJSON_IsArray(layers) || !cJSON_GetArraySize(layers)) { one = cJSON_CreateArray(); cJSON *l0 = cJSON_CreateObject(); cJSON *p = cJSON_GetObjectItem(k, "patch"); if (p) cJSON_AddItemToObject(l0, "patch", cJSON_Duplicate(p, 1)); cJSON_AddItemToArray(one, l0); layers = one; }
  cJSON *fallback = NULL;
  cJSON_ArrayForEach(ly, layers) {
    if (nk.n >= MAXLAYERS) break; Layer *L = &nk.l[nk.n++]; cJSON *p = cJSON_GetObjectItem(ly, "patch");
    L->on = !cJSON_IsFalse(cJSON_GetObjectItem(ly, "on")); L->volume = (float)num(ly, "volume", 1); L->pan = (float)num(ly, "pan", 0); L->octave = (int)num(ly, "octave", 0); L->transpose = (int)num(ly, "transpose", 0);
    L->lo = (int)num(ly, "lo", 0); L->hi = (int)num(ly, "hi", 127); L->velLo = (int)num(ly, "velLo", 1); L->velHi = (int)num(ly, "velHi", 127);
    cJSON *pl = cJSON_GetObjectItem(ly, "plugin"); if (!cJSON_IsObject(pl) && p) pl = cJSON_GetObjectItem(p, "plugin");
    if (cJSON_IsObject(pl)) { char slot[24]; clean_uid(str(ly, "uid", ""), slot); if (!strcmp(slot, "p")) snprintf(slot, sizeof slot, "layer%d", nk.n - 1); L->plug = plug_from(slot, pl, ly); L->bankIx = -1; continue; }
    const char *file = p ? str(p, "file", "") : ""; FILE *test = file[0] ? fopen(file, "rb") : NULL;
    if (test) fclose(test); else { if (!fallback) fallback = default_patch(); p = fallback; file = p ? str(p, "file", "") : ""; }
    L->bank = p ? (int)num(p, "bank", 0) : 0; L->prog = p ? (int)num(p, "prog", 0) : 0; L->bankIx = file[0] ? bank_for(file) : -1;
    if (L->bankIx < 0 && !lastError[0]) snprintf(lastError, sizeof lastError, "no SoundFont banks found - add .sf2 files to %s", dataDir);
  }
  cJSON_Delete(fallback); cJSON_Delete(one);
  /* the old layers' plugins: let go once the audio thread has moved to the new layers (it clears keysDirty when it has) */
  static PhPlug *old[MAXLAYERS * 4]; static int nOld;
  if (!devOpen || !atomic_load(&keysDirty)) { for (int i = 0; i < nOld; i++) ph_release(old[i]); nOld = 0; }
  for (int i = 0; i < keysCfg.n; i++) if (keysCfg.l[i].plug) { if (nOld < MAXLAYERS * 4) old[nOld++] = keysCfg.l[i].plug; else ph_release(keysCfg.l[i].plug); }
  keysCfg = nk; atomic_store(&keysDirty, 1);   /* (a plain copy: the audio thread picks the flag up before it reads the layers again) */
}
static cJSON *lastConfig;
/* play any sound's settings (control thread): {on, patch {file, bank, prog, name}, mode "auto" | "notes" | "synth",
   dry 0..1, sensitivity 0..1, volume 0..1.5} - the range of notes from the instrument (bass lower) */
static void playany_set(cJSON *pc, const char *forKind) {
  PlayCfg n; memset(&n, 0, sizeof n); n.bankIx = -1;
  n.on = cJSON_IsObject(pc) && cJSON_IsTrue(cJSON_GetObjectItem(pc, "on")) && strcmp(forKind, "keys") && strcmp(forKind, "off");
  const char *mode = cJSON_IsObject(pc) ? str(pc, "mode", "auto") : "auto"; n.mode = !strcmp(mode, "notes") ? PA_NOTES : !strcmp(mode, "synth") ? PA_SYNTH : PA_AUTO;
  n.dry = cJSON_IsObject(pc) ? clampf((float)num(pc, "dry", 0), 0, 1) : 0; n.sens = cJSON_IsObject(pc) ? clampf((float)num(pc, "sensitivity", 0.5), 0, 1) : 0.5f; n.volume = cJSON_IsObject(pc) ? clampf((float)num(pc, "volume", 1), 0, 1.5f) : 1;
  int bass = !strcmp(forKind, "bass"); n.lo = bass ? 23 : 40; n.hi = bass ? 67 : 88;
  cJSON *patch = cJSON_IsObject(pc) ? cJSON_GetObjectItem(pc, "patch") : NULL, *fallback = NULL;
  const char *file = patch ? str(patch, "file", "") : ""; FILE *test = file[0] ? fopen(file, "rb") : NULL;
  if (test) fclose(test); else if (n.on && n.mode != PA_SYNTH) { fallback = default_patch(); patch = fallback; file = patch ? str(patch, "file", "") : ""; }
  if (n.on && file[0] && n.mode != PA_SYNTH) { n.bankIx = bank_for(file); n.bank = (int)num(patch, "bank", 0); n.prog = (int)num(patch, "prog", 0); }
  if (n.on && n.mode != PA_SYNTH && n.bankIx < 0 && !lastError[0]) snprintf(lastError, sizeof lastError, "play any sound: no SoundFont bank for the sound - add .sf2 files to %s", dataDir);
  const char *name = patch ? str(patch, "name", "") : ""; n.tone = pa_tone_for_name(name[0] ? name : file);
  cJSON_Delete(fallback);
  playNext = n; atomic_store(&playDirty, 1);
}
static void plugs_keep(void) {   /* the plugin host keeps the plugins the newest chain and layers use, and saves + lets go of the rest */
  const char *slots[MAXFX + MAXLAYERS]; char names[MAXLAYERS][24]; int n = 0;
  Chain *c = atomic_load(&chainNext); if (!c) c = chainLive;
  if (c) for (int i = 0; i < c->n; i++) if (c->fx[i].type == FX_PLUG) slots[n++] = c->fx[i].uid;
  if (!strcmp(kind, "keys")) for (int i = 0; i < keysCfg.n; i++) if (keysCfg.l[i].plug) { snprintf(names[i], sizeof names[i], "%s", ph_slot(keysCfg.l[i].plug)); slots[n++] = names[i]; }
  ph_keep_only(slots, n);
}
static void keys_drop_plugins(void) { for (int i = 0; i < keysCfg.n; i++) if (keysCfg.l[i].plug) { ph_release(keysCfg.l[i].plug); keysCfg.l[i].plug = NULL; } }   /* (only with the audio stopped or not in keys) */
static void apply(cJSON *config) {
  if (config) { cJSON_Delete(lastConfig); lastConfig = cJSON_Duplicate(config, 1); }
  cJSON *c = lastConfig; if (!c) return;
  const char *k = str(c, "kind", "off"); lastError[0] = 0;
  cJSON *input = cJSON_GetObjectItem(c, "input");
  levelGain = db2lin(num(c, "levelDb", 0)); inGain = input ? db2lin(num(input, "gainDb", 0)) : 1;
  const char *chs = input ? str(input, "channel", "L") : "L"; inChannel = !strcmp(chs, "stereo") ? 2 : !strcmp(chs, "R") ? 1 : 0;
  routing(cJSON_GetObjectItem(c, "routing"));
  if (!strcmp(k, "off")) { dev_stop(); snprintf(kind, sizeof kind, "off"); running = 0; chain_swap(NULL); keys_drop_plugins(); plugs_keep(); playany_set(NULL, "off"); return; }
  int keysKind = !strcmp(k, "keys");
  const char *want = input ? str(input, "device", "auto") : "auto"; int reopen = !devOpen || strcmp(kind, k) != 0 || (!keysKind && strcmp(want, devIn) != 0);
  snprintf(devIn, sizeof devIn, "%s", want);
  if (reopen) { dev_stop(); snprintf(kind, sizeof kind, "%s", k); }
  if (keysKind) { cJSON *kc = cJSON_GetObjectItem(c, "keys"), *empty = kc ? NULL : cJSON_CreateObject(); keys_set(kc ? kc : empty); cJSON_Delete(empty); }
  else if (!devOpen) keys_drop_plugins();
  chain_swap(chain_from(cJSON_GetObjectItem(c, "chain"), input, keysKind));
  plugs_keep();
  playany_set(cJSON_GetObjectItem(c, "playAny"), k);
  if (reopen) { running = dev_start(!keysKind); if (!running && !lastError[0]) snprintf(lastError, sizeof lastError, "%s", devError); }
}

static void handle(cJSON *m) {
  const char *a = str(m, "action", ""); if (!strcmp(str(m, "type", ""), "routing")) a = "routing";
  if (!strcmp(a, "status")) { status(); return; }
  if (!strcmp(a, "apply")) { apply(cJSON_GetObjectItem(m, "config")); status(); return; }
  if (!strcmp(a, "set")) {
    Fx *x = find_fx(str(m, "uid", "")); if (!x) return; const char *sym = str(m, "sym", ""); double v = num(m, "value", 0);
    for (int i = 0; i < x->nctl; i++) if (!strcmp(x->ctl[i].sym, sym)) { x->val[i] = (float)v; fx_params(x); fx_prepare(x); }
    cJSON *ch = lastConfig ? cJSON_GetObjectItem(lastConfig, "chain") : NULL, *it; if (ch) cJSON_ArrayForEach(it, ch) { char u[24], w[24]; clean_uid(str(it, "uid", ""), u); clean_uid(str(m, "uid", ""), w); if (!strcmp(u, w)) { cJSON *vals = cJSON_GetObjectItem(it, "values"); if (!vals) vals = cJSON_AddObjectToObject(it, "values"); cJSON_DeleteItemFromObject(vals, sym); cJSON_AddNumberToObject(vals, sym, v); } }
    return;
  }
  if (!strcmp(a, "bypass") || !strcmp(a, "pedalmix")) {
    Fx *x = find_fx(str(m, "uid", "")); if (!x) return;
    cJSON *on = cJSON_GetObjectItem(m, "on"); if (cJSON_IsBool(on)) x->on = cJSON_IsTrue(on); else if (cJSON_IsNumber(on)) x->on = on->valuedouble != 0;
    if (cJSON_IsNumber(cJSON_GetObjectItem(m, "mix"))) x->mix = clampf((float)num(m, "mix", 1), 0, 1);
    if (cJSON_IsNumber(cJSON_GetObjectItem(m, "levelDb"))) x->levelDb = clampf((float)num(m, "levelDb", 0), -60, 12);
    mix_gains(x); return;
  }
  if (!strcmp(a, "scene")) {
    cJSON *ps = cJSON_GetObjectItem(m, "pedals"), *p; if (ps) cJSON_ArrayForEach(p, ps) { cJSON *q = cJSON_Duplicate(p, 1); cJSON_AddStringToObject(q, "action", "pedalmix"); handle(q); cJSON_Delete(q); }
    if (cJSON_GetObjectItem(m, "keys") && !cJSON_IsNull(cJSON_GetObjectItem(m, "keys"))) { if (lastConfig) { cJSON_DeleteItemFromObject(lastConfig, "keys"); cJSON_AddItemToObject(lastConfig, "keys", cJSON_Duplicate(cJSON_GetObjectItem(m, "keys"), 1)); } if (!strcmp(kind, "keys")) { keys_set(cJSON_GetObjectItem(m, "keys")); plugs_keep(); } }
    if (cJSON_IsNumber(cJSON_GetObjectItem(m, "levelDb"))) levelGain = db2lin(num(m, "levelDb", 0));
    return;
  }
  if (!strcmp(a, "level")) { levelGain = db2lin(num(m, "levelDb", 0)); return; }
  if (!strcmp(a, "input")) {
    cJSON *in = cJSON_GetObjectItem(m, "input"); if (!in) return;
    if (lastConfig) { cJSON_DeleteItemFromObject(lastConfig, "input"); cJSON_AddItemToObject(lastConfig, "input", cJSON_Duplicate(in, 1)); }
    const char *want = str(in, "device", "auto");
    if (strcmp(want, devIn) && strcmp(kind, "off") && strcmp(kind, "keys")) { apply(NULL); status(); return; }
    inGain = db2lin(num(in, "gainDb", 0)); const char *chs = str(in, "channel", "L"); inChannel = !strcmp(chs, "stereo") ? 2 : !strcmp(chs, "R") ? 1 : 0;
    Chain *c = chainLive; if (c) { c->gateOn = cJSON_IsFalse(cJSON_GetObjectItem(in, "gateOn")) ? 0 : 1; c->gateDb = (float)num(in, "gateDb", -65); }
    return;
  }
  if (!strcmp(a, "keys")) { cJSON *k = cJSON_GetObjectItem(m, "keys"); if (!k) return; if (lastConfig) { cJSON_DeleteItemFromObject(lastConfig, "keys"); cJSON_AddItemToObject(lastConfig, "keys", cJSON_Duplicate(k, 1)); } if (!strcmp(kind, "keys")) { keys_set(k); plugs_keep(); status(); } return; }
  if (!strcmp(a, "note")) { int on = cJSON_IsTrue(cJSON_GetObjectItem(m, "on")); push_ev(on ? 0x90 : 0x80, (int)num(m, "note", 60), on ? (int)num(m, "velocity", 100) : 0); return; }
  if (!strcmp(a, "midi")) { cJSON *d = cJSON_GetObjectItem(m, "data"); if (cJSON_GetArraySize(d) >= 2) push_ev((int)cJSON_GetNumberValue(cJSON_GetArrayItem(d, 0)), (int)cJSON_GetNumberValue(cJSON_GetArrayItem(d, 1)), cJSON_GetArraySize(d) > 2 ? (int)cJSON_GetNumberValue(cJSON_GetArrayItem(d, 2)) : 0); return; }
  if (!strcmp(a, "routing")) { routing(cJSON_GetObjectItem(m, "routing")); return; }
  if (!strcmp(a, "playany")) {   /* play any sound, live (the footswitch, the Instrument tab) */
    cJSON *pc = cJSON_GetObjectItem(m, "playAny"); if (!cJSON_IsObject(pc)) return;
    if (lastConfig) { cJSON_DeleteItemFromObject(lastConfig, "playAny"); cJSON_AddItemToObject(lastConfig, "playAny", cJSON_Duplicate(pc, 1)); }
    if (strstr(lastError, "play any")) lastError[0] = 0;
    playany_set(pc, kind); status(); return;
  }
  if (!strcmp(a, "testtone")) { ttFreq = (float)num(m, "freq", 220); ttLevel = (float)num(m, "level", 0); return; }
  if (!strcmp(a, "rescan")) { cJSON_Delete(catCache); catCache = NULL; status(); return; }
  /* the musician's own plugins */
  if (!strcmp(a, "plugins")) {   /* {scan, force, folders: [...]}: the list (and a fresh scan) */
    if (cJSON_IsTrue(cJSON_GetObjectItem(m, "scan"))) { cJSON *f = cJSON_GetObjectItem(m, "folders"); char *fj = f ? cJSON_PrintUnformatted(f) : NULL; ph_scan(fj ? fj : "[]", cJSON_IsTrue(cJSON_GetObjectItem(m, "force"))); free(fj); }
    char *j = ph_list_json(); cJSON *o = j ? cJSON_Parse(j) : NULL; free(j); if (o) { cJSON_AddStringToObject(o, "type", "pluginList"); emit_json(o); cJSON_Delete(o); } return;
  }
  if (!strcmp(a, "pluginParams")) { char slot[24]; clean_uid(str(m, "uid", ""), slot); char *j = ph_params_json(slot, (int)num(m, "max", 16)); cJSON *o = cJSON_CreateObject(); cJSON_AddStringToObject(o, "type", "pluginParams"); cJSON_AddStringToObject(o, "uid", str(m, "uid", "")); cJSON *pa = j ? cJSON_Parse(j) : NULL; free(j); cJSON_AddItemToObject(o, "params", pa ? pa : cJSON_CreateArray()); emit_json(o); cJSON_Delete(o); return; }
  if (!strcmp(a, "pluginSet")) { char slot[24]; clean_uid(str(m, "uid", ""), slot); ph_set_param(slot, (uint32_t)num(m, "id", 0), num(m, "value", 0)); return; }
  if (!strcmp(a, "pluginEditor")) { char slot[24]; clean_uid(str(m, "uid", ""), slot); int open = ph_editor(slot, cJSON_IsFalse(cJSON_GetObjectItem(m, "open")) ? 0 : 1); cJSON *o = cJSON_CreateObject(); cJSON_AddStringToObject(o, "type", "pluginEditor"); cJSON_AddStringToObject(o, "uid", str(m, "uid", "")); cJSON_AddBoolToObject(o, "open", open); if (!open && !cJSON_IsFalse(cJSON_GetObjectItem(m, "open"))) cJSON_AddStringToObject(o, "error", ph_has_editor(slot) ? "The plugin's window did not open." : "This plugin has no window of its own here."); emit_json(o); cJSON_Delete(o); return; }
  if (!strcmp(a, "pluginSave")) { ph_save_all(); return; }
  /* (10.1) a community plugin that was bypassed (crashed, stopped responding, too heavy): "Try again" loads it afresh */
  if (!strcmp(a, "pluginRestart")) { char slot[24]; clean_uid(str(m, "uid", ""), slot); ph_forget_slot(slot); apply(NULL); status(); return; }
  if (!strcmp(a, "pluginCopyState")) { char from[24], to[24]; clean_uid(str(m, "from", ""), from); clean_uid(str(m, "to", ""), to); int ok = ph_copy_state(from, to); cJSON *o = cJSON_CreateObject(); cJSON_AddStringToObject(o, "type", "pluginCopyState"); cJSON_AddStringToObject(o, "from", str(m, "from", "")); cJSON_AddStringToObject(o, "to", str(m, "to", "")); cJSON_AddBoolToObject(o, "ok", ok); emit_json(o); cJSON_Delete(o); return; }
  if (!strcmp(a, "meters")) { cJSON *o = cJSON_CreateObject(); cJSON_AddStringToObject(o, "type", "instrumentMeters"); cJSON_AddNumberToObject(o, "in", inPeak); cJSON_AddNumberToObject(o, "out", outPeak); cJSON_AddNumberToObject(o, "cpu", cpuLoad); { Chain *c = chainLive; if (c) { cJSON *g = NULL; for (int i = 0; i < c->n; i++) { Fx *x = &c->fx[i]; if (x->type == FX_SCOMP || x->type == FX_SLIMIT || x->type == FX_SDEESS) { if (!g) g = cJSON_AddObjectToObject(o, "gr"); cJSON_AddNumberToObject(g, x->uid, isfinite(x->gr) ? (double)x->gr : 0); } } } }   /* gain reduction (dB) of the Studio dynamics */ if (playRt.on) { cJSON *q = cJSON_AddObjectToObject(o, "playAny"); PaInfo in = paInfoNow; cJSON_AddStringToObject(q, "state", in.state == PA_NOTE ? "note" : in.state == PA_CHORD ? "synth" : "idle"); cJSON_AddNumberToObject(q, "note", in.note); cJSON_AddNumberToObject(q, "voices", in.voices); }
    inPeak = outPeak = 0; emit_json(o); cJSON_Delete(o); return; }
}

static char *read_file(const char *path) { FILE *f = fopen(path, "rb"); if (!f) return NULL; fseek(f, 0, SEEK_END); long n = ftell(f); fseek(f, 0, SEEK_SET); char *s = malloc((size_t)n + 1); if (fread(s, 1, (size_t)n, f) != (size_t)n) { fclose(f); free(s); return NULL; } s[n] = 0; fclose(f); return s; }
static void on_line(char *line) { cJSON *m = cJSON_Parse(line); if (!m) return; handle(m); cJSON_Delete(m); }
static void on_quit(void) { ph_save_all(); dev_stop(); chain_swap(NULL); keys_drop_plugins(); ph_keep_only(NULL, 0); if (ctxOk) ma_context_uninit(&ctx); }
int main(int argc, char **argv) {
  const char *scanFormat = NULL, *scanPath = NULL;
  for (int i = 1; i < argc; i++) {
    if (!strcmp(argv[i], "--data") && i + 1 < argc) snprintf(dataDir, sizeof dataDir, "%s", argv[++i]);
    else if (!strcmp(argv[i], "--sounds") && i + 1 < argc) snprintf(soundsDir, sizeof soundsDir, "%s", argv[++i]);
    else if (!strcmp(argv[i], "--map") && i + 1 < argc) snprintf(mapPath, sizeof mapPath, "%s", argv[++i]);
    else if (!strcmp(argv[i], "--backend") && i + 1 < argc) snprintf(backendArg, sizeof backendArg, "%s", argv[++i]);
    else if (!strcmp(argv[i], "--block") && i + 1 < argc) BLOCK = atoi(argv[++i]);
    else if (!strcmp(argv[i], "--version")) { puts("cu-rig 2"); return 0; }
    else if (!strcmp(argv[i], "--scan-one") && i + 2 < argc) { scanFormat = argv[i + 1]; scanPath = argv[i + 2]; i += 2; }
  }
  /* our own copy of stdout for the app; whatever else prints (plugins) goes to stderr */
#ifdef _WIN32
  { int pfd = _dup(1); _dup2(2, 1); proto = _fdopen(pfd, "wb"); SetStdHandle(STD_OUTPUT_HANDLE, GetStdHandle(STD_ERROR_HANDLE)); }
#else
  { int pfd = dup(1); dup2(2, 1); proto = fdopen(pfd, "w"); }
#endif
  if (!proto) proto = stdout;
  pl_mutex_init(&outLock);
  ph_init(dataDir, emit_raw);
  if (scanFormat) return ph_scan_one_main(scanFormat, scanPath);
  if (BLOCK < 32) BLOCK = 32; if (BLOCK > 2048) BLOCK = 2048;
  if (mapPath[0]) { char *s = read_file(mapPath); if (s) { rigMap = cJSON_Parse(s); free(s); } }
  status();
  return ph_run(on_line, on_quit);   /* the main thread: commands, plugins and their windows (stdin is read on a thread of its own) */
}
