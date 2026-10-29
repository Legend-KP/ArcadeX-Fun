-- Community circles and shareable invite links.
-- The URL holds a random token. This table stores only its hash.

CREATE TABLE IF NOT EXISTS circles (
  id TEXT PRIMARY KEY NOT NULL,
  creator_fid INTEGER NOT NULL,
  creator_player_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  visibility TEXT NOT NULL,
  member_count INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS circle_members (
  circle_id TEXT NOT NULL,
  fid INTEGER NOT NULL,
  player_id TEXT NOT NULL,
  role TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (circle_id, fid)
);

CREATE INDEX IF NOT EXISTS idx_circle_members_fid
  ON circle_members (fid, circle_id);

CREATE TABLE IF NOT EXISTS circle_invites (
  id TEXT PRIMARY KEY NOT NULL,
  circle_id TEXT NOT NULL,
  inviter_fid INTEGER NOT NULL,
  target_fid INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_circle_invites_target
  ON circle_invites (target_fid, status);

CREATE TABLE IF NOT EXISTS circle_invite_links (
  id TEXT PRIMARY KEY NOT NULL,
  circle_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  creator_fid INTEGER NOT NULL,
  expires_at INTEGER,
  max_uses INTEGER NOT NULL,
  uses INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_circle_invite_links_circle
  ON circle_invite_links (circle_id, created_at DESC);
