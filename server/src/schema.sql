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
