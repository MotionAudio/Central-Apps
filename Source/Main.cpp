#include "MainComponent.h"
#include "MotionPlugins.h"
#include "Theme.h"
#include "Instruments.h"
#include "VocalTools.h"
#include "Automation.h"

namespace ms
{

int runVocalTests (Session&);
juce::Array<juce::File> makeVocalDemoFiles (const juce::File&);

class MainWindow : public juce::DocumentWindow
{
public:
    MainWindow (Session& s, juce::ApplicationCommandManager& cm)
        : juce::DocumentWindow ("Motion Studio", Colours::bg, juce::DocumentWindow::allButtons)
    {
        setUsingNativeTitleBar (true);
        main = new MainComponent (s, cm);
        setContentOwned (main, false);
        main->onTitleChanged = [this] { setName (main->windowTitle()); };
        setResizable (true, false);
        setResizeLimits (1100, 680, 10000, 10000);
        auto area = juce::Desktop::getInstance().getDisplays().getPrimaryDisplay()->userArea;
        setBounds (area.reduced (juce::jmax (0, (area.getWidth() - 1680) / 2), juce::jmax (0, (area.getHeight() - 1020) / 2)));
       #if ! JUCE_MAC
        setMenuBar (main, 24);
       #endif
        setName (main->windowTitle());
        setVisible (true);
    }

    ~MainWindow() override
    {
       #if JUCE_MAC
        juce::MenuBarModel::setMacMainMenu (nullptr);
       #else
        setMenuBar (nullptr);
       #endif
    }

    void closeButtonPressed() override  { juce::JUCEApplication::getInstance()->systemRequestedQuit(); }
    MainComponent* main = nullptr;
};

} // namespace ms

//==============================================================================
class MotionStudioApp : public juce::JUCEApplication
{
public:
    const juce::String getApplicationName() override       { return "Motion Studio"; }
    const juce::String getApplicationVersion() override    { return JUCE_APPLICATION_VERSION_STRING; }
    bool moreThanOneInstanceAllowed() override             { return false; }

