#include "Automation.h"
#include "Theme.h"

namespace ms
{

static const juce::Identifier msAutoShow ("msAutoShow"), msAutoParam ("msAutoParam");

namespace automation
{
    bool isShown (te::AudioTrack& t)                          { return (bool) t.state.getProperty (msAutoShow, false); }
    void setShown (te::AudioTrack& t, bool b)                 { t.state.setProperty (msAutoShow, b, nullptr); }
    juce::String currentId (te::AudioTrack& t)                { return t.state[msAutoParam].toString(); }
    void setCurrentId (te::AudioTrack& t, const juce::String& id)  { t.state.setProperty (msAutoParam, id, nullptr); }

    juce::String idFor (te::AutomatableParameter& p)
    {
        if (auto pl = p.getPlugin()) return pl->itemID.toString() + "/" + p.paramID;
        return p.paramID;
    }

    te::AutomatableParameter* paramFor (te::AudioTrack& t, const juce::String& id)
    {
        if (id.isNotEmpty())
        {
            auto pid = id.upToFirstOccurrenceOf ("/", false, false), param = id.fromFirstOccurrenceOf ("/", false, false);
            for (auto p : t.pluginList)
                if (p->itemID.toString() == pid)
                    if (auto ap = p->getAutomatableParameterByID (param)) return ap.get();
        }
        if (auto vp = t.getVolumePlugin()) return vp->volParam.get();
        return nullptr;
    }

    te::AutomatableParameter* currentParam (te::AudioTrack& t)  { return paramFor (t, currentId (t)); }

    juce::String displayName (te::AudioTrack& t, te::AutomatableParameter& p)
    {
        if (auto vp = t.getVolumePlugin())
        {
            if (&p == vp->volParam.get()) return "Volume";
            if (&p == vp->panParam.get()) return "Pan";
        }
        if (auto pl = p.getPlugin()) return pl->getName() + ": " + p.getParameterName();
        return p.getParameterName();
    }

    bool hasAutomation (te::AudioTrack& t)
    {
        for (auto p : t.getAllAutomatableParams())
            if (p->hasAutomationPoints()) return true;
        return false;
    }

