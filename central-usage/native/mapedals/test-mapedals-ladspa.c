/* Loads central-pedals.so the way PipeWire does (dlopen + ladspa_descriptor), checks every plugin against
 * instrument-plugins.json's entries (passed as a list: label sym sym ... per line, made by tools/make-pedal-plugins.js --check)
 * and plays a few blocks through each one.   test-mapedals-ladspa <central-pedals.so> [<ports.txt>] */
#include <dlfcn.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef float LADSPA_Data;
typedef void *LADSPA_Handle;
typedef struct { int HintDescriptor; LADSPA_Data LowerBound, UpperBound; } LADSPA_PortRangeHint;
typedef struct LADSPA_Descriptor {
  unsigned long UniqueID; const char *Label; int Properties; const char *Name, *Maker, *Copyright;
  unsigned long PortCount; const int *PortDescriptors; const char *const *PortNames; const LADSPA_PortRangeHint *PortRangeHints;
  void *ImplementationData;
  LADSPA_Handle (*instantiate)(const struct LADSPA_Descriptor *, unsigned long);
  void (*connect_port)(LADSPA_Handle, unsigned long, LADSPA_Data *);
  void (*activate)(LADSPA_Handle);
  void (*run)(LADSPA_Handle, unsigned long);
  void (*run_adding)(LADSPA_Handle, unsigned long);
  void (*set_run_adding_gain)(LADSPA_Handle, LADSPA_Data);
  void (*deactivate)(LADSPA_Handle);
  void (*cleanup)(LADSPA_Handle);
} LADSPA_Descriptor;

int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "usage: %s central-pedals.so [ports.txt]\n", argv[0]); return 2; }
  void *lib = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL); if (!lib) { printf("FAIL: dlopen: %s\n", dlerror()); return 1; }
  const LADSPA_Descriptor *(*get)(unsigned long) = (const LADSPA_Descriptor *(*)(unsigned long))dlsym(lib, "ladspa_descriptor");
  if (!get) { printf("FAIL: no ladspa_descriptor\n"); return 1; }
  int fails = 0, n = 0;
  float in[256], out[256], ctl[16];
  for (int i = 0; i < 256; i++) in[i] = 0.3f * sinf(2 * 3.14159265f * 220 * i / 48000.f);
  for (unsigned long i = 0; get(i); i++, n++) {
    const LADSPA_Descriptor *d = get(i); LADSPA_Handle h = d->instantiate(d, 48000);
    if (!h) { printf("FAIL: %s: instantiate\n", d->Label); fails++; continue; }
    int nin = 0, nout = 0;
    for (unsigned long p = 0; p < d->PortCount; p++) {
      int pd = d->PortDescriptors[p];
      if (pd & 4) { const LADSPA_PortRangeHint *r = &d->PortRangeHints[p]; ctl[p] = (r->LowerBound + r->UpperBound) * 0.5f; d->connect_port(h, p, &ctl[p]); }
      else if (pd & 1) { d->connect_port(h, p, in); nin++; if (strcmp(d->PortNames[p], "in")) { printf("FAIL: %s: audio in is %s\n", d->Label, d->PortNames[p]); fails++; } }
      else { d->connect_port(h, p, out); nout++; if (strcmp(d->PortNames[p], "out")) { printf("FAIL: %s: audio out is %s\n", d->Label, d->PortNames[p]); fails++; } }
    }
    if (nin != 1 || nout != 1) { printf("FAIL: %s: %d in, %d out\n", d->Label, nin, nout); fails++; }
    d->activate(h);
    for (int b = 0; b < 200; b++) { d->run(h, 256); for (int k = 0; k < 256; k++) if (!isfinite(out[k])) { printf("FAIL: %s: not finite\n", d->Label); fails++; b = 200; break; } }
    d->cleanup(h);
  }
  /* the ports each plugin should have, as instrument-plugins.json says */
  if (argc > 2) {
    FILE *f = fopen(argv[2], "r"); if (!f) { printf("FAIL: %s\n", argv[2]); return 1; }
    char line[2048]; int listed = 0;
    while (fgets(line, sizeof line, f)) {
      char *tok = strtok(line, " \n"); if (!tok) continue; listed++;
      const LADSPA_Descriptor *d = NULL; for (unsigned long i = 0; get(i); i++) if (!strcmp(get(i)->Label, tok)) d = get(i);
      if (!d) { printf("FAIL: instrument-plugins.json lists %s, the library doesn't have it\n", tok); fails++; continue; }
      unsigned long p = 0; for (char *s = strtok(NULL, " \n"); s; s = strtok(NULL, " \n"), p++)
        if (p >= d->PortCount || strcmp(d->PortNames[p], s)) { printf("FAIL: %s: port %lu should be %s\n", d->Label, p, s); fails++; break; }
      if (p != d->PortCount) { printf("FAIL: %s: %lu ports listed, the plugin has %lu\n", tok, p, d->PortCount); fails++; }
    }
    fclose(f);
    if (listed != n) { printf("FAIL: instrument-plugins.json lists %d Central Pedals, the library has %d\n", listed, n); fails++; }
  }
  printf("central-pedals.so: %d plugins, %d failed\n", n, fails);
  return fails ? 1 : 0;
}
