// fmt_au.mm - Audio Units on macOS (AudioToolbox; v2 units, and v3 units through the system's bridge): effects
// ('aufx', 'aumf') and instruments ('aumu'), parameters, state (the unit's class info), and its editor (its own Cocoa
// view, else the system's generic one).
#ifdef __APPLE__
#import <Cocoa/Cocoa.h>
#import <AudioToolbox/AudioToolbox.h>
#import <CoreAudioKit/CoreAudioKit.h>
#include <algorithm>
#include <atomic>
#include <cstring>
#include <vector>
#include "ph.hpp"

// what an Audio Unit's own Cocoa view factory answers (the SDK's AUCocoaUIBase; declared here, checked at run time)
@protocol PHCocoaUIFactory <NSObject>
- (NSView *)uiViewForAudioUnit:(AudioUnit)inAudioUnit withSize:(NSSize)inPreferredSize;
@end

namespace ph {
static std::string fourcc(OSType t) { char b[9]; snprintf(b, sizeof b, "%08X", (unsigned)t); return b; }
static std::string cfstr(CFStringRef s) { if (!s) return ""; char b[512]; if (CFStringGetCString(s, b, sizeof b, kCFStringEncodingUTF8)) return b; return ""; }
static bool parseId(const std::string &id, AudioComponentDescription &d) {   // "TTTTTTTT-SSSSSSSS-MMMMMMMM" (hex type, subtype, manufacturer)
  unsigned t = 0, s = 0, m = 0; if (sscanf(id.c_str(), "%8X-%8X-%8X", &t, &s, &m) != 3) return false;
  memset(&d, 0, sizeof d); d.componentType = t; d.componentSubType = s; d.componentManufacturer = m; return true;
}

bool listAu(std::vector<ClassInfo> &out) {
  const OSType types[] = { kAudioUnitType_Effect, kAudioUnitType_MusicEffect, kAudioUnitType_MusicDevice };
  for (OSType type : types) {
    AudioComponentDescription want{}; want.componentType = type; AudioComponent c = nullptr;
    while ((c = AudioComponentFindNext(c, &want))) {
      AudioComponentDescription d{}; if (AudioComponentGetDescription(c, &d) != noErr) continue;
      CFStringRef cn = nullptr; AudioComponentCopyName(c, &cn); std::string full = cfstr(cn); if (cn) CFRelease(cn);
      std::string vendor, name = full; size_t k = full.find(": "); if (k != std::string::npos) { vendor = full.substr(0, k); name = full.substr(k + 2); }
      UInt32 ver = 0; AudioComponentGetVersion(c, &ver); char vb[32]; snprintf(vb, sizeof vb, "%u.%u.%u", (ver >> 16) & 0xFFFF, (ver >> 8) & 0xFF, ver & 0xFF);
      out.push_back({ "au", fourcc(d.componentType) + "-" + fourcc(d.componentSubType) + "-" + fourcc(d.componentManufacturer), name, vendor, vb, type == kAudioUnitType_MusicDevice ? "instrument" : "effect" });
    }
  }
  return true;
}

struct AuPlug : Plug {
  AudioUnit unit = nullptr; bool initialized = false; bool hasInput = false;
  const float *curIn[2] = { nullptr, nullptr }; int curN = 0; std::vector<float> zeros;
  AudioBufferList *abl = nullptr; std::vector<float> outMem[2]; Float64 sampleTime = 0;
  struct P { AudioUnitParameterID id; std::string name; float min, max; AudioUnitParameterUnit unit; UInt32 flags; }; std::vector<P> plist;
  NSView *auView = nil; ::id frameObserver = nil;   // (::id: Plug has a member called id)

