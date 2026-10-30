/* cu-studio - the Studio's live sound: what you play on a MIDI keyboard (or pads) comes out of here, straight away.
 *
 * The Studio tab (app/studio-*.js) plays back recorded clips itself (Web Audio, timed to the sample). But a key you
 * press right now has to sound right now, and a browser's audio path is too slow for that (20-40 ms on most
 * computers). So the notes you play go here: a small native program that plays the same SoundFont sounds with
 * TinySoundFont through miniaudio at 128-frame blocks (about 3 ms at 48 kHz, plus the sound card).
 *
 * One JSON message per line on stdin, answers on stdout:
 *   {"action":"tracks","tracks":[{"id","volume","pan","mute","layers":[{file,bank,prog,lo,hi,velLo,velHi,octave,transpose,volume,pan}]}]}
 *       the tracks that can be played live (up to 16, up to 4 layers each - split, layer and velocity zones)
 *   {"action":"midi","track":"<id>","data":[status,d1,d2]}   a note / pedal / bend for one track
 *   {"action":"allOff"}   {"action":"volume","value":0..2}   {"action":"status"}   {"action":"quit"}
 *   {"action":"render","frames":N}   (with --backend null: run the audio N frames and answer the peak - the tests)
 * Answers: {"type":"studioMonitor","ok":..,"device":..,"sampleRate":..,"block":..,"latencyMs":..,"banks":..,"error":..}
 *          {"type":"studioRender","peak":..}
 *
 *   cu-studio [--backend auto|null] [--block 128] [--version]
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
#include "plat.h"

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

#define FS 48000.0
#define MAXTRACKS 16
#define MAXLAYERS 4
#define MAXBANKS 32
#define MAXBLOCK 4096

typedef struct { char file[1024]; tsf *t; } Bank;
static Bank banks[MAXBANKS]; static _Atomic int nBanks;
typedef struct { int bankIx, bank, prog, lo, hi, velLo, velHi, octave, transpose, ch; float volume, pan; } Layer;
typedef struct { char id[64]; int n, mute; float volume, pan; Layer l[MAXLAYERS]; } Track;
typedef struct { Track t[MAXTRACKS]; int n; } Cfg;
static Cfg cfgA, cfgB; static Cfg *live = &cfgA; static _Atomic(Cfg *) pending;   /* the control thread fills one, the audio thread takes it */
typedef struct { uint8_t track, a, b, c; } Ev;
#define EVRING 2048
static Ev evs[EVRING]; static _Atomic unsigned evW, evR; static _Atomic int allOff;
static float master = 1.0f, peak;
static float mix[MAXBLOCK * 2];
static int BLOCK = 128; static char backendArg[16] = "auto", lastError[256], devError[256];
static ma_context ctx; static ma_device dev; static int devOpen, ctxOk, nullBackend;
static FILE *proto; static pl_mutex outLock;

static void emit(cJSON *o) { char *s = cJSON_PrintUnformatted(o); if (!s) return; pl_mutex_lock(&outLock); fputs(s, proto); fputc('\n', proto); fflush(proto); pl_mutex_unlock(&outLock); free(s); }
static double num(cJSON *o, const char *k, double d) { cJSON *v = cJSON_GetObjectItem(o, k); return cJSON_IsNumber(v) ? v->valuedouble : d; }
static const char *str(cJSON *o, const char *k, const char *d) { cJSON *v = cJSON_GetObjectItem(o, k); return cJSON_IsString(v) ? v->valuestring : d; }
static int clampi(int v, int a, int b) { return v < a ? a : v > b ? b : v; }
static float clampf(float v, float a, float b) { return v < a ? a : v > b ? b : v; }

static int bank_for(const char *file) {   /* control thread: a bank is loaded once and kept */
  int n = atomic_load(&nBanks);
  for (int i = 0; i < n; i++) if (!strcmp(banks[i].file, file)) return i;
  if (n >= MAXBANKS) { snprintf(lastError, sizeof lastError, "too many sound banks at once"); return -1; }
  tsf *t = tsf_load_filename(file); if (!t) { snprintf(lastError, sizeof lastError, "could not open the sound bank %s", file); return -1; }
  tsf_set_output(t, TSF_STEREO_INTERLEAVED, (int)FS, 0); tsf_set_max_voices(t, 128);
  snprintf(banks[n].file, sizeof banks[n].file, "%s", file); banks[n].t = t;
  atomic_store(&nBanks, n + 1); return n;
}

