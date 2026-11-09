#include "VocalTools.h"

namespace ms
{

static const juce::Identifier msOriginal ("msOriginal"), msTune ("msTune"), msComp ("msComp");

//==============================================================================
// clip audio
//==============================================================================
namespace clipaudio
{
    juce::File sourceFile (te::WaveAudioClip& c)   { return c.getSourceFileReference().getFile(); }

    juce::File originalFile (te::WaveAudioClip& c)
    {
        if (c.state.hasProperty (msOriginal))
        {
            juce::File f (c.state[msOriginal].toString());
            if (f.existsAsFile()) return f;
        }
        return sourceFile (c);
    }

    bool hasProcessing (te::WaveAudioClip& c)   { return c.state.hasProperty (msOriginal) && originalFile (c) != sourceFile (c); }

    juce::File newFile (Session& s, te::WaveAudioClip& c, const juce::String& what)
    {
        auto folder = s.engine.getEngineBehaviour().getDefaultFolderForAudioRecordings (*s.edit);
        folder.createDirectory();
        auto base = originalFile (c).getFileNameWithoutExtension();
        if (base.isEmpty()) base = c.getName();
        base = juce::File::createLegalFileName (base);
        return folder.getChildFile (base + " (" + what + ").wav").getNonexistentSibling (true);
    }

    void setSource (te::WaveAudioClip& c, const juce::File& f)
    {
        if (! c.state.hasProperty (msOriginal))
            c.state.setProperty (msOriginal, sourceFile (c).getFullPathName(), &c.edit.getUndoManager());
        c.getSourceFileReference().setToFile (f, te::SourceFileReference::PathStyle::alwaysAbsolute, false);
    }

    void restoreOriginal (te::WaveAudioClip& c)
    {
        auto um = &c.edit.getUndoManager();
        auto orig = originalFile (c);
        if (orig.existsAsFile() && orig != sourceFile (c))
            c.getSourceFileReference().setToFile (orig, te::SourceFileReference::PathStyle::alwaysAbsolute, false);
        c.state.removeProperty (msOriginal, um);
        c.state.removeProperty (msTune, um);
        c.state.removeProperty (msComp, um);
    }
}

//==============================================================================
/** Beat <-> seconds for the song, captured on the message thread so the worker can use it. */
struct BeatTable
{
    double startBeat = 0, step = 1.0 / 32.0;
    std::vector<double> times;

    void build (te::TempoSequence& ts, double fromBeat, double toBeat)
    {
        startBeat = std::floor (juce::jmax (0.0, fromBeat));
        auto n = (int) std::ceil ((toBeat - startBeat) / step) + 2;
        times.resize ((size_t) juce::jmax (2, n));
        for (size_t i = 0; i < times.size(); ++i)
            times[i] = ts.toTime (te::BeatPosition::fromBeats (startBeat + (double) i * step)).inSeconds();
    }
    double toTime (double beat) const
    {
        auto f = (beat - startBeat) / step;
        auto i = juce::jlimit (0, (int) times.size() - 2, (int) std::floor (f));
        auto frac = f - i;
        return times[(size_t) i] + (times[(size_t) i + 1] - times[(size_t) i]) * frac;
    }
    double toBeat (double t) const
    {
        auto it = std::upper_bound (times.begin(), times.end(), t);
        auto i = juce::jlimit (0, (int) times.size() - 2, (int) (it - times.begin()) - 1);
        auto t0 = times[(size_t) i], t1 = times[(size_t) i + 1];
        return startBeat + ((double) i + (t - t0) / juce::jmax (1e-9, t1 - t0)) * step;
    }
};

//==============================================================================
/** Runs work on a background thread behind a progress window (or straight away with no UI). */
static bool runWithProgress (const juce::String& title, std::function<bool (std::function<bool (float)>)> work)
{
    struct Task : public juce::ThreadWithProgressWindow
    {
        Task (const juce::String& t, std::function<bool (std::function<bool (float)>)> w)
            : juce::ThreadWithProgressWindow (t, true, true), fn (std::move (w)) {}
        void run() override
        {
            ok = fn ([this] (float p) { setProgress (p); return ! threadShouldExit(); });
        }
        std::function<bool (std::function<bool (float)>)> fn;
        bool ok = false;
    };
    if (juce::Desktop::getInstance().getNumComponents() == 0 || ! juce::MessageManager::existsAndIsCurrentThread())
        return work ([] (float) { return true; });
   #if JUCE_MODAL_LOOPS_PERMITTED
    Task t (title, std::move (work));
    if (! t.runThread()) return false;
    return t.ok;
   #else
    return work ([] (float) { return true; });
   #endif
}

//==============================================================================
// Auto Time
//==============================================================================
namespace autotime
{
    juce::StringArray instrumentNames()  { return { "Drums", "Bass", "Keys / piano", "Guitar", "Vocals", "Strings / pads", "Other" }; }

