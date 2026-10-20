-- Text posts and a FID-keyed daily check-in. No wallet and no chain transaction.

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY NOT NULL,
  fid INTEGER NOT NULL,
  player_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  pfp_url TEXT,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_posts_created ON posts (created_at DESC);

CREATE TABLE IF NOT EXISTS fid_streaks (
  fid INTEGER PRIMARY KEY NOT NULL,
  player_id TEXT NOT NULL,
  current_streak INTEGER NOT NULL,
  last_check_in INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
