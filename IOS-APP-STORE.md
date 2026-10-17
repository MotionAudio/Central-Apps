# Central Control on the App Store (iPhone / iPad)

Today iPhones and iPads use Central Control as a **web app**: Safari → the Central Pedal's address
(`http://padpedal.local:8080/cu/`) → Share → **Add to Home Screen**. That needs nothing from Apple.

The project in `central-usage-ios/` is the App Store version: a small app that finds the Central Pedal
on the Wi-Fi and opens the same Central Control, full screen. It keeps playing your in-ear mix with the
screen locked, and it appears in the App Store / TestFlight. Once the steps below are done, **every
release builds it, signs it and uploads it to App Store Connect automatically** (release.yml, job `ios`).
Until then that job does nothing.

## What you need

1. **An Apple Developer Program membership**: $99 a year, at https://developer.apple.com/programs/
   (as yourself or your church; an organisation needs a D-U-N-S number). Approval takes a day or two.
2. **The app's record in App Store Connect** (https://appstoreconnect.apple.com → Apps → **+** → New App):
   platform iOS, name *Central Control* (or another free name), bundle ID `org.centralcontrol.usage`
   (register it first under Certificates, IDs & Profiles → Identifiers → **+** → App IDs), SKU anything.
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
- The app talks to the Central Pedal over plain HTTP on the local network. That is allowed in the app
  (local networking) and is fine for review. Explain it in the review notes as "connects to the user's
  own Central Pedal device on their local network".
- Apple's review needs a way to see the app working. Add a note that it needs a Central Pedal (a
  Raspberry Pi) on the same Wi-Fi, and attach a short screen recording.
- To try it yourself before that: on a Mac with Xcode, run `bash central-usage-ios/prepare.sh`, open
  `central-usage-ios/ios/App/App.xcworkspace`, pick your iPhone and press Run (a free Apple ID works for
  your own phone for 7 days).
