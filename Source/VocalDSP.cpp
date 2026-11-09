#include "VocalDSP.h"

namespace ms::vocal
{

//==============================================================================
juce::StringArray scaleNames()  { return { "Major", "Minor", "Chromatic", "Major pentatonic", "Minor pentatonic" }; }

static const int* scaleSteps (Scale s, int& count)
{
    static const int major[] = { 0, 2, 4, 5, 7, 9, 11 };
    static const int minor[] = { 0, 2, 3, 5, 7, 8, 10 };
    static const int chrom[] = { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 };
    static const int majP[] = { 0, 2, 4, 7, 9 };
    static const int minP[] = { 0, 3, 5, 7, 10 };
    switch (s)
    {
        case Scale::minor:           count = 7; return minor;
        case Scale::chromatic:       count = 12; return chrom;
        case Scale::majorPentatonic: count = 5; return majP;
        case Scale::minorPentatonic: count = 5; return minP;
        default:                     count = 7; return major;
    }
}

bool inScale (int midi, int key, Scale s)
{
    int count; auto steps = scaleSteps (s, count);
    int rel = ((midi - key) % 12 + 12) % 12;
    for (int i = 0; i < count; ++i) if (steps[i] == rel) return true;
    return false;
}

int nearestInScale (float midi, int key, Scale s)
{
    int base = (int) std::floor (midi);
    int best = base;
    float bestD = 1e9f;
    for (int c = base - 2; c <= base + 3; ++c)
        if (inScale (c, key, s))
        {
            auto d = std::abs ((float) c - midi);
            if (d < bestD) { bestD = d; best = c; }
        }
    return best;
}

juce::String noteName (int midi)  { return juce::MidiMessage::getMidiNoteName (midi, true, true, 3); }

//==============================================================================
struct Biquad
{
    float b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0, z1 = 0, z2 = 0;
    void lowpass (double fc, double sr, double q = 0.7071)
    {
        auto w = 2.0 * juce::MathConstants<double>::pi * fc / sr, c = std::cos (w), s = std::sin (w), al = s / (2 * q), a0 = 1 + al;
        b0 = (float) ((1 - c) / 2 / a0); b1 = (float) ((1 - c) / a0); b2 = b0; a1 = (float) (-2 * c / a0); a2 = (float) ((1 - al) / a0);
    }
    inline float tick (float x) { float y = b0 * x + z1; z1 = b1 * x - a1 * y + z2; z2 = b2 * x - a2 * y; return y; }
};

static int decimationFor (double sr)  { return juce::jmax (1, (int) std::round (sr / 12000.0)); }

float yin (const float* x, int n, double sr, float minHz, float maxHz, float& confidence)
{
    confidence = 0;
    int tauMin = juce::jmax (2, (int) std::floor (sr / maxHz));
    int tauMax = juce::jmin (n / 2 - 1, (int) std::ceil (sr / minHz));
    if (tauMax <= tauMin + 2) return 0;
    int w = n - tauMax;
    double energy = 0;
    for (int j = 0; j < n; ++j) energy += (double) x[j] * x[j];
    if (energy / n < 1e-8) return 0;

    float d[2048];
    tauMax = juce::jmin (tauMax, 2046);
    d[0] = 1.0f;
    double running = 0;
    for (int tau = 1; tau <= tauMax; ++tau)
    {
        double s = 0;
        for (int j = 0; j < w; ++j) { auto diff = x[j] - x[j + tau]; s += (double) diff * diff; }
        running += s;
        d[tau] = running > 0 ? (float) (s * tau / running) : 1.0f;
    }
    int tau = -1;
    for (int t = tauMin; t <= tauMax; ++t)
        if (d[t] < 0.15f)
        {
            while (t + 1 <= tauMax && d[t + 1] < d[t]) ++t;
            tau = t;
            break;
        }
    if (tau < 0)
    {
        // no clear dip: the best one, if it's decent
        int best = tauMin;
        for (int t = tauMin; t <= tauMax; ++t) if (d[t] < d[best]) best = t;
        if (d[best] > 0.35f) return 0;
        tau = best;
    }
    float better = (float) tau;
    if (tau > 1 && tau < tauMax)
    {
        auto s0 = d[tau - 1], s1 = d[tau], s2 = d[tau + 1];
        auto denom = s0 + s2 - 2 * s1;
        if (std::abs (denom) > 1e-9f) better = (float) tau + 0.5f * (s0 - s2) / denom;
    }
    confidence = juce::jlimit (0.0f, 1.0f, 1.0f - d[tau]);
    return (float) (sr / better);
}

float PitchTrack::midiAt (int f) const
{
    if (! juce::isPositiveAndBelow (f, frames()) || hz[(size_t) f] <= 0) return 0;
    return 69.0f + 12.0f * std::log2 (hz[(size_t) f] / 440.0f);
}

PitchTrack analysePitch (const float* x, int n, double sr, float minHz, float maxHz, std::function<bool (float)> progress)
{
    PitchTrack t;
    t.sampleRate = sr;
    int dec = decimationFor (sr);
    t.hop = 64 * dec;
    double srD = sr / dec;
    // decimate (two low-passes, then every dec-th sample)
    std::vector<float> d ((size_t) (n / dec + 1));
    Biquad a, b; a.lowpass (srD * 0.42, sr); b.lowpass (srD * 0.42, sr);
    for (int i = 0, k = 0; i < n; ++i)
    {
        auto y = b.tick (a.tick (x[i]));
        if (i % dec == 0 && k < (int) d.size()) d[(size_t) k++] = y;
    }
    int tauMax = (int) std::ceil (srD / minHz);
    int frameLen = 2 * tauMax + 4;
    int frames = n / t.hop + 1;
    t.hz.assign ((size_t) frames, 0.0f);
    t.confidence.assign ((size_t) frames, 0.0f);
    t.rms.assign ((size_t) frames, 0.0f);
    std::vector<float> fr ((size_t) frameLen);
    for (int f = 0; f < frames; ++f)
    {
        int centre = f * 64;
        int start = centre - frameLen / 2;
        bool ok = start >= 0 && start + frameLen <= (int) d.size();
        // level on the original signal
        double e = 0; int cnt = 0;
        for (int i = juce::jmax (0, f * t.hop - t.hop); i < juce::jmin (n, f * t.hop + t.hop); ++i) { e += (double) x[i] * x[i]; ++cnt; }
        t.rms[(size_t) f] = cnt > 0 ? (float) std::sqrt (e / cnt) : 0.0f;
        if (! ok || t.rms[(size_t) f] < 0.002f) continue;
        for (int i = 0; i < frameLen; ++i) fr[(size_t) i] = d[(size_t) (start + i)];
        float c = 0;
        auto hz = yin (fr.data(), frameLen, srD, minHz, maxHz, c);
        t.hz[(size_t) f] = hz;
        t.confidence[(size_t) f] = c;
        if (progress && (f & 255) == 0 && ! progress ((float) f / (float) frames)) break;
    }
    // clean up: octave slips and single-frame blips
    for (int f = 1; f + 1 < frames; ++f)
    {
        auto p = t.hz[(size_t) f - 1], c = t.hz[(size_t) f], q = t.hz[(size_t) f + 1];
        if (c <= 0 || p <= 0 || q <= 0) continue;
        auto ref = std::sqrt (p * q);
        auto r = c / ref;
        if (r > 1.85f && r < 2.15f) t.hz[(size_t) f] = c * 0.5f;
        else if (r > 0.465f && r < 0.54f) t.hz[(size_t) f] = c * 2.0f;
    }
    for (int f = 1; f + 1 < frames; ++f)
        if (t.hz[(size_t) f] > 0 && t.hz[(size_t) f - 1] <= 0 && t.hz[(size_t) f + 1] <= 0) t.hz[(size_t) f] = 0;
    return t;
}

//==============================================================================
std::vector<double> detectOnsets (const float* x, int n, double sr, OnsetStyle style)
{
    constexpr int order = 10, N = 1 << order;
    int hop = 256;
    juce::dsp::FFT fft (order);
    std::vector<float> win (N), buf (2 * N), prev (N / 2 + 1, 0.0f);
    for (int i = 0; i < N; ++i) win[(size_t) i] = 0.5f - 0.5f * std::cos (juce::MathConstants<float>::twoPi * (float) i / (float) N);
    int frames = juce::jmax (0, (n - N) / hop + 1);
    std::vector<float> flux ((size_t) frames, 0.0f);
    for (int f = 0; f < frames; ++f)
    {
        std::fill (buf.begin(), buf.end(), 0.0f);
        for (int i = 0; i < N; ++i) buf[(size_t) i] = x[f * hop + i] * win[(size_t) i];
        fft.performFrequencyOnlyForwardTransform (buf.data());
        float s = 0;
        for (int k = 1; k <= N / 2; ++k)
        {
            auto l = std::log1p (20.0f * buf[(size_t) k]);
            auto dlt = l - prev[(size_t) k];
            if (dlt > 0) s += dlt;
            prev[(size_t) k] = l;
        }
        flux[(size_t) f] = s;
    }
    if (frames < 3) return {};
    // adaptive threshold
    float mean = 0; for (auto v : flux) mean += v; mean /= (float) frames;
    double minGap = style == OnsetStyle::drums ? 0.04 : style == OnsetStyle::tight ? 0.05 : style == OnsetStyle::normal ? 0.07 : 0.12;
    float delta = style == OnsetStyle::vocal ? 0.6f : 0.35f;
    std::vector<double> onsets;
    std::vector<float> tops;
    std::vector<float> win2;
    for (int f = 1; f + 1 < frames; ++f)
    {
        int a = juce::jmax (0, f - 8), b = juce::jmin (frames - 1, f + 8);
        win2.assign (flux.begin() + a, flux.begin() + b + 1);
        std::nth_element (win2.begin(), win2.begin() + (long) win2.size() / 2, win2.end());
        auto th = win2[win2.size() / 2] * 1.25f + delta * mean;
        bool peak = flux[(size_t) f] > th;
        for (int k = juce::jmax (0, f - 3); k <= juce::jmin (frames - 1, f + 3) && peak; ++k)
            if (flux[(size_t) k] > flux[(size_t) f]) peak = false;
        if (! peak) continue;
        // place it where the attack starts: back from the loudest moment to where the level was 15% of the way up
        int centre = f * hop + N / 2;
        int from = juce::jmax (0, centre - N / 2 - 256), to = juce::jmin (n - 1, centre + N / 2);
        float env = 0, top = 0;
        int peakAt = from;
        std::vector<float> e ((size_t) (to - from + 1));
        auto rel = (float) std::exp (-1.0 / (sr * 0.0007));
        for (int i = from; i <= to; ++i)
        {
            auto x2 = std::abs (x[i]);
            env = x2 > env ? x2 : rel * env + (1 - rel) * x2;
            e[(size_t) (i - from)] = env;
            if (env > top) { top = env; peakAt = i; }
        }
        float base = top;
        for (int i = from; i <= peakAt; ++i) base = juce::jmin (base, e[(size_t) (i - from)]);
        auto level = base + (top - base) * 0.15f;
        int best = peakAt;
        while (best > from && e[(size_t) (best - 1 - from)] > level) --best;
        // a real start: the level comes up out of something quieter (vibrato and tone changes don't)
        {
            auto w = juce::jmax (16, (int) (0.01 * sr));
            auto rmsAt = [&] (int at) { double e = 0; int c = 0; for (int i = juce::jmax (0, at); i < juce::jmin (n, at + w); ++i) { e += (double) x[i] * x[i]; ++c; } return c > 0 ? std::sqrt (e / c) : 0.0; };
            double before = 1e9, after = 0;
            for (int at = best - (int) (0.1 * sr); at <= best - w; at += w / 2) before = juce::jmin (before, rmsAt (at));
            for (int at = best; at <= best + (int) (0.08 * sr); at += w / 2) after = juce::jmax (after, rmsAt (at));
            if (before > 1e8) before = 0;
            auto needed = style == OnsetStyle::vocal ? 2.0 : 1.41;
            if (after < before * needed) continue;
        }
        auto t = (double) best / sr;
        if (! onsets.empty() && t - onsets.back() < minGap) continue;
        onsets.push_back (t);
        tops.push_back (top);
    }
    // drop the faint ones (room noise, tails) - more than ~26 dB under the loudest hits
    if (tops.empty()) return onsets;
    auto sorted = tops;
    std::sort (sorted.begin(), sorted.end());
    auto loud = sorted[(size_t) ((sorted.size() - 1) * 9 / 10)];
    std::vector<double> kept;
    for (size_t i = 0; i < onsets.size(); ++i)
        if (tops[i] >= loud * (style == OnsetStyle::vocal ? 0.035f : 0.05f)) kept.push_back (onsets[i]);
    return kept;
}

double estimateTempo (const std::vector<double>& onsets)
{
    if (onsets.size() < 8) return 0;
    double bestBpm = 0, bestMag = 0;
    for (double bpm = 60; bpm <= 200; bpm += 0.25)
    {
        auto period = 60.0 / bpm;
        double re = 0, im = 0, re2 = 0, im2 = 0;
        for (auto t : onsets)
        {
            auto ph = juce::MathConstants<double>::twoPi * t / period;
            re += std::cos (ph); im += std::sin (ph);
            re2 += std::cos (ph * 2); im2 += std::sin (ph * 2);
        }
        auto mag = std::sqrt (re * re + im * im) + 0.5 * std::sqrt (re2 * re2 + im2 * im2);
        if (mag > bestMag) { bestMag = mag; bestBpm = bpm; }
    }
    auto confidence = bestMag / (1.5 * (double) onsets.size());
    return confidence > 0.35 ? bestBpm : 0.0;
}

//==============================================================================
std::vector<TuneNote> segmentNotes (const PitchTrack& t, int key, Scale scale)
{
    std::vector<TuneNote> notes;
    float maxRms = 0;
    for (auto r : t.rms) maxRms = juce::jmax (maxRms, r);
    auto gate = maxRms * 0.02f;   // -34 dB from the loudest moment
    auto voiced = [&] (int f) { return t.hz[(size_t) f] > 0 && t.confidence[(size_t) f] > 0.45f && t.rms[(size_t) f] > gate; };

    int f = 0, frames = t.frames();
    auto frameSec = (double) t.hop / t.sampleRate;
    while (f < frames)
    {
        if (! voiced (f)) { ++f; continue; }
        int start = f;
        std::vector<float> pitches;
        float running = t.midiAt (f);
        int away = 0;
        while (f < frames && voiced (f))
        {
            auto m = t.midiAt (f);
            if (std::abs (m - running) > 0.8f) { if (++away >= 4) break; }
            else { away = 0; pitches.push_back (m); running += (m - running) * 0.15f; }
            ++f;
        }
        int end = f - away;
        if (end <= start) end = start + 1;
        if (! pitches.empty() && (end - start) * frameSec >= 0.05)
        {
            std::vector<float> p = pitches;
            std::nth_element (p.begin(), p.begin() + (long) p.size() / 2, p.end());
            TuneNote n;
            n.start = start * frameSec;
            n.end = end * frameSec;
            n.pitch = p[p.size() / 2];
            n.target = nearestInScale (n.pitch, key, scale);
            notes.push_back (n);
        }
        if (away > 0) f = end;
    }
    return notes;
}

static void zeroPhaseSmooth (std::vector<float>& v, float alpha)
{
    float s = v.empty() ? 0.0f : v.front();
    for (auto& x : v) { s += (x - s) * alpha; x = s; }
    s = v.empty() ? 0.0f : v.back();
    for (auto it = v.rbegin(); it != v.rend(); ++it) { s += (*it - s) * alpha; *it = s; }
}

std::vector<float> shiftCurve (const PitchTrack& t, const std::vector<TuneNote>& notes, float tightness, float glideMs)
{
    int frames = t.frames();
    std::vector<float> base ((size_t) frames, 0.0f), detail ((size_t) frames, 0.0f);
    auto frameSec = (double) t.hop / t.sampleRate;
    for (auto& n : notes)
    {
        if (! n.tune) continue;
        int a = juce::jmax (0, (int) std::floor (n.start / frameSec)), b = juce::jmin (frames, (int) std::ceil (n.end / frameSec));
        for (int f = a; f < b; ++f)
        {
            base[(size_t) f] = (float) n.target - n.pitch;
            auto m = t.midiAt (f);
            if (m > 0 && std::abs (m - n.pitch) < 2.0f) detail[(size_t) f] = -tightness * (m - n.pitch);
        }
        // let notes keep their base shift through short gaps to the next note (no wobble in consonants)
    }
    auto alpha = (float) (1.0 - std::exp (-frameSec * 1000.0 / juce::jmax (1.0f, glideMs)));
    zeroPhaseSmooth (base, alpha);
    zeroPhaseSmooth (detail, juce::jmin (1.0f, alpha * 3.0f));
    std::vector<float> out ((size_t) frames);
    for (int f = 0; f < frames; ++f) out[(size_t) f] = base[(size_t) f] + detail[(size_t) f];
    return out;
}

//==============================================================================
namespace
{
    struct Mark { int pos; int period; bool voiced; };

