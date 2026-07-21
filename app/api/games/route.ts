import { NextResponse } from "next/server";
import {
  apiErrorResponse,
  unauthorizedResponse,
  verifyAdminRequest,
} from "@/lib/admin-auth";
import {
  createGameOnServer,
  fetchGamesFromServer,
  isGameVisible,
  invalidateGameCache,
} from "@/lib/firestore-server";
import { fetchAllGamePlayCounts } from "@/lib/rtdb-server";
import { Game } from "@/types";
import { startMetric } from "@/lib/api-metrics";
import { getGameCacheStats } from "@/lib/game-cache";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const metric = startMetric("/api/games", "GET");

  try {
    const statsBefore = getGameCacheStats();
    const games = await fetchGamesFromServer();
    const statsAfter = getGameCacheStats();

    if (statsBefore.listCached) {
      metric.cacheHit("list");
    } else {
      metric.cacheMiss("list");
    }
    metric.set("gameCount", games.length);
    metric.set("cbOpen", statsAfter.cbOpen);

    const visible = verifyAdminRequest(request)
      ? games
      : games.filter(isGameVisible);

    let playCounts: Record<string, number> = {};
    try {
      playCounts = await fetchAllGamePlayCounts();
    } catch {
      // Play counts are optional; games still load without them.
    }

    return metric.finish(NextResponse.json({ games: visible, playCounts }));
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load games.";
    const hint = message.includes("Cloud Firestore API")
      ? " Enable the Cloud Firestore API in Google Cloud Console, then redeploy."
      : "";
    metric.emit(500);
    return NextResponse.json(
      { error: `${message}${hint}` },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  if (!verifyAdminRequest(request)) return unauthorizedResponse();

  const metric = startMetric("/api/games", "POST");

  try {
    const body = (await request.json()) as Omit<Game, "id" | "createdAt">;

    if (!body.name?.trim() || !body.url?.trim()) {
      metric.emit(400);
      return NextResponse.json(
        { error: "Name and URL are required." },
        { status: 400 }
      );
    }

    const id = await createGameOnServer({
      name: body.name.trim(),
      thumbnail: body.thumbnail?.trim() ?? "",
      url: body.url.trim(),
      plays: body.plays?.trim() || "0",
      fallbackImage: body.fallbackImage?.trim() ?? "",
      active: body.active ?? true,
      live: body.live !== false,
      hasLeaderboard: body.hasLeaderboard !== false,
    });

    // createGameOnServer already calls invalidateGameCache()
    metric.invalidated();
    return metric.finish(NextResponse.json({ id }, { status: 201 }));
  } catch (err) {
    metric.emit(500);
    return apiErrorResponse(err, "Failed to add game.");
  }
}
