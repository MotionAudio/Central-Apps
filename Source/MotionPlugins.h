#pragma once
#include "Common.h"
extern "C" {
#include "mapedals.h"
}

/* Motion Audio's own plugins, built into Motion Studio:
 *   - the 55 Central Pedals (the same C DSP the Central Pedal and the Central apps run)
 *   - Motion Pedalboard: a chain of Central Pedals, with Motion Audio's 32 boards as presets
 *   - the Central FX plugin collection (.cmfx.json, played by the same C core as Central Production's plugin builder),
 *     plus any .cmfx.json in ~/Music/Motion Studio/Plugins
 *   - Motion Keys: plays SoundFont (.sf2) banks (the same banks the Central apps use), with a built-in electric piano
 *   - Motion Pads: a worship pad synth
 * They are a real juce::AudioPluginFormat ("Motion Audio"), so they sit in the plugin list beside AU / VST3 and save,
 * automate and open their editors the same way. */

namespace ms
{

struct MotionPluginInfo
{
    juce::String id, name, category, group;   // group: "Pedals", "Boards", "Plugins", "Instruments"
    bool isInstrument = false;
    juce::Colour colour;
};

/** Every Motion Audio plugin (pedals, boards, FX, instruments). */
const std::vector<MotionPluginInfo>& motionPlugins();
const MotionPluginInfo* findMotionPlugin (const juce::String& id);
juce::PluginDescription describeMotionPlugin (const MotionPluginInfo&);
std::unique_ptr<juce::AudioPluginInstance> createMotionPlugin (const juce::String& id);

/** Folders the app keeps its things in (created on demand). */
juce::File userFolder();              // ~/Music/Motion Studio
juce::File soundsFolder();            // .../Sounds   (SoundFonts)
juce::File userPluginsFolder();       // .../Plugins  (.cmfx.json)
juce::File projectsFolder();          // .../Projects

/** Pedal category display names and colours, as on the Central Pedal. */
juce::String pedalCategoryName (const juce::String& cat);
juce::Colour pedalCategoryColour (const juce::String& cat);
juce::Colour pedalColour (const juce::String& label);

class MotionAudioFormat : public juce::AudioPluginFormat
{
public:
    static constexpr const char* formatName = "Motion Audio";

    juce::String getName() const override                                         { return formatName; }
    void findAllTypesForFile (juce::OwnedArray<juce::PluginDescription>&, const juce::String&) override;
    bool fileMightContainThisPluginType (const juce::String& id) override         { return id.startsWith ("motion:"); }
    juce::String getNameOfPluginFromIdentifier (const juce::String&) override;
    bool pluginNeedsRescanning (const juce::PluginDescription&) override           { return false; }
    bool doesPluginStillExist (const juce::PluginDescription& d) override          { return findMotionPlugin (d.fileOrIdentifier) != nullptr; }
    bool canScanForPlugins() const override                                        { return false; }
    bool isTrivialToScan() const override                                          { return true; }
    juce::StringArray searchPathsForPlugins (const juce::FileSearchPath&, bool, bool) override;
    juce::FileSearchPath getDefaultLocationsToSearch() override                    { return {}; }
    bool requiresUnblockedMessageThreadDuringCreation (const juce::PluginDescription&) const override { return false; }

protected:
    void createPluginInstance (const juce::PluginDescription&, double, int, PluginCreationCallback) override;
};

/** Puts every Motion Audio plugin into a KnownPluginList (done at startup and after scans). */
void registerMotionPlugins (juce::KnownPluginList&);

} // namespace ms