    Instrument guessInstrument (te::Track* t)
    {
        if (t == nullptr) return Instrument::other;
        auto n = t->getName().toLowerCase();
        if (auto at = dynamic_cast<te::AudioTrack*> (t))
            if (auto inst = trackInstrument (*at)) n << " " << inst->getName().toLowerCase();
        auto has = [&] (std::initializer_list<const char*> words) { for (auto w : words) if (n.contains (w)) return true; return false; };
        if (has ({ "drum", "kick", "snare", "hat", "perc", "beat", "loop" })) return Instrument::drums;
        if (has ({ "bass" })) return Instrument::bass;
        if (has ({ "vox", "vocal", "voice", "sing", "lead", "choir", "bgv", "harmony" })) return Instrument::vocals;
        if (has ({ "pad", "string", "violin", "cello", "swell", "ambient" })) return Instrument::strings;
        if (has ({ "gtr", "guitar", "acoustic" })) return Instrument::guitar;
        if (has ({ "key", "piano", "organ", "rhodes", "synth", "ep" })) return Instrument::keys;
        return Instrument::other;
    }

    juce::String gridName (double g)
    {
        if (std::abs (g - 4.0) < 1e-6) return "1 bar";
        if (std::abs (g - 2.0) < 1e-6) return "1/2";
        if (std::abs (g - 1.0) < 1e-6) return "1/4";
        if (std::abs (g - 0.5) < 1e-6) return "1/8";
        if (std::abs (g - 0.25) < 1e-6) return "1/16";
        if (std::abs (g - 1.0 / 3.0) < 1e-6) return "1/8 triplet";
        if (std::abs (g - 1.0 / 6.0) < 1e-6) return "1/16 triplet";
        if (std::abs (g - 0.125) < 1e-6) return "1/32";
        return juce::String (g, 3) + " beat";
    }

    struct Profile
    {
        std::vector<double> grids;       // coarse to fine
        double fallback;
        float strength;
        vocal::OnsetStyle style;
        float maxMove;                    // only move hits within this fraction of the grid
        float endAmount;                  // MIDI: how much note ends follow the grid
        bool legato;                      // MIDI: ends go to the next grid line
    };

    static Profile profileFor (Instrument i)
    {
        switch (i)
        {
            case Instrument::drums:   return { { 0.5, 0.25, 1.0 / 6.0 }, 0.25, 1.0f, vocal::OnsetStyle::drums, 0.5f, 0.0f, false };
            case Instrument::bass:    return { { 1.0, 0.5, 0.25 }, 0.25, 0.9f, vocal::OnsetStyle::tight, 0.5f, 0.5f, false };
            case Instrument::keys:    return { { 1.0, 0.5, 1.0 / 3.0, 0.25 }, 0.25, 0.8f, vocal::OnsetStyle::normal, 0.5f, 0.4f, false };
            case Instrument::guitar:  return { { 1.0, 0.5, 1.0 / 3.0, 0.25 }, 0.25, 0.85f, vocal::OnsetStyle::normal, 0.5f, 0.3f, false };
            case Instrument::vocals:  return { { 1.0, 0.5, 1.0 / 3.0, 0.25 }, 0.5, 0.65f, vocal::OnsetStyle::vocal, 0.42f, 0.0f, false };
            case Instrument::strings: return { { 2.0, 1.0, 0.5 }, 0.5, 0.6f, vocal::OnsetStyle::vocal, 0.5f, 1.0f, true };
            case Instrument::other:
            default:                  return { { 1.0, 0.5, 1.0 / 3.0, 0.25 }, 0.25, 0.8f, vocal::OnsetStyle::normal, 0.5f, 0.0f, false };
        }
    }

    /** The coarsest grid the playing sits on. */
    static double pickGrid (const std::vector<double>& beats, const Profile& p)
    {
        if (beats.size() < 4) return p.fallback;
        auto threshold = p.style == vocal::OnsetStyle::vocal ? 0.17 : 0.13;
        double bestG = p.grids.back(), bestE = 1e9;
        for (auto g : p.grids)
        {
            double e = 0;
            for (auto b : beats) e += std::abs (b - std::round (b / g) * g) / g;
            e /= (double) beats.size();
            if (e < threshold) return g;
            if (e < bestE) { bestE = e; bestG = g; }
        }
        return bestG;
    }

