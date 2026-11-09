#include "Loudness.h"

namespace ms
{

static constexpr int bins = 900;            // -70 .. +20 LUFS in 0.1 LU steps
static constexpr int tapsPerPhase = 12;
static float truePeakTaps[4][tapsPerPhase];

static void makeTruePeakFilter()
{
    static bool done = false;
    if (done) return;
    done = true;
    constexpr int N = 4 * tapsPerPhase;
    for (int i = 0; i < N; ++i)
    {
        auto m = (double) i - (N - 1) / 2.0;
        auto x = m / 4.0;
        auto sinc = std::abs (x) < 1e-9 ? 1.0 : std::sin (juce::MathConstants<double>::pi * x) / (juce::MathConstants<double>::pi * x);
        auto w = 0.5 - 0.5 * std::cos (juce::MathConstants<double>::twoPi * (i + 0.5) / N);   // Hann
        truePeakTaps[i % 4][i / 4] = (float) (sinc * w);
    }
    // each phase sums to 1 (no level change)
    for (auto& phase : truePeakTaps)
    {
        float s = 0;
        for (auto t : phase) s += t;
        for (auto& t : phase) t /= s;
    }
}

static inline float toLufs (double meanSquare)  { return meanSquare > 1e-12 ? (float) (-0.691 + 10.0 * std::log10 (meanSquare)) : -120.0f; }
static inline int binOf (float lufs)            { return juce::jlimit (0, bins - 1, (int) std::floor ((lufs + 70.0f) * 10.0f)); }
static inline float binLufs (int b)             { return -70.0f + (float) b * 0.1f; }

void LoudnessMeter::prepare (double sampleRate, int numChannels)
{
    sr = sampleRate;
    chans = juce::jlimit (1, 8, numChannels);
    hop = juce::jmax (1, (int) std::round (sr * 0.1));
    makeTruePeakFilter();
    // K-weighting (BS.1770): a high shelf, then the RLB high-pass, worked out for this sample rate
    {
        auto f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
        auto K = std::tan (juce::MathConstants<double>::pi * f0 / sr);
        auto Vh = std::pow (10.0, G / 20.0), Vb = std::pow (Vh, 0.4996667741545416);
        auto a0 = 1.0 + K / Q + K * K;
        for (auto& b : pre)
        {
            b = {};
            b.b0 = (Vh + Vb * K / Q + K * K) / a0; b.b1 = 2.0 * (K * K - Vh) / a0; b.b2 = (Vh - Vb * K / Q + K * K) / a0;
            b.a1 = 2.0 * (K * K - 1.0) / a0; b.a2 = (1.0 - K / Q + K * K) / a0;
        }
    }
    {
        auto f0 = 38.13547087602444, Q = 0.5003270373238773;
        auto K = std::tan (juce::MathConstants<double>::pi * f0 / sr);
        auto a0 = 1.0 + K / Q + K * K;
        for (auto& b : rlb)
        {
            b = {};
            b.b0 = 1.0; b.b1 = -2.0; b.b2 = 1.0;
            b.a1 = 2.0 * (K * K - 1.0) / a0; b.a2 = (1.0 - K / Q + K * K) / a0;
        }
    }
    hops.assign (30, 0.0);
    binEnergy.assign (bins, 0.0); binCount.assign (bins, 0);
    shortBinEnergy.assign (bins, 0.0); shortBinCount.assign (bins, 0);
    for (auto& h : history) h.assign (tapsPerPhase, 0.0f);
    reset();
}

void LoudnessMeter::reset()
{
    for (auto& b : pre) b.z1 = b.z2 = 0;
    for (auto& b : rlb) b.z1 = b.z2 = 0;
    std::fill (hops.begin(), hops.end(), 0.0);
    std::fill (binEnergy.begin(), binEnergy.end(), 0.0); std::fill (binCount.begin(), binCount.end(), 0);
    std::fill (shortBinEnergy.begin(), shortBinEnergy.end(), 0.0); std::fill (shortBinCount.begin(), shortBinCount.end(), 0);
    for (auto& h : history) std::fill (h.begin(), h.end(), 0.0f);
    hopWrite = hopsFilled = inHop = histPos = 0;
    hopEnergy = 0;
    peakLinear = 0;
    momentaryLufs = shortLufs = integratedLufs = silence;
    truePeakDb = -120.0f;
    lra = 0.0f;
    blocksSeen = 0;
}

void LoudnessMeter::process (const float* const* ch, int numCh, int n)
{
    numCh = juce::jmin (numCh, chans);
    for (int i = 0; i < n; ++i)
    {
        double e = 0;
        for (int c = 0; c < numCh; ++c)
        {
            auto x = (double) ch[c][i];
            auto y = rlb[c].tick (pre[c].tick (x));
            e += y * y;       // channel weight 1 for left, right and centre
            // true peak
            auto& h = history[c];
            h[(size_t) histPos] = (float) x;
            for (int p = 0; p < 4; ++p)
            {
                float s = 0;
                for (int k = 0; k < tapsPerPhase; ++k)
                    s += truePeakTaps[p][k] * h[(size_t) ((histPos - k + tapsPerPhase) % tapsPerPhase)];
                peakLinear = juce::jmax (peakLinear, std::abs (s));
            }
            peakLinear = juce::jmax (peakLinear, std::abs ((float) x));
        }
        histPos = (histPos + 1) % tapsPerPhase;
        hopEnergy += e;
        if (++inHop >= hop)
        {
            hops[(size_t) hopWrite] = hopEnergy / hop;
            hopWrite = (hopWrite + 1) % (int) hops.size();
            hopsFilled = juce::jmin ((int) hops.size(), hopsFilled + 1);
            hopEnergy = 0;
            inHop = 0;
            blockDone();
        }
    }
    truePeakDb = peakLinear > 1e-6f ? gainToDb (peakLinear) : -120.0f;
}

void LoudnessMeter::blockDone()
{
    auto meanOf = [this] (int count)
    {
        double s = 0;
        int have = juce::jmin (count, hopsFilled);
        for (int k = 1; k <= have; ++k) s += hops[(size_t) ((hopWrite - k + (int) hops.size()) % (int) hops.size())];
        return have > 0 ? s / count : 0.0;   // a not-yet-full window counts its missing part as silence
    };
    auto m = meanOf (4), st = meanOf (30);
    auto mL = toLufs (m), sL = toLufs (st);
    momentaryLufs = juce::jmax (silence, mL);
    shortLufs = juce::jmax (silence, sL);
    ++blocksSeen;

    // integrated: 400 ms blocks every 100 ms, gated at -70 LUFS and 10 LU under the gated average
    if (hopsFilled >= 4 && mL > -70.0f)
    {
        auto b = binOf (mL);
        binEnergy[(size_t) b] += m;
        binCount[(size_t) b]++;
    }
    double sum = 0; int count = 0;
    for (int b = 0; b < bins; ++b) { sum += binEnergy[(size_t) b]; count += binCount[(size_t) b]; }
    if (count > 0)
    {
        auto gate = toLufs (sum / count) - 10.0f;
        double s2 = 0; int c2 = 0;
        for (int b = binOf (gate); b < bins; ++b) { s2 += binEnergy[(size_t) b]; c2 += binCount[(size_t) b]; }
        integratedLufs = c2 > 0 ? juce::jmax (silence, toLufs (s2 / c2)) : silence;
    }

    // loudness range: short-term values, gated at -70 and 20 LU under their average; 95th minus 10th percentile
    if (hopsFilled >= 30 && sL > -70.0f)
    {
        auto b = binOf (sL);
        shortBinEnergy[(size_t) b] += st;
        shortBinCount[(size_t) b]++;
    }
    double ss = 0; int sc = 0;
    for (int b = 0; b < bins; ++b) { ss += shortBinEnergy[(size_t) b]; sc += shortBinCount[(size_t) b]; }
    if (sc > 10)
    {
        auto gate = binOf (toLufs (ss / sc) - 20.0f);
        int total = 0;
        for (int b = gate; b < bins; ++b) total += shortBinCount[(size_t) b];
        int acc = 0; float lo = 0, hi = 0; bool haveLo = false;
        for (int b = gate; b < bins; ++b)
        {
            acc += shortBinCount[(size_t) b];
            if (! haveLo && acc >= total * 0.10) { lo = binLufs (b); haveLo = true; }
            if (acc >= total * 0.95) { hi = binLufs (b); break; }
        }
        lra = juce::jmax (0.0f, hi - lo);
    }
}

void TruePeakDetector::reset()
{
    makeTruePeakFilter();
    std::fill (std::begin (h), std::end (h), 0.0f);
    pos = 0;
}

float TruePeakDetector::process (float x)
{
    h[pos] = x;
    float peak = std::abs (h[(pos - delay + tapsPerPhase) % tapsPerPhase]);
    for (int p = 0; p < 4; ++p)
    {
        float s = 0;
        for (int k = 0; k < tapsPerPhase; ++k) s += truePeakTaps[p][k] * h[(pos - k + tapsPerPhase) % tapsPerPhase];
        peak = juce::jmax (peak, std::abs (s));
    }
    pos = (pos + 1) % tapsPerPhase;
    return peak;
}

LoudnessReport measureLoudness (const juce::AudioBuffer<float>& b, double sr)
{
    LoudnessMeter m;
    m.prepare (sr, b.getNumChannels());
    LoudnessReport r;
    const int block = 4096;
    std::vector<const float*> ptrs ((size_t) b.getNumChannels());
    for (int i = 0; i < b.getNumSamples(); i += block)
    {
        auto n = juce::jmin (block, b.getNumSamples() - i);
        for (int c = 0; c < b.getNumChannels(); ++c) ptrs[(size_t) c] = b.getReadPointer (c, i);
        m.process (ptrs.data(), b.getNumChannels(), n);
        r.shortMax = juce::jmax (r.shortMax, m.shortTerm());
    }
    r.integrated = m.integrated();
    r.truePeak = m.truePeak();
    r.range = m.loudnessRange();
    return r;
}

} // namespace ms
