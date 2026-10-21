/* After this computer took over as the hub (hubsync.js): the hub's lighting rig and cues, slides and timecode settings
 * go into place before the rest of the app reads them. Loaded first. */
(function () {
  "use strict";
  try {
    var j = window.CU && window.CU.hubImport ? window.CU.hubImport() : null;
    if (j && typeof j === "object") Object.keys(j).forEach(function (k) { if (/^cu-[A-Za-z]+$/.test(k) && typeof j[k] === "string") localStorage.setItem(k, j[k]); });
  } catch (_) { }
})();
