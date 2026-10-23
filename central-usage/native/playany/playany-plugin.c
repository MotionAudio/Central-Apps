/* Play any sound as a plugin for the Raspberry Pi's instrument chain (and Linux with PipeWire): one shared
 * library that is both a LADSPA plugin (label "central_playany") and an LV2 plugin
 * (https://motionaudio.github.io/Central-Apps/plugins/playany). PipeWire's filter-chain hosts it inside the guitar
 * chain (instrument_host.py), so the synth mode's sound is in the same audio cycle as the guitar - no added buffer.
 *
 *   audio in  -> the guitar, bass or acoustic
 *   audio out <- the synth mode's sound (the chain mixes the dry guitar in, at the dry blend)
 *   note mode -> MIDI notes for the keys engine: a thread of the plugin sends them to FluidSynth's shell
 *                (127.0.0.1:<Port>, the port instrument_host.py starts it on) on <Channel>, where the chosen sound is
 *                loaded. (The audio thread never waits: it queues the notes and wakes that thread.)
 *
 * Controls: Active (0/1), Mode (0 auto, 1 notes, 2 synth), Sensitivity (0..1), Tone (0..4, the synth voice),
 * Synth level (0..2), Low note / High note (MIDI), Channel (0..15), Port (TCP, 0 = no notes), Bend (0/1).
 * Outputs (for meters): State (0 idle, 1 note, 2 chord), Note (-1 none).
 *
 * Build (Linux): cc -O2 -fPIC -shared -o central-playany.so playany-plugin.c playany.c -lm -lpthread
 * No LADSPA / LV2 headers needed: their (stable, tiny) C interfaces are declared below. */
#define _GNU_SOURCE
#include "playany.h"
#include <arpa/inet.h>
#include <errno.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <pthread.h>
#include <semaphore.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>

/* ------------------------------------------------------------------ the ports */
enum { P_IN, P_OUT, P_ACTIVE, P_MODE, P_SENS, P_TONE, P_LEVEL, P_LOW, P_HIGH, P_CHAN, P_PORT, P_BEND, P_STATE, P_NOTE, P_COUNT };
static const char *const portNames[P_COUNT] = { "In", "Out", "Active", "Mode", "Sensitivity", "Tone", "Synth level", "Low note", "High note", "Channel", "Port", "Bend", "State", "Note" };
static const char *const portSyms[P_COUNT] = { "in", "out", "active", "mode", "sensitivity", "tone", "level", "low", "high", "channel", "port", "bend", "state", "note" };
static const float portMin[P_COUNT] = { 0, 0, 0, 0, 0, 0, 0, 21, 48, 0, 0, 0, 0, -1 };
static const float portMax[P_COUNT] = { 0, 0, 1, 2, 1, 4, 2, 72, 108, 15, 65535, 1, 2, 127 };
static const float portDef[P_COUNT] = { 0, 0, 1, 0, 0.5f, 0, 1, 40, 88, 10, 9800, 1, 0, -1 };

#define QN 1024
typedef struct {
  PlayAny *pa; double fs; float *port[P_COUNT];
  float cur[P_COUNT]; int active;
  /* notes to FluidSynth: the audio thread queues, the sender thread writes */
  PaEvent q[QN]; _Atomic unsigned qw, qr; sem_t wake; pthread_t th; _Atomic int quit; int thOk;
  _Atomic int fluidPort;
} Inst;

