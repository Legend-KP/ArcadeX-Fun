import { requireSocialDb } from "@/lib/farcaster/social-db";
import { CAST_ONLY_PERMISSION } from "@/lib/farcaster/signer/permissions";

export type SignerStatus =
  | "pending_approval"
  | "active"
  | "retired"
  | "revoked"
  | "expired";

export type SignerRow = {
  fid: number;
  generation: number;
  player_id: string;
  public_key: string;
  status: SignerStatus;
  permissions: string;
  manifest_hash: string;
  manifest_text: string;
  metadata_type: number;
  metadata_hex: string;
  deadline: number;
  nonce: string;
  custody_address: string;
  approval_signature: string | null;
  onchain_tx: string | null;
  created_at: number;
  approved_at: number | null;
  activated_at: number | null;
  retired_at: number | null;
};

let schemaReady: Promise<void> | null = null;

export function ensureSignerSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const db = await requireSocialDb();
      await db
        .prepare(
          `CREATE TABLE IF NOT EXISTS farcaster_signers (
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
          )`
        )
        .bind()
        .run();
      await db
        .prepare(
          `CREATE INDEX IF NOT EXISTS idx_farcaster_signers_fid_status
           ON farcaster_signers (fid, status)`
        )
        .bind()
        .run();
      await db
        .prepare(
          `CREATE TABLE IF NOT EXISTS farcaster_signer_audit (
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
          )`
        )
        .bind()
        .run();
      await db
        .prepare(
          `CREATE INDEX IF NOT EXISTS idx_farcaster_signer_audit_fid
           ON farcaster_signer_audit (fid, created_at DESC)`
        )
        .bind()
        .run();
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

export async function getSigner(
  fid: number,
  generation: number
): Promise<SignerRow | null> {
  await ensureSignerSchema();
  const db = await requireSocialDb();
  return db
    .prepare(
      `SELECT * FROM farcaster_signers WHERE fid = ? AND generation = ?`
    )
    .bind(fid, generation)
    .first<SignerRow>();
}

export async function getLatestSigner(fid: number): Promise<SignerRow | null> {
  await ensureSignerSchema();
  const db = await requireSocialDb();
  return db
    .prepare(
      `SELECT * FROM farcaster_signers
       WHERE fid = ?
       ORDER BY generation DESC
       LIMIT 1`
    )
    .bind(fid)
    .first<SignerRow>();
}

export async function getActiveSigner(fid: number): Promise<SignerRow | null> {
  await ensureSignerSchema();
  const db = await requireSocialDb();
  return db
    .prepare(
      `SELECT * FROM farcaster_signers
       WHERE fid = ? AND status = 'active' AND permissions = ?
       ORDER BY generation DESC
       LIMIT 1`
    )
    .bind(fid, CAST_ONLY_PERMISSION)
    .first<SignerRow>();
}

export async function insertSigner(row: SignerRow): Promise<void> {
  await ensureSignerSchema();
  const db = await requireSocialDb();
  await db
    .prepare(
      `INSERT INTO farcaster_signers (
        fid, generation, player_id, public_key, status, permissions,
        manifest_hash, manifest_text, metadata_type, metadata_hex,
        deadline, nonce, custody_address, approval_signature, onchain_tx,
        created_at, approved_at, activated_at, retired_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      row.fid,
      row.generation,
      row.player_id,
      row.public_key,
      row.status,
      row.permissions,
      row.manifest_hash,
      row.manifest_text,
      row.metadata_type,
      row.metadata_hex,
      row.deadline,
      row.nonce,
      row.custody_address,
      row.approval_signature,
      row.onchain_tx,
      row.created_at,
      row.approved_at,
      row.activated_at,
      row.retired_at
    )
    .run();
}

export async function updatePendingSigner(input: {
  fid: number;
  generation: number;
  nonce: string;
  custody: string;
  deadline: number;
  manifestHash: string;
  manifestText: string;
  metadataType: number;
  metadataHex: string;
}): Promise<void> {
  await ensureSignerSchema();
  const db = await requireSocialDb();
  await db
    .prepare(
      `UPDATE farcaster_signers
       SET nonce = ?, custody_address = ?, deadline = ?,
           manifest_hash = ?, manifest_text = ?,
           metadata_type = ?, metadata_hex = ?, approval_signature = NULL
       WHERE fid = ? AND generation = ? AND status = 'pending_approval'`
    )
    .bind(
      input.nonce,
      input.custody,
      input.deadline,
      input.manifestHash,
      input.manifestText,
      input.metadataType,
      input.metadataHex,
      input.fid,
      input.generation
    )
    .run();
}

export async function markSignerApproved(input: {
  fid: number;
  generation: number;
}): Promise<void> {
  await ensureSignerSchema();
  const db = await requireSocialDb();
  await db
    .prepare(
      `UPDATE farcaster_signers
       SET approved_at = ?, approval_signature = NULL
       WHERE fid = ? AND generation = ? AND status = 'pending_approval'`
    )
    .bind(Date.now(), input.fid, input.generation)
    .run();
}

export async function markSignerActive(input: {
  fid: number;
  generation: number;
  txHash: string | null;
}): Promise<void> {
  await ensureSignerSchema();
  const db = await requireSocialDb();
  const now = Date.now();
  await db
    .prepare(
      `UPDATE farcaster_signers
       SET status = 'retired', retired_at = ?, approval_signature = NULL
       WHERE fid = ? AND status = 'active' AND generation != ?`
    )
    .bind(now, input.fid, input.generation)
    .run();
  await db
    .prepare(
      `UPDATE farcaster_signers
       SET status = 'active', activated_at = ?, onchain_tx = ?, approval_signature = NULL
       WHERE fid = ? AND generation = ?`
    )
    .bind(now, input.txHash, input.fid, input.generation)
    .run();
}

export async function markSignerStatus(input: {
  fid: number;
  generation: number;
  status: SignerStatus;
}): Promise<void> {
  await ensureSignerSchema();
  const db = await requireSocialDb();
  await db
    .prepare(
      `UPDATE farcaster_signers
       SET status = ?, retired_at = ?, approval_signature = NULL
       WHERE fid = ? AND generation = ?`
    )
    .bind(
      input.status,
      input.status === "pending_approval" ? null : Date.now(),
      input.fid,
      input.generation
    )
    .run();
}

export async function listRetiredGenerations(fid: number): Promise<number[]> {
  await ensureSignerSchema();
  const db = await requireSocialDb();
  const rows = await db
    .prepare(
      `SELECT generation FROM farcaster_signers
       WHERE fid = ? AND status = 'retired'`
    )
    .bind(fid)
    .all<{ generation: number }>();
  return (rows.results ?? []).map((row) => row.generation);
}

export async function writeSignerAudit(input: {
  fid: number;
  playerId: string;
  generation?: number | null;
  action: string;
  castText?: string | null;
  messageHash?: string | null;
  publicKey?: string | null;
  result: "ok" | "error";
  detail?: string | null;
}): Promise<void> {
  await ensureSignerSchema();
  const db = await requireSocialDb();
  const detail = input.detail?.replace(/\s+/g, " ").slice(0, 180) ?? null;
  await db
    .prepare(
      `INSERT INTO farcaster_signer_audit (
        id, fid, player_id, generation, action, cast_text, message_hash,
        public_key, result, detail, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      crypto.randomUUID(),
      input.fid,
      input.playerId,
      input.generation ?? null,
      input.action,
      input.castText ?? null,
      input.messageHash ?? null,
      input.publicKey ?? null,
      input.result,
      detail,
      Date.now()
    )
    .run();
}
