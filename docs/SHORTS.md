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
   - add the scopes `youtube.upload` and `youtube.readonly`.
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
   - `business_management`

   Meta asks for a screen recording of the flow and a test account.
5. Complete **Business verification** for Motion Audio. App Review needs it.
6. In Render, set `META_APP_ID` and `META_APP_SECRET`. The app's admins and testers can connect while the app is in development mode; switch it to **Live** once the review passes.
7. Churches need a Facebook Page, plus an Instagram **professional** (Business or Creator) account linked to it, for Instagram.

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
  - `post.js`: the four platforms;
  - `index.js`: the main-process service;
  - `fonts/`: Archivo, OFL.
- `central-usage/app/shorts.js` and `shorts.css`: the Shorts tab.
- `server/src/social.js`: the connections, and the `social_accounts` table.
- Tests:
  - `central-usage/test-shorts.mjs`: the rules, plus a whole made-up service through real ffmpeg;
  - `central-usage/test-shorts-ui.mjs`: the tab;
  - `server/test/v102-social.mjs`: the connections, plus posting against stand-ins of the four platforms.
