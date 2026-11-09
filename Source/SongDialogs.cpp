#include "SongDialogs.h"
#include "Theme.h"
#include "MotionPlugins.h"

namespace ms
{

static void label (juce::Label& l, const juce::String& text, float size = 13.0f, juce::Colour c = Colours::muted)
{
    l.setText (text, juce::dontSendNotification);
    l.setFont (Fonts::ui (size));
    l.setColour (juce::Label::textColourId, c);
}

static void gold (juce::TextButton& b)
{
    b.setColour (juce::TextButton::buttonColourId, Colours::gold);
    b.setColour (juce::TextButton::textColourOffId, Colours::goldText);
}

static void closeDialog (juce::Component* c)
{
    if (auto dw = c->findParentComponentOfClass<juce::DialogWindow>()) dw->exitModalState (0);
}

static void launch (std::unique_ptr<juce::Component> content, const juce::String& title)
{
    juce::DialogWindow::LaunchOptions o;
    o.content.setOwned (content.release());
    o.dialogTitle = title;
    o.dialogBackgroundColour = Colours::panel;
    o.escapeKeyTriggersCloseButton = true;
    o.useNativeTitleBar = true;
    o.resizable = false;
    o.launchAsync();
}

//==============================================================================
class KeyTempoPanel : public juce::Component
{
public:
    KeyTempoPanel (Session& s, std::function<void (const juce::String&)> d) : session (s), done (std::move (d))
    {
        for (int k = 0; k < 24; ++k)
            key.addItem (song::keyName (k % 12).upToFirstOccurrenceOf ("m", false, false) + (k < 12 ? " major" : " minor"), k + 1);
        key.setSelectedId (session.songKey + 1, juce::dontSendNotification);
        key.onChange = [this] { update(); };
        addAndMakeVisible (key);
        auto bpmNow = session.edit->tempoSequence.getTempo (0)->getBpm();
        bpm.setText (juce::String (bpmNow, std::abs (bpmNow - std::round (bpmNow)) < 0.05 ? 0 : 1), false);
        bpm.setInputRestrictions (6, "0123456789.");
        bpm.onTextChange = [this] { update(); };
        addAndMakeVisible (bpm);
        audio.setToggleState (true, juce::dontSendNotification);
        audio.setColour (juce::ToggleButton::tickColourId, Colours::gold);
        audio.onClick = [this] { update(); };
        addAndMakeVisible (audio);
        label (keyL, "Key"); label (bpmL, "Tempo (BPM)");
        addAndMakeVisible (keyL); addAndMakeVisible (bpmL);
        label (info, {}, 12.5f);
        info.setJustificationType (juce::Justification::topLeft);
        addAndMakeVisible (info);
        gold (apply);
        apply.onClick = [this] { run(); };
        cancel.onClick = [this] { closeDialog (this); };
        addAndMakeVisible (apply); addAndMakeVisible (cancel);
        update();
        setSize (440, 270);
    }

    void update()
    {
        auto newKey = key.getSelectedId() - 1;
        auto semis = song::semitonesBetween (session.songKey, newKey);
        auto oldBpm = session.edit->tempoSequence.getTempo (0)->getBpm(), newBpm = bpm.getText().getDoubleValue();
        juce::StringArray lines;
        lines.add ("Now: " + song::keyName (session.songKey) + ", " + juce::String (oldBpm, 1) + " BPM.");
        if (semis != 0) lines.add ("Everything moves " + juce::String (std::abs (semis)) + (std::abs (semis) == 1 ? " semitone " : " semitones ") + (semis > 0 ? "up" : "down") + "; drums keep their pitch.");
        else if (newKey != session.songKey) lines.add ("Same notes (a relative key): only the key name changes.");
        if (newBpm >= 30 && std::abs (newBpm - oldBpm) > 0.01) lines.add ("Clips, sections and automation stay on their beats" + juce::String (audio.getToggleState() ? "; audio is stretched (hits stay sharp)." : "."));
        if (! audio.getToggleState()) lines.add ("Audio is left as it is (only MIDI and the tempo change).");
        info.setText (lines.joinIntoString ("\n"), juce::dontSendNotification);
        apply.setEnabled (newBpm >= 30 && newBpm <= 300);
    }

