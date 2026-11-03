# Shorts (Central Control 10.2)

After a service is recorded, Central Control finds its best moments, from the sermon and from the worship. It makes each one into a vertical video (9:16, 1080 × 1920) with captions. Someone looks them over on the **Shorts** tab, fixes anything, approves them, and posts them to YouTube Shorts, Facebook Reels, Instagram Reels and TikTok with one click. Until a platform is connected, they can download the short and copy its caption instead.

Shorts are made on the **main admin's computer** only. That computer records the service and holds the speech and AI models. Nothing is sent anywhere to pick the moments.

## How it works

1. **The recording.** The program or stream-mix recording (Online mix → Record) provides the sound. The Video tab's camera recording provides the picture.
   - The two recordings are lined up automatically by their sound, even if they didn't start at the same moment.
   - With no camera recording, each short shows a moving waveform in the church's colour behind the captions.
2. **Songs and sermon.** While the service records, Central Control notes when each song and section starts, from the tracks.
   - Without those notes, long stretches of music count as songs.
   - The longest stretch of talking counts as the sermon.
3. **The words.** The speech model from Settings → Lyrics (listening) writes down the sermon, with the time of every word.
   - Without the model, shorts are picked by their sound alone and have no captions, and the Shorts tab says so.
4. **Picking the moments.**
   - **Sermon:** every run of whole sentences that fits the length range gets a score. It counts higher for:
     - a complete thought that doesn't start mid-sentence;
     - strong and quotable lines;
     - a story's payoff;
     - energy in the voice;
     - a pause after it;
     - applause, an "amen" or laughter right after.

     It counts lower for announcements. The AI model already in Central Control (for the lights) then reads the strongest few dozen and rates each one.
   - **Worship:** the choruses, the bridge, the last chorus, and stretches louder than the rest of the song. Each one starts and ends where the music breathes.
   - The best moments win. They never overlap, at most two come from one song, and the sermon/worship split follows the settings.
5. **Making each short.**
   - **Framing:** the picture follows the speaker when they move (a slow, steady pan), or shows the wide shot over a blurred copy of itself.
   - **Captions:** a few words at a time, with the word being said lit up.
   - **Finish:** the logo, an intro and outro if set, and the sound brought to −14 LUFS (the level social apps play at).
   - **Extras:** an SRT file, a picture for the list, and a title and description drafted by the AI, all editable.

The work runs in its own process at low priority, so the service isn't affected. The Shorts tab shows how far it has got. By default it starts by itself after each recording longer than 10 minutes. "Make shorts" starts it by hand.

## The Shorts tab

- **Recordings:** listed on the left, each marked camera or sound only, songs marked, and how many shorts it has.
- **Shorts:** shown as tall cards marked Sermon or Worship, with their length and status (To look at, Approved, Posted).
- **Opening a short:**
  - Play it, and change its title, description and hashtags.
  - **Trim** it by dragging the handles or using ±1 s; it's made again with the change.
  - Edit the captions, or turn them off.
  - **Approve** it, **Delete** it, **Download** it, or **Copy caption**.
  - **Make another from here** makes a new short starting at the moment the video is at.
- **Posting:** a short must be approved first. Each post is kept in a history with its link. Any change after approving sets it back to To look at.
- **Settings:**
  - shorts per service (default 5), shortest and longest (default 30–60 s), the sermon/worship mix, and whether the AI helps;
  - framing;
  - captions: size, words per line, colours, outline, position, capitals and a box;
  - the logo (corner, size), intro and outro;
  - YouTube privacy, hashtags on every short, and whether TikTok posts directly.
- Files are kept in `<recordings folder>/Shorts/<recording name>/`.

## Key moments (10.3)

**Sermon.** The picker reads the sermon's shape from its words:
- the **main points** ("first…", "the second thing…", "finally…"), which also become the full sermon video's chapters;
- the **big idea**: the line it keeps coming back to, or "if you remember one thing…";
- the **call to action** ("this week…", "will you…");
- **scripture being explained** ("the word here means…", "in the Greek…");
- **an illustration's payoff**: a story, then its turn ("that's when…", "and that's what God…").

**Worship.** From the song markers and the sound:
- the **first chorus lifting off** (louder than what came before);
- a **bridge that builds**;
- the **last big chorus**;
- **spontaneous moments**: a part that isn't in the arrangement, such as a vamp or "spontaneous";
- **the room singing**.

