// test-bridge.cpp - the community plugin wall's checks, through the plugin host's own API (ph_get & co, as cu-rig and
// cm-pwnode use it). Never shipped. test-plugin-wall.mjs sets up a fake libraries folder and runs:
//   test-bridge <libraries folder> <data folder>
// The libraries folder holds community-plugins/community-7/central-test.clap (the gain) and
// community-plugins/community-8/evil-test.clap (crashes / hangs / too heavy / tries to get out), with their records.
// Prints one line per check ("ok ..." / "FAIL ..."), then "summary <failures>"; exits 1 on any failure.
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <string>
#include <thread>
#include <vector>
#include "../ph.hpp"
#include "../bridge.h"
#include "../../vendor/cJSON.h"

namespace fs = std::filesystem;
static std::mutex evLock; static std::vector<std::string> events;
static void onEmit(const char *s) { std::lock_guard<std::mutex> g(evLock); events.push_back(s); }
static int failures = 0;
static void check(bool ok, const std::string &what) { printf("%s %s\n", ok ? "ok" : "FAIL", what.c_str()); fflush(stdout); if (!ok) failures++; }
static double nowSec() { return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count(); }
static const int SR = 48000, N = 128;
static std::string L, D, gainPath, evilPath;

struct Blocks { int plugged = 0, dry = 0, other = 0; double maxMs = 0, p99 = 0, p50 = 0; };
// n blocks of a 0.25 sine through p; "plugged" = out == in * want (the plugin played it), "dry" = out == in
static Blocks run(PhPlug *p, int n, double want, int idleEvery = 8) {
  Blocks b; std::vector<double> ms; float inL[N], inR[N], oL[N], oR[N]; static double ph = 0;
  for (int k = 0; k < n; k++) {
    for (int i = 0; i < N; i++) { inL[i] = inR[i] = (float)(0.25 * sin(ph)); ph += 2 * M_PI * 220 / SR; }
    double t0 = nowSec(); ph_process(p, inL, inR, oL, oR, N, nullptr, 0); double dt = (nowSec() - t0) * 1000; ms.push_back(dt); b.maxMs = std::max(b.maxMs, dt);
    bool plug = true, dry = true; for (int i = 0; i < N; i++) { if (fabsf(oL[i] - inL[i] * (float)want) > 1e-3f || fabsf(oR[i] - inR[i] * (float)want) > 1e-3f) plug = false; if (oL[i] != inL[i] || oR[i] != inR[i]) dry = false; }
    if (plug && want != 1.0) b.plugged++; else if (dry) b.dry++; else if (plug) b.plugged++; else b.other++;
    if (idleEvery && k % idleEvery == 0) ph::runPosted();
    // real time: a block every N / SR seconds, the rest of the time "the audio thread" waits like a device would
    double left = (double)N / SR - (nowSec() - t0); if (left > 0) std::this_thread::sleep_for(std::chrono::duration<double>(left));
  }
  std::sort(ms.begin(), ms.end()); if (!ms.empty()) { b.p50 = ms[ms.size() / 2]; b.p99 = ms[(size_t)(ms.size() * 0.99)]; }
  return b;
}
static std::string slotField(const char *slot, const char *field) {
  char *j = ph_slots_json(); cJSON *o = cJSON_Parse(j); free(j); std::string v;
  cJSON *e = cJSON_GetObjectItem(o, slot); cJSON *f = e ? cJSON_GetObjectItem(e, field) : nullptr;
  if (cJSON_IsString(f)) v = f->valuestring; else if (cJSON_IsBool(f)) v = cJSON_IsTrue(f) ? "true" : "false";
  cJSON_Delete(o); return v;
}
static double paramValue(const char *slot, const char *name) {
  char *j = ph_params_json(slot, 16); cJSON *a = cJSON_Parse(j), *e; free(j); double v = -1;
  cJSON_ArrayForEach(e, a) { const char *n = cJSON_GetStringValue(cJSON_GetObjectItem(e, "name")); if (n && !strcmp(n, name)) v = cJSON_GetNumberValue(cJSON_GetObjectItem(e, "value")); }
  cJSON_Delete(a); return v;
}
static uint32_t paramId(const char *slot, const char *name) {
  char *j = ph_params_json(slot, 16); cJSON *a = cJSON_Parse(j), *e; free(j); uint32_t v = 0;
  cJSON_ArrayForEach(e, a) { const char *n = cJSON_GetStringValue(cJSON_GetObjectItem(e, "name")); if (n && !strcmp(n, name)) v = (uint32_t)cJSON_GetNumberValue(cJSON_GetObjectItem(e, "id")); }
  cJSON_Delete(a); return v;
}
static PhPlug *get(const char *slot, const std::string &id, const std::string &path, std::string &err) {
  char e[300] = ""; PhPlug *p = ph_get(slot, "clap", id.c_str(), path.c_str(), nullptr, SR, N, e, sizeof e); err = e; return p;
}
static bool sawEvent(const char *slot, const char *reason) {
  std::lock_guard<std::mutex> g(evLock);
  for (auto &s : events) if (s.find("\"pluginBypassed\"") != std::string::npos && s.find(std::string("\"uid\":\"") + slot + "\"") != std::string::npos && s.find(std::string("\"reason\":\"") + reason + "\"") != std::string::npos) return true;
  return false;
}
static void drop(PhPlug *p, const char *slot) { ph_forget_slot(slot); ph_release(p); }
static bool waitBypass(PhPlug *p, const char *slot, double secs) { double end = nowSec() + secs; while (nowSec() < end) { run(p, 16, 1.0, 1); if (!slotField(slot, "bypassed").empty()) return true; } return false; }

