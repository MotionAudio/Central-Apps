#include "MotionProcessors.h"
#include "VocalDSP.h"

/* Motion Audio's vocal and mixing tools:
 *   Motion Tune              real-time pitch correction to the song's key (the Tune tab does the note-by-note version)
 *   Motion Denoise           spectral background-noise removal (adaptive, or learned from a stretch of noise)
 *   Motion De-Esser          split-band, level-independent de-esser with a harshness band and look-ahead
 *   Motion Sidechain Ducker  ducks a track from another track (kick, voice-over) or in time with the beat */

namespace ms
{

static const juce::StringArray keyNames { "C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B" };

//==============================================================================
/** A thin vertical meter for gain reduction (dB, drawn down from the top). */
class ReductionMeter : public juce::Component
{
public:
    float db = 0.0f, maxDb = 24.0f;
    juce::String label { "GR" };
    void paint (juce::Graphics& g) override
    {
        auto r = getLocalBounds().toFloat();
        auto text = r.removeFromBottom (16);
        g.setColour (Colours::bg2);
        g.fillRoundedRectangle (r, 3.0f);
        auto frac = juce::jlimit (0.0f, 1.0f, db / maxDb);
        g.setColour (Colours::gold);
        g.fillRoundedRectangle (r.withHeight (r.getHeight() * frac).reduced (2, 1), 2.0f);
        g.setColour (Colours::line2);
        for (float d = 6; d < maxDb; d += 6)
            g.fillRect (r.getX(), r.getY() + r.getHeight() * d / maxDb, 4.0f, 1.0f);
        g.setColour (Colours::muted);
        g.setFont (Fonts::narrow (11.0f));
        g.drawText (label + " " + juce::String (db, 1), text, juce::Justification::centred);
    }
};

static void styleToggle (juce::ToggleButton& t)
{
    t.setColour (juce::ToggleButton::tickColourId, Colours::gold);
    t.setColour (juce::ToggleButton::textColourId, Colours::text);
}

//==============================================================================
// Motion Tune
//==============================================================================
class TuneProcessor : public MotionProcessorBase
{
public:
    TuneProcessor (const MotionPluginInfo& i) : MotionProcessorBase (i)
    {
        key = addChoice ("key", "Key", keyNames, 0);
        scale = addChoice ("scale", "Scale", vocal::scaleNames(), 0);
        speed = addFloat ("speed", "Retune", 0.0f, 400.0f, 25.0f, "ms");
        amount = addFloat ("amount", "Amount", 0.0f, 100.0f, 100.0f, "%");
        humanize = addFloat ("humanize", "Humanize", 0.0f, 100.0f, 25.0f, "%");
        mix = addFloat ("mix", "Mix", 0.0f, 100.0f, 100.0f, "%");
        follow = addBool ("follow", "Follow song key", true);
    }

    void prepareToPlay (double sr, int bs) override
    {
        tuner.prepare (sr, bs);
        setLatencySamples (tuner.getLatency());
    }

    void processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) override
    {
        juce::ScopedNoDenormals nd;
        tuner.key = key->getIndex();
        tuner.scale = scale->getIndex();
        tuner.speedMs = speed->get();
        tuner.amount = amount->get() / 100.0f;
        tuner.humanize = humanize->get() / 100.0f;
        tuner.mix = mix->get() / 100.0f;
        auto chans = juce::jmin (2, buffer.getNumChannels());
        tuner.process (buffer.getArrayOfWritePointers(), chans, buffer.getNumSamples());
    }

    void releaseResources() override {}
    juce::AudioProcessorEditor* createEditor() override;

    vocal::RealtimeTuner tuner;
    juce::AudioParameterChoice* key = nullptr;
    juce::AudioParameterChoice* scale = nullptr;
    juce::AudioParameterFloat *speed = nullptr, *amount = nullptr, *humanize = nullptr, *mix = nullptr;
    juce::AudioParameterBool* follow = nullptr;
};

class TuneEditor : public MotionEditorBase, private juce::Timer
{
public:
    TuneEditor (TuneProcessor& p) : MotionEditorBase (p), proc (p), knobs (p)
    {
        subtitle = "Pitch correction";
        addAndMakeVisible (knobs);
        styleToggle (follow);
        follow.setTooltip ("Use the song's key (set it at the top of Motion Studio)");
        addAndMakeVisible (follow);
        followAttach = std::make_unique<juce::ButtonParameterAttachment> (*p.follow, follow);
        setSize (560, 44 + 10 + 126 + knobs.preferredHeight (536) + 44);
        startTimerHz (30);
    }

    void timerCallback() override
    {
        auto d = proc.tuner.detectedMidi.load(), t = proc.tuner.targetMidi.load();
        shownDetected += (d - shownDetected) * (d > 0 && shownDetected > 0 ? 0.35f : 1.0f);
        shownTarget = t;
        repaint (display);
    }

