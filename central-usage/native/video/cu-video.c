/* cu-video - the native helpers of Central Usage's Video tab. One program, three jobs:
 *
 *   cu-video audio       the stream's audio: two sources, each a device + channel pair on an audio interface or
 *                        Dante (miniaudio, shared mode - it does not take the device away from anything else).
 *                        The chosen one (with its gain and a delay to line it up with the cameras) goes out as
 *                        48 kHz stereo; both are metered.
 *   cu-video ndi-recv    NDI cameras in: finds the sources on the network, receives the ones asked for at low
 *                        bandwidth (the multiview) or full quality (what is on air), sends I420 frames.
 *   cu-video ndi-send N  an NDI source named N out (the stream or the main output) - for OBS / vMix / Streamlabs.
 *
 * The NDI runtime is loaded at run time (libndi.so.6/.5, libndi.dylib, Processing.NDI.Lib.x64.dll), so this builds
 * without the NDI SDK and says so when the runtime is missing.
 *
 * stdout (all jobs): framed messages - u8 type, u32 length (little endian), payload
 *   'J'  a JSON event
 *   'A'  audio: s16le stereo 48 kHz
 *   'F'  a video frame: u16 id, u16 width, u16 height, u8 format (0 = I420), u8 0, then the planes
 * stdin:
 *   audio / ndi-recv  one JSON command per line
 *   ndi-send          framed: 'V' u16 width, u16 height, u16 fps, u8 format (0 = I420, 1 = BGRA), u8 0, data;  'Q' quit
 */
#define MINIAUDIO_IMPLEMENTATION
#define MA_NO_ENCODING
#define MA_NO_DECODING
#define MA_NO_GENERATION
#define MA_NO_RESOURCE_MANAGER
#define MA_NO_NODE_GRAPH
#define MA_NO_ENGINE
#include "miniaudio.h"

#include <math.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#include <windows.h>
#include <fcntl.h>
#include <io.h>
typedef HANDLE thread_t;
static void *lib_open(const char *n) { return (void *)LoadLibraryA(n); }
static void *lib_sym(void *h, const char *n) { return (void *)GetProcAddress((HMODULE)h, n); }
static void sleep_ms(int ms) { Sleep(ms); }
#else
#include <dlfcn.h>
#include <pthread.h>
#include <unistd.h>
typedef pthread_t thread_t;
static void *lib_open(const char *n) { return dlopen(n, RTLD_NOW); }
static void *lib_sym(void *h, const char *n) { return dlsym(h, n); }
static void sleep_ms(int ms) { usleep((useconds_t)ms * 1000); }
#endif

/* ------------------------------------------------------------------ output */
static ma_mutex out_lock;
static void put_frame(char type, const void *a, size_t na, const void *b, size_t nb) {
  uint8_t h[5]; uint32_t n = (uint32_t)(na + nb);
  h[0] = (uint8_t)type; h[1] = n & 255; h[2] = (n >> 8) & 255; h[3] = (n >> 16) & 255; h[4] = (n >> 24) & 255;
  ma_mutex_lock(&out_lock);
  fwrite(h, 1, 5, stdout); if (na) fwrite(a, 1, na, stdout); if (nb) fwrite(b, 1, nb, stdout); fflush(stdout);
  ma_mutex_unlock(&out_lock);
}
static void emit(const char *fmt, ...) {
  char buf[16384]; va_list ap; va_start(ap, fmt); int n = vsnprintf(buf, sizeof buf, fmt, ap); va_end(ap);
  if (n < 0) return; if (n >= (int)sizeof buf) n = (int)sizeof buf - 1;
  put_frame('J', buf, (size_t)n, NULL, 0);
}
static void json_escape(const char *s, char *out, size_t cap) {
  size_t o = 0;
  for (; s && *s && o + 7 < cap; s++) {
    unsigned char c = (unsigned char)*s;
    if (c == '"' || c == '\\') { out[o++] = '\\'; out[o++] = (char)c; }
    else if (c < 0x20) o += (size_t)snprintf(out + o, cap - o, "\\u%04x", c);
    else out[o++] = (char)c;
  }
  out[o] = 0;
}

