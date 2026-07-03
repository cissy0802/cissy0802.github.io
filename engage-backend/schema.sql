-- BigCat Learning Hub — D1 schema.
-- Apply with:
--   npx wrangler d1 execute bigcat-engage --file=schema.sql --remote

CREATE TABLE IF NOT EXISTS subscribers (
  email TEXT PRIMARY KEY,
  ts    INTEGER NOT NULL
);

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
