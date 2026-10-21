// check-packaged.js <app.asar>: every script in the packed app finds the local files it requires ("./x"). A file left
// out of package.json's build.files would make the app crash when it starts.
"use strict";
const path = require("node:path");
const asar = require(require.resolve("@electron/asar", { paths: [process.cwd(), path.dirname(process.argv[2] || ".")] }));
const file = process.argv[2], list = new Set(asar.listPackage(file).map((f) => f.replace(/\\/g, "/").replace(/^\//, "")));
let bad = 0;
for (const f of list) {
  if (!/\.js$/.test(f) || f.startsWith("node_modules/") || f.startsWith("app/")) continue;
  const src = asar.extractFile(file, f).toString("utf8");
  for (const m of src.matchAll(/require\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)) {
    const want = path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1]));
    if (![want, want + ".js", want + ".json", want + "/index.js"].some((x) => list.has(x))) { console.error("::error::" + f + " requires " + m[1] + ", which isn't in the package (package.json build.files)"); bad++; }
  }
}
console.log(bad ? bad + " missing" : "every require of the packed app is in it (" + list.size + " files)");
process.exit(bad ? 1 : 0);