    void run()
    {
        auto newKey = key.getSelectedId() - 1;
        auto newBpm = bpm.getText().getDoubleValue();
        auto& s = session;
        auto d = done;
        auto moveAudio = audio.getToggleState();
        closeDialog (this);
        juce::MessageManager::callAsync ([&s, d, newKey, newBpm, moveAudio]
        {
            auto r = song::changeKeyAndTempo (s, newKey, newBpm, moveAudio);
            if (d) d (r.message);
            else juce::AlertWindow::showMessageBoxAsync (juce::MessageBoxIconType::InfoIcon, "Key and tempo", r.message);
        });
    }

    void paint (juce::Graphics& g) override { g.fillAll (Colours::panel); }

    void resized() override
    {
        auto r = getLocalBounds().reduced (16);
        auto row = r.removeFromTop (28);
        keyL.setBounds (row.removeFromLeft (100)); key.setBounds (row.removeFromLeft (180));
        r.removeFromTop (8);
        row = r.removeFromTop (28);
        bpmL.setBounds (row.removeFromLeft (100)); bpm.setBounds (row.removeFromLeft (90));
        r.removeFromTop (8);
        audio.setBounds (r.removeFromTop (26));
        auto buttons = r.removeFromBottom (32);
        apply.setBounds (buttons.removeFromRight (120));
        buttons.removeFromRight (8);
        cancel.setBounds (buttons.removeFromRight (90));
        r.removeFromBottom (6);
        info.setBounds (r);
    }

    Session& session;
    std::function<void (const juce::String&)> done;
    juce::ComboBox key;
    juce::TextEditor bpm;
    juce::ToggleButton audio { "Move the audio too (pitch and tempo)" };
    juce::Label keyL, bpmL, info;
    juce::TextButton apply { "Change it" }, cancel { "Cancel" };
};

void showKeyTempoDialog (Session& s, std::function<void (const juce::String&)> done)
{
    if (s.edit == nullptr) return;
    launch (std::make_unique<KeyTempoPanel> (s, std::move (done)), "Change Key and Tempo");
}

//==============================================================================
class ExportPackPanel : public juce::Component
{
public:
    ExportPackPanel (Session& s) : session (s)
    {
        label (titleL, "Title"); label (artistL, "Artist");
        title.setText (session.songName(), false);
        for (auto* c : { (juce::Component*) &titleL, (juce::Component*) &artistL, (juce::Component*) &title, (juce::Component*) &artist }) addAndMakeVisible (c);
        label (stemsL, "STEMS  (each track goes in the stem you pick; the reverb and delay go in with every stem)", 11.5f, Colours::dim);
        addAndMakeVisible (stemsL);
        for (auto t : session.tracks())
        {
            if (session.kindOf (*t) == TrackKind::ret) continue;
            auto row = std::make_unique<Row>();
            row->id = t->itemID.toString();
            label (row->name, t->getName() + (t->isMuted (false) ? "  (muted: left out)" : ""), 13.0f, Colours::text);
            row->role.addItemList (song::roleNames(), 1);
            row->role.setSelectedId ((int) song::guessRole (session, *t) + 1, juce::dontSendNotification);
            list.addAndMakeVisible (row->name);
            list.addAndMakeVisible (row->role);
            rows.push_back (std::move (row));
        }
        viewport.setViewedComponent (&list, false);
        viewport.setScrollBarsShown (true, false);
        addAndMakeVisible (viewport);
        for (auto* t : { &click, &guide, &markers, &mix, &zip })
        {
            t->setToggleState (true, juce::dontSendNotification);
            t->setColour (juce::ToggleButton::tickColourId, Colours::gold);
            addAndMakeVisible (t);
        }
        auto secs = song::sections (session);
        if (secs.empty())
        {
            guide.setToggleState (false, juce::dontSendNotification);
            markers.setToggleState (false, juce::dontSendNotification);
            guide.setEnabled (false);
            markers.setEnabled (false);
        }
        label (note, secs.empty() ? "Tip: add sections first (right-click the strip above the bar numbers) to get a spoken guide track and the song's sections on the pedal."
                                  : juce::String ((int) secs.size()) + " sections: the guide says each one a bar ahead, and Central Pedal reads them from Markers.mid.", 12.0f);
        note.setJustificationType (juce::Justification::topLeft);
        addAndMakeVisible (note);
        gold (go);
        go.onClick = [this] { run(); };
        close.onClick = [this] { closeDialog (this); };
        reveal.onClick = [this] { if (lastOutput.exists()) lastOutput.revealToUser(); };
        addAndMakeVisible (go); addAndMakeVisible (close); addChildComponent (reveal);
        setSize (620, 600);
    }

