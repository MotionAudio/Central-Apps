# Copying every release to Google Drive

Every release goes up on GitHub, and the installed apps update themselves from there. If you'd also like each release in a Google Drive folder, so you can hand new people a link, set this up once. After that, every release copies itself to Drive:

```
Central Apps/
  10.4.1/     every file of that release
  latest/     always the newest release (older files are cleared out)
```

It uses [rclone](https://rclone.org) with your own Google account. Nothing secret goes into the repository. The Drive login is kept as an encrypted GitHub secret that only the release job can read.

## 1. Install rclone and connect it to Google Drive

On Ubuntu:

```bash
sudo -v && curl -fsSL https://rclone.org/install.sh | sudo bash
rclone config
```

Answer its questions like this:

| rclone asks | You type |
|---|---|
| `n) New remote` | `n` |
| `name>` | `gdrive` (exactly that) |
| `Storage>` | `drive` |
| `client_id>` and `client_secret>` | press **Enter** for both |
| `scope>` | `1` |
| `service_account_file>` | press **Enter** |
| `Edit advanced config?` | `n` |
| `Use web browser to automatically authenticate?` | `y`, then sign in to Google in the browser that opens and click **Allow** |
| `Configure this as a Shared Drive?` | `n` |
| `Keep this "gdrive" remote?` | `y`, then `q` to quit |

Check it worked:

```bash
rclone mkdir "gdrive:Central Apps" && rclone lsd gdrive:
```

You should see `Central Apps` in the list, and in Drive on the web.

## 2. Give the login to GitHub

```bash
cat ~/.config/rclone/rclone.conf
```

Copy everything it prints, from `[gdrive]` to the last line. Then on GitHub:

1. Open the repository and go to **Settings → Secrets and variables → Actions**.
2. Click **New repository secret**, name it `RCLONE_CONFIG`, paste what you copied, and click **Add secret**.
3. If you want a different folder name, open the **Variables** tab, click **New repository variable**, and add `GDRIVE_FOLDER` with the name you want, like `Church Apps`.

The next release copies itself to Drive. To run it now, go to **Actions → Release → Run workflow**. It only does something when the current version doesn't have a release yet.

## Sharing it

In Drive, right-click the `Central Apps` folder, choose **Share → Anyone with the link** as a Viewer, and send people that link. The `latest` folder always has the newest files.

## Good to know

- The login doesn't expire by itself. If you change your Google password or remove rclone's access (myaccount.google.com → Security → Third-party access), run `rclone config` again, choose `e` to edit `gdrive`, and then update the secret.
- Don't share `rclone.conf` with anyone or put it in the repository. It can read and write your whole Drive.
- To stop the copies, delete the `RCLONE_CONFIG` secret.
