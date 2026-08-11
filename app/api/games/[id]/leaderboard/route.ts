import { fetchGameFromServer } from "@/lib/firestore-server";
import {
  fetchContestLeaderboardFromServer,
  fetchLeaderboardFromServer,
  fetchPersonalBestFromServer,
  fetchUserFromServer,
  fetchUserSubmittedBestFromServer,
  saveGameProgressOnServer,
} from "@/lib/rtdb-server";
import {
  corsJsonResponse,
  handleCorsPreflightRequest,
} from "@/lib/cors";
import {
  CONTEST_TOP_MAX_ENTRIES,
  gameHasLeaderboard,
  getContestStatus,
  LEADERBOARD_MAX_ENTRIES,
  LeaderboardEntry,
  LeaderboardResponse,
} from "@/types";
import { tryNormalizeWalletAddress } from "@/lib/wallet-address";
import { resolvePlayerId } from "@/lib/player-identity";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function OPTIONS(request: Request) {
  return handleCorsPreflightRequest(request);
}

async function assertLeaderboardEnabled(request: Request, gameId: string) {
  if (!gameId || gameId.length > 128 || /[.#$[\]/]/.test(gameId)) {
    return {
      error: corsJsonResponse(
        request,
        { error: "Invalid game id." },
        { status: 400 }
      ),
      game: null,
    };
  }

  const game = await fetchGameFromServer(gameId);
  if (!game || !gameHasLeaderboard(game)) {
    return {
      error: corsJsonResponse(
        request,
        { error: "Leaderboard is not enabled for this game." },
        { status: 404 }
      ),
      game: null,
    };
  }
  return { error: null, game };
}

function parseScoreBody(body: LeaderboardEntry & { value?: number }) {
  const score =
    typeof body.score === "number"
      ? body.score
      : typeof body.value === "number"
        ? body.value
        : undefined;
  return score;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ip = getClientIp(request);
    if (
      !(await checkRateLimit(`leaderboard:ip:${ip}`, 90, 60_000)) ||
      !(await checkRateLimit(`leaderboard:game:${id}:${ip}`, 45, 60_000))
    ) {
      return rateLimitResponse();
    }

    const { error, game } = await assertLeaderboardEnabled(request, id);
    if (error || !game) return error;

    const { searchParams } = new URL(request.url);
    const wallet = searchParams.get("wallet") ?? undefined;
    const name = searchParams.get("name") ?? undefined;
    const playerId =
      resolvePlayerId(searchParams.get("playerId") ?? "") ??
      resolvePlayerId(wallet ?? "");

    const hasPersonal = Boolean(playerId || wallet || name);

    const [entries, personalBest, submittedBest, contestEntries] =
      await Promise.all([
        fetchLeaderboardFromServer(id, LEADERBOARD_MAX_ENTRIES),
        playerId
          ? fetchPersonalBestFromServer(playerId, id)
          : Promise.resolve(undefined as number | undefined),
        wallet || name
          ? fetchUserSubmittedBestFromServer(id, {
              walletAddress: wallet,
              playerName: name,
            })
          : Promise.resolve(undefined as number | undefined),
        (async () => {
          const contestStatus = getContestStatus(game);
          if (
            contestStatus &&
            typeof game.contestStartedAt === "number" &&
            typeof game.contestEndsAt === "number"
          ) {
            return {
              status: contestStatus,
              startedAt: game.contestStartedAt,
              endsAt: game.contestEndsAt,
              entries: await fetchContestLeaderboardFromServer(
                id,
                game.contestStartedAt,
                CONTEST_TOP_MAX_ENTRIES
              ),
            };
          }
          return null;
        })(),
      ]);

    const canSubmit =
      typeof personalBest === "number" &&
      personalBest > 0 &&
      personalBest > (submittedBest ?? 0);

    let contest: LeaderboardResponse["contest"] = null;
    if (contestEntries) {
      contest = {
        status: contestEntries.status,
        task: game.contestTask ?? "",
        startedAt: contestEntries.startedAt,
        endsAt: contestEntries.endsAt,
        durationDays: game.contestDurationDays ?? 1,
        entries: contestEntries.entries,
      };
    }

    const response: LeaderboardResponse = {
      entries,
      ...(personalBest !== undefined && personalBest > 0
        ? { personalBest }
        : {}),
      ...(submittedBest !== undefined && submittedBest > 0
        ? { submittedBest }
        : {}),
      ...(canSubmit ? { canSubmit: true } : {}),
      contest,
    };

    // Public top board is cacheable; personalized fields must not share CDN cache.
    const cacheControl = hasPersonal
      ? "private, no-store"
      : "public, s-maxage=15, stale-while-revalidate=60";

    return corsJsonResponse(request, response, {
      headers: { "Cache-Control": cacheControl },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load leaderboard.";
    return corsJsonResponse(request, { error: message }, { status: 500 });
  }
}

/** Free personal-best save only — does not write to the public board. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ip = getClientIp(request);
    if (!(await checkRateLimit(`leaderboard-save:ip:${ip}`, 40, 60_000))) {
      return rateLimitResponse();
    }

    const { error, game } = await assertLeaderboardEnabled(request, id);
    if (error || !game) return error;

    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > 16_384) {
      return corsJsonResponse(
        request,
        { error: "Request body too large." },
        { status: 413 }
      );
    }

    const body = (await request.json()) as LeaderboardEntry & {
      value?: number;
      playerName?: string;
      playerId?: string;
    };
    const score = parseScoreBody(body);

    if (typeof score !== "number") {
      return corsJsonResponse(
        request,
        { error: "score is required." },
        { status: 400 }
      );
    }

    const wallet = tryNormalizeWalletAddress(body.walletAddress);
    const playerId =
      resolvePlayerId(body.playerId ?? "") ?? resolvePlayerId(wallet ?? "");

    let name = body.name?.trim() || body.playerName?.trim() || "";

    if (!name && wallet) {
      const profile = await fetchUserFromServer(wallet);
      name = profile?.name?.trim() || "";
    }

    if (!name && wallet) {
      name = `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
    }

    if (!playerId) {
      return corsJsonResponse(
        request,
        { error: "playerId or walletAddress is required." },
        { status: 400 }
      );
    }

    const progress = await saveGameProgressOnServer(playerId, id, score, true, {
      playerName: name,
    });

    return corsJsonResponse(request, {
      success: true,
      personalBest: progress.score ?? score,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to save score.";
    return corsJsonResponse(request, { error: message }, { status: 500 });
  }
}
