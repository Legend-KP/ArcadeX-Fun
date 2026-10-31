import {
  fetchSocialProfileByFid,
  fetchSocialProfileByUsername,
  requireSocialDb,
  searchSocialProfiles,
} from "@/lib/farcaster/social-db";
import { ensureCircleSchema } from "@/lib/circle-invites";
import { ensureSocialBoardSchema } from "@/lib/social-board";
import { notifyUser } from "@/lib/social-inbox";
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
  circleId: string | null;
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
  circle_id: string | null;
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
    circleId: row.circle_id,
  };
}

export function challengeWindowOpen(
  challenge: Pick<SocialChallenge, "status" | "acceptedAt" | "expiryHours">,
  now = Date.now()
): boolean {
  if (challenge.status !== "accepted" || !challenge.acceptedAt) return false;
  return now <= challenge.acceptedAt + challenge.expiryHours * 60 * 60 * 1000;
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
  const byUsername = await fetchSocialProfileByUsername(target);
  if (byUsername?.fid) return byUsername;

  const matches = await searchSocialProfiles(target, 8).catch(() => []);
  const needle = target.toLowerCase();
  const exact = matches.filter((row) => {
    const name = row.displayName?.trim().toLowerCase();
    const fname = row.fname?.trim().toLowerCase();
    const username = row.username?.trim().toLowerCase();
    return name === needle || fname === needle || username === needle;
  });
  const pick = exact.length === 1 ? exact[0] : matches.length === 1 ? matches[0] : null;
  if (!pick?.fid) return null;
  return fetchSocialProfileByFid(pick.fid);
}

export async function listChallengesForFid(fid: number): Promise<SocialChallenge[]> {
  await ensureSocialBoardSchema();
  const db = await requireSocialDb();
  const result = await db
    .prepare(
      `SELECT id, challenger_fid, challenger_name, challenger_player_id,
              target_fid, target_label, game_id, game_name, expiry_hours,
              status, created_at, accepted_at, result_post_id, circle_id
       FROM challenges
       WHERE challenger_fid = ? OR target_fid = ?
       ORDER BY created_at DESC
       LIMIT 50`
    )
    .bind(fid, fid)
    .all<ChallengeRow>();
  return (result.results ?? []).map(toChallenge);
}

export async function listChallengesForCircle(
  circleId: string
): Promise<SocialChallenge[]> {
  await ensureSocialBoardSchema();
  const db = await requireSocialDb();
  const result = await db
    .prepare(
      `SELECT id, challenger_fid, challenger_name, challenger_player_id,
              target_fid, target_label, game_id, game_name, expiry_hours,
              status, created_at, accepted_at, result_post_id, circle_id
       FROM challenges
       WHERE circle_id = ?
       ORDER BY created_at DESC
       LIMIT 40`
    )
    .bind(circleId)
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
  circleId?: string | null;
}): Promise<SocialChallenge> {
  await ensureSocialBoardSchema();
  if (!input.target.fid) {
    throw new Error("That player has no FID.");
  }
  const db = await requireSocialDb();
  const circleId = input.circleId ?? null;
  if (circleId) {
    await ensureCircleSchema();
    const members = await db
      .prepare(
        `SELECT fid FROM circle_members
         WHERE circle_id = ? AND fid IN (?, ?)`
      )
      .bind(circleId, input.challengerFid, input.target.fid)
      .all<{ fid: number }>();
    if ((members.results ?? []).length < 2) {
      throw new Error("Both players have to be in this circle.");
    }
  }
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
    circle_id: circleId,
  };
  await db
    .prepare(
      `INSERT INTO challenges (
        id, challenger_fid, challenger_name, challenger_player_id,
        target_fid, target_label, game_id, game_name, expiry_hours,
        status, created_at, circle_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      row.created_at,
      circleId
    )
    .run();
  await notifyUser({
    fid: input.target.fid,
    kind: "challenge",
    title: `${input.challengerName} challenged you`,
    body: `${input.gameName} · ${input.expiryHours}h after you accept`,
    href: circleId ? `/circle/${circleId}` : "/?section=challenges",
    campKind: circleId ? "circle" : null,
    campId: circleId,
  });
  return toChallenge(row);
}

export async function getChallenge(id: string): Promise<SocialChallenge | null> {
  await ensureSocialBoardSchema();
  const db = await requireSocialDb();
  const row = await db
    .prepare(
      `SELECT id, challenger_fid, challenger_name, challenger_player_id,
              target_fid, target_label, game_id, game_name, expiry_hours,
              status, created_at, accepted_at, result_post_id, circle_id
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
  const challenge = await getChallenge(id);
  if (challenge && challenge.status === status) {
    await notifyUser({
      fid: challenge.challengerFid,
      kind: "challenge",
      title:
        status === "accepted"
          ? "Your challenge was accepted"
          : "Your challenge was declined",
      body: `${challenge.gameName} · ${challenge.targetLabel}`,
      href: challenge.circleId
        ? `/circle/${challenge.circleId}`
        : "/?section=challenges",
      campKind: challenge.circleId ? "circle" : null,
      campId: challenge.circleId,
    });
  }
  return challenge;
}

export async function attachChallengeResult(
  id: string,
  fid: number,
  postId: string
): Promise<boolean> {
  await ensureSocialBoardSchema();
  const db = await requireSocialDb();
  const current = await getChallenge(id);
  if (!current || !challengeWindowOpen(current)) return false;
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
