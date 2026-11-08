#pragma once

#include <JuceHeader.h>

namespace te = tracktion;
using namespace std::literals;

namespace ms
{

//==============================================================================
// Motion Audio look: graphite black with brass / gold.
namespace Colours
{
    inline const juce::Colour bg        { 0xff0a0a0c };
    inline const juce::Colour bg2       { 0xff060607 };   // wells: meters, waveforms, fields
    inline const juce::Colour panel     { 0xff131316 };
    inline const juce::Colour panel2    { 0xff1b1b1f };
    inline const juce::Colour panel3    { 0xff25252a };
    inline const juce::Colour line      { 0xff2c2c32 };
    inline const juce::Colour line2     { 0xff3c3c44 };
    inline const juce::Colour text      { 0xffede6d6 };
    inline const juce::Colour muted     { 0xff9a9488 };
    inline const juce::Colour dim       { 0xff6a655c };
    inline const juce::Colour gold      { 0xffd9b45a };
    inline const juce::Colour goldHi    { 0xfff0d9a4 };
    inline const juce::Colour goldDeep  { 0xff9c7a2e };
    inline const juce::Colour goldText  { 0xff1a1408 };
    inline const juce::Colour live      { 0xffe0453a };
    inline const juce::Colour ok        { 0xff6fcf97 };
    inline const juce::Colour warn      { 0xfff0b429 };
    inline const juce::Colour solo      { 0xfff0c84a };
    inline const juce::Colour mute      { 0xff5b8dd9 };
    inline const juce::Colour info      { 0xff8db5de };

    // track colours: warm golds first, then a palette that still sits well on black
    inline juce::Colour track (int i)
    {
        static const juce::uint32 c[] = { 0xffd9b45a, 0xffc9783b, 0xffb8505a, 0xff9b5fb5, 0xff5f7fd0,
                                          0xff4aa6b5, 0xff5fae6a, 0xffa8b04a, 0xffe2a24a, 0xff8a8a96 };
        return juce::Colour (c[(size_t) ((i % 10) + 10) % 10]);
    }
}

//==============================================================================
struct Fonts
{
    static juce::Typeface::Ptr regular();
    static juce::Typeface::Ptr semibold();
    static juce::Typeface::Ptr bold();
    static juce::Typeface::Ptr condensed();

    static juce::Font ui (float h = 14.0f)        { return juce::Font (juce::FontOptions (regular()).withHeight (h)); }
    static juce::Font semi (float h = 14.0f)      { return juce::Font (juce::FontOptions (semibold()).withHeight (h)); }
    static juce::Font heavy (float h = 14.0f)     { return juce::Font (juce::FontOptions (bold()).withHeight (h)); }
    static juce::Font narrow (float h = 13.0f)    { return juce::Font (juce::FontOptions (condensed()).withHeight (h)); }
    static juce::Font mono (float h = 13.0f)      { return juce::Font (juce::FontOptions (juce::Font::getDefaultMonospacedFontName(), h, juce::Font::plain)); }
};

//==============================================================================
inline juce::String dbString (float db)
{
    if (db <= -100.0f) return "-inf";
    return (db > 0 ? "+" : "") + juce::String (db, 1);
}

inline float textWidth (const juce::Font& f, const juce::String& s)  { return juce::GlyphArrangement::getStringWidth (f, s); }

inline float gainToDb (float g)  { return juce::Decibels::gainToDecibels (g, -100.0f); }

/** Bars|beats|ticks from a beat position (assumes the time signature at that point). */
inline juce::String barsBeats (te::Edit& edit, te::TimePosition t)
{
    auto bb = edit.tempoSequence.toBarsAndBeats (t);
    auto beat = bb.getWholeBeats() + 1;
    auto ticks = (int) (bb.getFractionalBeats().inBeats() * 960.0);
    return juce::String (bb.bars + 1).paddedLeft (' ', 3) + " . " + juce::String (beat) + " . " + juce::String (ticks).paddedLeft ('0', 3);
}

inline juce::String timecode (double seconds)
{
    auto ms = juce::roundToInt (seconds * 1000.0);
    ms = juce::jmax (0, ms);
    return juce::String::formatted ("%02d:%02d.%03d", ms / 60000, (ms / 1000) % 60, ms % 1000);
}

/** The audio tracks of the edit in order (folders aside). */
inline juce::Array<te::AudioTrack*> audioTracks (te::Edit& e)    { return te::getAudioTracks (e); }

/** True when a track holds an instrument (so it's a MIDI / software instrument track). */
bool trackHasInstrument (te::AudioTrack&);
te::Plugin* trackInstrument (te::AudioTrack&);

class Session;

} // namespace ms
