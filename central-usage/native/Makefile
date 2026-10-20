# Central Usage native helpers:
#   cu-mixer  the audio engine (JACK on Linux; Windows / macOS / Linux audio devices through miniaudio)
#   cu-ndi    the NDI sender (the NDI runtime is loaded at run time)
#   cu-rig    the instrument rig for Windows / macOS (built-in effects + SoundFont keys), and the musician's own
#             plugins on every computer (plughost/: VST3, CLAP; Audio Units on macOS; LV2 on Linux) - C++
#   test-plugins/  test CLAP and VST3 plugins for test-rig.mjs (never shipped)
#   rig-map.json  which built-in effect plays each pedal (made from js/pedals.js)
# No JACK / NDI headers needed. Third-party sources are in vendor/. Linux also needs the X11, lilv and suil headers
# (libx11-dev liblilv-dev libsuil-dev lv2-dev; the libraries themselves are loaded at run time, if they are there).
#   make                    this computer (Linux: gcc, macOS: clang universal arm64 + x86_64)
#   make TARGET=win         Windows x64 from Linux (x86_64-w64-mingw32-gcc) or from MSYS2 / MinGW
CFLAGS ?= -O2 -Wall -Wno-misleading-indentation -Wno-format-nonliteral -Wno-format-security -Wno-format-truncation -Wno-unused-function -Wno-unknown-warning-option
UNAME := $(shell uname -s)
EXE :=
CXXFLAGS ?= -O2 -std=c++17 -Wall -Wno-unused-parameter -Wno-missing-field-initializers -Wno-misleading-indentation -Wno-unknown-warning-option
VST3 := vendor/vst3sdk/pluginterfaces/base/funknown.cpp vendor/vst3sdk/pluginterfaces/base/coreiids.cpp vendor/vst3sdk/public.sdk/source/vst/vstinitiids.cpp vendor/vst3sdk/public.sdk/source/common/commoniids.cpp
PHSRC := plughost/host.cpp plughost/fmt_clap.cpp plughost/fmt_vst3.cpp $(VST3)
PHFLAGS := -Ivendor/vst3sdk -DPH_VST3
ifeq ($(TARGET),win)
  ifneq (,$(findstring MINGW,$(UNAME))$(findstring MSYS,$(UNAME)))
    CC := gcc
    CXX := g++
  else
    CC := x86_64-w64-mingw32-gcc
    CXX := $(shell command -v x86_64-w64-mingw32-g++-posix || echo x86_64-w64-mingw32-g++)
  endif
  EXE := .exe
  LIBS := -lole32 -lwinmm -static
  RIGLIBS := -lole32 -lwinmm -luuid -lgdi32 -luser32 -static
  NDILIBS := -static
  PHSRC += plughost/gui_win.cpp
  PLAT := win
else ifneq (,$(findstring MINGW,$(UNAME))$(findstring MSYS,$(UNAME)))
  CC := gcc
  CXX := g++
  EXE := .exe
  LIBS := -lole32 -lwinmm -static
  RIGLIBS := -lole32 -lwinmm -luuid -lgdi32 -luser32 -static
  NDILIBS := -static
  PHSRC += plughost/gui_win.cpp
  PLAT := win
else ifeq ($(UNAME),Darwin)
  ARCH ?= -arch arm64 -arch x86_64
  CFLAGS += $(ARCH) -mmacosx-version-min=11.0
  CXXFLAGS += $(ARCH) -mmacosx-version-min=11.0
  CXX := clang++
  LIBS := -framework CoreFoundation -framework CoreAudio -framework AudioToolbox -lpthread -lm
  RIGLIBS := $(LIBS) -framework Cocoa -framework AudioUnit -framework CoreAudioKit
  NDILIBS :=
  PHSRC += plughost/gui_mac.mm plughost/fmt_au.mm
  PLAT := mac
else
  LIBS := -lm -ldl -lpthread
  RIGLIBS := $(LIBS)
  NDILIBS := -ldl
  CXX ?= g++
  PHSRC += plughost/gui_x11.cpp plughost/fmt_lv2.cpp
  PHFLAGS += -DPH_LV2 $(shell pkg-config --cflags lilv-0 suil-0 2>/dev/null || echo -I/usr/include/lilv-0 -I/usr/include/suil-0)
  PLAT := linux
endif
OUT ?= build
all: $(OUT)/cu-mixer$(EXE) $(OUT)/cu-ndi$(EXE) $(OUT)/cu-rig$(EXE) $(OUT)/rig-map.json $(OUT)/test-plugins/central-test.clap
$(OUT)/cu-mixer$(EXE): cu-mixer.c plat.h
	mkdir -p $(OUT) && $(CC) $(CFLAGS) -o $@ cu-mixer.c $(LIBS)
$(OUT)/cu-ndi$(EXE): cu-ndi.c plat.h
	mkdir -p $(OUT) && $(CC) $(CFLAGS) -o $@ cu-ndi.c $(NDILIBS)
# cu-rig: C (the rig) + C++ / Objective-C++ (the plugin host), linked as C++
PHOBJ := $(patsubst %,$(OUT)/obj/%.o,$(PHSRC))
$(OUT)/obj/%.cpp.o: %.cpp plughost/ph.hpp plughost/plughost.h
	mkdir -p $(dir $@) && $(CXX) $(CXXFLAGS) $(PHFLAGS) -c -o $@ $<
$(OUT)/obj/%.mm.o: %.mm plughost/ph.hpp plughost/plughost.h
	mkdir -p $(dir $@) && $(CXX) $(CXXFLAGS) $(PHFLAGS) -ObjC++ -c -o $@ $<
$(OUT)/obj/cu-rig.o: cu-rig.c plat.h plughost/plughost.h
	mkdir -p $(dir $@) && $(CC) $(CFLAGS) -c -o $@ cu-rig.c
$(OUT)/obj/cJSON.o: vendor/cJSON.c
	mkdir -p $(dir $@) && $(CC) $(CFLAGS) -c -o $@ vendor/cJSON.c
$(OUT)/cu-rig$(EXE): $(OUT)/obj/cu-rig.o $(OUT)/obj/cJSON.o $(PHOBJ)
	mkdir -p $(OUT) && $(CXX) $(CXXFLAGS) -o $@ $^ $(RIGLIBS)
$(OUT)/test-plugins/central-test.clap: plughost/test/test-plugins.c plughost/test/test-vst3.cpp plughost/test/make-test-plugins.sh
	CC="$(CC)" CXX="$(CXX)" bash plughost/test/make-test-plugins.sh $(OUT) $(PLAT) "$(ARCH)"
$(OUT)/rig-map.json: ../../js/pedals.js ../../instrument-plugins.json ../../tools/make-rig-map.js
	mkdir -p $(OUT) && node ../../tools/make-rig-map.js $@
test: all
	node test-mixer.mjs $(OUT)/cu-mixer$(EXE) && node test-rig.mjs $(OUT)/cu-rig$(EXE)
clean:
	rm -rf build build-*
.PHONY: all test clean
