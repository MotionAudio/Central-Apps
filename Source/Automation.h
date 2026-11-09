#pragma once
#include "Session.h"

/* Automation: each track can show one lane under its clips, drawing any of its parameters (volume, pan, or a knob on
 * any of its plugins). Click to add a point, drag to move it, double-click to delete. "Write Automation" in the
 * Transport menu records knob and fader moves while the song plays. */

namespace ms
{

namespace automation
{
    bool isShown (te::AudioTrack&);
    void setShown (te::AudioTrack&, bool);
    juce::String currentId (te::AudioTrack&);
    void setCurrentId (te::AudioTrack&, const juce::String&);

    /** "<plugin id>/<param id>" -> the parameter (the track's volume when the id is empty or gone). */
    te::AutomatableParameter* paramFor (te::AudioTrack&, const juce::String& id);
    te::AutomatableParameter* currentParam (te::AudioTrack&);
    juce::String idFor (te::AutomatableParameter&);
    juce::String displayName (te::AudioTrack&, te::AutomatableParameter&);
    /** Tracks with any automation drawn, for the little "A" lights. */
    bool hasAutomation (te::AudioTrack&);

    void showParamMenu (Session&, te::AudioTrack&, juce::Component* target);
}

/** Adds "Sidechain from" (every other track) for a plugin with a sidechain input: Motion Sidechain Ducker, the
    built-in compressor, or an AU / VST3 with a sidechain. */
void addSidechainMenu (juce::PopupMenu&, te::Plugin::Ptr);
/** The track feeding a plugin's sidechain ("" when none). */
juce::String sidechainSource (te::Plugin&);

/** The lane itself (sits under the clips in a track's row). */
class AutomationLane : public juce::Component
{
public:
    AutomationLane (Session&, te::AudioTrack&);
    void paint (juce::Graphics&) override;
    void mouseDown (const juce::MouseEvent&) override;
    void mouseDrag (const juce::MouseEvent&) override;
    void mouseUp (const juce::MouseEvent&) override;
    void mouseDoubleClick (const juce::MouseEvent&) override;
    void mouseMove (const juce::MouseEvent&) override;
    std::function<double (double)> beatToX, xToBeat;   // set by the lane's owner

private:
    int pointAt (juce::Point<int>) const;
    float valueToY (te::AutomatableParameter&, float value) const;
    float yToValue (te::AutomatableParameter&, float y) const;
    float timeToX (te::TimePosition) const;
    te::TimePosition xToTime (float, bool snap) const;
    Session& session;
    te::AudioTrack::Ptr track;
    int dragging = -1, hover = -1;
    juce::String readout;
};

} // namespace ms
