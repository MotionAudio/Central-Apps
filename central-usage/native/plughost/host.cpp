// host.cpp - the plugin host's common part: posted work and timers for the main loop, the slots (running plugins by
// the app's key), their saved states, and finding plugins (each plugin file is opened by a child process, so a plugin
// that crashes or hangs while it loads only loses itself).
#include <algorithm>
#include <chrono>
#include <cstdarg>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <thread>
#include "ph.hpp"
#include "../vendor/cJSON.h"
#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#else
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <sys/wait.h>
#include <unistd.h>
#endif
#ifdef __APPLE__
#include <mach-o/dyld.h>
#endif

namespace fs = std::filesystem;
namespace ph {

static std::string gData = ".";
static void (*gEmit)(const char *) = nullptr;
void emitJson(cJSON *j) { char *s = cJSON_PrintUnformatted(j); if (gEmit && s) gEmit(s); free(s); }

void log(const char *fmt, ...) { va_list a; va_start(a, fmt); fputs("plughost: ", stderr); vfprintf(stderr, fmt, a); fputc('\n', stderr); va_end(a); }
std::string lower(std::string s) { for (auto &c : s) c = (char)tolower((unsigned char)c); return s; }
bool endsWith(const std::string &s, const std::string &suf) { return s.size() >= suf.size() && lower(s.substr(s.size() - suf.size())) == lower(suf); }
std::string baseName(const std::string &p) { size_t k = p.find_last_of("/\\"); std::string b = k == std::string::npos ? p : p.substr(k + 1); size_t d = b.rfind('.'); return d == std::string::npos || d == 0 ? b : b.substr(0, d); }
uint64_t nowMs() { return (uint64_t)std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count(); }
static fs::path P(const std::string &utf8) { return fs::u8path(utf8); }
static std::string U(const fs::path &p) { auto s = p.u8string(); return std::string(s.begin(), s.end()); }

std::string exePath() {
#ifdef _WIN32
  wchar_t w[4096]; DWORD n = GetModuleFileNameW(NULL, w, 4096); return U(fs::path(std::wstring(w, n)));
#elif defined(__APPLE__)
  char b[4096]; uint32_t n = sizeof b; if (_NSGetExecutablePath(b, &n) == 0) { char r[4096]; if (realpath(b, r)) return r; return b; } return "";
#else
  char b[4096]; ssize_t n = readlink("/proc/self/exe", b, sizeof b - 1); if (n > 0) { b[n] = 0; return b; } return "";
#endif
}

// ------------------------------------------------------------------ posted work, timers, fds (main thread)
static std::mutex postLock;
static std::vector<std::function<void()>> posted;
struct Timer { uint64_t id; int period; uint64_t next; TimerFn fn; };
static std::vector<Timer> timers; static uint64_t timerIds = 1;
std::vector<FdWatch> fdWatches;   // (gui_x11.cpp polls them)
void post(std::function<void()> f) { { std::lock_guard<std::mutex> g(postLock); posted.push_back(std::move(f)); } wake(); }
uint64_t addTimer(int periodMs, TimerFn fn) { Timer t{ timerIds++, std::max(1, periodMs), nowMs() + (uint64_t)std::max(1, periodMs), std::move(fn) }; timers.push_back(t); return t.id; }
void removeTimer(uint64_t id) { for (auto &t : timers) if (t.id == id) t.fn = nullptr; }
void addFd(int fd, FdFn fn) { removeFd(fd); fdWatches.push_back({ fd, std::move(fn) }); }
void removeFd(int fd) { fdWatches.erase(std::remove_if(fdWatches.begin(), fdWatches.end(), [&](const FdWatch &w) { return w.fd == fd; }), fdWatches.end()); }
int nextTimerMs() {
  { std::lock_guard<std::mutex> g(postLock); if (!posted.empty()) return 0; }
  uint64_t now = nowMs(); int64_t best = 33;
  for (auto &t : timers) if (t.fn) best = std::min<int64_t>(best, (int64_t)t.next - (int64_t)now);
  return (int)std::max<int64_t>(0, best);
}
static uint64_t lastIdle;
static void idleAll();
void runPosted() {
  std::vector<std::function<void()>> work; { std::lock_guard<std::mutex> g(postLock); work.swap(posted); }
  for (auto &f : work) f();
  uint64_t now = nowMs();
  for (size_t i = 0; i < timers.size(); i++) { if (timers[i].fn && now >= timers[i].next) { timers[i].next = now + (uint64_t)timers[i].period; auto f = timers[i].fn; f(); } }
  timers.erase(std::remove_if(timers.begin(), timers.end(), [](const Timer &t) { return !t.fn; }), timers.end());
  if (now - lastIdle >= 30) { lastIdle = now; idleAll(); }
}

// ------------------------------------------------------------------ the slots
static std::map<std::string, Plug *> pool;
static std::string statesDir() { return U(P(gData) / "plugin-states"); }
static std::string cleanName(const std::string &s) { std::string o; for (char c : s) if (isalnum((unsigned char)c) || c == '-' || c == '_') o += c; return o.empty() ? "slot" : o.substr(0, 64); }
static std::string stateFile(const std::string &name) { return U(P(statesDir()) / P(cleanName(name) + ".state")); }
// a state file: "CUPS1\n<format>\n<id>\n" then the plugin's own bytes
static bool readState(const std::string &name, const std::string &format, const std::string &id, std::vector<uint8_t> &out) {
  std::ifstream f(P(stateFile(name)), std::ios::binary); if (!f) return false;
  std::string magic, fmt, cid; if (!std::getline(f, magic) || magic != "CUPS1" || !std::getline(f, fmt) || !std::getline(f, cid)) return false;
  if (fmt != format || cid != id) return false;
  out.assign(std::istreambuf_iterator<char>(f), std::istreambuf_iterator<char>()); return true;
}
static std::map<std::string, size_t> savedHash;
static bool writeState(Plug *p, const std::string &name) {
  std::vector<uint8_t> b; if (!p->saveState(b)) return false;
  size_t h = std::hash<std::string>()(std::string(b.begin(), b.end())) ^ b.size();
  if (savedHash.count(name) && savedHash[name] == h && fs::exists(P(stateFile(name)))) return true;
  std::error_code ec; fs::create_directories(P(statesDir()), ec);
  std::string tmp = stateFile(name) + ".tmp";
  { std::ofstream f(P(tmp), std::ios::binary | std::ios::trunc); if (!f) return false; f << "CUPS1\n" << p->format << "\n" << p->id << "\n"; f.write((const char *)b.data(), (std::streamsize)b.size()); if (!f) return false; }
  fs::rename(P(tmp), P(stateFile(name)), ec); if (ec) return false;
  savedHash[name] = h; return true;
}
static void saveSlot(Plug *p) { if (!p->slot.empty() && writeState(p, p->slot)) p->dirty = false; }
static uint64_t lastAutosave;
static void idleAll() {
  for (auto &kv : pool) kv.second->idle();
  uint64_t now = nowMs();
  if (now - lastAutosave >= 4000) { lastAutosave = now; for (auto &kv : pool) if (kv.second->dirty || kv.second->editor) saveSlot(kv.second); }
}
static void destroy(Plug *p) { if (p->editor) p->closeEditor(); delete p; }

// the list (scan results), for finding a moved plugin by its id
static std::mutex listLock; static cJSON *gList;
static std::string findPath(const std::string &format, const std::string &id) {
  std::lock_guard<std::mutex> g(listLock); if (!gList) return "";
  cJSON *ps = cJSON_GetObjectItem(gList, "plugins"), *e; cJSON_ArrayForEach(e, ps) {
    const char *f = cJSON_GetStringValue(cJSON_GetObjectItem(e, "format")), *i = cJSON_GetStringValue(cJSON_GetObjectItem(e, "id")), *pa = cJSON_GetStringValue(cJSON_GetObjectItem(e, "path"));
    if (f && i && pa && format == f && id == i) return pa;
  }
  return "";
}
static Plug *openAny(const std::string &format, const std::string &id, const std::string &path, std::string &err) {
  if (format == "clap") return openClap(path, id, err);
#ifdef PH_VST3
  if (format == "vst3") return openVst3(path, id, err);
#endif
#ifdef PH_LV2
  if (format == "lv2") return openLv2(id, err);
#endif
#ifdef __APPLE__
  if (format == "au") return openAu(id, err);
#endif
  err = format + " plugins don't work on this computer"; return nullptr;
}
}  // namespace ph