    //==============================================================================
    static Result applyMidi (Session& s, te::MidiClip& mc, const Options& o)
    {
        Result r;
        auto p = profileFor (o.instrument);
        auto strength = o.strength >= 0 ? o.strength : p.strength;
        auto& ts = s.edit->tempoSequence;
        auto* um = &s.edit->getUndoManager();
        auto notes = mc.getSequence().getNotes();
        r.total = notes.size();
        if (notes.isEmpty()) { r.message = "There are no notes in this clip."; return r; }

        struct N { te::MidiNote* n; double songStart, songEnd; };
        std::vector<N> list;
        for (auto n : notes)
        {
            auto st = ts.toBeats (mc.getTimeOfContentBeat (n->getStartBeat())).inBeats();
            auto en = ts.toBeats (mc.getTimeOfContentBeat (n->getEndBeat())).inBeats();
            list.push_back ({ n, st, en });
        }
        std::sort (list.begin(), list.end(), [] (auto& a, auto& b) { return a.songStart < b.songStart; });

        // chords and strums move together, from their first note
        std::vector<std::vector<size_t>> groups;
        for (size_t i = 0; i < list.size(); ++i)
        {
            if (! groups.empty() && list[i].songStart - list[groups.back().front()].songStart < 0.06) groups.back().push_back (i);
            else groups.push_back ({ i });
        }
        std::vector<double> starts;
        for (auto& g : groups) starts.push_back (list[g.front()].songStart);
        auto grid = o.gridBeats > 0 ? o.gridBeats : pickGrid (starts, p);
        r.grid = grid;

        um->beginNewTransaction ("Auto Time");
        for (auto& g : groups)
        {
            auto first = list[g.front()].songStart;
            auto target = std::round (first / grid) * grid;
            auto dev = target - first;
            if (std::abs (dev) > p.maxMove * grid + 1e-9) continue;
            auto delta = dev * strength;
            if (std::abs (delta) > 1e-6) ++r.moved;
            for (auto idx : g)
            {
                auto& n = list[idx];
                auto ns = n.songStart + delta;
                auto ne = n.songEnd + delta;
                if (p.legato)
                {
                    auto q = std::round (ne / grid) * grid;
                    ne = juce::jmax (ns + grid * 0.5, q);
                }
                else if (p.endAmount > 0)
                {
                    auto q = std::round (ne / grid) * grid;
                    if (q - ns >= grid * 0.5) ne += (q - ne) * p.endAmount * strength;
                }
                auto cs = mc.getContentBeatAtTime (ts.toTime (te::BeatPosition::fromBeats (juce::jmax (0.0, ns))));
                auto ce = mc.getContentBeatAtTime (ts.toTime (te::BeatPosition::fromBeats (juce::jmax (0.0, ne))));
                auto len = juce::jmax (1.0 / 64.0, (ce - cs).inBeats());
                n.n->setStartAndLength (cs, te::BeatDuration::fromBeats (len), um);
            }
        }
        r.moved = juce::jmin (r.moved, (int) groups.size());
        r.ok = true;
        r.message = "Moved " + juce::String (r.moved) + " of " + juce::String ((int) groups.size()) + (groups.size() == list.size() ? " notes" : " notes and chords")
                    + " onto the " + gridName (grid) + " grid (" + juce::String (juce::roundToInt (strength * 100.0f)) + "%).";
        return r;
    }

