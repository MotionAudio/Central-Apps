/* Central Pedals (10.3): Motion Audio's own pedals, one C library for every place a pedal plays.
 *   - the computer rig (cu-rig: Central Control, Central Usage, Central Production, Central Pedal Control)
 *   - the Raspberry Pi's guitar chain: the same code as a LADSPA plugin library, central-pedals.so, which
 *     PipeWire's filter-chain loads (instrument_host.py)
 * So a pedal sounds the same on the Pi and on a computer.
 *
 * Every pedal is mono in, mono out (a guitar, bass or acoustic). The rig runs one per side for a stereo chain.
 * Real-time safe: all memory is taken in mp_new, nothing is allocated or locked in mp_run. */
#ifndef MAPEDALS_H
#define MAPEDALS_H

#define MP_MAXCTL 8

typedef struct {
  const char *sym;     /* the control's name on the plugin (LADSPA port name, the rig's control symbol) */
  const char *name;    /* what the knob says */
  float min, max, def;
  int integer;         /* 1: whole numbers (a switch or a choice) */
  const char *unit;    /* "dB", "ms", "Hz", "%", "bpm", "st" or "" */
} MpCtl;

typedef struct {
  const char *id;      /* the plugin's label: "ma_klon" (the catalogue's pedal id is "ma-klon") */
  const char *name;    /* "Gold Horse Drive" */
  const char *cat;     /* the catalogue's category: boost, dist, fuzz, comp, eq, wah, mod, trem, pitch, delay, reverb, amp, util, acoustic */
  int kind;            /* which DSP (internal) */
  int voice;           /* a voicing of that DSP (internal) */
  int nctl;
  MpCtl ctl[MP_MAXCTL];
} MpDef;

typedef struct MpFx MpFx;

int mp_count(void);
const MpDef *mp_def(int i);
const MpDef *mp_find(const char *id);
int mp_ctl_index(const MpDef *d, const char *sym);   /* -1 when the pedal has no such control */

MpFx *mp_new(const MpDef *d, double fs);   /* NULL when out of memory */
void mp_free(MpFx *x);
void mp_set(MpFx *x, int ctl, float value);  /* any thread; picked up at the next mp_run */
float mp_get(const MpFx *x, int ctl);
void mp_reset(MpFx *x);                      /* silence the tails */
void mp_run(MpFx *x, const float *in, float *out, int n);   /* in == out is fine */

#endif
