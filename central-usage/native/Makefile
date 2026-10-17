# Central Usage native helpers:
#   cu-mixer  the audio engine (JACK on Linux; Windows / macOS / Linux audio devices through miniaudio)
#   cu-ndi    the NDI sender (the NDI runtime is loaded at run time)
#   cu-rig    the instrument rig for Windows / macOS (built-in effects + SoundFont keys)
#   rig-map.json  which built-in effect plays each pedal (made from js/pedals.js)
# No JACK / NDI headers needed. Third-party sources are in vendor/.
#   make                    this computer (Linux: gcc, macOS: clang universal arm64 + x86_64)
#   make TARGET=win         Windows x64 from Linux (x86_64-w64-mingw32-gcc) or from MSYS2 / MinGW
CFLAGS ?= -O2 -Wall -Wno-misleading-indentation -Wno-format-nonliteral -Wno-format-security -Wno-format-truncation -Wno-unused-function -Wno-unknown-warning-option
UNAME := $(shell uname -s)
EXE :=
ifeq ($(TARGET),win)
  ifneq (,$(findstring MINGW,$(UNAME))$(findstring MSYS,$(UNAME)))
    CC := gcc
  else
    CC := x86_64-w64-mingw32-gcc
  endif
  EXE := .exe
  LIBS := -lole32 -lwinmm -static
  NDILIBS := -static
else ifneq (,$(findstring MINGW,$(UNAME))$(findstring MSYS,$(UNAME)))
  CC := gcc
  EXE := .exe
  LIBS := -lole32 -lwinmm -static
  NDILIBS := -static
else ifeq ($(UNAME),Darwin)
  ARCH ?= -arch arm64 -arch x86_64
  CFLAGS += $(ARCH) -mmacosx-version-min=11.0
  LIBS := -framework CoreFoundation -framework CoreAudio -framework AudioToolbox -lpthread -lm
  NDILIBS :=
else
  LIBS := -lm -ldl -lpthread
  NDILIBS := -ldl
endif
OUT ?= build
all: $(OUT)/cu-mixer$(EXE) $(OUT)/cu-ndi$(EXE) $(OUT)/cu-rig$(EXE) $(OUT)/rig-map.json
$(OUT)/cu-mixer$(EXE): cu-mixer.c plat.h
	mkdir -p $(OUT) && $(CC) $(CFLAGS) -o $@ cu-mixer.c $(LIBS)
$(OUT)/cu-ndi$(EXE): cu-ndi.c plat.h
	mkdir -p $(OUT) && $(CC) $(CFLAGS) -o $@ cu-ndi.c $(NDILIBS)
$(OUT)/cu-rig$(EXE): cu-rig.c plat.h vendor/cJSON.c
	mkdir -p $(OUT) && $(CC) $(CFLAGS) -o $@ cu-rig.c vendor/cJSON.c $(LIBS)
$(OUT)/rig-map.json: ../../js/pedals.js ../../instrument-plugins.json ../../tools/make-rig-map.js
	mkdir -p $(OUT) && node ../../tools/make-rig-map.js $@
test: all
	node test-mixer.mjs $(OUT)/cu-mixer$(EXE) && node test-rig.mjs $(OUT)/cu-rig$(EXE)
clean:
	rm -rf build build-*
.PHONY: all test clean
