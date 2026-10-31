// check-asar-lean.js <app.asar> [--no-ai <resources folder>]: the packed app holds only the app - not the lights' AI
// model, the bundled driver, the native sources or the tests. (10.0: a platform "files" list made only of "!" patterns
// made electron-builder pack the whole folder, so Central Usage carried the 491 MB AI model inside app.asar.)
// With --no-ai, the resources folder must not have the AI helper at all (Central Usage).
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const asar = require(require.resolve("@electron/asar", { paths: [process.cwd(), path.dirname(process.argv[2] || ".")] }));
const file = process.argv[2];
const list = asar.listPackage(file).map((f) => f.replace(/\\/g, "/").replace(/^\//, ""));
const bad = list.filter((f) => /\.gguf$/i.test(f) || /^driver-dist\//.test(f) || /^native\//.test(f) || /^player-src\//.test(f) || /^test-[^/]*\.mjs$/.test(f));
for (const f of bad.slice(0, 20)) console.error("::error::" + f + " shouldn't be inside app.asar");
let mb = fs.statSync(file).size / 1048576, fail = bad.length > 0;
if (mb > 400) { console.error("::error::app.asar is " + mb.toFixed(0) + " MB - something large got packed in"); fail = true; }
const i = process.argv.indexOf("--no-ai");
if (i > 0) {
  const res = process.argv[i + 1];
  if (fs.existsSync(path.join(res, "ai"))) { console.error("::error::this app must not carry the lights' AI helper (resources/ai)"); fail = true; }
}
console.log(fail ? "app.asar is not lean" : "app.asar is lean: " + list.length + " files, " + mb.toFixed(0) + " MB");
process.exit(fail ? 1 : 0);
