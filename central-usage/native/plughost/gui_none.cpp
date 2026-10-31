// gui_none.cpp - no editor windows: cm-plugbridge (one community plugin, walled off) can't reach the window system from
// inside its wall, so the plugin runs without its own window; the app's quick controls set its parameters.
#include "ph.hpp"
namespace ph {
const char *windowApi() { return ""; }
Window *makeWindow(const std::string &, int, int, bool) { return nullptr; }
void wake() {}
}  // namespace ph
extern "C" int ph_run(void (*)(char *), void (*)(void)) { return 0; }