using namespace ph;
struct PhPlug {};   // (the C side only ever sees ph::Plug pointers through this name)
static Plug *PP(PhPlug *p) { return reinterpret_cast<Plug *>(p); }

extern "C" {
void ph_init(const char *dataDir, void (*emit)(const char *json)) { gData = dataDir && dataDir[0] ? dataDir : "."; gEmit = emit; }
void ph_post(void (*fn)(void *), void *arg) { post([fn, arg] { fn(arg); }); }

PhPlug *ph_get(const char *slot, const char *format, const char *id, const char *path, const char *stateFrom, double sr, int maxBlock, char *err, int errLen) {
  std::string s = slot ? slot : "", f = format ? format : "", i = id ? id : "", pa = path ? path : "";
  auto it = pool.find(s);
  if (it != pool.end()) {
    if (it->second->format == f && it->second->id == i) { it->second->refs++; return reinterpret_cast<PhPlug *>(it->second); }
    Plug *old = it->second; saveSlot(old); pool.erase(it); if (--old->refs == 0) destroy(old);
  }
  std::error_code ec; if (pa.empty() || (f != "au" && f != "lv2" && !fs::exists(P(pa), ec))) { std::string found = findPath(f, i); if (!found.empty()) pa = found; }
  std::string e; Plug *p = openAny(f, i, pa, e);
  if (!p) { if (err) snprintf(err, (size_t)errLen, "%s", e.c_str()); return nullptr; }
  p->format = f; p->id = i; p->path = pa; p->slot = s; p->sampleRate = sr; p->maxBlock = maxBlock;
  if (!p->start(sr, maxBlock, e)) { if (err) snprintf(err, (size_t)errLen, "%s", e.c_str()); delete p; return nullptr; }
  std::vector<uint8_t> st;
  if (readState(s, f, i, st) || (stateFrom && stateFrom[0] && readState(stateFrom, f, i, st))) { if (!p->loadState(st)) log("%s: its saved state did not load", p->name.c_str()); else if (!readState(s, f, i, st)) p->dirty = true; }
  p->refs = 2; pool[s] = p; return reinterpret_cast<PhPlug *>(p);
}
void ph_retain(PhPlug *p) { if (p) PP(p)->refs++; }
void ph_release(PhPlug *p) { if (!p) return; Plug *q = PP(p); if (--q->refs == 0) destroy(q); }
void ph_keep_only(const char *const *slots, int n) {
  std::set<std::string> keep; for (int i = 0; i < n; i++) keep.insert(slots[i]);
  for (auto it = pool.begin(); it != pool.end();) {
    if (keep.count(it->first)) { ++it; continue; }
    Plug *p = it->second; saveSlot(p); if (p->editor) { p->closeEditor(); cJSON *o = cJSON_CreateObject(); cJSON_AddStringToObject(o, "type", "pluginEditor"); cJSON_AddStringToObject(o, "uid", p->slot.c_str()); cJSON_AddBoolToObject(o, "open", 0); emitJson(o); cJSON_Delete(o); }
    it = pool.erase(it); if (--p->refs == 0) destroy(p);
  }
}
int ph_is_instrument(PhPlug *p) { return p && PP(p)->instrument; }
const char *ph_slot(PhPlug *p) { return p ? PP(p)->slot.c_str() : ""; }
char *ph_slots_json(void) {
  cJSON *o = cJSON_CreateObject(); bool win = windowApi()[0] != 0;
  for (auto &kv : pool) { Plug *p = kv.second; cJSON *e = cJSON_AddObjectToObject(o, kv.first.c_str()); cJSON_AddStringToObject(e, "name", p->name.c_str()); cJSON_AddStringToObject(e, "vendor", p->vendor.c_str()); cJSON_AddStringToObject(e, "format", p->format.c_str()); cJSON_AddBoolToObject(e, "instrument", p->instrument); cJSON_AddBoolToObject(e, "editor", win && p->hasEditor()); cJSON_AddBoolToObject(e, "open", p->editor != nullptr); cJSON_AddNumberToObject(e, "latency", p->latency()); }
  char *s = cJSON_PrintUnformatted(o); cJSON_Delete(o); return s;
}
const char *ph_name(PhPlug *p) { return p ? PP(p)->name.c_str() : ""; }
int ph_latency(PhPlug *p) { return p ? PP(p)->latency() : 0; }
void ph_process(PhPlug *p, const float *inL, const float *inR, float *outL, float *outR, int n, const PhMidi *midi, int nMidi) { PP(p)->process(inL, inR, outL, outR, n, midi, nMidi); }

char *ph_params_json(const char *slot, int max) {
  cJSON *a = cJSON_CreateArray(); auto it = pool.find(slot ? slot : "");
  if (it != pool.end()) for (auto &q : it->second->params(max)) { cJSON *o = cJSON_CreateObject(); cJSON_AddNumberToObject(o, "id", q.id); cJSON_AddStringToObject(o, "name", q.name.c_str()); cJSON_AddNumberToObject(o, "value", q.value); cJSON_AddStringToObject(o, "text", q.text.c_str()); cJSON_AddItemToArray(a, o); }
  char *s = cJSON_PrintUnformatted(a); cJSON_Delete(a); return s;
}
int ph_set_param(const char *slot, uint32_t id, double v) { auto it = pool.find(slot ? slot : ""); if (it == pool.end()) return 0; it->second->setParam(id, std::min(1.0, std::max(0.0, v))); it->second->dirty = true; return 1; }
int ph_has_editor(const char *slot) { auto it = pool.find(slot ? slot : ""); return it != pool.end() && it->second->hasEditor() && windowApi()[0]; }
int ph_editor(const char *slot, int open) {
  auto it = pool.find(slot ? slot : ""); if (it == pool.end()) return 0; Plug *p = it->second;
  if (!open) { if (p->editor) { saveSlot(p); p->closeEditor(); } return 0; }
  if (p->editor) { p->editor->show(); return 1; }
  if (!p->hasEditor() || !windowApi()[0] || !p->openEditor() || !p->editor) return 0;
  std::string s = p->slot;
  p->editor->onClose = [s] {
    auto i2 = pool.find(s); if (i2 == pool.end()) return; Plug *q = i2->second; saveSlot(q);
    post([s] { auto i3 = pool.find(s); if (i3 != pool.end() && i3->second->editor) i3->second->closeEditor(); cJSON *o = cJSON_CreateObject(); cJSON_AddStringToObject(o, "type", "pluginEditor"); cJSON_AddStringToObject(o, "uid", s.c_str()); cJSON_AddBoolToObject(o, "open", 0); emitJson(o); cJSON_Delete(o); });
  };
  return 1;
}
void ph_save_all(void) { for (auto &kv : pool) saveSlot(kv.second); }
int ph_copy_state(const char *fromSlot, const char *toName) {
  auto it = pool.find(fromSlot ? fromSlot : ""); if (it != pool.end()) saveSlot(it->second);
  std::error_code ec; fs::copy_file(P(stateFile(fromSlot ? fromSlot : "")), P(stateFile(toName ? toName : "")), fs::copy_options::overwrite_existing, ec); return !ec;
}

const char *ph_formats(void) {
  return "clap"
#ifdef PH_VST3
         ",vst3"
#endif
#ifdef __APPLE__
         ",au"
#endif
#ifdef PH_LV2
         ",lv2"
#endif
      ;
}
}  // extern "C"