    //==============================================================================
    static Result applyAudio (Session& s, te::WaveAudioClip& wc, const Options& o, std::function<bool (float)> progress)
    {
        Result r;
        if (wc.isLooping()) { r.message = "Turn off Loop on this clip first."; return r; }
        auto p = profileFor (o.instrument);
        auto strength = o.strength >= 0 ? o.strength : p.strength;
        auto& ts = s.edit->tempoSequence;

        // clip -> song mapping (bake any tempo-follow / speed into plain time first)
        if (wc.getAutoTempo()) wc.setAutoTempo (false);
        if (std::abs (wc.getSpeedRatio() - 1.0) > 1e-6) wc.setSpeedRatio (1.0);
        auto src = clipaudio::sourceFile (wc);
        auto clipStart = wc.getPosition().getStart().inSeconds();
        auto offset = wc.getPosition().getOffset().inSeconds();
        auto clipLen = wc.getPosition().getLength().inSeconds();
        auto songBpm = ts.getBpmAt (wc.getPosition().getStart());
        BeatTable beats;
        beats.build (ts, ts.toBeats (wc.getPosition().getStart()).inBeats() - 64.0,
                     ts.toBeats (wc.getPosition().getEnd()).inBeats() + 256.0);

        juce::AudioBuffer<float> audio, out;
        double sr = 0;
        juce::String error;
        double outSeconds = 0;
        double tempoFactor = 1.0;
        int moved = 0, total = 0;
        double grid = 0;

        bool ok = runWithProgress ("Auto Time", [&] (std::function<bool (float)> prog)
        {
            auto report = [&] (float f) { if (progress && ! progress (f)) return false; return prog (f); };
            if (! vocal::readAudio (s.engine, src, audio, sr)) { error = "Couldn't read " + src.getFileName(); return false; }
            std::vector<float> mono;
            vocal::mixToMono (audio, mono);
            auto srcLen = audio.getNumSamples() / sr;
            report (0.1f);
            auto onsets = vocal::detectOnsets (mono.data(), (int) mono.size(), sr, p.style);
            // only the hits the clip actually plays
            std::vector<double> used;
            for (auto t : onsets) if (t >= offset - 0.02 && t <= offset + clipLen + 0.02) used.push_back (t);
            total = (int) used.size();
            if (used.size() < 2) { error = "Couldn't find enough clear hits or words in this clip to line up."; return false; }
            report (0.3f);

            // played at another tempo? stretch to the song first
            if (o.matchTempo && used.size() >= 8)
            {
                auto det = vocal::estimateTempo (used);
                if (det > 0)
                {
                    while (det > songBpm * 1.41) det *= 0.5;
                    while (det < songBpm * 0.71) det *= 2.0;
                    r.detectedBpm = det;
                    if (std::abs (det / songBpm - 1.0) > 0.03) tempoFactor = det / songBpm;
                }
            }
            auto first = used.front();
            auto scaled = [&] (double t) { return first + (t - first) * tempoFactor; };

            // where each hit is in the song, in beats
            std::vector<double> songBeats;
            for (auto t : used) songBeats.push_back (beats.toBeat (clipStart + scaled (t) - offset));
            grid = o.gridBeats > 0 ? o.gridBeats : pickGrid (songBeats, p);

            std::vector<vocal::WarpKnot> knots;
            knots.push_back ({ 0.0, 0.0, false });
            for (size_t i = 0; i < used.size(); ++i)
            {
                auto b = songBeats[i];
                auto target = std::round (b / grid) * grid;
                auto dev = target - b;
                double newBeat = b;
                if (std::abs (dev) <= p.maxMove * grid) { newBeat = b + dev * strength; if (std::abs (dev * strength) > 0.004) ++moved; }
                auto outT = beats.toTime (newBeat) - clipStart + offset;
                auto srcT = used[i];
                auto next = i + 1 < used.size() ? used[i + 1] : srcLen;
                // keep the attack and the loud part of the hit as it was; stretch the quieter tail
                auto hold = p.style == vocal::OnsetStyle::vocal ? 0.04 : 0.09;
                auto attack = juce::jmin (hold, 0.4 * (next - srcT));
                auto& last = knots.back();
                auto slopeOk = [&] (double o1, double s1) { auto dOut = o1 - last.out, dSrc = s1 - last.src; return dOut > 0.004 && dSrc / dOut > 0.45 && dSrc / dOut < 2.2; };
                if (outT <= 0.005 || ! slopeOk (outT, srcT)) continue;
                knots.push_back ({ outT, srcT, true });
                knots.push_back ({ outT + attack, srcT + attack, false });
            }
            if (std::getenv ("MS_DEBUG"))
                for (auto& k : knots) std::cout << "   knot out " << k.out << " src " << k.src << (k.onset ? " onset" : "") << std::endl;
            auto& last = knots.back();
            outSeconds = juce::jmax (0.1, last.out + (srcLen - last.src) * (knots.size() > 1 ? 1.0 : tempoFactor));
            knots.push_back ({ outSeconds, srcLen, false });
            if (! report (0.4f)) return false;
            vocal::warpRender (audio, sr, knots, outSeconds, out, [&] (float f) { return report (0.4f + 0.55f * f); });
            return true;
        });
        if (! ok) { r.message = error.isNotEmpty() ? error : juce::String ("Cancelled."); return r; }

        auto file = clipaudio::newFile (s, wc, "timed");
        if (! vocal::writeWav (file, out, sr)) { r.message = "Couldn't write " + file.getFullPathName(); return r; }
        auto& um = s.edit->getUndoManager();
        um.beginNewTransaction ("Auto Time");
        auto oldSrcLen = audio.getNumSamples() / sr;
        bool endsAtSource = offset + clipLen >= oldSrcLen - 0.05;
        clipaudio::setSource (wc, file);
        wc.state.removeProperty (msTune, &um);
        if (endsAtSource || tempoFactor != 1.0)
        {
            auto newLen = juce::jmax (0.05, outSeconds - offset);
            wc.setLength (te::TimeDuration::fromSeconds (newLen), true);
        }
        r.ok = true;
        r.moved = moved;
        r.total = total;
        r.grid = grid;
        r.message = "Lined up " + juce::String (moved) + " of " + juce::String (total) + " hits with the " + gridName (grid) + " grid ("
                    + juce::String (juce::roundToInt (strength * 100.0f)) + "%).";
        if (tempoFactor != 1.0)
            r.message << " It was played at about " << juce::String (r.detectedBpm, 1) << " BPM, so it's been stretched to the song's "
                      << juce::String (songBpm, 1) << " BPM.";
        return r;
    }

