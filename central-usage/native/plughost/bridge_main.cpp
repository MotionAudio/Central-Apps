// bridge_main.cpp - cm-plugbridge: hosts ONE community plugin, inside its wall (bridge.h has the protocol).
//   cm-plugbridge <format> <id> <path> <audio fd> <control fd> <shm fd> <rate> <block>
// It is started by the rig (cu-rig) or the Central Pedal's community stage (cm-pwnode) through bubblewrap / sandbox-exec,
// never by hand. Before the plugin's code runs at all (loading a library runs its constructors), the process puts up
// the rest of its wall itself: no new privileges and a seccomp filter on Linux (cmb_seccomp below), no core dumps.
// Then: the audio thread answers each block over shared memory; the main thread answers the control lines.
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <thread>
#include <vector>
#include "bridge.h"
#include "ph.hpp"
#ifndef _WIN32
#include <errno.h>
#include <poll.h>
#include <pthread.h>
#include <sched.h>
#include <signal.h>
#include <sys/mman.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <unistd.h>
#endif
#ifdef __linux__
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <sched.h>
#include <stddef.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#endif

#ifdef _WIN32
extern "C" int cmb_seccomp(void) { return -1; }
extern "C" int cmb_child_main(int, char **) { fprintf(stderr, "cm-plugbridge: not on Windows\n"); return 2; }
#else

// ------------------------------------------------------------------ the seccomp filter (Linux)
#ifdef __linux__
#if defined(__x86_64__)
#define CMB_ARCH AUDIT_ARCH_X86_64
#elif defined(__aarch64__)
#define CMB_ARCH AUDIT_ARCH_AARCH64
#elif defined(__arm__)
#define CMB_ARCH AUDIT_ARCH_ARM
#elif defined(__i386__)
#define CMB_ARCH AUDIT_ARCH_I386
#endif
#endif

