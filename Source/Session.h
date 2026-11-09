#pragma once
#include "Common.h"
#include "EngineSetup.h"

namespace ms
{

enum class TrackKind { audio, instrument, ret };

/** The open song: the Edit, what's selected, how the timeline is zoomed, and helpers the views share. */
class Session : private juce::ValueTree::Listener,
                private juce::AsyncUpdater,
                private juce::ChangeListener
{
public:
    Session (te::Engine&);
    ~Session() override;

    te::Engine& engine;
    std::unique_ptr<te::Edit> edit;
    te::SelectionManager selection { engine };
    juce::File file;

    //==============================================================================
    void newSong (double bpm = 90.0, int key = 0, bool worshipTemplate = true);
    bool open (const juce::File&);
    bool save();
    void saveAs (std::function<void (bool)> done = nullptr);
    bool isUntitled() const    { return untitled; }
    juce::String songName() const;
    bool hasChanged() const;

    //==============================================================================
    struct Listener
    {
        virtual ~Listener() = default;
        virtual void editChanged() {}            // a different song is open
        virtual void structureChanged() {}       // tracks, clips or plugins added / removed / moved
        virtual void propertiesChanged() {}      // names, colours, positions...
        virtual void selectionChanged() {}
    };
    void addListener (Listener* l)     { listeners.add (l); }
    void removeListener (Listener* l)  { listeners.remove (l); }

    //==============================================================================
    // Tracks
    TrackKind kindOf (te::Track&) const;
    te::AudioTrack::Ptr addTrack (TrackKind, const juce::String& name = {}, const juce::PluginDescription* instrument = nullptr,
                                  te::Track* after = nullptr);
    te::AudioTrack::Ptr addInstrumentTrack (const PluginChoice&, te::Track* after = nullptr);
    te::AudioTrack::Ptr addReturnTrack (const juce::String& name, const juce::String& motionFxId);
    void deleteTrack (te::Track&);
    void duplicateTrack (te::Track&);
    juce::Array<te::AudioTrack*> tracks() const;         // in order, every audio track (instrument, audio, return)
    juce::Array<te::AudioTrack*> returnTracks() const;
    int returnBusOf (te::AudioTrack&) const;            // -1 if not a return
    juce::String busName (int bus) const;
    te::AudioTrack* selectedTrack() const;
    void selectTrack (te::Track*);
    te::Plugin::Ptr insertPlugin (te::Track&, const PluginChoice&, int index = -1);
    te::Plugin::Ptr insertPlugin (te::Track&, const juce::PluginDescription&, int index = -1);
    juce::Array<te::Plugin*> insertsOf (te::Track&) const;   // the user's effects (not the instrument, volume or meter)
    te::AuxSendPlugin* sendFor (te::AudioTrack&, int bus, bool create);

    //==============================================================================
    // Inputs and recording
    void routeMidiTo (te::AudioTrack*);                   // the selected instrument track plays from every MIDI input
    void setAudioInput (te::AudioTrack&, te::InputDevice*);
    te::InputDevice* audioInputOf (te::AudioTrack&) const;
    bool isArmed (te::AudioTrack&) const;
    void setArmed (te::AudioTrack&, bool);
    te::VirtualMidiInputDevice* musicalTyping();          // computer keyboard / on-screen keys

    //==============================================================================
    // Clips
    te::Clip::Ptr addAudioFile (te::AudioTrack&, const juce::File&, te::TimePosition at);
    te::Clip::Ptr addMidiFile (te::AudioTrack&, const juce::File&, te::TimePosition at);
    te::MidiClip::Ptr addMidiClip (te::AudioTrack&, te::TimePosition at, te::BeatDuration length);
    juce::Array<te::Clip*> selectedClips() const;
    void deleteSelected();
    void splitSelectedAtPlayhead();
    void duplicateSelected();
    void quantiseSelected (double beats);

    //==============================================================================
    // Timeline view state shared by the arrange view, ruler and piano roll
    double pixelsPerBeat = 22.0;
    double viewStartBeats = 0.0;
    int trackHeight = 72;
    bool snap = true;
    double gridBeats = 1.0;                // 0.25 = 1/16, 1 = 1 beat, 4 = 1 bar
    bool followPlayhead = true;
    te::TimePosition snapTime (te::TimePosition t, bool force = false) const;
    te::BeatPosition snapBeat (te::BeatPosition b, bool force = false) const;
    double beatsPerBar() const;
    int songKey = 0;                       // 0..11 = C..B major, 12..23 = C..B minor
    int keyRoot() const      { return songKey % 12; }
    bool keyIsMinor() const  { return songKey >= 12; }
    void setSongKey (int);
    /** Sets every Motion Tune that follows the song to the song's key and scale. */
    void syncTuneKeys();

    //==============================================================================
    void undo();
    void redo();
    /** Motion Master on the master (the limiter + loudness meter), or null. */
    te::Plugin::Ptr masterLimiter() const;
    te::Plugin::Ptr addMasterLimiter();
    /** Points every clip and take at its audio by full path (before the song file moves). */
    void makeAudioPathsAbsolute();
    void notifyStructure()   { structureDirty = true; triggerAsyncUpdate(); }
    juce::String lastError;

private:
    void attach();
    void detach();
    void ensureDefaults();
    void valueTreePropertyChanged (juce::ValueTree&, const juce::Identifier&) override;
    void valueTreeChildAdded (juce::ValueTree&, juce::ValueTree&) override;
    void valueTreeChildRemoved (juce::ValueTree&, juce::ValueTree&, int) override;
    void valueTreeChildOrderChanged (juce::ValueTree&, int, int) override;
    void handleAsyncUpdate() override;
    void changeListenerCallback (juce::ChangeBroadcaster*) override;

    juce::ListenerList<Listener> listeners;
    bool structureDirty = false, propsDirty = false, untitled = true, keyDirty = false;
    juce::File tempFolder;
};

} // namespace ms
