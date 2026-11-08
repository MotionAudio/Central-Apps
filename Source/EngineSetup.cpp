#include "EngineSetup.h"
#include "MotionPlugins.h"
#include "Session.h"
#include "Theme.h"

namespace ms
{

//==============================================================================
juce::File MotionEngineBehaviour::getDefaultFolderForAudioRecordings (te::Edit& edit)
{
    auto f = edit.editFileRetriever ? edit.editFileRetriever() : juce::File();
    auto dir = f != juce::File() ? f.getParentDirectory().getChildFile ("Audio") : projectsFolder().getChildFile ("Recordings");
    dir.createDirectory();
    return dir;
}

std::unique_ptr<juce::PluginDescription> MotionEngineBehaviour::findDescriptionForFileOrID (const juce::String& id)
{
    if (auto p = findMotionPlugin (id))
        return std::make_unique<juce::PluginDescription> (describeMotionPlugin (*p));
    return {};
}

//==============================================================================
class PluginWindow : public juce::DocumentWindow
{
public:
    PluginWindow (te::Plugin& p)
        : juce::DocumentWindow (p.getName() + (p.getOwnerTrack() != nullptr ? "  -  " + p.getOwnerTrack()->getName() : juce::String()),
                                Colours::panel, juce::DocumentWindow::closeButton, true),
          plugin (p)
    {
        setUsingNativeTitleBar (true);
        getConstrainer()->setMinimumOnscreenAmounts (0x10000, 50, 30, 50);
        recreateEditor();
        auto pos = plugin.windowState->choosePositionForPluginWindow();
        setTopLeftPosition (pos.x, pos.y);
        setAlwaysOnTop (true);
        setVisible (true);
        toFront (true);
        ready = true;
    }

    ~PluginWindow() override
    {
        ready = false;
        plugin.edit.flushPluginStateIfNeeded (plugin);
        clearContentComponent();
        editor.reset();
    }

    void recreateEditor()
    {
        clearContentComponent();
        editor.reset();
        editor = plugin.createEditor();
        if (editor == nullptr)
            editor = std::make_unique<GenericPluginEditor> (plugin);
        setContentNonOwned (editor.get(), true);
        setResizable (editor->allowWindowResizing(), false);
    }

    void recreateEditorAsync()
    {
        clearContentComponent();
        editor.reset();
        juce::Timer::callAfterDelay (50, [sp = juce::Component::SafePointer<PluginWindow> (this)] { if (sp) sp->recreateEditor(); });
    }

    void moved() override
    {
        if (ready) { plugin.windowState->lastWindowBounds = getBounds(); plugin.edit.pluginChanged (plugin); }
    }
    void closeButtonPressed() override  { plugin.windowState->closeWindowExplicitly(); }
    float getDesktopScaleFactor() const override { return 1.0f; }

