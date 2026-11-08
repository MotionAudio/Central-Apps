#include "MainComponent.h"
#include "MotionPlugins.h"

namespace ms
{

MainComponent::MainComponent (Session& s, juce::ApplicationCommandManager& cm)
    : session (s), commands (cm), transport (s), browser (s), arrange (s), live (s), mixer (s), editor (s)
{
    addAndMakeVisible (transport);
    addAndMakeVisible (browser);
    addAndMakeVisible (arrange);
    addChildComponent (live);
    addChildComponent (mixer);
    addAndMakeVisible (editor);

    transport.onShowView = [this] (int v) { showView (v); };
    transport.onToggleBrowser = [this] { browserVisible = ! browserVisible; resized(); };
    transport.onToggleEditor = [this] { editorVisible = ! editorVisible; resized(); };
    transport.onSettings = [this] { showSettings(); };
    browser.onScanPlugins = [this] { showSettings (1); };
    arrange.onOpenClip = [this] (te::Clip* c) { openClip (c); };
    live.onOpenClip = [this] (te::Clip* c) { openClip (c); };

    session.addListener (this);
    setWantsKeyboardFocus (true);
    startTimer (1000);
    showView (0);
}

MainComponent::~MainComponent()
{
    session.removeListener (this);
}

void MainComponent::openClip (te::Clip* c)
{
    if (c == nullptr) return;
    editorVisible = true;
    resized();
    editor.showClip (c);
}

void MainComponent::showView (int v)
{
    view = v;
    arrange.setVisible (v == 0);
    live.setVisible (v == 1);
    mixer.setVisible (v == 2);
    transport.setCurrentView (v);
    resized();
}

void MainComponent::paint (juce::Graphics& g)
{
    g.fillAll (Colours::bg);
    // splitter lines
    g.setColour (Colours::line);
    if (browserVisible) g.fillRect (browser.getRight(), browser.getY(), 3, browser.getHeight());
    if (editorVisible && editor.isVisible()) g.fillRect (editor.getX(), editor.getY() - 3, editor.getWidth(), 3);
}

void MainComponent::resized()
{
    auto r = getLocalBounds();
    transport.setBounds (r.removeFromTop (66));
    transport.setPanelStates (browserVisible, editorVisible);
    browser.setVisible (browserVisible);
    if (browserVisible)
    {
        browser.setBounds (r.removeFromLeft (browserWidth));
        r.removeFromLeft (3);
    }
    bool showEditor = editorVisible && view != 2;
    editor.setVisible (showEditor);
    if (showEditor)
    {
        auto h = juce::jlimit (140, juce::jmax (140, r.getHeight() - 160), editorHeight);
        editor.setBounds (r.removeFromBottom (h));
        r.removeFromBottom (3);
    }
    centreArea = r;
    arrange.setBounds (r);
    live.setBounds (r);
    mixer.setBounds (r);
    repaint();
}

void MainComponent::mouseMove (const juce::MouseEvent& e)
{
    bool onBrowser = browserVisible && std::abs (e.x - browser.getRight() - 1) <= 3;
    bool onEditor = editor.isVisible() && std::abs (e.y - editor.getY() + 2) <= 3;
    setMouseCursor (onBrowser ? juce::MouseCursor::LeftRightResizeCursor : onEditor ? juce::MouseCursor::UpDownResizeCursor : juce::MouseCursor::NormalCursor);
}

void MainComponent::mouseDown (const juce::MouseEvent& e)
{
    if (browserVisible && std::abs (e.x - browser.getRight() - 1) <= 3) { split = Split::browser; splitStart = browserWidth; }
    else if (editor.isVisible() && std::abs (e.y - editor.getY() + 2) <= 3) { split = Split::editor; splitStart = editorHeight; }
    else split = Split::none;
}

void MainComponent::mouseDrag (const juce::MouseEvent& e)
{
    if (split == Split::browser) { browserWidth = juce::jlimit (180, 520, splitStart + e.getDistanceFromDragStartX()); resized(); }
    if (split == Split::editor) { editorHeight = juce::jlimit (140, juce::jmax (140, getHeight() - 66 - 160), splitStart - e.getDistanceFromDragStartY()); resized(); }
}

void MainComponent::mouseUp (const juce::MouseEvent&)  { split = Split::none; }

//==============================================================================
// Musical Typing: the computer keyboard plays the selected instrument (A = C, W = C#, S = D ...; Z / X octave)
static int typingNote (juce::juce_wchar c)
{
    static const juce::String keys ("awsedftgyhujkolp;'");
    auto i = keys.indexOfChar (juce::CharacterFunctions::toLowerCase (c));
    return i;
}

void MainComponent::setTyping (bool on)
{
    typing = on;
    for (auto n : typingDown)
        if (auto v = session.musicalTyping())
        {
            auto m = juce::MidiMessage::noteOff (1, n);
            m.setTimeStamp (juce::Time::getMillisecondCounterHiRes() * 0.001);
            v->handleIncomingMidiMessage (nullptr, m);
        }
    typingDown.clear();
    if (auto t = session.selectedTrack()) session.routeMidiTo (t);
    repaint();
}

bool MainComponent::keyPressed (const juce::KeyPress& k)
{
    if (! typing || k.getModifiers().isCommandDown() || k.getModifiers().isCtrlDown() || k.getModifiers().isAltDown())
        return false;
    auto c = juce::CharacterFunctions::toLowerCase (k.getTextCharacter());
    if (c == 'z') { typingOctave = juce::jmax (0, typingOctave - 1); return true; }
    if (c == 'x') { typingOctave = juce::jmin (8, typingOctave + 1); return true; }
    if (c == 'c') { typingVelocity = juce::jmax (20, typingVelocity - 20); return true; }
    if (c == 'v') { typingVelocity = juce::jmin (127, typingVelocity + 20); return true; }
    auto i = typingNote (c);
    if (i < 0) return false;
    auto note = juce::jlimit (0, 127, (typingOctave + 1) * 12 + i);
    if (typingDown.count (note)) return true;
    typingDown.insert (note);
    if (auto v = session.musicalTyping())
    {
        auto m = juce::MidiMessage::noteOn (1, note, (juce::uint8) typingVelocity);
        m.setTimeStamp (juce::Time::getMillisecondCounterHiRes() * 0.001);
        v->handleIncomingMidiMessage (nullptr, m);
    }
    return true;
}

bool MainComponent::keyStateChanged (bool)
{
    if (! typing) return false;
    static const juce::String keys ("awsedftgyhujkolp;'");
    std::vector<int> released;
    for (auto n : typingDown)
    {
        int i = n - (typingOctave + 1) * 12;
        bool down = juce::isPositiveAndBelow (i, keys.length()) && juce::KeyPress::isKeyCurrentlyDown ((int) keys[i]);
        // also catch keys pressed in another octave before Z / X
        if (! juce::isPositiveAndBelow (i, keys.length())) down = false;
        if (! down) released.push_back (n);
    }
    for (auto n : released)
    {
        typingDown.erase (n);
        if (auto v = session.musicalTyping())
        {
            auto m = juce::MidiMessage::noteOff (1, n);
            m.setTimeStamp (juce::Time::getMillisecondCounterHiRes() * 0.001);
            v->handleIncomingMidiMessage (nullptr, m);
        }
    }
    return ! released.empty();
}

//==============================================================================
void MainComponent::getAllCommands (juce::Array<juce::CommandID>& c)
{
    c.addArray ({ Cmd::newSong, Cmd::openSong, Cmd::saveSong, Cmd::saveSongAs, Cmd::exportMix, Cmd::exportStems, Cmd::revealSong,
                  Cmd::undo, Cmd::redo, Cmd::deleteSel, Cmd::splitClip, Cmd::duplicateClip, Cmd::selectAll,
                  Cmd::play, Cmd::stop, Cmd::record, Cmd::cycle, Cmd::metronome, Cmd::toStart, Cmd::countIn,
                  Cmd::zoomIn, Cmd::zoomOut, Cmd::zoomFit, Cmd::showArrange, Cmd::showLive, Cmd::showMixer, Cmd::toggleBrowser,
                  Cmd::toggleEditor, Cmd::musicalTyping, Cmd::newAudioTrack, Cmd::newInstrumentTrack, Cmd::settings, Cmd::scanPlugins,
                  Cmd::getSounds, Cmd::openUserFolder, Cmd::about, Cmd::followPlayhead, Cmd::trackHeightUp, Cmd::trackHeightDown,
                  Cmd::quantise, Cmd::demoSong });
}

void MainComponent::getCommandInfo (juce::CommandID id, juce::ApplicationCommandInfo& i)
{
    using KP = juce::KeyPress;
    auto cmd = juce::ModifierKeys::commandModifier, shift = juce::ModifierKeys::shiftModifier, alt = juce::ModifierKeys::altModifier;
    auto single = [&] (int key) { if (! typing) i.addDefaultKeypress (key, 0); };
    if (session.edit == nullptr) session.newSong();
    auto& tp = session.edit->getTransport();
    switch (id)
    {
        case Cmd::newSong:       i.setInfo ("New Song", "Start a new song", "File", 0); i.addDefaultKeypress ('n', cmd); break;
        case Cmd::demoSong:      i.setInfo ("New Demo Song (worship groove)", "A song to start from", "File", 0); break;
        case Cmd::openSong:      i.setInfo ("Open...", "Open a song", "File", 0); i.addDefaultKeypress ('o', cmd); break;
        case Cmd::saveSong:      i.setInfo ("Save", "Save the song", "File", 0); i.addDefaultKeypress ('s', cmd); break;
        case Cmd::saveSongAs:    i.setInfo ("Save As...", "Save the song under a new name", "File", 0); i.addDefaultKeypress ('s', cmd | shift); break;
        case Cmd::exportMix:     i.setInfo ("Bounce Mix...", "Render the song to a WAV, AIFF or FLAC file", "File", 0); i.addDefaultKeypress ('b', cmd); break;
        case Cmd::exportStems:   i.setInfo ("Export Stems...", "Render each track to its own file", "File", 0); i.addDefaultKeypress ('b', cmd | shift); break;
        case Cmd::revealSong:    i.setInfo ("Show Song in Finder", {}, "File", 0); break;
        case Cmd::undo:          i.setInfo ("Undo", {}, "Edit", 0); i.addDefaultKeypress ('z', cmd); i.setActive (session.edit->getUndoManager().canUndo()); break;
        case Cmd::redo:          i.setInfo ("Redo", {}, "Edit", 0); i.addDefaultKeypress ('z', cmd | shift); i.setActive (session.edit->getUndoManager().canRedo()); break;
        case Cmd::deleteSel:     i.setInfo ("Delete", "Delete the selected clips", "Edit", 0); i.addDefaultKeypress (KP::deleteKey, 0); i.addDefaultKeypress (KP::backspaceKey, 0); break;
        case Cmd::splitClip:     i.setInfo ("Split at Playhead", "Split the selected clips at the playhead", "Edit", 0); i.addDefaultKeypress ('t', cmd); i.addDefaultKeypress ('e', cmd); break;
        case Cmd::duplicateClip: i.setInfo ("Duplicate", "Repeat the selected clips after themselves", "Edit", 0); i.addDefaultKeypress ('d', cmd); break;
        case Cmd::selectAll:     i.setInfo ("Select All Clips", {}, "Edit", 0); i.addDefaultKeypress ('a', cmd); break;
        case Cmd::quantise:      i.setInfo ("Quantize Selected MIDI", {}, "Edit", 0); single ('q'); break;
        case Cmd::play:          i.setInfo ("Play / Stop", {}, "Transport", 0); i.addDefaultKeypress (KP::spaceKey, 0); break;
        case Cmd::stop:          i.setInfo ("Stop", {}, "Transport", 0); i.addDefaultKeypress (KP::numberPad0, 0); break;
        case Cmd::record:        i.setInfo ("Record", {}, "Transport", 0); single ('r'); i.addDefaultKeypress ('r', cmd | alt); i.setTicked (tp.isRecording()); break;
        case Cmd::cycle:         i.setInfo ("Cycle", "Loop the cycle range", "Transport", 0); single ('c'); i.setTicked (tp.looping.get()); break;
        case Cmd::metronome:     i.setInfo ("Metronome", {}, "Transport", 0); single ('k'); i.setTicked (session.edit->clickTrackEnabled.get()); break;
        case Cmd::countIn:       i.setInfo ("Count-in", {}, "Transport", 0); i.setTicked (session.edit->getCountInMode() != te::Edit::CountIn::none); break;
        case Cmd::toStart:       i.setInfo ("Go to Start", {}, "Transport", 0); i.addDefaultKeypress (KP::returnKey, 0); i.addDefaultKeypress (KP::homeKey, 0); break;
        case Cmd::zoomIn:        i.setInfo ("Zoom In", {}, "View", 0); i.addDefaultKeypress ('=', cmd); i.addDefaultKeypress (KP::rightKey, cmd); break;
        case Cmd::zoomOut:       i.setInfo ("Zoom Out", {}, "View", 0); i.addDefaultKeypress ('-', cmd); i.addDefaultKeypress (KP::leftKey, cmd); break;
        case Cmd::zoomFit:       i.setInfo ("Zoom to Fit Song", {}, "View", 0); single ('z'); break;
        case Cmd::followPlayhead:i.setInfo ("Follow Playhead", {}, "View", 0); single ('f'); i.setTicked (session.followPlayhead); break;
        case Cmd::trackHeightUp: i.setInfo ("Taller Tracks", {}, "View", 0); i.addDefaultKeypress (KP::downKey, cmd); break;
        case Cmd::trackHeightDown: i.setInfo ("Shorter Tracks", {}, "View", 0); i.addDefaultKeypress (KP::upKey, cmd); break;
        case Cmd::showArrange:   i.setInfo ("Tracks", "The timeline", "View", 0); i.addDefaultKeypress ('1', cmd); i.setTicked (view == 0); break;
        case Cmd::showLive:      i.setInfo ("Live (clip launcher)", "Clips and scenes", "View", 0); i.addDefaultKeypress ('2', cmd); i.setTicked (view == 1); break;
        case Cmd::showMixer:     i.setInfo ("Mixer", {}, "View", 0); i.addDefaultKeypress ('3', cmd); single ('x'); i.setTicked (view == 2); break;
        case Cmd::toggleBrowser: i.setInfo ("Browser", {}, "View", 0); single ('b'); i.setTicked (browserVisible); break;
        case Cmd::toggleEditor:  i.setInfo ("Editor", {}, "View", 0); single ('e'); i.setTicked (editorVisible); break;
        case Cmd::musicalTyping: i.setInfo ("Musical Typing", "Play the selected instrument from the computer keyboard", "View", 0); i.addDefaultKeypress ('k', cmd); i.setTicked (typing); break;
        case Cmd::newAudioTrack: i.setInfo ("New Audio Track", {}, "Track", 0); i.addDefaultKeypress ('a', cmd | alt); break;
        case Cmd::newInstrumentTrack: i.setInfo ("New Instrument Track", {}, "Track", 0); i.addDefaultKeypress ('s', cmd | alt); break;
        case Cmd::settings:      i.setInfo ("Settings...", "Audio, MIDI and plugins", "App", 0); i.addDefaultKeypress (',', cmd); break;
        case Cmd::scanPlugins:   i.setInfo ("Find Plugins (AU / VST3)...", {}, "App", 0); break;
        case Cmd::getSounds:     i.setInfo ("Get Motion Audio Sounds...", "Download the free SoundFont banks", "App", 0); break;
        case Cmd::openUserFolder:i.setInfo ("Open Motion Studio Folder", {}, "App", 0); break;
        case Cmd::about:         i.setInfo ("About Motion Studio", {}, "App", 0); break;
        default: break;
    }
}

bool MainComponent::perform (const InvocationInfo& info)
{
    if (session.edit == nullptr) return false;
    auto& tp = session.edit->getTransport();
    switch (info.commandID)
    {
        case Cmd::newSong:     askToSaveThen ([this] { session.newSong(); }); break;
        case Cmd::demoSong:    askToSaveThen ([this] { makeDemoSong(); }); break;
        case Cmd::openSong:
            askToSaveThen ([this]
            {
                auto fc = std::make_shared<juce::FileChooser> ("Open a song", projectsFolder(), "*.motionstudio;*.tracktionedit");
                fc->launchAsync (juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles, [this, fc] (const juce::FileChooser& c)
                {
                    if (c.getResult().existsAsFile()) openFile (c.getResult());
                });
            });
            break;
        case Cmd::saveSong:
            if (session.isUntitled()) session.saveAs ([this] (bool) { if (onTitleChanged) onTitleChanged(); });
            else { session.save(); if (onTitleChanged) onTitleChanged(); }
            break;
        case Cmd::saveSongAs:  session.saveAs ([this] (bool) { if (onTitleChanged) onTitleChanged(); }); break;
        case Cmd::exportMix:   exportAudio (false); break;
        case Cmd::exportStems: exportAudio (true); break;
        case Cmd::revealSong:  session.file.revealToUser(); break;
        case Cmd::undo:        session.undo(); break;
        case Cmd::redo:        session.redo(); break;
        case Cmd::deleteSel:   session.deleteSelected(); break;
        case Cmd::splitClip:   session.splitSelectedAtPlayhead(); break;
        case Cmd::duplicateClip: session.duplicateSelected(); break;
        case Cmd::selectAll:
            session.selection.deselectAll();
            for (auto t : session.tracks()) for (auto c : t->getClips()) session.selection.addToSelection (c);
            break;
        case Cmd::quantise:    session.quantiseSelected (session.snap ? juce::jmin (session.gridBeats, 1.0) : 0.25); editor.pianoRoll.repaint(); break;
        case Cmd::play:        if (tp.isPlaying()) tp.stop (false, false); else tp.play (false); break;
        case Cmd::stop:        if (! tp.isPlaying()) tp.setPosition (0s); tp.stop (false, false); break;
        case Cmd::record:      if (tp.isRecording()) tp.stop (false, false); else tp.record (false); break;
        case Cmd::cycle:
            if (tp.getLoopRange().getLength() <= 0s)
                tp.setLoopRange ({ 0s, session.edit->tempoSequence.toTime (te::BeatPosition::fromBeats (4 * session.beatsPerBar())) });
            tp.looping = ! tp.looping.get();
            break;
        case Cmd::metronome:   session.edit->clickTrackEnabled = ! session.edit->clickTrackEnabled.get(); break;
        case Cmd::countIn:     session.edit->setCountInMode (session.edit->getCountInMode() == te::Edit::CountIn::none ? te::Edit::CountIn::oneBar : te::Edit::CountIn::none); break;
        case Cmd::toStart:     tp.setPosition (0s); break;
        case Cmd::zoomIn:      arrange.zoom (1.4, session.edit->tempoSequence.toBeats (tp.getPosition()).inBeats()); break;
        case Cmd::zoomOut:     arrange.zoom (1.0 / 1.4, session.edit->tempoSequence.toBeats (tp.getPosition()).inBeats()); break;
        case Cmd::zoomFit:     arrange.zoomToFit(); break;
        case Cmd::followPlayhead: session.followPlayhead = ! session.followPlayhead; break;
        case Cmd::trackHeightUp:  session.trackHeight = juce::jmin (180, session.trackHeight + 16); arrange.layoutAll(); arrange.rebuild(); break;
        case Cmd::trackHeightDown: session.trackHeight = juce::jmax (36, session.trackHeight - 16); arrange.layoutAll(); arrange.rebuild(); break;
        case Cmd::showArrange: showView (0); break;
        case Cmd::showLive:    showView (1); break;
        case Cmd::showMixer:   showView (view == 2 ? 0 : 2); break;
        case Cmd::toggleBrowser: browserVisible = ! browserVisible; resized(); break;
        case Cmd::toggleEditor:  editorVisible = ! editorVisible; resized(); break;
        case Cmd::musicalTyping: setTyping (! typing); commands.commandStatusChanged(); break;
        case Cmd::newAudioTrack: if (auto t = session.addTrack (TrackKind::audio)) session.selectTrack (t.get()); break;
        case Cmd::newInstrumentTrack:
        {
            PluginChoice c; auto inf = findMotionPlugin ("motion:keys");
            c.name = inf->name; c.desc = describeMotionPlugin (*inf); c.isInstrument = true;
            if (auto t = session.addInstrumentTrack (c)) session.selectTrack (t.get());
            break;
        }
        case Cmd::settings:    showSettings (0); break;
        case Cmd::scanPlugins: showSettings (1); break;
        case Cmd::getSounds:
        {
            // open a Motion Keys on the selected track (or a new one) and start its download
            PluginChoice c; auto inf = findMotionPlugin ("motion:keys");
            c.name = inf->name; c.desc = describeMotionPlugin (*inf); c.isInstrument = true;
            auto t = session.addInstrumentTrack (c);
            if (t) if (auto p = trackInstrument (*t)) p->showWindowExplicitly();
            juce::AlertWindow::showMessageBoxAsync (juce::MessageBoxIconType::InfoIcon, "Motion Audio sounds",
                "In the Motion Keys window press \"Get Motion Audio sounds\". The banks (pianos, organs, pads, strings, basses, guitars) download to "
                + soundsFolder().getFullPathName() + " and every Motion Keys can use them.");
            break;
        }
        case Cmd::openUserFolder: userFolder().startAsProcess(); break;
        case Cmd::about:
            juce::AlertWindow::showMessageBoxAsync (juce::MessageBoxIconType::NoIcon, "Motion Studio",
                "Motion Studio " + juce::JUCEApplication::getInstance()->getApplicationVersion() + "\nMotion Audio's own DAW.\n\n"
                "Motion Audio pedals, pedalboards and plugins: the same DSP as the Central Pedal and Central apps.\n"
                "Built on JUCE and Tracktion Engine (GPLv3). Sounds: FreePats (CC0 / CC-BY 3.0).");
            break;
        default: return false;
    }
    commands.commandStatusChanged();
    return true;
}

juce::StringArray MainComponent::getMenuBarNames()
{
    return { "File", "Edit", "Track", "Transport", "View", "Help" };
}

juce::PopupMenu MainComponent::getMenuForIndex (int index, const juce::String&)
{
    juce::PopupMenu m;
    auto add = [&] (int id) { m.addCommandItem (&commands, id); };
    switch (index)
    {
        case 0:
            add (Cmd::newSong); add (Cmd::demoSong); add (Cmd::openSong);
            {
                juce::PopupMenu recent;
                for (auto& f : projectsFolder().findChildFiles (juce::File::findFiles, true, "*.motionstudio"))
                    recent.addItem (f.getFileNameWithoutExtension(), [this, f] { askToSaveThen ([this, f] { openFile (f); }); });
                m.addSubMenu ("Open Song from Projects", recent);
            }
            m.addSeparator(); add (Cmd::saveSong); add (Cmd::saveSongAs);
            m.addSeparator(); add (Cmd::exportMix); add (Cmd::exportStems); add (Cmd::revealSong);
           #if ! JUCE_MAC
            m.addSeparator(); add (Cmd::settings);
            m.addItem ("Quit", [] { juce::JUCEApplication::getInstance()->systemRequestedQuit(); });
           #endif
            break;
        case 1:
            add (Cmd::undo); add (Cmd::redo); m.addSeparator();
            add (Cmd::splitClip); add (Cmd::duplicateClip); add (Cmd::deleteSel); add (Cmd::selectAll); add (Cmd::quantise);
            break;
        case 2:
            add (Cmd::newInstrumentTrack); add (Cmd::newAudioTrack);
            m.addItem ("New Return (effect bus)", [this] { session.addReturnTrack ("Return " + juce::String (session.returnTracks().size() + 1), "motion:fx:room-reverb"); });
            break;
        case 3:
            add (Cmd::play); add (Cmd::stop); add (Cmd::record); add (Cmd::toStart); m.addSeparator();
            add (Cmd::cycle); add (Cmd::metronome); add (Cmd::countIn);
            break;
        case 4:
            add (Cmd::showArrange); add (Cmd::showLive); add (Cmd::showMixer); m.addSeparator();
            add (Cmd::toggleBrowser); add (Cmd::toggleEditor); add (Cmd::musicalTyping); m.addSeparator();
            add (Cmd::zoomIn); add (Cmd::zoomOut); add (Cmd::zoomFit); add (Cmd::followPlayhead); add (Cmd::trackHeightUp); add (Cmd::trackHeightDown);
            break;
        case 5:
            add (Cmd::scanPlugins); add (Cmd::getSounds); add (Cmd::openUserFolder);
           #if ! JUCE_MAC
            add (Cmd::about);
           #endif
            m.addSeparator();
            m.addItem ("Shortcuts", []
            {
                juce::AlertWindow::showMessageBoxAsync (juce::MessageBoxIconType::NoIcon, "Shortcuts",
                    "Space  play / stop        R  record        Return  go to start\n"
                    "C  cycle        K  metronome        Z  zoom to fit        F  follow playhead\n"
                    "Cmd T / Cmd E  split at playhead        Cmd D  duplicate        Delete  delete\n"
                    "Cmd 1  tracks        Cmd 2  live        X  mixer        B  browser        E  editor\n"
                    "Cmd K  musical typing (A W S E D F T G Y H U J K: notes, Z / X octave, C / V velocity)\n"
                    "Cmd + / -  zoom        Cmd scroll  zoom        Shift scroll  scroll sideways\n"
                    "Clips: drag to move, Alt-drag to copy, edges to trim, top corners for fades\n"
                    "Piano roll: click to draw, drag to move, edge to resize, double-click to delete, Q quantize");
            });
            break;
        default: break;
    }
    return m;
}

//==============================================================================
void MainComponent::showSettings (int tab)
{
    auto* tabs = new juce::TabbedComponent (juce::TabbedButtonBar::TabsAtTop);
    tabs->setTabBarDepth (34);
    auto& dm = session.engine.getDeviceManager().deviceManager;
    auto* audio = new juce::AudioDeviceSelectorComponent (dm, 0, 256, 0, 256, true, false, true, false);
    tabs->addTab ("Audio and MIDI", Colours::bg, audio, true);

    auto& pm = session.engine.getPluginManager();
    auto deadMans = userFolder().getChildFile ("plugin-scan-crash.txt");
    auto* plugins = new juce::PluginListComponent (pm.pluginFormatManager, pm.knownPluginList, deadMans, nullptr, true);
    plugins->setOptionsButtonText ("Scan / options");
    tabs->addTab ("Plugins (AU / VST3)", Colours::bg, plugins, true);
    tabs->setCurrentTabIndex (tab);
    tabs->setSize (760, 600);

    juce::DialogWindow::LaunchOptions o;
    o.dialogTitle = "Motion Studio Settings";
    o.dialogBackgroundColour = Colours::bg;
    o.content.setOwned (tabs);
    o.useNativeTitleBar = true;
    o.resizable = true;
    o.componentToCentreAround = this;
    if (auto* w = o.launchAsync())
    {
        struct Closer : public juce::ComponentListener
        {
            Closer (Session& s, Browser& b) : session (s), browser (b) {}
            void componentBeingDeleted (juce::Component&) override
            {
                registerMotionPlugins (session.engine.getPluginManager().knownPluginList);
                session.engine.getDeviceManager().rescanWaveDeviceList();
                browser.rebuild();
                delete this;
            }
            Session& session; Browser& browser;
        };
        w->addComponentListener (new Closer (session, browser));
    }
}

void MainComponent::exportAudio (bool stems)
{
    if (! session.edit) return;
    session.edit->getTransport().stop (false, true);
    auto start = projectsFolder().getChildFile (session.songName() + (stems ? " Stems" : " Mix") + ".wav");
    auto fc = std::make_shared<juce::FileChooser> (stems ? "Export stems to (a folder is made next to this name)" : "Bounce the mix to", start, "*.wav;*.aiff;*.flac");
    fc->launchAsync (juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::warnAboutOverwriting, [this, fc, stems] (const juce::FileChooser& c)
    {
        auto f = c.getResult();
        if (f == juce::File()) return;
        if (! f.hasFileExtension ("wav;aif;aiff;flac")) f = f.withFileExtension ("wav");
        auto& afm = session.engine.getAudioFileFormatManager();
        auto* format = f.hasFileExtension ("flac") ? afm.getFlacFormat() : f.hasFileExtension ("aif;aiff") ? afm.getAiffFormat() : afm.getWavFormat();
        auto length = session.edit->getLength();
        if (length <= 0s) { juce::AlertWindow::showMessageBoxAsync (juce::MessageBoxIconType::InfoIcon, "Bounce", "The song is empty."); return; }

        auto renderOne = [this, format, length] (const juce::File& dest, juce::BigInteger tracks, const juce::String& what)
        {
            te::Renderer::Parameters p (*session.edit);
            p.destFile = dest;
            p.audioFormat = format;
            p.bitDepth = 24;
            p.sampleRateForAudio = juce::jmax (44100.0, session.engine.getDeviceManager().getSampleRate());
            p.blockSizeForAudio = 512;
            p.time = { 0s, te::TimePosition() + length };
            p.endAllowance = 4s;
            p.tracksToDo = tracks;
            p.usePlugins = true;
            p.useMasterPlugins = tracks.countNumberOfSetBits() > 1;
            p.canRenderInMono = false;
            p.checkNodesForAudio = false;
            return te::Renderer::renderToFile ("Bouncing " + what, p);
        };

        if (! stems)
        {
            auto out = renderOne (f, te::toBitSet (te::getAllTracks (*session.edit)), session.songName());
            juce::AlertWindow::showMessageBoxAsync (juce::MessageBoxIconType::InfoIcon, "Bounce", out.existsAsFile() ? "Saved " + out.getFullPathName() : "The bounce didn't work.");
            if (out.existsAsFile()) out.revealToUser();
            return;
        }
        auto folder = f.getParentDirectory().getChildFile (f.getFileNameWithoutExtension());
        folder.createDirectory();
        auto all = te::getAllTracks (*session.edit);
        int done = 0;
        for (auto t : session.tracks())
        {
            juce::BigInteger bits;
            bits.setBit (all.indexOf (t));
            auto dest = folder.getChildFile (juce::File::createLegalFileName (juce::String (done + 1).paddedLeft ('0', 2) + " " + t->getName())).withFileExtension (f.getFileExtension());
            if (renderOne (dest, bits, t->getName()).existsAsFile()) ++done;
        }
        juce::AlertWindow::showMessageBoxAsync (juce::MessageBoxIconType::InfoIcon, "Stems", juce::String (done) + " stems saved in " + folder.getFullPathName());
        folder.revealToUser();
    });
}

void MainComponent::askToSaveThen (std::function<void()> then)
{
    if (! session.hasChanged()) { then(); return; }
    juce::AlertWindow::showYesNoCancelBox (juce::MessageBoxIconType::QuestionIcon, "Save changes?",
        "Save the changes to \"" + session.songName() + "\" first?", "Save", "Don't save", "Cancel", nullptr,
        juce::ModalCallbackFunction::create ([this, then] (int r)
        {
            if (r == 1)
            {
                if (session.isUntitled()) session.saveAs ([then] (bool ok) { if (ok) then(); });
                else { session.save(); then(); }
            }
            else if (r == 2) then();
        }));
}

void MainComponent::openFile (const juce::File& f)
{
    if (! session.open (f))
        juce::AlertWindow::showMessageBoxAsync (juce::MessageBoxIconType::WarningIcon, "Open", session.lastError);
}

juce::String MainComponent::windowTitle() const
{
    return session.songName() + (session.hasChanged() ? "  *" : "") + "  -  Motion Studio";
}

void MainComponent::editChanged()
{
    if (onTitleChanged) onTitleChanged();
    commands.commandStatusChanged();
}

void MainComponent::propertiesChanged()
{
    auto t = windowTitle();
    if (t != lastTitle) { lastTitle = t; if (onTitleChanged) onTitleChanged(); }
}

void MainComponent::timerCallback()
{
    static int ticks = 0;
    auto t = windowTitle();
    if (t != lastTitle) { lastTitle = t; if (onTitleChanged) onTitleChanged(); }
    // autosave a backup every two minutes (next to the song, never over it)
    if (++ticks % 120 == 0 && session.edit && session.hasChanged())
        te::EditFileOperations (*session.edit).saveTempVersion (false);
}

//==============================================================================
void MainComponent::makeDemoSong()
{
    session.newSong (72.0, 7, true);   // G major, 72 BPM
    auto& edit = *session.edit;
    auto& ts = edit.tempoSequence;
    auto bars = 8;
    auto toT = [&] (double beats) { return ts.toTime (te::BeatPosition::fromBeats (beats)); };
    auto tracks = visibleTracks (session);
    te::AudioTrack *keys = nullptr, *pads = nullptr, *drums = nullptr;
    for (auto t : tracks)
    {
        auto n = t->getName();
        if (n.contains ("Keys")) keys = t; else if (n.contains ("Pads")) pads = t; else if (n.contains ("Drums")) drums = t;
    }
    // I - V/7 - vi - IV in G: G, D/F#, Em, C
    const int chords[4][4] = { { 55, 59, 62, 67 }, { 54, 57, 62, 66 }, { 52, 55, 59, 64 }, { 48, 55, 60, 64 } };
    if (pads)
        if (auto c = pads->insertMIDIClip ("Pads", { toT (0), toT (bars * 4.0) }, nullptr))
        {
            c->setColour (pads->getColour());
            for (int b = 0; b < bars; ++b)
                for (int n : chords[b % 4])
                    c->getSequence().addNote (n, te::BeatPosition::fromBeats (b * 4.0), te::BeatDuration::fromBeats (4.0), 80, 0, nullptr);
        }
    if (keys)
        if (auto c = keys->insertMIDIClip ("Keys", { toT (0), toT (bars * 4.0) }, nullptr))
        {
            c->setColour (keys->getColour());
            static const int pattern[8] = { 0, 1, 2, 3, 2, 1, 2, 3 };
            for (int b = 0; b < bars; ++b)
            {
                c->getSequence().addNote (chords[b % 4][0] - 12, te::BeatPosition::fromBeats (b * 4.0), te::BeatDuration::fromBeats (3.9), 90, 0, nullptr);
                for (int e = 0; e < 8; ++e)
                    c->getSequence().addNote (chords[b % 4][pattern[e]] + 12, te::BeatPosition::fromBeats (b * 4.0 + e * 0.5), te::BeatDuration::fromBeats (0.45), e % 2 ? 70 : 90, 0, nullptr);
            }
        }
    if (drums)
        if (auto c = drums->insertMIDIClip ("Groove", { toT (0), toT (bars * 4.0) }, nullptr))
        {
            c->setColour (drums->getColour());
            auto& seq = c->getSequence();
            for (int b = 0; b < bars; ++b)
            {
                double o = b * 4.0;
                seq.addNote (36, te::BeatPosition::fromBeats (o), te::BeatDuration::fromBeats (0.25), 112, 0, nullptr);
                seq.addNote (36, te::BeatPosition::fromBeats (o + 2.5), te::BeatDuration::fromBeats (0.25), 96, 0, nullptr);
                seq.addNote (b % 4 == 3 ? 38 : 37, te::BeatPosition::fromBeats (o + 1), te::BeatDuration::fromBeats (0.25), 100, 0, nullptr);
                seq.addNote (38, te::BeatPosition::fromBeats (o + 3), te::BeatDuration::fromBeats (0.25), 108, 0, nullptr);
                for (int e = 0; e < 8; ++e)
                    seq.addNote (42, te::BeatPosition::fromBeats (o + e * 0.5), te::BeatDuration::fromBeats (0.25), e % 2 ? 60 : 88, 0, nullptr);
                if (b % 4 == 0) seq.addNote (49, te::BeatPosition::fromBeats (o), te::BeatDuration::fromBeats (0.5), 90, 0, nullptr);
            }
        }
    // sends: pads and keys into the reverb
    for (auto t : { keys, pads })
        if (t != nullptr)
            for (auto r : session.returnTracks())
                if (session.returnBusOf (*r) == 0)
                    if (auto s = session.sendFor (*t, 0, true)) s->setGainDb (t == pads ? -12.0f : -9.0f);
    edit.getTransport().setLoopRange ({ toT (0), toT (bars * 4.0) });
    edit.getTransport().looping = true;
    session.notifyStructure();
    arrange.zoomToFit();
    edit.resetChangedStatus();
}

} // namespace ms
