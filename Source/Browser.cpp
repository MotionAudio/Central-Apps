#include "Browser.h"
#include "MotionPlugins.h"

namespace ms
{

namespace
{
    struct Item : public juce::TreeViewItem
    {
        Item (Session& s, const juce::String& n, juce::Colour c = Colours::text) : session (s), name (n), colour (c) {}

        bool mightContainSubItems() override         { return isFolder; }
        int getItemHeight() const override            { return isFolder && getParentItem() != nullptr && getParentItem()->getParentItem() == nullptr ? 26 : 22; }
        bool canBeSelected() const override           { return true; }
        juce::String getUniqueName() const override   { return name; }

        void paintItem (juce::Graphics& g, int w, int h) override
        {
            if (isSelected())
            {
                g.setColour (Colours::gold.withAlpha (0.18f));
                g.fillRoundedRectangle (0, 0, (float) w, (float) h, 3.0f);
            }
            bool top = isFolder && getParentItem() != nullptr && getParentItem()->getParentItem() == nullptr;
            int x = 2;
            if (! isFolder)
            {
                g.setColour (colour);
                g.fillEllipse (4.0f, (float) h * 0.5f - 3.5f, 7.0f, 7.0f);
                x = 16;
            }
            g.setColour (top ? Colours::gold : isFolder ? Colours::text : Colours::text.withAlpha (0.9f));
            g.setFont (top ? Fonts::narrow (12.5f) : isFolder ? Fonts::semi (13.0f) : Fonts::ui (13.0f));
            g.drawText (top ? name.toUpperCase() : name, x, 0, w - x - 4, h, juce::Justification::centredLeft, true);
            if (detail.isNotEmpty())
            {
                g.setColour (Colours::dim);
                g.setFont (Fonts::narrow (11.0f));
                g.drawText (detail, 0, 0, w - 6, h, juce::Justification::centredRight);
            }
        }

        juce::var getDragSourceDescription() override
        {
            if (plugin) return makePluginDrag (*plugin);
            if (file.existsAsFile()) return makeFileDrag (file);
            return {};
        }

        void itemOpennessChanged (bool isNowOpen) override
        {
            if (isNowOpen && folder.isDirectory() && getNumSubItems() == 0) populateFolder();
        }

        void populateFolder()
        {
            auto entries = folder.findChildFiles (juce::File::findFilesAndDirectories | juce::File::ignoreHiddenFiles, false);
            std::sort (entries.begin(), entries.end(), [] (const juce::File& a, const juce::File& b)
            {
                if (a.isDirectory() != b.isDirectory()) return a.isDirectory();
                return a.getFileName().compareNatural (b.getFileName()) < 0;
            });
            int count = 0;
            for (auto& f : entries)
            {
                if (count++ > 400) break;
                if (f.isDirectory())
                {
                    auto* d = new Item (session, f.getFileName());
                    d->isFolder = true; d->folder = f;
                    addSubItem (d);
                }
                else if (f.hasFileExtension ("wav;aif;aiff;flac;ogg;mp3;m4a;caf;mid;midi"))
                {
                    auto* i = new Item (session, f.getFileNameWithoutExtension(), f.hasFileExtension ("mid;midi") ? Colours::info : Colours::ok);
                    i->file = f;
                    i->detail = f.getFileExtension().substring (1).toUpperCase();
                    addSubItem (i);
                }
            }
        }

        void itemClicked (const juce::MouseEvent& e) override
        {
            if (isFolder && ! e.mods.isPopupMenu()) setOpen (! isOpen());
        }

