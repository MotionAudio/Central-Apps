/* Motion Audio Central - Windows signing through any command: an EV certificate on a USB token with signtool on a
 * self-hosted runner, or a cloud signing tool. electron-builder calls this for every file it signs.
 *   WIN_SIGN_COMMAND='signtool sign /tr http://timestamp.digicert.com /td sha256 /fd sha256 /a "{file}"'
 * See docs/SIGNING.md. */
"use strict";
const { execSync } = require("node:child_process");
exports.default = async function (configuration) {
  const cmd = process.env.WIN_SIGN_COMMAND;
  if (!cmd) throw new Error("WIN_SIGN_COMMAND isn't set");
  execSync(cmd.split("{file}").join(configuration.path), { stdio: "inherit" });
};
