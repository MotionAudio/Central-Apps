# Shorts in Central Control

Once a service has been recorded, Central Control finds its best moments in the sermon and the worship and turns each one into a vertical video (9:16, 1080 × 1920) with captions. Someone looks them over on the **Shorts** tab, fixes anything that needs it, approves them, and posts them to YouTube Shorts, Facebook Reels, Instagram Reels and TikTok in one click. Until a platform is connected, you can download the short and copy its caption instead.

Shorts are only made on the **main admin's computer**, because that's the computer that records the service and has the speech and AI models. Nothing is sent anywhere to pick the moments.

## How it works

1. **The recording.** The sound comes from the program or stream-mix recording (Online mix → Record), and the picture comes from the Video tab's camera recording. The two are lined up by their sound, so it doesn't matter if they started at different moments. With no camera recording, each short shows a moving waveform in the church's colour behind the captions.

2. **Finding the songs and the sermon.** While the service records, Central Control notes when each song and section starts, from the tracks. Without those notes, long stretches of music count as songs. The longest stretch of talking counts as the sermon.

3. **The words.** The speech model from Settings → Lyrics (listening) writes down the sermon with the time of every word. If that model isn't installed, shorts are picked from the sound alone and have no captions, and the Shorts tab tells you so.

4. **Picking the moments.** In the sermon, every run of whole sentences that fits the length range gets a score. It scores higher when it's a complete thought that doesn't start halfway through a sentence, when it has strong, quotable lines or a story's payoff, when there's energy in the voice, when there's a pause after it, and when applause, an "amen" or laughter follows. Announcements score lower. The AI model that's already in Central Control for the lights then reads the strongest few dozen and rates each one.

   In the worship, it looks at the choruses, the bridge, the last chorus, and anywhere louder than the rest of the song, and it starts and ends each moment where the music breathes.

   The best moments win. They never overlap, no more than two come from one song, and the split between sermon and worship follows your settings.

5. **Making each short.** The picture follows the speaker with a slow, steady pan when they move, or shows the wide shot over a blurred copy of itself. Captions come up a few words at a time with the word being said lit up. The short gets the logo, the intro and outro if you've set them, and its sound is brought to −14 LUFS, which is the level social apps play at. It also gets an SRT file, a picture for the list, and a title and description drafted by the AI, all of which you can edit.

The work runs in its own process at low priority, so it doesn't affect the service, and the Shorts tab shows how far it's got. By default it starts by itself after any recording longer than 10 minutes. **Make shorts** starts it by hand.

## The Shorts tab

Recordings are listed on the left. Each one says whether it has camera or sound only, marks its songs and shows how many shorts it has. The shorts themselves are tall cards marked Sermon or Worship, with their length and their status: To look at, Approved or Posted.

When you open a short you can play it and change its title, description and hashtags. To **trim** it, drag the handles or use ±1 s, and it's made again with the change. You can edit the captions or turn them off, and **Approve**, **Delete**, **Download** or **Copy caption**. **Make another from here** makes a new short starting wherever the video is.

A short has to be approved before it can be posted. Each post is kept in a history with its link. If you change anything after approving, the short goes back to To look at.

The settings cover how many shorts to make for each service (5 by default), the shortest and longest (30 to 60 seconds by default), the mix of sermon and worship, and whether the AI helps. They also cover framing; caption size, words per line, colours, outline, position, capitals and a box behind them; the logo's corner and size; the intro and outro; YouTube privacy; hashtags to add to every short; and whether TikTok posts directly.

Files are kept in `<recordings folder>/Shorts/<recording name>/`.

## Key moments

In the sermon, the picker reads its shape from the words. It looks for the **main points** ("first…", "the second thing…", "finally…"), which also become the chapters of the full sermon video. It looks for the **big idea**, which is the line the preacher keeps coming back to or something like "if you remember one thing…". It finds the **call to action** ("this week…", "will you…"), **scripture being explained** ("the word here means…", "in the Greek…"), and **the payoff of an illustration**, where a story turns ("that's when…", "and that's what God…").

In the worship, it goes by the song markers and the sound. It looks for the **first chorus lifting off** (louder than what came before), a **bridge that builds**, the **last big chorus**, **spontaneous moments** that aren't in the arrangement, like a vamp or a part marked "spontaneous", and **the room singing**.

## Learning what the church likes

