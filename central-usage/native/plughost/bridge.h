/* bridge.h - a community plugin, walled off in its own process (10.1).
 *
 * Community plugins (Make & sell, reviewed by Motion Audio) are someone else's program, so they never load inside the
 * rig (cu-rig on computers) or the Central Pedal's live chain. Each one runs in its own process, cm-plugbridge, started
 * inside a wall (bubblewrap + seccomp on Linux and the Pi, sandbox-exec on macOS; see docs/COMMUNITY-PLUGINS.md), and
 * audio crosses over shared memory:
 *
 *   parent (cu-rig / cm-pwnode)                         child (cm-plugbridge, walled)
 *   ---------------------------                         ----------------------------
 *   fills shm->inL/inR (+ MIDI), seq++                  waits on the audio socket
 *   writes seq (4 bytes) to the audio socket   ----->   runs the plugin on the block, shm->outL/outR
 *   waits for the reply, at most `budget` us   <-----   writes seq back
 *   takes the output - or, when it's late, plays the block dry (the sound never stops), and keeps track:
 *     no reply for CMB_HUNG_MS      -> "stopped responding": bypassed, the child is killed
 *     the socket closes / child dies -> "crashed": bypassed
 *     most blocks late (over budget) for a couple of seconds -> "too heavy": bypassed
 *
 * The control socket carries lines (the parent's main thread; the child's main thread):
 *   child -> "R {name,vendor,instrument,latency}" when the plugin is running, or "E <why>" and it exits
 *   "P <max>"            -> "P [{id,name,value,text},...]"    the first automatable parameters (normalized)
 *   "S <id> <value>"     (no reply)                          set a parameter (0..1)
 *   "G"                  -> "G <base64>" or "G -"            the plugin's state (a preset), to save
 *   "L <base64>"         -> "L 1" / "L 0"                    load a saved state
 *   "Q"                  the child exits
 * The file descriptors are inherited: cm-plugbridge <format> <id> <path> <audio fd> <control fd> <shm fd> <rate> <block>
 */
#ifndef CM_BRIDGE_H
#define CM_BRIDGE_H
#include <stdint.h>
#include <stddef.h>
#ifdef __cplusplus
extern "C" {
#endif

#define CMB_MAGIC 0x31424d43u   /* "CMB1" */
#define CMB_MAXBLOCK 4096
#define CMB_MAXMIDI 64
#define CMB_HUNG_MS 1500         /* no answer for this long: the plugin stopped responding */
#define CMB_HEAVY_MS 2000        /* the share of late blocks over about this long ... */
#define CMB_HEAVY_SHARE 0.5      /* ... above this: too heavy for this device */
#define CMB_START_MS 8000        /* how long the plugin may take to load */

typedef struct {
  uint32_t magic, version;
  uint32_t frames;               /* this block (<= CMB_MAXBLOCK) */
  uint32_t flags;                /* bit 0: no audio in (an instrument) */
  uint32_t nMidi;
  uint8_t midi[CMB_MAXMIDI][3];  /* 3-byte MIDI messages, at the start of the block */
  uint32_t lastUs;               /* child: how long the last block took */
  uint32_t latency;              /* child: the plugin's latency, in samples */
  uint32_t pad[8];
  float inL[CMB_MAXBLOCK], inR[CMB_MAXBLOCK], outL[CMB_MAXBLOCK], outR[CMB_MAXBLOCK];
} CmbShm;

/* ---- the parent's side (bridge_client.c) ------------------------------------------------------------------------ */
enum { CMB_RUNNING = 0, CMB_CRASHED = 1, CMB_HUNG = 2, CMB_HEAVY_ = 3, CMB_STOPPED = 4, CMB_FAILED = 5 };
typedef struct CmbClient CmbClient;

/* starts argv (the wall's command line, then cm-plugbridge and its first three arguments: format id path - the
 * descriptors, rate and block are added here) and waits for "R" or "E". On failure: NULL and err. */
CmbClient *cmb_start(const char *const *argv, double sampleRate, int maxBlock, char *err, int errLen);
/* the audio thread: never blocks for longer than the budget; out is always written (the plugin's or the dry input) */
void cmb_process(CmbClient *c, const float *inL, const float *inR, float *outL, float *outR, int n, const uint8_t (*midi)[3], int nMidi);
/* the main thread: why it is bypassed (CMB_RUNNING when it plays), and a word for it; reaps a dead child */
int  cmb_state(CmbClient *c);
const char *cmb_state_word(int state);
/* the main thread: one request line; the reply line without its letter and space (malloc'd: free it), NULL if none came */
char *cmb_request(CmbClient *c, const char *line, int timeoutMs);
int  cmb_send(CmbClient *c, const char *line);   /* no reply expected */
const char *cmb_info(CmbClient *c);              /* the "R" line's JSON */
/* stops it for good: bypassed with this state (CMB_STOPPED: taken down / not used), the child killed */
void cmb_stop(CmbClient *c, int state);
void cmb_free(CmbClient *c);
int  cmb_pid(CmbClient *c);
uint32_t cmb_budget_us(CmbClient *c);

/* base64 for states (both sides) */
size_t cmb_b64_encode(const uint8_t *in, size_t n, char *out);          /* out: 4 * ((n + 2) / 3) + 1 bytes */
size_t cmb_b64_decode(const char *in, uint8_t *out, size_t outMax);     /* returns the bytes written */

/* ---- the child's side ------------------------------------------------------------------------------------------- */
int cmb_child_main(int argc, char **argv);   /* bridge_main.cpp */
/* the wall inside the child (Linux): no new privileges + a seccomp filter (no ptrace, mount, modules, bpf, exec,
 * internet / netlink / raw sockets...); returns 0 when it is in place */
int cmb_seccomp(void);

#ifdef __cplusplus
}
#endif
#endif
