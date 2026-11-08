#include "Widgets.h"

namespace ms
{

LevelMeter::LevelMeter (bool v) : vertical (v)
{
    setInterceptsMouseClicks (true, false);
    setTooltip ("Click to reset the peak hold");
}

LevelMeter::~LevelMeter()  { setMeasurer (nullptr); }

void LevelMeter::setMeasurer (te::LevelMeasurer* m)
{
    if (measurer.get() == m && m != nullptr) return;
    if (auto old = measurer.get()) old->removeClient (client);
    measurer = m;
    client.reset();
    if (m != nullptr) { m->addClient (client); startTimerHz (30); }
    else stopTimer();
}

void LevelMeter::timerCallback()
{
    if (measurer.get() == nullptr) { stopTimer(); return; }
    bool changed = false;
    for (int c = 0; c < 2; ++c)
    {
        auto db = client.getAndClearAudioLevel (c).dB;
        // fast attack, smooth fall (about 26 dB a second)
        float next = db > level[c] ? db : juce::jmax (db, level[c] - 0.9f);
        if (std::abs (next - level[c]) > 0.05f) changed = true;
        level[c] = next;
        if (db >= peakHold[c]) { peakHold[c] = db; holdCount[c] = 45; }
        else if (--holdCount[c] <= 0) peakHold[c] = juce::jmax (-100.0f, peakHold[c] - 0.6f);
        if (db > 0.0f) clip = true;
    }
    if (client.getAndClearOverload()) clip = true;
    if (changed || clip) repaint();
}

static float dbToPos (float db)
{
    // a fader-like curve: 0 dB at 82 %, -60 at the bottom, +6 at the top
    if (db <= -60.0f) return 0.0f;
    if (db >= 6.0f) return 1.0f;
    if (db > 0.0f) return 0.82f + 0.18f * db / 6.0f;
    return 0.82f * std::pow ((db + 60.0f) / 60.0f, 1.7f);
}

void LevelMeter::paint (juce::Graphics& g)
{
    auto r = getLocalBounds().toFloat();
    g.setColour (Colours::bg2);
    g.fillRoundedRectangle (r, 2.0f);
    r.reduce (1.5f, 1.5f);
    auto clipH = vertical ? 3.0f : 0.0f;
    if (vertical) r.removeFromTop (clipH + 1.0f);

    for (int c = 0; c < 2; ++c)
    {
        auto lane = vertical ? r.withWidth ((r.getWidth() - 1.0f) / 2.0f).withX (r.getX() + (float) c * ((r.getWidth() + 1.0f) / 2.0f))
                             : r.withHeight ((r.getHeight() - 1.0f) / 2.0f).withY (r.getY() + (float) c * ((r.getHeight() + 1.0f) / 2.0f));
        auto p = dbToPos (level[c]);
        if (vertical)
        {
            auto bar = lane.withTop (lane.getBottom() - lane.getHeight() * p);
            juce::ColourGradient grad (Colours::goldDeep, 0, lane.getBottom(), Colours::live, 0, lane.getY(), false);
            grad.addColour (0.62, Colours::gold);
            grad.addColour (0.80, Colours::goldHi);
            g.setGradientFill (grad);
            g.fillRect (bar);
            auto ph = dbToPos (peakHold[c]);
            if (ph > 0.01f)
            {
                g.setColour (peakHold[c] > 0 ? Colours::live : Colours::goldHi);
                g.fillRect (lane.withTop (lane.getBottom() - lane.getHeight() * ph).withHeight (1.5f));
            }
        }
        else
        {
            auto bar = lane.withWidth (lane.getWidth() * p);
            juce::ColourGradient grad (Colours::goldDeep, lane.getX(), 0, Colours::live, lane.getRight(), 0, false);
            grad.addColour (0.62, Colours::gold);
            grad.addColour (0.80, Colours::goldHi);
            g.setGradientFill (grad);
            g.fillRect (bar);
        }
    }
    if (vertical)
    {
        g.setColour (clip ? Colours::live : Colours::panel3);
        g.fillRect (getLocalBounds().toFloat().reduced (1.5f).withHeight (clipH));
    }
    if (showScale && vertical)
    {
        g.setFont (Fonts::narrow (9.0f));
        for (float db : { 0.0f, -6.0f, -12.0f, -24.0f, -48.0f })
        {
            auto y = r.getBottom() - r.getHeight() * dbToPos (db);
            g.setColour (Colours::line2);
            g.fillRect (r.getRight() - 3.0f, y, 3.0f, 1.0f);
        }
    }
}

//==============================================================================
SmallToggle::SmallToggle (const juce::String& text, juce::Colour on, const juce::String& tip)
    : juce::Button (text), onColour (on)
{
    setClickingTogglesState (false);
    setTooltip (tip);
}

void SmallToggle::paintButton (juce::Graphics& g, bool over, bool down)
{
    auto r = getLocalBounds().toFloat().reduced (0.5f);
    bool on = getToggleState();
    g.setColour (on ? onColour : (down ? Colours::panel3 : over ? Colours::panel3.brighter (0.05f) : Colours::panel2));
    g.fillRoundedRectangle (r, 3.0f);
    g.setColour (on ? onColour.brighter (0.2f) : Colours::line);
    g.drawRoundedRectangle (r, 3.0f, 1.0f);
    g.setColour (on ? (onColour.getPerceivedBrightness() > 0.55f ? Colours::goldText : juce::Colours::white) : Colours::muted);
    g.setFont (Fonts::heavy (juce::jmin (12.0f, r.getHeight() * 0.62f)));
    g.drawText (getButtonText(), r, juce::Justification::centred);
}

EditableName::EditableName()
{
    setEditable (false, true, false);
    setFont (Fonts::semi (13.5f));
    setColour (juce::Label::textColourId, Colours::text);
    setColour (juce::Label::textWhenEditingColourId, Colours::text);
    setColour (juce::Label::backgroundWhenEditingColourId, Colours::bg2);
    setColour (juce::Label::outlineWhenEditingColourId, Colours::gold);
    setMinimumHorizontalScale (0.7f);
}

void showColourMenu (juce::Component* target, std::function<void (juce::Colour)> cb)
{
    juce::PopupMenu m;
    for (int i = 0; i < 10; ++i)
    {
        auto c = Colours::track (i);
        juce::PopupMenu::Item item;
        item.text = juce::String::charToString (0x25CF) + "  " + juce::String::formatted ("Colour %d", i + 1);
        item.colour = c;
        item.action = [cb, c] { cb (c); };
        m.addItem (item);
    }
    m.showMenuAsync (juce::PopupMenu::Options().withTargetComponent (target));
}

void styleMiniFader (juce::Slider& s)
{
    s.setSliderStyle (juce::Slider::LinearHorizontal);
    s.setTextBoxStyle (juce::Slider::NoTextBox, false, 0, 0);
    s.setPopupDisplayEnabled (true, true, nullptr);
}

} // namespace ms
