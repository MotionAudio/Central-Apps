#pragma once
#include "Session.h"
#include "VocalDSP.h"

/* The clip tools behind Auto Time, Tune and Auto Comp. They work on the clip's audio offline, write a new file next to
 * the song and point the clip at it; the first original is remembered on the clip so it can always go back. */

namespace ms
{

/** Runs work on a background thread behind a progress window (straight away when there's no window, or off the
    message thread). The work gets a progress callback that returns false when cancelled. */
bool runWithProgress (const juce::String& title, std::function<bool (std::function<bool (float)>)> work);

//==============================================================================
namespace clipaudio
{
    juce::File sourceFile (te::WaveAudioClip&);                         // what the clip plays now
    juce::File originalFile (te::WaveAudioClip&);                       // what it was before any Motion processing
    bool hasProcessing (te::WaveAudioClip&);
    juce::File newFile (Session&, te::WaveAudioClip&, const juce::String& what);   // a fresh .wav in the song's Audio folder
    void setSource (te::WaveAudioClip&, const juce::File&);             // point the clip at another file (keeps the original)
    void restoreOriginal (te::WaveAudioClip&);
}

//==============================================================================
namespace autotime
{
    enum class Instrument { drums, bass, keys, guitar, vocals, strings, other };
    juce::StringArray instrumentNames();
    Instrument guessInstrument (te::Track*);

    struct Options
    {
        Instrument instrument = Instrument::other;
        double gridBeats = 0;       // 0 = work it out from the playing
        float strength = -1.0f;     // 0..1, < 0 = the instrument's default
        bool matchTempo = true;     // audio played at another tempo is stretched to the song first
    };

    struct Result
    {
        bool ok = false;
        juce::String message;
        int moved = 0, total = 0;
        double grid = 0, detectedBpm = 0;
    };

    /** Lines a MIDI or audio clip up with the song's grid. Audio is rendered on the calling thread (use a background
        thread for long clips); the clip is changed on the message thread. */
    Result apply (Session&, te::Clip&, const Options&, std::function<bool (float)> progress = nullptr);

    juce::String gridName (double beats);
}

//==============================================================================
namespace tune
{
    struct Data
    {
        juce::File source;                       // the audio the notes were found in (before tuning)
        int key = 0;
        vocal::Scale scale = vocal::Scale::major;
        float tightness = 0.6f, glideMs = 60.0f;
        std::vector<vocal::TuneNote> notes;
        vocal::PitchTrack pitch;                 // not saved: found again when needed
    };

    bool load (te::WaveAudioClip&, Data&);       // false if the clip hasn't been tuned
    void save (te::WaveAudioClip&, const Data&);
    void clear (te::WaveAudioClip&);

    /** Finds every note in the clip's audio (in the song's key) - "hit Tune". */
    bool analyse (Session&, te::WaveAudioClip&, Data&, std::function<bool (float)> progress = nullptr);
    /** Renders the tuned audio to a new file. */
    juce::File render (Session&, te::WaveAudioClip&, const Data&, std::function<bool (float)> progress = nullptr);

    // the same work, safe to run on a background thread (only reads and writes files)
    bool findPitch (te::Engine&, Data&, std::function<bool (float)> progress = nullptr);
    bool renderToFile (te::Engine&, const Data&, const juce::File& out, std::function<bool (float)> progress = nullptr);
}

/** The loudest sample in each of `points` stretches of a file (for drawing). */
std::vector<float> filePeaks (te::Engine&, const juce::File&, int points, double& lengthSeconds);

//==============================================================================
namespace takes
{
    /** The takes of a clip (loop recording keeps every pass), without repeats. */
    juce::Array<juce::File> list (te::WaveAudioClip&);
    void addTake (te::WaveAudioClip&, const juce::File&);

    struct Comp
    {
        double sectionBeats = 4.0;
        std::vector<int> choice;                // the take used for each section
        std::vector<std::vector<vocal::SectionScore>> scores;   // [take][section]
        juce::Array<juce::File> files;
        double clipStartBeat = 0, sourceStartSeconds = 0;
        double sectionStartBeat (int i) const   { return clipStartBeat + i * sectionBeats; }
    };

    /** Scores every take in every section and picks the best (with a nudge against hopping takes too often). */
    bool autoComp (Session&, te::WaveAudioClip&, Comp&, std::function<bool (float)> progress = nullptr);
    /** Sections and files for a clip, keeping any saved choices (no scoring). */
    bool prepare (Session&, te::WaveAudioClip&, Comp&, double sectionBeats);
    /** Writes the comp (crossfaded at quiet moments near the section lines) and points the clip at it. */
    juce::File render (Session&, te::WaveAudioClip&, const Comp&);
    bool loadChoices (te::WaveAudioClip&, Comp&);
    void saveChoices (te::WaveAudioClip&, const Comp&);
}

} // namespace ms