// ------------------------------------------------------------------ finding plugins
namespace ph {
static std::vector<std::string> envList(const char *name) {
  std::vector<std::string> out; const char *v = getenv(name); if (!v) return out;
#ifdef _WIN32
  char sep = ';';
#else
  char sep = ':';
#endif
  std::string s = v; size_t a = 0; while (a <= s.size()) { size_t b = s.find(sep, a); if (b == std::string::npos) b = s.size(); if (b > a) out.push_back(s.substr(a, b - a)); a = b + 1; }
  return out;
}
static std::string home() {
#ifdef _WIN32
  const char *h = getenv("USERPROFILE");
#else
  const char *h = getenv("HOME");
#endif
  return h ? h : "";
}
static std::vector<std::pair<std::string, std::string>> defaultFolders() {   // (format, folder)
  std::vector<std::pair<std::string, std::string>> d; std::string h = home();
#ifdef _WIN32
  const char *cpf = getenv("COMMONPROGRAMFILES"), *lad = getenv("LOCALAPPDATA");
  if (cpf) { d.push_back({ "vst3", std::string(cpf) + "\\VST3" }); d.push_back({ "clap", std::string(cpf) + "\\CLAP" }); }
  if (lad) { d.push_back({ "vst3", std::string(lad) + "\\Programs\\Common\\VST3" }); d.push_back({ "clap", std::string(lad) + "\\Programs\\Common\\CLAP" }); }
#elif defined(__APPLE__)
  for (std::string base : { std::string(""), h }) { d.push_back({ "vst3", base + "/Library/Audio/Plug-Ins/VST3" }); d.push_back({ "clap", base + "/Library/Audio/Plug-Ins/CLAP" }); }
#else
  d.push_back({ "vst3", h + "/.vst3" }); d.push_back({ "vst3", "/usr/lib/vst3" }); d.push_back({ "vst3", "/usr/local/lib/vst3" }); d.push_back({ "vst3", "/usr/lib64/vst3" });
  d.push_back({ "clap", h + "/.clap" }); d.push_back({ "clap", "/usr/lib/clap" }); d.push_back({ "clap", "/usr/local/lib/clap" }); d.push_back({ "clap", "/usr/lib64/clap" });
#endif
  for (auto &e : envList("CLAP_PATH")) d.push_back({ "clap", e });
  for (auto &e : envList("VST3_PATH")) d.push_back({ "vst3", e });
  return d;
}
struct Cand { std::string format, path; };
static void walk(const fs::path &dir, int depth, std::vector<Cand> &out, std::set<std::string> &seen) {
  std::error_code ec; if (depth > 6) return;
  for (fs::directory_iterator it(dir, fs::directory_options::skip_permission_denied, ec), end; !ec && it != end; it.increment(ec)) {
    std::string name = U(it->path().filename()), full = U(it->path());
    bool isDir = it->is_directory(ec);
    if (endsWith(name, ".vst3") || endsWith(name, ".clap")) { std::string canon = lower(full); if (!seen.count(canon)) { seen.insert(canon); out.push_back({ endsWith(name, ".vst3") ? "vst3" : "clap", full }); } continue; }
    if (isDir && name[0] != '.') walk(it->path(), depth + 1, out, seen);
  }
}
static int64_t stamp(const std::string &p) {
  std::error_code ec; auto t = fs::last_write_time(P(p), ec); if (ec) return 0;
  int64_t s = (int64_t)t.time_since_epoch().count();
  for (auto sub : { "Contents", "Contents/x86_64-linux", "Contents/x86_64-win", "Contents/MacOS" }) { auto t2 = fs::last_write_time(P(p) / sub, ec); if (!ec) s ^= (int64_t)t2.time_since_epoch().count(); }
  return s;
}

// run `<this program> --scan-one <format> <path>`, at most `ms`; its stdout
static bool runChild(const std::string &format, const std::string &path, int ms, std::string &out) {
  std::string exe = exePath();
#ifdef _WIN32
  auto w = [](const std::string &s) { int n = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, NULL, 0); std::wstring r(n ? n - 1 : 0, 0); if (n) MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, &r[0], n); return r; };
  std::wstring cmd = L"\"" + w(exe) + L"\" --scan-one " + w(format) + L" \"" + w(path) + L"\"";
  SECURITY_ATTRIBUTES sa{ sizeof sa, NULL, TRUE }; HANDLE rd, wr; if (!CreatePipe(&rd, &wr, &sa, 0)) return false; SetHandleInformation(rd, HANDLE_FLAG_INHERIT, 0);
  STARTUPINFOW si{}; si.cb = sizeof si; si.dwFlags = STARTF_USESTDHANDLES; si.hStdOutput = wr; si.hStdError = GetStdHandle(STD_ERROR_HANDLE); si.hStdInput = NULL;
  PROCESS_INFORMATION pi{}; std::vector<wchar_t> cl(cmd.begin(), cmd.end()); cl.push_back(0);
  if (!CreateProcessW(NULL, cl.data(), NULL, NULL, TRUE, CREATE_NO_WINDOW, NULL, NULL, &si, &pi)) { CloseHandle(rd); CloseHandle(wr); return false; }
  CloseHandle(wr); uint64_t end = nowMs() + (uint64_t)ms; bool ok = false; char buf[4096];
  for (;;) {
    DWORD avail = 0; while (PeekNamedPipe(rd, NULL, 0, NULL, &avail, NULL) && avail) { DWORD got = 0; if (!ReadFile(rd, buf, sizeof buf, &got, NULL) || !got) break; out.append(buf, got); }
    if (WaitForSingleObject(pi.hProcess, 20) == WAIT_OBJECT_0) { DWORD got = 0; while (ReadFile(rd, buf, sizeof buf, &got, NULL) && got) out.append(buf, got); DWORD code = 1; GetExitCodeProcess(pi.hProcess, &code); ok = code == 0; break; }
    if (nowMs() > end) { TerminateProcess(pi.hProcess, 9); out = "timeout"; break; }
  }
  CloseHandle(rd); CloseHandle(pi.hProcess); CloseHandle(pi.hThread); return ok;
