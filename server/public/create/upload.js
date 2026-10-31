/* Make & sell (10.1): talking to the website for the creator pages and the browser studio.
 *   Maker.api(method, path, body)       the website's /v1 API with the account's sign-in
 *   Maker.signIn(back)                  go to the website's sign-in, and come back here after
 *   Maker.send(meta, files, progress)   make an item, upload its files straight to storage, send it for review
 *     meta: { kind, pack, title, description, tags, key, bpm, bars, rights: true, studio }
 *     files: [{ role: "source" | "demo", platform?, name, blob }]       -> the item (status "waiting")
 */
(function () {
  "use strict";
  var token = null; try { token = localStorage.getItem("ma-token"); } catch (_) { }
  function api(method, path, body) {
    return fetch("/v1" + path, { method: method, headers: Object.assign({ "Content-Type": "application/json" }, token ? { Authorization: "Bearer " + token } : {}), body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.error || "Something went wrong (" + r.status + ")."); e.status = r.status; throw e; } return j; }); });
  }
  function signIn(back) { try { sessionStorage.setItem("ma-after-signin", back || location.pathname); } catch (_) { } location.href = "/#account"; }
  function put(url, blob, onPart) {
    return new Promise(function (ok, bad) {
      var x = new XMLHttpRequest(); x.open("PUT", url); x.setRequestHeader("Content-Type", blob.type || "application/octet-stream");
      x.upload.onprogress = function (e) { if (e.lengthComputable && onPart) onPart(e.loaded / e.total); };
      x.onload = function () { x.status >= 200 && x.status < 300 ? ok() : bad(new Error("The upload didn't go through (" + x.status + "). Try again.")); };
      x.onerror = function () { bad(new Error("The upload didn't go through. Check the internet connection and try again.")); };
      x.send(blob);
    });
  }
  function upload(itemId, files, progress) {
    var total = files.reduce(function (a, f) { return a + (f.blob.size || 1); }, 0), done = 0, first = true;
    return files.reduce(function (pr, f) {
      return pr.then(function () {
        if (progress) progress(done / total, "Uploading " + f.name + "…");
        return api("POST", "/creator/items/" + itemId + "/upload", { role: f.role, platform: f.platform, name: f.name, size: f.blob.size, type: f.blob.type, replace: f.role === "source" && first ? (first = false, true) : false })
          .then(function (u) { return put(u.url, f.blob, function (p) { if (progress) progress((done + p * f.blob.size) / total, "Uploading " + f.name + "…"); }); })
          .then(function () { done += f.blob.size || 1; });
      });
    }, Promise.resolve());
  }
  function send(meta, files, progress) {
    return api("POST", "/creator/items", meta).then(function (r) {
      var id = r.item.id;
      return upload(id, files, progress).then(function () {
        if (progress) progress(1, "Checking it…");
        return api("POST", "/creator/items/" + id + "/submit", {}).catch(function (e) { e.itemId = id; throw e; });
      }).then(function (s) { return s.item; });
    });
  }
  function resend(itemId, files, progress) {
    return upload(itemId, files, progress).then(function () { if (progress) progress(1, "Checking it…"); return api("POST", "/creator/items/" + itemId + "/submit", {}); }).then(function (s) { return s.item; });
  }
  window.Maker = { api: api, signIn: signIn, send: send, resend: resend, upload: upload, signedIn: function () { return !!token; } };
})();
