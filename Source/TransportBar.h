#pragma once
#include "Session.h"
#include "Widgets.h"

namespace ms
{

/** A number you drag up / down or double-click to type (tempo, time signature...). */
class DragValue : public juce::Component, public juce::SettableTooltipClient
{
public:
    DragValue (const juce::String& suffix, double min, double max, double step);
    std::function<double()> getValue;
    std::function<void (double)> setValue;
    std::function<juce::String (double)> format;
    void paint (juce::Graphics&) override;
    void mouseDown (const juce::MouseEvent&) override;
    void mouseDrag (const juce::MouseEvent&) override;
    void mouseUp (const juce::MouseEvent&) override;
    void mouseDoubleClick (const juce::MouseEvent&) override;
    juce::String suffix;
    double min, max, step;
    float fontSize = 20.0f;
    juce::Colour colour = Colours::goldHi;
private:
    double startValue = 0;
    std::unique_ptr<juce::TextEditor> editor;
};

class TransportBar : public juce::Component, private juce::Timer, private Session::Listener
{
public:
    TransportBar (Session&);
    ~TransportBar() override;
    void paint (juce::Graphics&) override;
    void resized() override;

    std::function<void (int)> onShowView;      // 0 arrange, 1 session, 2 mixer
    std::function<void()> onToggleBrowser, onToggleEditor, onSettings;
    void setCurrentView (int);
    void setPanelStates (bool browser, bool editor);

private:
    void timerCallback() override;
    void editChanged() override;
    void updateButtons();
    Session& session;

    IconButton toStart { "Go to start (Return)", Icons::toStart() }, rewind { "Back a bar (,)", Icons::rewind() },
               forward { "Forward a bar (.)", Icons::forward() }, stop { "Stop (Space)", Icons::stop() },
               play { "Play (Space)", Icons::play(), Colours::ok }, record { "Record (R)", Icons::record(), Colours::live },
               loop { "Cycle (C)", Icons::loop() }, click { "Metronome (K)", Icons::metronome() },
               countIn { "Count-in (one bar before recording)", Icons::countIn() }, punch { "Punch in / out on the cycle range", Icons::punch(), Colours::live };
    DragValue bpm { "", 30.0, 300.0, 0.1 }, sigNum { "", 1, 16, 1 }, sigDen { "", 1, 16, 1 };
    juce::ComboBox keyBox, gridBox;
    juce::TextButton arrangeBtn { "Tracks" }, sessionBtn { "Live" }, mixerBtn { "Mixer" };
    juce::TextButton browserBtn { "Browser" }, editorBtn { "Editor" }, settingsBtn { "Settings" };
    LevelMeter master { false };
    juce::Rectangle<int> lcd, logo;
    juce::String posBars, posTime, cpuText;
    int currentView = 0;
    bool showTime = true;
};

} // namespace ms
