# Planning Center and CCLI

From 10.2 a church's Planning Center plans become Central setlists, and every song shown, streamed, recorded or printed
is noted for the church's CCLI report. Both work today with files. The direct connections switch on once Motion Audio is
registered (the steps are at the end).

## Planning Center

**Where:** website → Account → Planning Center. In Central Control: Settings → Planning Center. In the Central Pedal
apps: Settings → Planning Center & CCLI, and Setlists → Load setlist → From Planning Center.

- **Connect** (a main admin): signs in with the church's own Planning Center account. The website keeps the sign-in
  sealed on the church account, so every device in the church sees the plans. Only main admins connect or disconnect;
  admins bring in plans.
- **Make a setlist:** pick a service type, then a plan. The setlist is named for the service and day. It has:
  - the plan's songs in order, with their keys, arrangements, lengths, CCLI numbers and writers;
  - the whole order of service (headers, welcome, sermon, videos and their lengths and notes);
  - who's on the team and whether they've confirmed.
- **Matching:** each song is matched to Central Tracks by its CCLI number, then by its title. Songs the church owns go
  in ready to play. The rest are listed with what to do: buy them, or add them with Central Tracks Unlimited. On a
  device, a song the church already has is found by its number or name.
- **Follows the plan:** upcoming services (the next 30 days) are checked every 15 minutes, and Check for changes does
  it at once. When the plan changes, the setlist changes: a new key, a song added or taken out, a player who
  declined. Songs added in the apps or on the website stay, after the plan's songs.
- **Import a plan from a file** (no sign-in needed). Accepted files:
  - a CSV exported from Planning Center, or any CSV with a title column (type, length, key, BPM, arrangement,
    writers, CCLI and notes are optional), plus an optional team table with name and position columns;
  - a plain list with one item per line ("4:30 Amazing Grace - G");
  - Planning Center's JSON.
- **Run sheets:** the run sheet work (10.2 service) connects with `pco.setRunSheetMaker(fn)`. It gets each imported
  plan's items, team and setlist.

## CCLI

- **SongSelect files:** in the song editor, Upload a PDF / text chart takes SongSelect's lyrics (.txt), its import
  file (.usr) and ChordPro (.cho, .pro, .chopro). The song gets:
  - its title, writers, copyright and CCLI number;
  - its sections, words and chords as the chart. The lyric screens and the chord charts read it.

  The song editor also has fields to type or fix the CCLI number, writers and copyright.
- **The copyright line:** CCLI asks churches to show each song's title, writers, copyright, CCLI song number and the
  church's licence number. The line shows on the lyric screens: the Central Pedal's projector screen and Central
  Control's slides and NDI. It's on by default, on each song's first slide. A main admin can set it to the last slide
  or every slide, change the wording, or turn it off. Public-domain hymns show only the title, writers and "Public
  Domain".
- **Usage:** a song counts as shown when its words go up on a real screen. That means:
  - the pedal's HDMI port showing the lyrics with a monitor plugged in and not blanked;
  - Central Control's lyric slides going to a screen, NDI or the pedal.

  Each song counts once per kind and day for the whole church, however many screens show it. Usage made offline
  waits on the device and is sent later.
- **The report:** pick the dates, then Show the report (on the website, Central Control or the pedal apps). It lists
  each song with its number and how many times it was shown, printed, recorded and streamed. Download the file for
  CCLI gives a CSV with the columns CCLI's reporting asks for (Digital, Print, Record, Translate, Stream) and the
  licence numbers, ready to enter on CCLI's reporting page.
- **Waiting for CCLI:** searching SongSelect from inside the apps and sending the report straight to CCLI need CCLI
  partner approval. Until then the apps and the website say so. All the CCLI code lives in
  `server/src/ccli-partner.js`.

**Not counted automatically yet** (the API takes these kinds, but no app sends them yet):
- streaming, recording and printing;
- the record and stream jobs in Central Control;
- printing charts.

## Registering Motion Audio

### Planning Center (free)
1. Sign in at **api.planningcenteronline.com** with a Planning Center account. Any account works; Motion Audio's own
   church account is fine.
2. Open **Developer → My Apps → New Application**.
   - Name: "Motion Audio Central".
   - Website: your site's address.
   - Callback URL: `https://<your-domain>/pco/callback` (the exact address of the website, with `/pco/callback`).
   - Scope: Services.
3. Copy the **Client ID** and **Secret**.
4. In Render, on the `motion-audio` service → Environment, add `PCO_CLIENT_ID` and `PCO_CLIENT_SECRET`, then save.
   Render restarts the site.
5. Check it: Account → Planning Center now shows **Connect Planning Center** for a main admin. Connect a test church
   and make a setlist from a plan.
6. Optional: `PCO_REFRESH_MINUTES` (default 15) sets how often upcoming setlists follow their plans. 0 means only when
   asked.

Planning Center doesn't review apps used by churches that sign in themselves. If many churches use it, read
Planning Center's API terms (rate limits are per church account).

### CCLI (partner application)
1. Go to CCLI's partner page (**ccli.com → Partners**, or email CCLI's partner team) and apply to integrate
   **SongSelect** (search and import) and **reporting**. Describe Central: worship software that shows lyrics,
   streams and records services.
2. CCLI reviews the application. Approved partners get the documentation and keys.
3. When they arrive:
   - put them in Render as `CCLI_PARTNER_ID`, `CCLI_CLIENT_ID` and `CCLI_CLIENT_SECRET`;
   - send the documentation to the developer. The adapter in `server/src/ccli-partner.js` is written from it, and
     the apps then show SongSelect search and Send to CCLI.
4. Until then, churches import SongSelect files and enter the downloaded report on CCLI's site.
