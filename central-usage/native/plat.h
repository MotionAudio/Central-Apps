/* plat.h - the few operating-system pieces the native helpers need, for Linux, macOS and Windows:
 * threads, a mutex + condition, monotonic time and sleeping, loading a shared library at run time,
 * and binary stdin / stdout. Header only. */
#ifndef CU_PLAT_H
#define CU_PLAT_H
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <mmsystem.h>
#include <io.h>
#include <fcntl.h>

typedef HANDLE pl_thread;
typedef CRITICAL_SECTION pl_mutex;
typedef CONDITION_VARIABLE pl_cond;
typedef struct { void *(*fn)(void *); void *arg; } pl_tramp;
static DWORD WINAPI pl_tramp_run(LPVOID p) { pl_tramp t = *(pl_tramp *)p; free(p); t.fn(t.arg); return 0; }
static inline int pl_thread_start(pl_thread *t, void *(*fn)(void *), void *arg) {
  pl_tramp *p = malloc(sizeof *p); if (!p) return -1; p->fn = fn; p->arg = arg;
  *t = CreateThread(NULL, 0, pl_tramp_run, p, 0, NULL); return *t ? 0 : -1;
}
static inline void pl_thread_join(pl_thread t) { WaitForSingleObject(t, INFINITE); CloseHandle(t); }
static inline void pl_mutex_init(pl_mutex *m) { InitializeCriticalSection(m); }
static inline void pl_mutex_lock(pl_mutex *m) { EnterCriticalSection(m); }
static inline void pl_mutex_unlock(pl_mutex *m) { LeaveCriticalSection(m); }
static inline void pl_cond_init(pl_cond *c) { InitializeConditionVariable(c); }
static inline void pl_cond_signal(pl_cond *c) { WakeConditionVariable(c); }
static inline void pl_cond_wait_ms(pl_cond *c, pl_mutex *m, int ms) { SleepConditionVariableCS(c, m, (DWORD)ms); }
static inline uint64_t pl_now_ns(void) {
  static LARGE_INTEGER f; LARGE_INTEGER c; if (!f.QuadPart) QueryPerformanceFrequency(&f); QueryPerformanceCounter(&c);
  return (uint64_t)((double)c.QuadPart * 1e9 / (double)f.QuadPart);
}
static inline void pl_sleep_ms(int ms) { Sleep((DWORD)ms); }
static inline void pl_sleep_until_ns(uint64_t t) {   /* coarse sleep, then yield to the deadline */
  static int periodSet; if (!periodSet) { periodSet = 1; timeBeginPeriod(1); }
  for (;;) { uint64_t now = pl_now_ns(); if (now >= t) return; uint64_t left = t - now; if (left > 2000000) Sleep((DWORD)(left / 1000000 - 1)); else SwitchToThread(); }
}
static inline void *pl_dlopen(const char *name) { return (void *)LoadLibraryA(name); }
static inline void *pl_dlsym(void *lib, const char *sym) { return (void *)(uintptr_t)GetProcAddress((HMODULE)lib, sym); }
static inline long pl_read(void *buf, size_t n) { return (long)_read(0, buf, (unsigned)n); }
static inline void pl_binary_stdio(void) { _setmode(_fileno(stdin), _O_BINARY); _setmode(_fileno(stdout), _O_BINARY); }
static inline void pl_ignore_sigpipe(void) { }
#if defined(__GNUC__)
#define PL_THREAD_LOCAL __thread
#else
#define PL_THREAD_LOCAL __declspec(thread)
#endif

#else
#include <dlfcn.h>
#include <errno.h>
#include <pthread.h>
#include <signal.h>
#include <time.h>
#include <unistd.h>

typedef pthread_t pl_thread;
typedef pthread_mutex_t pl_mutex;
typedef pthread_cond_t pl_cond;
static inline int pl_thread_start(pl_thread *t, void *(*fn)(void *), void *arg) { return pthread_create(t, NULL, fn, arg); }
static inline void pl_thread_join(pl_thread t) { pthread_join(t, NULL); }
static inline void pl_mutex_init(pl_mutex *m) { pthread_mutex_init(m, NULL); }
static inline void pl_mutex_lock(pl_mutex *m) { pthread_mutex_lock(m); }
static inline void pl_mutex_unlock(pl_mutex *m) { pthread_mutex_unlock(m); }
static inline void pl_cond_init(pl_cond *c) { pthread_cond_init(c, NULL); }
static inline void pl_cond_signal(pl_cond *c) { pthread_cond_signal(c); }
static inline void pl_cond_wait_ms(pl_cond *c, pl_mutex *m, int ms) {
  struct timespec t; clock_gettime(CLOCK_REALTIME, &t); t.tv_nsec += (long)ms * 1000000L;
  while (t.tv_nsec >= 1000000000L) { t.tv_nsec -= 1000000000L; t.tv_sec++; }
  pthread_cond_timedwait(c, m, &t);
}
static inline uint64_t pl_now_ns(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return (uint64_t)t.tv_sec * 1000000000ULL + (uint64_t)t.tv_nsec; }
static inline void pl_sleep_ms(int ms) { usleep((useconds_t)ms * 1000); }
static inline void pl_sleep_until_ns(uint64_t t) {
  for (;;) { uint64_t now = pl_now_ns(); if (now >= t) return; uint64_t left = t - now; struct timespec d = { (time_t)(left / 1000000000ULL), (long)(left % 1000000000ULL) }; nanosleep(&d, NULL); }
}
static inline void *pl_dlopen(const char *name) { return dlopen(name, RTLD_NOW | RTLD_LOCAL); }
static inline void *pl_dlsym(void *lib, const char *sym) { return dlsym(lib, sym); }
static inline long pl_read(void *buf, size_t n) { for (;;) { ssize_t k = read(0, buf, n); if (k < 0 && errno == EINTR) continue; return (long)k; } }
static inline void pl_binary_stdio(void) { }
static inline void pl_ignore_sigpipe(void) { signal(SIGPIPE, SIG_IGN); }
#define PL_THREAD_LOCAL __thread
#endif

#endif
