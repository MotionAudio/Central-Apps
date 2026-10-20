// fmt_vst3.cpp - VST3 plugins (Steinberg VST3 SDK interfaces, MIT since 3.8): effects and instruments, the
// processor + controller pair, parameters (from the app and from the plugin's own window), MIDI notes and the
// controllers the plugin maps, state, and the editor (embedded in our window; on Linux with our run loop).
// Only the SDK's interface headers are used (vendor/vst3sdk); the host classes are the small ones below.
#include <atomic>
#include <cstring>
#include <map>
#include <mutex>
#include <vector>
#include "ph.hpp"
#include "pluginterfaces/base/ibstream.h"
#include "pluginterfaces/base/ipluginbase.h"
#include "pluginterfaces/gui/iplugview.h"
#include "pluginterfaces/vst/ivstaudioprocessor.h"
#include "pluginterfaces/vst/ivstcomponent.h"
#include "pluginterfaces/vst/ivsteditcontroller.h"
#include "pluginterfaces/vst/ivstevents.h"
#include "pluginterfaces/vst/ivsthostapplication.h"
#include "pluginterfaces/vst/ivstmessage.h"
#include "pluginterfaces/vst/ivstattributes.h"
#include "pluginterfaces/vst/ivstmidicontrollers.h"
#include "pluginterfaces/vst/ivstparameterchanges.h"
#include "pluginterfaces/vst/ivstprocesscontext.h"
#include "pluginterfaces/vst/ivstunits.h"
#include "pluginterfaces/vst/vstspeaker.h"
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

using namespace Steinberg;
using namespace Steinberg::Vst;

