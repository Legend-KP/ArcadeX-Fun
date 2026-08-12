import { fetchGameFromServer } from "@/lib/firestore-server";
import {
  resolveGameProgressFromServer,
  saveGameProgressOnServer,
} from "@/lib/rtdb-server";
import {
  corsJsonResponse,
  handleCorsPreflightRequest,
} from "@/lib/cors";
import { gameHasLeaderboard } from "@/types";
import { resolvePlayerId } from "@/lib/player-identity";
import { cachedGetProgress, invalidateProgressCache } from "@/lib/progress-response-cache";
import { coalesceProgressWrite } from "@/lib/progress-write-coalesce";
import { readSessionFromCookies } from "@/lib/auth-session";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import {
  evaluateScoreAnomaly,
  shouldEnforceScoreBounds,
} from "@/lib/play-session";
import {
  assertPlaySessionActive,
  flagAnomalousScoreOnServer,
  PlaySessionError,
} from "@/lib/play-session-server";

export const dynamic = "force-dynamic";

export async function OPTIONS(request: Request) {
  return handleCorsPreflightRequest(request);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const game = await fetchGameFromServer(id);
    if (!game) {
      return corsJsonResponse(
        request,
        { error: "Game not found." },
        { status: 404 }
      );
    }

    const { searchParams } = new URL(request.url);
    const playerId =
      resolvePlayerId(searchParams.get("playerId") ?? "") ??
      resolvePlayerId(searchParams.get("wallet") ?? "");

    if (!playerId) {
      return corsJsonResponse(
        request,
        { error: "A valid playerId or wallet query parameter is required." },
        { status: 400 }
      );
    }

    const hasLeaderboard = gameHasLeaderboard(game);
    const session = await readSessionFromCookies();
    const scope = {
      chainId: session?.chainId,
      ecosystem: session?.ecosystem,
    };
    const result = await cachedGetProgress(playerId, id, () =>
      resolveGameProgressFromServer(playerId, id, hasLeaderboard, scope).then(
        (progress) => ({ progress, hasLeaderboard })
      )
    );

    return corsJsonResponse(request, result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load game progress.";
    return corsJsonResponse(request, { error: message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const game = await fetchGameFromServer(id);
    if (!game) {
      return corsJsonResponse(
        request,
        { error: "Game not found." },
        { status: 404 }
      );
    }

    const session = await readSessionFromCookies();
    if (!session) {
      return corsJsonResponse(
        request,
        { error: "Sign in to save progress.", code: "NO_SESSION" },
        { status: 401 }
      );
    }

    const ip = getClientIp(request);
    if (
      !(await checkRateLimit(
        `progress:player:${session.playerId}:game:${id}`,
        30,
        60_000
      )) ||
      !(await checkRateLimit(`progress:ip:${ip}`, 90, 60_000))
    ) {
      return rateLimitResponse();
    }

    const body = (await request.json()) as {
      playerId?: string;
      walletAddress?: string;
      value?: number;
      score?: number;
      name?: string;
      playerName?: string;
      playSessionId?: string;
    };

    const bodyPlayerId =
      resolvePlayerId(body.playerId ?? "") ??
      resolvePlayerId(body.walletAddress ?? "");

    if (bodyPlayerId && bodyPlayerId !== session.playerId) {
      return corsJsonResponse(
        request,
        {
          error: "Player does not match your signed-in session.",
          code: "PLAYER_MISMATCH",
        },
        { status: 403 }
      );
    }

    const playerId = session.playerId;
    const playSessionId = body.playSessionId?.trim() ?? "";
    if (!playSessionId) {
      return corsJsonResponse(
        request,
        {
          error: "playSessionId is required. Start the game again.",
          code: "NO_PLAY_SESSION",
        },
        { status: 400 }
      );
    }

    const playSession = await assertPlaySessionActive({
      playSessionId,
      playerId,
      gameId: id,
      chainId: session.chainId,
      ecosystem: session.ecosystem,
    });

    const scoreValue =
      typeof body.value === "number"
        ? body.value
        : typeof body.score === "number"
          ? body.score
          : undefined;

    if (typeof scoreValue !== "number") {
      return corsJsonResponse(
        request,
        { error: "value or score is required." },
        { status: 400 }
      );
    }

    const anomaly = evaluateScoreAnomaly({
      score: scoreValue,
      scoreBounds: game.scoreBounds,
      sessionStartedAt: playSession.startedAt,
    });
    if (anomaly.flagged) {
      await flagAnomalousScoreOnServer({
        gameId: id,
        playerId,
        score: scoreValue,
        playSessionId,
        reasons: anomaly.reasons,
        scoreBounds: game.scoreBounds,
        sessionStartedAt: playSession.startedAt,
        elapsedMs: Date.now() - playSession.startedAt,
        chainId: session.chainId,
        ecosystem: session.ecosystem,
        source: "progress",
      }).catch(() => {});

      if (shouldEnforceScoreBounds()) {
        return corsJsonResponse(
          request,
          {
            error: "Score failed integrity checks.",
            code: "SCORE_ANOMALY",
            reasons: anomaly.reasons,
          },
          { status: 400 }
        );
      }
    }

    const hasLeaderboard = gameHasLeaderboard(game);
    const playerName = body.playerName ?? body.name;

    const progress = await coalesceProgressWrite(
      playerId,
      id,
      scoreValue,
      hasLeaderboard,
      {
        playerName,
        chainId: session.chainId,
        ecosystem: session.ecosystem,
      },
      (v, hl, opts) =>
        saveGameProgressOnServer(playerId, id, v, hl, {
          playerName: opts.playerName,
          chainId: opts.chainId,
          ecosystem: opts.ecosystem as
            | import("@/lib/player-identity").WalletEcosystem
            | null
            | undefined,
        })
    );

    invalidateProgressCache(playerId, id);

    return corsJsonResponse(request, { success: true, progress, hasLeaderboard });
  } catch (err) {
    if (err instanceof PlaySessionError) {
      return corsJsonResponse(
        request,
        { error: err.message, code: err.code },
        { status: 400 }
      );
    }

    const message =
      err instanceof Error ? err.message : "Failed to save game progress.";
    return corsJsonResponse(request, { error: message }, { status: 500 });
  }
}
