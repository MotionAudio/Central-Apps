// fmt_lv2.cpp - LV2 plugins on Linux (lilv for the plugins, suil for their X11 editors; both loaded at run time, so
// the rig runs without them): effects and instruments (MIDI through an atom port), parameters (control ports), the
// worker (sample players load files on it), state, and the editor.
#if defined(PH_LV2) && !defined(_WIN32) && !defined(__APPLE__)
#include <dlfcn.h>
#include <atomic>
#include <cmath>
#include <condition_variable>
#include <cstring>
#include <map>
#include <mutex>
#include <thread>
#include <lilv/lilv.h>
#include <suil/suil.h>
#include <lv2/atom/atom.h>
#include <lv2/atom/util.h>
#include <lv2/buf-size/buf-size.h>
#include <lv2/core/lv2.h>
#include <lv2/data-access/data-access.h>
#include <lv2/instance-access/instance-access.h>
#include <lv2/log/log.h>
#include <lv2/midi/midi.h>
#include <lv2/options/options.h>
#include <lv2/parameters/parameters.h>
#include <lv2/port-props/port-props.h>
#include <lv2/state/state.h>
#include <lv2/ui/ui.h>
#include <lv2/urid/urid.h>
#include <lv2/worker/worker.h>
#include "ph.hpp"