#else
  int fd[2]; if (pipe(fd)) return false;
  pid_t pid = fork(); if (pid < 0) { close(fd[0]); close(fd[1]); return false; }
  if (pid == 0) { dup2(fd[1], 1); close(fd[0]); close(fd[1]); int nul = open("/dev/null", O_RDONLY); if (nul >= 0) dup2(nul, 0); execl(exe.c_str(), exe.c_str(), "--scan-one", format.c_str(), path.c_str(), (char *)NULL); _exit(127); }
  close(fd[1]); fcntl(fd[0], F_SETFL, O_NONBLOCK); uint64_t end = nowMs() + (uint64_t)ms; char buf[4096]; bool done = false; int status = 0;
  while (!done) {
    struct pollfd p{ fd[0], POLLIN, 0 }; poll(&p, 1, 50);
    for (;;) { ssize_t n = read(fd[0], buf, sizeof buf); if (n > 0) out.append(buf, (size_t)n); else break; }
    if (waitpid(pid, &status, WNOHANG) == pid) { for (;;) { ssize_t n = read(fd[0], buf, sizeof buf); if (n > 0) out.append(buf, (size_t)n); else break; } done = true; break; }
    if (nowMs() > end) { kill(pid, SIGKILL); waitpid(pid, &status, 0); out = "timeout"; close(fd[0]); return false; }
  }
  close(fd[0]); return WIFEXITED(status) && WEXITSTATUS(status) == 0;
