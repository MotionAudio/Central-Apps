#pragma once
#include "Session.h"
#include "Widgets.h"

namespace ms
{

/** Piano roll for a MIDI clip: draw, move, resize and delete notes, velocity lane, quantize. */
class PianoRoll : public juce::Component, private juce::Timer, public juce::KeyListener
{
public:
    PianoRoll (Session&);
    ~PianoRoll() override;
    void setClip (te::MidiClip*);
    te::MidiClip* getClip() const { return clip.get(); }
    void paint (juce::Graphics&) override;
    void resized() override;
    void mouseDown (const juce::MouseEvent&) override;
    void mouseDrag (const juce::MouseEvent&) override;
    void mouseUp (const juce::MouseEvent&) override;
    void mouseMove (const juce::MouseEvent&) override;
    void mouseDoubleClick (const juce::MouseEvent&) override;
    void mouseWheelMove (const juce::MouseEvent&, const juce::MouseWheelDetails&) override;
    bool keyPressed (const juce::KeyPress&, juce::Component*) override;
    bool keyPressed (const juce::KeyPress& k) override { return keyPressed (k, this); }
    void deleteSelected();
    void quantise();
    void selectAll();
    void transposeSelected (int);

private:
    void timerCallback() override;
    juce::Rectangle<int> noteArea() const;
    juce::Rectangle<int> velocityArea() const;
    float beatToX (double b) const;
    double xToBeat (float x) const;
    int yToNote (float y) const;
    float noteToY (int n) const;
    double gridBeats() const;
    te::MidiNote* noteAt (juce::Point<int>, bool& onRightEdge) const;
    void audition (int note, int vel);
    bool isDrums() const;
    juce::String rowName (int note) const;
    double clipLengthBeats() const;

    Session& session;
    te::MidiClip::Ptr clip;
    double ppb = 60.0, scrollBeats = 0;
    float rowH = 13.0f;
    int topNote = 84;
    static constexpr int keysW = 64, velH = 64, rulerH = 20;
    juce::Array<te::MidiNote*> selected;
    enum class Drag { none, create, move, resize, velocity, select } drag = Drag::none;
    struct Orig { te::MidiNote* n; double start, len; int pitch, vel; };
    std::vector<Orig> orig;
    te::MidiNote* createdNote = nullptr;
    juce::Rectangle<int> band;
    int lastAuditioned = -1;
    float lastPlayX = -1;
    int lastVelocity = 100;
};

/** The selected track's device chain (instrument + effects), each with its main knobs, like Ableton's device view. */
class DeviceChain : public juce::Component
{
public:
    DeviceChain (Session&);
    void setTrack (te::AudioTrack*);
    void refresh();
    void paint (juce::Graphics&) override;
    void resized() override;
    te::AudioTrack* getTrack() const { return track.get(); }
private:
    struct Card;
    Session& session;
    te::AudioTrack::Ptr track;
    juce::Viewport viewport;
    juce::Component row;
    juce::OwnedArray<Card> cards;
    juce::TextButton addFx { "+ Add effect" };
    juce::String signature;
};

/** Settings for an audio clip: gain, pitch, tempo-follow, reverse, fades. */
class AudioClipInspector : public juce::Component
{
public:
    AudioClipInspector (Session&);
    void setClip (te::WaveAudioClip*);
    void paint (juce::Graphics&) override;
    void resized() override;
    void refresh();
private:
    Session& session;
    te::WaveAudioClip::Ptr clip;
    Knob gain { "Gain" }, pitch { "Pitch" }, fadeIn { "Fade in" }, fadeOut { "Fade out" };
    juce::ToggleButton warp { "Follow song tempo (warp)" }, reverse { "Reverse" }, loop { "Loop" };
    juce::Label info;
};

/** The panel under the timeline: piano roll / audio clip, the track's devices, and a playable keyboard. */
class EditorPanel : public juce::Component, private Session::Listener
{
public:
    EditorPanel (Session&);
    ~EditorPanel() override;
    void paint (juce::Graphics&) override;
    void resized() override;
    void showClip (te::Clip*);
    void showDevices();
    PianoRoll pianoRoll;

private:
    void selectionChanged() override;
    void structureChanged() override;
    void editChanged() override;
    void setPage (int);
    Session& session;
    juce::TextButton clipTab { "Clip" }, devicesTab { "Devices" }, keysTab { "Keyboard" };
    juce::TextButton quantiseBtn { "Quantize" };
    juce::Label title;
    DeviceChain devices;
    AudioClipInspector audioInspector;
    juce::MidiKeyboardState keyState;
    juce::MidiKeyboardComponent keyboard { keyState, juce::KeyboardComponentBase::horizontalKeyboard };
    struct KeyForwarder;
    std::unique_ptr<KeyForwarder> forwarder;
    int page = 0;
};

} // namespace ms