static void push(Inst *s, const PaEvent *e, int n) {
  for (int i = 0; i < n; i++) { unsigned w = atomic_load(&s->qw); if (w - atomic_load(&s->qr) >= QN) break; s->q[w % QN] = e[i]; atomic_store(&s->qw, w + 1); }
  if (n > 0) sem_post(&s->wake);
}
static void *sender(void *arg) {
  Inst *s = arg; int fd = -1, port = 0; time_t lastTry = 0;
  while (!atomic_load(&s->quit)) {
    struct timespec ts; clock_gettime(CLOCK_REALTIME, &ts); ts.tv_nsec += 200000000; if (ts.tv_nsec >= 1000000000) { ts.tv_sec++; ts.tv_nsec -= 1000000000; }
    sem_timedwait(&s->wake, &ts);
    int want = atomic_load(&s->fluidPort);
    if (want != port && fd >= 0) { close(fd); fd = -1; }
    port = want;
    if (fd < 0 && port > 0 && time(NULL) != lastTry) {
      lastTry = time(NULL);
      fd = socket(AF_INET, SOCK_STREAM, 0);
      struct sockaddr_in a; memset(&a, 0, sizeof a); a.sin_family = AF_INET; a.sin_port = htons((uint16_t)port); a.sin_addr.s_addr = htonl(0x7F000001);
      if (fd >= 0 && connect(fd, (struct sockaddr *)&a, sizeof a) == 0) { int one = 1; setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof one); }
      else if (fd >= 0) { close(fd); fd = -1; }
    }
    char buf[8192]; size_t len = 0;
    unsigned r = atomic_load(&s->qr), w = atomic_load(&s->qw);
    for (; r != w && len + 64 < sizeof buf; r++) {
      PaEvent e = s->q[r % QN]; int ch = e.status & 15, st = e.status & 0xF0;
      if (st == 0x90 && e.d2) len += (size_t)snprintf(buf + len, sizeof buf - len, "noteon %d %d %d\n", ch, e.d1, e.d2);
      else if (st == 0x80 || st == 0x90) len += (size_t)snprintf(buf + len, sizeof buf - len, "noteoff %d %d\n", ch, e.d1);
      else if (st == 0xE0) len += (size_t)snprintf(buf + len, sizeof buf - len, "pitch_bend %d %d\n", ch, e.d1 | e.d2 << 7);
      else if (st == 0xB0) len += (size_t)snprintf(buf + len, sizeof buf - len, "cc %d %d %d\n", ch, e.d1, e.d2);
    }
    atomic_store(&s->qr, r);
    if (fd >= 0 && len) { if (send(fd, buf, len, MSG_NOSIGNAL) < 0) { close(fd); fd = -1; } }
    if (fd >= 0) { char junk[4096]; while (recv(fd, junk, sizeof junk, MSG_DONTWAIT) > 0) {} }   /* (the shell's replies) */
  }
  if (fd >= 0) close(fd);
  return NULL;
}

static void *inst_new(double fs) {
  Inst *s = calloc(1, sizeof *s); if (!s) return NULL;
  s->fs = fs; s->pa = pa_new(fs); if (!s->pa) { free(s); return NULL; }
  for (int i = 0; i < P_COUNT; i++) s->cur[i] = -12345;
  sem_init(&s->wake, 0, 0);
  s->thOk = pthread_create(&s->th, NULL, sender, s) == 0;
  return s;
}
static void inst_free(void *h) {
  Inst *s = h; if (!s) return;
  atomic_store(&s->quit, 1); sem_post(&s->wake); if (s->thOk) pthread_join(s->th, NULL);
  sem_destroy(&s->wake); pa_free(s->pa); free(s);
}
static void inst_connect(void *h, unsigned long port, float *data) { Inst *s = h; if (port < P_COUNT) s->port[port] = data; }
static float ctl(Inst *s, int p) { float v = s->port[p] ? *s->port[p] : portDef[p]; if (!(v == v)) v = portDef[p]; return v < portMin[p] ? portMin[p] : v > portMax[p] ? portMax[p] : v; }
static void inst_run(void *h, unsigned long n) {
  Inst *s = h; PaEvent ev[256]; int ne;
  /* the controls (cheap: only what changed is passed on) */
  int changedRange = 0;
  for (int p = P_ACTIVE; p <= P_BEND; p++) {
    float v = ctl(s, p); if (v == s->cur[p]) continue; s->cur[p] = v;
    switch (p) {
      case P_ACTIVE: { int a = v >= 0.5f; if (!a && s->active) { ne = pa_all_notes_off(s->pa, ev, 256); push(s, ev, ne); pa_reset(s->pa); } s->active = a; break; }
      case P_MODE: pa_set_mode(s->pa, (int)(v + 0.5f)); if ((int)(v + 0.5f) == PA_SYNTH) { ne = pa_all_notes_off(s->pa, ev, 256); push(s, ev, ne); } break;
      case P_SENS: pa_set_sensitivity(s->pa, v); break;
      case P_TONE: pa_set_tone(s->pa, (int)(v + 0.5f)); break;
      case P_LEVEL: pa_set_synth_level(s->pa, v); break;
      case P_LOW: case P_HIGH: changedRange = 1; break;
      case P_CHAN: { ne = pa_all_notes_off(s->pa, ev, 256); push(s, ev, ne); pa_set_channel(s->pa, (int)(v + 0.5f)); break; }
      case P_PORT: atomic_store(&s->fluidPort, (int)(v + 0.5f)); break;
      case P_BEND: pa_set_bend(s->pa, v >= 0.5f); break;
    }
  }
  if (changedRange) pa_set_range(s->pa, (int)(ctl(s, P_LOW) + 0.5f), (int)(ctl(s, P_HIGH) + 0.5f));
  float *in = s->port[P_IN], *out = s->port[P_OUT];
  if (!out) return;
  if (!s->active || !in) { memset(out, 0, sizeof(float) * n); if (s->port[P_STATE]) *s->port[P_STATE] = 0; if (s->port[P_NOTE]) *s->port[P_NOTE] = -1; return; }
  ne = pa_process(s->pa, in, out, (int)n, ev, 256);
  if (ne) push(s, ev, ne);
  PaInfo info; pa_info(s->pa, &info);
  if (s->port[P_STATE]) *s->port[P_STATE] = (float)info.state;
  if (s->port[P_NOTE]) *s->port[P_NOTE] = (float)info.note;
}
static void inst_deactivate(void *h) { Inst *s = h; PaEvent ev[16]; int ne = pa_all_notes_off(s->pa, ev, 16); push(s, ev, ne); }