extern "C" int cmb_seccomp(void) {
#if defined(__linux__) && defined(CMB_ARCH)
  // refused with EPERM: debugging other processes, mounting, kernel modules / bpf / perf, keyrings, new namespaces,
  // starting programs (after cm-plugbridge itself), the clock; socket(): only local (AF_UNIX) sockets; clone():
  // no new namespaces; clone3 says "not here" (ENOSYS) so the C library falls back to clone, whose flags we can see.
  static const int deny[] = {
#ifdef __NR_ptrace
    __NR_ptrace,
#endif
#ifdef __NR_process_vm_readv
    __NR_process_vm_readv, __NR_process_vm_writev,
#endif
#ifdef __NR_mount
    __NR_mount,
#endif
#ifdef __NR_umount2
    __NR_umount2,
#endif
#ifdef __NR_pivot_root
    __NR_pivot_root,
#endif
#ifdef __NR_chroot
    __NR_chroot,
#endif
#ifdef __NR_swapon
    __NR_swapon, __NR_swapoff,
#endif
#ifdef __NR_reboot
    __NR_reboot,
#endif
#ifdef __NR_kexec_load
    __NR_kexec_load,
#endif
#ifdef __NR_kexec_file_load
    __NR_kexec_file_load,
#endif
#ifdef __NR_init_module
    __NR_init_module, __NR_delete_module,
#endif
#ifdef __NR_finit_module
    __NR_finit_module,
#endif
#ifdef __NR_bpf
    __NR_bpf,
#endif
#ifdef __NR_perf_event_open
    __NR_perf_event_open,
#endif
#ifdef __NR_keyctl
    __NR_keyctl, __NR_add_key, __NR_request_key,
#endif
#ifdef __NR_unshare
    __NR_unshare,
#endif
#ifdef __NR_setns
    __NR_setns,
#endif
#ifdef __NR_personality
    __NR_personality,
#endif
#ifdef __NR_userfaultfd
    __NR_userfaultfd,
#endif
#ifdef __NR_acct
    __NR_acct,
#endif
#ifdef __NR_quotactl
    __NR_quotactl,
#endif
#ifdef __NR_open_by_handle_at
    __NR_open_by_handle_at, __NR_name_to_handle_at,
#endif
#ifdef __NR_iopl
    __NR_iopl,
#endif
#ifdef __NR_ioperm
    __NR_ioperm,
#endif
#ifdef __NR_settimeofday
    __NR_settimeofday,
#endif
#ifdef __NR_clock_settime
    __NR_clock_settime,
#endif
#ifdef __NR_execve
    __NR_execve,
#endif
#ifdef __NR_execveat
    __NR_execveat,
#endif
#ifdef __NR_socketpair
    __NR_socketpair,
#endif
  };
  const int nDeny = (int)(sizeof deny / sizeof deny[0]);
  std::vector<sock_filter> f;
  auto S = [&](uint16_t code, uint32_t k) { f.push_back(sock_filter{ code, 0, 0, k }); };
  auto J = [&](uint16_t code, uint32_t k, uint8_t jt, uint8_t jf) { f.push_back(sock_filter{ code, jt, jf, k }); };
  const uint32_t ALLOW = SECCOMP_RET_ALLOW, EPERM_ = SECCOMP_RET_ERRNO | (EPERM & SECCOMP_RET_DATA);
  S(BPF_LD | BPF_W | BPF_ABS, offsetof(seccomp_data, arch));
  J(BPF_JMP | BPF_JEQ | BPF_K, CMB_ARCH, 1, 0);
  S(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS);
  S(BPF_LD | BPF_W | BPF_ABS, offsetof(seccomp_data, nr));
#if defined(__x86_64__)
  J(BPF_JMP | BPF_JGE | BPF_K, 0x40000000u, 0, 1);   // (the x32 ABI: not here)
  S(BPF_RET | BPF_K, EPERM_);
#endif
  for (int i = 0; i < nDeny; i++) { J(BPF_JMP | BPF_JEQ | BPF_K, (uint32_t)deny[i], 0, 1); S(BPF_RET | BPF_K, EPERM_); }
#ifdef __NR_clone3
  J(BPF_JMP | BPF_JEQ | BPF_K, __NR_clone3, 0, 1); S(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (ENOSYS & SECCOMP_RET_DATA));
#endif
#ifdef __NR_clone
  {   // clone(flags, ...): no namespace flags
    const uint32_t ns = 0x00020000u /*NEWNS*/ | 0x02000000u /*NEWCGROUP*/ | 0x04000000u /*NEWUTS*/ | 0x08000000u /*NEWIPC*/ | 0x10000000u /*NEWUSER*/ | 0x20000000u /*NEWPID*/ | 0x40000000u /*NEWNET*/;
    J(BPF_JMP | BPF_JEQ | BPF_K, __NR_clone, 0, 4);
    S(BPF_LD | BPF_W | BPF_ABS, offsetof(seccomp_data, args[0]));
    J(BPF_JMP | BPF_JSET | BPF_K, ns, 0, 1);
    S(BPF_RET | BPF_K, EPERM_);
    S(BPF_RET | BPF_K, ALLOW);
  }
#endif
#ifdef __NR_socket
  {   // socket(family, ...): AF_UNIX only
    J(BPF_JMP | BPF_JEQ | BPF_K, __NR_socket, 0, 4);
    S(BPF_LD | BPF_W | BPF_ABS, offsetof(seccomp_data, args[0]));
    J(BPF_JMP | BPF_JEQ | BPF_K, 1 /*AF_UNIX*/, 1, 0);
    S(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (EAFNOSUPPORT & SECCOMP_RET_DATA));
    S(BPF_RET | BPF_K, ALLOW);
  }
#endif
  S(BPF_RET | BPF_K, ALLOW);
  sock_fprog prog{ (unsigned short)f.size(), f.data() };
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) return -1;
  if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &prog) != 0) return -1;
  return 0;
#elif defined(__APPLE__)
  return 0;   // (macOS: the wall is sandbox-exec's profile, applied before this program started)
#else
  return -1;
#endif
}

