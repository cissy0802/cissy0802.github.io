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

-- Highlight notes (owner-private; every /notes-* endpoint requires NOTES_TOKEN).
-- `id` is minted client-side so a note saved offline keeps its identity when it
-- syncs later. `prefix`/`suffix` are the surrounding characters, used to find
-- the exact occurrence again when jumping back into the article.
CREATE TABLE IF NOT EXISTS notes (
  id      TEXT    PRIMARY KEY,        -- client-generated uuid
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
CREATE INDEX IF NOT EXISTS idx_notes_page ON notes (page, ts);
