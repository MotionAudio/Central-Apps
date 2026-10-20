#!/usr/bin/env bash
# Sets one version on every app (all five share it):   bash tools/bump-version.sh 9.1.1
# Full releases are 9.1, 9.2 ... 9.9, then 10.0; fixes and small updates are the third number (9.1.1).
set -euo pipefail
V="${1:?the version, like 9.1.1}"
[[ "$V" =~ ^[0-9]+\.[0-9]\.[0-9]+$ ]] || { echo "a version like 9.1.1 (the middle number is 0-9)"; exit 1; }
cd "$(dirname "$0")/.."
sed -i -E "s/^APP_VERSION = \"[^\"]+\"/APP_VERSION = \"$V\"/" pedal-driver.py
for p in central-usage central-pedal-control central-services central-usage-mobile central-pedal-control-mobile central-services-mobile; do
  node -e 'const f=process.argv[1]+"/package.json",fs=require("fs"),j=JSON.parse(fs.readFileSync(f));j.version=process.argv[2];fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n")' "$p" "$V"
done
for g in central-usage-mobile central-pedal-control-mobile central-services-mobile; do perl -pi -e 's/(_VERSION"\) \?: ")[0-9.]+"/${1}'"$V"'"/' "$g/android/app/build.gradle"; done
sed -i -E "s/window.CS_VERSION = \"[0-9.]+\"/window.CS_VERSION = \"$V\"/" central-services/src/index.html
grep -n "APP_VERSION = " pedal-driver.py | head -1
grep -h '"version"' central-*/package.json | sort | uniq -c
grep -h "_VERSION\") ?:" central-*-mobile/android/app/build.gradle