// ------------------------------------------------------------------ the child
using namespace ph;
static int ctlFd = -1;
static void sendLine(const std::string &s) {
  std::string l = s + "\n"; size_t off = 0;
  while (off < l.size()) { ssize_t w = write(ctlFd, l.data() + off, l.size() - off); if (w < 0 && errno == EINTR) continue; if (w <= 0) return; off += (size_t)w; }
}
static std::string jsonStr(const std::string &s) {
  std::string o = "\""; for (unsigned char c : s) { if (c == '"' || c == '\\') { o += '\\'; o += (char)c; } else if (c < 0x20) { char b[8]; snprintf(b, sizeof b, "\\u%04x", c); o += b; } else o += (char)c; }
  return o + "\"";
}

struct AudioArgs { Plug *p; CmbShm *m; int fd; std::atomic<bool> *quit; };
static void audioLoop(AudioArgs a) {
#ifdef __linux__
  { sched_param sp{}; sp.sched_priority = 60; pthread_setschedparam(pthread_self(), SCHED_FIFO, &sp); }   // (only where the device allows real-time; the rig's own thread is higher)
#endif
  std::vector<PhMidi> midi(CMB_MAXMIDI);
  for (;;) {
    uint32_t seq; ssize_t r = read(a.fd, &seq, sizeof seq);
    if (r < 0 && errno == EINTR) continue;
    if (r != (ssize_t)sizeof seq) break;   // the parent is gone
    __atomic_thread_fence(__ATOMIC_ACQUIRE);
    CmbShm *m = a.m; int n = (int)std::min<uint32_t>(m->frames, CMB_MAXBLOCK); int nm = (int)std::min<uint32_t>(m->nMidi, CMB_MAXMIDI);
    for (int i = 0; i < nm; i++) memcpy(midi[(size_t)i].d, m->midi[i], 3);
    auto t0 = std::chrono::steady_clock::now();
    bool noIn = (m->flags & 1) != 0;
    a.p->process(noIn ? nullptr : m->inL, noIn ? nullptr : m->inR, m->outL, m->outR, n, midi.data(), nm);
    m->lastUs = (uint32_t)std::chrono::duration_cast<std::chrono::microseconds>(std::chrono::steady_clock::now() - t0).count();
    __atomic_thread_fence(__ATOMIC_RELEASE);
    if (write(a.fd, &seq, sizeof seq) != (ssize_t)sizeof seq) break;
  }
  a.quit->store(true); _exit(0);   // (the parent closed the audio socket: nothing left to do)
}

