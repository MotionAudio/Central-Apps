#include "MixerView.h"
#include "MotionPlugins.h"

namespace ms
{

ChannelStrip::Slot::Slot (ChannelStrip& s, te::Plugin* p, bool inst) : strip (s), plugin (p), instrument (inst)
{
    setTooltip (p != nullptr ? p->getName() + "  (click to open, right-click for more)" : juce::String ("Add an effect (or drop one here)"));
}

void ChannelStrip::Slot::paint (juce::Graphics& g)
{
    auto r = getLocalBounds().toFloat().reduced (2.0f, 1.0f);
    if (plugin == nullptr)
    {
        g.setColour (Colours::bg2);
        g.fillRoundedRectangle (r, 3.0f);
        g.setColour (Colours::dim);
        g.setFont (Fonts::ui (11.0f));
        g.drawText (instrument ? "+ instrument" : "+", r, juce::Justification::centred);
        return;
    }
    bool on = plugin->isEnabled();
    auto base = instrument ? Colours::gold.withAlpha (on ? 0.9f : 0.25f) : (on ? Colours::panel3 : Colours::panel2);
    g.setColour (base);
    g.fillRoundedRectangle (r, 3.0f);
    if (! instrument && on)
    {
        g.setColour (Colours::gold);
        g.fillRect (r.withWidth (2.5f));
    }
    g.setColour (instrument ? Colours::goldText : (on ? Colours::text : Colours::dim));
    g.setFont (Fonts::narrow (11.5f));
    g.drawFittedText (plugin->getName(), r.reduced (6, 0).toNearestInt(), juce::Justification::centredLeft, 1, 0.8f);
}

void ChannelStrip::Slot::mouseDown (const juce::MouseEvent& e)
{
    auto& session = strip.session;
    auto track = strip.track;
    if (plugin == nullptr)
    {
        if (track == nullptr && ! strip.isMaster) return;
        showPluginMenu (session.engine, instrument, this, [&session, track, isMaster = strip.isMaster] (const PluginChoice& c)
        {
            if (isMaster)
            {
                if (auto p = createPlugin (*session.edit, c))
                {
                    auto& list = session.edit->getMasterPluginList();
                    list.insertPlugin (p, juce::jmax (0, list.size() - 1), nullptr);
                    p->showWindowExplicitly();
                }
            }
            else if (auto p = session.insertPlugin (*track, c))
                p->showWindowExplicitly();
        });
        return;
    }
    session.selection.selectOnly (plugin.get());
    if (e.mods.isPopupMenu())
    {
        juce::PopupMenu m;
        auto p = plugin;
        m.addItem ("Open", [p] { p->showWindowExplicitly(); });
        m.addItem (p->isEnabled() ? "Bypass" : "Turn on", [p] { p->setEnabled (! p->isEnabled()); });
        if (! instrument)
        {
            auto& list = p->getOwnerList() != nullptr ? *p->getOwnerList() : session.edit->getMasterPluginList();
            int idx = list.indexOf (p.get());
            m.addItem ("Move up", idx > 0 && ! list[idx - 1]->isSynth(), false, [p, idx, &list] { list.insertPlugin (p, idx - 1, nullptr); });
            m.addItem ("Move down", idx + 1 < list.size() && dynamic_cast<te::VolumeAndPanPlugin*> (list[idx + 1]) == nullptr, false,
                       [p, idx, &list] { list.insertPlugin (p, idx + 2, nullptr); });
        }
        m.addItem ("Replace...", [this, p, &session, track, inst = instrument]
        {
            showPluginMenu (session.engine, inst, this, [p, &session, track] (const PluginChoice& c)
            {
                auto list = p->getOwnerList();
                if (list == nullptr) return;
                int idx = list->indexOf (p.get());
                if (auto np = createPlugin (*session.edit, c))
                {
                    p->deleteFromParent();
                    list->insertPlugin (np, idx, nullptr);
                    if (track != nullptr && c.isInstrument) session.routeMidiTo (track.get());
                }
            });
        });
        m.addSeparator();
        m.addItem ("Remove", [p] { p->deleteFromParent(); });
        m.showMenuAsync (juce::PopupMenu::Options().withTargetComponent (this));
        return;
    }
    if (e.mods.isAltDown()) { plugin->setEnabled (! plugin->isEnabled()); repaint(); return; }
    plugin->showWindowExplicitly();
}

//==============================================================================
ChannelStrip::ChannelStrip (Session& s, te::AudioTrack* t) : track (t), session (s), isMaster (t == nullptr), meter (true)
{
    pan.setSliderStyle (juce::Slider::RotaryHorizontalVerticalDrag);
    pan.setRotaryParameters (juce::MathConstants<float>::pi * 1.25f, juce::MathConstants<float>::pi * 2.75f, true);
    pan.setRange (-1.0, 1.0);
    pan.setTextBoxStyle (juce::Slider::NoTextBox, false, 0, 0);
    pan.setPopupDisplayEnabled (true, true, nullptr);
    pan.setDoubleClickReturnValue (true, 0.0);
    pan.textFromValueFunction = [] (double v) { auto p = juce::roundToInt (v * 100); return p == 0 ? juce::String ("C") : p < 0 ? "L" + juce::String (-p) : "R" + juce::String (p); };
    pan.onValueChange = [this] { if (auto vp = volumePlugin()) vp->panParam->setParameter ((float) pan.getValue(), juce::sendNotification); };
    pan.setTooltip ("Pan");
    addAndMakeVisible (pan);

    fader.setSliderStyle (juce::Slider::LinearVertical);
    fader.setRange (0.0, 1.0);
    fader.setTextBoxStyle (juce::Slider::NoTextBox, false, 0, 0);
    fader.setDoubleClickReturnValue (true, te::decibelsToVolumeFaderPosition (0.0f));
    fader.onValueChange = [this]
    {
        if (auto vp = volumePlugin()) vp->volParam->setParameter ((float) fader.getValue(), juce::sendNotification);
        dbLabel.setText (dbString (te::volumeFaderPositionToDB ((float) fader.getValue())), juce::dontSendNotification);
    };
    addAndMakeVisible (fader);
    addAndMakeVisible (meter);
    meter.showScale = true;

    dbLabel.setJustificationType (juce::Justification::centred);
    dbLabel.setFont (Fonts::narrow (12.0f));
    dbLabel.setColour (juce::Label::textColourId, Colours::goldHi);
    dbLabel.setColour (juce::Label::backgroundColourId, Colours::bg2);
    addAndMakeVisible (dbLabel);

    if (! isMaster)
    {
        for (auto* b : { &mute, &solo, &arm }) addAndMakeVisible (b);
        mute.onClick = [this] { track->setMute (! track->isMuted (false)); refresh(); };
        solo.onClick = [this] { track->setSolo (! track->isSolo (false)); refresh(); };
        arm.onClick = [this] { session.setArmed (*track, ! session.isArmed (*track)); refresh(); };
        arm.setVisible (session.kindOf (*track) != TrackKind::ret);
        if (auto lm = track->getLevelMeterPlugin()) meter.setMeasurer (&lm->measurer);

        // sends to every return
        if (session.kindOf (*track) != TrackKind::ret)
            for (auto r : session.returnTracks())
            {
                int bus = session.returnBusOf (*r);
                if (bus < 0) continue;
                auto* k = sendKnobs.add (new Knob (r->getName(), Colours::goldHi));
                k->slider.setTextBoxStyle (juce::Slider::NoTextBox, false, 0, 0);
                k->slider.setPopupDisplayEnabled (true, true, nullptr);
                k->slider.setRange (0.0, 1.0);
                k->slider.setDoubleClickReturnValue (true, 0.0);
                k->slider.textFromValueFunction = [] (double v) { return v <= 0.001 ? juce::String ("-inf") : dbString (te::volumeFaderPositionToDB ((float) v)) + " dB"; };
                k->label.setFont (Fonts::narrow (10.5f));
                k->slider.onValueChange = [this, k, bus]
                {
                    auto v = (float) k->slider.getValue();
                    if (auto send = session.sendFor (*track, bus, v > 0.001f))
                        send->setGainDb (v <= 0.001f ? -100.0f : te::volumeFaderPositionToDB (v));
                };
                k->setTooltip ("Send to " + r->getName());
                addAndMakeVisible (k);
                sendBuses.add (bus);
            }
    }
    buildSlots();
    refresh();
}

te::VolumeAndPanPlugin* ChannelStrip::volumePlugin() const
{
    if (isMaster) return session.edit ? session.edit->getMasterVolumePlugin().get() : nullptr;
    return track->getVolumePlugin();
}

te::PluginList& ChannelStrip::plugins() const
{
    return isMaster ? session.edit->getMasterPluginList() : track->pluginList;
}

void ChannelStrip::buildSlots()
{
    slots.clear();
    juce::String sig;
    if (! isMaster && session.kindOf (*track) == TrackKind::instrument)
    {
        auto inst = trackInstrument (*track);
        addAndMakeVisible (slots.add (new Slot (*this, inst, true)));
        sig << (inst ? inst->itemID.toString() : juce::String ("-")) << ",";
    }
    juce::Array<te::Plugin*> inserts;
    if (isMaster)
    {
        for (auto p : session.edit->getMasterPluginList())
            if (! dynamic_cast<te::VolumeAndPanPlugin*> (p) && ! dynamic_cast<te::LevelMeterPlugin*> (p)) inserts.add (p);
    }
    else inserts = session.insertsOf (*track);
    for (auto p : inserts)
    {
        addAndMakeVisible (slots.add (new Slot (*this, p, false)));
        sig << p->itemID.toString() << (p->isEnabled() ? "+" : "-") << ",";
    }
    addAndMakeVisible (slots.add (new Slot (*this, nullptr, false)));
    slotSignature = sig;
    resized();
}

void ChannelStrip::refresh()
{
    if (session.edit == nullptr) return;
    if (isMaster)
        if (auto ctx = session.edit->getTransport().getCurrentPlaybackContext())
            if (meter.getMeasurer() != &ctx->masterLevels) meter.setMeasurer (&ctx->masterLevels);
    // rebuild the insert list if it changed
    juce::String sig;
    if (! isMaster && session.kindOf (*track) == TrackKind::instrument)
    {
        auto inst = trackInstrument (*track);
        sig << (inst ? inst->itemID.toString() : juce::String ("-")) << ",";
    }
    juce::Array<te::Plugin*> inserts;
    if (isMaster)
    {
        for (auto p : session.edit->getMasterPluginList())
            if (! dynamic_cast<te::VolumeAndPanPlugin*> (p) && ! dynamic_cast<te::LevelMeterPlugin*> (p)) inserts.add (p);
    }
    else inserts = session.insertsOf (*track);
    for (auto p : inserts) sig << p->itemID.toString() << (p->isEnabled() ? "+" : "-") << ",";
    if (sig != slotSignature) buildSlots();

    if (auto vp = volumePlugin())
    {
        if (! fader.isMouseButtonDown()) fader.setValue (vp->getSliderPos(), juce::dontSendNotification);
        if (! pan.isMouseButtonDown()) pan.setValue (vp->getPan(), juce::dontSendNotification);
        dbLabel.setText (dbString (vp->getVolumeDb()), juce::dontSendNotification);
    }
    if (! isMaster)
    {
        mute.setToggleState (track->isMuted (false), juce::dontSendNotification);
        solo.setToggleState (track->isSolo (false), juce::dontSendNotification);
        arm.setToggleState (session.isArmed (*track), juce::dontSendNotification);
        for (int i = 0; i < sendKnobs.size(); ++i)
            if (! sendKnobs[i]->slider.isMouseButtonDown())
            {
                auto send = session.sendFor (*track, sendBuses[i], false);
                auto db = send != nullptr ? send->getGainDb() : -100.0f;
                sendKnobs[i]->slider.setValue (db <= -99.0f ? 0.0 : te::decibelsToVolumeFaderPosition (db), juce::dontSendNotification);
            }
    }
    for (auto* s : slots) s->repaint();
    repaint();
}

void ChannelStrip::paint (juce::Graphics& g)
{
    auto r = getLocalBounds().toFloat().reduced (2.0f, 0);
    bool selected = ! isMaster && session.selection.isSelected (track.get());
    g.setColour (isMaster ? Colours::panel2 : selected ? Colours::panel3 : Colours::panel);
    g.fillRoundedRectangle (r, 5.0f);
    if (selected) { g.setColour (Colours::gold.withAlpha (0.55f)); g.drawRoundedRectangle (r, 5.0f, 1.2f); }
    // name band
    auto band = r.removeFromTop (26.0f);
    auto col = isMaster ? Colours::gold : track->getColour();
    g.setColour (col.withAlpha (0.9f));
    g.fillRoundedRectangle (band.reduced (3.0f, 3.0f), 3.0f);
    g.setColour (col.getPerceivedBrightness() > 0.55f ? Colours::goldText : juce::Colours::white);
    g.setFont (Fonts::semi (12.0f));
    g.drawFittedText (isMaster ? juce::String ("Stereo Out") : track->getName(), band.reduced (6, 3).toNearestInt(), juce::Justification::centred, 1, 0.75f);
    // section labels
    g.setColour (Colours::dim);
    g.setFont (Fonts::narrow (10.0f));
    if (! slots.isEmpty())
        g.drawText ("INSERTS", slots.getFirst()->getBounds().translated (0, -13).withHeight (12), juce::Justification::centredLeft);
    if (! sendKnobs.isEmpty())
        g.drawText ("SENDS", sendKnobs.getFirst()->getBounds().translated (0, -13).withHeight (12).withX (8), juce::Justification::centredLeft);
    // output
    g.setColour (Colours::muted);
    g.drawText (isMaster ? "MASTER" : (session.kindOf (*track) == TrackKind::ret ? "RETURN > OUT" : "> STEREO OUT"),
                getLocalBounds().removeFromBottom (16), juce::Justification::centred);
}

void ChannelStrip::resized()
{
    auto r = getLocalBounds().reduced (6, 0).withTrimmedTop (30).withTrimmedBottom (16);
    r.removeFromTop (12);
    int slotH = 21;
    int maxSlots = 6;
    for (int i = 0; i < slots.size(); ++i)
    {
        if (i < maxSlots + 1) slots[i]->setBounds (r.removeFromTop (slotH));
        else slots[i]->setBounds ({});
    }
    r.removeFromTop (juce::jmax (0, (maxSlots + 1 - slots.size())) * slotH);
    r.removeFromTop (6);
    if (! sendKnobs.isEmpty())
    {
        r.removeFromTop (12);
        auto row = r.removeFromTop (54);
        int w = row.getWidth() / juce::jmax (1, juce::jmin (2, sendKnobs.size()));
        for (int i = 0; i < sendKnobs.size(); ++i)
        {
            if (i > 0 && i % 2 == 0) row = r.removeFromTop (54);
            sendKnobs[i]->setBounds (row.removeFromLeft (w));
        }
    }
    else r.removeFromTop (66);
    r.removeFromTop (2);
    pan.setBounds (r.removeFromTop (40).withSizeKeepingCentre (40, 40));
    r.removeFromTop (4);
    auto btns = r.removeFromBottom (22);
    if (! isMaster)
    {
        int bw = (btns.getWidth() - 4) / 3;
        mute.setBounds (btns.removeFromLeft (bw)); btns.removeFromLeft (2);
        solo.setBounds (btns.removeFromLeft (bw)); btns.removeFromLeft (2);
        arm.setBounds (btns);
    }
    r.removeFromBottom (4);
    dbLabel.setBounds (r.removeFromTop (18).reduced (8, 0));
    r.removeFromTop (4);
    auto meterArea = r.removeFromRight (16);
    meter.setBounds (meterArea);
    fader.setBounds (r);
}

void ChannelStrip::mouseDown (const juce::MouseEvent& e)
{
    if (isMaster) return;
    session.selectTrack (track.get());
    if (e.mods.isPopupMenu())
    {
        juce::PopupMenu m;
        auto t = track;
        m.addItem ("Colour...", [this, t] { showColourMenu (this, [t] (juce::Colour c) { t->setColour (c); }); });
        m.addItem ("Delete", [t, &s = session] { juce::MessageManager::callAsync ([t, &s] { s.deleteTrack (*t); }); });
        m.showMenuAsync ({});
    }
}

bool ChannelStrip::isInterestedInDragSource (const SourceDetails& d)  { return pluginFromDrag (session.engine, d.description).has_value(); }

void ChannelStrip::itemDropped (const SourceDetails& d)
{
    auto c = pluginFromDrag (session.engine, d.description);
    if (! c) return;
    if (isMaster)
    {
        if (auto p = createPlugin (*session.edit, *c))
            session.edit->getMasterPluginList().insertPlugin (p, juce::jmax (0, session.edit->getMasterPluginList().size() - 1), nullptr);
    }
    else session.insertPlugin (*track, *c);
}

//==============================================================================
MixerView::MixerView (Session& s) : session (s)
{
    viewport.setViewedComponent (&content, false);
    viewport.setScrollBarsShown (false, true);
    addAndMakeVisible (viewport);
    addReturn.onClick = [this]
    {
        juce::PopupMenu m;
        auto add = [this] (const char* name, const char* fx) { session.addReturnTrack (name, fx); };
        m.addItem ("Reverb return (Lush Hall)", [add] { add ("Reverb", "motion:fx:lush-hall"); });
        m.addItem ("Plate return (Vocal Plate)", [add] { add ("Plate", "motion:fx:vocal-plate"); });
        m.addItem ("Delay return (Dotted Eighth)", [add] { add ("Delay", "motion:fx:dotted-eighth"); });
        m.addItem ("Shimmer return (Worship Shimmer)", [add] { add ("Shimmer", "motion:fx:worship-shimmer"); });
        m.addItem ("Empty return", [add] { add ("Return", ""); });
        m.showMenuAsync (juce::PopupMenu::Options().withTargetComponent (&addReturn));
    };
    content.addAndMakeVisible (addReturn);
    session.addListener (this);
    rebuild();
    startTimerHz (10);
}

MixerView::~MixerView()  { session.removeListener (this); }

void MixerView::rebuild()
{
    strips.clear();
    master.reset();
    if (! session.edit) return;
    for (auto t : session.tracks())
        content.addAndMakeVisible (strips.add (new ChannelStrip (session, t)));
    master = std::make_unique<ChannelStrip> (session, nullptr);
    addAndMakeVisible (*master);
    resized();
}

void MixerView::paint (juce::Graphics& g)
{
    g.fillAll (Colours::bg);
}

void MixerView::resized()
{
    auto r = getLocalBounds().reduced (6);
    if (master)
    {
        master->setBounds (r.removeFromRight (ChannelStrip::width + 8));
        r.removeFromRight (6);
    }
    viewport.setBounds (r);
    int x = 0, h = r.getHeight() - (viewport.isHorizontalScrollBarShown() ? 12 : 0);
    bool sawReturn = false;
    for (auto* s : strips)
    {
        if (! sawReturn && session.kindOf (*s->track) == TrackKind::ret) { x += 10; sawReturn = true; }
        s->setBounds (x, 0, ChannelStrip::width, h);
        x += ChannelStrip::width;
    }
    addReturn.setBounds (x + 8, 6, 84, 26);
    content.setSize (juce::jmax (x + 100, r.getWidth()), h);
}

void MixerView::timerCallback()
{
    if (! isShowing()) return;
    for (auto* s : strips) s->refresh();
    if (master) master->refresh();
    if (session.edit)
        if (auto ctx = session.edit->getTransport().getCurrentPlaybackContext())
            juce::ignoreUnused (ctx);
}

} // namespace ms
