/* cm-pwnode - the Central Pedal's community stage (10.1): one PipeWire node that plays the board's community plugins,
 * in series, each one walled off in its own cm-plugbridge process (plughost/bridge.h). Our own pedals keep running in
 * the PipeWire filter-chain as before; instrument_host.py starts this only when a board has community plugins on it,
 * and links it after the chain:  guitar -> padpedal-<chain> -> cm-community -> outputs.
 *
 *   cm-pwnode --data <folder> [--name cm-community] [--rate 48000] [--block 128]
 * stdin: JSON lines
 *   {"action":"chain","items":[{"uid","plugin":{"format","id","path"},"on":true,"mix":1,"stateFrom":""}]}
 *   {"action":"pluginParams","uid"}  {"action":"pluginSet","uid","id","value"}  {"action":"pluginRestart","uid"}
 *   {"action":"pluginSave"}  {"action":"status"}
 * stdout: JSON lines - {"type":"communityStatus","running":true,"node":"cm-community","slots":{...},"errors":{uid:why}},
 *   {"type":"pluginParams",...}, {"type":"pluginBypassed","uid","reason"} (crashed / hung / heavy / revoked / off)
 * Light on the Pi 4: no plugin runs in this process (only community plugins are accepted here), the audio thread
 * only copies blocks to and from shared memory, and libpipewire is loaded at run time (only its headers are needed
 * to build this). */
#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#include <dlfcn.h>
#include <math.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <pipewire/pipewire.h>
#include <pipewire/filter.h>
#include "plughost/plughost.h"
#include "vendor/cJSON.h"

#define MAXITEMS 16
#define MAXN 8192

/* ---- libpipewire, loaded at run time */
static struct {
  void (*init)(int *, char ***);
  struct pw_thread_loop *(*tl_new)(const char *, const struct spa_dict *);
  struct pw_loop *(*tl_loop)(struct pw_thread_loop *);
  int (*tl_start)(struct pw_thread_loop *);
  void (*tl_stop)(struct pw_thread_loop *), (*tl_destroy)(struct pw_thread_loop *), (*tl_lock)(struct pw_thread_loop *), (*tl_unlock)(struct pw_thread_loop *);
  struct pw_properties *(*props_new)(const char *, ...);
  struct pw_filter *(*filter_new_simple)(struct pw_loop *, const char *, struct pw_properties *, const struct pw_filter_events *, void *);
  void *(*add_port)(struct pw_filter *, enum pw_direction, enum pw_filter_port_flags, size_t, struct pw_properties *, const struct spa_pod **, uint32_t);
  int (*connect)(struct pw_filter *, enum pw_filter_flags, const struct spa_pod **, uint32_t);
  void *(*dsp_buffer)(void *, uint32_t);
  void (*destroy)(struct pw_filter *);
} PW;
static int pw_load(char *err, size_t n) {
  void *h = dlopen("libpipewire-0.3.so.0", RTLD_NOW | RTLD_GLOBAL); if (!h) { snprintf(err, n, "PipeWire isn't installed (libpipewire-0.3)"); return 0; }
#define S(f, name) if (!(*(void **)&PW.f = dlsym(h, name))) { snprintf(err, n, "PipeWire is too old (no %s)", name); return 0; }
  S(init, "pw_init") S(tl_new, "pw_thread_loop_new") S(tl_loop, "pw_thread_loop_get_loop") S(tl_start, "pw_thread_loop_start") S(tl_stop, "pw_thread_loop_stop")
  S(tl_destroy, "pw_thread_loop_destroy") S(tl_lock, "pw_thread_loop_lock") S(tl_unlock, "pw_thread_loop_unlock") S(props_new, "pw_properties_new")
  S(filter_new_simple, "pw_filter_new_simple") S(add_port, "pw_filter_add_port") S(connect, "pw_filter_connect") S(dsp_buffer, "pw_filter_get_dsp_buffer") S(destroy, "pw_filter_destroy")
#undef S
  return 1;
}

