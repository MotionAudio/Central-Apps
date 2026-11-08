#include "SessionView.h"
#include "ArrangeView.h"
#include "MotionPlugins.h"

namespace ms
{

SessionView::SessionView (Session& s) : session (s)
{
    quantise.addItem ("Launch: immediately", 1);
    quantise.addItem ("Launch: next bar", 2);
    quantise.addItem ("Launch: next 2 bars", 3);
    quantise.addItem ("Launch: next 4 bars", 4);
    quantise.addItem ("Launch: next beat", 5);
    quantise.setSelectedId (2, juce::dontSendNotification);
    quantise.onChange = [this]
    {
        if (! session.edit) return;
        static const te::LaunchQType q[] = { te::LaunchQType::none, te::LaunchQType::bar, te::LaunchQType::twoBars, te::LaunchQType::fourBars, te::LaunchQType::quarter };
        session.edit->getLaunchQuantisation().type = q[quantise.getSelectedId() - 1];
    };
    addAndMakeVisible (quantise);
    stopAllBtn.onClick = [this] { stopAll(); };
    addAndMakeVisible (stopAllBtn);
    backToArrange.setTooltip ("Stop the launched clips and let every track play its timeline again");
    backToArrange.onClick = [this]
    {
        stopAll();
        for (auto t : session.tracks()) t->playSlotClips = false;
    };
    addAndMakeVisible (backToArrange);
    addScene.onClick = [this] { if (session.edit) session.edit->getSceneList().insertScene (-1); repaint(); };
    addAndMakeVisible (addScene);
    session.addListener (this);
    ensureScenes();
    startTimerHz (20);
}

SessionView::~SessionView()  { session.removeListener (this); }

void SessionView::ensureScenes()
{
    if (! session.edit) return;
    auto& scenes = session.edit->getSceneList();
    scenes.ensureNumberOfScenes (juce::jmax (8, scenes.getNumScenes()));
    for (auto t : session.tracks())
        t->getClipSlotList().ensureNumberOfSlots (scenes.getNumScenes());
}

te::ClipSlot* SessionView::slotAt (int track, int scene) const
{
    auto tracks = visibleTracks (session);
    if (! juce::isPositiveAndBelow (track, tracks.size())) return nullptr;
    auto slots = tracks[track]->getClipSlotList().getClipSlots();
    return slots[scene];
}

std::optional<te::MonotonicBeat> SessionView::nextLaunchBeat()
{
    if (! session.edit) return std::nullopt;
    auto& tp = session.edit->getTransport();
    if (! tp.isPlaying()) return std::nullopt;
    auto q = session.edit->getLaunchQuantisation().type.get();
    if (q == te::LaunchQType::none) return std::nullopt;
    if (auto epc = tp.getCurrentPlaybackContext())
        if (auto sp = epc->getSyncPoint())
        {
            auto next = te::getNext (q, session.edit->tempoSequence, sp->beat);
            return te::MonotonicBeat { sp->monotonicBeat.v + (next - sp->beat) };
        }
    return std::nullopt;
}

void SessionView::launch (te::AudioTrack& t, int scene)
{
    auto slots = t.getClipSlotList().getClipSlots();
    auto slot = slots[scene];
    if (slot == nullptr) return;
    auto clip = slot->getClip();
    if (clip == nullptr) { stopTrack (t); return; }
    auto handle = clip->getLaunchHandle();
    if (! handle) return;
    t.playSlotClips = true;
    auto& tp = session.edit->getTransport();
    bool wasStopped = ! tp.isPlaying();
    if (wasStopped) tp.play (false);
    auto when = wasStopped ? std::optional<te::MonotonicBeat>() : nextLaunchBeat();
    // only one clip per track plays: queue a stop on the others
    for (auto other : slots)
        if (other != slot)
            if (auto oc = other->getClip())
                if (auto oh = oc->getLaunchHandle())
                    if (oh->getPlayingStatus() == te::LaunchHandle::PlayState::playing || oh->getQueuedStatus())
                        oh->stop (when);
    handle->play (when);
}

void SessionView::stopTrack (te::AudioTrack& t)
{
    auto when = nextLaunchBeat();
    for (auto slot : t.getClipSlotList().getClipSlots())
        if (auto c = slot->getClip())
            if (auto h = c->getLaunchHandle())
                if (h->getPlayingStatus() == te::LaunchHandle::PlayState::playing || h->getQueuedStatus())
                    h->stop (when);
}

void SessionView::launchScene (int scene)
{
    auto tracks = visibleTracks (session);
    for (auto t : tracks) launch (*t, scene);
}

void SessionView::stopAll()
{
    for (auto t : session.tracks()) stopTrack (*t);
}

bool SessionView::cellAt (juce::Point<int> p, int& track, int& scene, bool& onPlay) const
{
    if (! grid.contains (p)) return false;
    auto local = p - grid.getPosition() + juce::Point<int> (scrollX, scrollY);
    track = local.x / colW;
    scene = local.y / rowH;
    onPlay = (local.x % colW) < 24;
    return true;
}

void SessionView::timerCallback()
{
    pulse += 0.12f;
    if (isShowing()) repaint (grid.expanded (0, footH).withRight (getWidth()));
}

void SessionView::paint (juce::Graphics& g)
{
    g.fillAll (Colours::bg);
    if (! session.edit) return;
    auto tracks = visibleTracks (session);
    auto& scenes = session.edit->getSceneList();
    int numScenes = scenes.getNumScenes();
    float glow = 0.5f + 0.5f * std::sin (pulse * 3.0f);

    // track names
    {
        juce::Graphics::ScopedSaveState ss (g);
        g.reduceClipRegion (grid.withY (grid.getY() - headH).withHeight (headH));
        for (int i = 0; i < tracks.size(); ++i)
        {
            auto r = juce::Rectangle<int> (grid.getX() + i * colW - scrollX, grid.getY() - headH, colW, headH).reduced (2, 3);
            auto col = tracks[i]->getColour();
            g.setColour (col.withAlpha (0.9f));
            g.fillRoundedRectangle (r.toFloat(), 4.0f);
            g.setColour (col.getPerceivedBrightness() > 0.55f ? Colours::goldText : juce::Colours::white);
            g.setFont (Fonts::semi (12.5f));
            g.drawFittedText (tracks[i]->getName(), r.reduced (6, 0), juce::Justification::centredLeft, 1, 0.8f);
            if (tracks[i]->playSlotClips.get())
            {
                g.setFont (Fonts::narrow (10.0f));
                g.drawText ("LIVE", r.reduced (6, 0), juce::Justification::centredRight);
            }
        }
    }

    // slots
    {
        juce::Graphics::ScopedSaveState ss (g);
        g.reduceClipRegion (grid);
        for (int ti = 0; ti < tracks.size(); ++ti)
        {
            auto slots = tracks[ti]->getClipSlotList().getClipSlots();
            bool isInst = session.kindOf (*tracks[ti]) == TrackKind::instrument;
            for (int si = 0; si < numScenes; ++si)
            {
                auto r = juce::Rectangle<int> (grid.getX() + ti * colW - scrollX, grid.getY() + si * rowH - scrollY, colW, rowH).reduced (2);
                if (! r.intersects (grid)) continue;
                auto slot = slots[si];
                auto clip = slot != nullptr ? slot->getClip() : nullptr;
                if (clip == nullptr)
                {
                    g.setColour (Colours::panel);
                    g.fillRoundedRectangle (r.toFloat(), 3.0f);
                    g.setColour (Colours::line);
                    g.drawRoundedRectangle (r.toFloat().reduced (0.5f), 3.0f, 1.0f);
                    // a stop square, as in Ableton
                    g.setColour (Colours::dim);
                    g.fillRect (juce::Rectangle<int> (7, 7).withCentre ({ r.getX() + 12, r.getCentreY() }));
                    if (isInst)
                    {
                        g.setColour (Colours::line2);
                        g.setFont (Fonts::ui (13.0f));
                        g.drawText ("+", r.withTrimmedRight (8), juce::Justification::centredRight);
                    }
                    continue;
                }
                auto handle = clip->getLaunchHandle();
                bool playing = handle && handle->getPlayingStatus() == te::LaunchHandle::PlayState::playing;
                auto queued = handle ? handle->getQueuedStatus() : std::optional<te::LaunchHandle::QueueState>();
                auto col = clip->getColour();
                bool selected = session.selection.isSelected (clip);
                g.setColour (playing ? col.brighter (0.1f) : col.darker (0.5f));
                g.fillRoundedRectangle (r.toFloat(), 3.0f);
                if (playing)
                {
                    // progress through the clip
                    if (auto range = handle->getPlayedRange())
                    {
                        auto len = juce::jmax (0.001, clip->getLengthInBeats().inBeats());
                        auto played = range->getLength().inBeats();
                        auto frac = (float) std::fmod (played, len) / (float) len;
                        g.setColour (juce::Colours::white.withAlpha (0.18f));
                        g.fillRect (r.withWidth ((int) (r.getWidth() * frac)).withTrimmedTop (r.getHeight() - 4));
                    }
                }
                if (queued)
                {
                    g.setColour ((queued == te::LaunchHandle::QueueState::playQueued ? Colours::goldHi : Colours::live).withAlpha (glow));
                    g.drawRoundedRectangle (r.toFloat().reduced (1.0f), 3.0f, 2.0f);
                }
                if (selected)
                {
                    g.setColour (Colours::goldHi);
                    g.drawRoundedRectangle (r.toFloat(), 3.0f, 1.5f);
                }
                // play triangle
                juce::Path tri;
                auto c = juce::Point<float> ((float) r.getX() + 12.0f, (float) r.getCentreY());
                tri.addTriangle (c.x - 4, c.y - 5, c.x - 4, c.y + 5, c.x + 5, c.y);
                g.setColour (playing ? Colours::goldText : juce::Colours::white.withAlpha (0.85f));
                g.fillPath (tri);
                g.setColour (col.getPerceivedBrightness() > 0.55f && playing ? Colours::goldText : juce::Colours::white);
                g.setFont (Fonts::semi (11.5f));
                g.drawFittedText (clip->getName(), r.withTrimmedLeft (24).reduced (2, 0), juce::Justification::centredLeft, 1, 0.8f);
            }
        }
    }

    // scene column
    auto sceneX = getWidth() - sceneColW - 8;
    g.setColour (Colours::panel2);
    g.fillRect (sceneX - 4, grid.getY() - headH, sceneColW + 12, grid.getHeight() + headH);
    g.setColour (Colours::gold);
    g.setFont (Fonts::narrow (12.0f));
    g.drawText ("SCENES", sceneX, grid.getY() - headH, sceneColW, headH, juce::Justification::centred);
    {
        juce::Graphics::ScopedSaveState ss (g);
        g.reduceClipRegion (juce::Rectangle<int> (sceneX - 4, grid.getY(), sceneColW + 12, grid.getHeight()));
        for (int si = 0; si < numScenes; ++si)
        {
            auto r = juce::Rectangle<int> (sceneX, grid.getY() + si * rowH - scrollY, sceneColW, rowH).reduced (2);
            g.setColour (Colours::panel3);
            g.fillRoundedRectangle (r.toFloat(), 3.0f);
            juce::Path tri;
            auto c = juce::Point<float> ((float) r.getX() + 12.0f, (float) r.getCentreY());
            tri.addTriangle (c.x - 4, c.y - 5, c.x - 4, c.y + 5, c.x + 5, c.y);
            g.setColour (Colours::gold);
            g.fillPath (tri);
            g.setColour (Colours::text);
            g.setFont (Fonts::ui (12.0f));
            auto name = scenes.getScenes()[si]->name.get();
            g.drawText (name.isNotEmpty() ? name : "Scene " + juce::String (si + 1), r.withTrimmedLeft (24), juce::Justification::centredLeft);
        }
    }

    // stop buttons under each track
    auto footY = grid.getBottom() + 2;
    for (int ti = 0; ti < tracks.size(); ++ti)
    {
        auto r = juce::Rectangle<int> (grid.getX() + ti * colW - scrollX, footY, colW, footH - 4).reduced (2);
        if (r.getRight() > sceneX - 6) break;
        g.setColour (Colours::panel2);
        g.fillRoundedRectangle (r.toFloat(), 3.0f);
        g.setColour (Colours::muted);
        g.fillRect (juce::Rectangle<int> (8, 8).withCentre (r.getCentre()));
    }
    if (tracks.isEmpty())
    {
        g.setColour (Colours::muted);
        g.setFont (Fonts::ui (15.0f));
        g.drawText ("Add tracks in the Tracks view, then drop loops here or double-click a slot on an instrument track.", grid, juce::Justification::centred);
    }
}

void SessionView::resized()
{
    auto r = getLocalBounds().reduced (8);
    auto top = r.removeFromTop (30);
    quantise.setBounds (top.removeFromLeft (190));
    top.removeFromLeft (8);
    stopAllBtn.setBounds (top.removeFromLeft (120));
    top.removeFromLeft (6);
    backToArrange.setBounds (top.removeFromLeft (130));
    addScene.setBounds (top.removeFromRight (90));
    r.removeFromTop (8 + headH);
    r.removeFromRight (sceneColW + 16);
    r.removeFromBottom (footH);
    grid = r;
}

void SessionView::mouseWheelMove (const juce::MouseEvent& e, const juce::MouseWheelDetails& w)
{
    if (! session.edit) return;
    auto maxY = juce::jmax (0, session.edit->getSceneList().getNumScenes() * rowH - grid.getHeight());
    auto maxX = juce::jmax (0, visibleTracks (session).size() * colW - grid.getWidth());
    if (e.mods.isShiftDown() || w.deltaX != 0) scrollX = juce::jlimit (0, maxX, scrollX - (int) ((w.deltaX != 0 ? w.deltaX : w.deltaY) * 200));
    else scrollY = juce::jlimit (0, maxY, scrollY - (int) (w.deltaY * 200));
    repaint();
}

void SessionView::mouseDown (const juce::MouseEvent& e)
{
    if (! session.edit) return;
    auto tracks = visibleTracks (session);
    auto sceneX = getWidth() - sceneColW - 8;
    // scene launch
    if (e.x >= sceneX && e.y >= grid.getY() && e.y < grid.getBottom())
    {
        int si = (e.y - grid.getY() + scrollY) / rowH;
        if (si < session.edit->getSceneList().getNumScenes())
        {
            if (e.mods.isPopupMenu())
            {
                juce::PopupMenu m;
                auto scene = session.edit->getSceneList().getScenes()[si];
                m.addItem ("Rename scene...", [scene]
                {
                    auto* w = new juce::AlertWindow ("Rename scene", {}, juce::MessageBoxIconType::NoIcon);
                    w->addTextEditor ("name", scene->name.get());
                    w->addButton ("OK", 1, juce::KeyPress (juce::KeyPress::returnKey));
                    w->addButton ("Cancel", 0);
                    w->enterModalState (true, juce::ModalCallbackFunction::create ([w, scene] (int r) { if (r == 1) scene->name = w->getTextEditorContents ("name"); }), true);
                });
                m.addItem ("Delete scene", [this, scene] { session.edit->getSceneList().deleteScene (*scene); repaint(); });
                m.showMenuAsync ({});
            }
            else launchScene (si);
        }
        return;
    }
    // stop buttons
    if (e.y > grid.getBottom() && e.y < grid.getBottom() + footH)
    {
        int ti = (e.x - grid.getX() + scrollX) / colW;
        if (juce::isPositiveAndBelow (ti, tracks.size())) stopTrack (*tracks[ti]);
        return;
    }
    int ti, si; bool onPlay;
    if (! cellAt (e.getPosition(), ti, si, onPlay) || ! juce::isPositiveAndBelow (ti, tracks.size())) return;
    auto slot = slotAt (ti, si);
    if (slot == nullptr) return;
    auto clip = slot->getClip();
    session.selectTrack (tracks[ti]);
    if (e.mods.isPopupMenu())
    {
        juce::PopupMenu m;
        if (clip != nullptr)
        {
            m.addItem ("Edit", [this, clip] { if (onOpenClip) onOpenClip (clip); });
            m.addItem ("Copy to the timeline at the playhead", [this, clip, t = tracks[ti]]
            {
                auto state = clip->state.createCopy();
                te::EditItemID::remapIDs (state, nullptr, *session.edit);
                if (auto c = t->insertClipWithState (state))
                {
                    c->setStart (session.edit->getTransport().getPosition(), false, true);
                    c->disableLooping();
                }
            });
            m.addItem ("Delete", [clip] { clip->removeFromParent(); });
        }
        else if (session.kindOf (*tracks[ti]) == TrackKind::instrument)
            m.addItem ("New MIDI clip (1 bar)", [this, slot, t = tracks[ti]]
            {
                if (auto c = te::insertMIDIClip (*slot, { 0s, session.edit->tempoSequence.toTime (te::BeatPosition::fromBeats (session.beatsPerBar())) }))
                { c->setColour (t->getColour()); c->setName (t->getName()); if (onOpenClip) onOpenClip (c.get()); }
            });
        m.showMenuAsync ({});
        return;
    }
    if (clip == nullptr) { if (onPlay) stopTrack (*tracks[ti]); return; }
    session.selection.selectOnly (clip);
    if (onPlay) launch (*tracks[ti], si);
}

void SessionView::mouseDoubleClick (const juce::MouseEvent& e)
{
    auto tracks = visibleTracks (session);
    int ti, si; bool onPlay;
    if (! cellAt (e.getPosition(), ti, si, onPlay) || ! juce::isPositiveAndBelow (ti, tracks.size())) return;
    auto slot = slotAt (ti, si);
    if (slot == nullptr) return;
    if (auto clip = slot->getClip()) { if (onOpenClip) onOpenClip (clip); return; }
    if (session.kindOf (*tracks[ti]) != TrackKind::instrument) return;
    auto len = session.edit->tempoSequence.toTime (te::BeatPosition::fromBeats (session.beatsPerBar()));
    if (auto c = te::insertMIDIClip (*slot, { 0s, len }))
    {
        c->setColour (tracks[ti]->getColour());
        c->setName (tracks[ti]->getName() + " " + juce::String (si + 1));
        session.selection.selectOnly (c.get());
        if (onOpenClip) onOpenClip (c.get());
    }
}

void SessionView::dropFile (const juce::File& f, int ti, int si)
{
    auto slot = slotAt (ti, si);
    if (slot == nullptr) return;
    auto tracks = visibleTracks (session);
    if (f.hasFileExtension ("mid;midi"))
    {
        juce::FileInputStream in (f);
        juce::MidiFile mf;
        if (! in.openedOk() || ! mf.readFrom (in)) return;
        mf.convertTimestampTicksToSeconds();
        juce::MidiMessageSequence all;
        for (int i = 0; i < mf.getNumTracks(); ++i) all.addSequence (*mf.getTrack (i), 0.0);
        all.updateMatchedPairs();
        auto len = juce::jmax (1.0, all.getEndTime());
        if (auto c = te::insertMIDIClip (*slot, f.getFileNameWithoutExtension(), { 0s, te::TimePosition::fromSeconds (len) }))
        {
            c->getSequence().importMidiSequence (all, session.edit.get(), 0s, nullptr);
            c->setColour (tracks[ti]->getColour());
        }
        return;
    }
    te::AudioFile af (session.engine, f);
    if (! af.isValid()) return;
    if (auto c = te::insertWaveClip (*slot, f.getFileNameWithoutExtension(), f, { { 0s, te::TimeDuration::fromSeconds (af.getLength()) }, {} }, te::DeleteExistingClips::yes))
        c->setColour (tracks[ti]->getColour());
}

bool SessionView::isInterestedInDragSource (const SourceDetails& d)  { return fileFromDrag (d.description).existsAsFile(); }

void SessionView::itemDropped (const SourceDetails& d)
{
    int ti, si; bool onPlay;
    if (cellAt (d.localPosition, ti, si, onPlay)) dropFile (fileFromDrag (d.description), ti, si);
}

void SessionView::filesDropped (const juce::StringArray& files, int x, int y)
{
    int ti, si; bool onPlay;
    if (! cellAt ({ x, y }, ti, si, onPlay)) return;
    for (auto& p : files) { dropFile (juce::File (p), ti, si); ++si; }
}

} // namespace ms
