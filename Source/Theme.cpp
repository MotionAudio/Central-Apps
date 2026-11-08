#include "Theme.h"

namespace ms
{

static juce::Typeface::Ptr loadFont (const void* data, int size)
{
    return juce::Typeface::createSystemTypefaceFor (data, (size_t) size);
}

juce::Typeface::Ptr Fonts::regular()   { static auto t = loadFont (MotionData::archivomedium_ttf, MotionData::archivomedium_ttfSize); return t; }
juce::Typeface::Ptr Fonts::semibold()  { static auto t = loadFont (MotionData::archivosemibold_ttf, MotionData::archivosemibold_ttfSize); return t; }
juce::Typeface::Ptr Fonts::bold()      { static auto t = loadFont (MotionData::archivobold_ttf, MotionData::archivobold_ttfSize); return t; }
juce::Typeface::Ptr Fonts::condensed() { static auto t = loadFont (MotionData::archivocondensedbold_ttf, MotionData::archivocondensedbold_ttfSize); return t; }

//==============================================================================
MotionLookAndFeel::MotionLookAndFeel()
{
    using namespace juce;
    auto scheme = LookAndFeel_V4::ColourScheme (Colours::panel, Colours::bg, Colours::panel2, Colours::line,
                                                Colours::text, Colours::panel2, Colours::goldText, Colours::gold, Colours::text);
    setColourScheme (scheme);

    setColour (ResizableWindow::backgroundColourId, Colours::bg);
    setColour (DocumentWindow::backgroundColourId, Colours::bg);
    setColour (TextButton::buttonColourId, Colours::panel2);
    setColour (TextButton::buttonOnColourId, Colours::gold);
    setColour (TextButton::textColourOffId, Colours::text);
    setColour (TextButton::textColourOnId, Colours::goldText);
    setColour (ComboBox::backgroundColourId, Colours::panel2);
    setColour (ComboBox::outlineColourId, Colours::line);
    setColour (ComboBox::textColourId, Colours::text);
    setColour (ComboBox::arrowColourId, Colours::gold);
    setColour (PopupMenu::backgroundColourId, Colours::panel);
    setColour (PopupMenu::textColourId, Colours::text);
    setColour (PopupMenu::highlightedBackgroundColourId, Colours::gold);
    setColour (PopupMenu::highlightedTextColourId, Colours::goldText);
    setColour (Label::textColourId, Colours::text);
    setColour (Slider::thumbColourId, Colours::gold);
    setColour (Slider::trackColourId, Colours::gold);
    setColour (Slider::rotarySliderFillColourId, Colours::gold);
    setColour (Slider::rotarySliderOutlineColourId, Colours::panel3);
    setColour (Slider::textBoxTextColourId, Colours::text);
    setColour (Slider::textBoxOutlineColourId, Colours::line);
    setColour (Slider::textBoxBackgroundColourId, Colours::bg2);
    setColour (TextEditor::backgroundColourId, Colours::bg2);
    setColour (TextEditor::textColourId, Colours::text);
    setColour (TextEditor::outlineColourId, Colours::line);
    setColour (TextEditor::focusedOutlineColourId, Colours::gold);
    setColour (TextEditor::highlightColourId, Colours::gold.withAlpha (0.35f));
    setColour (CaretComponent::caretColourId, Colours::gold);
    setColour (ListBox::backgroundColourId, Colours::panel);
    setColour (ListBox::textColourId, Colours::text);
    setColour (TreeView::backgroundColourId, Colours::panel);
    setColour (TreeView::selectedItemBackgroundColourId, Colours::gold.withAlpha (0.22f));
    setColour (TreeView::linesColourId, Colours::line);
    setColour (ScrollBar::thumbColourId, Colours::panel3);
    setColour (ToggleButton::textColourId, Colours::text);
    setColour (ToggleButton::tickColourId, Colours::gold);
    setColour (ToggleButton::tickDisabledColourId, Colours::dim);
    setColour (TabbedButtonBar::tabTextColourId, Colours::muted);
    setColour (TabbedButtonBar::frontTextColourId, Colours::gold);
    setColour (TabbedComponent::backgroundColourId, Colours::bg);
    setColour (TabbedComponent::outlineColourId, Colours::line);
    setColour (AlertWindow::backgroundColourId, Colours::panel);
    setColour (AlertWindow::textColourId, Colours::text);
    setColour (AlertWindow::outlineColourId, Colours::gold);
    setColour (ProgressBar::foregroundColourId, Colours::gold);
    setColour (ProgressBar::backgroundColourId, Colours::bg2);
    setColour (TooltipWindow::backgroundColourId, Colours::panel2);
    setColour (TooltipWindow::textColourId, Colours::text);
    setColour (TooltipWindow::outlineColourId, Colours::gold);
    setColour (DirectoryContentsDisplayComponent::highlightColourId, Colours::gold.withAlpha (0.25f));
    setColour (DirectoryContentsDisplayComponent::textColourId, Colours::text);
    setColour (FileBrowserComponent::currentPathBoxBackgroundColourId, Colours::panel2);
    setColour (FileBrowserComponent::currentPathBoxTextColourId, Colours::text);
    setColour (FileBrowserComponent::currentPathBoxArrowColourId, Colours::gold);
    setColour (FileBrowserComponent::filenameBoxBackgroundColourId, Colours::panel2);
    setColour (FileBrowserComponent::filenameBoxTextColourId, Colours::text);
    setColour (HyperlinkButton::textColourId, Colours::gold);
    setColour (GroupComponent::outlineColourId, Colours::line);
    setColour (GroupComponent::textColourId, Colours::gold);

    setDefaultSansSerifTypeface (Fonts::regular());
}

juce::Typeface::Ptr MotionLookAndFeel::getTypefaceForFont (const juce::Font& f)
{
    if (f.getTypefaceName() == juce::Font::getDefaultSansSerifFontName())
        return f.isBold() ? Fonts::semibold() : Fonts::regular();
    return LookAndFeel_V4::getTypefaceForFont (f);
}

//==============================================================================
void MotionLookAndFeel::drawRotarySlider (juce::Graphics& g, int x, int y, int w, int h, float pos, float start, float end, juce::Slider& s)
{
    using namespace juce;
    auto accent = s.findColour (Slider::rotarySliderFillColourId);
    auto b = Rectangle<float> ((float) x, (float) y, (float) w, (float) h).reduced (3.0f);
    auto size = jmin (b.getWidth(), b.getHeight());
    auto r = b.withSizeKeepingCentre (size, size);
    auto centre = r.getCentre();
    auto radius = size * 0.5f;
    auto angle = start + pos * (end - start);
    auto lineW = jmax (2.0f, radius * 0.11f);

    // track
    Path track;
    track.addCentredArc (centre.x, centre.y, radius - lineW, radius - lineW, 0, start, end, true);
    g.setColour (Colours::panel3);
    g.strokePath (track, PathStrokeType (lineW, PathStrokeType::curved, PathStrokeType::rounded));

    // value arc (from the centre for bipolar knobs)
    bool bipolar = s.getMinimum() < 0 && s.getMaximum() > 0;
    float from = bipolar ? start + (float) ((0 - s.getMinimum()) / (s.getMaximum() - s.getMinimum())) * (end - start) : start;
    Path arc;
    arc.addCentredArc (centre.x, centre.y, radius - lineW, radius - lineW, 0, jmin (from, angle), jmax (from, angle), true);
    g.setColour (s.isEnabled() ? accent : Colours::dim);
    g.strokePath (arc, PathStrokeType (lineW, PathStrokeType::curved, PathStrokeType::rounded));

    // body: a dark machined cap with a gold rim
    auto capR = radius - lineW * 2.4f;
    auto cap = Rectangle<float> (capR * 2, capR * 2).withCentre (centre);
    ColourGradient grad (Colour (0xff2a2a30), cap.getX(), cap.getY(), Colour (0xff0d0d10), cap.getRight(), cap.getBottom(), false);
    g.setGradientFill (grad);
    g.fillEllipse (cap);
    g.setColour (Colour (0xff000000).withAlpha (0.6f));
    g.drawEllipse (cap.expanded (1.0f), 1.0f);
    g.setColour (accent.withAlpha (0.35f));
    g.drawEllipse (cap, 1.0f);

    // pointer
    Path p;
    auto pl = capR * 0.75f;
    p.addRoundedRectangle (-lineW * 0.45f, -capR + 2.0f, lineW * 0.9f, pl * 0.55f, lineW * 0.45f);
    g.setColour (s.isEnabled() ? Colours::goldHi : Colours::muted);
    g.fillPath (p, AffineTransform::rotation (angle).translated (centre));
}

void MotionLookAndFeel::drawLinearSlider (juce::Graphics& g, int x, int y, int w, int h, float pos, float, float,
                                          juce::Slider::SliderStyle style, juce::Slider& s)
{
    using namespace juce;
    auto accent = s.findColour (Slider::trackColourId);
    if (style == Slider::LinearVertical)
    {
        // a mixer-style fader: thin slot, a gold-capped handle
        auto slot = Rectangle<float> ((float) x + (float) w * 0.5f - 2.0f, (float) y, 4.0f, (float) h);
        g.setColour (Colours::bg2);
        g.fillRoundedRectangle (slot, 2.0f);
        auto fill = slot.withTop (pos);
        g.setColour (accent.withAlpha (0.55f));
        g.fillRoundedRectangle (fill, 2.0f);

        auto cap = Rectangle<float> (jmin ((float) w - 2.0f, 34.0f), 16.0f).withCentre ({ (float) x + (float) w * 0.5f, pos });
        ColourGradient grad (Colour (0xff3a3a42), cap.getX(), cap.getY(), Colour (0xff15151a), cap.getX(), cap.getBottom(), false);
        g.setGradientFill (grad);
        g.fillRoundedRectangle (cap, 3.0f);
        g.setColour (Colours::line2);
        g.drawRoundedRectangle (cap, 3.0f, 1.0f);
        g.setColour (Colours::gold);
        g.fillRect (cap.withSizeKeepingCentre (cap.getWidth() - 8.0f, 2.0f));
        return;
    }
    if (style == Slider::LinearHorizontal || style == Slider::LinearBar)
    {
        auto slot = Rectangle<float> ((float) x, (float) y + (float) h * 0.5f - 2.0f, (float) w, 4.0f);
        g.setColour (Colours::bg2);
        g.fillRoundedRectangle (slot, 2.0f);
        bool bipolar = s.getMinimum() < 0 && s.getMaximum() > 0;
        float from = bipolar ? (float) x + (float) w * (float) ((0 - s.getMinimum()) / (s.getMaximum() - s.getMinimum())) : (float) x;
        g.setColour (accent);
        g.fillRoundedRectangle (Rectangle<float> (jmin (from, pos), slot.getY(), std::abs (pos - from), 4.0f), 2.0f);
        g.setColour (Colours::goldHi);
        g.fillEllipse (Rectangle<float> (11.0f, 11.0f).withCentre ({ pos, slot.getCentreY() }));
        return;
    }
    LookAndFeel_V4::drawLinearSlider (g, x, y, w, h, pos, 0, 0, style, s);
}

juce::Slider::SliderLayout MotionLookAndFeel::getSliderLayout (juce::Slider& s)
{
    return LookAndFeel_V4::getSliderLayout (s);
}

juce::Label* MotionLookAndFeel::createSliderTextBox (juce::Slider& s)
{
    auto* l = LookAndFeel_V4::createSliderTextBox (s);
    l->setFont (Fonts::narrow (12.0f));
    l->setColour (juce::Label::backgroundColourId, juce::Colours::transparentBlack);
    l->setColour (juce::Label::outlineColourId, juce::Colours::transparentBlack);
    l->setColour (juce::Label::textColourId, Colours::muted);
    return l;
}

//==============================================================================
void MotionLookAndFeel::drawButtonBackground (juce::Graphics& g, juce::Button& b, const juce::Colour& bgColour, bool over, bool down)
{
    using namespace juce;
    auto r = b.getLocalBounds().toFloat().reduced (0.5f);
    bool on = b.getToggleState();
    auto base = on ? b.findColour (TextButton::buttonOnColourId) : bgColour;
    if (down) base = base.brighter (0.15f);
    else if (over) base = base.brighter (0.07f);
    g.setColour (base);
    g.fillRoundedRectangle (r, 4.0f);
    g.setColour (on ? base.brighter (0.3f) : Colours::line);
    g.drawRoundedRectangle (r, 4.0f, 1.0f);
}

void MotionLookAndFeel::drawButtonText (juce::Graphics& g, juce::TextButton& b, bool, bool)
{
    g.setFont (getTextButtonFont (b, b.getHeight()));
    g.setColour (b.findColour (b.getToggleState() ? juce::TextButton::textColourOnId : juce::TextButton::textColourOffId)
                  .withMultipliedAlpha (b.isEnabled() ? 1.0f : 0.45f));
    g.drawFittedText (b.getButtonText(), b.getLocalBounds().reduced (4, 1), juce::Justification::centred, 1, 0.8f);
}

juce::Font MotionLookAndFeel::getTextButtonFont (juce::TextButton&, int h)
{
    return Fonts::semi (juce::jmin (14.0f, (float) h * 0.55f));
}

void MotionLookAndFeel::drawToggleButton (juce::Graphics& g, juce::ToggleButton& b, bool over, bool)
{
    using namespace juce;
    auto r = b.getLocalBounds().toFloat();
    auto box = r.removeFromLeft (r.getHeight()).reduced (4.0f);
    g.setColour (Colours::bg2);
    g.fillRoundedRectangle (box, 3.0f);
    g.setColour (b.getToggleState() ? Colours::gold : (over ? Colours::line2 : Colours::line));
    g.drawRoundedRectangle (box, 3.0f, 1.2f);
    if (b.getToggleState())
        g.fillRoundedRectangle (box.reduced (3.5f), 2.0f);
    g.setColour (Colours::text.withMultipliedAlpha (b.isEnabled() ? 1.0f : 0.5f));
    g.setFont (Fonts::ui (14.0f));
    g.drawFittedText (b.getButtonText(), r.toNearestInt().withTrimmedLeft (4), Justification::centredLeft, 1);
}

//==============================================================================
void MotionLookAndFeel::drawComboBox (juce::Graphics& g, int w, int h, bool, int, int, int, int, juce::ComboBox& c)
{
    using namespace juce;
    auto r = Rectangle<float> (0, 0, (float) w, (float) h).reduced (0.5f);
    g.setColour (c.findColour (ComboBox::backgroundColourId));
    g.fillRoundedRectangle (r, 4.0f);
    g.setColour (c.hasKeyboardFocus (true) ? Colours::gold : c.findColour (ComboBox::outlineColourId));
    g.drawRoundedRectangle (r, 4.0f, 1.0f);
    Path arrow;
    auto ax = (float) w - 14.0f, ay = (float) h * 0.5f;
    arrow.addTriangle (ax - 4.0f, ay - 2.0f, ax + 4.0f, ay - 2.0f, ax, ay + 3.0f);
    g.setColour (Colours::gold.withMultipliedAlpha (c.isEnabled() ? 1.0f : 0.4f));
    g.fillPath (arrow);
}

juce::Font MotionLookAndFeel::getComboBoxFont (juce::ComboBox& c)  { return Fonts::ui (juce::jmin (14.0f, (float) c.getHeight() * 0.58f)); }

void MotionLookAndFeel::positionComboBoxText (juce::ComboBox& c, juce::Label& l)
{
    l.setBounds (6, 1, c.getWidth() - 24, c.getHeight() - 2);
    l.setFont (getComboBoxFont (c));
}

void MotionLookAndFeel::drawPopupMenuBackground (juce::Graphics& g, int w, int h)
{
    g.fillAll (Colours::panel);
    g.setColour (Colours::goldDeep);
    g.drawRect (0, 0, w, h, 1);
}

void MotionLookAndFeel::drawPopupMenuItem (juce::Graphics& g, const juce::Rectangle<int>& area, bool isSeparator, bool isActive,
                                           bool isHighlighted, bool isTicked, bool hasSubMenu, const juce::String& text,
                                           const juce::String& shortcutKeyText, const juce::Drawable* icon, const juce::Colour* textColour)
{
    using namespace juce;
    if (isSeparator)
    {
        g.setColour (Colours::line);
        g.fillRect (area.reduced (8, 0).withHeight (1).withY (area.getCentreY()));
        return;
    }
    auto r = area.reduced (2, 0);
    if (isHighlighted && isActive)
    {
        g.setColour (Colours::gold);
        g.fillRoundedRectangle (r.toFloat(), 3.0f);
    }
    auto tc = isHighlighted && isActive ? Colours::goldText : (textColour != nullptr ? *textColour : Colours::text);
    if (! isActive) tc = Colours::dim;
    g.setColour (tc);
    g.setFont (getPopupMenuFont());
    auto tr = r.reduced (10, 0);
    auto tick = tr.removeFromLeft (16);
    if (isTicked)
    {
        g.fillEllipse (tick.toFloat().withSizeKeepingCentre (6, 6));
    }
    if (icon != nullptr)
        icon->drawWithin (g, tr.removeFromLeft (18).toFloat().reduced (2), RectanglePlacement::centred, 1.0f);
    if (hasSubMenu)
    {
        Path p;
        auto ax = (float) tr.getRight() - 4.0f, ay = (float) tr.getCentreY();
        p.addTriangle (ax - 4.0f, ay - 4.0f, ax - 4.0f, ay + 4.0f, ax + 1.0f, ay);
        g.fillPath (p);
        tr.removeFromRight (12);
    }
    g.drawFittedText (text, tr, Justification::centredLeft, 1);
    if (shortcutKeyText.isNotEmpty())
    {
        g.setColour (tc.withMultipliedAlpha (0.65f));
        g.setFont (Fonts::ui (12.0f));
        g.drawText (shortcutKeyText, tr, Justification::centredRight);
    }
}

juce::Font MotionLookAndFeel::getPopupMenuFont()  { return Fonts::ui (14.5f); }

void MotionLookAndFeel::drawScrollbar (juce::Graphics& g, juce::ScrollBar&, int x, int y, int w, int h, bool vertical,
                                       int thumbStart, int thumbSize, bool over, bool down)
{
    juce::Rectangle<int> thumb = vertical ? juce::Rectangle<int> (x, thumbStart, w, thumbSize) : juce::Rectangle<int> (thumbStart, y, thumbSize, h);
    g.setColour ((down ? Colours::gold : over ? Colours::line2 : Colours::panel3).withAlpha (0.9f));
    g.fillRoundedRectangle (thumb.reduced (2).toFloat(), 3.0f);
}

void MotionLookAndFeel::drawTabButton (juce::TabBarButton& b, juce::Graphics& g, bool over, bool)
{
    using namespace juce;
    auto r = b.getActiveArea();
    bool front = b.isFrontTab();
    g.setColour (front ? Colours::panel2 : (over ? Colours::panel : Colours::bg));
    g.fillRect (r);
    if (front)
    {
        g.setColour (Colours::gold);
        g.fillRect (r.removeFromBottom (2));
    }
    g.setColour (front ? Colours::gold : Colours::muted);
    g.setFont (Fonts::semi (13.5f));
    g.drawFittedText (b.getButtonText(), b.getTextArea(), Justification::centred, 1);
}

void MotionLookAndFeel::drawTreeviewPlusMinusBox (juce::Graphics& g, const juce::Rectangle<float>& area, juce::Colour, bool isOpen, bool)
{
    juce::Path p;
    auto c = area.getCentre();
    if (isOpen) p.addTriangle (c.x - 4, c.y - 2, c.x + 4, c.y - 2, c.x, c.y + 3);
    else        p.addTriangle (c.x - 2, c.y - 4, c.x - 2, c.y + 4, c.x + 3, c.y);
    g.setColour (Colours::gold);
    g.fillPath (p);
}

void MotionLookAndFeel::drawDocumentWindowTitleBar (juce::DocumentWindow& w, juce::Graphics& g, int width, int h, int, int,
                                                    const juce::Image*, bool)
{
    g.fillAll (Colours::panel);
    g.setColour (Colours::line);
    g.fillRect (0, h - 1, width, 1);
    g.setColour (Colours::gold);
    g.setFont (Fonts::semi (14.0f));
    g.drawText (w.getName(), 10, 0, width - 20, h, juce::Justification::centredLeft);
}

void MotionLookAndFeel::fillTextEditorBackground (juce::Graphics& g, int w, int h, juce::TextEditor& e)
{
    g.setColour (e.findColour (juce::TextEditor::backgroundColourId));
    g.fillRoundedRectangle (0, 0, (float) w, (float) h, 4.0f);
}

void MotionLookAndFeel::drawTextEditorOutline (juce::Graphics& g, int w, int h, juce::TextEditor& e)
{
    g.setColour (e.hasKeyboardFocus (true) ? Colours::gold : Colours::line);
    g.drawRoundedRectangle (0.5f, 0.5f, (float) w - 1.0f, (float) h - 1.0f, 4.0f, 1.0f);
}

void MotionLookAndFeel::drawProgressBar (juce::Graphics& g, juce::ProgressBar&, int w, int h, double progress, const juce::String& text)
{
    auto r = juce::Rectangle<float> (0, 0, (float) w, (float) h);
    g.setColour (Colours::bg2);
    g.fillRoundedRectangle (r, 4.0f);
    if (progress >= 0 && progress <= 1)
    {
        g.setColour (Colours::gold);
        g.fillRoundedRectangle (r.withWidth (r.getWidth() * (float) progress), 4.0f);
    }
    g.setColour (Colours::text);
    g.setFont (Fonts::semi (13.0f));
    g.drawText (text, r, juce::Justification::centred);
}

void MotionLookAndFeel::drawCallOutBoxBackground (juce::CallOutBox&, juce::Graphics& g, const juce::Path& path, juce::Image&)
{
    g.setColour (Colours::panel);
    g.fillPath (path);
    g.setColour (Colours::goldDeep);
    g.strokePath (path, juce::PathStrokeType (1.0f));
}

void MotionLookAndFeel::drawTooltip (juce::Graphics& g, const juce::String& text, int w, int h)
{
    g.fillAll (Colours::panel2);
    g.setColour (Colours::goldDeep);
    g.drawRect (0, 0, w, h);
    g.setColour (Colours::text);
    g.setFont (Fonts::ui (13.0f));
    g.drawFittedText (text, 6, 2, w - 12, h - 4, juce::Justification::centredLeft, 3);
}

void MotionLookAndFeel::drawStretchableLayoutResizerBar (juce::Graphics& g, int w, int h, bool, bool over, bool dragging)
{
    g.fillAll (dragging ? Colours::gold : over ? Colours::line2 : Colours::line);
    juce::ignoreUnused (w, h);
}

//==============================================================================
Knob::Knob (const juce::String& text, juce::Colour accent)
{
    slider.setSliderStyle (juce::Slider::RotaryHorizontalVerticalDrag);
    slider.setTextBoxStyle (juce::Slider::TextBoxBelow, false, 70, 16);
    slider.setRotaryParameters (juce::MathConstants<float>::pi * 1.25f, juce::MathConstants<float>::pi * 2.75f, true);
    slider.setColour (juce::Slider::rotarySliderFillColourId, accent);
    slider.setDoubleClickReturnValue (true, 0.0);
    addAndMakeVisible (slider);
    label.setText (text, juce::dontSendNotification);
    label.setJustificationType (juce::Justification::centred);
    label.setFont (Fonts::semi (12.5f));
    label.setColour (juce::Label::textColourId, Colours::text);
    label.setInterceptsMouseClicks (false, false);
    addAndMakeVisible (label);
}

void Knob::setAccent (juce::Colour c)  { slider.setColour (juce::Slider::rotarySliderFillColourId, c); repaint(); }

void Knob::resized()
{
    auto r = getLocalBounds();
    label.setBounds (r.removeFromTop (16));
    slider.setBounds (r);
}

void drawPanel (juce::Graphics& g, juce::Rectangle<float> r, const juce::String& title, juce::Colour edge)
{
    g.setColour (Colours::panel);
    g.fillRoundedRectangle (r, 6.0f);
    g.setColour (edge);
    g.drawRoundedRectangle (r.reduced (0.5f), 6.0f, 1.0f);
    if (title.isNotEmpty())
    {
        g.setColour (Colours::gold);
        g.setFont (Fonts::narrow (12.5f));
        g.drawText (title.toUpperCase(), r.reduced (10, 6).removeFromTop (16), juce::Justification::centredLeft);
    }
}

//==============================================================================
namespace Icons
{
    juce::Path play()      { juce::Path p; p.addTriangle (0, 0, 0, 10, 9, 5); return p; }
    juce::Path stop()      { juce::Path p; p.addRoundedRectangle (0, 0, 9, 9, 1.2f); return p; }
    juce::Path record()    { juce::Path p; p.addEllipse (0, 0, 10, 10); return p; }
    juce::Path toStart()   { juce::Path p; p.addRectangle (0, 0, 1.6f, 10); p.addTriangle (10, 0, 10, 10, 2, 5); return p; }
    juce::Path rewind()    { juce::Path p; p.addTriangle (6, 0, 6, 10, 0, 5); p.addTriangle (12, 0, 12, 10, 6, 5); return p; }
    juce::Path forward()   { juce::Path p; p.addTriangle (0, 0, 0, 10, 6, 5); p.addTriangle (6, 0, 6, 10, 12, 5); return p; }
    juce::Path plus()      { juce::Path p; p.addRectangle (4, 0, 2, 10); p.addRectangle (0, 4, 10, 2); return p; }
    juce::Path loop()
    {
        juce::Path p;
        p.startNewSubPath (2, 6); p.lineTo (2, 3); p.lineTo (10, 3);
        p.startNewSubPath (10, 6); p.lineTo (10, 9); p.lineTo (2, 9);
        juce::Path s; juce::PathStrokeType (1.6f).createStrokedPath (s, p);
        s.addTriangle (9, 0.5f, 9, 5.5f, 12.5f, 3);
        s.addTriangle (3, 6.5f, 3, 11.5f, -0.5f, 9);
        return s;
    }
    juce::Path metronome()
    {
        juce::Path p;
        p.addTriangle (2, 12, 10, 12, 6, 0);
        juce::Path arm; arm.startNewSubPath (6, 9); arm.lineTo (10.5f, 2);
        juce::Path s; juce::PathStrokeType (1.4f).createStrokedPath (s, arm);
        p.setUsingNonZeroWinding (false);
        p.addPath (s);
        return p;
    }
    juce::Path countIn()
    {
        juce::Path p;
        for (int i = 0; i < 4; ++i) p.addEllipse ((float) i * 3.2f, 4, 2.2f, 2.2f);
        p.addRectangle (0, 0, 11.8f, 1.2f);
        return p;
    }
    juce::Path punch()
    {
        juce::Path p;
        p.addRectangle (0, 0, 1.4f, 10); p.addRectangle (10, 0, 1.4f, 10);
        p.addEllipse (3.2f, 2.5f, 5, 5);
        return p;
    }
    juce::Path power()
    {
        juce::Path arc; arc.addCentredArc (5, 6, 4.5f, 4.5f, 0, 0.6f, juce::MathConstants<float>::twoPi - 0.6f, true);
        juce::Path s; juce::PathStrokeType (1.6f, juce::PathStrokeType::curved, juce::PathStrokeType::rounded).createStrokedPath (s, arc);
        s.addRoundedRectangle (4.2f, 0, 1.6f, 6, 0.8f);
        return s;
    }
    juce::Path wrench()
    {
        juce::Path p; p.addEllipse (0, 0, 6, 6); p.addRectangle (4, 4, 7, 2.2f);
        p.applyTransform (juce::AffineTransform::rotation (0.78f, 5, 5));
        return p;
    }
}

IconButton::IconButton (const juce::String& name, juce::Path i, juce::Colour c)
    : juce::Button (name), icon (std::move (i)), onColour (c)
{
    setTooltip (name);
}

void IconButton::paintButton (juce::Graphics& g, bool over, bool down)
{
    auto r = getLocalBounds().toFloat().reduced (1.0f);
    bool on = getToggleState();
    g.setColour (on ? onColour.withAlpha (0.18f) : (down ? Colours::panel3 : over ? Colours::panel2 : Colours::panel.brighter (0.02f)));
    g.fillRoundedRectangle (r, 5.0f);
    g.setColour (on ? onColour.withAlpha (0.8f) : Colours::line);
    g.drawRoundedRectangle (r, 5.0f, 1.0f);
    auto ir = r.reduced (r.getHeight() * 0.3f);
    g.setColour (on ? onColour : (isEnabled() ? (over ? Colours::text : Colours::muted) : Colours::dim));
    g.fillPath (icon, icon.getTransformToScaleToFit (ir, true));
}

} // namespace ms
