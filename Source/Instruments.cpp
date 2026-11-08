#include "Instruments.h"
#include "Theme.h"

#define TSF_IMPLEMENTATION
#include "tsf.h"

namespace ms
{

//==============================================================================
// Small DSP helpers
namespace dsp
{
    inline float polyBlep (float t, float dt)
    {
        if (t < dt) { t /= dt; return t + t - t * t - 1.0f; }
        if (t > 1.0f - dt) { t = (t - 1.0f) / dt; return t * t + t + t + 1.0f; }
        return 0.0f;
    }

    struct Svf   // Simper's state variable filter
    {
        float ic1 = 0, ic2 = 0, g = 0, k = 1, a1 = 0, a2 = 0, a3 = 0;
        void set (float cutoff, float q, float sr)
        {
            cutoff = juce::jlimit (20.0f, sr * 0.45f, cutoff);
            g = std::tan (juce::MathConstants<float>::pi * cutoff / sr);
            k = 1.0f / juce::jmax (0.3f, q);
            a1 = 1.0f / (1.0f + g * (g + k)); a2 = g * a1; a3 = g * a2;
        }
        inline void tick (float v0, float& lp, float& bp, float& hp)
        {
            float v3 = v0 - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
            ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
            lp = v2; bp = v1; hp = v0 - k * v1 - v2;
        }
        inline float lp (float x) { float l, b, h; tick (x, l, b, h); return l; }
        inline float bp (float x) { float l, b, h; tick (x, l, b, h); return b; }
        inline float hp (float x) { float l, b, h; tick (x, l, b, h); return h; }
        void reset() { ic1 = ic2 = 0; }
    };

    struct Noise
    {
        juce::uint32 s = 0x12345678;
        inline float next() { s = s * 1664525u + 1013904223u; return (float) (s >> 9) * (1.0f / 4194304.0f) - 1.0f; }
    };
}

//==============================================================================
// Motion EP: a two-operator FM electric piano (what Motion Keys plays when no bank is loaded)
struct EPSound : public juce::SynthesiserSound
{
    bool appliesToNote (int) override    { return true; }
    bool appliesToChannel (int) override { return true; }
};

struct EPVoice : public juce::SynthesiserVoice
{
    bool canPlaySound (juce::SynthesiserSound* s) override { return dynamic_cast<EPSound*> (s) != nullptr; }

    void startNote (int note, float vel, juce::SynthesiserSound*, int) override
    {
        freq = (float) juce::MidiMessage::getMidiNoteInHertz (note);
        auto sr = (float) getSampleRate();
        velocity = vel;
        pc = pm = pt = 0;
        env = 0; idx = 1.0f;
        decay = std::exp (-1.0f / (sr * juce::jmap ((float) note, 30.0f, 100.0f, 4.0f, 0.9f)));
        idxDecay = std::exp (-1.0f / (sr * 0.35f));
        tineDecay = std::exp (-1.0f / (sr * 0.05f));
        release = 0; releasing = false; tine = 1.0f;
        attack = 1.0f / (sr * 0.002f);
        pan = juce::jmap ((float) note, 30.0f, 100.0f, -0.35f, 0.35f);
    }

    void stopNote (float, bool allowTailOff) override
    {
        if (allowTailOff) { releasing = true; release = std::exp (-1.0f / ((float) getSampleRate() * 0.18f)); }
        else { clearCurrentNote(); env = 0; }
    }

    void pitchWheelMoved (int) override {}
    void controllerMoved (int, int) override {}

    void renderNextBlock (juce::AudioBuffer<float>& out, int start, int num) override
    {
        if (! isVoiceActive()) return;
        auto sr = (float) getSampleRate();
        const float twoPi = juce::MathConstants<float>::twoPi;
        float dc = freq / sr, dm = freq / sr, dt = freq * 14.0f / sr;
        float gL = 0.5f * (1.0f - pan), gR = 0.5f * (1.0f + pan);
        for (int i = 0; i < num; ++i)
        {
            if (attackPhase < 1.0f) { attackPhase += attack; env = juce::jmin (1.0f, attackPhase); }
            else env *= decay;
            if (releasing) env *= release;
            idx *= idxDecay; tine *= tineDecay;
            float mod = std::sin (pm * twoPi) * (0.6f + 2.6f * velocity * idx);
            float tn = std::sin (pt * twoPi) * tine * 0.25f * velocity;
            float s = (std::sin (pc * twoPi + mod) + tn) * env * (0.25f + 0.55f * velocity) * 0.32f;
            out.addSample (0, start + i, s * gL);
            if (out.getNumChannels() > 1) out.addSample (1, start + i, s * gR);
            pc += dc; pm += dm; pt += dt;
            pc -= std::floor (pc); pm -= std::floor (pm); pt -= std::floor (pt);
            if (env < 0.0001f && (releasing || attackPhase >= 1.0f)) { clearCurrentNote(); attackPhase = 0; break; }
        }
    }

    float freq = 440, velocity = 1, pc = 0, pm = 0, pt = 0, env = 0, idx = 1, decay = 0.9999f, idxDecay = 0.999f, tine = 1, tineDecay = 0.99f;
    float release = 0, attack = 0.01f, attackPhase = 0, pan = 0;
    bool releasing = false;
};

//==============================================================================
// Motion Keys: SoundFont player
class KeysProcessor : public MotionProcessorBase, public juce::ChangeBroadcaster
{
public:
    KeysProcessor (const MotionPluginInfo& i) : MotionProcessorBase (i)
    {
        volume = addFloat ("volume", "Volume", -30.0f, 12.0f, 0.0f, "dB");
        transpose = addFloat ("transpose", "Transpose", -24.0f, 24.0f, 0.0f, "st", false, 1.0f);
        brightness = addFloat ("brightness", "Brightness", 600.0f, 20000.0f, 20000.0f, "Hz", true);
        velocityAmt = addFloat ("velocity", "Velocity", 0.0f, 1.0f, 1.0f);
        for (int v = 0; v < 16; ++v) ep.addVoice (new EPVoice());
        ep.addSound (new EPSound());
        tailSeconds = 2.0;
        std::fill (std::begin (held), std::end (held), -1);
        // first run: pick the first piano bank found
        auto banks = findSoundBanks();
        for (auto& f : banks)
            if (f.getFileName().containsIgnoreCase ("piano")) { loadBank (f, 0); break; }
        if (sf == nullptr && ! banks.isEmpty()) loadBank (banks.getFirst(), 0);
    }

    ~KeysProcessor() override { if (sf) tsf_close (sf); }

    bool loadBank (const juce::File& f, int presetIndex)
    {
        auto* n = tsf_load_filename (f.getFullPathName().toRawUTF8());
        if (n == nullptr) return false;
        tsf_set_output (n, TSF_STEREO_INTERLEAVED, (int) (rate > 0 ? rate : 48000.0), -10.0f);
        tsf_set_max_voices (n, 96);
        presetIndex = juce::jlimit (0, juce::jmax (0, tsf_get_presetcount (n) - 1), presetIndex);
        tsf_channel_set_presetindex (n, 0, presetIndex);
        tsf_channel_set_pitchrange (n, 0, 2.0f);
        tsf* old = nullptr;
        {
            juce::SpinLock::ScopedLockType sl (lock);
            old = sf; sf = n;
            bankFile = f; preset = presetIndex;
        }
        if (old) tsf_close (old);
        sendChangeMessage();
        return true;
    }