/* ---- the chain (built on the main thread, swapped into the audio thread) */
typedef struct { PhPlug *p; int on; float mix; char uid[40]; } Item;
typedef struct { int n; Item it[MAXITEMS]; } Chain;
static _Atomic(Chain *) live, pending, retired;
static atomic_int processing;   /* the audio thread has run at least once lately (else the main thread swaps itself) */
static FILE *proto; static pthread_mutex_t outLock = PTHREAD_MUTEX_INITIALIZER;
static void emit(const char *s) { pthread_mutex_lock(&outLock); fputs(s, proto); fputc('\n', proto); fflush(proto); pthread_mutex_unlock(&outLock); }
static void emitJ(cJSON *o) { char *s = cJSON_PrintUnformatted(o); if (s) emit(s); free(s); cJSON_Delete(o); }
static const char *str(cJSON *o, const char *k, const char *d) { const char *v = cJSON_GetStringValue(cJSON_GetObjectItem(o, k)); return v ? v : d; }
static double num(cJSON *o, const char *k, double d) { cJSON *v = cJSON_GetObjectItem(o, k); return cJSON_IsNumber(v) ? v->valuedouble : d; }
static void clean(const char *in, char *out, size_t n) { size_t j = 0; for (; *in && j + 1 < n; in++) if ((*in >= 'a' && *in <= 'z') || (*in >= 'A' && *in <= 'Z') || (*in >= '0' && *in <= '9') || *in == '-' || *in == '_') out[j++] = *in; out[j] = 0; }

static double rate = 48000; static int block = 128; static char nodeName[64] = "cm-community", dataDir[1024] = ".";
struct port { int dummy; };
static void *inP[2], *outP[2];
static struct pw_filter *filter; static struct pw_thread_loop *tloop; static char pwError[200];

static void on_process(void *data, struct spa_io_position *pos) {
  (void)data; uint32_t n = pos ? (uint32_t)pos->clock.duration : (uint32_t)block; if (n > MAXN) n = MAXN;
  Chain *nx = atomic_exchange(&pending, NULL); if (nx) { Chain *old = atomic_exchange(&live, nx); if (old) atomic_store(&retired, old); }   /* (the main thread frees it) */
  atomic_store(&processing, 1);
  float *iL = PW.dsp_buffer(inP[0], n), *iR = PW.dsp_buffer(inP[1], n), *oL = PW.dsp_buffer(outP[0], n), *oR = PW.dsp_buffer(outP[1], n);
  if (!oL || !oR) return;
  static float aL[MAXN], aR[MAXN], bL[MAXN], bR[MAXN];
  for (uint32_t i = 0; i < n; i++) { aL[i] = iL ? iL[i] : 0.f; aR[i] = iR ? iR[i] : aL[i]; }
  Chain *c = atomic_load(&live);
  if (c) for (int k = 0; k < c->n; k++) {
    Item *it = &c->it[k]; if (!it->on || !it->p) continue;
    ph_process(it->p, aL, aR, bL, bR, (int)n, NULL, 0);   /* (walled off: never blocks past its budget; plays dry when bypassed) */
    float w = it->mix, d = 1.f - w; for (uint32_t i = 0; i < n; i++) { aL[i] = d * aL[i] + w * bL[i]; aR[i] = d * aR[i] + w * bR[i]; }
  }
  memcpy(oL, aL, n * sizeof(float)); memcpy(oR, aR, n * sizeof(float));
}
static const struct pw_filter_events events = { PW_VERSION_FILTER_EVENTS, .process = on_process };

