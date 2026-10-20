// gui_mac.mm - macOS: the main loop (an NSApplication without a Dock icon: stdin lines and posted work arrive on the
// main queue, a timer runs plugins' timers and idle) and the editor windows (NSWindow; plugins attach to its view).
#ifdef __APPLE__
#import <Cocoa/Cocoa.h>
#include <atomic>
#include <cstdio>
#include <string>
#include <thread>
#include "ph.hpp"

namespace ph { struct MacWin; }

@interface PHWindowDelegate : NSObject <NSWindowDelegate>
@property(nonatomic, assign) ph::MacWin *owner;
@end

namespace ph {
static std::atomic<bool> inPosted{ false };
static void safeRun() { if (inPosted.exchange(true)) return; runPosted(); inPosted = false; }   // (never inside itself: a plugin may run a nested loop)
void wake() { dispatch_async(dispatch_get_main_queue(), ^{ safeRun(); }); }
const char *windowApi() { return "cocoa"; }

struct MacWin : Window {
  NSWindow *win = nil; PHWindowDelegate *del = nil; bool sizing = false;
  MacWin(const std::string &title, int w, int h, bool resizable) {
    NSWindowStyleMask style = NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | (resizable ? NSWindowStyleMaskResizable : 0);
    win = [[NSWindow alloc] initWithContentRect:NSMakeRect(120, 120, w, h) styleMask:style backing:NSBackingStoreBuffered defer:NO];
    [win setReleasedWhenClosed:NO];
    [win setTitle:[NSString stringWithUTF8String:title.c_str()]];
    [win setBackgroundColor:[NSColor colorWithCalibratedRed:0x15 / 255.0 green:0x18 / 255.0 blue:0x1D / 255.0 alpha:1]];
    del = [[PHWindowDelegate alloc] init]; del.owner = this; [win setDelegate:del];
    [win center];
  }
  ~MacWin() override { [win setDelegate:nil]; del.owner = nullptr; [win orderOut:nil]; [win close]; [del release]; [win release]; }
  void *native() override { return (void *)[win contentView]; }
  void resize(int w, int h) override { sizing = true; [win setContentSize:NSMakeSize(w, h)]; sizing = false; }
  void show() override { [win makeKeyAndOrderFront:nil]; [NSApp activateIgnoringOtherApps:YES]; }
};
Window *makeWindow(const std::string &title, int w, int h, bool resizable) { return new MacWin(title, w < 64 ? 64 : w, h < 48 ? 48 : h, resizable); }
}  // namespace ph

@implementation PHWindowDelegate
- (BOOL)windowShouldClose:(NSWindow *)sender {
  (void)sender; ph::MacWin *o = self.owner;
  if (o && o->onClose) { auto f = o->onClose; f(); }
  return NO;   // (the plugin host closes it, after the plugin has let go of it)
}
- (void)windowDidResize:(NSNotification *)n {
  (void)n; ph::MacWin *o = self.owner; if (!o || o->sizing || !o->onResized) return;
  NSRect r = [[o->win contentView] frame]; o->onResized((int)r.size.width, (int)r.size.height);
}
@end

using namespace ph;
static void (*gQuit)(void);

extern "C" int ph_run(void (*onLine)(char *), void (*onQuit)(void)) {
  @autoreleasepool {
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];   // windows, but no Dock icon or menu bar of its own
    gQuit = onQuit;
    std::thread([onLine] {
      std::string acc; char buf[65536];
      while (fgets(buf, sizeof buf, stdin)) {
        acc += buf; if (acc.empty() || acc.back() != '\n') continue;
        std::string line = acc; acc.clear();
        post([onLine, line] { std::string t = line; while (!t.empty() && (t.back() == '\n' || t.back() == '\r')) t.pop_back(); if (!t.empty()) onLine(&t[0]); });
      }
      dispatch_async(dispatch_get_main_queue(), ^{ runPosted(); if (gQuit) gQuit(); exit(0); });   // stdin closed: the app quit
    }).detach();
    NSTimer *t = [NSTimer timerWithTimeInterval:0.015 repeats:YES block:^(NSTimer *timer) { (void)timer; ph::safeRun(); }];
    [[NSRunLoop mainRunLoop] addTimer:t forMode:NSRunLoopCommonModes];
    [NSApp run];
  }
  return 0;
}
#endif
