// fmt_clap.cpp - CLAP plugins (https://github.com/free-audio/clap, MIT): effects and instruments, parameters,
// state, the editor (embedded in our window), timers and file descriptors for the editor.
#include <atomic>
#include <cmath>
#include <cstring>
#include <map>
#include <mutex>
#include <thread>
#include "ph.hpp"
#include "../vendor/clap/clap.h"
#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#else
#include <dlfcn.h>
#endif
#ifdef __APPLE__
#include <CoreFoundation/CoreFoundation.h>
#endif

namespace ph {
static std::thread::id mainThread = std::this_thread::get_id();
static thread_local bool onAudio = false;

// ---- the library (one per file; init once, deinit when the last plugin from it closes)
struct ClapLib { void *handle = nullptr; const clap_plugin_entry_t *entry = nullptr; int refs = 0; std::string path;
#ifdef __APPLE__
  CFBundleRef bundle = nullptr;
#endif
};
static std::map<std::string, ClapLib *> libs;
static ClapLib *loadLib(const std::string &path, std::string &err) {
  auto it = libs.find(path); if (it != libs.end()) { it->second->refs++; return it->second; }
  auto *L = new ClapLib(); L->path = path;
#ifdef _WIN32
  int n = MultiByteToWideChar(CP_UTF8, 0, path.c_str(), -1, NULL, 0); std::wstring w(n, 0); MultiByteToWideChar(CP_UTF8, 0, path.c_str(), -1, &w[0], n);
  L->handle = (void *)LoadLibraryW(w.c_str()); if (L->handle) L->entry = (const clap_plugin_entry_t *)(void *)GetProcAddress((HMODULE)L->handle, "clap_entry");
#elif defined(__APPLE__)
  CFURLRef url = CFURLCreateFromFileSystemRepresentation(NULL, (const UInt8 *)path.c_str(), (CFIndex)path.size(), true);
  if (url) { L->bundle = CFBundleCreate(NULL, url); CFRelease(url); }
  if (L->bundle && CFBundleLoadExecutable(L->bundle)) L->entry = (const clap_plugin_entry_t *)CFBundleGetDataPointerForName(L->bundle, CFSTR("clap_entry"));
  if (!L->entry) { if (L->bundle) { CFRelease(L->bundle); L->bundle = nullptr; } L->handle = dlopen(path.c_str(), RTLD_LOCAL | RTLD_NOW); if (L->handle) L->entry = (const clap_plugin_entry_t *)dlsym(L->handle, "clap_entry"); }   // (a plain file, not a bundle)
#else
  L->handle = dlopen(path.c_str(), RTLD_LOCAL | RTLD_NOW); if (L->handle) L->entry = (const clap_plugin_entry_t *)dlsym(L->handle, "clap_entry"); else err = dlerror() ? dlerror() : "";
#endif
  if (!L->entry) { if (err.empty()) err = "not a CLAP plugin (no clap_entry)"; delete L; return nullptr; }
  if (!clap_version_is_compatible(L->entry->clap_version)) { err = "made for a newer CLAP version"; delete L; return nullptr; }
  if (!L->entry->init(path.c_str())) { err = "the plugin did not start"; delete L; return nullptr; }
  L->refs = 1; libs[path] = L; return L;
}
static void unloadLib(ClapLib *L) {
  if (!L || --L->refs > 0) return;
  libs.erase(L->path); L->entry->deinit();
#ifdef _WIN32
  FreeLibrary((HMODULE)L->handle);
#elif defined(__APPLE__)
  if (L->bundle) { CFBundleUnloadExecutable(L->bundle); CFRelease(L->bundle); } else if (L->handle) dlclose(L->handle);
#else
  dlclose(L->handle);
#endif
  delete L;
}
static std::string kindOf(const char *const *features) {
  for (const char *const *f = features; f && *f; f++) if (!strcmp(*f, CLAP_PLUGIN_FEATURE_INSTRUMENT)) return "instrument";
  return "effect";
}

bool scanClap(const std::string &path, std::vector<ClassInfo> &out, std::string &err) {
  ClapLib *L = loadLib(path, err); if (!L) return false;
  auto *fac = (const clap_plugin_factory_t *)L->entry->get_factory(CLAP_PLUGIN_FACTORY_ID);
  if (!fac) { err = "no plugins inside"; unloadLib(L); return false; }
  uint32_t n = fac->get_plugin_count(fac);
  for (uint32_t i = 0; i < n; i++) { auto *d = fac->get_plugin_descriptor(fac, i); if (!d || !d->id) continue; out.push_back({ "clap", d->id, d->name ? d->name : d->id, d->vendor ? d->vendor : "", d->version ? d->version : "", kindOf(d->features) }); }
  unloadLib(L); return true;
}

// ---- event lists (no allocation on the audio thread)
union AnyEvent { clap_event_header_t h; clap_event_note_t note; clap_event_midi_t midi; clap_event_param_value_t param; };
struct InEvents { clap_input_events_t api; AnyEvent ev[1024]; uint32_t n = 0;
  InEvents() { api.ctx = this; api.size = [](const clap_input_events_t *l) { return ((InEvents *)l->ctx)->n; }; api.get = [](const clap_input_events_t *l, uint32_t i) -> const clap_event_header_t * { auto *s = (InEvents *)l->ctx; return i < s->n ? &s->ev[i].h : nullptr; }; }
  AnyEvent *add() { return n < 1024 ? &ev[n++] : nullptr; }
};
struct OutEvents { clap_output_events_t api; std::atomic<bool> *changed;
  OutEvents() { api.ctx = this; api.try_push = [](const clap_output_events_t *l, const clap_event_header_t *e) { auto *s = (OutEvents *)l->ctx; if (e->space_id == CLAP_CORE_EVENT_SPACE_ID && (e->type == CLAP_EVENT_PARAM_VALUE || e->type == CLAP_EVENT_PARAM_GESTURE_END)) s->changed->store(true); return true; }; }
};

struct ClapParam { clap_id id; std::string name; double min, max, def; uint32_t flags; };

struct ClapPlug : Plug {
  ClapLib *lib = nullptr; clap_host_t host{}; const clap_plugin_t *p = nullptr;
  const clap_plugin_params_t *ext_params = nullptr; const clap_plugin_state_t *ext_state = nullptr; const clap_plugin_audio_ports_t *ext_ports = nullptr;
  const clap_plugin_note_ports_t *ext_notes = nullptr; const clap_plugin_gui_t *ext_gui = nullptr; const clap_plugin_latency_t *ext_latency = nullptr;
  const clap_plugin_timer_support_t *ext_timer = nullptr; const clap_plugin_posix_fd_support_t *ext_fd = nullptr;
  bool active = false; std::atomic<bool> processing{ false }, wantCallback{ false }, wantRestart{ false }, changedOnAudio{ false };
  std::atomic<uint64_t> lastProcess{ 0 };
  std::vector<ClapParam> plist; ParamQ q;
  // audio buffers for every port (the main ones carry our stereo)
  std::vector<clap_audio_buffer_t> ins, outs; std::vector<std::vector<float *>> inPtrs, outPtrs; std::vector<std::vector<float>> scratch; std::vector<float> zeros;
  int mainIn = -1, mainOut = -1; uint32_t noteDialects = 0; InEvents inEv; OutEvents outEv; int64_t steady = 0;
  std::map<clap_id, uint64_t> timerMap; bool guiCreated = false; bool guiResizable = false;