    void setPreset (int idx)
    {
        juce::SpinLock::ScopedLockType sl (lock);
        if (sf == nullptr) return;
        preset = juce::jlimit (0, tsf_get_presetcount (sf) - 1, idx);
        tsf_channel_sounds_off_all (sf, 0);
        tsf_channel_set_presetindex (sf, 0, preset);
    }

    void unloadBank()
    {
        tsf* old;
        { juce::SpinLock::ScopedLockType sl (lock); old = sf; sf = nullptr; bankFile = juce::File(); }
        if (old) tsf_close (old);
        sendChangeMessage();
    }

    juce::StringArray presetNames()
    {
        juce::StringArray s;
        juce::SpinLock::ScopedLockType sl (lock);
        if (sf) for (int i = 0; i < tsf_get_presetcount (sf); ++i) s.add (tsf_get_presetname (sf, i));
        return s;
    }

    void prepareToPlay (double sr, int bs) override
    {
        rate = sr;
        interleaved.assign ((size_t) juce::jmax (bs, 1024) * 2, 0.0f);
        ep.setCurrentPlaybackSampleRate (sr);
        juce::SpinLock::ScopedLockType sl (lock);
        if (sf) tsf_set_output (sf, TSF_STEREO_INTERLEAVED, (int) sr, -10.0f);
        lpL.reset(); lpR.reset();
    }

    void renderTsf (juce::AudioBuffer<float>& b, int start, int num)
    {
        while (num > 0)
        {
            int m = juce::jmin (num, (int) interleaved.size() / 2);
            tsf_render_float (sf, interleaved.data(), m, 0);
            auto* L = b.getWritePointer (0, start);
            auto* R = b.getNumChannels() > 1 ? b.getWritePointer (1, start) : nullptr;
            for (int i = 0; i < m; ++i)
            {
                L[i] += interleaved[(size_t) i * 2];
                if (R) R[i] += interleaved[(size_t) i * 2 + 1];
            }
            start += m; num -= m;
        }
    }

    void processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi) override
    {
        buffer.clear();
        int tr = (int) transpose->get();
        float velAmt = velocityAmt->get();
        juce::SpinLock::ScopedTryLockType sl (lock);
        bool useSf = sl.isLocked() && sf != nullptr;

        if (useSf)
        {
            int pos = 0;
            for (auto m : midi)
            {
                auto msg = m.getMessage();
                int t = juce::jlimit (0, buffer.getNumSamples(), m.samplePosition);
                if (t > pos) { renderTsf (buffer, pos, t - pos); pos = t; }
                if (msg.isNoteOn())
                {
                    int key = juce::jlimit (0, 127, msg.getNoteNumber() + tr);
                    held[msg.getNoteNumber()] = key;
                    float v = msg.getFloatVelocity();
                    v = 1.0f - velAmt + velAmt * v;
                    tsf_channel_note_on (sf, 0, key, v);
                }
                else if (msg.isNoteOff())
                {
                    int key = held[msg.getNoteNumber()] >= 0 ? held[msg.getNoteNumber()] : msg.getNoteNumber() + tr;
                    held[msg.getNoteNumber()] = -1;
                    tsf_channel_note_off (sf, 0, juce::jlimit (0, 127, key));
                }
                else if (msg.isController())
                    tsf_channel_midi_control (sf, 0, msg.getControllerNumber(), msg.getControllerValue());
                else if (msg.isPitchWheel())
                    tsf_channel_set_pitchwheel (sf, 0, msg.getPitchWheelValue());
                else if (msg.isAllNotesOff() || msg.isAllSoundOff())
                    tsf_channel_note_off_all (sf, 0);
            }
            if (pos < buffer.getNumSamples()) renderTsf (buffer, pos, buffer.getNumSamples() - pos);
        }
        else
        {
            juce::MidiBuffer shifted;
            for (auto m : midi)
            {
                auto msg = m.getMessage();
                if (msg.isNoteOnOrOff())
                {
                    float v = msg.getFloatVelocity();
                    v = 1.0f - velAmt + velAmt * v;
                    msg = msg.isNoteOn() ? juce::MidiMessage::noteOn (msg.getChannel(), juce::jlimit (0, 127, msg.getNoteNumber() + tr), v)
                                         : juce::MidiMessage::noteOff (msg.getChannel(), juce::jlimit (0, 127, msg.getNoteNumber() + tr));
                }
                shifted.addEvent (msg, m.samplePosition);
            }
            ep.renderNextBlock (buffer, shifted, 0, buffer.getNumSamples());
        }

        float cut = brightness->get();
        if (cut < 19500.0f)
        {
            lpL.set (cut, 0.6f, (float) rate); lpR.set (cut, 0.6f, (float) rate);
            auto* L = buffer.getWritePointer (0);
            auto* R = buffer.getNumChannels() > 1 ? buffer.getWritePointer (1) : nullptr;
            for (int i = 0; i < buffer.getNumSamples(); ++i) { L[i] = lpL.lp (L[i]); if (R) R[i] = lpR.lp (R[i]); }
        }
        buffer.applyGain (juce::Decibels::decibelsToGain (volume->get()));
    }

    void saveExtra (juce::ValueTree& v) override
    {
        v.setProperty ("bank", bankFile.getFullPathName(), nullptr);
        v.setProperty ("preset", preset, nullptr);
    }

    void loadExtra (const juce::ValueTree& v) override
    {
        juce::File f (v["bank"].toString());
        if (! f.existsAsFile() && v["bank"].toString().isNotEmpty())
            f = soundsFolder().getChildFile (juce::File (v["bank"].toString()).getFileName());   // moved computers
        if (f.existsAsFile()) loadBank (f, (int) v.getProperty ("preset", 0));
        else if (v.hasProperty ("bank") && v["bank"].toString().isEmpty()) unloadBank();
    }

    juce::AudioProcessorEditor* createEditor() override;

    juce::AudioParameterFloat *volume = nullptr, *transpose = nullptr, *brightness = nullptr, *velocityAmt = nullptr;
    tsf* sf = nullptr;
    juce::File bankFile;
    int preset = 0;
    double rate = 48000;
    std::vector<float> interleaved;
    juce::SpinLock lock;
    juce::Synthesiser ep;
    dsp::Svf lpL, lpR;
    int held[128];
};

class KeysEditor : public MotionEditorBase, private juce::ChangeListener, private juce::Timer
{
public:
    KeysEditor (KeysProcessor& p) : MotionEditorBase (p), proc (p), knobs (p)
    {
        subtitle = "SoundFont keys and instruments";
        addAndMakeVisible (bank);
        addAndMakeVisible (presets);
        bank.onChange = [this]
        {
            auto i = bank.getSelectedId() - 2;
            if (bank.getSelectedId() == 1) proc.unloadBank();
            else if (juce::isPositiveAndBelow (i, banks.size())) proc.loadBank (banks[i], 0);
        };
        presets.onChange = [this] { proc.setPreset (presets.getSelectedId() - 1); };
        loadButton.setButtonText ("Load .sf2...");
        loadButton.onClick = [this]
        {
            chooser = std::make_unique<juce::FileChooser> ("Choose a SoundFont", soundsFolder(), "*.sf2");
            chooser->launchAsync (juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles, [this] (const juce::FileChooser& fc)
            {
                auto f = fc.getResult();
                if (! f.existsAsFile()) return;
                auto dest = soundsFolder().getChildFile (f.getFileName());
                if (f != dest) f.copyFileTo (dest);
                proc.loadBank (dest.existsAsFile() ? dest : f, 0);
            });
        };
        addAndMakeVisible (loadButton);
        getButton.setButtonText ("Get Motion Audio sounds");
        getButton.setTooltip ("Downloads the free FreePats banks the Central apps use (pianos, organs, pads, strings, basses, guitars)");
        getButton.onClick = [this] { startDownload(); };
        addAndMakeVisible (getButton);
        addAndMakeVisible (knobs);
        status.setFont (Fonts::ui (13.0f));
        status.setColour (juce::Label::textColourId, Colours::muted);
        addAndMakeVisible (status);
        addChildComponent (progressBar);
        proc.addChangeListener (this);
        refreshBanks();
        setSize (620, 330);
    }