/* ------------------------------------------------------------------ tiny JSON field readers (flat commands) */
static const char *jfind(const char *s, const char *key) {
  char pat[64]; snprintf(pat, sizeof pat, "\"%s\"", key);
  const char *p = strstr(s, pat); if (!p) return NULL; p += strlen(pat);
  while (*p == ' ' || *p == '\t') p++; if (*p != ':') return NULL; p++; while (*p == ' ' || *p == '\t') p++;
  return p;
}
static int jstr(const char *s, const char *key, char *out, size_t cap) {
  const char *p = jfind(s, key); if (!p || *p != '"') return 0; p++;
  size_t o = 0;
  while (*p && *p != '"' && o + 1 < cap) {
    if (*p == '\\' && p[1]) {
      p++;
      if (*p == 'u' && p[1] && p[2] && p[3] && p[4]) { unsigned v = 0; sscanf(p + 1, "%4x", &v); p += 4; if (v < 0x80) out[o++] = (char)v; else if (v < 0x800 && o + 2 < cap) { out[o++] = (char)(0xC0 | (v >> 6)); out[o++] = (char)(0x80 | (v & 63)); } else if (o + 3 < cap) { out[o++] = (char)(0xE0 | (v >> 12)); out[o++] = (char)(0x80 | ((v >> 6) & 63)); out[o++] = (char)(0x80 | (v & 63)); } p++; continue; }
      out[o++] = *p == 'n' ? '\n' : *p == 't' ? '\t' : *p; p++; continue;
    }
    out[o++] = *p++;
  }
  out[o] = 0; return 1;
}
static double jnum(const char *s, const char *key, double def) { const char *p = jfind(s, key); if (!p) return def; char *e; double v = strtod(p, &e); return e == p ? def : v; }
static int read_line(char *buf, size_t cap) {
  size_t n = 0; int c;
  while ((c = getchar()) != EOF) { if (c == '\n') break; if (n + 1 < cap) buf[n++] = (char)c; }
  buf[n] = 0; return c != EOF || n > 0;
}

/* ================================================================== audio */
#define SLOTS 2
#define RING (48000 * 4)                      /* 4 s of stereo frames (delay up to ~3.5 s) */
typedef struct {
  char device[256]; int l, r; float gain; int on;
  ma_device dev; int open; int channels; float peak[2]; char error[256];
} AudioSource;
static AudioSource src[SLOTS];
static ma_context actx; static int actx_ok = 0;
static volatile int use_slot = 0;
static int delay_frames = 0;
static int16_t ring[RING * 2]; static volatile long long ring_w = 0, ring_r = 0;
static ma_mutex ring_lock;
static volatile long long last_write_ms = 0;