/* ------------------------------------------------------------------ LADSPA (declared here: ladspa.h, version 1.1) */
typedef float LADSPA_Data; typedef void *LADSPA_Handle; typedef int LADSPA_Properties, LADSPA_PortDescriptor, LADSPA_PortRangeHintDescriptor;
typedef struct { LADSPA_PortRangeHintDescriptor HintDescriptor; LADSPA_Data LowerBound, UpperBound; } LADSPA_PortRangeHint;
typedef struct _LADSPA_Descriptor {
  unsigned long UniqueID; const char *Label; LADSPA_Properties Properties; const char *Name, *Maker, *Copyright; unsigned long PortCount;
  const LADSPA_PortDescriptor *PortDescriptors; const char *const *PortNames; const LADSPA_PortRangeHint *PortRangeHints; void *ImplementationData;
  LADSPA_Handle (*instantiate)(const struct _LADSPA_Descriptor *, unsigned long);
  void (*connect_port)(LADSPA_Handle, unsigned long, LADSPA_Data *); void (*activate)(LADSPA_Handle); void (*run)(LADSPA_Handle, unsigned long);
  void (*run_adding)(LADSPA_Handle, unsigned long); void (*set_run_adding_gain)(LADSPA_Handle, LADSPA_Data); void (*deactivate)(LADSPA_Handle); void (*cleanup)(LADSPA_Handle);
} LADSPA_Descriptor;
#define LP_INPUT 1
#define LP_OUTPUT 2
#define LP_CONTROL 4
#define LP_AUDIO 8
#define LH_BOUNDED_BELOW 1
#define LH_BOUNDED_ABOVE 2
#define LH_TOGGLED 4
#define LH_INTEGER 32
#define LH_DEFAULT_MASK 0x3C0
#define LH_DEFAULT_MINIMUM 0x40
#define LH_DEFAULT_MIDDLE 0xC0
#define LH_DEFAULT_MAXIMUM 0x140
static LADSPA_PortDescriptor ladDesc[P_COUNT]; static LADSPA_PortRangeHint ladHints[P_COUNT];
static LADSPA_Handle lad_inst(const LADSPA_Descriptor *d, unsigned long fs) { (void)d; return inst_new((double)fs); }
static void lad_connect(LADSPA_Handle h, unsigned long p, LADSPA_Data *d) { inst_connect(h, p, d); }
static void lad_run(LADSPA_Handle h, unsigned long n) { inst_run(h, n); }
static void lad_deact(LADSPA_Handle h) { inst_deactivate(h); }
static void lad_clean(LADSPA_Handle h) { inst_free(h); }
static LADSPA_Descriptor lad = { 0x4D41504Eul /* "MAPN" */, "central_playany", 0, "Central Play Any Sound", "Motion Audio", "MIT", P_COUNT, ladDesc, portNames, ladHints, NULL,
                                 lad_inst, lad_connect, NULL, lad_run, NULL, NULL, lad_deact, lad_clean };
