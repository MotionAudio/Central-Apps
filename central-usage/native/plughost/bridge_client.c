/* bridge_client.c - the parent's side of a walled-off community plugin (see bridge.h): starts the child inside its
 * wall, passes each audio block over shared memory, and never lets a slow, hung or crashed plugin stop the sound. */
#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#include "bridge.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* base64 (states) - both platforms */
static const char B64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
size_t cmb_b64_encode(const uint8_t *in, size_t n, char *out) {
  size_t o = 0;
  for (size_t i = 0; i < n; i += 3) {
    uint32_t v = (uint32_t)in[i] << 16 | (i + 1 < n ? (uint32_t)in[i + 1] << 8 : 0) | (i + 2 < n ? in[i + 2] : 0);
    out[o++] = B64[v >> 18 & 63]; out[o++] = B64[v >> 12 & 63];
    out[o++] = i + 1 < n ? B64[v >> 6 & 63] : '='; out[o++] = i + 2 < n ? B64[v & 63] : '=';
  }
  out[o] = 0; return o;
}
size_t cmb_b64_decode(const char *in, uint8_t *out, size_t outMax) {
  uint32_t v = 0; int bits = 0; size_t o = 0;
  for (; *in; in++) {
    const char *p = strchr(B64, *in); if (*in == '=' || !p) continue;
    v = v << 6 | (uint32_t)(p - B64); bits += 6;
    if (bits >= 8) { bits -= 8; if (o < outMax) out[o++] = (uint8_t)(v >> bits & 0xFF); }
  }
  return o;
}
const char *cmb_state_word(int s) {
  return s == CMB_RUNNING ? "running" : s == CMB_CRASHED ? "crashed" : s == CMB_HUNG ? "stopped responding" : s == CMB_HEAVY_ ? "too heavy for this device" : s == CMB_STOPPED ? "stopped" : "didn't start";
}

#ifdef _WIN32
/* Windows: community plugins aren't walled off there yet, so they don't run at all (docs/COMMUNITY-PLUGINS.md) */
CmbClient *cmb_start(const char *const *argv, double sr, int mb, char *err, int errLen) { (void)argv; (void)sr; (void)mb; if (err) snprintf(err, (size_t)errLen, "community plugins can't run walled off on Windows yet"); return NULL; }
void cmb_process(CmbClient *c, const float *inL, const float *inR, float *outL, float *outR, int n, const uint8_t (*midi)[3], int nMidi) { (void)c; (void)midi; (void)nMidi; for (int i = 0; i < n; i++) { outL[i] = inL ? inL[i] : 0; outR[i] = inR ? inR[i] : 0; } }
int cmb_state(CmbClient *c) { (void)c; return CMB_FAILED; }
char *cmb_request(CmbClient *c, const char *l, int t) { (void)c; (void)l; (void)t; return NULL; }
int cmb_send(CmbClient *c, const char *l) { (void)c; (void)l; return 0; }
const char *cmb_info(CmbClient *c) { (void)c; return "{}"; }
void cmb_stop(CmbClient *c, int s) { (void)c; (void)s; }
void cmb_free(CmbClient *c) { (void)c; }
int cmb_pid(CmbClient *c) { (void)c; return 0; }
uint32_t cmb_budget_us(CmbClient *c) { (void)c; return 0; }
#else
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <sys/mman.h>
#include <sys/resource.h>
#include <sys/select.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
#ifdef __linux__
#include <sys/syscall.h>
#endif

struct CmbClient {
  pid_t pid; int audio, ctl, shmFd; CmbShm *shm;
  double sr; int maxBlock;
  volatile int state;              /* written by the audio thread (crash / hang / heavy) and the main thread */
  uint32_t seq, pendingSeq; int pending;
  uint64_t lastOkUs, startUs; double late; uint32_t budget;   /* late: the share of late blocks, averaged over ~CMB_HEAVY_MS */
  char info[1024]; char *rbuf; size_t rlen, rcap;
};

static uint64_t nowUs(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return (uint64_t)t.tv_sec * 1000000u + (uint64_t)t.tv_nsec / 1000u; }
static void setState(CmbClient *c, int s) { if (__atomic_load_n(&c->state, __ATOMIC_ACQUIRE) == CMB_RUNNING) __atomic_store_n(&c->state, s, __ATOMIC_RELEASE); }
int cmb_pid(CmbClient *c) { return c ? (int)c->pid : 0; }
uint32_t cmb_budget_us(CmbClient *c) { return c ? c->budget : 0; }
const char *cmb_info(CmbClient *c) { return c && c->info[0] ? c->info : "{}"; }

