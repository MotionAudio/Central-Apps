/* Two tiny CLAP plugins for testing the plugin host (never shipped):
 *   "Central Test Gain"   an effect: stereo in/out, one parameter (Gain, -24..+24 dB), state = the gain
 *   "Central Test Synth"  an instrument: MIDI / CLAP notes in, a sine per note out, one parameter (Volume 0..1)
 * Build: cc -shared -fPIC -O2 -o central-test.clap test-plugins.c -lm   (Windows: x86_64-w64-mingw32-gcc -shared -o central-test.clap)
 * With -DCENTRAL_TEST_CRASH it crashes as it loads instead (the scan must only lose that one file).
 * The test suite (test-rig.mjs) loads this bundle through the rig and checks gain, notes, parameters and state. */
#include <math.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include "../../vendor/clap/clap.h"

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

typedef struct { clap_plugin_t p; const clap_host_t *host; int synth; double sr; double gainDb, volume; double ph[128]; int on[128]; float vel[128]; } Plug;
#define SELF ((Plug *)plugin->plugin_data)

static const char *fxFeat[] = { CLAP_PLUGIN_FEATURE_AUDIO_EFFECT, CLAP_PLUGIN_FEATURE_UTILITY, NULL };
static const char *synFeat[] = { CLAP_PLUGIN_FEATURE_INSTRUMENT, CLAP_PLUGIN_FEATURE_SYNTHESIZER, NULL };
static const clap_plugin_descriptor_t descFx = { CLAP_VERSION_INIT, "audio.motion.test-gain", "Central Test Gain", "Motion Audio", "", "", "", "1.0", "a gain for the plugin host's tests", fxFeat };
static const clap_plugin_descriptor_t descSyn = { CLAP_VERSION_INIT, "audio.motion.test-synth", "Central Test Synth", "Motion Audio", "", "", "", "1.0", "sines for the plugin host's tests", synFeat };

static bool p_init(const clap_plugin_t *plugin) { (void)plugin; return true; }
static void p_destroy(const clap_plugin_t *plugin) { free(SELF); }
static bool p_activate(const clap_plugin_t *plugin, double sr, uint32_t mn, uint32_t mx) { (void)mn; (void)mx; SELF->sr = sr; return true; }
static void p_deactivate(const clap_plugin_t *plugin) { (void)plugin; }
static bool p_start(const clap_plugin_t *plugin) { (void)plugin; return true; }
static void p_stop(const clap_plugin_t *plugin) { (void)plugin; }
static void p_reset(const clap_plugin_t *plugin) { memset(SELF->on, 0, sizeof SELF->on); }

static void event(Plug *s, const clap_event_header_t *h) {
  if (h->space_id != CLAP_CORE_EVENT_SPACE_ID) return;
  if (h->type == CLAP_EVENT_PARAM_VALUE) { const clap_event_param_value_t *e = (const void *)h; if (e->param_id == 1) s->gainDb = e->value; else if (e->param_id == 2) s->volume = e->value; }
  else if (h->type == CLAP_EVENT_NOTE_ON) { const clap_event_note_t *e = (const void *)h; if (e->key >= 0 && e->key < 128) { s->on[e->key] = 1; s->vel[e->key] = (float)e->velocity; } }
  else if (h->type == CLAP_EVENT_NOTE_OFF) { const clap_event_note_t *e = (const void *)h; if (e->key >= 0 && e->key < 128) s->on[e->key] = 0; }
  else if (h->type == CLAP_EVENT_MIDI) { const clap_event_midi_t *e = (const void *)h; int st = e->data[0] & 0xF0, k = e->data[1] & 127; if (st == 0x90 && e->data[2]) { s->on[k] = 1; s->vel[k] = e->data[2] / 127.0f; } else if (st == 0x80 || st == 0x90) s->on[k] = 0; }
}
static clap_process_status p_process(const clap_plugin_t *plugin, const clap_process_t *pr) {
  Plug *s = SELF; uint32_t n = pr->frames_count, ne = pr->in_events->size(pr->in_events);
  for (uint32_t i = 0; i < ne; i++) event(s, pr->in_events->get(pr->in_events, i));
  float **out = pr->audio_outputs[0].data32;
  if (s->synth) {
    for (uint32_t i = 0; i < n; i++) {
      double v = 0; for (int k = 0; k < 128; k++) if (s->on[k]) { v += sin(s->ph[k]) * s->vel[k] * 0.2; s->ph[k] += 2 * M_PI * 440 * pow(2, (k - 69) / 12.0) / s->sr; if (s->ph[k] > 2 * M_PI) s->ph[k] -= 2 * M_PI; }
      out[0][i] = out[1][i] = (float)(v * s->volume);
    }
  } else {
    float g = (float)pow(10, s->gainDb / 20); float **in = pr->audio_inputs[0].data32;
    for (uint32_t i = 0; i < n; i++) { out[0][i] = in[0][i] * g; out[1][i] = in[1][i] * g; }
  }
  return CLAP_PROCESS_CONTINUE;
}