static void lad_init(void) {
  static int done; if (done) return; done = 1;
  for (int p = 0; p < P_COUNT; p++) {
    int audio = p == P_IN || p == P_OUT, output = p == P_OUT || p == P_STATE || p == P_NOTE;
    ladDesc[p] = (audio ? LP_AUDIO : LP_CONTROL) | (output ? LP_OUTPUT : LP_INPUT);
    if (audio) { ladHints[p].HintDescriptor = 0; continue; }
    int hint = LH_BOUNDED_BELOW | LH_BOUNDED_ABOVE; if (p == P_ACTIVE || p == P_BEND) hint |= LH_TOGGLED; if (p != P_SENS && p != P_LEVEL) hint |= LH_INTEGER;
    /* defaults: LADSPA can only say minimum / middle / maximum / 0 / 1 / 100 / 440: the host sets every control anyway */
    hint |= portDef[p] <= portMin[p] ? LH_DEFAULT_MINIMUM : portDef[p] >= portMax[p] ? LH_DEFAULT_MAXIMUM : LH_DEFAULT_MIDDLE;
    ladHints[p].HintDescriptor = hint; ladHints[p].LowerBound = portMin[p]; ladHints[p].UpperBound = portMax[p];
  }
}
__attribute__((visibility("default"))) const LADSPA_Descriptor *ladspa_descriptor(unsigned long i) { lad_init(); return i == 0 ? &lad : NULL; }

/* ------------------------------------------------------------------ LV2 (declared here: lv2/core/lv2.h) */
typedef void *LV2_Handle; typedef struct { const char *URI; void *data; } LV2_Feature;
typedef struct LV2_Descriptor {
  const char *URI; LV2_Handle (*instantiate)(const struct LV2_Descriptor *, double, const char *, const LV2_Feature *const *);
  void (*connect_port)(LV2_Handle, uint32_t, void *); void (*activate)(LV2_Handle); void (*run)(LV2_Handle, uint32_t);
  void (*deactivate)(LV2_Handle); void (*cleanup)(LV2_Handle); const void *(*extension_data)(const char *);
} LV2_Descriptor;
static LV2_Handle lv2_inst(const LV2_Descriptor *d, double fs, const char *b, const LV2_Feature *const *f) { (void)d; (void)b; (void)f; return inst_new(fs); }
static void lv2_connect(LV2_Handle h, uint32_t p, void *d) { inst_connect(h, p, d); }
static void lv2_run(LV2_Handle h, uint32_t n) { inst_run(h, n); }
static void lv2_deact(LV2_Handle h) { inst_deactivate(h); }
static void lv2_clean(LV2_Handle h) { inst_free(h); }
static const void *lv2_ext(const char *u) { (void)u; return NULL; }
static const LV2_Descriptor lv2 = { "https://motionaudio.github.io/Central-Apps/plugins/playany", lv2_inst, lv2_connect, NULL, lv2_run, lv2_deact, lv2_clean, lv2_ext };
__attribute__((visibility("default"))) const LV2_Descriptor *lv2_descriptor(uint32_t i) { return i == 0 ? &lv2 : NULL; }

/* (for the test: the port table, so the LV2 description can be checked against it) */
__attribute__((visibility("default"))) const char *central_playany_port(int i, float *mn, float *mx, float *def) {
  if (i < 0 || i >= P_COUNT) return NULL; if (mn) *mn = portMin[i]; if (mx) *mx = portMax[i]; if (def) *def = portDef[i]; return portSyms[i];
}
