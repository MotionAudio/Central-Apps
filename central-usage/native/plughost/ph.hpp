// ph.hpp - inside the plugin host: what every plugin format implements, the editor window, the main loop's timers.
#pragma once
#include <atomic>
#include <cstdint>
#include <functional>
#include <string>
#include <vector>
#include "plughost.h"

namespace ph {

// ---- one plugin file's contents (scanning)
struct ClassInfo { std::string format, id, name, vendor, version, kind; };   // kind: "effect" | "instrument"

// ---- the editor window (one per open editor; native window on the main thread)
struct Window {
  virtual ~Window() {}
  virtual void *native() = 0;                 // X11 Window id (as a pointer-sized integer) / HWND / NSView*
  virtual void resize(int w, int h) = 0;      // the plugin asked for a new size
  virtual void show() = 0;
  virtual bool fitChild() { return false; }   // take the size of the window the plugin put inside (for plugins that never say their size)
  std::function<void()> onClose;              // the musician closed it
  std::function<void(int, int)> onResized;    // the musician resized it (for plugins that allow it)
};
Window *makeWindow(const std::string &title, int w, int h, bool resizable);
const char *windowApi();                      // "x11", "win32", "cocoa", or "" (no windows here)

// ---- a parameter change for the audio thread (single producer: the main thread; single consumer: the audio thread)
struct ParamQ {
  struct Item { uint32_t id; double value; };
  static const unsigned N = 512;
  Item items[N]; std::atomic<unsigned> w{0}, r{0};
  bool push(uint32_t id, double v) { unsigned ww = w.load(std::memory_order_relaxed); if (ww - r.load(std::memory_order_acquire) >= N) return false; items[ww % N] = { id, v }; w.store(ww + 1, std::memory_order_release); return true; }
  template <class F> void drain(F f) { unsigned rr = r.load(std::memory_order_relaxed), ww = w.load(std::memory_order_acquire); while (rr != ww) { f(items[rr % N]); rr++; } r.store(rr, std::memory_order_release); }
};

struct Param { uint32_t id; std::string name; double value; std::string text; };

// ---- a running plugin (every call on the main thread but process)
struct Plug {
  virtual ~Plug() {}
  std::string format, id, path, name, vendor; bool instrument = false;
  int refs = 1; std::string slot; bool dirty = false; double sampleRate = 48000; int maxBlock = 4096;
  Window *editor = nullptr;
  virtual bool start(double sr, int maxBlock, std::string &err) = 0;       // activate + start processing
  virtual void process(const float *inL, const float *inR, float *outL, float *outR, int n, const PhMidi *midi, int nMidi) = 0;
  virtual int latency() { return 0; }
  virtual std::vector<Param> params(int max) = 0;                          // the first `max` automatable ones (normalized values)
  virtual void setParam(uint32_t id, double norm) = 0;
  virtual bool saveState(std::vector<uint8_t> &out) = 0;
  virtual bool loadState(const std::vector<uint8_t> &in) = 0;
  virtual bool hasEditor() { return false; }
  virtual bool openEditor() { return false; }                              // creates `editor` and attaches the plugin's view
  virtual void closeEditor() {}
  virtual void idle() {}                                                   // the main loop, ~30 times a second
  bool community = false;                                                  // (10.1) a community plugin, walled off in its own process
  virtual std::string bypassed() { return ""; }                            // why it plays dry now ("" while it plays): crashed, stopped responding...
};

// ---- (10.1) community plugins (Make & sell): never loaded in this process - each runs in cm-plugbridge, walled off
// (fmt_remote.cpp, bridge.h). isCommunity: the path is inside a library's community-plugins folder.
bool isCommunity(const std::string &path);
Plug *openRemote(const std::string &format, const std::string &id, const std::string &path, std::string &err);
// in this process, without the slots (cm-plugbridge: the one plugin it hosts); an empty id is the bundle's first one
Plug *openDirect(const std::string &format, const std::string &id, const std::string &path, std::string &err);
void emitRaw(const std::string &json);   // one JSON line to the rig's app

// the formats (each returns nullptr + err if it can't)
Plug *openClap(const std::string &path, const std::string &id, std::string &err);
bool scanClap(const std::string &path, std::vector<ClassInfo> &out, std::string &err);
Plug *openVst3(const std::string &path, const std::string &id, std::string &err);
bool scanVst3(const std::string &path, std::vector<ClassInfo> &out, std::string &err);
Plug *openLv2(const std::string &uri, std::string &err);
bool listLv2(std::vector<ClassInfo> &out, std::vector<std::string> &paths);   // in process (reads the plugins' descriptions only)
Plug *openAu(const std::string &id, std::string &err);
bool listAu(std::vector<ClassInfo> &out);                                      // in process (the system's list)

// ---- the main loop: timers and (Linux) file descriptors for plugins' editors
using TimerFn = std::function<void()>;
uint64_t addTimer(int periodMs, TimerFn fn);
void removeTimer(uint64_t id);
using FdFn = std::function<void(int fd)>;
void addFd(int fd, FdFn fn);
void removeFd(int fd);
struct FdWatch { int fd; FdFn fn; };
extern std::vector<FdWatch> fdWatches;
void post(std::function<void()> f);   // run on the main thread soon (from any thread)
void wake();                       // the main loop's poll returns (another thread posted work)
uint64_t nowMs();
void runPosted();                  // the main loop runs posted work, timers and plugin idles
int nextTimerMs();                 // how long the main loop may sleep

// small helpers
std::string lower(std::string s);
bool endsWith(const std::string &s, const std::string &suf);
std::string baseName(const std::string &p);
std::string exePath();
void log(const char *fmt, ...);    // to stderr
}  // namespace ph