        void itemDoubleClicked (const juce::MouseEvent&) override
        {
            if (isFolder) return;
            auto t = session.selectedTrack();
            if (plugin)
            {
                if (plugin->isInstrument && (t == nullptr || session.kindOf (*t) != TrackKind::instrument))
                {
                    if (auto nt = session.addInstrumentTrack (*plugin)) session.selectTrack (nt.get());
                    return;
                }
                if (t == nullptr) return;
                if (auto p = session.insertPlugin (*t, *plugin)) p->showWindowExplicitly();
                return;
            }
            if (file.existsAsFile())
            {
                auto pos = session.edit ? session.edit->getTransport().getPosition() : te::TimePosition();
                if (t == nullptr || (file.hasFileExtension ("mid;midi") == (session.kindOf (*t) != TrackKind::instrument)))
                {
                    if (file.hasFileExtension ("mid;midi"))
                    {
                        PluginChoice c; auto info = findMotionPlugin ("motion:keys");
                        c.name = info->name; c.desc = describeMotionPlugin (*info); c.isInstrument = true;
                        t = session.addInstrumentTrack (c).get();
                    }
                    else t = session.addTrack (TrackKind::audio, file.getFileNameWithoutExtension()).get();
                }
                if (t == nullptr) return;
                if (file.hasFileExtension ("mid;midi")) session.addMidiFile (*t, file, pos);
                else session.addAudioFile (*t, file, pos);
            }
        }

        Session& session;
        juce::String name, detail;
        juce::Colour colour;
        bool isFolder = false;
        std::optional<PluginChoice> plugin;
        juce::File file, folder;
    };

    Item* folderItem (Session& s, juce::TreeViewItem& parent, const juce::String& name)
    {
        for (int i = 0; i < parent.getNumSubItems(); ++i)
            if (auto it = dynamic_cast<Item*> (parent.getSubItem (i)))
                if (it->isFolder && it->name == name) return it;
        auto* f = new Item (s, name);
        f->isFolder = true;
        parent.addSubItem (f);
        return f;
    }

