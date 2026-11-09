#pragma once
#include "Session.h"
#include "TransportBar.h"
#include "ArrangeView.h"
#include "MixerView.h"
#include "SessionView.h"
#include "EditorPanel.h"
#include "Browser.h"

namespace ms
{

namespace Cmd
{
    enum
    {
        newSong = 0x2000, openSong, saveSong, saveSongAs, exportMix, exportStems, revealSong,
        undo, redo, deleteSel, splitClip, duplicateClip, selectAll,
        play, stop, record, cycle, metronome, toStart, countIn,
        zoomIn, zoomOut, zoomFit, showArrange, showLive, showMixer, toggleBrowser, toggleEditor, musicalTyping,
        newAudioTrack, newInstrumentTrack, settings, scanPlugins, getSounds, openUserFolder, about, followPlayhead,
        trackHeightUp, trackHeightDown, quantise, demoSong, autoTime, tuneVocal, autoComp, writeAutomation, exportPack, changeKeyTempo, addSection, loudnessMeter
    };
}

class MainComponent : public juce::Component,
                      public juce::DragAndDropContainer,
                      public juce::ApplicationCommandTarget,
                      public juce::MenuBarModel,
                      private Session::Listener,
                      private juce::Timer
{
public:
    MainComponent (Session&, juce::ApplicationCommandManager&);
    ~MainComponent() override;
    void paint (juce::Graphics&) override;
    void resized() override;
    bool keyPressed (const juce::KeyPress&) override;
    bool keyStateChanged (bool isKeyDown) override;
    void mouseDown (const juce::MouseEvent&) override;
    void mouseDrag (const juce::MouseEvent&) override;
    void mouseUp (const juce::MouseEvent&) override;
    void mouseMove (const juce::MouseEvent&) override;

    // commands
    juce::ApplicationCommandTarget* getNextCommandTarget() override { return nullptr; }
    void getAllCommands (juce::Array<juce::CommandID>&) override;
    void getCommandInfo (juce::CommandID, juce::ApplicationCommandInfo&) override;
    bool perform (const InvocationInfo&) override;

    // menus
    juce::StringArray getMenuBarNames() override;
    juce::PopupMenu getMenuForIndex (int, const juce::String&) override;
    void menuItemSelected (int, int) override {}

    void showView (int);
    void showSettings (int tab = 0);
    void exportAudio (bool stems);
    void askToSaveThen (std::function<void()>);
    juce::String windowTitle() const;
    std::function<void()> onTitleChanged;
    void openFile (const juce::File&);
    void makeDemoSong();
    EditorPanel& getEditor()    { return editor; }
    ArrangeView& getArrange()   { return arrange; }

private:
    void editChanged() override;
    void propertiesChanged() override;
    void timerCallback() override;
    void openClip (te::Clip*);
    void setTyping (bool);

    Session& session;
    juce::ApplicationCommandManager& commands;
    TransportBar transport;
    Browser browser;
    ArrangeView arrange;
    SessionView live;
    MixerView mixer;
    EditorPanel editor;
    juce::TooltipWindow tooltips { this, 600 };
    int view = 0;
    bool browserVisible = true, editorVisible = true, typing = false;
    int browserWidth = 270, editorHeight = 300;
    enum class Split { none, browser, editor } split = Split::none;
    int splitStart = 0;
    std::set<int> typingDown;
    int typingOctave = 4, typingVelocity = 100;
    juce::Rectangle<int> centreArea;
    juce::String lastTitle;
};

} // namespace ms
