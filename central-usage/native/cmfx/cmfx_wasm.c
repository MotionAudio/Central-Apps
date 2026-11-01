/* cmfx_wasm.c - Central FX in WebAssembly (the browser engines: the plugin builder, Central Production, the website's
 * studio, the Central Pedal's HDMI app). Built with clang --target=wasm32 and no libc (tools/build-cmfx.sh); the same
 * C as the native builds, so a plugin sounds the same in the browser as on the pedal.
 * Memory: a simple heap that only grows; cmw_reset_heap forgets everything (one AudioWorklet node = one instance). */
#include "cmfx.h"
#include "cmfx_int.h"

#define EXPORT(n) __attribute__((export_name(#n)))
extern unsigned char __heap_base;
static unsigned long heapTop;
static char lastErr[300];

void *memset(void *p, int v, unsigned long n) { cm_memset(p, v, n); return p; }
void *memcpy(void *d, const void *s, unsigned long n) { cm_memcpy(d, s, n); return d; }
void *memmove(void *d, const void *s, unsigned long n) {
  unsigned char *dd = (unsigned char *)d; const unsigned char *ss = (const unsigned char *)s;
  if (dd < ss) while (n--) *dd++ = *ss++; else { dd += n; ss += n; while (n--) *--dd = *--ss; }
  return d;
}

EXPORT(cmw_alloc) void *cmw_alloc(unsigned long n) {
  if (!heapTop) heapTop = (unsigned long)&__heap_base;
  unsigned long p = (heapTop + 15) & ~15ul, end = p + n;
  unsigned long have = __builtin_wasm_memory_size(0) * 65536ul;
  if (end > have) { unsigned long pages = (end - have + 65535) / 65536; if (__builtin_wasm_memory_grow(0, pages) == (unsigned long)-1) return 0; }
  heapTop = end; return (void *)p;
}
EXPORT(cmw_reset_heap) void cmw_reset_heap(void) { heapTop = 0; }
EXPORT(cmw_error) const char *cmw_error(void) { return lastErr; }

/* a plugin from JSON (already in memory at json, len bytes): its handle, or 0 (cmw_error says why) */
EXPORT(cmw_new) CmFx *cmw_new(const char *json, int len, float sr) {
  lastErr[0] = 0;
  CmFx *fx = (CmFx *)cmw_alloc(cmfx_struct_size());
  if (!fx) { cm_fmt(lastErr, sizeof lastErr, "not enough memory for the plugin"); return 0; }
  if (cmfx_load(fx, json, len, sr, lastErr, sizeof lastErr) != 0) return 0;
  float *pool = (float *)cmw_alloc(cmfx_pool_floats(fx) * sizeof(float));
  if (!pool) { cm_fmt(lastErr, sizeof lastErr, "not enough memory for the plugin's delays"); return 0; }
  cmfx_attach(fx, pool);
  return fx;
}
EXPORT(cmw_process) void cmw_process(CmFx *fx, const float *inL, const float *inR, float *outL, float *outR, int n) { cmfx_process(fx, inL, inR, outL, outR, n); }
EXPORT(cmw_reset) void cmw_reset(CmFx *fx) { cmfx_reset(fx); }
EXPORT(cmw_name) const char *cmw_name(CmFx *fx) { return cmfx_name(fx); }
EXPORT(cmw_status) const char *cmw_status(CmFx *fx) { const char *s = cmfx_status(fx); return s ? s : ""; }
EXPORT(cmw_param_count) int cmw_param_count(CmFx *fx) { return cmfx_param_count(fx); }
EXPORT(cmw_param_id) const char *cmw_param_id(CmFx *fx, int i) { return cmfx_param_id(fx, i); }
EXPORT(cmw_param_index) int cmw_param_index(CmFx *fx, const char *id) { return cmfx_param_index(fx, id); }
EXPORT(cmw_set_param) void cmw_set_param(CmFx *fx, int i, float v) { cmfx_set_param(fx, i, v); }
EXPORT(cmw_get_param) float cmw_get_param(CmFx *fx, int i) { return cmfx_param_get(fx, i); }
EXPORT(cmw_types) const char *cmw_types(void) { return cmfx_types_json(); }
EXPORT(cmw_check_code) int cmw_check_code(const char *code, int len) { lastErr[0] = 0; return cmfx_check_code(code, len, lastErr, sizeof lastErr); }
/* a check of a whole plugin without keeping it (the builder's error line): 0 fine */
EXPORT(cmw_check) int cmw_check(const char *json, int len, float sr) {
  unsigned long top = heapTop; CmFx *fx = (CmFx *)cmw_alloc(cmfx_struct_size()); lastErr[0] = 0;
  int r = fx ? cmfx_load(fx, json, len, sr, lastErr, sizeof lastErr) : -1;
  heapTop = top; return r;
}