static long long now_ms(void) {
#ifdef _WIN32
  return (long long)GetTickCount64();
#else
  struct timespec ts; clock_gettime(CLOCK_MONOTONIC, &ts); return (long long)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
#endif
}
static void ring_push(const int16_t *lr, int frames) {
  ma_mutex_lock(&ring_lock);
  for (int i = 0; i < frames; i++) { long long w = ring_w % RING; ring[w * 2] = lr[i * 2]; ring[w * 2 + 1] = lr[i * 2 + 1]; ring_w++; }
  if (ring_w - ring_r > RING - 4800) ring_r = ring_w - (RING - 4800);
  ma_mutex_unlock(&ring_lock);
}
static void cb_capture(ma_device *d, void *out, const void *in, ma_uint32 frames) {
  (void)out; AudioSource *s = (AudioSource *)d->pUserData; if (!in || !s) return;
  int slot = (int)(s - src), ch = (int)d->capture.channels; const float *x = (const float *)in;
  int l = s->l < ch ? s->l : 0, r = s->r < ch ? s->r : (ch > 1 ? 1 : 0);
  float g = powf(10.f, s->gain / 20.f), pl = 0, pr = 0;
  int16_t tmp[2048 * 2]; ma_uint32 done = 0;
  while (done < frames) {
    ma_uint32 n = frames - done; if (n > 2048) n = 2048;
    for (ma_uint32 i = 0; i < n; i++) {
      float a = x[(done + i) * ch + l] * g, b = x[(done + i) * ch + r] * g;
      float aa = fabsf(a), bb = fabsf(b); if (aa > pl) pl = aa; if (bb > pr) pr = bb;
      if (a > 1) a = 1; if (a < -1) a = -1; if (b > 1) b = 1; if (b < -1) b = -1;
      tmp[i * 2] = (int16_t)lrintf(a * 32767.f); tmp[i * 2 + 1] = (int16_t)lrintf(b * 32767.f);
    }
    if (slot == use_slot) { ring_push(tmp, (int)n); last_write_ms = now_ms(); }
    done += n;
  }
  if (pl > s->peak[0]) s->peak[0] = pl; if (pr > s->peak[1]) s->peak[1] = pr;
}
static void close_source(AudioSource *s) { if (s->open) { ma_device_uninit(&s->dev); s->open = 0; } }
static int find_device(const char *name, ma_device_id *id, int *channels) {
  ma_device_info *caps; ma_uint32 ncap; ma_device_info *pb; ma_uint32 npb;
  if (ma_context_get_devices(&actx, &pb, &npb, &caps, &ncap) != MA_SUCCESS) return 0;
  for (ma_uint32 i = 0; i < ncap; i++) {
    if (strcmp(caps[i].name, name) == 0) {
      *id = caps[i].id; *channels = 2;
      ma_device_info info; if (ma_context_get_device_info(&actx, ma_device_type_capture, &caps[i].id, &info) == MA_SUCCESS)
        for (ma_uint32 k = 0; k < info.nativeDataFormatCount; k++) if ((int)info.nativeDataFormats[k].channels > *channels) *channels = (int)info.nativeDataFormats[k].channels;
      return 1;
    }
  }
  return 0;
}
static void open_source(AudioSource *s) {
  close_source(s); s->error[0] = 0;
  if (!s->on || !s->device[0]) return;
  ma_device_id id; int ch = 2;
  if (!find_device(s->device, &id, &ch)) { snprintf(s->error, sizeof s->error, "not found"); return; }
  int need = (s->l > s->r ? s->l : s->r) + 1; if (need > ch) ch = need;
  if (ch > 256) ch = 256;
  ma_device_config c = ma_device_config_init(ma_device_type_capture);
  c.capture.pDeviceID = &id; c.capture.format = ma_format_f32; c.capture.channels = (ma_uint32)ch; c.capture.shareMode = ma_share_mode_shared;
  c.sampleRate = 48000; c.periodSizeInMilliseconds = 10; c.dataCallback = cb_capture; c.pUserData = s;
  if (ma_device_init(&actx, &c, &s->dev) != MA_SUCCESS) {
    c.capture.channels = 0;   /* the device's own channel count */
    if (ma_device_init(&actx, &c, &s->dev) != MA_SUCCESS) { snprintf(s->error, sizeof s->error, "could not open"); return; }
  }
  if (ma_device_start(&s->dev) != MA_SUCCESS) { ma_device_uninit(&s->dev); snprintf(s->error, sizeof s->error, "could not start"); return; }
  s->open = 1; s->channels = (int)s->dev.capture.channels;
}
static void list_devices(void) {
  ma_device_info *caps; ma_uint32 ncap; ma_device_info *pb; ma_uint32 npb;
  char out[16000]; size_t o = 0; o += (size_t)snprintf(out + o, sizeof out - o, "{\"ev\":\"devices\",\"backend\":\"%s\",\"devices\":[", actx_ok ? ma_get_backend_name(actx.backend) : "none");
  if (actx_ok && ma_context_get_devices(&actx, &pb, &npb, &caps, &ncap) == MA_SUCCESS) {
    for (ma_uint32 i = 0; i < ncap && o < sizeof out - 600; i++) {
      int ch = 2; ma_device_info info;
      if (ma_context_get_device_info(&actx, ma_device_type_capture, &caps[i].id, &info) == MA_SUCCESS)
        for (ma_uint32 k = 0; k < info.nativeDataFormatCount; k++) if ((int)info.nativeDataFormats[k].channels > ch) ch = (int)info.nativeDataFormats[k].channels;
      char nm[512]; json_escape(caps[i].name, nm, sizeof nm);
      o += (size_t)snprintf(out + o, sizeof out - o, "%s{\"name\":\"%s\",\"channels\":%d,\"default\":%s}", i ? "," : "", nm, ch, caps[i].isDefault ? "true" : "false");
    }
  }
  o += (size_t)snprintf(out + o, sizeof out - o, "]}");
  put_frame('J', out, o, NULL, 0);
}
static void status_sources(void) {
  char out[4096]; size_t o = (size_t)snprintf(out, sizeof out, "{\"ev\":\"status\",\"use\":%d,\"delay\":%d,\"sources\":[", use_slot, delay_frames / 48);
  for (int i = 0; i < SLOTS; i++) { char nm[600], er[600]; json_escape(src[i].device, nm, sizeof nm); json_escape(src[i].error, er, sizeof er);
    o += (size_t)snprintf(out + o, sizeof out - o, "%s{\"device\":\"%s\",\"l\":%d,\"r\":%d,\"gain\":%.1f,\"on\":%s,\"running\":%s,\"channels\":%d,\"error\":\"%s\"}", i ? "," : "", nm, src[i].l, src[i].r, src[i].gain, src[i].on ? "true" : "false", src[i].open ? "true" : "false", src[i].channels, er); }
  o += (size_t)snprintf(out + o, sizeof out - o, "]}"); put_frame('J', out, o, NULL, 0);
}
static void set_delay(int ms) {
  if (ms < 0) ms = 0; if (ms > 3000) ms = 3000;
  ma_mutex_lock(&ring_lock);
  int want = ms * 48;
  if (want < delay_frames) { ring_r += delay_frames - want; if (ring_r > ring_w) ring_r = ring_w; }   /* shorter: skip ahead */
  delay_frames = want;                                                                                /* longer: the backlog grows while silence goes out */
  ma_mutex_unlock(&ring_lock);
}
static volatile int running = 1;
#ifdef _WIN32
static DWORD WINAPI audio_writer(LPVOID arg)
#else
static void *audio_writer(void *arg)
#endif
{
  (void)arg; long long meter_at = now_ms(), silence_at = now_ms(), start = now_ms(), out_total = 0; int16_t buf[480 * 2];
  while (running) {
    sleep_ms(5);
    for (;;) {   /* the device's clock paces the output: send what arrived, keeping the delay held back */
      int got = 0;
      ma_mutex_lock(&ring_lock);
      long long avail = ring_w - ring_r - delay_frames;
      if (avail > 48000 / 5) ring_r += avail - 48000 / 10;   /* drifted too far behind: catch up */
      avail = ring_w - ring_r - delay_frames;
      if (out_total + 480 > (now_ms() - start) * 48 + 4800) { ma_mutex_unlock(&ring_lock); break; }   /* never faster than real time (an unclocked device) */
      if (avail >= 480) { for (int i = 0; i < 480; i++) { long long r = ring_r % RING; buf[i * 2] = ring[r * 2]; buf[i * 2 + 1] = ring[r * 2 + 1]; ring_r++; } got = 1; }
      ma_mutex_unlock(&ring_lock);
      if (!got) break;
      put_frame('A', buf, sizeof buf, NULL, 0); silence_at = now_ms(); out_total += 480;
    }
    /* nothing from the chosen source (none set, the device stopped, or the delay still filling): silence on our own clock */
    if (now_ms() - last_write_ms > 150 || ring_w - ring_r < delay_frames) {
      while (now_ms() - silence_at >= 10) { memset(buf, 0, sizeof buf); put_frame('A', buf, sizeof buf, NULL, 0); silence_at += 10; out_total += 480; }
    } else silence_at = now_ms();
    if (now_ms() - meter_at >= 50) {
      meter_at = now_ms();
      emit("{\"ev\":\"meters\",\"peak\":[[%.4f,%.4f],[%.4f,%.4f]],\"live\":%s}", src[0].peak[0], src[0].peak[1], src[1].peak[0], src[1].peak[1], now_ms() - last_write_ms < 200 ? "true" : "false");
      src[0].peak[0] = src[0].peak[1] = src[1].peak[0] = src[1].peak[1] = 0;
    }
  }
  return 0;
}
static int run_audio(void) {
  ma_mutex_init(&ring_lock);
  actx_ok = ma_context_init(NULL, 0, NULL, &actx) == MA_SUCCESS;
  memset(src, 0, sizeof src); for (int i = 0; i < SLOTS; i++) { src[i].l = 0; src[i].r = 1; }
  emit("{\"ev\":\"ready\",\"job\":\"audio\",\"backend\":\"%s\"}", actx_ok ? ma_get_backend_name(actx.backend) : "none");
  thread_t th;
#ifdef _WIN32
  th = CreateThread(NULL, 0, audio_writer, NULL, 0, NULL);
#else
  pthread_create(&th, NULL, audio_writer, NULL);
#endif
  char line[8192];
  while (read_line(line, sizeof line)) {
    char cmd[32] = ""; jstr(line, "cmd", cmd, sizeof cmd);
    if (!strcmp(cmd, "quit")) break;
    if (!strcmp(cmd, "list")) list_devices();
    else if (!strcmp(cmd, "source")) {
      int i = (int)jnum(line, "slot", 0); if (i < 0 || i >= SLOTS) continue;
      AudioSource *s = &src[i]; char dev[256] = ""; jstr(line, "device", dev, sizeof dev);
      int l = (int)jnum(line, "l", 0), r = (int)jnum(line, "r", 1), on = (int)jnum(line, "on", 1);
      float g = (float)jnum(line, "gain", 0); if (g < -60) g = -60; if (g > 24) g = 24;
      int reopen = strcmp(dev, s->device) != 0 || on != s->on || (l > r ? l : r) >= s->channels;
      snprintf(s->device, sizeof s->device, "%s", dev); s->l = l < 0 ? 0 : l; s->r = r < 0 ? 0 : r; s->gain = g; s->on = on;
      if (reopen && actx_ok) open_source(s);
      status_sources();
    } else if (!strcmp(cmd, "use")) { int u = (int)jnum(line, "slot", 0); use_slot = u == 1 ? 1 : 0; status_sources(); }
    else if (!strcmp(cmd, "delay")) { set_delay((int)jnum(line, "ms", 0)); status_sources(); }
    else if (!strcmp(cmd, "status")) status_sources();
  }
  running = 0;
#ifdef _WIN32
  WaitForSingleObject(th, 1000);
#else
  pthread_join(th, NULL);
#endif
  for (int i = 0; i < SLOTS; i++) close_source(&src[i]);
  if (actx_ok) ma_context_uninit(&actx);
  return 0;
}