extern "C" int cmb_child_main(int argc, char **argv) {
  if (argc < 9) { fprintf(stderr, "usage: cm-plugbridge <format> <id> <path> <audio fd> <control fd> <shm fd> <rate> <block>\n"); return 2; }
  std::string format = argv[1], id = argv[2], path = argv[3];
  int afd = atoi(argv[4]), sfd = atoi(argv[6]); ctlFd = atoi(argv[5]);
  double sr = atof(argv[7]); int block = atoi(argv[8]); if (sr < 8000 || sr > 384000) sr = 48000; if (block < 16 || block > CMB_MAXBLOCK) block = CMB_MAXBLOCK;
  signal(SIGPIPE, SIG_IGN);
  struct rlimit core = { 0, 0 }; setrlimit(RLIMIT_CORE, &core);
#ifdef __linux__
  // CPU and memory limits: a real-time thread that never yields for 0.2 s is killed (the rig then bypasses it - and
  // the parent's own budget check bypasses one that is merely too slow); at most 1.5 GB of its own memory
  { struct rlimit rt = { 100000, 200000 }; setrlimit(RLIMIT_RTTIME, &rt); struct rlimit dm = { (rlim_t)1536 << 20, (rlim_t)1536 << 20 }; setrlimit(RLIMIT_DATA, &dm); }
#endif
  CmbShm *m = (CmbShm *)mmap(nullptr, sizeof(CmbShm), PROT_READ | PROT_WRITE, MAP_SHARED, sfd, 0);
  if (m == MAP_FAILED || m->magic != CMB_MAGIC) { sendLine("E the plugin's audio couldn't be shared"); return 3; }
  close(sfd);
  if (cmb_seccomp() != 0) { sendLine("E the plugin's wall couldn't be put up on this device"); return 3; }
  // the plugin's own folder for anything it writes: the wall's empty /tmp (Linux) or its own temporary folder (macOS)
  const char *tmp = getenv("TMPDIR"); std::string data = std::string(tmp && tmp[0] ? tmp : "/tmp") + "/cm-plugbridge";
  ph_init(data.c_str(), nullptr);
  std::string err; Plug *p = openDirect(format, id, path, err);
  if (!p) { sendLine("E " + (err.empty() ? std::string("the plugin didn't load") : err)); return 4; }
  p->sampleRate = sr; p->maxBlock = block;
  if (!p->start(sr, block, err)) { sendLine("E " + (err.empty() ? std::string("the plugin didn't start") : err)); return 4; }
  m->latency = (uint32_t)std::max(0, p->latency());
  sendLine("R {\"name\":" + jsonStr(p->name) + ",\"vendor\":" + jsonStr(p->vendor) + ",\"id\":" + jsonStr(p->id) + ",\"instrument\":" + (p->instrument ? "true" : "false") + ",\"latency\":" + std::to_string(p->latency()) + "}");
  std::atomic<bool> quit{ false };
  std::thread(audioLoop, AudioArgs{ p, m, afd, &quit }).detach();
  // the main thread: control lines, the plugin's timers and idle
  std::string buf; char rb[8192]; uint64_t lastIdle = 0;
  while (!quit.load()) {
    pollfd pf{ ctlFd, POLLIN, 0 }; int wait = std::min(30, nextTimerMs());
    int r = poll(&pf, 1, wait);
    if (r < 0 && errno != EINTR) break;
    if (r > 0 && (pf.revents & (POLLIN | POLLHUP | POLLERR))) {
      ssize_t got = read(ctlFd, rb, sizeof rb);
      if (got <= 0) break;   // the parent is gone
      buf.append(rb, (size_t)got);
      size_t nl;
      while ((nl = buf.find('\n')) != std::string::npos) {
        std::string line = buf.substr(0, nl); buf.erase(0, nl + 1);
        if (line.empty()) continue;
        char c = line[0]; std::string arg = line.size() > 2 ? line.substr(2) : "";
        if (c == 'Q') { _exit(0); }
        else if (c == 'P') {
          int max = std::max(1, std::min(256, atoi(arg.c_str()) ? atoi(arg.c_str()) : 32)); std::string o = "P [";
          bool first = true; for (auto &q : p->params(max)) { char v[40]; snprintf(v, sizeof v, "%.6g", q.value); o += (first ? "" : ",") + std::string("{\"id\":") + std::to_string(q.id) + ",\"name\":" + jsonStr(q.name) + ",\"value\":" + v + ",\"text\":" + jsonStr(q.text) + "}"; first = false; }
          sendLine(o + "]");
        } else if (c == 'S') { unsigned long pid = 0; double v = 0; if (sscanf(arg.c_str(), "%lu %lf", &pid, &v) == 2) p->setParam((uint32_t)pid, std::min(1.0, std::max(0.0, v))); }
        else if (c == 'G') {
          std::vector<uint8_t> st; if (!p->saveState(st) || st.empty()) { sendLine("G -"); continue; }
          std::string enc(4 * ((st.size() + 2) / 3) + 1, '\0'); size_t k = cmb_b64_encode(st.data(), st.size(), &enc[0]); enc.resize(k); sendLine("G " + enc);
        } else if (c == 'L') {
          std::vector<uint8_t> st(arg.size() * 3 / 4 + 3); size_t k = cmb_b64_decode(arg.c_str(), st.data(), st.size()); st.resize(k);
          sendLine(std::string("L ") + (p->loadState(st) ? "1" : "0"));
        }
      }
      if (buf.size() > (64u << 20)) buf.clear();   // (no line is ever that long)
    }
    runPosted();
    uint64_t now = nowMs(); if (now - lastIdle >= 30) { lastIdle = now; p->idle(); }
  }
  _exit(0);
}
#endif
