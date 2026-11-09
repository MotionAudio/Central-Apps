#include "MotionProcessors.h"
#include "Loudness.h"

/* Motion Master: the last thing on the master - a look-ahead, true-peak brickwall limiter with a loudness meter
 * (LUFS momentary / short-term / integrated, true peak, loudness range). "Match" sets the input gain so the song's
 * integrated loudness lands on the target you pick. */

namespace ms
{

class MasterProcessor : public MotionProcessorBase, public LoudnessSource
{
public:
    static juce::StringArray targetNames()  { return { "-14 LUFS (streaming)", "-12 LUFS (Central Tracks / worship)", "-10 LUFS (loud)", "-16 LUFS (Apple / podcasts)", "-23 LUFS (broadcast)" }; }
    static float targetLufs (int i)          { static const float t[] = { -14.0f, -12.0f, -10.0f, -16.0f, -23.0f }; return t[juce::jlimit (0, 4, i)]; }

    MasterProcessor (const MotionPluginInfo& i) : MotionProcessorBase (i)
    {
        input = addFloat ("input", "Input", -12.0f, 24.0f, 0.0f, "dB");
        ceiling = addFloat ("ceiling", "Ceiling", -12.0f, 0.0f, -1.0f, "dBTP");
        release = addFloat ("release", "Release", 10.0f, 1000.0f, 150.0f, "ms", true);
        target = addChoice ("target", "Target", targetNames(), 0);
    }

    void prepareToPlay (double sr, int) override
    {
        sampleRate = sr;
        look = juce::jmax (8, (int) std::round (sr * 0.005));
        delayLen = look - 1 + TruePeakDetector::delay;
        for (int c = 0; c < 2; ++c) { delay[c].assign ((size_t) delayLen + 1, 0.0f); tp[c].reset(); }
        boxBuf.assign ((size_t) look, 1.0f);
        boxSum = look;
        boxPos = delayPos = 0;
        minQ.clear();
        sampleIndex = 0;
        env = 1.0f;
        meter.prepare (sr, 2);
        setLatencySamples (delayLen);
    }

    void processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) override
    {
        juce::ScopedNoDenormals nd;
        // a new play starts a new measurement
        bool playing = false;
        if (auto* ph = getPlayHead())
            if (auto pos = ph->getPosition()) playing = pos->getIsPlaying();
        if (playing && ! wasPlaying) meter.reset();
        wasPlaying = playing;

        int chans = juce::jmin (2, buffer.getNumChannels()), n = buffer.getNumSamples();
        auto gIn = juce::Decibels::decibelsToGain (input->get());
        auto ceil = juce::Decibels::decibelsToGain (ceiling->get());
        auto rc = (float) (1.0 - std::exp (-1.0 / (sampleRate * release->get() / 1000.0)));
        float maxGr = 0;
        for (int i = 0; i < n; ++i)
        {
            float peak = 0;
            float x[2] = { 0, 0 };
            for (int c = 0; c < chans; ++c)
            {
                x[c] = buffer.getSample (c, i) * gIn;
                peak = juce::jmax (peak, tp[c].process (x[c]));
            }
            if (chans == 1) x[1] = x[0];
            auto need = peak > ceil ? ceil / peak : 1.0f;
            // the smallest gain needed over the look-ahead window
            while (! minQ.empty() && minQ.back().first >= need) minQ.pop_back();
            minQ.emplace_back (need, sampleIndex);
            while (minQ.front().second <= sampleIndex - look) minQ.pop_front();
            auto s = minQ.front().first;
            env = juce::jmin (s, env + (1.0f - env) * rc);
            // smoothed over the window, so the gain is already down when the peak arrives
            boxSum += env - boxBuf[(size_t) boxPos];
            boxBuf[(size_t) boxPos] = env;
            boxPos = (boxPos + 1) % look;
            auto g = (float) (boxSum / look);
            ++sampleIndex;
            for (int c = 0; c < chans; ++c)
            {
                auto& d = delay[c];
                auto out = d[(size_t) delayPos];
                d[(size_t) delayPos] = x[c];
                // never above the ceiling, even with rounding
                buffer.setSample (c, i, juce::jlimit (-ceil, ceil, out * g));
            }
            delayPos = (delayPos + 1) % (delayLen + 1);
            maxGr = juce::jmax (maxGr, -gainToDb (juce::jmax (1e-6f, g)));
        }
        meter.process (buffer.getArrayOfReadPointers(), chans, n);
        gr = juce::jmax (maxGr, gr.load() * 0.9f);
        if (buffer.getNumChannels() > chans)
            for (int c = chans; c < buffer.getNumChannels(); ++c) buffer.copyFrom (c, 0, buffer, 0, 0, n);
    }