static int makeShm(void) {
#ifdef __linux__
#ifdef SYS_memfd_create
  int fd = (int)syscall(SYS_memfd_create, "cm-plugbridge", 0);
  if (fd >= 0) return fd;
#endif
  char tmpl[] = "/dev/shm/cm-plugbridge-XXXXXX"; int f = mkstemp(tmpl); if (f >= 0) unlink(tmpl); return f;
#else
  char name[64]; snprintf(name, sizeof name, "/cmb-%d-%ld", (int)getpid(), (long)(nowUs() & 0xFFFFFF));
  int fd = shm_open(name, O_RDWR | O_CREAT | O_EXCL, 0600); if (fd >= 0) shm_unlink(name); return fd;
#endif
}
static void cloexec(int fd, int on) { int f = fcntl(fd, F_GETFD); if (f >= 0) fcntl(fd, F_SETFD, on ? (f | FD_CLOEXEC) : (f & ~FD_CLOEXEC)); }

/* one line from the control socket (buffered; a state can be megabytes), waiting at most timeoutMs: malloc'd, or NULL */
#define CMB_MAXLINE (64u << 20)
static char *readLine(CmbClient *c, int timeoutMs) {
  uint64_t end = nowUs() + (uint64_t)timeoutMs * 1000u;
  for (;;) {
    char *nl = c->rlen ? (char *)memchr(c->rbuf, '\n', c->rlen) : NULL;
    if (nl) {
      size_t k = (size_t)(nl - c->rbuf); char *out = (char *)malloc(k + 1); if (!out) return NULL;
      memcpy(out, c->rbuf, k); out[k] = 0;
      memmove(c->rbuf, nl + 1, c->rlen - k - 1); c->rlen -= k + 1; return out;
    }
    if (c->rcap - c->rlen < 65536) {
      size_t cap = c->rcap ? c->rcap * 2 : 131072;
      if (cap > CMB_MAXLINE) c->rlen = 0;   /* (a line longer than any state: dropped) */
      else { char *b = (char *)realloc(c->rbuf, cap); if (!b) return NULL; c->rbuf = b; c->rcap = cap; }
    }
    uint64_t now = nowUs(); if (now >= end) return NULL;
    fd_set rs; FD_ZERO(&rs); FD_SET(c->ctl, &rs); uint64_t left = end - now;
    struct timeval tv = { (time_t)(left / 1000000u), (suseconds_t)(left % 1000000u) };
    int r = select(c->ctl + 1, &rs, NULL, NULL, &tv);
    if (r < 0 && errno == EINTR) continue;
    if (r <= 0) return NULL;
    ssize_t got = read(c->ctl, c->rbuf + c->rlen, c->rcap - c->rlen);
    if (got <= 0) return NULL;
    c->rlen += (size_t)got;
  }
}