/* audio thread: a new set of tracks - every channel's preset, volume and pan */
static void apply_rt(Cfg *c) {
  int n = atomic_load(&nBanks);
  for (int b = 0; b < n; b++) { tsf_note_off_all(banks[b].t); }
  for (int i = 0; i < c->n; i++) {
    Track *T = &c->t[i];
    for (int j = 0; j < T->n; j++) {
      Layer *L = &T->l[j]; if (L->bankIx < 0) continue; tsf *t = banks[L->bankIx].t;
      tsf_channel_set_bank_preset(t, L->ch, L->bank, L->prog);
      tsf_channel_set_volume(t, L->ch, T->mute ? 0 : clampf(T->volume * L->volume, 0, 2));
      tsf_channel_set_pan(t, L->ch, clampf((L->pan + T->pan + 1) / 2, 0, 1));
      tsf_channel_set_pitchrange(t, L->ch, 2);
    }
  }
  live = c;
}
static void event_rt(Ev e) {
  if (e.track >= live->n) return;
  Track *T = &live->t[e.track]; int st = e.a & 0xF0, note = e.b, vel = e.c;
  for (int j = 0; j < T->n; j++) {
    Layer *L = &T->l[j]; if (L->bankIx < 0) continue; tsf *t = banks[L->bankIx].t; int k = note + 12 * L->octave + L->transpose;
    if (st == 0x90 && vel > 0) { if (note >= L->lo && note <= L->hi && vel >= L->velLo && vel <= L->velHi && k >= 0 && k <= 127) tsf_channel_note_on(t, L->ch, k, vel / 127.0f); }
    else if (st == 0x80 || st == 0x90) { if (k >= 0 && k <= 127) tsf_channel_note_off(t, L->ch, k); }
    else if (st == 0xB0) tsf_channel_midi_control(t, L->ch, note, vel);
    else if (st == 0xE0) tsf_channel_set_pitchwheel(t, L->ch, note | vel << 7);
  }
}
static void run(float *out, ma_uint32 frames) {
  Cfg *nx = atomic_exchange(&pending, NULL); if (nx) apply_rt(nx);
  int n = atomic_load(&nBanks);
  if (atomic_exchange(&allOff, 0)) for (int b = 0; b < n; b++) tsf_note_off_all(banks[b].t);
  unsigned r = atomic_load(&evR), w = atomic_load(&evW); while (r != w) { event_rt(evs[r % EVRING]); r++; } atomic_store(&evR, r);
  for (ma_uint32 done = 0; done < frames;) {
    int k = (int)(frames - done > MAXBLOCK ? MAXBLOCK : frames - done);
    memset(mix, 0, sizeof(float) * k * 2);
    for (int b = 0; b < n; b++) tsf_render_float(banks[b].t, mix, k, 1);
    for (int i = 0; i < k * 2; i++) { float v = mix[i] * master; if (!isfinite(v)) v = 0; v = clampf(v, -1, 1); float a = fabsf(v); if (a > peak) peak = a; if (out) out[done * 2 + i] = v; }
    done += (ma_uint32)k;
  }
}
static void data_cb(ma_device *d, void *out, const void *in, ma_uint32 n) { (void)d; (void)in; run(out, n); }

static void status(void) {
  cJSON *o = cJSON_CreateObject(); cJSON_AddStringToObject(o, "type", "studioMonitor"); cJSON_AddBoolToObject(o, "ok", devOpen || nullBackend);
  cJSON_AddStringToObject(o, "device", devOpen ? dev.playback.name : nullBackend ? "none (test)" : "");
  cJSON_AddNumberToObject(o, "sampleRate", FS); cJSON_AddNumberToObject(o, "block", BLOCK);
  double lat = devOpen ? (double)dev.playback.internalPeriodSizeInFrames * dev.playback.internalPeriods / FS * 1000.0 : BLOCK / FS * 1000.0;
  cJSON_AddNumberToObject(o, "latencyMs", round(lat * 10) / 10); cJSON_AddNumberToObject(o, "banks", atomic_load(&nBanks)); cJSON_AddNumberToObject(o, "tracks", live->n);
  if (devError[0]) cJSON_AddStringToObject(o, "error", devError); else if (lastError[0]) cJSON_AddStringToObject(o, "error", lastError); else cJSON_AddNullToObject(o, "error");
  emit(o); cJSON_Delete(o);
}
static void open_device(void) {
  if (!strcmp(backendArg, "null")) { nullBackend = 1; return; }
  if (!ctxOk) { if (ma_context_init(NULL, 0, NULL, &ctx) != MA_SUCCESS) { snprintf(devError, sizeof devError, "no sound system found"); return; } ctxOk = 1; }
  ma_device_config c = ma_device_config_init(ma_device_type_playback);
  c.sampleRate = (ma_uint32)FS; c.playback.format = ma_format_f32; c.playback.channels = 2; c.periodSizeInFrames = (ma_uint32)BLOCK;
  c.performanceProfile = ma_performance_profile_low_latency; c.dataCallback = data_cb; c.noClip = MA_TRUE;
  if (ma_device_init(&ctx, &c, &dev) != MA_SUCCESS) { snprintf(devError, sizeof devError, "the sound card could not be opened"); return; }
  if (ma_device_start(&dev) != MA_SUCCESS) { ma_device_uninit(&dev); snprintf(devError, sizeof devError, "the sound card did not start"); return; }
  devOpen = 1;
}

