#include "EditorPanel.h"
#include "Automation.h"
#include "MotionPlugins.h"

namespace ms
{

static void sendToTrack (Session& s, const juce::MidiMessage& m)
{
    if (auto v = s.musicalTyping())
    {
        auto msg = m;
        msg.setTimeStamp (juce::Time::getMillisecondCounterHiRes() * 0.001);
        v->handleIncomingMidiMessage (nullptr, msg);
    }
}

//==============================================================================
PianoRoll::PianoRoll (Session& s) : session (s)
{
    setWantsKeyboardFocus (true);
    startTimerHz (30);
}

PianoRoll::~PianoRoll() = default;

void PianoRoll::setClip (te::MidiClip* c)
{
    clip = c;
    selected.clear();
    scrollBeats = 0;
    if (clip)
    {
        int lo = 127, hi = 0;
        for (auto n : clip->getSequence().getNotes()) { lo = juce::jmin (lo, n->getNoteNumber()); hi = juce::jmax (hi, n->getNoteNumber()); }
        if (isDrums()) { lo = 35; hi = 57; }
        if (hi < lo) { lo = 48; hi = 72; }
        auto rows = juce::jmax (12, hi - lo + 3);
        auto avail = (float) juce::jmax (120, noteArea().getHeight());
        rowH = juce::jlimit (10.0f, 18.0f, avail / (float) rows);
        topNote = juce::jlimit (12, 127, hi + juce::jmax (1, ((int) (avail / rowH) - (hi - lo + 1)) / 2));
        auto len = clipLengthBeats();
        auto w = juce::jmax (200, noteArea().getWidth());
        ppb = juce::jlimit (12.0, 200.0, w / juce::jmax (4.0, len + 1.0));
        scrollBeats = clip->getOffsetInBeats().inBeats();
    }
    repaint();
}

double PianoRoll::clipLengthBeats() const
{
    if (! clip) return 4.0;
    if (clip->isLooping()) return clip->getLoopLengthBeats().inBeats();
    return clip->getLengthInBeats().inBeats();
}

bool PianoRoll::isDrums() const
{
    if (! clip) return false;
    if (auto t = dynamic_cast<te::AudioTrack*> (clip->getTrack()))
        if (auto p = trackInstrument (*t))
            return p->getName().containsIgnoreCase ("drum");
    if (auto slotOwner = clip->getClipSlot())
        if (auto t = dynamic_cast<te::AudioTrack*> (&slotOwner->track))
            if (auto p = trackInstrument (*t))
                return p->getName().containsIgnoreCase ("drum");
    return false;
}

juce::String PianoRoll::rowName (int n) const
{
    if (isDrums())
    {
        static const std::map<int, const char*> names { { 35, "Kick 2" }, { 36, "Kick" }, { 37, "Side Stick" }, { 38, "Snare" }, { 39, "Clap" },
            { 40, "Snare 2" }, { 41, "Low Tom 2" }, { 42, "Closed Hat" }, { 43, "Low Tom" }, { 44, "Pedal Hat" }, { 45, "Mid Tom 2" },
            { 46, "Open Hat" }, { 47, "Mid Tom" }, { 48, "Hi Tom 2" }, { 49, "Crash" }, { 50, "Hi Tom" }, { 51, "Ride" }, { 52, "China" },
            { 53, "Ride Bell" }, { 54, "Tambourine" }, { 55, "Splash" }, { 56, "Cowbell" }, { 57, "Crash 2" }, { 59, "Ride 2" }, { 70, "Shaker" } };
        auto it = names.find (n);
        if (it != names.end()) return it->second;
    }
    return juce::MidiMessage::getMidiNoteName (n, true, true, 3);
}

juce::Rectangle<int> PianoRoll::noteArea() const      { return getLocalBounds().withTrimmedLeft (keysW).withTrimmedTop (rulerH).withTrimmedBottom (velH); }
juce::Rectangle<int> PianoRoll::velocityArea() const  { return getLocalBounds().withTrimmedLeft (keysW).removeFromBottom (velH); }
float PianoRoll::beatToX (double b) const             { return (float) (keysW + (b - scrollBeats) * ppb); }
double PianoRoll::xToBeat (float x) const             { return (x - keysW) / ppb + scrollBeats; }
float PianoRoll::noteToY (int n) const                { return (float) rulerH + (float) (topNote - n) * rowH; }
int PianoRoll::yToNote (float y) const                { return juce::jlimit (0, 127, topNote - (int) std::floor ((y - (float) rulerH) / rowH)); }

double PianoRoll::gridBeats() const
{
    return session.snap ? juce::jmax (0.0625, juce::jmin (session.gridBeats, 1.0)) : 0.0625;
}

te::MidiNote* PianoRoll::noteAt (juce::Point<int> p, bool& onRight) const
{
    onRight = false;
    if (! clip) return nullptr;
    for (auto n : clip->getSequence().getNotes())
    {
        auto x1 = beatToX (n->getStartBeat().inBeats()), x2 = beatToX (n->getEndBeat().inBeats());
        auto y = noteToY (n->getNoteNumber());
        juce::Rectangle<float> r (x1, y, juce::jmax (4.0f, x2 - x1), rowH);
        if (r.contains (p.toFloat()))
        {
            onRight = p.x > x2 - juce::jmin (8.0f, (x2 - x1) * 0.35f);
            return n;
        }
    }
    return nullptr;
}

void PianoRoll::paint (juce::Graphics& g)
{
    g.fillAll (Colours::bg);
    if (! clip)
    {
        g.setColour (Colours::muted);
        g.setFont (Fonts::ui (15.0f));
        g.drawText ("Double-click a MIDI clip (or an empty spot on an instrument track) to edit notes here.", getLocalBounds(), juce::Justification::centred);
        return;
    }
    auto na = noteArea();
    bool drums = isDrums();
    // rows
    for (int n = topNote; n >= 0; --n)
    {
        auto y = noteToY (n);
        if (y > na.getBottom()) break;
        int pc = n % 12;
        bool black = pc == 1 || pc == 3 || pc == 6 || pc == 8 || pc == 10;
        bool inKey = true;
        static const int major[] = { 0, 2, 4, 5, 7, 9, 11 };
        int key = session.songKey % 12;
        bool minor = session.songKey >= 12;
        int rel = ((pc - key) % 12 + 12) % 12;
        if (minor) rel = (rel + 3) % 12;
        inKey = std::find (std::begin (major), std::end (major), rel) != std::end (major);
        g.setColour (drums ? (n % 2 ? Colours::panel : Colours::bg) : (black ? Colours::bg2 : (inKey ? Colours::panel : Colours::bg)));
        g.fillRect ((float) na.getX(), y, (float) na.getWidth(), rowH);
        if (pc == 0) { g.setColour (Colours::line2); g.fillRect ((float) na.getX(), y + rowH - 1, (float) na.getWidth(), 1.0f); }
    }
    // beat grid
    auto bar = session.beatsPerBar();
    auto gb = gridBeats();
    for (double b = std::floor (scrollBeats / gb) * gb; beatToX (b) < getWidth(); b += gb)
    {
        auto x = beatToX (b);
        if (x < na.getX()) continue;
        bool isBar = std::fmod (b + 1e-6, bar) < 1e-3, isBeat = std::fmod (b + 1e-6, 1.0) < 1e-3;
        g.setColour (isBar ? Colours::line2 : isBeat ? Colours::line : Colours::line.withAlpha (0.4f));
        g.fillRect (x, (float) na.getY(), 1.0f, (float) na.getHeight());
    }
    // clip end / loop length
    auto len = clipLengthBeats();
    auto offset = clip->isLooping() ? clip->getLoopStartBeats().inBeats() : clip->getOffsetInBeats().inBeats();
    auto endX = beatToX (offset + len);
    g.setColour (juce::Colours::black.withAlpha (0.45f));
    if (endX < getWidth()) g.fillRect (endX, (float) na.getY(), (float) getWidth() - endX, (float) na.getHeight());
    auto startX = beatToX (offset);
    if (startX > na.getX()) g.fillRect ((float) na.getX(), (float) na.getY(), startX - na.getX(), (float) na.getHeight());

    // notes
    auto col = clip->getColour();
    {
        juce::Graphics::ScopedSaveState ss (g);
        g.reduceClipRegion (na);
        for (auto n : clip->getSequence().getNotes())
        {
            auto x1 = beatToX (n->getStartBeat().inBeats()), x2 = beatToX (n->getEndBeat().inBeats());
            auto y = noteToY (n->getNoteNumber());
            juce::Rectangle<float> r (x1, y + 1, juce::jmax (3.0f, x2 - x1 - 1.0f), rowH - 2);
            bool sel = selected.contains (n);
            auto v = (float) n->getVelocity() / 127.0f;
            g.setColour (Colours::gold.withMultipliedBrightness (0.55f + 0.5f * v).withAlpha (n->isMute() ? 0.3f : 1.0f));
            g.fillRoundedRectangle (r, 2.5f);
            g.setColour (sel ? juce::Colours::white : col.darker (0.6f));
            g.drawRoundedRectangle (r, 2.5f, sel ? 1.6f : 1.0f);
            if (r.getWidth() > 30 && rowH >= 11)
            {
                g.setColour (Colours::goldText);
                g.setFont (Fonts::narrow (juce::jmin (11.0f, rowH - 2)));
                g.drawText (rowName (n->getNoteNumber()), r.reduced (3, 0), juce::Justification::centredLeft, false);
            }
        }
    }
    // keys
    for (int n = topNote; n >= 0; --n)
    {
        auto y = noteToY (n);
        if (y > na.getBottom()) break;
        int pc = n % 12;
        bool black = pc == 1 || pc == 3 || pc == 6 || pc == 8 || pc == 10;
        auto kr = juce::Rectangle<float> (0, y, (float) keysW, rowH);
        g.setColour (drums ? Colours::panel2 : black ? juce::Colour (0xff16161a) : juce::Colour (0xffdcd6c8));
        g.fillRect (kr.reduced (0, 0.5f));
        if (n == lastAuditioned) { g.setColour (Colours::gold); g.fillRect (kr.reduced (0, 0.5f)); }
        if (drums || pc == 0 || rowH >= 14)
        {
            g.setColour (drums ? Colours::text : black ? Colours::muted : juce::Colour (0xff333333));
            g.setFont (Fonts::narrow (juce::jmin (11.0f, rowH - 1)));
            if (drums || pc == 0 || ! black) g.drawText (rowName (n), kr.reduced (4, 0), juce::Justification::centredRight);
        }
    }
    // ruler
    auto rr = getLocalBounds().withHeight (rulerH);
    g.setColour (Colours::panel2);
    g.fillRect (rr);
    g.setFont (Fonts::semi (11.0f));
    for (double b = std::floor (scrollBeats); beatToX (b) < getWidth(); b += 1.0)
    {
        auto x = beatToX (b);
        if (x < keysW) continue;
        bool isBar = std::fmod (b + 1e-6, bar) < 1e-3;
        g.setColour (isBar ? Colours::muted : Colours::line2);
        g.fillRect (x, isBar ? 4.0f : 12.0f, 1.0f, (float) rulerH);
        if (isBar)
        {
            g.setColour (Colours::text);
            g.drawText (juce::String ((int) (b / bar) + 1), (int) x + 3, 0, 30, rulerH, juce::Justification::centredLeft);
        }
    }
    g.setColour (Colours::panel2);
    g.fillRect (0, 0, keysW, rulerH);
    g.setColour (Colours::gold);
    g.setFont (Fonts::narrow (11.0f));
    g.drawText (drums ? "DRUMS" : "NOTES", 0, 0, keysW, rulerH, juce::Justification::centred);

    // velocity lane
    auto va = velocityArea();
    g.setColour (Colours::bg2);
    g.fillRect (va);
    g.setColour (Colours::line);
    g.fillRect (va.withHeight (1));
    g.setColour (Colours::muted);
    g.setFont (Fonts::narrow (11.0f));
    g.drawText ("VELOCITY", juce::Rectangle<int> (0, va.getY(), keysW, va.getHeight()), juce::Justification::centred);
    for (auto n : clip->getSequence().getNotes())
    {
        auto x = beatToX (n->getStartBeat().inBeats());
        if (x < va.getX() || x > va.getRight()) continue;
        auto h = (float) (va.getHeight() - 8) * (float) n->getVelocity() / 127.0f;
        bool sel = selected.contains (n);
        g.setColour (sel ? Colours::goldHi : Colours::gold.withAlpha (0.7f));
        g.fillRect (x, (float) va.getBottom() - 4 - h, 3.0f, h);
        g.fillEllipse (x - 2.0f, (float) va.getBottom() - 6 - h, 7.0f, 4.0f);
    }
    // selection band
    if (! band.isEmpty())
    {
        g.setColour (Colours::gold.withAlpha (0.12f)); g.fillRect (band);
        g.setColour (Colours::gold.withAlpha (0.7f)); g.drawRect (band);
    }
    // playhead
    if (lastPlayX >= keysW)
    {
        g.setColour (Colours::goldHi);
        g.fillRect (lastPlayX, (float) rulerH, 1.5f, (float) (getHeight() - rulerH));
    }
}

void PianoRoll::resized() {}

void PianoRoll::timerCallback()
{
    float x = -1;
    if (clip && session.edit)
    {
        auto& tp = session.edit->getTransport();
        if (tp.isPlaying())
        {
            double beatInClip = -1;
            if (clip->getClipSlot() != nullptr)
            {
                if (auto h = clip->getLaunchHandle())
                    if (h->getPlayingStatus() == te::LaunchHandle::PlayState::playing)
                        if (auto r = h->getPlayedRange())
                            beatInClip = std::fmod (r->getLength().inBeats(), juce::jmax (0.001, clipLengthBeats()));
            }
            else
            {
                auto pos = session.edit->tempoSequence.toBeats (tp.getPosition()).inBeats();
                auto start = clip->getStartBeat().inBeats();
                if (pos >= start && pos <= clip->getEndBeat().inBeats())
                {
                    beatInClip = pos - start;
                    if (clip->isLooping()) beatInClip = std::fmod (beatInClip + clip->getOffsetInBeats().inBeats(), clipLengthBeats());
                }
            }
            if (beatInClip >= 0)
            {
                auto offset = clip->isLooping() ? clip->getLoopStartBeats().inBeats() : clip->getOffsetInBeats().inBeats();
                x = beatToX (offset + beatInClip);
            }
        }
    }
    if (std::abs (x - lastPlayX) > 0.5f) { lastPlayX = x; repaint(); }
}

void PianoRoll::audition (int note, int vel)
{
    if (lastAuditioned >= 0) sendToTrack (session, juce::MidiMessage::noteOff (1, lastAuditioned));
    lastAuditioned = note;
    if (note >= 0) sendToTrack (session, juce::MidiMessage::noteOn (1, note, (juce::uint8) juce::jlimit (1, 127, vel)));
    repaint (0, 0, keysW, getHeight());
}

void PianoRoll::mouseMove (const juce::MouseEvent& e)
{
    bool right = false;
    auto n = noteArea().contains (e.getPosition()) ? noteAt (e.getPosition(), right) : nullptr;
    setMouseCursor (n == nullptr ? juce::MouseCursor::NormalCursor : right ? juce::MouseCursor::LeftRightResizeCursor : juce::MouseCursor::DraggingHandCursor);
}

void PianoRoll::mouseDown (const juce::MouseEvent& e)
{
    grabKeyboardFocus();
    if (! clip) return;
    auto& seq = clip->getSequence();
    auto* um = &session.edit->getUndoManager();
    drag = Drag::none;
    orig.clear();
    if (e.x < keysW && e.y > rulerH && e.y < noteArea().getBottom())
    {
        audition (yToNote ((float) e.y), 100);
        return;
    }
    if (velocityArea().contains (e.getPosition()))
    {
        drag = Drag::velocity;
        for (auto n : seq.getNotes()) orig.push_back ({ n, n->getStartBeat().inBeats(), n->getLengthBeats().inBeats(), n->getNoteNumber(), n->getVelocity() });
        mouseDrag (e);
        return;
    }
    if (! noteArea().contains (e.getPosition())) return;
    bool right = false;
    auto n = noteAt (e.getPosition(), right);
    if (e.mods.isPopupMenu())
    {
        if (n) { if (! selected.contains (n)) { selected.clear(); selected.add (n); } }
        juce::PopupMenu m;
        m.addItem ("Delete", [this] { deleteSelected(); });
        m.addItem ("Quantize", [this] { quantise(); });
        m.addItem ("Select all", [this] { selectAll(); });
        m.addItem ("Up an octave", [this] { transposeSelected (12); });
        m.addItem ("Down an octave", [this] { transposeSelected (-12); });
        m.showMenuAsync ({});
        repaint();
        return;
    }
    if (n == nullptr)
    {
        if (e.mods.isShiftDown() || e.mods.isCommandDown())
        {
            drag = Drag::select;
            band = {};
            return;
        }
        // draw a note
        selected.clear();
        auto gb = gridBeats();
        auto b = std::floor (xToBeat ((float) e.x) / gb) * gb;
        auto pitch = yToNote ((float) e.y);
        createdNote = seq.addNote (pitch, te::BeatPosition::fromBeats (juce::jmax (0.0, b)), te::BeatDuration::fromBeats (gb), lastVelocity, 0, um);
        if (createdNote)
        {
            selected.add (createdNote);
            drag = Drag::create;
            orig.push_back ({ createdNote, b, gb, pitch, lastVelocity });
            audition (pitch, lastVelocity);
        }
        repaint();
        return;
    }
    if (! selected.contains (n))
    {
        if (! (e.mods.isShiftDown() || e.mods.isCommandDown())) selected.clear();
        selected.add (n);
    }
    else if (e.mods.isCommandDown()) { selected.removeFirstMatchingValue (n); repaint(); return; }

    if (e.mods.isAltDown())
    {
        // duplicate the selection and drag the copies
        juce::Array<te::MidiNote*> copies;
        for (auto s : selected)
            if (auto c = seq.addNote (s->getNoteNumber(), s->getStartBeat(), s->getLengthBeats(), s->getVelocity(), 0, um))
                copies.add (c);
        selected = copies;
    }
    drag = right ? Drag::resize : Drag::move;
    for (auto s : selected) orig.push_back ({ s, s->getStartBeat().inBeats(), s->getLengthBeats().inBeats(), s->getNoteNumber(), s->getVelocity() });
    lastVelocity = n->getVelocity();
    audition (n->getNoteNumber(), n->getVelocity());
    repaint();
}

void PianoRoll::mouseDrag (const juce::MouseEvent& e)
{
    if (! clip) return;
    auto* um = &session.edit->getUndoManager();
    auto gb = gridBeats();
    auto snapB = [&] (double b) { return e.mods.isCtrlDown() ? b : std::round (b / gb) * gb; };
    switch (drag)
    {
        case Drag::create:
        case Drag::resize:
        {
            auto dx = e.getDistanceFromDragStartX() / ppb;
            for (auto& o : orig)
            {
                auto end = snapB (o.start + o.len + dx);
                auto len = juce::jmax (gb * 0.5, end - o.start);
                if (drag == Drag::create) len = juce::jmax (gb, snapB (xToBeat ((float) e.x)) - o.start);
                o.n->setStartAndLength (te::BeatPosition::fromBeats (o.start), te::BeatDuration::fromBeats (len), um);
            }
            break;
        }
        case Drag::move:
        {
            auto dx = snapB (e.getDistanceFromDragStartX() / ppb);
            auto dy = (int) std::round (-e.getDistanceFromDragStartY() / rowH);
            for (auto& o : orig)
            {
                o.n->setStartAndLength (te::BeatPosition::fromBeats (juce::jmax (0.0, o.start + dx)), te::BeatDuration::fromBeats (o.len), um);
                o.n->setNoteNumber (juce::jlimit (0, 127, o.pitch + dy), um);
            }
            if (! orig.empty())
            {
                auto p = orig.front().n->getNoteNumber();
                if (p != lastAuditioned) audition (p, orig.front().vel);
            }
            break;
        }
        case Drag::velocity:
        {
            auto va = velocityArea();
            auto v = juce::jlimit (1, 127, (int) std::round ((float) (va.getBottom() - 4 - e.y) / (float) (va.getHeight() - 8) * 127.0f));
            // the notes under the mouse (or the selection when dragging from a selected note's bar)
            for (auto& o : orig)
            {
                auto x = beatToX (o.start);
                bool hit = std::abs (x - (float) e.x) < 5.0f;
                if (hit || (selected.contains (o.n) && std::abs (beatToX (o.start) - (float) e.getMouseDownX()) < 5.0f))
                {
                    o.n->setVelocity (v, um);
                    lastVelocity = v;
                }
            }
            break;
        }
        case Drag::select:
        {
            band = juce::Rectangle<int> (e.getMouseDownPosition(), e.getPosition());
            selected.clear();
            for (auto n : clip->getSequence().getNotes())
            {
                auto x1 = beatToX (n->getStartBeat().inBeats()), x2 = beatToX (n->getEndBeat().inBeats());
                juce::Rectangle<float> r (x1, noteToY (n->getNoteNumber()), x2 - x1, rowH);
                if (r.intersects (band.toFloat())) selected.add (n);
            }
            break;
        }
        default: break;
    }
    repaint();
}

void PianoRoll::mouseUp (const juce::MouseEvent&)
{
    if (lastAuditioned >= 0) audition (-1, 0);
    drag = Drag::none;
    band = {};
    createdNote = nullptr;
    session.notifyStructure();
    repaint();
}

void PianoRoll::mouseDoubleClick (const juce::MouseEvent& e)
{
    if (! clip) return;
    bool right;
    if (auto n = noteAt (e.getPosition(), right))
    {
        selected.removeFirstMatchingValue (n);
        clip->getSequence().removeNote (*n, &session.edit->getUndoManager());
        repaint();
    }
}

void PianoRoll::mouseWheelMove (const juce::MouseEvent& e, const juce::MouseWheelDetails& w)
{
    if (e.mods.isCommandDown() || e.mods.isCtrlDown())
    {
        auto b = xToBeat ((float) e.x);
        ppb = juce::jlimit (8.0, 600.0, ppb * std::pow (1.15, w.deltaY * 8.0));
        scrollBeats = juce::jmax (0.0, b - (e.x - keysW) / ppb);
    }
    else if (e.mods.isAltDown())
        rowH = juce::jlimit (7.0f, 30.0f, rowH + w.deltaY * 12.0f);
    else if (e.mods.isShiftDown() || w.deltaX != 0)
        scrollBeats = juce::jmax (0.0, scrollBeats - (w.deltaX != 0 ? w.deltaX : w.deltaY) * 200.0 / ppb);
    else
        topNote = juce::jlimit (12, 127, topNote + (int) std::round (w.deltaY * 30.0f));
    repaint();
}

bool PianoRoll::keyPressed (const juce::KeyPress& k, juce::Component*)
{
    if (! clip) return false;
    if (k == juce::KeyPress::deleteKey || k == juce::KeyPress::backspaceKey) { deleteSelected(); return true; }
    if (k == juce::KeyPress ('q')) { quantise(); return true; }
    if (k == juce::KeyPress ('a', juce::ModifierKeys::commandModifier, 0)) { selectAll(); return true; }
    if (k == juce::KeyPress::upKey) { transposeSelected (k.getModifiers().isShiftDown() ? 12 : 1); return true; }
    if (k == juce::KeyPress::downKey) { transposeSelected (k.getModifiers().isShiftDown() ? -12 : -1); return true; }
    return false;
}

void PianoRoll::deleteSelected()
{
    if (! clip) return;
    for (auto n : selected) clip->getSequence().removeNote (*n, &session.edit->getUndoManager());
    selected.clear();
    repaint();
}

void PianoRoll::quantise()
{
    if (! clip) return;
    auto gb = gridBeats();
    auto& notes = selected.isEmpty() ? clip->getSequence().getNotes() : selected;
    for (auto n : notes)
        n->setStartAndLength (te::BeatPosition::fromBeats (std::round (n->getStartBeat().inBeats() / gb) * gb), n->getLengthBeats(), &session.edit->getUndoManager());
    repaint();
}

void PianoRoll::selectAll()
{
    if (! clip) return;
    selected.clear();
    selected.addArray (clip->getSequence().getNotes());
    repaint();
}

void PianoRoll::transposeSelected (int st)
{
    if (! clip) return;
    for (auto n : selected) n->setNoteNumber (juce::jlimit (0, 127, n->getNoteNumber() + st), &session.edit->getUndoManager());
    repaint();
}

//==============================================================================
struct DeviceChain::Card : public juce::Component, private juce::Timer
{
    Card (Session& s, te::Plugin* p, bool inst) : session (s), plugin (p), instrument (inst)
    {
        power.setClickingTogglesState (false);
        power.onClick = [this] { plugin->setEnabled (! plugin->isEnabled()); power.setToggleState (plugin->isEnabled(), juce::dontSendNotification); repaint(); };
        power.setToggleState (p->isEnabled(), juce::dontSendNotification);
        addAndMakeVisible (power);
        open.onClick = [this] { plugin->showWindowExplicitly(); };
        addAndMakeVisible (open);
        remove.onClick = [this] { juce::MessageManager::callAsync ([pl = plugin] { pl->deleteFromParent(); }); };
        remove.setTooltip ("Remove");
        addAndMakeVisible (remove);
        int count = 0;
        for (auto ap : p->getAutomatableParameters())
        {
            if (count >= 8) break;
            auto nm = ap->getParameterName();
            if (nm.containsIgnoreCase ("bypass") || nm.equalsIgnoreCase ("on") || nm == "Dry Level" || nm == "Wet Level") continue;
            if (ap->isDiscrete() && ap->getNumberOfStates() <= 2) continue;   // switches: open the plugin for those
            auto* k = knobs.add (new Knob (ap->getParameterShortName (12).isNotEmpty() ? ap->getParameterShortName (12) : nm, inst ? Colours::goldHi : Colours::gold));
            auto range = ap->getValueRange();
            k->slider.setRange (range.getStart(), range.getEnd());
            k->slider.setTextBoxStyle (juce::Slider::NoTextBox, false, 0, 0);
            k->slider.setPopupDisplayEnabled (true, true, nullptr);
            k->slider.setValue (ap->getCurrentValue(), juce::dontSendNotification);
            k->slider.textFromValueFunction = [ap] (double v) { return ap->valueToString ((float) v) + " " + ap->getLabel(); };
            k->slider.onDragStart = [ap] { ap->parameterChangeGestureBegin(); };
            k->slider.onDragEnd = [ap] { ap->parameterChangeGestureEnd(); };
            k->slider.onValueChange = [ap, k] { ap->setParameter ((float) k->slider.getValue(), juce::sendNotification); };
            k->label.setFont (Fonts::narrow (10.5f));
            addAndMakeVisible (k);
            params.add (ap);
            ++count;
        }
        startTimerHz (10);
    }
    int preferredWidth() const { return 120 + juce::jmax (0, (knobs.size() + 1) / 2 - 1) * 62; }
    void mouseDown (const juce::MouseEvent& e) override
    {
        if (! e.mods.isPopupMenu()) return;
        juce::PopupMenu m;
        auto p = plugin;
        m.addItem ("Open", [p] { p->showWindowExplicitly(); });
        m.addItem (p->isEnabled() ? "Bypass" : "Turn on", [p] { p->setEnabled (! p->isEnabled()); });
        addSidechainMenu (m, p);
        m.addSeparator();
        m.addItem ("Remove", [p] { juce::MessageManager::callAsync ([p] { p->deleteFromParent(); }); });
        m.showMenuAsync (juce::PopupMenu::Options().withTargetComponent (this).withMousePosition());
    }
    void timerCallback() override
    {
        for (int i = 0; i < knobs.size(); ++i)
            if (! knobs[i]->slider.isMouseButtonDown()) knobs[i]->slider.setValue (params[i]->getCurrentValue(), juce::dontSendNotification);
    }
    void paint (juce::Graphics& g) override
    {
        auto r = getLocalBounds().toFloat().reduced (3.0f);
        g.setColour (Colours::panel);
        g.fillRoundedRectangle (r, 6.0f);
        g.setColour (instrument ? Colours::gold.withAlpha (0.7f) : Colours::line);
        g.drawRoundedRectangle (r, 6.0f, 1.0f);
        auto head = r.removeFromTop (26.0f);
        g.setColour (instrument ? Colours::gold.withAlpha (0.18f) : Colours::panel2);
        g.fillRoundedRectangle (head.reduced (1.0f), 5.0f);
        g.setColour (plugin->isEnabled() ? Colours::text : Colours::dim);
        g.setFont (Fonts::semi (12.5f));
        g.drawFittedText (plugin->getName(), head.withTrimmedLeft (28).withTrimmedRight (52).toNearestInt(), juce::Justification::centredLeft, 1, 0.8f);
        if (knobs.isEmpty())
        {
            g.setColour (Colours::muted);
            g.setFont (Fonts::ui (12.0f));
            g.drawFittedText ("Open the plugin to edit it", r.reduced (8).toNearestInt(), juce::Justification::centred, 2);
        }
        if (plugin->canSidechain())
        {
            auto src = sidechainSource (*plugin);
            g.setColour (src.isNotEmpty() ? Colours::gold : Colours::dim);
            g.setFont (Fonts::narrow (10.5f));
            g.drawText (src.isNotEmpty() ? "SIDECHAIN: " + src.toUpperCase() : juce::String ("RIGHT-CLICK: SIDECHAIN FROM"), r.removeFromBottom (14).toNearestInt(), juce::Justification::centred);
        }
    }
    void resized() override
    {
        auto r = getLocalBounds().reduced (6);
        auto head = r.removeFromTop (22);
        power.setBounds (head.removeFromLeft (20).reduced (1));
        remove.setBounds (head.removeFromRight (20).reduced (1));
        open.setBounds (head.removeFromRight (28).reduced (1));
        r.removeFromTop (4);
        int cols = juce::jmax (1, (knobs.size() + 1) / 2);
        int w = r.getWidth() / cols, h = r.getHeight() / 2;
        for (int i = 0; i < knobs.size(); ++i)
            knobs[i]->setBounds (r.getX() + (i / 2) * w, r.getY() + (i % 2) * h, w, h);
    }
    Session& session;
    te::Plugin::Ptr plugin;
    bool instrument;
    SmallToggle power { "", Colours::gold, "On / off" };
    juce::TextButton open { "Edit" }, remove { "x" };
    juce::OwnedArray<Knob> knobs;
    juce::Array<te::AutomatableParameter*> params;
};

DeviceChain::DeviceChain (Session& s) : session (s)
{
    viewport.setViewedComponent (&row, false);
    viewport.setScrollBarsShown (false, true);
    addAndMakeVisible (viewport);
    addFx.onClick = [this]
    {
        if (track == nullptr) return;
        showPluginMenu (session.engine, false, &addFx, [this] (const PluginChoice& c) { if (track) session.insertPlugin (*track, c); });
    };
    row.addAndMakeVisible (addFx);
}

void DeviceChain::setTrack (te::AudioTrack* t)
{
    if (track.get() == t) { refresh(); return; }
    track = t;
    signature = "-";
    refresh();
}

void DeviceChain::refresh()
{
    juce::String sig;
    juce::Array<te::Plugin*> list;
    if (track != nullptr)
    {
        if (auto inst = trackInstrument (*track)) list.add (inst);
        list.addArray (session.insertsOf (*track));
    }
    for (auto p : list) sig << p->itemID.toString() << ",";
    if (sig == signature) return;
    signature = sig;
    cards.clear();
    for (auto p : list)
        row.addAndMakeVisible (cards.add (new Card (session, p, p->isSynth())));
    resized();
    repaint();
}

void DeviceChain::paint (juce::Graphics& g)
{
    if (track == nullptr)
    {
        g.setColour (Colours::muted);
        g.setFont (Fonts::ui (14.0f));
        g.drawText ("Select a track to see its instrument and effects.", getLocalBounds(), juce::Justification::centred);
    }
}

void DeviceChain::resized()
{
    viewport.setBounds (getLocalBounds());
    int x = 4, h = juce::jmax (100, getHeight() - 14);
    for (auto* c : cards)
    {
        c->setBounds (x, 0, c->preferredWidth(), h);
        x += c->getWidth() + 2;
    }
    addFx.setBounds (x + 8, 8, 110, 28);
    addFx.setVisible (track != nullptr);
    row.setSize (juce::jmax (x + 130, getWidth()), h);
}

//==============================================================================
AudioClipInspector::AudioClipInspector (Session& s) : session (s)
{
    gain.slider.setRange (-24.0, 24.0, 0.1);
    gain.slider.setTextValueSuffix (" dB");
    gain.slider.onValueChange = [this] { if (clip) clip->setGainDB ((float) gain.slider.getValue()); };
    pitch.slider.setRange (-24.0, 24.0, 1.0);
    pitch.slider.setTextValueSuffix (" st");
    pitch.slider.onValueChange = [this] { if (clip) clip->setTranspose ((int) pitch.slider.getValue()); };
    fadeIn.slider.setRange (0.0, 10.0, 0.01);
    fadeIn.slider.setSkewFactorFromMidPoint (1.0);
    fadeIn.slider.setTextValueSuffix (" s");
    fadeIn.slider.onValueChange = [this] { if (clip) clip->setFadeIn (te::TimeDuration::fromSeconds (fadeIn.slider.getValue())); };
    fadeOut.slider.setRange (0.0, 10.0, 0.01);
    fadeOut.slider.setSkewFactorFromMidPoint (1.0);
    fadeOut.slider.setTextValueSuffix (" s");
    fadeOut.slider.onValueChange = [this] { if (clip) clip->setFadeOut (te::TimeDuration::fromSeconds (fadeOut.slider.getValue())); };
    for (auto* k : { &gain, &pitch, &fadeIn, &fadeOut }) addAndMakeVisible (k);
    warp.onClick = [this] { if (clip) clip->setAutoTempo (warp.getToggleState()); };
    reverse.onClick = [this] { if (clip) clip->setIsReversed (reverse.getToggleState()); };
    loop.onClick = [this]
    {
        if (! clip) return;
        if (loop.getToggleState()) { clip->setAutoTempo (true); clip->setLoopRangeBeats ({ te::BeatPosition(), clip->getLengthInBeats() }); }
        else clip->disableLooping();
        refresh();
    };
    for (auto* b : { &warp, &reverse, &loop }) addAndMakeVisible (b);
    info.setFont (Fonts::ui (13.0f));
    info.setColour (juce::Label::textColourId, Colours::muted);
    addAndMakeVisible (info);
}

void AudioClipInspector::setClip (te::WaveAudioClip* c)  { clip = c; refresh(); }

void AudioClipInspector::refresh()
{
    if (! clip) return;
    gain.slider.setValue (clip->getGainDB(), juce::dontSendNotification);
    pitch.slider.setValue (clip->getTransposeSemiTones (false), juce::dontSendNotification);
    fadeIn.slider.setValue (clip->getFadeIn().inSeconds(), juce::dontSendNotification);
    fadeOut.slider.setValue (clip->getFadeOut().inSeconds(), juce::dontSendNotification);
    warp.setToggleState (clip->getAutoTempo(), juce::dontSendNotification);
    reverse.setToggleState (clip->getIsReversed(), juce::dontSendNotification);
    loop.setToggleState (clip->isLooping(), juce::dontSendNotification);
    te::AudioFile af (clip->getAudioFile());
    auto li = clip->getLoopInfo();
    info.setText (clip->getOriginalFile().getFileName() + "    " + juce::String (af.getSampleRate() / 1000.0, 1) + " kHz, "
                  + juce::String (af.getNumChannels()) + " ch, " + timecode (af.getLength())
                  + (li.getBpm (af.getInfo()) > 0 ? "    detected " + juce::String (li.getBpm (af.getInfo()), 1) + " BPM" : juce::String()),
                  juce::dontSendNotification);
}

void AudioClipInspector::paint (juce::Graphics&) {}

void AudioClipInspector::resized()
{
    auto r = getLocalBounds().reduced (10, 6);
    info.setBounds (r.removeFromTop (22));
    r.removeFromTop (6);
    auto knobs = r.removeFromLeft (4 * 92);
    for (auto* k : { &gain, &pitch, &fadeIn, &fadeOut }) k->setBounds (knobs.removeFromLeft (92).withHeight (104));
    r.removeFromLeft (20);
    warp.setBounds (r.removeFromTop (26).withWidth (260));
    loop.setBounds (r.removeFromTop (26).withWidth (260));
    reverse.setBounds (r.removeFromTop (26).withWidth (260));
}

//==============================================================================
struct EditorPanel::KeyForwarder : public juce::MidiKeyboardState::Listener
{
    KeyForwarder (Session& s) : session (s) {}
    void handleNoteOn (juce::MidiKeyboardState*, int ch, int note, float vel) override  { sendToTrack (session, juce::MidiMessage::noteOn (ch, note, vel)); }
    void handleNoteOff (juce::MidiKeyboardState*, int ch, int note, float) override     { sendToTrack (session, juce::MidiMessage::noteOff (ch, note)); }
    Session& session;
};

EditorPanel::EditorPanel (Session& s) : pianoRoll (s), session (s), tuneView (s), takesView (s), devices (s), audioInspector (s)
{
    for (auto* b : { &clipTab, &tuneTab, &takesTab, &devicesTab, &keysTab })
    {
        b->setRadioGroupId (2002);
        addAndMakeVisible (b);
    }
    clipTab.onClick = [this] { setPage (0); };
    devicesTab.onClick = [this] { setPage (1); };
    keysTab.onClick = [this] { setPage (2); };
    tuneTab.onClick = [this] { setPage (3); };
    takesTab.onClick = [this] { setPage (4); };
    tuneTab.setTooltip ("Tune a vocal: marks every note and tunes it to the song's key");
    takesTab.setTooltip ("The takes of a loop recording, and Auto Comp");
    autoTimeBtn.setTooltip ("Line the selected audio or MIDI clips up with the metronome");
    autoTimeBtn.onClick = [this] { showAutoTime(); };
    addAndMakeVisible (autoTimeBtn);
    addChildComponent (tuneView);
    addChildComponent (takesView);
    quantiseBtn.onClick = [this] { pianoRoll.quantise(); };
    quantiseBtn.setTooltip ("Quantize the selected notes (or all) to the grid (Q)");
    addAndMakeVisible (quantiseBtn);
    title.setFont (Fonts::semi (13.0f));
    title.setColour (juce::Label::textColourId, Colours::muted);
    addAndMakeVisible (title);
    addChildComponent (pianoRoll);
    addChildComponent (devices);
    addChildComponent (audioInspector);
    keyboard.setColour (juce::MidiKeyboardComponent::keyDownOverlayColourId, Colours::gold);
    keyboard.setColour (juce::MidiKeyboardComponent::mouseOverKeyOverlayColourId, Colours::gold.withAlpha (0.3f));
    keyboard.setColour (juce::MidiKeyboardComponent::whiteNoteColourId, juce::Colour (0xffe8e2d4));
    keyboard.setColour (juce::MidiKeyboardComponent::blackNoteColourId, juce::Colour (0xff141416));
    keyboard.setColour (juce::MidiKeyboardComponent::keySeparatorLineColourId, juce::Colour (0xff555555));
    keyboard.setColour (juce::MidiKeyboardComponent::shadowColourId, juce::Colours::transparentBlack);
    keyboard.setLowestVisibleKey (36);
    keyboard.setKeyWidth (22.0f);
    keyboard.setWantsKeyboardFocus (false);
    addChildComponent (keyboard);
    forwarder = std::make_unique<KeyForwarder> (s);
    keyState.addListener (forwarder.get());
    session.addListener (this);
    setPage (1);
}

EditorPanel::~EditorPanel()
{
    keyState.removeListener (forwarder.get());
    session.removeListener (this);
}

te::WaveAudioClip* EditorPanel::selectedAudioClip() const
{
    for (auto c : session.selection.getItemsOfType<te::Clip>())
        if (auto wc = dynamic_cast<te::WaveAudioClip*> (c)) return wc;
    return nullptr;
}

void EditorPanel::showTune (te::Clip* c)
{
    if (auto wc = dynamic_cast<te::WaveAudioClip*> (c)) tuneView.setClip (wc);
    setPage (3);
}

void EditorPanel::showTakes (te::Clip* c)
{
    if (auto wc = dynamic_cast<te::WaveAudioClip*> (c)) takesView.setClip (wc);
    setPage (4);
}

void EditorPanel::showAutoTime()
{
    juce::Component::SafePointer<EditorPanel> safe (this);
    AutoTimePanel::show (session, autoTimeBtn, [safe] (const juce::String& message)
    {
        if (safe == nullptr) return;
        safe->title.setText (message, juce::dontSendNotification);
        safe->pianoRoll.repaint();
        if (safe->page == 3)
        {
            safe->tuneView.setClip (nullptr);   // the audio changed: start from the new file
            safe->tuneView.setClip (safe->selectedAudioClip());
        }
    });
}

void EditorPanel::setPage (int p)
{
    page = p;
    clipTab.setToggleState (p == 0, juce::dontSendNotification);
    devicesTab.setToggleState (p == 1, juce::dontSendNotification);
    keysTab.setToggleState (p == 2, juce::dontSendNotification);
    tuneTab.setToggleState (p == 3, juce::dontSendNotification);
    takesTab.setToggleState (p == 4, juce::dontSendNotification);
    tuneView.setVisible (p == 3);
    takesView.setVisible (p == 4);
    if (p == 3) tuneView.setClip (selectedAudioClip() != nullptr ? selectedAudioClip() : tuneView.getClip());
    if (p == 4) takesView.setClip (selectedAudioClip() != nullptr ? selectedAudioClip() : takesView.getClip());
    bool isAudio = audioInspector.isVisible() || (p == 0 && pianoRoll.getClip() == nullptr && dynamic_cast<te::WaveAudioClip*> (session.selection.getFirstItemOfType<te::Clip>()) != nullptr);
    pianoRoll.setVisible (p == 0 && ! isAudio);
    audioInspector.setVisible (p == 0 && isAudio);
    quantiseBtn.setVisible (p == 0 && ! isAudio);
    devices.setVisible (p == 1);
    keyboard.setVisible (p == 2);
    if (p == 1) devices.setTrack (session.selectedTrack());
    title.setText (p == 0 ? (pianoRoll.getClip() ? "Piano roll: " + pianoRoll.getClip()->getName() + "    (click to draw, drag to move, edge to resize, double-click to delete, Alt-drag to copy)" : juce::String())
                   : p == 1 ? (session.selectedTrack() ? session.selectedTrack()->getName() + ": instrument and effects" : juce::String())
                   : p == 2 ? "Play the selected instrument track (or use Musical Typing: Cmd K)"
                   : p == 3 ? (tuneView.getClip() ? "Tune: " + tuneView.getClip()->getName() : juce::String())
                   : (takesView.getClip() ? "Takes: " + takesView.getClip()->getName() : juce::String()), juce::dontSendNotification);
    resized();
}

void EditorPanel::showClip (te::Clip* c)
{
    if (auto mc = dynamic_cast<te::MidiClip*> (c))
    {
        audioInspector.setVisible (false);
        pianoRoll.setClip (mc);
        setPage (0);
        pianoRoll.grabKeyboardFocus();
    }
    else if (auto wc = dynamic_cast<te::WaveAudioClip*> (c))
    {
        pianoRoll.setClip (nullptr);
        audioInspector.setClip (wc);
        audioInspector.setVisible (true);
        setPage (0);
    }
}

void EditorPanel::showDevices()  { setPage (1); }

void EditorPanel::selectionChanged()
{
    if (page == 3 || page == 4)
        if (auto wc = selectedAudioClip())
        {
            if (page == 3) tuneView.setClip (wc); else takesView.setClip (wc);
            title.setText ((page == 3 ? "Tune: " : "Takes: ") + wc->getName(), juce::dontSendNotification);
        }
    if (page == 1) { devices.setTrack (session.selectedTrack()); setPage (1); }
    if (page == 0 && audioInspector.isVisible())
        if (auto wc = dynamic_cast<te::WaveAudioClip*> (session.selection.getFirstItemOfType<te::Clip>()))
            audioInspector.setClip (wc);
}

void EditorPanel::structureChanged()
{
    if (auto c = tuneView.getClip())  if (c->getTrack() == nullptr) tuneView.setClip (nullptr);
    if (auto c = takesView.getClip()) if (c->getTrack() == nullptr) takesView.setClip (nullptr);
    devices.refresh();
    if (auto c = pianoRoll.getClip())
        if (c->getTrack() == nullptr && c->getClipSlot() == nullptr) pianoRoll.setClip (nullptr);
    if (page == 0) pianoRoll.repaint();
    if (devices.isVisible() && devices.getTrack() != session.selectedTrack()) devices.setTrack (session.selectedTrack());
}

void EditorPanel::editChanged()
{
    tuneView.setClip (nullptr);
    takesView.setClip (nullptr);
    pianoRoll.setClip (nullptr);
    audioInspector.setClip (nullptr);
    audioInspector.setVisible (false);
    devices.setTrack (nullptr);
    setPage (1);
}

void EditorPanel::paint (juce::Graphics& g)
{
    g.fillAll (Colours::bg);
    g.setColour (Colours::panel);
    g.fillRect (getLocalBounds().removeFromTop (34));
    g.setColour (Colours::line);
    g.fillRect (0, 34, getWidth(), 1);
}

void EditorPanel::resized()
{
    auto r = getLocalBounds();
    auto top = r.removeFromTop (34).reduced (8, 4);
    clipTab.setBounds (top.removeFromLeft (64));
    tuneTab.setBounds (top.removeFromLeft (64));
    takesTab.setBounds (top.removeFromLeft (68));
    devicesTab.setBounds (top.removeFromLeft (80));
    keysTab.setBounds (top.removeFromLeft (84));
    top.removeFromLeft (10);
    autoTimeBtn.setBounds (top.removeFromRight (96));
    top.removeFromRight (8);
    if (quantiseBtn.isVisible()) { quantiseBtn.setBounds (top.removeFromRight (84)); top.removeFromRight (8); }
    title.setBounds (top);
    r.removeFromTop (1);
    pianoRoll.setBounds (r);
    audioInspector.setBounds (r);
    tuneView.setBounds (r);
    takesView.setBounds (r);
    devices.setBounds (r.reduced (4));
    keyboard.setBounds (r.reduced (8).withTrimmedTop (juce::jmax (0, r.getHeight() - 130)));
}

} // namespace ms
