# iPhone and iPad apps (TestFlight / App Store)

Two apps go to Apple:

| App | Project | Bundle ID | What it is |
|---|---|---|---|
| **Central Usage** (iPhone, iPad) | `central-usage-mobile/` | `org.centralcontrol.usage` | finds the main admin's computer on the Wi-Fi and opens Central Usage - the chord chart, the lyrics, the instrument and your in-ear mix, full screen; keeps playing the in-ear mix with the screen locked |
| **Central Pedal Control** (iPhone, iPad) | `central-pedal-control-mobile/` | `org.centralcontrol.pedalcontrol` | the Central Pedal app on the iPhone and iPad: set up songs, tracks, pads and controls anywhere, then Upload them to the Central Pedal |

Until they are on TestFlight, iPhones and iPads use Central Usage as a **web app**: Safari → the main admin's
address (`http://<main admin>:8095/cu/`) → Share → **Add to Home Screen**. That needs nothing from Apple.

Once the steps below are done, **every release builds both, signs them and uploads them to App Store Connect
automatically** (release.yml, job `ios`). Until then that job does nothing. (Android: the Central Usage and Central Pedal Control `.apk` files
are on the download page already - INSTALL.md.)

## What you need

1. **An Apple Developer Program membership**: $99 a year, at https://developer.apple.com/programs/
   (as yourself or your church; an organisation needs a D-U-N-S number). Approval takes a day or two.
2. **Each app's record in App Store Connect** (https://appstoreconnect.apple.com → Apps → **+** → New App),
   twice: platform iOS, name *Central Usage* with bundle ID `org.centralcontrol.usage`, and name *Central Pedal
   Control* with bundle ID `org.centralcontrol.pedalcontrol` (register each first under Certificates, IDs &
   Profiles → Identifiers → **+** → App IDs), SKU anything.
3. **An App Store Connect API key**: App Store Connect → Users and Access → **Integrations** → App Store
   Connect API → **+**, access **Admin** (needed so the build can create its own signing certificate).
   Download the `.p8` file (only possible once) and note the **Key ID** and the **Issuer ID**.
4. Your **Team ID**: developer.apple.com → Account → Membership details.

## Give them to GitHub

Repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**, four times:

| Secret | Value |
|---|---|
| `APPLE_TEAM_ID` | the Team ID (10 characters) |
| `APP_STORE_CONNECT_API_KEY_ID` | the Key ID |
| `APP_STORE_CONNECT_ISSUER_ID` | the Issuer ID |
| `APP_STORE_CONNECT_API_KEY` | the whole content of the `.p8` file, including the BEGIN / END lines |

The next release uploads a build. After Apple processes it (about 15 to 60 minutes), it shows in App
Store Connect → TestFlight: add testers (your team) there. To put it in the App Store, fill in the store
listing (screenshots, description, privacy: *no data collected*) and **Submit for Review**. Every later
release uploads a new build by itself; you choose when a build goes to the store.

## Notes

- Signing is done by Xcode with the API key (cloud signing), so there are no certificates or profiles
  to keep up to date.
- The apps talk to the main admin's computer and the Central Pedal over plain HTTP on the local network. That is allowed in the app
  (local networking) and is fine for review. Explain it in the review notes as "connects to the user's
  own Central Pedal device on their local network".
- Apple's review needs a way to see the app working. Add a note that it needs a Central Pedal (a
  Raspberry Pi) on the same Wi-Fi, and attach a short screen recording.
- To try one yourself before that: on a Mac with Xcode, run `bash central-usage-mobile/prepare.sh ios` (or
  `bash central-pedal-control-mobile/prepare.sh ios`), open `ios/App/App.xcworkspace` in that folder, pick your
  iPhone / iPad and press Run (a free Apple ID works for your own device for 7 days).