int main(int argc, char **argv) {
  if (argc < 3) { fprintf(stderr, "usage: test-bridge <libraries folder> <data folder>\n"); return 2; }
  L = argv[1]; D = argv[2];
  gainPath = L + "/community-plugins/community-7/central-test.clap"; evilPath = L + "/community-plugins/community-8/evil-test.clap";
  ph_init(D.c_str(), onEmit);
  std::string err;

  // 1. the bridge round-trips audio, with bounded latency
  {
    PhPlug *p = get("g1", "audio.motion.test-gain", gainPath, err);
    check(p != nullptr, "a community plugin starts walled off (" + err + ")");
    if (p) {
      check(slotField("g1", "community") == "true", "the rig lists it as a community plugin");
      uint32_t gid = paramId("g1", "Gain"); check(gid == 1, "its parameters come across the wall");
      ph_set_param("g1", gid, 0.625);   // -24..+24 dB: 0.625 = +6 dB, so a block the plugin played differs from a dry one
      run(p, 40, 1.0);
      Blocks a = run(p, 3000, pow(10, 6.0 / 20));
      char m[300]; snprintf(m, sizeof m, "3000 blocks of 128 at 48 kHz round-trip with the +6 dB set from the app: %d through the plugin, %d dry, %d wrong; per block p50 %.3f ms, p99 %.3f ms, max %.3f ms", a.plugged, a.dry, a.other, a.p50, a.p99, a.maxMs);
      check(a.other == 0 && a.plugged >= 2955, m);
      check(a.p99 < 2.0 && a.maxMs < 25.0, "the round trip stays inside the block's time (p99 under 2 ms of the 2.67 ms block; never longer than the budget + scheduling)");
      // the preset (state) is saved through the wall and restored into a fresh process
      ph_save_all(); check(fs::exists(D + "/plugin-states/g1.state"), "its state (preset) is saved");
      drop(p, "g1");
      PhPlug *q = get("g1", "audio.motion.test-gain", gainPath, err);
      if (q) { run(q, 40, 1.0); Blocks c = run(q, 300, pow(10, 6.0 / 20)); check(c.plugged >= 290, "its state is restored into a fresh walled-off process (+6 dB again: " + std::to_string(c.plugged) + " played, " + std::to_string(c.dry) + " dry, " + std::to_string(c.other) + " other)"); drop(q, "g1"); }
      else check(false, "restarts after save: " + err);
    }
  }

  // 2. the wall: no internet, no files outside its folder, no programs (the probe it makes when it starts)
  {
    PhPlug *p = get("w1", "audio.motion.test-evil", evilPath, err);
    check(p != nullptr, "the misbehaving test plugin starts walled off (" + err + ")");
    if (p) {
      double probe = paramValue("w1", "Probe");
      check(probe == 0, "walled off, it could not reach the internet, read or write the musician's file, or start a program (probe " + std::to_string((int)probe) + ")");
      std::ifstream pp(L + "/community-plugins/community-8/probe-path.txt"); std::string target; std::getline(pp, target);
      check(!fs::exists(target + ".written"), "nothing was written outside its folder");
      // 3. crashes: bypassed, and the sound never stops (every block comes back - dry)
      uint32_t mode = paramId("w1", "Mode");
      ph_set_param("w1", mode, 1.0 / 3);
      bool by = waitBypass(p, "w1", 3);
      Blocks after = run(p, 200, 1.0);
      check(by && slotField("w1", "bypassed") == "crashed" && sawEvent("w1", "crashed"), "a plugin that crashes is bypassed and the app is told (" + slotField("w1", "bypassed") + ")");
      check(after.dry == 200, "after the crash the sound goes on, dry (" + std::to_string(after.dry) + "/200)");
      drop(p, "w1");
    }
  }
  {   // hangs: each block still returns within its budget; after ~1.5 s it is bypassed and killed
    PhPlug *p = get("h1", "audio.motion.test-evil", evilPath, err);
    if (p) {
      ph_set_param("h1", paramId("h1", "Mode"), 2.0 / 3);
      double t0 = nowSec(); Blocks h = run(p, (int)(2.5 * SR / N), 1.0, 4); double took = nowSec() - t0;
      check(slotField("h1", "bypassed") == "hung" && sawEvent("h1", "hung"), "a plugin that stops responding is bypassed after about 1.5 s (" + slotField("h1", "bypassed") + ")");
      char m[200]; snprintf(m, sizeof m, "while it hung no block waited past its budget (longest %.2f ms) and none went missing (%d dry, %d other, %.2f s)", h.maxMs, h.dry, h.other, took);
      check(h.maxMs < 25.0 && h.other <= 2, m);
      drop(p, "h1");
    } else check(false, "the hang test plugin starts: " + err);
  }
  {   // too heavy: over budget block after block -> bypassed
    PhPlug *p = get("v1", "audio.motion.test-evil", evilPath, err);
    if (p) {
      ph_set_param("v1", paramId("v1", "Mode"), 1.0);
      double end = nowSec() + 20; while (nowSec() < end && slotField("v1", "bypassed").empty()) run(p, 32, 1.0, 1);
      std::string w = slotField("v1", "bypassed");
      check(w == "heavy", "a plugin too heavy for the device (50 ms for a 2.7 ms block) is bypassed as too heavy (" + w + ")");
      drop(p, "v1");
    } else check(false, "the heavy test plugin starts: " + err);
  }

  // 4. revoked: its folder taken away while it plays -> unloaded live, the sound goes on dry
  {
    std::string copyDir = L + "/community-plugins/community-9";
    fs::create_directories(copyDir); fs::copy_file(gainPath, copyDir + "/central-test.clap", fs::copy_options::overwrite_existing);
    { std::ifstream r(L + "/community-7.json"); std::string s((std::istreambuf_iterator<char>(r)), std::istreambuf_iterator<char>()); size_t k; while ((k = s.find("community-7")) != std::string::npos) s.replace(k, 11, "community-9"); std::ofstream w(L + "/community-9.json"); w << s; }
    PhPlug *p = get("r1", "audio.motion.test-gain", copyDir + "/central-test.clap", err);
    check(p != nullptr, "a second community plugin starts (" + err + ")");
    if (p) {
      run(p, 100, 1.0);
      fs::remove_all(copyDir); fs::remove(L + "/community-9.json");
      bool by = waitBypass(p, "r1", 3);
      check(by && slotField("r1", "bypassed") == "revoked" && sawEvent("r1", "revoked"), "a revoked plugin is stopped live (" + slotField("r1", "bypassed") + ")");
      Blocks a = run(p, 100, 1.0); check(a.dry == 100, "and the sound goes on, dry");
      drop(p, "r1");
      PhPlug *again = get("r2", "audio.motion.test-gain", copyDir + "/central-test.clap", err); check(again == nullptr, "a revoked plugin doesn't start again (" + err + ")");
    }
  }
  // 5. its program file changed since the review -> it doesn't start
  {
    std::string t = L + "/community-plugins/community-7/central-test.clap"; std::string bak = t + ".bak"; fs::copy_file(t, bak, fs::copy_options::overwrite_existing);
    { std::ofstream f(t, std::ios::app | std::ios::binary); f << "tampered"; }
    PhPlug *p = get("t1", "audio.motion.test-gain", t, err);
    check(p == nullptr && err.find("don't match") != std::string::npos, "a program file changed since Motion Audio checked it: it doesn't start (" + err + ")");
    fs::rename(bak, t);
  }
  // 6. the switch off -> what plays stops live, nothing new starts
  {
    PhPlug *p = get("s1", "audio.motion.test-gain", gainPath, err);
    if (p) {
      run(p, 50, 1.0);
      { std::ofstream f(L + "/community-plugins.json"); f << "{\"on\":false}"; }
      bool by = waitBypass(p, "s1", 3);
      check(by && slotField("s1", "bypassed") == "off", "switching community plugins off stops them live (" + slotField("s1", "bypassed") + ")");
      drop(p, "s1");
      PhPlug *q = get("s2", "audio.motion.test-gain", gainPath, err); check(q == nullptr, "and none start while it is off (" + err + ")");
      { std::ofstream f(L + "/community-plugins.json"); f << "{\"on\":true}"; }
    } else check(false, "starts for the switch test: " + err);
  }
  // 7. (the probe is real: loaded unwalled, in this test process, the same plugin reads and writes the musician's file
  // and starts a program - so the 0 it reports inside the wall means the wall stopped it)
  {
    std::string e; ph::Plug *raw = ph::openDirect("clap", "audio.motion.test-evil", evilPath, e);
    if (raw && raw->start(SR, N, e)) {
      double probe = -1; for (auto &q : raw->params(8)) if (q.name == "Probe") probe = q.value * 15;
      int bits = (int)(probe + 0.5);
      check((bits & 14) == 14, "outside the wall the same probe does read, write and start a program (probe " + std::to_string(bits) + ") - so the wall is what stops it");
      delete raw;
    } else check(false, "the probe loads unwalled for the comparison: " + e);
  }
  ph_keep_only(nullptr, 0);
  printf("summary %d\n", failures); fflush(stdout);
  return failures ? 1 : 0;
}