    // LoudnessSource
    const LoudnessMeter& loudness() const override  { return meter; }
    float gainReductionDb() const override           { return gr.load(); }
    void resetLoudness() override                    { meter.reset(); }

    /** Sets the input gain so the integrated loudness hits the target (after a play of the song). */
    bool matchTarget()
    {
        auto now = meter.integrated();
        if (now <= LoudnessMeter::silence + 1.0f) return false;
        auto newGain = juce::jlimit (-12.0f, 24.0f, input->get() + (targetLufs (target->getIndex()) - now));
        input->setValueNotifyingHost (input->convertTo0to1 (newGain));
        meter.reset();
        return true;
    }

    juce::AudioProcessorEditor* createEditor() override;

    juce::AudioParameterFloat *input = nullptr, *ceiling = nullptr, *release = nullptr;
    juce::AudioParameterChoice* target = nullptr;
    LoudnessMeter meter;
    std::atomic<float> gr { 0.0f };

private:
    double sampleRate = 48000.0;
    int look = 240, delayLen = 245, boxPos = 0, delayPos = 0;
    std::vector<float> delay[2], boxBuf;
    double boxSum = 0;
    std::deque<std::pair<float, juce::int64>> minQ;
    juce::int64 sampleIndex = 0;
    float env = 1.0f;
    TruePeakDetector tp[2];
    bool wasPlaying = false;
};

//==============================================================================
class MasterEditor : public MotionEditorBase, private juce::Timer
{
public:
    MasterEditor (MasterProcessor& p) : MotionEditorBase (p), proc (p), knobs (p)
    {
        subtitle = "Limiter and loudness";
        addAndMakeVisible (knobs);
        match.setColour (juce::TextButton::buttonColourId, Colours::gold);
        match.setColour (juce::TextButton::textColourOffId, Colours::goldText);
        match.setTooltip ("Play the song through, then press Match: the input gain is set so the song lands on the target");
        match.onClick = [this]
        {
            status = proc.matchTarget() ? "Input set for " + MasterProcessor::targetNames()[proc.target->getIndex()].upToFirstOccurrenceOf (" (", false, false)
                                                + ". Play it again to check."
                                        : juce::String ("Play the song first, then press Match.");
            history.clear();
            repaint();
        };
        reset.onClick = [this] { proc.resetLoudness(); history.clear(); status = {}; repaint(); };
        addAndMakeVisible (match);
        addAndMakeVisible (reset);
        setSize (640, 44 + 10 + 190 + knobs.preferredHeight (616) + 50);
        startTimerHz (10);
    }

    void timerCallback() override
    {
        auto& m = proc.loudness();
        if (m.seconds() > 0.3f) history.push_back (m.shortTerm());
        if (history.size() > 600) history.erase (history.begin(), history.begin() + (long) (history.size() - 600));
        repaint();
    }