    te::Plugin& plugin;
    std::unique_ptr<te::Plugin::EditorComponent> editor;
    bool ready = false;
};

std::unique_ptr<juce::Component> MotionUIBehaviour::createPluginWindow (te::PluginWindowState& pws)
{
    if (auto ws = dynamic_cast<te::Plugin::WindowState*> (&pws))
    {
        if (auto ext = dynamic_cast<te::ExternalPlugin*> (&ws->plugin))
            if (ext->getAudioPluginInstance() == nullptr)
                return {};
        return std::make_unique<PluginWindow> (ws->plugin);
    }
    return {};
}

void MotionUIBehaviour::recreatePluginWindowContentAsync (te::Plugin& p)
{
    if (auto* w = dynamic_cast<PluginWindow*> (p.windowState->pluginWindow.get()))
        return w->recreateEditorAsync();
    UIBehaviour::recreatePluginWindowContentAsync (p);
}

void MotionUIBehaviour::showWarningAlert (const juce::String& title, const juce::String& message)
{
    juce::AlertWindow::showMessageBoxAsync (juce::MessageBoxIconType::WarningIcon, title, message);
}

void MotionUIBehaviour::runTaskWithProgressBar (te::ThreadPoolJobWithProgress& job)
{
    // simple: run it here, keeping the message loop alive
    struct Runner : public juce::ThreadWithProgressWindow
    {
        Runner (te::ThreadPoolJobWithProgress& j) : juce::ThreadWithProgressWindow (j.getJobName(), true, false), job (j) {}
        void run() override
        {
            while (job.runJob() == juce::ThreadPoolJob::jobNeedsRunningAgain && ! threadShouldExit())
                setProgress (job.getCurrentTaskProgress());
        }
        te::ThreadPoolJobWithProgress& job;
    };
    Runner r (job);
    r.runThread();
}

te::Edit* MotionUIBehaviour::getCurrentlyFocusedEdit()          { return session != nullptr ? session->edit.get() : nullptr; }
juce::Array<te::Edit*> MotionUIBehaviour::getAllOpenEdits()     { juce::Array<te::Edit*> a; if (auto e = getCurrentlyFocusedEdit()) a.add (e); return a; }
te::SelectionManager* MotionUIBehaviour::getCurrentlyFocusedSelectionManager() { return session != nullptr ? &session->selection : nullptr; }

//==============================================================================
struct GenericPluginEditor::ParamKnob : public juce::Component
{
    ParamKnob (te::AutomatableParameter::Ptr p) : param (p), knob (p->getParameterName())
    {
        auto range = p->getValueRange();
        knob.slider.setRange (range.getStart(), range.getEnd());
        knob.slider.setValue (p->getCurrentValue(), juce::dontSendNotification);
        knob.slider.textFromValueFunction = [this] (double v) { return param->valueToString ((float) v) + " " + param->getLabel(); };
        knob.slider.onDragStart = [this] { param->parameterChangeGestureBegin(); };
        knob.slider.onDragEnd = [this] { param->parameterChangeGestureEnd(); };
        knob.slider.onValueChange = [this] { param->setParameter ((float) knob.slider.getValue(), juce::sendNotification); };
        knob.slider.setDoubleClickReturnValue (true, p->getDefaultValue().value_or (range.getStart()));
        addAndMakeVisible (knob);
    }
    void resized() override { knob.setBounds (getLocalBounds()); }
    void refresh()
    {
        if (! knob.slider.isMouseButtonDown())
            knob.slider.setValue (param->getCurrentValue(), juce::dontSendNotification);
    }
    te::AutomatableParameter::Ptr param;
    Knob knob;
};

GenericPluginEditor::GenericPluginEditor (te::Plugin& p) : plugin (&p)
{
    for (auto ap : p.getAutomatableParameters())
        content.addAndMakeVisible (knobs.add (new ParamKnob (ap)));
    viewport.setViewedComponent (&content, false);
    viewport.setScrollBarsShown (true, false);
    addAndMakeVisible (viewport);
    int perRow = juce::jlimit (2, 7, (int) std::ceil (std::sqrt ((double) juce::jmax (1, knobs.size())) * 1.6));
    int rows = (knobs.size() + perRow - 1) / perRow;
    setSize (juce::jmax (360, perRow * 92 + 24), 54 + juce::jmin (4, juce::jmax (1, rows)) * 104 + 16);
    startTimerHz (15);
}

GenericPluginEditor::~GenericPluginEditor() { stopTimer(); }

void GenericPluginEditor::paint (juce::Graphics& g)
{
    g.fillAll (Colours::bg);
    auto head = getLocalBounds().removeFromTop (44);
    g.setColour (Colours::panel2);
    g.fillRect (head);
    g.setColour (Colours::gold);
    g.fillRect (head.removeFromBottom (2));
    g.setFont (Fonts::heavy (17.0f));
    g.setColour (Colours::text);
    g.drawText (plugin->getName(), getLocalBounds().removeFromTop (42).reduced (14, 0), juce::Justification::centredLeft);
    if (knobs.isEmpty())
    {
        g.setColour (Colours::muted);
        g.setFont (Fonts::ui (14.0f));
        g.drawText ("This plugin has no controls.", getLocalBounds().withTrimmedTop (44), juce::Justification::centred);
    }
}

void GenericPluginEditor::resized()
{
    viewport.setBounds (getLocalBounds().withTrimmedTop (50).reduced (10, 4));
    int perRow = juce::jmax (1, (viewport.getWidth() - 12) / 92);
    int rows = (knobs.size() + perRow - 1) / perRow;
    content.setSize (viewport.getWidth() - 12, rows * 104);
    for (int i = 0; i < knobs.size(); ++i)
        knobs[i]->setBounds ((i % perRow) * 92, (i / perRow) * 104, 92, 104);
}

void GenericPluginEditor::timerCallback()
{
    for (auto* k : knobs) k->refresh();
}

//==============================================================================
std::vector<PluginChoice> builtInPluginChoices()
{
    std::vector<PluginChoice> v;
    auto add = [&] (const char* type, const char* name, const char* sub, bool inst = false)
    {
        PluginChoice c; c.name = name; c.group = "Built-in"; c.sub = sub; c.builtinType = type; c.isInstrument = inst;
        v.push_back (c);
    };
    add (te::FourOscPlugin::xmlTypeName, "4OSC Synth", "Instruments", true);
    add (te::SamplerPlugin::xmlTypeName, "Sampler", "Instruments", true);
    add (te::EqualiserPlugin::xmlTypeName, "4-Band EQ", "Studio");
    add (te::CompressorPlugin::xmlTypeName, "Compressor / Limiter", "Studio");
    add (te::ReverbPlugin::xmlTypeName, "Reverb", "Space");
    add (te::DelayPlugin::xmlTypeName, "Delay", "Space");
    add (te::ChorusPlugin::xmlTypeName, "Chorus", "Modulation");
    add (te::PhaserPlugin::xmlTypeName, "Phaser", "Modulation");
    add (te::LowPassPlugin::xmlTypeName, "Low / High Pass", "Studio");
    add (te::PitchShiftPlugin::xmlTypeName, "Pitch Shifter", "Pitch");
    add (te::ImpulseResponsePlugin::xmlTypeName, "Impulse Response (cab / room)", "Space");
    add (te::MidiModifierPlugin::xmlTypeName, "MIDI Modifier", "MIDI");
    add (te::ToneGeneratorPlugin::xmlTypeName, "Tone Generator", "Utility");

    struct AW { const char* type; const char* name; };
    static const AW air[] = {
       #include "AirwindowsList.inc"
    };
    for (auto& a : air) add (a.type, a.name, "Airwindows");
    return v;
}

te::Plugin::Ptr createPluginFromDescription (te::Edit& edit, const juce::PluginDescription& d)
{
    return edit.getPluginCache().createNewPlugin (te::ExternalPlugin::xmlTypeName, d);
}

te::Plugin::Ptr createPlugin (te::Edit& edit, const PluginChoice& c)
{
    if (c.builtinType.isNotEmpty())
    {
        juce::PluginDescription d;
        d.name = c.name;
        d.pluginFormatName = te::PluginManager::builtInPluginFormatName;
        d.fileOrIdentifier = c.builtinType + "_trkbuiltin";
        return edit.getPluginCache().createNewPlugin (c.builtinType, d);
    }
    return createPluginFromDescription (edit, c.desc);
}

juce::var makePluginDrag (const PluginChoice& c)
{
    if (c.builtinType.isNotEmpty())
        return "msplugin|builtin|" + c.builtinType + "|" + c.name + "|" + (c.isInstrument ? "1" : "0");
    return "msplugin|desc|" + c.desc.createIdentifierString();
}

std::optional<PluginChoice> pluginFromDrag (te::Engine& engine, const juce::var& v)
{
    auto s = v.toString();
    if (! s.startsWith ("msplugin|")) return std::nullopt;
    juce::StringArray parts;
    parts.addTokens (s, "|", "");
    PluginChoice c;
    if (parts[1] == "builtin" && parts.size() >= 5)
    {
        c.builtinType = parts[2]; c.name = parts[3]; c.isInstrument = parts[4] == "1"; c.group = "Built-in";
        return c;
    }
    if (parts[1] == "desc")
    {
        auto id = s.fromFirstOccurrenceOf ("msplugin|desc|", false, false);
        if (auto d = engine.getPluginManager().knownPluginList.getTypeForIdentifierString (id))
        {
            c.desc = *d; c.name = d->name; c.isInstrument = d->isInstrument;
            return c;
        }
    }
    return std::nullopt;
}

juce::var makeFileDrag (const juce::File& f)  { return "msfile|" + f.getFullPathName(); }

juce::File fileFromDrag (const juce::var& v)
{
    auto s = v.toString();
    if (! s.startsWith ("msfile|")) return {};
    return juce::File (s.fromFirstOccurrenceOf ("msfile|", false, false));
}

void showPluginMenu (te::Engine& engine, bool instrumentsOnly, juce::Component* target, std::function<void (const PluginChoice&)> cb)
{
    auto choices = std::make_shared<std::vector<PluginChoice>>();
    // Motion Audio first
    for (auto& p : motionPlugins())
    {
        if (instrumentsOnly != p.isInstrument) continue;
        PluginChoice c; c.name = p.name; c.group = "Motion Audio"; c.sub = p.group == "Pedals" ? "Pedals/" + p.category : p.group;
        c.desc = describeMotionPlugin (p); c.isInstrument = p.isInstrument;
        choices->push_back (c);
    }
    for (auto& c : builtInPluginChoices())
        if (c.isInstrument == instrumentsOnly) choices->push_back (c);
    for (auto& d : engine.getPluginManager().knownPluginList.getTypes())
    {
        if (d.pluginFormatName == MotionAudioFormat::formatName) continue;
        if (d.isInstrument != instrumentsOnly) continue;
        PluginChoice c; c.name = d.name; c.group = d.pluginFormatName; c.sub = d.manufacturerName.isNotEmpty() ? d.manufacturerName : "Other";
        c.desc = d; c.isInstrument = d.isInstrument;
        choices->push_back (c);
    }

    juce::PopupMenu root;
    std::map<juce::String, std::map<juce::String, juce::PopupMenu>> menus;
    std::map<juce::String, std::map<juce::String, std::map<juce::String, juce::PopupMenu>>> pedalMenus;
    for (size_t i = 0; i < choices->size(); ++i)
    {
        auto& c = (*choices)[i];
        auto action = [choices, i, cb] { cb ((*choices)[i]); };
        if (c.sub.startsWith ("Pedals/"))
            pedalMenus[c.group]["Pedals"][c.sub.fromFirstOccurrenceOf ("/", false, false)].addItem (c.name, action);
        else
            menus[c.group][c.sub].addItem (c.name, action);
    }
    juce::StringArray order { "Motion Audio", "Built-in", "AudioUnit", "VST3", "LADSPA" };
    for (auto& [g, _] : menus) if (! order.contains (g)) order.add (g);
    for (auto& g : order)
    {
        if (menus.count (g) == 0 && pedalMenus.count (g) == 0) continue;
        juce::PopupMenu gm;
        if (pedalMenus.count (g))
        {
            juce::PopupMenu pm;
            for (auto& [cat, m] : pedalMenus[g]["Pedals"]) pm.addSubMenu (cat, m);
            gm.addSubMenu ("Pedals", pm);
        }
        for (auto& [sub, m] : menus[g])
        {
            if (menus[g].size() == 1 && pedalMenus.count (g) == 0)
                gm = m;
            else
                gm.addSubMenu (sub, m);
        }
        root.addSubMenu (g == "AudioUnit" ? juce::String ("Audio Units") : g, gm);
    }
    if (engine.getPluginManager().knownPluginList.getNumTypes() <= (int) motionPlugins().size())
    {
        root.addSeparator();
        root.addItem ("No AU / VST3 plugins found yet: scan in Settings", false, false, [] {});
    }
    root.showMenuAsync (target != nullptr ? juce::PopupMenu::Options().withTargetComponent (target) : juce::PopupMenu::Options());
}

} // namespace ms
