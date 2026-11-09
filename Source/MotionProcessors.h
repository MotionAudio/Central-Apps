#pragma once
#include "MotionPlugins.h"
#include "Theme.h"

namespace ms
{

struct CmfxSource
{
    juce::String id, name, family, description, json;
    bool bundled = true;
};
const std::vector<CmfxSource>& cmfxSources();
const CmfxSource* findCmfx (const juce::String& id);

struct BoardPreset
{
    struct Pedal { juce::String label; std::map<juce::String, float> values; };
    juce::String id, name, kind;
    std::vector<Pedal> chain;
};
const std::vector<BoardPreset>& boardPresets();

std::unique_ptr<juce::AudioPluginInstance> createPedalProcessor (const MotionPluginInfo&, const juce::String& label);
std::unique_ptr<juce::AudioPluginInstance> createPedalboardProcessor (const MotionPluginInfo&, const juce::String& presetId);
std::unique_ptr<juce::AudioPluginInstance> createCmfxProcessor (const MotionPluginInfo&, const CmfxSource&);
std::unique_ptr<juce::AudioPluginInstance> createKeysProcessor (const MotionPluginInfo&);
std::unique_ptr<juce::AudioPluginInstance> createPadsProcessor (const MotionPluginInfo&);
std::unique_ptr<juce::AudioPluginInstance> createDrumsProcessor (const MotionPluginInfo&);
std::unique_ptr<juce::AudioPluginInstance> createTuneProcessor (const MotionPluginInfo&);
std::unique_ptr<juce::AudioPluginInstance> createDenoiseProcessor (const MotionPluginInfo&);
std::unique_ptr<juce::AudioPluginInstance> createDeEsserProcessor (const MotionPluginInfo&);
std::unique_ptr<juce::AudioPluginInstance> createDuckerProcessor (const MotionPluginInfo&);
std::unique_ptr<juce::AudioPluginInstance> createMasterProcessor (const MotionPluginInfo&);

//==============================================================================
/** Shared base: name, buses, parameter state, the Motion Audio editor frame. */
class MotionProcessorBase : public juce::AudioPluginInstance
{
public:
    MotionProcessorBase (const MotionPluginInfo&);

    const juce::String getName() const override                    { return info.name; }
    void fillInPluginDescription (juce::PluginDescription& d) const override { d = describeMotionPlugin (info); }
    double getTailLengthSeconds() const override                    { return tailSeconds; }
    bool acceptsMidi() const override                               { return info.isInstrument; }
    bool producesMidi() const override                              { return false; }
    bool hasEditor() const override                                 { return true; }
    int getNumPrograms() override                                   { return 1; }
    int getCurrentProgram() override                                { return 0; }
    void setCurrentProgram (int) override                           {}
    const juce::String getProgramName (int) override                { return {}; }
    void changeProgramName (int, const juce::String&) override      {}
    void releaseResources() override                                {}
    bool isBusesLayoutSupported (const BusesLayout&) const override;

    void getStateInformation (juce::MemoryBlock&) override;
    void setStateInformation (const void*, int) override;
    virtual void saveExtra (juce::ValueTree&) {}
    virtual void loadExtra (const juce::ValueTree&) {}

    juce::AudioParameterFloat* addFloat (const juce::String& id, const juce::String& name, float min, float max, float def,
                                         const juce::String& unit = {}, bool log = false, float step = 0.0f);
    juce::AudioParameterBool* addBool (const juce::String& id, const juce::String& name, bool def);
    juce::AudioParameterChoice* addChoice (const juce::String& id, const juce::String& name, const juce::StringArray&, int def);

    MotionPluginInfo info;
    double tailSeconds = 0.0;
};

/** Editor frame: black panel, gold header with the plugin name and "MOTION AUDIO". */
class MotionEditorBase : public juce::AudioProcessorEditor
{
public:
    MotionEditorBase (MotionProcessorBase&);
    ~MotionEditorBase() override;
    void paint (juce::Graphics&) override;
    juce::Rectangle<int> content() const    { return getLocalBounds().withTrimmedTop (44).reduced (12, 10); }
    juce::String subtitle;

protected:
    MotionProcessorBase& base;
    std::unique_ptr<juce::LookAndFeel> laf;
};

/** A row of knobs for every float parameter of a processor (used by FX plugins and instruments). */
class ParamKnobPanel : public juce::Component
{
public:
    ParamKnobPanel (juce::AudioProcessor&, juce::StringArray onlyIds = {}, juce::Colour accent = Colours::gold);
    void resized() override;
    int preferredWidth (int maxPerRow = 6) const;
    int preferredHeight (int width) const;
    juce::OwnedArray<Knob> knobs;
    juce::OwnedArray<juce::SliderParameterAttachment> attachments;
    juce::OwnedArray<juce::ComboBox> combos;
    juce::OwnedArray<juce::ComboBoxParameterAttachment> comboAttachments;
    juce::OwnedArray<juce::Label> comboLabels;
};

/** A drawn stompbox for one Central Pedal: enclosure in the pedal's colour, knobs, footswitch and LED. */
class StompboxView : public juce::Component
{
public:
    struct Callbacks
    {
        std::function<float (int)> get;
        std::function<void (int, float)> set;
        std::function<bool()> isOn;
        std::function<void (bool)> setOn;
        std::function<void()> onRemove;           // optional (pedalboard)
        std::function<void (int)> onMove;          // optional (pedalboard): -1 left, +1 right
    };

    StompboxView (const MpDef&, Callbacks);
    void paint (juce::Graphics&) override;
    void resized() override;
    void mouseDown (const juce::MouseEvent&) override;
    void refresh();
    static int widthFor (const MpDef&);
    static constexpr int height = 316;

    const MpDef& def;
    Callbacks cb;
    juce::Colour colour;
    juce::OwnedArray<juce::Slider> sliders;
    juce::OwnedArray<juce::Label> labels;
    juce::Rectangle<int> footswitch;
    std::unique_ptr<juce::TextButton> removeButton;
};

} // namespace ms
