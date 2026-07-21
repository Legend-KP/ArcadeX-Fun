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
  updateGameOnServer,
} from "@/lib/firestore-server";
import { Game } from "@/types";
import { startMetric } from "@/lib/api-metrics";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const metric = startMetric("/api/games/[id]", "GET");

  try {
    const { id } = await params;
    const game = await fetchGameFromServer(id);

    if (!game || !isGameVisible(game)) {
      metric.emit(404);
      return NextResponse.json({ error: "Game not found." }, { status: 404 });
    }

    return metric.finish(NextResponse.json({ game }));
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
    const body = (await request.json()) as Partial<Omit<Game, "id">>;
    await updateGameOnServer(id, body);
    // updateGameOnServer already calls invalidateGameCache(id)
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
    // deleteGameOnServer already calls invalidateGameCache(id)
    metric.invalidated();
    return metric.finish(NextResponse.json({ ok: true }));
  } catch (err) {
    metric.emit(500);
    return apiErrorResponse(err, "Failed to delete game.");
  }
}