    ~KeysEditor() override
    {
        proc.removeChangeListener (this);
        if (downloader) downloader->stopThread (4000);
    }

    void startDownload()
    {
        if (downloader && downloader->isThreadRunning()) return;
        downloader = std::make_unique<SoundBankDownloader>();
        downloader->onFinished = [sp = juce::Component::SafePointer<KeysEditor> (this)]
        {
            juce::MessageManager::callAsync ([sp] { if (sp) { sp->refreshBanks(); sp->progressBar.setVisible (false); sp->getButton.setEnabled (true); } });
        };
        progressBar.setVisible (true);
        getButton.setEnabled (false);
        downloader->startThread();
        startTimerHz (8);
    }

    void timerCallback() override
    {
        if (downloader)
        {
            progressValue = downloader->progress.load();
            status.setText (downloader->getStatus(), juce::dontSendNotification);
            if (! downloader->isThreadRunning()) stopTimer();
        }
    }

    void refreshBanks()
    {
        banks = findSoundBanks();
        bank.clear (juce::dontSendNotification);
        bank.addItem ("Motion EP (built in)", 1);
        for (int i = 0; i < banks.size(); ++i) bank.addItem (banks[i].getFileNameWithoutExtension(), i + 2);
        changeListenerCallback (nullptr);
        if (! downloader || ! downloader->isThreadRunning())
            status.setText (banks.isEmpty() ? "No banks yet: press \"Get Motion Audio sounds\" or load your own .sf2."
                                            : juce::String (banks.size()) + " banks in " + soundsFolder().getFullPathName(), juce::dontSendNotification);
    }

    void changeListenerCallback (juce::ChangeBroadcaster*) override
    {
        int sel = 1;
        for (int i = 0; i < banks.size(); ++i) if (banks[i] == proc.bankFile) sel = i + 2;
        bank.setSelectedId (sel, juce::dontSendNotification);
        presets.clear (juce::dontSendNotification);
        auto names = proc.presetNames();
        for (int i = 0; i < names.size(); ++i) presets.addItem (names[i].isNotEmpty() ? names[i] : "Preset " + juce::String (i + 1), i + 1);
        presets.setSelectedId (proc.preset + 1, juce::dontSendNotification);
        presets.setEnabled (names.size() > 0);
    }

    void resized() override
    {
        auto r = content();
        auto row = r.removeFromTop (28);
        bank.setBounds (row.removeFromLeft (260)); row.removeFromLeft (8);
        presets.setBounds (row.removeFromLeft (190)); row.removeFromLeft (8);
        loadButton.setBounds (row);
        r.removeFromTop (8);
        auto row2 = r.removeFromTop (28);
        getButton.setBounds (row2.removeFromLeft (220)); row2.removeFromLeft (10);
        progressBar.setBounds (row2.removeFromLeft (180).reduced (0, 4));
        r.removeFromTop (4);
        status.setBounds (r.removeFromTop (22));
        r.removeFromTop (6);
        knobs.setBounds (r.removeFromLeft (4 * 92));
    }

    KeysProcessor& proc;
    ParamKnobPanel knobs;
    juce::ComboBox bank, presets;
    juce::TextButton loadButton, getButton;
    juce::Label status;
    double progressValue = -1.0;
    juce::ProgressBar progressBar { progressValue };
    juce::Array<juce::File> banks;
    std::unique_ptr<juce::FileChooser> chooser;
    std::unique_ptr<SoundBankDownloader> downloader;
};

juce::AudioProcessorEditor* KeysProcessor::createEditor()  { return new KeysEditor (*this); }
std::unique_ptr<juce::AudioPluginInstance> createKeysProcessor (const MotionPluginInfo& i) { return std::make_unique<KeysProcessor> (i); }

//==============================================================================
// Motion Pads: a worship pad synth. Each preset is its own recipe of detuned saws, a sub, breath, formants or FM
// glass, run into Motion Audio's own shimmer reverb (the Central Pedals "Octave Shimmer").
struct PadRecipe
{
    const char* name;
    int saws; float detune; float sub; float air; float formant; float fm; float fmRatio; float cutoff; float reso;
    float swell; float square; float octaveUp;
};

static const PadRecipe padRecipes[] = {
    //  name               saws detune sub   air   formant fm    ratio cutoff reso swell square oct
    { "Warm Pad",            5, 14.0f, 0.35f, 0.05f, 0.0f, 0.0f, 1.0f, 2.4f, 0.7f, 0.0f, 0.0f, 0.0f },
    { "Worship Pad",         7, 22.0f, 0.40f, 0.10f, 0.0f, 0.0f, 1.0f, 3.2f, 0.6f, 0.0f, 0.0f, 0.25f },
    { "Sunday Pad",          6, 16.0f, 0.30f, 0.12f, 0.0f, 0.15f, 2.0f, 2.8f, 0.6f, 0.0f, 0.0f, 0.15f },
    { "Air Pad",             3, 10.0f, 0.15f, 0.55f, 0.0f, 0.0f, 1.0f, 4.5f, 0.8f, 0.0f, 0.0f, 0.3f },
    { "Shimmer Pad",         5, 18.0f, 0.20f, 0.15f, 0.0f, 0.0f, 1.0f, 5.0f, 0.6f, 0.0f, 0.0f, 0.5f },
    { "String Pad",          7, 12.0f, 0.10f, 0.05f, 0.0f, 0.0f, 1.0f, 3.8f, 0.9f, 0.0f, 0.0f, 0.0f },
    { "Choir Aah",           5, 9.0f, 0.10f, 0.15f, 1.0f, 0.0f, 1.0f, 6.0f, 0.7f, 0.0f, 0.0f, 0.0f },
    { "Glass Pad",           2, 6.0f, 0.10f, 0.08f, 0.0f, 0.75f, 3.5f, 6.0f, 0.6f, 0.0f, 0.0f, 0.0f },
    { "Swell Pad",           6, 16.0f, 0.30f, 0.10f, 0.0f, 0.0f, 1.0f, 3.0f, 1.1f, 3.0f, 0.0f, 0.0f },
    { "Analog Sweep Pad",    4, 12.0f, 0.30f, 0.00f, 0.0f, 0.0f, 1.0f, 1.6f, 2.2f, 0.0f, 0.4f, 0.0f },
    { "Dark Pad",            5, 10.0f, 0.60f, 0.05f, 0.0f, 0.0f, 1.0f, 1.2f, 0.6f, 0.0f, 0.0f, 0.0f },
    { "Bell Pad",            1, 3.0f, 0.05f, 0.05f, 0.0f, 1.0f, 2.0f, 8.0f, 0.5f, 0.0f, 0.0f, 0.0f },
};

static juce::StringArray padNames()
{
    juce::StringArray s;
    for (auto& r : padRecipes) s.add (r.name);
    return s;
}