    Result apply (Session& s, te::Clip& c, const Options& o, std::function<bool (float)> progress)
    {
        if (auto mc = dynamic_cast<te::MidiClip*> (&c)) return applyMidi (s, *mc, o);
        if (auto wc = dynamic_cast<te::WaveAudioClip*> (&c)) return applyAudio (s, *wc, o, progress);
        Result r;
        r.message = "Auto Time works on audio and MIDI clips.";
        return r;
    }
}

//==============================================================================
// Tune
//==============================================================================
namespace tune
{
    void save (te::WaveAudioClip& c, const Data& d)
    {
        auto* obj = new juce::DynamicObject();
        obj->setProperty ("source", d.source.getFullPathName());
        obj->setProperty ("key", d.key);
        obj->setProperty ("scale", (int) d.scale);
        obj->setProperty ("tight", d.tightness);
        obj->setProperty ("glide", d.glideMs);
        juce::Array<juce::var> notes;
        for (auto& n : d.notes)
            notes.add (juce::Array<juce::var> { n.start, n.end, n.pitch, n.target, n.tune ? 1 : 0, n.userSet ? 1 : 0 });
        obj->setProperty ("notes", notes);
        c.state.setProperty (msTune, juce::JSON::toString (juce::var (obj), true), &c.edit.getUndoManager());
    }

    bool load (te::WaveAudioClip& c, Data& d)
    {
        if (! c.state.hasProperty (msTune)) return false;
        auto v = juce::JSON::parse (c.state[msTune].toString());
        if (! v.isObject()) return false;
        d.source = juce::File (v["source"].toString());
        d.key = (int) v["key"];
        d.scale = (vocal::Scale) (int) v["scale"];
        d.tightness = (float) v["tight"];
        d.glideMs = (float) v["glide"];
        d.notes.clear();
        if (auto* arr = v["notes"].getArray())
            for (auto& n : *arr)
                if (n.isArray() && n.size() >= 6)
                {
                    vocal::TuneNote t;
                    t.start = n[0]; t.end = n[1]; t.pitch = n[2]; t.target = n[3]; t.tune = (int) n[4] != 0; t.userSet = (int) n[5] != 0;
                    d.notes.push_back (t);
                }
        d.pitch = {};
        return d.source.existsAsFile();
    }

    void clear (te::WaveAudioClip& c)  { c.state.removeProperty (msTune, &c.edit.getUndoManager()); }

    bool analyse (Session& s, te::WaveAudioClip& c, Data& d, std::function<bool (float)> progress)
    {
        // tune what's playing now, unless it's our own tuned file (then go back to what it was tuned from)
        Data old;
        d.source = load (c, old) && old.source.existsAsFile() ? old.source : clipaudio::sourceFile (c);
        d.key = s.keyRoot();
        d.scale = s.keyIsMinor() ? vocal::Scale::minor : vocal::Scale::major;
        juce::String error;
        bool ok = runWithProgress ("Finding the notes", [&] (std::function<bool (float)> prog)
        {
            juce::AudioBuffer<float> audio;
            double sr = 0;
            if (! vocal::readAudio (s.engine, d.source, audio, sr)) { error = "Couldn't read the audio"; return false; }
            std::vector<float> mono;
            vocal::mixToMono (audio, mono);
            d.pitch = vocal::analysePitch (mono.data(), (int) mono.size(), sr, 65.0f, 1100.0f,
                                           [&] (float f) { if (progress && ! progress (f * 0.9f)) return false; return prog (f * 0.9f); });
            d.notes = vocal::segmentNotes (d.pitch, d.key, d.scale);
            return true;
        });
        if (std::getenv ("MS_DEBUG"))
            std::cout << "tune analyse: " << d.source.getFullPathName() << " exists " << (int) d.source.existsAsFile() << " ok " << (int) ok
                      << " frames " << d.pitch.frames() << " notes " << d.notes.size() << " " << error << std::endl;
        return ok && ! d.notes.empty();
    }

    bool findPitch (te::Engine& e, Data& d, std::function<bool (float)> progress)
    {
        juce::AudioBuffer<float> audio;
        double sr = 0;
        if (! vocal::readAudio (e, d.source, audio, sr)) return false;
        std::vector<float> mono;
        vocal::mixToMono (audio, mono);
        d.pitch = vocal::analysePitch (mono.data(), (int) mono.size(), sr, 65.0f, 1100.0f, progress);
        return d.pitch.frames() > 0;
    }

