# Signed installers (10.3)

Unsigned apps make Macs say the app "can't be opened because Apple cannot check it", and make Windows show a blue
"Windows protected your PC" box. Signing removes both. The build is ready: it signs as soon as the secrets below are
added to GitHub (the repository → **Settings → Secrets and variables → Actions → New repository secret**).
Until then, every installer is built unsigned, exactly as before.

What signs what: `tools/signing-config.js` (tested by `tools/test-signing.mjs`) and the `macos` and `windows` jobs in
`.github/workflows/build.yml`. Never put a certificate, a password or a key in the repository.

## Mac: Apple Developer ID (about $99 a year)

1. **Join the Apple Developer Program.** Go to developer.apple.com → Account and enrol, as an organisation if Motion
   Audio is a registered business (you'll need a D-U-N-S number, which is free), or as an individual. Approval takes a
   day to a couple of weeks.
2. **Make the certificate.** On a Mac:
   - Open Keychain Access → Certificate Assistant → *Request a Certificate From a Certificate Authority*. Use your
     email, choose "Saved to disk", and save the file.
   - On developer.apple.com → Certificates → **+** → **Developer ID Application**, upload that file, and download the
     certificate. Double-click it to add it to the keychain.
   - In Keychain Access → My Certificates, right-click "Developer ID Application: …" → **Export** as a .p12, with a
     strong password.
3. **Turn it into text for GitHub.** In Terminal: `base64 -i Certificates.p12 | pbcopy`. That copies it.
4. **Make an app-specific password** (for notarization): appleid.apple.com → Sign-In and Security → App-Specific
   Passwords → **+**, named "Motion Audio notarize".
5. **Find your Team ID:** developer.apple.com → Account → Membership details (10 letters and numbers).
6. **Add these GitHub Secrets:**

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

The entitlements (`tools/signing/entitlements.mac.plist`) allow what the apps need:
- the microphone and audio interface;
- cameras (the Video tab);
- JavaScript and WebAssembly (JIT);
- loading third-party VST3/CLAP/Audio Units plugins (library validation off).

Notarizing adds a few minutes to each Mac build.

## Windows: three ways

Since mid-2023, certificate authorities only issue code-signing keys on a hardware token or in a cloud vault, so a
plain .pfx file isn't available for new certificates. Pick one of these.

### A. Azure Trusted Signing (recommended: about $10 a month)

Microsoft's signing service. It's trusted straight away (no "reputation" building), and there's no token to plug in.
Check Microsoft's current eligibility rules; it has been open to businesses with some history, and to individual
developers in the US and Canada.

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
   | `AZURE_TS_ENDPOINT` | the account's endpoint, e.g. `https://eus.codesigning.azure.net` |
   | `AZURE_TS_ACCOUNT` | the signing account's name |
   | `AZURE_TS_PROFILE` | the certificate profile's name |
   | `AZURE_TS_PUBLISHER` | the publisher name exactly as on the certificate, e.g. `Motion Audio LLC` |

### B. A certificate from a certificate authority, kept in their cloud (about $200–600 a year)

For example DigiCert KeyLocker, SSL.com eSigner or Sectigo. An EV certificate builds SmartScreen trust fastest.
1. Install their signing tool on the build.
2. Put its full sign command in the `WIN_SIGN_COMMAND` secret, with `{file}` where the file to sign goes, for example
   `signtool sign /tr http://timestamp.digicert.com /td sha256 /fd sha256 /a "{file}"`, plus whatever the tool needs.
3. Put the tool's own login details in the secrets its instructions name. Tell me which provider, and I'll add its
   setup step to the Windows job.

### C. An older .pfx certificate (if you already have one)

Put the .pfx as base64 in `WIN_CSC_LINK` and its password in `WIN_CSC_KEY_PASSWORD`.

With any of these, the next release signs all five Windows installers and the programs inside them.

## Updates

Signed and unsigned builds use the same file names and the same SHA256SUMS check, so the apps' self-updates keep
working. Once a Mac app is signed, it only replaces itself with a new version signed by the same developer team, so a
tampered download can't install even if its checksum were somehow changed too.
