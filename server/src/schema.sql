-- Motion Audio / Central Tracks database. Safe to run on every start (everything is IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  pass_hash     TEXT NOT NULL,
  stripe_customer TEXT,
  subscription_id TEXT,
  subscribed    BOOLEAN NOT NULL DEFAULT FALSE,
  connect_account TEXT,             -- Stripe Connect account for publisher payouts
  connect_ready BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tracks (
  id            BIGSERIAL PRIMARY KEY,
  publisher_id  BIGINT NOT NULL REFERENCES users(id),
  title         TEXT NOT NULL,
  artist        TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('Pad','Multitrack','Prime')),
  song_key      TEXT NOT NULL DEFAULT '',
  bpm           NUMERIC(6,2) NOT NULL DEFAULT 0,
  stars         SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  price_cents   INTEGER NOT NULL,
  grade_report  JSONB NOT NULL DEFAULT '[]',
  status        TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live','hidden','removed')),
  rights_ok     BOOLEAN NOT NULL DEFAULT FALSE,  -- publisher confirmed they own or licensed it
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tracks_search ON tracks USING gin (to_tsvector('simple', title || ' ' || artist || ' ' || song_key));

CREATE TABLE IF NOT EXISTS track_files (
  id        BIGSERIAL PRIMARY KEY,
  track_id  BIGINT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  role      TEXT NOT NULL DEFAULT '',
  storage_key TEXT NOT NULL,
  is_mix    BOOLEAN NOT NULL DEFAULT FALSE
);

-- a track in someone's storage: bought, or added with the subscription
CREATE TABLE IF NOT EXISTS library (
  user_id   BIGINT NOT NULL REFERENCES users(id),
  track_id  BIGINT NOT NULL REFERENCES tracks(id),
  how       TEXT NOT NULL CHECK (how IN ('purchase','subscription','own')),
  added_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, track_id)
);

-- what each publisher has earned; paid out monthly through Stripe Connect
CREATE TABLE IF NOT EXISTS earnings (
  id          BIGSERIAL PRIMARY KEY,
  publisher_id BIGINT NOT NULL REFERENCES users(id),
  track_id    BIGINT NOT NULL REFERENCES tracks(id),
  buyer_id    BIGINT NOT NULL REFERENCES users(id),
  reason      TEXT NOT NULL CHECK (reason IN ('purchase','subscriber_add')),
  cents       INTEGER NOT NULL,
  transfer_id TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (track_id, buyer_id, reason)
);

