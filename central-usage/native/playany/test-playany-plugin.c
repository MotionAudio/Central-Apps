/* Test for the Raspberry Pi's play-any plugin (central-playany.so): loads it the way PipeWire's filter-chain does
 * (dlopen + ladspa_descriptor), plays it guitar notes and a chord, and checks that the notes reach a stand-in
 * for FluidSynth's shell (a TCP server here) as "noteon <ch> <note> <vel>" lines, how long after the audio they
 * arrive, that the synth mode makes sound, that the LV2 description (central-playany.lv2) matches the plugin.
 * Build: cc -O2 -o test-playany-plugin test-playany-plugin.c -ldl -lpthread -lm
 * Run:   ./test-playany-plugin ./central-playany.so central-playany.lv2/central-playany.ttl */
#define _GNU_SOURCE
#include <arpa/inet.h>
#include <dlfcn.h>
#include <math.h>
#include <netinet/in.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif
typedef struct _LD {
  unsigned long UniqueID; const char *Label; int Properties; const char *Name, *Maker, *Copyright; unsigned long PortCount;
  const int *PortDescriptors; const char *const *PortNames; const void *PortRangeHints; void *ImplementationData;
  void *(*instantiate)(const struct _LD *, unsigned long); void (*connect_port)(void *, unsigned long, float *); void (*activate)(void *);
  void (*run)(void *, unsigned long); void (*run_adding)(void *, unsigned long); void (*set_run_adding_gain)(void *, float); void (*deactivate)(void *); void (*cleanup)(void *);
} LD;
static int failures; static void check(int ok, const char *what) { printf("  %s  %s\n", ok ? "ok  " : "FAIL", what); if (!ok) failures++; }
static double now(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec + t.tv_nsec / 1e9; }

/* the stand-in FluidSynth shell: records what arrives, and when */
static int lsock, port; static char got[65536]; static size_t gotLen; static double firstOn; static pthread_mutex_t mu = PTHREAD_MUTEX_INITIALIZER;
static void *server(void *a) {
  (void)a; int fd = accept(lsock, NULL, NULL); if (fd < 0) return NULL; char b[4096]; ssize_t n;
  while ((n = recv(fd, b, sizeof b, 0)) > 0) { pthread_mutex_lock(&mu); if (!firstOn && memmem(b, (size_t)n, "noteon", 6)) firstOn = now(); if (gotLen + (size_t)n < sizeof got) { memcpy(got + gotLen, b, (size_t)n); gotLen += (size_t)n; got[gotLen] = 0; } pthread_mutex_unlock(&mu); }
  close(fd); return NULL;
}
static void pluck(float *buf, int len, int start, double f0, double amp) {
  for (int h = 1; h <= 20 && h * f0 < 20000; h++) { double a = amp * fabs(sin(M_PI * h * 0.2)) / (h * h) * 3, w = 2 * M_PI * h * f0 / 48000, r = exp(-6.9 / (1.5 / (1 + 0.1 * h) * 48000)); for (int i = start; i < len; i++) { buf[i] += (float)(a * sin(w * (i - start))); a *= r; } }
}

