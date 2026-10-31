-- In-app inbox, live presence, reports, circle posts, and invite declines.
-- Runtime ensure* helpers create the same tables when this migration
-- has not been applied yet.

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY NOT NULL,
  fid INTEGER NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  href TEXT,
  camp_kind TEXT,
  camp_id TEXT,
  created_at INTEGER NOT NULL,
  read_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_notifications_fid
  ON notifications (fid, created_at DESC);

CREATE TABLE IF NOT EXISTS notification_broadcasts (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  href TEXT,
  camp_kind TEXT,
  camp_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_reads (
  broadcast_id TEXT NOT NULL,
  fid INTEGER NOT NULL,
  read_at INTEGER NOT NULL,
  PRIMARY KEY (broadcast_id, fid)
);

CREATE TABLE IF NOT EXISTS presence (
  fid INTEGER PRIMARY KEY NOT NULL,
  last_seen INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS content_reports (
  id TEXT PRIMARY KEY NOT NULL,
  reporter_fid INTEGER NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE TABLE IF NOT EXISTS circle_posts (
  id TEXT PRIMARY KEY NOT NULL,
  circle_id TEXT NOT NULL,
  fid INTEGER NOT NULL,
  player_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_handle TEXT,
  pfp_url TEXT,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  removed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_circle_posts_circle
  ON circle_posts (circle_id, created_at DESC);

CREATE TABLE IF NOT EXISTS circle_invite_declines (
  token_hash TEXT NOT NULL,
  fid INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (token_hash, fid)
);

CREATE INDEX IF NOT EXISTS idx_circles_updated
  ON circles (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_circle_join_requests_circle
  ON circle_join_requests (circle_id, status);
