#pragma once
#include "Session.h"
#include "Widgets.h"

namespace ms
{

/** One mixer channel: instrument, inserts, sends, pan, fader + meter, mute / solo / record. */
class ChannelStrip : public juce::Component, public juce::DragAndDropTarget
{
public:
    ChannelStrip (Session&, te::AudioTrack*);   // nullptr = the master
    void paint (juce::Graphics&) override;
    void resized() override;
    void refresh();
    void mouseDown (const juce::MouseEvent&) override;
    bool isInterestedInDragSource (const SourceDetails&) override;
    void itemDropped (const SourceDetails&) override;
    static constexpr int width = 104;
    te::AudioTrack::Ptr track;

private:
    struct Slot : public juce::Component, public juce::SettableTooltipClient
    {
        Slot (ChannelStrip&, te::Plugin*, bool isInstrument);
        void paint (juce::Graphics&) override;
        void mouseDown (const juce::MouseEvent&) override;
        ChannelStrip& strip;
        te::Plugin::Ptr plugin;
        bool instrument;
    };
    void buildSlots();
    te::VolumeAndPanPlugin* volumePlugin() const;
    te::PluginList& plugins() const;

    Session& session;
    bool isMaster;
    juce::OwnedArray<Slot> slots;
    juce::OwnedArray<Knob> sendKnobs;
    juce::Array<int> sendBuses;
    juce::Slider pan, fader;
    LevelMeter meter;
    SmallToggle mute { "M", Colours::mute, "Mute" }, solo { "S", Colours::solo, "Solo" }, arm { "R", Colours::live, "Record enable" };
    juce::Label dbLabel;
    juce::String slotSignature;
};

class MixerView : public juce::Component, private Session::Listener, private juce::Timer
{
public:
    MixerView (Session&);
    ~MixerView() override;
    void paint (juce::Graphics&) override;
    void resized() override;
    void rebuild();

private:
    void editChanged() override        { rebuild(); }
    void structureChanged() override   { rebuild(); }
    void propertiesChanged() override  { for (auto* s : strips) s->refresh(); }
    void selectionChanged() override   { repaint(); for (auto* s : strips) s->repaint(); }
    void timerCallback() override;
    Session& session;
    juce::Viewport viewport;
    juce::Component content;
    juce::OwnedArray<ChannelStrip> strips;
    std::unique_ptr<ChannelStrip> master;
    juce::TextButton addReturn { "+ Return" };
};

} // namespace ms
