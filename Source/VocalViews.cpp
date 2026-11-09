#include "VocalViews.h"

namespace ms
{

static void styleSmallSlider (juce::Slider& s)
{
    s.setSliderStyle (juce::Slider::LinearHorizontal);
    s.setTextBoxStyle (juce::Slider::NoTextBox, false, 0, 0);
    s.setColour (juce::Slider::trackColourId, Colours::gold);
    s.setColour (juce::Slider::backgroundColourId, Colours::bg2);
    s.setColour (juce::Slider::thumbColourId, Colours::goldHi);
}

static void styleLabel (juce::Label& l, float size = 12.5f, juce::Colour c = Colours::muted)
{
    l.setFont (Fonts::ui (size));
    l.setColour (juce::Label::textColourId, c);
}

static void goldButton (juce::TextButton& b)
{
    b.setColour (juce::TextButton::buttonColourId, Colours::gold);
    b.setColour (juce::TextButton::textColourOffId, Colours::goldText);
}

static juce::String keyName (Session& s)
{
    static const char* names[] = { "C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B" };
    return juce::String (names[s.keyRoot()]) + (s.keyIsMinor() ? " minor" : " major");
}

//==============================================================================
// Auto Time
//==============================================================================
AutoTimePanel::AutoTimePanel (Session& s, juce::Array<te::Clip*> c) : session (s)
{
    for (auto* x : c)
    {
        clips.add (x);
        if (dynamic_cast<te::WaveAudioClip*> (x) != nullptr) anyAudio = true;
    }
    instrument.addItemList (autotime::instrumentNames(), 1);
    auto guess = clips.isEmpty() ? autotime::Instrument::other : autotime::guessInstrument (clips.getFirst()->getTrack());
    instrument.setSelectedId ((int) guess + 1, juce::dontSendNotification);
    instrument.onChange = [this] { instrumentChanged(); };
    addAndMakeVisible (instrument);

    grid.addItem ("Work it out from the playing", 1);
    grid.addItem ("1/4", 2); grid.addItem ("1/8", 3); grid.addItem ("1/16", 4);
    grid.addItem ("1/8 triplet", 5); grid.addItem ("1/16 triplet", 6);
    grid.setSelectedId (1, juce::dontSendNotification);
    addAndMakeVisible (grid);

    strength.setRange (0.0, 100.0, 1.0);
    strength.setSliderStyle (juce::Slider::LinearHorizontal);
    strength.setTextBoxStyle (juce::Slider::TextBoxRight, false, 52, 22);
    strength.setTextValueSuffix ("%");
    strength.setColour (juce::Slider::trackColourId, Colours::gold);
    addAndMakeVisible (strength);

    matchTempo.setToggleState (true, juce::dontSendNotification);
    matchTempo.setColour (juce::ToggleButton::tickColourId, Colours::gold);
    matchTempo.setVisible (anyAudio);
    addChildComponent (matchTempo);

    goldButton (go);
    go.onClick = [this] { run(); };
    addAndMakeVisible (go);
    styleLabel (info, 12.5f);
    info.setJustificationType (juce::Justification::topLeft);
    addAndMakeVisible (info);
    instrumentChanged();
    setSize (420, anyAudio ? 292 : 262);
}

void AutoTimePanel::instrumentChanged()
{
    static const int defaults[] = { 100, 90, 80, 85, 65, 60, 80 };
    static const char* notes[] = {
        "Drums: every hit goes right on the grid. The hits themselves aren't stretched, so they stay punchy.",
        "Bass: tight to the grid; note ends follow a little too.",
        "Keys: chords and rolls move together, so a spread chord stays spread.",
        "Guitar: strums move together from their first string.",
        "Vocals: words move toward the beat but keep some of your phrasing. Only words that are close to a beat move.",
        "Strings and pads: gentle, and notes are held to the next grid line (legato).",
        "Lines everything up with the grid." };
    auto i = juce::jlimit (0, 6, instrument.getSelectedId() - 1);
    strength.setValue (defaults[i], juce::dontSendNotification);
    info.setText (notes[i], juce::dontSendNotification);
}

void AutoTimePanel::paint (juce::Graphics& g)
{
    g.setColour (Colours::text);
    g.setFont (Fonts::heavy (16.0f));
    g.drawText ("Auto Time", 14, 10, getWidth() - 28, 22, juce::Justification::centredLeft);
    g.setColour (Colours::muted);
    g.setFont (Fonts::ui (12.5f));
    g.drawText (juce::String (clips.size()) + (clips.size() == 1 ? " clip" : " clips") + " to the metronome", 14, 10, getWidth() - 28, 22, juce::Justification::centredRight);
    g.setFont (Fonts::semi (12.5f));
    g.setColour (Colours::muted);
    g.drawText ("Instrument", 14, 44, 90, 26, juce::Justification::centredLeft);
    g.drawText ("Grid", 14, 78, 90, 26, juce::Justification::centredLeft);
    g.drawText ("Strength", 14, 112, 90, 26, juce::Justification::centredLeft);
}

void AutoTimePanel::resized()
{
    instrument.setBounds (110, 44, getWidth() - 124, 26);
    grid.setBounds (110, 78, getWidth() - 124, 26);
    strength.setBounds (104, 112, getWidth() - 114, 26);
    int y = 146;
    info.setBounds (12, y, getWidth() - 24, 54);
    y += 58;
    if (anyAudio) { matchTempo.setBounds (10, y, getWidth() - 20, 26); y += 30; }
    go.setBounds (getWidth() - 134, getHeight() - 42, 120, 30);
}

void AutoTimePanel::run()
{
    autotime::Options o;
    o.instrument = (autotime::Instrument) juce::jlimit (0, 6, instrument.getSelectedId() - 1);
    static const double grids[] = { 0, 1.0, 0.5, 0.25, 1.0 / 3.0, 1.0 / 6.0 };
    o.gridBeats = grids[juce::jlimit (0, 5, grid.getSelectedId() - 1)];
    o.strength = (float) strength.getValue() / 100.0f;
    o.matchTempo = matchTempo.getToggleState();
    auto list = clips;
    auto* s = &session;
    auto done = onDone;
    if (auto box = findParentComponentOfClass<juce::CallOutBox>()) box->dismiss();
    juce::MessageManager::callAsync ([s, list, o, done]
    {
        juce::StringArray messages;
        for (auto c : list)
        {
            auto r = autotime::apply (*s, *c, o);
            messages.add ((list.size() > 1 ? c->getName() + ": " : juce::String()) + r.message);
        }
        s->notifyStructure();
        auto text = messages.joinIntoString ("\n");
        if (done) done (text);
        else juce::AlertWindow::showMessageBoxAsync (juce::MessageBoxIconType::InfoIcon, "Auto Time", text);
    });
}

void AutoTimePanel::show (Session& s, juce::Component& anchor, std::function<void (const juce::String&)> onDone)
{
    juce::Array<te::Clip*> clips;
    for (auto c : s.selectedClips())
        if (dynamic_cast<te::MidiClip*> (c) != nullptr || dynamic_cast<te::WaveAudioClip*> (c) != nullptr) clips.add (c);
    if (clips.isEmpty())
    {
        juce::AlertWindow::showMessageBoxAsync (juce::MessageBoxIconType::InfoIcon, "Auto Time",
                                                "Select the audio or MIDI clips to put in time (click a clip on the timeline), then press Auto Time.");
        return;
    }
    auto panel = std::make_unique<AutoTimePanel> (s, clips);
    panel->onDone = std::move (onDone);
    juce::CallOutBox::launchAsynchronously (std::move (panel), anchor.getScreenBounds(), nullptr);
}

//==============================================================================
// Tune
//==============================================================================
TuneView::TuneView (Session& s) : session (s)
{
    goldButton (tuneBtn);
    tuneBtn.setTooltip ("Find every note and tune it to the song's key");
    tuneBtn.onClick = [this] { tuneNow(); };
    addAndMakeVisible (tuneBtn);
    originalBtn.setTooltip ("Go back to the audio as it was recorded");
    originalBtn.onClick = [this]
    {
        if (! clip) return;
        ++generation;
        clipaudio::restoreOriginal (*clip);
        hasData = false;
        data = {};
        status.setText ("Back to the original recording.", juce::dontSendNotification);
        updateLabels();
        repaint();
    };
    addAndMakeVisible (originalBtn);
    for (auto* sl : { &tight, &glide }) { styleSmallSlider (*sl); addAndMakeVisible (sl); }
    tight.setRange (0.0, 1.0, 0.01);
    tight.setValue (0.6, juce::dontSendNotification);
    tight.setTooltip ("Natural (keeps vibrato and slides) to hard (flat, robotic)");
    glide.setRange (5.0, 250.0, 1.0);
    glide.setSkewFactorFromMidPoint (60.0);
    glide.setValue (60.0, juce::dontSendNotification);
    glide.setTooltip ("How quickly it moves from note to note");
    tight.onDragEnd = glide.onDragEnd = [this]
    {
        data.tightness = (float) tight.getValue();
        data.glideMs = (float) glide.getValue();
        if (hasData) scheduleRender (50);
    };
    tightLabel.setText ("Natural  -  Hard", juce::dontSendNotification);
    glideLabel.setText ("Glide", juce::dontSendNotification);
    for (auto* l : { &tightLabel, &glideLabel, &keyLabel, &status }) { styleLabel (*l); addAndMakeVisible (l); }
    status.setJustificationType (juce::Justification::centredRight);
    keyLabel.setColour (juce::Label::textColourId, Colours::goldHi);
    startTimerHz (20);
}

TuneView::~TuneView()
{
    ++generation;
    pool.removeAllJobs (true, 10000);
}

void TuneView::setClip (te::WaveAudioClip* c)
{
    if (c == clip.get()) { updateLabels(); return; }
    clip = c;
    ++generation;
    selected = hover = dragging = -1;
    data = {};
    hasData = clip != nullptr && tune::load (*clip, data);
    if (hasData)
    {
        tight.setValue (data.tightness, juce::dontSendNotification);
        glide.setValue (data.glideMs, juce::dontSendNotification);
        findPitchInBackground();
    }
    status.setText ({}, juce::dontSendNotification);
    fitRange();
    updateLabels();
    repaint();
}

void TuneView::updateLabels()
{
    keyLabel.setText (hasData ? "Tuned to " + vocal::noteName (data.key + 60).dropLastCharacters (1) + (data.scale == vocal::Scale::minor ? " minor" : " major")
                              : "Song key: " + keyName (session), juce::dontSendNotification);
    tuneBtn.setEnabled (clip != nullptr);
    originalBtn.setEnabled (clip != nullptr && clipaudio::hasProcessing (*clip));
    tuneBtn.setButtonText (hasData ? "Tune again" : "Tune");
}

void TuneView::fitRange()
{
    if (! clip) return;
    viewStart = clip->getPosition().getOffset().inSeconds();
    viewLength = juce::jmax (0.5, clip->getPosition().getLength().inSeconds());
    if (hasData && ! data.notes.empty())
    {
        float lo = 127, hi = 0;
        for (auto& n : data.notes) { lo = juce::jmin (lo, juce::jmin (n.pitch, (float) n.target)); hi = juce::jmax (hi, juce::jmax (n.pitch, (float) n.target)); }
        lowNote = (int) std::floor (lo) - 3;
        highNote = (int) std::ceil (hi) + 3;
        while (highNote - lowNote < 14) { --lowNote; ++highNote; }
    }
    else { lowNote = 48; highNote = 72; }
}

juce::Rectangle<int> TuneView::grid() const       { return getLocalBounds().withTrimmedTop (toolbarH).withTrimmedLeft (keysW); }
float TuneView::timeToX (double t) const          { auto g = grid(); return (float) (g.getX() + (t - viewStart) / viewLength * g.getWidth()); }
double TuneView::xToTime (float x) const          { auto g = grid(); return viewStart + (x - g.getX()) / juce::jmax (1, g.getWidth()) * viewLength; }
float TuneView::noteToY (float midi) const
{
    auto g = grid();
    auto rows = (float) (highNote - lowNote + 1);
    return g.getY() + (float) g.getHeight() * ((float) highNote + 0.5f - midi) / rows;
}
int TuneView::yToNote (float y) const
{
    auto g = grid();
    auto rows = (float) (highNote - lowNote + 1);
    return juce::jlimit (0, 127, (int) std::floor ((float) highNote + 1.0f - (y - g.getY()) / (float) g.getHeight() * rows));
}

int TuneView::noteAt (juce::Point<int> p) const
{
    if (! hasData) return -1;
    auto rowH = (float) grid().getHeight() / (float) (highNote - lowNote + 1);
    for (int i = (int) data.notes.size(); --i >= 0;)
    {
        auto& n = data.notes[(size_t) i];
        auto x1 = timeToX (n.start), x2 = timeToX (n.end);
        if (p.x < x1 || p.x > x2) continue;
        auto yt = noteToY ((float) n.target), ys = noteToY (n.pitch);
        if (std::abs (p.y - yt) <= rowH * 0.6f || std::abs (p.y - ys) <= rowH * 0.5f) return i;
    }
    return -1;
}

void TuneView::paint (juce::Graphics& g)
{
    g.fillAll (Colours::bg);
    auto bar = getLocalBounds().removeFromTop (toolbarH);
    g.setColour (Colours::panel);
    g.fillRect (bar);
    g.setColour (Colours::line);
    g.fillRect (0, toolbarH - 1, getWidth(), 1);

    if (! clip)
    {
        g.setColour (Colours::muted);
        g.setFont (Fonts::ui (15.0f));
        g.drawText ("Select an audio clip (a vocal) on the timeline, then press Tune.", getLocalBounds().withTrimmedTop (toolbarH), juce::Justification::centred);
        return;
    }
    auto gr = grid();
    auto rows = highNote - lowNote + 1;
    auto rowH = (float) gr.getHeight() / (float) rows;
    int key = hasData ? data.key : session.keyRoot();
    auto scale = hasData ? data.scale : (session.keyIsMinor() ? vocal::Scale::minor : vocal::Scale::major);
    for (int m = lowNote; m <= highNote; ++m)
    {
        auto y = noteToY ((float) m) - rowH * 0.5f;
        bool in = vocal::inScale (m, key, scale);
        g.setColour (in ? Colours::panel : Colours::bg2);
        g.fillRect ((float) gr.getX(), y, (float) gr.getWidth(), rowH);
        g.setColour (Colours::line.withAlpha (0.6f));
        g.fillRect ((float) gr.getX(), y + rowH - 1, (float) gr.getWidth(), 1.0f);
        // keys
        auto k = juce::Rectangle<float> (0, y, (float) keysW - 2, rowH);
        bool black = juce::MidiMessage::isMidiNoteBlack (m);
        g.setColour (black ? juce::Colour (0xff1a1a1d) : juce::Colour (0xffd8d2c4));
        g.fillRect (k.reduced (0, 0.5f));
        if (rowH >= 11 || m % 12 == key)
        {
            g.setColour (black ? Colours::muted : Colours::goldText);
            g.setFont (Fonts::narrow (juce::jmin (11.0f, rowH - 1)));
            g.drawText (vocal::noteName (m), k.reduced (4, 0), juce::Justification::centredRight);
        }
    }
    // bars and beats along the top
    if (session.edit)
    {
        auto& ts = session.edit->tempoSequence;
        auto clipStart = clip->getPosition().getStart().inSeconds(), offset = clip->getPosition().getOffset().inSeconds();
        auto b0 = std::floor (ts.toBeats (te::TimePosition::fromSeconds (juce::jmax (0.0, clipStart + viewStart - offset))).inBeats());
        auto b1 = ts.toBeats (te::TimePosition::fromSeconds (clipStart + viewStart + viewLength - offset)).inBeats();
        auto bpb = session.beatsPerBar();
        for (auto b = b0; b <= b1; b += 1.0)
        {
            auto t = ts.toTime (te::BeatPosition::fromBeats (b)).inSeconds() - clipStart + offset;
            auto x = timeToX (t);
            bool barLine = std::fmod (b, bpb) < 1e-6;
            g.setColour (barLine ? Colours::line2 : Colours::line.withAlpha (0.5f));
            g.fillRect (x, (float) gr.getY(), 1.0f, (float) gr.getHeight());
            if (barLine)
            {
                g.setColour (Colours::dim);
                g.setFont (Fonts::narrow (11.0f));
                g.drawText (juce::String ((int) (b / bpb) + 1), juce::Rectangle<float> (x + 3, (float) gr.getY() + 1, 30, 12), juce::Justification::centredLeft);
            }
        }
    }

    if (! hasData)
    {
        g.setColour (Colours::text);
        g.setFont (Fonts::semi (16.0f));
        g.drawText ("Press Tune: every note gets marked and tuned to " + keyName (session) + ".", gr.withTrimmedBottom (gr.getHeight() / 2 - 10), juce::Justification::centredBottom);
        g.setColour (Colours::muted);
        g.setFont (Fonts::ui (13.5f));
        g.drawText ("Then drag a note up or down, or right-click it and \"Make it\" the note you want.", gr.withTrimmedTop (gr.getHeight() / 2 + 6), juce::Justification::centredTop);
        return;
    }

    g.saveState();
    g.reduceClipRegion (gr);
    // the notes: where they were sung (thin) and where they're going (gold)
    for (int i = 0; i < (int) data.notes.size(); ++i)
    {
        auto& n = data.notes[(size_t) i];
        auto x1 = timeToX (n.start), x2 = timeToX (n.end);
        if (x2 < gr.getX() || x1 > gr.getRight()) continue;
        auto ys = noteToY (n.pitch), yt = noteToY ((float) n.target);
        bool sel = i == selected, hov = i == hover;
        g.setColour (Colours::text.withAlpha (0.35f));
        g.fillRoundedRectangle (x1, ys - 2.0f, x2 - x1, 4.0f, 2.0f);
        auto box = juce::Rectangle<float> (x1, yt - rowH * 0.5f + 1, juce::jmax (3.0f, x2 - x1), rowH - 2);
        if (n.tune)
        {
            if (std::abs (ys - yt) > 2.0f)
            {
                g.setColour (Colours::gold.withAlpha (0.5f));
                auto cx = juce::jmin (x1 + 8.0f, (x1 + x2) * 0.5f);
                g.drawArrow ({ cx, ys, cx, yt + (yt > ys ? -rowH * 0.5f : rowH * 0.5f) }, 1.2f, 6.0f, 6.0f);
            }
            g.setColour ((n.userSet ? Colours::goldHi : Colours::gold).withAlpha (sel || hov ? 1.0f : 0.85f));
            g.fillRoundedRectangle (box, 3.0f);
            if (box.getWidth() > 26 && rowH >= 10)
            {
                g.setColour (Colours::goldText);
                g.setFont (Fonts::semi (juce::jmin (12.0f, rowH - 1)));
                g.drawText (vocal::noteName (n.target), box.reduced (4, 0), juce::Justification::centredLeft);
            }
        }
        else
        {
            box = box.withY (ys - rowH * 0.5f + 1);
            g.setColour (Colours::muted);
            g.drawRoundedRectangle (box, 3.0f, 1.2f);
            if (box.getWidth() > 50)
            {
                g.setFont (Fonts::ui (11.0f));
                g.drawText ("as sung", box.reduced (4, 0), juce::Justification::centredLeft);
            }
        }
        if (sel)
        {
            g.setColour (Colours::text);
            g.drawRoundedRectangle (box.expanded (1.5f), 4.0f, 1.2f);
        }
    }
    // the pitch that was sung
    if (data.pitch.frames() > 0)
    {
        juce::Path p;
        bool open = false;
        for (int f = 0; f < data.pitch.frames(); ++f)
        {
            auto t = data.pitch.frameTime (f);
            if (t < viewStart - 0.1 || t > viewStart + viewLength + 0.1) { open = false; continue; }
            auto m = data.pitch.midiAt (f);
            if (m <= 0 || data.pitch.confidence[(size_t) f] < 0.45f) { open = false; continue; }
            auto x = timeToX (t), y = noteToY (m);
            if (! open) { p.startNewSubPath (x, y); open = true; }
            else p.lineTo (x, y);
        }
        g.setColour (Colours::text.withAlpha (0.55f));
        g.strokePath (p, juce::PathStrokeType (1.1f));
    }
    // playhead
    if (session.edit)
    {
        auto pos = session.edit->getTransport().getPosition().inSeconds() - clip->getPosition().getStart().inSeconds() + clip->getPosition().getOffset().inSeconds();
        auto x = timeToX (pos);
        if (x >= gr.getX() && x <= gr.getRight())
        {
            g.setColour (Colours::goldHi);
            g.fillRect (x, (float) gr.getY(), 1.5f, (float) gr.getHeight());
        }
        lastPlayX = x;
    }
    g.restoreState();
}

void TuneView::resized()
{
    auto r = getLocalBounds().removeFromTop (toolbarH).reduced (8, 6);
    tuneBtn.setBounds (r.removeFromLeft (100));
    r.removeFromLeft (6);
    originalBtn.setBounds (r.removeFromLeft (84));
    r.removeFromLeft (12);
    keyLabel.setBounds (r.removeFromLeft (170));
    tightLabel.setBounds (r.removeFromLeft (102));
    tight.setBounds (r.removeFromLeft (110));
    r.removeFromLeft (10);
    glideLabel.setBounds (r.removeFromLeft (40));
    glide.setBounds (r.removeFromLeft (90));
    r.removeFromLeft (10);
    status.setBounds (r);
}

void TuneView::mouseDown (const juce::MouseEvent& e)
{
    if (! clip || e.y < toolbarH) return;
    auto i = noteAt (e.getPosition());
    selected = i;
    dragging = -1;
    if (i >= 0)
    {
        if (e.mods.isPopupMenu()) showNoteMenu (i);
        else dragging = i;
    }
    else if (e.x > keysW && session.edit)
    {
        auto t = xToTime ((float) e.x) - clip->getPosition().getOffset().inSeconds() + clip->getPosition().getStart().inSeconds();
        if (! session.edit->getTransport().isPlaying()) session.edit->getTransport().setPosition (te::TimePosition::fromSeconds (juce::jmax (0.0, t)));
    }
    repaint();
}

void TuneView::mouseDrag (const juce::MouseEvent& e)
{
    if (dragging < 0 || ! hasData) return;
    auto& n = data.notes[(size_t) dragging];
    auto target = yToNote ((float) e.y);
    if (target != n.target || ! n.tune)
    {
        n.target = target;
        n.tune = true;
        n.userSet = true;
        status.setText ("Make it " + vocal::noteName (target), juce::dontSendNotification);
        repaint();
    }
}

void TuneView::mouseUp (const juce::MouseEvent& e)
{
    if (dragging >= 0 && e.mouseWasDraggedSinceMouseDown()) scheduleRender (30);
    dragging = -1;
}

void TuneView::mouseMove (const juce::MouseEvent& e)
{
    auto h = noteAt (e.getPosition());
    if (h != hover) { hover = h; repaint(); }
    setMouseCursor (h >= 0 ? juce::MouseCursor::UpDownResizeCursor : juce::MouseCursor::NormalCursor);
}

void TuneView::mouseWheelMove (const juce::MouseEvent& e, const juce::MouseWheelDetails& w)
{
    if (! clip) return;
    if (e.mods.isCommandDown() || e.mods.isCtrlDown())
    {
        auto at = xToTime ((float) e.x);
        auto factor = w.deltaY > 0 ? 0.8 : 1.25;
        viewLength = juce::jlimit (0.25, juce::jmax (1.0, clip->getPosition().getLength().inSeconds() * 2.0), viewLength * factor);
        viewStart = at - (at - viewStart) * factor;
    }
    else if (e.mods.isShiftDown() || std::abs (w.deltaX) > std::abs (w.deltaY))
        viewStart -= (std::abs (w.deltaX) > 0 ? w.deltaX : w.deltaY) * viewLength * 0.5;
    else
    {
        auto d = w.deltaY > 0 ? 1 : -1;
        lowNote = juce::jlimit (0, 110, lowNote + d);
        highNote = juce::jlimit (lowNote + 12, 127, highNote + d);
    }
    repaint();
}

void TuneView::showNoteMenu (int index)
{
    auto& n = data.notes[(size_t) index];
    juce::PopupMenu make;
    auto sung = (int) std::round (n.pitch);
    for (int m = sung + 7; m >= sung - 7; --m)
    {
        bool in = vocal::inScale (m, data.key, data.scale);
        make.addItem (vocal::noteName (m) + (in ? "" : "   (not in the key)") + (m == sung ? "   - sung" : ""), true, n.tune && n.target == m, [this, index, m]
        {
            auto& note = data.notes[(size_t) index];
            note.target = m; note.tune = true; note.userSet = true;
            repaint();
            scheduleRender (10);
        });
    }
    juce::PopupMenu menu;
    menu.addSectionHeader (vocal::noteName (sung) + ", sung " + juce::String ((int) std::round ((n.pitch - sung) * 100.0f)) + " cents "
                           + (n.pitch >= sung ? "sharp" : "flat"));
    menu.addSubMenu ("Make it", make);
    auto keyNote = vocal::nearestInScale (n.pitch, data.key, data.scale);
    menu.addItem ("Tune to the key (" + vocal::noteName (keyNote) + ")", true, n.tune && ! n.userSet, [this, index, keyNote]
    {
        auto& note = data.notes[(size_t) index];
        note.target = keyNote; note.tune = true; note.userSet = false;
        repaint();
        scheduleRender (10);
    });
    menu.addItem ("Leave this note as sung", true, ! n.tune, [this, index]
    {
        data.notes[(size_t) index].tune = ! data.notes[(size_t) index].tune;
        repaint();
        scheduleRender (10);
    });
    menu.addSeparator();
    menu.addItem ("Tune every note to the key again", [this]
    {
        for (auto& note : data.notes) { note.target = vocal::nearestInScale (note.pitch, data.key, data.scale); note.tune = true; note.userSet = false; }
        repaint();
        scheduleRender (10);
    });
    menu.showMenuAsync (juce::PopupMenu::Options().withTargetComponent (this).withMousePosition());
}

void TuneView::tuneNow()
{
    if (! clip) return;
    ++generation;
    tune::Data d;
    status.setText ("Finding the notes...", juce::dontSendNotification);
    if (! tune::analyse (session, *clip, d))
    {
        status.setText ("Couldn't find notes to tune. Tune works on a single voice or instrument line.", juce::dontSendNotification);
        return;
    }
    d.tightness = (float) tight.getValue();
    d.glideMs = (float) glide.getValue();
    data = std::move (d);
    hasData = true;
    tune::save (*clip, data);
    fitRange();
    updateLabels();
    repaint();
    status.setText (juce::String ((int) data.notes.size()) + " notes found", juce::dontSendNotification);
    startRender();
}

void TuneView::scheduleRender (int ms)
{
    renderPending = true;
    renderAt = juce::Time::getMillisecondCounter() + (juce::uint32) ms;
}

void TuneView::timerCallback()
{
    if (renderPending && juce::Time::getMillisecondCounter() >= renderAt) { renderPending = false; startRender(); }
    if (clip && session.edit && isShowing())
    {
        auto pos = session.edit->getTransport().getPosition().inSeconds() - clip->getPosition().getStart().inSeconds() + clip->getPosition().getOffset().inSeconds();
        if (std::abs (timeToX (pos) - lastPlayX) > 0.5f) repaint();
    }
}

void TuneView::startRender()
{
    if (! clip || ! hasData) return;
    auto out = clipaudio::newFile (session, *clip, "tuned");
    auto copy = data;
    copy.tightness = (float) tight.getValue();
    copy.glideMs = (float) glide.getValue();
    data.tightness = copy.tightness;
    data.glideMs = copy.glideMs;
    auto gen = ++generation;
    rendering = true;
    status.setText ("Tuning...", juce::dontSendNotification);
    juce::Component::SafePointer<TuneView> safe (this);
    auto* engine = &session.engine;
    te::WaveAudioClip::Ptr target = clip;
    pool.addJob ([safe, engine, copy, out, gen, target]
    {
        auto ok = tune::renderToFile (*engine, copy, out, [safe, gen] (float) { return safe != nullptr && safe->generation.load() == gen; });
        juce::MessageManager::callAsync ([safe, ok, out, gen, target]
        {
            if (safe == nullptr || safe->generation.load() != gen || safe->clip != target) { out.deleteFile(); return; }
            safe->rendering = false;
            if (! ok) { safe->status.setText ("Couldn't tune this audio.", juce::dontSendNotification); out.deleteFile(); return; }
            clipaudio::setSource (*target, out);
            tune::save (*target, safe->data);
            int moved = 0, mine = 0;
            for (auto& n : safe->data.notes) { if (n.tune) ++moved; if (n.userSet) ++mine; }
            safe->status.setText ("Tuned " + juce::String (moved) + " notes" + (mine > 0 ? " (" + juce::String (mine) + " set by you)" : juce::String()),
                                  juce::dontSendNotification);
            safe->updateLabels();
        });
    });
}

void TuneView::findPitchInBackground()
{
    auto gen = ++pitchGeneration;
    auto src = data.source;
    juce::Component::SafePointer<TuneView> safe (this);
    auto* engine = &session.engine;
    pool.addJob ([safe, engine, src, gen]
    {
        tune::Data d;
        d.source = src;
        tune::findPitch (*engine, d, [safe, gen] (float) { return safe != nullptr && safe->pitchGeneration.load() == gen; });
        auto pitch = std::make_shared<vocal::PitchTrack> (std::move (d.pitch));
        juce::MessageManager::callAsync ([safe, pitch, gen, src]
        {
            if (safe == nullptr || safe->pitchGeneration.load() != gen || safe->data.source != src) return;
            safe->data.pitch = std::move (*pitch);
            safe->repaint();
        });
    });
}

//==============================================================================
// Takes
//==============================================================================
TakesView::TakesView (Session& s) : session (s)
{
    goldButton (autoBtn);
    autoBtn.setTooltip ("Score every take in every section and build the best one");
    autoBtn.onClick = [this] { autoComp(); };
    addAndMakeVisible (autoBtn);
    addBtn.onClick = [this]
    {
        if (! clip) return;
        auto fc = std::make_shared<juce::FileChooser> ("Add a take", juce::File::getSpecialLocation (juce::File::userMusicDirectory),
                                                       session.engine.getAudioFileFormatManager().readFormatManager.getWildcardForAllFormats());
        fc->launchAsync (juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles | juce::FileBrowserComponent::canSelectMultipleItems,
                         [this, fc] (const juce::FileChooser& c)
        {
            if (! clip) return;
            for (auto& f : c.getResults())
                if (f.existsAsFile()) takes::addTake (*clip, f);
            reload();
        });
    };
    addAndMakeVisible (addBtn);
    sectionBox.addItem ("Half bars", 1);
    sectionBox.addItem ("Bars", 2);
    sectionBox.addItem ("2 bars", 3);
    sectionBox.addItem ("4 bars", 4);
    sectionBox.setSelectedId (2, juce::dontSendNotification);
    sectionBox.setTooltip ("How finely Auto Comp cuts between takes");
    sectionBox.onChange = [this] { reload(); };
    addAndMakeVisible (sectionBox);
    styleLabel (status);
    status.setJustificationType (juce::Justification::centredRight);
    addAndMakeVisible (status);
}

TakesView::~TakesView()
{
    ++generation;
    pool.removeAllJobs (true, 10000);
}

void TakesView::setClip (te::WaveAudioClip* c)
{
    if (c == clip.get() && c != nullptr) return;
    clip = c;
    status.setText ({}, juce::dontSendNotification);
    if (clip)
    {
        takes::Comp saved;
        if (takes::loadChoices (*clip, saved))
        {
            auto bars = saved.sectionBeats / session.beatsPerBar();
            sectionBox.setSelectedId (bars < 0.75 ? 1 : bars < 1.5 ? 2 : bars < 3 ? 3 : 4, juce::dontSendNotification);
        }
    }
    reload();
}

void TakesView::reload()
{
    comp = {};
    peaks.clear();
    lengths.clear();
    if (clip && session.edit)
    {
        static const double bars[] = { 0.5, 1.0, 2.0, 4.0 };
        takes::prepare (session, *clip, comp, session.beatsPerBar() * bars[juce::jlimit (0, 3, sectionBox.getSelectedId() - 1)]);
        loadPeaks();
    }
    autoBtn.setEnabled (comp.files.size() > 1);
    repaint();
}

void TakesView::loadPeaks()
{
    auto files = comp.files;
    auto gen = ++generation;
    juce::Component::SafePointer<TakesView> safe (this);
    auto* engine = &session.engine;
    pool.addJob ([safe, files, gen, engine]
    {
        auto result = std::make_shared<std::pair<std::vector<std::vector<float>>, std::vector<double>>>();
        for (auto& f : files)
        {
            double len = 0;
            result->first.push_back (filePeaks (*engine, f, 3000, len));
            result->second.push_back (len);
            if (safe == nullptr) return;
        }
        juce::MessageManager::callAsync ([safe, result, gen]
        {
            if (safe == nullptr || safe->generation.load() != gen) return;
            safe->peaks = std::move (result->first);
            safe->lengths = std::move (result->second);
            safe->repaint();
        });
    });
}

juce::Rectangle<int> TakesView::gridArea() const   { return getLocalBounds().withTrimmedTop (toolbarH + 22).reduced (8, 6); }

juce::Rectangle<int> TakesView::cell (int take, int section) const
{
    auto a = gridArea();
    int n = juce::jmax (1, (int) comp.choice.size()), rows = juce::jmax (1, comp.files.size());
    auto rowH = juce::jmin (70, a.getHeight() / rows);
    auto w = (float) (a.getWidth() - headerW) / (float) n;
    auto x1 = a.getX() + headerW + (int) std::round (section * w), x2 = a.getX() + headerW + (int) std::round ((section + 1) * w);
    return { x1, a.getY() + take * rowH, x2 - x1, rowH };
}

std::pair<double, double> TakesView::sectionSource (int i) const
{
    if (! clip || ! session.edit) return { 0, 0 };
    auto& ts = session.edit->tempoSequence;
    auto clipStart = clip->getPosition().getStart().inSeconds(), offset = clip->getPosition().getOffset().inSeconds();
    auto t0 = ts.toTime (te::BeatPosition::fromBeats (comp.sectionStartBeat (i))).inSeconds();
    auto t1 = ts.toTime (te::BeatPosition::fromBeats (comp.sectionStartBeat (i + 1))).inSeconds();
    t0 = juce::jmax (t0, clipStart);
    t1 = juce::jmin (t1, clip->getPosition().getEnd().inSeconds());
    return { t0 - clipStart + offset, t1 - clipStart + offset };
}

void TakesView::paint (juce::Graphics& g)
{
    g.fillAll (Colours::bg);
    g.setColour (Colours::panel);
    g.fillRect (getLocalBounds().removeFromTop (toolbarH));
    g.setColour (Colours::line);
    g.fillRect (0, toolbarH - 1, getWidth(), 1);
    if (! clip)
    {
        g.setColour (Colours::muted);
        g.setFont (Fonts::ui (15.0f));
        g.drawText ("Select an audio clip on the timeline to see its takes.", getLocalBounds().withTrimmedTop (toolbarH), juce::Justification::centred);
        return;
    }
    auto a = gridArea();
    if (comp.files.size() < 2)
    {
        g.setColour (Colours::text);
        g.setFont (Fonts::semi (16.0f));
        g.drawText ("Record a few takes, then let Auto Comp pick the best parts.", a.withTrimmedBottom (a.getHeight() / 2), juce::Justification::centredBottom);
        g.setColour (Colours::muted);
        g.setFont (Fonts::ui (13.5f));
        g.drawFittedText ("Turn on Cycle over the part (drag in the ruler), arm the track and record: every time it loops round, the pass is kept as a take.\n"
                          "Or add takes you already have with \"Add take from file...\".",
                          a.withTrimmedTop (a.getHeight() / 2 + 8).reduced (40, 0), juce::Justification::centredTop, 3);
        return;
    }
    int n = (int) comp.choice.size();
    auto bpb = session.beatsPerBar();
    // section labels
    g.setFont (Fonts::narrow (11.5f));
    for (int i = 0; i < n; ++i)
    {
        auto c = cell (0, i);
        auto bar = comp.sectionStartBeat (i) / bpb + 1.0;
        g.setColour (Colours::dim);
        g.drawText (std::abs (bar - std::round (bar)) < 1e-6 ? "Bar " + juce::String ((int) std::round (bar)) : juce::String (bar, 1),
                    c.withY (a.getY() - 18).withHeight (16).reduced (4, 0), juce::Justification::centredLeft);
    }
    bool scored = ! comp.scores.empty();
    for (int t = 0; t < comp.files.size(); ++t)
    {
        auto row = cell (t, 0).withX (a.getX()).withWidth (headerW - 6);
        bool used = std::find (comp.choice.begin(), comp.choice.end(), t) != comp.choice.end();
        g.setColour (used ? Colours::panel3 : Colours::panel);
        g.fillRoundedRectangle (row.toFloat().reduced (0, 2), 4.0f);
        g.setColour (used ? Colours::gold : Colours::text);
        g.setFont (Fonts::semi (13.0f));
        g.drawText ("Take " + juce::String (t + 1), row.reduced (10, 6).withTrimmedBottom (row.getHeight() / 2 - 6), juce::Justification::topLeft);
        g.setFont (Fonts::ui (11.0f));
        g.setColour (Colours::muted);
        if (scored)
        {
            float sum = 0; int cnt = 0;
            for (auto& sc : comp.scores[(size_t) t]) if (! sc.silent) { sum += sc.total; ++cnt; }
            g.drawText (cnt > 0 ? "score " + juce::String (juce::roundToInt (100.0f * sum / (float) cnt)) : juce::String ("silent"),
                        row.reduced (10, 6), juce::Justification::bottomLeft);
        }
        else g.drawText ("click to use it all", row.reduced (10, 6), juce::Justification::bottomLeft);

        for (int i = 0; i < n; ++i)
        {
            auto c = cell (t, i).reduced (1, 2);
            bool chosen = comp.choice[(size_t) i] == t;
            bool hov = hoverTake == t && hoverSection == i;
            g.setColour (chosen ? Colours::gold.withAlpha (0.22f) : (hov ? Colours::panel3 : Colours::bg2));
            g.fillRoundedRectangle (c.toFloat(), 3.0f);
            // waveform
            if (t < (int) peaks.size() && lengths[(size_t) t] > 0)
            {
                auto [s0, s1] = sectionSource (i);
                auto& pk = peaks[(size_t) t];
                auto mid = (float) c.getCentreY();
                g.setColour (chosen ? Colours::goldHi : Colours::muted.withAlpha (0.7f));
                for (int x = c.getX() + 1; x < c.getRight() - 1; ++x)
                {
                    auto tt = s0 + (s1 - s0) * (x - c.getX()) / juce::jmax (1, c.getWidth());
                    auto idx = (int) (tt / lengths[(size_t) t] * (double) pk.size());
                    if (idx < 0 || idx >= (int) pk.size()) continue;
                    auto h = juce::jmin (1.0f, pk[(size_t) idx] * 1.4f) * (float) c.getHeight() * 0.42f;
                    g.fillRect ((float) x, mid - h, 1.0f, juce::jmax (0.5f, 2 * h));
                }
            }
            if (scored && t < (int) comp.scores.size() && i < (int) comp.scores[(size_t) t].size())
            {
                auto& sc = comp.scores[(size_t) t][(size_t) i];
                auto v = juce::jlimit (0.0f, 1.0f, sc.total);
                auto col = sc.silent ? Colours::dim : sc.clipped ? Colours::live : v > 0.7f ? Colours::ok : v > 0.45f ? Colours::warn : Colours::live;
                g.setColour (col);
                g.fillRect (c.getX() + 3, c.getBottom() - 4, (int) ((c.getWidth() - 6) * (sc.silent ? 0.05f : v)), 2);
            }
            if (chosen)
            {
                g.setColour (Colours::gold);
                g.drawRoundedRectangle (c.toFloat(), 3.0f, 1.6f);
            }
        }
    }
}

void TakesView::resized()
{
    auto r = getLocalBounds().removeFromTop (toolbarH).reduced (8, 6);
    autoBtn.setBounds (r.removeFromLeft (110));
    r.removeFromLeft (8);
    sectionBox.setBounds (r.removeFromLeft (110));
    r.removeFromLeft (8);
    addBtn.setBounds (r.removeFromLeft (150));
    r.removeFromLeft (10);
    status.setBounds (r);
}

void TakesView::mouseMove (const juce::MouseEvent& e)
{
    int ht = -1, hs = -1;
    for (int t = 0; t < comp.files.size() && ht < 0; ++t)
        for (int i = 0; i < (int) comp.choice.size(); ++i)
            if (cell (t, i).contains (e.getPosition())) { ht = t; hs = i; break; }
    if (ht != hoverTake || hs != hoverSection)
    {
        hoverTake = ht; hoverSection = hs;
        if (ht >= 0 && ! comp.scores.empty() && ht < (int) comp.scores.size() && hs < (int) comp.scores[(size_t) ht].size())
        {
            auto& sc = comp.scores[(size_t) ht][(size_t) hs];
            setTooltip (sc.silent ? juce::String ("Nothing sung here") :
                        "In tune " + juce::String (juce::roundToInt (sc.pitch * 100)) + ", in time " + juce::String (juce::roundToInt (sc.timing * 100))
                        + ", level " + juce::String (juce::roundToInt (sc.level * 100)) + (sc.clipped ? ", clipped" : ""));
        }
        else setTooltip ({});
        repaint();
    }
}

void TakesView::mouseDown (const juce::MouseEvent& e)
{
    if (! clip || comp.files.size() < 2) return;
    for (int t = 0; t < comp.files.size(); ++t)
    {
        auto row = cell (t, 0).withX (gridArea().getX()).withWidth (headerW - 6);
        if (row.contains (e.getPosition()))
        {
            std::fill (comp.choice.begin(), comp.choice.end(), t);
            renderComp ("Using take " + juce::String (t + 1) + " all the way through.");
            return;
        }
        for (int i = 0; i < (int) comp.choice.size(); ++i)
            if (cell (t, i).contains (e.getPosition()))
            {
                if (comp.choice[(size_t) i] == t) return;
                comp.choice[(size_t) i] = t;
                renderComp ("Take " + juce::String (t + 1) + " in bar " + juce::String ((int) (comp.sectionStartBeat (i) / session.beatsPerBar()) + 1) + ".");
                return;
            }
    }
}

void TakesView::autoComp()
{
    if (! clip) return;
    if (comp.files.size() < 2) { status.setText ("Auto Comp needs at least two takes.", juce::dontSendNotification); return; }
    if (! takes::autoComp (session, *clip, comp)) { status.setText ("Cancelled.", juce::dontSendNotification); return; }
    std::map<int, int> counts;
    for (auto c : comp.choice) counts[c]++;
    juce::StringArray parts;
    for (auto& [t, cnt] : counts) parts.add ("take " + juce::String (t + 1) + " x" + juce::String (cnt));
    renderComp ("Auto Comp: " + parts.joinIntoString (", "));
}

void TakesView::renderComp (const juce::String& message)
{
    auto f = takes::render (session, *clip, comp);
    status.setText (f.existsAsFile() ? message : juce::String ("Couldn't build the comp."), juce::dontSendNotification);
    session.notifyStructure();
    repaint();
}

} // namespace ms