CmbClient *cmb_start(const char *const *argv, double sr, int maxBlock, char *err, int errLen) {
  if (err && errLen) err[0] = 0;
  if (!argv || !argv[0]) { if (err) snprintf(err, (size_t)errLen, "no plugin host to run"); return NULL; }
  if (maxBlock > CMB_MAXBLOCK) maxBlock = CMB_MAXBLOCK;
  int a[2] = { -1, -1 }, k[2] = { -1, -1 }, shm = makeShm();
  if (shm < 0 || ftruncate(shm, (off_t)sizeof(CmbShm)) != 0 || socketpair(AF_UNIX, SOCK_STREAM, 0, a) != 0 || socketpair(AF_UNIX, SOCK_STREAM, 0, k) != 0) {
    if (err) snprintf(err, (size_t)errLen, "couldn't set up the plugin's audio (%s)", strerror(errno));
    if (shm >= 0) close(shm); for (int i = 0; i < 2; i++) { if (a[i] >= 0) close(a[i]); if (k[i] >= 0) close(k[i]); }
    return NULL;
  }
#ifdef SO_NOSIGPIPE   /* (macOS: no MSG_NOSIGNAL - a write to a plugin that died must never kill the rig) */
  { int one = 1; setsockopt(a[0], SOL_SOCKET, SO_NOSIGPIPE, &one, sizeof one); setsockopt(k[0], SOL_SOCKET, SO_NOSIGPIPE, &one, sizeof one); }
#endif
  CmbShm *m = (CmbShm *)mmap(NULL, sizeof(CmbShm), PROT_READ | PROT_WRITE, MAP_SHARED, shm, 0);
  if (m == MAP_FAILED) { if (err) snprintf(err, (size_t)errLen, "couldn't map the plugin's audio"); close(shm); close(a[0]); close(a[1]); close(k[0]); close(k[1]); return NULL; }
  memset(m, 0, sizeof *m); m->magic = CMB_MAGIC; m->version = 1;
  /* the full command line: argv + the three descriptors (3, 4, 5 in the child), the rate and the block */
  int n = 0; while (argv[n]) n++;
  char **av = (char **)calloc((size_t)n + 6, sizeof(char *)); char fa[3][4] = { "3", "4", "5" }, rate[32], blk[16];
  snprintf(rate, sizeof rate, "%.0f", sr); snprintf(blk, sizeof blk, "%d", maxBlock);
  for (int i = 0; i < n; i++) av[i] = (char *)argv[i];
  av[n] = fa[0]; av[n + 1] = fa[1]; av[n + 2] = fa[2]; av[n + 3] = rate; av[n + 4] = blk; av[n + 5] = NULL;
  /* the program, found before fork (exec in the child does nothing else) */
  char exe[4096] = "";
  if (strchr(argv[0], '/')) snprintf(exe, sizeof exe, "%s", argv[0]);
  else { const char *path = getenv("PATH"); if (!path) path = "/usr/bin:/bin"; char *dup = strdup(path), *save = NULL;
    for (char *d = strtok_r(dup, ":", &save); d; d = strtok_r(NULL, ":", &save)) { char cand[4096]; snprintf(cand, sizeof cand, "%s/%s", d, argv[0]); if (access(cand, X_OK) == 0) { snprintf(exe, sizeof exe, "%s", cand); break; } }
    free(dup); }
  if (!exe[0]) { if (err) snprintf(err, (size_t)errLen, "%s isn't installed on this device", argv[0]); munmap(m, sizeof *m); close(shm); close(a[0]); close(a[1]); close(k[0]); close(k[1]); free(av); return NULL; }
  pid_t pid = fork();
  if (pid == 0) {   /* the child: only async-signal-safe calls until exec */
    int fds[3] = { a[1], k[1], shm };
    for (int i = 0; i < 3; i++) { int t = fcntl(fds[i], F_DUPFD, 10); if (t < 0) _exit(126); fds[i] = t; }
    for (int i = 0; i < 3; i++) { if (dup2(fds[i], 3 + i) < 0) _exit(126); }
    for (int fd = 6; fd < 1024; fd++) close(fd);
    for (int i = 3; i < 6; i++) { int f = fcntl(i, F_GETFD); if (f >= 0) fcntl(i, F_SETFD, f & ~FD_CLOEXEC); }
    struct rlimit core = { 0, 0 }; setrlimit(RLIMIT_CORE, &core);
    struct rlimit nofile = { 256, 256 }; setrlimit(RLIMIT_NOFILE, &nofile);
    setpgid(0, 0);
    execv(exe, av);
    _exit(127);
  }
  free(av); close(a[1]); close(k[1]);
  if (pid < 0) { if (err) snprintf(err, (size_t)errLen, "couldn't start the plugin's process"); munmap(m, sizeof *m); close(shm); close(a[0]); close(k[0]); return NULL; }
  cloexec(a[0], 1); cloexec(k[0], 1); cloexec(shm, 1);
  CmbClient *c = (CmbClient *)calloc(1, sizeof *c);
  c->pid = pid; c->audio = a[0]; c->ctl = k[0]; c->shmFd = shm; c->shm = m; c->sr = sr > 0 ? sr : 48000; c->maxBlock = maxBlock; c->state = CMB_RUNNING;
  char *line = readLine(c, CMB_START_MS);
  if (!line) {
    int st = 0; pid_t w = waitpid(pid, &st, WNOHANG);
    if (err) snprintf(err, (size_t)errLen, "%s", w == pid ? (WIFEXITED(st) && WEXITSTATUS(st) == 127 ? "the plugin's host program isn't there" : "the plugin crashed while it loaded") : "the plugin took too long to load");
    cmb_stop(c, CMB_FAILED); cmb_free(c); return NULL;
  }
  if (line[0] == 'E') { if (err) snprintf(err, (size_t)errLen, "%s", line[1] ? line + 2 : "the plugin didn't load"); free(line); cmb_stop(c, CMB_FAILED); cmb_free(c); return NULL; }
  if (line[0] != 'R') { if (err) snprintf(err, (size_t)errLen, "the plugin's host answered something unexpected"); free(line); cmb_stop(c, CMB_FAILED); cmb_free(c); return NULL; }
  snprintf(c->info, sizeof c->info, "%s", line[1] ? line + 2 : "{}"); free(line);
  c->lastOkUs = c->startUs = nowUs();
  return c;
}

