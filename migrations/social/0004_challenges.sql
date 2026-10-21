CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY NOT NULL,
  challenger_fid INTEGER NOT NULL,
  challenger_name TEXT NOT NULL,
  challenger_player_id TEXT NOT NULL,
  target_fid INTEGER NOT NULL,
  target_label TEXT NOT NULL,
  game_id TEXT NOT NULL,
  game_name TEXT NOT NULL,
  expiry_hours INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  accepted_at INTEGER,
  result_post_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_challenges_target
  ON challenges (target_fid, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_challenges_challenger
  ON challenges (challenger_fid, created_at DESC);
