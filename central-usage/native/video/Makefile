# cu-video: the Video tab's native helper (stream audio via miniaudio, NDI in / out loaded at run time).
# Linux / macOS: make     Windows: see CMakeLists.txt (MSVC) or `make CC=x86_64-w64-mingw32-gcc EXE=.exe LIBS="-lole32 -lwinmm"` (MinGW, also from Linux)
CFLAGS ?= -O2 -Wall -Wno-misleading-indentation -Wno-unused-function
EXE ?=
UNAME := $(shell uname -s 2>/dev/null)
ifeq ($(UNAME),Darwin)
LIBS ?= -lm -lpthread -framework CoreFoundation -framework CoreAudio -framework AudioToolbox
else
LIBS ?= -lm -ldl -lpthread
endif
all: ../build/cu-video$(EXE)
../build/cu-video$(EXE): cu-video.c miniaudio.h
	mkdir -p ../build && $(CC) $(CFLAGS) -o $@ cu-video.c $(LIBS)
clean:
	rm -f ../build/cu-video$(EXE)
