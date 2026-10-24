/* Play any sound - make a guitar, bass or acoustic (anything with a 1/4" / 1/8" output) sound like any installed
 * sound, analysing the input live.
 *
 *   NOTE mode   single notes (lead lines) are tracked (MPM / NSDF pitch tracker + onset detector) and played as
 *               MIDI notes (note on / off, pitch bend for bends and vibrato) by the keys engine with the chosen sound.
 *   SYNTH mode  chords: a guitar-synth style polyphonic effect - the input split into bands, each band squared up
 *               (a square wave per string region, plus a sub octave), through a resonant filter that follows the
 *               playing. No note detection, so it follows chords instantly.
 *   AUTO        switches by itself: notes when a clear single pitch is heard, synth when a chord is (no single
 *               clear pitch, or several harmonic series in the spectrum).
 *
 * Plain C99, no dependencies, no allocation while processing. One instance per input; not thread-safe (call the
 * setters from the audio thread, or between blocks). Used by cu-rig (Windows / macOS / Linux without PipeWire)
 * and by cp-playany (the Raspberry Pi and Linux with PipeWire). */
#ifndef PLAYANY_H
#define PLAYANY_H
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

enum { PA_AUTO = 0, PA_NOTES = 1, PA_SYNTH = 2 };                              /* pa_set_mode */
enum { PA_IDLE = 0, PA_NOTE = 1, PA_CHORD = 2 };                               /* PaInfo.state: what is sounding */
enum { PA_TONE_PLUCK = 0, PA_TONE_PAD, PA_TONE_LEAD, PA_TONE_BASS, PA_TONE_ORGAN, PA_TONES };   /* the synth mode's voice */

typedef struct { int offset; uint8_t status, d1, d2; } PaEvent;               /* a MIDI event at a sample of the block */
typedef struct {
  int state;          /* PA_IDLE / PA_NOTE / PA_CHORD */
  int note;           /* the MIDI note sounding in note mode, -1 when none */
  float freq;         /* the latest pitch estimate (Hz), 0 when none */
  float clarity;      /* how clearly periodic the input is (0..1) */
  int voices;         /* harmonic series heard in the latest spectrum (1 = a single note, 2+ = a chord) */
  float levelDb;      /* input level */
} PaInfo;

typedef struct PlayAny PlayAny;
PlayAny *pa_new(double sampleRate);
void pa_free(PlayAny *p);
void pa_reset(PlayAny *p);
void pa_set_mode(PlayAny *p, int mode);                 /* PA_AUTO (default), PA_NOTES, PA_SYNTH */
void pa_set_sensitivity(PlayAny *p, float s);           /* 0..1 (0.5): gate level, onset and pitch thresholds */
void pa_set_range(PlayAny *p, int lowNote, int highNote);/* MIDI notes the instrument plays: guitar 40..88 (default), bass 23..67 */
void pa_set_tone(PlayAny *p, int tone);                 /* PA_TONE_* */
void pa_set_channel(PlayAny *p, int channel);           /* MIDI channel of the events (0..15, default 0) */
void pa_set_bend(PlayAny *p, int on);                   /* follow bends / vibrato with pitch bend (+-2 semitones), default on */
void pa_set_synth_level(PlayAny *p, float gain);        /* the synth mode's output level (linear, default 1) */
/* Process n mono input samples. synth (may be NULL) gets the synth mode's sound (n samples, nothing else mixed in);
 * ev gets up to maxEv MIDI events for the keys engine. Returns the number of events. */
int pa_process(PlayAny *p, const float *in, float *synth, int n, PaEvent *ev, int maxEv);
int pa_all_notes_off(PlayAny *p, PaEvent *ev, int maxEv);   /* stop the sounding note (when switching off) */
void pa_info(const PlayAny *p, PaInfo *info);
int pa_tone_for_name(const char *soundName);            /* a synth voice that suits a sound's name ("Warm Pad" -> PA_TONE_PAD) */
int pa_latency_hint(const PlayAny *p, int midiNote);    /* the expected note-on delay for a note, in input samples */

#ifdef __cplusplus
}
#endif
#endif