struct PadParams
{
    std::atomic<int> recipe { 0 };
    std::atomic<float> attack { 1.0f }, release { 3.0f }, brightness { 0.5f }, movement { 0.4f }, air { 0.3f }, width { 0.8f };
    std::atomic<bool> fifths { false };
    float lfo = 0;   // shared breathing LFO (audio thread only)
};

struct PadSound : public juce::SynthesiserSound
{
    bool appliesToNote (int) override    { return true; }
    bool appliesToChannel (int) override { return true; }
};

struct PadVoice : public juce::SynthesiserVoice
{
    PadVoice (PadParams& p) : params (p) {}
    bool canPlaySound (juce::SynthesiserSound* s) override { return dynamic_cast<PadSound*> (s) != nullptr; }

    void startNote (int note, float vel, juce::SynthesiserSound*, int) override
    {
        r = padRecipes[(size_t) juce::jlimit (0, (int) std::size (padRecipes) - 1, params.recipe.load())];
        freq = (float) juce::MidiMessage::getMidiNoteInHertz (note);
        velocity = 0.55f + 0.45f * vel;
        for (int i = 0; i < 8; ++i) phase[i] = rng.next() * 0.5f + 0.5f;
        subPhase = fmPhase = fmMod = 0;
        state = Attack; env = juce::jmax (env, 0.0f);
        swellPos = 0;
        f1.reset(); f2.reset(); fa.reset(); fb.reset(); fc.reset(); g1.reset(); g2.reset(); g3.reset(); airF.reset();
    }

    void stopNote (float, bool tail) override
    {
        if (tail) state = Release;
        else { clearCurrentNote(); env = 0; state = Idle; }
    }
    void pitchWheelMoved (int) override {}
    void controllerMoved (int, int) override {}

    void renderNextBlock (juce::AudioBuffer<float>& out, int start, int num) override
    {
        if (! isVoiceActive()) return;
        auto sr = (float) getSampleRate();
        float att = 1.0f / juce::jmax (1.0f, params.attack.load() * sr);
        float rel = std::exp (-4.6f / juce::jmax (1.0f, params.release.load() * sr));
        float bright = params.brightness.load(), move = params.movement.load(), airAmt = params.air.load() + r.air;
        float width = params.width.load();
        int n = juce::jlimit (1, 8, r.saws);
        float det[8], pan[8];
        for (int i = 0; i < n; ++i)
        {
            float t = n == 1 ? 0.0f : (float) i / (float) (n - 1) * 2.0f - 1.0f;
            det[i] = std::pow (2.0f, (t * r.detune) / 1200.0f);
            pan[i] = t * width;
        }
        float norm = 1.0f / std::sqrt ((float) n);
        bool formant = r.formant > 0.5f;
        if (formant) { g1.set (800, 6, sr); g2.set (1150, 7, sr); g3.set (2900, 9, sr); }
        airF.set (juce::jmin (12000.0f, freq * 6.0f), 2.0f, sr);

        for (int i = 0; i < num; ++i)
        {
            // envelope
            if (state == Attack) { env += att; if (env >= 1.0f) { env = 1.0f; state = Sustain; } }
            else if (state == Release) { env *= rel; if (env < 0.0002f) { clearCurrentNote(); state = Idle; env = 0; break; } }

            float L = 0, R = 0;
            if (r.fm < 0.99f)
            {
                for (int k = 0; k < n; ++k)
                {
                    float dt = freq * det[k] / sr;
                    float p = phase[k];
                    float s = 2.0f * p - 1.0f - dsp::polyBlep (p, dt);
                    if (r.square > 0)
                    {
                        float p2 = p + 0.5f; if (p2 >= 1.0f) p2 -= 1.0f;
                        float s2 = 2.0f * p2 - 1.0f - dsp::polyBlep (p2, dt);
                        s = s * (1.0f - r.square) + (s - s2) * 0.5f * r.square;
                    }
                    phase[k] = p + dt; if (phase[k] >= 1.0f) phase[k] -= 1.0f;
                    L += s * (0.5f - 0.5f * pan[k]);
                    R += s * (0.5f + 0.5f * pan[k]);
                }
                L *= norm; R *= norm;
                if (r.octaveUp > 0)
                {
                    float o = std::sin (phase[0] * juce::MathConstants<float>::twoPi * 2.0f) * r.octaveUp * 0.5f;
                    L += o; R += o;
                }
            }
            if (r.fm > 0)
            {
                float mod = std::sin (fmMod * juce::MathConstants<float>::twoPi) * (1.2f + 1.6f * bright);
                float s = std::sin (fmPhase * juce::MathConstants<float>::twoPi + mod) * r.fm * 0.7f;
                fmPhase += freq / sr; fmMod += freq * r.fmRatio / sr;
                fmPhase -= std::floor (fmPhase); fmMod -= std::floor (fmMod);
                L += s; R += s;
            }
            // sub
            float sub = std::sin (subPhase * juce::MathConstants<float>::twoPi) * r.sub;
            subPhase += freq * 0.5f / sr; subPhase -= std::floor (subPhase);
            L += sub; R += sub;

            // filter: brightness x recipe, breathing with the shared LFO, the Swell Pad opening over seconds
            float swell = r.swell > 0 ? juce::jmin (1.0f, swellPos / (r.swell * sr)) : 1.0f;
            swellPos += 1.0f;
            float breathe = 1.0f + move * 0.45f * params.lfo;
            float cutoff = freq * r.cutoff * (0.35f + 2.4f * bright * bright) * breathe * (0.25f + 0.75f * swell) + 120.0f;
            if ((i & 15) == 0) { f1.set (cutoff, r.reso, sr); f2.set (cutoff, r.reso, sr); }

            if (formant)
            {
                float m = (L + R) * 0.5f;
                float v = g1.bp (m) * 1.0f + g2.bp (m) * 0.7f + g3.bp (m) * 0.35f;
                L = v * (1.0f - 0.3f * width) + L * 0.15f;
                R = v * (1.0f + 0.3f * width) * 0.9f + R * 0.15f;
            }
            else { L = f1.lp (L); R = f2.lp (R); }

            // breath / air
            if (airAmt > 0)
            {
                float a = airF.bp (rng.next()) * airAmt * 0.6f;
                L += a; R += a * 0.9f;
            }
            float g = env * velocity * 0.32f;
            out.addSample (0, start + i, L * g);
            if (out.getNumChannels() > 1) out.addSample (1, start + i, R * g);
        }
    }

    enum State { Idle, Attack, Sustain, Release } state = Idle;
    PadParams& params;
    PadRecipe r = padRecipes[0];
    float freq = 220, velocity = 1, env = 0, phase[8] {}, subPhase = 0, fmPhase = 0, fmMod = 0, swellPos = 0;
    dsp::Svf f1, f2, fa, fb, fc, g1, g2, g3, airF;
    dsp::Noise rng;
};

class PadsProcessor : public MotionProcessorBase
{
public:
    PadsProcessor (const MotionPluginInfo& i) : MotionProcessorBase (i)
    {
        sound = addChoice ("sound", "Sound", padNames(), 1);
        attack = addFloat ("attack", "Attack", 0.01f, 8.0f, 1.2f, "s", true);
        release = addFloat ("release", "Release", 0.05f, 12.0f, 3.5f, "s", true);
        brightness = addFloat ("brightness", "Brightness", 0.0f, 1.0f, 0.5f);
        movement = addFloat ("movement", "Movement", 0.0f, 1.0f, 0.4f);
        air = addFloat ("air", "Air", 0.0f, 1.0f, 0.2f);
        shimmer = addFloat ("shimmer", "Shimmer", 0.0f, 1.0f, 0.45f);
        space = addFloat ("space", "Space", 0.0f, 1.0f, 0.45f);
        width = addFloat ("width", "Width", 0.0f, 1.0f, 0.8f);
        fifths = addBool ("fifths", "Add fifth + octave", false);
        volume = addFloat ("volume", "Volume", -30.0f, 6.0f, -6.0f, "dB");
        for (int v = 0; v < 16; ++v) synth.addVoice (new PadVoice (pp));
        synth.addSound (new PadSound());
        tailSeconds = 12.0;
    }
    ~PadsProcessor() override { for (auto* x : verb) mp_free (x); }

