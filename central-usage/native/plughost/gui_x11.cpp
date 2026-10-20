// gui_x11.cpp - Linux: the main loop (stdin lines, posted work, timers, plugins' file descriptors, X11 events) and the
// editor windows (X11; libX11 is loaded at run time, so the rig still runs without a display).
#if !defined(_WIN32) && !defined(__APPLE__)
#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <dlfcn.h>
#include <fcntl.h>
#include <poll.h>
#include <unistd.h>
#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <map>
#include <string>
#include <thread>
#include "ph.hpp"

namespace ph {

// ---- libX11, loaded when the first window is wanted
static struct {
  void *lib; int tried; Display *dpy; Atom wmDelete;
  Display *(*OpenDisplay)(const char *); int (*ConnNum)(Display *); int (*Pending)(Display *); int (*NextEvent)(Display *, XEvent *);
  ::Window (*CreateSimpleWindow)(Display *, ::Window, int, int, unsigned, unsigned, unsigned, unsigned long, unsigned long);
  int (*MapRaised)(Display *, ::Window); int (*StoreName)(Display *, ::Window, const char *); int (*SelectInput)(Display *, ::Window, long);
  Atom (*InternAtom)(Display *, const char *, Bool); Status (*SetWMProtocols)(Display *, ::Window, Atom *, int); int (*ResizeWindow)(Display *, ::Window, unsigned, unsigned);
  int (*DestroyWindow)(Display *, ::Window); int (*Flush)(Display *); int (*Sync)(Display *, Bool); void (*SetWMNormalHints)(Display *, ::Window, XSizeHints *);
  XSizeHints *(*AllocSizeHints)(void); int (*Free)(void *); Status (*InitThreads)(void);
  Status (*QueryTree)(Display *, ::Window, ::Window *, ::Window *, ::Window **, unsigned *); Status (*GetWindowAttributes)(Display *, ::Window, XWindowAttributes *);
} X;
static bool xOpen() {
  if (X.dpy) return true; if (X.tried) return false; X.tried = 1;
  if (!getenv("DISPLAY") || !getenv("DISPLAY")[0]) return false;
  X.lib = dlopen("libX11.so.6", RTLD_NOW | RTLD_GLOBAL); if (!X.lib) return false;
#define L(n) *(void **)&X.n = dlsym(X.lib, "X" #n); if (!X.n) return false;
  *(void **)&X.ConnNum = dlsym(X.lib, "XConnectionNumber"); if (!X.ConnNum) return false;
  L(OpenDisplay) L(Pending) L(NextEvent) L(CreateSimpleWindow) L(MapRaised) L(StoreName) L(SelectInput) L(InternAtom) L(SetWMProtocols) L(ResizeWindow) L(DestroyWindow) L(Flush) L(Sync) L(SetWMNormalHints) L(AllocSizeHints) L(Free) L(InitThreads) L(QueryTree) L(GetWindowAttributes)
#undef L
  X.InitThreads(); X.dpy = X.OpenDisplay(nullptr); if (!X.dpy) return false;
  X.wmDelete = X.InternAtom(X.dpy, "WM_DELETE_WINDOW", False); return true;
}
const char *windowApi() { return xOpen() ? "x11" : ""; }

struct XWin : Window {
  ::Window w = 0; int width, height; bool resizable;
  static std::map<::Window, XWin *> &all() { static std::map<::Window, XWin *> m; return m; }
  XWin(const std::string &title, int ww, int hh, bool rs) : width(ww), height(hh), resizable(rs) {
    w = X.CreateSimpleWindow(X.dpy, DefaultRootWindow(X.dpy), 80, 80, (unsigned)ww, (unsigned)hh, 0, 0, 0x15181D);
    X.StoreName(X.dpy, w, title.c_str()); X.SelectInput(X.dpy, w, StructureNotifyMask); X.SetWMProtocols(X.dpy, w, &X.wmDelete, 1);
    hints(); all()[w] = this; X.Sync(X.dpy, False);
  }
  void hints() { XSizeHints *h = X.AllocSizeHints(); if (!h) return; if (!resizable) { h->flags = PMinSize | PMaxSize; h->min_width = h->max_width = width; h->min_height = h->max_height = height; } else { h->flags = PMinSize; h->min_width = 120; h->min_height = 80; } X.SetWMNormalHints(X.dpy, w, h); X.Free(h); }
  ~XWin() override { all().erase(w); X.DestroyWindow(X.dpy, w); X.Flush(X.dpy); }
  void *native() override { return (void *)(uintptr_t)w; }
  void resize(int ww, int hh) override { width = ww; height = hh; hints(); X.ResizeWindow(X.dpy, w, (unsigned)ww, (unsigned)hh); X.Flush(X.dpy); }
  void show() override { X.MapRaised(X.dpy, w); X.Flush(X.dpy); }
  bool fitChild() override {
    ::Window root, parent, *kids = nullptr; unsigned n = 0; X.Sync(X.dpy, False);
    if (!X.QueryTree(X.dpy, w, &root, &parent, &kids, &n) || !n) { if (kids) X.Free(kids); return false; }
    XWindowAttributes a; bool ok = X.GetWindowAttributes(X.dpy, kids[0], &a) && a.width > 16 && a.height > 16; X.Free(kids);
    if (ok && (a.width != width || a.height != height)) resize(a.width, a.height); return ok;
  }
};
Window *makeWindow(const std::string &title, int w, int h, bool resizable) { if (!xOpen()) return nullptr; return new XWin(title, w < 64 ? 64 : w, h < 48 ? 48 : h, resizable); }
static void xEvents() {
  if (!X.dpy) return;
  while (X.Pending(X.dpy)) {
    XEvent e; X.NextEvent(X.dpy, &e);
    auto it = XWin::all().find(e.xany.window); if (it == XWin::all().end()) continue; XWin *w = it->second;
    if (e.type == ClientMessage && (Atom)e.xclient.data.l[0] == X.wmDelete) { if (w->onClose) { auto f = w->onClose; f(); } }
    else if (e.type == ConfigureNotify && (e.xconfigure.width != w->width || e.xconfigure.height != w->height)) { w->width = e.xconfigure.width; w->height = e.xconfigure.height; if (w->onResized) w->onResized(w->width, w->height); }
  }
}

// ---- the main loop
static int wakeFd[2] = { -1, -1 };
void wake() { if (wakeFd[1] >= 0) { char c = 1; if (write(wakeFd[1], &c, 1) < 0) { } } }
}  // namespace ph
using namespace ph;

