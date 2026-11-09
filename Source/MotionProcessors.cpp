#include "MotionProcessors.h"
#include "Instruments.h"
#include "Theme.h"
#include "cmfx.h"

namespace ms
{

//==============================================================================
MotionProcessorBase::MotionProcessorBase (const MotionPluginInfo& i)
    : juce::AudioPluginInstance (i.isInstrument
                                    ? BusesProperties().withOutput ("Output", juce::AudioChannelSet::stereo(), true)
                                    : i.sidechain
                                        ? BusesProperties().withInput ("Input", juce::AudioChannelSet::stereo(), true)
                                                           .withOutput ("Output", juce::AudioChannelSet::stereo(), true)
                                                           .withInput ("Sidechain", juce::AudioChannelSet::stereo(), true)
                                        : BusesProperties().withInput ("Input", juce::AudioChannelSet::stereo(), true)
                                                           .withOutput ("Output", juce::AudioChannelSet::stereo(), true)),
      info (i)
{
}

bool MotionProcessorBase::isBusesLayoutSupported (const BusesLayout& l) const
{
    auto out = l.getMainOutputChannelSet();
    if (out != juce::AudioChannelSet::stereo() && out != juce::AudioChannelSet::mono()) return false;
    if (info.isInstrument) return true;
    auto in = l.getMainInputChannelSet();
    if (in != juce::AudioChannelSet::stereo() && in != juce::AudioChannelSet::mono()) return false;
    if (l.inputBuses.size() > 1)
    {
        auto sc = l.getChannelSet (true, 1);
        return sc.isDisabled() || sc == juce::AudioChannelSet::stereo() || sc == juce::AudioChannelSet::mono();
    }
    return true;
}

void MotionProcessorBase::getStateInformation (juce::MemoryBlock& mb)
{
    juce::ValueTree v ("MOTION");
    v.setProperty ("plugin", info.id, nullptr);
    for (auto* p : getParameters())
        if (auto* wid = dynamic_cast<juce::RangedAudioParameter*> (p))
            v.setProperty (juce::Identifier (wid->getParameterID()), wid->convertFrom0to1 (wid->getValue()), nullptr);
    saveExtra (v);
    if (auto xml = v.createXml())
        copyXmlToBinary (*xml, mb);
}

void MotionProcessorBase::setStateInformation (const void* data, int size)
{
    auto xml = getXmlFromBinary (data, size);
    if (xml == nullptr) return;
    auto v = juce::ValueTree::fromXml (*xml);
    loadExtra (v);
    for (auto* p : getParameters())
        if (auto* wid = dynamic_cast<juce::RangedAudioParameter*> (p))
            if (v.hasProperty (juce::Identifier (wid->getParameterID())))
                wid->setValueNotifyingHost (wid->convertTo0to1 ((float) v[juce::Identifier (wid->getParameterID())]));
}

juce::AudioParameterFloat* MotionProcessorBase::addFloat (const juce::String& id, const juce::String& name, float min, float max,
                                                          float def, const juce::String& unit, bool log, float step)
{
    juce::NormalisableRange<float> range (min, max, step);
    if (log && min > 0)
    {
        range = juce::NormalisableRange<float> (min, max,
            [] (float s, float e, float n) { return s * std::pow (e / s, n); },
            [] (float s, float e, float v) { return std::log (v / s) / std::log (e / s); },
            [step] (float s, float e, float v) { v = juce::jlimit (s, e, v); return step > 0 ? std::round (v / step) * step : v; });
    }
    auto attrs = juce::AudioParameterFloatAttributes().withLabel (unit)
        .withStringFromValueFunction ([unit] (float v, int)
        {
            if (unit == "Hz" && v >= 1000.0f) return juce::String (v / 1000.0f, 2) + " kHz";
            auto a = std::abs (v);
            int dec = a >= 100 ? 0 : a >= 10 ? 1 : 2;
            return juce::String (v, dec) + (unit.isNotEmpty() ? " " + unit : juce::String());
        });
    auto* p = new juce::AudioParameterFloat (juce::ParameterID { id, 1 }, name, range, def, attrs);
    AudioProcessor::addParameter (p);
    return p;
}

juce::AudioParameterBool* MotionProcessorBase::addBool (const juce::String& id, const juce::String& name, bool def)
{
    auto* p = new juce::AudioParameterBool (juce::ParameterID { id, 1 }, name, def);
    AudioProcessor::addParameter (p);
    return p;
}

juce::AudioParameterChoice* MotionProcessorBase::addChoice (const juce::String& id, const juce::String& name, const juce::StringArray& c, int def)
{
    auto* p = new juce::AudioParameterChoice (juce::ParameterID { id, 1 }, name, c, def);
    AudioProcessor::addParameter (p);
    return p;
}

//==============================================================================
MotionEditorBase::MotionEditorBase (MotionProcessorBase& p) : juce::AudioProcessorEditor (p), base (p)
{
    laf = std::make_unique<MotionLookAndFeel>();
    setLookAndFeel (laf.get());
}

MotionEditorBase::~MotionEditorBase()  { setLookAndFeel (nullptr); }

void MotionEditorBase::paint (juce::Graphics& g)
{
    g.fillAll (Colours::bg);
    auto head = getLocalBounds().removeFromTop (44);
    juce::ColourGradient grad (Colours::panel2, 0, 0, Colours::panel, 0, 44, false);
    g.setGradientFill (grad);
    g.fillRect (head);
    g.setColour (Colours::gold);
    g.fillRect (head.removeFromBottom (2).withTrimmedLeft (0));
    auto r = getLocalBounds().removeFromTop (42).reduced (14, 0);
    g.setFont (Fonts::heavy (18.0f));
    g.setColour (Colours::text);
    g.drawText (base.info.name, r, juce::Justification::centredLeft);
    g.setFont (Fonts::narrow (12.0f));
    g.setColour (Colours::gold);
    g.drawText ("MOTION AUDIO", r, juce::Justification::centredRight);
    if (subtitle.isNotEmpty())
    {
        g.setColour (Colours::muted);
        g.setFont (Fonts::ui (12.5f));
        auto w = (int) textWidth (Fonts::heavy (18.0f), base.info.name);
        g.drawText (subtitle, r.withTrimmedLeft (w + 14).withTrimmedRight (110), juce::Justification::centredLeft);
    }
}

//==============================================================================
ParamKnobPanel::ParamKnobPanel (juce::AudioProcessor& proc, juce::StringArray onlyIds, juce::Colour accent)
{
    for (auto* p : proc.getParameters())
    {
        auto* rp = dynamic_cast<juce::RangedAudioParameter*> (p);
        if (rp == nullptr) continue;
        if (! onlyIds.isEmpty() && ! onlyIds.contains (rp->getParameterID())) continue;

        if (auto* choice = dynamic_cast<juce::AudioParameterChoice*> (rp))
        {
            auto* c = combos.add (new juce::ComboBox());
            c->addItemList (choice->choices, 1);
            addAndMakeVisible (c);
            comboAttachments.add (new juce::ComboBoxParameterAttachment (*choice, *c));
            auto* l = comboLabels.add (new juce::Label ({}, choice->getName (40)));
            l->setFont (Fonts::semi (12.5f));
            l->setJustificationType (juce::Justification::centred);
            addAndMakeVisible (l);
            continue;
        }
        if (dynamic_cast<juce::AudioParameterBool*> (rp) != nullptr)
            continue;   // switches get their own toggle in each editor

        auto* k = knobs.add (new Knob (rp->getName (32), accent));
        addAndMakeVisible (k);
        attachments.add (new juce::SliderParameterAttachment (*rp, k->slider, nullptr));
        k->slider.setDoubleClickReturnValue (true, rp->convertFrom0to1 (rp->getDefaultValue()));
    }
}

int ParamKnobPanel::preferredWidth (int maxPerRow) const
{
    int n = knobs.size() + combos.size() * 2;
    return juce::jmax (1, juce::jmin (n, maxPerRow)) * 92;
}

int ParamKnobPanel::preferredHeight (int width) const
{
    int perRow = juce::jmax (1, width / 92);
    int n = knobs.size() + combos.size() * 2;
    int rows = (n + perRow - 1) / perRow;
    return juce::jmax (1, rows) * 104;
}

void ParamKnobPanel::resized()
{
    int perRow = juce::jmax (1, getWidth() / 92);
    int i = 0;
    auto place = [&] (juce::Rectangle<int>& cell) { cell = { (i % perRow) * 92, (i / perRow) * 104, 92, 104 }; ++i; };
    for (int c = 0; c < combos.size(); ++c)
    {
        if ((i % perRow) == perRow - 1) ++i;   // a choice takes two cells, on one row
        juce::Rectangle<int> cell; place (cell); ++i;
        cell.setWidth (184);
        comboLabels[c]->setBounds (cell.removeFromTop (18).reduced (2, 0));
        combos[c]->setBounds (cell.reduced (6, 24).withHeight (28));
    }
    for (auto* k : knobs)
    {
        juce::Rectangle<int> cell; place (cell);
        k->setBounds (cell.reduced (4, 2));
    }
}

//==============================================================================
// Stompbox
static juce::Colour textOn (juce::Colour c)   { return c.getPerceivedBrightness() > 0.62f ? juce::Colour (0xff111111) : juce::Colour (0xfff5efe2); }

int StompboxView::widthFor (const MpDef& d)   { return d.nctl <= 2 ? 150 : d.nctl <= 4 ? 176 : 236; }

StompboxView::StompboxView (const MpDef& d, Callbacks c) : def (d), cb (std::move (c))
{
    colour = pedalColour (d.id);
    for (int i = 0; i < d.nctl; ++i)
    {
        auto& ctl = d.ctl[i];
        auto* s = sliders.add (new juce::Slider());
        if (ctl.integer && ctl.max - ctl.min <= 1.0f)
        {
            s->setSliderStyle (juce::Slider::LinearHorizontal);
            s->setRange (ctl.min, ctl.max, 1.0);
        }
        else
        {
            s->setSliderStyle (juce::Slider::RotaryHorizontalVerticalDrag);
            s->setRotaryParameters (juce::MathConstants<float>::pi * 1.25f, juce::MathConstants<float>::pi * 2.75f, true);
            s->setRange (ctl.min, ctl.max, ctl.integer ? 1.0 : 0.0);
        }
        juce::String unit (ctl.unit);
        s->setTextValueSuffix (unit.isNotEmpty() ? " " + unit : juce::String());
        s->setNumDecimalPlacesToDisplay (ctl.max - ctl.min > 50 ? 0 : 2);
        s->setTextBoxStyle (juce::Slider::NoTextBox, false, 0, 0);
        s->setPopupDisplayEnabled (true, true, nullptr);
        s->setDoubleClickReturnValue (true, ctl.def);
        s->setColour (juce::Slider::rotarySliderFillColourId, Colours::goldHi);
        s->setValue (cb.get ? cb.get (i) : ctl.def, juce::dontSendNotification);
        s->onValueChange = [this, i, s] { if (cb.set) cb.set (i, (float) s->getValue()); };
        addAndMakeVisible (s);

        auto* l = labels.add (new juce::Label ({}, ctl.name));
        l->setFont (Fonts::narrow (11.5f));
        l->setJustificationType (juce::Justification::centred);
        l->setColour (juce::Label::textColourId, Colours::text);
        l->setInterceptsMouseClicks (false, false);
        addAndMakeVisible (l);
    }
    if (cb.onRemove)
    {
        removeButton = std::make_unique<juce::TextButton> ("x");
        removeButton->setTooltip ("Remove this pedal");
        removeButton->onClick = [this] { if (cb.onRemove) cb.onRemove(); };
        addAndMakeVisible (*removeButton);
    }
    setSize (widthFor (d), height);
}

void StompboxView::refresh()
{
    for (int i = 0; i < sliders.size(); ++i)
        if (cb.get) sliders[i]->setValue (cb.get (i), juce::dontSendNotification);
    repaint();
}

void StompboxView::paint (juce::Graphics& g)
{
    using namespace juce;
    auto r = getLocalBounds().toFloat().reduced (4.0f);
    // shadow
    g.setColour (Colour (0x90000000));
    g.fillRoundedRectangle (r.translated (0, 3), 12.0f);
    // enclosure
    ColourGradient grad (colour.brighter (0.18f), r.getX(), r.getY(), colour.darker (0.35f), r.getRight(), r.getBottom(), false);
    g.setGradientFill (grad);
    g.fillRoundedRectangle (r, 12.0f);
    g.setColour (juce::Colours::black.withAlpha (0.55f));
    g.drawRoundedRectangle (r, 12.0f, 1.5f);
    g.setColour (juce::Colours::white.withAlpha (0.10f));
    g.drawRoundedRectangle (r.reduced (1.5f), 11.0f, 1.0f);
    // screws
    for (auto p : { r.getTopLeft() + Point<float> (11, 11), r.getTopRight() + Point<float> (-11, 11),
                    r.getBottomLeft() + Point<float> (11, -11), r.getBottomRight() + Point<float> (-11, -11) })
    {
        g.setColour (Colour (0xff8a8a8a)); g.fillEllipse (Rectangle<float> (6, 6).withCentre (p));
        g.setColour (Colour (0xff3a3a3a)); g.drawLine (p.x - 2, p.y, p.x + 2, p.y, 1.0f);
    }
    // knob deck: a dark inset so the knobs read on any colour
    auto deck = r.reduced (12.0f).withHeight (r.getHeight() * 0.52f).withY (r.getY() + 18.0f);
    g.setColour (Colour (0xcc0b0b0d));
    g.fillRoundedRectangle (deck, 8.0f);
    // name plate
    auto tc = textOn (colour);
    auto name = r.withTop (deck.getBottom() + 8.0f).withHeight (36.0f).reduced (10.0f, 0);
    g.setColour (tc);
    g.setFont (Fonts::heavy (15.0f));
    g.drawFittedText (String (def.name).toUpperCase(), name.toNearestInt(), Justification::centred, 2, 0.8f);
    // LED
    bool on = cb.isOn ? cb.isOn() : true;
    auto led = Rectangle<float> (10, 10).withCentre ({ r.getCentreX(), name.getBottom() + 10.0f });
    if (on)
    {
        g.setColour (Colours::live.withAlpha (0.35f)); g.fillEllipse (led.expanded (5));
        g.setColour (Colour (0xffff5040)); g.fillEllipse (led);
    }
    else
    {
        g.setColour (Colour (0xff3a1210)); g.fillEllipse (led);
    }
    g.setColour (juce::Colours::black.withAlpha (0.5f)); g.drawEllipse (led, 1.0f);
    // footswitch
    auto fs = footswitch.toFloat();
    ColourGradient fg (Colour (0xffd8d8d8), fs.getX(), fs.getY(), Colour (0xff6a6a6a), fs.getRight(), fs.getBottom(), false);
    g.setGradientFill (fg);
    g.fillEllipse (fs);
    g.setColour (Colour (0xff2a2a2a));
    g.drawEllipse (fs, 2.0f);
    g.setColour (Colour (0xffb0b0b0));
    g.fillEllipse (fs.reduced (fs.getWidth() * 0.22f));
    // Motion Audio badge
    g.setColour (tc.withAlpha (0.6f));
    g.setFont (Fonts::narrow (9.5f));
    g.drawText ("MOTION AUDIO", r.withTop (r.getBottom() - 18.0f).toNearestInt(), Justification::centred);
}

void StompboxView::resized()
{
    auto r = getLocalBounds().reduced (16);
    auto deck = r.withHeight ((int) ((float) getHeight() * 0.52f) - 8).withY (r.getY() + 10);
    int n = sliders.size();
    int perRow = n <= 2 ? 2 : n <= 4 ? 2 : 3;
    if (n == 3) perRow = 3;
    int rows = juce::jmax (1, (n + perRow - 1) / perRow);
    int cw = deck.getWidth() / perRow, ch = deck.getHeight() / rows;
    for (int i = 0; i < n; ++i)
    {
        auto cell = juce::Rectangle<int> (deck.getX() + (i % perRow) * cw, deck.getY() + (i / perRow) * ch, cw, ch);
        labels[i]->setBounds (cell.removeFromBottom (14));
        auto* s = sliders[i];
        if (s->getSliderStyle() == juce::Slider::LinearHorizontal)
            s->setBounds (cell.withSizeKeepingCentre (juce::jmin (cell.getWidth() - 6, 44), 20));
        else
            s->setBounds (cell.withSizeKeepingCentre (juce::jmin (cell.getWidth(), cell.getHeight()), juce::jmin (cell.getWidth(), cell.getHeight())).reduced (2));
    }
    footswitch = juce::Rectangle<int> (46, 46).withCentre ({ getWidth() / 2, getHeight() - 50 });
    if (removeButton) removeButton->setBounds (getWidth() - 30, 8, 22, 18);
}

void StompboxView::mouseDown (const juce::MouseEvent& e)
{
    if (e.mods.isPopupMenu() && (cb.onMove || cb.onRemove))
    {
        juce::PopupMenu m;
        if (cb.onMove) { m.addItem ("Move left", [this] { cb.onMove (-1); }); m.addItem ("Move right", [this] { cb.onMove (1); }); }
        if (cb.onRemove) { m.addSeparator(); m.addItem ("Remove", [this] { cb.onRemove(); }); }
        m.showMenuAsync ({});
        return;
    }
    if (footswitch.expanded (6).contains (e.getPosition()) && cb.setOn && cb.isOn)
    {
        cb.setOn (! cb.isOn());
        repaint();
    }
}

//==============================================================================
// One Central Pedal
class PedalProcessor : public MotionProcessorBase
{
public:
    PedalProcessor (const MotionPluginInfo& i, const MpDef& d) : MotionProcessorBase (i), def (d)
    {
        on = addBool ("on", "On", true);
        for (int k = 0; k < d.nctl; ++k)
        {
            auto& c = d.ctl[k];
            bool log = juce::String (c.unit) == "Hz" || (juce::String (c.unit) == "ms" && c.min > 0 && c.max / c.min > 50);
            params.push_back (addFloat (c.sym, c.name, c.min, c.max, c.def, c.unit, log && c.min > 0, c.integer ? 1.0f : 0.0f));
            last[k] = std::numeric_limits<float>::quiet_NaN();
        }
        tailSeconds = juce::String (d.cat) == "reverb" ? 8.0 : juce::String (d.cat) == "delay" ? 4.0 : 0.0;
    }