#endif
}

static cJSON *classJson(const ClassInfo &c, const std::string &path) {
  cJSON *o = cJSON_CreateObject(); cJSON_AddStringToObject(o, "key", (c.format + ":" + c.id).c_str()); cJSON_AddStringToObject(o, "format", c.format.c_str()); cJSON_AddStringToObject(o, "id", c.id.c_str());
  cJSON_AddStringToObject(o, "name", c.name.c_str()); cJSON_AddStringToObject(o, "vendor", c.vendor.c_str()); cJSON_AddStringToObject(o, "version", c.version.c_str()); cJSON_AddStringToObject(o, "kind", c.kind.c_str()); cJSON_AddStringToObject(o, "path", path.c_str());
  return o;
}
static std::atomic<bool> scanning{ false };
static std::string cachePath() { return U(P(gData) / "plugin-cache.json"); }
static cJSON *readJsonFile(const std::string &p) { std::ifstream f(P(p), std::ios::binary); if (!f) return nullptr; std::string s((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>()); return cJSON_Parse(s.c_str()); }
static void writeJsonFile(const std::string &p, cJSON *j) { std::error_code ec; fs::create_directories(P(gData), ec); char *s = cJSON_PrintUnformatted(j); std::ofstream f(P(p + ".tmp"), std::ios::binary | std::ios::trunc); if (s) f << s; f.close(); free(s); fs::rename(P(p + ".tmp"), P(p), ec); }

static void scanWorker(std::vector<std::string> extra, bool force) {
  // 1. what is there
  std::vector<Cand> cands; std::set<std::string> seen; cJSON *folders = cJSON_CreateArray();
  auto add = [&](const std::string &dir) { std::error_code ec; if (fs::is_directory(P(dir), ec)) walk(P(dir), 0, cands, seen); };
  std::set<std::string> listed;
  for (auto &fd : defaultFolders()) { add(fd.second); if (!listed.count(fd.second)) { listed.insert(fd.second); std::error_code ec; if (fs::is_directory(P(fd.second), ec)) cJSON_AddItemToArray(folders, cJSON_CreateString(fd.second.c_str())); } }
  for (auto &e : extra) { add(e); if (!listed.count(e)) { listed.insert(e); cJSON_AddItemToArray(folders, cJSON_CreateString(e.c_str())); } }
#ifndef PH_VST3
  cands.erase(std::remove_if(cands.begin(), cands.end(), [](const Cand &c) { return c.format == "vst3"; }), cands.end());   // (a build without VST3)
#endif
  // 2. each file: from the cache, else from a child process (3 at a time)
  cJSON *cache = force ? nullptr : readJsonFile(cachePath()); if (!cache) cache = cJSON_CreateObject();
  cJSON *entries = cJSON_GetObjectItem(cache, "entries"); if (!entries) entries = cJSON_AddObjectToObject(cache, "entries");
  std::vector<cJSON *> results(cands.size(), nullptr); std::atomic<size_t> next{ 0 }, done{ 0 }; std::mutex m;
  auto progress = [&](const std::string &cur) { cJSON *o = cJSON_CreateObject(); cJSON_AddStringToObject(o, "type", "pluginScan"); cJSON_AddNumberToObject(o, "done", (double)done.load()); cJSON_AddNumberToObject(o, "total", (double)cands.size()); cJSON_AddStringToObject(o, "current", cur.c_str()); emitJson(o); cJSON_Delete(o); };
  auto worker = [&] {
    for (;;) {
      size_t i = next++; if (i >= cands.size()) return; const Cand &c = cands[i]; int64_t st = stamp(c.path);
      { std::lock_guard<std::mutex> g(m); cJSON *e = cJSON_GetObjectItem(entries, c.path.c_str()); if (e && (int64_t)cJSON_GetNumberValue(cJSON_GetObjectItem(e, "stamp")) == st) { results[i] = cJSON_Duplicate(e, 1); done++; continue; } }
      progress(baseName(c.path));
      std::string out; bool ok = runChild(c.format, c.path, 60000, out);
      cJSON *r = ok ? cJSON_Parse(out.c_str()) : nullptr; cJSON *e = cJSON_CreateObject(); cJSON_AddNumberToObject(e, "stamp", (double)st); cJSON_AddStringToObject(e, "format", c.format.c_str());
      if (r && cJSON_IsArray(cJSON_GetObjectItem(r, "classes"))) cJSON_AddItemToObject(e, "classes", cJSON_Duplicate(cJSON_GetObjectItem(r, "classes"), 1));
      else { std::string why = r && cJSON_GetStringValue(cJSON_GetObjectItem(r, "error")) ? cJSON_GetStringValue(cJSON_GetObjectItem(r, "error")) : out == "timeout" ? "it took too long to load" : "it crashed while loading"; cJSON_AddStringToObject(e, "error", why.c_str()); }
      cJSON_Delete(r); results[i] = e; done++;
    }
  };
  std::vector<std::thread> th; for (int k = 0; k < 3; k++) th.emplace_back(worker); for (auto &t : th) t.join();
  // 3. the list
  cJSON *list = cJSON_CreateObject(), *plugins = cJSON_AddArrayToObject(list, "plugins"), *failed = cJSON_AddArrayToObject(list, "failed"), *newEntries = cJSON_CreateObject();
  std::set<std::string> keys;
  for (size_t i = 0; i < cands.size(); i++) {
    cJSON *e = results[i]; if (!e) continue; cJSON_AddItemToObject(newEntries, cands[i].path.c_str(), cJSON_Duplicate(e, 1));
    cJSON *cl = cJSON_GetObjectItem(e, "classes"), *c;
    if (cl) cJSON_ArrayForEach(c, cl) { ClassInfo ci; auto g = [&](const char *k) { const char *v = cJSON_GetStringValue(cJSON_GetObjectItem(c, k)); return std::string(v ? v : ""); }; ci.format = cands[i].format; ci.id = g("id"); ci.name = g("name"); ci.vendor = g("vendor"); ci.version = g("version"); ci.kind = g("kind"); if (ci.id.empty() || keys.count(ci.format + ci.id)) continue; keys.insert(ci.format + ci.id); cJSON_AddItemToArray(plugins, classJson(ci, cands[i].path)); }
    else { cJSON *f = cJSON_CreateObject(); cJSON_AddStringToObject(f, "format", cands[i].format.c_str()); cJSON_AddStringToObject(f, "path", cands[i].path.c_str()); cJSON_AddStringToObject(f, "name", baseName(cands[i].path).c_str()); cJSON_AddStringToObject(f, "error", cJSON_GetStringValue(cJSON_GetObjectItem(e, "error")) ? cJSON_GetStringValue(cJSON_GetObjectItem(e, "error")) : "it did not load"); cJSON_AddItemToArray(failed, f); }
    cJSON_Delete(e);
  }
  std::vector<ClassInfo> more; std::vector<std::string> morePaths;
#ifdef PH_LV2
  listLv2(more, morePaths);
#endif
#ifdef __APPLE__
  { std::vector<ClassInfo> au; listAu(au); for (auto &a : au) { more.push_back(a); morePaths.push_back(""); } }
#endif
  for (size_t i = 0; i < more.size(); i++) { if (keys.count(more[i].format + more[i].id)) continue; keys.insert(more[i].format + more[i].id); cJSON_AddItemToArray(plugins, classJson(more[i], morePaths[i])); }
  cJSON_AddItemToObject(list, "folders", folders); cJSON_AddStringToObject(list, "formats", ph_formats());
  cJSON *nc = cJSON_CreateObject(); cJSON_AddNumberToObject(nc, "version", 1); cJSON_AddItemToObject(nc, "entries", newEntries); writeJsonFile(cachePath(), nc); cJSON_Delete(nc); cJSON_Delete(cache);
  { cJSON *saved = cJSON_Duplicate(list, 1); writeJsonFile(U(P(gData) / "plugin-list.json"), saved); cJSON_Delete(saved); }
  { std::lock_guard<std::mutex> g(listLock); cJSON_Delete(gList); gList = cJSON_Duplicate(list, 1); }
  cJSON_AddStringToObject(list, "type", "pluginList"); emitJson(list); cJSON_Delete(list);
  scanning = false;
}
}  // namespace ph

