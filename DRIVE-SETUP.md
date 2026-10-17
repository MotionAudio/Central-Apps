# Copying every release to Google Drive

Every release is published on GitHub, and installed apps update themselves from there. If you also
want each release in a Google Drive folder (to hand a link to new people), set this up **once**. After
that, every release copies itself to Drive automatically:

```
Central Apps/
  8.1.0/      every file of that release
  latest/     always the newest release (older files are removed from here)
```

It uses [rclone](https://rclone.org) with your own Google account. Nothing secret goes into the
repository: the Drive login is stored as an encrypted **GitHub secret** that only the release job can read.

## 1. Install rclone and connect it to Google Drive (Ubuntu)

```bash
sudo -v && curl -fsSL https://rclone.org/install.sh | sudo bash
rclone config
```

Answer the questions like this:

| rclone asks | Type |
|---|---|
| `n) New remote` | `n` |
| `name>` | `gdrive` (exactly this name) |
| `Storage>` | `drive` (Google Drive) |
| `client_id>` / `client_secret>` | press **Enter** for both (leave empty) |
| `scope>` | `1` (full access) |
| `service_account_file>` | press **Enter** |
| `Edit advanced config?` | `n` |
| `Use web browser to automatically authenticate?` | `y`, then sign in with your Google account in the browser that opens and click **Allow** |
| `Configure this as a Shared Drive?` | `n` |
| `Keep this "gdrive" remote?` | `y`, then `q` to quit |

Check it works:

```bash
rclone mkdir "gdrive:Central Apps" && rclone lsd gdrive:
```

You should see `Central Apps` in the list (and in Drive on the web).

## 2. Give the login to GitHub as a secret

```bash
cat ~/.config/rclone/rclone.conf
```

Copy **everything** it prints (from `[gdrive]` to the last line). Then on GitHub:

1. Open the repository → **Settings** → **Secrets and variables** → **Actions**.
2. **New repository secret**. Name: `RCLONE_CONFIG`. Secret: paste what you copied. **Add secret**.
3. Optional, for another folder name: the **Variables** tab → **New repository variable**.
   Name: `GDRIVE_FOLDER`, value: e.g. `Church Apps`.

The next release copies itself to Drive. To copy one now, open **Actions** → **Release** →
**Run workflow**. This only does something when a version has no release yet.

## Sharing

In Drive, right-click the `Central Apps` folder → **Share** → **Anyone with the link** (Viewer), and
send people that link. The `latest` folder always has the newest files.

## Notes

- The login doesn't expire on its own. If you change your Google password or remove rclone's access
  (myaccount.google.com → Security → Third-party access), do step 1 again (`rclone config` → `e` to edit
  `gdrive`), then update the secret.
- Don't share `rclone.conf` with anyone, and don't put it in the repository: it can read and write
  your whole Drive.
- To stop the copies, delete the `RCLONE_CONFIG` secret.
