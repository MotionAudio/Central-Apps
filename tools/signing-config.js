#!/usr/bin/env node
/* Motion Audio Central - signing for the Mac and Windows installers (10.3).
 *
 *   npx electron-builder $(node ../tools/signing-config.js . [usage-builder.js]) --mac dmg --arm64 --publish never
 *
 * Prints the electron-builder --config argument to use. With no signing secrets in the environment it prints the
 * app's normal config (nothing, or "--config usage-builder.js"), so unsigned builds stay exactly as before. When the
 * secrets are there, it writes build/signing-*.json (the app's own build config plus signing) and prints that.
 *
 * The secrets (GitHub Secrets, mapped to these environment variables in build.yml; docs/SIGNING.md):
 *   macOS   CSC_LINK + CSC_KEY_PASSWORD            the Developer ID Application certificate (.p12, base64) and its password
 *           APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID                notarization with an Apple ID, or
 *           APPLE_API_KEY (path to the .p8) + APPLE_API_KEY_ID + APPLE_API_ISSUER  notarization with an App Store Connect key
 *   Windows WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD    an OV / EV certificate as a .pfx (electron-builder reads these itself), or
 *           AZURE_TENANT_ID + AZURE_CLIENT_ID + AZURE_CLIENT_SECRET + AZURE_TS_ENDPOINT + AZURE_TS_ACCOUNT
 *             + AZURE_TS_PROFILE + AZURE_TS_PUBLISHER          Azure Trusted Signing, or
 *           WIN_SIGN_COMMAND                       any signing command (an EV token's signtool on a self-hosted runner);
 *                                                  "{file}" in it is replaced by the file to sign
 * Never put a secret in this repository. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const rel = (from, to) => path.relative(from, to).split(path.sep).join("/");   // (forward slashes: the Windows job passes this through bash)

function plan(platform, env) {
  env = env || process.env;
  const has = (...names) => names.every((n) => typeof env[n] === "string" && env[n].trim() !== "");
  const mac = platform === "darwin" && has("CSC_LINK", "CSC_KEY_PASSWORD");
  const notarize = mac && (has("APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID") || has("APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"));
  const azure = platform === "win32" && has("AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "AZURE_TS_ENDPOINT", "AZURE_TS_ACCOUNT", "AZURE_TS_PROFILE", "AZURE_TS_PUBLISHER");
  const winCmd = platform === "win32" && !azure && has("WIN_SIGN_COMMAND");
  const winPfx = platform === "win32" && has("WIN_CSC_LINK", "WIN_CSC_KEY_PASSWORD");
  return { mac, notarize, azure, winCmd, winPfx, env };
}

// the app's build config with signing added (pure, so test-signing.mjs can check it)
function signed(base, p, appDir) {
  const b = JSON.parse(JSON.stringify(base));
  const env = p.env || process.env;
  if (p.mac) {
    b.mac = Object.assign({}, b.mac);
    delete b.mac.identity;   // (null turns signing off; without it electron-builder signs with the CSC_LINK certificate)
    b.mac.hardenedRuntime = true;
    b.mac.gatekeeperAssess = false;
    const ent = rel(appDir, path.join(__dirname, "signing", "entitlements.mac.plist"));
    b.mac.entitlements = ent; b.mac.entitlementsInherit = ent;   // (the helpers inside - cu-rig, cm-plugbridge, ffmpeg, llama-server... - get the same)
    b.mac.notarize = !!p.notarize;
    b.dmg = Object.assign({}, b.dmg, { sign: false });   // (the app inside is signed and notarized; the .dmg itself needn't be)
  }
  if (p.azure) {
    b.win = Object.assign({}, b.win, { azureSignOptions: { publisherName: env.AZURE_TS_PUBLISHER, endpoint: env.AZURE_TS_ENDPOINT, codeSigningAccountName: env.AZURE_TS_ACCOUNT, certificateProfileName: env.AZURE_TS_PROFILE } });
  } else if (p.winCmd) {
    b.win = Object.assign({}, b.win, { signtoolOptions: Object.assign({}, (b.win || {}).signtoolOptions, { sign: rel(appDir, path.join(__dirname, "signing", "win-sign.js")) }) });
  }
  return b;
}

// the --config argument for this app on this machine (writes the signing config when there is one)
function configArg(appDir, own, platform, env) {
  const p = plan(platform || process.platform, env);
  const anything = p.mac || p.azure || p.winCmd;   // (a .pfx alone needs no config change: electron-builder reads WIN_CSC_LINK itself)
  if (!anything) return own ? "--config " + own : "";
  const base = own ? require(path.join(appDir, own)) : JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf8")).build;
  const out = path.join(appDir, "build", own ? "signing-" + path.basename(own, ".js") + ".json" : "signing-builder.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(signed(base, p, appDir), null, 2));
  process.stderr.write("signing: " + [p.mac && "macOS certificate", p.notarize && "notarization", p.azure && "Azure Trusted Signing", p.winCmd && "custom Windows signing", p.winPfx && "Windows certificate"].filter(Boolean).join(", ") + "\n");
  return "--config " + rel(appDir, out);
}

if (require.main === module) process.stdout.write(configArg(path.resolve(process.argv[2] || "."), process.argv[3] || ""));
module.exports = { plan, signed, configArg };
