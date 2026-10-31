/* plughost.h - the rig's plugin host: the musician's own VST3, CLAP, Audio Units (macOS) and LV2 (Linux) plugins,
 * effects and instruments, with their editor windows. C interface for cu-rig.c; the host itself is C++ (the .cpp files here).
 *
 * Threads:
 *   main thread   everything but ph_process: the rig's commands run here (ph_run reads stdin on its own thread and
 *                 hands each line to the main thread), plugins are created / destroyed / saved here, and the editor
 *                 windows live here (each OS wants its windows on the main thread).
 *   audio thread  ph_process only.
 * Plugin states are files in <data>/plugin-states/<key>.state, saved when they change (a knob turned from the app,
 * the editor window closing, every few seconds while it is open) and when the rig quits. */
#ifndef CU_PLUGHOST_H
#define CU_PLUGHOST_H
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

typedef struct PhPlug PhPlug;
typedef struct { uint8_t d[3]; } PhMidi;   /* a 3-byte MIDI message, at the start of the block */

/* the program: ph_init first; ph_run takes the main thread over until stdin closes (calls onLine for each line,
 * then onQuit), ph_post runs fn(arg) on the main thread soon (from any thread). */
void ph_init(const char *dataDir, void (*emit)(const char *json));
int  ph_run(void (*onLine)(char *line), void (*onQuit)(void));
void ph_post(void (*fn)(void *), void *arg);
/* `cu-rig --scan-one <format> <path>`: the child process that loads one plugin file and prints what is in it
 * (a crash or hang there only loses that plugin) */
int  ph_scan_one_main(const char *format, const char *path);

/* finding plugins: ph_scan starts a scan on a worker thread (the folders as a JSON array of extra folders; force
 * rescans files the cache already knows); progress and the result arrive as JSON lines through emit:
 *   {"type":"pluginScan","done":3,"total":40,"current":"Kontakt 7"}
 *   {"type":"pluginList","plugins":[{"key","format","id","name","vendor","kind":"effect"|"instrument","path","version"}],"failed":[...],"folders":[...]} */
void ph_scan(const char *extraFoldersJson, int force);
char *ph_list_json(void);   /* the last list (malloc'd JSON), without scanning */
const char *ph_formats(void);   /* the formats this build hosts, e.g. "vst3,clap,lv2" */

/* instances, by the app's key for the slot (the pedal's uid, or a keys layer's): ph_get returns the running one if it
 * is the same plugin, or loads it (restoring its saved state, else the state of stateFrom's slot). Each returned
 * plugin holds a reference: ph_release when the chain that used it is gone. ph_keep_only drops the slots no longer used
 * (saving them first). */
PhPlug *ph_get(const char *slot, const char *format, const char *id, const char *path, const char *stateFrom, double sampleRate, int maxBlock, char *err, int errLen);
void ph_retain(PhPlug *p);
void ph_release(PhPlug *p);
void ph_keep_only(const char *const *slots, int n);
/* (10.1) community plugins (a path inside a library's community-plugins folder) run walled off in their own process
 * (cm-plugbridge, bridge.h); one that crashes, stops responding, is too heavy or is taken down plays dry from then on
 * and says so: {"type":"pluginBypassed","uid":slot,"reason":"crashed"|...}. ph_forget_slot: the next ph_get loads it
 * afresh ("Try again"). */
int  ph_forget_slot(const char *slot);
int  ph_is_instrument(PhPlug *p);
const char *ph_slot(PhPlug *p);
char *ph_slots_json(void);   /* the running plugins: {slot: {name, vendor, format, instrument, editor (has one), open (is open), latency,
                                (10.1) community: true and bypassed: "crashed" | "hung" | "heavy" | "revoked" | "off" for community plugins}} */
const char *ph_name(PhPlug *p);
int  ph_latency(PhPlug *p);
/* the audio thread: in may be NULL (instruments); out gets the plugin's main stereo output; midi goes to instruments */
void ph_process(PhPlug *p, const float *inL, const float *inR, float *outL, float *outR, int n, const PhMidi *midi, int nMidi);

/* parameters (normalized 0..1), for the app's quick controls: a JSON array [{id,name,value,text}] of the first max
 * automatable ones; set from the app (queued for the audio thread, marks the state to save) */
char *ph_params_json(const char *slot, int max);
int  ph_set_param(const char *slot, uint32_t id, double value);
/* the editor window */
int  ph_has_editor(const char *slot);
int  ph_editor(const char *slot, int open);   /* returns 1 when it is open */
/* save every changed state now (before quitting, before the app saves a board) */
void ph_save_all(void);
/* a copy of a slot's state under a new name (a board remembers it): returns 1 when there was a state */
int  ph_copy_state(const char *fromSlot, const char *toName);

#ifdef __cplusplus
}
#endif
#endif
