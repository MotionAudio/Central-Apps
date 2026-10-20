// A tiny VST3 plugin pair for testing the plugin host (never shipped): "Central Test Gain VST3" (an effect, one
// parameter: Gain -24..+24 dB) and "Central Test Synth VST3" (an instrument: a sine per note, one parameter: Volume).
// One object is processor and controller. Only the SDK's interface headers (vendor/vst3sdk) are used.
// Built into a .vst3 bundle by the Makefile (tools: plughost/test/make-test-vst3.sh).
#include <atomic>
#include <cmath>
#include <cstdio>
#include <cstring>
#include "pluginterfaces/base/ibstream.h"
#include "pluginterfaces/base/ipluginbase.h"
#include "pluginterfaces/vst/ivstaudioprocessor.h"
#include "pluginterfaces/vst/ivstcomponent.h"
#include "pluginterfaces/vst/ivsteditcontroller.h"
#include "pluginterfaces/vst/ivstevents.h"
#include "pluginterfaces/vst/ivstparameterchanges.h"
#include "pluginterfaces/vst/vstspeaker.h"
#ifdef __APPLE__
#include <CoreFoundation/CoreFoundation.h>
#endif

using namespace Steinberg;
using namespace Steinberg::Vst;
#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

static const TUID kFxUid = INLINE_UID(0x43454E54, 0x52414C47, 0x41494E31, 0x00000001);
static const TUID kSynUid = INLINE_UID(0x43454E54, 0x52414C53, 0x594E5431, 0x00000002);
static void str16(const char *s, String128 out) { int k = 0; for (; s[k] && k < 127; k++) out[k] = (char16)s[k]; out[k] = 0; }

