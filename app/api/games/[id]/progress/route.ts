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
    const name = searchParams.get("name") ?? undefined;

    if (!playerId) {
      return corsJsonResponse(
        request,
        { error: "A valid playerId or wallet query parameter is required." },
        { status: 400 }
      );
    }

    const hasLeaderboard = gameHasLeaderboard(game);
    const progress = await resolveGameProgressFromServer(
      playerId,
      id,
      hasLeaderboard,
      { playerName: name }
    );

    return corsJsonResponse(request, { progress, hasLeaderboard });
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

    const body = (await request.json()) as {
      playerId?: string;
      walletAddress?: string;
      value?: number;
      score?: number;
      name?: string;
      playerName?: string;
    };

    const playerId =
      resolvePlayerId(body.playerId ?? "") ??
      resolvePlayerId(body.walletAddress ?? "");

    if (!playerId) {
      return corsJsonResponse(
        request,
        { error: "playerId or walletAddress is required." },
        { status: 400 }
      );
    }

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

    const hasLeaderboard = gameHasLeaderboard(game);
    const progress = await saveGameProgressOnServer(
      playerId,
      id,
      scoreValue,
      hasLeaderboard,
      { playerName: body.playerName ?? body.name }
    );

    return corsJsonResponse(request, { success: true, progress, hasLeaderboard });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to save game progress.";
    return corsJsonResponse(request, { error: message }, { status: 500 });
  }
}
