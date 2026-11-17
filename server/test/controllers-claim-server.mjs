// The website with a stand-in for the burner app's code list (for test/reve-controllers.mjs only): one control box
// code, CC-00007, whose one-time pass is TEST_PASS; the first device that uses it keeps it.
import * as pedals from "../src/pedals.js";

const used = new Map();
pedals.setDeviceClaim(async ({ kind, code, pass, serial, publicKey }) => {
  const no = (m, status) => Object.assign(new Error(m), { status });
  if (kind !== "controller") throw no("That code isn't for a control box.", 400);
  if (code !== "CC-00007") throw no("There's no code " + code + ".", 404);
  if (pass !== process.env.TEST_PASS) throw no("That code's pass doesn't match.", 403);
  const who = serial + "|" + publicKey, had = used.get(code);
  if (had && had !== who) throw no("That code's pass was used by another device.", 403);
  used.set(code, who);
  return { code };
});
await import("../src/index.js");
