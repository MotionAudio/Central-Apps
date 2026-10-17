/* cu-mixer - the audio engine of Central Usage (the audio host computer).
 *
 *  Inputs (up to 128): the audio interface's inputs, and the Central Control's channels that arrive over
 *  the network (each track on its own channel, click, pads, instrument).
 *  Each input: trim, polarity, high-pass, 3-band EQ (low shelf, bell, high shelf), compressor, then
 *    - the main mix (fader, pan, mute)          -> two interface outputs (the tracks summed out over USB)
 *    - a direct output (pre or post fader)      -> any interface output (each track on its own USB output)
 *    - 48 in-ear mixes (level and pan per mix)  -> interface outputs (packs), or back over Wi-Fi
 *  Every mix has a level, mute and a limiter; any mix (and the main mix) can be "tapped": its audio comes
 *  back to Central Usage (Wi-Fi in-ears, listening on the laptop, recording, the live waveform).
 *  Meters, 3-band levels and onsets (the lights react to the music) come back 20 times a second.
 *
 *  Audio runs through JACK (PipeWire's JACK on current Linux: start it with pw-jack). With no JACK it runs
 *  on its own clock: the network channels still mix, tap and meter (Wi-Fi in-ears work without an interface).
 *
 *  stdin / stdout carry framed messages: u8 type, u32 length (little endian), payload.
 *    in : 'J' a JSON command (one object)        'N' network audio: u8 source, u8 channels, u16 frames, int16 data
 *    out: 'J' a JSON event (status, meters)      'A' tap audio: u8 tap (0 main, 1..48 mixes), u16 frames, int16 stereo
 *
 *  cc -O2 -o cu-mixer cu-mixer.c -lm -ldl -lpthread           (no JACK headers needed: libjack is loaded at run time)
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <math.h>
#include <pthread.h>
#include <signal.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#define MAXIN 128
#define MAXMIX 48
#define MAXOUT 128
#define MAXNET 4
#define MAXNETCH 40
#define NETRING 32768          /* frames per network channel (0.68 s at 48 kHz) */
#define MAXBLOCK 4096
#define TAPFRAMES 960          /* 20 ms at 48 kHz per tap message */
#define CMDRING 4096
#define OUTRING (8 << 20)

/* ------------------------------------------------------------------ JACK, loaded at run time */
typedef uint32_t jack_nframes_t;
typedef struct _jack_client jack_client_t;
typedef struct _jack_port jack_port_t;
enum { JackNullOption = 0, JackNoStartServer = 1 };
enum { JackPortIsInput = 1, JackPortIsOutput = 2, JackPortIsPhysical = 4 };
#define JACK_AUDIO "32 bit float mono audio"
static struct {
  jack_client_t *(*client_open)(const char *, int, int *, ...);
  int (*client_close)(jack_client_t *);
  int (*set_process_callback)(jack_client_t *, int (*)(jack_nframes_t, void *), void *);
  void (*on_shutdown)(jack_client_t *, void (*)(void *), void *);
  int (*set_xrun_callback)(jack_client_t *, int (*)(void *), void *);
  int (*activate)(jack_client_t *);
  jack_port_t *(*port_register)(jack_client_t *, const char *, const char *, unsigned long, unsigned long);
  void *(*port_get_buffer)(jack_port_t *, jack_nframes_t);
  const char **(*get_ports)(jack_client_t *, const char *, const char *, unsigned long);
  int (*connect)(jack_client_t *, const char *, const char *);
  const char *(*port_name)(const jack_port_t *);
  void (*free)(void *);
  jack_nframes_t (*get_sample_rate)(jack_client_t *);
  jack_nframes_t (*get_buffer_size)(jack_client_t *);
  float (*cpu_load)(jack_client_t *);
} J;
static void *jlib;
static int load_jack(void) {
  const char *names[] = { "libjack.so.0", "libjack.so", NULL };
  for (int i = 0; names[i] && !jlib; i++) jlib = dlopen(names[i], RTLD_NOW | RTLD_LOCAL);
  if (!jlib) return 0;
#define SYM(f, n) if (!(*(void **)&J.f = dlsym(jlib, n))) return 0
  SYM(client_open, "jack_client_open"); SYM(client_close, "jack_client_close"); SYM(set_process_callback, "jack_set_process_callback");
  SYM(on_shutdown, "jack_on_shutdown"); SYM(set_xrun_callback, "jack_set_xrun_callback"); SYM(activate, "jack_activate");
  SYM(port_register, "jack_port_register"); SYM(port_get_buffer, "jack_port_get_buffer"); SYM(get_ports, "jack_get_ports");
  SYM(connect, "jack_connect"); SYM(port_name, "jack_port_name"); SYM(free, "jack_free"); SYM(get_sample_rate, "jack_get_sample_rate");
  SYM(get_buffer_size, "jack_get_buffer_size"); SYM(cpu_load, "jack_cpu_load");
#undef SYM
  return 1;
}

/* ------------------------------------------------------------------ DSP pieces */
typedef struct { float b0, b1, b2, a1, a2, z1, z2; } Biquad;
static inline float bq(Biquad *f, float x) { float y = f->b0 * x + f->z1; f->z1 = f->b1 * x - f->a1 * y + f->z2; f->z2 = f->b2 * x - f->a2 * y; return y; }
static void bq_set(Biquad *f, int type, double fs, double freq, double gainDb, double q) {   /* RBJ cookbook; keeps the state */
  if (freq < 10) freq = 10; if (freq > fs * 0.45) freq = fs * 0.45; if (q < 0.1) q = 0.1;
  double A = pow(10, gainDb / 40), w = 2 * M_PI * freq / fs, cw = cos(w), sw = sin(w), al = sw / (2 * q), b0, b1, b2, a0, a1, a2;
  if (type == 0) { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }                  /* high-pass */
  else if (type == 1) { double s = 2 * sqrt(A) * al; b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s); a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s; }   /* low shelf */
  else if (type == 2) { b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; }              /* bell */
  else { double s = 2 * sqrt(A) * al; b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s); a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s; }       /* high shelf */
  f->b0 = b0 / a0; f->b1 = b1 / a0; f->b2 = b2 / a0; f->a1 = a1 / a0; f->a2 = a2 / a0;
}

