import { getWorkerEnv, type D1DatabaseBinding } from "@/lib/worker-env";
import type { SocialProfile } from "@/types";

export type D1DatabaseLike = D1DatabaseBinding;

type ProfileRow = {
  player_id: string;
  fid: number | null;
  primary_wallet: string | null;
  username: string | null;
  email: string | null;
  email_verified_at: number | null;
  display_name: string | null;
  fname: string | null;
  pfp_url: string | null;
  custody_address: string | null;
  recovery_address: string | null;
  ecosystem: string | null;
  chain_id: number | null;
  created_at: number;
  updated_at: number;
};

export async function getSocialDb(): Promise<D1DatabaseLike | null> {
  const env = await getWorkerEnv();
  return env?.ARCADEX_SOCIAL_DB ?? null;
}

export async function requireSocialDb(): Promise<D1DatabaseLike> {
  const db = await getSocialDb();
  if (!db) {
    throw new Error(
      "ARCADEX_SOCIAL_DB binding missing. Add d1_databases in wrangler.jsonc and redeploy."
    );
  }
  return db;
}

function rowToProfile(row: ProfileRow): SocialProfile {
  return {
    playerId: row.player_id,
    fid: row.fid ?? undefined,
    primaryWallet: row.primary_wallet ?? undefined,
    username: row.username ?? undefined,
    email: row.email ?? undefined,
    emailVerifiedAt: row.email_verified_at ?? undefined,
    displayName: row.display_name ?? undefined,
    fname: row.fname ?? undefined,
    pfpUrl: row.pfp_url ?? undefined,
    custodyAddress: row.custody_address ?? undefined,
    recoveryAddress: row.recovery_address ?? undefined,
    ecosystem: row.ecosystem ?? undefined,
    chainId: row.chain_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function fetchSocialProfileByPlayerId(
  playerId: string
): Promise<SocialProfile | null> {
  const db = await requireSocialDb();
  const row = await db
    .prepare("SELECT * FROM profiles WHERE player_id = ?")
    .bind(playerId)
    .first<ProfileRow>();
  return row ? rowToProfile(row) : null;
}

export async function fetchSocialProfileByFid(
  fid: number
): Promise<SocialProfile | null> {
  const db = await requireSocialDb();
  const row = await db
    .prepare("SELECT * FROM profiles WHERE fid = ?")
    .bind(fid)
    .first<ProfileRow>();
  return row ? rowToProfile(row) : null;
}

export async function fetchSocialProfileByUsername(
  username: string
): Promise<SocialProfile | null> {
  const db = await requireSocialDb();
  const normalized = username.trim().toLowerCase();
  const row = await db
    .prepare("SELECT * FROM profiles WHERE username = ?")
    .bind(normalized)
    .first<ProfileRow>();
  return row ? rowToProfile(row) : null;
}

export type UpsertSocialProfileInput = {
  playerId: string;
  fid?: number | null;
  primaryWallet?: string | null;
  username?: string | null;
  email?: string | null;
  emailVerifiedAt?: number | null;
  displayName?: string | null;
  fname?: string | null;
  pfpUrl?: string | null;
  custodyAddress?: string | null;
  recoveryAddress?: string | null;
  ecosystem?: string | null;
  chainId?: number | null;
};

export async function upsertSocialProfile(
  input: UpsertSocialProfileInput
): Promise<SocialProfile> {
  const db = await requireSocialDb();
  const now = Date.now();
  const existing = await fetchSocialProfileByPlayerId(input.playerId);

  const fid = input.fid !== undefined ? input.fid : existing?.fid ?? null;
  const primaryWallet =
    input.primaryWallet !== undefined
      ? input.primaryWallet
      : existing?.primaryWallet ?? null;
  const username =
    input.username !== undefined ? input.username : existing?.username ?? null;
  const email =
    input.email !== undefined ? input.email : existing?.email ?? null;
  const emailVerifiedAt =
    input.emailVerifiedAt !== undefined
      ? input.emailVerifiedAt
      : existing?.emailVerifiedAt ?? null;
  const displayName =
    input.displayName !== undefined
      ? input.displayName
      : existing?.displayName ?? null;
  const fname =
    input.fname !== undefined ? input.fname : existing?.fname ?? null;
  const pfpUrl =
    input.pfpUrl !== undefined ? input.pfpUrl : existing?.pfpUrl ?? null;
  const custodyAddress =
    input.custodyAddress !== undefined
      ? input.custodyAddress
      : existing?.custodyAddress ?? null;
  const recoveryAddress =
    input.recoveryAddress !== undefined
      ? input.recoveryAddress
      : existing?.recoveryAddress ?? null;
  const ecosystem =
    input.ecosystem !== undefined
      ? input.ecosystem
      : existing?.ecosystem ?? null;
  const chainId =
    input.chainId !== undefined ? input.chainId : existing?.chainId ?? null;
  const createdAt = existing?.createdAt ?? now;

  await db
    .prepare(
      `INSERT INTO profiles (
        player_id, fid, primary_wallet, username, email, email_verified_at,
        display_name, fname, pfp_url, custody_address, recovery_address,
        ecosystem, chain_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(player_id) DO UPDATE SET
        fid = excluded.fid,
        primary_wallet = excluded.primary_wallet,
        username = excluded.username,
        email = excluded.email,
        email_verified_at = excluded.email_verified_at,
        display_name = excluded.display_name,
        fname = excluded.fname,
        pfp_url = excluded.pfp_url,
        custody_address = excluded.custody_address,
        recovery_address = excluded.recovery_address,
        ecosystem = excluded.ecosystem,
        chain_id = excluded.chain_id,
        updated_at = excluded.updated_at`
    )
    .bind(
      input.playerId,
      fid,
      primaryWallet,
      username,
      email,
      emailVerifiedAt,
      displayName,
      fname,
      pfpUrl,
      custodyAddress,
      recoveryAddress,
      ecosystem,
      chainId,
      createdAt,
      now
    )
    .run();

  if (typeof fid === "number" && fid > 0) {
    await db
      .prepare(
        `INSERT INTO fids (fid, player_id, created_at)
         VALUES (?, ?, ?)
         ON CONFLICT(fid) DO UPDATE SET player_id = excluded.player_id`
      )
      .bind(fid, input.playerId, now)
      .run();
  }

  const profile = await fetchSocialProfileByPlayerId(input.playerId);
  if (!profile) {
    throw new Error("Failed to persist social profile.");
  }
  return profile;
}
