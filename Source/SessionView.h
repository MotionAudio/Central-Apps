#pragma once
#include "Session.h"
#include "Widgets.h"

namespace ms
{

/** The Live view: a grid of clip slots (tracks across, scenes down) launched in time with the song, like Ableton's
    Session view. Built on Tracktion's clip launcher. */
class SessionView : public juce::Component,
                    public juce::DragAndDropTarget,
                    public juce::FileDragAndDropTarget,
                    private Session::Listener,
                    private juce::Timer
{
public:
    SessionView (Session&);
    ~SessionView() override;
    void paint (juce::Graphics&) override;
    void resized() override;
    void mouseDown (const juce::MouseEvent&) override;
    void mouseDoubleClick (const juce::MouseEvent&) override;
    void mouseWheelMove (const juce::MouseEvent&, const juce::MouseWheelDetails&) override;
    bool isInterestedInDragSource (const SourceDetails&) override;
    void itemDropped (const SourceDetails&) override;
    bool isInterestedInFileDrag (const juce::StringArray&) override  { return true; }
    void filesDropped (const juce::StringArray&, int x, int y) override;

    std::function<void (te::Clip*)> onOpenClip;
    void launchScene (int scene);
    void stopAll();

private:
    void editChanged() override        { ensureScenes(); repaint(); }
    void structureChanged() override   { ensureScenes(); repaint(); }
    void propertiesChanged() override  { repaint(); }
    void selectionChanged() override   { repaint(); }
    void timerCallback() override;
    void ensureScenes();
    void launch (te::AudioTrack&, int scene);
    void stopTrack (te::AudioTrack&);
    std::optional<te::MonotonicBeat> nextLaunchBeat();
    bool cellAt (juce::Point<int>, int& track, int& scene, bool& onPlayButton) const;
    te::ClipSlot* slotAt (int track, int scene) const;
    void dropFile (const juce::File&, int track, int scene);

    Session& session;
    juce::ComboBox quantise;
    juce::TextButton stopAllBtn { "Stop all clips" }, backToArrange { "Back to Tracks" }, addScene { "+ Scene" };
    int scrollX = 0, scrollY = 0;
    static constexpr int colW = 132, rowH = 30, headH = 34, sceneColW = 120, footH = 34;
    juce::Rectangle<int> grid;
    float pulse = 0;
};

} // namespace ms