/* ------------------------------------------------------------------ state */
typedef struct {
  int src, ch;                 /* src 0 none, 1 interface input ch, 2 network: ch = source * MAXNETCH + channel */
  float trim; int hpfOn; Biquad hpf; int eqOn; Biquad eq[3];
  int compOn; float thr, ratio, attC, relC, makeup, env;
  float fader, pan, gL, gR, cL, cR; int mute; int direct, directPre;
  float peak, gr;
} Input;
typedef struct { int m; float gL, gR, cL, cR; } Send;
typedef struct { float level, cur; int mute, outL, outR, stereo, tap, used; float lim, peakL, peakR; } Mix;
typedef struct {
  int channels, used; double rate, target, ratio, rpos; float *ring; _Atomic uint64_t w; int primed; unsigned under, over; float peak[MAXNETCH]; double level;
} Net;

static Input in[MAXIN];
static Send sends[MAXIN][MAXMIX];
static int nsends[MAXIN];
static Mix mix[MAXMIX], mainb;          /* mainb: the main mix */
static Net net[MAXNET];
static double FS = 48000;
static int BLOCK = 256, nIn = 0, nOut = 0;
static jack_client_t *client;
static jack_port_t *inPorts[MAXIN], *outPorts[MAXOUT];
static float *zero, *scratch[MAXOUT], netbuf[MAXNET][MAXNETCH][MAXBLOCK], mixL[MAXMIX][MAXBLOCK], mixR[MAXMIX][MAXBLOCK], mainL[MAXBLOCK], mainR[MAXBLOCK], strip[MAXBLOCK];
static volatile int running = 1, internal = 0;
static _Atomic unsigned xruns;
static int analysisSrc = 0;            /* 0: every network channel of source 0 (the Central Control), 1: the main mix */
static float bandEnv[3], bandLp1, bandLp2, bandHp, bandSlow, onsetHold; static unsigned onsets;
static unsigned meterEvery, meterCount;
static float limCeil = 0.89f;          /* -1 dBFS */

/* ------------------------------------------------------------------ rings */
typedef struct { int kind, a, b; float f[24]; Input input; float *ptr; } Cmd;
static Cmd cmds[CMDRING]; static _Atomic unsigned cmdW, cmdR;
static uint8_t *outRing; static _Atomic uint64_t outW, outR;
static pthread_mutex_t outLock = PTHREAD_MUTEX_INITIALIZER; static pthread_cond_t outCond = PTHREAD_COND_INITIALIZER;

static int push_cmd(Cmd *c) { unsigned w = atomic_load(&cmdW), r = atomic_load(&cmdR); if (w - r >= CMDRING) return 0; cmds[w % CMDRING] = *c; atomic_store(&cmdW, w + 1); return 1; }
static void out_write(const void *data, size_t n) {   /* real-time side: drops when the ring is full */
  uint64_t w = atomic_load(&outW), r = atomic_load(&outR); if (w - r + n > OUTRING) return;
  const uint8_t *p = data; for (size_t i = 0; i < n; i++) outRing[(w + i) % OUTRING] = p[i];
  atomic_store(&outW, w + n);
}
static void out_msg(uint8_t type, const void *a, uint32_t na, const void *b, uint32_t nb) {
  uint8_t h[5] = { type, (uint8_t)(na + nb), (uint8_t)((na + nb) >> 8), (uint8_t)((na + nb) >> 16), (uint8_t)((na + nb) >> 24) };
  uint64_t w = atomic_load(&outW), r = atomic_load(&outR); if (w - r + 5 + na + nb > OUTRING) return;
  out_write(h, 5); if (na) out_write(a, na); if (nb) out_write(b, nb);
}
static void wake_writer(void) { pthread_cond_signal(&outCond); }

/* ------------------------------------------------------------------ JSON in (flat objects, numbers, number arrays, strings) */
static const char *jkey(const char *js, const char *key) { char pat[64]; snprintf(pat, sizeof pat, "\"%s\"", key); const char *p = strstr(js, pat); if (!p) return NULL; p += strlen(pat); while (*p == ' ' || *p == ':') p++; return p; }
static double jnum(const char *js, const char *key, double def) { const char *p = jkey(js, key); if (!p) return def; if (*p == 't') return 1; if (*p == 'f' || *p == 'n') return def; char *e; double v = strtod(p, &e); return e == p ? def : v; }
static int jarr(const char *js, const char *key, float *out, int max) { const char *p = jkey(js, key); if (!p || *p != '[') return 0; p++; int n = 0; while (*p && *p != ']' && n < max) { char *e; double v = strtod(p, &e); if (e == p) { p++; continue; } out[n++] = (float)v; p = e; while (*p == ',' || *p == ' ') p++; } return n; }
static int jstr(const char *js, const char *key, char *out, int max) { const char *p = jkey(js, key); if (!p || *p != '"') return 0; p++; int n = 0; while (*p && *p != '"' && n < max - 1) { if (*p == '\\' && p[1]) p++; out[n++] = *p++; } out[n] = 0; return 1; }
static float db2lin(double db) { return db <= -90 ? 0 : (float)pow(10, db / 20); }

