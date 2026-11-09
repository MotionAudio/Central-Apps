#pragma once
#include "VocalTools.h"
#include "Widgets.h"
#include "Theme.h"

namespace ms
{

//==============================================================================
/** Auto Time: pick the instrument and it lines the clip up with the metronome. Shown in a call-out. */
class AutoTimePanel : public juce::Component
{
public:
    AutoTimePanel (Session&, juce::Array<te::Clip*> clips);
    void paint (juce::Graphics&) override;
    void resized() override;

    /** Opens the panel for the selected clips (or says what to select). */
    static void show (Session&, juce::Component& anchor, std::function<void (const juce::String&)> onDone = nullptr);
    std::function<void (const juce::String&)> onDone;

private:
    void instrumentChanged();
    void run();
    Session& session;
    juce::Array<te::Clip::Ptr> clips;
    bool anyAudio = false;
    juce::ComboBox instrument, grid;
    juce::Slider strength;
    juce::ToggleButton matchTempo { "Stretch to the song's tempo if it was played at another one" };
    juce::TextButton go { "Auto Time" };
    juce::Label info;
};

//==============================================================================
/** The Tune tab: "Tune" marks every note of a vocal and tunes it to the song's key. Drag a note up or down, or
    right-click it and "Make it" another note; everything else stays tuned to the key. */
class TuneView : public juce::Component, private juce::Timer
{
public:
    TuneView (Session&);
    ~TuneView() override;
    void setClip (te::WaveAudioClip*);
    te::WaveAudioClip* getClip() const     { return clip.get(); }
    void tuneNow();

    void paint (juce::Graphics&) override;
    void resized() override;
    void mouseDown (const juce::MouseEvent&) override;
    void mouseDrag (const juce::MouseEvent&) override;
    void mouseUp (const juce::MouseEvent&) override;
    void mouseMove (const juce::MouseEvent&) override;
    void mouseWheelMove (const juce::MouseEvent&, const juce::MouseWheelDetails&) override;

private:
    void timerCallback() override;
    void scheduleRender (int ms = 250);
    void startRender();
    void findPitchInBackground();
    void showNoteMenu (int index);
    void fitRange();
    void updateLabels();
    juce::Rectangle<int> grid() const;
    float timeToX (double sourceSeconds) const;
    double xToTime (float x) const;
    float noteToY (float midi) const;
    int yToNote (float y) const;
    int noteAt (juce::Point<int>) const;

    Session& session;
    te::WaveAudioClip::Ptr clip;
    tune::Data data;
    bool hasData = false, renderPending = false, rendering = false;
    juce::uint32 renderAt = 0;
    std::atomic<int> generation { 0 }, pitchGeneration { 0 };
    juce::ThreadPool pool { 1 };
    juce::TextButton tuneBtn { "Tune" }, originalBtn { "Original" };
    juce::Slider tight, glide;
    juce::Label tightLabel, glideLabel, keyLabel, status;
    int lowNote = 48, highNote = 72;
    double viewStart = 0, viewLength = 1;
    int selected = -1, hover = -1, dragging = -1;
    float lastPlayX = -1;
    static constexpr int toolbarH = 40, keysW = 46;
};

//==============================================================================
/** The Takes tab: every pass of a loop recording, cut into bars. Auto Comp scores each take in each bar (in tune,
    in time, not clipped or missing) and builds the best one; click any bar of any take to use it instead. */
class TakesView : public juce::Component, public juce::SettableTooltipClient
{
public:
    TakesView (Session&);
    ~TakesView() override;
    void setClip (te::WaveAudioClip*);
    te::WaveAudioClip* getClip() const     { return clip.get(); }
    void autoComp();

    void paint (juce::Graphics&) override;
    void resized() override;
    void mouseDown (const juce::MouseEvent&) override;
    void mouseMove (const juce::MouseEvent&) override;

private:
    void reload();
    void loadPeaks();
    void renderComp (const juce::String& message);
    juce::Rectangle<int> gridArea() const;
    juce::Rectangle<int> cell (int take, int section) const;
    std::pair<double, double> sectionSource (int section) const;

    Session& session;
    te::WaveAudioClip::Ptr clip;
    takes::Comp comp;
    std::vector<std::vector<float>> peaks;
    std::vector<double> lengths;
    juce::ThreadPool pool { 1 };
    std::atomic<int> generation { 0 };
    juce::TextButton autoBtn { "Auto Comp" }, addBtn { "Add take from file..." };
    juce::ComboBox sectionBox;
    juce::Label status;
    int hoverTake = -1, hoverSection = -1;
    static constexpr int toolbarH = 40, headerW = 120;
};

} // namespace ms
