# Signing the installers

When an app isn't signed, a Mac says it "can't be opened because Apple cannot check it", and Windows shows a blue "Windows protected your PC" box. Signing gets rid of both. The build is already set up for it and starts signing as soon as the secrets below are added to GitHub, under the repository's **Settings → Secrets and variables → Actions → New repository secret**. Until then, every installer is built unsigned, the same as now.

The signing is set up in `tools/signing-config.js` (tested by `tools/test-signing.mjs`) and in the `macos` and `windows` jobs in `.github/workflows/build.yml`. Never put a certificate, a password or a key in the repository.

You'll need about $99 a year for Apple and somewhere between $10 a month and a few hundred dollars a year for Windows, depending on the route you pick. Setting up the Mac side takes an afternoon once Apple has approved you.

## Mac: Apple Developer ID (about $99 a year)

1. **Join the Apple Developer Program.** Go to developer.apple.com → Account and enrol, as an organisation if Motion
   Audio is a registered business (you'll need a D-U-N-S number, which is free), or as an individual. Approval takes a
   day to a couple of weeks.
2. **Make the certificate on a Mac.** Open Keychain Access → Certificate Assistant → *Request a Certificate From a
   Certificate Authority*, use your email, choose "Saved to disk", and save the file. Then on developer.apple.com go to
   Certificates → **+** → **Developer ID Application**, upload that file, download the certificate, and double-click it
   to add it to the keychain. Finally, in Keychain Access → My Certificates, right-click "Developer ID Application: …"
   and **Export** it as a .p12 with a strong password. If "Developer ID Application" is greyed out, only the account
   holder can make one, so sign in as them.
3. **Turn it into text for GitHub.** In Terminal, run `base64 -i Certificates.p12 | pbcopy`, which copies it.
4. **Make an app-specific password** for notarizing. Go to appleid.apple.com → Sign-In and Security → App-Specific
   Passwords → **+** and call it "Motion Audio notarize".
5. **Find your Team ID** under developer.apple.com → Account → Membership details. It's 10 letters and numbers.
6. **Add these GitHub secrets.**

   | Secret | What goes in it |
   |---|---|
   | `MAC_CSC_LINK` | the base64 text from step 3 |
   | `MAC_CSC_KEY_PASSWORD` | the .p12's password |
   | `APPLE_ID` | the Apple ID email of the developer account |
   | `APPLE_APP_SPECIFIC_PASSWORD` | the password from step 4 |
   | `APPLE_TEAM_ID` | the Team ID from step 5 |

The next release then signs all five Mac apps (Central Control, Central Usage, Central Pedal Control, Central Services
and Central Production), including every helper inside them (cu-rig, cm-plugbridge, ffmpeg, llama-server and the
rest). It also turns on the hardened runtime, sends each app to Apple to be notarized, and staples the result. The Mac
build checks this before it publishes anything.

The entitlements in `tools/signing/entitlements.mac.plist` allow what the apps need: the microphone and audio interface, cameras for the Video tab, JIT for JavaScript and WebAssembly, and loading other people's VST3, CLAP and Audio Units plugins (library validation is off).

Notarizing adds a few minutes to each Mac build.

## Windows

Since mid-2023, certificate authorities only issue code-signing keys on a hardware token or in a cloud vault, so a
plain .pfx file isn't available for new certificates. Pick one of these.

### A. Azure Trusted Signing (about $10 a month, and the one I'd pick)

This is Microsoft's own signing service. It's trusted straight away, so there's no reputation to build up, and there's no token to plug in. Check Microsoft's current rules on who can use it. It has been open to businesses with some history and to individual developers in the US and Canada.

1. In the Azure portal, create a **Trusted Signing account** and complete **identity validation** (for the business or
   for you).
2. Create a **certificate profile** ("Public Trust").
3. Create an **app registration** (Microsoft Entra ID → App registrations → New) and a client secret. Give it the
   *Trusted Signing Certificate Profile Signer* role on the signing account.
4. Add these GitHub Secrets:

   | Secret | What goes in it |
   |---|---|
   | `AZURE_TENANT_ID` | the tenant (directory) ID |
   | `AZURE_CLIENT_ID` | the app registration's client ID |
   | `AZURE_CLIENT_SECRET` | the app registration's secret |
   | `AZURE_TS_ENDPOINT` | the account's endpoint, for example `https://eus.codesigning.azure.net` |
   | `AZURE_TS_ACCOUNT` | the signing account's name |
   | `AZURE_TS_PROFILE` | the certificate profile's name |
   | `AZURE_TS_PUBLISHER` | the publisher name exactly as it is on the certificate, for example `Motion Audio LLC` |

### B. A certificate from a certificate authority, kept in their cloud (about $200–600 a year)

DigiCert KeyLocker, SSL.com eSigner and Sectigo all work this way. An EV certificate builds SmartScreen trust the fastest.

1. Install their signing tool on the build.
2. Put its full sign command in the `WIN_SIGN_COMMAND` secret, with `{file}` where the file to sign goes, for example
   `signtool sign /tr http://timestamp.digicert.com /td sha256 /fd sha256 /a "{file}"`, plus whatever the tool needs.
3. Put the tool's own login details in the secrets its instructions name. The Windows job in `build.yml` also needs a
   step that installs that provider's tool, so add one for whichever provider you choose.

### C. An older .pfx certificate (if you already have one)

Put the .pfx as base64 in `WIN_CSC_LINK` and its password in `WIN_CSC_KEY_PASSWORD`.

With any of these, the next release signs all five Windows installers and the programs inside them.

## Updates

Signed and unsigned builds use the same file names and the same SHA256SUMS check, so the apps' self-updates keep
working. Once a Mac app is signed, it only replaces itself with a new version signed by the same developer team, so a
tampered download can't install even if its checksum were somehow changed too.
