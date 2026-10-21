-- Farcaster-style actions on posts and score casts.
CREATE TABLE IF NOT EXISTS post_likes (
  post_id TEXT NOT NULL,
  fid INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, fid)
);

CREATE TABLE IF NOT EXISTS post_shares (
  post_id TEXT NOT NULL,
  fid INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, fid)
);

CREATE TABLE IF NOT EXISTS post_comments (
  id TEXT PRIMARY KEY NOT NULL,
  post_id TEXT NOT NULL,
  fid INTEGER NOT NULL,
  author_name TEXT NOT NULL,
  author_handle TEXT,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_post_comments_post
  ON post_comments (post_id, created_at ASC);