    std::vector<Mark> analysisMarks (const std::vector<float>& mono, const PitchTrack& t)
    {
        std::vector<Mark> marks;
        int n = (int) mono.size();
        int unvoicedP = juce::jmax (32, (int) std::round (t.sampleRate * 0.004));
        int pos = 0;
        while (pos < n)
        {
            int f = juce::jlimit (0, t.frames() - 1, pos / t.hop);
            bool voiced = t.hz[(size_t) f] > 0 && t.confidence[(size_t) f] > 0.4f;
            int P = voiced ? juce::jlimit (16, 4000, (int) std::round (t.sampleRate / t.hz[(size_t) f])) : unvoicedP;
            marks.push_back ({ pos, P, voiced });
            int next = pos + P;
            if (voiced)
            {
                int a = next - P / 4, b = juce::jmin (n - 1, next + P / 4);
                int best = next;
                float bv = -1e9f;
                for (int i = juce::jmax (pos + P / 2, a); i <= b; ++i)
                    if (mono[(size_t) i] > bv) { bv = mono[(size_t) i]; best = i; }
                next = best;
            }
            pos = juce::jmax (pos + 1, next);
        }
        return marks;
    }
}

void psolaRender (const juce::AudioBuffer<float>& in, juce::AudioBuffer<float>& out, const PitchTrack& t,
                  const std::vector<float>& shift, std::function<bool (float)> progress)
{
    int n = in.getNumSamples(), chans = in.getNumChannels();
    out.setSize (chans, n);
    out.clear();
    std::vector<float> mono;
    mixToMono (in, mono);
    auto marks = analysisMarks (mono, t);
    if (marks.empty()) { out.makeCopyOf (in); return; }
    std::vector<float> wsum ((size_t) n, 0.0f);
    std::vector<float> window;
    auto shiftAt = [&] (int pos)
    {
        auto fpos = (double) pos / t.hop;
        int f = juce::jlimit (0, (int) shift.size() - 1, (int) fpos);
        int g = juce::jmin ((int) shift.size() - 1, f + 1);
        auto frac = (float) (fpos - f);
        return shift.empty() ? 0.0f : shift[(size_t) f] * (1 - frac) + shift[(size_t) g] * frac;
    };
    size_t i = 0;
    double s = marks.front().pos;
    int count = 0;
    while (s < n)
    {
        int si = (int) s;
        while (i + 1 < marks.size() && std::abs (marks[i + 1].pos - si) <= std::abs (marks[i].pos - si)) ++i;
        auto& m = marks[i];
        auto sh = m.voiced ? shiftAt (m.pos) : 0.0f;
        auto ratio = std::pow (2.0f, sh / 12.0f);
        int P = m.period;
        if ((int) window.size() != 2 * P + 1)
        {
            window.resize ((size_t) (2 * P + 1));
            for (int k = 0; k <= 2 * P; ++k) window[(size_t) k] = 0.5f - 0.5f * std::cos (juce::MathConstants<float>::pi * (float) k / (float) P);
        }
        for (int k = -P; k <= P; ++k)
        {
            int src = m.pos + k, dst = si + k;
            if (src < 0 || src >= n || dst < 0 || dst >= n) continue;
            auto w = window[(size_t) (k + P)];
            for (int c = 0; c < chans; ++c) out.addSample (c, dst, in.getSample (c, src) * w);
            wsum[(size_t) dst] += w;
        }
        s += m.voiced ? (double) P / ratio : (double) P;
        if (progress && (++count & 1023) == 0 && ! progress ((float) (s / n))) break;
    }
    for (int k = 0; k < n; ++k)
    {
        auto w = wsum[(size_t) k];
        auto g = w > 0.25f ? 1.0f / w : (w > 1e-6f ? 4.0f : 0.0f);
        for (int c = 0; c < chans; ++c) out.setSample (c, k, out.getSample (c, k) * g);
    }
}

//==============================================================================
void RealtimeTuner::prepare (double sampleRate, int)
{
    sr = sampleRate;
    dec = decimationFor (sr);
    maxPeriod = (int) std::ceil (sr / 80.0);
    latency = 3 * maxPeriod + 64;
    for (int c = 0; c < 2; ++c) { in[c].assign (ringSize, 0.0f); acc[c].assign (ringSize, 0.0f); }
    wsum.assign (ringSize, 0.0f);
    decBuf.assign (8192, 0.0f);
    frame.assign (4096, 0.0f);
    reset();
}

void RealtimeTuner::reset()
{
    for (int c = 0; c < 2; ++c) { std::fill (in[c].begin(), in[c].end(), 0.0f); std::fill (acc[c].begin(), acc[c].end(), 0.0f); }
    std::fill (wsum.begin(), wsum.end(), 0.0f);
    std::fill (decBuf.begin(), decBuf.end(), 0.0f);
    written = decWritten = lastDetect = 0;
    nextSynth = nextAnalysis = latency;
    marks.clear();
    lp1 = lp2 = 0; f0 = conf = smoothShift = centre = 0; heldTarget = -1;
}

void RealtimeTuner::detect()
{
    double srD = sr / dec;
    int tauMax = (int) std::ceil (srD / 80.0);
    int frameLen = juce::jmin ((int) frame.size(), 2 * tauMax + 4);
    if (decWritten < frameLen) return;
    auto mask = (juce::int64) decBuf.size() - 1;
    for (int i = 0; i < frameLen; ++i) frame[(size_t) i] = decBuf[(size_t) ((decWritten - frameLen + i) & mask)];
    float c = 0;
    auto hz = yin (frame.data(), frameLen, srD, 80.0f, 1100.0f, c);
    f0 = c > 0.5f ? hz : 0.0f;
    conf = c;
}

void RealtimeTuner::makeAnalysisMarks (juce::int64 upTo)
{
    auto mask = (juce::int64) ringSize - 1;
    int unvoicedP = juce::jmax (32, (int) std::round (sr * 0.004));
    while (nextAnalysis + maxPeriod < upTo)
    {
        bool voiced = f0 > 0;
        int P = voiced ? juce::jlimit (16, maxPeriod, (int) std::round (sr / f0)) : unvoicedP;
        marks.emplace_back (nextAnalysis, voiced ? P : -P);
        auto next = nextAnalysis + P;
        if (voiced)
        {
            auto best = next; float bv = -1e9f;
            for (auto k = juce::jmax (nextAnalysis + P / 2, next - P / 4); k <= next + P / 4; ++k)
            {
                float v = 0;
                for (int ch = 0; ch < channels; ++ch) v += in[ch][(size_t) (k & mask)];
                if (v > bv) { bv = v; best = k; }
            }
            next = best;
        }
        nextAnalysis = juce::jmax (nextAnalysis + 1, next);
        while (marks.size() > 64) marks.pop_front();
    }
}

void RealtimeTuner::process (float* const* ch, int numCh, int numSamples)
{
    channels = juce::jlimit (1, 2, numCh);
    auto mask = (juce::int64) ringSize - 1;
    auto dmask = (juce::int64) decBuf.size() - 1;
    // decimation filter coefficient (one-pole x2 at about 4 kHz on the original rate)
    auto a = (float) (1.0 - std::exp (-2.0 * juce::MathConstants<double>::pi * 4000.0 / sr));
    int pos = 0;
    while (pos < numSamples)
    {
        int m = juce::jmin (64, numSamples - pos);
        for (int i = 0; i < m; ++i)
        {
            float mono = 0;
            for (int c = 0; c < channels; ++c) { in[c][(size_t) (written & mask)] = ch[c][pos + i]; mono += ch[c][pos + i]; }
            mono /= (float) channels;
            lp1 += a * (mono - lp1); lp2 += a * (lp1 - lp2);
            if ((written % dec) == 0) decBuf[(size_t) (decWritten++ & dmask)] = lp2;
            ++written;
        }
        if (written - lastDetect >= 128) { detect(); lastDetect = written; }
        makeAnalysisMarks (written);

        // synthesis marks up to what this block outputs
        auto outEnd = written - latency;
        auto speed = speedMs.load(), amt = amount.load(), hum = humanize.load();
        while (nextSynth <= outEnd + maxPeriod && ! marks.empty())
        {
            // nearest analysis mark
            size_t best = 0;
            for (size_t k = 1; k < marks.size(); ++k)
                if (std::abs (marks[k].first - nextSynth) < std::abs (marks[best].first - nextSynth)) best = k;
            auto mk = marks[best];
            bool voiced = mk.second > 0;
            int P = std::abs (mk.second);
            float ratio = 1.0f;
            if (voiced)
            {
                auto midi = 69.0f + 12.0f * std::log2 ((float) (sr / P) / 440.0f);
                auto stepMs = (float) (1000.0 * P / sr);
                centre += (midi - centre) * (std::abs (midi - centre) > 1.5f ? 1.0f : juce::jmin (1.0f, stepMs / (40.0f + 300.0f * hum)));
                auto basis = midi + (centre - midi) * hum;
                int target = nearestInScale (basis, key.load(), (Scale) scale.load());
                if (heldTarget >= 0 && std::abs (basis - (float) heldTarget) < 0.65f) target = heldTarget;
                heldTarget = target;
                auto desired = ((float) target - basis) * amt;
                auto k = speed <= 0.5f ? 1.0f : juce::jmin (1.0f, stepMs / speed);
                smoothShift += (desired - smoothShift) * k;
                ratio = std::pow (2.0f, smoothShift / 12.0f);
                detectedMidi = midi; targetMidi = (float) target;
            }
            else
            {
                smoothShift *= 0.9f;
                heldTarget = -1;
                detectedMidi = 0; targetMidi = 0;
            }
            // overlap-add the grain
            for (int k = -P; k <= P; ++k)
            {
                auto w = 0.5f - 0.5f * std::cos (juce::MathConstants<float>::pi * (float) (k + P) / (float) P);
                auto dst = (size_t) ((nextSynth + k) & mask), src = (size_t) ((mk.first + k) & mask);
                for (int c = 0; c < channels; ++c) acc[c][dst] += in[c][src] * w;
                wsum[dst] += w;
            }
            nextSynth += voiced ? juce::jmax (8, (int) std::round ((float) P / ratio)) : P;
        }

        // output this sub-block (delayed by the latency)
        auto mx = mix.load();
        for (int i = 0; i < m; ++i)
        {
            auto o = written - m + i - latency;
            if (o < 0) { for (int c = 0; c < channels; ++c) ch[c][pos + i] = 0; continue; }
            auto idx = (size_t) (o & mask);
            auto w = wsum[idx];
            auto g = w > 0.25f ? 1.0f / w : (w > 1e-6f ? 4.0f : 0.0f);
            for (int c = 0; c < channels; ++c)
            {
                auto wet = acc[c][idx] * g;
                ch[c][pos + i] = wet * mx + in[c][idx] * (1.0f - mx);
                acc[c][idx] = 0;
            }
            wsum[idx] = 0;
        }
        pos += m;
    }
    if (numCh > channels)
        for (int c = channels; c < numCh; ++c) juce::FloatVectorOperations::copy (ch[c], ch[0], numSamples);
}

//==============================================================================
SectionScore scoreSection (const float* x, int n, double sr, int key, Scale scale, double secondsPerGrid, double gridOffset)
{
    SectionScore s;
    if (n <= 0) { s.silent = true; s.total = -10; return s; }
    double e = 0; int clips = 0;
    for (int i = 0; i < n; ++i) { e += (double) x[i] * x[i]; if (std::abs (x[i]) > 0.985f) ++clips; }
    auto rms = std::sqrt (e / n);
    auto db = juce::Decibels::gainToDecibels ((float) rms, -120.0f);
    s.clipped = clips > 3;
    s.silent = db < -48.0f;
    if (s.silent) { s.total = -5; return s; }
    // in tune: the average distance (cents) of steady voiced moments from the nearest note in the key
    auto pt = analysePitch (x, n, sr);
    double cents = 0; int voiced = 0;
    for (int f = 0; f < pt.frames(); ++f)
        if (pt.hz[(size_t) f] > 0 && pt.confidence[(size_t) f] > 0.6f)
        {
            auto m = pt.midiAt (f);
            cents += std::abs (m - (float) nearestInScale (m, key, scale)) * 100.0;
            ++voiced;
        }
    s.pitch = voiced > 4 ? (float) juce::jlimit (0.0, 1.0, 1.0 - (cents / voiced) / 50.0) : 0.6f;
    // in time: onsets close to the grid
    auto onsets = detectOnsets (x, n, sr, OnsetStyle::normal);
    if (! onsets.empty() && secondsPerGrid > 0)
    {
        double dev = 0;
        for (auto o : onsets)
        {
            auto t = o + gridOffset;
            auto g = std::round (t / secondsPerGrid) * secondsPerGrid;
            dev += std::abs (t - g) / (secondsPerGrid * 0.5);
        }
        s.timing = (float) juce::jlimit (0.0, 1.0, 1.0 - dev / (double) onsets.size());
    }
    else s.timing = 0.6f;
    // level: a healthy level scores best
    s.level = (float) juce::jlimit (0.0, 1.0, 1.0 - std::abs (db + 18.0) / 30.0);
    s.total = 0.55f * s.pitch + 0.3f * s.timing + 0.15f * s.level - (s.clipped ? 0.6f : 0.0f);
    return s;
}

//==============================================================================
bool readAudio (te::Engine& engine, const juce::File& f, juce::AudioBuffer<float>& buf, double& sampleRate)
{
    std::unique_ptr<juce::AudioFormatReader> r (engine.getAudioFileFormatManager().readFormatManager.createReaderFor (f));
    if (r == nullptr) return false;
    int chans = (int) juce::jlimit (1u, 2u, r->numChannels);
    buf.setSize (chans, (int) r->lengthInSamples);
    r->read (&buf, 0, (int) r->lengthInSamples, 0, true, chans > 1);
    sampleRate = r->sampleRate;
    return true;
}

bool writeWav (const juce::File& f, const juce::AudioBuffer<float>& buf, double sampleRate)
{
    f.deleteFile();
    juce::WavAudioFormat wav;
    auto stream = f.createOutputStream();
    if (stream == nullptr) return false;
    auto opts = juce::AudioFormatWriterOptions().withSampleRate (sampleRate).withNumChannels (buf.getNumChannels()).withBitsPerSample (24);
    std::unique_ptr<juce::OutputStream> os (stream.release());
    auto w = wav.createWriterFor (os, opts);
    if (w == nullptr) return false;
    return w->writeFromAudioSampleBuffer (buf, 0, buf.getNumSamples());
}

void mixToMono (const juce::AudioBuffer<float>& b, std::vector<float>& mono)
{
    mono.assign ((size_t) b.getNumSamples(), 0.0f);
    auto g = 1.0f / (float) juce::jmax (1, b.getNumChannels());
    for (int c = 0; c < b.getNumChannels(); ++c)
        juce::FloatVectorOperations::addWithMultiply (mono.data(), b.getReadPointer (c), g, b.getNumSamples());
}

} // namespace ms::vocal

