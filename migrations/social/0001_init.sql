-- ArcadeX social identity (Farcaster). Do not store these fields in Firebase RTDB.

CREATE TABLE IF NOT EXISTS profiles (
  player_id TEXT PRIMARY KEY NOT NULL,
  fid INTEGER UNIQUE,
  primary_wallet TEXT,
  username TEXT UNIQUE,
  email TEXT,
  email_verified_at INTEGER,
  display_name TEXT,
  fname TEXT,
  pfp_url TEXT,
  custody_address TEXT,
  recovery_address TEXT,
  ecosystem TEXT,
  chain_id INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_profiles_fid ON profiles (fid);
CREATE INDEX IF NOT EXISTS idx_profiles_primary_wallet ON profiles (primary_wallet);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles (email);

CREATE TABLE IF NOT EXISTS usernames (
  username TEXT PRIMARY KEY NOT NULL,
  player_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (player_id) REFERENCES profiles (player_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS fids (
  fid INTEGER PRIMARY KEY NOT NULL,
  player_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (player_id) REFERENCES profiles (player_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS email_verification (
  id TEXT PRIMARY KEY NOT NULL,
  player_id TEXT NOT NULL,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (player_id) REFERENCES profiles (player_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_email_verification_player
  ON email_verification (player_id, email);