    ~PedalProcessor() override { for (auto* x : fx) mp_free (x); }

    void prepareToPlay (double sr, int) override
    {
        if (sr != rate || fx[0] == nullptr)
        {
            juce::SpinLock::ScopedLockType sl (lock);
            for (auto*& x : fx) { mp_free (x); x = nullptr; }
            fx[0] = mp_new_side (&def, sr, 0);
            fx[1] = mp_new_side (&def, sr, 1);
            rate = sr;
            for (auto& l : last) l = std::numeric_limits<float>::quiet_NaN();
        }
        for (auto* x : fx) mp_reset (x);
    }

    void processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) override
    {
        juce::SpinLock::ScopedTryLockType sl (lock);
        if (! sl.isLocked() || fx[0] == nullptr || ! on->get()) return;
        for (int k = 0; k < (int) params.size(); ++k)
        {
            auto v = params[(size_t) k]->get();
            if (v != last[k]) { last[k] = v; mp_set (fx[0], k, v); mp_set (fx[1], k, v); }
        }
        auto n = buffer.getNumSamples();
        auto chans = juce::jmin (2, buffer.getNumChannels());
        for (int c = 0; c < chans; ++c)
            mp_run (fx[c], buffer.getWritePointer (c), buffer.getWritePointer (c), n);
    }