namespace ph {
// ---- UTF-16 (VST3 strings) <-> UTF-8
static std::string u8(const char16 *s, size_t max = 128) {
  std::string o; for (size_t i = 0; i < max && s[i]; i++) {
    uint32_t c = (uint16_t)s[i]; if (c >= 0xD800 && c < 0xDC00 && i + 1 < max && s[i + 1]) { uint32_t d = (uint16_t)s[i + 1]; if (d >= 0xDC00 && d < 0xE000) { c = 0x10000 + ((c - 0xD800) << 10) + (d - 0xDC00); i++; } }
    if (c < 0x80) o += (char)c; else if (c < 0x800) { o += (char)(0xC0 | (c >> 6)); o += (char)(0x80 | (c & 63)); } else if (c < 0x10000) { o += (char)(0xE0 | (c >> 12)); o += (char)(0x80 | ((c >> 6) & 63)); o += (char)(0x80 | (c & 63)); } else { o += (char)(0xF0 | (c >> 18)); o += (char)(0x80 | ((c >> 12) & 63)); o += (char)(0x80 | ((c >> 6) & 63)); o += (char)(0x80 | (c & 63)); }
  }
  return o;
}
static void toU16(const char *s, char16 *out, size_t max) { size_t k = 0; for (; *s && k + 1 < max; s++) out[k++] = (char16)(unsigned char)*s; out[k] = 0; }
static std::string uidHex(const TUID t) { static const char *h = "0123456789ABCDEF"; std::string o; for (int i = 0; i < 16; i++) { o += h[(uint8_t)t[i] >> 4]; o += h[(uint8_t)t[i] & 15]; } return o; }
static bool hexUid(const std::string &s, TUID out) { if (s.size() != 32) return false; for (int i = 0; i < 16; i++) { auto v = [](char c) { return c >= '0' && c <= '9' ? c - '0' : c >= 'A' && c <= 'F' ? c - 'A' + 10 : c >= 'a' && c <= 'f' ? c - 'a' + 10 : -1; }; int a = v(s[2 * i]), b = v(s[2 * i + 1]); if (a < 0 || b < 0) return false; out[i] = (char)(a * 16 + b); } return true; }

// ---- a tiny COM-style base: reference counting and queryInterface over a list of interfaces
#define PH_REFCOUNT \
  std::atomic<uint32> refc{ 1 }; \
  uint32 PLUGIN_API addRef() override { return ++refc; } \
  uint32 PLUGIN_API release() override { uint32 r = --refc; if (!r) delete this; return r; }
#define PH_QI_BEGIN tresult PLUGIN_API queryInterface(const TUID _iid, void **obj) override {
#define PH_QI(I) if (FUnknownPrivate::iidEqual(_iid, I::iid)) { addRef(); *obj = static_cast<I *>(this); return kResultOk; }
#define PH_QI_END if (FUnknownPrivate::iidEqual(_iid, FUnknown::iid)) { addRef(); *obj = this; return kResultOk; } *obj = nullptr; return kNoInterface; }

// ---- streams
struct MemStream final : IBStream, ISizeableStream {
  std::vector<uint8_t> d; int64 pos = 0; PH_REFCOUNT
  PH_QI_BEGIN PH_QI(IBStream) PH_QI(ISizeableStream) PH_QI_END
  tresult PLUGIN_API read(void *buf, int32 n, int32 *got) override { int64 k = std::max<int64>(0, std::min<int64>(n, (int64)d.size() - pos)); if (k) memcpy(buf, d.data() + pos, (size_t)k); pos += k; if (got) *got = (int32)k; return kResultOk; }
  tresult PLUGIN_API write(void *buf, int32 n, int32 *put) override { if (n < 0) return kInvalidArgument; if (pos + n > (int64)d.size()) d.resize((size_t)(pos + n)); memcpy(d.data() + pos, buf, (size_t)n); pos += n; if (put) *put = n; return kResultOk; }
  tresult PLUGIN_API seek(int64 p, int32 mode, int64 *res) override { int64 np = mode == kIBSeekSet ? p : mode == kIBSeekCur ? pos + p : (int64)d.size() + p; if (np < 0) return kResultFalse; pos = np; if (res) *res = pos; return kResultOk; }
  tresult PLUGIN_API tell(int64 *p) override { if (p) *p = pos; return kResultOk; }
  tresult PLUGIN_API getStreamSize(int64 &s) override { s = (int64)d.size(); return kResultOk; }
  tresult PLUGIN_API setStreamSize(int64 s) override { d.resize((size_t)s); return kResultOk; }
};

// ---- messages between the processor and its controller (plugins make them through the host)
struct HostAttributes final : IAttributeList {
  std::map<std::string, int64> ints; std::map<std::string, double> floats; std::map<std::string, std::vector<char16>> strs; std::map<std::string, std::vector<uint8_t>> bins; PH_REFCOUNT
  PH_QI_BEGIN PH_QI(IAttributeList) PH_QI_END
  tresult PLUGIN_API setInt(AttrID id, int64 v) override { ints[id] = v; return kResultOk; }
  tresult PLUGIN_API getInt(AttrID id, int64 &v) override { auto it = ints.find(id); if (it == ints.end()) return kResultFalse; v = it->second; return kResultOk; }
  tresult PLUGIN_API setFloat(AttrID id, double v) override { floats[id] = v; return kResultOk; }
  tresult PLUGIN_API getFloat(AttrID id, double &v) override { auto it = floats.find(id); if (it == floats.end()) return kResultFalse; v = it->second; return kResultOk; }
  tresult PLUGIN_API setString(AttrID id, const TChar *s) override { std::vector<char16> v; while (s && *s) v.push_back(*s++); v.push_back(0); strs[id] = v; return kResultOk; }
  tresult PLUGIN_API getString(AttrID id, TChar *s, uint32 bytes) override { auto it = strs.find(id); if (it == strs.end() || bytes < 2) return kResultFalse; size_t n = std::min<size_t>(it->second.size(), bytes / 2); memcpy(s, it->second.data(), n * 2); s[n - 1] = 0; return kResultOk; }
  tresult PLUGIN_API setBinary(AttrID id, const void *data, uint32 n) override { bins[id].assign((const uint8_t *)data, (const uint8_t *)data + n); return kResultOk; }
  tresult PLUGIN_API getBinary(AttrID id, const void *&data, uint32 &n) override { auto it = bins.find(id); if (it == bins.end()) return kResultFalse; data = it->second.data(); n = (uint32)it->second.size(); return kResultOk; }
};
struct HostMessage final : IMessage {
  std::string id; HostAttributes *attrs = new HostAttributes(); PH_REFCOUNT
  ~HostMessage() { attrs->release(); }
  PH_QI_BEGIN PH_QI(IMessage) PH_QI_END
  FIDString PLUGIN_API getMessageID() override { return id.c_str(); }
  void PLUGIN_API setMessageID(FIDString m) override { id = m ? m : ""; }
  IAttributeList *PLUGIN_API getAttributes() override { return attrs; }
};
struct HostApp final : IHostApplication {
  PH_REFCOUNT
  PH_QI_BEGIN PH_QI(IHostApplication) PH_QI_END
  tresult PLUGIN_API getName(String128 name) override { toU16("Central", name, 128); return kResultOk; }
  tresult PLUGIN_API createInstance(TUID cid, TUID _iid, void **obj) override {
    if (FUnknownPrivate::iidEqual(cid, IMessage::iid) && FUnknownPrivate::iidEqual(_iid, IMessage::iid)) { *obj = static_cast<IMessage *>(new HostMessage()); return kResultOk; }
    if (FUnknownPrivate::iidEqual(cid, IAttributeList::iid) && FUnknownPrivate::iidEqual(_iid, IAttributeList::iid)) { *obj = static_cast<IAttributeList *>(new HostAttributes()); return kResultOk; }
    *obj = nullptr; return kResultFalse;
  }
};
static HostApp *hostApp() { static HostApp *h = new HostApp(); return h; }

// ---- parameter changes and events for process() (fixed sizes: nothing is allocated on the audio thread)
struct ParamQueue : IParamValueQueue {
  ParamID id = 0; int32 n = 0; int32 offs[16]; ParamValue vals[16];
  tresult PLUGIN_API queryInterface(const TUID _iid, void **obj) override { if (FUnknownPrivate::iidEqual(_iid, IParamValueQueue::iid) || FUnknownPrivate::iidEqual(_iid, FUnknown::iid)) { *obj = this; return kResultOk; } *obj = nullptr; return kNoInterface; }
  uint32 PLUGIN_API addRef() override { return 1; } uint32 PLUGIN_API release() override { return 1; }
  ParamID PLUGIN_API getParameterId() override { return id; }
  int32 PLUGIN_API getPointCount() override { return n; }
  tresult PLUGIN_API getPoint(int32 i, int32 &o, ParamValue &v) override { if (i < 0 || i >= n) return kResultFalse; o = offs[i]; v = vals[i]; return kResultOk; }
  tresult PLUGIN_API addPoint(int32 o, ParamValue v, int32 &i) override { if (n > 0 && offs[n - 1] == o) { vals[n - 1] = v; i = n - 1; return kResultOk; } if (n >= 16) { vals[15] = v; i = 15; return kResultOk; } offs[n] = o; vals[n] = v; i = n++; return kResultOk; }
};
struct ParamChanges : IParameterChanges {
  ParamQueue q[128]; int32 n = 0;
  tresult PLUGIN_API queryInterface(const TUID _iid, void **obj) override { if (FUnknownPrivate::iidEqual(_iid, IParameterChanges::iid) || FUnknownPrivate::iidEqual(_iid, FUnknown::iid)) { *obj = this; return kResultOk; } *obj = nullptr; return kNoInterface; }
  uint32 PLUGIN_API addRef() override { return 1; } uint32 PLUGIN_API release() override { return 1; }
  int32 PLUGIN_API getParameterCount() override { return n; }
  IParamValueQueue *PLUGIN_API getParameterData(int32 i) override { return i >= 0 && i < n ? &q[i] : nullptr; }
  IParamValueQueue *PLUGIN_API addParameterData(const ParamID &id, int32 &i) override { for (int32 k = 0; k < n; k++) if (q[k].id == id) { i = k; return &q[k]; } if (n >= 128) return nullptr; q[n].id = id; q[n].n = 0; i = n; return &q[n++]; }
  void clear() { n = 0; }
  void set(ParamID id, double v) { int32 i, j; auto *qq = addParameterData(id, i); if (qq) qq->addPoint(0, v, j); }
};
struct Events : IEventList {
  Event ev[512]; int32 n = 0;
  tresult PLUGIN_API queryInterface(const TUID _iid, void **obj) override { if (FUnknownPrivate::iidEqual(_iid, IEventList::iid) || FUnknownPrivate::iidEqual(_iid, FUnknown::iid)) { *obj = this; return kResultOk; } *obj = nullptr; return kNoInterface; }
  uint32 PLUGIN_API addRef() override { return 1; } uint32 PLUGIN_API release() override { return 1; }
  int32 PLUGIN_API getEventCount() override { return n; }
  tresult PLUGIN_API getEvent(int32 i, Event &e) override { if (i < 0 || i >= n) return kResultFalse; e = ev[i]; return kResultOk; }
  tresult PLUGIN_API addEvent(Event &e) override { if (n >= 512) return kResultFalse; ev[n++] = e; return kResultOk; }
};

// ---- the module (one per file: entry once, exit when the last plugin from it closes)
struct Vst3Module { void *handle = nullptr; IPluginFactory *factory = nullptr; int refs = 0; std::string path; bool (*exitFn)() = nullptr;
#ifdef __APPLE__
  CFBundleRef bundle = nullptr;
#endif
};
static std::map<std::string, Vst3Module *> modules;
static std::string binaryOf(const std::string &path) {
#if defined(_WIN32)
  DWORD a = GetFileAttributesA(path.c_str()); std::string b = baseName(path);
  if (a != INVALID_FILE_ATTRIBUTES && (a & FILE_ATTRIBUTE_DIRECTORY)) return path + "\\Contents\\x86_64-win\\" + b + ".vst3";
  return path;
#elif defined(__APPLE__)
  return path;
#else
#if defined(__aarch64__)
  const char *arch = "aarch64-linux";
#else
  const char *arch = "x86_64-linux";
#endif
  return path + "/Contents/" + arch + "/" + baseName(path) + ".so";
#endif
}
typedef IPluginFactory *(PLUGIN_API *GetFactoryProc)();
static Vst3Module *loadModule(const std::string &path, std::string &err) {
  auto it = modules.find(path); if (it != modules.end()) { it->second->refs++; return it->second; }
  auto *M = new Vst3Module(); M->path = path; GetFactoryProc gf = nullptr; std::string bin = binaryOf(path);
#ifdef _WIN32
  int n = MultiByteToWideChar(CP_UTF8, 0, bin.c_str(), -1, NULL, 0); std::wstring w(n, 0); MultiByteToWideChar(CP_UTF8, 0, bin.c_str(), -1, &w[0], n);
  M->handle = (void *)LoadLibraryW(w.c_str()); if (!M->handle) { err = "the plugin's file did not load (error " + std::to_string(GetLastError()) + ")"; delete M; return nullptr; }
  auto init = (bool (*)())(void *)GetProcAddress((HMODULE)M->handle, "InitDll"); M->exitFn = (bool (*)())(void *)GetProcAddress((HMODULE)M->handle, "ExitDll");
  if (init && !init()) { err = "the plugin did not start"; FreeLibrary((HMODULE)M->handle); delete M; return nullptr; }
  gf = (GetFactoryProc)(void *)GetProcAddress((HMODULE)M->handle, "GetPluginFactory");
#elif defined(__APPLE__)
  CFURLRef url = CFURLCreateFromFileSystemRepresentation(NULL, (const UInt8 *)path.c_str(), (CFIndex)path.size(), true);
  if (url) { M->bundle = CFBundleCreate(NULL, url); CFRelease(url); }
  if (!M->bundle || !CFBundleLoadExecutable(M->bundle)) { err = "the plugin's bundle did not load"; if (M->bundle) CFRelease(M->bundle); delete M; return nullptr; }
  auto entry = (bool (*)(CFBundleRef))CFBundleGetFunctionPointerForName(M->bundle, CFSTR("bundleEntry")); M->exitFn = (bool (*)())CFBundleGetFunctionPointerForName(M->bundle, CFSTR("bundleExit"));
  if (entry && !entry(M->bundle)) { err = "the plugin did not start"; CFBundleUnloadExecutable(M->bundle); CFRelease(M->bundle); delete M; return nullptr; }
  gf = (GetFactoryProc)CFBundleGetFunctionPointerForName(M->bundle, CFSTR("GetPluginFactory"));
#else
  M->handle = dlopen(bin.c_str(), RTLD_LOCAL | RTLD_NOW); if (!M->handle) { const char *e = dlerror(); err = e ? e : "the plugin's file did not load"; delete M; return nullptr; }
  auto entry = (bool (*)(void *))dlsym(M->handle, "ModuleEntry"); M->exitFn = (bool (*)())dlsym(M->handle, "ModuleExit");
  if (entry && !entry(M->handle)) { err = "the plugin did not start"; dlclose(M->handle); delete M; return nullptr; }
  gf = (GetFactoryProc)dlsym(M->handle, "GetPluginFactory");
#endif
  if (gf) M->factory = gf();
  if (!M->factory) { err = "not a VST3 plugin (no factory)"; if (M->exitFn) M->exitFn();
#ifdef _WIN32
    FreeLibrary((HMODULE)M->handle);
#elif defined(__APPLE__)
    CFBundleUnloadExecutable(M->bundle); CFRelease(M->bundle);
#else
    dlclose(M->handle);
#endif
    delete M; return nullptr; }
  M->refs = 1; modules[path] = M; return M;
}
static void unloadModule(Vst3Module *M) {
  if (!M || --M->refs > 0) return;
  modules.erase(M->path); M->factory->release(); if (M->exitFn) M->exitFn();
#ifdef _WIN32
  FreeLibrary((HMODULE)M->handle);
#elif defined(__APPLE__)
  CFBundleUnloadExecutable(M->bundle); CFRelease(M->bundle);
#else
  dlclose(M->handle);
#endif
  delete M;
}

bool scanVst3(const std::string &path, std::vector<ClassInfo> &out, std::string &err) {
  Vst3Module *M = loadModule(path, err); if (!M) return false;
  PFactoryInfo fi; std::string fvendor; if (M->factory->getFactoryInfo(&fi) == kResultOk) fvendor = fi.vendor;
  IPluginFactory2 *f2 = nullptr; M->factory->queryInterface(IPluginFactory2::iid, (void **)&f2);
  int32 n = M->factory->countClasses();
  for (int32 i = 0; i < n; i++) {
    PClassInfo ci; if (M->factory->getClassInfo(i, &ci) != kResultOk || strcmp(ci.category, kVstAudioEffectClass)) continue;
    ClassInfo c; c.format = "vst3"; c.id = uidHex(ci.cid); c.name = ci.name; c.vendor = fvendor; c.kind = "effect";
    PClassInfo2 c2; if (f2 && f2->getClassInfo2(i, &c2) == kResultOk) { if (c2.vendor[0]) c.vendor = c2.vendor; c.version = c2.version; if (strstr(c2.subCategories, "Instrument")) c.kind = "instrument"; }
    out.push_back(c);
  }
  if (f2) f2->release(); unloadModule(M); return true;
}

// ---- a running plugin
struct Vst3Plug;
struct Handler final : IComponentHandler, IComponentHandler2 {
  Vst3Plug *owner; explicit Handler(Vst3Plug *o) : owner(o) {} PH_REFCOUNT
  PH_QI_BEGIN PH_QI(IComponentHandler) PH_QI(IComponentHandler2) PH_QI_END
  tresult PLUGIN_API beginEdit(ParamID) override { return kResultOk; }
  tresult PLUGIN_API performEdit(ParamID id, ParamValue v) override;
  tresult PLUGIN_API endEdit(ParamID) override { return kResultOk; }
  tresult PLUGIN_API restartComponent(int32 flags) override;
  tresult PLUGIN_API setDirty(TBool) override;
  tresult PLUGIN_API requestOpenEditor(FIDString) override { return kResultFalse; }
  tresult PLUGIN_API startGroupEdit() override { return kResultOk; }
  tresult PLUGIN_API finishGroupEdit() override { return kResultOk; }
};
struct Frame final : IPlugFrame
#if !defined(_WIN32) && !defined(__APPLE__)
  , Linux::IRunLoop
#endif
{
  Vst3Plug *owner; explicit Frame(Vst3Plug *o) : owner(o) {} PH_REFCOUNT
  tresult PLUGIN_API queryInterface(const TUID _iid, void **obj) override {
    if (FUnknownPrivate::iidEqual(_iid, IPlugFrame::iid) || FUnknownPrivate::iidEqual(_iid, FUnknown::iid)) { addRef(); *obj = static_cast<IPlugFrame *>(this); return kResultOk; }
#if !defined(_WIN32) && !defined(__APPLE__)
    if (FUnknownPrivate::iidEqual(_iid, Linux::IRunLoop::iid)) { addRef(); *obj = static_cast<Linux::IRunLoop *>(this); return kResultOk; }
#endif
    *obj = nullptr; return kNoInterface;
  }
  tresult PLUGIN_API resizeView(IPlugView *view, ViewRect *r) override;
#if !defined(_WIN32) && !defined(__APPLE__)
  std::multimap<Linux::IEventHandler *, int> fdsOf; std::map<Linux::ITimerHandler *, uint64_t> timersOf;
  tresult PLUGIN_API registerEventHandler(Linux::IEventHandler *h, Linux::FileDescriptor fd) override { fdsOf.insert({ h, fd }); addFd(fd, [h](int f) { h->onFDIsSet(f); }); return kResultOk; }
  tresult PLUGIN_API unregisterEventHandler(Linux::IEventHandler *h) override { auto r = fdsOf.equal_range(h); for (auto it = r.first; it != r.second; ++it) removeFd(it->second); fdsOf.erase(h); return kResultOk; }
  tresult PLUGIN_API registerTimer(Linux::ITimerHandler *h, Linux::TimerInterval ms) override { auto it = timersOf.find(h); if (it != timersOf.end()) removeTimer(it->second); timersOf[h] = addTimer((int)ms, [h] { h->onTimer(); }); return kResultOk; }
  tresult PLUGIN_API unregisterTimer(Linux::ITimerHandler *h) override { auto it = timersOf.find(h); if (it != timersOf.end()) { removeTimer(it->second); timersOf.erase(it); } return kResultOk; }
  void clearAll() { for (auto &f : fdsOf) removeFd(f.second); fdsOf.clear(); for (auto &t : timersOf) removeTimer(t.second); timersOf.clear(); }
#else
  void clearAll() {}
#endif
};

struct Vst3Plug : Plug {
  Vst3Plug() { for (auto &c : ccMap) c = kNoParamId; }
  Vst3Module *mod = nullptr; IComponent *comp = nullptr; IEditController *ctrl = nullptr; IAudioProcessor *proc = nullptr; IMidiMapping *midiMap = nullptr;
  IConnectionPoint *cpComp = nullptr, *cpCtrl = nullptr; bool sepCtrl = false, active = false, procOn = false; Handler *handler = nullptr; Frame *frame = nullptr; IPlugView *view = nullptr;
  ParamQ fromApp, fromGui; ParamQ toCtrl;   // (toCtrl: changes the processor reports, for the controller on the main thread)
  ParamChanges inChanges, outChanges; Events events; ProcessContext ctx{};
  std::vector<AudioBusBuffers> inBus, outBus; std::vector<std::vector<float *>> inCh, outCh; std::vector<std::vector<float>> mem; std::vector<float> zeros;
  int mainIn = -1, mainOut = -1; ParamID ccMap[130];   /* MIDI controller -> the parameter the plugin maps it to (kNoParamId: none) */ std::atomic<bool> dirtyAudio{ false }, restart{ false };
  ~Vst3Plug() override {
    if (editor) closeEditor();
    if (proc && procOn) proc->setProcessing(false);
    if (comp && active) comp->setActive(false);
    if (cpComp && cpCtrl) { cpComp->disconnect(cpCtrl); cpCtrl->disconnect(cpComp); }
    if (cpComp) cpComp->release(); if (cpCtrl) cpCtrl->release();
    if (midiMap) midiMap->release();
    if (ctrl) { ctrl->setComponentHandler(nullptr); ctrl->terminate(); ctrl->release(); }
    if (proc) proc->release();
    if (comp) { comp->terminate(); comp->release(); }
    if (handler) handler->release(); if (frame) frame->release();
    unloadModule(mod);
  }
  bool init(const std::string &path, const std::string &cidHex, std::string &err) {
    TUID cid; if (!hexUid(cidHex, cid)) { err = "not a VST3 class id"; return false; }
    mod = loadModule(path, err); if (!mod) return false;
    // what it is
    IPluginFactory2 *f2 = nullptr; mod->factory->queryInterface(IPluginFactory2::iid, (void **)&f2);
    for (int32 i = 0, n = mod->factory->countClasses(); i < n; i++) {
      PClassInfo ci; if (mod->factory->getClassInfo(i, &ci) != kResultOk || memcmp(ci.cid, cid, 16)) continue; name = ci.name;
      PClassInfo2 c2; if (f2 && f2->getClassInfo2(i, &c2) == kResultOk) { vendor = c2.vendor; instrument = strstr(c2.subCategories, "Instrument") != nullptr; }
    }
    if (f2) f2->release();
    if (name.empty()) { err = "this plugin is no longer in its file (updated or removed?)"; return false; }
    if (vendor.empty()) { PFactoryInfo fi; if (mod->factory->getFactoryInfo(&fi) == kResultOk) vendor = fi.vendor; }
    // the processor ...
    if (mod->factory->createInstance(cid, IComponent::iid, (void **)&comp) != kResultOk || !comp) { err = "the plugin could not be created"; return false; }
    if (comp->initialize(hostApp()) != kResultOk) { err = "the plugin did not start"; comp->release(); comp = nullptr; return false; }
    if (comp->queryInterface(IAudioProcessor::iid, (void **)&proc) != kResultOk || !proc) { err = "the plugin does not process audio"; return false; }
    // ... and its controller (the same object, or a second one)
    if (comp->queryInterface(IEditController::iid, (void **)&ctrl) != kResultOk || !ctrl) {
      TUID ccid; ctrl = nullptr;
      if (comp->getControllerClassId(ccid) == kResultOk && mod->factory->createInstance(ccid, IEditController::iid, (void **)&ctrl) == kResultOk && ctrl) {
        if (ctrl->initialize(hostApp()) != kResultOk) { ctrl->release(); ctrl = nullptr; } else sepCtrl = true;
      }
    }
    if (ctrl) {
      handler = new Handler(this); ctrl->setComponentHandler(handler);
      if (sepCtrl && comp->queryInterface(IConnectionPoint::iid, (void **)&cpComp) == kResultOk && ctrl->queryInterface(IConnectionPoint::iid, (void **)&cpCtrl) == kResultOk && cpComp && cpCtrl) { cpComp->connect(cpCtrl); cpCtrl->connect(cpComp); }
      MemStream *s = new MemStream(); if (comp->getState(s) == kResultOk) { s->pos = 0; ctrl->setComponentState(s); } s->release();
      ctrl->queryInterface(IMidiMapping::iid, (void **)&midiMap);
    }
    return true;
  }
  void setupBuses() {
    inBus.clear(); outBus.clear(); inCh.clear(); outCh.clear(); mem.clear(); mainIn = mainOut = -1; zeros.assign((size_t)maxBlock, 0.f);
    int32 nIn = comp->getBusCount(kAudio, kInput), nOut = comp->getBusCount(kAudio, kOutput);
    // the main buses in stereo; the others as they are, switched off
    std::vector<SpeakerArrangement> ai((size_t)nIn), ao((size_t)nOut);
    for (int32 i = 0; i < nIn; i++) { BusInfo b; comp->getBusInfo(kAudio, kInput, i, b); proc->getBusArrangement(kInput, i, ai[(size_t)i]); if (mainIn < 0 && b.busType == kMain) { mainIn = i; ai[(size_t)i] = SpeakerArr::kStereo; } }
    for (int32 i = 0; i < nOut; i++) { BusInfo b; comp->getBusInfo(kAudio, kOutput, i, b); proc->getBusArrangement(kOutput, i, ao[(size_t)i]); if (mainOut < 0 && b.busType == kMain) { mainOut = i; ao[(size_t)i] = SpeakerArr::kStereo; } }
    if (mainIn < 0 && nIn) mainIn = 0; if (mainOut < 0 && nOut) mainOut = 0;
    if (proc->setBusArrangements(ai.data(), nIn, ao.data(), nOut) != kResultOk) {   // it insists on its own (mono, say): take what it has
      for (int32 i = 0; i < nIn; i++) proc->getBusArrangement(kInput, i, ai[(size_t)i]); for (int32 i = 0; i < nOut; i++) proc->getBusArrangement(kOutput, i, ao[(size_t)i]);
    }
    for (int32 i = 0; i < nIn; i++) comp->activateBus(kAudio, kInput, i, i == mainIn);
    for (int32 i = 0; i < nOut; i++) comp->activateBus(kAudio, kOutput, i, i == mainOut);
    for (int32 i = 0, n = comp->getBusCount(kEvent, kInput); i < n; i++) comp->activateBus(kEvent, kInput, i, i == 0);
    auto build = [&](int32 n, std::vector<SpeakerArrangement> &arr, std::vector<AudioBusBuffers> &bus, std::vector<std::vector<float *>> &ch) {
      bus.resize((size_t)n); ch.resize((size_t)n);
      for (int32 i = 0; i < n; i++) { int c = SpeakerArr::getChannelCount(arr[(size_t)i]); ch[(size_t)i].resize((size_t)std::max(c, 0)); for (int k = 0; k < c; k++) { mem.emplace_back((size_t)maxBlock, 0.f); } bus[(size_t)i].numChannels = c; bus[(size_t)i].silenceFlags = 0; }
    };
    build(nIn, ai, inBus, inCh); build(nOut, ao, outBus, outCh);
    size_t k = 0; for (auto &v : inCh) for (auto &p : v) p = mem[k++].data(); for (auto &v : outCh) for (auto &p : v) p = mem[k++].data();
    for (size_t i = 0; i < inBus.size(); i++) inBus[i].channelBuffers32 = inCh[i].data(); for (size_t i = 0; i < outBus.size(); i++) outBus[i].channelBuffers32 = outCh[i].data();
    if (!inBus.empty() && mainIn < 0) mainIn = 0;
    if (!comp->getBusCount(kAudio, kInput) && comp->getBusCount(kEvent, kInput)) instrument = true;
  }
  bool start(double sr, int mb, std::string &err) override {
    sampleRate = sr; maxBlock = mb; setupBuses();
    ProcessSetup ps{ kRealtime, kSample32, mb, sr };
    if (proc->canProcessSampleSize(kSample32) != kResultOk) { err = "the plugin only does 64-bit audio"; return false; }
    if (proc->setupProcessing(ps) != kResultOk) { err = "the plugin would not start at " + std::to_string((int)sr) + " Hz"; return false; }
    if (comp->setActive(true) != kResultOk) { err = "the plugin would not switch on"; return false; }
    active = true; proc->setProcessing(true); procOn = true;   /* (kNotImplemented is fine too) */
    mapControllers();
    ctx.sampleRate = sr; ctx.tempo = 120; ctx.timeSigNumerator = 4; ctx.timeSigDenominator = 4; ctx.state = ProcessContext::kTempoValid | ProcessContext::kTimeSigValid;
    return true;
  }
  void mapControllers() { for (int cc = 0; cc < 130; cc++) { ParamID id = kNoParamId; if (!midiMap || midiMap->getMidiControllerAssignment(0, 0, (CtrlNumber)cc, id) != kResultOk) id = kNoParamId; ccMap[cc] = id; } }
  int latency() override { return proc ? (int)proc->getLatencySamples() : 0; }
  void process(const float *inL, const float *inR, float *outL, float *outR, int n, const PhMidi *midi, int nMidi) override {
    inChanges.clear(); outChanges.clear(); events.n = 0;
    fromApp.drain([&](const ParamQ::Item &it) { inChanges.set(it.id, it.value); });
    fromGui.drain([&](const ParamQ::Item &it) { inChanges.set(it.id, it.value); });
    for (int i = 0; i < nMidi; i++) {
      const uint8_t *d = midi[i].d; int st = d[0] & 0xF0, ch = d[0] & 15;
      if (st == 0x90 || st == 0x80) { Event e{}; e.busIndex = 0; e.sampleOffset = 0; e.flags = Event::kIsLive; bool on = st == 0x90 && d[2] > 0;
        if (on) { e.type = Event::kNoteOnEvent; e.noteOn = { (int16)ch, (int16)(d[1] & 127), 0.f, d[2] / 127.f, 0, -1 }; } else { e.type = Event::kNoteOffEvent; e.noteOff = { (int16)ch, (int16)(d[1] & 127), 0.f, -1, 0.f }; }
        events.addEvent(e); }
      else if (st == 0xB0) { ParamID id = ccMap[d[1] & 127]; if (id != kNoParamId) inChanges.set(id, d[2] / 127.0); }
      else if (st == 0xE0) { ParamID id = ccMap[kPitchBend]; if (id != kNoParamId) inChanges.set(id, ((d[2] << 7) | d[1]) / 16383.0); }
      else if (st == 0xD0) { ParamID id = ccMap[kAfterTouch]; if (id != kNoParamId) inChanges.set(id, d[1] / 127.0); }
    }
    if (mainIn >= 0 && (size_t)mainIn < inCh.size()) { auto &c = inCh[(size_t)mainIn]; if (c.size() == 1) { for (int i = 0; i < n; i++) c[0][i] = ((inL ? inL[i] : 0) + (inR ? inR[i] : inL ? inL[i] : 0)) * 0.5f; } else if (c.size() >= 2) { memcpy(c[0], inL ? inL : zeros.data(), sizeof(float) * (size_t)n); memcpy(c[1], inR ? inR : inL ? inL : zeros.data(), sizeof(float) * (size_t)n); } }
    ProcessData d; d.processMode = kRealtime; d.symbolicSampleSize = kSample32; d.numSamples = n;
    d.numInputs = (int32)inBus.size(); d.numOutputs = (int32)outBus.size(); d.inputs = inBus.empty() ? nullptr : inBus.data(); d.outputs = outBus.empty() ? nullptr : outBus.data();
    d.inputParameterChanges = &inChanges; d.outputParameterChanges = &outChanges; d.inputEvents = &events; d.outputEvents = nullptr; d.processContext = &ctx;
    tresult r = proc->process(d); ctx.projectTimeSamples += n;
    if (r != kResultOk || mainOut < 0 || (size_t)mainOut >= outCh.size() || outCh[(size_t)mainOut].empty()) { memset(outL, 0, sizeof(float) * (size_t)n); memset(outR, 0, sizeof(float) * (size_t)n); }
    else { auto &c = outCh[(size_t)mainOut]; memcpy(outL, c[0], sizeof(float) * (size_t)n); memcpy(outR, c.size() > 1 ? c[1] : c[0], sizeof(float) * (size_t)n); }
    for (int32 i = 0; i < outChanges.n; i++) { auto &qq = outChanges.q[i]; if (qq.n) toCtrl.push(qq.id, qq.vals[qq.n - 1]); }
  }
  std::vector<Param> params(int max) override {
    std::vector<Param> out; if (!ctrl) return out;
    for (int32 i = 0, n = ctrl->getParameterCount(); i < n && (int)out.size() < max; i++) {
      ParameterInfo pi; if (ctrl->getParameterInfo(i, pi) != kResultOk) continue;
      if (!(pi.flags & ParameterInfo::kCanAutomate) || (pi.flags & (ParameterInfo::kIsReadOnly | ParameterInfo::kIsHidden | ParameterInfo::kIsBypass | ParameterInfo::kIsProgramChange))) continue;
      double v = ctrl->getParamNormalized(pi.id); String128 t{}; ctrl->getParamStringByValue(pi.id, v, t); std::string unit = u8(pi.units, 128), txt = u8(t);
      out.push_back({ pi.id, u8(pi.title), v, txt + (unit.empty() || txt.empty() ? "" : " " + unit) });
    }
    return out;
  }
  void setParam(uint32_t id, double norm) override { if (ctrl) ctrl->setParamNormalized(id, norm); fromApp.push(id, norm); }
  // state: "V3S1", then the processor's state and the controller's, each with its length
  bool saveState(std::vector<uint8_t> &out) override {
    MemStream *a = new MemStream(), *b = new MemStream(); bool ok = comp->getState(a) == kResultOk; if (ctrl) ctrl->getState(b);
    out.clear(); const char *m = "V3S1"; out.insert(out.end(), m, m + 4);
    auto put = [&](const std::vector<uint8_t> &v) { uint32_t n = (uint32_t)v.size(); for (int i = 0; i < 4; i++) out.push_back((uint8_t)(n >> (8 * i))); out.insert(out.end(), v.begin(), v.end()); };
    put(a->d); put(b->d); a->release(); b->release(); return ok;
  }
  bool loadState(const std::vector<uint8_t> &in) override {
    if (in.size() < 12 || memcmp(in.data(), "V3S1", 4)) return false; size_t pos = 4;
    auto get = [&](std::vector<uint8_t> &v) { if (pos + 4 > in.size()) return false; uint32_t n = 0; for (int i = 0; i < 4; i++) n |= (uint32_t)in[pos + (size_t)i] << (8 * i); pos += 4; if (pos + n > in.size()) return false; v.assign(in.begin() + (long)pos, in.begin() + (long)(pos + n)); pos += n; return true; };
    std::vector<uint8_t> cs, ks; if (!get(cs) || !get(ks)) return false;
    MemStream *a = new MemStream(); a->d = cs; bool ok = comp->setState(a) == kResultOk;
    if (ctrl) { a->pos = 0; ctrl->setComponentState(a); if (!ks.empty()) { MemStream *b = new MemStream(); b->d = ks; ctrl->setState(b); b->release(); } }
    a->release(); return ok;
  }
  // the editor
  const char *viewType() { const char *w = windowApi(); return !strcmp(w, "x11") ? kPlatformTypeX11EmbedWindowID : !strcmp(w, "win32") ? kPlatformTypeHWND : !strcmp(w, "cocoa") ? kPlatformTypeNSView : nullptr; }
  bool hasEditor() override {
    if (!ctrl || !viewType()) return false; if (hasView >= 0) return hasView > 0;
    IPlugView *v = ctrl->createView(ViewType::kEditor); hasView = v && v->isPlatformTypeSupported(viewType()) == kResultTrue ? 1 : 0; if (v) v->release(); return hasView > 0;
  }
  int hasView = -1;
  bool openEditor() override {
    if (!ctrl || !viewType()) return false;
    view = ctrl->createView(ViewType::kEditor); if (!view) return false;
    if (view->isPlatformTypeSupported(viewType()) != kResultTrue) { view->release(); view = nullptr; return false; }
    if (!frame) frame = new Frame(this); view->setFrame(frame);
    ViewRect r{ 0, 0, 640, 400 }; view->getSize(&r); bool rs = view->canResize() == kResultTrue;
    editor = makeWindow(name, r.getWidth(), r.getHeight(), rs); if (!editor) { view->setFrame(nullptr); view->release(); view = nullptr; return false; }
    if (view->attached(editor->native(), viewType()) != kResultOk) { closeEditor(); return false; }
    editor->onResized = [this](int w, int h) { if (!view || view->canResize() != kResultTrue) return; ViewRect nr{ 0, 0, w, h }; if (view->checkSizeConstraint(&nr) == kResultTrue) view->onSize(&nr); };
    editor->show(); return true;
  }
  void closeEditor() override {
    if (view) { view->removed(); view->setFrame(nullptr); view->release(); view = nullptr; }
    if (frame) frame->clearAll();
    if (editor) { Window *w = editor; editor = nullptr; delete w; }
  }
  void idle() override {
    toCtrl.drain([&](const ParamQ::Item &it) { if (ctrl) ctrl->setParamNormalized(it.id, it.value); });
    if (dirtyAudio.exchange(false)) dirty = true;
  }
};
tresult PLUGIN_API Handler::performEdit(ParamID id, ParamValue v) { owner->fromGui.push(id, v); owner->dirty = true; return kResultOk; }
tresult PLUGIN_API Handler::restartComponent(int32 flags) {
  if (flags & (kParamValuesChanged | kParamTitlesChanged)) owner->dirty = true;
  if (flags & kMidiCCAssignmentChanged) owner->mapControllers();
  return kResultOk;
}
tresult PLUGIN_API Handler::setDirty(TBool d) { if (d) owner->dirty = true; return kResultOk; }
tresult PLUGIN_API Frame::resizeView(IPlugView *view, ViewRect *r) {
  if (!owner->editor || !r) return kResultFalse; owner->editor->resize(r->getWidth(), r->getHeight()); view->onSize(r); return kResultOk;
}

Plug *openVst3(const std::string &path, const std::string &id, std::string &err) { auto *p = new Vst3Plug(); if (!p->init(path, id, err)) { delete p; return nullptr; } return p; }
}  // namespace ph
