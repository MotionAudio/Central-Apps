/* cmfx.h - Central FX: the plugins made in Central Production's plugin builder (10.2; docs/PLUGIN-BUILDER.md).
 *
 * A plugin is a JSON file (.cmfx.json):
 *   {format:"central-fx", version:1, name, author?, params:[{id,name,min,max,default,unit,curve?}],
 *    graph:{blocks:[{id,type,x,y,props}], wires:[{from:"blockId.port", to:"blockId.port"}]}, code?:string}
 * This one C core reads it, checks it and plays it - in the rig (cu-rig), the Central Pedal (cm-pwnode), and, built to
 * WebAssembly (cmfx_wasm.c), in every browser engine - so a plugin sounds the same everywhere.
 *
 * Safe by design: the graph only connects our own blocks, and the code language (cmfx_code.c) has no files, network
 * or system calls, bounded loops and a cap on the work per sample. Real-time safe: nothing is allocated after
 * cmfx_attach, no locks, no denormals.
 *
 * Use (host side):
 *   CmFx *fx = malloc(cmfx_struct_size());
 *   if (cmfx_load(fx, json, len, sampleRate, err, sizeof err) != 0) -> err says what is wrong (with the line for code)
 *   float *pool = calloc(cmfx_pool_floats(fx), sizeof(float)); cmfx_attach(fx, pool);
 *   audio thread: cmfx_process(fx, inL, inR, outL, outR, n)   (inL may be NULL; inR NULL = mono in)
 *   any thread:   cmfx_set_param(fx, i, value)   (real units, smoothed on the audio side) */
#ifndef CMFX_H
#define CMFX_H
#ifdef __cplusplus
extern "C" {
#endif

typedef struct CmFx CmFx;

unsigned long cmfx_struct_size(void);
/* parse + check + compile; 0 = fine, else err holds the reason ("line 3: ..." for code) */
int cmfx_load(CmFx *fx, const char *json, int len, float sampleRate, char *err, int errLen);
/* the memory the delays, reverbs and code arrays need (floats), after cmfx_load */
unsigned long cmfx_pool_floats(CmFx *fx);
/* hand the memory over (zeroed here) and run the code's @init: ready to play */
void cmfx_attach(CmFx *fx, float *pool);
void cmfx_reset(CmFx *fx);   /* silence every delay, reverb and filter (and run @init again) */
void cmfx_process(CmFx *fx, const float *inL, const float *inR, float *outL, float *outR, int n);

const char *cmfx_name(CmFx *fx);
const char *cmfx_author(CmFx *fx);
int cmfx_param_count(CmFx *fx);
const char *cmfx_param_id(CmFx *fx, int i);
const char *cmfx_param_name(CmFx *fx, int i);
const char *cmfx_param_unit(CmFx *fx, int i);
float cmfx_param_min(CmFx *fx, int i);
float cmfx_param_max(CmFx *fx, int i);
float cmfx_param_default(CmFx *fx, int i);
int cmfx_param_log(CmFx *fx, int i);          /* 1: the knob moves on a log scale (frequencies, times) */
float cmfx_param_get(CmFx *fx, int i);
void cmfx_set_param(CmFx *fx, int i, float value);   /* real units, clamped */
float cmfx_param_to_norm(CmFx *fx, int i, float value);
float cmfx_param_from_norm(CmFx *fx, int i, float norm);
int cmfx_param_index(CmFx *fx, const char *id);
/* how it is doing: 0 fine; else a short reason (the code went over its budget, made an invalid number...) */
const char *cmfx_status(CmFx *fx);

/* only check code (the editor's error list): 0 fine, else err "line N: ..." */
int cmfx_check_code(const char *code, int len, char *err, int errLen);

#ifdef __cplusplus
}
#endif
#endif