    juce::AudioProcessorEditor* createEditor() override;

    const MpDef& def;
    juce::AudioParameterBool* on = nullptr;
    std::vector<juce::AudioParameterFloat*> params;
    float last[MP_MAXCTL] {};
    MpFx* fx[2] { nullptr, nullptr };
    double rate = 0;
    juce::SpinLock lock;
};

class PedalEditor : public MotionEditorBase, private juce::Timer
{
public:
    PedalEditor (PedalProcessor& p) : MotionEditorBase (p), proc (p)
    {
        subtitle = pedalCategoryName (p.def.cat);
        StompboxView::Callbacks cb;
        cb.get = [this] (int k) { return proc.params[(size_t) k]->get(); };
        cb.set = [this] (int k, float v) { auto* prm = proc.params[(size_t) k]; prm->setValueNotifyingHost (prm->convertTo0to1 (v)); };
        cb.isOn = [this] { return proc.on->get(); };
        cb.setOn = [this] (bool b) { proc.on->setValueNotifyingHost (b ? 1.0f : 0.0f); };
        box = std::make_unique<StompboxView> (p.def, cb);
        addAndMakeVisible (*box);
        setSize (juce::jmax (320, box->getWidth() + 120), StompboxView::height + 44 + 30);
        startTimerHz (10);
    }
    void resized() override { box->setCentrePosition (getWidth() / 2, 44 + (getHeight() - 44) / 2); }
    void timerCallback() override { box->refresh(); }
    PedalProcessor& proc;
    std::unique_ptr<StompboxView> box;
};