    void initialise (const juce::String& commandLine) override
    {
        using namespace ms;
        laf = std::make_unique<MotionLookAndFeel>();
        juce::LookAndFeel::setDefaultLookAndFeel (laf.get());

        auto ui = std::make_unique<MotionUIBehaviour>();
        uiBehaviour = ui.get();
        engine = std::make_unique<te::Engine> ("Motion Studio", std::move (ui), std::make_unique<MotionEngineBehaviour>());
        auto& pm = engine->getPluginManager();
        pm.pluginFormatManager.addFormat (std::make_unique<MotionAudioFormat>());
        registerMotionPlugins (pm.knownPluginList);

        session = std::make_unique<Session> (*engine);
        uiBehaviour->session = session.get();

        juce::PropertiesFile::Options opts;
        opts.applicationName = "Motion Studio";
        opts.filenameSuffix = ".settings";
        opts.folderName = "Motion Studio";
        opts.osxLibrarySubFolder = "Application Support";
        props.setStorageParameters (opts);

        auto args = juce::StringArray::fromTokens (commandLine, true);
        args.trim();

        // headless checks: --render-demo <file.wav>   (builds the demo song and bounces it, then quits)
        if (args.contains ("--get-sounds"))
        {
            // downloads the Motion Audio starter banks without a window
            SoundBankDownloader d;
            d.startThread();
            juce::String last;
            while (d.isThreadRunning())
            {
                juce::MessageManager::getInstance()->runDispatchLoopUntil (200);
                if (d.getStatus() != last) { last = d.getStatus(); std::cout << last << std::endl; }
            }
            std::cout << d.getStatus() << std::endl;
            for (auto& f : findSoundBanks()) std::cout << "bank: " << f.getFileName() << " " << f.getSize() / 1024 << " KB" << std::endl;
            quit();
            return;
        }

        if (args.contains ("--test-vocal"))
        {
            auto failures = runVocalTests (*session);
            setApplicationReturnValue (failures == 0 ? 0 : 1);
            quit();
            return;
        }

        if (args.contains ("--test-roundtrip"))
        {
            // build the demo, change Motion plugin settings, save, reopen and compare
            juce::ApplicationCommandManager cm;
            {
                MainComponent mc (*session, cm);
                mc.makeDemoSong();
            }
            for (int i = 0; i < 20; ++i) juce::MessageManager::getInstance()->runDispatchLoopUntil (50);
            auto dir = juce::File ("/tmp/ms-roundtrip"); dir.deleteRecursively(); dir.createDirectory();
            auto f = dir.getChildFile ("rt.motionstudio");
            // tweak a pedal board on the guitar track and a pad setting
            juce::String expect;
            for (auto t : session->tracks())
            {
                if (t->getName() == "Guitar")
                {
                    auto d = describeMotionPlugin (*findMotionPlugin ("motion:board:worship-dotted"));
                    session->insertPlugin (*t, d);
                }
                for (auto p : t->pluginList)
                    if (auto ext = dynamic_cast<te::ExternalPlugin*> (p))
                        if (auto inst = ext->getAudioPluginInstance())
                            if (ext->getName() == "Motion Pads")
                                for (auto prm : inst->getParameters())
                                    if (auto rp = dynamic_cast<juce::RangedAudioParameter*> (prm); rp && rp->getParameterID() == "brightness")
                                        rp->setValueNotifyingHost (0.9f);
            }
            for (int i = 0; i < 10; ++i) juce::MessageManager::getInstance()->runDispatchLoopUntil (50);
            auto describe = [this]
            {
                juce::String out;
                for (auto t : session->tracks())
                {
                    out << t->getName() << " [" << t->getClips().size() << " clips]: ";
                    for (auto p : t->pluginList)
                    {
                        out << p->getName();
                        if (auto ext = dynamic_cast<te::ExternalPlugin*> (p))
                            if (auto inst = ext->getAudioPluginInstance())
                            {
                                for (auto prm : inst->getParameters())
                                    if (auto rp = dynamic_cast<juce::RangedAudioParameter*> (prm); rp && rp->getParameterID() == "brightness")
                                        out << "(bright " << juce::String (rp->getValue(), 2) << ")";
                                juce::MemoryBlock mb; inst->getStateInformation (mb);
                                if (auto xml = juce::AudioProcessor::getXmlFromBinary (mb.getData(), (int) mb.getSize()))
                                    if (xml->getNumChildElements() > 0) out << "{" << xml->getNumChildElements() << " pedals}";
                            }
                        out << ", ";
                    }
                    out << "\n";
                }
                return out;
            };
            session->file = f;
            session->edit->editFileRetriever = [f] { return f; };
            bool saved = session->save();
            auto before = describe();
            bool opened = session->open (f);
            for (int i = 0; i < 20; ++i) juce::MessageManager::getInstance()->runDispatchLoopUntil (50);
            auto after = describe();
            std::cout << "saved " << saved << " opened " << opened << "\nBEFORE\n" << before << "AFTER\n" << after
                      << (before == after ? "ROUNDTRIP OK" : "ROUNDTRIP DIFFERS") << std::endl;
            quit();
            return;
        }

        if (args.contains ("--render-demo"))
        {
            auto out = juce::File::getCurrentWorkingDirectory().getChildFile (args[args.indexOf ("--render-demo") + 1].unquoted());
            renderDemo (out);
            quit();
            return;
        }

        // --plugin-shot <plugin id> <file.png>: draws a Motion Audio plugin's editor (checks)
        if (args.contains ("--plugin-shot"))
        {
            auto id = args[args.indexOf ("--plugin-shot") + 1].unquoted();
            auto shot = juce::File::getCurrentWorkingDirectory().getChildFile (args[args.indexOf ("--plugin-shot") + 2].unquoted());
            if (auto p = createMotionPlugin (id))
            {
                p->setRateAndBufferSizeDetails (48000.0, 512);
                p->prepareToPlay (48000.0, 512);
                std::unique_ptr<juce::AudioProcessorEditor> ed (p->createEditorAndMakeActive());
                if (ed != nullptr)
                {
                    juce::MessageManager::getInstance()->runDispatchLoopUntil (300);
                    auto img = ed->createComponentSnapshot (ed->getLocalBounds(), true, 1.0f);
                    juce::FileOutputStream os (shot);
                    if (os.openedOk()) { os.setPosition (0); os.truncate(); juce::PNGImageFormat().writeImageToStream (img, os); }
                    ed.reset();
                }
            }
            quit();
            return;
        }

        window = std::make_unique<MainWindow> (*session, commands);

        // open: a file given on the command line, else the last song, else a demo song to start from
        juce::File toOpen;
        for (auto& a : args) if (a.unquoted().endsWith (".motionstudio")) toOpen = juce::File (a.unquoted());
        if (! toOpen.existsAsFile()) toOpen = juce::File (props.getUserSettings()->getValue ("lastSong"));
        if (args.contains ("--demo")) toOpen = juce::File();
        if (toOpen.existsAsFile() && session->open (toOpen)) {}
        else window->main->makeDemoSong();

        commands.registerAllCommandsForTarget (window->main);
        commands.setFirstCommandTarget (window->main);
        window->addKeyListener (commands.getKeyMappings());
        window->main->addKeyListener (commands.getKeyMappings());
        window->main->setApplicationCommandManagerToWatch (&commands);
       #if JUCE_MAC
        appleMenu.addCommandItem (&commands, ms::Cmd::about);
        appleMenu.addSeparator();
        appleMenu.addCommandItem (&commands, ms::Cmd::settings);
        juce::MenuBarModel::setMacMainMenu (window->main, &appleMenu);
       #endif

        if (args.contains ("--vocal-demo") || args.contains ("--tune") || args.contains ("--takes") || args.contains ("--auto"))
            addVocalDemo (args);

        if (args.contains ("--screenshot"))
        {
            auto shot = juce::File::getCurrentWorkingDirectory().getChildFile (args[args.indexOf ("--screenshot") + 1].unquoted());
            int viewIndex = args.contains ("--mixer") ? 2 : args.contains ("--live") ? 1 : 0;
            juce::Timer::callAfterDelay (args.contains ("--tune") || args.contains ("--takes") ? 6000 : 1500, [this, shot, viewIndex]
            {
                window->main->showView (viewIndex);
                if (viewIndex == 0) window->main->resized();
                juce::Timer::callAfterDelay (1200, [this, shot]
                {
                    auto img = window->getContentComponent()->createComponentSnapshot (window->getContentComponent()->getLocalBounds(), true, 1.0f);
                    juce::FileOutputStream os (shot);
                    if (os.openedOk()) { os.setPosition (0); os.truncate(); juce::PNGImageFormat().writeImageToStream (img, os); }
                    quit();
                });
            });
        }
    }

