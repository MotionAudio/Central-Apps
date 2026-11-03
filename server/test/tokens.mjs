// The website's and Central Services' copies of the shared design tokens match css/central-tokens.css (bash
// tools/sync-tokens.sh copies them), and every page loads them before its own styles.
//   node test/tokens.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = fs.readFileSync(path.join(root, "css/central-tokens.css"), "utf8");
let fails = 0;
const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fails++; };
for (const f of ["server/public/central-tokens.css", "server/public/services/central-tokens.css"]) {
  const p = path.join(root, f);
  ok(fs.existsSync(p) && fs.readFileSync(p, "utf8") === src, f + " matches css/central-tokens.css (bash tools/sync-tokens.sh)");
}
const pages = ["server/public/index.html", "server/public/privacy.html", "server/public/terms.html", "server/public/refunds.html",
  "server/public/apps/index.html", "server/public/help/index.html", "server/public/create/index.html", "server/public/services/index.html", "server/review/index.html"];
for (const f of pages) {
  const s = fs.readFileSync(path.join(root, f), "utf8"), t = s.indexOf("central-tokens.css");
  const own = s.search(/<link rel="stylesheet" href="[^"]*(site|maker|manual)\.css"|<style>/);
  ok(t > 0 && (own < 0 || t < own), f + " loads the tokens before its own styles");
}
console.log(fails ? "\n" + fails + " FAILED" : "\nall passed");
process.exit(fails ? 1 : 0);