enum { C_INPUT = 1, C_SEND, C_MIX, C_MAIN, C_NET, C_ANALYSIS, C_CLEARSENDS };
static void pan_gains(float g, float pan, float *L, float *R) { double a = (pan + 1) * M_PI / 4; *L = (float)(g * cos(a) * M_SQRT2); *R = (float)(g * sin(a) * M_SQRT2); if (*L > g) *L = g; if (*R > g) *R = g; }

static void command(const char *js) {
  char cmd[32] = ""; jstr(js, "cmd", cmd, sizeof cmd);
  Cmd c; memset(&c, 0, sizeof c);
  if (!strcmp(cmd, "input")) {
    int i = (int)jnum(js, "i", -1); if (i < 0 || i >= MAXIN) return;
    Input *x = &c.input; c.kind = C_INPUT; c.a = i;
    x->src = (int)jnum(js, "src", 0); x->ch = (int)jnum(js, "ch", 0);
    x->trim = db2lin(jnum(js, "trim", 0)) * (jnum(js, "phase", 0) ? -1 : 1);
    double hpf = jnum(js, "hpf", 0); x->hpfOn = hpf > 0; if (hpf > 0) bq_set(&x->hpf, 0, FS, hpf, 0, 0.707);
    float eq[8] = { 0 }; int ne = jarr(js, "eq", eq, 8);
    x->eqOn = ne >= 8 && eq[0] > 0; if (x->eqOn) { bq_set(&x->eq[0], 1, FS, eq[1], eq[2], 0.707); bq_set(&x->eq[1], 2, FS, eq[3], eq[4], eq[5]); bq_set(&x->eq[2], 3, FS, eq[6], eq[7], 0.707); }
    float cp[6] = { 0 }; int nc = jarr(js, "comp", cp, 6);
    x->compOn = nc >= 6 && cp[0] > 0; x->thr = cp[1]; x->ratio = cp[2] < 1 ? 1 : cp[2];
    x->attC = (float)exp(-1.0 / (FS * (cp[3] > 0.1 ? cp[3] : 10) / 1000)); x->relC = (float)exp(-1.0 / (FS * (cp[4] > 1 ? cp[4] : 120) / 1000)); x->makeup = db2lin(cp[5]);
    x->fader = db2lin(jnum(js, "fader", -90)); x->mute = (int)jnum(js, "mute", 0); x->pan = (float)jnum(js, "pan", 0);
    pan_gains(x->mute ? 0 : x->fader, x->pan, &x->gL, &x->gR);
    x->direct = (int)jnum(js, "direct", -1); x->directPre = (int)jnum(js, "directPre", 0);
  } else if (!strcmp(cmd, "send")) {
    c.kind = C_SEND; c.a = (int)jnum(js, "m", -1); c.b = (int)jnum(js, "i", -1); if (c.a < 0 || c.a >= MAXMIX || c.b < 0 || c.b >= MAXIN) return;
    float g = db2lin(jnum(js, "level", -90)); if (jnum(js, "on", 1) == 0) g = 0; pan_gains(g, (float)jnum(js, "pan", 0), &c.f[0], &c.f[1]);
  } else if (!strcmp(cmd, "mix") || !strcmp(cmd, "main")) {
    c.kind = cmd[1] == 'i' ? C_MIX : C_MAIN; c.a = (int)jnum(js, "m", 0); if (c.kind == C_MIX && (c.a < 0 || c.a >= MAXMIX)) return;
    c.f[0] = db2lin(jnum(js, "level", 0)); c.f[1] = (float)jnum(js, "mute", 0); c.f[2] = (float)jnum(js, "outL", -1); c.f[3] = (float)jnum(js, "outR", -1); c.f[4] = (float)jnum(js, "stereo", 1); c.f[5] = (float)jnum(js, "tap", 0); c.f[6] = (float)jnum(js, "used", 1);
  } else if (!strcmp(cmd, "clearSends")) { c.kind = C_CLEARSENDS; c.a = (int)jnum(js, "m", -1); if (c.a < 0 || c.a >= MAXMIX) return;
  } else if (!strcmp(cmd, "net")) {
    int s = (int)jnum(js, "src", -1); if (s < 0 || s >= MAXNET) return;
    c.kind = C_NET; c.a = s; c.b = (int)jnum(js, "channels", 0); if (c.b > MAXNETCH) c.b = MAXNETCH;
    c.f[0] = (float)jnum(js, "rate", 48000); c.f[1] = (float)jnum(js, "latency", 60);
    if (c.b > 0 && !net[s].ring) c.ptr = calloc((size_t)MAXNETCH * NETRING, sizeof(float));   /* allocated here, not on the audio thread */
  } else if (!strcmp(cmd, "analysis")) { c.kind = C_ANALYSIS; c.a = (int)jnum(js, "src", 0);
  } else if (!strcmp(cmd, "quit")) { running = 0; return;
  } else return;
  push_cmd(&c);
}

