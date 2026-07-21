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
import { isWalletAddress, tryNormalizeWalletAddress } from "@/lib/wallet-address";
import { resolvePlayerId } from "@/lib/player-identity";

export const dynamic = "force-dynamic";

export async function OPTIONS(request: Request) {
  return handleCorsPreflightRequest(request);
}

async function assertLeaderboardEnabled(request: Request, gameId: string) {
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
    const { error, game } = await assertLeaderboardEnabled(request, id);
    if (error || !game) return error;

    const { searchParams } = new URL(request.url);
    const wallet = searchParams.get("wallet") ?? undefined;
    const name = searchParams.get("name") ?? undefined;
    const playerId =
      resolvePlayerId(searchParams.get("playerId") ?? "") ??
      resolvePlayerId(wallet ?? "");

    const entries = await fetchLeaderboardFromServer(id, LEADERBOARD_MAX_ENTRIES);

    let personalBest: number | undefined;
    if (playerId) {
      personalBest = await fetchPersonalBestFromServer(playerId, id);
    }

    let submittedBest: number | undefined;
    if (wallet || name) {
      submittedBest = await fetchUserSubmittedBestFromServer(id, {
        walletAddress: wallet,
        playerName: name,
      });
    }

    const canSubmit =
      typeof personalBest === "number" &&
      personalBest > 0 &&
      personalBest > (submittedBest ?? 0);

    const contestStatus = getContestStatus(game);
    let contest: LeaderboardResponse["contest"] = null;

    if (
      contestStatus &&
      typeof game.contestStartedAt === "number" &&
      typeof game.contestEndsAt === "number"
    ) {
      const contestEntries = await fetchContestLeaderboardFromServer(
        id,
        game.contestStartedAt,
        CONTEST_TOP_MAX_ENTRIES
      );

      contest = {
        status: contestStatus,
        task: game.contestTask ?? "",
        startedAt: game.contestStartedAt,
        endsAt: game.contestEndsAt,
        durationDays: game.contestDurationDays ?? 1,
        entries: contestEntries,
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

    return corsJsonResponse(request, response);
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
    const { error, game } = await assertLeaderboardEnabled(request, id);
    if (error || !game) return error;

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