    bool renderToFile (te::Engine& e, const Data& dIn, const juce::File& file, std::function<bool (float)> progress)
    {
        Data d = dIn;
        juce::AudioBuffer<float> audio, out;
        double sr = 0;
        auto report = [&] (float f) { return progress == nullptr || progress (f); };
        if (! vocal::readAudio (e, d.source, audio, sr)) return false;
        if (d.pitch.frames() == 0 || std::abs (d.pitch.sampleRate - sr) > 1.0)
        {
            std::vector<float> mono;
            vocal::mixToMono (audio, mono);
            d.pitch = vocal::analysePitch (mono.data(), (int) mono.size(), sr, 65.0f, 1100.0f, [&] (float f) { return report (f * 0.4f); });
        }
        auto curve = vocal::shiftCurve (d.pitch, d.notes, d.tightness, d.glideMs);
        bool cancelled = false;
        vocal::psolaRender (audio, out, d.pitch, curve, [&] (float f) { if (! report (0.4f + 0.6f * f)) { cancelled = true; return false; } return true; });
        if (cancelled) return false;
        return vocal::writeWav (file, out, sr);
    }

    juce::File render (Session& s, te::WaveAudioClip& c, const Data& d, std::function<bool (float)> progress)
    {
        auto file = clipaudio::newFile (s, c, "tuned");
        bool ok = runWithProgress ("Tuning", [&] (std::function<bool (float)> prog)
        {
            return renderToFile (s.engine, d, file, [&] (float f) { if (progress && ! progress (f)) return false; return prog (f); });
        });
        return ok ? file : juce::File();
    }
}

//==============================================================================
std::vector<float> filePeaks (te::Engine& e, const juce::File& f, int points, double& lengthSeconds)
{
    std::vector<float> peaks ((size_t) juce::jmax (1, points), 0.0f);
    lengthSeconds = 0;
    std::unique_ptr<juce::AudioFormatReader> r (e.getAudioFileFormatManager().readFormatManager.createReaderFor (f));
    if (r == nullptr || r->lengthInSamples <= 0) return peaks;
    lengthSeconds = (double) r->lengthInSamples / r->sampleRate;
    auto per = juce::jmax ((juce::int64) 1, r->lengthInSamples / points);
    juce::AudioBuffer<float> buf ((int) juce::jmin (2u, r->numChannels), (int) juce::jmin (per, (juce::int64) 1 << 20));
    for (int i = 0; i < points; ++i)
    {
        auto start = (juce::int64) i * per;
        if (start >= r->lengthInSamples) break;
        auto len = (int) juce::jmin ((juce::int64) buf.getNumSamples(), r->lengthInSamples - start);
        r->read (&buf, 0, len, start, true, buf.getNumChannels() > 1);
        float m = 0;
        for (int c = 0; c < buf.getNumChannels(); ++c) m = juce::jmax (m, buf.getMagnitude (c, 0, len));
        peaks[(size_t) i] = m;
    }
    return peaks;
}

//==============================================================================
// Takes and Auto Comp
//==============================================================================
namespace takes
{
    juce::Array<juce::File> list (te::WaveAudioClip& c)
    {
        juce::Array<juce::File> files;
        auto tree = c.state.getChildWithName (te::IDs::TAKES);
        for (auto take : tree)
        {
            te::SourceFileReference ref (c.edit, take, te::IDs::source);
            auto f = ref.getFile();
            if (f.existsAsFile()) files.addIfNotAlreadyThere (f);
        }
        if (files.isEmpty())
        {
            auto f = clipaudio::originalFile (c);
            if (f.existsAsFile()) files.add (f);
        }
        return files;
    }

    void addTake (te::WaveAudioClip& c, const juce::File& f)
    {
        if (c.state.getChildWithName (te::IDs::TAKES).getNumChildren() == 0)
        {
            // the clip's own audio becomes take 1
            auto first = clipaudio::originalFile (c);
            if (first.existsAsFile() && first != f) c.addTake (first);
        }
        c.addTake (f);
    }

    bool loadChoices (te::WaveAudioClip& c, Comp& comp)
    {
        auto s = c.state[msComp].toString();
        if (s.isEmpty()) return false;
        comp.sectionBeats = juce::jmax (0.5, s.upToFirstOccurrenceOf ("|", false, false).getDoubleValue());
        auto parts = juce::StringArray::fromTokens (s.fromFirstOccurrenceOf ("|", false, false), ",", {});
        comp.choice.clear();
        for (auto& p : parts) comp.choice.push_back (p.getIntValue());
        return true;
    }

    void saveChoices (te::WaveAudioClip& c, const Comp& comp)
    {
        juce::StringArray parts;
        for (auto ch : comp.choice) parts.add (juce::String (ch));
        c.state.setProperty (msComp, juce::String (comp.sectionBeats) + "|" + parts.joinIntoString (","), &c.edit.getUndoManager());
    }

    static int numSections (Session& s, te::WaveAudioClip& c, const Comp& comp)
    {
        auto& ts = s.edit->tempoSequence;
        auto endBeat = ts.toBeats (c.getPosition().getEnd()).inBeats();
        return juce::jmax (1, (int) std::ceil ((endBeat - comp.clipStartBeat) / comp.sectionBeats - 1e-6));
    }