  ~ClapPlug() override {
    if (editor) closeEditor();
    for (auto &t : timerMap) removeTimer(t.second); timerMap.clear();
    if (p) { if (active) { if (processing) { onAudio = true; p->stop_processing(p); onAudio = false; } p->deactivate(p); } p->destroy(p); }
    unloadLib(lib);
  }
  static ClapPlug *of(const clap_host_t *h) { return (ClapPlug *)h->host_data; }

  // ---- what we offer the plugin
  static const void *hostExt(const clap_host_t *h, const char *id);
  bool init(const std::string &path, const std::string &cid, std::string &err) {
    lib = loadLib(path, err); if (!lib) return false;
    auto *fac = (const clap_plugin_factory_t *)lib->entry->get_factory(CLAP_PLUGIN_FACTORY_ID); if (!fac) { err = "no plugins inside"; return false; }
    host.clap_version = CLAP_VERSION; host.host_data = this; host.name = "Central"; host.vendor = "Motion Audio"; host.url = "https://motionaudio.github.io/Central-Apps/"; host.version = "9";
    host.get_extension = hostExt;
    host.request_restart = [](const clap_host_t *h) { of(h)->wantRestart = true; };
    host.request_process = [](const clap_host_t *) {};
    host.request_callback = [](const clap_host_t *h) { of(h)->wantCallback = true; wake(); };
    p = fac->create_plugin(fac, &host, cid.c_str()); if (!p) { err = "the plugin could not be created"; return false; }
    if (!p->init(p)) { p->destroy(p); p = nullptr; err = "the plugin did not start"; return false; }
    name = p->desc->name ? p->desc->name : cid; vendor = p->desc->vendor ? p->desc->vendor : ""; instrument = kindOf(p->desc->features) == "instrument";
    ext_params = (const clap_plugin_params_t *)p->get_extension(p, CLAP_EXT_PARAMS); ext_state = (const clap_plugin_state_t *)p->get_extension(p, CLAP_EXT_STATE);
    ext_ports = (const clap_plugin_audio_ports_t *)p->get_extension(p, CLAP_EXT_AUDIO_PORTS); ext_notes = (const clap_plugin_note_ports_t *)p->get_extension(p, CLAP_EXT_NOTE_PORTS);
    ext_gui = (const clap_plugin_gui_t *)p->get_extension(p, CLAP_EXT_GUI); ext_latency = (const clap_plugin_latency_t *)p->get_extension(p, CLAP_EXT_LATENCY);
    ext_timer = (const clap_plugin_timer_support_t *)p->get_extension(p, CLAP_EXT_TIMER_SUPPORT); ext_fd = (const clap_plugin_posix_fd_support_t *)p->get_extension(p, CLAP_EXT_POSIX_FD_SUPPORT);
    outEv.changed = &changedOnAudio;
    readParams(); return true;
  }
  void readParams() {
    plist.clear(); if (!ext_params) return; uint32_t n = ext_params->count(p);
    for (uint32_t i = 0; i < n; i++) { clap_param_info_t in{}; if (!ext_params->get_info(p, i, &in)) continue; plist.push_back({ in.id, in.name, in.min_value, in.max_value, in.default_value, in.flags }); }
  }
  void setupPorts() {
    ins.clear(); outs.clear(); inPtrs.clear(); outPtrs.clear(); scratch.clear(); mainIn = mainOut = -1; zeros.assign((size_t)maxBlock, 0.f);
    auto ports = [&](bool isIn, std::vector<clap_audio_buffer_t> &bufs, std::vector<std::vector<float *>> &ptrs, int &mainIx) {
      uint32_t n = ext_ports ? ext_ports->count(p, isIn) : 0; bufs.resize(n); ptrs.resize(n);
      for (uint32_t i = 0; i < n; i++) {
        clap_audio_port_info_t info{}; ext_ports->get(p, i, isIn, &info); uint32_t ch = info.channel_count ? info.channel_count : 2;
        ptrs[i].resize(ch); for (uint32_t c = 0; c < ch; c++) { scratch.emplace_back((size_t)maxBlock, 0.f); ptrs[i][c] = scratch.back().data(); }
        bufs[i] = clap_audio_buffer_t{ ptrs[i].data(), nullptr, ch, 0, 0 };
        if (mainIx < 0 && (info.flags & CLAP_AUDIO_PORT_IS_MAIN)) mainIx = (int)i;
      }
      if (mainIx < 0 && n) mainIx = 0;
    };
    scratch.reserve(256); ports(true, ins, inPtrs, mainIn); ports(false, outs, outPtrs, mainOut);
    // the scratch vectors must not move: re-point after building
    size_t k = 0; for (auto &pv : inPtrs) for (auto &q2 : pv) q2 = scratch[k++].data(); for (auto &pv : outPtrs) for (auto &q2 : pv) q2 = scratch[k++].data();
    for (size_t i = 0; i < ins.size(); i++) ins[i].data32 = inPtrs[i].data(); for (size_t i = 0; i < outs.size(); i++) outs[i].data32 = outPtrs[i].data();
    noteDialects = 0; if (ext_notes && ext_notes->count(p, true)) { clap_note_port_info_t ni{}; if (ext_notes->get(p, 0, true, &ni)) noteDialects = ni.supported_dialects; if (ins.empty()) instrument = true; }
  }
  bool start(double sr, int mb, std::string &err) override {
    sampleRate = sr; maxBlock = mb; setupPorts();
    if (!p->activate(p, sr, 1, (uint32_t)mb)) { err = "the plugin would not start at " + std::to_string((int)sr) + " Hz"; return false; }
    active = true; return true;
  }
  int latency() override { return ext_latency ? (int)ext_latency->get(p) : 0; }