    void prepareToPlay (double sr, int bs) override
    {
        synth.setCurrentPlaybackSampleRate (sr);
        if (sr != rate)
        {
            for (auto*& x : verb) { mp_free (x); x = nullptr; }
            auto d = mp_find ("ma_shimmer");
            verb[0] = mp_new_side (d, sr, 0);
            verb[1] = mp_new_side (d, sr, 1);
            rate = sr;
        }
        for (auto* x : verb) mp_reset (x);
        wet.setSize (2, juce::jmax (bs, 2048));
    }

    void processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi) override
    {
        buffer.clear();
        pp.recipe = sound->getIndex();
        pp.attack = attack->get(); pp.release = release->get(); pp.brightness = brightness->get();
        pp.movement = movement->get(); pp.air = air->get(); pp.width = width->get();
        // the breathing LFO (a slow sine, about 0.13 Hz)
        lfoPhase += (float) buffer.getNumSamples() * 0.13f / (float) rate;
        lfoPhase -= std::floor (lfoPhase);
        pp.lfo = std::sin (lfoPhase * juce::MathConstants<float>::twoPi);

        if (fifths->get())
        {
            juce::MidiBuffer more;
            for (auto m : midi)
            {
                auto msg = m.getMessage();
                more.addEvent (msg, m.samplePosition);
                if (msg.isNoteOnOrOff())
                    for (int iv : { 7, 12 })
                    {
                        int nn = msg.getNoteNumber() + iv;
                        if (nn > 127) continue;
                        more.addEvent (msg.isNoteOn() ? juce::MidiMessage::noteOn (msg.getChannel(), nn, msg.getFloatVelocity() * 0.8f)
                                                      : juce::MidiMessage::noteOff (msg.getChannel(), nn), m.samplePosition);
                    }
            }
            synth.renderNextBlock (buffer, more, 0, buffer.getNumSamples());
        }
        else
            synth.renderNextBlock (buffer, midi, 0, buffer.getNumSamples());

        // Motion Audio's Octave Shimmer for the space
        int n = buffer.getNumSamples();
        if (verb[0] && n <= wet.getNumSamples() && buffer.getNumChannels() >= 2)
        {
            float mix = space->get(), sh = shimmer->get();
            if (mix > 0.001f)
            {
                auto d = mp_find ("ma_shimmer");
                int kDecay = mp_ctl_index (d, "decay"), kSh = mp_ctl_index (d, "shimmer"), kMix = mp_ctl_index (d, "mix"), kTone = mp_ctl_index (d, "tone");
                float decay = 4.0f + 10.0f * mix;
                for (auto* x : verb)
                {
                    if (mp_get (x, kDecay) != decay) mp_set (x, kDecay, decay);
                    if (mp_get (x, kSh) != sh) mp_set (x, kSh, sh);
                    if (mp_get (x, kMix) != mix) mp_set (x, kMix, juce::jmin (0.95f, mix));
                    if (mp_get (x, kTone) != 0.55f) mp_set (x, kTone, 0.55f);
                }
                for (int c = 0; c < 2; ++c)
                    mp_run (verb[c], buffer.getWritePointer (c), buffer.getWritePointer (c), n);
            }
        }
        buffer.applyGain (juce::Decibels::decibelsToGain (volume->get()));
    }

    juce::AudioProcessorEditor* createEditor() override;

    juce::AudioParameterChoice* sound = nullptr;
    juce::AudioParameterFloat *attack = nullptr, *release = nullptr, *brightness = nullptr, *movement = nullptr, *air = nullptr,
                              *shimmer = nullptr, *space = nullptr, *width = nullptr, *volume = nullptr;
    juce::AudioParameterBool* fifths = nullptr;
    PadParams pp;
    juce::Synthesiser synth;
    MpFx* verb[2] { nullptr, nullptr };
    juce::AudioBuffer<float> wet;
    double rate = 0;
    float lfoPhase = 0;
};

class PadsEditor : public MotionEditorBase
{
public:
    PadsEditor (PadsProcessor& p) : MotionEditorBase (p), knobs (p)
    {
        subtitle = "Worship pads, with Motion Audio's shimmer";
        addAndMakeVisible (knobs);
        fifthsToggle.setButtonText ("Add fifth + octave (one finger pads)");
        attach = std::make_unique<juce::ButtonParameterAttachment> (*p.fifths, fifthsToggle);
        addAndMakeVisible (fifthsToggle);
        setSize (6 * 92 + 24, 44 + 10 + 2 * 104 + 44);
    }
    void resized() override
    {
        auto r = content();
        fifthsToggle.setBounds (r.removeFromBottom (28));
        knobs.setBounds (r);
    }
    ParamKnobPanel knobs;
    juce::ToggleButton fifthsToggle;
    std::unique_ptr<juce::ButtonParameterAttachment> attach;
};

juce::AudioProcessorEditor* PadsProcessor::createEditor()  { return new PadsEditor (*this); }
std::unique_ptr<juce::AudioPluginInstance> createPadsProcessor (const MotionPluginInfo& i) { return std::make_unique<PadsProcessor> (i); }

//==============================================================================
// Motion Drums: a synthesised General MIDI kit (kick 36, snare 38, hats 42/44/46, toms, cymbals...)
enum class DrumType { Kick, Snare, Rim, Clap, ClosedHat, PedalHat, OpenHat, Tom, Crash, Ride, RideBell, Cowbell, Tambourine, Shaker, None };

static DrumType drumFor (int note, float& pitch)
{
    pitch = 1.0f;
    switch (note)
    {
        case 35: pitch = 0.85f; return DrumType::Kick;
        case 36: return DrumType::Kick;
        case 37: return DrumType::Rim;
        case 38: return DrumType::Snare;
        case 40: pitch = 1.12f; return DrumType::Snare;
        case 39: return DrumType::Clap;
        case 42: return DrumType::ClosedHat;
        case 44: return DrumType::PedalHat;
        case 46: return DrumType::OpenHat;
        case 41: pitch = 0.55f; return DrumType::Tom;
        case 43: pitch = 0.66f; return DrumType::Tom;
        case 45: pitch = 0.78f; return DrumType::Tom;
        case 47: pitch = 0.92f; return DrumType::Tom;
        case 48: pitch = 1.08f; return DrumType::Tom;
        case 50: pitch = 1.25f; return DrumType::Tom;
        case 49: case 57: case 52: case 55: pitch = note == 55 ? 1.3f : note == 57 ? 0.93f : 1.0f; return DrumType::Crash;
        case 51: case 59: return DrumType::Ride;
        case 53: return DrumType::RideBell;
        case 56: return DrumType::Cowbell;
        case 54: return DrumType::Tambourine;
        case 69: case 70: case 82: return DrumType::Shaker;
        default: return DrumType::None;
    }
}

