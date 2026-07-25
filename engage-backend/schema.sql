-- BigCat Learning Hub — D1 schema.
-- Apply with:
--   npx wrangler d1 execute bigcat-engage --file=schema.sql --remote

-- One row per (email, list): an address can subscribe to several tabs.
-- `list` = which tab they subscribed under ("mental-models", ..., or "hub").
CREATE TABLE IF NOT EXISTS subscriptions (
  email     TEXT    NOT NULL,
  list      TEXT    NOT NULL DEFAULT 'hub',
  ts        INTEGER NOT NULL,
  confirmed INTEGER NOT NULL DEFAULT 1, -- 0 = awaiting double-opt-in click
  token     TEXT,                       -- confirm token while pending, else NULL
  lang      TEXT    NOT NULL DEFAULT 'zh', -- language of the page they subscribed from
  PRIMARY KEY (email, list)
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_list ON subscriptions (list);

CREATE TABLE IF NOT EXISTS votes (
  poll   TEXT    NOT NULL,
  choice TEXT    NOT NULL,
  voter  TEXT    NOT NULL,
  ts     INTEGER NOT NULL,
  PRIMARY KEY (poll, voter)
);

CREATE INDEX IF NOT EXISTS idx_votes_poll ON votes (poll);

CREATE TABLE IF NOT EXISTS comments (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  page     TEXT    NOT NULL,           -- pathname the comment belongs to
  name     TEXT    NOT NULL,           -- display name (defaults to Anonymous)
  body     TEXT    NOT NULL,           -- raw text; rendered with textContent (no HTML)
  ts       INTEGER NOT NULL,
  approved INTEGER NOT NULL DEFAULT 1, -- 1 = visible; 0 = held for moderation
  iphash   TEXT                        -- salted hash, for rate limiting only
);

CREATE INDEX IF NOT EXISTS idx_comments_page ON comments (page, ts);
CREATE INDEX IF NOT EXISTS idx_comments_iphash ON comments (iphash, ts);

-- Accounts. Anyone may register; an account can only log in once the emailed
-- verification link has been clicked. Passwords are PBKDF2-SHA256 (100k
-- iterations — Workers' hard ceiling) over an HMAC of the password with the
-- AUTH_PEPPER secret, so a database leak alone is not enough to crack them.
CREATE TABLE IF NOT EXISTS users (
  id       TEXT    PRIMARY KEY,        -- uuid
  email    TEXT    NOT NULL UNIQUE,    -- lowercased
  pwhash   TEXT    NOT NULL,           -- pbkdf2$<iter>$<salt_b64>$<hash_b64>
  -- Public display name shown on comments. The email is NEVER exposed
  -- publicly; when this is blank the worker falls back to the email's local
  -- part so a pre-existing account still has something to show.
  display_name TEXT NOT NULL DEFAULT '',
  verified INTEGER NOT NULL DEFAULT 0,
  vtoken   TEXT,                       -- email-verification token, cleared on use
  rtoken   TEXT,                       -- password-reset token, cleared on use
  rexpires INTEGER,                    -- reset token expiry (ms epoch)
  created  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_vtoken ON users (vtoken);
CREATE INDEX IF NOT EXISTS idx_users_rtoken ON users (rtoken);

-- Login sessions. `token` is the SHA-256 of the secret handed to the browser,
-- so the database never holds anything that can be replayed directly.
CREATE TABLE IF NOT EXISTS sessions (
  token   TEXT    PRIMARY KEY,
  user_id TEXT    NOT NULL,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

-- Failed-login throttling, per salted IP hash.
CREATE TABLE IF NOT EXISTS auth_attempts (
  iphash TEXT    NOT NULL,
  ts     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_attempts ON auth_attempts (iphash, ts);

-- Highlight notes, scoped to the account that made them. `id` is minted
-- client-side so a note saved offline keeps its identity when it syncs later.
-- `prefix`/`suffix` are the surrounding characters, used to find the exact
-- occurrence again when jumping back into the article.
CREATE TABLE IF NOT EXISTS notes (
  id      TEXT    PRIMARY KEY,        -- client-generated uuid
  user_id TEXT    NOT NULL DEFAULT '',-- owner; every query filters on this
  page    TEXT    NOT NULL,           -- pathname the highlight lives on
  title   TEXT    NOT NULL DEFAULT '',-- page title, for the notes list
  lang    TEXT    NOT NULL DEFAULT 'zh',
  text    TEXT    NOT NULL,           -- the highlighted passage
  prefix  TEXT    NOT NULL DEFAULT '',-- ~40 chars before, for re-locating
  suffix  TEXT    NOT NULL DEFAULT '',-- ~40 chars after
  comment TEXT    NOT NULL DEFAULT '',-- optional own words
  ts      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notes_ts ON notes (ts);
CREATE INDEX IF NOT EXISTS idx_notes_user ON notes (user_id, ts);

-- Read/finished markers, one row per (account, page). Marked automatically on
-- reaching the end of an article — by scrolling or by listening to the last TTS
-- segment — and toggleable by hand.
CREATE TABLE IF NOT EXISTS reads (
  user_id TEXT    NOT NULL,
  page    TEXT    NOT NULL,
  ts      INTEGER NOT NULL,
  PRIMARY KEY (user_id, page)
);
CREATE INDEX IF NOT EXISTS idx_reads_user ON reads (user_id, ts);