static int pw_start(void) {
  if (!pw_load(pwError, sizeof pwError)) return 0;
  PW.init(NULL, NULL);
  tloop = PW.tl_new("cm-pwnode", NULL); if (!tloop) { snprintf(pwError, sizeof pwError, "PipeWire's loop didn't start"); return 0; }
  char lat[32]; snprintf(lat, sizeof lat, "%d/%.0f", block, rate);
  PW.tl_lock(tloop);
  filter = PW.filter_new_simple(PW.tl_loop(tloop), nodeName, PW.props_new(PW_KEY_MEDIA_TYPE, "Audio", PW_KEY_MEDIA_CATEGORY, "Filter", PW_KEY_MEDIA_ROLE, "DSP", PW_KEY_NODE_NAME, nodeName, PW_KEY_NODE_DESCRIPTION, "Community plugins (walled off)", PW_KEY_NODE_LATENCY, lat, PW_KEY_NODE_AUTOCONNECT, "false", NULL), &events, NULL);
  if (!filter) { PW.tl_unlock(tloop); snprintf(pwError, sizeof pwError, "PipeWire didn't make the node"); return 0; }
  const char *names[2][2] = { { "input_FL", "input_FR" }, { "output_FL", "output_FR" } };
  for (int i = 0; i < 2; i++) {
    inP[i] = PW.add_port(filter, PW_DIRECTION_INPUT, PW_FILTER_PORT_FLAG_MAP_BUFFERS, sizeof(struct port), PW.props_new(PW_KEY_FORMAT_DSP, "32 bit float mono audio", PW_KEY_PORT_NAME, names[0][i], NULL), NULL, 0);
    outP[i] = PW.add_port(filter, PW_DIRECTION_OUTPUT, PW_FILTER_PORT_FLAG_MAP_BUFFERS, sizeof(struct port), PW.props_new(PW_KEY_FORMAT_DSP, "32 bit float mono audio", PW_KEY_PORT_NAME, names[1][i], NULL), NULL, 0);
  }
  int r = PW.connect(filter, PW_FILTER_FLAG_RT_PROCESS, NULL, 0);
  PW.tl_unlock(tloop);
  if (r < 0) { snprintf(pwError, sizeof pwError, "PipeWire didn't connect the node (%d)", r); return 0; }
  if (PW.tl_start(tloop) < 0) { snprintf(pwError, sizeof pwError, "PipeWire's loop didn't start"); return 0; }
  return 1;
}