static void apply_cmds(void) {
  unsigned r = atomic_load(&cmdR), w = atomic_load(&cmdW);
  while (r != w) {
    Cmd *c = &cmds[r % CMDRING];
    if (c->kind == C_INPUT) {
      Input *x = &in[c->a], *n = &c->input; Biquad h = x->hpf, e0 = x->eq[0], e1 = x->eq[1], e2 = x->eq[2]; float env = x->env, cL = x->cL, cR = x->cR, pk = x->peak;
      int sameSrc = x->src == n->src && x->ch == n->ch;
      *x = *n;
      if (sameSrc) { x->hpf.z1 = h.z1; x->hpf.z2 = h.z2; x->eq[0].z1 = e0.z1; x->eq[0].z2 = e0.z2; x->eq[1].z1 = e1.z1; x->eq[1].z2 = e1.z2; x->eq[2].z1 = e2.z1; x->eq[2].z2 = e2.z2; x->env = env; x->cL = cL; x->cR = cR; x->peak = pk; }
    } else if (c->kind == C_SEND) {
      int m = c->a, i = c->b, k; for (k = 0; k < nsends[i]; k++) if (sends[i][k].m == m) break;
      if (c->f[0] == 0 && c->f[1] == 0) { if (k < nsends[i]) { sends[i][k].gL = sends[i][k].gR = 0; } }   /* glides to 0, removed below */
      else if (k < nsends[i]) { sends[i][k].gL = c->f[0]; sends[i][k].gR = c->f[1]; }
      else if (nsends[i] < MAXMIX) { Send *s = &sends[i][nsends[i]++]; s->m = m; s->gL = c->f[0]; s->gR = c->f[1]; s->cL = s->cR = 0; }
    } else if (c->kind == C_CLEARSENDS) {
      for (int i = 0; i < MAXIN; i++) for (int k = 0; k < nsends[i]; k++) if (sends[i][k].m == c->a) { sends[i][k].gL = sends[i][k].gR = 0; }
    } else if (c->kind == C_MIX || c->kind == C_MAIN) {
      Mix *m = c->kind == C_MIX ? &mix[c->a] : &mainb;
      m->level = c->f[0]; m->mute = c->f[1] != 0; m->outL = (int)c->f[2]; m->outR = (int)c->f[3]; m->stereo = c->f[4] != 0; m->tap = c->f[5] != 0; m->used = c->f[6] != 0;
    } else if (c->kind == C_NET) {
      Net *n = &net[c->a]; if (c->ptr && !n->ring) n->ring = c->ptr; else if (c->ptr) free(c->ptr);   /* (free on the audio thread happens only on a race at start) */
      n->channels = c->b; n->rate = c->f[0] > 1000 ? c->f[0] : 48000; n->target = c->f[1] * n->rate / 1000; n->used = c->b > 0 && n->ring;
      n->primed = 0; n->ratio = n->rate / FS;
    } else if (c->kind == C_ANALYSIS) analysisSrc = c->a;
    r++;
  }
  atomic_store(&cmdR, r);
}

/* ------------------------------------------------------------------ network audio in */
static void net_write(int s, int ch, int frames, const int16_t *data) {
  Net *n = &net[s]; if (!n->used || !n->ring) return;
  uint64_t w = atomic_load(&n->w); int C = ch < n->channels ? ch : n->channels;
  for (int f = 0; f < frames; f++) { size_t pos = (w + f) % NETRING; for (int c = 0; c < C; c++) n->ring[(size_t)c * NETRING + pos] = data[f * ch + c] * (1.0f / 32768); for (int c = C; c < n->channels; c++) n->ring[(size_t)c * NETRING + pos] = 0; }
  atomic_store(&n->w, w + frames);
}
static void net_read(int s, int frames) {   /* resample to the engine rate, keeping the buffer near its target (clock drift) */
  Net *n = &net[s];
  for (int c = 0; c < MAXNETCH; c++) memset(netbuf[s][c], 0, sizeof(float) * frames);
  if (!n->used || !n->ring) return;
  double w = (double)atomic_load(&n->w), level = w - n->rpos;
  if (!n->primed) { if (level >= n->target) { n->rpos = w - n->target; n->primed = 1; n->level = n->target; } else return; }
  level = w - n->rpos; n->level = n->level * 0.995 + level * 0.005;
  double step0 = n->rate / FS, need = frames * step0 + 2;
  if (level < need) { n->under++; n->primed = 0; return; }                          /* ran dry: wait for the target again */
  if (level > NETRING - MAXBLOCK * 4) { n->over++; n->rpos = w - n->target; }       /* far behind (a stall): jump */
  double err = (n->level - n->target) / (n->target > 1 ? n->target : 1), adj = err * 0.002; if (adj > 0.005) adj = 0.005; if (adj < -0.005) adj = -0.005;
  double step = step0 * (1 + adj), r = n->rpos;
  for (int f = 0; f < frames; f++) {
    uint64_t i0 = (uint64_t)r; float fr = (float)(r - (double)i0); size_t a = i0 % NETRING, b = (i0 + 1) % NETRING;
    for (int c = 0; c < n->channels; c++) { float *R = n->ring + (size_t)c * NETRING; float v = R[a] + (R[b] - R[a]) * fr; netbuf[s][c][f] = v; float av = fabsf(v); if (av > n->peak[c]) n->peak[c] = av; }
    r += step;
  }
  n->rpos = r;
}

/* ------------------------------------------------------------------ the mix */
static int16_t tapBuf[MAXMIX + 1][TAPFRAMES * 2]; static int tapN[MAXMIX + 1];
static void tap_add(int t, const float *L, const float *R, int frames) {
  for (int f = 0; f < frames; f++) {
    float l = L[f], r = R[f]; l = l > 1 ? 1 : l < -1 ? -1 : l; r = r > 1 ? 1 : r < -1 ? -1 : r;
    tapBuf[t][tapN[t] * 2] = (int16_t)(l * 32767); tapBuf[t][tapN[t] * 2 + 1] = (int16_t)(r * 32767);
    if (++tapN[t] == TAPFRAMES) { uint8_t h[3] = { (uint8_t)t, TAPFRAMES & 255, TAPFRAMES >> 8 }; out_msg('A', h, 3, tapBuf[t], TAPFRAMES * 4); tapN[t] = 0; wake_writer(); }
  }
}
static void meters_out(void);