/* ================================================================== NDI */
typedef struct { const char *p_ndi_name; const char *p_url_address; } NDIlib_source_t;
typedef struct { _Bool show_local_sources; const char *p_groups; const char *p_extra_ips; } NDIlib_find_create_t;
typedef struct { NDIlib_source_t source_to_connect_to; int color_format; int bandwidth; _Bool allow_video_fields; const char *p_ndi_recv_name; } NDIlib_recv_create_v3_t;
typedef struct { const char *p_ndi_name; const char *p_groups; _Bool clock_video; _Bool clock_audio; } NDIlib_send_create_t;
typedef struct {
  int xres, yres; int FourCC; int frame_rate_N, frame_rate_D; float picture_aspect_ratio; int frame_format_type;
  int64_t timecode; uint8_t *p_data; int line_stride_in_bytes; const char *p_metadata; int64_t timestamp;
} NDIlib_video_frame_v2_t;
#define FOURCC(a, b, c, d) ((uint32_t)(uint8_t)(a) | ((uint32_t)(uint8_t)(b) << 8) | ((uint32_t)(uint8_t)(c) << 16) | ((uint32_t)(uint8_t)(d) << 24))

static _Bool (*ndi_init)(void);
static void *(*ndi_find_create)(const NDIlib_find_create_t *);
static void (*ndi_find_destroy)(void *);
static _Bool (*ndi_find_wait)(void *, uint32_t);
static const NDIlib_source_t *(*ndi_find_sources)(void *, uint32_t *);
static void *(*ndi_recv_create)(const NDIlib_recv_create_v3_t *);
static void (*ndi_recv_destroy)(void *);
static int (*ndi_recv_capture)(void *, NDIlib_video_frame_v2_t *, void *, void *, uint32_t);
static void (*ndi_recv_free_video)(void *, const NDIlib_video_frame_v2_t *);
static void *(*ndi_send_create)(const NDIlib_send_create_t *);
static void (*ndi_send_destroy)(void *);
static void (*ndi_send_video)(void *, const NDIlib_video_frame_v2_t *);
static int (*ndi_send_conns)(void *, uint32_t);