  void process(const float *inL, const float *inR, float *outL, float *outR, int n, const PhMidi *midi, int nMidi) override {
    onAudio = true;
    if (!processing) { if (!p->start_processing(p)) { onAudio = false; memset(outL, 0, sizeof(float) * (size_t)n); memset(outR, 0, sizeof(float) * (size_t)n); return; } processing = true; }
    inEv.n = 0;
    q.drain([&](const ParamQ::Item &it) { auto *e = inEv.add(); if (!e) return; double v = it.value; for (auto &pp : plist) if (pp.id == it.id) { v = pp.min + (pp.max - pp.min) * it.value; break; }
      e->param = clap_event_param_value_t{ { sizeof(clap_event_param_value_t), 0, CLAP_CORE_EVENT_SPACE_ID, CLAP_EVENT_PARAM_VALUE, 0 }, it.id, nullptr, -1, -1, -1, -1, v }; });
    for (int i = 0; i < nMidi; i++) {
      auto *e = inEv.add(); if (!e) break; const uint8_t *d = midi[i].d; int st = d[0] & 0xF0, ch = d[0] & 15;
      bool noteMsg = st == 0x90 || st == 0x80;
      if (noteMsg && (noteDialects & CLAP_NOTE_DIALECT_CLAP)) { bool on = st == 0x90 && d[2] > 0; e->note = clap_event_note_t{ { sizeof(clap_event_note_t), 0, CLAP_CORE_EVENT_SPACE_ID, (uint16_t)(on ? CLAP_EVENT_NOTE_ON : CLAP_EVENT_NOTE_OFF), 0 }, -1, 0, (int16_t)ch, (int16_t)(d[1] & 127), on ? d[2] / 127.0 : 0.0 }; }
      else { e->midi = clap_event_midi_t{ { sizeof(clap_event_midi_t), 0, CLAP_CORE_EVENT_SPACE_ID, CLAP_EVENT_MIDI, 0 }, 0, { d[0], d[1], d[2] } }; }
    }
    if (mainIn >= 0) { auto &b = inPtrs[(size_t)mainIn]; memcpy(b[0], inL ? inL : zeros.data(), sizeof(float) * (size_t)n); if (b.size() > 1) memcpy(b[1], inR ? inR : inL ? inL : zeros.data(), sizeof(float) * (size_t)n); }
    clap_process_t pr{}; pr.steady_time = steady; pr.frames_count = (uint32_t)n; pr.audio_inputs = ins.data(); pr.audio_inputs_count = (uint32_t)ins.size(); pr.audio_outputs = outs.data(); pr.audio_outputs_count = (uint32_t)outs.size(); pr.in_events = &inEv.api; pr.out_events = &outEv.api;
    clap_process_status s = p->process(p, &pr); steady += n;
    if (s == CLAP_PROCESS_ERROR || mainOut < 0) { memset(outL, 0, sizeof(float) * (size_t)n); memset(outR, 0, sizeof(float) * (size_t)n); }
    else { auto &b = outPtrs[(size_t)mainOut]; memcpy(outL, b[0], sizeof(float) * (size_t)n); memcpy(outR, b.size() > 1 ? b[1] : b[0], sizeof(float) * (size_t)n); }
    lastProcess = nowMs(); onAudio = false;
  }

