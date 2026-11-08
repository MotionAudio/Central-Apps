#pragma once
#include "Common.h"

namespace ms
{

/** The black-and-gold look for every control in the app (and Motion Audio plugin editors). */
class MotionLookAndFeel : public juce::LookAndFeel_V4
{
public:
    MotionLookAndFeel();

    juce::Typeface::Ptr getTypefaceForFont (const juce::Font&) override;

    void drawRotarySlider (juce::Graphics&, int x, int y, int w, int h, float pos, float start, float end, juce::Slider&) override;
    void drawLinearSlider (juce::Graphics&, int x, int y, int w, int h, float pos, float minPos, float maxPos,
                           juce::Slider::SliderStyle, juce::Slider&) override;
    juce::Slider::SliderLayout getSliderLayout (juce::Slider&) override;
    juce::Label* createSliderTextBox (juce::Slider&) override;

    void drawButtonBackground (juce::Graphics&, juce::Button&, const juce::Colour&, bool over, bool down) override;
    void drawButtonText (juce::Graphics&, juce::TextButton&, bool over, bool down) override;
    juce::Font getTextButtonFont (juce::TextButton&, int buttonHeight) override;
    void drawToggleButton (juce::Graphics&, juce::ToggleButton&, bool over, bool down) override;

    void drawComboBox (juce::Graphics&, int w, int h, bool down, int bx, int by, int bw, int bh, juce::ComboBox&) override;
    juce::Font getComboBoxFont (juce::ComboBox&) override;
    void positionComboBoxText (juce::ComboBox&, juce::Label&) override;

    void drawPopupMenuBackground (juce::Graphics&, int w, int h) override;
    void drawPopupMenuItem (juce::Graphics&, const juce::Rectangle<int>&, bool isSeparator, bool isActive, bool isHighlighted,
                            bool isTicked, bool hasSubMenu, const juce::String& text, const juce::String& shortcutKeyText,
                            const juce::Drawable* icon, const juce::Colour* textColour) override;
    juce::Font getPopupMenuFont() override;

    void drawScrollbar (juce::Graphics&, juce::ScrollBar&, int x, int y, int w, int h, bool vertical, int thumbStart,
                        int thumbSize, bool over, bool down) override;
    int getDefaultScrollbarWidth() override { return 10; }

    void drawTabButton (juce::TabBarButton&, juce::Graphics&, bool over, bool down) override;
    void drawTabAreaBehindFrontButton (juce::TabbedButtonBar&, juce::Graphics&, int, int) override {}

    void drawTreeviewPlusMinusBox (juce::Graphics&, const juce::Rectangle<float>& area, juce::Colour, bool isOpen, bool over) override;
    void drawDocumentWindowTitleBar (juce::DocumentWindow&, juce::Graphics&, int w, int h, int titleSpaceX, int titleSpaceW,
                                     const juce::Image* icon, bool drawTitleTextOnLeft) override;

    void fillTextEditorBackground (juce::Graphics&, int w, int h, juce::TextEditor&) override;
    void drawTextEditorOutline (juce::Graphics&, int w, int h, juce::TextEditor&) override;

    void drawProgressBar (juce::Graphics&, juce::ProgressBar&, int w, int h, double progress, const juce::String&) override;
    void drawCallOutBoxBackground (juce::CallOutBox&, juce::Graphics&, const juce::Path&, juce::Image&) override;
    void drawTooltip (juce::Graphics&, const juce::String& text, int width, int height) override;

    void drawStretchableLayoutResizerBar (juce::Graphics&, int w, int h, bool isVertical, bool over, bool dragging) override;
};

/** A knob with its label under it and the value shown while you turn it. */
class Knob : public juce::Component, public juce::SettableTooltipClient
{
public:
    Knob (const juce::String& label, juce::Colour accent = Colours::gold);
    juce::Slider slider;
    juce::Label label;
    void resized() override;
    void setAccent (juce::Colour);
};

/** Draws a gold-edged panel with a title. */
void drawPanel (juce::Graphics&, juce::Rectangle<float>, const juce::String& title = {}, juce::Colour edge = Colours::line);

/** Small icon paths used across the UI. */
namespace Icons
{
    juce::Path play();
    juce::Path stop();
    juce::Path record();
    juce::Path loop();
    juce::Path metronome();
    juce::Path toStart();
    juce::Path rewind();
    juce::Path forward();
    juce::Path plus();
    juce::Path power();
    juce::Path wrench();
    juce::Path countIn();
    juce::Path punch();
}

/** A square icon button with a lit (gold) state. */
class IconButton : public juce::Button
{
public:
    IconButton (const juce::String& name, juce::Path icon, juce::Colour onColour = Colours::gold);
    void paintButton (juce::Graphics&, bool over, bool down) override;
    juce::Path icon;
    juce::Colour onColour;
};

} // namespace ms