static juce::String drumName (int note)
{
    switch (note)
    {
        case 35: return "Kick 2"; case 36: return "Kick"; case 37: return "Side Stick"; case 38: return "Snare"; case 39: return "Clap";
        case 40: return "Snare 2"; case 41: return "Low Tom 2"; case 42: return "Closed Hat"; case 43: return "Low Tom"; case 44: return "Pedal Hat";
        case 45: return "Mid Tom 2"; case 46: return "Open Hat"; case 47: return "Mid Tom"; case 48: return "High Tom 2"; case 49: return "Crash";
        case 50: return "High Tom"; case 51: return "Ride"; case 52: return "China"; case 53: return "Ride Bell"; case 54: return "Tambourine";
        case 55: return "Splash"; case 56: return "Cowbell"; case 57: return "Crash 2"; case 59: return "Ride 2"; case 70: return "Shaker";
        default: return juce::MidiMessage::getMidiNoteName (note, true, true, 3);
    }
}

struct DrumVoice
{
    DrumType type = DrumType::None;
    int note = -1;
    float vel = 0, t = 0, pitch = 1, env = 0, ph = 0, ph2 = 0, metal[6] {}, pan = 0;
    bool active = false;
    dsp::Svf f1, f2, f3;
    dsp::Noise rng;
};

class DrumsProcessor : public MotionProcessorBase
{
public:
    DrumsProcessor (const MotionPluginInfo& i) : MotionProcessorBase (i)
    {
        kit = addChoice ("kit", "Kit", { "Studio", "808", "Soft / Brushes" }, 0);
        tune = addFloat ("tune", "Tune", -12.0f, 12.0f, 0.0f, "st");
        decay = addFloat ("decay", "Decay", 0.3f, 2.5f, 1.0f, "x");
        tone = addFloat ("tone", "Tone", 0.0f, 1.0f, 0.6f);
        punch = addFloat ("punch", "Punch", 0.0f, 1.0f, 0.5f);
        room = addFloat ("room", "Room", 0.0f, 1.0f, 0.15f);
        volume = addFloat ("volume", "Volume", -30.0f, 6.0f, 0.0f, "dB");
        tailSeconds = 3.0;
    }
    ~DrumsProcessor() override { for (auto* x : verb) mp_free (x); }

    void prepareToPlay (double sr, int) override
    {
        rate = sr;
        for (auto& v : voices) v.active = false;
        if (verb[0] == nullptr || sr != verbRate)
        {
            for (auto*& x : verb) { mp_free (x); x = nullptr; }
            auto d = mp_find ("ma_plate");
            verb[0] = mp_new_side (d, sr, 0); verb[1] = mp_new_side (d, sr, 1);
            verbRate = sr;
        }
        for (auto* x : verb) mp_reset (x);
    }

    void trigger (int note, float vel)
    {
        float p;
        auto type = drumFor (note, p);
        if (type == DrumType::None) return;
        if (type == DrumType::ClosedHat || type == DrumType::PedalHat)   // choke the open hat
            for (auto& v : voices) if (v.active && v.type == DrumType::OpenHat) v.env *= 0.05f;
        DrumVoice* best = &voices[0];
        for (auto& v : voices) { if (! v.active) { best = &v; break; } if (v.t > best->t) best = &v; }
        auto& v = *best;
        v = DrumVoice();
        v.type = type; v.note = note; v.vel = vel; v.pitch = p * std::pow (2.0f, tune->get() / 12.0f);
        v.active = true; v.env = 1.0f;
        v.rng.s = (juce::uint32) (note * 7919 + 17 + juce::Random::getSystemRandom().nextInt (1000));
        v.pan = type == DrumType::Tom ? juce::jmap (p, 0.5f, 1.3f, 0.35f, -0.35f) : type == DrumType::ClosedHat || type == DrumType::OpenHat || type == DrumType::PedalHat ? -0.25f
              : type == DrumType::Ride || type == DrumType::RideBell ? 0.3f : type == DrumType::Crash ? -0.2f : 0.0f;
        static const float metalHz[6] = { 205.3f, 304.4f, 369.6f, 522.7f, 540.0f, 800.0f };
        for (int k = 0; k < 6; ++k) v.metal[k] = v.rng.next() * 0.5f + 0.5f;
        juce::ignoreUnused (metalHz);
    }

