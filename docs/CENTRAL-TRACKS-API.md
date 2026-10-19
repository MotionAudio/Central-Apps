# Central Tracks server API (v1)

The **Central Tracks** tab in *Add songs* (Central Pedal and Central Pedal Control) talks to this API.
Set the server address in that tab. With no server set, the tab shows a preview of the library.

All requests and answers are JSON. Signed-in requests send `Authorization: Bearer <token>`.
The server must allow CORS from the apps (the Pi app runs at `http://127.0.0.1:8766`, the Mac app from `file://`).

| Method | Path | Answer |
|---|---|---|
| POST | `/v1/login` `{email, password}` | `{token}` |
| GET | `/v1/me` | `{email, subscribed}` (`subscribed` = Central Tracks Unlimited, $77/month) |
| GET | `/v1/tracks?q=&kind=` | `{tracks: [{id, title, artist, kind, key, bpm, price, stars, owned}]}` (`kind`: Pad, Multitrack, Prime) |
| POST | `/v1/tracks/{id}/add` | subscriber or owner: `{files: [{name, url, role}]}` · otherwise **402** `{checkoutUrl}` |
| POST | `/v1/tracks/{id}/purchase` | `{checkoutUrl}` (or `{files}` if already owned) |

`role` is optional (`music`, `drums`, `bass`, `keys`, `guitar`, `vocals`, `click`, `guide`). Download `url`s must be
reachable without the token (signed, short-lived links).

## Rules the server enforces

- **Only tracks published on the Motion Audio website are listed.** Songs people import into their own Central Pedal
  or Central Pedal Control (own MP3 / WAV, multitracks, Prime tracks) stay on their devices and are never uploaded to
  the library.
- **Price comes from the audio-quality grade** (1–5 stars, worked out automatically when a track is published):
  1★ $5 · 2★ $10 · 3★ $15 · 4★ $20 · 5★ $30. Publishers can't set their own price.
- **Central Tracks Unlimited ($77/month)** subscribers add any track with no per-track charge.
- **Payouts:** the publisher gets 75% of each purchase, and $3 each time a Central Tracks subscriber adds the track.
