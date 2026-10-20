// Playwright from the project or the global install (npm i -g playwright)
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
let pw;
try { pw = createRequire(import.meta.url)("playwright"); }
catch (_) { const root = execSync("npm root -g").toString().trim(); pw = createRequire(root + "/")("playwright"); }
export const chromium = pw.chromium;