static void *ndi_load(void) {
  void *h = NULL; char path[1024];
#ifdef _WIN32
  const char *env[] = { "NDI_RUNTIME_DIR_V6", "NDI_RUNTIME_DIR_V5", NULL };
  for (int i = 0; env[i] && !h; i++) { const char *d = getenv(env[i]); if (d) { snprintf(path, sizeof path, "%s\\Processing.NDI.Lib.x64.dll", d); h = lib_open(path); } }
  if (!h) h = lib_open("Processing.NDI.Lib.x64.dll");
#elif defined(__APPLE__)
  const char *env[] = { "NDI_RUNTIME_DIR_V6", "NDI_RUNTIME_DIR_V5", NULL };
  for (int i = 0; env[i] && !h; i++) { const char *d = getenv(env[i]); if (d) { snprintf(path, sizeof path, "%s/libndi.dylib", d); h = lib_open(path); } }
  const char *names[] = { "libndi.dylib", "/usr/local/lib/libndi.dylib", "/Library/NDI SDK for Apple/lib/macOS/libndi.dylib", "/Applications/NDI Video Monitor.app/Contents/Frameworks/libndi.dylib", NULL };
  for (int i = 0; names[i] && !h; i++) h = lib_open(names[i]);
#else
  const char *env[] = { "NDI_RUNTIME_DIR_V6", "NDI_RUNTIME_DIR_V5", NULL };
  for (int i = 0; env[i] && !h; i++) { const char *d = getenv(env[i]); if (d) { snprintf(path, sizeof path, "%s/libndi.so.%c", d, env[i][17]); h = lib_open(path); } }
  const char *names[] = { "libndi.so.6", "libndi.so.5", "libndi.so", "/usr/local/lib/libndi.so.6", "/usr/lib/libndi.so.6", NULL };
  for (int i = 0; names[i] && !h; i++) h = lib_open(names[i]);
#endif
  if (!h) return NULL;
  *(void **)&ndi_init = lib_sym(h, "NDIlib_initialize");
  *(void **)&ndi_find_create = lib_sym(h, "NDIlib_find_create_v2"); *(void **)&ndi_find_destroy = lib_sym(h, "NDIlib_find_destroy");
  *(void **)&ndi_find_wait = lib_sym(h, "NDIlib_find_wait_for_sources"); *(void **)&ndi_find_sources = lib_sym(h, "NDIlib_find_get_current_sources");
  *(void **)&ndi_recv_create = lib_sym(h, "NDIlib_recv_create_v3"); *(void **)&ndi_recv_destroy = lib_sym(h, "NDIlib_recv_destroy");
  *(void **)&ndi_recv_capture = lib_sym(h, "NDIlib_recv_capture_v2"); *(void **)&ndi_recv_free_video = lib_sym(h, "NDIlib_recv_free_video_v2");
  *(void **)&ndi_send_create = lib_sym(h, "NDIlib_send_create"); *(void **)&ndi_send_destroy = lib_sym(h, "NDIlib_send_destroy");
  *(void **)&ndi_send_video = lib_sym(h, "NDIlib_send_send_video_v2"); *(void **)&ndi_send_conns = lib_sym(h, "NDIlib_send_get_no_connections");
  return h;
}
static const char *NO_NDI = "The NDI runtime is not installed - get NDI Tools (free) from ndi.video.";