static void process(int frames, float **ins, float **outs) {
  apply_cmds();
  for (int s = 0; s < MAXNET; s++) net_read(s, frames);
  for (int o = 0; o < nOut; o++) memset(outs[o], 0, sizeof(float) * frames);
  memset(mainL, 0, sizeof(float) * frames); memset(mainR, 0, sizeof(float) * frames);
  for (int m = 0; m < MAXMIX; m++) if (mix[m].used) { memset(mixL[m], 0, sizeof(float) * frames); memset(mixR[m], 0, sizeof(float) * frames); }
  const float gstep = 1.0f / 256;   /* gain glide per sample */
  for (int i = 0; i < MAXIN; i++) {
    Input *x = &in[i]; const float *src = NULL;
    if (x->src == 1 && x->ch >= 0 && x->ch < nIn && ins) src = ins[x->ch];
    else if (x->src == 2) { int s = x->ch / MAXNETCH, c = x->ch % MAXNETCH; if (s < MAXNET && net[s].used && c < net[s].channels) src = netbuf[s][c]; }
    if (!src) { x->peak *= 0.9f; continue; }
    float pk = x->peak, grMax = 0;
    for (int f = 0; f < frames; f++) {
      float v = src[f] * x->trim;
      if (x->hpfOn) v = bq(&x->hpf, v);
      if (x->eqOn) { v = bq(&x->eq[0], v); v = bq(&x->eq[1], v); v = bq(&x->eq[2], v); }
      if (x->compOn) {
        float a = fabsf(v); x->env = a > x->env ? x->attC * x->env + (1 - x->attC) * a : x->relC * x->env + (1 - x->relC) * a;
        float lev = x->env > 1e-6f ? 20 * log10f(x->env) : -120, over = lev - x->thr;
        if (over > 0) { float red = over * (1 - 1 / x->ratio); if (red > grMax) grMax = red; v *= powf(10, -red / 20); }
        v *= x->makeup;
      }
      strip[f] = v; float av = fabsf(v); if (av > pk) pk = av;
    }
    x->peak = pk; x->gr = grMax > x->gr ? grMax : x->gr * 0.9f;
    /* main */
    for (int f = 0; f < frames; f++) {
      x->cL += (x->gL - x->cL) * gstep; x->cR += (x->gR - x->cR) * gstep;
      mainL[f] += strip[f] * x->cL; mainR[f] += strip[f] * x->cR;
    }
    if (x->direct >= 0 && x->direct < nOut) { float g = x->directPre ? 1 : (x->mute ? 0 : x->fader); float *o = outs[x->direct]; for (int f = 0; f < frames; f++) o[f] += strip[f] * g; }
    /* in-ear mixes */
    for (int k = 0; k < nsends[i]; k++) {
      Send *s = &sends[i][k]; Mix *m = &mix[s->m]; if (!m->used) continue;
      float *L = mixL[s->m], *R = mixR[s->m];
      for (int f = 0; f < frames; f++) { s->cL += (s->gL - s->cL) * gstep; s->cR += (s->gR - s->cR) * gstep; L[f] += strip[f] * s->cL; R[f] += strip[f] * s->cR; }
      if (s->gL == 0 && s->gR == 0 && fabsf(s->cL) < 1e-5f && fabsf(s->cR) < 1e-5f) { sends[i][k] = sends[i][--nsends[i]]; k--; }
    }
  }
  /* mix masters: level, mute, limiter, outputs, taps */
  for (int m = -1; m < MAXMIX; m++) {
    Mix *b = m < 0 ? &mainb : &mix[m]; if (m >= 0 && !b->used) continue;
    float *L = m < 0 ? mainL : mixL[m], *R = m < 0 ? mainR : mixR[m], target = b->mute ? 0 : b->level, pl = b->peakL, pr = b->peakR;
    for (int f = 0; f < frames; f++) {
      b->cur += (target - b->cur) * gstep; float l = L[f] * b->cur, r = R[f] * b->cur;
      if (!b->stereo) { l = r = (l + r) * 0.5f; }
      float pk = fabsf(l) > fabsf(r) ? fabsf(l) : fabsf(r), g = pk > limCeil ? limCeil / pk : 1;   /* limiter: instant attack, ~200 ms release */
      if (g < b->lim || b->lim == 0) b->lim = g; else b->lim += (1 - b->lim) * 0.0001f; if (b->lim > 1) b->lim = 1;
      l *= b->lim; r *= b->lim; L[f] = l; R[f] = r;
      if (fabsf(l) > pl) pl = fabsf(l); if (fabsf(r) > pr) pr = fabsf(r);
    }
    b->peakL = pl; b->peakR = pr;
    if (b->outL >= 0 && b->outL < nOut) { float *o = outs[b->outL]; for (int f = 0; f < frames; f++) o[f] += L[f]; }
    if (b->outR >= 0 && b->outR < nOut && b->outR != b->outL) { float *o = outs[b->outR]; for (int f = 0; f < frames; f++) o[f] += R[f]; }
    if (b->tap) tap_add(m < 0 ? 0 : m + 1, L, R, frames);
  }
  /* what the lights hear: 3 bands + onsets, from the Central Control's channels (or the main mix) */
  for (int f = 0; f < frames; f++) {
    float v = 0;
    if (analysisSrc == 1) v = (mainL[f] + mainR[f]) * 0.5f;
    else if (net[0].used) { for (int c = 0; c < net[0].channels; c++) v += netbuf[0][c][f]; }
    bandLp1 += (v - bandLp1) * 0.0195f; bandLp2 += (bandLp1 - bandLp2) * 0.0195f;   /* ~150 Hz low-pass (two poles) */
    bandHp += (v - bandHp) * 0.28f; float hi = v - bandHp;                          /* ~2.5 kHz high-pass */
    float lo = bandLp2, mid = v - lo - hi;
    float e[3] = { fabsf(lo), fabsf(mid), fabsf(hi) };
    for (int k = 0; k < 3; k++) bandEnv[k] = e[k] > bandEnv[k] ? bandEnv[k] + (e[k] - bandEnv[k]) * 0.01f : bandEnv[k] * 0.9995f;
    bandSlow += (bandEnv[0] - bandSlow) * 0.00005f;
    if (onsetHold > 0) onsetHold -= 1;
    else if (bandEnv[0] > 0.02f && bandEnv[0] > bandSlow * 1.8f) { onsets++; onsetHold = (float)(FS * 0.12); }
  }
  meterCount += frames; if (meterCount >= meterEvery) { meterCount = 0; meters_out(); }
}