class TestPlug final : public IComponent, public IAudioProcessor, public IEditController {
 public:
  explicit TestPlug(bool syn) : synth(syn) {}
  std::atomic<uint32> refc{ 1 }; bool synth; double sr = 48000, value; double ph[128] = { 0 }; bool on[128] = { false }; float vel[128] = { 0 };
  // value: the parameter (normalized): Gain 0.5 = 0 dB, Volume 0.8
  tresult PLUGIN_API queryInterface(const TUID iid, void **obj) override {
    if (FUnknownPrivate::iidEqual(iid, IComponent::iid) || FUnknownPrivate::iidEqual(iid, IPluginBase::iid) || FUnknownPrivate::iidEqual(iid, FUnknown::iid)) { addRef(); *obj = static_cast<IComponent *>(this); return kResultOk; }
    if (FUnknownPrivate::iidEqual(iid, IAudioProcessor::iid)) { addRef(); *obj = static_cast<IAudioProcessor *>(this); return kResultOk; }
    if (FUnknownPrivate::iidEqual(iid, IEditController::iid)) { addRef(); *obj = static_cast<IEditController *>(this); return kResultOk; }
    *obj = nullptr; return kNoInterface;
  }
  uint32 PLUGIN_API addRef() override { return ++refc; }
  uint32 PLUGIN_API release() override { uint32 r = --refc; if (!r) delete this; return r; }
  tresult PLUGIN_API initialize(FUnknown *) override { value = synth ? 0.8 : 0.5; return kResultOk; }
  tresult PLUGIN_API terminate() override { return kResultOk; }
  // IComponent
  tresult PLUGIN_API getControllerClassId(TUID) override { return kResultFalse; }
  tresult PLUGIN_API setIoMode(IoMode) override { return kResultOk; }
  int32 PLUGIN_API getBusCount(MediaType t, BusDirection d) override { if (t == kAudio) return d == kOutput ? 1 : synth ? 0 : 1; return t == kEvent && d == kInput && synth ? 1 : 0; }
  tresult PLUGIN_API getBusInfo(MediaType t, BusDirection d, int32 i, BusInfo &b) override {
    if (i != 0) return kResultFalse; memset(&b, 0, sizeof b); b.mediaType = t; b.direction = d; b.busType = kMain; b.flags = BusInfo::kDefaultActive;
    if (t == kAudio) { b.channelCount = 2; str16(d == kInput ? "In" : "Out", b.name); } else { b.channelCount = 16; str16("Notes", b.name); } return kResultOk;
  }
  tresult PLUGIN_API getRoutingInfo(RoutingInfo &, RoutingInfo &) override { return kResultFalse; }
  tresult PLUGIN_API activateBus(MediaType, BusDirection, int32, TBool) override { return kResultOk; }
  tresult PLUGIN_API setActive(TBool) override { return kResultOk; }
  tresult PLUGIN_API setState(IBStream *s) override { double v; int32 got = 0; if (s->read(&v, sizeof v, &got) != kResultOk || got != (int32)sizeof v) return kResultFalse; value = v; return kResultOk; }
  tresult PLUGIN_API getState(IBStream *s) override { double v = value; return s->write(&v, sizeof v, nullptr); }
  // IAudioProcessor
  tresult PLUGIN_API setBusArrangements(SpeakerArrangement *, int32, SpeakerArrangement *, int32) override { return kResultOk; }
  tresult PLUGIN_API getBusArrangement(BusDirection, int32, SpeakerArrangement &a) override { a = SpeakerArr::kStereo; return kResultOk; }
  tresult PLUGIN_API canProcessSampleSize(int32 s) override { return s == kSample32 ? kResultOk : kResultFalse; }
  uint32 PLUGIN_API getLatencySamples() override { return 0; }
  tresult PLUGIN_API setupProcessing(ProcessSetup &s) override { sr = s.sampleRate; return kResultOk; }
  tresult PLUGIN_API setProcessing(TBool) override { return kResultOk; }
  tresult PLUGIN_API process(ProcessData &d) override {
    if (d.inputParameterChanges) for (int32 i = 0; i < d.inputParameterChanges->getParameterCount(); i++) { auto *q = d.inputParameterChanges->getParameterData(i); int32 o; ParamValue v; if (q && q->getParameterId() == 1 && q->getPoint(q->getPointCount() - 1, o, v) == kResultOk) value = v; }
    if (d.inputEvents) for (int32 i = 0; i < d.inputEvents->getEventCount(); i++) { Event e; if (d.inputEvents->getEvent(i, e) != kResultOk) continue; if (e.type == Event::kNoteOnEvent && e.noteOn.pitch >= 0 && e.noteOn.pitch < 128) { on[e.noteOn.pitch] = e.noteOn.velocity > 0; vel[e.noteOn.pitch] = e.noteOn.velocity; } else if (e.type == Event::kNoteOffEvent && e.noteOff.pitch >= 0 && e.noteOff.pitch < 128) on[e.noteOff.pitch] = false; }
    if (!d.numOutputs || d.numSamples <= 0) return kResultOk;
    float **out = d.outputs[0].channelBuffers32;
    if (synth) {
      for (int32 i = 0; i < d.numSamples; i++) { double v = 0; for (int k = 0; k < 128; k++) if (on[k]) { v += sin(ph[k]) * vel[k] * 0.2; ph[k] += 2 * M_PI * 440 * pow(2, (k - 69) / 12.0) / sr; if (ph[k] > 2 * M_PI) ph[k] -= 2 * M_PI; } out[0][i] = out[1][i] = (float)(v * value); }
    } else {
      float g = (float)pow(10, (-24 + 48 * value) / 20); float **in = d.numInputs ? d.inputs[0].channelBuffers32 : nullptr;
      for (int32 i = 0; i < d.numSamples; i++) { out[0][i] = in ? in[0][i] * g : 0; out[1][i] = in ? in[1][i] * g : 0; }
    }
    return kResultOk;
  }
  uint32 PLUGIN_API getTailSamples() override { return 0; }
  // IEditController (one parameter, id 1)
  tresult PLUGIN_API setComponentState(IBStream *s) override { return setState(s); }
  int32 PLUGIN_API getParameterCount() override { return 1; }
  tresult PLUGIN_API getParameterInfo(int32 i, ParameterInfo &p) override { if (i) return kResultFalse; memset(&p, 0, sizeof p); p.id = 1; str16(synth ? "Volume" : "Gain", p.title); str16(synth ? "Vol" : "Gain", p.shortTitle); str16(synth ? "%" : "dB", p.units); p.defaultNormalizedValue = synth ? 0.8 : 0.5; p.flags = ParameterInfo::kCanAutomate; return kResultOk; }
  tresult PLUGIN_API getParamStringByValue(ParamID, ParamValue v, String128 s) override { char b[64]; if (synth) snprintf(b, sizeof b, "%d", (int)(v * 100 + 0.5)); else snprintf(b, sizeof b, "%.1f", -24 + 48 * v); str16(b, s); return kResultOk; }
  tresult PLUGIN_API getParamValueByString(ParamID, TChar *, ParamValue &) override { return kResultFalse; }
  ParamValue PLUGIN_API normalizedParamToPlain(ParamID, ParamValue v) override { return v; }
  ParamValue PLUGIN_API plainParamToNormalized(ParamID, ParamValue v) override { return v; }
  ParamValue PLUGIN_API getParamNormalized(ParamID) override { return value; }
  tresult PLUGIN_API setParamNormalized(ParamID, ParamValue v) override { value = v; return kResultOk; }
  tresult PLUGIN_API setComponentHandler(IComponentHandler *) override { return kResultOk; }
  IPlugView *PLUGIN_API createView(FIDString) override { return nullptr; }
};

