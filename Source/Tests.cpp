#include "VocalTools.h"
#include "MotionProcessors.h"
#include "Automation.h"
#include "SongTools.h"

/* Headless checks for the vocal tools (run with --test-vocal). Each prints PASS / FAIL with the numbers. */

namespace ms
{

namespace
{
    int failures = 0;
    void check (bool ok, const juce::String& what, const juce::String& detail)
    {
        std::cout << (ok ? "PASS  " : "FAIL  ") << what << "   " << detail << std::endl;
        if (! ok) ++failures;
    }

    constexpr double sr = 48000.0;

    /** A buzzy, voice-like tone: harmonics of a gliding pitch (MIDI float per sample), with vibrato. */
    void voice (std::vector<float>& out, double start, double end, float midi, float vibratoCents, float level, double& phase)
    {
        auto a = (int) (start * sr), b = (int) (end * sr);
        if ((int) out.size() < b) out.resize ((size_t) b, 0.0f);
        for (int i = a; i < b; ++i)
        {
            auto t = (i - a) / sr;
            auto m = midi + vibratoCents / 100.0f * (float) std::sin (2.0 * juce::MathConstants<double>::pi * 5.5 * t);
            auto f = 440.0 * std::pow (2.0, (m - 69.0) / 12.0);
            phase += f / sr;
            double v = 0;
            for (int k = 1; k <= 18; ++k) v += std::sin (juce::MathConstants<double>::twoPi * phase * k) / k * (k < 4 ? 1.0 : 0.6);
            auto env = juce::jmin (1.0, juce::jmin (t / 0.03, (end - start - t) / 0.03));
            out[(size_t) i] += (float) (v * 0.35 * level * env);
        }
    }

    float medianMidi (const vocal::PitchTrack& p, double t0, double t1)
    {
        std::vector<float> v;
        for (int f = 0; f < p.frames(); ++f)
        {
            auto t = p.frameTime (f);
            if (t >= t0 && t <= t1 && p.hz[(size_t) f] > 0 && p.confidence[(size_t) f] > 0.5f) v.push_back (p.midiAt (f));
        }
        if (v.empty()) return 0;
        std::nth_element (v.begin(), v.begin() + (long) v.size() / 2, v.end());
        return v[v.size() / 2];
    }

    juce::AudioBuffer<float> toBuffer (const std::vector<float>& v, int chans = 1)
    {
        juce::AudioBuffer<float> b (chans, (int) v.size());
        for (int c = 0; c < chans; ++c) b.copyFrom (c, 0, v.data(), (int) v.size());
        return b;
    }

    float rms (const juce::AudioBuffer<float>& b, int ch, double t0, double t1)
    {
        auto a = juce::jlimit (0, b.getNumSamples(), (int) (t0 * sr)), e = juce::jlimit (a, b.getNumSamples(), (int) (t1 * sr));
        return e > a ? b.getRMSLevel (ch, a, e - a) : 0.0f;
    }

    void process (juce::AudioProcessor& p, juce::AudioBuffer<float>& b, int block = 512)
    {
        juce::MidiBuffer midi;
        for (int i = 0; i < b.getNumSamples(); i += block)
        {
            auto n = juce::jmin (block, b.getNumSamples() - i);
            juce::AudioBuffer<float> view (b.getArrayOfWritePointers(), b.getNumChannels(), i, n);
            p.processBlock (view, midi);
        }
    }

    void setParam (juce::AudioProcessor& p, const juce::String& id, float value)
    {
        for (auto* prm : p.getParameters())
            if (auto rp = dynamic_cast<juce::RangedAudioParameter*> (prm))
                if (rp->getParameterID() == id) rp->setValueNotifyingHost (rp->convertTo0to1 (value));
    }

