# The Central Tracks API (v1)

The server lives in `server/` (`server/SETUP.md` explains how to run it), and it also serves the Motion Audio website. The **Central Tracks** tab under *Add songs* on the pedal and in Central Pedal Control talks to it. You set the server's address in that tab, and with no address it shows a preview of the library.

Everything is JSON. Signed-in requests send `Authorization: Bearer <token>`. The server has to allow CORS from the apps, because the Pi app runs at `http://127.0.0.1:8766` and the desktop apps load from `file://`.

| Method | Path | Answer |
|---|---|---|
| POST | `/v1/login` `{email, password, device}` | `{token}`, or for the main admin and admins on a new device `{step: "phone" \| "code", ticket, to}` |
| POST | `/v1/login/phone` `{ticket, phone}` | `{step: "code", ticket, to}` (the first time: the code goes to this number) |
| POST | `/v1/login/code` `{ticket, code, trust}` | `{token}` (the device is trusted 30 days) |
| POST | `/v1/login/resend` `{ticket}` | a new code |
| GET | `/v1/me` | The account, including `subscribed` (Central Tracks Unlimited, $77 a month) |
| GET | `/v1/tracks?q=&kind=` | `{tracks: [{id, title, artist, kind, key, bpm, price, stars, owned, preview}]}` (`kind` is Pad, Multitrack, Prime, Sound, Board or Click) |
| GET | `/v1/tracks/{id}/preview.mp3` | Anyone. Redirects (302) to a 30-second clip: the loudest part of the mix, or for a hymn the part its build picked. It's made once and kept. |
| POST | `/v1/tracks/{id}/add` | A subscriber or owner gets `{files: [{name, url, role}]}`. Anyone else gets **402** with `{checkoutUrl}`. |
| POST | `/v1/tracks/{id}/purchase` | `{checkoutUrl}` (or `{files}` if already owned) |

`role` is optional: `music`, `drums`, `bass`, `keys`, `guitar`, `vocals`, `click` or `guide`. The download `url`s have to work without the token, so they're signed links that expire quickly.

## What the server enforces

Only tracks published on the Motion Audio website are listed. Songs people import into their own pedal or Central Pedal Control, whether their own files, multitracks or Prime tracks, stay on their devices and never go into the library.

The price comes from the sound-quality grade, from 1 to 5 stars, worked out when a track is published. One star is $5, two $10, three $15, four $20 and five $30. Publishers can't set their own price. Central Tracks Unlimited subscribers ($77 a month) can add any track without paying for it separately.

Publishers get 75% of every purchase. On top of that, half of each month's subscription money goes into a pool that's split between publishers by how many times subscribers added their tracks that month, counting each subscriber once per track.
