#pragma once
#include "Common.h"
#include "Theme.h"

namespace ms
{

/** Stereo peak meter fed by a Tracktion LevelMeasurer, black well with a gold-to-red ladder. */
class LevelMeter : public juce::Component, public juce::SettableTooltipClient, private juce::Timer
{
public:
    LevelMeter (bool vertical = true);
    ~LevelMeter() override;
    void setMeasurer (te::LevelMeasurer*);
    te::LevelMeasurer* getMeasurer() const { return measurer.get(); }
    void paint (juce::Graphics&) override;
    void mouseDown (const juce::MouseEvent&) override  { peakHold[0] = peakHold[1] = -100.0f; clip = false; repaint(); }
    bool showScale = false;

private:
    void timerCallback() override;
    juce::WeakReference<te::LevelMeasurer> measurer;
    te::LevelMeasurer::Client client;
    float level[2] { -100.0f, -100.0f }, peakHold[2] { -100.0f, -100.0f };
    int holdCount[2] {};
    bool vertical, clip = false;
};

/** Small square toggle (M / S / R / I) with its own lit colour. */
class SmallToggle : public juce::Button
{
public:
    SmallToggle (const juce::String& text, juce::Colour on, const juce::String& tip);
    void paintButton (juce::Graphics&, bool over, bool down) override;
    juce::Colour onColour;
};

/** A text label that becomes editable on double-click. */
class EditableName : public juce::Label
{
public:
    EditableName();
};

/** Menu of track colours. */
void showColourMenu (juce::Component* target, std::function<void (juce::Colour)>);

/** Paints a horizontal fader-style volume slider (track headers). */
void styleMiniFader (juce::Slider&);

} // namespace ms