/* meters: packed binary for the writer thread (which turns them into JSON) */
typedef struct { float in[MAXIN], gr[MAXIN], mix[MAXMIX][2], main[2], net[MAXNET][MAXNETCH], bands[3], netLevel[MAXNET]; unsigned onsets, xruns, under[MAXNET]; int netUsed[MAXNET], netCh[MAXNET]; } Meters;
static Meters mt;
static void meters_out(void) {
  for (int i = 0; i < MAXIN; i++) { mt.in[i] = in[i].peak; mt.gr[i] = in[i].gr; in[i].peak = 0; }
  for (int m = 0; m < MAXMIX; m++) { mt.mix[m][0] = mix[m].peakL; mt.mix[m][1] = mix[m].peakR; mix[m].peakL = mix[m].peakR = 0; }
  mt.main[0] = mainb.peakL; mt.main[1] = mainb.peakR; mainb.peakL = mainb.peakR = 0;
  for (int s = 0; s < MAXNET; s++) { mt.netUsed[s] = net[s].used; mt.netCh[s] = net[s].channels; mt.under[s] = net[s].under; mt.netLevel[s] = (float)(net[s].level / (net[s].rate > 0 ? net[s].rate : 48000) * 1000); for (int c = 0; c < MAXNETCH; c++) { mt.net[s][c] = net[s].peak[c]; net[s].peak[c] = 0; } }
  for (int k = 0; k < 3; k++) mt.bands[k] = bandEnv[k];
  mt.onsets = onsets; mt.xruns = atomic_load(&xruns);
  out_msg('M', &mt, sizeof mt, NULL, 0); wake_writer();
}

/* ------------------------------------------------------------------ JACK backend */
static int jack_cb(jack_nframes_t n, void *arg) {
  (void)arg; float *ins[MAXIN], *outs[MAXOUT]; if (n > MAXBLOCK) return 0;
  for (int i = 0; i < nIn; i++) ins[i] = J.port_get_buffer(inPorts[i], n);
  for (int o = 0; o < nOut; o++) outs[o] = J.port_get_buffer(outPorts[o], n);
  process((int)n, ins, outs); return 0;
}
static int jack_xrun(void *arg) { (void)arg; atomic_fetch_add(&xruns, 1); return 0; }
static void jack_gone(void *arg) { (void)arg; running = 0; }

static char capName[128] = "", playName[128] = "", clientName[64] = "Central Usage";
static int maxIn = MAXIN, maxOut = MAXOUT;
static const char **capPorts, **playPorts;
static int filter_ports(const char **all, const char *want, const char **out, int max) {
  int n = 0; for (int i = 0; all && all[i] && n < max; i++) { if (!want[0] || strstr(all[i], want)) out[n++] = all[i]; } return n;
}
static const char *capList[MAXIN], *playList[MAXOUT];
static int start_jack(void) {
  if (!load_jack()) return 0;
  int status = 0; client = J.client_open(clientName, JackNoStartServer, &status);
  if (!client) return 0;
  FS = J.get_sample_rate(client); BLOCK = (int)J.get_buffer_size(client);
  capPorts = J.get_ports(client, NULL, JACK_AUDIO, JackPortIsOutput | JackPortIsPhysical);
  playPorts = J.get_ports(client, NULL, JACK_AUDIO, JackPortIsInput | JackPortIsPhysical);
  nIn = filter_ports(capPorts, capName, capList, maxIn); nOut = filter_ports(playPorts, playName, playList, maxOut);
  /* a named device that isn't a physical card (a virtual or network device): its ports by name */
  if (capName[0] && !nIn) { const char **all = J.get_ports(client, capName, JACK_AUDIO, JackPortIsOutput); for (int i = 0; all && all[i] && nIn < maxIn; i++) if (!strstr(all[i], clientName)) capList[nIn++] = all[i]; }
  if (playName[0] && !nOut) { const char **all = J.get_ports(client, playName, JACK_AUDIO, JackPortIsInput); for (int i = 0; all && all[i] && nOut < maxOut; i++) if (!strstr(all[i], clientName)) playList[nOut++] = all[i]; }
  for (int i = 0; i < nIn; i++) { char nm[32]; snprintf(nm, sizeof nm, "in_%d", i + 1); inPorts[i] = J.port_register(client, nm, JACK_AUDIO, JackPortIsInput, 0); }
  for (int o = 0; o < nOut; o++) { char nm[32]; snprintf(nm, sizeof nm, "out_%d", o + 1); outPorts[o] = J.port_register(client, nm, JACK_AUDIO, JackPortIsOutput, 0); }
  J.set_process_callback(client, jack_cb, NULL); J.set_xrun_callback(client, jack_xrun, NULL); J.on_shutdown(client, jack_gone, NULL);
  if (J.activate(client)) { J.client_close(client); client = NULL; return 0; }
  for (int i = 0; i < nIn; i++) if (inPorts[i]) J.connect(client, capList[i], J.port_name(inPorts[i]));
  for (int o = 0; o < nOut; o++) if (outPorts[o]) J.connect(client, J.port_name(outPorts[o]), playList[o]);
  return 1;
}