/* frames to I420 */
static void uyvy_to_i420(const uint8_t *s, int stride, int w, int h, uint8_t *y, uint8_t *u, uint8_t *v) {
  for (int r = 0; r < h; r++) {
    const uint8_t *p = s + (size_t)r * stride; uint8_t *yy = y + (size_t)r * w;
    for (int c = 0; c < w / 2; c++) { yy[c * 2] = p[c * 4 + 1]; yy[c * 2 + 1] = p[c * 4 + 3]; }
    if ((r & 1) == 0) {
      const uint8_t *q = r + 1 < h ? p + stride : p; uint8_t *uu = u + (size_t)(r / 2) * (w / 2), *vv = v + (size_t)(r / 2) * (w / 2);
      for (int c = 0; c < w / 2; c++) { uu[c] = (uint8_t)((p[c * 4] + q[c * 4] + 1) >> 1); vv[c] = (uint8_t)((p[c * 4 + 2] + q[c * 4 + 2] + 1) >> 1); }
    }
  }
}
static void bgra_to_i420(const uint8_t *s, int stride, int w, int h, uint8_t *y, uint8_t *u, uint8_t *v) {   /* BT.709, limited range */
  for (int r = 0; r < h; r++) {
    const uint8_t *p = s + (size_t)r * stride;
    for (int c = 0; c < w; c++) { float B = p[c * 4], G = p[c * 4 + 1], R = p[c * 4 + 2]; y[(size_t)r * w + c] = (uint8_t)(16 + (0.1826f * R + 0.6142f * G + 0.0620f * B)); }
    if ((r & 1) == 0) for (int c = 0; c < w / 2; c++) {
      float B = p[c * 8], G = p[c * 8 + 1], R = p[c * 8 + 2];
      u[(size_t)(r / 2) * (w / 2) + c] = (uint8_t)(128 + (-0.1006f * R - 0.3386f * G + 0.4392f * B));
      v[(size_t)(r / 2) * (w / 2) + c] = (uint8_t)(128 + (0.4392f * R - 0.3989f * G - 0.0403f * B));
    }
  }
}