int main(int argc, char **argv) {
  const char *so = argc > 1 ? argv[1] : "./central-playany.so", *ttl = argc > 2 ? argv[2] : NULL;
  void *lib = dlopen(so, RTLD_NOW | RTLD_LOCAL); if (!lib) { printf("FAIL  could not load %s: %s\n", so, dlerror()); return 1; }
  const LD *(*ladspa)(unsigned long) = (const LD *(*)(unsigned long))dlsym(lib, "ladspa_descriptor");
  const void *(*lv2)(unsigned) = (const void *(*)(unsigned))dlsym(lib, "lv2_descriptor");
  const char *(*portInfo)(int, float *, float *, float *) = (const char *(*)(int, float *, float *, float *))dlsym(lib, "central_playany_port");
  check(ladspa && lv2 && portInfo, "the plugin has a LADSPA and an LV2 entry point");
  if (!ladspa) return 1;
  const LD *d = ladspa(0); check(d && !strcmp(d->Label, "central_playany") && d->PortCount == 14 && !ladspa(1), "LADSPA: one plugin, label central_playany, 14 ports");
  printf("  ports:"); for (unsigned long i = 0; i < d->PortCount; i++) printf(" %s%s", d->PortNames[i], i + 1 < d->PortCount ? "," : "\n");
  if (ttl) {   /* the LV2 description lists the same ports, in the same order, with the same ranges */
    FILE *f = fopen(ttl, "r"); char *s = NULL; size_t n = 0; if (f) { fseek(f, 0, SEEK_END); n = (size_t)ftell(f); fseek(f, 0, SEEK_SET); s = malloc(n + 1); n = fread(s, 1, n, f); s[n] = 0; fclose(f); }
    int ok = s != NULL;
    for (int i = 0; ok && i < 14; i++) {
      float mn, mx, df; const char *sym = portInfo(i, &mn, &mx, &df); char want[160];
      snprintf(want, sizeof want, "lv2:index %d ; lv2:symbol \"%s\"", i, sym); if (!strstr(s, want)) { printf("    ttl is missing: %s\n", want); ok = 0; }
      if (i >= 2) { char *at = strstr(s, want), *nx = at ? strstr(at + 1, "lv2:index") : NULL; char rng[96]; snprintf(rng, sizeof rng, "lv2:minimum %g ; lv2:maximum %g", mn, mx); char *r = at ? strstr(at, rng) : NULL; if (!r || (nx && r > nx)) { printf("    ttl port %s: want %s\n", sym, rng); ok = 0; } }
    }
    check(ok, "LV2: central-playany.ttl matches the plugin's ports");
    free(s);
  }
  /* the stand-in FluidSynth */
  lsock = socket(AF_INET, SOCK_STREAM, 0); struct sockaddr_in a; memset(&a, 0, sizeof a); a.sin_family = AF_INET; a.sin_addr.s_addr = htonl(0x7F000001);
  bind(lsock, (struct sockaddr *)&a, sizeof a); socklen_t al = sizeof a; getsockname(lsock, (struct sockaddr *)&a, &al); port = ntohs(a.sin_port); listen(lsock, 1);
  pthread_t th; pthread_create(&th, NULL, server, NULL);
  void *h = d->instantiate(d, 48000);
  float ctl[14] = { 0, 0, 1, 0, 0.5f, 0, 1, 40, 88, 10, (float)port, 1, 0, 0 };
  int len = 48000 * 2; float *in = calloc((size_t)len, sizeof(float)), *out = calloc((size_t)len, sizeof(float));
  pluck(in, len, 4800, 329.63, 0.3);                      /* E4 at 0.1 s */
  pluck(in, len, 4800 + 24000, 392.0, 0.3);               /* G4 at 0.6 s */
  static const double E[] = { 82.41, 123.47, 164.81, 207.65, 246.94, 329.63 };
  for (int s = 0; s < 6; s++) pluck(in, len, 4800 + 48000 + s * 400, E[s], 0.2);   /* an E chord at 1.1 s */
  for (int i = 2; i < 14; i++) d->connect_port(h, (unsigned long)i, &ctl[i]);
  d->activate ? d->activate(h) : (void)0;
  double tNoteBlock = 0; int stateChord = 0; float synthPeak = 0;
  usleep(300000);   /* (the plugin's sender thread connects to the stand-in) */
  for (int i = 0; i < len; i += 128) {
    d->connect_port(h, 0, in + i); d->connect_port(h, 1, out + i); d->run(h, 128);
    if (!tNoteBlock && ctl[13] >= 0 && ctl[12] == 1) tNoteBlock = now();
    if (ctl[12] == 2) stateChord = 1;
    for (int k = 0; k < 128; k++) if (fabsf(out[i + k]) > synthPeak) synthPeak = fabsf(out[i + k]);
    usleep(2000);   /* about real time (128 samples = 2.7 ms) */
  }
  usleep(100000);
  ctl[2] = 0; d->connect_port(h, 0, in); d->connect_port(h, 1, out); d->run(h, 128);   /* switched off: all notes off */
  usleep(100000);
  d->deactivate ? d->deactivate(h) : (void)0; d->cleanup(h);
  pthread_mutex_lock(&mu); char copy[65536]; memcpy(copy, got, gotLen + 1); double fo = firstOn; pthread_mutex_unlock(&mu);
  printf("  to FluidSynth:\n"); { char *l = copy; int shown = 0; while (*l && shown < 12) { char *e = strchr(l, '\n'); if (!e) break; printf("    %.*s\n", (int)(e - l), l); l = e + 1; shown++; } }
  check(strstr(copy, "noteon 10 64 ") != NULL, "E4 played: noteon 10 64 on channel 10");
  check(strstr(copy, "noteon 10 67 ") != NULL, "G4 played: noteon 10 67");
  check(strstr(copy, "noteoff 10 64") != NULL, "E4 ended: noteoff 10 64");
  check(stateChord, "the E chord switched to synth mode");
  check(synthPeak > 0.02f, "synth mode made sound");
  if (fo && tNoteBlock) { printf("  the note reached FluidSynth %.2f ms after the audio block that found it\n", (fo - tNoteBlock) * 1000); check(fo - tNoteBlock < 0.003, "audio block -> FluidSynth < 3 ms"); }
  else check(0, "a note reached FluidSynth");
  close(lsock); dlclose(lib); free(in); free(out);
  printf("%s (%d failed)\n", failures ? "FAILED" : "all passed", failures);
  return failures ? 1 : 0;
}