## Learning what the church likes (10.3)

Every review action is a lesson, kept on the main admin's computer:
- approved as it was;
- trimmed (how far the start and end moved);
- captions corrected or turned off;
- title rewritten;
- deleted, with an optional one-tap reason: boring, cut off mid-thought, wrong moment, audio bad;
- posted.

Once posted, how the short did is read back every 6 hours for 45 days:
- **YouTube:** views, average view duration, likes and shares, through the YouTube Analytics API.
- **Instagram:** views, likes, shares and average watch time.
- **Facebook:** plays and average watch time.
- **TikTok:** not yet. Its posts go through the TikTok inbox, which doesn't give the video back.

From these it learns:
- **A small scoring model** (logistic) over the signals the picker measures: the words, the voice's energy, the room answering, the AI's rating, the key moments, the song section, the length.
  - It starts at the tuned starting weights below, so a new church gets sensible picks from day one.
  - Each week's lessons pull it toward the church. Older lessons count half as much after 26 weeks.
- **Habits:**
  - its usual length;
  - how much lead-in and run-out it adds when it trims (new shorts are cut that way);
  - whether it turns captions off or writes them in capitals;
  - which kind (sermon or worship) it keeps more, which nudges the sermon/worship mix.
- **Titles:** the titles it rewrote or posted become examples for the AI's next titles.

Settings → Social media → **What the AI has learned** says all of this in plain words, and has **Reset learning**. There's also a switch to stop learning.

The learning file (`shorts-learning.json`) stays on the church's computers. It moves with the hub to the second main admin's computer (hubsync) and isn't sent anywhere else.

### The starting weights: tuned on free-to-use recordings

We can't use other churches' YouTube streams; downloading them breaks YouTube's terms and their copyright. The starting weights were tuned on recordings whose licences clearly allow it. Each licence was checked on its Internet Archive page:

