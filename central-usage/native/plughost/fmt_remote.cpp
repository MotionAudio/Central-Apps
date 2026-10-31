// fmt_remote.cpp - (10.1) a community plugin, as the rig sees it: a Plug whose sound comes from cm-plugbridge, walled off
// in its own process (bridge.h). Our own plugins and the musician's own plugins never come here - only plugins installed
// from Make & sell, which live in <libraries>/community-plugins/<library id>/<bundle>.
//
// Before it starts, every time:
//   * the device's "Allow community plugins" switch (<libraries>/community-plugins.json) must be on;
//   * the library's record (<libraries>/<library id>.json) must list this plugin, and each of its program files must
//     still match the sha256 Motion Audio's review recorded;
//   * there must be a wall: bubblewrap on Linux (the Central Pedal and Linux computers), sandbox-exec on macOS.
//     Windows: no wall yet, so community plugins don't run there at all.
// While it plays (idle(), on the main thread, about once a second): the switch going off, or the plugin's folder going
// away (the revoke list took it away), stops it live; crashing, stopping responding or being too heavy bypasses it.
// Bypassed means the block plays dry, so the sound never stops; the app hears {"type":"pluginBypassed",...}.
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include "ph.hpp"
#include "bridge.h"
#include "sha256.h"
#include "../vendor/cJSON.h"
#ifndef _WIN32
#include <unistd.h>
#endif

