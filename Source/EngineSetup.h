#pragma once
#include "Common.h"

namespace ms
{

/** Engine behaviour: where recordings go, Motion Audio plugin lookups, sensible defaults. */
class MotionEngineBehaviour : public te::EngineBehaviour
{
public:
    juce::File getDefaultFolderForAudioRecordings (te::Edit&) override;
    juce::String getDefaultAudioRecordingFilePattern() override { return "%projectdir%/%edit%_%track%_Take_%take%"; }
    std::unique_ptr<juce::PluginDescription> findDescriptionForFileOrID (const juce::String&) override;
    bool autoAddClipEdgeFades() override                         { return true; }
    bool areClipSlotsEnabled() override                          { return true; }
    bool shouldProcessMutedTracks() override                     { return false; }
    int getMiddleCOctave() override                              { return 3; }   // Logic / Ableton style: middle C = C3
};

/** UI behaviour: opens plugin windows (third party, Motion Audio and Tracktion's built-ins). */
class MotionUIBehaviour : public te::UIBehaviour
{
public:
    std::unique_ptr<juce::Component> createPluginWindow (te::PluginWindowState&) override;
    void recreatePluginWindowContentAsync (te::Plugin&) override;
    void showWarningAlert (const juce::String& title, const juce::String& message) override;
    void showInfoMessage (const juce::String&) override {}
    void runTaskWithProgressBar (te::ThreadPoolJobWithProgress&) override;
    te::Edit* getCurrentlyFocusedEdit() override;
    te::Edit* getLastFocusedEdit() override                     { return getCurrentlyFocusedEdit(); }
    juce::Array<te::Edit*> getAllOpenEdits() override;
    te::SelectionManager* getCurrentlyFocusedSelectionManager() override;
    Session* session = nullptr;
};

/** Knobs for any Tracktion plugin that has no editor of its own (EQ, compressor, 4OSC, Airwindows...). */
class GenericPluginEditor : public te::Plugin::EditorComponent, private juce::Timer
{
public:
    GenericPluginEditor (te::Plugin&);
    ~GenericPluginEditor() override;
    void paint (juce::Graphics&) override;
    void resized() override;
    bool allowWindowResizing() override { return false; }
    juce::ComponentBoundsConstrainer* getBoundsConstrainer() override { return nullptr; }

private:
    void timerCallback() override;
    te::Plugin::Ptr plugin;
    struct ParamKnob;
    juce::OwnedArray<ParamKnob> knobs;
    juce::Viewport viewport;
    juce::Component content;
};

/** Every plugin a user can add: Motion Audio, Tracktion built-ins and scanned AU / VST3. */
struct PluginChoice
{
    juce::String name, group, sub;      // group: "Motion Audio", "Built-in", manufacturer...
    juce::PluginDescription desc;       // for Motion / external
    juce::String builtinType;           // for Tracktion built-ins (xmlTypeName)
    bool isInstrument = false;
};

std::vector<PluginChoice> builtInPluginChoices();
te::Plugin::Ptr createPlugin (te::Edit&, const PluginChoice&);
te::Plugin::Ptr createPluginFromDescription (te::Edit&, const juce::PluginDescription&);

/** Drag-and-drop descriptions shared by the browser, tracks and mixer. */
juce::var makePluginDrag (const PluginChoice&);
std::optional<PluginChoice> pluginFromDrag (te::Engine&, const juce::var&);
juce::var makeFileDrag (const juce::File&);
juce::File fileFromDrag (const juce::var&);

/** A popup menu with every plugin, grouped. Calls back with the choice. */
void showPluginMenu (te::Engine&, bool instrumentsOnly, juce::Component* target, std::function<void (const PluginChoice&)>);

} // namespace ms