juce::AudioProcessorEditor* PedalProcessor::createEditor()  { return new PedalEditor (*this); }

std::unique_ptr<juce::AudioPluginInstance> createPedalProcessor (const MotionPluginInfo& info, const juce::String& label)
{
    if (auto d = mp_find (label.toRawUTF8()))
        return std::make_unique<PedalProcessor> (info, *d);
    return {};
}

//==============================================================================
// Motion Pedalboard: a chain of Central Pedals
struct BoardSlot
{
    BoardSlot (const MpDef& d, double sr) : def (d)
    {
        fx[0] = mp_new_side (&d, sr, 0);
        fx[1] = mp_new_side (&d, sr, 1);
        for (int k = 0; k < MP_MAXCTL; ++k) values[(size_t) k] = k < d.nctl ? d.ctl[k].def : 0.0f;
        for (auto& l : last) l = std::numeric_limits<float>::quiet_NaN();
    }
    ~BoardSlot() { mp_free (fx[0]); mp_free (fx[1]); }

    const MpDef& def;
    MpFx* fx[2] {};
    std::array<std::atomic<float>, MP_MAXCTL> values {};
    float last[MP_MAXCTL] {};
    std::atomic<bool> on { true };
};

class PedalboardProcessor : public MotionProcessorBase, public juce::ChangeBroadcaster
{
public:
    PedalboardProcessor (const MotionPluginInfo& i, const juce::String& presetId) : MotionProcessorBase (i)
    {
        input = addFloat ("input", "Input", -24.0f, 24.0f, 0.0f, "dB");
        output = addFloat ("output", "Output", -24.0f, 12.0f, 0.0f, "dB");
        expression = addFloat ("expression", "Expression", 0.0f, 1.0f, 0.5f);
        expressionOn = addBool ("expressionOn", "Expression to wah / whammy / volume", false);
        tailSeconds = 8.0;
        rate = 48000.0;
        if (presetId.isNotEmpty())
            for (auto& b : boardPresets())
                if (b.id == presetId) loadPreset (b);
    }

