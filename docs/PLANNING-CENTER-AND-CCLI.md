# Planning Center and CCLI

A church's Planning Center plans can become Central setlists, and every song that's shown on a screen is noted for the church's CCLI report. Both already work with files. The direct connections switch on once Motion Audio is registered with each service, and the steps for that are at the end.

## Planning Center

You'll find it in a few places. On the website it's under Account → Planning Center. In Central Control it's Settings → Planning Center. On the pedal and in Central Pedal Control it's Settings → Planning Center & CCLI, and Setlists → Load setlist → From Planning Center.

### Connecting

A main admin connects by signing in with the church's own Planning Center account. The website keeps that sign-in sealed on the church's account, so every device in the church can see the plans. Only main admins can connect or disconnect. Admins can bring plans in.

### Making a setlist

Pick a service type, then a plan. The setlist is named after the service and the day, and it brings in the plan's songs in order with their keys, arrangements, lengths, CCLI numbers and writers. It also brings the whole order of service (headers, the welcome, the sermon, videos, with their lengths and notes) and the team, including who has confirmed.

Each song is matched to Central Tracks by its CCLI number first and then by its title. Songs the church owns go in ready to play. The others are listed with what you can do about them, which is buy them or add them with Central Tracks Unlimited. On a device, a song the church already has is found by its number or its name.

### Keeping up with the plan

Services in the next 30 days are checked every 15 minutes, and **Check for changes** does it straight away. When the plan changes, the setlist follows: a new key, a song added or taken out, a player who declined. Songs you added in the apps or on the website stay where they are, after the plan's songs.

### Bringing in a plan from a file

This doesn't need a sign-in. You can use a CSV exported from Planning Center, or any CSV with a title column. Type, length, key, BPM, arrangement, writers, CCLI and notes columns are optional, and you can add a team table with name and position columns. A plain list with one item per line also works, like "4:30 Amazing Grace - G". So does Planning Center's JSON.

### Run sheets

Run sheet tools connect with `pco.setRunSheetMaker(fn)`, which is given each imported plan's items, team and setlist.

## CCLI

### SongSelect files

In the song editor, **Upload a PDF / text chart** accepts SongSelect's lyrics (.txt), its import file (.usr) and ChordPro (.cho, .pro, .chopro). The song picks up its title, writers, copyright and CCLI number, and its sections, words and chords become the chart that the lyric screens and chord charts read. The song editor also has fields to type in or correct the CCLI number, writers and copyright.

### The copyright line

CCLI asks churches to show each song's title, writers, copyright, CCLI song number and the church's licence number. Central shows that line on the lyric screens, which means the pedal's projector screen and Central Control's slides and NDI. It's on by default, on the first slide of each song. A main admin can move it to the last slide or every slide, change the wording, or turn it off. Public domain hymns show only the title, the writers and "Public Domain".

### What counts as shown

A song counts as shown when its words go up on a real screen. That's the pedal's HDMI port showing lyrics with a monitor plugged in and not blanked, or Central Control's lyric slides going to a screen, to NDI or to the pedal. Each song counts once per kind per day for the whole church, however many screens showed it. Anything counted while a device was offline waits there and is sent later.

### The report

Pick the dates and press **Show the report**, on the website, in Central Control or in the pedal apps. It lists each song with its number and how many times it was shown, printed, recorded and streamed. **Download the file for CCLI** gives you a CSV with the columns CCLI's reporting asks for (Digital, Print, Record, Translate and Stream) and the licence numbers, ready to enter on CCLI's reporting page.

### Still to come

Searching SongSelect from inside the apps and sending the report straight to CCLI both need CCLI to approve Motion Audio as a partner. Until then, the apps and the website say so. All the CCLI code is in `server/src/ccli-partner.js`.

Streaming, recording and printing aren't counted automatically yet. The API accepts those kinds, but nothing sends them so far, including the record and stream jobs in Central Control and printing charts.

## Registering Motion Audio

### Planning Center (free)

1. Sign in at **api.planningcenteronline.com** with any Planning Center account. Motion Audio's own church account is fine.
2. Open **Developer → My Apps → New Application**. Call it "Motion Audio Central", put your site's address as the website, set the callback URL to `https://<your-domain>/pco/callback` (the website's exact address followed by `/pco/callback`), and choose the Services scope.
3. Copy the **Client ID** and the **Secret**.
4. In Render, open the `motion-audio` service → Environment, add `PCO_CLIENT_ID` and `PCO_CLIENT_SECRET`, and save. Render restarts the site.
5. Check it worked. Account → Planning Center should now show **Connect Planning Center** to a main admin. Connect a test church and make a setlist from a plan. If the button isn't there, check the two values in Render and that the site finished restarting.
6. If you like, set `PCO_REFRESH_MINUTES` to change how often upcoming setlists follow their plans. It's 15 by default, and 0 means only when someone asks.

Planning Center doesn't review apps that churches sign into themselves. If a lot of churches end up using it, read Planning Center's API terms. Rate limits are per church account.

### CCLI (partner application)

1. Go to CCLI's partner page (**ccli.com → Partners**, or email CCLI's partner team) and apply to integrate **SongSelect** (search and import) and **reporting**. Describe Central as worship software that shows lyrics and streams and records services.
2. CCLI reviews the application. Approved partners get the documentation and keys.
3. When they arrive, put the keys in Render as `CCLI_PARTNER_ID`, `CCLI_CLIENT_ID` and `CCLI_CLIENT_SECRET`, and send the documentation to the developer. The adapter in `server/src/ccli-partner.js` gets written from it, and then the apps show SongSelect search and **Send to CCLI**.

Until then, churches bring in SongSelect files and enter the downloaded report on CCLI's site.
