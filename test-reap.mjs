// The tests' helper programs (a simulated Central Pedal driver, a hub, a stand-in server) go when the test goes - also
// when it fails half-way, throws, or is stopped (Ctrl+C, a timeout). A driver left running keeps ports 8765 / 8766 and
// the next test's page talks to it instead of its own. Import this first:  import "./test-reap.mjs";
import { createRequire, syncBuiltinESMExports } from "node:module";
const cp = createRequire(import.meta.url)("node:child_process");
const kids = new Set();
for (const name of ["spawn", "execFile", "fork"]) {
  const orig = cp[name];
  cp[name] = function () { const c = orig.apply(this, arguments); if (c && c.pid) { kids.add(c); c.once("exit", () => kids.delete(c)); } return c; };
}
syncBuiltinESMExports();
function reap() { for (const c of kids) { try { c.kill("SIGTERM"); } catch (_) { } } kids.clear(); }
process.on("exit", reap);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(sig, () => { reap(); process.exit(sig === "SIGINT" ? 130 : 143); });
export { reap };
