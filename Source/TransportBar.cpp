#include "TransportBar.h"
#include "Loudness.h"
#include "MotionPlugins.h"

namespace ms
{

DragValue::DragValue (const juce::String& s, double mn, double mx, double st) : suffix (s), min (mn), max (mx), step (st)
{
    setMouseCursor (juce::MouseCursor::UpDownResizeCursor);
}

void DragValue::paint (juce::Graphics& g)
{
    auto v = getValue ? getValue() : 0.0;
    auto text = format ? format (v) : juce::String (v, step < 1 ? 1 : 0);
    g.setColour (colour);
    g.setFont (Fonts::heavy (fontSize));
    g.drawText (text + suffix, getLocalBounds(), juce::Justification::centred);
}

void DragValue::mouseDown (const juce::MouseEvent&)  { startValue = getValue ? getValue() : 0.0; }

void DragValue::mouseDrag (const juce::MouseEvent& e)
{
    auto perPixel = step >= 1 ? 0.12 : (e.mods.isShiftDown() ? 0.01 : 0.1);
    auto v = juce::jlimit (min, max, startValue - e.getDistanceFromDragStartY() * perPixel);
    v = std::round (v / step) * step;
    if (setValue) setValue (v);
    repaint();
}

void DragValue::mouseUp (const juce::MouseEvent&) {}

void DragValue::mouseDoubleClick (const juce::MouseEvent&)
{
    editor = std::make_unique<juce::TextEditor>();
    editor->setJustification (juce::Justification::centred);
    editor->setFont (Fonts::heavy (fontSize * 0.8f));
    editor->setText (juce::String (getValue ? getValue() : 0.0, step < 1 ? 1 : 0));
    editor->selectAll();
    editor->setBounds (getLocalBounds());
    auto commit = [this]
    {
        if (editor == nullptr) return;
        auto v = juce::jlimit (min, max, editor->getText().getDoubleValue());
        if (editor->getText().trim().isNotEmpty() && setValue) setValue (v);
        juce::MessageManager::callAsync ([sp = juce::Component::SafePointer<DragValue> (this)] { if (sp) { sp->editor.reset(); sp->repaint(); } });
    };
    editor->onReturnKey = commit;
    editor->onFocusLost = commit;
    editor->onEscapeKey = [this] { juce::MessageManager::callAsync ([sp = juce::Component::SafePointer<DragValue> (this)] { if (sp) sp->editor.reset(); }); };
    addAndMakeVisible (*editor);
    editor->grabKeyboardFocus();
}

//==============================================================================
static const char* keyNames[] = { "C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B" };

TransportBar::TransportBar (Session& s) : session (s)
{
    for (auto* b : { &toStart, &rewind, &forward, &stop, &play, &record, &loop, &click, &countIn, &punch })
        addAndMakeVisible (b);

    toStart.onClick = [this] { if (session.edit) session.edit->getTransport().setPosition (0s); };
    rewind.onClick = [this]
    {
        if (! session.edit) return;
        auto& tp = session.edit->getTransport(); auto& ts = session.edit->tempoSequence;
        auto b = ts.toBeats (tp.getPosition()).inBeats(), bar = session.beatsPerBar();
        tp.setPosition (ts.toTime (te::BeatPosition::fromBeats (juce::jmax (0.0, (std::ceil (b / bar - 0.01) - 1.0) * bar))));
    };
    forward.onClick = [this]
    {
        if (! session.edit) return;
        auto& tp = session.edit->getTransport(); auto& ts = session.edit->tempoSequence;
        auto b = ts.toBeats (tp.getPosition()).inBeats(), bar = session.beatsPerBar();
        tp.setPosition (ts.toTime (te::BeatPosition::fromBeats ((std::floor (b / bar + 0.01) + 1.0) * bar)));
    };
    stop.onClick = [this]
    {
        if (! session.edit) return;
        auto& tp = session.edit->getTransport();
        if (! tp.isPlaying()) tp.setPosition (0s);
        tp.stop (false, false);
    };
    play.onClick = [this]
    {
        if (! session.edit) return;
        auto& tp = session.edit->getTransport();
        if (tp.isPlaying()) tp.stop (false, false); else tp.play (false);
    };
    record.onClick = [this]
    {
        if (! session.edit) return;
        auto& tp = session.edit->getTransport();
        if (tp.isRecording()) tp.stop (false, false); else tp.record (false);
    };
    loop.onClick = [this] { if (session.edit) { auto& tp = session.edit->getTransport(); tp.looping = ! tp.looping.get(); } updateButtons(); };
    click.onClick = [this] { if (session.edit) session.edit->clickTrackEnabled = ! session.edit->clickTrackEnabled.get(); updateButtons(); };
    countIn.onClick = [this]
    {
        if (! session.edit) return;
        auto on = session.edit->getCountInMode() != te::Edit::CountIn::none;
        session.edit->setCountInMode (on ? te::Edit::CountIn::none : te::Edit::CountIn::oneBar);
        updateButtons();
    };
    punch.onClick = [this] { if (session.edit) session.edit->recordingPunchInOut = ! session.edit->recordingPunchInOut.get(); updateButtons(); };

    bpm.getValue = [this] { return session.edit ? session.edit->tempoSequence.getTempos()[0]->getBpm() : 120.0; };
    bpm.setValue = [this] (double v) { if (session.edit) session.edit->tempoSequence.getTempos()[0]->setBpm (v); };
    bpm.format = [] (double v) { return juce::String (v, std::abs (v - std::round (v)) < 0.05 ? 0 : 1); };
    sigNum.getValue = [this] { return session.edit ? (double) session.edit->tempoSequence.getTimeSigs()[0]->numerator.get() : 4.0; };
    sigNum.setValue = [this] (double v) { if (session.edit) session.edit->tempoSequence.getTimeSigs()[0]->numerator = (int) v; };
    sigDen.getValue = [this] { return session.edit ? (double) session.edit->tempoSequence.getTimeSigs()[0]->denominator.get() : 4.0; };
    sigDen.setValue = [this] (double v)
    {
        int d = (int) v; d = d <= 2 ? 2 : d <= 4 ? 4 : d <= 8 ? 8 : 16;
        if (session.edit) session.edit->tempoSequence.getTimeSigs()[0]->denominator = d;
    };
    for (auto* d : { &bpm, &sigNum, &sigDen }) addAndMakeVisible (d);
    sigNum.fontSize = sigDen.fontSize = 16.0f;
    bpm.setTooltip ("Tempo: drag up / down, or double-click to type");

    for (int i = 0; i < 12; ++i) { keyBox.addItem (juce::String (keyNames[i]) + " major", i + 1); }
    for (int i = 0; i < 12; ++i) { keyBox.addItem (juce::String (keyNames[i]) + " minor", i + 13); }
    keyBox.onChange = [this] { session.setSongKey (keyBox.getSelectedId() - 1); };
    keyBox.setTooltip ("Song key");
    keyBox.setColour (juce::ComboBox::backgroundColourId, Colours::bg2);
    keyBox.setColour (juce::ComboBox::outlineColourId, juce::Colours::transparentBlack);
    keyBox.setColour (juce::ComboBox::textColourId, Colours::goldHi);
    addAndMakeVisible (keyBox);

    gridBox.addItem ("Snap off", 1);
    gridBox.addItem ("1/32", 2); gridBox.addItem ("1/16", 3); gridBox.addItem ("1/8", 4);
    gridBox.addItem ("1/4", 5); gridBox.addItem ("1/2", 6); gridBox.addItem ("Bar", 7);
    gridBox.setSelectedId (5, juce::dontSendNotification);
    gridBox.onChange = [this]
    {
        static const double beats[] = { 0, 0.125, 0.25, 0.5, 1.0, 2.0, 4.0 };
        auto id = gridBox.getSelectedId();
        session.snap = id > 1;
        if (id > 1) session.gridBeats = id == 7 ? session.beatsPerBar() : beats[id - 1];
    };
    gridBox.setTooltip ("Snap / grid");
    addAndMakeVisible (gridBox);

    for (auto* b : { &arrangeBtn, &sessionBtn, &mixerBtn })
    {
        b->setClickingTogglesState (false);
        b->setRadioGroupId (1001);
        addAndMakeVisible (b);
    }
    arrangeBtn.onClick = [this] { if (onShowView) onShowView (0); };
    sessionBtn.onClick = [this] { if (onShowView) onShowView (1); };
    mixerBtn.onClick = [this] { if (onShowView) onShowView (2); };
    arrangeBtn.setTooltip ("Tracks: the timeline (Cmd 1)");
    sessionBtn.setTooltip ("Live: clips and scenes to launch, like Ableton's Session view (Cmd 2)");
    mixerBtn.setTooltip ("Mixer (X)");
    browserBtn.onClick = [this] { if (onToggleBrowser) onToggleBrowser(); };
    editorBtn.onClick = [this] { if (onToggleEditor) onToggleEditor(); };
    settingsBtn.onClick = [this] { if (onSettings) onSettings(); };
    browserBtn.setTooltip ("Show / hide the browser (B)");
    editorBtn.setTooltip ("Show / hide the editor: piano roll, plugins, keyboard (E)");
    for (auto* b : { &browserBtn, &editorBtn, &settingsBtn }) addAndMakeVisible (b);

    addAndMakeVisible (master);
    master.setTooltip ("Master output");
    addAndMakeVisible (loudness);
    session.addListener (this);
    editChanged();
    setCurrentView (0);
    startTimerHz (20);
}

TransportBar::~TransportBar()  { session.removeListener (this); }

void TransportBar::editChanged()
{
    if (session.edit)
    {
        master.setMeasurer (nullptr);
        keyBox.setSelectedId (session.songKey + 1, juce::dontSendNotification);
    }
    updateButtons();
    repaint();
}

void TransportBar::setCurrentView (int v)
{
    currentView = v;
    arrangeBtn.setToggleState (v == 0, juce::dontSendNotification);
    sessionBtn.setToggleState (v == 1, juce::dontSendNotification);
    mixerBtn.setToggleState (v == 2, juce::dontSendNotification);
}

void TransportBar::setPanelStates (bool b, bool e)
{
    browserBtn.setToggleState (b, juce::dontSendNotification);
    editorBtn.setToggleState (e, juce::dontSendNotification);
}

void TransportBar::updateButtons()
{
    if (! session.edit) return;
    auto& tp = session.edit->getTransport();
    play.setToggleState (tp.isPlaying(), juce::dontSendNotification);
    record.setToggleState (tp.isRecording(), juce::dontSendNotification);
    loop.setToggleState (tp.looping.get(), juce::dontSendNotification);
    click.setToggleState (session.edit->clickTrackEnabled.get(), juce::dontSendNotification);
    countIn.setToggleState (session.edit->getCountInMode() != te::Edit::CountIn::none, juce::dontSendNotification);
    punch.setToggleState (session.edit->recordingPunchInOut.get(), juce::dontSendNotification);
}

void TransportBar::timerCallback()
{
    if (! session.edit) return;
    auto& tp = session.edit->getTransport();
    if (auto ctx = tp.getCurrentPlaybackContext())
        if (master.getMeasurer() != &ctx->masterLevels) master.setMeasurer (&ctx->masterLevels);
    auto pos = tp.getPosition();
    auto nb = barsBeats (*session.edit, pos), nt = timecode (pos.inSeconds());
    auto cpu = juce::String (juce::roundToInt (session.engine.getDeviceManager().getCpuUsage() * 100.0f)) + "%";
    if (nb != posBars || nt != posTime || cpu != cpuText)
    {
        posBars = nb; posTime = nt; cpuText = cpu;
        repaint (lcd); repaint (master.getBounds().expanded (0, 16));
    }
    updateButtons();
    loudness.refresh();
    bpm.repaint(); sigNum.repaint(); sigDen.repaint();
}

void TransportBar::paint (juce::Graphics& g)
{
    juce::ColourGradient grad (Colours::panel2, 0, 0, Colours::panel, 0, (float) getHeight(), false);
    g.setGradientFill (grad);
    g.fillAll();
    g.setColour (Colours::line);
    g.fillRect (0, getHeight() - 1, getWidth(), 1);

    // wordmark
    g.setColour (Colours::gold);
    g.setFont (Fonts::heavy (17.0f));
    g.drawText ("MOTION", logo.removeFromTop (logo.getHeight() / 2 + 4).withTrimmedTop (6), juce::Justification::bottomLeft);
    g.setColour (Colours::text);
    g.setFont (Fonts::narrow (11.0f));
    g.drawText ("S T U D I O", logo, juce::Justification::topLeft);
    logo = juce::Rectangle<int> (14, 0, 90, getHeight());

    // the LCD
    auto r = lcd.toFloat();
    g.setColour (Colours::bg2);
    g.fillRoundedRectangle (r, 6.0f);
    g.setColour (Colours::goldDeep.withAlpha (0.6f));
    g.drawRoundedRectangle (r.reduced (0.5f), 6.0f, 1.0f);
    auto cell = lcd.reduced (12, 4);
    auto barsArea = cell.removeFromLeft (142);
    g.setColour (Colours::goldHi);
    g.setFont (Fonts::heavy (22.0f));
    g.drawText (posBars, barsArea.withTrimmedBottom (14), juce::Justification::centredLeft);
    g.setColour (Colours::muted);
    g.setFont (Fonts::narrow (10.5f));
    g.drawText ("BAR . BEAT . TICK", barsArea.removeFromBottom (14), juce::Justification::centredLeft);
    auto timeArea = cell.removeFromLeft (showTime ? 96 : 0);
    g.setColour (Colours::text);
    g.setFont (Fonts::semi (15.0f));
    g.drawText (posTime, timeArea.withTrimmedBottom (14), juce::Justification::centredLeft);
    g.setColour (Colours::muted);
    g.setFont (Fonts::narrow (10.5f));
    g.drawText ("TIME", timeArea.removeFromBottom (14), juce::Justification::centredLeft);
    // labels under the tempo / signature / key
    g.drawText ("BPM", bpm.getBounds().withY (lcd.getBottom() - 18).withHeight (14), juce::Justification::centred);
    g.drawText ("TIME SIG", juce::Rectangle<int> (sigNum.getX(), lcd.getBottom() - 18, sigDen.getRight() - sigNum.getX(), 14), juce::Justification::centred);
    g.drawText ("KEY", keyBox.getBounds().withY (lcd.getBottom() - 18).withHeight (14), juce::Justification::centred);
    g.setColour (Colours::goldHi);
    g.setFont (Fonts::heavy (16.0f));
    g.drawText ("/", juce::Rectangle<int> (sigNum.getRight(), sigNum.getY(), sigDen.getX() - sigNum.getRight(), sigNum.getHeight()), juce::Justification::centred);
    // dividers
    g.setColour (Colours::line);
    for (auto x : { bpm.getX() - 8, sigNum.getX() - 8, keyBox.getX() - 8 })
        g.fillRect (x, lcd.getY() + 8, 1, lcd.getHeight() - 16);
    // CPU, beside the master meter
    g.setColour (Colours::muted);
    g.setFont (Fonts::narrow (10.5f));
    g.drawText ("CPU " + cpuText, master.getBounds().translated (0, 14).withHeight (14), juce::Justification::centredLeft);
    g.drawText ("OUT", master.getBounds().translated (0, -14).withHeight (14), juce::Justification::centredLeft);
}

//==============================================================================
void LoudnessReadout::refresh()
{
    juce::String st, detail;
    bool has = false, hot = false;
    if (auto p = session.masterLimiter())
        if (auto ep = dynamic_cast<te::ExternalPlugin*> (p.get()))
            if (auto src = dynamic_cast<LoudnessSource*> (ep->getAudioPluginInstance()))
            {
                has = true;
                auto& m = src->loudness();
                auto f = [] (float v) { return v <= LoudnessMeter::silence + 0.05f ? juce::String ("--") : juce::String (v, 1); };
                st = f (m.shortTerm());
                detail = "I " + f (m.integrated()) + "  TP " + (m.truePeak() < -100 ? juce::String ("--") : juce::String (m.truePeak(), 1));
                hot = m.truePeak() > -0.1f;
            }
    if (st != shortText || detail != detailText || has != present || hot != over)
    {
        shortText = st; detailText = detail; present = has; over = hot;
        setTooltip (present ? "Loudness (Motion Master on the master). Click to open it." : "Click to add Motion Master (limiter + loudness meter) to the master");
        repaint();
    }
}

void LoudnessReadout::paint (juce::Graphics& g)
{
    auto r = getLocalBounds().toFloat();
    g.setColour (Colours::bg2);
    g.fillRoundedRectangle (r, 5.0f);
    if (! present)
    {
        g.setColour (Colours::dim);
        g.setFont (Fonts::narrow (11.0f));
        g.drawText ("+ LOUDNESS", r, juce::Justification::centred);
        return;
    }
    auto top = r.removeFromTop (r.getHeight() * 0.58f).reduced (6, 0);
    g.setColour (Colours::goldHi);
    g.setFont (Fonts::heavy (16.0f));
    g.drawText (shortText, top, juce::Justification::centredLeft);
    g.setColour (Colours::muted);
    g.setFont (Fonts::narrow (10.0f));
    g.drawText ("LUFS", top, juce::Justification::centredRight);
    g.setColour (over ? Colours::live : Colours::muted);
    g.drawText (detailText, r.reduced (6, 0), juce::Justification::centredLeft);
}

void LoudnessReadout::mouseDown (const juce::MouseEvent&)
{
    auto p = session.masterLimiter();
    if (p == nullptr) p = session.addMasterLimiter();
    if (p != nullptr) p->showWindowExplicitly();
    refresh();
}

void TransportBar::resized()
{
    auto r = getLocalBounds().reduced (8, 8);
    logo = r.removeFromLeft (96);
    auto bw = r.getHeight() - 14;
    auto tb = r.removeFromLeft (bw * 6 + 25).withSizeKeepingCentre (bw * 6 + 25, bw);
    for (auto* b : { &toStart, &rewind, &forward, &stop, &play, &record })
    {
        b->setBounds (tb.removeFromLeft (bw));
        tb.removeFromLeft (5);
    }
    r.removeFromLeft (8);
    auto tb2 = r.removeFromLeft (bw * 4 + 15).withSizeKeepingCentre (bw * 4 + 15, bw);
    for (auto* b : { &loop, &click, &countIn, &punch })
    {
        b->setBounds (tb2.removeFromLeft (bw));
        tb2.removeFromLeft (5);
    }
    r.removeFromLeft (12);

    // right side: views, panels, output meter, settings
    settingsBtn.setBounds (r.removeFromRight (74).withSizeKeepingCentre (74, 30));
    r.removeFromRight (8);
    master.setBounds (r.removeFromRight (78).withSizeKeepingCentre (78, 12));
    r.removeFromRight (8);
    loudness.setBounds (r.removeFromRight (92).reduced (0, 2));
    r.removeFromRight (8);
    editorBtn.setBounds (r.removeFromRight (60).withSizeKeepingCentre (60, 30));
    r.removeFromRight (3);
    browserBtn.setBounds (r.removeFromRight (68).withSizeKeepingCentre (68, 30));
    r.removeFromRight (10);
    auto views = r.removeFromRight (192).withSizeKeepingCentre (192, 30);
    arrangeBtn.setBounds (views.removeFromLeft (64));
    sessionBtn.setBounds (views.removeFromLeft (64));
    mixerBtn.setBounds (views.removeFromLeft (64));
    r.removeFromRight (10);
    gridBox.setBounds (r.removeFromRight (88).withSizeKeepingCentre (88, 26));
    r.removeFromRight (10);

    // the LCD gets the rest: bars | time | tempo | signature | key (the time readout goes first when it's tight)
    lcd = r.withSizeKeepingCentre (juce::jmin (r.getWidth(), 640), r.getHeight()).withX (r.getX());
    auto c = lcd.reduced (12, 4);
    showTime = c.getWidth() >= 140 + 96 + 70 + 76 + 110 + 48;
    c.removeFromLeft (showTime ? 240 : 146);
    bpm.setBounds (c.removeFromLeft (70).withTrimmedBottom (14));
    c.removeFromLeft (16);
    sigNum.setBounds (c.removeFromLeft (24).withTrimmedBottom (14));
    c.removeFromLeft (12);
    sigDen.setBounds (c.removeFromLeft (24).withTrimmedBottom (14));
    c.removeFromLeft (16);
    auto kw = juce::jmin (116, c.getWidth());
    keyBox.setBounds (c.removeFromLeft (kw).withTrimmedBottom (16).withSizeKeepingCentre (kw, 24));
}

} // namespace ms