/* ------------------------------------------------------------------ internal clock backend (no interface) */
static void *internal_loop(void *arg) {
  (void)arg; struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); long ns = (long)(1e9 * BLOCK / FS);
  while (running) {
    t.tv_nsec += ns; while (t.tv_nsec >= 1000000000L) { t.tv_nsec -= 1000000000L; t.tv_sec++; }
    clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &t, NULL);
    process(BLOCK, NULL, scratch);
  }
  return NULL;
}

/* ------------------------------------------------------------------ stdout writer + stdin reader */
static pthread_mutex_t stdoutLock = PTHREAD_MUTEX_INITIALIZER;
static void put(FILE *f, uint8_t type, const void *p, uint32_t n) { uint8_t h[5] = { type, (uint8_t)n, (uint8_t)(n >> 8), (uint8_t)(n >> 16), (uint8_t)(n >> 24) }; pthread_mutex_lock(&stdoutLock); fwrite(h, 1, 5, f); if (n) fwrite(p, 1, n, f); pthread_mutex_unlock(&stdoutLock); }
static void put_json(const char *s) { put(stdout, 'J', s, (uint32_t)strlen(s)); pthread_mutex_lock(&stdoutLock); fflush(stdout); pthread_mutex_unlock(&stdoutLock); }
static char *jbuf; static size_t jcap = 1 << 20;
static void jcat(size_t *len, const char *fmt, ...) __attribute__((format(printf, 2, 3)));
#include <stdarg.h>
static __thread char *jt;
static void jcat(size_t *len, const char *fmt, ...) { va_list ap; va_start(ap, fmt); char *b = jt ? jt : jbuf; int n = vsnprintf(b + *len, jcap - *len, fmt, ap); va_end(ap); if (n > 0 && *len + (size_t)n < jcap) *len += (size_t)n; }
static void meters_json(const Meters *m) {
  size_t L = 0; jcat(&L, "{\"ev\":\"meters\",\"in\":[");
  for (int i = 0; i < MAXIN; i++) jcat(&L, "%s%.4f", i ? "," : "", m->in[i]);
  jcat(&L, "],\"gr\":["); for (int i = 0; i < MAXIN; i++) jcat(&L, "%s%.1f", i ? "," : "", m->gr[i]);
  jcat(&L, "],\"mix\":["); for (int k = 0; k < MAXMIX; k++) jcat(&L, "%s%.4f,%.4f", k ? "," : "", m->mix[k][0], m->mix[k][1]);
  jcat(&L, "],\"main\":[%.4f,%.4f],\"net\":[", m->main[0], m->main[1]);
  for (int s = 0; s < MAXNET; s++) { jcat(&L, "%s{\"on\":%d,\"ch\":%d,\"ms\":%.1f,\"under\":%u,\"peak\":[", s ? "," : "", m->netUsed[s], m->netCh[s], m->netLevel[s], m->under[s]); for (int c = 0; c < m->netCh[s] && c < MAXNETCH; c++) jcat(&L, "%s%.4f", c ? "," : "", m->net[s][c]); jcat(&L, "]}"); }
  jcat(&L, "],\"bands\":[%.4f,%.4f,%.4f],\"onsets\":%u,\"xruns\":%u,\"cpu\":%.1f}", m->bands[0], m->bands[1], m->bands[2], m->onsets, m->xruns, client ? J.cpu_load(client) : 0.0f);
  put(stdout, 'J', jbuf, (uint32_t)L);
}
static void *writer(void *arg) {
  (void)arg; uint8_t *msg = malloc(OUTRING);
  while (running) {
    pthread_mutex_lock(&outLock);
    if (atomic_load(&outW) == atomic_load(&outR)) { struct timespec t; clock_gettime(CLOCK_REALTIME, &t); t.tv_nsec += 20000000; if (t.tv_nsec >= 1000000000L) { t.tv_nsec -= 1000000000L; t.tv_sec++; } pthread_cond_timedwait(&outCond, &outLock, &t); }
    pthread_mutex_unlock(&outLock);
    for (;;) {
      uint64_t r = atomic_load(&outR), w = atomic_load(&outW); if (w - r < 5) break;
      uint8_t h[5]; for (int i = 0; i < 5; i++) h[i] = outRing[(r + i) % OUTRING];
      uint32_t n = h[1] | h[2] << 8 | h[3] << 16 | (uint32_t)h[4] << 24; if (w - r < 5 + n) break;
      for (uint32_t i = 0; i < n; i++) msg[i] = outRing[(r + 5 + i) % OUTRING];
      atomic_store(&outR, r + 5 + n);
      if (h[0] == 'M') meters_json((Meters *)msg); else put(stdout, h[0], msg, n);
    }
    pthread_mutex_lock(&stdoutLock); fflush(stdout); pthread_mutex_unlock(&stdoutLock);
  }
  free(msg); return NULL;
}
static int read_full(void *p, size_t n) { uint8_t *b = p; while (n) { ssize_t k = read(0, b, n); if (k <= 0) { if (k < 0 && errno == EINTR) continue; return 0; } b += k; n -= (size_t)k; } return 1; }
static void *reader(void *arg) {
  (void)arg; uint8_t *buf = malloc(4 << 20);
  for (;;) {
    uint8_t h[5]; if (!read_full(h, 5)) break;
    uint32_t n = h[1] | h[2] << 8 | h[3] << 16 | (uint32_t)h[4] << 24; if (n > (4u << 20) - 1) break;
    if (!read_full(buf, n)) break;
    if (h[0] == 'J') { buf[n] = 0; command((char *)buf); }
    else if (h[0] == 'N' && n >= 4) { int s = buf[0], ch = buf[1], frames = buf[2] | buf[3] << 8; if (s < MAXNET && ch > 0 && n >= 4 + (uint32_t)frames * ch * 2) net_write(s, ch, frames, (int16_t *)(buf + 4)); }
  }
  running = 0; free(buf); return NULL;   /* the app went away */
}