namespace ph {
// ---- lilv and suil, loaded when first wanted
#define LILV_FNS(X) X(lilv_world_new) X(lilv_world_free) X(lilv_world_load_all) X(lilv_world_get_all_plugins) X(lilv_plugins_begin) X(lilv_plugins_next) X(lilv_plugins_is_end) X(lilv_plugins_get) \
  X(lilv_plugins_get_by_uri) X(lilv_new_uri) X(lilv_node_free) X(lilv_node_as_string) X(lilv_node_as_uri) X(lilv_node_as_float) X(lilv_node_is_float) X(lilv_node_is_int) X(lilv_node_as_int) X(lilv_plugin_get_uri) X(lilv_plugin_get_name) \
  X(lilv_plugin_get_author_name) X(lilv_plugin_get_class) X(lilv_plugin_class_get_uri) X(lilv_plugin_get_bundle_uri) X(lilv_plugin_get_num_ports) X(lilv_plugin_get_port_by_index) X(lilv_port_is_a) X(lilv_port_supports_event) \
  X(lilv_port_get_name) X(lilv_port_get_symbol) X(lilv_port_has_property) X(lilv_plugin_get_port_ranges_float) X(lilv_plugin_instantiate) X(lilv_instance_free) X(lilv_node_equals) \
  X(lilv_state_new_from_instance) X(lilv_state_to_string) X(lilv_state_new_from_string) \
  X(lilv_state_restore) X(lilv_state_free) X(lilv_plugin_get_uis) X(lilv_uis_begin) X(lilv_uis_next) X(lilv_uis_is_end) X(lilv_uis_get) X(lilv_ui_is_supported) X(lilv_ui_get_uri) X(lilv_ui_get_bundle_uri) \
  X(lilv_ui_get_binary_uri) X(lilv_uis_free) X(lilv_file_uri_parse) X(lilv_free) X(lilv_port_get_scale_points) X(lilv_scale_points_begin) X(lilv_scale_points_next) X(lilv_scale_points_is_end) X(lilv_scale_points_get) \
  X(lilv_scale_point_get_label) X(lilv_scale_point_get_value) X(lilv_scale_points_free)
#define SUIL_FNS(X) X(suil_host_new) X(suil_host_free) X(suil_instance_new) X(suil_instance_free) X(suil_instance_get_widget) X(suil_instance_port_event) X(suil_instance_extension_data) X(suil_ui_supported) X(suil_init) X(suil_instance_get_handle)
#define DECL(f) decltype(&::f) f = nullptr;
static struct { void *lib = nullptr; bool tried = false; LILV_FNS(DECL) } L;
static struct { void *lib = nullptr; bool tried = false; SUIL_FNS(DECL) } S;
#undef DECL
static bool lilvOk() {
  if (L.lib) return true; if (L.tried) return false; L.tried = true;
  L.lib = dlopen("liblilv-0.so.0", RTLD_NOW | RTLD_LOCAL); if (!L.lib) return false;
#define LOAD(f) *(void **)&L.f = dlsym(L.lib, #f); if (!L.f) { log("lilv: no %s", #f); L.lib = nullptr; return false; }
  LILV_FNS(LOAD)
#undef LOAD
  return true;
}
static bool suilOk() {
  if (S.lib) return true; if (S.tried) return false; S.tried = true;
  S.lib = dlopen("libsuil-0.so.0", RTLD_NOW | RTLD_LOCAL); if (!S.lib) return false;
#define LOAD(f) *(void **)&S.f = dlsym(S.lib, #f); if (!S.f) { S.lib = nullptr; return false; }
  SUIL_FNS(LOAD)
#undef LOAD
  int argc = 0; S.suil_init(&argc, nullptr, SUIL_ARG_NONE); return true;
}

// ---- URIDs (shared by every plugin)
static std::mutex uridLock; static std::map<std::string, LV2_URID> uridOf; static std::vector<std::string> uriOf{ "" };
static LV2_URID mapUri(LV2_URID_Map_Handle, const char *uri) { std::lock_guard<std::mutex> g(uridLock); auto it = uridOf.find(uri); if (it != uridOf.end()) return it->second; uriOf.push_back(uri); return uridOf[uri] = (LV2_URID)(uriOf.size() - 1); }
static const char *unmapUri(LV2_URID_Unmap_Handle, LV2_URID u) { std::lock_guard<std::mutex> g(uridLock); return u < uriOf.size() ? uriOf[u].c_str() : nullptr; }
static LV2_URID_Map mapF{ nullptr, mapUri }; static LV2_URID_Unmap unmapF{ nullptr, unmapUri };
static int logPrintf(LV2_Log_Handle, LV2_URID type, const char *fmt, ...) { va_list a; va_start(a, fmt); if (type == mapUri(nullptr, LV2_LOG__Error)) vfprintf(stderr, fmt, a); va_end(a); return 0; }
static int logVprintf(LV2_Log_Handle, LV2_URID type, const char *fmt, va_list a) { if (type == mapUri(nullptr, LV2_LOG__Error)) vfprintf(stderr, fmt, a); return 0; }
static LV2_Log_Log logF{ nullptr, logPrintf, logVprintf };

static LilvWorld *mainWorld() { static LilvWorld *w = nullptr; if (!w && lilvOk()) { w = L.lilv_world_new(); L.lilv_world_load_all(w); } return w; }
static std::string pathOfUri(const char *uri) { if (!uri) return ""; char *p = L.lilv_file_uri_parse(uri, nullptr); std::string s = p ? p : ""; if (p) L.lilv_free(p); return s; }

bool listLv2(std::vector<ClassInfo> &out, std::vector<std::string> &paths) {
  if (!lilvOk()) return false;
  LilvWorld *w = L.lilv_world_new(); L.lilv_world_load_all(w);
  LilvNode *audio = L.lilv_new_uri(w, LV2_CORE__AudioPort), *input = L.lilv_new_uri(w, LV2_CORE__InputPort), *output = L.lilv_new_uri(w, LV2_CORE__OutputPort), *atomP = L.lilv_new_uri(w, LV2_ATOM__AtomPort), *midiEv = L.lilv_new_uri(w, LV2_MIDI__MidiEvent);
  const LilvPlugins *all = L.lilv_world_get_all_plugins(w);
  for (LilvIter *i = L.lilv_plugins_begin(all); !L.lilv_plugins_is_end(all, i); i = L.lilv_plugins_next(all, i)) {
    const LilvPlugin *p = L.lilv_plugins_get(all, i); int ain = 0, aout = 0; bool midiIn = false;
    for (uint32_t k = 0, n = L.lilv_plugin_get_num_ports(p); k < n; k++) { const LilvPort *pt = L.lilv_plugin_get_port_by_index(p, k); bool in = L.lilv_port_is_a(p, pt, input);
      if (L.lilv_port_is_a(p, pt, audio)) (in ? ain : aout)++; else if (in && L.lilv_port_is_a(p, pt, atomP) && L.lilv_port_supports_event(p, pt, midiEv)) midiIn = true; }
    if (!aout) continue;   // (no sound out: an analyser or a MIDI tool)
    std::string cls = L.lilv_node_as_uri(L.lilv_plugin_class_get_uri(L.lilv_plugin_get_class(p)));
    bool instr = cls == LV2_CORE__InstrumentPlugin || (midiIn && !ain);
    LilvNode *nm = L.lilv_plugin_get_name(p), *au = L.lilv_plugin_get_author_name(p);
    out.push_back({ "lv2", L.lilv_node_as_uri(L.lilv_plugin_get_uri(p)), nm ? L.lilv_node_as_string(nm) : "", au ? L.lilv_node_as_string(au) : "", "", instr ? "instrument" : "effect" });
    paths.push_back(pathOfUri(L.lilv_node_as_uri(L.lilv_plugin_get_bundle_uri(p))));
    if (nm) L.lilv_node_free(nm); if (au) L.lilv_node_free(au);
  }
  for (LilvNode *n : { audio, input, output, atomP, midiEv }) L.lilv_node_free(n);
  L.lilv_world_free(w); return true;
}

// ---- a byte ring between two threads (one writer, one reader)
struct Ring {
  std::vector<uint8_t> b; std::atomic<size_t> w{ 0 }, r{ 0 }; explicit Ring(size_t n) : b(n) {}
  bool write(const void *h, uint32_t hn, const void *d, uint32_t dn) { size_t ww = w.load(), rr = r.load(std::memory_order_acquire), sz = b.size(); if (sz - (ww - rr) < hn + dn) return false; for (uint32_t i = 0; i < hn; i++) b[(ww + i) % sz] = ((const uint8_t *)h)[i]; for (uint32_t i = 0; i < dn; i++) b[(ww + hn + i) % sz] = ((const uint8_t *)d)[i]; w.store(ww + hn + dn, std::memory_order_release); return true; }
  size_t avail() { return w.load(std::memory_order_acquire) - r.load(); }
  void read(void *d, size_t n) { size_t rr = r.load(), sz = b.size(); for (size_t i = 0; i < n; i++) ((uint8_t *)d)[i] = b[(rr + i) % sz]; r.store(rr + n, std::memory_order_release); }
};

struct Lv2Plug : Plug {
  const LilvPlugin *plugin = nullptr; LilvInstance *inst = nullptr;
  enum Kind { AUDIO_IN, AUDIO_OUT, CTL_IN, CTL_OUT, ATOM_IN, ATOM_OUT, OTHER };
  struct Port { Kind kind; std::string sym, name; float min = 0, max = 1, def = 0; bool integer = false, toggled = false, hidden = false; std::vector<std::pair<float, std::string>> scale; };
  std::vector<Port> ports; std::vector<float> ctl; std::vector<float> uiSent; std::vector<std::vector<float>> audioBuf; std::vector<std::vector<uint8_t>> atomBuf;
  std::vector<int> ain, aout; int midiPort = -1; ParamQ q;
  // features
  LV2_Options_Option opts[6]; int32_t minBlock = 1, maxBlockI = 4096, seqSize = 32768; float srF = 48000;
  LV2_Feature fMap{ LV2_URID__map, &mapF }, fUnmap{ LV2_URID__unmap, &unmapF }, fLog{ LV2_LOG__log, &logF }, fOpts{ LV2_OPTIONS__options, opts }, fBounded{ LV2_BUF_SIZE__boundedBlockLength, nullptr }, fWorker{ LV2_WORKER__schedule, nullptr };
  LV2_Worker_Schedule sched{ this, scheduleWork };
  const LV2_Feature *features[8];
  // the worker
  const LV2_Worker_Interface *worker = nullptr; Ring toWorker{ 1 << 16 }, toAudio{ 1 << 16 }; std::thread workerThread; std::mutex wm; std::condition_variable wcv; std::atomic<bool> workerQuit{ false }; bool inRun = false;
  // the editor
  SuilHost *suilHost = nullptr; SuilInstance *ui = nullptr; const LV2UI_Idle_Interface *uiIdle = nullptr; LV2UI_Resize uiResize{ this, [](LV2UI_Feature_Handle h, int w, int hh) { auto *s = (Lv2Plug *)h; if (s->editor) s->editor->resize(w, hh); return 0; } };
  std::string uiUri, uiType, uiBundle, uiBinary; LV2_Extension_Data_Feature extData{ nullptr };

