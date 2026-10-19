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
