// gui_win.cpp - Windows: the main loop (stdin lines, posted work, timers, window messages) and the editor windows.
#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <ole2.h>
#include <atomic>
#include <cstdio>
#include <string>
#include <thread>
#include "ph.hpp"

namespace ph {
static HANDLE wakeEvent;
void wake() { if (wakeEvent) SetEvent(wakeEvent); }
const char *windowApi() { return "win32"; }
static std::wstring W(const std::string &s) { int n = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, NULL, 0); std::wstring r(n ? n - 1 : 0, 0); if (n) MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, &r[0], n); return r; }

struct WinWin : Window {
  HWND hwnd = nullptr; bool resizable; bool sizing = false;
  static LRESULT CALLBACK proc(HWND h, UINT m, WPARAM w, LPARAM l) {
    auto *self = (WinWin *)GetWindowLongPtrW(h, GWLP_USERDATA);
    if (m == WM_NCCREATE) { auto *cs = (CREATESTRUCTW *)l; SetWindowLongPtrW(h, GWLP_USERDATA, (LONG_PTR)cs->lpCreateParams); }
    if (self) {
      if (m == WM_CLOSE) { if (self->onClose) { auto f = self->onClose; f(); } return 0; }
      if (m == WM_SIZE && !self->sizing && self->onResized && w != SIZE_MINIMIZED) self->onResized(LOWORD(l), HIWORD(l));
      if (m == WM_ERASEBKGND) { RECT r; GetClientRect(h, &r); HBRUSH b = CreateSolidBrush(RGB(0x15, 0x18, 0x1D)); FillRect((HDC)w, &r, b); DeleteObject(b); return 1; }
    }
    return DefWindowProcW(h, m, w, l);
  }
  DWORD style() const { return resizable ? WS_OVERLAPPEDWINDOW : (WS_OVERLAPPEDWINDOW & ~(WS_THICKFRAME | WS_MAXIMIZEBOX)); }
  WinWin(const std::string &title, int w, int h, bool rs) : resizable(rs) {
    static bool registered = false;
    if (!registered) { WNDCLASSEXW wc{}; wc.cbSize = sizeof wc; wc.lpfnWndProc = proc; wc.hInstance = GetModuleHandleW(NULL); wc.lpszClassName = L"CentralPluginWindow"; wc.hCursor = LoadCursor(NULL, IDC_ARROW); wc.hIcon = LoadIcon(NULL, IDI_APPLICATION); RegisterClassExW(&wc); registered = true; }
    RECT r{ 0, 0, w, h }; AdjustWindowRectEx(&r, style(), FALSE, 0);
    hwnd = CreateWindowExW(0, L"CentralPluginWindow", W(title).c_str(), style() | WS_CLIPCHILDREN, CW_USEDEFAULT, CW_USEDEFAULT, r.right - r.left, r.bottom - r.top, NULL, NULL, GetModuleHandleW(NULL), this);
  }
  ~WinWin() override { if (hwnd) { SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0); DestroyWindow(hwnd); } }
  void *native() override { return (void *)hwnd; }
  void resize(int w, int h) override { RECT r{ 0, 0, w, h }; AdjustWindowRectEx(&r, style(), FALSE, 0); sizing = true; SetWindowPos(hwnd, NULL, 0, 0, r.right - r.left, r.bottom - r.top, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE); sizing = false; }
  void show() override { ShowWindow(hwnd, SW_SHOWNORMAL); SetForegroundWindow(hwnd); BringWindowToTop(hwnd); }
};
Window *makeWindow(const std::string &title, int w, int h, bool resizable) { auto *x = new WinWin(title, w < 64 ? 64 : w, h < 48 ? 48 : h, resizable); if (!x->hwnd) { delete x; return nullptr; } return x; }
}  // namespace ph
using namespace ph;

static std::atomic<bool> quitting{ false };
static bool inPosted = false;
static void CALLBACK tick(HWND, UINT, UINT_PTR, DWORD) { if (!inPosted) { inPosted = true; runPosted(); inPosted = false; } }   // (also runs inside a window's own move/size loop)

extern "C" int ph_run(void (*onLine)(char *), void (*onQuit)(void)) {
  OleInitialize(NULL);
  { typedef BOOL(WINAPI * SetCtx)(HANDLE); auto f = (SetCtx)(void *)GetProcAddress(GetModuleHandleW(L"user32.dll"), "SetProcessDpiAwarenessContext"); if (f) f((HANDLE)-4); }   // per-monitor aware: plugin windows stay sharp
  wakeEvent = CreateEventW(NULL, FALSE, FALSE, NULL);
  std::thread([onLine] {
    std::string acc; char buf[65536];
    while (fgets(buf, sizeof buf, stdin)) {
      acc += buf; if (acc.empty() || acc.back() != '\n') continue;
      std::string line = acc; acc.clear();
      post([onLine, line] { std::string t = line; while (!t.empty() && (t.back() == '\n' || t.back() == '\r')) t.pop_back(); if (!t.empty()) onLine(&t[0]); });
    }
    post([] { quitting = true; });
  }).detach();
  SetTimer(NULL, 0, 15, tick);
  while (!quitting) {
    DWORD t = (DWORD)nextTimerMs();
    MsgWaitForMultipleObjects(1, &wakeEvent, FALSE, t, QS_ALLINPUT);
    MSG m; while (PeekMessageW(&m, NULL, 0, 0, PM_REMOVE)) { TranslateMessage(&m); DispatchMessageW(&m); }
    if (!inPosted) { inPosted = true; runPosted(); inPosted = false; }
  }
  if (onQuit) onQuit();
  OleUninitialize();
  return 0;
}
#endif
