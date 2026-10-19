#!/bin/bash
# Makes the Android signing key for Central Usage, once. Every APK is signed with it, so a new version installs over
# the old one. Keep the .keystore file and its password safe (a USB stick in the office) - a lost key means everyone
# uninstalls and installs again.
#   bash tools/make-android-key.sh            (needs Java's keytool: sudo apt install default-jdk-headless)
# Then on GitHub: the repository → Settings → Secrets and variables → Actions → New repository secret, twice:
#   ANDROID_KEYSTORE_B64       the text this prints (the key file, base64)
#   ANDROID_KEYSTORE_PASSWORD  the password you typed
set -euo pipefail
OUT="${1:-central-usage-android.keystore}"
[ -e "$OUT" ] && { echo "$OUT exists already - use it (or move it away)."; exit 1; }
read -r -s -p "A password for the key (6+ characters): " PW; echo
keytool -genkeypair -v -keystore "$OUT" -alias central-usage -keyalg RSA -keysize 4096 -validity 10000 \
  -storepass "$PW" -keypass "$PW" -dname "CN=Central Usage, O=Central Pedal" > /dev/null
echo "Made $OUT. Paste this as the secret ANDROID_KEYSTORE_B64:"; echo
base64 -w0 "$OUT"; echo