-- subscription money received (Stripe invoice.paid), the source of the monthly publisher pool
CREATE TABLE IF NOT EXISTS subscription_payments (
  invoice_id  TEXT PRIMARY KEY,
  user_id     BIGINT REFERENCES users(id),
  cents       INTEGER NOT NULL,
  paid_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- each publisher's share of a month's pool (month = 'YYYY-MM')
CREATE TABLE IF NOT EXISTS pool_shares (
  month        TEXT NOT NULL,
  publisher_id BIGINT NOT NULL REFERENCES users(id),
  adds         INTEGER NOT NULL,
  cents        INTEGER NOT NULL,
  transfer_id  TEXT,
  PRIMARY KEY (month, publisher_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT REFERENCES users(id),
  email       TEXT NOT NULL DEFAULT '',
  stripe_session TEXT UNIQUE NOT NULL,
  items       JSONB NOT NULL,
  total_cents INTEGER NOT NULL,
  shipping    JSONB,
  status      TEXT NOT NULL DEFAULT 'paid',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS licenses (
  key         TEXT PRIMARY KEY,
  order_id    BIGINT NOT NULL REFERENCES orders(id),
  product     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reports (
  id        BIGSERIAL PRIMARY KEY,
  track_id  BIGINT NOT NULL REFERENCES tracks(id),
  reporter  TEXT NOT NULL,
  reason    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- churches and license keys (8.10)
-- A church (or production) owns the keys it bought. The main user makes it; admins and users join it with its codes.
CREATE TABLE IF NOT EXISTS churches (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  owner_id    BIGINT REFERENCES users(id),
  admin_code  TEXT UNIQUE NOT NULL,
  user_code   TEXT UNIQUE NOT NULL,
  has_pack    BOOLEAN NOT NULL DEFAULT FALSE,     -- bought a church pack: extra users are $10
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS church_members (
  church_id   BIGINT NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL UNIQUE REFERENCES users(id),   -- one church per account
  role        TEXT NOT NULL CHECK (role IN ('owner','admin','user')),
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (church_id, user_id)
);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS church_id BIGINT REFERENCES churches(id);
-- a key: P (Central Pedal, Central Pedal Control), A (Central Control - admins), U (Central Usage - users).
-- It works on one device at a time; Release (in the app or on the website) frees it for another.
ALTER TABLE licenses ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS kind TEXT;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS church_id BIGINT REFERENCES churches(id);
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS device_id TEXT;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS device_name TEXT;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS app TEXT;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS revoked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';
UPDATE licenses SET kind = CASE WHEN product IN ('pedal-sw','pedal-hw','pedal','pedal-control') THEN 'P' WHEN product IN ('control','admin') THEN 'A' ELSE 'U' END WHERE kind IS NULL;
CREATE INDEX IF NOT EXISTS licenses_church ON licenses (church_id);
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id);   -- the account signed in on its device (it can release its own key)

-- ---------------------------------------------------------------- teams, invites, devices, settings (8.11)
-- the devices a key is on: an A key (admin) one at a time; a U key (user) or a Pedal Control P key two (church and home),
-- both signed in with the same account; a pedal's P key one
CREATE TABLE IF NOT EXISTS license_devices (
  key          TEXT NOT NULL REFERENCES licenses(key) ON DELETE CASCADE,
  device_id    TEXT NOT NULL,
  device_name  TEXT NOT NULL DEFAULT '',
  app          TEXT NOT NULL DEFAULT '',
  activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (key, device_id)
);
INSERT INTO license_devices (key, device_id, device_name, app, activated_at, last_seen)
  SELECT key, device_id, COALESCE(device_name,''), COALESCE(app,''), COALESCE(activated_at, now()), COALESCE(last_seen, now()) FROM licenses WHERE device_id IS NOT NULL
  ON CONFLICT DO NOTHING;
UPDATE licenses SET device_id=NULL, device_name=NULL WHERE device_id IS NOT NULL;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS assigned_email TEXT;   -- the person the Teams page gave it to
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS assigned_name TEXT;
-- Teams: people the main admin or an admin added (Admins, Users, Pedal Control), each with a key and an email invite.
-- section 'owner' is the invite to take over as main admin.
CREATE TABLE IF NOT EXISTS invites (
  id          BIGSERIAL PRIMARY KEY,
  church_id   BIGINT NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  section     TEXT NOT NULL CHECK (section IN ('admin','user','pedal','owner')),
  name        TEXT NOT NULL DEFAULT '',
  email       TEXT NOT NULL,
  role_text   TEXT NOT NULL DEFAULT '',
  key         TEXT REFERENCES licenses(key) ON DELETE SET NULL,
  token       TEXT UNIQUE NOT NULL,
  user_id     BIGINT REFERENCES users(id),
  sent_at     TIMESTAMPTZ,
  sent_ok     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (church_id, section, email)
);
-- settings that follow an account (both devices of a user's key share them)
CREATE TABLE IF NOT EXISTS user_settings (
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app         TEXT NOT NULL,
  data        JSONB NOT NULL DEFAULT '{}',
  updated_at  BIGINT NOT NULL DEFAULT 0,     -- the app's clock (ms) of the change: the newest wins
  PRIMARY KEY (user_id, app)
);

-- ---------------------------------------------------------------- Central Services: scheduling (8.11)
ALTER TABLE churches ADD COLUMN IF NOT EXISTS has_services BOOLEAN NOT NULL DEFAULT FALSE;   -- bought (or came with a pack)
UPDATE churches SET has_services=TRUE WHERE has_pack AND NOT has_services;
-- who makes the schedules (up to 4; none chosen: the main admin and the first admins)
CREATE TABLE IF NOT EXISTS service_schedulers (
  church_id   BIGINT NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (church_id, user_id)
);
CREATE TABLE IF NOT EXISTS service_teams (    -- up to 4 worship teams and 4 production teams
  id          BIGSERIAL PRIMARY KEY,
  church_id   BIGINT NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('worship','production')),
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS service_team_members (
  team_id     BIGINT NOT NULL REFERENCES service_teams(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  role        TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (team_id, email)
);
CREATE TABLE IF NOT EXISTS services (           -- a service (Sunday 9:00, Wednesday night...)
  id          BIGSERIAL PRIMARY KEY,
  church_id   BIGINT NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  starts_at   TIMESTAMPTZ NOT NULL,
  notes       TEXT NOT NULL DEFAULT '',
  created_by  BIGINT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS services_when ON services (church_id, starts_at);
CREATE TABLE IF NOT EXISTS service_requests (   -- someone asked to serve: they accept or decline
  id          BIGSERIAL PRIMARY KEY,
  service_id  BIGINT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  team_id     BIGINT NOT NULL REFERENCES service_teams(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  role        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
  note        TEXT NOT NULL DEFAULT '',
  responded_at TIMESTAMPTZ,
  UNIQUE (service_id, team_id, email)
);

-- ---------------------------------------------------------------- forgot password, reminders, moving people (8.12)
-- a reset link (only its hash is kept); it works once, for an hour
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash  TEXT PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_resets_user ON password_resets (user_id, created_at);
ALTER TABLE users ADD COLUMN IF NOT EXISTS pw_changed_at TIMESTAMPTZ;   -- sign-ins from before a new password stop working
-- invites nobody answered: a reminder after 3 days, another after 7, then no more
ALTER TABLE invites ADD COLUMN IF NOT EXISTS reminders SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE invites ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ;
-- Central Services: the day-before reminder (accepted: "you're serving tomorrow"; not answered yet: "please answer")
ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS asked_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ;

-- ---------------------------------------------------------------- 8.13: confirm email, phone codes for admins, delete
-- account, church billing, blockout dates, song lists, error reports, support messages
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_confirmed BOOLEAN;
UPDATE users SET email_confirmed=TRUE WHERE email_confirmed IS NULL;          -- (accounts from before: already fine)
ALTER TABLE users ALTER COLUMN email_confirmed SET DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS email_confirms (
  token_hash  TEXT PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- the main admin and admins sign in with email, password and a code sent to their phone (once per device, 30 days)
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_confirmed BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS login_codes (
  nonce       TEXT PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash   TEXT,
  phone       TEXT,
  device      TEXT NOT NULL DEFAULT '',
  attempts    SMALLINT NOT NULL DEFAULT 0,
  sends       SMALLINT NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS trusted_devices (
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_hash TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, device_hash)
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
-- billing belongs to the church (its name on the card's receipts), not to whoever is main admin
ALTER TABLE churches ADD COLUMN IF NOT EXISTS stripe_customer TEXT;
ALTER TABLE churches ADD COLUMN IF NOT EXISTS subscribed BOOLEAN NOT NULL DEFAULT FALSE;   -- Central Tracks Unlimited for the whole church
ALTER TABLE churches ADD COLUMN IF NOT EXISTS subscription_id TEXT;
ALTER TABLE churches ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
-- Central Services: dates someone can't serve, and each service's songs
CREATE TABLE IF NOT EXISTS service_blockouts (
  id          BIGSERIAL PRIMARY KEY,
  church_id   BIGINT NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  starts_on   DATE NOT NULL,
  ends_on     DATE NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS service_blockouts_when ON service_blockouts (church_id, ends_on);
ALTER TABLE services ADD COLUMN IF NOT EXISTS songs JSONB NOT NULL DEFAULT '[]';
-- errors the website and the apps ran into (one row per kind of error; the support email hears about each new one)
CREATE TABLE IF NOT EXISTS app_errors (
  id          BIGSERIAL PRIMARY KEY,
  fingerprint TEXT UNIQUE NOT NULL,
  source      TEXT NOT NULL,             -- website, central-pedal, central-pedal-control, central-control, central-usage, central-services
  version     TEXT NOT NULL DEFAULT '',
  message     TEXT NOT NULL,
  stack       TEXT NOT NULL DEFAULT '',
  detail      JSONB NOT NULL DEFAULT '{}',
  count       INTEGER NOT NULL DEFAULT 1,
  first_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  alerted_at  TIMESTAMPTZ,
  resolved    BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS app_errors_last ON app_errors (last_at DESC);
CREATE TABLE IF NOT EXISTS support_requests (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  name        TEXT NOT NULL DEFAULT '',
  email       TEXT NOT NULL,
  subject     TEXT NOT NULL DEFAULT '',
  message     TEXT NOT NULL,
  app         TEXT NOT NULL DEFAULT '',
  version     TEXT NOT NULL DEFAULT '',
  sent        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- (8.13 sign-in codes: adding a phone takes a texted code and an emailed one; texts are counted per account and number)
ALTER TABLE login_codes ADD COLUMN IF NOT EXISTS email_code_hash TEXT;
ALTER TABLE login_codes ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'login';
ALTER TABLE login_codes ADD COLUMN IF NOT EXISTS via TEXT;
CREATE TABLE IF NOT EXISTS sms_sends (
  id       BIGSERIAL PRIMARY KEY,
  user_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  phone    TEXT NOT NULL,
  at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sms_sends_phone ON sms_sends (phone, at);
CREATE INDEX IF NOT EXISTS sms_sends_user ON sms_sends (user_id, at);

-- ---------------------------------------------------------------- 9.0: update coverage, renewals, discount codes, trials
-- updates_until: the last full release a key gets (in tenths: 94 = 9.4); NULL = forever (P keys: Central Pedal and
-- Central Pedal Control). expires_at: a trial key stops working then.
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS updates_until INTEGER;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS trial BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE licenses SET updates_until=99 WHERE updates_until IS NULL AND kind IN ('A','U') AND NOT trial AND created_at < '2026-10-21';   -- (keys from before: through 9.9)
ALTER TABLE churches ADD COLUMN IF NOT EXISTS trial_until TIMESTAMPTZ;
ALTER TABLE churches ADD COLUMN IF NOT EXISTS trial_code TEXT;
ALTER TABLE churches ADD COLUMN IF NOT EXISTS trial_by BIGINT REFERENCES users(id);
ALTER TABLE churches ADD COLUMN IF NOT EXISTS trial_reminded BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_code TEXT;
-- prices staff changed on the website's price page (one JSON document; anything missing uses config.js)
CREATE TABLE IF NOT EXISTS site_settings (
  name        TEXT PRIMARY KEY,
  data        JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT NOT NULL DEFAULT ''
);
-- a % code used by a church (once each); Central Services' monthly plan
CREATE TABLE IF NOT EXISTS discount_uses (
  church_id   BIGINT NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  order_id    BIGINT REFERENCES orders(id),
  used_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (church_id, code)
);
ALTER TABLE churches ADD COLUMN IF NOT EXISTS services_sub TEXT;         -- the Stripe subscription
ALTER TABLE churches ADD COLUMN IF NOT EXISTS services_item TEXT;        -- its item (its price changes with the church's size)
ALTER TABLE churches ADD COLUMN IF NOT EXISTS services_cents INTEGER;    -- what it charges now
ALTER TABLE churches ADD COLUMN IF NOT EXISTS services_status TEXT;
-- 9.3: Central Services slots (bought once; packs come with some); a church can have 2 main admins (role 'owner')
ALTER TABLE churches ADD COLUMN IF NOT EXISTS services_slots INTEGER NOT NULL DEFAULT 0;
-- every Checkout Session this server starts (the webhook fulfils from this row, not from metadata)
CREATE TABLE IF NOT EXISTS checkouts (
  session_id  TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,              -- store, renew, subscription, track
  user_id     BIGINT REFERENCES users(id),
  church_id   BIGINT REFERENCES churches(id),
  track_id    BIGINT REFERENCES tracks(id),
  items       JSONB,                      -- store: { productId: qty }; renew: { keys: [...] }
  code        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- one row per paid one-time payment: how a refund, dispute or fraud warning finds what to take back
CREATE TABLE IF NOT EXISTS stripe_payments (
  payment_intent TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  kind        TEXT NOT NULL,              -- store, renew, track
  user_id     BIGINT REFERENCES users(id),
  order_id    BIGINT REFERENCES orders(id),
  track_id    BIGINT REFERENCES tracks(id),
  status      TEXT NOT NULL DEFAULT 'paid',   -- paid, refunded, disputed, review
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE subscription_payments ADD COLUMN IF NOT EXISTS payment_intent TEXT;
ALTER TABLE subscription_payments ADD COLUMN IF NOT EXISTS reversed BOOLEAN NOT NULL DEFAULT FALSE;
-- a sale paid back: what it gave the publisher comes off their next payout
ALTER TABLE earnings DROP CONSTRAINT IF EXISTS earnings_reason_check;
ALTER TABLE earnings ADD CONSTRAINT earnings_reason_check CHECK (reason IN ('purchase','subscriber_add','reversal'));
-- publishers verify their ID once (Stripe Identity) before their first upload
ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_session TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS id_status TEXT NOT NULL DEFAULT 'none';   -- none, processing, requires_input, verified
ALTER TABLE orders ADD COLUMN IF NOT EXISTS slots INTEGER NOT NULL DEFAULT 0;   -- Central Services slots it gave (a refund takes them back)

-- 9.3.1: the church account - the church's own login (office@church), not a person. It buys and pays, holds the keys
-- and slots, and adds the main admins (up to 2), admins and users. One per church; it uses no Central Services slot.
ALTER TABLE church_members DROP CONSTRAINT IF EXISTS church_members_role_check;
ALTER TABLE church_members ADD CONSTRAINT church_members_role_check CHECK (role IN ('church','owner','admin','user'));
CREATE UNIQUE INDEX IF NOT EXISTS church_members_one_church_account ON church_members (church_id) WHERE role='church';

-- 9.5: buying "Just me": the keys belong to a personal row (personal, owner_id = the person), each key given to its
-- buyer at once. Nobody is a member of it, so the person can still be in a church (or join one later).
ALTER TABLE churches ADD COLUMN IF NOT EXISTS personal BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS churches_one_personal ON churches (owner_id) WHERE personal;

-- 9.5: sound plans (yearly): Central Keys, Central Plugins, Central Instrument, Central Pedals. One row per Stripe
-- subscription: a person's own (some of the plans, or all four: one package key), or a church's bundle (all four plans,
-- `seats` package keys handed out on the Teams page). Written when the checkout starts; the webhook makes it active,
-- issues its keys and keeps its dates (a key lasts as long as its subscription).
CREATE TABLE IF NOT EXISTS plan_subs (
  id          BIGSERIAL PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('person','bundle')),
  user_id     BIGINT REFERENCES users(id),                         -- person: whose; bundle: who bought it
  church_id   BIGINT REFERENCES churches(id) ON DELETE CASCADE,    -- bundle: whose
  plans       TEXT[] NOT NULL,
  seats       INTEGER NOT NULL DEFAULT 1,
  cents       INTEGER NOT NULL DEFAULT 0,                          -- a year, as sold
  code        TEXT,                                                -- a % code on the first year
  session_id  TEXT,
  stripe_sub  TEXT UNIQUE,
  status      TEXT NOT NULL DEFAULT 'incomplete',                  -- Stripe's: active, trialing, past_due, canceled, ...
  period_end  TIMESTAMPTZ,                                         -- paid through (it renews then)
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  past_due_since TIMESTAMPTZ,                                      -- a renewal that didn't go through: 14 more days
  ended_at    TIMESTAMPTZ,                                         -- canceled, refunded: when it stopped
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE plan_subs ADD COLUMN IF NOT EXISTS past_due_since TIMESTAMPTZ;
ALTER TABLE plan_subs ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS plan_subs_user ON plan_subs (user_id) WHERE kind='person';
CREATE INDEX IF NOT EXISTS plan_subs_church ON plan_subs (church_id) WHERE kind='bundle';
-- a package key: SXXX-XXXX-XXXX-XXXX. Its plans last as long as its subscription (renewals carry it on), or until a
-- trial ends. A church's key is given to one person (holder) on the Teams page; taking it back revokes it and puts a new
-- key in its place, so the first person's copy stops working.
CREATE TABLE IF NOT EXISTS package_keys (
  key          TEXT PRIMARY KEY,
  plans        TEXT[] NOT NULL,
  plan_sub_id  BIGINT REFERENCES plan_subs(id) ON DELETE SET NULL,
  church_id    BIGINT REFERENCES churches(id) ON DELETE CASCADE,   -- a bundle's or a trial's
  user_id      BIGINT REFERENCES users(id),                        -- a person's own: who bought it
  holder_email TEXT,                                               -- who it's for (emailed to them)
  holder_name  TEXT NOT NULL DEFAULT '',
  given_at     TIMESTAMPTZ,
  trial        BOOLEAN NOT NULL DEFAULT FALSE,
  ends_at      TIMESTAMPTZ,                                        -- a trial key: when it stops
  revoked      BOOLEAN NOT NULL DEFAULT FALSE,
  revoked_why  TEXT,                                               -- 'replaced' (given to someone else), 'removed'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS package_keys_sub ON package_keys (plan_sub_id);
CREATE INDEX IF NOT EXISTS package_keys_church ON package_keys (church_id);
CREATE INDEX IF NOT EXISTS package_keys_holder ON package_keys (holder_email);
CREATE TABLE IF NOT EXISTS package_devices (
  key          TEXT NOT NULL REFERENCES package_keys(key) ON DELETE CASCADE,
  device_id    TEXT NOT NULL,
  app          TEXT NOT NULL DEFAULT '',
  device_name  TEXT NOT NULL DEFAULT '',
  activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (key, device_id)
);
-- a % code on a plan's first year: once per person ('u' + id), or once per church for a bundle ('c' + id)
CREATE TABLE IF NOT EXISTS plan_code_uses (
  who         TEXT NOT NULL,
  code        TEXT NOT NULL,
  plan_sub_id BIGINT REFERENCES plan_subs(id) ON DELETE SET NULL,
  used_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (who, code)
);
-- Central Tracks: Sound, Board and Click besides the recordings. Their demo clip is the graded mix (is_mix); the file
-- the apps install is the track_files row with role 'item'.
ALTER TABLE tracks DROP CONSTRAINT IF EXISTS tracks_kind_check;
ALTER TABLE tracks ADD CONSTRAINT tracks_kind_check CHECK (kind IN ('Pad','Multitrack','Prime','Sound','Board','Click'));
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS item_format TEXT;   -- sf2, zip, json