    using Chain = std::vector<std::unique_ptr<BoardSlot>>;

    void prepareToPlay (double sr, int bs) override
    {
        juce::ignoreUnused (bs);
        if (sr != rate)
        {
            rate = sr;
            // rebuild every pedal at the new rate, keeping its settings
            Chain fresh;
            for (auto& s : chain)
            {
                auto n = std::make_unique<BoardSlot> (s->def, rate);
                for (int k = 0; k < MP_MAXCTL; ++k) n->values[(size_t) k] = s->values[(size_t) k].load();
                n->on = s->on.load();
                fresh.push_back (std::move (n));
            }
            swapChain (fresh);
        }
        juce::SpinLock::ScopedLockType sl (lock);
        for (auto& s : chain) { mp_reset (s->fx[0]); mp_reset (s->fx[1]); }
    }

    void processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) override
    {
        auto n = buffer.getNumSamples();
        auto chans = juce::jmin (2, buffer.getNumChannels());
        buffer.applyGain (juce::Decibels::decibelsToGain (input->get()));
        {
            juce::SpinLock::ScopedTryLockType sl (lock);
            if (sl.isLocked())
            {
                bool expr = expressionOn->get();
                float ev = expression->get();
                for (auto& s : chain)
                {
                    if (! s->on.load()) continue;
                    for (int k = 0; k < s->def.nctl; ++k)
                    {
                        float v = s->values[(size_t) k].load();
                        if (expr && isExpressionControl (s->def, k))
                            v = s->def.ctl[k].min + ev * (s->def.ctl[k].max - s->def.ctl[k].min);
                        if (v != s->last[k]) { s->last[k] = v; mp_set (s->fx[0], k, v); mp_set (s->fx[1], k, v); }
                    }
                    for (int c = 0; c < chans; ++c)
                        mp_run (s->fx[c], buffer.getWritePointer (c), buffer.getWritePointer (c), n);
                }
            }
        }
        buffer.applyGain (juce::Decibels::decibelsToGain (output->get()));
    }

    static bool isExpressionControl (const MpDef& d, int k)
    {
        juce::String id (d.id), sym (d.ctl[k].sym);
        return (id == "ma_wah" && sym == "position") || (id == "ma_whammy" && sym == "position") || (id == "ma_volume" && sym == "volume");
    }

    void swapChain (Chain& fresh)
    {
        {
            juce::SpinLock::ScopedLockType sl (lock);
            std::swap (chain, fresh);
        }
        fresh.clear();   // old pedals freed here, off the audio thread
        sendChangeMessage();
    }

    Chain copyChain() const
    {
        Chain c;
        for (auto& s : chain)
        {
            auto n = std::make_unique<BoardSlot> (s->def, rate);
            for (int k = 0; k < MP_MAXCTL; ++k) n->values[(size_t) k] = s->values[(size_t) k].load();
            n->on = s->on.load();
            c.push_back (std::move (n));
        }
        return c;
    }

    // Edits rebuild the chain and swap it in whole, so the audio thread never sees half a change.
    void addPedal (const juce::String& label, int index = -1)
    {
        auto d = mp_find (label.toRawUTF8());
        if (d == nullptr) return;
        auto c = copyChain();
        if (index < 0 || index > (int) c.size()) index = (int) c.size();
        c.insert (c.begin() + index, std::make_unique<BoardSlot> (*d, rate));
        swapChain (c);
        presetName = presetName.isEmpty() ? juce::String ("Custom") : presetName;
    }
    void removePedal (int index)
    {
        auto c = copyChain();
        if (juce::isPositiveAndBelow (index, (int) c.size())) c.erase (c.begin() + index);
        swapChain (c);
    }
    void movePedal (int index, int delta)
    {
        auto c = copyChain();
        int to = index + delta;
        if (juce::isPositiveAndBelow (index, (int) c.size()) && juce::isPositiveAndBelow (to, (int) c.size()))
            std::swap (c[(size_t) index], c[(size_t) to]);
        swapChain (c);
    }
    void loadPreset (const BoardPreset& b)
    {
        Chain c;
        for (auto& p : b.chain)
        {
            auto d = mp_find (p.label.toRawUTF8());
            if (d == nullptr) continue;
            auto s = std::make_unique<BoardSlot> (*d, rate);
            for (auto& [sym, v] : p.values)
            {
                int k = mp_ctl_index (d, sym.toRawUTF8());
                if (k >= 0) s->values[(size_t) k] = v;
            }
            c.push_back (std::move (s));
        }
        presetName = b.name;
        swapChain (c);
    }

    void saveExtra (juce::ValueTree& v) override
    {
        v.setProperty ("preset", presetName, nullptr);
        for (auto& s : chain)
        {
            juce::ValueTree t ("PEDAL");
            t.setProperty ("label", juce::String (s->def.id), nullptr);
            t.setProperty ("on", s->on.load(), nullptr);
            for (int k = 0; k < s->def.nctl; ++k)
                t.setProperty (juce::Identifier (s->def.ctl[k].sym), s->values[(size_t) k].load(), nullptr);
            v.appendChild (t, nullptr);
        }
    }

    void loadExtra (const juce::ValueTree& v) override
    {
        Chain c;
        for (auto t : v)
        {
            if (! t.hasType ("PEDAL")) continue;
            auto d = mp_find (t["label"].toString().toRawUTF8());
            if (d == nullptr) continue;
            auto s = std::make_unique<BoardSlot> (*d, rate);
            s->on = (bool) t.getProperty ("on", true);
            for (int k = 0; k < d->nctl; ++k)
                if (t.hasProperty (juce::Identifier (d->ctl[k].sym)))
                    s->values[(size_t) k] = (float) t[juce::Identifier (d->ctl[k].sym)];
            c.push_back (std::move (s));
        }
        presetName = v["preset"].toString();
        swapChain (c);
    }

    juce::AudioProcessorEditor* createEditor() override;

    juce::AudioParameterFloat *input = nullptr, *output = nullptr, *expression = nullptr;
    juce::AudioParameterBool* expressionOn = nullptr;
    Chain chain;
    double rate = 48000.0;
    juce::SpinLock lock;
    juce::String presetName;
};