class Factory final : public IPluginFactory2 {
 public:
  tresult PLUGIN_API queryInterface(const TUID iid, void **obj) override { if (FUnknownPrivate::iidEqual(iid, IPluginFactory2::iid) || FUnknownPrivate::iidEqual(iid, IPluginFactory::iid) || FUnknownPrivate::iidEqual(iid, FUnknown::iid)) { *obj = this; return kResultOk; } *obj = nullptr; return kNoInterface; }
  uint32 PLUGIN_API addRef() override { return 1; } uint32 PLUGIN_API release() override { return 1; }
  tresult PLUGIN_API getFactoryInfo(PFactoryInfo *i) override { memset(i, 0, sizeof *i); strcpy(i->vendor, "Motion Audio"); strcpy(i->url, "https://motionaudio.github.io/Central-Apps/"); i->flags = PFactoryInfo::kUnicode; return kResultOk; }
  int32 PLUGIN_API countClasses() override { return 2; }
  tresult PLUGIN_API getClassInfo(int32 i, PClassInfo *c) override { if (i < 0 || i > 1) return kResultFalse; memset(c, 0, sizeof *c); memcpy(c->cid, i ? kSynUid : kFxUid, 16); c->cardinality = PClassInfo::kManyInstances; strcpy(c->category, kVstAudioEffectClass); strcpy(c->name, i ? "Central Test Synth VST3" : "Central Test Gain VST3"); return kResultOk; }
  tresult PLUGIN_API getClassInfo2(int32 i, PClassInfo2 *c) override { if (i < 0 || i > 1) return kResultFalse; memset(c, 0, sizeof *c); memcpy(c->cid, i ? kSynUid : kFxUid, 16); c->cardinality = PClassInfo::kManyInstances; strcpy(c->category, kVstAudioEffectClass); strcpy(c->name, i ? "Central Test Synth VST3" : "Central Test Gain VST3"); strcpy(c->subCategories, i ? "Instrument|Synth" : "Fx|Tools"); strcpy(c->vendor, "Motion Audio"); strcpy(c->version, "1.0.0"); strcpy(c->sdkVersion, "VST 3.8"); return kResultOk; }
  tresult PLUGIN_API createInstance(FIDString cid, FIDString iid, void **obj) override {
    bool syn = FUnknownPrivate::iidEqual(cid, kSynUid); if (!syn && !FUnknownPrivate::iidEqual(cid, kFxUid)) { *obj = nullptr; return kNoInterface; }
    TestPlug *p = new TestPlug(syn); tresult r = p->queryInterface(iid, obj); p->release(); return r;
  }
};
static Factory factory;

#if defined(_WIN32)
#define EXPORT extern "C" __declspec(dllexport)
#else
#define EXPORT extern "C" __attribute__((visibility("default")))
#endif
EXPORT IPluginFactory *PLUGIN_API GetPluginFactory() { return &factory; }
#if defined(_WIN32)
EXPORT bool InitDll() { return true; }
EXPORT bool ExitDll() { return true; }
#elif defined(__APPLE__)
EXPORT bool bundleEntry(CFBundleRef) { return true; }
EXPORT bool bundleExit() { return true; }
#else
EXPORT bool ModuleEntry(void *) { return true; }
EXPORT bool ModuleExit() { return true; }
#endif
