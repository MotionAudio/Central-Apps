// Signing (10.3): without the secrets nothing changes; with them each app's config is signed, hardened, notarized,
// and Windows uses Azure Trusted Signing or a custom command.   node tools/test-signing.mjs
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.dirname(here);
const S = require("./signing-config.js");
let failed = 0;
const check = (label, fn) => { try { fn(); console.log("  ✓ " + label); } catch (e) { failed++; console.log("  ✗ " + label + "\n      " + e.message); } };
const apps = ["central-usage", "central-pedal-control", "central-services", "central-production"];
const MAC = { CSC_LINK: "x", CSC_KEY_PASSWORD: "y", APPLE_ID: "a@b.c", APPLE_APP_SPECIFIC_PASSWORD: "p", APPLE_TEAM_ID: "T" };

console.log("Signing:");
check("no secrets: every app builds with its normal config (unsigned, as before)", () => {
  for (const a of apps) { for (const pf of ["darwin", "win32", "linux"]) assert.equal(S.configArg(path.join(root, a), "", pf, {}), ""); }
  assert.equal(S.configArg(path.join(root, "central-usage"), "usage-builder.js", "darwin", {}), "--config usage-builder.js");
  assert.equal(S.configArg(path.join(root, "central-usage"), "", "darwin", { CSC_LINK: "", CSC_KEY_PASSWORD: "" }), "", "empty secrets count as none");
});
check("every Mac app starts unsigned in its own config (identity null, no hardened runtime)", () => {
  for (const a of apps) { const m = JSON.parse(fs.readFileSync(path.join(root, a, "package.json"), "utf8")).build.mac; assert.equal(m.identity, null, a); assert.equal(m.hardenedRuntime, false, a); }
});
check("Mac secrets: signed with the hardened runtime, the entitlements for the app and its helpers, notarized", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sign-"));
  for (const a of apps) {
    const dir = path.join(tmp, a); fs.mkdirSync(dir); fs.copyFileSync(path.join(root, a, "package.json"), path.join(dir, "package.json"));
    const arg = S.configArg(dir, "", "darwin", MAC); assert.equal(arg, "--config build/signing-builder.json");
    const b = JSON.parse(fs.readFileSync(path.join(dir, "build", "signing-builder.json"), "utf8"));
    assert.ok(!("identity" in b.mac), a); assert.equal(b.mac.hardenedRuntime, true); assert.equal(b.mac.notarize, true);
    assert.ok(fs.existsSync(path.join(dir, b.mac.entitlements)) && b.mac.entitlementsInherit === b.mac.entitlements, "entitlements found from the app's folder");
    const orig = JSON.parse(fs.readFileSync(path.join(root, a, "package.json"), "utf8")).build;
    assert.equal(b.mac.artifactName, orig.mac.artifactName, "same file names, so the updaters find them"); assert.deepEqual(b.extraResources, orig.extraResources, "same helpers packed");
  }
  const ent = fs.readFileSync(path.join(here, "signing", "entitlements.mac.plist"), "utf8");
  for (const k of ["allow-jit", "allow-unsigned-executable-memory", "disable-library-validation", "device.audio-input", "device.camera"]) assert.ok(ent.includes(k), k);
});
check("Central Usage's own config keeps its names when signed", () => {
  const arg = S.configArg(path.join(root, "central-usage"), "usage-builder.js", "darwin", MAC);
  const b = JSON.parse(fs.readFileSync(path.join(root, "central-usage", arg.split(" ")[1]), "utf8"));
  assert.equal(b.appId, "org.centralcontrol.musicians"); assert.match(b.mac.artifactName, /^CentralUsage-/); assert.equal(b.mac.hardenedRuntime, true);
  fs.rmSync(path.join(root, "central-usage", arg.split(" ")[1]));
});
check("a certificate without notarization secrets signs but doesn't notarize", () => {
  const b = S.signed({ mac: { identity: null } }, S.plan("darwin", { CSC_LINK: "x", CSC_KEY_PASSWORD: "y" }), root);
  assert.equal(b.mac.notarize, false); assert.ok(!("identity" in b.mac));
});
check("Windows: a .pfx needs no config change; Azure Trusted Signing and a custom command do", () => {
  assert.equal(S.configArg(path.join(root, "central-services"), "", "win32", { WIN_CSC_LINK: "x", WIN_CSC_KEY_PASSWORD: "y" }), "");
  const az = { AZURE_TENANT_ID: "t", AZURE_CLIENT_ID: "c", AZURE_CLIENT_SECRET: "s", AZURE_TS_ENDPOINT: "https://eus.codesigning.azure.net", AZURE_TS_ACCOUNT: "acct", AZURE_TS_PROFILE: "prof", AZURE_TS_PUBLISHER: "Motion Audio" };
  const b = S.signed({ win: { target: "nsis" } }, S.plan("win32", az), root);
  assert.deepEqual(b.win.azureSignOptions, { publisherName: "Motion Audio", endpoint: az.AZURE_TS_ENDPOINT, codeSigningAccountName: "acct", certificateProfileName: "prof" });
  const c = S.signed({ win: {} }, S.plan("win32", { WIN_SIGN_COMMAND: "signtool sign \"{file}\"" }), path.join(root, "central-services"));
  assert.ok(fs.existsSync(path.join(root, "central-services", c.win.signtoolOptions.sign)));
});
check("the workflow builds every Mac and Windows installer through the signing config, and maps the secrets", () => {
  const y = fs.readFileSync(path.join(root, ".github", "workflows", "build.yml"), "utf8");
  const mac = (y.match(/npx electron-builder [^\n]*--mac /g) || []), win = (y.match(/npx electron-builder [^\n]*--win /g) || []);
  assert.equal(mac.length, 5); assert.equal(win.length, 5);
  for (const l of mac.concat(win)) assert.ok(/signing-config\.js/.test(l), l);
  for (const s of ["MAC_CSC_LINK", "MAC_CSC_KEY_PASSWORD", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID", "WIN_CSC_LINK", "WIN_CSC_KEY_PASSWORD", "AZURE_TS_ENDPOINT", "WIN_SIGN_COMMAND"]) assert.ok(y.includes("secrets." + s), s);
});
{
  const { Updater } = require("../central-usage/updater.js");
  const fake = (team, bad) => async (cmd) => { if (cmd === "codesign" && bad) throw new Error("invalid signature"); return "Identifier=org.x\nTeamIdentifier=" + team + "\n"; };
  const results = await Promise.all([Updater.macTeam(fake("ABCDE12345"), "/A.app"), Updater.macTeam(fake("not set"), "/A.app"), Updater.macTeam(fake("ABCDE12345", true), "/A.app", true)]);
  check("the Mac updater reads the developer team (unsigned or ad-hoc: none; a broken signature: none)", () => assert.deepEqual(results, ["ABCDE12345", null, null]));
}
console.log(failed ? "\n" + failed + " FAILED" : "\nall passed");
process.exit(failed ? 1 : 0);