static cJSON *errors;
static void status(void) {
  cJSON *o = cJSON_CreateObject(); cJSON_AddStringToObject(o, "type", "communityStatus"); cJSON_AddBoolToObject(o, "running", filter != NULL); cJSON_AddStringToObject(o, "node", nodeName);
  if (pwError[0]) cJSON_AddStringToObject(o, "error", pwError);
  char *j = ph_slots_json(); cJSON *s = j ? cJSON_Parse(j) : NULL; free(j); cJSON_AddItemToObject(o, "slots", s ? s : cJSON_CreateObject());
  cJSON_AddItemToObject(o, "errors", errors ? cJSON_Duplicate(errors, 1) : cJSON_CreateObject()); emitJ(o);
}
static void free_chain(Chain *c) { if (!c) return; for (int i = 0; i < c->n; i++) if (c->it[i].p) ph_release(c->it[i].p); free(c); }
static void swap(Chain *c) {   /* hand c to the audio thread; release the chain it played before */
  atomic_store(&processing, 0);
  Chain *stale = atomic_exchange(&pending, c); free_chain(stale);
  for (int i = 0; i < 40 && atomic_load(&pending); i++) usleep(5000);
  if (atomic_load(&pending) && !atomic_load(&processing)) {   /* (the node isn't being run: swap here) */
    Chain *nx = atomic_exchange(&pending, NULL); if (nx) { Chain *old = atomic_exchange(&live, nx); free_chain(old); }
  }
  Chain *old = atomic_exchange(&retired, NULL); if (old && old != atomic_load(&live)) free_chain(old);
}
static cJSON *lastItems;
static void build(cJSON *items) {
  if (items) { cJSON_Delete(lastItems); lastItems = cJSON_Duplicate(items, 1); }
  cJSON_Delete(errors); errors = cJSON_CreateObject();
  Chain *c = calloc(1, sizeof *c); const char *slots[MAXITEMS]; int ns = 0; cJSON *it;
  cJSON_ArrayForEach(it, lastItems) {
    if (c->n >= MAXITEMS) break;
    cJSON *pl = cJSON_GetObjectItem(it, "plugin"); char uid[40]; clean(str(it, "uid", ""), uid, sizeof uid); if (!uid[0] || !cJSON_IsObject(pl)) continue;
    const char *path = str(pl, "path", "");
    if (!strstr(path, "/community-plugins/")) { cJSON_AddStringToObject(errors, uid, "only community plugins play in the community stage"); continue; }
    char err[300] = ""; PhPlug *p = ph_get(uid, str(pl, "format", ""), str(pl, "id", ""), path, str(it, "stateFrom", ""), rate, block, err, sizeof err);
    if (!p) { cJSON_AddStringToObject(errors, uid, err[0] ? err : "it didn't start"); continue; }
    Item *x = &c->it[c->n++]; x->p = p; x->on = !cJSON_IsFalse(cJSON_GetObjectItem(it, "on")); x->mix = (float)fmin(1, fmax(0, num(it, "mix", 1))); snprintf(x->uid, sizeof x->uid, "%s", uid); slots[ns++] = x->uid;
  }
  swap(c);
  ph_keep_only(slots, ns);
}
static void on_line(char *line) {
  cJSON *m = cJSON_Parse(line); if (!m) return; const char *a = str(m, "action", ""); char slot[40]; clean(str(m, "uid", ""), slot, sizeof slot);
  if (!strcmp(a, "chain")) { build(cJSON_GetObjectItem(m, "items")); status(); }
  else if (!strcmp(a, "status")) status();
  else if (!strcmp(a, "pluginParams")) { char *j = ph_params_json(slot, (int)num(m, "max", 16)); cJSON *o = cJSON_CreateObject(); cJSON_AddStringToObject(o, "type", "pluginParams"); cJSON_AddStringToObject(o, "uid", str(m, "uid", "")); cJSON *pa = j ? cJSON_Parse(j) : NULL; free(j); cJSON_AddItemToObject(o, "params", pa ? pa : cJSON_CreateArray()); emitJ(o); }
  else if (!strcmp(a, "pluginSet")) ph_set_param(slot, (uint32_t)num(m, "id", 0), num(m, "value", 0));
  else if (!strcmp(a, "pluginRestart")) { ph_forget_slot(slot); build(NULL); status(); }
  else if (!strcmp(a, "pluginSave")) ph_save_all();
  cJSON_Delete(m);
}
static void on_quit(void) {
  ph_save_all();
  if (tloop) PW.tl_stop(tloop);
  if (filter) PW.destroy(filter);
  free_chain(atomic_exchange(&pending, NULL)); free_chain(atomic_exchange(&live, NULL));
  ph_keep_only(NULL, 0);
}

int main(int argc, char **argv) {
  for (int i = 1; i < argc; i++) {
    if (!strcmp(argv[i], "--data") && i + 1 < argc) snprintf(dataDir, sizeof dataDir, "%s", argv[++i]);
    else if (!strcmp(argv[i], "--name") && i + 1 < argc) { clean(argv[++i], nodeName, sizeof nodeName); if (!nodeName[0]) snprintf(nodeName, sizeof nodeName, "cm-community"); }
    else if (!strcmp(argv[i], "--rate") && i + 1 < argc) rate = atof(argv[++i]);
    else if (!strcmp(argv[i], "--block") && i + 1 < argc) block = atoi(argv[++i]);
  }
  if (rate < 8000 || rate > 384000) rate = 48000; if (block < 16 || block > 4096) block = 128;
  int fd = dup(1); proto = fd >= 0 ? fdopen(fd, "w") : stdout; dup2(2, 1);   /* (plugins' and PipeWire's prints go to stderr) */
  ph_init(dataDir, emit);
  if (!pw_start()) { filter = NULL; fprintf(stderr, "cm-pwnode: %s\n", pwError); }
  status();
  return ph_run(on_line, on_quit);
}