#define MAXRX 64
typedef struct { int used, id; char name[512]; int hi; int fps_cap; void *rx; volatile int stop; thread_t th; uint8_t *buf; size_t cap; long long last_sent; } Rx;
static Rx rxs[MAXRX];
static ma_mutex rx_lock;
#ifdef _WIN32
static DWORD WINAPI rx_thread(LPVOID arg)
#else
static void *rx_thread(void *arg)
#endif
{
  Rx *x = (Rx *)arg;
  NDIlib_recv_create_v3_t rc; memset(&rc, 0, sizeof rc);
  rc.source_to_connect_to.p_ndi_name = x->name; rc.color_format = 1; /* UYVY_BGRA */ rc.bandwidth = x->hi ? 100 : 0; rc.allow_video_fields = 0; rc.p_ndi_recv_name = "Central Usage";
  x->rx = ndi_recv_create(&rc);
  if (!x->rx) { char nm[600]; json_escape(x->name, nm, sizeof nm); emit("{\"ev\":\"rx\",\"id\":%d,\"ok\":false,\"error\":\"could not connect to %s\"}", x->id, nm); return 0; }
  emit("{\"ev\":\"rx\",\"id\":%d,\"ok\":true,\"hi\":%s}", x->id, x->hi ? "true" : "false");
  int frames = 0;
  while (!x->stop) {
    NDIlib_video_frame_v2_t f; memset(&f, 0, sizeof f);
    int t = ndi_recv_capture(x->rx, &f, NULL, NULL, 200);
    if (t != 1) continue;
    long long now = now_ms();
    int cap_ms = x->fps_cap > 0 ? 1000 / x->fps_cap : 0;
    if (cap_ms && now - x->last_sent < cap_ms - 3) { ndi_recv_free_video(x->rx, &f); continue; }
    x->last_sent = now;
    int w = f.xres & ~1, h = f.yres & ~1; size_t need = (size_t)w * h * 3 / 2 + 8;
    if (w <= 0 || h <= 0) { ndi_recv_free_video(x->rx, &f); continue; }
    if (need > x->cap) { free(x->buf); x->buf = malloc(need); x->cap = x->buf ? need : 0; if (!x->buf) { ndi_recv_free_video(x->rx, &f); continue; } }
    uint8_t *hd = x->buf, *Y = hd + 8, *U = Y + (size_t)w * h, *V = U + (size_t)(w / 2) * (h / 2);
    hd[0] = x->id & 255; hd[1] = (x->id >> 8) & 255; hd[2] = w & 255; hd[3] = (w >> 8) & 255; hd[4] = h & 255; hd[5] = (h >> 8) & 255; hd[6] = 0; hd[7] = 0;
    if ((uint32_t)f.FourCC == FOURCC('U', 'Y', 'V', 'Y')) uyvy_to_i420(f.p_data, f.line_stride_in_bytes, w, h, Y, U, V);
    else bgra_to_i420(f.p_data, f.line_stride_in_bytes, w, h, Y, U, V);
    ndi_recv_free_video(x->rx, &f);
    put_frame('F', x->buf, need, NULL, 0);
    if (++frames == 1) emit("{\"ev\":\"rx\",\"id\":%d,\"first\":true,\"width\":%d,\"height\":%d}", x->id, w, h);
  }
  ndi_recv_destroy(x->rx); x->rx = NULL;
  return 0;
}
static void rx_close(Rx *x) {
  if (!x->used) return; x->stop = 1;
#ifdef _WIN32
  WaitForSingleObject(x->th, 2000);
#else
  pthread_join(x->th, NULL);
#endif
  free(x->buf); memset(x, 0, sizeof *x);
}
static void rx_open(int id, const char *name, int hi, int fps_cap) {
  ma_mutex_lock(&rx_lock);
  for (int i = 0; i < MAXRX; i++) if (rxs[i].used && rxs[i].id == id) rx_close(&rxs[i]);
  Rx *x = NULL; for (int i = 0; i < MAXRX && !x; i++) if (!rxs[i].used) x = &rxs[i];
  if (!x) { ma_mutex_unlock(&rx_lock); emit("{\"ev\":\"rx\",\"id\":%d,\"ok\":false,\"error\":\"too many NDI sources\"}", id); return; }
  x->used = 1; x->id = id; snprintf(x->name, sizeof x->name, "%s", name); x->hi = hi; x->fps_cap = fps_cap;
#ifdef _WIN32
  x->th = CreateThread(NULL, 0, rx_thread, x, 0, NULL);
#else
  pthread_create(&x->th, NULL, rx_thread, x);
#endif
  ma_mutex_unlock(&rx_lock);
}
static volatile int find_stop = 0; static void *finder = NULL;
#ifdef _WIN32
static DWORD WINAPI find_thread(LPVOID arg)
#else
static void *find_thread(void *arg)
#endif
{
  (void)arg; char last[16384] = "";
  while (!find_stop) {
    ndi_find_wait(finder, 1000);
    uint32_t n = 0; const NDIlib_source_t *s = ndi_find_sources(finder, &n);
    char out[16384]; size_t o = (size_t)snprintf(out, sizeof out, "{\"ev\":\"sources\",\"list\":[");
    for (uint32_t i = 0; i < n && o < sizeof out - 1200; i++) { char nm[600], url[400]; json_escape(s[i].p_ndi_name, nm, sizeof nm); json_escape(s[i].p_url_address ? s[i].p_url_address : "", url, sizeof url); o += (size_t)snprintf(out + o, sizeof out - o, "%s{\"name\":\"%s\",\"url\":\"%s\"}", i ? "," : "", nm, url); }
    o += (size_t)snprintf(out + o, sizeof out - o, "]}");
    if (strcmp(out, last)) { strcpy(last, out); put_frame('J', out, o, NULL, 0); }
  }
  return 0;
}
static int run_ndi_recv(void) {
  ma_mutex_init(&rx_lock);
  void *lib = ndi_load();
  if (!lib || !ndi_init || !ndi_find_create || !ndi_recv_create || !ndi_recv_capture) { emit("{\"ev\":\"ready\",\"job\":\"ndi-recv\",\"ok\":false,\"error\":\"%s\"}", NO_NDI); char l[256]; while (read_line(l, sizeof l)) { if (strstr(l, "quit")) break; } return 2; }
  if (!ndi_init()) { emit("{\"ev\":\"ready\",\"job\":\"ndi-recv\",\"ok\":false,\"error\":\"The NDI runtime could not start.\"}"); return 3; }
  NDIlib_find_create_t fc = { 1, NULL, NULL }; char extra[1024] = "";
  finder = ndi_find_create(&fc);
  emit("{\"ev\":\"ready\",\"job\":\"ndi-recv\",\"ok\":true}");
  thread_t ft;
#ifdef _WIN32
  ft = CreateThread(NULL, 0, find_thread, NULL, 0, NULL);
#else
  pthread_create(&ft, NULL, find_thread, NULL);
#endif
  char line[4096];
  while (read_line(line, sizeof line)) {
    char cmd[32] = ""; jstr(line, "cmd", cmd, sizeof cmd);
    if (!strcmp(cmd, "quit")) break;
    if (!strcmp(cmd, "open")) { char name[512] = ""; char bw[8] = "lo"; jstr(line, "name", name, sizeof name); jstr(line, "bw", bw, sizeof bw); rx_open((int)jnum(line, "id", 0), name, !strcmp(bw, "hi"), (int)jnum(line, "fps", 0)); }
    else if (!strcmp(cmd, "close")) { int id = (int)jnum(line, "id", 0); ma_mutex_lock(&rx_lock); for (int i = 0; i < MAXRX; i++) if (rxs[i].used && rxs[i].id == id) rx_close(&rxs[i]); ma_mutex_unlock(&rx_lock); }
    else if (!strcmp(cmd, "extraIps")) { jstr(line, "ips", extra, sizeof extra); /* a new finder with the extra addresses (sources on other subnets) */
      find_stop = 1;
#ifdef _WIN32
      WaitForSingleObject(ft, 3000);
#else
      pthread_join(ft, NULL);
#endif
      ndi_find_destroy(finder); NDIlib_find_create_t f2 = { 1, NULL, extra[0] ? extra : NULL }; finder = ndi_find_create(&f2); find_stop = 0;
#ifdef _WIN32
      ft = CreateThread(NULL, 0, find_thread, NULL, 0, NULL);
#else
      pthread_create(&ft, NULL, find_thread, NULL);
#endif
    }
  }
  find_stop = 1;
  for (int i = 0; i < MAXRX; i++) rx_close(&rxs[i]);
  return 0;
}