namespace fs = std::filesystem;
namespace ph {

static const char *kDir = "community-plugins";
bool isCommunity(const std::string &path) {
  std::string p = path; for (auto &c : p) if (c == '\\') c = '/';
  return p.find(std::string("/") + kDir + "/") != std::string::npos;
}
// <root>/community-plugins/<lib>/<rest...>
static bool parts(const std::string &path, std::string &root, std::string &lib, std::string &rest) {
  std::string p = path; for (auto &c : p) if (c == '\\') c = '/';
  std::string key = std::string("/") + kDir + "/"; size_t k = p.rfind(key); if (k == std::string::npos) return false;
  root = p.substr(0, k); std::string tail = p.substr(k + key.size()); size_t s = tail.find('/');
  if (s == std::string::npos || s == 0 || s + 1 >= tail.size()) return false;
  lib = tail.substr(0, s); rest = tail.substr(s + 1);
  if (lib.find("..") != std::string::npos || rest.find("..") != std::string::npos) return false;
  return true;
}
static cJSON *readJson(const std::string &p) { std::ifstream f(fs::u8path(p), std::ios::binary); if (!f) return nullptr; std::string s((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>()); return cJSON_Parse(s.c_str()); }
static bool switchOn(const std::string &root) { cJSON *j = readJson(root + "/community-plugins.json"); bool on = j && cJSON_IsTrue(cJSON_GetObjectItem(j, "on")); cJSON_Delete(j); return on; }
static std::string nearExe(const char *name) {
  std::string e = exePath(); size_t k = e.find_last_of("/\\"); std::string dir = k == std::string::npos ? "." : e.substr(0, k);
  return dir + "/" + name;
}
static bool onPath(const char *prog, std::string &out) {
  const char *pth = getenv("PATH"); std::string s = pth ? pth : "/usr/bin:/bin"; size_t a = 0;
  while (a <= s.size()) { size_t b = s.find(':', a); if (b == std::string::npos) b = s.size(); std::string c = s.substr(a, b - a) + "/" + prog;
#ifndef _WIN32
    if (b > a && access(c.c_str(), X_OK) == 0) { out = c; return true; }
#endif
    a = b + 1; }
  return false;
}

// the checks before it may run; on success, the folder to wall it into (the library's plugin folder)
static bool vet(const std::string &format, const std::string &path, std::string &root, std::string &libDir, std::string &rest, std::string &err) {
  std::string lib;
  if (!parts(path, root, lib, rest)) { err = "it isn't an installed community plugin"; return false; }
  if (format == "au") { err = "community Audio Units plugins can't be walled off, so they don't run"; return false; }
  if (!switchOn(root)) { err = "community plugins are switched off on this device"; return false; }
  libDir = root + "/" + kDir + "/" + lib;
  cJSON *rec = readJson(root + "/" + lib + ".json");
  if (!rec) { err = "it isn't from an installed Make & sell library any more"; return false; }
  std::string bundle = rest.substr(0, rest.find('/')); cJSON *pl = nullptr, *e;
  cJSON_ArrayForEach(e, cJSON_GetObjectItem(rec, "plugins")) { const char *b = cJSON_GetStringValue(cJSON_GetObjectItem(e, "bundle")); if (b && bundle == b) { pl = e; break; } }
  int checked = 0; bool ok = pl != nullptr;
  if (pl) cJSON_ArrayForEach(e, cJSON_GetObjectItem(pl, "binaries")) {
    const char *n = cJSON_GetStringValue(cJSON_GetObjectItem(e, "name")), *h = cJSON_GetStringValue(cJSON_GetObjectItem(e, "sha256"));
    if (!n || !h || strstr(n, "..")) { ok = false; break; }
    char hex[65] = ""; if (!cm_sha256_file((libDir + "/" + n).c_str(), hex) || strcmp(hex, h) != 0) { ok = false; break; }
    checked++;
  }
  cJSON_Delete(rec);
  if (!pl) { err = "its library doesn't list it"; return false; }
  if (!ok || !checked) { err = "its program files don't match what Motion Audio checked, so it won't run"; return false; }
  std::error_code ec; if (!fs::exists(fs::u8path(path), ec)) { err = "its files aren't there"; return false; }
  return true;
}

#ifdef __APPLE__
static std::string sbString(const std::string &s) { std::string o = "\""; for (char c : s) { if (c == '\\' || c == '"') o += '\\'; o += c; } return o + "\""; }
static std::string macProfile(const std::string &pluginDir, const std::string &tmpDir, const std::string &exe) {
  std::string exeDir = exe.substr(0, exe.find_last_of('/'));
  return "(version 1)\n(deny default)\n(deny network*)\n"
         "(allow process-exec (literal " + sbString(exe) + "))\n"
         "(allow process-fork)\n(allow signal (target self))\n(allow sysctl-read)\n(allow file-read-metadata)\n"
         "(allow file-read* (subpath \"/System\") (subpath \"/usr/lib\") (subpath \"/usr/share\") (subpath \"/Library/Audio\") (subpath \"/private/var/db/timezone\") (subpath \"/private/var/db/dyld\") (literal \"/dev/null\") (literal \"/dev/urandom\") (literal \"/dev/random\")\n"
         "  (subpath " + sbString(exeDir) + ") (subpath " + sbString(pluginDir) + "))\n"
         "(allow file-read* file-write* (subpath " + sbString(tmpDir) + "))\n"
         "(allow file-write-data (literal \"/dev/null\"))\n"
         "(allow mach-lookup (global-name \"com.apple.system.logger\"))\n";
}
#endif

// the wall's command line, ending with cm-plugbridge <format> <id> <path> (bridge_client.c adds the rest)
static bool wallArgv(const std::string &format, const std::string &id, const std::string &libDir, const std::string &rest, std::vector<std::string> &av, std::string &tmpOut, std::string &err) {
  std::string exe = nearExe("cm-plugbridge");
  std::error_code ec; if (!fs::exists(fs::u8path(exe), ec)) { err = "the community plugin host (cm-plugbridge) isn't installed"; return false; }
  std::string real = fs::canonical(fs::u8path(libDir), ec).u8string(); if (ec) { err = "its folder isn't there"; return false; }
#if defined(__linux__)
  std::string bwrap; if (!onPath("bwrap", bwrap)) { err = "community plugins need bubblewrap (bwrap) to run walled off, and it isn't installed"; return false; }
  av = { bwrap, "--unshare-all", "--die-with-parent", "--new-session", "--cap-drop", "ALL", "--clearenv" };
  for (const char *p : { "/usr", "/lib", "/lib64", "/lib32", "/bin", "/sbin", "/etc/ld.so.cache", "/etc/ld.so.conf", "/etc/ld.so.conf.d", "/etc/alternatives", "/etc/fonts" }) { av.push_back("--ro-bind-try"); av.push_back(p); av.push_back(p); }
  for (const char *s : { "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--dir", "/tmp/home" }) av.push_back(s);
  for (const std::string &s : { std::string("--ro-bind"), real, std::string("/plugin"), std::string("--ro-bind"), exe, std::string("/cm/cm-plugbridge") }) av.push_back(s);
  for (const char *s : { "--setenv", "HOME", "/tmp/home", "--setenv", "TMPDIR", "/tmp", "--setenv", "PATH", "/usr/bin:/bin", "--setenv", "LV2_PATH", "/plugin", "--setenv", "VST3_PATH", "/plugin", "--setenv", "CLAP_PATH", "/plugin", "--chdir", "/tmp", "--", "/cm/cm-plugbridge" }) av.push_back(s);
  av.push_back(format); av.push_back(id); av.push_back("/plugin/" + rest);
  return true;
#elif defined(__APPLE__)
  const char *td = getenv("TMPDIR"); std::string base = td && td[0] ? std::string(td) : "/tmp/";
  std::string pat = base + (base.back() == '/' ? "" : "/") + "cm-plugin-XXXXXX"; std::vector<char> t(pat.begin(), pat.end()); t.push_back(0);
  if (!mkdtemp(t.data())) { err = "couldn't make the plugin's own folder"; return false; }
  std::string tmp = fs::canonical(fs::u8path(t.data()), ec).u8string(); tmpOut = tmp;
  std::string rexe = fs::canonical(fs::u8path(exe), ec).u8string();
  av = { "/usr/bin/env", "-i", "TMPDIR=" + tmp, "HOME=" + tmp, "PATH=/usr/bin:/bin", "/usr/bin/sandbox-exec", "-p", macProfile(real, tmp, rexe), rexe, format, id, real + "/" + rest };
  return true;
#else
  (void)format; (void)id; (void)rest; (void)av; (void)tmpOut; (void)real;
  err = "community plugins can't run walled off on Windows yet, so they stay off here"; return false;
#endif
}

struct RemotePlug : Plug {
  CmbClient *c = nullptr; std::string root, libDir, rest, tmpDir, why; int lat = 0; uint64_t lastCheck = 0;
  ~RemotePlug() override {
    if (c) { cmb_stop(c, CMB_STOPPED); cmb_free(c); }
    if (!tmpDir.empty()) { std::error_code ec; fs::remove_all(fs::u8path(tmpDir), ec); }
  }
  bool start(double sr, int mb, std::string &err) override {
    std::vector<std::string> av;
    if (!wallArgv(format, id, libDir, rest, av, tmpDir, err)) return false;
    std::vector<const char *> argv; for (auto &s : av) argv.push_back(s.c_str()); argv.push_back(nullptr);
    char e[300] = ""; c = cmb_start(argv.data(), sr, mb, e, sizeof e);
    if (!c) { err = e[0] ? e : "the plugin didn't start"; return false; }
    cJSON *j = cJSON_Parse(cmb_info(c));
    if (j) { const char *n = cJSON_GetStringValue(cJSON_GetObjectItem(j, "name")), *v = cJSON_GetStringValue(cJSON_GetObjectItem(j, "vendor"));
      if (n && *n) name = n; if (v) vendor = v; instrument = cJSON_IsTrue(cJSON_GetObjectItem(j, "instrument")); lat = (int)cJSON_GetNumberValue(cJSON_GetObjectItem(j, "latency")); if (lat < 0 || lat > 1 << 20) lat = 0; cJSON_Delete(j); }
    if (name.empty()) name = baseName(path);
    lastCheck = nowMs(); return true;
  }
  void process(const float *inL, const float *inR, float *outL, float *outR, int n, const PhMidi *midi, int nMidi) override {
    cmb_process(c, inL, inR, outL, outR, n, reinterpret_cast<const uint8_t (*)[3]>(midi), nMidi);
  }
  int latency() override { return lat; }
  std::vector<Param> params(int max) override {
    std::vector<Param> out; if (!why.empty()) return out;
    char q[32]; snprintf(q, sizeof q, "P %d", max); char *r = cmb_request(c, q, 1500); if (!r) return out;
    cJSON *a = cJSON_Parse(r), *e; free(r);
    cJSON_ArrayForEach(e, a) { Param p; p.id = (uint32_t)cJSON_GetNumberValue(cJSON_GetObjectItem(e, "id")); const char *nm = cJSON_GetStringValue(cJSON_GetObjectItem(e, "name")), *tx = cJSON_GetStringValue(cJSON_GetObjectItem(e, "text")); p.name = nm ? nm : ""; p.text = tx ? tx : ""; p.value = cJSON_GetNumberValue(cJSON_GetObjectItem(e, "value")); if (p.value != p.value) p.value = 0; out.push_back(p); if ((int)out.size() >= max) break; }
    cJSON_Delete(a); return out;
  }
  void setParam(uint32_t pid, double norm) override { if (!why.empty()) return; char l[64]; snprintf(l, sizeof l, "S %u %.9g", pid, norm); cmb_send(c, l); }
  bool saveState(std::vector<uint8_t> &out) override {
    if (!why.empty()) return false;
    char *r = cmb_request(c, "G", 4000); if (!r) return false;
    bool ok = strcmp(r, "-") != 0; if (ok) { out.resize(strlen(r) * 3 / 4 + 3); out.resize(cmb_b64_decode(r, out.data(), out.size())); ok = !out.empty(); }
    free(r); return ok;
  }
  bool loadState(const std::vector<uint8_t> &in) override {
    if (!why.empty() || in.empty()) return false;
    std::string l(4 * ((in.size() + 2) / 3) + 3, '\0'); l[0] = 'L'; l[1] = ' '; size_t k = cmb_b64_encode(in.data(), in.size(), &l[2]); l.resize(k + 2);
    char *r = cmb_request(c, l.c_str(), 4000); bool ok = r && !strcmp(r, "1"); free(r); return ok;
  }
  std::string bypassed() override { return why; }
  void bypass(const std::string &code) {
    if (!why.empty()) return; why = code;
    cJSON *o = cJSON_CreateObject(); cJSON_AddStringToObject(o, "type", "pluginBypassed"); cJSON_AddStringToObject(o, "uid", slot.c_str()); cJSON_AddStringToObject(o, "reason", code.c_str()); cJSON_AddStringToObject(o, "name", name.c_str());
    char *s = cJSON_PrintUnformatted(o); if (s) emitRaw(s); free(s); cJSON_Delete(o);
    log("community plugin %s bypassed: %s", name.c_str(), code.c_str());
  }
  void idle() override {
    if (!why.empty() || !c) return;
    int s = cmb_state(c);
    if (s != CMB_RUNNING) { bypass(s == CMB_CRASHED ? "crashed" : s == CMB_HUNG ? "hung" : s == CMB_HEAVY_ ? "heavy" : "stopped"); return; }
    uint64_t now = nowMs(); if (now - lastCheck < 1000) return; lastCheck = now;
    std::error_code ec;
    if (!switchOn(root)) { cmb_stop(c, CMB_STOPPED); bypass("off"); return; }
    if (!fs::exists(fs::u8path(path), ec)) { cmb_stop(c, CMB_STOPPED); bypass("revoked"); return; }
  }
};

Plug *openRemote(const std::string &format, const std::string &id, const std::string &path, std::string &err) {
  std::string root, libDir, rest;
  if (!vet(format, path, root, libDir, rest, err)) return nullptr;
  auto *p = new RemotePlug(); p->root = root; p->libDir = libDir; p->rest = rest; p->format = format; p->id = id; p->path = path; p->community = true;
  return p;
}
}  // namespace ph