static void dry(const float *inL, const float *inR, float *outL, float *outR, int n) {
  for (int i = 0; i < n; i++) { outL[i] = inL ? inL[i] : 0.f; outR[i] = inR ? inR[i] : (inL ? inL[i] : 0.f); }
}
/* the replies the child has written so far (non-blocking): 1 when `want` came back; -1 when the socket is gone */
static int drain(CmbClient *c, uint32_t want, int *got) {
  *got = 0; uint32_t v;
  for (;;) {
    ssize_t r = recv(c->audio, &v, sizeof v, MSG_DONTWAIT);
    if (r == (ssize_t)sizeof v) { if (v == want) *got = 1; continue; }
    if (r == 0) return -1;
    if (r < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) return 0;
    if (r < 0 && errno == EINTR) continue;
    if (r < 0) return -1;
    /* (a partial 4-byte word never happens on a stream this small; treat as gone) */
    return -1;
  }
}

/* the share of late blocks (a ~CMB_HEAVY_MS running average): mostly late for that long -> too heavy */
static void account(CmbClient *c, int n, int late, uint64_t now) {
  double a = (double)n / (c->sr * CMB_HEAVY_MS / 1000.0); if (a > 1) a = 1;
  c->late += a * ((late ? 1.0 : 0.0) - c->late);
  if (c->late > CMB_HEAVY_SHARE && now - c->startUs > (uint64_t)CMB_HEAVY_MS * 1000u) setState(c, CMB_HEAVY_);
}
static void block(CmbClient *c, const float *inL, const float *inR, float *outL, float *outR, int n, const uint8_t (*midi)[3], int nMidi) {
  if (__atomic_load_n(&c->state, __ATOMIC_ACQUIRE) != CMB_RUNNING) { dry(inL, inR, outL, outR, n); return; }
  uint64_t now = nowUs();
  uint32_t budget = (uint32_t)((double)n / c->sr * 1e6 * 0.6); if (budget < 1000) budget = 1000; if (budget > 20000) budget = 20000;
  c->budget = budget;
  if (c->pending) {   /* the last block's answer is still out: see whether it came; this block plays dry (it is late) */
    int got = 0; if (drain(c, c->pendingSeq, &got) < 0) { setState(c, CMB_CRASHED); dry(inL, inR, outL, outR, n); return; }
    if (got) { c->pending = 0; c->lastOkUs = now; }
    else { if (now - c->lastOkUs > (uint64_t)CMB_HUNG_MS * 1000u) setState(c, CMB_HUNG); account(c, n, 1, now); dry(inL, inR, outL, outR, n); return; }
  }
  CmbShm *m = c->shm;
  m->frames = (uint32_t)n; m->flags = inL ? 0 : 1;
  if (inL) { memcpy(m->inL, inL, sizeof(float) * (size_t)n); memcpy(m->inR, inR ? inR : inL, sizeof(float) * (size_t)n); }
  m->nMidi = 0; for (int i = 0; i < nMidi && i < CMB_MAXMIDI; i++) { memcpy(m->midi[i], midi[i], 3); m->nMidi++; }
  uint32_t seq = ++c->seq;
  __atomic_thread_fence(__ATOMIC_RELEASE);
  ssize_t w = send(c->audio, &seq, sizeof seq, MSG_DONTWAIT
#ifdef MSG_NOSIGNAL
    | MSG_NOSIGNAL
#endif
  );
  if (w != (ssize_t)sizeof seq) { if (w < 0 && (errno == EAGAIN || errno == EINTR)) { account(c, n, 1, now); dry(inL, inR, outL, outR, n); return; } setState(c, CMB_CRASHED); dry(inL, inR, outL, outR, n); return; }
  uint64_t end = now + budget;
  for (;;) {
    uint64_t t = nowUs(); if (t >= end) break;
    fd_set rs; FD_ZERO(&rs); FD_SET(c->audio, &rs); uint64_t left = end - t;
    struct timeval tv = { 0, (suseconds_t)left };
    int r = select(c->audio + 1, &rs, NULL, NULL, &tv);
    if (r < 0 && errno == EINTR) continue;
    if (r <= 0) break;
    int got = 0; if (drain(c, seq, &got) < 0) { setState(c, CMB_CRASHED); dry(inL, inR, outL, outR, n); return; }
    if (got) {
      __atomic_thread_fence(__ATOMIC_ACQUIRE);
      memcpy(outL, m->outL, sizeof(float) * (size_t)n); memcpy(outR, m->outR, sizeof(float) * (size_t)n);
      for (int i = 0; i < n; i++) { if (!(outL[i] == outL[i]) || outL[i] > 64.f || outL[i] < -64.f) outL[i] = 0.f; if (!(outR[i] == outR[i]) || outR[i] > 64.f || outR[i] < -64.f) outR[i] = 0.f; }   /* (NaN / runaway never reaches the speakers) */
      c->lastOkUs = nowUs(); account(c, n, 0, c->lastOkUs);
      return;
    }
  }
  /* late: this block plays dry; the answer is picked up next time */
  c->pending = 1; c->pendingSeq = seq;
  if (nowUs() - c->lastOkUs > (uint64_t)CMB_HUNG_MS * 1000u) setState(c, CMB_HUNG);
  account(c, n, 1, now);
  dry(inL, inR, outL, outR, n);
}