static int read_full(void *p, size_t n) { uint8_t *b = p; while (n) { size_t k = fread(b, 1, n, stdin); if (k == 0) return 0; b += k; n -= k; } return 1; }
static int run_ndi_send(const char *name) {
  void *lib = ndi_load();
  if (!lib || !ndi_init || !ndi_send_create || !ndi_send_video) { emit("{\"ev\":\"status\",\"ok\":false,\"error\":\"%s\"}", NO_NDI); return 2; }
  if (!ndi_init()) { emit("{\"ev\":\"status\",\"ok\":false,\"error\":\"The NDI runtime could not start.\"}"); return 3; }
  NDIlib_send_create_t sc = { name, NULL, 1, 0 };
  void *snd = ndi_send_create(&sc);
  if (!snd) { emit("{\"ev\":\"status\",\"ok\":false,\"error\":\"Could not create the NDI source.\"}"); return 4; }
  char nm[600]; json_escape(name, nm, sizeof nm); emit("{\"ev\":\"status\",\"ok\":true,\"name\":\"%s\"}", nm);
  uint8_t *buf[2] = { NULL, NULL }; size_t cap[2] = { 0, 0 }; int cur = 0; unsigned frames = 0;
  for (;;) {
    uint8_t h[5]; if (!read_full(h, 5)) break;
    uint32_t n = h[1] | h[2] << 8 | h[3] << 16 | (uint32_t)h[4] << 24;
    if (h[0] == 'Q') break;
    if (n > cap[cur]) { free(buf[cur]); cap[cur] = n; buf[cur] = malloc(n); if (!buf[cur]) break; }
    if (!read_full(buf[cur], n)) break;
    if (h[0] != 'V' || n < 8) continue;
    uint8_t *b = buf[cur]; int w = b[0] | b[1] << 8, hh = b[2] | b[3] << 8, fps = b[4] | b[5] << 8, fmt = b[6];
    size_t need = fmt == 1 ? (size_t)w * hh * 4 : (size_t)w * hh * 3 / 2; if (need + 8 > n) continue;
    NDIlib_video_frame_v2_t f; memset(&f, 0, sizeof f);
    f.xres = w; f.yres = hh; f.FourCC = (int)(fmt == 1 ? FOURCC('B', 'G', 'R', 'A') : FOURCC('I', '4', '2', '0'));
    f.frame_rate_N = (fps > 0 ? fps : 30) * 1000; f.frame_rate_D = 1000; f.picture_aspect_ratio = (float)w / (float)hh; f.frame_format_type = 1;
    f.timecode = INT64_MAX; f.p_data = b + 8; f.line_stride_in_bytes = fmt == 1 ? w * 4 : w;
    ndi_send_video(snd, &f);   /* clock_video paces us to the frame rate */
    cur ^= 1;
    if (++frames % 150 == 0 && ndi_send_conns) emit("{\"ev\":\"stats\",\"frames\":%u,\"receivers\":%d}", frames, ndi_send_conns(snd, 0));
  }
  if (ndi_send_destroy) ndi_send_destroy(snd);
  return 0;
}

int main(int argc, char **argv) {
#ifdef _WIN32
  _setmode(_fileno(stdin), _O_BINARY); _setmode(_fileno(stdout), _O_BINARY);
#endif
  ma_mutex_init(&out_lock);
  const char *job = argc > 1 ? argv[1] : "";
  if (!strcmp(job, "audio")) return run_audio();
  if (!strcmp(job, "ndi-recv")) return run_ndi_recv();
  if (!strcmp(job, "ndi-send")) return run_ndi_send(argc > 2 ? argv[2] : "Central Usage");
  if (!strcmp(job, "version")) { printf("cu-video 1\n"); return 0; }
  fprintf(stderr, "usage: cu-video audio | ndi-recv | ndi-send NAME | version\n");
  return 1;
}