    void paint (juce::Graphics& g) override
    {
        MotionEditorBase::paint (g);
        auto r = display.toFloat();
        g.setColour (Colours::bg2);
        g.fillRoundedRectangle (r, 6.0f);
        g.setColour (Colours::line);
        g.drawRoundedRectangle (r, 6.0f, 1.0f);
        bool voiced = shownDetected > 0 && shownTarget > 0;
        auto left = r.removeFromLeft (180.0f);
        g.setFont (Fonts::heavy (46.0f));
        g.setColour (voiced ? Colours::gold : Colours::dim);
        g.drawText (voiced ? vocal::noteName ((int) shownTarget) : juce::String ("--"), left.reduced (10, 10), juce::Justification::centred);
        // cents meter: how far the singer is from the note it's going to
        auto meter = r.reduced (18, 22);
        auto mid = meter.getCentreX();
        g.setColour (Colours::line2);
        g.fillRect (meter.withHeight (2.0f).withY (meter.getCentreY()));
        g.setFont (Fonts::narrow (11.0f));
        for (int c = -50; c <= 50; c += 25)
        {
            auto x = mid + meter.getWidth() * 0.5f * (float) c / 50.0f;
            g.setColour (c == 0 ? Colours::gold : Colours::line2);
            g.fillRect (x - 0.5f, meter.getCentreY() - (c == 0 ? 16.0f : 8.0f), 1.0f, c == 0 ? 34.0f : 18.0f);
            g.setColour (Colours::muted);
            g.drawText ((c > 0 ? "+" : "") + juce::String (c), juce::Rectangle<float> (x - 20, meter.getBottom() - 12, 40, 14), juce::Justification::centred);
        }
        if (voiced)
        {
            auto cents = juce::jlimit (-50.0f, 50.0f, (shownDetected - shownTarget) * 100.0f);
            auto x = mid + meter.getWidth() * 0.5f * cents / 50.0f;
            g.setColour (std::abs (cents) < 10 ? Colours::ok : Colours::goldHi);
            g.fillEllipse (x - 7, meter.getCentreY() - 6, 14, 14);
            g.setColour (Colours::muted);
            g.setFont (Fonts::ui (12.5f));
            g.drawText ("singing " + vocal::noteName ((int) std::round (shownDetected)) + (cents >= 0 ? "  +" : "  ") + juce::String ((int) cents) + " cents",
                        meter.withHeight (18).translated (0, -4), juce::Justification::centred);
        }
        else
        {
            g.setColour (Colours::muted);
            g.setFont (Fonts::ui (12.5f));
            g.drawText ("Waiting for a voice", meter.withHeight (18).translated (0, -4), juce::Justification::centred);
        }
    }

    void resized() override
    {
        auto r = content();
        display = r.removeFromTop (116);
        r.removeFromTop (10);
        follow.setBounds (r.removeFromBottom (28).removeFromLeft (220));
        knobs.setBounds (r);
    }

    TuneProcessor& proc;
    ParamKnobPanel knobs;
    juce::ToggleButton follow { "Follow song key" };
    std::unique_ptr<juce::ButtonParameterAttachment> followAttach;
    juce::Rectangle<int> display;
    float shownDetected = 0, shownTarget = 0;
};

juce::AudioProcessorEditor* TuneProcessor::createEditor()  { return new TuneEditor (*this); }
std::unique_ptr<juce::AudioPluginInstance> createTuneProcessor (const MotionPluginInfo& i)  { return std::make_unique<TuneProcessor> (i); }

//==============================================================================
// Motion Denoise
//==============================================================================
class DenoiseProcessor : public MotionProcessorBase
{
public:
    static constexpr int order = 11, N = 1 << order, hop = N / 4, bins = N / 2 + 1, bands = 48;

    DenoiseProcessor (const MotionPluginInfo& i) : MotionProcessorBase (i), fft (order)
    {
        reduction = addFloat ("reduction", "Reduction", 0.0f, 40.0f, 18.0f, "dB");
        sensitivity = addFloat ("sensitivity", "Sensitivity", 0.0f, 100.0f, 50.0f, "%");
        smoothing = addFloat ("smooth", "Smoothing", 0.0f, 100.0f, 50.0f, "%");
        output = addFloat ("output", "Output", -12.0f, 12.0f, 0.0f, "dB");
        mode = addChoice ("mode", "Noise", { "Adaptive", "Learned" }, 0);
        learn = addBool ("learn", "Learn noise", false);
        listen = addBool ("listen", "Listen to removed noise", false);
        window.resize (N);
        for (int k = 0; k < N; ++k)
            window[(size_t) k] = std::sqrt (0.5f - 0.5f * std::cos (juce::MathConstants<float>::twoPi * (float) k / (float) N));
        profile.assign (bins, 0.0f);
    }