static void set_tracks(cJSON *arr) {
  for (int i = 0; i < 300 && atomic_load(&pending); i++) pl_sleep_ms(1);   /* the last change taken by the audio thread first */
  Cfg *c = live == &cfgA ? &cfgB : &cfgA;   /* the one the audio thread isn't using */
  memset(c, 0, sizeof *c); lastError[0] = 0; int nextCh[MAXBANKS] = { 0 };
  cJSON *t; cJSON_ArrayForEach(t, arr) {
    if (c->n >= MAXTRACKS) break;
    Track *T = &c->t[c->n++]; snprintf(T->id, sizeof T->id, "%s", str(t, "id", ""));
    T->volume = (float)num(t, "volume", 1); T->pan = (float)num(t, "pan", 0); T->mute = cJSON_IsTrue(cJSON_GetObjectItem(t, "mute"));
    cJSON *ls = cJSON_GetObjectItem(t, "layers"), *l;
    cJSON_ArrayForEach(l, ls) {
      if (T->n >= MAXLAYERS) break;
      const char *file = str(l, "file", ""); if (!file[0]) continue;
      Layer *L = &T->l[T->n]; L->bankIx = bank_for(file); if (L->bankIx < 0) continue;
      L->bank = (int)num(l, "bank", 0); L->prog = (int)num(l, "prog", 0);
      L->lo = clampi((int)num(l, "lo", 0), 0, 127); L->hi = clampi((int)num(l, "hi", 127), 0, 127);
      L->velLo = clampi((int)num(l, "velLo", 1), 1, 127); L->velHi = clampi((int)num(l, "velHi", 127), 1, 127);
      L->octave = clampi((int)num(l, "octave", 0), -4, 4); L->transpose = clampi((int)num(l, "transpose", 0), -24, 24);
      L->volume = (float)num(l, "volume", 1); L->pan = (float)num(l, "pan", 0);
      L->ch = nextCh[L->bankIx]++;   /* every layer its own channel of its bank */
      T->n++;
    }
  }
  atomic_store(&pending, c);
  if (nullBackend) { Cfg *nx = atomic_exchange(&pending, NULL); if (nx) apply_rt(nx); }
}
static int track_index(const char *id) { Cfg *c = atomic_load(&pending); if (!c) c = live; for (int i = 0; i < c->n; i++) if (!strcmp(c->t[i].id, id)) return i; return -1; }
static void push_ev(int track, int a, int b, int c) { unsigned w = atomic_load(&evW); if (w - atomic_load(&evR) >= EVRING) return; evs[w % EVRING] = (Ev){ (uint8_t)track, (uint8_t)a, (uint8_t)b, (uint8_t)c }; atomic_store(&evW, w + 1); }

static int handle(cJSON *m) {
  const char *a = str(m, "action", "");
  if (!strcmp(a, "quit")) return 0;
  if (!strcmp(a, "status")) status();
  else if (!strcmp(a, "tracks")) { set_tracks(cJSON_GetObjectItem(m, "tracks")); status(); }
  else if (!strcmp(a, "midi")) {
    int ti = track_index(str(m, "track", "")); cJSON *d = cJSON_GetObjectItem(m, "data");
    if (ti >= 0 && cJSON_GetArraySize(d) >= 2) push_ev(ti, (int)cJSON_GetArrayItem(d, 0)->valuedouble, (int)cJSON_GetArrayItem(d, 1)->valuedouble, cJSON_GetArraySize(d) > 2 ? (int)cJSON_GetArrayItem(d, 2)->valuedouble : 0);
  }
  else if (!strcmp(a, "allOff")) atomic_store(&allOff, 1);
  else if (!strcmp(a, "volume")) master = clampf((float)num(m, "value", 1), 0, 2);
  else if (!strcmp(a, "render")) {   /* the tests: run the audio by hand (only without a sound card) */
    int frames = clampi((int)num(m, "frames", 4800), 1, 480000); peak = 0;
    if (!devOpen) for (int done = 0; done < frames; done += BLOCK) run(NULL, (ma_uint32)(frames - done < BLOCK ? frames - done : BLOCK));
    cJSON *o = cJSON_CreateObject(); cJSON_AddStringToObject(o, "type", "studioRender"); cJSON_AddNumberToObject(o, "peak", peak); emit(o); cJSON_Delete(o);
  }
  return 1;
}

int main(int argc, char **argv) {
  for (int i = 1; i < argc; i++) {
    if (!strcmp(argv[i], "--backend") && i + 1 < argc) snprintf(backendArg, sizeof backendArg, "%s", argv[++i]);
    else if (!strcmp(argv[i], "--block") && i + 1 < argc) BLOCK = atoi(argv[++i]);
    else if (!strcmp(argv[i], "--version")) { puts("cu-studio 1"); return 0; }
  }
  if (BLOCK < 32) BLOCK = 32; if (BLOCK > 1024) BLOCK = 1024;
  proto = stdout; pl_mutex_init(&outLock);
  open_device(); status();
  static char line[1 << 16];
  while (fgets(line, sizeof line, stdin)) {
    cJSON *m = cJSON_Parse(line); if (!m) continue;
    int go = handle(m); cJSON_Delete(m); if (!go) break;
  }
  if (devOpen) ma_device_uninit(&dev);
  if (ctxOk) ma_context_uninit(&ctx);
  return 0;
}