  std::vector<Param> params(int max) override {
    std::vector<Param> out; if (!ext_params) return out;
    for (auto &pp : plist) {
      if ((int)out.size() >= max) break; if (pp.flags & (CLAP_PARAM_IS_HIDDEN | CLAP_PARAM_IS_READONLY)) continue;
      double v = pp.def; ext_params->get_value(p, pp.id, &v); char txt[256] = ""; ext_params->value_to_text(p, pp.id, v, txt, sizeof txt);
      out.push_back({ pp.id, pp.name, pp.max > pp.min ? (v - pp.min) / (pp.max - pp.min) : 0, txt });
    }
    return out;
  }
  void setParam(uint32_t id, double norm) override {
    q.push(id, norm);
    if (nowMs() - lastProcess.load() > 250 && ext_params) {   // no audio running: hand it over right away
      InEvents ev; double v = norm; for (auto &pp : plist) if (pp.id == id) v = pp.min + (pp.max - pp.min) * norm;
      auto *e = ev.add(); e->param = clap_event_param_value_t{ { sizeof(clap_event_param_value_t), 0, CLAP_CORE_EVENT_SPACE_ID, CLAP_EVENT_PARAM_VALUE, 0 }, id, nullptr, -1, -1, -1, -1, v };
      q.drain([](const ParamQ::Item &) {}); ext_params->flush(p, &ev.api, &outEv.api);
    }
  }
  bool saveState(std::vector<uint8_t> &out) override {
    if (!ext_state) return false; out.clear();
    clap_ostream_t os{ &out, [](const clap_ostream_t *s, const void *buf, uint64_t size) -> int64_t { auto *v = (std::vector<uint8_t> *)s->ctx; v->insert(v->end(), (const uint8_t *)buf, (const uint8_t *)buf + size); return (int64_t)size; } };
    return ext_state->save(p, &os);
  }
  bool loadState(const std::vector<uint8_t> &in) override {
    if (!ext_state) return false; struct R { const std::vector<uint8_t> *v; size_t pos; } r{ &in, 0 };
    clap_istream_t is{ &r, [](const clap_istream_t *s, void *buf, uint64_t size) -> int64_t { auto *rr = (R *)s->ctx; size_t n = std::min<size_t>((size_t)size, rr->v->size() - rr->pos); memcpy(buf, rr->v->data() + rr->pos, n); rr->pos += n; return (int64_t)n; } };
    bool ok = ext_state->load(p, &is); readParams(); return ok;
  }

