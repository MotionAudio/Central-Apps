#pragma once
#include "Session.h"
#include "Widgets.h"
#include "Automation.h"

namespace ms
{

class ArrangeView;

/** Converts between beats / time and x in the timeline. */
struct TimelineMap
{
    Session& s;
    int originX = 0;   // x of beat viewStart in the component's coordinates
    double beatToX (double beats) const     { return originX + (beats - s.viewStartBeats) * s.pixelsPerBeat; }
    double xToBeat (double x) const         { return (x - originX) / s.pixelsPerBeat + s.viewStartBeats; }
    double timeToX (te::TimePosition t) const { return beatToX (s.edit->tempoSequence.toBeats (t).inBeats()); }
    te::TimePosition xToTime (double x) const { return s.edit->tempoSequence.toTime (te::BeatPosition::fromBeats (juce::jmax (0.0, xToBeat (x)))); }
};

class Ruler : public juce::Component
{
public:
    Ruler (Session&);
    void paint (juce::Graphics&) override;
    void mouseDown (const juce::MouseEvent&) override;
    void mouseDrag (const juce::MouseEvent&) override;
    void mouseUp (const juce::MouseEvent&) override;
    void mouseDoubleClick (const juce::MouseEvent&) override;
    void mouseWheelMove (const juce::MouseEvent&, const juce::MouseWheelDetails&) override;
    std::function<void (const juce::MouseEvent&, const juce::MouseWheelDetails&)> onWheel;
    int originX = 0;
private:
    Session& session;
    enum class Drag { none, locate, newLoop, moveLoop, loopStart, loopEnd } drag = Drag::none;
    double dragStartBeat = 0, loopStartBeat = 0, loopEndBeat = 0;
};

class ClipComponent : public juce::Component
{
public:
    ClipComponent (Session&, ArrangeView&, te::Clip::Ptr);
    ~ClipComponent() override;
    void paint (juce::Graphics&) override;
    void mouseDown (const juce::MouseEvent&) override;
    void mouseDrag (const juce::MouseEvent&) override;
    void mouseUp (const juce::MouseEvent&) override;
    void mouseDoubleClick (const juce::MouseEvent&) override;
    void mouseMove (const juce::MouseEvent&) override;
    void updateThumbnail();
    void checkSource();      // the clip's audio was swapped (tuned, timed, comped): redraw its waveform
    te::Clip::Ptr clip;

private:
    void showMenu();
    Session& session;
    ArrangeView& view;
    std::unique_ptr<te::SmartThumbnail> thumbnail;
    juce::String thumbSource;
    enum class Drag { none, move, trimStart, trimEnd, fadeIn, fadeOut } drag = Drag::none;
    te::ClipPosition startPos;
    double startFadeIn = 0, startFadeOut = 0;
    int targetRow = -1;
    bool copying = false, dragged = false;
    Drag hitTestDrag (juce::Point<int>) const;
};

class TrackHeader : public juce::Component, public juce::DragAndDropTarget
{
public:
    TrackHeader (Session&, te::AudioTrack&);
    void paint (juce::Graphics&) override;
    void resized() override;
    void mouseDown (const juce::MouseEvent&) override;
    void mouseDoubleClick (const juce::MouseEvent&) override;
    void refresh();
    bool isInterestedInDragSource (const SourceDetails&) override;
    void itemDropped (const SourceDetails&) override;
    te::AudioTrack::Ptr track;

private:
    void showMenu();
    Session& session;
    EditableName name;
    SmallToggle mute { "M", Colours::mute, "Mute" }, solo { "S", Colours::solo, "Solo" },
                arm { "R", Colours::live, "Record enable" }, input { "I", Colours::gold, "Input: choose the audio input / monitoring" },
                autoBtn { "A", Colours::gold, "Automation: draw volume, pan or any plugin knob over time" };
    juce::Slider volume;
    juce::TextButton instrumentBtn, paramBtn;
};

class TrackLane : public juce::Component, public juce::DragAndDropTarget, public juce::FileDragAndDropTarget
{
public:
    TrackLane (Session&, ArrangeView&, te::AudioTrack&);
    void paint (juce::Graphics&) override;
    void resized() override;
    void mouseDown (const juce::MouseEvent&) override;
    void mouseDrag (const juce::MouseEvent&) override;
    void mouseUp (const juce::MouseEvent&) override;
    void mouseDoubleClick (const juce::MouseEvent&) override;
    void rebuildClips();
    void layoutClips();
    bool isInterestedInDragSource (const SourceDetails&) override;
    void itemDropped (const SourceDetails&) override;
    bool isInterestedInFileDrag (const juce::StringArray&) override;
    void filesDropped (const juce::StringArray&, int x, int y) override;
    te::AudioTrack::Ptr track;
    juce::OwnedArray<ClipComponent> clips;
    juce::Rectangle<int> rubber;
    AutomationLane autoLane;
    int clipAreaHeight() const;

private:
    Session& session;
    ArrangeView& view;
};

class ArrangeView : public juce::Component,
                    private Session::Listener,
                    private juce::Timer,
                    private juce::ScrollBar::Listener,
                    public juce::FileDragAndDropTarget
{
public:
    ArrangeView (Session&);
    ~ArrangeView() override;
    void resized() override;
    void paint (juce::Graphics&) override;
    void paintOverChildren (juce::Graphics&) override;
    void mouseWheelMove (const juce::MouseEvent&, const juce::MouseWheelDetails&) override;

    void rebuild();
    void layoutAll();
    void zoom (double factor, double aroundBeat);
    void zoomToFit();
    void scrollToPlayhead();
    TimelineMap map() const;                 // x in lane coordinates
    int rowAt (int yInContainer) const;
    int rowY (int row) const;
    int rowHeight (int row) const;
    TrackLane* laneAt (int row) const;
    static constexpr int autoLaneHeight = 70;
    juce::Component& tracksContainer()      { return container; }

    std::function<void (te::Clip*)> onOpenClip;
    std::function<void (te::Clip*, int)> onClipTool;   // 0 Auto Time, 1 Tune, 2 Takes
    std::function<void (te::Plugin*)> onOpenPlugin;
    static constexpr int headerWidth = 236;
    static constexpr int rulerHeight = 34;

    bool isInterestedInFileDrag (const juce::StringArray&) override;
    void filesDropped (const juce::StringArray&, int x, int y) override;

private:
    void editChanged() override         { rebuild(); }
    void structureChanged() override    { rebuild(); }
    void propertiesChanged() override;
    void selectionChanged() override    { repaintAll(); }
    void timerCallback() override;
    void scrollBarMoved (juce::ScrollBar*, double) override;
    void repaintAll();
    void showAddTrackMenu();

    Session& session;
    Ruler ruler;
    juce::Viewport viewport;
    juce::Component container;
    juce::ScrollBar hbar { false };
    juce::OwnedArray<TrackHeader> headers;
    juce::OwnedArray<TrackLane> lanes;
    juce::TextButton addTrackBtn { "+  New track" };
    float lastPlayheadX = -1.0f;
    bool updatingScroll = false;
    juce::String heightsSignature;
};

/** Every non-return track, in order (what the arrange and live views show). */
juce::Array<te::AudioTrack*> visibleTracks (Session&);

} // namespace ms