static void status_json(const char *backend) {
  jt = malloc(jcap); size_t L = 0; jcat(&L, "{\"ev\":\"status\",\"backend\":\"%s\",\"rate\":%.0f,\"block\":%d,\"inputs\":%d,\"outputs\":%d,\"captureNames\":[", backend, FS, BLOCK, nIn, nOut);
  for (int i = 0; i < nIn; i++) { jcat(&L, "%s\"", i ? "," : ""); for (const char *p = capList[i]; *p; p++) jcat(&L, *p == '"' || *p == '\\' ? "\\%c" : "%c", *p); jcat(&L, "\""); }
  jcat(&L, "],\"playbackNames\":[");
  for (int o = 0; o < nOut; o++) { jcat(&L, "%s\"", o ? "," : ""); for (const char *p = playList[o]; *p; p++) jcat(&L, *p == '"' || *p == '\\' ? "\\%c" : "%c", *p); jcat(&L, "\""); }
  jcat(&L, "],\"allCapture\":["); int k = 0; for (int i = 0; capPorts && capPorts[i] && i < 512; i++, k++) { jcat(&L, "%s\"", i ? "," : ""); for (const char *p = capPorts[i]; *p; p++) jcat(&L, *p == '"' || *p == '\\' ? "\\%c" : "%c", *p); jcat(&L, "\""); }
  jcat(&L, "],\"allPlayback\":["); for (int i = 0; playPorts && playPorts[i] && i < 512; i++) { jcat(&L, "%s\"", i ? "," : ""); for (const char *p = playPorts[i]; *p; p++) jcat(&L, *p == '"' || *p == '\\' ? "\\%c" : "%c", *p); jcat(&L, "\""); }
  jcat(&L, "],\"max\":{\"inputs\":%d,\"mixes\":%d,\"outputs\":%d,\"netChannels\":%d}}", MAXIN, MAXMIX, MAXOUT, MAXNETCH);
  pthread_mutex_lock(&stdoutLock); fflush(stdout); pthread_mutex_unlock(&stdoutLock);
  put(stdout, 'J', jt, (uint32_t)L); pthread_mutex_lock(&stdoutLock); fflush(stdout); pthread_mutex_unlock(&stdoutLock); free(jt); jt = NULL;
}

int main(int argc, char **argv) {
  const char *backend = "auto";
  for (int i = 1; i < argc; i++) {
    if (!strcmp(argv[i], "--backend") && i + 1 < argc) backend = argv[++i];
    else if (!strcmp(argv[i], "--capture") && i + 1 < argc) snprintf(capName, sizeof capName, "%s", argv[++i]);
    else if (!strcmp(argv[i], "--playback") && i + 1 < argc) snprintf(playName, sizeof playName, "%s", argv[++i]);
    else if (!strcmp(argv[i], "--name") && i + 1 < argc) snprintf(clientName, sizeof clientName, "%s", argv[++i]);
    else if (!strcmp(argv[i], "--rate") && i + 1 < argc) FS = atof(argv[++i]);
    else if (!strcmp(argv[i], "--block") && i + 1 < argc) BLOCK = atoi(argv[++i]);
    else if (!strcmp(argv[i], "--max-in") && i + 1 < argc) maxIn = atoi(argv[++i]);
    else if (!strcmp(argv[i], "--max-out") && i + 1 < argc) maxOut = atoi(argv[++i]);
    else if (!strcmp(argv[i], "--version")) { puts("cu-mixer 1"); return 0; }
  }
  if (maxIn > MAXIN) maxIn = MAXIN; if (maxOut > MAXOUT) maxOut = MAXOUT; if (BLOCK < 16) BLOCK = 16; if (BLOCK > MAXBLOCK) BLOCK = MAXBLOCK;
  signal(SIGPIPE, SIG_IGN);
  outRing = malloc(OUTRING); jbuf = malloc(jcap); zero = calloc(MAXBLOCK, sizeof(float));
  for (int o = 0; o < MAXOUT; o++) scratch[o] = calloc(MAXBLOCK, sizeof(float));
  mainb.level = 1; mainb.stereo = 1; mainb.used = 1; mainb.outL = mainb.outR = -1;
  for (int m = 0; m < MAXMIX; m++) { mix[m].level = 1; mix[m].stereo = 1; mix[m].outL = mix[m].outR = -1; }
  for (int i = 0; i < MAXIN; i++) { in[i].direct = -1; in[i].trim = 1; }
  int ok = 0;
  if (strcmp(backend, "internal")) ok = start_jack();
  if (!ok && !strcmp(backend, "jack")) { put_json("{\"ev\":\"error\",\"error\":\"JACK is not running (start the engine with pw-jack, or install pipewire-jack)\"}"); }
  meterEvery = (unsigned)(FS / 20);
  pthread_t tw, tr, ti; pthread_create(&tw, NULL, writer, NULL);
  status_json(ok ? "jack" : "internal");
  pthread_create(&tr, NULL, reader, NULL);
  if (!ok) { internal = 1; nIn = 0; nOut = 0; pthread_create(&ti, NULL, internal_loop, NULL); }
  while (running) usleep(50000);
  if (client) J.client_close(client);
  if (internal) pthread_join(ti, NULL);
  wake_writer(); pthread_join(tw, NULL);
  return 0;
}