    bool prepare (Session& s, te::WaveAudioClip& c, Comp& comp, double sectionBeats)
    {
        auto& ts = s.edit->tempoSequence;
        comp.files = list (c);
        Comp saved;
        bool hasSaved = loadChoices (c, saved) && std::abs (saved.sectionBeats - sectionBeats) < 1e-6;
        comp.sectionBeats = sectionBeats;
        auto bar = s.beatsPerBar();
        auto startBeat = ts.toBeats (c.getPosition().getStart()).inBeats();
        comp.clipStartBeat = std::floor (startBeat / bar + 1e-6) * bar;
        comp.sourceStartSeconds = c.getPosition().getOffset().inSeconds();
        auto n = numSections (s, c, comp);
        comp.choice.assign ((size_t) n, juce::jmax (0, comp.files.size() - 1));
        if (hasSaved)
            for (int i = 0; i < n && i < (int) saved.choice.size(); ++i)
                comp.choice[(size_t) i] = juce::jlimit (0, comp.files.size() - 1, saved.choice[(size_t) i]);
        comp.scores.clear();
        return comp.files.size() > 0;
    }

    bool autoComp (Session& s, te::WaveAudioClip& c, Comp& comp, std::function<bool (float)> progress)
    {
        if (! prepare (s, c, comp, comp.sectionBeats)) return false;
        auto& ts = s.edit->tempoSequence;
        int n = (int) comp.choice.size(), nt = comp.files.size();
        auto clipStart = c.getPosition().getStart().inSeconds(), offset = c.getPosition().getOffset().inSeconds();
        auto clipEnd = c.getPosition().getEnd().inSeconds();
        std::vector<std::pair<double, double>> ranges;   // source seconds of each section
        std::vector<double> gridOffsets;
        for (int i = 0; i < n; ++i)
        {
            auto t0 = ts.toTime (te::BeatPosition::fromBeats (comp.sectionStartBeat (i))).inSeconds();
            auto t1 = ts.toTime (te::BeatPosition::fromBeats (comp.sectionStartBeat (i + 1))).inSeconds();
            auto a = juce::jmax (t0, clipStart), b = juce::jmin (t1, clipEnd);
            ranges.push_back ({ a - clipStart + offset, b - clipStart + offset });
            gridOffsets.push_back (a - t0);
        }
        auto sixteenth = 60.0 / ts.getBpmAt (c.getPosition().getStart()) / 4.0;
        int key = s.keyRoot();
        auto scale = s.keyIsMinor() ? vocal::Scale::minor : vocal::Scale::major;
        auto files = comp.files;
        std::vector<std::vector<vocal::SectionScore>> scores ((size_t) nt);
        bool ok = runWithProgress ("Auto Comp", [&] (std::function<bool (float)> prog)
        {
            for (int t = 0; t < nt; ++t)
            {
                juce::AudioBuffer<float> audio;
                double sr = 0;
                scores[(size_t) t].assign ((size_t) n, {});
                if (! vocal::readAudio (s.engine, files[t], audio, sr)) { for (auto& sc : scores[(size_t) t]) { sc.silent = true; sc.total = -10; } continue; }
                std::vector<float> mono;
                vocal::mixToMono (audio, mono);
                for (int i = 0; i < n; ++i)
                {
                    auto a = (int) std::round (ranges[(size_t) i].first * sr), b = (int) std::round (ranges[(size_t) i].second * sr);
                    a = juce::jlimit (0, (int) mono.size(), a);
                    b = juce::jlimit (a, (int) mono.size(), b);
                    auto expected = ranges[(size_t) i].second - ranges[(size_t) i].first;
                    if ((b - a) < expected * sr * 0.6) { auto& sc = scores[(size_t) t][(size_t) i]; sc.silent = true; sc.total = -10; continue; }
                    scores[(size_t) t][(size_t) i] = vocal::scoreSection (mono.data() + a, b - a, sr, key, scale, sixteenth, gridOffsets[(size_t) i]);
                    auto f = ((float) t + (float) (i + 1) / (float) n) / (float) nt;
                    if ((progress && ! progress (f)) || ! prog (f)) return false;
                }
            }
            return true;
        });
        if (! ok) return false;
        comp.scores = scores;

        // best path through the sections, with a small cost for changing takes
        const float switchCost = 0.06f;
        std::vector<std::vector<float>> cost ((size_t) n, std::vector<float> ((size_t) nt, 0.0f));
        std::vector<std::vector<int>> from ((size_t) n, std::vector<int> ((size_t) nt, 0));
        for (int t = 0; t < nt; ++t) cost[0][(size_t) t] = -scores[(size_t) t][0].total;
        for (int i = 1; i < n; ++i)
            for (int t = 0; t < nt; ++t)
            {
                float best = 1e9f; int arg = 0;
                for (int u = 0; u < nt; ++u)
                {
                    auto cst = cost[(size_t) i - 1][(size_t) u] + (u == t ? 0.0f : switchCost);
                    if (cst < best) { best = cst; arg = u; }
                }
                cost[(size_t) i][(size_t) t] = best - scores[(size_t) t][(size_t) i].total;
                from[(size_t) i][(size_t) t] = arg;
            }
        int t = 0;
        for (int u = 1; u < nt; ++u) if (cost[(size_t) n - 1][(size_t) u] < cost[(size_t) n - 1][(size_t) t]) t = u;
        for (int i = n - 1; i >= 0; --i)
        {
            comp.choice[(size_t) i] = t;
            t = from[(size_t) i][(size_t) t];
        }
        return true;
    }

