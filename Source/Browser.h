#pragma once
#include "Session.h"
#include "Widgets.h"

namespace ms
{

/** The browser: Motion Audio instruments, pedals, boards and plugins, built-in effects, your AU / VST3 plugins and
    your sound files. Drag anything onto a track (or the mixer); double-click to add it to the selected track. */
class Browser : public juce::Component, private juce::Timer
{
public:
    Browser (Session&);
    ~Browser() override;
    void paint (juce::Graphics&) override;
    void resized() override;
    void rebuild();
    std::function<void()> onScanPlugins;

private:
    void timerCallback() override;
    Session& session;
    juce::TextEditor search;
    juce::TreeView tree;
    std::unique_ptr<juce::TreeViewItem> root;
    juce::TextButton scanBtn { "Find my plugins" };
    juce::String lastFilter;
    int knownCount = -1;
};

} // namespace ms