    void drumHit (std::vector<float>& out, double t, float level)
    {
        juce::Random rnd (juce::roundToInt (t * 1000));
        auto a = (int) (t * sr);
        for (int i = 0; i < (int) (0.12 * sr); ++i)
        {
            auto k = a + i;
            if (k >= (int) out.size()) break;
            auto tt = i / sr;
            auto env = std::exp (-tt / 0.03);
            out[(size_t) k] += (float) (level * env * (0.6 * std::sin (juce::MathConstants<double>::twoPi * 90.0 * tt) + 0.4 * (rnd.nextFloat() * 2 - 1)));
        }
    }
}

/** Three sung takes of a short line in G major at 72 BPM (each a little off in different places), for the demo. */
juce::Array<juce::File> makeVocalDemoFiles (const juce::File& dir)
{
    dir.createDirectory();
    juce::Array<juce::File> files;
    const double beat = 60.0 / 72.0;
    const float melody[] = { 67, 69, 71, 74, 72, 71, 69, 67, 71, 69, 67, 66, 67 };
    const double beats[] = { 0, 1, 2, 3, 4.5, 5, 6, 7, 8, 9, 10, 11, 12 };
    const double lens[] = { 0.8, 0.8, 0.8, 1.3, 0.45, 0.8, 0.8, 0.9, 0.8, 0.8, 0.8, 0.8, 3.2 };
    juce::Random rnd (11);
    for (int take = 0; take < 3; ++take)
    {
        std::vector<float> v ((size_t) (17 * beat * sr), 0.0f);
        double ph = 0;
        for (int i = 0; i < 13; ++i)
        {
            auto off = (rnd.nextFloat() * 2 - 1) * (take == 1 && i > 6 ? 0.45f : 0.28f);   // cents off, in semitones
            auto late = (rnd.nextFloat() * 2 - 1) * 0.05;
            auto start = juce::jmax (0.0, (beats[i] + 0.0) * beat + late);
            voice (v, start, start + lens[i] * beat, melody[i] - 12 + off, 16.0f, take == 2 && i < 4 ? 0.5f : 0.85f, ph);
        }
        auto f = dir.getChildFile ("Lead Vocal take " + juce::String (take + 1) + ".wav");
        vocal::writeWav (f, toBuffer (v, 1), sr);
        files.add (f);
    }
    return files;
}

int runVocalTests (Session& session)
{
    auto dir = juce::File ("/tmp/ms-vocaltest");
    dir.deleteRecursively();
    dir.createDirectory();
    juce::Random rnd (7);

    //==============================================================================
    // 1. Tune (offline): marks the notes and moves them into C major
    {
        std::vector<float> v;
        double ph = 0;
        voice (v, 0.20, 1.00, 57.35f, 18.0f, 1.0f, ph);    // A3, 35 cents sharp
        voice (v, 1.15, 1.95, 63.60f, 18.0f, 1.0f, ph);    // E4, 40 cents flat
        voice (v, 2.10, 2.90, 67.25f, 18.0f, 1.0f, ph);    // G4, 25 cents sharp
        v.resize ((size_t) (3.2 * sr), 0.0f);
        auto pt = vocal::analysePitch (v.data(), (int) v.size(), sr);
        auto notes = vocal::segmentNotes (pt, 0, vocal::Scale::major);
        juce::String found;
        for (auto& n : notes) found << vocal::noteName (n.target) << "(" << juce::String (n.pitch, 2) << ") ";
        check (notes.size() == 3, "Tune marks every note", juce::String ((int) notes.size()) + " notes: " + found);
        if (notes.size() == 3)
        {
            check (notes[0].target == 57 && notes[1].target == 64 && notes[2].target == 67, "Tune picks the notes in the key", found);
            notes[2].target = 69; notes[2].userSet = true;          // "Make it" A4
            auto curve = vocal::shiftCurve (pt, notes, 0.6f, 50.0f);
            auto in = toBuffer (v);
            juce::AudioBuffer<float> out;
            vocal::psolaRender (in, out, pt, curve);
            std::vector<float> mono;
            vocal::mixToMono (out, mono);
            auto po = vocal::analysePitch (mono.data(), (int) mono.size(), sr);
            float m0 = medianMidi (po, 0.4, 0.8), m1 = medianMidi (po, 1.35, 1.75), m2 = medianMidi (po, 2.3, 2.7);
            check (std::abs (m0 - 57) < 0.12f && std::abs (m1 - 64) < 0.12f, "Tuned notes land on the key",
                   "A3 " + juce::String ((m0 - 57) * 100, 1) + "c, E4 " + juce::String ((m1 - 64) * 100, 1) + "c");
            check (std::abs (m2 - 69) < 0.12f, "Right-click \"Make it\" moves a note to the chosen note", "G4 -> A4: " + juce::String (m2, 2));
            check (out.getMagnitude (0, 0, out.getNumSamples()) < 1.5f && rms (out, 0, 0.4, 0.8) > rms (in, 0, 0.4, 0.8) * 0.7f,
                   "Tuned audio keeps its level", juce::String (rms (out, 0, 0.4, 0.8) / rms (in, 0, 0.4, 0.8), 2));
        }

        // 2. Motion Tune (real time)
        auto tuneP = createMotionPlugin ("motion:tune");
        tuneP->setPlayConfigDetails (2, 2, sr, 256);
        tuneP->prepareToPlay (sr, 256);
        setParam (*tuneP, "speed", 0.0f);
        setParam (*tuneP, "humanize", 0.0f);
        auto rt = toBuffer (v, 2);
        process (*tuneP, rt, 256);
        auto lat = tuneP->getLatencySamples() / sr;
        std::vector<float> mono;
        vocal::mixToMono (rt, mono);
        auto pr = vocal::analysePitch (mono.data(), (int) mono.size(), sr);
        float r0 = medianMidi (pr, 0.45 + lat, 0.9 + lat), r1 = medianMidi (pr, 1.4 + lat, 1.85 + lat);
        check (std::abs (r0 - 57) < 0.15f && std::abs (r1 - 64) < 0.15f, "Motion Tune corrects live",
               "latency " + juce::String (lat * 1000, 1) + " ms, A3 " + juce::String ((r0 - 57) * 100, 1) + "c, E4 " + juce::String ((r1 - 64) * 100, 1) + "c");
    }

    //==============================================================================
    // 3. Denoise
    {
        auto p = createMotionPlugin ("motion:denoise");
        p->setPlayConfigDetails (2, 2, sr, 512);
        p->prepareToPlay (sr, 512);
        int n = (int) (6.0 * sr);
        juce::AudioBuffer<float> b (2, n), clean (2, n);
        clean.clear();
        for (int i = 0; i < n; ++i)
        {
            auto t = i / sr;
            float s = t > 3.0 ? 0.25f * (float) std::sin (juce::MathConstants<double>::twoPi * 440.0 * t) : 0.0f;
            for (int c = 0; c < 2; ++c) { clean.setSample (c, i, s); b.setSample (c, i, s + 0.006f * (rnd.nextFloat() * 2 - 1)); }
        }
        auto inNoise = rms (b, 0, 1.0, 2.8);
        process (*p, b);
        auto lat = p->getLatencySamples() / sr;
        auto outNoise = rms (b, 0, 1.0 + lat, 2.8 + lat);
        auto outSig = rms (b, 0, 4.0 + lat, 5.8 + lat), inSig = rms (clean, 0, 4.0, 5.8);
        check (gainToDb (outNoise / inNoise) < -12.0f, "Denoise removes background hiss", juce::String (gainToDb (outNoise / inNoise), 1) + " dB");
        check (std::abs (gainToDb (outSig / inSig)) < 1.0f, "Denoise keeps the voice", juce::String (gainToDb (outSig / inSig), 2) + " dB");

        // reduction at 0 dB passes the audio straight through
        auto q = createMotionPlugin ("motion:denoise");
        q->setPlayConfigDetails (2, 2, sr, 512);
        q->prepareToPlay (sr, 512);
        setParam (*q, "reduction", 0.0f);
        juce::AudioBuffer<float> x (2, (int) sr), ref (2, (int) sr);
        for (int i = 0; i < x.getNumSamples(); ++i) for (int c = 0; c < 2; ++c) { auto s = rnd.nextFloat() * 0.5f - 0.25f; x.setSample (c, i, s); ref.setSample (c, i, s); }
        process (*q, x);
        double err = 0, e = 0;
        int L = q->getLatencySamples();
        for (int i = L + 4096; i < x.getNumSamples(); ++i) { auto d = x.getSample (0, i) - ref.getSample (0, i - L); err += d * d; e += ref.getSample (0, i - L) * ref.getSample (0, i - L); }
        check (err / e < 1e-4, "Denoise at 0 dB is transparent", "error " + juce::String (10 * std::log10 (err / e + 1e-20), 1) + " dB");
    }

    //==============================================================================
    // 4. De-esser
    {
        auto p = createMotionPlugin ("motion:deesser");
        p->setPlayConfigDetails (2, 2, sr, 512);
        p->prepareToPlay (sr, 512);
        std::vector<float> v;
        double ph = 0;
        voice (v, 0.0, 3.0, 50.0f, 10.0f, 0.8f, ph);
        // harsh "s" bursts: noise band-passed around 7 kHz
        juce::dsp::IIR::Filter<float> bp;
        bp.coefficients = juce::dsp::IIR::Coefficients<float>::makeBandPass (sr, 7000.0, 1.5);
        for (int i = 0; i < (int) v.size(); ++i)
        {
            auto t = i / sr;
            auto s = bp.processSample (rnd.nextFloat() * 2 - 1);
            if ((t > 1.0 && t < 1.3) || (t > 2.0 && t < 2.3)) v[(size_t) i] += s * 1.2f;
        }
        auto in = toBuffer (v, 2), out = toBuffer (v, 2);
        process (*p, out);
        auto lat = p->getLatencySamples() / sr;
        auto band = [&] (juce::AudioBuffer<float>& b, bool high, double t0, double t1, double shift)
        {
            juce::dsp::IIR::Filter<float> f;
            f.coefficients = high ? juce::dsp::IIR::Coefficients<float>::makeHighPass (sr, 5000.0) : juce::dsp::IIR::Coefficients<float>::makeLowPass (sr, 2000.0);
            double e = 0; int cnt = 0;
            for (int i = 0; i < b.getNumSamples(); ++i)
            {
                auto y = f.processSample (b.getSample (0, i));
                auto t = i / sr - shift;
                if (t >= t0 && t < t1) { e += y * y; ++cnt; }
            }
            return (float) std::sqrt (e / juce::jmax (1, cnt));
        };
        auto sIn = band (in, true, 1.05, 1.25, 0), sOut = band (out, true, 1.05, 1.25, lat);
        auto vIn = band (in, false, 0.3, 0.9, 0), vOut = band (out, false, 0.3, 0.9, lat);
        check (gainToDb (sOut / sIn) < -4.0f, "De-esser turns the S down", juce::String (gainToDb (sOut / sIn), 1) + " dB on the S");
        check (std::abs (gainToDb (vOut / vIn)) < 0.5f, "De-esser leaves the voice alone", juce::String (gainToDb (vOut / vIn), 2) + " dB on the voice");
    }

    //==============================================================================
    // 5. Sidechain ducker
    {
        auto p = createMotionPlugin ("motion:ducker");
        p->enableAllBuses();
        p->setRateAndBufferSizeDetails (sr, 512);
        p->prepareToPlay (sr, 512);
        int n = (int) (3.0 * sr);
        juce::AudioBuffer<float> b (4, n);
        b.clear();
        std::vector<float> kick ((size_t) n, 0.0f);
        for (double t = 0.5; t < 3.0; t += 0.5) drumHit (kick, t, 0.9f);
        for (int i = 0; i < n; ++i)
        {
            auto s = 0.3f * (float) std::sin (juce::MathConstants<double>::twoPi * 220.0 * i / sr);
            b.setSample (0, i, s); b.setSample (1, i, s);
            b.setSample (2, i, kick[(size_t) i]); b.setSample (3, i, kick[(size_t) i]);
        }
        if (std::getenv ("MS_DEBUG")) std::cout << "   ducker ins " << p->getTotalNumInputChannels() << " main " << p->getMainBusNumInputChannels() << " buses " << p->getBusCount (true) << std::endl;
        process (*p, b);
        auto onKick = rms (b, 0, 1.01, 1.04), between = rms (b, 0, 1.40, 1.48), dry = 0.3f / std::sqrt (2.0f);
        check (gainToDb (onKick / dry) < -6.0f && gainToDb (between / dry) > -2.0f, "Sidechain ducks on the kick and comes back",
               juce::String (gainToDb (onKick / dry), 1) + " dB on the kick, " + juce::String (gainToDb (between / dry), 1) + " dB between");
    }

    //==============================================================================
    // 6. Auto Time on audio and MIDI (in a song at 120 BPM)
    {
        session.newSong (120.0, 0, false);
        auto track = session.addTrack (TrackKind::audio, "Drums");
        std::vector<float> d ((size_t) (9.0 * sr), 0.0f);
        std::vector<double> truth;
        for (int k = 0; k < 28; ++k)
        {
            auto t = 0.5 + k * 0.25 + (rnd.nextFloat() * 2 - 1) * 0.035;
            truth.push_back (t);
            drumHit (d, t, 0.8f);
        }
        auto onsets = vocal::detectOnsets (d.data(), (int) d.size(), sr, vocal::OnsetStyle::drums);
        double worst = 0; int matched = 0;
        for (auto t : truth)
        {
            double best = 1;
            for (auto o : onsets) best = juce::jmin (best, std::abs (o - t));
            if (best < 0.02) { ++matched; worst = juce::jmax (worst, best); }
        }
        check (matched == (int) truth.size() && onsets.size() == truth.size(), "Hits are found in audio",
               juce::String (matched) + "/" + juce::String ((int) truth.size()) + " (found " + juce::String ((int) onsets.size()) + "), worst " + juce::String (worst * 1000, 1) + " ms");

        auto f = dir.getChildFile ("drums.wav");
        vocal::writeWav (f, toBuffer (d, 2), sr);
        auto clip = session.addAudioFile (*track, f, te::TimePosition());
        if (auto wc = dynamic_cast<te::WaveAudioClip*> (clip.get()))
        {
            autotime::Options o;
            o.instrument = autotime::Instrument::drums;
            auto r = autotime::apply (session, *wc, o);
            check (r.ok && std::abs (r.grid - 0.5) < 1e-6, "Auto Time (drums) finds the grid", r.message);
            juce::AudioBuffer<float> outB;
            double osr = 0;
            vocal::readAudio (session.engine, clipaudio::sourceFile (*wc), outB, osr);
            std::vector<float> mono;
            vocal::mixToMono (outB, mono);
            auto after = vocal::detectOnsets (mono.data(), (int) mono.size(), osr, vocal::OnsetStyle::drums);
            double maxErr = 0;
            for (auto t : after)
            {
                maxErr = juce::jmax (maxErr, std::abs (t - std::round (t / 0.25) * 0.25));
                if (std::getenv ("MS_DEBUG") && std::abs (t - std::round (t / 0.25) * 0.25) > 0.006) std::cout << "   off-grid hit at " << t << std::endl;
            }
            double before = 0;
            for (auto t : truth) before = juce::jmax (before, std::abs (t - std::round (t / 0.25) * 0.25));
            check (after.size() == truth.size() && maxErr < 0.006, "Auto Time puts audio hits on the beat",
                   "worst " + juce::String (before * 1000, 1) + " ms before, " + juce::String (maxErr * 1000, 1) + " ms after ("
                   + juce::String ((int) after.size()) + " hits)");
            check (clipaudio::hasProcessing (*wc) && clipaudio::originalFile (*wc) == f, "The original audio is kept", clipaudio::originalFile (*wc).getFileName());
        }

        // a vocal, sung a little ahead and behind
        {
            auto vt = session.addTrack (TrackKind::audio, "Lead Vocal");
            std::vector<float> v ((size_t) (7.0 * sr), 0.0f);
            double ph = 0;
            std::vector<double> sung;
            for (int k = 0; k < 10; ++k)
            {
                auto t = 1.0 + k * 0.5 + (k % 2 == 0 ? 1 : -1) * (0.02 + 0.004 * k);
                sung.push_back (t);
                voice (v, t, t + 0.36, (float) (60 + (k % 3) * 2), 12.0f, 0.9f, ph);
            }
            auto vf = dir.getChildFile ("vocal.wav");
            vocal::writeWav (vf, toBuffer (v, 1), sr);
            auto vclip = session.addAudioFile (*vt, vf, te::TimePosition());
            if (auto vw = dynamic_cast<te::WaveAudioClip*> (vclip.get()))
            {
                autotime::Options vo;
                vo.instrument = autotime::guessInstrument (vt.get());
                vo.strength = 1.0f;
                auto r = autotime::apply (session, *vw, vo);
                juce::AudioBuffer<float> outB;
                double osr = 0;
                vocal::readAudio (session.engine, clipaudio::sourceFile (*vw), outB, osr);
                std::vector<float> mono;
                vocal::mixToMono (outB, mono);
                auto after = vocal::detectOnsets (mono.data(), (int) mono.size(), osr, vocal::OnsetStyle::vocal);
                double maxErr = 0, before = 0;
                for (auto t : after) maxErr = juce::jmax (maxErr, std::abs (t - std::round (t / 0.5) * 0.5));
                for (auto t : sung) before = juce::jmax (before, std::abs (t - std::round (t / 0.5) * 0.5));
                auto po = vocal::analysePitch (mono.data(), (int) mono.size(), osr);
                auto m = medianMidi (po, 1.6, 1.8);   // the 2nd note (62), now starting at 1.5 s
                check (vo.instrument == autotime::Instrument::vocals && r.ok && after.size() == sung.size() && maxErr < 0.012 && std::abs (m - 62) < 0.1f,
                       "Auto Time (vocals) moves words onto the beat and keeps the pitch",
                       "worst " + juce::String (before * 1000, 1) + " ms before, " + juce::String (maxErr * 1000, 1) + " ms after, "
                       + juce::String ((int) after.size()) + " words, pitch " + juce::String (m, 2) + " | " + r.message);
            }
        }

        // MIDI keys, played loose
        auto keys = session.addTrack (TrackKind::instrument, "Keys");
        auto mc = session.addMidiClip (*keys, te::TimePosition(), te::BeatDuration::fromBeats (8));
        for (int k = 0; k < 16; ++k)
        {
            auto beat = k * 0.5 + (rnd.nextFloat() * 2 - 1) * 0.09;
            mc->getSequence().addNote (60 + (k % 5), te::BeatPosition::fromBeats (juce::jmax (0.0, beat)), te::BeatDuration::fromBeats (0.4), 100, 0, nullptr);
        }
        autotime::Options o;
        o.instrument = autotime::Instrument::keys;
        o.strength = 1.0f;
        auto r = autotime::apply (session, *mc, o);
        double worstM = 0;
        for (auto n : mc->getSequence().getNotes()) { auto b = n->getStartBeat().inBeats(); worstM = juce::jmax (worstM, std::abs (b - std::round (b / 0.5) * 0.5)); }
        check (r.ok && worstM < 1e-6 && std::abs (r.grid - 0.5) < 1e-6, "Auto Time (MIDI) lines up notes", r.message);
    }

    //==============================================================================
    // 7. Takes and Auto Comp: three passes, each good in different bars
    {
        session.newSong (120.0, 0, false);
        auto track = session.addTrack (TrackKind::audio, "Vocal");
        // bar = 2 s. good[take][bar]
        const bool good[3][4] = { { true, false, false, true }, { false, true, false, false }, { false, false, true, false } };
        juce::Array<juce::File> files;
        for (int t = 0; t < 3; ++t)
        {
            std::vector<float> v ((size_t) (8.0 * sr), 0.0f);
            double ph = 0;
            for (int bar = 0; bar < 4; ++bar)
            {
                if (t == 1 && bar == 0) continue;     // missed the first line
                const float notes[] = { 60, 62, 67, 65 };
                for (int k = 0; k < 2; ++k)
                    voice (v, bar * 2.0 + k * 1.0 + 0.05, bar * 2.0 + k * 1.0 + 0.9, notes[bar] + (k == 1 ? 2.0f : 0.0f) + (good[t][bar] ? 0.02f : 0.42f), 8.0f, 0.9f, ph);
            }
            auto f = dir.getChildFile ("take " + juce::String (t + 1) + ".wav");
            vocal::writeWav (f, toBuffer (v, 1), sr);
            files.add (f);
        }
        auto clip = session.addAudioFile (*track, files[2], te::TimePosition());
        auto wc = dynamic_cast<te::WaveAudioClip*> (clip.get());
        if (wc != nullptr)
        {
            for (auto& f : files) takes::addTake (*wc, f);
            auto list = takes::list (*wc);
            check (list.size() == 3, "Takes are kept on the clip", juce::String (list.size()) + " takes");
            takes::Comp comp;
            comp.sectionBeats = 4.0;
            bool ok = takes::autoComp (session, *wc, comp);
            juce::String picks;
            std::vector<int> picked;
            for (auto c : comp.choice) { picked.push_back (files.indexOf (comp.files[c])); picks << (picked.back() + 1) << " "; }
            check (ok && picked == std::vector<int> { 0, 1, 2, 0 },
                   "Auto Comp picks the best take for each bar", "takes " + picks + "(expected 1 2 3 1)");
            auto out = takes::render (session, *wc, comp);
            juce::AudioBuffer<float> cb, tb;
            double r1 = 0, r2 = 0;
            vocal::readAudio (session.engine, out, cb, r1);
            vocal::readAudio (session.engine, files[1], tb, r2);
            double diff = 0;
            for (int i = (int) (2.5 * sr); i < (int) (3.5 * sr); ++i) diff = juce::jmax (diff, (double) std::abs (cb.getSample (0, i) - tb.getSample (0, i)));
            check (out.existsAsFile() && clipaudio::sourceFile (*wc) == out && diff < 1e-3, "The comp plays the chosen take in each bar",
                   out.getFileName() + ", bar 2 matches take 2 (max diff " + juce::String (diff, 5) + ")");
        }
    }

    //==============================================================================
    // 8. In the engine: sidechain from another track, and volume automation, rendered
    {
        session.newSong (120.0, 0, false);
        for (auto t : session.tracks()) session.deleteTrack (*t);
        auto kickT = session.addTrack (TrackKind::audio, "Kick");
        auto padT = session.addTrack (TrackKind::audio, "Pad");
        int n = (int) (6.0 * sr);
        std::vector<float> kick ((size_t) n, 0.0f), pad ((size_t) n, 0.0f);
        for (double t = 0.5; t < 6.0; t += 0.5)
            for (int i = 0; i < (int) (0.15 * sr); ++i)
            {
                auto k = (int) (t * sr) + i;
                if (k < n) kick[(size_t) k] += 0.8f * (float) (std::exp (-i / (0.05 * sr)) * std::sin (juce::MathConstants<double>::twoPi * 45.0 * i / sr));
            }
        for (int i = 0; i < n; ++i) pad[(size_t) i] = 0.25f * (float) std::sin (juce::MathConstants<double>::twoPi * 1000.0 * i / sr);
        auto kf = dir.getChildFile ("kick.wav"), pf = dir.getChildFile ("pad.wav");
        vocal::writeWav (kf, toBuffer (kick, 2), sr);
        vocal::writeWav (pf, toBuffer (pad, 2), sr);
        session.addAudioFile (*kickT, kf, te::TimePosition());
        session.addAudioFile (*padT, pf, te::TimePosition());
        auto ducker = session.insertPlugin (*padT, describeMotionPlugin (*findMotionPlugin ("motion:ducker")));
        for (int i = 0; i < 10; ++i) juce::MessageManager::getInstance()->runDispatchLoopUntil (20);
        bool can = ducker != nullptr && ducker->canSidechain();
        juce::String srcName;
        if (can)
        {
            for (auto& nm : ducker->getSidechainSourceNames (false)) if (nm.endsWith ("Kick")) srcName = nm;
            ducker->setSidechainSourceByName (srcName);
            if (ducker->getNumWires() == 0) ducker->guessSidechainRouting();
        }
        check (can && sidechainSource (*ducker) == "Kick", "Sidechain can be fed from another track",
               "source \"" + sidechainSource (*ducker) + "\", wires " + juce::String (ducker != nullptr ? ducker->getNumWires() : 0));

        // volume automation on the pad: full for 2 s, then down 20 dB by 4 s (after the ducker, so both show)
        auto vp = padT->getVolumePlugin();
        auto& curve = vp->volParam->getCurve();
        auto full = te::decibelsToVolumeFaderPosition (0.0f), low = te::decibelsToVolumeFaderPosition (-20.0f);
        curve.addPoint (te::TimePosition::fromSeconds (2.0), full, 0.0f, nullptr);
        curve.addPoint (te::TimePosition::fromSeconds (4.0), low, 0.0f, nullptr);

        auto& edit = *session.edit;
        te::Renderer::Parameters prm (edit);
        prm.destFile = dir.getChildFile ("mix.wav");
        prm.audioFormat = session.engine.getAudioFileFormatManager().getWavFormat();
        prm.bitDepth = 24;
        prm.sampleRateForAudio = sr;
        prm.blockSizeForAudio = 512;
        prm.time = te::TimeRange (te::TimePosition(), te::TimePosition::fromSeconds (6.0));
        prm.useMasterPlugins = false;
        prm.tracksToDo = te::toBitSet (te::getAllTracks (edit));
        prm.canRenderInMono = false;
        prm.checkNodesForAudio = false;
        auto mixFile = te::Renderer::renderToFile ("Test", prm);
        juce::AudioBuffer<float> mix;
        double msr = 0;
        bool got = vocal::readAudio (session.engine, mixFile, mix, msr);
        // the pad on its own: a narrow band at 1 kHz (the kick is down at 45 Hz)
        auto padLevel = [&] (double t0, double t1)
        {
            juce::dsp::IIR::Filter<float> f;
            f.coefficients = juce::dsp::IIR::Coefficients<float>::makeBandPass (msr, 1000.0, 4.0);
            double e = 0; int cnt = 0;
            for (int i = 0; i < mix.getNumSamples(); ++i)
            {
                auto y = f.processSample (mix.getSample (0, i));
                auto t = i / msr;
                if (t >= t0 && t < t1) { e += y * y; ++cnt; }
            }
            return (float) std::sqrt (e / juce::jmax (1, cnt));
        };
        if (got)
        {
            auto onKick = padLevel (1.02, 1.06), between = padLevel (1.36, 1.46);
            check (gainToDb (onKick / between) < -5.0f, "Ducker on the pad ducks under the kick (rendered)",
                   juce::String (gainToDb (onKick / between), 1) + " dB on the kick");
            auto early = padLevel (1.36, 1.46), late = padLevel (5.36, 5.46);
            check (std::abs (gainToDb (late / early) + 20.0f) < 1.5f, "Volume automation plays back (rendered)",
                   juce::String (gainToDb (late / early), 1) + " dB after the fade (expected -20)");
        }
        else check (false, "Render", "couldn't read " + mixFile.getFullPathName());

        // Motion Tune follows the song's key when it's inserted and when the key changes
        auto vt = session.addTrack (TrackKind::audio, "Vocal");
        session.setSongKey (12 + 9);   // A minor
        auto tunePl = session.insertPlugin (*vt, describeMotionPlugin (*findMotionPlugin ("motion:tune")));
        for (int i = 0; i < 10; ++i) juce::MessageManager::getInstance()->runDispatchLoopUntil (20);
        session.syncTuneKeys();
        juce::String keyText;
        if (auto ext = dynamic_cast<te::ExternalPlugin*> (tunePl.get()))
            if (auto pi = ext->getAudioPluginInstance())
                for (auto* prm2 : pi->getParameters())
                    if (auto rp = dynamic_cast<juce::RangedAudioParameter*> (prm2))
                        if (rp->getParameterID() == "key" || rp->getParameterID() == "scale") keyText << rp->getCurrentValueAsText() << " ";
        check (keyText.trim() == "A Minor", "Motion Tune follows the song key", keyText);
    }

    //==============================================================================
    // 9. Loudness and Motion Master
    {
        // EBU Tech 3341 case 1: a stereo 1 kHz sine at -23 dBFS reads -23 LUFS
        int n = (int) (20.0 * sr);
        juce::AudioBuffer<float> b (2, n);
        auto a = juce::Decibels::decibelsToGain (-23.0f);
        for (int i = 0; i < n; ++i) { auto v = a * (float) std::sin (juce::MathConstants<double>::twoPi * 1000.0 * i / sr); b.setSample (0, i, v); b.setSample (1, i, v); }
        auto rep = measureLoudness (b, sr);
        check (std::abs (rep.integrated + 23.0f) < 0.15f && std::abs (rep.shortMax + 23.0f) < 0.2f, "Loudness meter reads the EBU test tone",
               juce::String (rep.integrated, 2) + " LUFS integrated, " + juce::String (rep.shortMax, 2) + " short-term (expected -23)");
        // a hot mix through Motion Master stays under its ceiling, true peak included
        auto p = createMotionPlugin ("motion:master");
        p->setPlayConfigDetails (2, 2, sr, 512);
        p->prepareToPlay (sr, 512);
        setParam (*p, "input", 12.0f);
        juce::AudioBuffer<float> x (2, (int) (6.0 * sr));
        std::vector<float> d ((size_t) x.getNumSamples(), 0.0f);
        for (double t = 0.1; t < 6.0; t += 0.25) drumHit (d, t, 0.9f);
        for (int i = 0; i < x.getNumSamples(); ++i)
        {
            auto v = d[(size_t) i] + 0.3f * (float) std::sin (juce::MathConstants<double>::twoPi * 110.0 * i / sr);
            x.setSample (0, i, v); x.setSample (1, i, v);
        }
        process (*p, x);
        auto out = measureLoudness (x, sr);
        float samplePeak = juce::jmax (x.getMagnitude (0, 0, x.getNumSamples()), x.getMagnitude (1, 0, x.getNumSamples()));
        check (gainToDb (samplePeak) <= -0.99f && out.truePeak <= -0.7f, "Motion Master holds the ceiling",
               "sample peak " + juce::String (gainToDb (samplePeak), 2) + " dBFS, true peak " + juce::String (out.truePeak, 2) + " dBTP (ceiling -1)");
        if (auto src = dynamic_cast<LoudnessSource*> (p.get()))
            check (std::abs (src->loudness().integrated() - out.integrated) < 0.5f && src->gainReductionDb() >= 0.0f, "Motion Master meters what it outputs",
                   juce::String (src->loudness().integrated(), 1) + " LUFS in the plugin vs " + juce::String (out.integrated, 1) + " measured");
    }

    //==============================================================================
    // 10. Key and tempo: stretching and shifting audio, and moving a whole song
    {
        // a click train at 120 BPM stretched to 96 BPM lands on the new beats; a 440 Hz tone up 2 semitones
        std::vector<float> clicks ((size_t) (8.0 * sr), 0.0f);
        for (double t = 0.5; t < 7.5; t += 0.5) drumHit (clicks, t, 0.8f);
        auto cf = dir.getChildFile ("clicks.wav"), cs = dir.getChildFile ("clicks slow.wav");
        vocal::writeWav (cf, toBuffer (clicks, 2), sr);
        bool ok = song::stretchFile (session.engine, cf, cs, 1.25, 0.0f);
        juce::AudioBuffer<float> sb; double ssr = 0;
        vocal::readAudio (session.engine, cs, sb, ssr);
        std::vector<float> mono; vocal::mixToMono (sb, mono);
        auto on = vocal::detectOnsets (mono.data(), (int) mono.size(), ssr, vocal::OnsetStyle::drums);
        auto before = vocal::detectOnsets (clicks.data(), (int) clicks.size(), sr, vocal::OnsetStyle::drums);
        double worst = 0;
        for (auto o : before)
        {
            double best = 1;
            for (auto t : on) best = juce::jmin (best, std::abs (t - o * 1.25));
            worst = juce::jmax (worst, best);
        }
        check (ok && std::abs (sb.getNumSamples() / ssr - 10.0) < 0.01 && on.size() == before.size() && worst < 0.006, "Audio stretched to a new tempo stays on the beat",
               juce::String (sb.getNumSamples() / ssr, 2) + " s long (10 expected), " + juce::String ((int) on.size()) + " hits (" + juce::String ((int) before.size())
               + " before), worst " + juce::String (worst * 1000, 1) + " ms off the new beat");
        std::vector<float> tone ((size_t) (3.0 * sr));
        for (size_t i = 0; i < tone.size(); ++i) tone[i] = 0.4f * (float) std::sin (juce::MathConstants<double>::twoPi * 440.0 * (double) i / sr);
        auto tf = dir.getChildFile ("tone.wav"), tu = dir.getChildFile ("tone up.wav");
        vocal::writeWav (tf, toBuffer (tone, 1), sr);
        song::stretchFile (session.engine, tf, tu, 1.0, 2.0f);
        juce::AudioBuffer<float> tb; double tsr = 0;
        vocal::readAudio (session.engine, tu, tb, tsr);
        vocal::mixToMono (tb, mono);
        auto pt = vocal::analysePitch (mono.data(), (int) mono.size(), tsr);
        auto m = medianMidi (pt, 0.5, 2.5);
        check (std::abs (m - 71.0f) < 0.1f && std::abs (tb.getNumSamples() / tsr - 3.0) < 0.01, "Audio pitch-shifted 2 semitones keeps its length",
               "A4 -> " + juce::String (m, 2) + " (71 = B4), " + juce::String (tb.getNumSamples() / tsr, 2) + " s");

        // a whole song: C at 120 -> D at 100
        session.newSong (120.0, 0, false);
        for (auto t : session.tracks()) session.deleteTrack (*t);
        auto keys = session.addTrack (TrackKind::instrument, "Keys");
        auto mc = session.addMidiClip (*keys, session.edit->tempoSequence.toTime (te::BeatPosition::fromBeats (4)), te::BeatDuration::fromBeats (4));
        mc->getSequence().addNote (60, te::BeatPosition::fromBeats (0), te::BeatDuration::fromBeats (1), 100, 0, nullptr);
        auto drums = session.addTrack (TrackKind::audio, "Drums");
        auto dclip = session.addAudioFile (*drums, cf, te::TimePosition());
        auto vox = session.addTrack (TrackKind::audio, "Lead Vocal");
        std::vector<float> v; double ph = 0;
        voice (v, 0.0, 4.0, 57.0f, 0.0f, 0.8f, ph);
        auto vf = dir.getChildFile ("song vocal.wav");
        vocal::writeWav (vf, toBuffer (v, 1), sr);
        auto vclip = session.addAudioFile (*vox, vf, te::TimePosition());
        song::addSection (session, 0, "Intro");
        song::addSection (session, 8, "Chorus");
        auto& c = vox->getVolumePlugin()->volParam->getCurve();
        c.addPoint (session.edit->tempoSequence.toTime (te::BeatPosition::fromBeats (8)), 0.5f, 0.0f, nullptr);
        auto r = song::changeKeyAndTempo (session, 2, 100.0, true);
        auto& ts = session.edit->tempoSequence;
        auto secs = song::sections (session);
        auto dw = dynamic_cast<te::WaveAudioClip*> (dclip.get()), vw = dynamic_cast<te::WaveAudioClip*> (vclip.get());
        bool placed = std::abs (mc->getPosition().getStart().inSeconds() - 2.4) < 1e-3 && secs.size() == 2 && std::abs (secs[1].clip->getPosition().getStart().inSeconds() - 4.8) < 1e-3
                      && std::abs (c.getPointTime (0).inSeconds() - 4.8) < 1e-3;
        check (r.ok && std::abs (ts.getTempo (0)->getBpm() - 100.0) < 1e-6 && session.songKey == 2 && placed, "Changing the song's tempo keeps everything on its beat",
               r.message + " MIDI at " + juce::String (mc->getPosition().getStart().inSeconds(), 3) + " s, chorus at " + (secs.size() > 1 ? juce::String (secs[1].clip->getPosition().getStart().inSeconds(), 3) : juce::String ("?")) + " s");
        int note = mc->getSequence().getNotes().isEmpty() ? 0 : mc->getSequence().getNotes()[0]->getNoteNumber();
        juce::AudioBuffer<float> vb; double vsr = 0;
        vocal::readAudio (session.engine, clipaudio::sourceFile (*vw), vb, vsr);
        vocal::mixToMono (vb, mono);
        auto vp = vocal::analysePitch (mono.data(), (int) mono.size(), vsr);
        auto vm = medianMidi (vp, 1.0, 4.0);
        juce::AudioBuffer<float> db; double dsr = 0;
        vocal::readAudio (session.engine, clipaudio::sourceFile (*dw), db, dsr);
        check (note == 62 && std::abs (vm - 59.0f) < 0.1f && std::abs (vb.getNumSamples() / vsr - 4.8) < 0.02 && std::abs (db.getNumSamples() / dsr - 9.6) < 0.02,
               "Changing the key moves MIDI and audio, not the drums",
               "MIDI C -> " + juce::String (note) + ", vocal A2 -> " + juce::String (vm, 2) + " over " + juce::String (vb.getNumSamples() / vsr, 2) + " s, drums " + juce::String (db.getNumSamples() / dsr, 2) + " s");

        // 11. Export for Central Pedal
        song::ExportOptions eo;
        eo.title = "Test Song";
        eo.folder = dir.getChildFile ("export");
        eo.folder.createDirectory();
        eo.zip = false;
        auto ex = song::exportPack (session, eo);
        auto folder = ex.output;
        bool names = folder.getFileName() == "Test Song - 100bpm - D";
        juce::StringArray want { "Keys.wav", "Drums.wav", "Vocals.wav", "Full Mix.wav", "Click.wav", "Guide.wav", "Markers.mid" };
        juce::StringArray missing;
        for (auto& w : want) if (! folder.getChildFile (w).existsAsFile()) missing.add (w);
        check (ex.ok && names && missing.isEmpty(), "Export makes a Central Pedal track pack", folder.getFileName() + " | " + ex.files.joinIntoString (", ") + (missing.isEmpty() ? juce::String() : " | missing " + missing.joinIntoString (",")));
        juce::MidiFile mf;
        juce::FileInputStream mi (folder.getChildFile ("Markers.mid"));
        juce::StringArray marks;
        if (mi.openedOk() && mf.readFrom (mi))
            for (int t = 0; t < mf.getNumTracks(); ++t)
                for (auto* e : *mf.getTrack (t))
                    if (e->message.isTextMetaEvent() && e->message.getMetaEventType() == 6) marks.add (e->message.getTextFromTextMetaEvent() + "@" + juce::String (e->message.getTimeStamp() / 960.0));
        check (marks.joinIntoString (",") == "Intro@0,Chorus@8", "The sections go in as MIDI markers", marks.joinIntoString (","));
        juce::AudioBuffer<float> gb; double gsr = 0;
        vocal::readAudio (session.engine, folder.getChildFile ("Guide.wav"), gb, gsr);
        auto rmsAt = [&] (double t0, double t1) { auto a = (int) (t0 * gsr), e = juce::jmin (gb.getNumSamples(), (int) (t1 * gsr)); return e > a ? gb.getRMSLevel (0, a, e - a) : 0.0f; };
        auto spoken = rmsAt (2.4, 3.0), quietBefore = rmsAt (0.0, 2.38);
        check (spoken > 0.01f && quietBefore < 1e-4f, "The guide says \"Chorus\" one bar before the chorus", "level " + juce::String (spoken, 3) + " at 2.4 s, " + juce::String (quietBefore, 5) + " before");
        check (ex.grade.stars >= 4, "Central Tracks grade estimate", juce::String (ex.grade.stars) + " stars | " + ex.grade.lines.joinIntoString (" ; ") + " | "
               + juce::String (ex.grade.loudness.integrated, 1) + " LUFS");
    }

    std::cout << (failures == 0 ? "ALL VOCAL TESTS PASSED" : juce::String (failures) + " FAILED") << std::endl;
    return failures;
}

} // namespace ms