    void prepareToPlay (double sr, int) override
    {
        sampleRate = sr;
        for (int c = 0; c < 2; ++c)
        {
            inFifo[c].assign (N, 0.0f);
            outAcc[c].assign (2 * N, 0.0f);
            spec[c].assign (2 * N, 0.0f);
        }
        smoothPow.assign (bins, 0.0f);
        noiseMin.assign (bins, 0.0f);
        gains.assign (bins, 1.0f);
        prevClean.assign (bins, 0.0f);
        fifoPos = 0;
        framesSeen = 0;
        setLatencySamples (N);
    }

    void processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) override
    {
        juce::ScopedNoDenormals nd;
        int chans = juce::jmin (2, buffer.getNumChannels());
        auto outGain = juce::Decibels::decibelsToGain (output->get());
        for (int i = 0; i < buffer.getNumSamples(); ++i)
        {
            for (int c = 0; c < chans; ++c)
            {
                inFifo[c][(size_t) fifoPos] = buffer.getSample (c, i);
                buffer.setSample (c, i, outAcc[c][(size_t) fifoPos] * outGain);
                outAcc[c][(size_t) fifoPos] = 0.0f;
            }
            if (++fifoPos == N) fifoPos = 0;
            if (++hopCount == hop)
            {
                hopCount = 0;
                processFrame (chans);
            }
        }
        if (buffer.getNumChannels() > chans)
            for (int c = chans; c < buffer.getNumChannels(); ++c) buffer.copyFrom (c, 0, buffer, 0, 0, buffer.getNumSamples());
    }

    void processFrame (int chans)
    {
        // analysis: the last N samples, windowed
        for (int c = 0; c < chans; ++c)
        {
            auto& s = spec[c];
            for (int k = 0; k < N; ++k)
                s[(size_t) k] = inFifo[c][(size_t) ((fifoPos + k) % N)] * window[(size_t) k];
            std::fill (s.begin() + N, s.end(), 0.0f);
            fft.performRealOnlyForwardTransform (s.data(), true);
        }
        // power (both channels share one gain so the stereo image stays put)
        auto smoothA = 0.6f;
        auto rise = (float) std::pow (10.0, 0.4 * hop / sampleRate);       // the noise floor may climb ~4 dB a second
        bool learning = learn->get();
        bool useProfile = mode->getIndex() == 1 && profileFrames > 0 && ! learning;
        auto floorGain = juce::Decibels::decibelsToGain (-reduction->get());
        auto over = 1.0f + 3.0f * sensitivity->get() / 100.0f;
        auto dd = 0.90f + 0.08f * smoothing->get() / 100.0f;                // decision-directed smoothing (less "musical noise")
        ++framesSeen;
        if (learning && ! wasLearning) { std::fill (profile.begin(), profile.end(), 0.0f); profileFrames = 0; }
        wasLearning = learning;

        float totalIn = 0, totalOut = 0;
        for (int b = 0; b < bins; ++b)
        {
            float p = 0;
            for (int c = 0; c < chans; ++c)
            {
                auto re = spec[c][(size_t) (2 * b)], im = spec[c][(size_t) (2 * b + 1)];
                p += re * re + im * im;
            }
            p /= (float) chans;
            smoothPow[(size_t) b] = smoothPow[(size_t) b] * smoothA + p * (1 - smoothA);
            auto& nm = noiseMin[(size_t) b];
            if (framesSeen < 8) nm = smoothPow[(size_t) b];
            else nm = juce::jmin (nm * rise, smoothPow[(size_t) b]);
            if (learning) profile[(size_t) b] += p;

            auto noise = useProfile ? profile[(size_t) b] / (float) profileFrames : nm * 1.6f;
            noise = juce::jmax (noise, 1e-12f) * over;
            auto gamma = p / noise;
            auto xi = dd * prevClean[(size_t) b] / noise + (1 - dd) * juce::jmax (0.0f, gamma - 1.0f);
            auto g = xi / (1.0f + xi);
            g = juce::jmax (floorGain, g);
            gains[(size_t) b] = g;
            prevClean[(size_t) b] = g * g * p;
            totalIn += p;
        }
        if (learning) ++profileFrames;
        // a little smoothing across frequency
        float prev = gains[0];
        for (int b = 1; b + 1 < bins; ++b)
        {
            auto cur = gains[(size_t) b];
            gains[(size_t) b] = 0.25f * prev + 0.5f * cur + 0.25f * gains[(size_t) b + 1];
            prev = cur;
        }
        bool delta = listen->get();
        for (int b = 0; b < bins; ++b)
        {
            auto g = learning ? 1.0f : gains[(size_t) b];
            if (delta) g = 1.0f - g;
            for (int c = 0; c < chans; ++c) { spec[c][(size_t) (2 * b)] *= g; spec[c][(size_t) (2 * b + 1)] *= g; }
            totalOut += g * g * smoothPow[(size_t) b];
        }
        // the display: 48 log-spaced bands of signal and noise
        for (int k = 0; k < bands; ++k)
        {
            auto f0 = 40.0 * std::pow (20000.0 / 40.0, (double) k / bands), f1 = 40.0 * std::pow (20000.0 / 40.0, (double) (k + 1) / bands);
            int b0 = juce::jlimit (1, bins - 1, (int) (f0 * N / sampleRate)), b1 = juce::jlimit (b0 + 1, bins, (int) (f1 * N / sampleRate) + 1);
            float s = 0, n = 0;
            for (int b = b0; b < b1; ++b)
            {
                s += smoothPow[(size_t) b];
                n += useProfile ? profile[(size_t) b] / (float) juce::jmax (1, profileFrames) : noiseMin[(size_t) b] * 1.6f;
            }
            bandSignal[(size_t) k] = s / (float) (b1 - b0);
            bandNoise[(size_t) k] = n / (float) (b1 - b0);
        }
        meterReduction = totalIn > 1e-12f ? -gainToDb (std::sqrt (juce::jmax (1e-12f, totalOut) / totalIn)) : 0.0f;
        // synthesis
        auto norm = 0.5f;   // sqrt-Hann in and out (= Hann) at 75% overlap sums to 2
        for (int c = 0; c < chans; ++c)
        {
            auto& s = spec[c];
            fft.performRealOnlyInverseTransform (s.data());
            for (int k = 0; k < N; ++k)
                outAcc[c][(size_t) ((fifoPos + k) % N)] += s[(size_t) k] * window[(size_t) k] * norm;
        }
    }

    void saveExtra (juce::ValueTree& v) override
    {
        if (profileFrames <= 0) return;
        juce::MemoryBlock mb;
        for (auto p : profile) { auto x = p / (float) profileFrames; mb.append (&x, sizeof (float)); }
        v.setProperty ("noiseProfile", mb.toBase64Encoding(), nullptr);
    }
    void loadExtra (const juce::ValueTree& v) override
    {
        juce::MemoryBlock mb;
        if (v.hasProperty ("noiseProfile") && mb.fromBase64Encoding (v["noiseProfile"].toString()) && mb.getSize() == (size_t) bins * sizeof (float))
        {
            std::memcpy (profile.data(), mb.getData(), mb.getSize());
            profileFrames = 1;
        }
    }

    juce::AudioProcessorEditor* createEditor() override;

    juce::dsp::FFT fft;
    std::vector<float> window, inFifo[2], outAcc[2], spec[2], smoothPow, noiseMin, gains, prevClean, profile;
    int fifoPos = 0, hopCount = 0, framesSeen = 0, profileFrames = 0;
    bool wasLearning = false;
    double sampleRate = 48000.0;
    std::array<std::atomic<float>, bands> bandSignal {}, bandNoise {};
    std::atomic<float> meterReduction { 0.0f };
    juce::AudioParameterFloat *reduction = nullptr, *sensitivity = nullptr, *smoothing = nullptr, *output = nullptr;
    juce::AudioParameterChoice* mode = nullptr;
    juce::AudioParameterBool *learn = nullptr, *listen = nullptr;
};

