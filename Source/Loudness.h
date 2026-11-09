#pragma once
#include "Common.h"

/* Loudness the way streaming services and broadcasters measure it (ITU-R BS.1770-4 / EBU R128):
 *   momentary (400 ms), short-term (3 s) and integrated (the whole run, gated) loudness in LUFS, and true peak (4x
 *   oversampled) in dBTP. Used by Motion Master (the master limiter + meter), the transport bar's readout and the
 *   export's Central Tracks check. */

namespace ms
{

class LoudnessMeter
{
public:
    void prepare (double sampleRate, int numChannels);
    void reset();
    /** Feed audio (any block size). Safe to read the results from another thread. */
    void process (const float* const* channels, int numChannels, int numSamples);

    float momentary() const     { return momentaryLufs.load(); }
    float shortTerm() const     { return shortLufs.load(); }
    float integrated() const    { return integratedLufs.load(); }
    float truePeak() const      { return truePeakDb.load(); }       // the highest since reset
    float loudnessRange() const { return lra.load(); }
    float seconds() const       { return (float) blocksSeen.load() * 0.1f; }

    static constexpr float silence = -70.0f;

private:
    struct Biquad { double b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0, z1 = 0, z2 = 0;
                    inline double tick (double x) { auto y = b0 * x + z1; z1 = b1 * x - a1 * y + z2; z2 = b2 * x - a2 * y; return y; } };
    void blockDone();
    double sr = 48000.0;
    int chans = 2, hop = 4800, inHop = 0;
    Biquad pre[8], rlb[8];
    double hopEnergy = 0;
    std::vector<double> hops;          // the last 30 hops of 100 ms (mean square, summed over channels)
    int hopWrite = 0, hopsFilled = 0;
    std::vector<double> binEnergy, shortBinEnergy;
    std::vector<int> binCount, shortBinCount;
    // true peak: 4x interpolation
    std::vector<float> history[8];
    int histPos = 0;
    float peakLinear = 0;
    std::atomic<float> momentaryLufs { silence }, shortLufs { silence }, integratedLufs { silence }, truePeakDb { -120.0f }, lra { 0.0f };
    std::atomic<int> blocksSeen { 0 };
};

/** Inter-sample peaks: the loudest point of a 4x oversampled signal around each sample (delayed by `delay` samples). */
class TruePeakDetector
{
public:
    static constexpr int delay = 6;
    void reset();
    float process (float x);
private:
    float h[12] {};
    int pos = 0;
};

/** Whole-buffer loudness (for the export check). */
struct LoudnessReport { float integrated = -70, truePeak = -120, shortMax = -70, range = 0; };
LoudnessReport measureLoudness (const juce::AudioBuffer<float>&, double sampleRate);

/** A plugin that can show its loudness (Motion Master), for the transport bar. */
struct LoudnessSource
{
    virtual ~LoudnessSource() = default;
    virtual const LoudnessMeter& loudness() const = 0;
    virtual float gainReductionDb() const = 0;
    virtual void resetLoudness() = 0;
};

} // namespace ms
