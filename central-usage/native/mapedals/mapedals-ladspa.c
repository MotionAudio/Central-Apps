/* Central Pedals as a LADSPA plugin library (central-pedals.so) for the Raspberry Pi: PipeWire's filter-chain loads it
 * (instrument_host.py names it by its full path). One plugin per pedal; its label is the pedal's id ("ma_plate").
 * Ports: the controls first (named by their symbol, as instrument-plugins.json lists them), then "in" and "out".
 * The LADSPA ABI is declared here (it's a plain C struct, stable since 2000), so no header has to be installed. */
#include "mapedals.h"
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
enum { P_IN = 1, P_OUT = 2, P_CONTROL = 4, P_AUDIO = 8 };
enum { H_BELOW = 1, H_ABOVE = 2, H_TOGGLED = 4, H_INTEGER = 0x20, D_MIN = 0x40, D_LOW = 0x80, D_MID = 0xC0, D_HIGH = 0x100, D_MAX = 0x140, D_0 = 0x200, D_1 = 0x240, D_100 = 0x280, D_440 = 0x2C0 };
#define ID_BASE 0x4D410000UL   /* "MA" and the pedal's place in the table */

typedef struct { MpFx *fx; const MpDef *d; LADSPA_Data *ctl[MP_MAXCTL]; float last[MP_MAXCTL]; LADSPA_Data *in, *out; } Inst;

static LADSPA_Handle instantiate(const LADSPA_Descriptor *desc, unsigned long rate) {
  Inst *p = calloc(1, sizeof *p); if (!p) return NULL;
  p->d = desc->ImplementationData; p->fx = mp_new(p->d, (double)rate);
  if (!p->fx) { free(p); return NULL; }
  for (int k = 0; k < MP_MAXCTL; k++) p->last[k] = 1e30f;
  return p;
}
static void connect_port(LADSPA_Handle h, unsigned long port, LADSPA_Data *data) {
  Inst *p = h; int n = p->d->nctl;
  if ((int)port < n) p->ctl[port] = data; else if ((int)port == n) p->in = data; else if ((int)port == n + 1) p->out = data;
}
static void activate(LADSPA_Handle h) { mp_reset(((Inst *)h)->fx); }
static void run(LADSPA_Handle h, unsigned long count) {
  Inst *p = h; if (!p->in || !p->out) return;
  for (int k = 0; k < p->d->nctl; k++) if (p->ctl[k] && *p->ctl[k] != p->last[k]) { p->last[k] = *p->ctl[k]; mp_set(p->fx, k, p->last[k]); }
  unsigned long done = 0;
  while (done < count) { int n = count - done > 1024 ? 1024 : (int)(count - done); mp_run(p->fx, p->in + done, p->out + done, n); done += (unsigned long)n; }
}
static void cleanup(LADSPA_Handle h) { Inst *p = h; mp_free(p->fx); free(p); }

/* the descriptors, built the first time they're asked for (and freed when the library unloads) */
static LADSPA_Descriptor *descs; static int ndescs;
static int default_hint(const MpCtl *c) {
  float lo = c->min, hi = c->max, v = c->def; if (c->integer && lo == 0 && hi == 1) return v > 0.5f ? D_1 : D_0;
  struct { int hint; float value; } opt[] = { { D_MIN, lo }, { D_LOW, lo * 0.75f + hi * 0.25f }, { D_MID, (lo + hi) * 0.5f }, { D_HIGH, lo * 0.25f + hi * 0.75f }, { D_MAX, hi },
                                              { D_0, 0 }, { D_1, 1 }, { D_100, 100 }, { D_440, 440 } };
  int best = D_MID; float bd = 1e30f;
  for (unsigned i = 0; i < sizeof opt / sizeof *opt; i++) { if (opt[i].value < lo || opt[i].value > hi) continue; float d = opt[i].value > v ? opt[i].value - v : v - opt[i].value; if (d < bd) { bd = d; best = opt[i].hint; } }
  return best;
}
static void build(void) {
  int n = mp_count(); descs = calloc((size_t)n, sizeof *descs); if (!descs) return;
  for (int i = 0; i < n; i++) {
    const MpDef *d = mp_def(i); LADSPA_Descriptor *D = &descs[i]; int np = d->nctl + 2;
    int *pd = calloc((size_t)np, sizeof(int)); const char **names = calloc((size_t)np, sizeof(char *)); LADSPA_PortRangeHint *hints = calloc((size_t)np, sizeof *hints);
    if (!pd || !names || !hints) { free(pd); free(names); free(hints); continue; }
    for (int k = 0; k < d->nctl; k++) {
      const MpCtl *c = &d->ctl[k]; pd[k] = P_IN | P_CONTROL; names[k] = c->sym;
      hints[k].HintDescriptor = H_BELOW | H_ABOVE | (c->integer ? H_INTEGER : 0) | (c->integer && c->min == 0 && c->max == 1 ? H_TOGGLED : 0) | default_hint(c);
      hints[k].LowerBound = c->min; hints[k].UpperBound = c->max;
    }
    pd[d->nctl] = P_IN | P_AUDIO; names[d->nctl] = "in"; pd[d->nctl + 1] = P_OUT | P_AUDIO; names[d->nctl + 1] = "out";
    D->UniqueID = ID_BASE + (unsigned long)i; D->Label = d->id; D->Properties = 1 | 4;   /* real-time, hard real-time capable (in place is fine) */
    D->Name = d->name; D->Maker = "Motion Audio"; D->Copyright = "Motion Audio's own (Central Pedals)";
    D->PortCount = (unsigned long)np; D->PortDescriptors = pd; D->PortNames = names; D->PortRangeHints = hints; D->ImplementationData = (void *)d;
    D->instantiate = instantiate; D->connect_port = connect_port; D->activate = activate; D->run = run; D->cleanup = cleanup;
    ndescs = i + 1;
  }
}
__attribute__((visibility("default"))) const LADSPA_Descriptor *ladspa_descriptor(unsigned long index) {
  if (!descs) build();
  return descs && index < (unsigned long)ndescs && descs[index].Label ? &descs[index] : NULL;
}
__attribute__((destructor)) static void unload(void) {
  if (!descs) return;
  for (int i = 0; i < ndescs; i++) { free((void *)descs[i].PortDescriptors); free((void *)descs[i].PortNames); free((void *)descs[i].PortRangeHints); }
  free(descs); descs = NULL;
}