    /** Adds a sung lead vocal (three takes) to the demo, with automation and a sidechain to show off. */
    void addVocalDemo (const juce::StringArray& args)
    {
        using namespace ms;
        auto files = makeVocalDemoFiles (projectsFolder().getChildFile ("Recordings").getChildFile ("Demo vocal"));
        auto& ts = session->edit->tempoSequence;
        auto at = ts.toTime (te::BeatPosition::fromBeats (8.0));
        te::AudioTrack* vocal = nullptr;
        for (auto t : session->tracks()) if (t->getName() == "Vocal") vocal = t;
        if (vocal == nullptr) vocal = session->addTrack (TrackKind::audio, "Vocal").get();
        auto clip = session->addAudioFile (*vocal, files[0], at);
        auto wc = dynamic_cast<te::WaveAudioClip*> (clip.get());
        if (wc == nullptr) return;
        wc->setName ("Lead Vocal");
        for (auto& f : files) takes::addTake (*wc, f);
        // automation and a sidechain on the pads
        for (auto t : session->tracks())
            if (t->getName().contains ("Pads"))
            {
                auto& c = t->getVolumePlugin()->volParam->getCurve();
                c.addPoint (ts.toTime (te::BeatPosition::fromBeats (0)), te::decibelsToVolumeFaderPosition (-14.0f), 0.0f, nullptr);
                c.addPoint (ts.toTime (te::BeatPosition::fromBeats (8)), te::decibelsToVolumeFaderPosition (-3.0f), 0.0f, nullptr);
                c.addPoint (ts.toTime (te::BeatPosition::fromBeats (24)), te::decibelsToVolumeFaderPosition (-1.0f), 0.0f, nullptr);
                c.addPoint (ts.toTime (te::BeatPosition::fromBeats (30)), te::decibelsToVolumeFaderPosition (-18.0f), 0.0f, nullptr);
                automation::setShown (*t, true);
                if (auto d = session->insertPlugin (*t, describeMotionPlugin (*findMotionPlugin ("motion:ducker"))))
                    for (auto& nm : d->getSidechainSourceNames (false))
                        if (nm.contains ("Drums")) { d->setSidechainSourceByName (nm); if (d->getNumWires() == 0) d->guessSidechainRouting(); }
            }
        session->selection.selectOnly (wc);
        auto& ed = window->main->getEditor();
        juce::Component::SafePointer<MainWindow> w (window.get());
        te::WaveAudioClip::Ptr keep (wc);
        if (args.contains ("--tune"))
            juce::Timer::callAfterDelay (800, [w, keep] { if (w) { w->main->getEditor().showTune (keep.get()); w->main->getEditor().tuneNow(); } });
        else if (args.contains ("--takes"))
            juce::Timer::callAfterDelay (800, [w, keep] { if (w) { w->main->getEditor().showTakes (keep.get()); w->main->getEditor().autoCompNow(); } });
        else ed.showClip (wc);
    }

