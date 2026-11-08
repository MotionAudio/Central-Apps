#pragma once
#include "MotionProcessors.h"

namespace ms
{

/** The free SoundFont banks Motion Studio can fetch for Motion Keys - the same FreePats banks the Central apps install
    (CC0 / CC-BY 3.0). Downloads go to ~/Music/Motion Studio/Sounds. */
struct SoundBankSource { const char* name; const char* url; const char* license; };
const std::vector<SoundBankSource>& starterSoundBanks();

/** Downloads and unpacks the starter banks on a background thread. */
class SoundBankDownloader : public juce::Thread
{
public:
    SoundBankDownloader();
    ~SoundBankDownloader() override;
    void run() override;
    std::atomic<double> progress { 0.0 };
    juce::String status;
    juce::CriticalSection statusLock;
    std::function<void()> onFinished;
    juce::String getStatus()  { const juce::ScopedLock sl (statusLock); return status; }
    void setStatus (const juce::String& s) { const juce::ScopedLock sl (statusLock); status = s; }
};

juce::Array<juce::File> findSoundBanks();

} // namespace ms
