// CCLI's direct connection (10.2): searching SongSelect and bringing a song in, and sending the usage report to CCLI.
//
// CCLI doesn't publish these programming interfaces: they come with CCLI's partner agreement. So this file is the one
// place they'll go, and until Motion Audio is an approved partner everything here says so instead of guessing at an
// API that may not exist. What works without it (ccli.js and the apps): SongSelect's downloaded files (.txt, .usr,
// ChordPro) import into a song, the copyright line shows on the lyric slides, and the report is a file to enter on
// CCLI's reporting page.
//
// Once CCLI approves Motion Audio and sends its documentation and keys:
//   1. put the keys in Render: CCLI_PARTNER_ID, CCLI_CLIENT_ID, CCLI_CLIENT_SECRET (config.ccli)
//   2. write the adapter below (search, song, submitReport) from CCLI's documentation, and set ADAPTER
// The routes in ccli.js already call these, and the apps already show the buttons when status().enabled is true.
import { config } from "./config.js";

const ADAPTER = null;   // { search(q), song(id), submitReport(report) } - from CCLI's partner documentation

function keysSet() { return !!(config.ccli.partnerId && config.ccli.clientId && config.ccli.clientSecret); }
export function status() {
  if (ADAPTER && keysSet()) return { enabled: true, why: "" };
  if (keysSet()) return { enabled: false, why: "CCLI partner keys are in place. Searching SongSelect and sending the report from here switch on with the update that follows CCLI's partner documentation. Until then, import SongSelect files and download the report file." };
  return { enabled: false, why: "Searching SongSelect and sending the report straight to CCLI are waiting for CCLI partner approval. Until then, import SongSelect files (.txt, .usr or ChordPro) in the song editor, and download the report file to enter on CCLI's site." };
}
function waiting() { const e = new Error(status().why); e.status = 503; e.waiting = true; return e; }
export async function search(q) { if (!status().enabled) throw waiting(); return ADAPTER.search(String(q || "").slice(0, 120)); }
export async function song(id) { if (!status().enabled) throw waiting(); return ADAPTER.song(String(id || "")); }
export async function submitReport(report) { if (!status().enabled) throw waiting(); return ADAPTER.submitReport(report); }