    juce::File render (Session& s, te::WaveAudioClip& c, const Comp& comp)
    {
        if (comp.files.isEmpty() || comp.choice.empty()) return {};
        auto& ts = s.edit->tempoSequence;
        std::vector<juce::AudioBuffer<float>> audio ((size_t) comp.files.size());
        double sr = 0;
        int len = 0, chans = 1;
        for (int t = 0; t < comp.files.size(); ++t)
        {
            double r = 0;
            if (vocal::readAudio (s.engine, comp.files[t], audio[(size_t) t], r))
            {
                if (sr == 0) sr = r;
                len = juce::jmax (len, audio[(size_t) t].getNumSamples());
                chans = juce::jmax (chans, audio[(size_t) t].getNumChannels());
            }
        }
        if (sr <= 0 || len == 0) return {};
        auto clipStart = c.getPosition().getStart().inSeconds(), offset = c.getPosition().getOffset().inSeconds();
        auto get = [&] (int t, int ch, int i)
        {
            auto& b = audio[(size_t) juce::jlimit (0, (int) audio.size() - 1, t)];
            if (i < 0 || i >= b.getNumSamples() || b.getNumChannels() == 0) return 0.0f;
            return b.getSample (juce::jmin (ch, b.getNumChannels() - 1), i);
        };
        auto energy = [&] (int t, int at, int w)
        {
            double e = 0;
            for (int i = at - w / 2; i < at + w / 2; ++i) { auto x = get (t, 0, i); e += (double) x * x; }
            return e;
        };
        // section lines in samples, nudged to the quietest moment nearby
        int n = (int) comp.choice.size();
        std::vector<int> cuts;
        auto beatSec = 60.0 / ts.getBpmAt (c.getPosition().getStart());
        auto search = (int) (beatSec * 0.25 * sr), w = (int) (0.01 * sr);
        for (int i = 1; i < n; ++i)
        {
            auto t = ts.toTime (te::BeatPosition::fromBeats (comp.sectionStartBeat (i))).inSeconds();
            auto at = (int) std::round ((t - clipStart + offset) * sr);
            int a = comp.choice[(size_t) i - 1], b = comp.choice[(size_t) i];
            if (a != b)
            {
                double best = 1e30; int bestAt = at;
                for (int x = at - search; x <= at + search; x += w / 2)
                {
                    auto e = energy (a, x, w) + energy (b, x, w);
                    if (e < best) { best = e; bestAt = x; }
                }
                at = bestAt;
            }
            cuts.push_back (juce::jlimit (0, len, at));
        }
        juce::AudioBuffer<float> out (chans, len);
        out.clear();
        auto fade = juce::jmax (16, (int) (0.012 * sr));
        for (int i = 0; i < len; ++i)
        {
            // which section, and how near a cut
            int sec = (int) (std::upper_bound (cuts.begin(), cuts.end(), i) - cuts.begin());
            int t = comp.choice[(size_t) juce::jlimit (0, n - 1, sec)];
            for (int ch = 0; ch < chans; ++ch)
            {
                float v = get (t, ch, i);
                // equal-power crossfade around each cut where the take changes
                for (int k = 0; k < (int) cuts.size(); ++k)
                {
                    auto d = i - cuts[(size_t) k];
                    if (std::abs (d) >= fade) continue;
                    int a = comp.choice[(size_t) k], b = comp.choice[(size_t) k + 1];
                    if (a == b) continue;
                    auto x = (float) (d + fade) / (float) (2 * fade);
                    v = get (a, ch, i) * std::cos (x * juce::MathConstants<float>::halfPi) + get (b, ch, i) * std::sin (x * juce::MathConstants<float>::halfPi);
                }
                out.setSample (ch, i, v);
            }
        }
        auto file = clipaudio::newFile (s, c, "comp");
        if (! vocal::writeWav (file, out, sr)) return {};
        auto& um = s.edit->getUndoManager();
        um.beginNewTransaction ("Comp takes");
        saveChoices (c, comp);
        clipaudio::setSource (c, file);
        c.state.removeProperty (msTune, &um);
        return file;
    }
}

} // namespace ms