//==============================================================================
namespace ms::vocal
{
void warpRender (const juce::AudioBuffer<float>& in, double sr, const std::vector<WarpKnot>& knots, double outSeconds,
                 juce::AudioBuffer<float>& out, std::function<bool (float)> progress)
{
    int chans = in.getNumChannels(), inLen = in.getNumSamples();
    int outLen = juce::jmax (1, (int) std::round (outSeconds * sr));
    out.setSize (chans, outLen);
    out.clear();
    if (inLen == 0) return;

    const int L = sr > 70000 ? 2048 : 1024, Ha = L / 2, tol = L / 4;
    std::vector<float> win ((size_t) L);
    for (int k = 0; k < L; ++k) win[(size_t) k] = 0.5f - 0.5f * std::cos (juce::MathConstants<float>::twoPi * (float) k / (float) L);
    std::vector<float> mono;
    mixToMono (in, mono);
    std::vector<float> wsum ((size_t) outLen + (size_t) L, 0.0f);

    auto mapOut = [&] (double tOut)   // output seconds -> source seconds
    {
        if (knots.empty()) return tOut;
        if (tOut <= knots.front().out) return knots.front().src + (tOut - knots.front().out);
        if (tOut >= knots.back().out) return knots.back().src + (tOut - knots.back().out);
        auto it = std::upper_bound (knots.begin(), knots.end(), tOut, [] (double t, const WarpKnot& k) { return t < k.out; });
        auto& b = *it; auto& a = *(it - 1);
        return a.src + (b.src - a.src) * (tOut - a.out) / juce::jmax (1e-9, b.out - a.out);
    };
    auto nearOnset = [&] (double tOut)
    {
        auto lo = tOut - (double) L / sr, hi = tOut + (double) L / sr;
        for (auto& k : knots)
            if (k.onset && k.out >= lo && k.out <= hi) return true;
        return false;
    };
    auto sample = [&] (int i) { return i >= 0 && i < inLen ? mono[(size_t) i] : 0.0f; };

    int prevSrc = -1;
    int frames = outLen / Ha + 2;
    for (int f = 0; f < frames; ++f)
    {
        int outPos = f * Ha - L / 2;
        auto centreOut = (double) (outPos + L / 2) / sr;
        int nominal = (int) std::round (mapOut (centreOut) * sr) - L / 2;
        int best = nominal;
        if (prevSrc >= 0 && ! nearOnset (centreOut))
        {
            // the start that best continues the previous frame (coarse search, then fine)
            int natural = prevSrc + Ha;
            auto corr = [&] (int cand, int step)
            {
                double s = 0;
                for (int k = 0; k < L; k += step) s += (double) sample (natural + k) * sample (cand + k);
                return s;
            };
            double bestC = -1e30;
            for (int d = -tol; d <= tol; d += 4)
            {
                auto c = corr (nominal + d, 4);
                if (c > bestC) { bestC = c; best = nominal + d; }
            }
            int coarse = best;
            bestC = -1e30;
            for (int d = -4; d <= 4; ++d)
            {
                auto c = corr (coarse + d, 1);
                if (c > bestC) { bestC = c; best = coarse + d; }
            }
        }
        prevSrc = best;
        for (int k = 0; k < L; ++k)
        {
            int o = outPos + k, s = best + k;
            if (o < 0 || o >= outLen || s < 0 || s >= inLen) continue;
            auto w = win[(size_t) k];
            for (int c = 0; c < chans; ++c) out.addSample (c, o, in.getSample (c, s) * w);
            wsum[(size_t) o] += w;
        }
        if (progress && (f & 127) == 0 && ! progress ((float) f / (float) frames)) return;
    }
    for (int o = 0; o < outLen; ++o)
    {
        auto w = wsum[(size_t) o];
        auto g = w > 0.05f ? 1.0f / w : 0.0f;
        for (int c = 0; c < chans; ++c) out.setSample (c, o, out.getSample (c, o) * g);
    }
}
} // namespace ms::vocal