    float renderVoice (DrumVoice& v, float sr, float& outR)
    {
        int k = kit->getIndex();
        float dec = decay->get(), tn = tone->get(), pn = punch->get();
        float t = v.t, s = 0;
        auto expd = [&] (float seconds) { return std::exp (-t / juce::jmax (0.001f, seconds * dec)); };
        static const float metalHz[6] = { 205.3f, 304.4f, 369.6f, 522.7f, 540.0f, 800.0f };
        auto metal = [&] (float scale)
        {
            float m = 0;
            for (int i = 0; i < 6; ++i)
            {
                v.metal[i] += metalHz[i] * scale * v.pitch / sr; v.metal[i] -= std::floor (v.metal[i]);
                m += v.metal[i] < 0.5f ? 1.0f : -1.0f;
            }
            return m / 6.0f;
        };
        switch (v.type)
        {
            case DrumType::Kick:
            {
                float f0 = k == 1 ? 110.0f : 150.0f, f1 = k == 1 ? 46.0f : 52.0f;
                float f = (f1 + (f0 - f1) * std::exp (-t / (k == 1 ? 0.06f : 0.035f))) * v.pitch;
                v.ph += f / sr; v.ph -= std::floor (v.ph);
                float body = std::sin (v.ph * juce::MathConstants<float>::twoPi) * expd (k == 1 ? 0.9f : k == 2 ? 0.28f : 0.38f);
                float click = v.f1.hp (v.rng.next()) * std::exp (-t / 0.0025f) * (0.25f + 0.6f * pn);
                if (t == 0) v.f1.set (3000, 0.7f, sr);
                s = std::tanh (body * (1.2f + 1.4f * pn)) + click;
                break;
            }
            case DrumType::Snare:
            {
                if (t == 0) { v.f1.set (k == 2 ? 3500.0f : 5000.0f * (0.6f + tn), 0.8f, sr); v.f2.set (k == 1 ? 6500.0f : 1800.0f, 0.7f, sr); }
                float f = 185.0f * v.pitch;
                v.ph += f / sr; v.ph2 += f * 1.78f / sr; v.ph -= std::floor (v.ph); v.ph2 -= std::floor (v.ph2);
                float tonePart = (std::sin (v.ph * juce::MathConstants<float>::twoPi) + 0.5f * std::sin (v.ph2 * juce::MathConstants<float>::twoPi)) * expd (0.07f) * (k == 2 ? 0.2f : 0.6f);
                float noise = v.f2.hp (v.f1.lp (v.rng.next())) * expd (k == 2 ? 0.32f : k == 1 ? 0.12f : 0.19f) * (k == 2 ? 0.7f : 1.0f);
                s = tonePart + noise * 1.2f;
                break;
            }
            case DrumType::Rim:
            {
                if (t == 0) v.f1.set (1700.0f * v.pitch, 4.0f, sr);
                s = v.f1.bp (v.rng.next() * std::exp (-t / 0.004f)) * 1.6f + std::sin (t * 2.0f * juce::MathConstants<float>::pi * 520.0f * v.pitch) * std::exp (-t / 0.02f) * 0.4f;
                break;
            }
            case DrumType::Clap:
            {
                if (t == 0) v.f1.set (1200.0f, 1.8f, sr);
                float bursts = 0;
                for (float off : { 0.0f, 0.011f, 0.022f }) if (t >= off) bursts += std::exp (-(t - off) / 0.006f);
                float tail = t > 0.03f ? std::exp (-(t - 0.03f) / (0.15f * dec)) * 0.6f : 0.0f;
                s = v.f1.bp (v.rng.next()) * (bursts + tail) * 2.2f;
                break;
            }
            case DrumType::ClosedHat: case DrumType::PedalHat: case DrumType::OpenHat:
            {
                if (t == 0) { v.f1.set (7000.0f + 3000.0f * tn, 0.7f, sr); v.f2.set (10000.0f, 0.5f, sr); }
                float len = v.type == DrumType::OpenHat ? 0.45f : v.type == DrumType::PedalHat ? 0.08f : (k == 1 ? 0.06f : 0.045f);
                float m = metal (k == 1 ? 1.0f : 1.6f) * 0.7f + v.rng.next() * (k == 2 ? 0.8f : 0.45f);
                s = v.f1.hp (m) * expd (len) * v.env * 0.9f;
                break;
            }
            case DrumType::Tom:
            {
                float base = (k == 1 ? 140.0f : 160.0f) * v.pitch;
                float f = base * (1.0f + 0.5f * std::exp (-t / 0.04f));
                v.ph += f / sr; v.ph -= std::floor (v.ph);
                s = std::sin (v.ph * juce::MathConstants<float>::twoPi) * expd (k == 2 ? 0.25f : 0.42f) + v.rng.next() * std::exp (-t / 0.01f) * 0.15f;
                s = std::tanh (s * 1.3f);
                break;
            }
            case DrumType::Crash: case DrumType::Ride: case DrumType::RideBell:
            {
                if (t == 0) { v.f1.set (v.type == DrumType::Crash ? 4500.0f : 6000.0f, 0.6f, sr); v.f2.set (2000.0f, 1.5f, sr); }
                float len = v.type == DrumType::Crash ? 2.2f : 2.8f;
                float m = metal (v.type == DrumType::Crash ? 2.3f : 3.1f) * 0.6f + v.rng.next() * (v.type == DrumType::Crash ? 0.8f : 0.35f);
                s = v.f1.hp (m) * expd (len) * (v.type == DrumType::Crash ? 0.7f : 0.45f);
                if (v.type != DrumType::Crash)
                {
                    v.ph += 2350.0f * v.pitch / sr; v.ph -= std::floor (v.ph);
                    s += std::sin (v.ph * juce::MathConstants<float>::twoPi) * expd (v.type == DrumType::RideBell ? 1.4f : 0.6f) * (v.type == DrumType::RideBell ? 0.45f : 0.12f);
                }
                break;
            }
            case DrumType::Cowbell:
            {
                if (t == 0) v.f1.set (900.0f, 2.0f, sr);
                v.ph += 540.0f * v.pitch / sr; v.ph2 += 800.0f * v.pitch / sr; v.ph -= std::floor (v.ph); v.ph2 -= std::floor (v.ph2);
                float sq = (v.ph < 0.5f ? 1.0f : -1.0f) + (v.ph2 < 0.5f ? 1.0f : -1.0f);
                s = v.f1.bp (sq) * expd (0.25f) * 0.8f;
                break;
            }
            case DrumType::Tambourine: case DrumType::Shaker:
            {
                if (t == 0) v.f1.set (v.type == DrumType::Shaker ? 6000.0f : 8000.0f, 0.7f, sr);
                float env = v.type == DrumType::Shaker ? std::exp (-t / (0.06f * dec)) * juce::jmin (1.0f, t / 0.01f) : expd (0.18f);
                s = v.f1.hp (v.rng.next() + (v.type == DrumType::Tambourine ? metal (4.0f) * 0.4f : 0.0f)) * env * 0.6f;
                break;
            }
            default: break;
        }
        v.t += 1.0f / sr;
        s *= v.vel * 0.8f;
        if (v.t > 6.0f || (v.t > 0.05f && std::abs (s) < 0.00001f && v.type != DrumType::Clap)) v.active = false;
        outR = s * (0.5f + 0.5f * v.pan) * 0.75f;
        return s * (0.5f - 0.5f * v.pan) * 0.75f;
    }

    void processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi) override
    {
        buffer.clear();
        int a = audition.exchange (-1);
        if (a >= 0) trigger (a, 0.9f);
        auto sr = (float) rate;
        auto* L = buffer.getWritePointer (0);
        auto* R = buffer.getNumChannels() > 1 ? buffer.getWritePointer (1) : nullptr;
        auto it = midi.begin();
        for (int i = 0; i < buffer.getNumSamples(); ++i)
        {
            while (it != midi.end() && (*it).samplePosition <= i)
            {
                auto msg = (*it).getMessage();
                if (msg.isNoteOn()) trigger (msg.getNoteNumber(), msg.getFloatVelocity());
                ++it;
            }
            float l = 0, r = 0;
            for (auto& v : voices)
                if (v.active) { float vr; l += renderVoice (v, sr, vr); r += vr; }
            L[i] = l; if (R) R[i] = r;
        }
        float rm = room->get();
        if (rm > 0.001f && verb[0] && R)
        {
            auto d = mp_find ("ma_plate");
            int kMix = mp_ctl_index (d, "mix"), kDecay = mp_ctl_index (d, "decay");
            for (auto* x : verb) { if (mp_get (x, kMix) != rm * 0.5f) mp_set (x, kMix, rm * 0.5f); if (mp_get (x, kDecay) != 0.9f) mp_set (x, kDecay, 0.9f); }
            mp_run (verb[0], L, L, buffer.getNumSamples());
            mp_run (verb[1], R, R, buffer.getNumSamples());
        }
        buffer.applyGain (juce::Decibels::decibelsToGain (volume->get()));
    }

    juce::AudioProcessorEditor* createEditor() override;

    juce::AudioParameterChoice* kit = nullptr;
    juce::AudioParameterFloat *tune = nullptr, *decay = nullptr, *tone = nullptr, *punch = nullptr, *room = nullptr, *volume = nullptr;
    std::array<DrumVoice, 24> voices;
    std::atomic<int> audition { -1 };
    MpFx* verb[2] { nullptr, nullptr };
    double rate = 48000, verbRate = 0;
};

class DrumsEditor : public MotionEditorBase
{
public:
    DrumsEditor (DrumsProcessor& p) : MotionEditorBase (p), proc (p), knobs (p)
    {
        subtitle = "General MIDI kit (C1 kick, D1 snare, F#1 hat...)";
        addAndMakeVisible (knobs);
        static const int pads[16] = { 49, 51, 53, 57, 46, 42, 44, 56, 50, 48, 45, 43, 36, 38, 37, 39 };
        for (int note : pads)
        {
            auto* b = buttons.add (new juce::TextButton (drumName (note)));
            b->onClick = [this, note] { proc.audition = note; };
            b->setTooltip ("MIDI note " + juce::String (note) + " (" + juce::MidiMessage::getMidiNoteName (note, true, true, 3) + ")");
            addAndMakeVisible (b);
        }
        setSize (7 * 92 + 24 + 300, 44 + 10 + 2 * 104 + 40);
    }
    void resized() override
    {
        auto r = content();
        auto padArea = r.removeFromRight (300);
        knobs.setBounds (r);
        int w = padArea.getWidth() / 4, h = padArea.getHeight() / 4;
        for (int i = 0; i < buttons.size(); ++i)
            buttons[i]->setBounds (juce::Rectangle<int> (padArea.getX() + (i % 4) * w, padArea.getY() + (i / 4) * h, w, h).reduced (3));
    }
    DrumsProcessor& proc;
    ParamKnobPanel knobs;
    juce::OwnedArray<juce::TextButton> buttons;
};