class DenoiseEditor : public MotionEditorBase, private juce::Timer
{
public:
    DenoiseEditor (DenoiseProcessor& p) : MotionEditorBase (p), proc (p), knobs (p)
    {
        subtitle = "Background noise remover";
        addAndMakeVisible (knobs);
        for (auto* t : { &learn, &listen }) { styleToggle (*t); addAndMakeVisible (t); }
        learn.setTooltip ("Turn on while only the noise is playing (a second or two of hiss, hum or room), then turn it off and set Noise to Learned");
        listen.setTooltip ("Hear only what's being taken away");
        learnAttach = std::make_unique<juce::ButtonParameterAttachment> (*p.learn, learn);
        listenAttach = std::make_unique<juce::ButtonParameterAttachment> (*p.listen, listen);
        meter.maxDb = 30.0f;
        addAndMakeVisible (meter);
        setSize (600, 44 + 10 + 150 + knobs.preferredHeight (576) + 50);
        startTimerHz (20);
    }
    void timerCallback() override
    {
        meter.db = proc.meterReduction.load();
        meter.repaint();
        repaint (graph);
    }
    void paint (juce::Graphics& g) override
    {
        MotionEditorBase::paint (g);
        auto r = graph.toFloat();
        g.setColour (Colours::bg2);
        g.fillRoundedRectangle (r, 6.0f);
        auto toY = [&] (float p) { auto db = 10.0f * std::log10 (juce::jmax (1e-14f, p)) ; return juce::jmap (juce::jlimit (-130.0f, -10.0f, db), -130.0f, -10.0f, r.getBottom() - 4, r.getY() + 4); };
        juce::Path sig, noise;
        for (int k = 0; k < DenoiseProcessor::bands; ++k)
        {
            auto x = r.getX() + r.getWidth() * (k + 0.5f) / DenoiseProcessor::bands;
            auto ys = toY (proc.bandSignal[(size_t) k].load()), yn = toY (proc.bandNoise[(size_t) k].load());
            if (k == 0) { sig.startNewSubPath (x, ys); noise.startNewSubPath (x, yn); }
            else { sig.lineTo (x, ys); noise.lineTo (x, yn); }
        }
        g.setColour (Colours::gold);
        g.strokePath (sig, juce::PathStrokeType (1.6f));
        g.setColour (Colours::live.withAlpha (0.8f));
        g.strokePath (noise, juce::PathStrokeType (1.4f, juce::PathStrokeType::curved));
        g.setFont (Fonts::narrow (11.0f));
        g.setColour (Colours::gold);
        g.drawText ("signal", r.reduced (10, 6), juce::Justification::topLeft);
        g.setColour (Colours::live);
        g.drawText ("noise floor" + juce::String (proc.mode->getIndex() == 1 && proc.profileFrames > 0 ? " (learned)" : ""),
                    r.reduced (10, 6).translated (50, 0), juce::Justification::topLeft);
        g.setColour (Colours::muted);
        for (auto f : { 100, 1000, 10000 })
        {
            auto x = r.getX() + r.getWidth() * (float) (std::log ((double) f / 40.0) / std::log (20000.0 / 40.0));
            g.drawText (f >= 1000 ? juce::String (f / 1000) + "k" : juce::String (f), juce::Rectangle<float> (x - 20, r.getBottom() - 16, 40, 14), juce::Justification::centred);
        }
    }
    void resized() override
    {
        auto r = content();
        auto top = r.removeFromTop (140);
        meter.setBounds (top.removeFromRight (44));
        top.removeFromRight (8);
        graph = top;
        r.removeFromTop (10);
        auto toggles = r.removeFromBottom (30);
        learn.setBounds (toggles.removeFromLeft (150));
        listen.setBounds (toggles.removeFromLeft (230));
        knobs.setBounds (r);
    }
    DenoiseProcessor& proc;
    ParamKnobPanel knobs;
    ReductionMeter meter;
    juce::ToggleButton learn { "Learn noise" }, listen { "Listen to removed noise" };
    std::unique_ptr<juce::ButtonParameterAttachment> learnAttach, listenAttach;
    juce::Rectangle<int> graph;
};