  ~AuPlug() override {
    if (editor) closeEditor();
    if (unit) { if (initialized) AudioUnitUninitialize(unit); AudioComponentInstanceDispose(unit); }
    free(abl);
  }
  static OSStatus inputCb(void *ref, AudioUnitRenderActionFlags *, const AudioTimeStamp *, UInt32, UInt32 n, AudioBufferList *io) {
    auto *s = (AuPlug *)ref;
    for (UInt32 b = 0; b < io->mNumberBuffers; b++) { const float *src = s->curIn[b < 2 ? b : 1]; if (!src) src = s->curIn[0] ? s->curIn[0] : s->zeros.data(); memcpy(io->mBuffers[b].mData, src, sizeof(float) * std::min<UInt32>(n, (UInt32)s->curN)); }
    return noErr;
  }
  bool init(const std::string &cid, std::string &err) {
    AudioComponentDescription d; if (!parseId(cid, d)) { err = "not an Audio Unit id"; return false; }
    AudioComponent c = AudioComponentFindNext(nullptr, &d); if (!c) { err = "this Audio Unit is not on this Mac any more"; return false; }
    CFStringRef cn = nullptr; AudioComponentCopyName(c, &cn); std::string full = cfstr(cn); if (cn) CFRelease(cn);
    size_t k = full.find(": "); if (k != std::string::npos) { vendor = full.substr(0, k); name = full.substr(k + 2); } else name = full;
    instrument = d.componentType == kAudioUnitType_MusicDevice;
    if (AudioComponentInstanceNew(c, &unit) != noErr || !unit) { err = "the Audio Unit could not be created"; unit = nullptr; return false; }
    return true;
  }
  bool start(double sr, int mb, std::string &err) override {
    sampleRate = sr; maxBlock = mb; zeros.assign((size_t)mb, 0.f);
    AudioStreamBasicDescription f{}; f.mSampleRate = sr; f.mFormatID = kAudioFormatLinearPCM; f.mFormatFlags = kAudioFormatFlagsNativeFloatPacked | kAudioFormatFlagIsNonInterleaved;
    f.mBytesPerPacket = 4; f.mFramesPerPacket = 1; f.mBytesPerFrame = 4; f.mChannelsPerFrame = 2; f.mBitsPerChannel = 32;
    UInt32 maxFrames = (UInt32)mb; AudioUnitSetProperty(unit, kAudioUnitProperty_MaximumFramesPerSlice, kAudioUnitScope_Global, 0, &maxFrames, sizeof maxFrames);
    if (AudioUnitSetProperty(unit, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Output, 0, &f, sizeof f) != noErr) { err = "the Audio Unit does not take stereo at " + std::to_string((int)sr) + " Hz"; return false; }
    UInt32 inCount = 0, sz = sizeof inCount; AudioUnitGetProperty(unit, kAudioUnitProperty_ElementCount, kAudioUnitScope_Input, 0, &inCount, &sz);
    if (inCount > 0 && !instrument) {
      hasInput = AudioUnitSetProperty(unit, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Input, 0, &f, sizeof f) == noErr;
      AURenderCallbackStruct cb{ inputCb, this }; AudioUnitSetProperty(unit, kAudioUnitProperty_SetRenderCallback, kAudioUnitScope_Input, 0, &cb, sizeof cb);
    }
    if (AudioUnitInitialize(unit) != noErr) { err = "the Audio Unit would not start"; return false; }
    initialized = true;
    abl = (AudioBufferList *)calloc(1, sizeof(AudioBufferList) + sizeof(AudioBuffer)); abl->mNumberBuffers = 2;
    for (int c = 0; c < 2; c++) { outMem[c].assign((size_t)mb, 0.f); abl->mBuffers[c].mNumberChannels = 1; }
    readParams(); return true;
  }
  void readParams() {
    plist.clear(); UInt32 sz = 0; Boolean w = false;
    if (AudioUnitGetPropertyInfo(unit, kAudioUnitProperty_ParameterList, kAudioUnitScope_Global, 0, &sz, &w) != noErr || !sz) return;
    std::vector<AudioUnitParameterID> ids(sz / sizeof(AudioUnitParameterID)); AudioUnitGetProperty(unit, kAudioUnitProperty_ParameterList, kAudioUnitScope_Global, 0, ids.data(), &sz);
    for (auto id : ids) {
      AudioUnitParameterInfo pi{}; UInt32 s2 = sizeof pi; if (AudioUnitGetProperty(unit, kAudioUnitProperty_ParameterInfo, kAudioUnitScope_Global, id, &pi, &s2) != noErr) continue;
      std::string nm = (pi.flags & kAudioUnitParameterFlag_HasCFNameString) && pi.cfNameString ? cfstr(pi.cfNameString) : pi.name;
      if ((pi.flags & kAudioUnitParameterFlag_CFNameRelease) && pi.cfNameString) CFRelease(pi.cfNameString);
      plist.push_back({ id, nm, pi.minValue, pi.maxValue, pi.unit, pi.flags });
    }
  }
  int latency() override { Float64 l = 0; UInt32 sz = sizeof l; AudioUnitGetProperty(unit, kAudioUnitProperty_Latency, kAudioUnitScope_Global, 0, &l, &sz); return (int)(l * sampleRate); }
  void process(const float *inL, const float *inR, float *outL, float *outR, int n, const PhMidi *midi, int nMidi) override {
    for (int i = 0; i < nMidi; i++) MusicDeviceMIDIEvent(unit, midi[i].d[0], midi[i].d[1], midi[i].d[2], 0);
    curIn[0] = inL; curIn[1] = inR ? inR : inL; curN = n;
    for (int c = 0; c < 2; c++) { abl->mBuffers[c].mData = outMem[c].data(); abl->mBuffers[c].mDataByteSize = (UInt32)(sizeof(float) * (size_t)n); }
    AudioUnitRenderActionFlags fl = 0; AudioTimeStamp ts{}; ts.mSampleTime = sampleTime; ts.mFlags = kAudioTimeStampSampleTimeValid;
    OSStatus r = AudioUnitRender(unit, &fl, &ts, 0, (UInt32)n, abl); sampleTime += n;
    if (r != noErr) { memset(outL, 0, sizeof(float) * (size_t)n); memset(outR, 0, sizeof(float) * (size_t)n); return; }
    memcpy(outL, abl->mBuffers[0].mData, sizeof(float) * (size_t)n); memcpy(outR, abl->mBuffers[1].mData, sizeof(float) * (size_t)n);
  }
  static const char *unitText(AudioUnitParameterUnit u) {
    switch (u) { case kAudioUnitParameterUnit_Decibels: return " dB"; case kAudioUnitParameterUnit_Hertz: return " Hz"; case kAudioUnitParameterUnit_Percent: return " %"; case kAudioUnitParameterUnit_Seconds: return " s"; case kAudioUnitParameterUnit_Milliseconds: return " ms"; case kAudioUnitParameterUnit_Cents: return " cents"; default: return ""; }
  }
  std::vector<Param> params(int max) override {
    std::vector<Param> out;
    for (auto &p : plist) {
      if ((int)out.size() >= max) break; if (!(p.flags & kAudioUnitParameterFlag_IsWritable)) continue;
      AudioUnitParameterValue v = 0; AudioUnitGetParameter(unit, p.id, kAudioUnitScope_Global, 0, &v);
      char t[64]; snprintf(t, sizeof t, p.unit == kAudioUnitParameterUnit_Indexed || p.unit == kAudioUnitParameterUnit_Boolean ? "%.0f%s" : "%.2f%s", v, unitText(p.unit));
      out.push_back({ p.id, p.name, p.max > p.min ? (v - p.min) / (p.max - p.min) : 0, t });
    }
    return out;
  }
  void setParam(uint32_t id, double norm) override { for (auto &p : plist) if (p.id == id) { AudioUnitSetParameter(unit, id, kAudioUnitScope_Global, 0, (AudioUnitParameterValue)(p.min + (p.max - p.min) * norm), 0); break; } }
  bool saveState(std::vector<uint8_t> &out) override {
    CFPropertyListRef pl = nullptr; UInt32 sz = sizeof pl; if (AudioUnitGetProperty(unit, kAudioUnitProperty_ClassInfo, kAudioUnitScope_Global, 0, &pl, &sz) != noErr || !pl) return false;
    CFDataRef d = CFPropertyListCreateData(nullptr, pl, kCFPropertyListBinaryFormat_v1_0, 0, nullptr); CFRelease(pl); if (!d) return false;
    out.assign(CFDataGetBytePtr(d), CFDataGetBytePtr(d) + CFDataGetLength(d)); CFRelease(d); return true;
  }
  bool loadState(const std::vector<uint8_t> &in) override {
    CFDataRef d = CFDataCreate(nullptr, in.data(), (CFIndex)in.size()); if (!d) return false;
    CFPropertyListRef pl = CFPropertyListCreateWithData(nullptr, d, kCFPropertyListImmutable, nullptr, nullptr); CFRelease(d); if (!pl) return false;
    OSStatus r = AudioUnitSetProperty(unit, kAudioUnitProperty_ClassInfo, kAudioUnitScope_Global, 0, &pl, sizeof pl); CFRelease(pl);
    AudioUnitParameter changed{ unit, kAUParameterListener_AnyParameter, kAudioUnitScope_Global, 0 }; AUParameterListenerNotify(nullptr, nullptr, &changed);
    return r == noErr;
  }
  // the editor: the unit's own Cocoa view, else the generic one
  bool hasEditor() override { return true; }
  NSView *makeView() {
    UInt32 sz = 0; Boolean w = false;
    if (AudioUnitGetPropertyInfo(unit, kAudioUnitProperty_CocoaUI, kAudioUnitScope_Global, 0, &sz, &w) == noErr && sz >= sizeof(AudioUnitCocoaViewInfo)) {
      std::vector<uint8_t> buf(sz); auto *info = (AudioUnitCocoaViewInfo *)buf.data();
      if (AudioUnitGetProperty(unit, kAudioUnitProperty_CocoaUI, kAudioUnitScope_Global, 0, info, &sz) == noErr) {
        NSURL *url = (NSURL *)info->mCocoaAUViewBundleLocation; NSString *cls = (NSString *)info->mCocoaAUViewClass[0];
        NSBundle *b = url ? [NSBundle bundleWithURL:url] : nil; Class c = b && cls ? [b classNamed:cls] : nil; NSView *v = nil;
        if (c && [c instancesRespondToSelector:@selector(uiViewForAudioUnit:withSize:)]) { ::id<PHCocoaUIFactory> factory = (::id<PHCocoaUIFactory>)[[c alloc] init]; v = [factory uiViewForAudioUnit:unit withSize:NSMakeSize(640, 400)]; [v retain]; [factory release]; }
        if (info->mCocoaAUViewBundleLocation) CFRelease(info->mCocoaAUViewBundleLocation);
        for (UInt32 i = 0; i < (sz - sizeof(CFURLRef)) / sizeof(CFStringRef); i++) if (info->mCocoaAUViewClass[i]) CFRelease(info->mCocoaAUViewClass[i]);
        if (v) return v;
      }
    }
    AUGenericView *g = [[AUGenericView alloc] initWithAudioUnit:unit]; [g setShowsExpertParameters:YES]; return g;
  }
  bool openEditor() override {
    auView = makeView(); if (!auView) return false;
    NSRect f = [auView frame]; int w = (int)f.size.width, h = (int)f.size.height; if (w < 100) w = 480; if (h < 60) h = 320;
    editor = makeWindow(name, w, h, false); if (!editor) { [auView release]; auView = nil; return false; }
    NSView *parent = (NSView *)editor->native(); [auView setFrameOrigin:NSMakePoint(0, 0)]; [parent addSubview:auView];
    [auView setPostsFrameChangedNotifications:YES];
    Window *win = editor; NSView *v = auView;
    frameObserver = [[NSNotificationCenter defaultCenter] addObserverForName:NSViewFrameDidChangeNotification object:auView queue:nil usingBlock:^(NSNotification *note) { (void)note; NSRect r = [v frame]; win->resize((int)r.size.width, (int)r.size.height); }];
    [frameObserver retain];
    editor->show(); return true;
  }
  void closeEditor() override {
    if (frameObserver) { [[NSNotificationCenter defaultCenter] removeObserver:frameObserver]; [frameObserver release]; frameObserver = nil; }
    if (auView) { [auView removeFromSuperview]; [auView release]; auView = nil; }
    if (editor) { Window *w = editor; editor = nullptr; delete w; }
    dirty = true;
  }
};

Plug *openAu(const std::string &id, std::string &err) { auto *p = new AuPlug(); if (!p->init(id, err)) { delete p; return nullptr; } return p; }
}  // namespace ph
#endif