  ~Lv2Plug() override {
    if (editor) closeEditor();
    if (inst) { lilv_instance_deactivate(inst); }
    if (workerThread.joinable()) { workerQuit = true; wcv.notify_all(); workerThread.join(); }
    if (inst) L.lilv_instance_free(inst);
  }
  static LV2_Worker_Status scheduleWork(LV2_Worker_Schedule_Handle h, uint32_t size, const void *data) {
    auto *s = (Lv2Plug *)h;
    if (!s->inRun) { s->worker->work(lilv_instance_get_handle(s->inst), respond, s, size, data); return LV2_WORKER_SUCCESS; }   // (outside run: right away)
    if (!s->toWorker.write(&size, sizeof size, data, size)) return LV2_WORKER_ERR_NO_SPACE; s->wcv.notify_one(); return LV2_WORKER_SUCCESS;
  }
  static LV2_Worker_Status respond(LV2_Worker_Respond_Handle h, uint32_t size, const void *data) { auto *s = (Lv2Plug *)h; return s->toAudio.write(&size, sizeof size, data, size) ? LV2_WORKER_SUCCESS : LV2_WORKER_ERR_NO_SPACE; }
  void workerLoop() {
    std::vector<uint8_t> buf;
    while (!workerQuit) {
      { std::unique_lock<std::mutex> g(wm); wcv.wait_for(g, std::chrono::milliseconds(50), [&] { return workerQuit || toWorker.avail() >= 4; }); }
      while (toWorker.avail() >= 4) { uint32_t n; toWorker.read(&n, 4); buf.resize(n); toWorker.read(buf.data(), n); worker->work(lilv_instance_get_handle(inst), respond, this, n, buf.data()); }
    }
  }