Every review action teaches it something, and the lessons are kept on the main admin's computer. It notes when a short is approved as it was, how far the start and end moved when it was trimmed, when captions were corrected or turned off, when a title was rewritten, when a short was deleted (with an optional one-tap reason: boring, cut off mid-thought, wrong moment, or bad audio), and when it was posted.

After a short is posted, how it did is read back every 6 hours for 45 days. From YouTube that's views, average view duration, likes and shares, through the YouTube Analytics API. From Instagram it's views, likes, shares and average watch time, and from Facebook it's plays and average watch time. TikTok isn't read yet, because its posts go through the TikTok inbox, which doesn't give the video back.

It learns three kinds of thing from all this.

First, there's a small scoring model (logistic) over the signals the picker measures: the words, the energy in the voice, the room responding, the AI's rating, the key moments, the song section and the length. It starts from the tuned starting weights described below, so a new church gets sensible picks from the first day. Each week's lessons pull it towards that church, and lessons older than 26 weeks count half as much.

Second, it picks up the church's habits: its usual length, how much lead-in and run-out it adds when it trims (new shorts are cut the same way), whether it turns captions off or writes them in capitals, and which kind it keeps more of, sermon or worship, which nudges the mix.

Third, the titles the church rewrote or posted become examples for the AI's next titles.

Settings → Social media → **What the AI has learned** explains all of this in plain words and has a **Reset learning** button. There's also a switch to stop it learning.

The learning file, `shorts-learning.json`, stays on the church's computers. It moves with the hub to the second main admin's computer (hubsync) and isn't sent anywhere else.

### The starting weights, tuned on free-to-use recordings

We can't use other churches' YouTube streams, because downloading them breaks YouTube's terms and their copyright. So the starting weights were tuned on recordings whose licences clearly allow it, with each licence checked on its Internet Archive page.

