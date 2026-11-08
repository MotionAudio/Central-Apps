#include "MotionPlugins.h"
#include "MotionProcessors.h"
#include "Theme.h"

namespace ms
{

//==============================================================================
juce::File userFolder()
{
    auto f = juce::File::getSpecialLocation (juce::File::userMusicDirectory).getChildFile ("Motion Studio");
    f.createDirectory();
    return f;
}
juce::File soundsFolder()       { auto f = userFolder().getChildFile ("Sounds");   f.createDirectory(); return f; }
juce::File userPluginsFolder()  { auto f = userFolder().getChildFile ("Plugins");  f.createDirectory(); return f; }
juce::File projectsFolder()     { auto f = userFolder().getChildFile ("Projects"); f.createDirectory(); return f; }

//==============================================================================
juce::String pedalCategoryName (const juce::String& c)
{
    static const std::map<juce::String, juce::String> names {
        { "boost", "Boost & Overdrive" }, { "dist", "Distortion" }, { "fuzz", "Fuzz" }, { "comp", "Compressor & Gate" },
        { "eq", "EQ & Tone" }, { "wah", "Wah & Filter" }, { "mod", "Chorus, Phaser, Flanger" }, { "trem", "Tremolo & Vibrato" },
        { "pitch", "Octave & Pitch" }, { "delay", "Delay & Echo" }, { "reverb", "Reverb & Ambience" }, { "amp", "Amps & Preamps" },
        { "util", "Utility" }, { "acoustic", "Acoustic" } };
    auto it = names.find (c);
    return it != names.end() ? it->second : c;
}

juce::Colour pedalCategoryColour (const juce::String& c)
{
    static const std::map<juce::String, juce::uint32> cols {
        { "boost", 0xff3f9f5a }, { "dist", 0xffd9542b }, { "fuzz", 0xff8e44ad }, { "comp", 0xff2a7fd4 }, { "eq", 0xff2d8f8b },
        { "wah", 0xffc9a227 }, { "mod", 0xff1f8ba6 }, { "trem", 0xffb0557e }, { "pitch", 0xff6a5acd }, { "delay", 0xff2f6b9a },
        { "reverb", 0xff5b8c5a }, { "amp", 0xff8a6d3b }, { "util", 0xff6c757d }, { "acoustic", 0xffc8793b } };
    auto it = cols.find (c);
    return juce::Colour (it != cols.end() ? it->second : 0xff6c757d);
}

juce::Colour pedalColour (const juce::String& label)
{
    static const std::map<juce::String, juce::uint32> cols {
        {"ma_clear_drive",0xff7fb3a0}, {"ma_mid_drive",0xff4f9a4a}, {"ma_blues_drive",0xff2f6fb0}, {"ma_gold_drive",0xffc9a24a},
        {"ma_bass_drive",0xff5a6b3a}, {"ma_boost",0xffd8d2c4}, {"ma_brit_dist",0xffe0b23a}, {"ma_hg_dist",0xff2b2b2e},
        {"ma_ge_fuzz",0xffb23a3a}, {"ma_si_fuzz",0xff7a4fb0}, {"ma_oct_fuzz",0xff3a8fa8}, {"ma_amp_clean",0xff2e2e2e},
        {"ma_amp_crunch",0xffc7a35a}, {"ma_amp_hg",0xff3c3f46}, {"ma_amp_bass",0xff4a5560}, {"ma_bass_pre",0xff6b5a45},
        {"ma_studio_comp",0xff3b6fa0}, {"ma_opto_comp",0xffa8b4bf}, {"ma_squash_comp",0xff2f8fc9}, {"ma_gate",0xff1f4e79},
        {"ma_ac_pre",0xffb07a45}, {"ma_ac_sim",0xffd2a06a}, {"ma_chorus",0xff5fb7d4}, {"ma_tri_chorus",0xff3f8fc0},
        {"ma_flanger",0xff8a7fc0}, {"ma_phaser",0xffe07a2a}, {"ma_vibe",0xff6a4a8a}, {"ma_rotary",0xff7a5230}, {"ma_ring",0xff8fb03a},
        {"ma_harm_trem",0xffa0475e}, {"ma_square_trem",0xffd0607e}, {"ma_octave_up",0xff8f80e0}, {"ma_octave_down",0xff4a3f8a},
        {"ma_harmonizer",0xff5a5ac0}, {"ma_whammy",0xffc03030}, {"ma_env_filter",0xffe0c040}, {"ma_autowah",0xffb08a2a},
        {"ma_wah",0xff303030}, {"ma_synth_filter",0xff40a080}, {"ma_analog_delay",0xff3f7a3a}, {"ma_tape_delay",0xff8a6a4a},
        {"ma_digital_delay",0xff4a90c0}, {"ma_dotted_delay",0xffe2c27e}, {"ma_multihead",0xff5a3a2a}, {"ma_reverse_delay",0xff9a4ab0},
        {"ma_spring",0xff2a2a2a}, {"ma_plate",0xff9aa6b0}, {"ma_hall",0xff3a5a8a}, {"ma_shimmer",0xffcfd8f0}, {"ma_swell_verb",0xff7a9ac0},
        {"ma_freeze",0xffa0d8e8}, {"ma_volume",0xff3a3a3a}, {"ma_geq7",0xffc8c8c8}, {"ma_peq",0xff2d8f8b}, {"ma_mute",0xff202020} };
    auto it = cols.find (label);
    if (it != cols.end()) return juce::Colour (it->second);
    if (auto d = mp_find (label.toRawUTF8())) return pedalCategoryColour (d->cat);
    return Colours::panel3;
}

//==============================================================================
static juce::String cmfxIdFromJson (const juce::var& v, const juce::String& fallback)
{
    auto id = v.getProperty ("id", {}).toString();
    return id.isNotEmpty() ? id : fallback;
}

const std::vector<CmfxSource>& cmfxSources()
{
    static std::vector<CmfxSource> list = []
    {
        std::vector<CmfxSource> out;
        std::set<juce::String> seen;
        auto add = [&] (const juce::String& text, const juce::String& fallbackId, bool bundled)
        {
            auto v = juce::JSON::parse (text);
            if (! v.isObject()) return;
            CmfxSource s;
            s.id = cmfxIdFromJson (v, fallbackId);
            s.name = v.getProperty ("name", s.id).toString();
            s.family = v.getProperty ("family", "fx").toString();
            s.description = v.getProperty ("description", {}).toString();
            s.json = text;
            s.bundled = bundled;
            if (seen.insert (s.id).second)
                out.push_back (s);
        };
        for (int i = 0; i < MotionData::namedResourceListSize; ++i)
        {
            juce::String file (MotionData::originalFilenames[i]);
            if (! file.endsWith (".cmfx.json")) continue;
            int size = 0;
            if (auto data = MotionData::getNamedResource (MotionData::namedResourceList[i], size))
                add (juce::String::fromUTF8 (data, size), file.upToFirstOccurrenceOf (".", false, false), true);
        }
        for (auto& f : userPluginsFolder().findChildFiles (juce::File::findFiles, true, "*.cmfx.json"))
            add (f.loadFileAsString(), f.getFileNameWithoutExtension().upToFirstOccurrenceOf (".", false, false), false);
        std::sort (out.begin(), out.end(), [] (auto& a, auto& b) { return a.name.compareNatural (b.name) < 0; });
        return out;
    }();
    return list;
}

const CmfxSource* findCmfx (const juce::String& id)
{
    for (auto& s : cmfxSources())
        if (s.id == id) return &s;
    return nullptr;
}

const std::vector<BoardPreset>& boardPresets()
{
    static std::vector<BoardPreset> list = []
    {
        std::vector<BoardPreset> out;
        auto v = juce::JSON::parse (juce::String::fromUTF8 (MotionData::boards_json, MotionData::boards_jsonSize));
        if (auto* arr = v.getProperty ("boards", {}).getArray())
        {
            for (auto& b : *arr)
            {
                BoardPreset p;
                p.id = b.getProperty ("id", {}).toString();
                p.name = b.getProperty ("name", {}).toString();
                p.kind = b.getProperty ("kind", {}).toString();
                if (auto* chain = b.getProperty ("chain", {}).getArray())
                    for (auto& c : *chain)
                    {
                        BoardPreset::Pedal pd;
                        pd.label = c.getProperty ("pedal", {}).toString();
                        if (auto* obj = c.getProperty ("values", {}).getDynamicObject())
                            for (auto& prop : obj->getProperties())
                                pd.values[prop.name.toString()] = (float) prop.value;
                        p.chain.push_back (pd);
                    }
                out.push_back (p);
            }
        }
        return out;
    }();
    return list;
}

//==============================================================================
static juce::String kindTitle (const juce::String& k)
{
    if (k == "electric") return "Electric";
    if (k == "acoustic") return "Acoustic";
    if (k == "bass") return "Bass";
    if (k == "keys") return "Keys";
    return k;
}

const std::vector<MotionPluginInfo>& motionPlugins()
{
    static std::vector<MotionPluginInfo> list = []
    {
        std::vector<MotionPluginInfo> out;
        out.push_back ({ "motion:keys", "Motion Keys", "Instrument", "Instruments", true, Colours::gold });
        out.push_back ({ "motion:pads", "Motion Pads", "Instrument", "Instruments", true, Colours::goldHi });
        out.push_back ({ "motion:drums", "Motion Drums", "Instrument", "Instruments", true, Colours::goldDeep });
        out.push_back ({ "motion:board", "Motion Pedalboard", "Pedalboard", "Boards", false, Colours::gold });

        for (auto& b : boardPresets())
            out.push_back ({ "motion:board:" + b.id, b.name, kindTitle (b.kind), "Boards", false, Colours::gold });

        for (int i = 0; i < mp_count(); ++i)
        {
            auto d = mp_def (i);
            out.push_back ({ juce::String ("motion:pedal:") + d->id, d->name, pedalCategoryName (d->cat), "Pedals", false, pedalColour (d->id) });
        }

        for (auto& s : cmfxSources())
        {
            auto fam = s.family.isNotEmpty() ? s.family.substring (0, 1).toUpperCase() + s.family.substring (1) : juce::String ("FX");
            out.push_back ({ "motion:fx:" + s.id, s.name, fam, "Plugins", false, Colours::gold });
        }
        return out;
    }();
    return list;
}

const MotionPluginInfo* findMotionPlugin (const juce::String& id)
{
    for (auto& p : motionPlugins())
        if (p.id == id) return &p;
    return nullptr;
}

juce::PluginDescription describeMotionPlugin (const MotionPluginInfo& p)
{
    juce::PluginDescription d;
    d.name = p.name;
    d.descriptiveName = p.name;
    d.pluginFormatName = MotionAudioFormat::formatName;
    d.category = p.group + "/" + p.category;
    d.manufacturerName = "Motion Audio";
    d.version = "1.0";
    d.fileOrIdentifier = p.id;
    d.uniqueId = d.deprecatedUid = p.id.hashCode();
    d.isInstrument = p.isInstrument;
    d.numInputChannels = p.isInstrument ? 0 : 2;
    d.numOutputChannels = 2;
    d.hasSharedContainer = false;
    d.lastFileModTime = juce::Time (2026, 10, 8, 0, 0);
    d.lastInfoUpdateTime = d.lastFileModTime;
    return d;
}

std::unique_ptr<juce::AudioPluginInstance> createMotionPlugin (const juce::String& id)
{
    auto info = findMotionPlugin (id);
    if (info == nullptr) return {};

    if (id == "motion:keys")  return createKeysProcessor (*info);
    if (id == "motion:pads")  return createPadsProcessor (*info);
    if (id == "motion:drums") return createDrumsProcessor (*info);
    if (id == "motion:board") return createPedalboardProcessor (*info, {});
    if (id.startsWith ("motion:board:")) return createPedalboardProcessor (*info, id.fromFirstOccurrenceOf ("motion:board:", false, false));
    if (id.startsWith ("motion:pedal:")) return createPedalProcessor (*info, id.fromFirstOccurrenceOf ("motion:pedal:", false, false));
    if (id.startsWith ("motion:fx:"))
        if (auto s = findCmfx (id.fromFirstOccurrenceOf ("motion:fx:", false, false)))
            return createCmfxProcessor (*info, *s);
    return {};
}

//==============================================================================
void MotionAudioFormat::findAllTypesForFile (juce::OwnedArray<juce::PluginDescription>& results, const juce::String& id)
{
    if (auto p = findMotionPlugin (id))
        results.add (new juce::PluginDescription (describeMotionPlugin (*p)));
}

juce::String MotionAudioFormat::getNameOfPluginFromIdentifier (const juce::String& id)
{
    if (auto p = findMotionPlugin (id)) return p->name;
    return id;
}

juce::StringArray MotionAudioFormat::searchPathsForPlugins (const juce::FileSearchPath&, bool, bool)
{
    juce::StringArray ids;
    for (auto& p : motionPlugins()) ids.add (p.id);
    return ids;
}

void MotionAudioFormat::createPluginInstance (const juce::PluginDescription& d, double sr, int bs, PluginCreationCallback callback)
{
    auto p = createMotionPlugin (d.fileOrIdentifier);
    if (p == nullptr)
    {
        callback (nullptr, "Motion Audio plugin not found: " + d.fileOrIdentifier);
        return;
    }
    p->setRateAndBufferSizeDetails (sr, bs);
    callback (std::move (p), {});
}

void registerMotionPlugins (juce::KnownPluginList& list)
{
    for (auto& p : motionPlugins())
    {
        auto d = describeMotionPlugin (p);
        if (list.getTypeForFile (d.fileOrIdentifier) == nullptr)
            list.addType (d);
    }
}

} // namespace ms
