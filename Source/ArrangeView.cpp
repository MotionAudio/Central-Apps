#include "ArrangeView.h"
#include "MotionPlugins.h"

namespace ms
{

juce::Array<te::AudioTrack*> visibleTracks (Session& s)
{
    juce::Array<te::AudioTrack*> r;
    for (auto t : s.tracks()) if (s.kindOf (*t) != TrackKind::ret) r.add (t);
    return r;
}

static void drawGrid (juce::Graphics& g, Session& s, const TimelineMap& m, juce::Rectangle<int> area, bool strong)
{
    auto bar = s.beatsPerBar();
    auto first = std::floor (m.xToBeat (area.getX()));
    auto last = m.xToBeat (area.getRight()) + 1;
    double step = s.pixelsPerBeat < 6 ? bar * (s.pixelsPerBeat * bar < 24 ? 4 : 1) : 1.0;
    if (s.pixelsPerBeat > 60) step = 0.25;
    first = std::floor (first / step) * step;
    for (double b = first; b <= last; b += step)
    {
        auto x = (float) m.beatToX (b);
        bool isBar = std::fmod (b, bar) < 0.0001;
        g.setColour (isBar ? Colours::line.withAlpha (strong ? 1.0f : 0.8f) : Colours::line.withAlpha (0.35f));
        g.fillRect (x, (float) area.getY(), 1.0f, (float) area.getHeight());
    }
}

//==============================================================================
Ruler::Ruler (Session& s) : session (s) {}

void Ruler::paint (juce::Graphics& g)
{
    g.fillAll (Colours::panel);
    if (! session.edit) return;
    TimelineMap m { session, originX };
    auto bar = session.beatsPerBar();
    auto r = getLocalBounds();

    // cycle range
    auto& tp = session.edit->getTransport();
    auto lr = tp.getLoopRange();
    if (lr.getLength() > 0s)
    {
        auto x1 = (float) m.timeToX (lr.getStart()), x2 = (float) m.timeToX (lr.getEnd());
        auto band = juce::Rectangle<float> (x1, 2.0f, x2 - x1, (float) getHeight() * 0.42f);
        g.setColour (tp.looping ? Colours::gold.withAlpha (0.85f) : Colours::line2);
        g.fillRoundedRectangle (band, 3.0f);
        g.setColour (tp.looping ? Colours::goldText : Colours::muted);
        g.setFont (Fonts::narrow (10.5f));
        if (band.getWidth() > 40) g.drawText ("CYCLE", band.reduced (6, 0), juce::Justification::centredLeft);
    }

    // bars and beats
    double labelEvery = 1;
    auto pxPerBar = session.pixelsPerBeat * bar;
    while (pxPerBar * labelEvery < 44) labelEvery *= 2;
    auto firstBar = std::floor (m.xToBeat (originX) / bar);
    auto lastBar = m.xToBeat (getWidth()) / bar + 1;
    g.setFont (Fonts::semi (12.0f));
    for (double b = juce::jmax (0.0, firstBar); b <= lastBar; b += 1)
    {
        auto x = (float) m.beatToX (b * bar);
        if (x < originX - 1) continue;
        bool labelled = std::fmod (b, labelEvery) < 0.001;
        g.setColour (labelled ? Colours::muted : Colours::line2);
        g.fillRect (x, (float) getHeight() * (labelled ? 0.45f : 0.7f), 1.0f, (float) getHeight());
        if (labelled)
        {
            g.setColour (Colours::text.withAlpha (0.85f));
            g.drawText (juce::String ((int) b + 1), (int) x + 4, getHeight() / 2 - 2, 40, getHeight() / 2, juce::Justification::centredLeft);
        }
        if (pxPerBar > 60)
            for (int beat = 1; beat < (int) bar; ++beat)
            {
                auto bx = (float) m.beatToX (b * bar + beat);
                g.setColour (Colours::line);
                g.fillRect (bx, (float) getHeight() * 0.8f, 1.0f, (float) getHeight());
            }
    }
    // playhead marker
    auto px = (float) m.timeToX (tp.getPosition());
    if (px >= originX)
    {
        juce::Path tri;
        tri.addTriangle (px - 6, (float) getHeight() - 9, px + 6, (float) getHeight() - 9, px, (float) getHeight());
        g.setColour (Colours::goldHi);
        g.fillPath (tri);
    }
    g.setColour (Colours::line);
    g.fillRect (0, getHeight() - 1, getWidth(), 1);
    // the corner over the track headers
    g.setColour (Colours::panel2);
    g.fillRect (r.withWidth (originX));
    g.setColour (Colours::line);
    g.fillRect (originX - 1, 0, 1, getHeight());
    g.setColour (Colours::muted);
    g.setFont (Fonts::narrow (11.0f));
    g.drawText (session.edit ? juce::String (visibleTracks (session).size()) + " TRACKS" : juce::String(), r.withWidth (originX).reduced (12, 0), juce::Justification::centredLeft);
}

void Ruler::mouseDown (const juce::MouseEvent& e)
{
    if (! session.edit || e.x < originX) return;
    TimelineMap m { session, originX };
    auto beat = juce::jmax (0.0, session.snapBeat (te::BeatPosition::fromBeats (m.xToBeat (e.x))).inBeats());
    auto& tp = session.edit->getTransport();
    auto& ts = session.edit->tempoSequence;
    dragStartBeat = beat;
    if (e.y < getHeight() * 0.48f)
    {
        auto lr = tp.getLoopRange();
        auto ls = ts.toBeats (lr.getStart()).inBeats(), le = ts.toBeats (lr.getEnd()).inBeats();
        loopStartBeat = ls; loopEndBeat = le;
        auto x1 = m.beatToX (ls), x2 = m.beatToX (le);
        if (lr.getLength() > 0s && std::abs (e.x - x1) < 6) drag = Drag::loopStart;
        else if (lr.getLength() > 0s && std::abs (e.x - x2) < 6) drag = Drag::loopEnd;
        else if (lr.getLength() > 0s && e.x > x1 && e.x < x2) drag = Drag::moveLoop;
        else drag = Drag::newLoop;
    }
    else
    {
        drag = Drag::locate;
        tp.setPosition (ts.toTime (te::BeatPosition::fromBeats (beat)));
    }
}

void Ruler::mouseDrag (const juce::MouseEvent& e)
{
    if (! session.edit) return;
    TimelineMap m { session, originX };
    auto beat = juce::jmax (0.0, session.snapBeat (te::BeatPosition::fromBeats (m.xToBeat (e.x))).inBeats());
    auto& tp = session.edit->getTransport();
    auto& ts = session.edit->tempoSequence;
    auto setLoop = [&] (double a, double b)
    {
        if (b < a) std::swap (a, b);
        if (b - a < 0.25) return;
        tp.setLoopRange ({ ts.toTime (te::BeatPosition::fromBeats (a)), ts.toTime (te::BeatPosition::fromBeats (b)) });
        tp.looping = true;
    };
    switch (drag)
    {
        case Drag::locate:   tp.setPosition (ts.toTime (te::BeatPosition::fromBeats (beat))); break;
        case Drag::newLoop:  setLoop (dragStartBeat, beat); break;
        case Drag::moveLoop: { auto d = beat - dragStartBeat; d = juce::jmax (d, -loopStartBeat); setLoop (loopStartBeat + d, loopEndBeat + d); break; }
        case Drag::loopStart: setLoop (beat, loopEndBeat); break;
        case Drag::loopEnd:   setLoop (loopStartBeat, beat); break;
        default: break;
    }
    repaint();
}

void Ruler::mouseUp (const juce::MouseEvent&)  { drag = Drag::none; }

void Ruler::mouseDoubleClick (const juce::MouseEvent& e)
{
    if (! session.edit || e.y >= getHeight() * 0.48f) return;
    auto& tp = session.edit->getTransport();
    tp.looping = ! tp.looping.get();
    repaint();
}

void Ruler::mouseWheelMove (const juce::MouseEvent& e, const juce::MouseWheelDetails& w)
{
    if (onWheel) onWheel (e, w);
}

//==============================================================================
ClipComponent::ClipComponent (Session& s, ArrangeView& v, te::Clip::Ptr c) : clip (c), session (s), view (v)
{
    updateThumbnail();
}

ClipComponent::~ClipComponent() = default;

void ClipComponent::updateThumbnail()
{
    if (auto wac = dynamic_cast<te::WaveAudioClip*> (clip.get()))
    {
        te::AudioFile af (wac->getAudioFile());
        if (af.isValid())
        {
            te::AudioFile proxy (wac->getPlaybackFile());
            if (thumbnail == nullptr) thumbnail = std::make_unique<te::SmartThumbnail> (session.engine, proxy, *this, session.edit.get());
            else thumbnail->setNewFile (proxy);
        }
    }
}

void ClipComponent::paint (juce::Graphics& g)
{
    auto r = getLocalBounds().toFloat().reduced (0.5f, 1.0f);
    auto col = clip->getColour();
    bool selected = session.selection.isSelected (clip.get());
    bool muted = clip->isMuted();
    auto body = col.withMultipliedSaturation (0.75f).darker (0.65f).withAlpha (muted ? 0.4f : 0.92f);
    g.setColour (body);
    g.fillRoundedRectangle (r, 4.0f);
    auto title = r.withHeight (juce::jmin (16.0f, r.getHeight() * 0.3f));
    g.setColour (col.withAlpha (muted ? 0.4f : 0.95f));
    g.fillRoundedRectangle (title.withHeight (title.getHeight() + 4.0f), 4.0f);
    g.setColour (body);
    g.fillRect (title.withTop (title.getBottom()).withHeight (4.0f));
    g.setColour (col.getPerceivedBrightness() > 0.55f ? Colours::goldText : juce::Colours::white);
    g.setFont (Fonts::semi (11.5f));
    g.drawText (clip->getName(), title.reduced (5, 0).toNearestInt(), juce::Justification::centredLeft, true);

    auto content = r.withTrimmedTop (title.getHeight() + 1).reduced (1.0f, 2.0f);
    auto contentCol = col.brighter (0.4f).withAlpha (muted ? 0.35f : 0.9f);
    if (auto wac = dynamic_cast<te::WaveAudioClip*> (clip.get()))
    {
        if (thumbnail != nullptr)
        {
            g.setColour (contentCol);
            auto pos = clip->getPosition();
            auto len = pos.getLength();
            auto speed = wac->getSpeedRatio();
            te::TimeRange tr { te::TimePosition() + pos.getOffset() * speed, te::TimePosition() + (pos.getOffset() + len) * speed };
            if (wac->getAutoTempo() || wac->isLooping())
                tr = { te::TimePosition(), te::TimePosition() + te::TimeDuration::fromSeconds (thumbnail->getTotalLength()) };
            auto gain = juce::Decibels::decibelsToGain (wac->getGainDB());
            if (thumbnail->getNumChannels() > 1 && content.getHeight() > 30)
            {
                auto top = content.withHeight (content.getHeight() / 2);
                thumbnail->drawChannel (g, top.toNearestInt(), tr, 0, gain);
                thumbnail->drawChannel (g, content.withTrimmedTop (top.getHeight()).toNearestInt(), tr, 1, gain);
            }
            else
                thumbnail->drawChannel (g, content.toNearestInt(), tr, 0, gain);
            if (thumbnail->isGeneratingProxy())
            {
                g.setColour (Colours::text.withAlpha (0.6f));
                g.setFont (Fonts::ui (11.0f));
                g.drawText ("Reading...", content, juce::Justification::centred);
            }
        }
        // fades
        auto fi = wac->getFadeIn().inSeconds(), fo = wac->getFadeOut().inSeconds();
        auto pxPerSec = session.pixelsPerBeat * session.edit->tempoSequence.getBpmAt (clip->getPosition().getStart()) / 60.0;
        g.setColour (Colours::goldHi.withAlpha (0.85f));
        if (fi > 0) g.drawLine (r.getX(), r.getBottom(), r.getX() + (float) (fi * pxPerSec), r.getY() + 2, 1.4f);
        if (fo > 0) g.drawLine (r.getRight() - (float) (fo * pxPerSec), r.getY() + 2, r.getRight(), r.getBottom(), 1.4f);
        // fade handles
        g.fillRect (r.getX() + (float) (fi * pxPerSec) - 2.0f, r.getY() + 1.0f, 4.0f, 4.0f);
        g.fillRect (r.getRight() - (float) (fo * pxPerSec) - 2.0f, r.getY() + 1.0f, 4.0f, 4.0f);
    }
    else if (auto mc = dynamic_cast<te::MidiClip*> (clip.get()))
    {
        auto& seq = mc->getSequence();
        int lo = 127, hi = 0;
        for (auto n : seq.getNotes()) { lo = juce::jmin (lo, n->getNoteNumber()); hi = juce::jmax (hi, n->getNoteNumber()); }
        if (hi < lo) { lo = 48; hi = 72; }
        if (hi - lo < 12) { auto mid = (hi + lo) / 2; lo = mid - 6; hi = mid + 6; }
        auto startBeat = mc->getStartBeat().inBeats();
        auto offsetBeats = mc->getOffsetInBeats().inBeats();
        auto lenBeats = (mc->getEndBeat() - mc->getStartBeat()).inBeats();
        auto noteH = juce::jmax (1.5f, content.getHeight() / (float) (hi - lo + 1));
        g.setColour (contentCol);
        auto drawPass = [&] (double loopStart, double loopLen)
        {
            for (auto n : seq.getNotes())
            {
                auto s = n->getStartBeat().inBeats() - offsetBeats - loopStart, e = n->getEndBeat().inBeats() - offsetBeats - loopStart;
                if (e <= 0 || s >= lenBeats || (loopLen > 0 && s >= loopLen)) continue;
                auto x1 = content.getX() + (float) (juce::jmax (0.0, s) * session.pixelsPerBeat);
                auto x2 = content.getX() + (float) (juce::jmin (lenBeats, e) * session.pixelsPerBeat);
                auto y = content.getBottom() - (float) (n->getNoteNumber() - lo + 1) * noteH;
                g.fillRect (x1, y, juce::jmax (1.5f, x2 - x1 - 1.0f), juce::jmax (1.5f, noteH - 1.0f));
            }
        };
        juce::ignoreUnused (startBeat);
        if (mc->isLooping())
        {
            auto loopLen = mc->getLoopLengthBeats().inBeats();
            if (loopLen > 0)
                for (double o = 0; o < lenBeats; o += loopLen)
                {
                    juce::Graphics::ScopedSaveState ss (g);
                    g.reduceClipRegion (juce::Rectangle<float> (content.getX() + (float) (o * session.pixelsPerBeat), content.getY(),
                                                                (float) (loopLen * session.pixelsPerBeat), content.getHeight()).toNearestInt());
                    g.setOrigin ((int) (o * session.pixelsPerBeat), 0);
                    drawPass (mc->getLoopStartBeats().inBeats() - offsetBeats, loopLen);
                }
        }
        else drawPass (0, 0);
    }

    g.setColour (selected ? Colours::goldHi : juce::Colours::black.withAlpha (0.6f));
    g.drawRoundedRectangle (r, 4.0f, selected ? 2.0f : 1.0f);
}

ClipComponent::Drag ClipComponent::hitTestDrag (juce::Point<int> p) const
{
    bool audio = dynamic_cast<te::WaveAudioClip*> (clip.get()) != nullptr;
    if (audio && p.y < 9)
    {
        auto wac = dynamic_cast<te::WaveAudioClip*> (clip.get());
        auto pxPerSec = session.pixelsPerBeat * session.edit->tempoSequence.getBpmAt (clip->getPosition().getStart()) / 60.0;
        auto fiX = wac->getFadeIn().inSeconds() * pxPerSec, foX = getWidth() - wac->getFadeOut().inSeconds() * pxPerSec;
        if (std::abs (p.x - fiX) < 8) return Drag::fadeIn;
        if (std::abs (p.x - foX) < 8) return Drag::fadeOut;
    }
    if (p.x < 6 && getWidth() > 18) return Drag::trimStart;
    if (p.x > getWidth() - 6 && getWidth() > 18) return Drag::trimEnd;
    return Drag::move;
}

void ClipComponent::mouseMove (const juce::MouseEvent& e)
{
    auto d = hitTestDrag (e.getPosition());
    setMouseCursor (d == Drag::trimStart || d == Drag::trimEnd ? juce::MouseCursor::LeftRightResizeCursor
                    : d == Drag::fadeIn || d == Drag::fadeOut ? juce::MouseCursor::CrosshairCursor
                    : juce::MouseCursor::NormalCursor);
}

void ClipComponent::mouseDown (const juce::MouseEvent& e)
{
    if (e.mods.isShiftDown() || e.mods.isCommandDown())
    {
        if (session.selection.isSelected (clip.get())) session.selection.deselect (clip.get());
        else session.selection.addToSelection (clip.get());
    }
    else if (! session.selection.isSelected (clip.get()))
        session.selection.selectOnly (clip.get());
    if (auto t = dynamic_cast<te::AudioTrack*> (clip->getTrack()))
        if (session.kindOf (*t) == TrackKind::instrument) session.routeMidiTo (t);

    if (e.mods.isPopupMenu()) { showMenu(); return; }
    drag = hitTestDrag (e.getPosition());
    startPos = clip->getPosition();
    if (auto wac = dynamic_cast<te::WaveAudioClip*> (clip.get()))
    {
        startFadeIn = wac->getFadeIn().inSeconds();
        startFadeOut = wac->getFadeOut().inSeconds();
    }
    copying = e.mods.isAltDown();
    dragged = false;
    targetRow = -1;
}

void ClipComponent::mouseDrag (const juce::MouseEvent& e)
{
    if (drag == Drag::none || e.mouseWasClicked()) return;
    dragged = true;
    auto& ts = session.edit->tempoSequence;
    auto dxBeats = e.getDistanceFromDragStartX() / session.pixelsPerBeat;
    auto startBeat = ts.toBeats (startPos.getStart()).inBeats();
    auto endBeat = ts.toBeats (startPos.getEnd()).inBeats();
    auto snapB = [&] (double b) { return e.mods.isCtrlDown() ? b : session.snapBeat (te::BeatPosition::fromBeats (b)).inBeats(); };
    auto toT = [&] (double b) { return ts.toTime (te::BeatPosition::fromBeats (juce::jmax (0.0, b))); };

    switch (drag)
    {
        case Drag::move:
        {
            auto ns = snapB (startBeat + dxBeats);
            auto lane = getParentComponent();
            auto delta = (ns - startBeat) * session.pixelsPerBeat;
            auto origX = TimelineMap { session, 0 }.beatToX (startBeat);
            setTopLeftPosition ((int) (origX + delta), getY());
            // a different track?
            auto posInContainer = view.tracksContainer().getLocalPoint (this, e.getPosition());
            targetRow = view.rowAt (posInContainer.y);
            auto rowOfLane = lane != nullptr ? view.rowAt (lane->getBounds().getCentreY()) : -1;
            setTransform (juce::AffineTransform::translation (0.0f, (float) ((targetRow >= 0 ? targetRow : rowOfLane) - rowOfLane) * (float) session.trackHeight));
            break;
        }
        case Drag::trimStart:
        {
            auto ns = juce::jmin (snapB (startBeat + dxBeats), endBeat - 0.0625);
            auto newStart = toT (ns);
            auto pos = startPos;
            auto delta = newStart - startPos.getStart();
            if (startPos.getOffset() + delta < 0s) delta = -startPos.getOffset();
            if (dynamic_cast<te::MidiClip*> (clip.get()) == nullptr || true)
            {
                pos.time = pos.time.withStart (startPos.getStart() + delta);
                pos.offset = startPos.getOffset() + delta;
                clip->setPosition (pos);
            }
            break;
        }
        case Drag::trimEnd:
        {
            auto ne = juce::jmax (snapB (endBeat + dxBeats), startBeat + 0.0625);
            auto pos = startPos;
            pos.time = pos.time.withEnd (toT (ne));
            if (auto wac = dynamic_cast<te::WaveAudioClip*> (clip.get()))
                if (! wac->isLooping() && ! wac->getAutoTempo())
                {
                    auto maxLen = te::TimeDuration::fromSeconds (wac->getSourceLength().inSeconds() / wac->getSpeedRatio()) - startPos.getOffset();
                    if (pos.getLength() > maxLen) pos.time = pos.time.withLength (maxLen);
                }
            clip->setPosition (pos);
            break;
        }
        case Drag::fadeIn: case Drag::fadeOut:
        {
            if (auto wac = dynamic_cast<te::WaveAudioClip*> (clip.get()))
            {
                auto secPerPx = 60.0 / (session.pixelsPerBeat * ts.getBpmAt (startPos.getStart()));
                auto len = startPos.getLength().inSeconds();
                if (drag == Drag::fadeIn) wac->setFadeIn (te::TimeDuration::fromSeconds (juce::jlimit (0.0, len, startFadeIn + e.getDistanceFromDragStartX() * secPerPx)));
                else wac->setFadeOut (te::TimeDuration::fromSeconds (juce::jlimit (0.0, len, startFadeOut - e.getDistanceFromDragStartX() * secPerPx)));
                repaint();
            }
            break;
        }
        default: break;
    }
}

void ClipComponent::mouseUp (const juce::MouseEvent& e)
{
    if (drag == Drag::move && dragged)
    {
        setTransform ({});
        auto& ts = session.edit->tempoSequence;
        auto startBeat = ts.toBeats (startPos.getStart()).inBeats();
        auto dxBeats = e.getDistanceFromDragStartX() / session.pixelsPerBeat;
        auto ns = e.mods.isCtrlDown() ? startBeat + dxBeats : session.snapBeat (te::BeatPosition::fromBeats (startBeat + dxBeats)).inBeats();
        auto newStart = ts.toTime (te::BeatPosition::fromBeats (juce::jmax (0.0, ns)));
        te::Clip::Ptr target = clip;
        if (copying)
            if (auto c = te::duplicateClip (*clip)) target = c;
        target->setStart (newStart, false, true);
        if (targetRow >= 0)
            if (auto lane = view.laneAt (targetRow))
                if (lane->track.get() != target->getTrack())
                    target->moveTo (*lane->track);
        if (copying) session.selection.selectOnly (target.get());
        session.notifyStructure();
    }
    drag = Drag::none;
}

void ClipComponent::mouseDoubleClick (const juce::MouseEvent&)
{
    if (view.onOpenClip) view.onOpenClip (clip.get());
}

void ClipComponent::showMenu()
{
    juce::PopupMenu m;
    auto c = clip;
    auto& s = session;
    m.addItem ("Rename...", [this, c]
    {
        auto* w = new juce::AlertWindow ("Rename clip", {}, juce::MessageBoxIconType::NoIcon);
        w->addTextEditor ("name", c->getName());
        w->addButton ("OK", 1, juce::KeyPress (juce::KeyPress::returnKey));
        w->addButton ("Cancel", 0, juce::KeyPress (juce::KeyPress::escapeKey));
        w->enterModalState (true, juce::ModalCallbackFunction::create ([w, c] (int r) { if (r == 1) c->setName (w->getTextEditorContents ("name")); }), true);
    });
    m.addItem ("Colour...", [this, c] { showColourMenu (this, [c] (juce::Colour col) { c->setColour (col); }); });
    m.addItem ("Split at playhead (Cmd T)", [&s] { s.splitSelectedAtPlayhead(); });
    m.addItem ("Duplicate (Cmd D)", [&s] { s.duplicateSelected(); });
    m.addItem (c->isMuted() ? "Unmute" : "Mute", [c] { c->setMuted (! c->isMuted()); });
    if (c->canLoop())
        m.addItem (c->isLooping() ? "Stop looping" : "Loop clip", [c]
        {
            if (c->isLooping()) c->disableLooping();
            else c->setLoopRangeBeats ({ te::BeatPosition(), c->getLengthInBeats() });
        });
    if (auto mc = dynamic_cast<te::MidiClip*> (c.get()))
    {
        juce::PopupMenu q;
        static const char* labels[] = { "1/4", "1/8", "1/16", "1/32" };
        static const double grid[] = { 1.0, 0.5, 0.25, 0.125 };
        for (int qi = 0; qi < 4; ++qi)
        {
            auto beats = grid[qi];
            q.addItem (labels[qi], [&s, beats] { s.quantiseSelected (beats); });
        }
        m.addSubMenu ("Quantize notes", q);
        m.addItem ("Edit in piano roll", [this, c] { if (view.onOpenClip) view.onOpenClip (c.get()); });
        juce::ignoreUnused (mc);
    }
    if (auto wac = dynamic_cast<te::WaveAudioClip*> (c.get()))
    {
        m.addItem (wac->getIsReversed() ? "Play forwards" : "Reverse", [wac] { wac->setIsReversed (! wac->getIsReversed()); });
        m.addItem (wac->getAutoTempo() ? "Stop following tempo" : "Follow song tempo (warp)", [wac] { wac->setAutoTempo (! wac->getAutoTempo()); });
        juce::PopupMenu gain;
        for (int db : { 6, 3, 0, -3, -6, -12 })
            gain.addItem ((db > 0 ? "+" : "") + juce::String (db) + " dB", true, std::abs (wac->getGainDB() - (float) db) < 0.1f, [wac, db] { wac->setGainDB ((float) db); });
        m.addSubMenu ("Clip gain", gain);
        juce::PopupMenu tr;
        for (int st = -12; st <= 12; ++st)
            tr.addItem ((st > 0 ? "+" : "") + juce::String (st), true, wac->getTransposeSemiTones (false) == st, [wac, st] { wac->setTranspose (st); });
        m.addSubMenu ("Transpose (semitones)", tr);
        m.addItem ("Show in Finder", [wac] { wac->getOriginalFile().revealToUser(); });
    }
    m.addSeparator();
    m.addItem ("Delete", [&s] { s.deleteSelected(); });
    m.showMenuAsync (juce::PopupMenu::Options().withTargetComponent (this).withMousePosition());
}

//==============================================================================
TrackHeader::TrackHeader (Session& s, te::AudioTrack& t) : track (&t), session (s)
{
    name.onTextChange = [this] { track->setName (name.getText()); };
    addAndMakeVisible (name);
    for (auto* b : { &mute, &solo, &arm, &input }) addAndMakeVisible (b);
    mute.onClick = [this] { track->setMute (! track->isMuted (false)); refresh(); };
    solo.onClick = [this] { track->setSolo (! track->isSolo (false)); refresh(); };
    arm.onClick = [this]
    {
        session.setArmed (*track, ! session.isArmed (*track));
        if (session.lastError.isNotEmpty())
        {
            juce::AlertWindow::showMessageBoxAsync (juce::MessageBoxIconType::InfoIcon, "Record", session.lastError);
            session.lastError = {};
        }
        refresh();
    };
    input.onClick = [this]
    {
        juce::PopupMenu m;
        auto current = session.audioInputOf (*track);
        m.addSectionHeader ("Audio input");
        m.addItem ("None", true, current == nullptr, [this] { session.setAudioInput (*track, nullptr); });
        auto& dm = session.engine.getDeviceManager();
        for (int i = 0; i < dm.getNumWaveInDevices(); ++i)
        {
            auto* d = dm.getWaveInDevice (i);
            if (d == nullptr || ! d->isEnabled()) continue;
            m.addItem (d->getName(), true, d == current, [this, d] { session.setAudioInput (*track, d); });
        }
        if (current != nullptr)
        {
            m.addSeparator();
            m.addSectionHeader ("Monitoring");
            auto mode = current->getMonitorMode();
            m.addItem ("Auto (when record-enabled)", true, mode == te::InputDevice::MonitorMode::automatic, [current] { current->setMonitorMode (te::InputDevice::MonitorMode::automatic); });
            m.addItem ("Always on", true, mode == te::InputDevice::MonitorMode::on, [current] { current->setMonitorMode (te::InputDevice::MonitorMode::on); });
            m.addItem ("Off", true, mode == te::InputDevice::MonitorMode::off, [current] { current->setMonitorMode (te::InputDevice::MonitorMode::off); });
        }
        m.showMenuAsync (juce::PopupMenu::Options().withTargetComponent (&input));
    };

    styleMiniFader (volume);
    volume.setRange (0.0, 1.0);
    volume.setDoubleClickReturnValue (true, te::decibelsToVolumeFaderPosition (0.0f));
    volume.textFromValueFunction = [] (double v) { return dbString (te::volumeFaderPositionToDB ((float) v)) + " dB"; };
    volume.onValueChange = [this] { if (auto vp = track->getVolumePlugin()) vp->volParam->setParameter ((float) volume.getValue(), juce::sendNotification); };
    addAndMakeVisible (volume);

    instrumentBtn.onClick = [this]
    {
        if (auto p = trackInstrument (*track)) p->showWindowExplicitly();
        else showMenu();
    };
    addAndMakeVisible (instrumentBtn);
    refresh();
}

void TrackHeader::refresh()
{
    name.setText (track->getName(), juce::dontSendNotification);
    mute.setToggleState (track->isMuted (false), juce::dontSendNotification);
    solo.setToggleState (track->isSolo (false), juce::dontSendNotification);
    arm.setToggleState (session.isArmed (*track), juce::dontSendNotification);
    bool isInst = session.kindOf (*track) == TrackKind::instrument;
    input.setVisible (! isInst);
    input.setToggleState (session.audioInputOf (*track) != nullptr, juce::dontSendNotification);
    if (auto vp = track->getVolumePlugin())
        if (! volume.isMouseButtonDown()) volume.setValue (vp->getSliderPos(), juce::dontSendNotification);
    auto inst = trackInstrument (*track);
    instrumentBtn.setButtonText (inst != nullptr ? inst->getName() : isInst ? "Choose instrument" : "Audio");
    instrumentBtn.setEnabled (inst != nullptr || isInst);
    instrumentBtn.setTooltip (inst != nullptr ? "Open " + inst->getName() : "");
    repaint();
}

void TrackHeader::paint (juce::Graphics& g)
{
    bool selected = session.selection.isSelected (track.get());
    g.setColour (selected ? Colours::panel3 : Colours::panel);
    g.fillRect (getLocalBounds());
    g.setColour (track->getColour());
    g.fillRect (0, 0, 5, getHeight());
    if (selected)
    {
        g.setColour (Colours::gold.withAlpha (0.5f));
        g.drawRect (getLocalBounds().withTrimmedLeft (5), 1);
    }
    g.setColour (Colours::line);
    g.fillRect (0, getHeight() - 1, getWidth(), 1);
    g.fillRect (getWidth() - 1, 0, 1, getHeight());
    // track number
    g.setColour (Colours::muted);
    g.setFont (Fonts::narrow (11.0f));
    auto idx = visibleTracks (session).indexOf (track.get()) + 1;
    g.drawText (juce::String (idx), juce::Rectangle<int> (8, 6, 18, 18), juce::Justification::centredLeft);
}

void TrackHeader::resized()
{
    auto r = getLocalBounds().reduced (8, 5).withTrimmedLeft (18);
    auto top = r.removeFromTop (20);
    auto btns = top.removeFromRight (4 * 21);
    for (auto* b : { &mute, &solo, &arm, &input })
    {
        b->setBounds (btns.removeFromLeft (20).reduced (0, 1));
        btns.removeFromLeft (1);
    }
    name.setBounds (top.withTrimmedRight (4));
    if (r.getHeight() >= 18)
    {
        r.removeFromTop (3);
        auto row = r.removeFromTop (18);
        instrumentBtn.setBounds (row.removeFromLeft (row.getWidth() / 2 + 10));
        row.removeFromLeft (6);
        volume.setBounds (row);
        instrumentBtn.setVisible (true);
        volume.setVisible (true);
    }
    else
    {
        instrumentBtn.setVisible (false);
        volume.setVisible (false);
    }
}

void TrackHeader::mouseDown (const juce::MouseEvent& e)
{
    session.selectTrack (track.get());
    if (e.mods.isPopupMenu()) showMenu();
}

void TrackHeader::mouseDoubleClick (const juce::MouseEvent&)
{
    if (auto p = trackInstrument (*track)) p->showWindowExplicitly();
}

void TrackHeader::showMenu()
{
    juce::PopupMenu m;
    auto t = track;
    auto& s = session;
    m.addItem ("Rename", [this] { name.showEditor(); });
    m.addItem ("Colour...", [this, t] { showColourMenu (this, [t] (juce::Colour c) { t->setColour (c); for (auto cl : t->getClips()) cl->setColour (c); }); });
    if (s.kindOf (*t) == TrackKind::instrument)
        m.addItem ("Change instrument...", [this, t, &s] { showPluginMenu (s.engine, true, this, [t, &s] (const PluginChoice& c) { s.insertPlugin (*t, c); }); });
    m.addItem ("Add effect...", [this, t, &s] { showPluginMenu (s.engine, false, this, [t, &s] (const PluginChoice& c) { s.insertPlugin (*t, c); }); });
    m.addSeparator();
    m.addItem ("Duplicate track", [t, &s] { s.duplicateTrack (*t); });
    m.addItem ("Delete track", [t, &s] { juce::MessageManager::callAsync ([t, &s] { s.deleteTrack (*t); }); });
    m.showMenuAsync (juce::PopupMenu::Options().withTargetComponent (this).withMousePosition());
}

bool TrackHeader::isInterestedInDragSource (const SourceDetails& d)  { return pluginFromDrag (session.engine, d.description).has_value(); }

void TrackHeader::itemDropped (const SourceDetails& d)
{
    if (auto c = pluginFromDrag (session.engine, d.description))
        session.insertPlugin (*track, *c);
}

//==============================================================================
TrackLane::TrackLane (Session& s, ArrangeView& v, te::AudioTrack& t) : track (&t), session (s), view (v)
{
    rebuildClips();
}

void TrackLane::rebuildClips()
{
    clips.clear();
    for (auto c : track->getClips())
    {
        auto* cc = clips.add (new ClipComponent (session, view, c));
        addAndMakeVisible (cc);
    }
    layoutClips();
}

void TrackLane::layoutClips()
{
    TimelineMap m { session, 0 };
    for (auto* c : clips)
    {
        auto r = c->clip->getEditTimeRange();
        auto x1 = m.timeToX (r.getStart()), x2 = m.timeToX (r.getEnd());
        c->setBounds ((int) std::floor (x1), 1, juce::jmax (4, (int) std::ceil (x2 - x1)), getHeight() - 2);
    }
}

void TrackLane::resized()  { layoutClips(); }

void TrackLane::paint (juce::Graphics& g)
{
    bool selected = session.selection.isSelected (track.get());
    g.fillAll (selected ? Colours::panel.brighter (0.02f) : Colours::bg);
    TimelineMap m { session, 0 };
    drawGrid (g, session, m, getLocalBounds(), false);
    g.setColour (Colours::line);
    g.fillRect (0, getHeight() - 1, getWidth(), 1);

    // the take being recorded
    auto& tp = session.edit->getTransport();
    if (tp.isRecording() && session.isArmed (*track))
    {
        auto x1 = (float) m.timeToX (tp.getTimeWhenStarted()), x2 = (float) m.timeToX (tp.getPosition());
        if (x2 > x1)
        {
            auto rr = juce::Rectangle<float> (x1, 1.0f, x2 - x1, (float) getHeight() - 2.0f);
            g.setColour (Colours::live.withAlpha (0.35f));
            g.fillRoundedRectangle (rr, 4.0f);
            g.setColour (Colours::live);
            g.drawRoundedRectangle (rr, 4.0f, 1.2f);
            g.setFont (Fonts::semi (11.0f));
            g.drawText ("Recording", rr.reduced (6, 2).toNearestInt(), juce::Justification::topLeft);
        }
    }
    if (! rubber.isEmpty())
    {
        g.setColour (Colours::gold.withAlpha (0.12f));
        g.fillRect (rubber);
        g.setColour (Colours::gold.withAlpha (0.6f));
        g.drawRect (rubber);
    }
}

void TrackLane::mouseDown (const juce::MouseEvent& e)
{
    if (! e.mods.isShiftDown()) session.selection.deselectAll();
    session.selectTrack (track.get());
    if (! e.mods.isPopupMenu())
    {
        TimelineMap m { session, 0 };
        if (! session.edit->getTransport().isPlaying())
            session.edit->getTransport().setPosition (session.snapTime (m.xToTime (e.x)));
    }
    else
    {
        juce::PopupMenu menu;
        TimelineMap m { session, 0 };
        auto t = session.snapTime (m.xToTime (e.x), true);
        if (session.kindOf (*track) == TrackKind::instrument)
            menu.addItem ("New MIDI clip here", [this, t] { session.addMidiClip (*track, t, te::BeatDuration::fromBeats (session.beatsPerBar())); });
        menu.addItem ("Add audio file here...", [this, t]
        {
            auto fc = std::make_shared<juce::FileChooser> ("Add audio", juce::File::getSpecialLocation (juce::File::userMusicDirectory),
                                                           session.engine.getAudioFileFormatManager().readFormatManager.getWildcardForAllFormats());
            fc->launchAsync (juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles, [this, fc, t] (const juce::FileChooser& c)
            {
                if (c.getResult().existsAsFile()) session.addAudioFile (*track, c.getResult(), t);
            });
        });
        menu.showMenuAsync ({});
    }
}

void TrackLane::mouseDrag (const juce::MouseEvent& e)
{
    if (e.mods.isPopupMenu()) return;
    rubber = juce::Rectangle<int> (e.getMouseDownPosition(), e.getPosition()).getIntersection (getLocalBounds().withHeight (getHeight()));
    // select clips under the band (on this track; dragging across tracks selects theirs too)
    auto inContainer = view.tracksContainer().getLocalArea (this, juce::Rectangle<int> (e.getMouseDownPosition(), e.getPosition()));
    if (! e.mods.isShiftDown()) session.selection.deselectAll();
    for (int row = view.rowAt (inContainer.getY()); row <= view.rowAt (inContainer.getBottom()); ++row)
        if (auto lane = view.laneAt (row))
            for (auto* c : lane->clips)
                if (c->getX() < juce::jmax (e.getMouseDownX(), e.x) && c->getRight() > juce::jmin (e.getMouseDownX(), e.x))
                    session.selection.addToSelection (c->clip.get());
    repaint();
}

void TrackLane::mouseUp (const juce::MouseEvent&)  { rubber = {}; repaint(); }

void TrackLane::mouseDoubleClick (const juce::MouseEvent& e)
{
    if (session.kindOf (*track) != TrackKind::instrument) return;
    TimelineMap m { session, 0 };
    auto bar = session.beatsPerBar();
    auto beat = std::floor (m.xToBeat (e.x) / bar) * bar;
    auto t = session.edit->tempoSequence.toTime (te::BeatPosition::fromBeats (juce::jmax (0.0, beat)));
    if (auto c = session.addMidiClip (*track, t, te::BeatDuration::fromBeats (bar)))
        if (view.onOpenClip) view.onOpenClip (c.get());
}

bool TrackLane::isInterestedInDragSource (const SourceDetails& d)
{
    return pluginFromDrag (session.engine, d.description).has_value() || fileFromDrag (d.description).existsAsFile();
}

void TrackLane::itemDropped (const SourceDetails& d)
{
    if (auto c = pluginFromDrag (session.engine, d.description)) { session.insertPlugin (*track, *c); return; }
    auto f = fileFromDrag (d.description);
    if (f.existsAsFile()) filesDropped ({ f.getFullPathName() }, d.localPosition.x, d.localPosition.y);
}

bool TrackLane::isInterestedInFileDrag (const juce::StringArray&)  { return true; }

void TrackLane::filesDropped (const juce::StringArray& files, int x, int)
{
    TimelineMap m { session, 0 };
    auto t = session.snapTime (m.xToTime (x));
    for (auto& path : files)
    {
        juce::File f (path);
        if (f.hasFileExtension ("mid;midi")) session.addMidiFile (*track, f, t);
        else if (auto c = session.addAudioFile (*track, f, t)) t = c->getPosition().getEnd();
    }
}

//==============================================================================
ArrangeView::ArrangeView (Session& s) : session (s), ruler (s)
{
    addAndMakeVisible (ruler);
    ruler.onWheel = [this] (const juce::MouseEvent& e, const juce::MouseWheelDetails& w) { mouseWheelMove (e.getEventRelativeTo (this), w); };
    viewport.setViewedComponent (&container, false);
    viewport.setScrollBarsShown (true, false);
    viewport.setScrollOnDragMode (juce::Viewport::ScrollOnDragMode::never);
    addAndMakeVisible (viewport);
    hbar.setAutoHide (false);
    hbar.addListener (this);
    addAndMakeVisible (hbar);
    addTrackBtn.onClick = [this] { showAddTrackMenu(); };
    container.addAndMakeVisible (addTrackBtn);
    session.addListener (this);
    rebuild();
    startTimerHz (30);
}

ArrangeView::~ArrangeView()  { session.removeListener (this); }

TimelineMap ArrangeView::map() const  { return TimelineMap { session, 0 }; }

void ArrangeView::rebuild()
{
    headers.clear();
    lanes.clear();
    if (session.edit)
        for (auto t : visibleTracks (session))
        {
            auto* h = headers.add (new TrackHeader (session, *t));
            container.addAndMakeVisible (h);
            auto* l = lanes.add (new TrackLane (session, *this, *t));
            container.addAndMakeVisible (l);
        }
    layoutAll();
    repaint();
}

void ArrangeView::layoutAll()
{
    auto w = viewport.getMaximumVisibleWidth();
    int y = 0;
    for (int i = 0; i < headers.size(); ++i)
    {
        headers[i]->setBounds (0, y, headerWidth, session.trackHeight);
        lanes[i]->setBounds (headerWidth, y, juce::jmax (10, w - headerWidth), session.trackHeight);
        y += session.trackHeight;
    }
    addTrackBtn.setBounds (12, y + 10, headerWidth - 24, 28);
    container.setSize (w, juce::jmax (y + 60, viewport.getHeight()));
    ruler.originX = headerWidth;

    // horizontal scroll: the song length plus room to work
    if (session.edit)
    {
        auto endBeat = session.edit->tempoSequence.toBeats (te::TimePosition() + session.edit->getLength()).inBeats();
        auto visibleBeats = (w - headerWidth) / session.pixelsPerBeat;
        auto total = juce::jmax (endBeat + visibleBeats, session.viewStartBeats + visibleBeats, 64.0 * session.beatsPerBar());
        updatingScroll = true;
        hbar.setRangeLimits (0.0, total);
        hbar.setCurrentRange (session.viewStartBeats, visibleBeats, juce::dontSendNotification);
        updatingScroll = false;
    }
}

int ArrangeView::rowAt (int y) const
{
    if (y < 0) return 0;
    auto r = y / juce::jmax (1, session.trackHeight);
    return juce::jlimit (0, juce::jmax (0, lanes.size() - 1), r);
}

TrackLane* ArrangeView::laneAt (int row) const  { return lanes[row]; }

void ArrangeView::resized()
{
    auto r = getLocalBounds();
    ruler.setBounds (r.removeFromTop (rulerHeight));
    hbar.setBounds (r.removeFromBottom (12).withTrimmedLeft (headerWidth));
    viewport.setBounds (r);
    layoutAll();
}

void ArrangeView::paint (juce::Graphics& g)
{
    g.fillAll (Colours::bg);
    g.setColour (Colours::panel);
    g.fillRect (getLocalBounds().withWidth (headerWidth).withTrimmedTop (rulerHeight));
}

void ArrangeView::paintOverChildren (juce::Graphics& g)
{
    if (! session.edit) return;
    auto x = (float) TimelineMap { session, headerWidth }.timeToX (session.edit->getTransport().getPosition());
    if (x >= headerWidth && x < getWidth())
    {
        g.setColour (Colours::goldHi.withAlpha (0.95f));
        g.fillRect (x, (float) rulerHeight, 1.5f, (float) (viewport.getBottom() - rulerHeight));
    }
    if (headers.isEmpty())
    {
        g.setColour (Colours::muted);
        g.setFont (Fonts::ui (15.0f));
        g.drawText ("No tracks yet. Press \"+ New track\", or drag a sound or a plugin in from the browser.",
                    getLocalBounds().withTrimmedLeft (headerWidth).withTrimmedTop (rulerHeight + 60).withHeight (40), juce::Justification::centred);
    }
}

void ArrangeView::propertiesChanged()
{
    for (auto* h : headers) h->refresh();
    for (auto* l : lanes) { l->layoutClips(); l->repaint(); for (auto* c : l->clips) c->repaint(); }
    ruler.repaint();
}

void ArrangeView::repaintAll()
{
    for (auto* h : headers) h->repaint();
    for (auto* l : lanes) { l->repaint(); for (auto* c : l->clips) c->repaint(); }
}

void ArrangeView::timerCallback()
{
    if (! session.edit) return;
    auto& tp = session.edit->getTransport();
    auto x = (float) TimelineMap { session, headerWidth }.timeToX (tp.getPosition());
    if (tp.isPlaying() && session.followPlayhead)
    {
        auto right = (float) getWidth() - 40.0f;
        if (x > right || x < headerWidth)
        {
            session.viewStartBeats = juce::jmax (0.0, session.edit->tempoSequence.toBeats (tp.getPosition()).inBeats() - 2.0);
            layoutAll();
            for (auto* l : lanes) { l->layoutClips(); l->repaint(); }
            ruler.repaint();
            x = (float) TimelineMap { session, headerWidth }.timeToX (tp.getPosition());
        }
    }
    if (std::abs (x - lastPlayheadX) > 0.5f)
    {
        auto top = rulerHeight, h = viewport.getBottom() - rulerHeight;
        repaint ((int) lastPlayheadX - 2, top, 5, h);
        repaint ((int) x - 2, top, 5, h);
        ruler.repaint ((int) lastPlayheadX - 8, 0, 17, ruler.getHeight());
        ruler.repaint ((int) x - 8, 0, 17, ruler.getHeight());
        lastPlayheadX = x;
    }
    if (tp.isRecording())
        for (auto* l : lanes) if (session.isArmed (*l->track)) l->repaint();
}

void ArrangeView::scrollBarMoved (juce::ScrollBar*, double start)
{
    if (updatingScroll) return;
    session.viewStartBeats = juce::jmax (0.0, start);
    for (auto* l : lanes) { l->layoutClips(); l->repaint(); }
    ruler.repaint();
    repaint();
}

void ArrangeView::zoom (double factor, double aroundBeat)
{
    auto oldPpb = session.pixelsPerBeat;
    session.pixelsPerBeat = juce::jlimit (1.0, 400.0, session.pixelsPerBeat * factor);
    // keep the beat under the mouse in place
    auto xOff = (aroundBeat - session.viewStartBeats) * oldPpb;
    session.viewStartBeats = juce::jmax (0.0, aroundBeat - xOff / session.pixelsPerBeat);
    layoutAll();
    for (auto* l : lanes) { l->layoutClips(); l->repaint(); }
    ruler.repaint();
    repaint();
}

void ArrangeView::zoomToFit()
{
    if (! session.edit) return;
    auto endBeat = session.edit->tempoSequence.toBeats (te::TimePosition() + session.edit->getLength()).inBeats();
    auto w = juce::jmax (100, viewport.getMaximumVisibleWidth() - headerWidth - 20);
    session.pixelsPerBeat = juce::jlimit (1.0, 400.0, w / juce::jmax (8.0, endBeat));
    session.viewStartBeats = 0;
    layoutAll();
    for (auto* l : lanes) { l->layoutClips(); l->repaint(); }
    ruler.repaint();
    repaint();
}

void ArrangeView::scrollToPlayhead()
{
    if (! session.edit) return;
    session.viewStartBeats = juce::jmax (0.0, session.edit->tempoSequence.toBeats (session.edit->getTransport().getPosition()).inBeats() - 4.0);
    layoutAll();
    for (auto* l : lanes) { l->layoutClips(); l->repaint(); }
    ruler.repaint();
}

void ArrangeView::mouseWheelMove (const juce::MouseEvent& e, const juce::MouseWheelDetails& w)
{
    if (e.mods.isCommandDown() || e.mods.isCtrlDown() || e.mods.isAltDown())
    {
        auto beat = TimelineMap { session, headerWidth }.xToBeat (e.getEventRelativeTo (this).x);
        zoom (std::pow (1.15, (w.deltaY != 0 ? w.deltaY : w.deltaX) * 8.0), beat);
        return;
    }
    auto dx = w.deltaX != 0 ? w.deltaX : (e.mods.isShiftDown() ? w.deltaY : 0.0f);
    if (dx != 0)
    {
        session.viewStartBeats = juce::jmax (0.0, session.viewStartBeats - dx * 300.0 / session.pixelsPerBeat);
        layoutAll();
        for (auto* l : lanes) { l->layoutClips(); l->repaint(); }
        ruler.repaint();
        repaint();
        return;
    }
    viewport.mouseWheelMove (e.getEventRelativeTo (&viewport), w);
}

void ArrangeView::showAddTrackMenu()
{
    juce::PopupMenu m;
    m.addItem ("Audio track (record a mic or guitar)", [this] { session.addTrack (TrackKind::audio); });
    auto addInst = [this] (const char* id)
    {
        PluginChoice c; auto info = findMotionPlugin (id);
        c.name = info->name; c.desc = describeMotionPlugin (*info); c.isInstrument = true;
        if (auto t = session.addInstrumentTrack (c)) session.selectTrack (t.get());
    };
    m.addItem ("Motion Keys (pianos, organs, SoundFonts)", [addInst] { addInst ("motion:keys"); });
    m.addItem ("Motion Pads (worship pads)", [addInst] { addInst ("motion:pads"); });
    m.addItem ("Motion Drums", [addInst] { addInst ("motion:drums"); });
    m.addItem ("Other instrument...", [this]
    {
        showPluginMenu (session.engine, true, &addTrackBtn, [this] (const PluginChoice& c) { if (auto t = session.addInstrumentTrack (c)) session.selectTrack (t.get()); });
    });
    m.addSeparator();
    m.addItem ("Guitar track with a Motion Pedalboard", [this]
    {
        if (auto t = session.addTrack (TrackKind::audio, "Guitar"))
        {
            auto d = describeMotionPlugin (*findMotionPlugin ("motion:board:worship-dotted"));
            if (auto p = session.insertPlugin (*t, d)) p->showWindowExplicitly();
        }
    });
    m.addItem ("Return (effect bus)", [this]
    {
        juce::PopupMenu r;
        session.addReturnTrack ("Return " + juce::String (session.returnTracks().size() + 1), "motion:fx:room-reverb");
    });
    m.showMenuAsync (juce::PopupMenu::Options().withTargetComponent (&addTrackBtn));
}

bool ArrangeView::isInterestedInFileDrag (const juce::StringArray&)  { return true; }

void ArrangeView::filesDropped (const juce::StringArray& files, int, int)
{
    // dropped below the tracks: one new audio track per file
    for (auto& p : files)
    {
        juce::File f (p);
        bool midi = f.hasFileExtension ("mid;midi");
        te::AudioTrack::Ptr t;
        if (midi)
        {
            PluginChoice c; auto info = findMotionPlugin ("motion:keys");
            c.name = info->name; c.desc = describeMotionPlugin (*info); c.isInstrument = true;
            t = session.addInstrumentTrack (c);
            if (t) { t->setName (f.getFileNameWithoutExtension()); session.addMidiFile (*t, f, te::TimePosition()); }
        }
        else
        {
            t = session.addTrack (TrackKind::audio, f.getFileNameWithoutExtension());
            if (t) session.addAudioFile (*t, f, te::TimePosition());
        }
    }
}

} // namespace ms
