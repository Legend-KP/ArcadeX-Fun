-- Public signer records and audit trail.
-- Ed25519 private keys are NOT stored here. Ciphertext lives in the
-- FARCASTER_SIGNER_VAULT KV binding, wrapped with a key that is not in D1.

CREATE TABLE IF NOT EXISTS farcaster_signers (
  fid INTEGER NOT NULL,
  generation INTEGER NOT NULL,
  player_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  status TEXT NOT NULL,
  permissions TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  manifest_text TEXT NOT NULL,
  metadata_type INTEGER NOT NULL,
  metadata_hex TEXT NOT NULL,
  deadline INTEGER NOT NULL,
  nonce TEXT NOT NULL,
  custody_address TEXT NOT NULL,
  approval_signature TEXT,
  onchain_tx TEXT,
  created_at INTEGER NOT NULL,
  approved_at INTEGER,
  activated_at INTEGER,
  retired_at INTEGER,
  PRIMARY KEY (fid, generation)
);

CREATE INDEX IF NOT EXISTS idx_farcaster_signers_fid_status
  ON farcaster_signers (fid, status);

CREATE TABLE IF NOT EXISTS farcaster_signer_audit (
  id TEXT PRIMARY KEY NOT NULL,
  fid INTEGER NOT NULL,
  player_id TEXT NOT NULL,
  generation INTEGER,
  action TEXT NOT NULL,
  cast_text TEXT,
  message_hash TEXT,
  public_key TEXT,
  result TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_farcaster_signer_audit_fid
  ON farcaster_signer_audit (fid, created_at DESC);
