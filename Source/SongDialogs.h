#pragma once
#include "SongTools.h"

namespace ms
{
/** Song > Change Key and Tempo: the whole song (MIDI, audio, sections, automation) to a new key and BPM. */
void showKeyTempoDialog (Session&, std::function<void (const juce::String&)> done = nullptr);

/** File > Export for Central Pedal / Central Tracks: the track pack, with the Central Tracks star check. */
void showExportPackDialog (Session&);
}