juce::AudioProcessorEditor* DenoiseProcessor::createEditor()  { return new DenoiseEditor (*this); }
std::unique_ptr<juce::AudioPluginInstance> createDenoiseProcessor (const MotionPluginInfo& i)  { return std::make_unique<DenoiseProcessor> (i); }

//==============================================================================
// Motion De-Esser
//==============================================================================
struct Biquad
{
    double b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
    double z1[2] {}, z2[2] {};
    void reset() { z1[0] = z1[1] = z2[0] = z2[1] = 0; }
    void set (double nb0, double nb1, double nb2, double a0, double na1, double na2)
    { b0 = nb0 / a0; b1 = nb1 / a0; b2 = nb2 / a0; a1 = na1 / a0; a2 = na2 / a0; }
    void lowpass (double f, double sr, double q)
    { auto w = juce::MathConstants<double>::twoPi * f / sr, c = std::cos (w), al = std::sin (w) / (2 * q); set ((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + al, -2 * c, 1 - al); }
    void highpass (double f, double sr, double q)
    { auto w = juce::MathConstants<double>::twoPi * f / sr, c = std::cos (w), al = std::sin (w) / (2 * q); set ((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al); }
    void bandpass (double f, double sr, double q)
    { auto w = juce::MathConstants<double>::twoPi * f / sr, c = std::cos (w), al = std::sin (w) / (2 * q); set (al, 0, -al, 1 + al, -2 * c, 1 - al); }
    void peak (double f, double sr, double q, double db)
    {
        auto A = std::pow (10.0, db / 40.0), w = juce::MathConstants<double>::twoPi * f / sr, c = std::cos (w), al = std::sin (w) / (2 * q);
        set (1 + al * A, -2 * c, 1 - al * A, 1 + al / A, -2 * c, 1 - al / A);
    }
    inline float tick (float x, int ch)
    {
        auto y = b0 * x + z1[ch];
        z1[ch] = b1 * x - a1 * y + z2[ch];
        z2[ch] = b2 * x - a2 * y;
        return (float) y;
    }
};

class DeEsserProcessor : public MotionProcessorBase
{
public:
    DeEsserProcessor (const MotionPluginInfo& i) : MotionProcessorBase (i)
    {
        frequency = addFloat ("freq", "Frequency", 3000.0f, 12000.0f, 5500.0f, "Hz", true);
        amount = addFloat ("amount", "Amount", 0.0f, 100.0f, 50.0f, "%");
        range = addFloat ("range", "Max cut", 0.0f, 24.0f, 10.0f, "dB");
        harsh = addFloat ("harsh", "Harshness", 0.0f, 100.0f, 0.0f, "%");
        mode = addChoice ("mode", "Mode", { "Split (just the S)", "Wide (whole voice)" }, 0);
        listen = addBool ("listen", "Listen to the S", false);
    }

    void prepareToPlay (double sr, int) override
    {
        sampleRate = sr;
        lookahead = (int) std::round (sr * 0.0015);
        delay.setSize (2, lookahead + 1);
        delay.clear();
        delayPos = 0;
        lastFreq = -1;
        for (auto* f : { &lp1, &lp2, &hp1, &hp2, &detHp, &detLp, &harshBand, &harshEq }) f->reset();
        envSib = envFull = envHarsh = 0;
        grSib = grHarsh = 0;
        harshCounter = 0;
        setLatencySamples (lookahead);
    }

    void updateFilters()
    {
        auto f = (double) frequency->get();
        if (std::abs (f - lastFreq) < 1.0) return;
        lastFreq = f;
        auto q = 0.7071;
        lp1.lowpass (f, sampleRate, q); lp2.lowpass (f, sampleRate, q);    // Linkwitz-Riley 4th order (two Butterworths)
        hp1.highpass (f, sampleRate, q); hp2.highpass (f, sampleRate, q);
        detHp.highpass (f * 0.8, sampleRate, 0.6);
        detLp.lowpass (juce::jmin (sampleRate * 0.45, f * 2.4), sampleRate, 0.6);
        harshBand.bandpass (3200.0, sampleRate, 1.1);
    }

    void processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) override
    {
        juce::ScopedNoDenormals nd;
        updateFilters();
        int chans = juce::jmin (2, buffer.getNumChannels()), n = buffer.getNumSamples();
        auto att = (float) std::exp (-1.0 / (sampleRate * 0.0004)), rel = (float) std::exp (-1.0 / (sampleRate * 0.045));
        auto grAtt = (float) std::exp (-1.0 / (sampleRate * 0.0008)), grRel = (float) std::exp (-1.0 / (sampleRate * 0.06));
        auto thr = juce::jmap (amount->get() / 100.0f, 0.0f, -20.0f);          // how loud the S band may get relative to the voice
        auto maxCut = range->get();
        auto harshAmt = harsh->get() / 100.0f;
        bool split = mode->getIndex() == 0, solo = listen->get();
        float peakGr = 0;
        for (int i = 0; i < n; ++i)
        {
            // detector on the (un-delayed) input, mono
            float mono = 0;
            for (int c = 0; c < chans; ++c) mono += buffer.getSample (c, i);
            mono /= (float) chans;
            auto sib = detLp.tick (detHp.tick (mono, 0), 0);
            auto h = harshBand.tick (mono, 0);
            auto follow = [] (float& env, float x, float a, float r) { x = std::abs (x); env = x > env ? a * env + (1 - a) * x : r * env + (1 - r) * x; };
            follow (envSib, sib, att, rel);
            follow (envFull, mono, att, rel);
            follow (envHarsh, h, att, rel * 1.0f);
            float targetSib = 0;
            if (envSib > 0.0012f)   // ignore very quiet hiss
            {
                auto rel_dB = gainToDb (envSib) - gainToDb (juce::jmax (envFull, 1e-6f));
                auto over = rel_dB - thr;
                if (over > 0) targetSib = juce::jmin (maxCut, over * 2.0f);
            }
            grSib = targetSib > grSib ? grAtt * grSib + (1 - grAtt) * targetSib : grRel * grSib + (1 - grRel) * targetSib;
            float targetHarsh = 0;
            if (harshAmt > 0 && envHarsh > 0.002f)
            {
                auto rel_dB = gainToDb (envHarsh) - gainToDb (juce::jmax (envFull, 1e-6f));
                auto over = rel_dB - juce::jmap (harshAmt, -2.0f, -14.0f);
                if (over > 0) targetHarsh = juce::jmin (9.0f, over * 1.2f);
            }
            grHarsh = targetHarsh > grHarsh ? grAtt * grHarsh + (1 - grAtt) * targetHarsh : grRel * grHarsh + (1 - grRel) * targetHarsh;
            if (harshAmt > 0 && ++harshCounter >= 16)
            {
                harshCounter = 0;
                harshEq.peak (3200.0, sampleRate, 1.2, -grHarsh);
            }
            peakGr = juce::jmax (peakGr, grSib);
            auto gSib = juce::Decibels::decibelsToGain (-grSib);

            for (int c = 0; c < chans; ++c)
            {
                // look-ahead: the audio is a little behind the detector
                auto x = delay.getSample (c, delayPos);
                delay.setSample (c, delayPos, buffer.getSample (c, i));
                if (harshAmt > 0) x = harshEq.tick (x, c);
                float y;
                if (split || solo)
                {
                    auto lo = lp2.tick (lp1.tick (x, c), c);
                    auto hi = hp2.tick (hp1.tick (x, c), c);
                    // Linkwitz-Riley 4th order bands sum back flat (an all-pass), so only the S band is touched
                    y = solo ? hi : lo + hi * gSib;
                }
                else y = x * gSib;
                buffer.setSample (c, i, y);
            }
            if (++delayPos > lookahead) delayPos = 0;
        }
        if (buffer.getNumChannels() > chans)
            for (int c = chans; c < buffer.getNumChannels(); ++c) buffer.copyFrom (c, 0, buffer, 0, 0, n);
        meterGr = juce::jmax (peakGr, meterGr.load() * 0.85f);
    }

    juce::AudioProcessorEditor* createEditor() override;

    double sampleRate = 48000.0, lastFreq = -1;
    Biquad lp1, lp2, hp1, hp2, detHp, detLp, harshBand, harshEq;
    juce::AudioBuffer<float> delay;
    int delayPos = 0, lookahead = 64, harshCounter = 0;
    float envSib = 0, envFull = 0, envHarsh = 0, grSib = 0, grHarsh = 0;
    std::atomic<float> meterGr { 0.0f };
    juce::AudioParameterFloat *frequency = nullptr, *amount = nullptr, *range = nullptr, *harsh = nullptr;
    juce::AudioParameterChoice* mode = nullptr;
    juce::AudioParameterBool* listen = nullptr;
};

class DeEsserEditor : public MotionEditorBase, private juce::Timer
{
public:
    DeEsserEditor (DeEsserProcessor& p) : MotionEditorBase (p), proc (p), knobs (p)
    {
        subtitle = "Tames harsh S, T and SH sounds";
        addAndMakeVisible (knobs);
        styleToggle (listen);
        listen.setTooltip ("Hear only the part being turned down, to find the right frequency");
        addAndMakeVisible (listen);
        listenAttach = std::make_unique<juce::ButtonParameterAttachment> (*p.listen, listen);
        meter.maxDb = 24.0f;
        addAndMakeVisible (meter);
        hint.setText ("Start with Amount around 50% and sweep Frequency (5-8 kHz for most voices) until the S's sit back. "
                      "Harshness tames a piercing 3 kHz edge.", juce::dontSendNotification);
        hint.setFont (Fonts::ui (12.5f));
        hint.setColour (juce::Label::textColourId, Colours::muted);
        hint.setJustificationType (juce::Justification::topLeft);
        addAndMakeVisible (hint);
        setSize (600, 44 + 10 + 40 + knobs.preferredHeight (520) + 50);
        startTimerHz (30);
    }
    void timerCallback() override { meter.db = proc.meterGr.load(); meter.repaint(); }
    void resized() override
    {
        auto r = content();
        meter.setBounds (r.removeFromRight (44).withTrimmedBottom (34));
        r.removeFromRight (10);
        hint.setBounds (r.removeFromTop (40));
        listen.setBounds (r.removeFromBottom (30).removeFromLeft (200));
        knobs.setBounds (r);
    }
    DeEsserProcessor& proc;
    ParamKnobPanel knobs;
    ReductionMeter meter;
    juce::Label hint;
    juce::ToggleButton listen { "Listen to the S" };
    std::unique_ptr<juce::ButtonParameterAttachment> listenAttach;
};

juce::AudioProcessorEditor* DeEsserProcessor::createEditor()  { return new DeEsserEditor (*this); }
std::unique_ptr<juce::AudioPluginInstance> createDeEsserProcessor (const MotionPluginInfo& i)  { return std::make_unique<DeEsserProcessor> (i); }

//==============================================================================
// Motion Sidechain Ducker
//==============================================================================
class DuckerProcessor : public MotionProcessorBase
{
public:
    DuckerProcessor (const MotionPluginInfo& i) : MotionProcessorBase (i)
    {
        trigger = addChoice ("trigger", "Trigger", { "Sidechain track", "Every beat", "Every half beat" }, 0);
        depth = addFloat ("depth", "Duck by", 0.0f, 40.0f, 10.0f, "dB");
        threshold = addFloat ("threshold", "Threshold", -60.0f, 0.0f, -30.0f, "dB");
        attack = addFloat ("attack", "Attack", 0.1f, 80.0f, 4.0f, "ms", true);
        release = addFloat ("release", "Release", 20.0f, 1500.0f, 180.0f, "ms", true);
        mixP = addFloat ("mix", "Mix", 0.0f, 100.0f, 100.0f, "%");
    }