  // ---- the editor
  const char *api() { const char *w = windowApi(); return !strcmp(w, "x11") ? CLAP_WINDOW_API_X11 : !strcmp(w, "win32") ? CLAP_WINDOW_API_WIN32 : !strcmp(w, "cocoa") ? CLAP_WINDOW_API_COCOA : nullptr; }
  bool hasEditor() override { return ext_gui && api() && ext_gui->is_api_supported(p, api(), false); }
  bool openEditor() override {
    if (!hasEditor()) return false;
    if (!ext_gui->create(p, api(), false)) return false; guiCreated = true;
    uint32_t w = 640, h = 400; ext_gui->get_size(p, &w, &h); guiResizable = ext_gui->can_resize(p);
    editor = makeWindow(name, (int)w, (int)h, guiResizable); if (!editor) { ext_gui->destroy(p); guiCreated = false; return false; }
    clap_window_t win{}; win.api = api();
#ifdef _WIN32
    win.win32 = editor->native();
#elif defined(__APPLE__)
    win.cocoa = editor->native();
#else
    win.x11 = (clap_xwnd)(uintptr_t)editor->native();
#endif
    ext_gui->set_scale(p, 1.0);
    if (!ext_gui->set_parent(p, &win)) { closeEditor(); return false; }
    editor->onResized = [this](int nw, int nh) { if (!guiCreated || !guiResizable) return; uint32_t a = (uint32_t)nw, b = (uint32_t)nh; ext_gui->adjust_size(p, &a, &b); ext_gui->set_size(p, a, b); };
    ext_gui->show(p); editor->show(); return true;
  }
  void closeEditor() override {
    if (guiCreated) { ext_gui->hide(p); ext_gui->destroy(p); guiCreated = false; }
    if (editor) { Window *w = editor; editor = nullptr; delete w; }
  }
  void idle() override {
    if (wantCallback.exchange(false)) p->on_main_thread(p);
    if (changedOnAudio.exchange(false)) dirty = true;
    if (wantRestart.exchange(false) && active && nowMs() - lastProcess.load() > 250) { /* (restart needs the audio thread quiet; the rig rebuilds the chain on its next change) */ }
  }
};

// ---- the host's extensions
static clap_host_log_t hLog{ [](const clap_host_t *, clap_log_severity s, const char *m) { if (s >= CLAP_LOG_WARNING) log("clap: %s", m); } };
static clap_host_thread_check_t hThread{ [](const clap_host_t *) { return std::this_thread::get_id() == mainThread; }, [](const clap_host_t *) { return onAudio; } };
static clap_host_params_t hParams{ [](const clap_host_t *h, clap_param_rescan_flags f) { if (f & (CLAP_PARAM_RESCAN_ALL | CLAP_PARAM_RESCAN_INFO)) ClapPlug::of(h)->readParams(); ClapPlug::of(h)->dirty = true; },
                                   [](const clap_host_t *, clap_id, clap_param_clear_flags) {}, [](const clap_host_t *h) { ClapPlug::of(h)->wantCallback = true; } };
static clap_host_state_t hState{ [](const clap_host_t *h) { ClapPlug::of(h)->dirty = true; } };
static clap_host_latency_t hLatency{ [](const clap_host_t *) {} };
static clap_host_audio_ports_t hPorts{ [](const clap_host_t *, uint32_t) { return false; }, [](const clap_host_t *, uint32_t) {} };
static clap_host_note_ports_t hNotes{ [](const clap_host_t *) -> uint32_t { return CLAP_NOTE_DIALECT_CLAP | CLAP_NOTE_DIALECT_MIDI; }, [](const clap_host_t *, uint32_t) {} };
static clap_host_gui_t hGui{
  [](const clap_host_t *) {},
  [](const clap_host_t *h, uint32_t w, uint32_t hh) { auto *s = ClapPlug::of(h); if (!s->editor) return false; s->editor->resize((int)w, (int)hh); return true; },
  [](const clap_host_t *h) { auto *s = ClapPlug::of(h); if (s->editor) s->editor->show(); return true; },
  [](const clap_host_t *) { return false; },
  [](const clap_host_t *h, bool) { auto *s = ClapPlug::of(h); if (s->editor && s->editor->onClose) { auto f = s->editor->onClose; f(); } } };
static clap_host_timer_support_t hTimer{
  [](const clap_host_t *h, uint32_t ms, clap_id *id) { auto *s = ClapPlug::of(h); static clap_id ids = 1; clap_id my = ids++; *id = my; s->timerMap[my] = addTimer((int)ms, [s, my] { if (s->ext_timer) s->ext_timer->on_timer(s->p, my); }); return true; },
  [](const clap_host_t *h, clap_id id) { auto *s = ClapPlug::of(h); auto it = s->timerMap.find(id); if (it == s->timerMap.end()) return false; removeTimer(it->second); s->timerMap.erase(it); return true; } };
static clap_host_posix_fd_support_t hFd{
  [](const clap_host_t *h, int fd, clap_posix_fd_flags_t fl) { auto *s = ClapPlug::of(h); addFd(fd, [s, fl](int f) { if (s->ext_fd) s->ext_fd->on_fd(s->p, f, fl & (CLAP_POSIX_FD_READ | CLAP_POSIX_FD_ERROR)); }); return true; },
  [](const clap_host_t *h, int fd, clap_posix_fd_flags_t fl) { auto *s = ClapPlug::of(h); addFd(fd, [s, fl](int f) { if (s->ext_fd) s->ext_fd->on_fd(s->p, f, fl & (CLAP_POSIX_FD_READ | CLAP_POSIX_FD_ERROR)); }); return true; },
  [](const clap_host_t *, int fd) { removeFd(fd); return true; } };
const void *ClapPlug::hostExt(const clap_host_t *, const char *id) {
  if (!strcmp(id, CLAP_EXT_LOG)) return &hLog;
  if (!strcmp(id, CLAP_EXT_THREAD_CHECK)) return &hThread;
  if (!strcmp(id, CLAP_EXT_PARAMS)) return &hParams;
  if (!strcmp(id, CLAP_EXT_STATE)) return &hState;
  if (!strcmp(id, CLAP_EXT_LATENCY)) return &hLatency;
  if (!strcmp(id, CLAP_EXT_AUDIO_PORTS)) return &hPorts;
  if (!strcmp(id, CLAP_EXT_NOTE_PORTS)) return &hNotes;
  if (!strcmp(id, CLAP_EXT_GUI)) return &hGui;
  if (!strcmp(id, CLAP_EXT_TIMER_SUPPORT)) return &hTimer;
#if !defined(_WIN32) && !defined(__APPLE__)
  if (!strcmp(id, CLAP_EXT_POSIX_FD_SUPPORT)) return &hFd;
#endif
  return nullptr;
}

Plug *openClap(const std::string &path, const std::string &id, std::string &err) {
  auto *s = new ClapPlug(); if (!s->init(path, id, err)) { delete s; return nullptr; } return s;
}
}  // namespace ph