| Recording | Licence | Used for |
| --- | --- | --- |
| [A Famine in the Land](https://archive.org/details/2018-07-15SermonAFamineInTheLand), Rev. Adriene Thorne | CC BY-SA 4.0 | sermon |
| [Reparenting Jesus](https://archive.org/details/2023-05-14-sermon-reparenting-jesus), Rebecca Stevens-Walter | CC BY-SA 4.0 | sermon |
| [The Golden Rule](https://archive.org/details/TheGoldenRule) | CC BY 3.0 | sermon |
| [Sermon and anthem at Sardis Presbyterian](https://archive.org/details/pwinklersept172006_worship) | CC BY 3.0 | sermon, music detection |
| [The Call to Worship](https://archive.org/details/jeremiah2013-04-28) | CC0 | sermon |
| [Sunday Christmas service](https://archive.org/details/Sunday-Christmas), Calgary World Harvest | CC BY 3.0 US | whole service: songs and sermon detection |
| [Three Sermons on Hebrews 1:1-2](https://archive.org/details/threesermonsonhebrews1_2501_librivox), Goodwin (LibriVox) | public domain | sermon text |
| [Sowing and Reaping](https://archive.org/details/sowingandreaping_2007_librivox), D. L. Moody (LibriVox) | public domain | sermon text |

Anything with a non-commercial (NC) or no-derivatives (ND) licence was skipped, and so were recordings of modern worship songs, whose song copyright a recording's licence can't clear.

- **What's kept:** the recordings and their transcripts are not in the repository and don't ship. Only the fitted weights are kept (`central-usage/shorts/defaults.json`, under `tuned`), plus `tools/shorts-tuning/ratings.json`, which holds each passage's recording, times and rating but not its words.
- **How it was done:** `tools/tune-shorts.mjs` transcribes nothing itself. It reads the transcripts and sound features the shorts worker would make, then picks 8 candidate passages per recording (64 in all).
- **Rating:** each passage was rated 1–5 for "would someone scrolling, who never heard the rest, watch this?". The ratings were done by Claude reading the transcripts, not by the church.
- **Fitting:** the weights were fitted and held close to the hand-set ones.

Result:

| | Mean rating of each recording's top 3 | First pick rated 4–5 |
| --- | --- | --- |
| Hand-set starting weights | 2.75 | 25% |
| Tuned, judged on recordings it didn't see (leave one out) | 2.83 | 25% |
| A random passage, for comparison | 2.69 | |

The gain is small and the set is small (8 recordings, 64 passages), so the tuning moved the weights only a little:
- The **main-point headings alone** count less: "First, …" on its own isn't a good short.
- **"Ends on a pause"** counts less.
- **Explaining scripture** and **speaking to the listener** count slightly more.

The bigger gains are expected from each church's own lessons. In the tests, a church that keeps its stories gets mostly stories after six weeks.

The worship tuning is detection only. On the Christmas service the songs and the 21-minute sermon were found, but there was no person-checked ground truth for the worship moments.

## Social media settings (10.3)

Settings → **Social media**, on the main admin's computer, holds everything about shorts and posting in one place:
- the accounts, with each one's name and picture, Connect and Disconnect;
- how many shorts, the length range and the sermon/worship mix;
- the captions, logo, intro and outro;
- what the AI has learned;
- the posting schedule;
- what each post says;
- the full videos.

The Shorts tab's **Settings** button opens the same settings.

### The posting queue and schedule

- **Getting into the queue:** an approved short goes into the queue once for each platform that's switched on, at that platform's next posting time. Un-approving it takes it back out.
- **Posting times:** for example "every day at 11:00", or "Mon, Wed, Fri at 9:00 and 18:30". A platform can have times of its own. There's also a start date.
- **Spacing:** never two posts on one platform closer than the gap (3 hours by default), and the platforms spread a few minutes apart (10 by default).
- **Each item** has **Post now**, **Later** (the next free time), **Skip**, and **Try again** after a failure.
- **Retries:** a failed post is tried again after 5 minutes, 30 minutes, 2 hours and 6 hours, then waits for Try again.
- **History:** every post is kept on the short and in the history, with its link.
- **Where it runs: the main admin's computer posts** (the videos are there).
  - If it's off at a posting time, what came due posts when it next comes on, one per platform at a time and spaced by the gap. A weekend away doesn't turn into ten posts at once.
  - We chose this over uploading every video to the website so the website could post it: that would double the upload, store gigabytes per church, and need the website to hold posting rights all the time. The cost is that nothing posts while the computer stays off.
  - The page hands the church's website sign-in to the queue when Central Control opens.

### What each post says

- **The description template:** `{description}`, `{link}`, `{links}`, `{hashtags}`, `{title}`, `{church}`, `{date}`. A line whose link is empty is left out.
- **What `{link}` points to:**
  - the YouTube live stream of that service (the broadcast that started closest to the recording, read from the church's YouTube connection);
  - the posted full sermon video;
  - a page the church chooses;
  - nothing.

### Full videos

These are optional, each with its own settings: on or off, a title template (`{date}`, `{speaker}`, `{scripture}`, `{sermon}`), privacy (public, unlisted or private), a YouTube playlist (found by name or made), YouTube and/or Facebook, and "post it without waiting for approval".

- **Worship:** the worship set, from the song markers or the songs found in the sound. Prayer or talking under 4 minutes between songs stays in. It starts where the music breathes and ends after the last ring. The description lists the songs with their times and an optional CCLI line.
- **Sermon:** from its first sentence to its last. The description has the speaker, the scripture and **chapters**: the main points with their times, from 0:00, at least three. YouTube reads these as chapters.
- **Format:** 16:9 at 1080p or 720p, the sound at −14 LUFS, a thumbnail of a frame with the title on it.
- **When approved:** they go into the queue for the next posting time, or straight away (a setting).

## Connecting the church's accounts

On the Shorts tab, **Accounts → Connect** opens the platform's own sign-in page in the browser. Central Control never sees the passwords.

- The connection belongs to the church's Motion Audio account, so any admin of the church can post with it.
- The website keeps the tokens encrypted with `TOKEN_SECRET`. It hands Central Control a fresh token each time it posts.
- The video goes straight from the computer to the platform.
- **Facebook and Instagram share one sign-in.** Shorts go to the Facebook Page and to the Instagram professional account linked to that Page.

Each platform stays switched off until Motion Audio adds its app keys in Render (below). Until then, the Shorts tab says so and offers Download and Copy caption.

## For Motion Audio: registering the apps

In each platform, the redirect address is `https://<your website>/v1/social/<platform>/callback`, using the website's real address (`PUBLIC_URL`). Put the keys in Render → motion-audio → Environment; never put them in the code.

### YouTube (Google)

1. Go to <https://console.cloud.google.com/>, create a project "Motion Audio", and enable the **YouTube Data API v3**.
2. Under **OAuth consent screen**:
   - choose External;
   - fill in the app name, support email, logo, and the privacy policy and terms pages of the website;
   - add the scopes `youtube.upload`, `youtube.readonly`, `yt-analytics.readonly` (how shorts did, 10.3) and `youtube.force-ssl` (playlists for the full videos and finding the live stream, 10.3).
3. Under **Credentials**:
   - choose Create credentials → OAuth client ID → Web application;
   - set the authorised redirect URI to `https://<your website>/v1/social/youtube/callback`.
4. In Render, set `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET`.
5. Until Google verifies the app, only test users added on the consent screen can connect, up to 100. Submit the app for **verification**; `youtube.upload` is a sensitive scope, so Google asks for a short screen recording of the Connect and post flow.
6. Uploads cost YouTube API quota: about 1,600 units each, and the default allowance is 10,000 a day, so about 6 uploads a day across every church. Ask for more quota through the **YouTube API quota extension form** before launch.

### Facebook and Instagram (Meta)

1. Go to <https://developers.facebook.com/>, choose My Apps → Create app → type **Business**, and connect it to Motion Audio's Business portfolio.
2. Add the products **Facebook Login for Business** and **Instagram** (Instagram API with Facebook Login).
3. Under Facebook Login → Settings, set the valid OAuth redirect URI to `https://<your website>/v1/social/meta/callback`.
4. Request these permissions in **App Review**:
   - `pages_show_list`
   - `pages_read_engagement`
   - `pages_manage_posts`
   - `publish_video`
   - `instagram_basic`
   - `instagram_content_publish`
   - `instagram_manage_insights` (how Reels did, 10.3)
   - `read_insights` (how Facebook reels did, 10.3)
   - `business_management`

   Meta asks for a screen recording of the flow and a test account.
5. Complete **Business verification** for Motion Audio. App Review needs it.
6. In Render, set `META_APP_ID` and `META_APP_SECRET`. The app's admins and testers can connect while the app is in development mode; switch it to **Live** once the review passes.
7. Churches that connected before 10.3 connect again once, so that the new permissions are granted. Settings → Social media says so next to the account.
8. Churches need a Facebook Page, plus an Instagram **professional** (Business or Creator) account linked to it, for Instagram.

### TikTok

1. Go to <https://developers.tiktok.com/>, register as a developer, and create an app for Motion Audio.
2. Add the products **Login Kit** and **Content Posting API**.
3. Add the scopes `user.info.basic`, `video.upload` and `video.publish`.
4. Set the redirect URI to `https://<your website>/v1/social/tiktok/callback`, and verify the website's domain as TikTok asks.
5. In Render, set `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET`.
6. Until TikTok's **audit** of the app passes, posts go into the account's **TikTok inbox**, where someone opens the TikTok app and taps Post.
7. After the audit, posting goes out directly. Turn that on per computer under Shorts → Settings → "TikTok: post straight away".
8. Until the audit, TikTok also limits posts to private accounts. Submit the audit once the flow is ready.

## Files

- `central-usage/shorts/`:
  - `pick.js`: songs, sermon and the moments;
  - `audio.js`: reading the recording, lining it up, movement;
  - `captions.js`;
  - `render.js`: ffmpeg;
  - `ai.js`: the local model;
  - `worker.js`: the job;
  - `post.js`: the four platforms, the full videos, the live stream's link;
  - `learn.js`: learning what the church likes, and `defaults.json`, the starting weights;
  - `analytics.js`: how posted shorts did;
  - `schedule.js`: the posting queue and its times;
  - `full.js`: the full worship and sermon videos;
  - `index.js`: the main-process service;
  - `fonts/`: Archivo, OFL.
- `central-usage/app/shorts.js` and `shorts.css`: the Shorts tab.
- `server/src/social.js`: the connections, and the `social_accounts` table.
- Tests:
  - `central-usage/test-shorts.mjs`: the rules, plus a whole made-up service through real ffmpeg;
  - `central-usage/test-shorts-ui.mjs`: the tab;
  - `server/test/v102-social.mjs`: the connections, plus posting and reading the numbers against stand-ins of the four platforms;
  - `central-usage/test-shorts-learn.mjs`: synthetic churches' feedback moves the picks the right way, and Reset learning;
  - `central-usage/test-shorts-social.mjs`: the schedule, the queue, retries, the full videos and the link to the service.
- `tools/tune-shorts.mjs` and `tools/shorts-tuning/ratings.json`: tuning the starting weights.
