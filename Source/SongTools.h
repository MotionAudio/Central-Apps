#pragma once
#include "Session.h"
#include "Loudness.h"

/* Whole-song tools:
 *   sections (Intro, Verse 1, Chorus...) - markers on the ruler, used by the guide track and the export
 *   change the song's key and tempo - MIDI is transposed, audio is pitch-shifted and stretched (drums aren't transposed)
 *   export for Central Pedal / Central Tracks - a track pack: stems by role, click, spoken guide cues, the sections
 *   as MIDI markers, a full mix, named "Title - Artist - 72bpm - G", with the Central Tracks star check */

namespace ms::song
{

//==============================================================================
struct Section { te::Clip::Ptr clip; double beat = 0; juce::String name; };
std::vector<Section> sections (Session&);
te::Clip::Ptr addSection (Session&, double beat, const juce::String& name);
void renameSection (te::Clip&, const juce::String& name);
void removeSection (Session&, te::Clip&);
void moveSection (Session&, te::Clip&, double beat);
juce::StringArray commonSectionNames();

//==============================================================================
/** Major and minor keys, 0..11 major, 12..23 minor. */
juce::String keyName (int key);
/** The shortest move between two keys (relative keys are 0: same notes). */
int semitonesBetween (int fromKey, int toKey);

struct Result { bool ok = false; juce::String message; juce::File output; };

/** Moves the whole song to a new key and tempo. Clips stay on their beats; audio is rendered again. */
Result changeKeyAndTempo (Session&, int newKey, double newBpm, bool moveAudio);
/** Stretches (durationFactor > 1 = longer) and pitch-shifts a file, keeping it lined up. */
bool stretchFile (te::Engine&, const juce::File& in, const juce::File& out, double durationFactor, float semitones,
                  std::function<bool (float)> progress = nullptr);

//==============================================================================
enum class Role { music, drums, bass, keys, guitar, vocals, none };
juce::StringArray roleNames();                 // in Role order (none = "Leave out")
Role guessRole (Session&, te::AudioTrack&);

struct ExportOptions
{
    juce::String title, artist;
    juce::File folder;                         // where the pack goes
    bool zip = true, click = true, guide = true, markers = true, fullMix = true;
    std::map<juce::String, Role> roles;        // track itemID -> role (missing: guessed)
};

struct GradeCheck
{
    int stars = 0;
    juce::StringArray lines;                   // "ok|text" or "no|text"
    LoudnessReport loudness;
};
/** The same checks the Motion Audio website grades a Central Tracks upload with (1-5 stars). */
GradeCheck gradeLikeCentralTracks (const juce::AudioBuffer<float>&, double sampleRate, int bitDepth);

struct ExportResult : Result { GradeCheck grade; juce::StringArray files; };
ExportResult exportPack (Session&, const ExportOptions&);

/** The click and the spoken guide for the song (also what the export writes). */
juce::AudioBuffer<float> makeClick (Session&, double sampleRate, double seconds);
juce::AudioBuffer<float> makeGuide (Session&, double sampleRate, double seconds);
/** The sections and tempo map as a MIDI file Central Pedal reads its sections from. */
juce::MemoryBlock makeMarkersMidi (Session&);

} // namespace ms::song