  bool init(const std::string &uri, std::string &err) {
    if (!lilvOk()) { err = "LV2 plugins need lilv (liblilv-0) on this computer"; return false; }
    LilvWorld *w = mainWorld(); LilvNode *u = L.lilv_new_uri(w, uri.c_str()); plugin = L.lilv_plugins_get_by_uri(L.lilv_world_get_all_plugins(w), u); L.lilv_node_free(u);
    if (!plugin) { err = "this LV2 plugin is not installed any more"; return false; }
    LilvNode *nm = L.lilv_plugin_get_name(plugin), *au = L.lilv_plugin_get_author_name(plugin); name = nm ? L.lilv_node_as_string(nm) : uri; vendor = au ? L.lilv_node_as_string(au) : ""; if (nm) L.lilv_node_free(nm); if (au) L.lilv_node_free(au);
    // the ports
    LilvNode *audio = L.lilv_new_uri(w, LV2_CORE__AudioPort), *control = L.lilv_new_uri(w, LV2_CORE__ControlPort), *input = L.lilv_new_uri(w, LV2_CORE__InputPort), *atomP = L.lilv_new_uri(w, LV2_ATOM__AtomPort), *midiEv = L.lilv_new_uri(w, LV2_MIDI__MidiEvent);
    LilvNode *intP = L.lilv_new_uri(w, LV2_CORE__integer), *togP = L.lilv_new_uri(w, LV2_CORE__toggled), *enumP = L.lilv_new_uri(w, LV2_CORE__enumeration), *notOn = L.lilv_new_uri(w, LV2_PORT_PROPS__notOnGUI), *connOpt = L.lilv_new_uri(w, LV2_CORE__connectionOptional);
    uint32_t n = L.lilv_plugin_get_num_ports(plugin); ports.resize(n); ctl.assign(n, 0.f);
    std::vector<float> mins(n), maxs(n), defs(n); L.lilv_plugin_get_port_ranges_float(plugin, mins.data(), maxs.data(), defs.data());
    for (uint32_t k = 0; k < n; k++) {
      const LilvPort *pt = L.lilv_plugin_get_port_by_index(plugin, k); Port &P = ports[k]; bool in = L.lilv_port_is_a(plugin, pt, input);
      P.sym = L.lilv_node_as_string(L.lilv_port_get_symbol(plugin, pt)); LilvNode *pn = L.lilv_port_get_name(plugin, pt); P.name = pn ? L.lilv_node_as_string(pn) : P.sym; if (pn) L.lilv_node_free(pn);
      if (L.lilv_port_is_a(plugin, pt, audio)) { P.kind = in ? AUDIO_IN : AUDIO_OUT; (in ? ain : aout).push_back((int)k); }
      else if (L.lilv_port_is_a(plugin, pt, control)) {
        P.kind = in ? CTL_IN : CTL_OUT; P.min = std::isnan(mins[k]) ? 0 : mins[k]; P.max = std::isnan(maxs[k]) ? 1 : maxs[k]; P.def = std::isnan(defs[k]) ? P.min : defs[k]; ctl[k] = P.def;
        P.integer = L.lilv_port_has_property(plugin, pt, intP) || L.lilv_port_has_property(plugin, pt, enumP); P.toggled = L.lilv_port_has_property(plugin, pt, togP); P.hidden = L.lilv_port_has_property(plugin, pt, notOn);
        if (LilvScalePoints *sp = L.lilv_port_get_scale_points(plugin, pt)) { for (LilvIter *i = L.lilv_scale_points_begin(sp); !L.lilv_scale_points_is_end(sp, i); i = L.lilv_scale_points_next(sp, i)) { const LilvScalePoint *s = L.lilv_scale_points_get(sp, i); P.scale.push_back({ L.lilv_node_as_float(L.lilv_scale_point_get_value(s)), L.lilv_node_as_string(L.lilv_scale_point_get_label(s)) }); } L.lilv_scale_points_free(sp); }
      }
      else if (L.lilv_port_is_a(plugin, pt, atomP)) { P.kind = in ? ATOM_IN : ATOM_OUT; if (in && midiPort < 0 && L.lilv_port_supports_event(plugin, pt, midiEv)) midiPort = (int)k; }
      else P.kind = OTHER;
    }
    for (LilvNode *x : { audio, control, input, atomP, midiEv, intP, togP, enumP, notOn, connOpt }) L.lilv_node_free(x);
    std::string cls = L.lilv_node_as_uri(L.lilv_plugin_class_get_uri(L.lilv_plugin_get_class(plugin)));
    instrument = cls == LV2_CORE__InstrumentPlugin || (midiPort >= 0 && ain.empty());
    return true;
  }
  bool start(double sr, int mb, std::string &err) override {
    sampleRate = sr; maxBlock = mb; srF = (float)sr; maxBlockI = mb;
    opts[0] = { LV2_OPTIONS_INSTANCE, 0, mapUri(nullptr, LV2_BUF_SIZE__minBlockLength), sizeof(int32_t), mapUri(nullptr, LV2_ATOM__Int), &minBlock };
    opts[1] = { LV2_OPTIONS_INSTANCE, 0, mapUri(nullptr, LV2_BUF_SIZE__maxBlockLength), sizeof(int32_t), mapUri(nullptr, LV2_ATOM__Int), &maxBlockI };
    opts[2] = { LV2_OPTIONS_INSTANCE, 0, mapUri(nullptr, LV2_BUF_SIZE__sequenceSize), sizeof(int32_t), mapUri(nullptr, LV2_ATOM__Int), &seqSize };
    opts[3] = { LV2_OPTIONS_INSTANCE, 0, mapUri(nullptr, LV2_PARAMETERS__sampleRate), sizeof(float), mapUri(nullptr, LV2_ATOM__Float), &srF };
    opts[4] = { LV2_OPTIONS_INSTANCE, 0, 0, 0, 0, nullptr };
    fWorker.data = &sched; int k = 0; for (LV2_Feature *f : { &fMap, &fUnmap, &fLog, &fOpts, &fBounded, &fWorker }) features[k++] = f; features[k] = nullptr;
    inst = L.lilv_plugin_instantiate(plugin, sr, features); if (!inst) { err = "the LV2 plugin would not start (it may need something this host does not offer)"; return false; }
    // buffers
    audioBuf.assign(ports.size(), {}); atomBuf.assign(ports.size(), {});
    for (size_t i = 0; i < ports.size(); i++) {
      switch (ports[i].kind) {
        case AUDIO_IN: case AUDIO_OUT: case OTHER: audioBuf[i].assign((size_t)mb, 0.f); lilv_instance_connect_port(inst, (uint32_t)i, audioBuf[i].data()); break;
        case CTL_IN: case CTL_OUT: lilv_instance_connect_port(inst, (uint32_t)i, &ctl[i]); break;
        case ATOM_IN: case ATOM_OUT: atomBuf[i].assign((size_t)seqSize, 0); lilv_instance_connect_port(inst, (uint32_t)i, atomBuf[i].data()); break;
      }
    }
    worker = (const LV2_Worker_Interface *)lilv_instance_get_extension_data(inst, LV2_WORKER__interface);
    if (worker) workerThread = std::thread([this] { workerLoop(); });
    lilv_instance_activate(inst); return true;
  }
  void process(const float *inL, const float *inR, float *outL, float *outR, int n, const PhMidi *midi, int nMidi) override {
    q.drain([&](const ParamQ::Item &it) { if (it.id < ctl.size()) ctl[it.id] = (float)it.value; });
    // inputs
    if (ain.size() == 1) { float *b = audioBuf[(size_t)ain[0]].data(); for (int i = 0; i < n; i++) b[i] = ((inL ? inL[i] : 0) + (inR ? inR[i] : inL ? inL[i] : 0)) * (inR ? 0.5f : 1.f); }
    else if (ain.size() >= 2) {
      float *a = audioBuf[(size_t)ain[0]].data(), *b = audioBuf[(size_t)ain[1]].data(); const float *r = inR ? inR : inL;
      if (inL) memcpy(a, inL, sizeof(float) * (size_t)n); else memset(a, 0, sizeof(float) * (size_t)n);
      if (r) memcpy(b, r, sizeof(float) * (size_t)n); else memset(b, 0, sizeof(float) * (size_t)n);
    }
    for (size_t i = 0; i < ports.size(); i++) {
      if (ports[i].kind == ATOM_IN) {
        auto *seq = (LV2_Atom_Sequence *)atomBuf[i].data(); seq->atom.type = mapUri(nullptr, LV2_ATOM__Sequence); seq->atom.size = sizeof(LV2_Atom_Sequence_Body); seq->body.unit = 0; seq->body.pad = 0;
        if ((int)i == midiPort) for (int k = 0; k < nMidi; k++) {
          uint32_t len = (midi[k].d[0] & 0xF0) == 0xC0 || (midi[k].d[0] & 0xF0) == 0xD0 ? 2 : 3; size_t need = sizeof(LV2_Atom_Event) + 8;
          if (sizeof(LV2_Atom) + seq->atom.size + need > atomBuf[i].size()) break;
          auto *ev = (LV2_Atom_Event *)((uint8_t *)LV2_ATOM_CONTENTS(LV2_Atom_Sequence, seq) + seq->atom.size - sizeof(LV2_Atom_Sequence_Body));
          ev->time.frames = 0; ev->body.type = mapUri(nullptr, LV2_MIDI__MidiEvent); ev->body.size = len; memcpy(ev + 1, midi[k].d, len);
          seq->atom.size += (uint32_t)lv2_atom_pad_size(sizeof(LV2_Atom_Event) + len);
        }
      } else if (ports[i].kind == ATOM_OUT) { auto *a = (LV2_Atom *)atomBuf[i].data(); a->type = 0; a->size = (uint32_t)(atomBuf[i].size() - sizeof(LV2_Atom)); }
    }
    inRun = true; lilv_instance_run(inst, (uint32_t)n); inRun = false;
    if (worker) { while (toAudio.avail() >= 4) { uint32_t sz; toAudio.read(&sz, 4); uint8_t tmp[4096]; if (sz > sizeof tmp) { std::vector<uint8_t> big(sz); toAudio.read(big.data(), sz); worker->work_response(lilv_instance_get_handle(inst), sz, big.data()); } else { toAudio.read(tmp, sz); worker->work_response(lilv_instance_get_handle(inst), sz, tmp); } } if (worker->end_run) worker->end_run(lilv_instance_get_handle(inst)); }
    if (aout.empty()) { memset(outL, 0, sizeof(float) * (size_t)n); memset(outR, 0, sizeof(float) * (size_t)n); return; }
    memcpy(outL, audioBuf[(size_t)aout[0]].data(), sizeof(float) * (size_t)n); memcpy(outR, audioBuf[(size_t)aout[aout.size() > 1 ? 1 : 0]].data(), sizeof(float) * (size_t)n);
  }
  std::string text(const Port &P, float v) {
    for (auto &s : P.scale) if (std::fabs(s.first - v) < 1e-4) return s.second;
    if (P.toggled) return v >= 0.5f ? "on" : "off"; char b[48]; snprintf(b, sizeof b, P.integer ? "%.0f" : std::fabs(v) >= 100 ? "%.0f" : "%.2f", v); return b;
  }
  std::vector<Param> params(int max) override {
    std::vector<Param> out;
    for (size_t i = 0; i < ports.size() && (int)out.size() < max; i++) { const Port &P = ports[i]; if (P.kind != CTL_IN || P.hidden || P.sym == "enable" || P.sym == "enabled" || P.sym == "freewheel" || P.sym == "latency") continue; out.push_back({ (uint32_t)i, P.name, P.max > P.min ? (ctl[i] - P.min) / (P.max - P.min) : 0, text(P, ctl[i]) }); }
    return out;
  }
  void setParam(uint32_t id, double norm) override { if (id >= ports.size() || ports[id].kind != CTL_IN) return; const Port &P = ports[id]; double v = P.min + (P.max - P.min) * norm; if (P.integer || P.toggled) v = std::round(v); q.push(id, v); ctl[id] = (float)v; }
  // state (Turtle, through lilv)
  static const void *getPortValue(const char *sym, void *ud, uint32_t *size, uint32_t *type) { auto *s = (Lv2Plug *)ud; for (size_t i = 0; i < s->ports.size(); i++) if (s->ports[i].kind == CTL_IN && s->ports[i].sym == sym) { *size = sizeof(float); *type = mapUri(nullptr, LV2_ATOM__Float); return &s->ctl[i]; } *size = 0; *type = 0; return nullptr; }
  static void setPortValue(const char *sym, void *ud, const void *val, uint32_t size, uint32_t type) { auto *s = (Lv2Plug *)ud; if (size != sizeof(float) || type != mapUri(nullptr, LV2_ATOM__Float)) return; for (size_t i = 0; i < s->ports.size(); i++) if (s->ports[i].kind == CTL_IN && s->ports[i].sym == sym) s->ctl[i] = *(const float *)val; }
  bool saveState(std::vector<uint8_t> &out) override {
    LilvState *st = L.lilv_state_new_from_instance(plugin, inst, &mapF, nullptr, nullptr, nullptr, nullptr, getPortValue, this, LV2_STATE_IS_POD | LV2_STATE_IS_PORTABLE, features); if (!st) return false;
    char *s = L.lilv_state_to_string(mainWorld(), &mapF, &unmapF, st, "urn:central:state", nullptr); L.lilv_state_free(st); if (!s) return false;
    out.assign(s, s + strlen(s)); L.lilv_free(s); return true;
  }
  bool loadState(const std::vector<uint8_t> &in) override {
    std::string s(in.begin(), in.end()); LilvState *st = L.lilv_state_new_from_string(mainWorld(), &mapF, s.c_str()); if (!st) return false;
    L.lilv_state_restore(st, inst, setPortValue, this, 0, features); L.lilv_state_free(st); return true;
  }
  // the editor (X11 UIs through suil)
  bool findUi() {
    if (!uiUri.empty()) return true; if (!suilOk() || strcmp(windowApi(), "x11")) return false;
    LilvWorld *w = mainWorld(); LilvUIs *uis = L.lilv_plugin_get_uis(plugin); if (!uis) return false;
    LilvNode *host = L.lilv_new_uri(w, LV2_UI__X11UI); bool ok = false;
    for (LilvIter *i = L.lilv_uis_begin(uis); !L.lilv_uis_is_end(uis, i) && !ok; i = L.lilv_uis_next(uis, i)) {
      const LilvUI *u = L.lilv_uis_get(uis, i); const LilvNode *type = nullptr;
      if (L.lilv_ui_is_supported(u, S.suil_ui_supported, host, &type) && type && L.lilv_node_equals(type, host)) {   // (native X11 UIs: GTK / Qt ones need those toolkits' loops)
        uiUri = L.lilv_node_as_uri(L.lilv_ui_get_uri(u)); uiType = L.lilv_node_as_uri(type); uiBundle = pathOfUri(L.lilv_node_as_uri(L.lilv_ui_get_bundle_uri(u))); uiBinary = pathOfUri(L.lilv_node_as_uri(L.lilv_ui_get_binary_uri(u))); ok = true;
      }
    }
    L.lilv_node_free(host); L.lilv_uis_free(uis); return ok;
  }
  bool hasEditor() override { return findUi(); }
  bool openEditor() override {
    if (!findUi()) return false;
    editor = makeWindow(name, 640, 400, false); if (!editor) return false;
    suilHost = S.suil_host_new([](SuilController c, uint32_t port, uint32_t size, uint32_t proto, const void *buf) { auto *s = (Lv2Plug *)c; if (proto == 0 && size == sizeof(float) && port < s->ports.size() && s->ports[port].kind == CTL_IN) { float v = *(const float *)buf; s->q.push(port, v); s->ctl[port] = v; if (port < s->uiSent.size()) s->uiSent[port] = v; s->dirty = true; } },
                               nullptr, nullptr, nullptr);
    LV2_Feature parent{ LV2_UI__parent, editor->native() }, resize{ LV2_UI__resize, &uiResize }, ia{ LV2_INSTANCE_ACCESS_URI, lilv_instance_get_handle(inst) };
    extData.data_access = inst->lv2_descriptor->extension_data; LV2_Feature da{ LV2_DATA_ACCESS_URI, &extData };
    const LV2_Feature *uf[] = { &fMap, &fUnmap, &fLog, &parent, &resize, &ia, &da, &fOpts, nullptr };
    ui = S.suil_instance_new(suilHost, this, LV2_UI__X11UI, L.lilv_node_as_uri(L.lilv_plugin_get_uri(plugin)), uiUri.c_str(), uiType.c_str(), uiBundle.c_str(), uiBinary.c_str(), uf);
    if (!ui) { closeEditor(); return false; }
    uiIdle = (const LV2UI_Idle_Interface *)S.suil_instance_extension_data(ui, LV2_UI__idleInterface);
    uiSent.assign(ports.size(), NAN); sendToUi();
    editor->show(); editor->fitChild(); fitTries = 10; return true;
  }
  void sendToUi() { if (!ui) return; for (size_t i = 0; i < ports.size(); i++) if ((ports[i].kind == CTL_IN || ports[i].kind == CTL_OUT) && !(uiSent[i] == ctl[i])) { uiSent[i] = ctl[i]; float v = ctl[i]; S.suil_instance_port_event(ui, (uint32_t)i, sizeof(float), 0, &v); } }
  void closeEditor() override {
    if (ui) { S.suil_instance_free(ui); ui = nullptr; uiIdle = nullptr; }
    if (suilHost) { S.suil_host_free(suilHost); suilHost = nullptr; }
    if (editor) { Window *w = editor; editor = nullptr; delete w; }
  }
  int fitTries = 0;
  void idle() override { if (!ui) return; if (fitTries > 0 && editor && (fitTries-- % 3) == 0) editor->fitChild(); sendToUi(); if (uiIdle && uiIdle->idle(S.suil_instance_get_handle(ui))) { /* the UI closed itself */ auto f = editor ? editor->onClose : nullptr; if (f) f(); } }
};

Plug *openLv2(const std::string &uri, std::string &err) { auto *p = new Lv2Plug(); if (!p->init(uri, err)) { delete p; return nullptr; } return p; }
}  // namespace ph
#endif