    void renderDemo (const juce::File& out)
    {
        using namespace ms;
        // the demo song without a window
        juce::ApplicationCommandManager cm;
        MainComponent mc (*session, cm);
        mc.makeDemoSong();
        auto& edit = *session->edit;
        // let the plugins finish loading
        for (int i = 0; i < 40; ++i) juce::MessageManager::getInstance()->runDispatchLoopUntil (50);
        te::Renderer::Parameters p (edit);
        p.destFile = out;
        p.audioFormat = engine->getAudioFileFormatManager().getWavFormat();
        p.bitDepth = 24;
        p.sampleRateForAudio = 48000.0;
        p.blockSizeForAudio = 512;
        p.time = { 0s, te::TimePosition() + edit.getLength() };
        p.endAllowance = 3s;
        p.useMasterPlugins = true;
        p.tracksToDo = te::toBitSet (te::getAllTracks (edit));
        p.canRenderInMono = false;
        p.checkNodesForAudio = false;
        std::cout << "edit length " << edit.getLength().inSeconds() << " s" << std::endl;
        auto f = te::Renderer::renderToFile ("Demo", p);
        std::cout << "rendered: " << f.getFullPathName() << " size " << f.getSize() << std::endl;
        if (juce::SystemStats::getEnvironmentVariable ("MS_STEMS", {}).isNotEmpty())
        {
            auto all = te::getAllTracks (edit);
            for (auto t : session->tracks())
            {
                auto q = p;
                juce::Array<te::Track*> one; one.add (t);
                q.tracksToDo = te::toBitSet (one);
                q.useMasterPlugins = false;
                q.destFile = out.getSiblingFile (out.getFileNameWithoutExtension() + "-" + t->getName().removeCharacters (" ") + ".wav");
                auto sf = te::Renderer::renderToFile ("Stem", q);
                std::cout << "stem: " << sf.getFullPathName() << std::endl;
            }
        }
        for (auto t : session->tracks())
        {
            juce::String chain;
            for (auto pl : t->pluginList) chain << pl->getName() << (pl->isEnabled() ? "" : " (off)") << ", ";
            std::cout << "track " << t->getName() << ": " << chain << std::endl;
        }
    }

    void shutdown() override
    {
        if (session && session->edit && ! session->isUntitled())
            props.getUserSettings()->setValue ("lastSong", session->file.getFullPathName());
        props.saveIfNeeded();
        window.reset();
        session.reset();
        engine.reset();
        juce::LookAndFeel::setDefaultLookAndFeel (nullptr);
        laf.reset();
    }

    void systemRequestedQuit() override
    {
        if (window == nullptr || window->main == nullptr) { quit(); return; }
        window->main->askToSaveThen ([] { juce::JUCEApplication::getInstance()->quit(); });
    }

    void anotherInstanceStarted (const juce::String& commandLine) override
    {
        if (window == nullptr) return;
        for (auto& a : juce::StringArray::fromTokens (commandLine, true))
            if (a.unquoted().endsWith (".motionstudio"))
            {
                juce::File f (a.unquoted());
                window->main->askToSaveThen ([this, f] { window->main->openFile (f); });
            }
    }

private:
    std::unique_ptr<juce::LookAndFeel> laf;
    std::unique_ptr<te::Engine> engine;
    ms::MotionUIBehaviour* uiBehaviour = nullptr;
    std::unique_ptr<ms::Session> session;
    std::unique_ptr<ms::MainWindow> window;
    juce::ApplicationCommandManager commands;
    juce::ApplicationProperties props;
    juce::PopupMenu appleMenu;
};

START_JUCE_APPLICATION (MotionStudioApp)
