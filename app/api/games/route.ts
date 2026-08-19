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
  toPublicGame,
} from "@/lib/firestore-server";
import { fetchAllGamePlayCounts } from "@/lib/rtdb-server";
import { Game } from "@/types";
import { startMetric } from "@/lib/api-metrics";
import { getGameCacheStats } from "@/lib/game-cache";
import { getPlayCountsCacheAgeMs, getRtdbCacheStats } from "@/lib/rtdb-cache";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { setFirebaseLogRoute } from "@/lib/firebase-log";
import {
  matchPublicGetCache,
  publicCatalogCacheKey,
  schedulePublicGetCache,
} from "@/lib/edge-cache";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const metric = startMetric("/api/games", "GET");
  setFirebaseLogRoute("/api/games");

  const isAdmin = verifyAdminRequest(request);
  if (!isAdmin) {
    const ip = getClientIp(request);
    if (!(await checkRateLimit(`games:ip:${ip}`, 120, 60_000))) {
      metric.emit(429);
      return rateLimitResponse();
    }

    const cached = await matchPublicGetCache(publicCatalogCacheKey(request));
    if (cached) {
      metric.cacheHit("edge");
      return metric.finish(cached);
    }
    metric.cacheMiss("edge");
  }

  try {
    const statsBefore = getGameCacheStats();
    const playAgeBefore = getPlayCountsCacheAgeMs();

    // Independent Firebase reads in parallel.
    const [games, playCounts] = await Promise.all([
      fetchGamesFromServer(),
      fetchAllGamePlayCounts().catch(() => ({} as Record<string, number>)),
    ]);

    const statsAfter = getGameCacheStats();
    const rtdbStats = getRtdbCacheStats();

    if (statsBefore.listCached) {
      metric.cacheHit("list");
    } else {
      metric.cacheMiss("list");
    }
    if (playAgeBefore !== null) {
      metric.set("playCountsCache", "hit");
    } else {
      metric.set("playCountsCache", "miss");
    }

    metric.set("gameCount", games.length);
    metric.set("cbOpen", statsAfter.cbOpen);
    metric.set("playCountsAgeMs", rtdbStats.playCountsAgeMs);

    const visible = isAdmin
      ? games
      : games.filter(isGameVisible).map(toPublicGame);

    const body = { games: visible, playCounts };
    const headers = new Headers();

    if (isAdmin) {
      headers.set("Cache-Control", "private, no-store");
    } else {
      // Edge-cacheable public catalog. Play counts are approximate (90s in-memory).
      headers.set(
        "Cache-Control",
        "public, s-maxage=60, stale-while-revalidate=300"
      );
      headers.set("CDN-Cache-Control", "public, s-maxage=60");
      headers.set("Vary", "Authorization");
    }

    const response = NextResponse.json(body, { headers });
    if (!isAdmin) {
      schedulePublicGetCache(publicCatalogCacheKey(request), response);
    }
    return metric.finish(response);
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

    metric.invalidated();
    return metric.finish(
      NextResponse.json(
        { id },
        {
          status: 201,
          headers: { "Cache-Control": "private, no-store" },
        }
      )
    );
  } catch (err) {
    metric.emit(500);
    return apiErrorResponse(err, "Failed to add game.");
  }
}