    void showParamMenu (Session& s, te::AudioTrack& t, juce::Component* target)
    {
        juce::PopupMenu m;
        te::AudioTrack::Ptr tp (&t);
        auto cur = currentParam (t);
        auto add = [&] (juce::PopupMenu& menu, te::AutomatableParameter* p, const juce::String& name)
        {
            if (p == nullptr) return;
            auto id = idFor (*p);
            menu.addItem (name + (p->hasAutomationPoints() ? "   (has automation)" : ""), true, p == cur, [tp, id]
            {
                setCurrentId (*tp, id);
                setShown (*tp, true);
            });
        };
        if (auto vp = t.getVolumePlugin())
        {
            add (m, vp->volParam.get(), "Volume");
            add (m, vp->panParam.get(), "Pan");
        }
        for (auto p : t.pluginList)
        {
            if (dynamic_cast<te::VolumeAndPanPlugin*> (p) != nullptr || dynamic_cast<te::LevelMeterPlugin*> (p) != nullptr) continue;
            juce::PopupMenu sub;
            int n = juce::jmin (160, p->getNumAutomatableParameters());
            for (int i = 0; i < n; ++i)
                if (auto ap = p->getAutomatableParameter (i))
                    add (sub, ap.get(), ap->getParameterName());
            if (sub.getNumItems() > 0) m.addSubMenu (p->getName(), sub);
        }
        m.addSeparator();
        if (cur != nullptr && cur->hasAutomationPoints())
        {
            te::AutomatableParameter::Ptr cp (cur);
            m.addItem ("Clear this lane", [cp, &s] { cp->getCurve().clear (&s.edit->getUndoManager()); });
        }
        m.addItem (isShown (t) ? "Hide automation" : "Show automation", [tp] { setShown (*tp, ! isShown (*tp)); });
        m.showMenuAsync (juce::PopupMenu::Options().withTargetComponent (target));
    }
}

//==============================================================================
juce::String sidechainSource (te::Plugin& p)
{
    if (! p.canSidechain()) return {};
    auto n = p.getSidechainSourceName();
    if (n.isEmpty() || n.startsWith ("<")) return {};
    return n.fromFirstOccurrenceOf (". ", false, false).isNotEmpty() ? n.fromFirstOccurrenceOf (". ", false, false) : n;
}

void addSidechainMenu (juce::PopupMenu& m, te::Plugin::Ptr p)
{
    if (p == nullptr || ! p->canSidechain()) return;
    juce::PopupMenu sc;
    auto current = p->getSidechainSourceName();
    for (auto& n : p->getSidechainSourceNames (true))
    {
        bool none = n.startsWith ("<");
        auto label = none ? juce::String ("None") : (n.fromFirstOccurrenceOf (". ", false, false).isNotEmpty() ? n.fromFirstOccurrenceOf (". ", false, false) : n);
        sc.addItem (label, true, none ? (current.isEmpty() || current.startsWith ("<")) : n == current, [p, n]
        {
            p->setSidechainSourceByName (n);
            if (! n.startsWith ("<") && p->getNumWires() == 0) p->guessSidechainRouting();
        });
    }
    m.addSubMenu ("Sidechain from" + (sidechainSource (*p).isNotEmpty() ? " (" + sidechainSource (*p) + ")" : juce::String()), sc);
}

//==============================================================================
AutomationLane::AutomationLane (Session& s, te::AudioTrack& t) : session (s), track (&t)
{
    setRepaintsOnMouseActivity (false);
}

float AutomationLane::timeToX (te::TimePosition t) const
{
    return (float) beatToX (session.edit->tempoSequence.toBeats (t).inBeats());
}

te::TimePosition AutomationLane::xToTime (float x, bool snap) const
{
    auto b = te::BeatPosition::fromBeats (juce::jmax (0.0, xToBeat (x)));
    if (snap) b = session.snapBeat (b);
    return session.edit->tempoSequence.toTime (b);
}

float AutomationLane::valueToY (te::AutomatableParameter& p, float v) const
{
    auto n = p.valueRange.convertTo0to1 (juce::jlimit (p.valueRange.start, p.valueRange.end, v));
    return 6.0f + (1.0f - n) * (float) (getHeight() - 12);
}

float AutomationLane::yToValue (te::AutomatableParameter& p, float y) const
{
    auto n = juce::jlimit (0.0f, 1.0f, 1.0f - (y - 6.0f) / (float) juce::jmax (1, getHeight() - 12));
    return p.valueRange.convertFrom0to1 (n);
}

int AutomationLane::pointAt (juce::Point<int> pos) const
{
    auto p = automation::currentParam (*track);
    if (p == nullptr) return -1;
    auto& c = p->getCurve();
    for (int i = c.getNumPoints(); --i >= 0;)
    {
        auto x = timeToX (c.getPointTime (i)), y = valueToY (*p, c.getPointValue (i));
        if (std::abs (pos.x - x) <= 6 && std::abs (pos.y - y) <= 6) return i;
    }
    return -1;
}

void AutomationLane::paint (juce::Graphics& g)
{
    g.fillAll (Colours::bg2);
    g.setColour (Colours::line);
    g.fillRect (0, 0, getWidth(), 1);
    auto p = automation::currentParam (*track);
    if (p == nullptr || ! beatToX) return;
    auto& c = p->getCurve();
    auto col = track->getColour().interpolatedWith (Colours::gold, 0.5f);
    juce::Path path;
    if (c.getNumPoints() == 0)
    {
        auto y = valueToY (*p, p->getCurrentValue());
        g.setColour (col.withAlpha (0.5f));
        float dashes[] = { 4.0f, 4.0f };
        g.drawDashedLine ({ 0.0f, y, (float) getWidth(), y }, dashes, 2, 1.2f);
        g.setColour (Colours::dim);
        g.setFont (Fonts::ui (11.5f));
        g.drawText ("Click to draw " + automation::displayName (*track, *p) + " automation", getLocalBounds().reduced (8, 4), juce::Justification::topLeft);
        return;
    }
    // the curve, sampled across the view
    for (int x = 0; x <= getWidth(); x += 2)
    {
        auto t = xToTime ((float) x, false);
        auto y = valueToY (*p, c.getValueAt (t, p->getCurrentValue()));
        if (x == 0) path.startNewSubPath ((float) x, y); else path.lineTo ((float) x, y);
    }
    auto fill = path;
    fill.lineTo ((float) getWidth(), (float) getHeight());
    fill.lineTo (0.0f, (float) getHeight());
    fill.closeSubPath();
    g.setColour (col.withAlpha (0.12f));
    g.fillPath (fill);
    g.setColour (col);
    g.strokePath (path, juce::PathStrokeType (1.6f));
    for (int i = 0; i < c.getNumPoints(); ++i)
    {
        auto x = timeToX (c.getPointTime (i)), y = valueToY (*p, c.getPointValue (i));
        if (x < -8 || x > getWidth() + 8) continue;
        g.setColour (i == hover || i == dragging ? Colours::goldHi : col);
        g.fillEllipse (x - 4, y - 4, 8, 8);
        g.setColour (Colours::bg);
        g.drawEllipse (x - 4, y - 4, 8, 8, 1.0f);
    }
    if (readout.isNotEmpty())
    {
        g.setColour (Colours::text);
        g.setFont (Fonts::semi (11.5f));
        g.drawText (readout, getLocalBounds().reduced (8, 4), juce::Justification::topRight);
    }
}

void AutomationLane::mouseDown (const juce::MouseEvent& e)
{
    auto p = automation::currentParam (*track);
    if (p == nullptr) return;
    auto* um = &session.edit->getUndoManager();
    auto i = pointAt (e.getPosition());
    if (e.mods.isPopupMenu())
    {
        juce::PopupMenu m;
        te::AutomatableParameter::Ptr cp (p);
        if (i >= 0) m.addItem ("Delete point", [cp, i, um] { cp->getCurve().removePoint (i, um); });
        m.addItem ("Clear this lane", [cp, um] { cp->getCurve().clear (um); });
        m.addItem ("Choose what to automate...", [this] { automation::showParamMenu (session, *track, this); });
        m.showMenuAsync (juce::PopupMenu::Options().withTargetComponent (this).withMousePosition());
        return;
    }
    um->beginNewTransaction ("Automation");
    if (i < 0)
    {
        auto t = xToTime ((float) e.x, ! e.mods.isAltDown());
        i = p->getCurve().addPoint (t, yToValue (*p, (float) e.y), 0.0f, um);
    }
    dragging = i;
    readout = p->valueToString (p->getCurve().getPointValue (i));
    repaint();
}

void AutomationLane::mouseDrag (const juce::MouseEvent& e)
{
    if (dragging < 0) return;
    auto p = automation::currentParam (*track);
    if (p == nullptr) return;
    auto t = xToTime ((float) e.x, ! e.mods.isAltDown());
    auto v = yToValue (*p, (float) e.y);
    dragging = p->getCurve().movePoint (*p, dragging, t, v, false, &session.edit->getUndoManager());
    readout = p->valueToString (v);
    repaint();
}

void AutomationLane::mouseUp (const juce::MouseEvent&)
{
    dragging = -1;
    readout = {};
    repaint();
}

void AutomationLane::mouseDoubleClick (const juce::MouseEvent& e)
{
    auto p = automation::currentParam (*track);
    auto i = pointAt (e.getPosition());
    if (p != nullptr && i >= 0)
    {
        p->getCurve().removePoint (i, &session.edit->getUndoManager());
        dragging = -1;
        repaint();
    }
}

void AutomationLane::mouseMove (const juce::MouseEvent& e)
{
    auto h = pointAt (e.getPosition());
    if (h != hover) { hover = h; repaint(); }
    setMouseCursor (h >= 0 ? juce::MouseCursor::DraggingHandCursor : juce::MouseCursor::CrosshairCursor);
}

} // namespace ms
