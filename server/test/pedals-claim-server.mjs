// The website with a stand-in for the burner app's code list (for test/reve-pedals-burner.mjs only): one code,
// CP-00042, whose one-time pass is TEST_PASS; the first chip that uses it keeps it, and the same chip asking again
// gets yes again. The real code list sets its own claim function the same way (pedals.setDeviceClaim).
import * as pedals from "../src/pedals.js";

const used = new Map();
pedals.setDeviceClaim(async ({ kind, code, pass, serial, publicKey }) => {
  const no = (m, status) => Object.assign(new Error(m), { status });
  if (kind !== "pedal") throw no("That code isn't for a pedal.", 400);
  if (code !== "CP-00042") throw no("There's no code " + code + ".", 404);
  if (pass !== process.env.TEST_PASS) throw no("That code's pass doesn't match.", 403);
  const chip = serial + "|" + publicKey, had = used.get(code);
  if (had && had !== chip) throw no("That code's pass was used by another pedal.", 403);
  used.set(code, chip);
  return { code };
});
await import("../src/index.js");