void cmb_process(CmbClient *c, const float *inL, const float *inR, float *outL, float *outR, int n, const uint8_t (*midi)[3], int nMidi) {
  if (!c) { dry(inL, inR, outL, outR, n); return; }
  int done = 0;
  while (done < n) {
    int k = n - done; if (k > c->maxBlock) k = c->maxBlock; if (k > CMB_MAXBLOCK) k = CMB_MAXBLOCK;
    block(c, inL ? inL + done : NULL, inR ? inR + done : NULL, outL + done, outR + done, k, done ? NULL : midi, done ? 0 : nMidi);
    done += k;
  }
}

static void killChild(CmbClient *c) {
  if (c->pid > 0) {
    kill(-c->pid, SIGKILL); kill(c->pid, SIGKILL);
    for (int i = 0; i < 100; i++) { if (waitpid(c->pid, NULL, WNOHANG) == c->pid) { c->pid = 0; return; } usleep(10000); }
    c->pid = 0;
  }
}
int cmb_state(CmbClient *c) {
  if (!c) return CMB_FAILED;
  if (c->pid > 0) { int st; if (waitpid(c->pid, &st, WNOHANG) == c->pid) { c->pid = 0; setState(c, CMB_CRASHED); } }
  int s = __atomic_load_n(&c->state, __ATOMIC_ACQUIRE);
  if (s != CMB_RUNNING && c->pid > 0) killChild(c);
  return s;
}
int cmb_send(CmbClient *c, const char *line) {
  if (!c || cmb_state(c) != CMB_RUNNING) return 0;
  size_t n = strlen(line); char *b = (char *)malloc(n + 2); memcpy(b, line, n); b[n] = '\n';
  size_t off = 0; int ok = 1;
  while (off < n + 1) { ssize_t w = send(c->ctl, b + off, n + 1 - off,
#ifdef MSG_NOSIGNAL
    MSG_NOSIGNAL
#else
    0
#endif
  ); if (w <= 0) { if (w < 0 && errno == EINTR) continue; ok = 0; break; } off += (size_t)w; }
  free(b); return ok;
}
char *cmb_request(CmbClient *c, const char *line, int timeoutMs) {
  if (!cmb_send(c, line)) return NULL;
  uint64_t end = nowUs() + (uint64_t)timeoutMs * 1000u;
  while (nowUs() < end) {
    int left = (int)((end - nowUs()) / 1000u); if (left < 1) left = 1;
    char *got = readLine(c, left); if (!got) break;
    if (got[0] == line[0]) { size_t k = strlen(got); if (k >= 2) memmove(got, got + 2, k - 1); else got[0] = 0; return got; }   /* (a stray earlier answer is skipped) */
    free(got);
  }
  return NULL;
}
void cmb_stop(CmbClient *c, int state) {
  if (!c) return;
  setState(c, state);
  if (c->pid > 0) {
    if (state == CMB_STOPPED) { (void)!send(c->ctl, "Q\n", 2,
#ifdef MSG_NOSIGNAL
      MSG_NOSIGNAL
#else
      0
#endif
      ); for (int i = 0; i < 20; i++) { if (waitpid(c->pid, NULL, WNOHANG) == c->pid) { c->pid = 0; break; } usleep(10000); } }
    killChild(c);
  }
}
void cmb_free(CmbClient *c) {
  if (!c) return;
  if (c->pid > 0) killChild(c);
  if (c->shm) munmap(c->shm, sizeof(CmbShm));
  if (c->shmFd >= 0) close(c->shmFd);
  if (c->audio >= 0) close(c->audio);
  if (c->ctl >= 0) close(c->ctl);
  free(c->rbuf); free(c);
}
#endif