extern "C" int ph_run(void (*onLine)(char *), void (*onQuit)(void)) {
  if (pipe(wakeFd) == 0) { fcntl(wakeFd[0], F_SETFL, O_NONBLOCK); fcntl(wakeFd[1], F_SETFL, O_NONBLOCK); }
  static std::atomic<bool> quit{ false };
  std::thread([onLine] {
    char *line = nullptr; size_t cap = 0; ssize_t n;
    while ((n = getline(&line, &cap, stdin)) >= 0) { std::string s(line, (size_t)n); post([onLine, s] { std::string t = s; while (!t.empty() && (t.back() == '\n' || t.back() == '\r')) t.pop_back(); if (!t.empty()) onLine(&t[0]); }); }
    free(line); post([] { quit = true; });
  }).detach();
  while (!quit) {
    std::vector<pollfd> fds; fds.push_back({ wakeFd[0], POLLIN, 0 });
    if (X.dpy) fds.push_back({ X.ConnNum(X.dpy), POLLIN, 0 });
    size_t first = fds.size(); for (auto &w : fdWatches) fds.push_back({ w.fd, POLLIN, 0 });
    int t = nextTimerMs(); if (X.dpy && X.Pending(X.dpy)) t = 0;
    poll(fds.data(), fds.size(), t);
    if (fds[0].revents) { char b[256]; while (read(wakeFd[0], b, sizeof b) > 0) { } }
    xEvents();
    for (size_t i = first; i < fds.size(); i++) if (fds[i].revents) { int fd = fds[i].fd; for (auto &w : fdWatches) if (w.fd == fd) { auto f = w.fn; f(fd); break; } }
    runPosted();
  }
  if (onQuit) onQuit();
  return 0;
}
#endif