| Recording | Licence | Used for |
| --- | --- | --- |
| [A Famine in the Land](https://archive.org/details/2018-07-15SermonAFamineInTheLand), Rev. Adriene Thorne | CC BY-SA 4.0 | sermon |
| [Reparenting Jesus](https://archive.org/details/2023-05-14-sermon-reparenting-jesus), Rebecca Stevens-Walter | CC BY-SA 4.0 | sermon |
| [The Golden Rule](https://archive.org/details/TheGoldenRule) | CC BY 3.0 | sermon |
| [Sermon and anthem at Sardis Presbyterian](https://archive.org/details/pwinklersept172006_worship) | CC BY 3.0 | sermon, music detection |
| [The Call to Worship](https://archive.org/details/jeremiah2013-04-28) | CC0 | sermon |
| [Sunday Christmas service](https://archive.org/details/Sunday-Christmas), Calgary World Harvest | CC BY 3.0 US | whole service: finding songs and the sermon |
| [Three Sermons on Hebrews 1:1-2](https://archive.org/details/threesermonsonhebrews1_2501_librivox), Goodwin (LibriVox) | public domain | sermon text |
| [Sowing and Reaping](https://archive.org/details/sowingandreaping_2007_librivox), D. L. Moody (LibriVox) | public domain | sermon text |

Anything under a non-commercial (NC) or no-derivatives (ND) licence was skipped. So were recordings of modern worship songs, because a recording's licence can't clear the song's own copyright.

The recordings and their transcripts aren't in the repository and don't ship. All that's kept is the fitted weights, in `central-usage/shorts/defaults.json` under `tuned`, and `tools/shorts-tuning/ratings.json`, which holds each passage's recording, times and rating but not its words.

`tools/tune-shorts.mjs` doesn't transcribe anything itself. It reads the transcripts and sound features the shorts worker would produce, then picks 8 candidate passages from each recording, 64 in all. Each passage was rated from 1 to 5 on whether someone scrolling, who never heard the rest, would watch it. Claude did the ratings by reading the transcripts. The church didn't. The weights were then fitted while being held close to the hand-set ones.

| | Average rating of each recording's top 3 | First pick rated 4 or 5 |
| --- | --- | --- |
| Hand-set starting weights | 2.75 | 25% |
| Tuned, judged on recordings it didn't see (leave one out) | 2.83 | 25% |
| A random passage, for comparison | 2.69 | |

The gain is small, and so is the set (8 recordings, 64 passages), so the tuning only moved the weights a little. Main-point headings on their own count for less, since "First, …" by itself isn't a good short. Ending on a pause counts for less too. Explaining scripture and speaking directly to the listener count for slightly more.

The bigger gains should come from each church's own lessons. In the tests, a church that keeps its stories is getting mostly stories after six weeks.

The worship side was only tuned for detection. On the Christmas service it found the songs and the 21-minute sermon, but nobody had checked the worship moments by hand to compare against.

## Social media settings

Settings → **Social media**, on the main admin's computer, keeps everything about shorts and posting in one place. That's the accounts (each with its name and picture, and Connect and Disconnect), how many shorts to make, the length range and the sermon and worship mix, the captions, logo, intro and outro, what the AI has learned, the posting schedule, what each post says, and the full videos. The **Settings** button on the Shorts tab opens the same page.

### The posting queue and schedule

An approved short goes into the queue once for each platform that's switched on, at that platform's next posting time. Taking the approval away takes it back out of the queue.

Posting times look like "every day at 11:00" or "Mon, Wed, Fri at 9:00 and 18:30". A platform can have its own times, and there's a start date. Two posts on one platform are never closer together than the gap, which is 3 hours by default, and the platforms are spread a few minutes apart (10 by default).

Each item in the queue has **Post now**, **Later** (which moves it to the next free time) and **Skip**, plus **Try again** if it failed. A failed post is retried after 5 minutes, 30 minutes, 2 hours and 6 hours, and after that it waits for someone to press Try again. Every post is kept on the short and in the history, with its link.

The main admin's computer does the posting, because that's where the videos are. If it's off at a posting time, whatever came due goes out when it's next switched on, one per platform at a time and spaced by the gap, so a weekend away doesn't turn into ten posts at once. We chose this over uploading every video to the website and posting from there, because that would double the upload, store gigabytes for every church, and mean the website holding posting rights all the time. The trade-off is that nothing posts while the computer stays off. The page passes the church's website sign-in to the queue when Central Control opens.

### What each post says

The description template can use `{description}`, `{link}`, `{links}`, `{hashtags}`, `{title}`, `{church}` and `{date}`. A line whose link is empty is left out.

`{link}` can point to that service's YouTube live stream (the broadcast that started closest to the recording, read from the church's YouTube connection), to the posted full sermon video, to a page the church picks, or to nothing.

### Full videos

These are optional and each has its own settings: on or off, a title template (`{date}`, `{speaker}`, `{scripture}`, `{sermon}`), privacy (public, unlisted or private), a YouTube playlist (found by name or created), whether it goes to YouTube, Facebook or both, and whether to post without waiting for approval.

The worship video is the worship set, taken from the song markers or from the songs found in the sound. Prayer or talking of under 4 minutes between songs stays in. It starts where the music breathes and ends after the last note rings out. Its description lists the songs with their times and can include a CCLI line.

The sermon video runs from the first sentence to the last. Its description has the speaker, the scripture and **chapters**, which are the main points with their times, starting at 0:00, with at least three. YouTube reads these as chapters.

Both are 16:9 at 1080p or 720p, with the sound at −14 LUFS and a thumbnail made from a frame with the title on it. Once approved, they go into the queue for the next posting time, or straight out if that's how it's set.

## Connecting the church's accounts

On the Shorts tab, **Accounts → Connect** opens the platform's own sign-in page in the browser, so Central Control never sees the passwords. The connection belongs to the church's Motion Audio account, which means any admin of the church can post with it. The website keeps the tokens encrypted with `TOKEN_SECRET` and hands Central Control a fresh token each time it posts. The video itself goes straight from the computer to the platform.

Facebook and Instagram share one sign-in. Shorts go to the Facebook Page and to the Instagram professional account linked to that Page.

Each platform stays switched off until Motion Audio adds its app keys in Render (see below). Until then, the Shorts tab says so and offers Download and Copy caption.

## For Motion Audio: registering the apps

On every platform, the redirect address is `https://<your website>/v1/social/<platform>/callback`, using the website's real address (`PUBLIC_URL`). The keys go in Render → motion-audio → Environment, never in the code.

### YouTube (Google)

1. Go to <https://console.cloud.google.com/>, create a project called "Motion Audio", and enable the **YouTube Data API v3**.
2. Under **OAuth consent screen**, choose External and fill in the app name, support email, logo, and the website's privacy policy and terms pages. Add the scopes `youtube.upload`, `youtube.readonly`, `yt-analytics.readonly` (for reading how shorts did) and `youtube.force-ssl` (for the full videos' playlists and finding the live stream).
3. Under **Credentials**, choose Create credentials → OAuth client ID → Web application, and set the authorised redirect URI to `https://<your website>/v1/social/youtube/callback`.
4. In Render, set `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET`.
5. Until Google verifies the app, only test users added on the consent screen can connect, and there can be up to 100 of them. Submit the app for **verification**. `youtube.upload` is a sensitive scope, so Google asks for a short screen recording of connecting and posting.
6. Each upload costs about 1,600 units of YouTube API quota, and the default allowance is 10,000 a day. That's about 6 uploads a day across every church, so ask for more through the **YouTube API quota extension form** before launch.

### Facebook and Instagram (Meta)

1. Go to <https://developers.facebook.com/>, choose My Apps → Create app → **Business**, and connect it to Motion Audio's Business portfolio.
2. Add the products **Facebook Login for Business** and **Instagram** (Instagram API with Facebook Login).
3. Under Facebook Login → Settings, set the valid OAuth redirect URI to `https://<your website>/v1/social/meta/callback`.
4. In **App Review**, request `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `publish_video`, `instagram_basic`, `instagram_content_publish`, `instagram_manage_insights` (how Reels did), `read_insights` (how Facebook reels did) and `business_management`. Meta asks for a screen recording of the flow and a test account.
5. Complete **Business verification** for Motion Audio, because App Review needs it.
6. In Render, set `META_APP_ID` and `META_APP_SECRET`. While the app is in development mode, its admins and testers can connect. Switch it to **Live** once the review passes.
7. Churches that connected before version 10.3 need to connect again once so the newer permissions are granted. Settings → Social media tells them next to the account.
8. To post to Instagram, a church needs a Facebook Page with an Instagram **professional** account (Business or Creator) linked to it.

### TikTok

1. Go to <https://developers.tiktok.com/>, register as a developer, and create an app for Motion Audio.
2. Add the products **Login Kit** and **Content Posting API**, with the scopes `user.info.basic`, `video.upload` and `video.publish`.
3. Set the redirect URI to `https://<your website>/v1/social/tiktok/callback`, and verify the website's domain the way TikTok asks.
4. In Render, set `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET`.
5. Until TikTok's **audit** of the app passes, posts land in the account's **TikTok inbox**, and someone has to open the TikTok app and tap Post. TikTok also limits posts to private accounts until then, so submit the audit once the flow is ready.
6. Once the audit passes, posts can go out directly. Turn that on for each computer under Shorts → Settings → "TikTok: post straight away".

## Files

| File | What's in it |
| --- | --- |
| `central-usage/shorts/pick.js` | finding the songs, the sermon and the moments |
| `central-usage/shorts/audio.js` | reading the recording, lining it up, movement |
| `central-usage/shorts/captions.js` | captions |
| `central-usage/shorts/render.js` | ffmpeg |
| `central-usage/shorts/ai.js` | the local model |
| `central-usage/shorts/worker.js` | the job |
| `central-usage/shorts/post.js` | the four platforms, the full videos and the live stream's link |
| `central-usage/shorts/learn.js` and `defaults.json` | learning what the church likes, and the starting weights |
| `central-usage/shorts/analytics.js` | how posted shorts did |
| `central-usage/shorts/schedule.js` | the posting queue and its times |
| `central-usage/shorts/full.js` | the full worship and sermon videos |
| `central-usage/shorts/index.js` | the main-process service |
| `central-usage/shorts/fonts/` | Archivo (OFL) |
| `central-usage/app/shorts.js` and `shorts.css` | the Shorts tab |
| `server/src/social.js` | the connections and the `social_accounts` table |
| `tools/tune-shorts.mjs` and `tools/shorts-tuning/ratings.json` | tuning the starting weights |

The tests:

| Test | What it checks |
| --- | --- |
| `central-usage/test-shorts.mjs` | the rules, plus a whole made-up service run through real ffmpeg |
| `central-usage/test-shorts-ui.mjs` | the tab |
| `server/test/v102-social.mjs` | the connections, plus posting and reading the numbers against stand-ins for the four platforms |
| `central-usage/test-shorts-learn.mjs` | made-up churches' feedback moves the picks the right way, and Reset learning works |
| `central-usage/test-shorts-social.mjs` | the schedule, the queue, retries, the full videos and the link to the service |
