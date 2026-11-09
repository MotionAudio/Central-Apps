#include "SongTools.h"
#include "VocalTools.h"
#include "BinaryData.h"

namespace ms::song
{

//==============================================================================
// sections
//==============================================================================
std::vector<Section> sections (Session& s)
{
    std::vector<Section> out;
    if (s.edit == nullptr) return out;
    auto& ts = s.edit->tempoSequence;
    for (auto m : s.edit->getMarkerManager().getMarkers())
        out.push_back ({ m, ts.toBeats (m->getPosition().getStart()).inBeats(), m->getName() });
    std::sort (out.begin(), out.end(), [] (auto& a, auto& b) { return a.beat < b.beat; });
    return out;
}

juce::StringArray commonSectionNames()
{
    return { "Intro", "Verse 1", "Verse 2", "Verse 3", "Verse 4", "Pre-Chorus", "Chorus", "Chorus 2", "Double Chorus", "Bridge", "Bridge 2",
             "Instrumental", "Interlude", "Turnaround", "Breakdown", "Build", "Refrain", "Tag", "Vamp", "Solo", "Outro", "Ending" };
}

te::Clip::Ptr addSection (Session& s, double beat, const juce::String& name)
{
    if (s.edit == nullptr) return {};
    s.edit->ensureMarkerTrack();
    auto& mm = s.edit->getMarkerManager();
    int next = 1;
    for (auto m : mm.getMarkers()) next = juce::jmax (next, m->getMarkerID() + 1);
    auto& ts = s.edit->tempoSequence;
    auto start = ts.toTime (te::BeatPosition::fromBeats (juce::jmax (0.0, beat)));
    auto end = ts.toTime (te::BeatPosition::fromBeats (juce::jmax (0.0, beat) + s.beatsPerBar() * 4));
    auto m = mm.createMarker (next, start, end - start, nullptr);
    if (m != nullptr) m->setName (name);
    return m;
}

void renameSection (te::Clip& c, const juce::String& name)  { c.setName (name); }
void removeSection (Session&, te::Clip& c)                    { c.removeFromParent(); }
void moveSection (Session& s, te::Clip& c, double beat)
{
    c.setStart (s.edit->tempoSequence.toTime (te::BeatPosition::fromBeats (juce::jmax (0.0, beat))), false, true);
}

//==============================================================================
// keys
//==============================================================================
juce::String keyName (int k)
{
    static const char* names[] = { "C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B" };
    k = juce::jlimit (0, 23, k);
    return juce::String (names[k % 12]) + (k >= 12 ? "m" : "");
}

static int majorRoot (int k)  { return k < 12 ? k : (k - 12 + 3) % 12; }

int semitonesBetween (int from, int to)
{
    auto d = ((majorRoot (to) - majorRoot (from)) % 12 + 12) % 12;
    return d > 6 ? d - 12 : d;
}

static bool isDrumTrack (te::Track* t)  { return autotime::guessInstrument (t) == autotime::Instrument::drums; }

//==============================================================================
/** SoundTouch pitch shift (and stretch) of a buffer. */
static bool soundTouch (const juce::AudioBuffer<float>& src, double sr, double factor, float semis, juce::AudioBuffer<float>& result,
                        std::function<bool (float)> progress)
{
    int chans = src.getNumChannels(), n = src.getNumSamples();
    int wanted = juce::jmax (1, (int) std::round (n * factor));
    juce::AudioBuffer<float> dst (chans, wanted + 8192);
    dst.clear();
    te::TimeStretcher ts;
    const int block = 1024;
    ts.initialise (sr, block, chans, te::TimeStretcher::soundtouchBetter, {}, false);
    if (! ts.isInitialised()) return false;
    ts.setSpeedAndPitch ((float) factor, semis);
    juce::AudioBuffer<float> inBlock (chans, ts.getMaxFramesNeeded() + block), outBlock (chans, block);
    int inPos = 0, written = 0;
    auto append = [&] (int got)
    {
        got = juce::jmin (got, dst.getNumSamples() - written);
        for (int c = 0; c < chans && got > 0; ++c) dst.copyFrom (c, written, outBlock, c, 0, got);
        written += juce::jmax (0, got);
    };
    while (inPos < n && written < dst.getNumSamples())
    {
        auto need = ts.getFramesNeeded();
        inBlock.clear();
        auto have = juce::jmin (need, n - inPos);
        for (int c = 0; c < chans; ++c) if (have > 0) inBlock.copyFrom (c, 0, src, c, inPos, have);
        outBlock.clear();
        append (ts.processData (inBlock.getArrayOfReadPointers(), need, outBlock.getArrayOfWritePointers()));
        inPos += need;
        if (progress && (inPos & 0xffff) < need && ! progress ((float) inPos / (float) n)) return false;
    }
    for (int guard = 0; guard < 4096 && written < dst.getNumSamples(); ++guard)
    {
        outBlock.clear();
        auto got = ts.flush (outBlock.getArrayOfWritePointers());
        if (got <= 0) break;
        append (got);
    }
    result.setSize (chans, wanted);
    result.clear();
    for (int c = 0; c < chans; ++c) result.copyFrom (c, 0, dst, c, 0, juce::jmin (wanted, written));
    return true;
}

bool stretchFile (te::Engine& e, const juce::File& in, const juce::File& out, double factor, float semis, std::function<bool (float)> progress)
{
    juce::AudioBuffer<float> src;
    double sr = 0;
    if (! vocal::readAudio (e, in, src, sr)) return false;
    juce::AudioBuffer<float> timed;
    if (std::abs (factor - 1.0) > 1e-6)
    {
        // tempo: every hit moves with the beat, the hit itself copied straight (no flams on drums), the rest stretched
        std::vector<float> mono;
        vocal::mixToMono (src, mono);
        auto len = src.getNumSamples() / sr;
        auto onsets = vocal::detectOnsets (mono.data(), (int) mono.size(), sr, vocal::OnsetStyle::normal);
        std::vector<vocal::WarpKnot> knots { { 0.0, 0.0, false } };
        for (size_t i = 0; i < onsets.size(); ++i)
        {
            auto o = onsets[i], next = i + 1 < onsets.size() ? onsets[i + 1] : len;
            auto hold = juce::jmin (0.2, 0.5 * (next - o) * juce::jmin (1.0, factor));
            if (o * factor <= knots.back().out + 0.002) continue;
            knots.push_back ({ o * factor, o, true });
            knots.push_back ({ o * factor + hold, o + hold, false });
        }
        if (len * factor > knots.back().out + 0.001) knots.push_back ({ len * factor, len, false });
        vocal::warpRender (src, sr, knots, len * factor, timed, [&] (float f) { return progress == nullptr || progress (f * (semis != 0 ? 0.5f : 1.0f)); });
    }
    else timed.makeCopyOf (src);
    if (semis != 0.0f)
    {
        juce::AudioBuffer<float> shifted;
        if (! soundTouch (timed, sr, 1.0, semis, shifted, [&] (float f) { return progress == nullptr || progress (0.5f + f * 0.5f); })) return false;
        return vocal::writeWav (out, shifted, sr);
    }
    return vocal::writeWav (out, timed, sr);
}

//==============================================================================
Result changeKeyAndTempo (Session& s, int newKey, double newBpm, bool moveAudio)
{
    Result r;
    if (s.edit == nullptr) return r;
    auto& edit = *s.edit;
    auto& ts = edit.tempoSequence;
    auto oldBpm = ts.getTempo (0)->getBpm();
    newBpm = juce::jlimit (30.0, 300.0, newBpm);
    auto ratio = newBpm / oldBpm, factor = oldBpm / newBpm;
    auto oldKey = s.songKey;
    auto semis = semitonesBetween (oldKey, newKey);
    bool tempoChanges = std::abs (ratio - 1.0) > 1e-6;
    if (! tempoChanges && semis == 0 && newKey == s.songKey) { r.ok = true; r.message = "Nothing to change."; return r; }
    edit.getTransport().stop (false, true);
    auto toBeat = [&] (te::TimePosition t) { return ts.toBeats (t).inBeats(); };

    // where everything is, in beats
    struct ClipPlace { te::Clip::Ptr clip; double startBeat, endBeat, offset, fadeIn, fadeOut; };
    std::vector<ClipPlace> places;
    for (auto t : te::getAllTracks (edit))
        if (auto ct = dynamic_cast<te::ClipTrack*> (t))
            for (auto c : ct->getClips())
            {
                ClipPlace p { c, toBeat (c->getPosition().getStart()), toBeat (c->getPosition().getEnd()), c->getPosition().getOffset().inSeconds(), 0, 0 };
                if (auto ac = dynamic_cast<te::AudioClipBase*> (c)) { p.fadeIn = ac->getFadeIn().inSeconds(); p.fadeOut = ac->getFadeOut().inSeconds(); }
                places.push_back (p);
            }
    struct AutoPoint { double beat; float value, curve; };
    std::vector<std::pair<te::AutomatableParameter::Ptr, std::vector<AutoPoint>>> autos;
    for (auto p : edit.getAllAutomatableParams (true))
        if (p->hasAutomationPoints())
        {
            std::vector<AutoPoint> pts;
            auto& c = p->getCurve();
            for (int i = 0; i < c.getNumPoints(); ++i) pts.push_back ({ toBeat (c.getPointTime (i)), c.getPointValue (i), c.getPointCurve (i) });
            autos.push_back ({ p, pts });
        }
    auto loop = edit.getTransport().getLoopRange();
    auto loopB = std::make_pair (toBeat (loop.getStart()), toBeat (loop.getEnd()));
    auto posB = toBeat (edit.getTransport().getPosition());

    // render the audio first (nothing has changed yet if it's cancelled)
    std::map<juce::String, juce::File> rendered;    // "path|semis" -> new file
    int audioClips = 0;
    if (moveAudio)
    {
        std::vector<std::tuple<juce::File, float, te::WaveAudioClip*>> jobs;
        for (auto& p : places)
            if (auto wc = dynamic_cast<te::WaveAudioClip*> (p.clip.get()))
            {
                if (wc->getAutoTempo()) continue;     // follows the tempo by itself
                auto sh = isDrumTrack (wc->getTrack()) ? 0.0f : (float) semis;
                if (! tempoChanges && sh == 0.0f) continue;
                auto f = clipaudio::sourceFile (*wc);
                auto keyStr = f.getFullPathName() + "|" + juce::String (sh);
                if (rendered.count (keyStr) == 0) { rendered[keyStr] = clipaudio::newFile (s, *wc, keyName (newKey) + " " + juce::String (newBpm, 1) + " bpm"); jobs.push_back ({ f, sh, wc }); }
            }
        bool ok = runWithProgress ("Moving the audio to " + keyName (newKey) + ", " + juce::String (newBpm, 1) + " BPM", [&] (std::function<bool (float)> prog)
        {
            int done = 0;
            for (auto& [f, sh, clip] : jobs)
            {
                juce::ignoreUnused (clip);
                auto out = rendered[f.getFullPathName() + "|" + juce::String (sh)];
                auto base = (float) done / (float) jobs.size();
                if (! stretchFile (s.engine, f, out, factor, sh, [&] (float x) { return prog (base + x / (float) jobs.size()); }))
                {
                    r.message = "Couldn't render " + f.getFileName();
                    return false;
                }
                ++done;
            }
            return true;
        });
        if (! ok) { if (r.message.isEmpty()) r.message = "Cancelled."; return r; }
    }

    auto& um = edit.getUndoManager();
    um.beginNewTransaction ("Change key and tempo");
    for (int i = 0; i < ts.getNumTempos(); ++i)
    {
        auto t = ts.getTempo (i);
        t->set (t->getStartBeat(), t->getBpm() * ratio, t->getCurve(), false);
    }
    auto toTime = [&] (double b) { return ts.toTime (te::BeatPosition::fromBeats (b)); };
    for (auto& p : places)
    {
        auto c = p.clip;
        auto start = toTime (p.startBeat), end = toTime (p.endBeat);
        double offset = p.offset;
        if (auto wc = dynamic_cast<te::WaveAudioClip*> (c.get()))
        {
            auto sh = isDrumTrack (wc->getTrack()) ? 0.0f : (float) semis;
            auto it = rendered.find (clipaudio::sourceFile (*wc).getFullPathName() + "|" + juce::String (sh));
            if (it != rendered.end())
            {
                clipaudio::setSource (*wc, it->second);
                tune::clear (*wc);
                offset = p.offset * factor;
                ++audioClips;
            }
            wc->setFadeIn (te::TimeDuration::fromSeconds (p.fadeIn * (it != rendered.end() ? factor : 1.0)));
            wc->setFadeOut (te::TimeDuration::fromSeconds (p.fadeOut * (it != rendered.end() ? factor : 1.0)));
        }
        c->setPosition ({ { start, end }, te::TimeDuration::fromSeconds (offset) });
        if (auto mc = dynamic_cast<te::MidiClip*> (c.get()); mc != nullptr && semis != 0 && ! isDrumTrack (mc->getTrack()))
            for (auto n : mc->getSequence().getNotes())
                n->setNoteNumber (juce::jlimit (0, 127, n->getNoteNumber() + semis), &um);
    }
    for (auto& [param, pts] : autos)
    {
        auto& c = param->getCurve();
        c.clear (&um);
        for (auto& pt : pts) c.addPoint (toTime (pt.beat), pt.value, pt.curve, &um);
    }
    if (loop.getLength() > 0s) edit.getTransport().setLoopRange ({ toTime (loopB.first), toTime (loopB.second) });
    edit.getTransport().setPosition (toTime (posB));
    s.setSongKey (newKey);
    s.notifyStructure();
    r.ok = true;
    juce::StringArray parts;
    if (semis != 0 || newKey != oldKey) parts.add ("key " + keyName (newKey) + (semis != 0 ? " (" + juce::String (semis > 0 ? "+" : "") + juce::String (semis) + " semitones)" : juce::String()));
    if (tempoChanges) parts.add (juce::String (newBpm, 1) + " BPM");
    r.message = "Moved the song to " + parts.joinIntoString (", ") + "." + (audioClips > 0 ? " " + juce::String (audioClips) + " audio clips were rendered again (drums keep their pitch)." : juce::String());
    return r;
}

//==============================================================================
// export
//==============================================================================
juce::StringArray roleNames()  { return { "Music", "Drums", "Bass", "Keys", "Guitar", "Vocals", "Leave out" }; }

Role guessRole (Session& s, te::AudioTrack& t)
{
    if (s.kindOf (t) == TrackKind::ret) return Role::none;
    switch (autotime::guessInstrument (&t))
    {
        case autotime::Instrument::drums:   return Role::drums;
        case autotime::Instrument::bass:    return Role::bass;
        case autotime::Instrument::keys:
        case autotime::Instrument::strings: return Role::keys;
        case autotime::Instrument::guitar:  return Role::guitar;
        case autotime::Instrument::vocals:  return Role::vocals;
        default: break;
    }
    if (trackHasInstrument (t)) return Role::keys;
    return Role::music;
}

static const std::map<juce::String, std::pair<const char*, int>>& cueResources()
{
    static std::map<juce::String, std::pair<const char*, int>> map;
    if (map.empty())
        for (int i = 0; i < MotionData::namedResourceListSize; ++i)
        {
            juce::String file (MotionData::originalFilenames[i]);
            if (! file.endsWithIgnoreCase (".wav")) continue;
            int size = 0;
            if (auto data = MotionData::getNamedResource (MotionData::namedResourceList[i], size))
                map[file.upToLastOccurrenceOf (".", false, false).toLowerCase()] = { data, size };
        }
    return map;
}

static juce::String cueFor (const juce::String& sectionName)
{
    auto& cues = cueResources();
    auto n = sectionName.toLowerCase().trim().replaceCharacters ("_ ", "--");
    while (n.contains ("--")) n = n.replace ("--", "-");
    if (n == "prechorus") n = "pre-chorus";
    if (n.startsWith ("v") && n.length() <= 3 && n.containsAnyOf ("1234")) n = "verse-" + n.retainCharacters ("1234");
    if (cues.count (n)) return n;
    auto base = n.trimCharactersAtEnd ("-0123456789");
    if (cues.count (base)) return base;
    return {};
}

static juce::AudioBuffer<float> loadCue (const juce::String& name, double sr)
{
    auto& cues = cueResources();
    auto it = cues.find (name);
    if (it == cues.end()) return {};
    juce::WavAudioFormat wav;
    std::unique_ptr<juce::AudioFormatReader> reader (wav.createReaderFor (new juce::MemoryInputStream (it->second.first, (size_t) it->second.second, false), true));
    if (reader == nullptr) return {};
    juce::AudioBuffer<float> raw (1, (int) reader->lengthInSamples);
    reader->read (&raw, 0, raw.getNumSamples(), 0, true, false);
    auto ratio = reader->sampleRate / sr;
    juce::AudioBuffer<float> out (1, (int) std::ceil (raw.getNumSamples() / ratio) + 4);
    out.clear();
    juce::LagrangeInterpolator li;
    li.process (ratio, raw.getReadPointer (0), out.getWritePointer (0), out.getNumSamples() - 4, raw.getNumSamples(), 0);
    return out;
}

juce::AudioBuffer<float> makeClick (Session& s, double sr, double seconds)
{
    juce::AudioBuffer<float> b (1, juce::jmax (1, (int) (seconds * sr)));
    b.clear();
    auto& ts = s.edit->tempoSequence;
    auto bpb = juce::jmax (1, (int) std::round (s.beatsPerBar()));
    auto lastBeat = ts.toBeats (te::TimePosition::fromSeconds (seconds)).inBeats();
    for (int beat = 0; beat <= (int) lastBeat; ++beat)
    {
        auto at = (int) std::round (ts.toTime (te::BeatPosition::fromBeats (beat)).inSeconds() * sr);
        bool accent = beat % bpb == 0;
        auto f = accent ? 1760.0 : 1320.0;
        auto level = accent ? 0.6f : 0.4f;
        for (int i = 0; i < (int) (0.06 * sr); ++i)
        {
            if (at + i >= b.getNumSamples()) break;
            auto t = i / sr;
            auto env = juce::jmin (1.0, t / 0.001) * std::exp (-t / 0.018);
            b.addSample (0, at + i, level * (float) (env * std::sin (juce::MathConstants<double>::twoPi * f * t)));
        }
    }
    return b;
}

juce::AudioBuffer<float> makeGuide (Session& s, double sr, double seconds)
{
    juce::AudioBuffer<float> b (1, juce::jmax (1, (int) (seconds * sr)));
    b.clear();
    auto& ts = s.edit->tempoSequence;
    auto bar = (double) juce::jmax (1, (int) std::round (s.beatsPerBar()));
    for (auto& sec : sections (s))
    {
        auto name = cueFor (sec.name);
        if (name.isEmpty() || sec.beat < bar - 1e-6) continue;     // said one bar ahead
        auto cue = loadCue (name, sr);
        auto at = (int) std::round (ts.toTime (te::BeatPosition::fromBeats (sec.beat - bar)).inSeconds() * sr);
        for (int i = 0; i < cue.getNumSamples() && at + i < b.getNumSamples(); ++i)
            if (at + i >= 0) b.addSample (0, at + i, cue.getSample (0, i) * 0.9f);
    }
    return b;
}

juce::MemoryBlock makeMarkersMidi (Session& s)
{
    constexpr int ppq = 960;
    juce::MidiMessageSequence seq;
    auto& ts = s.edit->tempoSequence;
    for (int i = 0; i < ts.getNumTempos(); ++i)
    {
        auto t = ts.getTempo (i);
        auto m = juce::MidiMessage::tempoMetaEvent ((int) std::round (60.0e6 / t->getBpm()));
        m.setTimeStamp (t->getStartBeat().inBeats() * ppq);
        seq.addEvent (m);
    }
    auto sig = juce::MidiMessage::timeSignatureMetaEvent (juce::jmax (1, (int) std::round (s.beatsPerBar())), 4);
    sig.setTimeStamp (0);
    seq.addEvent (sig);
    for (auto& sec : sections (s))
    {
        auto m = juce::MidiMessage::textMetaEvent (6, sec.name);
        m.setTimeStamp (sec.beat * ppq);
        seq.addEvent (m);
    }
    auto end = juce::MidiMessage::endOfTrack();
    end.setTimeStamp (seq.getEndTime() + ppq);
    seq.addEvent (end);
    seq.updateMatchedPairs();
    juce::MidiFile mf;
    mf.setTicksPerQuarterNote (ppq);
    mf.addTrack (seq);
    juce::MemoryOutputStream out;
    mf.writeTo (out, 1);
    return out.getMemoryBlock();
}

GradeCheck gradeLikeCentralTracks (const juce::AudioBuffer<float>& b, double sr, int bits)
{
    GradeCheck g;
    int score = 5;
    auto add = [&] (bool ok, const juce::String& text, int penalty) { g.lines.add ((ok ? "ok|" : "no|") + text); if (! ok) score -= penalty; };
    int n = b.getNumSamples(), chans = b.getNumChannels();
    auto secs = n / sr;
    g.lines.add ("ok|" + juce::String ((int) secs / 60) + ":" + juce::String ((int) std::round (std::fmod (secs, 60.0))).paddedLeft ('0', 2) + " - " + (chans == 1 ? "mono" : "stereo"));
    add (bits >= 16, "WAV - " + juce::String (bits) + "-bit - lossless", 1);
    add (sr >= 44100, juce::String (sr / 1000.0, 1) + " kHz sample rate", 1);
    float peak = 0;
    for (int c = 0; c < chans; ++c) peak = juce::jmax (peak, b.getMagnitude (c, 0, n));
    double clipped = 0;
    if (gainToDb (peak) >= -0.1f)
        for (int c = 0; c < chans; ++c) for (int i = 0; i < n; ++i) if (std::abs (b.getSample (c, i)) >= 0.9886f) clipped += 1;
    auto pct = clipped / juce::jmax (1.0, (double) n * chans) * 100.0;
    add (pct < 0.1, "Clipping " + (pct < 0.01 ? juce::String ("none") : juce::String (pct, 2) + "% of samples"), pct > 1 ? 2 : 1);
    // loud and quiet parts: RMS in 50 ms windows
    int w = juce::jmax (1, (int) (0.05 * sr));
    double loud = -200, quiet = 200;
    for (int c = 0; c < chans; ++c)
        for (int i = 0; i + w <= n; i += w)
        {
            auto rms = b.getRMSLevel (c, i, w);
            auto db = rms > 1e-9f ? 20.0 * std::log10 (rms) : -200.0;
            loud = juce::jmax (loud, db); quiet = juce::jmin (quiet, db);
        }
    add (loud > -30, "Level " + juce::String ((int) std::round (loud)) + " dBFS (loud parts)" + (loud <= -30 ? " - too quiet" : ""), 1);
    if (! (loud - quiet >= 20)) g.lines.add ("ok|Sustained throughout - no quiet gaps to check for noise");
    else add (quiet < -50, "Noise in quiet parts " + (quiet < -150 ? juce::String ("none") : juce::String ((int) std::round (quiet)) + " dBFS") + (quiet >= -50 ? " - hiss or hum" : ""), 1);
    g.stars = juce::jlimit (1, 5, score);
    g.loudness = measureLoudness (b, sr);
    return g;
}

static void addToZip (juce::ZipFile::Builder& zb, const juce::File& f, const juce::String& folder)
{
    zb.addFile (f, 0, folder + "/" + f.getFileName());   // stored: WAV hardly compresses
}

ExportResult exportPack (Session& s, const ExportOptions& o)
{
    ExportResult r;
    if (s.edit == nullptr) return r;
    auto& edit = *s.edit;
    edit.getTransport().stop (false, true);
    auto length = edit.getLength();
    if (length <= 0s) { r.message = "The song is empty."; return r; }
    auto bpm = edit.tempoSequence.getTempo (0)->getBpm();
    auto bpmText = std::abs (bpm - std::round (bpm)) < 0.05 ? juce::String ((int) std::round (bpm)) : juce::String (bpm, 1);
    auto name = juce::File::createLegalFileName (o.title.trim().isEmpty() ? s.songName() : o.title.trim());
    if (o.artist.trim().isNotEmpty()) name << " - " << juce::File::createLegalFileName (o.artist.trim());
    name << " - " << bpmText << "bpm - " << keyName (s.songKey);
    auto dir = o.folder.getChildFile (name);
    if (dir.exists()) dir = dir.getNonexistentSibling (true);
    dir.createDirectory();
    const double sr = juce::jmax (44100.0, s.engine.getDeviceManager().getSampleRate() > 0 ? s.engine.getDeviceManager().getSampleRate() : 48000.0);
    auto all = te::getAllTracks (edit);
    auto seconds = length.inSeconds() + 2.0;

    auto render = [&] (const juce::File& dest, juce::BigInteger tracks, bool master)
    {
        te::Renderer::Parameters p (edit);
        p.destFile = dest;
        p.audioFormat = s.engine.getAudioFileFormatManager().getWavFormat();
        p.bitDepth = 24;
        p.sampleRateForAudio = sr;
        p.blockSizeForAudio = 512;
        p.time = { 0s, te::TimePosition::fromSeconds (seconds) };
        p.endAllowance = 0s;
        p.tracksToDo = tracks;
        p.usePlugins = true;
        p.useMasterPlugins = master;
        p.canRenderInMono = false;
        p.checkNodesForAudio = false;
        return te::Renderer::renderToFile ("Exporting " + dest.getFileNameWithoutExtension(), p);
    };

    // which tracks make each stem (the reverb / delay returns go in every stem, so each has its own space)
    juce::BigInteger returns;
    std::map<Role, juce::BigInteger> stems;
    for (auto t : s.tracks())
    {
        auto idx = all.indexOf (t);
        if (idx < 0) continue;
        if (s.kindOf (*t) == TrackKind::ret) { returns.setBit (idx); continue; }
        if (t->isMuted (false)) continue;
        auto it = o.roles.find (t->itemID.toString());
        auto role = it != o.roles.end() ? it->second : guessRole (s, *t);
        if (role == Role::none) continue;
        stems[role].setBit (idx);
    }
    if (stems.empty()) { r.message = "No tracks to export (they're all left out or muted)."; return r; }
    auto names = roleNames();
    juce::Array<juce::File> files;
    for (auto& [role, bits] : stems)
    {
        auto f = dir.getChildFile (names[(int) role] + ".wav");
        auto withReturns = bits;
        withReturns |= returns;
        if (render (f, withReturns, false).existsAsFile()) files.add (f);
    }
    juce::File mix;
    if (o.fullMix)
    {
        mix = dir.getChildFile ("Full Mix.wav");
        juce::BigInteger everything;
        for (auto& [role, bits] : stems) everything |= bits;
        everything |= returns;
        if (render (mix, everything, true).existsAsFile()) files.add (mix);
    }
    if (o.click)
    {
        auto f = dir.getChildFile ("Click.wav");
        if (vocal::writeWav (f, makeClick (s, sr, seconds), sr)) files.add (f);
    }
    auto secs = sections (s);
    if (o.guide && ! secs.empty())
    {
        auto f = dir.getChildFile ("Guide.wav");
        if (vocal::writeWav (f, makeGuide (s, sr, seconds), sr)) files.add (f);
    }
    if (o.markers && ! secs.empty())
    {
        auto f = dir.getChildFile ("Markers.mid");
        auto data = makeMarkersMidi (s);
        if (f.replaceWithData (data.getData(), data.getSize())) files.add (f);
    }
    // the grade estimate, from the full mix (or the first stem)
    juce::AudioBuffer<float> check;
    double csr = 0;
    if (vocal::readAudio (s.engine, mix.existsAsFile() ? mix : files.getFirst(), check, csr))
        r.grade = gradeLikeCentralTracks (check, csr, 24);
    for (auto& f : files) r.files.add (f.getFileName());

    r.output = dir;
    if (o.zip)
    {
        juce::ZipFile::Builder zb;
        for (auto& f : files) addToZip (zb, f, dir.getFileName());
        auto zipFile = dir.getSiblingFile (dir.getFileName() + ".zip");
        zipFile.deleteFile();
        juce::FileOutputStream os (zipFile);
        if (os.openedOk() && zb.writeToStream (os, nullptr))
        {
            os.flush();
            r.output = zipFile;
            dir.deleteRecursively();
        }
    }
    r.ok = files.size() > 0;
    r.message = r.ok ? "Exported " + juce::String (files.size()) + " files." : juce::String ("The export didn't work.");
    return r;
}

} // namespace ms::song
