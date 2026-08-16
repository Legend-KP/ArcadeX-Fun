import {
  generatePlaySessionId,
  isValidPlaySessionId,
  PLAY_SESSION_TTL_MS,
  type PlaySessionRecord,
  type ScoreAnomalyResult,
  type ScoreBounds,
} from "@/lib/play-session";
import {
  getPlayerRtdbConnection,
  type RtdbConnection,
} from "@/lib/rtdb-resolver";
import { rtdbDelete, rtdbRead, rtdbWrite } from "@/lib/rtdb-rest";
import type { WalletEcosystem } from "@/lib/player-identity";

export class PlaySessionError extends Error {
  constructor(
    message: string,
    readonly code:
      | "INVALID_SESSION"
      | "SESSION_EXPIRED"
      | "SESSION_CONSUMED"
      | "SESSION_MISMATCH"
  ) {
    super(message);
    this.name = "PlaySessionError";
  }
}

type PlayerChainScope = {
  chainId?: number | null;
  ecosystem?: WalletEcosystem | null;
};

function connectionFor(scope?: PlayerChainScope): RtdbConnection {
  return getPlayerRtdbConnection({
    chainId: scope?.chainId,
    ecosystem: scope?.ecosystem,
  });
}

function playSessionPath(playSessionId: string): string {
  return `playSessions/${playSessionId}`;
}

export async function createPlaySessionOnServer(params: {
  playerId: string;
  gameId: string;
  walletAddress: string;
  chainId?: number | null;
  ecosystem?: WalletEcosystem | null;
  now?: number;
}): Promise<{ playSessionId: string; session: PlaySessionRecord }> {
  const now = params.now ?? Date.now();
  const playSessionId = generatePlaySessionId();
  const session: PlaySessionRecord = {
    playerId: params.playerId,
    gameId: params.gameId,
    walletAddress: params.walletAddress,
    startedAt: now,
    expiresAt: now + PLAY_SESSION_TTL_MS,
    status: "active",
  };

  await rtdbWrite(playSessionPath(playSessionId), session, {
    silent: true,
    connection: connectionFor(params),
  });

  return { playSessionId, session };
}

export async function assertPlaySessionActive(params: {
  playSessionId: string;
  playerId: string;
  gameId: string;
  chainId?: number | null;
  ecosystem?: WalletEcosystem | null;
  now?: number;
}): Promise<PlaySessionRecord> {
  const id = params.playSessionId.trim();
  if (!isValidPlaySessionId(id)) {
    throw new PlaySessionError(
      "A valid play session is required.",
      "INVALID_SESSION"
    );
  }

  const connection = connectionFor(params);
  const session = await rtdbRead<PlaySessionRecord>(
    playSessionPath(id),
    undefined,
    connection
  );

  if (!session) {
    throw new PlaySessionError(
      "Play session not found. Start the game again.",
      "INVALID_SESSION"
    );
  }

  if (session.playerId !== params.playerId || session.gameId !== params.gameId) {
    throw new PlaySessionError(
      "Play session does not match this player or game.",
      "SESSION_MISMATCH"
    );
  }

  const now = params.now ?? Date.now();
  if (session.expiresAt <= now) {
    await rtdbDelete(playSessionPath(id), {
      silent: true,
      connection,
    }).catch(() => {});
    throw new PlaySessionError(
      "Play session expired. Start the game again.",
      "SESSION_EXPIRED"
    );
  }

  if (session.status !== "active") {
    throw new PlaySessionError(
      "Play session already used. Start the game again.",
      "SESSION_CONSUMED"
    );
  }

  return session;
}

/** Mark session consumed after a successful paid leaderboard submit. */
export async function consumePlaySessionOnServer(params: {
  playSessionId: string;
  playerId: string;
  gameId: string;
  chainId?: number | null;
  ecosystem?: WalletEcosystem | null;
  now?: number;
}): Promise<void> {
  const session = await assertPlaySessionActive(params);
  const now = params.now ?? Date.now();
  const next: PlaySessionRecord = {
    ...session,
    status: "consumed",
    consumedAt: now,
  };
  await rtdbWrite(playSessionPath(params.playSessionId.trim()), next, {
    silent: true,
    connection: connectionFor(params),
  });
}

export async function flagAnomalousScoreOnServer(params: {
  gameId: string;
  playerId: string;
  score: number;
  playSessionId: string;
  reasons: string[];
  scoreBounds?: ScoreBounds | null;
  sessionStartedAt: number;
  elapsedMs: number;
  chainId?: number | null;
  ecosystem?: WalletEcosystem | null;
  source: "progress" | "leaderboard_submit";
}): Promise<void> {
  const anomaly: ScoreAnomalyResult & {
    gameId: string;
    playerId: string;
    score: number;
    playSessionId: string;
    scoreBounds?: ScoreBounds | null;
    sessionStartedAt: number;
    elapsedMs: number;
    source: string;
    flaggedAt: number;
  } = {
    flagged: true,
    reasons: params.reasons,
    gameId: params.gameId,
    playerId: params.playerId,
    score: params.score,
    playSessionId: params.playSessionId,
    scoreBounds: params.scoreBounds ?? null,
    sessionStartedAt: params.sessionStartedAt,
    elapsedMs: params.elapsedMs,
    source: params.source,
    flaggedAt: Date.now(),
  };

  const key = `${params.gameId}_${params.playerId.replace(/[/\\.#$[\]]/g, "_")}_${Date.now()}`;
  await rtdbWrite(`flaggedScores/${key}`, anomaly, {
    silent: true,
    connection: connectionFor(params),
  });
}