    void run()
    {
        song::ExportOptions o;
        o.title = title.getText();
        o.artist = artist.getText();
        o.click = click.getToggleState(); o.guide = guide.getToggleState(); o.markers = markers.getToggleState();
        o.fullMix = mix.getToggleState(); o.zip = zip.getToggleState();
        for (auto& r : rows) o.roles[r->id] = (song::Role) (r->role.getSelectedId() - 1);
        auto start = juce::File::getSpecialLocation (juce::File::userMusicDirectory).getChildFile ("Motion Studio").getChildFile ("Exports");
        start.createDirectory();
        auto fc = std::make_shared<juce::FileChooser> ("Where should the track pack go?", start);
        juce::Component::SafePointer<ExportPackPanel> safe (this);
        fc->launchAsync (juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectDirectories, [safe, fc, o] (const juce::FileChooser& c) mutable
        {
            if (safe == nullptr || c.getResult() == juce::File()) return;
            o.folder = c.getResult();
            auto r = song::exportPack (safe->session, o);
            safe->showResult (r);
        });
    }

    void showResult (const song::ExportResult& r)
    {
        result = r;
        lastOutput = r.output;
        reveal.setVisible (r.ok);
        repaint();
        resized();
    }

    void paint (juce::Graphics& g) override
    {
        g.fillAll (Colours::panel);
        if (resultArea.isEmpty()) return;
        auto a = resultArea.toFloat();
        g.setColour (Colours::bg2);
        g.fillRoundedRectangle (a, 6.0f);
        auto r = resultArea.reduced (12, 10);
        if (! result.ok)
        {
            g.setColour (Colours::live);
            g.setFont (Fonts::semi (14.0f));
            g.drawFittedText (result.message, r, juce::Justification::topLeft, 3);
            return;
        }
        g.setColour (Colours::text);
        g.setFont (Fonts::semi (14.0f));
        g.drawText (result.output.getFileName(), r.removeFromTop (20), juce::Justification::centredLeft, true);
        g.setColour (Colours::muted);
        g.setFont (Fonts::ui (12.0f));
        g.drawText (result.files.joinIntoString (", "), r.removeFromTop (18), juce::Justification::centredLeft, true);
        r.removeFromTop (6);
        // the stars
        auto starRow = r.removeFromTop (24);
        g.setFont (Fonts::heavy (18.0f));
        juce::String stars;
        for (int i = 0; i < 5; ++i) stars << (i < result.grade.stars ? juce::String (juce::CharPointer_UTF8 ("\xe2\x98\x85")) : juce::String (juce::CharPointer_UTF8 ("\xe2\x98\x86")));
        g.setColour (Colours::gold);
        g.drawText (stars, starRow.removeFromLeft (110), juce::Justification::centredLeft);
        g.setColour (Colours::text);
        g.setFont (Fonts::ui (13.0f));
        static const int prices[] = { 0, 5, 10, 15, 20, 30 };
        g.drawText ("Central Tracks estimate: " + juce::String (result.grade.stars) + " stars ($" + juce::String (prices[juce::jlimit (0, 5, result.grade.stars)]) + " a track)",
                    starRow, juce::Justification::centredLeft);
        g.setFont (Fonts::ui (12.0f));
        for (auto& line : result.grade.lines)
        {
            auto ok = line.startsWith ("ok|");
            g.setColour (ok ? Colours::ok : Colours::live);
            g.drawText (juce::String (ok ? juce::CharPointer_UTF8 ("\xe2\x9c\x93") : juce::CharPointer_UTF8 ("\xe2\x9c\x97")) + "  " + line.fromFirstOccurrenceOf ("|", false, false),
                        r.removeFromTop (17), juce::Justification::centredLeft, true);
        }
        auto& l = result.grade.loudness;
        g.setColour (Colours::muted);
        g.drawText ("Loudness " + juce::String (l.integrated, 1) + " LUFS, true peak " + juce::String (l.truePeak, 1) + " dBTP, range " + juce::String (l.range, 1) + " LU",
                    r.removeFromTop (18), juce::Justification::centredLeft, true);
        r.removeFromTop (4);
        g.setColour (Colours::text);
        g.drawFittedText ("Central Pedal Control: Add songs > Track pack, and pick this " + juce::String (result.output.isDirectory() ? "folder." : "zip.")
                          + " To sell it in Central Tracks, upload it on the Motion Audio website.", r, juce::Justification::topLeft, 3);
    }