    void prepareToPlay (double sr, int) override { sampleRate = sr; env = 0; gr = 0; }

    void processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) override
    {
        juce::ScopedNoDenormals nd;
        int n = buffer.getNumSamples();
        // channels 1-2 are this track, 3-4 the sidechain (however the host has laid the buses out)
        int mainCh = juce::jmin (2, buffer.getNumChannels());
        int scFirst = juce::jmin (2, getMainBusNumInputChannels()), scCount = juce::jmax (0, juce::jmin (buffer.getNumChannels(), getTotalNumInputChannels()) - scFirst);
        auto& main = buffer;
        auto a = (float) std::exp (-1.0 / (sampleRate * attack->get() / 1000.0));
        auto r = (float) std::exp (-1.0 / (sampleRate * release->get() / 1000.0));
        auto envA = (float) std::exp (-1.0 / (sampleRate * 0.0005)), envR = (float) std::exp (-1.0 / (sampleRate * 0.03));
        auto thr = threshold->get(), maxDuck = depth->get(), mx = mixP->get() / 100.0f;
        int mode = trigger->getIndex();

        // beat mode: where are we in the beat?
        double ppq = 0, bpm = 120;
        bool playing = false;
        if (mode > 0)
            if (auto* ph = getPlayHead())
                if (auto pos = ph->getPosition())
                {
                    ppq = pos->getPpqPosition().orFallback (0.0);
                    bpm = pos->getBpm().orFallback (120.0);
                    playing = pos->getIsPlaying();
                }
        auto beatsPerSample = bpm / 60.0 / sampleRate;
        auto division = mode == 2 ? 0.5 : 1.0;

        float peakGr = 0;
        for (int i = 0; i < n; ++i)
        {
            float target = 0;
            if (mode == 0)
            {
                float x = 0;
                for (int c = 0; c < scCount; ++c) x = juce::jmax (x, std::abs (buffer.getSample (scFirst + c, i)));
                env = x > env ? envA * env + (1 - envA) * x : envR * env + (1 - envR) * x;
                auto over = gainToDb (env) - thr;
                // soft knee 6 dB, then all the way down to the depth
                if (over > -3.0f) target = juce::jmin (maxDuck, over < 3.0f ? (over + 3.0f) * (over + 3.0f) / 12.0f * 2.0f : over * 2.0f);
            }
            else if (playing)
            {
                auto phase = std::fmod ((ppq + i * beatsPerSample) / division, 1.0);
                if (phase < 0) phase += 1.0;
                // fully down on the beat, back up along the release
                auto relBeats = (release->get() / 1000.0) * bpm / 60.0 / division;
                target = phase < 0.02 ? maxDuck : (float) (maxDuck * std::exp (-phase / juce::jmax (0.02, relBeats * 0.35)));
            }
            gr = target > gr ? a * gr + (1 - a) * target : r * gr + (1 - r) * target;
            if (mode > 0) gr = target > gr ? target : gr;  // beat mode: the shape is already drawn
            peakGr = juce::jmax (peakGr, gr);
            auto g = juce::Decibels::decibelsToGain (-gr);
            g = 1.0f + (g - 1.0f) * mx;
            for (int c = 0; c < mainCh; ++c) main.setSample (c, i, main.getSample (c, i) * g);
        }
        meterGr = juce::jmax (peakGr, meterGr.load() * 0.85f);
    }

