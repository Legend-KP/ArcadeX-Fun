-- Remember when a player skips the optional ArcadeX username.

CREATE TABLE IF NOT EXISTS username_choices (
  player_id TEXT PRIMARY KEY NOT NULL,
  skipped_at INTEGER NOT NULL
);