class PedalboardEditor : public MotionEditorBase, private juce::ChangeListener
{
public:
    PedalboardEditor (PedalboardProcessor& p) : MotionEditorBase (p), proc (p)
    {
        presets.setTextWhenNothingSelected ("Choose a Motion Audio board...");
        int id = 1;
        juce::StringArray kinds { "electric", "acoustic", "bass", "keys" };
        for (auto& k : kinds)
        {
            presets.addSectionHeading (k == "electric" ? "Electric" : k == "acoustic" ? "Acoustic" : k == "bass" ? "Bass" : "Keys");
            for (size_t i = 0; i < boardPresets().size(); ++i)
                if (boardPresets()[i].kind == k)
                    presets.addItem (boardPresets()[i].name, (int) i + 1);
            ++id;
        }
        presets.onChange = [this]
        {
            auto i = presets.getSelectedId() - 1;
            if (juce::isPositiveAndBelow (i, (int) boardPresets().size()))
                proc.loadPreset (boardPresets()[(size_t) i]);
        };
        addAndMakeVisible (presets);

        addPedal.setButtonText ("+ Add pedal");
        addPedal.onClick = [this] { showAddMenu(); };
        addAndMakeVisible (addPedal);
        clear.setButtonText ("Clear");
        clear.onClick = [this] { PedalboardProcessor::Chain c; proc.presetName = {}; proc.swapChain (c); };
        addAndMakeVisible (clear);

        knobs = std::make_unique<ParamKnobPanel> (p, juce::StringArray { "input", "output", "expression" });
        addAndMakeVisible (*knobs);
        exprToggle.setButtonText ("Expression drives wah / whammy / volume");
        exprAttach = std::make_unique<juce::ButtonParameterAttachment> (*p.expressionOn, exprToggle);
        addAndMakeVisible (exprToggle);

        viewport.setViewedComponent (&row, false);
        viewport.setScrollBarsShown (false, true);
        addAndMakeVisible (viewport);
        proc.addChangeListener (this);
        rebuild();
        setResizable (true, false);
        setResizeLimits (720, 560, 2400, 900);
        setSize (1000, 580);
    }

