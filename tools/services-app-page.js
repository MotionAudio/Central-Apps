#!/usr/bin/env node
// Marks a copy of the Central Services page as the app: window.CS_APP, and window.CS_SERVER = the website's address
// (the SERVER set in js/license.js; empty until the website is online - then the app's ⚙ App settings can take it).
//   node tools/services-app-page.js <copy of index.html> js/license.js
"use strict";
const fs = require("node:fs");
const [page, lic] = process.argv.slice(2);
const m = fs.readFileSync(lic, "utf8").match(/var SERVER = "([^"]*)"/), server = m ? m[1] : "";
let s = fs.readFileSync(page, "utf8");
if (!s.includes("window.CS_APP")) s = s.replace("<head>", "<head>\n<script>window.CS_APP = true; window.CS_SERVER = " + JSON.stringify(server) + ";</script>");
fs.writeFileSync(page, s);
console.log("Central Services page: app" + (server ? " · website " + server : " · no website address yet"));
