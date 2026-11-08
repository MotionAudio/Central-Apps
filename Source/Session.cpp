#include "Session.h"
#include "MotionPlugins.h"

namespace ms
{

static const juce::Identifier msKind ("msKind");     // stored on each track: "audio", "instrument", "return"
static const juce::Identifier msBus ("msBus");       // the aux bus a return track listens to
static const juce::Identifier msKey ("msKey");       // the song's key (on the edit)

Session::Session (te::Engine& e) : engine (e)
{
    selection.addChangeListener (this);
}

Session::~Session()
{
    selection.removeChangeListener (this);
    detach();
    if (edit) edit->getTransport().stop (false, true);
    edit.reset();
}

//==============================================================================
void Session::attach()
{
    if (edit == nullptr) return;
    edit->state.addListener (this);
    edit->getTransport().ensureContextAllocated();
    if (edit->state.hasProperty (msKey)) songKey = (int) edit->state[msKey];
    juce::MessageManager::callAsync ([this, e = edit.get()]
    {
        if (edit.get() != e) return;
        for (auto t : tracks()) if (kindOf (*t) == TrackKind::instrument) { selectTrack (t); break; }
    });
    listeners.call ([] (Listener& l) { l.editChanged(); });
}

void Session::detach()
{
    if (edit == nullptr) return;
    edit->state.removeListener (this);
    selection.deselectAll();
}

juce::String Session::songName() const
{
    return file.getFileNameWithoutExtension();
}

bool Session::hasChanged() const
{
    return edit != nullptr && edit->hasChangedSinceSaved();
}

void Session::newSong (double bpm, int key, bool worshipTemplate)
{
    detach();
    if (edit) { edit->getTransport().stop (false, true); edit.reset(); }

    // each song lives in its own folder, its recordings next to it
    auto base = projectsFolder();
    juce::File folder;
    for (int i = 1; ; ++i)
    {
        folder = base.getChildFile ("Untitled " + juce::String (i));
        if (! folder.exists()) break;
    }
    folder.createDirectory();
    file = folder.getChildFile (folder.getFileName() + ".motionstudio");
    untitled = true;

    edit = te::createEmptyEdit (engine, file);
    edit->playInStopEnabled = true;
    edit->tempoSequence.getTempos()[0]->setBpm (bpm);
    songKey = key;
    edit->state.setProperty (msKey, key, nullptr);
    edit->clickTrackEnabled = false;
    edit->setCountInMode (te::Edit::CountIn::oneBar);

    // remove TE's default empty tracks: we add our own
    for (auto t : te::getAudioTracks (*edit)) edit->deleteTrack (t);

    if (worshipTemplate)
    {
        addReturnTrack ("Reverb", "motion:fx:lush-hall");
        addReturnTrack ("Delay", "motion:fx:dotted-eighth");
        PluginChoice keys; keys.name = "Motion Keys"; keys.desc = describeMotionPlugin (*findMotionPlugin ("motion:keys")); keys.isInstrument = true;
        PluginChoice pads; pads.name = "Motion Pads"; pads.desc = describeMotionPlugin (*findMotionPlugin ("motion:pads")); pads.isInstrument = true;
        PluginChoice drums; drums.name = "Motion Drums"; drums.desc = describeMotionPlugin (*findMotionPlugin ("motion:drums")); drums.isInstrument = true;
        auto k = addInstrumentTrack (keys);
        addInstrumentTrack (pads);
        addInstrumentTrack (drums);
        addTrack (TrackKind::audio, "Guitar");
        addTrack (TrackKind::audio, "Vocal");
        if (k) selectTrack (k.get());
    }
    else
    {
        PluginChoice keys; keys.name = "Motion Keys"; keys.desc = describeMotionPlugin (*findMotionPlugin ("motion:keys")); keys.isInstrument = true;
        addInstrumentTrack (keys);
        addTrack (TrackKind::audio, "Audio 1");
    }

    edit->getUndoManager().clearUndoHistory();
    edit->resetChangedStatus();
    attach();
}

bool Session::open (const juce::File& f)
{
    if (! f.existsAsFile()) return false;
    auto loaded = te::loadEditFromFile (engine, f);
    if (loaded == nullptr) { lastError = "Couldn't open " + f.getFileName(); return false; }
    detach();
    if (edit) { edit->getTransport().stop (false, true); edit.reset(); }
    edit = std::move (loaded);
    edit->playInStopEnabled = true;
    file = f;
    untitled = false;
    ensureDefaults();
    edit->resetChangedStatus();
    attach();
    return true;
}

void Session::ensureDefaults()
{
    for (auto t : tracks())
        if (! t->state.hasProperty (msKind))
            t->state.setProperty (msKind, trackHasInstrument (*t) ? "instrument" : "audio", nullptr);
}

bool Session::save()
{
    if (edit == nullptr) return false;
    edit->state.setProperty (msKey, songKey, nullptr);
    bool ok = te::EditFileOperations (*edit).writeToFile (file, false);
    if (ok) edit->resetChangedStatus();
    return ok;
}

void Session::saveAs (std::function<void (bool)> done)
{
    auto fc = std::make_shared<juce::FileChooser> ("Save song as", projectsFolder().getChildFile (songName()), "*.motionstudio");
    fc->launchAsync (juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::warnAboutOverwriting,
                     [this, fc, done] (const juce::FileChooser& c)
    {
        auto f = c.getResult();
        if (f == juce::File()) { if (done) done (false); return; }
        f = f.withFileExtension ("motionstudio");
        // a new song folder for it (with its own Audio folder) unless it's already in one of its own name
        if (f.getParentDirectory().getFileName() != f.getFileNameWithoutExtension())
        {
            auto folder = f.getParentDirectory().getChildFile (f.getFileNameWithoutExtension());
            folder.createDirectory();
            f = folder.getChildFile (f.getFileName());
        }
        auto oldFolder = file.getParentDirectory();
        bool wasUntitled = untitled;
        file = f;
        edit->editFileRetriever = [f] { return f; };
        bool ok = save();
        untitled = ! ok && wasUntitled;
        // an untitled song that was never used leaves no empty folder behind
        if (ok && wasUntitled && oldFolder != f.getParentDirectory() && oldFolder.getChildFile ("Audio").findChildFiles (juce::File::findFiles, false).isEmpty())
            oldFolder.deleteRecursively();
        listeners.call ([] (Listener& l) { l.propertiesChanged(); });
        if (done) done (ok);
    });
}

//==============================================================================
TrackKind Session::kindOf (te::Track& t) const
{
    auto k = t.state[msKind].toString();
    if (k == "return") return TrackKind::ret;
    if (k == "instrument") return TrackKind::instrument;
    if (k == "audio") return TrackKind::audio;
    if (auto at = dynamic_cast<te::AudioTrack*> (&t)) return trackHasInstrument (*at) ? TrackKind::instrument : TrackKind::audio;
    return TrackKind::audio;
}

juce::Array<te::AudioTrack*> Session::tracks() const
{
    return edit ? te::getAudioTracks (*edit) : juce::Array<te::AudioTrack*>();
}

juce::Array<te::AudioTrack*> Session::returnTracks() const
{
    juce::Array<te::AudioTrack*> r;
    for (auto t : tracks()) if (kindOf (*t) == TrackKind::ret) r.add (t);
    return r;
}

int Session::returnBusOf (te::AudioTrack& t) const
{
    if (kindOf (t) != TrackKind::ret) return -1;
    return (int) t.state.getProperty (msBus, -1);
}

juce::String Session::busName (int bus) const
{
    for (auto t : returnTracks()) if (returnBusOf (*t) == bus) return t->getName();
    return edit ? edit->getAuxBusName (bus) : juce::String();
}

te::AudioTrack::Ptr Session::addTrack (TrackKind kind, const juce::String& name, const juce::PluginDescription* instrument, te::Track* after)
{
    if (edit == nullptr) return {};
    // new tracks go after the given one, else before the returns (returns stay at the bottom, like Logic's aux strips)
    te::Track* preceding = after;
    if (preceding == nullptr && kind != TrackKind::ret)
    {
        for (auto t : tracks()) if (kindOf (*t) != TrackKind::ret) preceding = t;
        if (preceding == nullptr) preceding = nullptr;
    }
    te::TrackInsertPoint ip = preceding != nullptr ? te::TrackInsertPoint (nullptr, preceding) : te::TrackInsertPoint::getEndOfTracks (*edit);
    if (preceding == nullptr && kind != TrackKind::ret && ! returnTracks().isEmpty())
        ip = te::TrackInsertPoint (*returnTracks().getFirst(), true);

    auto t = edit->insertNewAudioTrack (ip, nullptr, true);
    if (t == nullptr) return {};
    t->state.setProperty (msKind, kind == TrackKind::ret ? "return" : kind == TrackKind::instrument ? "instrument" : "audio", nullptr);
    int n = tracks().size();
    t->setColour (kind == TrackKind::ret ? Colours::goldDeep : Colours::track (n - 1));
    auto nm = name;
    if (nm.isEmpty()) nm = kind == TrackKind::audio ? "Audio " + juce::String (n) : "Track " + juce::String (n);
    t->setName (nm);

    if (instrument != nullptr)
        if (auto p = createPluginFromDescription (*edit, *instrument))
            t->pluginList.insertPlugin (p, 0, nullptr);

    if (kind == TrackKind::audio)
    {
        // the first audio input, monitored when armed
        for (auto idi : edit->getAllInputDevices())
            if (idi->getInputDevice().getDeviceType() == te::InputDevice::waveDevice && idi->getTargets().isEmpty())
            {
                [[maybe_unused]] auto r = idi->setTarget (t->itemID, false, nullptr);
                break;
            }
    }
    notifyStructure();
    return t;
}

te::AudioTrack::Ptr Session::addInstrumentTrack (const PluginChoice& c, te::Track* after)
{
    if (edit == nullptr) return {};
    auto t = addTrack (TrackKind::instrument, c.name, nullptr, after);
    if (t == nullptr) return {};
    if (auto p = createPlugin (*edit, c))
        t->pluginList.insertPlugin (p, 0, nullptr);
    return t;
}

te::AudioTrack::Ptr Session::addReturnTrack (const juce::String& name, const juce::String& motionFxId)
{
    if (edit == nullptr) return {};
    int bus = 0;
    for (auto r : returnTracks()) bus = juce::jmax (bus, returnBusOf (*r) + 1);
    auto t = addTrack (TrackKind::ret, name);
    if (t == nullptr) return {};
    t->state.setProperty (msBus, bus, nullptr);
    edit->setAuxBusName (bus, name);
    juce::ValueTree v (te::IDs::PLUGIN);
    v.setProperty (te::IDs::type, te::AuxReturnPlugin::xmlTypeName, nullptr);
    v.setProperty (te::IDs::busNum, bus, nullptr);
    if (auto ret = edit->getPluginCache().createNewPlugin (v))
        t->pluginList.insertPlugin (ret, 0, nullptr);
    if (motionFxId.isNotEmpty())
        if (auto info = findMotionPlugin (motionFxId))
        {
            auto d = describeMotionPlugin (*info);
            if (auto fx = createPluginFromDescription (*edit, d))
                t->pluginList.insertPlugin (fx, 1, nullptr);
        }
    return t;
}

void Session::deleteTrack (te::Track& t)
{
    if (edit == nullptr) return;
    selection.deselectAll();
    edit->deleteTrack (&t);
    notifyStructure();
}

void Session::duplicateTrack (te::Track& t)
{
    if (edit == nullptr) return;
    if (auto copy = edit->copyTrack (&t, te::TrackInsertPoint (t, false)))
    {
        copy->setName (t.getName() + " copy");
        notifyStructure();
    }
}

te::AudioTrack* Session::selectedTrack() const
{
    if (auto t = selection.getFirstItemOfType<te::AudioTrack>()) return t;
    if (auto c = selection.getFirstItemOfType<te::Clip>())
        return dynamic_cast<te::AudioTrack*> (c->getTrack());
    return nullptr;
}

void Session::selectTrack (te::Track* t)
{
    if (t == nullptr) { selection.deselectAll(); return; }
    selection.selectOnly (t);
    if (auto at = dynamic_cast<te::AudioTrack*> (t))
        if (kindOf (*at) == TrackKind::instrument) routeMidiTo (at);
}

te::Plugin::Ptr Session::insertPlugin (te::Track& t, const PluginChoice& c, int index)
{
    if (edit == nullptr) return {};
    auto p = createPlugin (*edit, c);
    if (p == nullptr) return {};
    if (index < 0)
    {
        // effects go before the volume / meter (pre-fader), instruments first
        auto& list = t.pluginList;
        index = list.size();
        for (int i = 0; i < list.size(); ++i)
            if (dynamic_cast<te::VolumeAndPanPlugin*> (list[i]) || dynamic_cast<te::LevelMeterPlugin*> (list[i])) { index = i; break; }
        if (c.isInstrument) index = 0;
    }
    if (c.isInstrument)
        if (auto at = dynamic_cast<te::AudioTrack*> (&t))
            if (auto old = trackInstrument (*at)) old->deleteFromParent();
    t.pluginList.insertPlugin (p, index, nullptr);
    if (c.isInstrument)
        if (auto at = dynamic_cast<te::AudioTrack*> (&t))
        {
            at->state.setProperty (msKind, "instrument", nullptr);
            routeMidiTo (at);
        }
    notifyStructure();
    return p;
}

te::Plugin::Ptr Session::insertPlugin (te::Track& t, const juce::PluginDescription& d, int index)
{
    PluginChoice c; c.name = d.name; c.desc = d; c.isInstrument = d.isInstrument;
    return insertPlugin (t, c, index);
}

juce::Array<te::Plugin*> Session::insertsOf (te::Track& t) const
{
    juce::Array<te::Plugin*> r;
    for (auto p : t.pluginList)
    {
        if (dynamic_cast<te::VolumeAndPanPlugin*> (p) || dynamic_cast<te::LevelMeterPlugin*> (p)
            || dynamic_cast<te::AuxSendPlugin*> (p) || dynamic_cast<te::AuxReturnPlugin*> (p))
            continue;
        if (p->isSynth()) continue;
        r.add (p);
    }
    return r;
}

te::AuxSendPlugin* Session::sendFor (te::AudioTrack& t, int bus, bool create)
{
    for (auto p : t.pluginList)
        if (auto s = dynamic_cast<te::AuxSendPlugin*> (p))
            if (s->getBusNumber() == bus) return s;
    if (! create || edit == nullptr) return nullptr;
    juce::ValueTree v (te::IDs::PLUGIN);
    v.setProperty (te::IDs::type, te::AuxSendPlugin::xmlTypeName, nullptr);
    v.setProperty (te::IDs::busNum, bus, nullptr);
    auto p = edit->getPluginCache().createNewPlugin (v);
    if (p == nullptr) return nullptr;
    // after the fader (post-fader send)
    int index = t.pluginList.size();
    for (int i = 0; i < t.pluginList.size(); ++i)
        if (dynamic_cast<te::LevelMeterPlugin*> (t.pluginList[i])) { index = i; break; }
    t.pluginList.insertPlugin (p, index, nullptr);
    if (auto s = dynamic_cast<te::AuxSendPlugin*> (p.get()))
    {
        s->setGainDb (-100.0f);
        return s;
    }
    return nullptr;
}

//==============================================================================
void Session::routeMidiTo (te::AudioTrack* t)
{
    if (edit == nullptr || t == nullptr) return;
    musicalTyping();
    for (auto idi : edit->getAllInputDevices())
    {
        auto type = idi->getInputDevice().getDeviceType();
        if (type != te::InputDevice::physicalMidiDevice && type != te::InputDevice::virtualMidiDevice) continue;
        bool wasArmedElsewhere = false;
        for (auto id : idi->getTargets())
            if (id != t->itemID && idi->isRecordingEnabled (id)) wasArmedElsewhere = true;
        if (wasArmedElsewhere) continue;   // a track armed for recording keeps its input
        if (! idi->getTargets().contains (t->itemID))
        {
            [[maybe_unused]] auto r = idi->setTarget (t->itemID, true, nullptr);
        }
        idi->getInputDevice().setMonitorMode (te::InputDevice::MonitorMode::on);
    }
}

void Session::setAudioInput (te::AudioTrack& t, te::InputDevice* dev)
{
    if (edit == nullptr) return;
    for (auto idi : edit->getAllInputDevices())
    {
        if (idi->getInputDevice().getDeviceType() != te::InputDevice::waveDevice) continue;
        if (&idi->getInputDevice() == dev)
        {
            [[maybe_unused]] auto r = idi->setTarget (t.itemID, false, nullptr);
        }
        else if (idi->getTargets().contains (t.itemID))
        {
            [[maybe_unused]] auto r = idi->removeTarget (t.itemID, nullptr);
        }
    }
    notifyStructure();
}

te::InputDevice* Session::audioInputOf (te::AudioTrack& t) const
{
    if (edit == nullptr) return nullptr;
    for (auto idi : edit->getAllInputDevices())
        if (idi->getInputDevice().getDeviceType() == te::InputDevice::waveDevice && idi->getTargets().contains (t.itemID))
            return &idi->getInputDevice();
    return nullptr;
}

bool Session::isArmed (te::AudioTrack& t) const
{
    if (edit == nullptr) return false;
    for (auto idi : edit->getAllInputDevices())
        if (idi->getTargets().contains (t.itemID) && idi->isRecordingEnabled (t.itemID))
            return true;
    return false;
}

void Session::setArmed (te::AudioTrack& t, bool arm)
{
    if (edit == nullptr) return;
    if (kindOf (t) == TrackKind::instrument && arm) routeMidiTo (&t);
    bool any = false;
    for (auto idi : edit->getAllInputDevices())
    {
        if (! idi->getTargets().contains (t.itemID)) continue;
        bool isMidi = idi->getInputDevice().isMidi();
        if ((kindOf (t) == TrackKind::instrument) != isMidi) continue;
        idi->setRecordingEnabled (t.itemID, arm);
        any = true;
    }
    if (! any && arm)
        lastError = kindOf (t) == TrackKind::instrument ? "No MIDI input found. Plug in a keyboard, or use Musical Typing (Cmd K)."
                                                         : "This track has no audio input. Pick one with the input button on the track.";
    notifyStructure();
}

te::VirtualMidiInputDevice* Session::musicalTyping()
{
    auto& dm = engine.getDeviceManager();
    for (auto& d : dm.getMidiInDevices())
        if (d->getName() == "Musical Typing")
            return dynamic_cast<te::VirtualMidiInputDevice*> (d.get());
    [[maybe_unused]] auto r = dm.createVirtualMidiDevice ("Musical Typing");
    for (auto& d : dm.getMidiInDevices())
        if (d->getName() == "Musical Typing")
            return dynamic_cast<te::VirtualMidiInputDevice*> (d.get());
    return nullptr;
}

//==============================================================================
te::Clip::Ptr Session::addAudioFile (te::AudioTrack& t, const juce::File& f, te::TimePosition at)
{
    te::AudioFile af (engine, f);
    if (! af.isValid()) { lastError = "Couldn't read " + f.getFileName(); return {}; }
    auto c = t.insertWaveClip (f.getFileNameWithoutExtension(), f, { { at, te::TimeDuration::fromSeconds (af.getLength()) }, {} }, false);
    if (c)
    {
        c->setColour (t.getColour());
        selection.selectOnly (c.get());
    }
    notifyStructure();
    return c;
}

te::Clip::Ptr Session::addMidiFile (te::AudioTrack& t, const juce::File& f, te::TimePosition at)
{
    juce::FileInputStream in (f);
    juce::MidiFile mf;
    if (! in.openedOk() || ! mf.readFrom (in)) { lastError = "Couldn't read " + f.getFileName(); return {}; }
    mf.convertTimestampTicksToSeconds();
    juce::MidiMessageSequence all;
    for (int i = 0; i < mf.getNumTracks(); ++i) all.addSequence (*mf.getTrack (i), 0.0);
    all.updateMatchedPairs();
    auto len = juce::jmax (1.0, all.getEndTime());
    auto clip = t.insertMIDIClip (f.getFileNameWithoutExtension(), { at, at + te::TimeDuration::fromSeconds (len) }, nullptr);
    if (clip)
    {
        clip->getSequence().importMidiSequence (all, edit.get(), at, nullptr);
        clip->setColour (t.getColour());
    }
    notifyStructure();
    return clip;
}

te::MidiClip::Ptr Session::addMidiClip (te::AudioTrack& t, te::TimePosition at, te::BeatDuration length)
{
    auto& ts = edit->tempoSequence;
    auto startBeat = ts.toBeats (at);
    auto end = ts.toTime (startBeat + length);
    auto c = t.insertMIDIClip ({ at, end }, nullptr);
    if (c) { c->setColour (t.getColour()); c->setName (t.getName()); selection.selectOnly (c.get()); }
    notifyStructure();
    return c;
}

juce::Array<te::Clip*> Session::selectedClips() const
{
    return selection.getItemsOfType<te::Clip>();
}

void Session::deleteSelected()
{
    if (edit == nullptr) return;
    auto clips = selectedClips();
    if (! clips.isEmpty())
    {
        selection.deselectAll();
        for (auto c : clips) c->removeFromParent();
        notifyStructure();
        return;
    }
    for (auto p : selection.getItemsOfType<te::Plugin>())
    {
        selection.deselectAll();
        p->deleteFromParent();
        notifyStructure();
        return;
    }
}

void Session::splitSelectedAtPlayhead()
{
    if (edit == nullptr) return;
    auto t = edit->getTransport().getPosition();
    auto clips = selectedClips();
    if (clips.isEmpty())
    {
        // nothing selected: split whatever is under the playhead on the selected track
        if (auto tr = selectedTrack())
            for (auto c : tr->getClips())
                if (c->getEditTimeRange().containsInclusive (t)) clips.add (c);
    }
    for (auto c : clips)
        if (auto ct = dynamic_cast<te::ClipTrack*> (c->getTrack()))
            if (c->getEditTimeRange().contains (t) && t > c->getPosition().getStart())
                ct->splitClip (*c, t);
    notifyStructure();
}

void Session::duplicateSelected()
{
    if (edit == nullptr) return;
    juce::Array<te::Clip*> made;
    for (auto c : selectedClips())
    {
        if (auto copy = te::duplicateClip (*c))
        {
            auto len = c->getPosition().getLength();
            copy->setStart (c->getPosition().getEnd(), false, true);
            juce::ignoreUnused (len);
            made.add (copy.get());
        }
    }
    selection.deselectAll();
    for (auto c : made) selection.addToSelection (c);
    notifyStructure();
}

void Session::quantiseSelected (double beats)
{
    if (edit == nullptr || beats <= 0) return;
    for (auto c : selectedClips())
        if (auto mc = dynamic_cast<te::MidiClip*> (c))
            for (auto n : mc->getSequence().getNotes())
            {
                auto s = n->getStartBeat().inBeats();
                auto q = std::round (s / beats) * beats;
                n->setStartAndLength (te::BeatPosition::fromBeats (q), n->getLengthBeats(), &edit->getUndoManager());
            }
}

//==============================================================================
double Session::beatsPerBar() const
{
    if (edit == nullptr) return 4.0;
    auto& sig = edit->tempoSequence.getTimeSigAt (te::TimePosition());
    return sig.numerator * 4.0 / juce::jmax (1, sig.denominator.get());
}

te::BeatPosition Session::snapBeat (te::BeatPosition b, bool force) const
{
    if (! snap && ! force) return b;
    auto g = juce::jmax (1.0 / 64.0, gridBeats);
    return te::BeatPosition::fromBeats (std::round (b.inBeats() / g) * g);
}

te::TimePosition Session::snapTime (te::TimePosition t, bool force) const
{
    if (edit == nullptr || (! snap && ! force)) return t;
    auto& ts = edit->tempoSequence;
    return ts.toTime (snapBeat (ts.toBeats (t), force));
}

void Session::undo()  { if (edit) { edit->getUndoManager().undo(); notifyStructure(); } }
void Session::redo()  { if (edit) { edit->getUndoManager().redo(); notifyStructure(); } }

//==============================================================================
void Session::valueTreePropertyChanged (juce::ValueTree&, const juce::Identifier&)  { propsDirty = true; triggerAsyncUpdate(); }
void Session::valueTreeChildAdded (juce::ValueTree&, juce::ValueTree&)              { structureDirty = true; triggerAsyncUpdate(); }
void Session::valueTreeChildRemoved (juce::ValueTree&, juce::ValueTree&, int)       { structureDirty = true; triggerAsyncUpdate(); }
void Session::valueTreeChildOrderChanged (juce::ValueTree&, int, int)               { structureDirty = true; triggerAsyncUpdate(); }

void Session::handleAsyncUpdate()
{
    if (structureDirty) { structureDirty = false; propsDirty = false; listeners.call ([] (Listener& l) { l.structureChanged(); }); }
    if (propsDirty)     { propsDirty = false; listeners.call ([] (Listener& l) { l.propertiesChanged(); }); }
}

void Session::changeListenerCallback (juce::ChangeBroadcaster*)
{
    listeners.call ([] (Listener& l) { l.selectionChanged(); });
}

//==============================================================================
te::Plugin* trackInstrument (te::AudioTrack& t)
{
    for (auto p : t.pluginList)
        if (p->isSynth()) return p;
    return nullptr;
}

bool trackHasInstrument (te::AudioTrack& t)   { return trackInstrument (t) != nullptr; }

} // namespace ms