    ~PedalboardEditor() override { proc.removeChangeListener (this); }

    void showAddMenu()
    {
        juce::PopupMenu m;
        std::map<juce::String, juce::PopupMenu> cats;
        juce::StringArray order { "boost", "dist", "fuzz", "comp", "eq", "wah", "mod", "trem", "pitch", "delay", "reverb", "amp", "acoustic", "util" };
        for (int i = 0; i < mp_count(); ++i)
        {
            auto d = mp_def (i);
            juce::String label (d->id);
            cats[d->cat].addItem (d->name, [this, label] { proc.addPedal (label); });
        }
        for (auto& c : order)
            if (cats.count (c)) m.addSubMenu (pedalCategoryName (c), cats[c]);
        m.showMenuAsync (juce::PopupMenu::Options().withTargetComponent (&addPedal));
    }

    void changeListenerCallback (juce::ChangeBroadcaster*) override { rebuild(); }

    void rebuild()
    {
        boxes.clear();
        int x = 10;
        for (size_t i = 0; i < proc.chain.size(); ++i)
        {
            auto* slot = proc.chain[i].get();
            StompboxView::Callbacks cb;
            cb.get = [slot] (int k) { return slot->values[(size_t) k].load(); };
            cb.set = [slot] (int k, float v) { slot->values[(size_t) k] = v; };
            cb.isOn = [slot] { return slot->on.load(); };
            cb.setOn = [slot] (bool b) { slot->on = b; };
            int idx = (int) i;
            cb.onRemove = [this, idx] { juce::MessageManager::callAsync ([sp = juce::Component::SafePointer<PedalboardEditor> (this), idx] { if (sp) sp->proc.removePedal (idx); }); };
            cb.onMove = [this, idx] (int d) { juce::MessageManager::callAsync ([sp = juce::Component::SafePointer<PedalboardEditor> (this), idx, d] { if (sp) sp->proc.movePedal (idx, d); }); };
            auto* b = boxes.add (new StompboxView (slot->def, cb));
            row.addAndMakeVisible (b);
            b->setTopLeftPosition (x, 6);
            x += b->getWidth() + 6;
        }
        row.setSize (juce::jmax (x + 10, viewport.getWidth()), StompboxView::height + 12);
        presets.setText (proc.presetName.isNotEmpty() ? proc.presetName : juce::String(), juce::dontSendNotification);
        repaint();
    }

    void paint (juce::Graphics& g) override
    {
        MotionEditorBase::paint (g);
        auto area = viewport.getBounds().toFloat().expanded (4);
        g.setColour (Colours::bg2);
        g.fillRoundedRectangle (area, 8.0f);
        // the board's wooden-black floor with a gold cable line
        g.setColour (Colours::goldDeep.withAlpha (0.4f));
        g.drawLine (area.getX() + 6, area.getCentreY(), area.getRight() - 6, area.getCentreY(), 2.0f);
        if (proc.chain.empty())
        {
            g.setColour (Colours::muted);
            g.setFont (Fonts::ui (15.0f));
            g.drawText ("Pick a Motion Audio board above, or add pedals one by one.", area, juce::Justification::centred);
        }
    }

    void resized() override
    {
        auto r = content();
        auto top = r.removeFromTop (30);
        presets.setBounds (top.removeFromLeft (320));
        top.removeFromLeft (8);
        addPedal.setBounds (top.removeFromLeft (120));
        top.removeFromLeft (6);
        clear.setBounds (top.removeFromLeft (70));
        r.removeFromTop (8);
        auto bottom = r.removeFromBottom (110);
        knobs->setBounds (bottom.removeFromLeft (3 * 92));
        exprToggle.setBounds (bottom.removeFromLeft (320).withSizeKeepingCentre (320, 26));
        viewport.setBounds (r.reduced (4));
        row.setSize (juce::jmax (row.getWidth(), viewport.getWidth()), StompboxView::height + 12);
    }

    PedalboardProcessor& proc;
    juce::ComboBox presets;
    juce::TextButton addPedal, clear;
    juce::ToggleButton exprToggle;
    std::unique_ptr<juce::ButtonParameterAttachment> exprAttach;
    std::unique_ptr<ParamKnobPanel> knobs;
    juce::Viewport viewport;
    juce::Component row;
    juce::OwnedArray<StompboxView> boxes;
};

juce::AudioProcessorEditor* PedalboardProcessor::createEditor()  { return new PedalboardEditor (*this); }

std::unique_ptr<juce::AudioPluginInstance> createPedalboardProcessor (const MotionPluginInfo& info, const juce::String& presetId)
{
    return std::make_unique<PedalboardProcessor> (info, presetId);
}

