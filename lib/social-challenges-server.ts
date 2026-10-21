import {
  fetchSocialProfileByFid,
  fetchSocialProfileByUsername,
  requireSocialDb,
} from "@/lib/farcaster/social-db";
import { ensureSocialBoardSchema } from "@/lib/social-board";
import type { SocialProfile } from "@/types";

export type ChallengeStatus = "pending" | "accepted" | "declined";

export type SocialChallenge = {
  id: string;
  challengerName: string;
  challengerFid: number;
  targetFid: number;
  targetLabel: string;
  gameId: string;
  gameName: string;
  expiryHours: 24 | 72;
  createdAt: number;
  status: ChallengeStatus;
  acceptedAt: number | null;
  resultPostId: string | null;
};

type ChallengeRow = {
  id: string;
  challenger_fid: number;
  challenger_name: string;
  challenger_player_id: string;
  target_fid: number;
  target_label: string;
  game_id: string;
  game_name: string;
  expiry_hours: number;
  status: string;
  created_at: number;
  accepted_at: number | null;
  result_post_id: string | null;
};

function toChallenge(row: ChallengeRow): SocialChallenge {
  return {
    id: row.id,
    challengerName: row.challenger_name,
    challengerFid: row.challenger_fid,
    targetFid: row.target_fid,
    targetLabel: row.target_label,
    gameId: row.game_id,
    gameName: row.game_name,
    expiryHours: row.expiry_hours === 72 ? 72 : 24,
    createdAt: row.created_at,
    status:
      row.status === "accepted" || row.status === "declined"
        ? row.status
        : "pending",
    acceptedAt: row.accepted_at,
    resultPostId: row.result_post_id,
  };
}

export async function findChallengeTarget(
  raw: string
): Promise<SocialProfile | null> {
  const target = raw.trim().replace(/^@/, "");
  if (!target) return null;
  if (/^\d+$/.test(target)) {
    const byFid = await fetchSocialProfileByFid(Number(target));
    if (byFid?.fid) return byFid;
  }
  return fetchSocialProfileByUsername(target);
}

export async function listChallengesForFid(fid: number): Promise<SocialChallenge[]> {
  await ensureSocialBoardSchema();
  const db = await requireSocialDb();
  const result = await db
    .prepare(
      `SELECT id, challenger_fid, challenger_name, challenger_player_id,
              target_fid, target_label, game_id, game_name, expiry_hours,
              status, created_at, accepted_at, result_post_id
       FROM challenges
       WHERE challenger_fid = ? OR target_fid = ?
       ORDER BY created_at DESC
       LIMIT 50`
    )
    .bind(fid, fid)
    .all<ChallengeRow>();
  return (result.results ?? []).map(toChallenge);
}

export async function createChallenge(input: {
  challengerFid: number;
  challengerName: string;
  challengerPlayerId: string;
  target: SocialProfile;
  targetLabel: string;
  gameId: string;
  gameName: string;
  expiryHours: 24 | 72;
}): Promise<SocialChallenge> {
  await ensureSocialBoardSchema();
  if (!input.target.fid) {
    throw new Error("That player has no FID.");
  }
  const db = await requireSocialDb();
  const row: ChallengeRow = {
    id: crypto.randomUUID(),
    challenger_fid: input.challengerFid,
    challenger_name: input.challengerName,
    challenger_player_id: input.challengerPlayerId,
    target_fid: input.target.fid,
    target_label: input.targetLabel,
    game_id: input.gameId,
    game_name: input.gameName,
    expiry_hours: input.expiryHours,
    status: "pending",
    created_at: Date.now(),
    accepted_at: null,
    result_post_id: null,
  };
  await db
    .prepare(
      `INSERT INTO challenges (
        id, challenger_fid, challenger_name, challenger_player_id,
        target_fid, target_label, game_id, game_name, expiry_hours,
        status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      row.id,
      row.challenger_fid,
      row.challenger_name,
      row.challenger_player_id,
      row.target_fid,
      row.target_label,
      row.game_id,
      row.game_name,
      row.expiry_hours,
      row.status,
      row.created_at
    )
    .run();
  return toChallenge(row);
}

export async function getChallenge(id: string): Promise<SocialChallenge | null> {
  await ensureSocialBoardSchema();
  const db = await requireSocialDb();
  const row = await db
    .prepare(
      `SELECT id, challenger_fid, challenger_name, challenger_player_id,
              target_fid, target_label, game_id, game_name, expiry_hours,
              status, created_at, accepted_at, result_post_id
       FROM challenges WHERE id = ?`
    )
    .bind(id)
    .first<ChallengeRow>();
  return row ? toChallenge(row) : null;
}

export async function setChallengeStatus(
  id: string,
  fid: number,
  status: "accepted" | "declined"
): Promise<SocialChallenge | null> {
  await ensureSocialBoardSchema();
  const db = await requireSocialDb();
  const acceptedAt = status === "accepted" ? Date.now() : null;
  await db
    .prepare(
      `UPDATE challenges
       SET status = ?, accepted_at = ?
       WHERE id = ? AND target_fid = ? AND status = 'pending'`
    )
    .bind(status, acceptedAt, id, fid)
    .run();
  return getChallenge(id);
}

export async function attachChallengeResult(
  id: string,
  fid: number,
  postId: string
): Promise<boolean> {
  await ensureSocialBoardSchema();
  const db = await requireSocialDb();
  await db
    .prepare(
      `UPDATE challenges
       SET result_post_id = ?
       WHERE id = ?
         AND status = 'accepted'
         AND result_post_id IS NULL
         AND (challenger_fid = ? OR target_fid = ?)`
    )
    .bind(postId, id, fid, fid)
    .run();
  const saved = await getChallenge(id);
  return saved?.resultPostId === postId;
}
