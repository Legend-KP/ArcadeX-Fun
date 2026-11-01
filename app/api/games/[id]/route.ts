import { NextResponse } from "next/server";
import {
  apiErrorResponse,
  unauthorizedResponse,
  verifyAdminRequest,
} from "@/lib/admin-auth";
import {
  deleteGameOnServer,
  fetchGameFromServer,
  isGameVisible,
  toPublicGame,
  updateGameContestOnServer,
  updateGameOnServer,
} from "@/lib/firestore-server";
import { isContestChainKey } from "@/lib/contest-chains";
import { Game } from "@/types";
import { startMetric } from "@/lib/api-metrics";
import {
  matchPublicGetCache,
  publicCatalogCacheKey,
  schedulePublicGetCache,
} from "@/lib/edge-cache";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const cached = await matchPublicGetCache(publicCatalogCacheKey(request));
  if (cached) return cached;

  const metric = startMetric("/api/games/[id]", "GET");

  try {
    const { id } = await params;
    const game = await fetchGameFromServer(id);

    if (!game || !isGameVisible(game)) {
      metric.emit(404);
      return NextResponse.json({ error: "Game not found." }, { status: 404 });
    }

    const response = NextResponse.json(
      { game: toPublicGame(game) },
      {
        headers: {
          "Cache-Control":
            "public, max-age=60, s-maxage=120, stale-while-revalidate=300",
        },
      }
    );
    schedulePublicGetCache(publicCatalogCacheKey(request), response);
    return metric.finish(response);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load game.";
    metric.emit(500);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!verifyAdminRequest(request)) return unauthorizedResponse();

  const metric = startMetric("/api/games/[id]", "PATCH");

  try {
    const { id } = await params;
    const body = (await request.json()) as Partial<Omit<Game, "id">> & {
      contestChainKey?: string;
    };

    const contestChainKey = body.contestChainKey;
    const {
      contestChainKey: _ck,
      chainContests: _cc,
      contestTask,
      contestLive,
      contestStartedAt,
      contestEndsAt,
      contestDurationDays,
      ...nonContest
    } = body;

    if (contestChainKey) {
      if (!isContestChainKey(contestChainKey)) {
        metric.emit(400);
        return NextResponse.json(
          { error: "Invalid contestChainKey. Use base, avalanche, or vara." },
          { status: 400 }
        );
      }

      await updateGameContestOnServer(id, contestChainKey, {
        ...(typeof contestTask === "string" ? { contestTask } : {}),
        ...(contestLive !== undefined ? { contestLive } : {}),
        ...(typeof contestStartedAt === "number" ? { contestStartedAt } : {}),
        ...(typeof contestEndsAt === "number" ? { contestEndsAt } : {}),
        ...(typeof contestDurationDays === "number"
          ? { contestDurationDays }
          : {}),
      });
    } else {
      const contestOnly =
        Object.keys(nonContest).length === 0 &&
        (contestTask !== undefined ||
          contestLive !== undefined ||
          contestStartedAt !== undefined ||
          contestEndsAt !== undefined ||
          contestDurationDays !== undefined);

      if (contestOnly) {
        metric.emit(400);
        return NextResponse.json(
          {
            error:
              "contestChainKey is required when updating contest fields (base | avalanche | vara).",
          },
          { status: 400 }
        );
      }

      await updateGameOnServer(id, nonContest);
    }

    metric.invalidated();
    return metric.finish(NextResponse.json({ ok: true }));
  } catch (err) {
    metric.emit(500);
    return apiErrorResponse(err, "Failed to update game.");
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!verifyAdminRequest(request)) return unauthorizedResponse();

  const metric = startMetric("/api/games/[id]", "DELETE");

  try {
    const { id } = await params;
    await deleteGameOnServer(id);
    metric.invalidated();
    return metric.finish(NextResponse.json({ ok: true }));
  } catch (err) {
    metric.emit(500);
    return apiErrorResponse(err, "Failed to delete game.");
  }
}
