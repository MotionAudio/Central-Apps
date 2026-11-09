#pragma once
#include "Common.h"

/* The analysis and correction under Auto Time, Motion Tune and Auto Comp:
 *   - YIN pitch detection (on a decimated copy, so it's quick)
 *   - spectral-flux onset detection
 *   - note segmentation (Tune: "mark every note")
 *   - TD-PSOLA pitch shifting: offline for the Tune editor, streaming for the Motion Tune plugin
 *   - scales and keys
 *   - scoring takes for Auto Comp */

namespace ms::vocal
{

//==============================================================================
enum class Scale { major, minor, chromatic, majorPentatonic, minorPentatonic };
juce::StringArray scaleNames();
bool inScale (int midiNote, int key, Scale);
int nearestInScale (float midi, int key, Scale);
juce::String noteName (int midi);

//==============================================================================
/** YIN on one frame. Returns Hz (0 = unvoiced) and a confidence 0..1. */
float yin (const float* x, int n, double sampleRate, float minHz, float maxHz, float& confidence);

struct PitchTrack
{
    double sampleRate = 48000.0;
    int hop = 256;                  // in original samples
    std::vector<float> hz;          // 0 = unvoiced
    std::vector<float> confidence;
    std::vector<float> rms;
    float midiAt (int frame) const;
    int frames() const               { return (int) hz.size(); }
    double frameTime (int f) const   { return (double) f * hop / sampleRate; }
};

/** Pitch of a whole (mono) signal. */
PitchTrack analysePitch (const float* mono, int numSamples, double sampleRate, float minHz = 65.0f, float maxHz = 1100.0f,
                         std::function<bool (float)> progress = nullptr);

//==============================================================================
enum class OnsetStyle { drums, tight, normal, vocal };
/** Onset times in seconds. */
std::vector<double> detectOnsets (const float* mono, int numSamples, double sampleRate, OnsetStyle);
/** A tempo guess from onsets (0 when there isn't a steady one). */
double estimateTempo (const std::vector<double>& onsets);

//==============================================================================
struct TuneNote
{
    double start = 0, end = 0;   // seconds in the file
    float pitch = 60.0f;         // its centre (median, MIDI float)
    int target = 60;             // where it goes
    bool tune = true;            // false = leave this note as sung
    bool userSet = false;        // the target was chosen by hand ("Make it")
};

std::vector<TuneNote> segmentNotes (const PitchTrack&, int key, Scale);

/** The shift (semitones) at every pitch frame for a set of notes.
    tightness 0 = move each note's centre and keep its vibrato and drift; 1 = flatten it onto the note. */
std::vector<float> shiftCurve (const PitchTrack&, const std::vector<TuneNote>&, float tightness, float glideMs);

/** Offline TD-PSOLA: shifts the pitch of every channel by the curve (semitones per pitch frame), keeping time. */
void psolaRender (const juce::AudioBuffer<float>& in, juce::AudioBuffer<float>& out, const PitchTrack&, const std::vector<float>& shiftSemis,
                  std::function<bool (float)> progress = nullptr);

//==============================================================================
/** A point of a time map: output time (seconds) -> source time (seconds). */
struct WarpKnot { double out = 0, src = 0; bool onset = false; };

/** Re-times audio by a piecewise-linear map (knots strictly increasing), keeping its pitch (WSOLA).
    Frames that touch an onset knot are copied straight, so attacks land exactly and stay sharp. */
void warpRender (const juce::AudioBuffer<float>& in, double sampleRate, const std::vector<WarpKnot>&, double outSeconds,
                 juce::AudioBuffer<float>& out, std::function<bool (float)> progress = nullptr);

//==============================================================================
/** Streaming pitch correction for the Motion Tune plugin (latency: getLatency() samples). */
class RealtimeTuner
{
public:
    void prepare (double sampleRate, int maxBlock);
    void reset();
    int getLatency() const { return latency; }
    void process (float* const* channels, int numChannels, int numSamples);

    std::atomic<int> key { 0 };
    std::atomic<int> scale { 0 };
    std::atomic<float> speedMs { 30.0f }, amount { 1.0f }, humanize { 0.3f }, mix { 1.0f };
    std::atomic<float> detectedMidi { 0.0f }, targetMidi { 0.0f };   // for the editor's display

private:
    void detect();
    void makeAnalysisMarks (juce::int64 upTo);
    double sr = 48000.0;
    int latency = 2048, dec = 4, maxPeriod = 700;
    static constexpr int ringSize = 1 << 15;
    std::vector<float> in[2], acc[2], wsum, decBuf, frame;
    juce::int64 written = 0, decWritten = 0, nextSynth = 0, nextAnalysis = 0, lastDetect = 0;
    std::deque<std::pair<juce::int64, int>> marks;   // analysis marks: position, period
    float lp1 = 0, lp2 = 0;
    float f0 = 0, conf = 0, smoothShift = 0, centre = 0;
    int heldTarget = -1;
    int channels = 2;
};

//==============================================================================
/** How good a stretch of a take is (higher is better): in tune, in time, not clipped, not missing. */
struct SectionScore { float total = 0, pitch = 0, timing = 0, level = 0; bool silent = false, clipped = false; };
SectionScore scoreSection (const float* mono, int numSamples, double sampleRate, int key, Scale, double secondsPerGrid,
                           double gridOffsetSeconds);

//==============================================================================
/** Reads a file as float channels (stereo max). */
bool readAudio (te::Engine&, const juce::File&, juce::AudioBuffer<float>&, double& sampleRate);
bool writeWav (const juce::File&, const juce::AudioBuffer<float>&, double sampleRate);
void mixToMono (const juce::AudioBuffer<float>&, std::vector<float>&);

} // namespace ms::vocal