juce::AudioProcessorEditor* DrumsProcessor::createEditor()  { return new DrumsEditor (*this); }
std::unique_ptr<juce::AudioPluginInstance> createDrumsProcessor (const MotionPluginInfo& i) { return std::make_unique<DrumsProcessor> (i); }

//==============================================================================
const std::vector<SoundBankSource>& starterSoundBanks()
{
    static const std::vector<SoundBankSource> list {
        { "Upright Piano KW", "https://freepats.zenvoid.org/Piano/UprightPianoKW/UprightPianoKW-SF2-20220221.7z", "CC0" },
        { "YDP Grand Piano", "https://freepats.zenvoid.org/Piano/YDP-GrandPiano/YDP-GrandPiano-SF2-20160804.tar.bz2", "CC-BY 3.0" },
        { "FM Piano 1", "https://github.com/freepats/fm-piano1/releases/download/2019-09-16/FM-Piano1-SF2-20190916.7z", "CC0" },
        { "Drawbar Organ", "https://freepats.zenvoid.org/Organ/DrawbarOrganEmulation/DrawbarOrganEmulation-SF2-20190712.tar.xz", "CC0" },
        { "Church Organ", "https://freepats.zenvoid.org/Organ/ChurchOrganEmulation/ChurchOrganEmulation-SF2-20190924.tar.xz", "CC0" },
        { "Synth Pad Choir", "https://github.com/freepats/synth-pad-choir/releases/download/2020-05-16/SynthPadChoir-SF2-20200516.7z", "CC0" },
        { "Sweep Pad", "https://github.com/freepats/sweep-pad/releases/download/2019-08-13/SweepPad-SF2-20190813.7z", "CC0" },
        { "Synth Strings 1", "https://github.com/freepats/synth-strings-1/releases/download/2020-05-28/SynthStrings1-SF2-20200528.7z", "CC0" },
        { "Synth Bass 1", "https://github.com/freepats/synth-bass-1/releases/download/2019-07-23/SynthBass1-SF2-20190723.7z", "CC0" },
        { "Finger Bass YR", "https://github.com/freepats/electric-bass-YR/releases/download/2019-09-30/FingerBassYR-SF2-20190930.7z", "CC0" },
        { "Nylon Guitar", "https://freepats.zenvoid.org/Guitar/SpanishClassicalGuitar/SpanishClassicalGuitar-SF2-20190618.7z", "CC0" },
        { "Electric Guitar Clean", "https://github.com/freepats/electric-guitar-FSBS-clean/releases/download/2026-08-07/EGuitarFSBS-clean-bridge-small-SF2-20260807.7z", "CC0" },
        { "Tubular Bells", "https://github.com/freepats/tubular-bells1/releases/download/2024-11-30/TubularBells-SF2-20241130.7z", "CC0" },
    };
    return list;
}

juce::Array<juce::File> findSoundBanks()
{
    auto files = soundsFolder().findChildFiles (juce::File::findFiles, true, "*.sf2");
    juce::Array<juce::File> out;
    for (auto& f : files) if (! f.getFullPathName().contains ("/.downloads/")) out.add (f);
    std::sort (out.begin(), out.end(), [] (const juce::File& a, const juce::File& b) { return a.getFileName().compareNatural (b.getFileName()) < 0; });
    return out;
}

SoundBankDownloader::SoundBankDownloader() : juce::Thread ("Motion sound banks") {}
SoundBankDownloader::~SoundBankDownloader() { stopThread (5000); }

static bool unpack (const juce::File& archive, const juce::File& dest)
{
    dest.createDirectory();
    std::vector<juce::StringArray> tries;
    auto a = archive.getFullPathName(), d = dest.getFullPathName();
   #if JUCE_MAC
    tries.push_back ({ "/usr/bin/tar", "-xf", a, "-C", d });          // macOS tar (libarchive) reads 7z, xz and bz2
   #else
    if (archive.getFileName().endsWith (".7z"))
    {
        tries.push_back ({ "7z", "x", "-y", "-o" + d, a });
        tries.push_back ({ "7za", "x", "-y", "-o" + d, a });
        tries.push_back ({ "bsdtar", "-xf", a, "-C", d });
    }
    tries.push_back ({ "tar", "-xf", a, "-C", d });
   #endif
    for (auto& args : tries)
    {
        juce::ChildProcess p;
        if (p.start (args, 0) && p.waitForProcessToFinish (300000) && p.getExitCode() == 0)
            return true;
    }
    return false;
}

void SoundBankDownloader::run()
{
    auto banks = starterSoundBanks();
    auto cache = soundsFolder().getChildFile (".downloads");
    cache.createDirectory();
    int done = 0, failed = 0;
    auto only = juce::StringArray::fromTokens (juce::SystemStats::getEnvironmentVariable ("MS_BANK_ONLY", {}), ",", "");
    only.removeEmptyStrings();
    if (! only.isEmpty())
        banks.erase (std::remove_if (banks.begin(), banks.end(), [&] (const SoundBankSource& b) { return ! only.contains (b.name); }), banks.end());
    for (auto& b : banks)
    {
        if (threadShouldExit()) break;
        auto target = soundsFolder().getChildFile (juce::String (b.name) + ".sf2");
        progress = (double) done / (double) banks.size();
        if (target.existsAsFile()) { ++done; continue; }
        setStatus ("Downloading " + juce::String (b.name) + " (" + juce::String (b.license) + ")...");
        juce::URL url (b.url);
        auto archive = cache.getChildFile (url.getFileName());
        if (! archive.existsAsFile())
        {
            auto stream = url.createInputStream (juce::URL::InputStreamOptions (juce::URL::ParameterHandling::inAddress)
                                                    .withConnectionTimeoutMs (20000).withNumRedirectsToFollow (8));
            if (stream == nullptr) { ++failed; ++done; continue; }
            juce::FileOutputStream out (archive);
            if (! out.openedOk()) { ++failed; ++done; continue; }
            auto total = stream->getTotalLength();
            juce::HeapBlock<char> buf (65536);
            juce::int64 got = 0;
            while (! stream->isExhausted() && ! threadShouldExit())
            {
                auto n = stream->read (buf, 65536);
                if (n <= 0) break;
                out.write (buf, (size_t) n);
                got += n;
                if (total > 0) progress = ((double) done + (double) got / (double) total * 0.9) / (double) banks.size();
            }
            out.flush();
            if (threadShouldExit()) { archive.deleteFile(); break; }
        }
        setStatus ("Unpacking " + juce::String (b.name) + "...");
        auto dir = cache.getChildFile (juce::String (b.name).removeCharacters (" "));
        if (unpack (archive, dir))
        {
            auto found = dir.findChildFiles (juce::File::findFiles, true, "*.sf2");
            if (! found.isEmpty())
            {
                std::sort (found.begin(), found.end(), [] (const juce::File& x, const juce::File& y) { return x.getSize() > y.getSize(); });
                found.getFirst().moveFileTo (target);
            }
            else ++failed;
            dir.deleteRecursively();
            archive.deleteFile();
        }
        else ++failed;
        ++done;
    }
    progress = 1.0;
    setStatus (failed == 0 ? juce::String ("Sound banks ready in ") + soundsFolder().getFullPathName()
                           : juce::String (failed) + " of " + juce::String ((int) banks.size()) + " banks couldn't be fetched; the rest are ready.");
    if (onFinished) onFinished();
}

} // namespace ms
