/* cu-ndi - sends Central Usage's slides / lyrics output as an NDI video source on the network.
 * Needs the NDI runtime, free from ndi.video: Linux libndi.so.6 / .5 ("NDI SDK for Linux"), Windows
 * Processing.NDI.Lib.x64.dll ("NDI Tools" / "NDI Runtime"), macOS libndi.dylib ("NDI Tools" / the SDK).
 * It is loaded at run time, so this program builds without it and says so when it is missing.
 * stdin: framed messages - u8 type, u32 length (little endian), payload
 *   'V'  u16 width, u16 height, u16 fps, u16 0, then width*height*4 bytes BGRA
 *   'Q'  quit
 * stdout: one JSON line per event ({"ev":"status",...}). */
#ifndef _WIN32
#define _GNU_SOURCE
#endif
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "plat.h"
#define say(...) do { printf(__VA_ARGS__); fflush(stdout); } while (0)

typedef struct { const char *p_ndi_name; const char *p_groups; bool clock_video; bool clock_audio; } NDIlib_send_create_t;
typedef struct {
  int xres, yres; int FourCC; int frame_rate_N, frame_rate_D; float picture_aspect_ratio; int frame_format_type;
  int64_t timecode; uint8_t *p_data; int line_stride_in_bytes; const char *p_metadata; int64_t timestamp;
} NDIlib_video_frame_v2_t;
#define FOURCC(a, b, c, d) ((uint32_t)(uint8_t)(a) | ((uint32_t)(uint8_t)(b) << 8) | ((uint32_t)(uint8_t)(c) << 16) | ((uint32_t)(uint8_t)(d) << 24))
static bool (*ndi_init)(void);
static void *(*ndi_send_create)(const NDIlib_send_create_t *);
static void (*ndi_send_destroy)(void *);
static void (*ndi_send_video)(void *, const NDIlib_video_frame_v2_t *);
static int (*ndi_send_conns)(void *, uint32_t);

static int read_full(void *p, size_t n) { uint8_t *b = p; while (n) { long k = pl_read(b, n); if (k <= 0) return 0; b += k; n -= (size_t)k; } return 1; }
#ifdef _WIN32
#define NDI_LIB "Processing.NDI.Lib.x64.dll"
static const char *names[] = { "Processing.NDI.Lib.x64.dll", "C:\\Program Files\\NDI\\NDI 6 Runtime\\v6\\Processing.NDI.Lib.x64.dll",
  "C:\\Program Files\\NDI\\NDI 6 Tools\\Runtime\\Processing.NDI.Lib.x64.dll", "C:\\Program Files\\NDI\\NDI 5 Runtime\\v5\\Processing.NDI.Lib.x64.dll", NULL };
#define SEP "\\"
#elif defined(__APPLE__)
#define NDI_LIB "libndi.dylib"
static const char *names[] = { "libndi.dylib", "/usr/local/lib/libndi.dylib", "/Library/NDI SDK for Apple/lib/macOS/libndi.dylib", "/Library/NDI SDK for Apple/lib/macOS/libndi_advanced.dylib",
  "/Applications/NDI Video Monitor.app/Contents/Frameworks/libndi.dylib", NULL };
#define SEP "/"
#else
#define NDI_LIB "libndi.so.6"
static const char *names[] = { "libndi.so.6", "libndi.so.5", "libndi.so", "/usr/local/lib/libndi.so.6", "/usr/lib/libndi.so.6", NULL };
#define SEP "/"
#endif
static void *load(void) {
  const char *env[] = { "NDI_RUNTIME_DIR_V6", "NDI_RUNTIME_DIR_V5", NULL }; char path[1024]; void *h = NULL;
  for (int i = 0; env[i] && !h; i++) {
    const char *d = getenv(env[i]); if (!d) continue;
#if defined(_WIN32) || defined(__APPLE__)
    snprintf(path, sizeof path, "%s" SEP "%s", d, NDI_LIB);
#else
    snprintf(path, sizeof path, "%s/libndi.so.%c", d, env[i][17]);
#endif
    h = pl_dlopen(path);
  }
  for (int i = 0; names[i] && !h; i++) h = pl_dlopen(names[i]);
  return h;
}
int main(int argc, char **argv) {
  const char *name = argc > 1 ? argv[1] : "Central Usage";
  pl_binary_stdio();
  void *lib = load();
  if (!lib) { say("{\"ev\":\"status\",\"ok\":false,\"error\":\"The NDI runtime is not installed (" NDI_LIB " - get NDI Tools from ndi.video).\"}\n"); return 2; }
  *(void **)&ndi_init = pl_dlsym(lib, "NDIlib_initialize"); *(void **)&ndi_send_create = pl_dlsym(lib, "NDIlib_send_create");
  *(void **)&ndi_send_destroy = pl_dlsym(lib, "NDIlib_send_destroy"); *(void **)&ndi_send_video = pl_dlsym(lib, "NDIlib_send_send_video_v2");
  *(void **)&ndi_send_conns = pl_dlsym(lib, "NDIlib_send_get_no_connections");
  if (!ndi_init || !ndi_send_create || !ndi_send_video || !ndi_init()) { say("{\"ev\":\"status\",\"ok\":false,\"error\":\"The NDI runtime could not start (unsupported CPU or an old version).\"}\n"); return 3; }
  NDIlib_send_create_t sc = { name, NULL, true, false };
  void *snd = ndi_send_create(&sc);
  if (!snd) { say("{\"ev\":\"status\",\"ok\":false,\"error\":\"Could not create the NDI source.\"}\n"); return 4; }
  say("{\"ev\":\"status\",\"ok\":true,\"name\":\"%s\"}\n", name);
  uint8_t *buf = NULL; size_t cap = 0; unsigned frames = 0;
  for (;;) {
    uint8_t h[5]; if (!read_full(h, 5)) break;
    uint32_t n = h[1] | h[2] << 8 | h[3] << 16 | (uint32_t)h[4] << 24;
    if (h[0] == 'Q') break;
    if (n > cap) { free(buf); cap = n; buf = malloc(cap); if (!buf) break; }
    if (!read_full(buf, n)) break;
    if (h[0] != 'V' || n < 8) continue;
    int w = buf[0] | buf[1] << 8, hgt = buf[2] | buf[3] << 8, fps = buf[4] | buf[5] << 8;
    if ((size_t)w * hgt * 4 + 8 > n) continue;
    NDIlib_video_frame_v2_t f; memset(&f, 0, sizeof f);
    f.xres = w; f.yres = hgt; f.FourCC = (int)FOURCC('B', 'G', 'R', 'A'); f.frame_rate_N = (fps > 0 ? fps : 30) * 1000; f.frame_rate_D = 1000;
    f.picture_aspect_ratio = (float)w / (float)hgt; f.frame_format_type = 1; f.timecode = INT64_MAX; f.p_data = buf + 8; f.line_stride_in_bytes = w * 4;
    ndi_send_video(snd, &f);
    if (++frames % 150 == 0 && ndi_send_conns) say("{\"ev\":\"stats\",\"frames\":%u,\"receivers\":%d}\n", frames, ndi_send_conns(snd, 0));
  }
  if (ndi_send_destroy) ndi_send_destroy(snd);
  return 0;
}
