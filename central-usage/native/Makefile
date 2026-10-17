# Central Usage native helpers: the audio engine and the NDI sender. No JACK / NDI headers needed:
# libjack and libndi are loaded at run time (the engine runs on its own clock without JACK).
CFLAGS ?= -O2 -Wall -Wno-misleading-indentation -Wno-format-nonliteral -Wno-format-security
all: build/cu-mixer build/cu-ndi
build/cu-mixer: cu-mixer.c
	mkdir -p build && $(CC) $(CFLAGS) -o $@ $< -lm -ldl -lpthread
build/cu-ndi: cu-ndi.c
	mkdir -p build && $(CC) $(CFLAGS) -o $@ $< -ldl
clean:
	rm -rf build