//==============================================================================
// Central FX: a plugin from the plugin builder collection
struct CmfxDeleter { void operator() (CmFx* p) const { std::free (p); } };

class CmfxProcessor : public MotionProcessorBase
{
public:
    CmfxProcessor (const MotionPluginInfo& i, const CmfxSource& s) : MotionProcessorBase (i), source (s)
    {
        // read the knobs once at 48 kHz; the real engine is built in prepareToPlay
        auto probe = load (48000.0);
        if (probe.fx != nullptr)
        {
            auto* fx = probe.fx.get();
            for (int k = 0; k < cmfx_param_count (fx); ++k)
            {
                auto p = addFloat (cmfx_param_id (fx, k), cmfx_param_name (fx, k), cmfx_param_min (fx, k), cmfx_param_max (fx, k),
                                   cmfx_param_default (fx, k), cmfx_param_unit (fx, k), cmfx_param_log (fx, k) != 0);
                params.push_back (p);
            }
        }
        auto fam = s.family.toLowerCase();
        tailSeconds = fam.contains ("reverb") ? 8.0 : fam.contains ("delay") || fam.contains ("echo") ? 4.0 : 0.5;
    }

    struct Engine
    {
        std::unique_ptr<CmFx, CmfxDeleter> fx;
        std::vector<float> pool;
        juce::String error;
    };

    Engine load (double sr) const
    {
        Engine e;
        e.fx.reset ((CmFx*) std::calloc (1, cmfx_struct_size()));
        char err[256] = { 0 };
        auto utf8 = source.json.toStdString();
        if (cmfx_load (e.fx.get(), utf8.c_str(), (int) utf8.size(), (float) sr, err, (int) sizeof (err)) != 0)
        {
            e.error = err;
            e.fx.reset();
            return e;
        }
        e.pool.assign ((size_t) cmfx_pool_floats (e.fx.get()) + 1, 0.0f);
        cmfx_attach (e.fx.get(), e.pool.data());
        return e;
    }

    void prepareToPlay (double sr, int bs) override
    {
        scratchL.assign ((size_t) juce::jmax (bs, 4096), 0.0f);
        scratchR.assign ((size_t) juce::jmax (bs, 4096), 0.0f);
        if (sr != rate || engine.fx == nullptr)
        {
            auto e = load (sr);
            {
                juce::SpinLock::ScopedLockType sl (lock);
                std::swap (engine, e);
                rate = sr;
            }
            for (auto& l : last) l = std::numeric_limits<float>::quiet_NaN();
        }
        else if (engine.fx)
        {
            juce::SpinLock::ScopedLockType sl (lock);
            cmfx_reset (engine.fx.get());
        }
    }

    void processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) override
    {
        juce::SpinLock::ScopedTryLockType sl (lock);
        if (! sl.isLocked() || engine.fx == nullptr) return;
        auto* fx = engine.fx.get();
        last.resize (params.size(), std::numeric_limits<float>::quiet_NaN());
        for (size_t k = 0; k < params.size(); ++k)
        {
            auto v = params[k]->get();
            if (v != last[k]) { last[k] = v; cmfx_set_param (fx, (int) k, v); }
        }
        int n = buffer.getNumSamples();
        if (n > (int) scratchL.size()) return;
        auto* L = buffer.getWritePointer (0);
        auto* R = buffer.getNumChannels() > 1 ? buffer.getWritePointer (1) : nullptr;
        std::copy (L, L + n, scratchL.begin());
        if (R) std::copy (R, R + n, scratchR.begin());
        cmfx_process (fx, scratchL.data(), R ? scratchR.data() : nullptr, L, R, n);
    }

    juce::AudioProcessorEditor* createEditor() override;

    const CmfxSource& source;
    std::vector<juce::AudioParameterFloat*> params;
    std::vector<float> last;
    std::vector<float> scratchL, scratchR;
    Engine engine;
    double rate = 0;
    juce::SpinLock lock;
};

class CmfxEditor : public MotionEditorBase
{
public:
    CmfxEditor (CmfxProcessor& p) : MotionEditorBase (p), proc (p), knobs (p)
    {
        subtitle = p.source.family.isNotEmpty() ? p.source.family.substring (0, 1).toUpperCase() + p.source.family.substring (1) : juce::String();
        desc.setText (p.source.description, juce::dontSendNotification);
        desc.setFont (Fonts::ui (13.5f));
        desc.setColour (juce::Label::textColourId, Colours::muted);
        addAndMakeVisible (desc);
        addAndMakeVisible (knobs);
        int w = juce::jmax (380, knobs.preferredWidth (6) + 24);
        setSize (w, 44 + 10 + 36 + knobs.preferredHeight (w - 24) + 20);
    }
    void resized() override
    {
        auto r = content();
        desc.setBounds (r.removeFromTop (34));
        knobs.setBounds (r);
    }
    CmfxProcessor& proc;
    ParamKnobPanel knobs;
    juce::Label desc;
};

juce::AudioProcessorEditor* CmfxProcessor::createEditor()  { return new CmfxEditor (*this); }

std::unique_ptr<juce::AudioPluginInstance> createCmfxProcessor (const MotionPluginInfo& info, const CmfxSource& s)
{
    return std::make_unique<CmfxProcessor> (info, s);
}

} // namespace ms