    juce::AudioProcessorEditor* createEditor() override;

    double sampleRate = 48000.0;
    float env = 0, gr = 0;
    std::atomic<float> meterGr { 0.0f };
    juce::AudioParameterChoice* trigger = nullptr;
    juce::AudioParameterFloat *depth = nullptr, *threshold = nullptr, *attack = nullptr, *release = nullptr, *mixP = nullptr;
};

class DuckerEditor : public MotionEditorBase, private juce::Timer
{
public:
    DuckerEditor (DuckerProcessor& p) : MotionEditorBase (p), proc (p), knobs (p)
    {
        subtitle = "Sidechain";
        addAndMakeVisible (knobs);
        meter.maxDb = 30.0f;
        addAndMakeVisible (meter);
        hint.setText ("Pick the track that pushes this one down: right-click this plugin in the Mixer or Devices and choose "
                      "\"Sidechain from\" (the kick, a voice-over...). Or set Trigger to the beat for a pumping pad.", juce::dontSendNotification);
        hint.setFont (Fonts::ui (12.5f));
        hint.setColour (juce::Label::textColourId, Colours::muted);
        hint.setJustificationType (juce::Justification::topLeft);
        addAndMakeVisible (hint);
        setSize (620, 44 + 10 + 46 + knobs.preferredHeight (540) + 20);
        startTimerHz (30);
    }
    void timerCallback() override { meter.db = proc.meterGr.load(); meter.repaint(); }
    void resized() override
    {
        auto r = content();
        meter.setBounds (r.removeFromRight (44));
        r.removeFromRight (10);
        hint.setBounds (r.removeFromTop (46));
        knobs.setBounds (r);
    }
    DuckerProcessor& proc;
    ParamKnobPanel knobs;
    ReductionMeter meter;
    juce::Label hint;
};

juce::AudioProcessorEditor* DuckerProcessor::createEditor()  { return new DuckerEditor (*this); }
std::unique_ptr<juce::AudioPluginInstance> createDuckerProcessor (const MotionPluginInfo& i)  { return std::make_unique<DuckerProcessor> (i); }

} // namespace ms
