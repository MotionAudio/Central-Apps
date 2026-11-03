// fmt_cmfx.cpp - Central FX plugins (10.2, made in Central Production's plugin builder; cmfx/cmfx.h) in the rig's
// plugin host: Central Usage / Central Control's boards and the Central Pedal's extra stage (cm-pwnode).
// A Central FX plugin is a .cmfx.json file our own core interprets - only our blocks and the safe code language, no
// program of anyone's own - so it plays in this process (no wall needed) on every system, Windows included.
// A community one (inside a library's community-plugins folder) is still checked before it starts - the device's
// switch, the library's record and the file's sha256 - and is stopped live when it is switched off or taken down.
#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <cmath>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <sstream>
#include "ph.hpp"
#include "../vendor/cJSON.h"
extern "C" {
#include "../cmfx/cmfx.h"
}
namespace fs = std::filesystem;

namespace ph {
static bool readFile(const std::string &path, std::string &out) {
  std::ifstream f(fs::u8path(path), std::ios::binary); if (!f) return false;
  std::ostringstream s; s << f.rdbuf(); out = s.str(); return out.size() < (512u << 10);
}

struct CmfxPlug : Plug {
  CmFx *fx = nullptr; float *pool = nullptr; std::string text, root, why; uint64_t lastCheck = 0;
  ~CmfxPlug() override { free(fx); free(pool); }
  bool start(double sr, int mb, std::string &err) override {
    (void)mb;
    fx = (CmFx *)malloc(cmfx_struct_size()); if (!fx) { err = "not enough memory for the plugin"; return false; }
    char e[300] = "";
    if (cmfx_load(fx, text.data(), (int)text.size(), (float)sr, e, sizeof e) != 0) { err = e; return false; }
    pool = (float *)calloc(cmfx_pool_floats(fx), sizeof(float)); if (!pool) { err = "not enough memory for the plugin's delays"; return false; }
    cmfx_attach(fx, pool);
    name = cmfx_name(fx); vendor = cmfx_author(fx)[0] ? cmfx_author(fx) : "Central FX";
    lastCheck = nowMs(); return true;
  }
  void process(const float *inL, const float *inR, float *outL, float *outR, int n, const PhMidi *, int) override {
    if (!why.empty() || !fx) { for (int i = 0; i < n; i++) { outL[i] = inL ? inL[i] : 0; outR[i] = inR ? inR[i] : (inL ? inL[i] : 0); } return; }
    cmfx_process(fx, inL, inR, outL, outR, n);
  }
  std::vector<Param> params(int max) override {
    std::vector<Param> out; if (!fx) return out;
    for (int i = 0; i < cmfx_param_count(fx) && (int)out.size() < max; i++) {
      Param p; p.id = (uint32_t)i; p.name = cmfx_param_name(fx, i); float v = cmfx_param_get(fx, i); p.value = cmfx_param_to_norm(fx, i, v);
      char t[64]; const char *u = cmfx_param_unit(fx, i);
      if (fabsf(v) >= 1000 && !strcmp(u, "Hz")) snprintf(t, sizeof t, "%.2f kHz", v / 1000); else snprintf(t, sizeof t, fabsf(v) >= 100 ? "%.0f%s%s" : "%.2f%s%s", v, u[0] ? " " : "", u);
      p.text = t; out.push_back(p);
    }
    return out;
  }
  void setParam(uint32_t id, double norm) override { if (fx) cmfx_set_param(fx, (int)id, cmfx_param_from_norm(fx, (int)id, (float)norm)); }
  bool saveState(std::vector<uint8_t> &out) override {
    if (!fx) return false; std::string s = "CMFX1\n";
    for (int i = 0; i < cmfx_param_count(fx); i++) { char l[96]; snprintf(l, sizeof l, "%s=%.9g\n", cmfx_param_id(fx, i), cmfx_param_get(fx, i)); s += l; }
    out.assign(s.begin(), s.end()); return true;
  }
  bool loadState(const std::vector<uint8_t> &in) override {
    if (!fx) return false; std::string s(in.begin(), in.end()); if (s.compare(0, 6, "CMFX1\n") != 0) return false;
    std::istringstream is(s.substr(6)); std::string line;
    while (std::getline(is, line)) { size_t eq = line.find('='); if (eq == std::string::npos) continue; int i = cmfx_param_index(fx, line.substr(0, eq).c_str()); if (i >= 0) cmfx_set_param(fx, i, (float)atof(line.c_str() + eq + 1)); }
    cmfx_reset(fx); return true;
  }
  std::string bypassed() override { return why; }
  void bypass(const std::string &code) {
    if (!why.empty()) return; why = code;
    cJSON *o = cJSON_CreateObject(); cJSON_AddStringToObject(o, "type", "pluginBypassed"); cJSON_AddStringToObject(o, "uid", slot.c_str()); cJSON_AddStringToObject(o, "reason", code.c_str()); cJSON_AddStringToObject(o, "name", name.c_str());
    char *j = cJSON_PrintUnformatted(o); if (j) emitRaw(j); free(j); cJSON_Delete(o);
    log("Central FX plugin %s bypassed: %s", name.c_str(), code.c_str());
  }
  void idle() override {
    if (!community || !why.empty()) return;
    uint64_t now = nowMs(); if (now - lastCheck < 1000) return; lastCheck = now;
    std::error_code ec;
    if (!communityOn(root)) { bypass("off"); return; }
    if (!fs::exists(fs::u8path(path), ec)) { bypass("revoked"); return; }
  }
};

// (10.3) "collection:<id>": one of Motion Audio's own Central FX plugins, shipped next to this program (central-fx/), or in
// CENTRAL_FX_COLLECTION (tests, development)
static std::string collectionPath(const std::string &id) {
  if (id.empty() || id.size() > 60) return "";
  for (char c : id) if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-')) return "";
  const char *env = getenv("CENTRAL_FX_COLLECTION");
  fs::path dir = env && env[0] ? fs::u8path(env) : fs::u8path(exePath()).parent_path() / "central-fx";
  return (dir / (id + ".cmfx.json")).u8string();
}
Plug *openCmfx(const std::string &pathIn, std::string &err) {
  std::string path = pathIn;
  if (path.compare(0, 11, "collection:") == 0) { path = collectionPath(path.substr(11)); if (path.empty()) { err = "that isn't one of the Central FX plugins"; return nullptr; } }
  auto *p = new CmfxPlug();
  if (isCommunity(path)) {
    std::string root;
    if (!vetCommunity("cmfx", path, root, err)) { delete p; return nullptr; }
    p->root = root; p->community = true;
  }
  if (!readFile(path, p->text)) { err = "its file isn't there (or is too big)"; delete p; return nullptr; }
  p->path = path; p->format = "cmfx";
  return p;
}
bool scanCmfx(const std::string &path, std::vector<ClassInfo> &out, std::string &err) {
  std::string text; if (!readFile(path, text)) { err = "it couldn't be read"; return false; }
  CmFx *fx = (CmFx *)malloc(cmfx_struct_size()); char e[300] = "";
  bool ok = fx && cmfx_load(fx, text.data(), (int)text.size(), 48000, e, sizeof e) == 0;
  if (ok) { ClassInfo c; c.format = "cmfx"; c.name = cmfx_name(fx); c.id = c.name; c.vendor = cmfx_author(fx)[0] ? cmfx_author(fx) : "Central FX"; c.version = "1"; c.kind = "effect"; out.push_back(c); }
  else err = e[0] ? e : "it isn't a Central FX plugin";
  free(fx); return ok;
}
}  // namespace ph