    void resized() override
    {
        auto r = getLocalBounds().reduced (16);
        auto row = r.removeFromTop (28);
        titleL.setBounds (row.removeFromLeft (60)); title.setBounds (row.removeFromLeft (230));
        row.removeFromLeft (16);
        artistL.setBounds (row.removeFromLeft (56)); artist.setBounds (row);
        r.removeFromTop (12);
        stemsL.setBounds (r.removeFromTop (18));
        auto buttons = r.removeFromBottom (32);
        go.setBounds (buttons.removeFromRight (180));
        buttons.removeFromRight (8);
        close.setBounds (buttons.removeFromRight (90));
        reveal.setBounds (buttons.removeFromLeft (140));
        r.removeFromBottom (8);
        resultArea = result.output == juce::File() && result.message.isEmpty() ? juce::Rectangle<int>() : r.removeFromBottom (210);
        if (! resultArea.isEmpty()) r.removeFromBottom (8);
        note.setBounds (r.removeFromBottom (34));
        auto opts = r.removeFromBottom (52);
        auto o1 = opts.removeFromTop (26), o2 = opts;
        click.setBounds (o1.removeFromLeft (190)); guide.setBounds (o1.removeFromLeft (210)); markers.setBounds (o1);
        mix.setBounds (o2.removeFromLeft (190)); zip.setBounds (o2);
        r.removeFromBottom (6);
        viewport.setBounds (r);
        int y = 0;
        for (auto& rw : rows)
        {
            rw->name.setBounds (4, y, r.getWidth() - 200, 28);
            rw->role.setBounds (r.getWidth() - 186, y + 2, 160, 24);
            y += 30;
        }
        list.setSize (r.getWidth() - 12, juce::jmax (y, 10));
    }

    struct Row { juce::String id; juce::Label name; juce::ComboBox role; };
    Session& session;
    juce::Label titleL, artistL, stemsL, note;
    juce::TextEditor title, artist;
    std::vector<std::unique_ptr<Row>> rows;
    juce::Component list;
    juce::Viewport viewport;
    juce::ToggleButton click { "Click track" }, guide { "Guide (spoken cues)" }, markers { "Sections (Markers.mid)" },
                       mix { "Full mix" }, zip { "Make one .zip" };
    juce::TextButton go { "Export track pack..." }, close { "Close" }, reveal { "Show it" };
    juce::Rectangle<int> resultArea;
    song::ExportResult result;
    juce::File lastOutput;
};

void showExportPackDialog (Session& s)
{
    if (s.edit == nullptr) return;
    launch (std::make_unique<ExportPackPanel> (s), "Export for Central Pedal / Central Tracks");
}

} // namespace ms