    void paint (juce::Graphics& g) override
    {
        MotionEditorBase::paint (g);
        auto& m = proc.loudness();
        auto r = readouts.toFloat();
        g.setColour (Colours::bg2);
        g.fillRoundedRectangle (r, 6.0f);
        auto fmt = [] (float v) { return v <= LoudnessMeter::silence + 0.05f ? juce::String ("--") : juce::String (v, 1); };
        struct Item { const char* label; juce::String value; const char* unit; };
        Item items[] = { { "INTEGRATED", fmt (m.integrated()), "LUFS" }, { "SHORT-TERM", fmt (m.shortTerm()), "LUFS" },
                         { "MOMENTARY", fmt (m.momentary()), "LUFS" }, { "TRUE PEAK", m.truePeak() < -100 ? juce::String ("--") : juce::String (m.truePeak(), 1), "dBTP" },
                         { "RANGE", juce::String (m.loudnessRange(), 1), "LU" } };
        auto cellW = r.getWidth() / 5.0f;
        for (int i = 0; i < 5; ++i)
        {
            auto c = juce::Rectangle<float> (r.getX() + i * cellW, r.getY(), cellW, 74.0f).reduced (8, 8);
            g.setColour (Colours::muted);
            g.setFont (Fonts::narrow (11.0f));
            g.drawText (items[i].label, c.removeFromTop (14), juce::Justification::centredLeft);
            g.setColour (i == 0 ? Colours::gold : Colours::text);
            g.setFont (Fonts::heavy (i == 0 ? 28.0f : 22.0f));
            g.drawText (items[i].value, c.removeFromTop (32), juce::Justification::centredLeft);
            g.setColour (Colours::dim);
            g.setFont (Fonts::narrow (11.0f));
            g.drawText (items[i].unit, c, juce::Justification::centredLeft);
        }
        // the short-term history against the target
        auto graph = r.withTrimmedTop (78).reduced (8, 6);
        auto t = MasterProcessor::targetLufs (proc.target->getIndex());
        auto toY = [&] (float l) { return juce::jmap (juce::jlimit (-36.0f, 0.0f, l), -36.0f, 0.0f, graph.getBottom(), graph.getY()); };
        g.setColour (Colours::line);
        for (float l = -30; l < 0; l += 6) g.fillRect (graph.getX(), toY (l), graph.getWidth(), 1.0f);
        g.setColour (Colours::gold.withAlpha (0.5f));
        float dashes[] = { 5.0f, 4.0f };
        g.drawDashedLine ({ graph.getX(), toY (t), graph.getRight(), toY (t) }, dashes, 2, 1.2f);
        g.setFont (Fonts::narrow (10.5f));
        g.drawText ("target " + juce::String ((int) t), juce::Rectangle<float> (graph.getRight() - 80, toY (t) - 14, 78, 12), juce::Justification::centredRight);
        if (history.size() > 1)
        {
            juce::Path p;
            auto n = (int) history.size();
            for (int i = 0; i < n; ++i)
            {
                auto x = graph.getRight() - (float) (n - 1 - i) * graph.getWidth() / 600.0f;
                if (i == 0) p.startNewSubPath (x, toY (history[(size_t) i])); else p.lineTo (x, toY (history[(size_t) i]));
            }
            g.setColour (Colours::goldHi);
            g.strokePath (p, juce::PathStrokeType (1.5f));
        }
        // gain reduction
        auto grBox = grArea.toFloat();
        g.setColour (Colours::bg2);
        g.fillRoundedRectangle (grBox, 4.0f);
        auto grv = juce::jlimit (0.0f, 12.0f, proc.gainReductionDb());
        g.setColour (Colours::gold);
        g.fillRoundedRectangle (grBox.withHeight (grBox.getHeight() * grv / 12.0f).reduced (2, 1), 3.0f);
        g.setColour (Colours::muted);
        g.setFont (Fonts::narrow (10.5f));
        g.drawText ("GR " + juce::String (grv, 1), grArea.withY (grArea.getBottom() + 2).withHeight (14), juce::Justification::centred);
        if (status.isNotEmpty())
        {
            g.setColour (Colours::muted);
            g.setFont (Fonts::ui (12.5f));
            g.drawText (status, statusArea, juce::Justification::centredLeft);
        }
    }

    void resized() override
    {
        auto r = content();
        auto top = r.removeFromTop (180);
        grArea = top.removeFromRight (40).withTrimmedBottom (16);
        top.removeFromRight (10);
        readouts = top;
        r.removeFromTop (10);
        auto bottom = r.removeFromBottom (32);
        match.setBounds (bottom.removeFromLeft (110));
        bottom.removeFromLeft (8);
        reset.setBounds (bottom.removeFromLeft (80));
        bottom.removeFromLeft (12);
        statusArea = bottom;
        knobs.setBounds (r);
    }

    MasterProcessor& proc;
    ParamKnobPanel knobs;
    juce::TextButton match { "Match target" }, reset { "Reset" };
    juce::Rectangle<int> readouts, grArea, statusArea;
    std::vector<float> history;
    juce::String status;
};

juce::AudioProcessorEditor* MasterProcessor::createEditor()  { return new MasterEditor (*this); }
std::unique_ptr<juce::AudioPluginInstance> createMasterProcessor (const MotionPluginInfo& i)  { return std::make_unique<MasterProcessor> (i); }

} // namespace ms