/* ---- audio ports, note ports */
static uint32_t ap_count(const clap_plugin_t *plugin, bool isIn) { return isIn ? (SELF->synth ? 0 : 1) : 1; }
static bool ap_get(const clap_plugin_t *plugin, uint32_t i, bool isIn, clap_audio_port_info_t *info) {
  (void)plugin; if (i) return false; memset(info, 0, sizeof *info); info->id = isIn ? 0 : 1; snprintf(info->name, sizeof info->name, "%s", isIn ? "In" : "Out");
  info->flags = CLAP_AUDIO_PORT_IS_MAIN; info->channel_count = 2; info->port_type = CLAP_PORT_STEREO; info->in_place_pair = CLAP_INVALID_ID; return true;
}
static const clap_plugin_audio_ports_t audioPorts = { ap_count, ap_get };
static uint32_t np_count(const clap_plugin_t *plugin, bool isIn) { return SELF->synth && isIn ? 1 : 0; }
static bool np_get(const clap_plugin_t *plugin, uint32_t i, bool isIn, clap_note_port_info_t *info) {
  (void)plugin; if (i || !isIn) return false; memset(info, 0, sizeof *info); info->supported_dialects = CLAP_NOTE_DIALECT_CLAP | CLAP_NOTE_DIALECT_MIDI; info->preferred_dialect = CLAP_NOTE_DIALECT_CLAP; snprintf(info->name, sizeof info->name, "Notes"); return true;
}
static const clap_plugin_note_ports_t notePorts = { np_count, np_get };

/* ---- params */
static uint32_t pa_count(const clap_plugin_t *plugin) { (void)plugin; return 1; }
static bool pa_info(const clap_plugin_t *plugin, uint32_t i, clap_param_info_t *info) {
  if (i) return false;
  memset(info, 0, sizeof *info); info->flags = CLAP_PARAM_IS_AUTOMATABLE;
  if (SELF->synth) { info->id = 2; snprintf(info->name, sizeof info->name, "Volume"); info->min_value = 0; info->max_value = 1; info->default_value = 0.8; }
  else { info->id = 1; snprintf(info->name, sizeof info->name, "Gain"); info->min_value = -24; info->max_value = 24; info->default_value = 0; }
  return true;
}
static bool pa_value(const clap_plugin_t *plugin, clap_id id, double *v) { if (id == 1) *v = SELF->gainDb; else if (id == 2) *v = SELF->volume; else return false; return true; }
static bool pa_text(const clap_plugin_t *plugin, clap_id id, double v, char *out, uint32_t n) { (void)plugin; if (id == 1) snprintf(out, n, "%.1f dB", v); else snprintf(out, n, "%d %%", (int)(v * 100 + 0.5)); return true; }
static bool pa_fromtext(const clap_plugin_t *plugin, clap_id id, const char *t, double *v) { (void)plugin; (void)id; *v = atof(t); return true; }
static void pa_flush(const clap_plugin_t *plugin, const clap_input_events_t *in, const clap_output_events_t *out) { (void)out; uint32_t n = in->size(in); for (uint32_t i = 0; i < n; i++) event(SELF, in->get(in, i)); }
static const clap_plugin_params_t params = { pa_count, pa_info, pa_value, pa_text, pa_fromtext, pa_flush };

/* ---- state: "CTP1 <value>" */
static bool st_save(const clap_plugin_t *plugin, const clap_ostream_t *os) { char b[64]; int n = snprintf(b, sizeof b, "CTP1 %.6f", SELF->synth ? SELF->volume : SELF->gainDb); return os->write(os, b, (uint64_t)n) == n; }
static bool st_load(const clap_plugin_t *plugin, const clap_istream_t *is) { char b[64] = { 0 }; int64_t n = is->read(is, b, sizeof b - 1); if (n < 5 || strncmp(b, "CTP1 ", 5)) return false; double v = atof(b + 5); if (SELF->synth) SELF->volume = v; else SELF->gainDb = v; return true; }
static const clap_plugin_state_t state = { st_save, st_load };

static const void *p_ext(const clap_plugin_t *plugin, const char *id) {
  (void)plugin;
  if (!strcmp(id, CLAP_EXT_AUDIO_PORTS)) return &audioPorts;
  if (!strcmp(id, CLAP_EXT_NOTE_PORTS)) return &notePorts;
  if (!strcmp(id, CLAP_EXT_PARAMS)) return &params;
  if (!strcmp(id, CLAP_EXT_STATE)) return &state;
  return NULL;
}
static void p_main(const clap_plugin_t *plugin) { (void)plugin; }

/* ---- factory, entry */
static uint32_t f_count(const clap_plugin_factory_t *f) { (void)f; return 2; }
static const clap_plugin_descriptor_t *f_desc(const clap_plugin_factory_t *f, uint32_t i) { (void)f; return i == 0 ? &descFx : i == 1 ? &descSyn : NULL; }
static const clap_plugin_t *f_create(const clap_plugin_factory_t *f, const clap_host_t *host, const char *id) {
  (void)f; int syn = !strcmp(id, descSyn.id); if (!syn && strcmp(id, descFx.id)) return NULL;
  Plug *s = calloc(1, sizeof *s); s->host = host; s->synth = syn; s->volume = 0.8; s->sr = 48000;
  s->p = (clap_plugin_t){ syn ? &descSyn : &descFx, s, p_init, p_destroy, p_activate, p_deactivate, p_start, p_stop, p_reset, p_process, p_ext, p_main };
  return &s->p;
}
static const clap_plugin_factory_t factory = { f_count, f_desc, f_create };
static bool e_init(const char *path) {
  (void)path;
#ifdef CENTRAL_TEST_CRASH
  abort();
#endif
  return true;
}
static void e_deinit(void) { }
static const void *e_factory(const char *id) { return !strcmp(id, CLAP_PLUGIN_FACTORY_ID) ? &factory : NULL; }
#ifdef _WIN32
__declspec(dllexport)
#else
__attribute__((visibility("default")))
#endif
const clap_plugin_entry_t clap_entry = { CLAP_VERSION_INIT, e_init, e_deinit, e_factory };