    void addPlugin (Session& s, juce::TreeViewItem& parent, const PluginChoice& c, juce::Colour col)
    {
        auto* i = new Item (s, c.name, col);
        i->plugin = c;
        parent.addSubItem (i);
    }
}

Browser::Browser (Session& s) : session (s)
{
    search.setTextToShowWhenEmpty ("Search sounds, pedals, plugins...", Colours::dim);
    search.setFont (Fonts::ui (14.0f));
    search.onTextChange = [this] { startTimer (180); };
    addAndMakeVisible (search);
    tree.setRootItemVisible (false);
    tree.setDefaultOpenness (false);
    tree.setIndentSize (14);
    tree.setColour (juce::TreeView::backgroundColourId, Colours::panel);
    addAndMakeVisible (tree);
    scanBtn.setTooltip ("Scan this computer for Audio Units and VST3 plugins");
    scanBtn.onClick = [this] { if (onScanPlugins) onScanPlugins(); };
    addAndMakeVisible (scanBtn);
    rebuild();
}

Browser::~Browser()  { tree.setRootItem (nullptr); }

void Browser::timerCallback()
{
    stopTimer();
    if (search.getText() != lastFilter) rebuild();
}

void Browser::rebuild()
{
    auto filter = search.getText().trim();
    lastFilter = filter;
    auto matches = [&] (const juce::String& n) { return filter.isEmpty() || n.containsIgnoreCase (filter); };
    tree.setRootItem (nullptr);
    root = std::make_unique<Item> (session, "root");
    static_cast<Item*> (root.get())->isFolder = true;
    auto& r = *root;

    auto* instruments = folderItem (session, r, "Instruments");
    auto* pedals = folderItem (session, r, "Motion Pedals");
    auto* boards = folderItem (session, r, "Motion Pedalboards");
    auto* plugins = folderItem (session, r, "Motion Plugins");
    auto* builtin = folderItem (session, r, "Built-in Effects");
    auto* third = folderItem (session, r, "Your Plugins (AU / VST3)");
    auto* sounds = folderItem (session, r, "Sounds and Loops");

    for (auto& p : motionPlugins())
    {
        if (! matches (p.name) && ! matches (p.category)) continue;
        PluginChoice c; c.name = p.name; c.desc = describeMotionPlugin (p); c.isInstrument = p.isInstrument; c.group = "Motion Audio";
        if (p.group == "Instruments") addPlugin (session, *instruments, c, Colours::gold);
        else if (p.group == "Pedals") addPlugin (session, *folderItem (session, *pedals, p.category), c, p.colour);
        else if (p.group == "Boards") addPlugin (session, p.id == "motion:board" ? *boards : *folderItem (session, *boards, p.category), c, Colours::gold);
        else addPlugin (session, *folderItem (session, *plugins, p.category), c, Colours::goldHi);
    }
    for (auto& c : builtInPluginChoices())
    {
        if (! matches (c.name)) continue;
        if (c.isInstrument) addPlugin (session, *instruments, c, Colours::muted);
        else addPlugin (session, *folderItem (session, *builtin, c.sub), c, Colours::muted);
    }
    int ext = 0;
    for (auto& d : session.engine.getPluginManager().knownPluginList.getTypes())
    {
        if (d.pluginFormatName == MotionAudioFormat::formatName || ! matches (d.name + " " + d.manufacturerName)) continue;
        PluginChoice c; c.name = d.name; c.desc = d; c.isInstrument = d.isInstrument; c.group = d.pluginFormatName;
        auto* maker = folderItem (session, *third, d.manufacturerName.isNotEmpty() ? d.manufacturerName : juce::String ("Other"));
        if (d.isInstrument) addPlugin (session, *instruments, c, Colours::info);
        auto* it = new Item (session, d.name, d.isInstrument ? Colours::info : Colours::muted);
        it->plugin = c;
        it->detail = d.pluginFormatName == "AudioUnit" ? "AU" : d.pluginFormatName;
        maker->addSubItem (it);
        ++ext;
    }
    if (ext == 0 && filter.isEmpty())
    {
        auto* hint = new Item (session, "Press \"Find my plugins\" below", Colours::dim);
        third->addSubItem (hint);
    }

    if (filter.isEmpty())
    {
        auto addFolder = [&] (const juce::String& name, const juce::File& f)
        {
            if (! f.isDirectory()) return;
            auto* it = new Item (session, name);
            it->isFolder = true; it->folder = f;
            sounds->addSubItem (it);
        };
        addFolder ("Motion Studio", userFolder());
        addFolder ("Music", juce::File::getSpecialLocation (juce::File::userMusicDirectory));
        addFolder ("Desktop", juce::File::getSpecialLocation (juce::File::userDesktopDirectory));
        addFolder ("Downloads", juce::File::getSpecialLocation (juce::File::userHomeDirectory).getChildFile ("Downloads"));
        addFolder ("Documents", juce::File::getSpecialLocation (juce::File::userDocumentsDirectory));
    }
    else
    {
        // search the Motion Studio folder and Music for matching files (shallow and quick)
        int found = 0;
        for (auto base : { userFolder(), juce::File::getSpecialLocation (juce::File::userMusicDirectory) })
            for (juce::RangedDirectoryIterator it (base, true, "*.wav;*.aif;*.aiff;*.flac;*.mp3;*.ogg;*.mid;*.midi", juce::File::findFiles); it != juce::RangedDirectoryIterator() && found < 200; ++it)
                if (it->getFile().getFileName().containsIgnoreCase (filter))
                {
                    auto f = it->getFile();
                    auto* i = new Item (session, f.getFileNameWithoutExtension(), Colours::ok);
                    i->file = f;
                    sounds->addSubItem (i);
                    ++found;
                }
    }

    tree.setRootItem (root.get());
    knownCount = session.engine.getPluginManager().knownPluginList.getNumTypes();
    if (filter.isNotEmpty())
        for (int i = 0; i < r.getNumSubItems(); ++i)
        {
            auto* sub = r.getSubItem (i);
            sub->setOpen (sub->getNumSubItems() > 0);
            for (int j = 0; j < sub->getNumSubItems(); ++j) sub->getSubItem (j)->setOpen (true);
        }
    else
        instruments->setOpen (true);
}

void Browser::paint (juce::Graphics& g)
{
    g.fillAll (Colours::panel);
    g.setColour (Colours::line);
    g.fillRect (getWidth() - 1, 0, 1, getHeight());
    g.setColour (Colours::gold);
    g.setFont (Fonts::narrow (12.5f));
    g.drawText ("BROWSER", 12, 6, 200, 20, juce::Justification::centredLeft);
}

void Browser::resized()
{
    auto r = getLocalBounds().reduced (8, 6).withTrimmedRight (1);
    r.removeFromTop (22);
    search.setBounds (r.removeFromTop (28));
    r.removeFromTop (6);
    scanBtn.setBounds (r.removeFromBottom (28));
    r.removeFromBottom (6);
    tree.setBounds (r);
}

} // namespace ms