extern "C" {
void ph_scan(const char *extraFoldersJson, int force) {
  if (scanning.exchange(true)) return;
  std::vector<std::string> extra; cJSON *a = extraFoldersJson ? cJSON_Parse(extraFoldersJson) : nullptr, *e; if (a) cJSON_ArrayForEach(e, a) if (cJSON_IsString(e)) extra.push_back(e->valuestring); cJSON_Delete(a);
  std::thread(scanWorker, extra, force != 0).detach();
}
char *ph_list_json(void) {
  std::lock_guard<std::mutex> g(listLock);
  if (!gList) gList = readJsonFile(U(P(gData) / "plugin-list.json"));
  cJSON *o = gList ? cJSON_Duplicate(gList, 1) : cJSON_CreateObject(); if (!gList) { cJSON_AddArrayToObject(o, "plugins"); cJSON_AddArrayToObject(o, "failed"); cJSON_AddArrayToObject(o, "folders"); }
  cJSON_DeleteItemFromObject(o, "formats"); cJSON_AddStringToObject(o, "formats", ph_formats()); cJSON_AddBoolToObject(o, "scanning", scanning.load());
  char *s = cJSON_PrintUnformatted(o); cJSON_Delete(o); return s;
}
int ph_scan_one_main(const char *format, const char *path) {
  std::vector<ClassInfo> cls; std::string err; bool ok = false; std::string f = format ? format : "";
  if (f == "clap") ok = scanClap(path, cls, err);
#ifdef PH_VST3
  else if (f == "vst3") ok = scanVst3(path, cls, err);
#endif
  else err = "unknown format";
  cJSON *o = cJSON_CreateObject(); cJSON_AddBoolToObject(o, "ok", ok); if (!ok) cJSON_AddStringToObject(o, "error", err.c_str());
  cJSON *a = cJSON_AddArrayToObject(o, "classes"); for (auto &c : cls) cJSON_AddItemToArray(a, classJson(c, path));
  char *s = cJSON_PrintUnformatted(o); if (gEmit) gEmit(s); else { fputs(s, stdout); fputc('\n', stdout); fflush(stdout); } free(s); cJSON_Delete(o);   /* (gEmit: the rig's own copy of stdout - plugins' prints go to stderr) */
  return ok ? 0 : 1;
}
}
