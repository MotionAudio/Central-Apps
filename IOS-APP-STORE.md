# The iPhone and iPad apps

Two apps are ready to go to Apple once there's a developer account:

| App | Project | Bundle ID | What it does |
|---|---|---|---|
| **Central Usage** | `central-usage-mobile/` | `org.centralcontrol.usage` | Finds the main admin's computer on the Wi-Fi and opens Central Usage full screen, with the chart, lyrics, instrument and your in-ear mix. The in-ear mix keeps playing with the screen locked. |
| **Central Pedal Control** | `central-pedal-control-mobile/` | `org.centralcontrol.pedalcontrol` | The pedal's app on an iPhone or iPad. Set up songs, tracks, pads and controls anywhere, then upload them to the pedal. |

Until then, iPhones and iPads use them in Safari: Central Usage from the main admin's computer (`http://<main admin>:8095/cu/`), and Central Pedal Control from the pedal (`http://padpedal.local:8080/control/`). Tap Share → **Add to Home Screen** and they open like apps. None of that needs anything from Apple. The Android versions are already on the download page.

Once the steps below are done, every release builds both apps, signs them and uploads them to App Store Connect by itself (the `ios` job in `release.yml`). Until then, that job skips itself.

## What you need

1. **An Apple Developer Program membership.** It's $99 a year at https://developer.apple.com/programs/, either as yourself or as an organisation (which needs a D-U-N-S number). Approval takes a day or two.
2. **A record for each app in App Store Connect.** First register each bundle ID under Certificates, IDs & Profiles → Identifiers → **+** → App IDs. Then in https://appstoreconnect.apple.com go to Apps → **+** → New App, twice: platform iOS, name *Central Usage* with `org.centralcontrol.usage`, and name *Central Pedal Control* with `org.centralcontrol.pedalcontrol`. The SKU can be anything.
3. **An App Store Connect API key.** In App Store Connect, go to Users and Access → **Integrations** → App Store Connect API → **+**, and give it **Admin** access, which the build needs to make its own signing certificate. Download the `.p8` file (you only get one chance) and note the **Key ID** and **Issuer ID**.
4. **Your Team ID**, from developer.apple.com → Account → Membership details.

## Give them to GitHub

In the repository, go to **Settings → Secrets and variables → Actions → New repository secret** and add these four:

| Secret | What goes in it |
|---|---|
| `APPLE_TEAM_ID` | The Team ID (10 characters) |
| `APP_STORE_CONNECT_API_KEY_ID` | The Key ID |
| `APP_STORE_CONNECT_ISSUER_ID` | The Issuer ID |
| `APP_STORE_CONNECT_API_KEY` | Everything in the `.p8` file, including the BEGIN and END lines |

The next release uploads a build. Apple takes 15 to 60 minutes to process it, and then it shows up under TestFlight in App Store Connect, where you can add your team as testers. To put an app in the App Store, fill in the store listing (screenshots, a description, and privacy set to *no data collected*) and press **Submit for Review**. After that, each release uploads a new build by itself, and you decide when a build goes to the store.

## Good to know

- Xcode signs the apps with the API key, so there are no certificates or profiles to keep renewing.
- The apps talk to the main admin's computer and the pedal over plain HTTP on the local network. That's allowed for local networking and is fine for review. In the review notes, say it "connects to the user's own Central Pedal device on their local network".
- Apple's reviewers need to see the app working. Add a note that it needs a Central Pedal (a Raspberry Pi) or the main admin's computer on the same Wi-Fi, and attach a short screen recording.
- To try one on your own device first, on a Mac with Xcode run `bash central-usage-mobile/prepare.sh ios` (or `bash central-pedal-control-mobile/prepare.sh ios`), open `ios/App/App.xcworkspace` in that folder, pick your iPhone or iPad and press Run. A free Apple ID works on your own device for 7 days.
