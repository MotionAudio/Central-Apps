# motionaudio.org and its email (10.3)

The goal is three things:
- the website at **https://motionaudio.org** (and www);
- email at **support@**, **team@** and **noreply@motionaudio.org**;
- email that lands in inboxes, not spam.

Nothing in the apps changes until the site is really online. Then one command points every app at it (step 5).

## 1. Point the domain at the website (Render)

1. In Render, open the **motion-audio** web service → **Settings → Custom Domains → Add**. Add `motionaudio.org`,
   then `www.motionaudio.org`.
2. Render shows the DNS records to add at your domain's registrar (or at Cloudflare if your DNS is there). Usually:
   - for `motionaudio.org`: an **A** record (or ALIAS/ANAME/flattened CNAME) with the value Render gives;
   - for `www`: a **CNAME** to the service's `….onrender.com` name.

   Copy the values exactly from Render. They're specific to your service. If the DNS is on Cloudflare, set these
   records to **DNS only** (grey cloud) until Render shows them as verified.
3. Wait for Render to show both as **Verified**, with a certificate issued. HTTPS is automatic.
4. In Render → the service → **Environment**, set `PUBLIC_URL` to `https://motionaudio.org`. Links in emails and the
   sign-in callbacks then use it. Redeploy.
5. Check that `https://motionaudio.org/health` shows `{"ok":true,...}`.

## 2. Receiving email: support@, team@

Pick one:

- **Google Workspace** (about $7 per user a month): full Gmail inboxes. Make one user (for example you) and add
  support@ and team@ as aliases or groups. Its setup wizard gives the **MX** records to add.
- **Zoho Mail**: cheaper, with a free tier for a few users. The same idea: add the MX records it gives.
- **Cloudflare Email Routing** (free, if the DNS is on Cloudflare): forwards support@ and team@ to your existing
  Gmail. Cloudflare adds its MX records for you. Replying "as" support@ then needs Gmail's "Send mail as" with an SMTP
  service, so the paid inboxes above are simpler if several people answer support.

## 3. Sending email from the website: noreply@ (Resend)

The website already sends its emails (keys, invites, password resets, schedule reminders, the contact form) through
Resend.

1. At resend.com → **Domains → Add Domain** → `motionaudio.org`.
2. Resend shows DNS records to add: an **SPF** TXT record, **DKIM** TXT/CNAME records, and usually an MX for its bounce
   subdomain. Add them exactly, then press **Verify**.
3. In Render → Environment, set:
   - `RESEND_API_KEY`: from Resend → API Keys;
   - `MAIL_FROM`: `Motion Audio <noreply@motionaudio.org>`;
   - `SUPPORT_EMAIL`: `support@motionaudio.org`. The Help page's contact form and error alerts go here, and
     replies to the contact form go back to the person who wrote.

## 4. Stay out of spam: SPF, DKIM, DMARC

- **SPF:** there can be only one SPF record for `motionaudio.org`. If your email provider (Google, Zoho) also gives
  one, merge them into a single TXT record, e.g. `v=spf1 include:_spf.google.com include:amazonses.com ~all`. Use the
  exact `include:` values both providers give. Resend's SPF usually sits on its own `send` subdomain, which avoids
  clashing.
- **DKIM:** add every DKIM record each provider gives (Google or Zoho for the inboxes, Resend for the website).
- **DMARC:** add a TXT record at `_dmarc.motionaudio.org` with
  `v=DMARC1; p=none; rua=mailto:support@motionaudio.org`. After a few weeks of clean reports, tighten it to
  `p=quarantine`.
- **Test:** send a test from the website (Account → Forgot password) and from support@ to a Gmail address. In Gmail,
  open the message → ⋮ → **Show original**. SPF, DKIM and DMARC should all say **PASS**.

## 5. Point the apps at the website (only once it's online)

```
bash tools/set-website.sh https://motionaudio.org
```

This checks that the site answers, then sets the one address all the apps read (`js/license.js`). After that, make a
quick fix release (bump the version, write the notes, push), and every installed app picks it up through its normal
update. Keys are then checked on the website. The default keys keep working until they're switched off on the staff
page.
