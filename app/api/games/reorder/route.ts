import { NextResponse } from "next/server";
import {
  apiErrorResponse,
  unauthorizedResponse,
  verifyAdminRequest,
} from "@/lib/admin-auth";
import { reorderGamesOnServer } from "@/lib/firestore-server";
import { startMetric } from "@/lib/api-metrics";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!verifyAdminRequest(request)) return unauthorizedResponse();

  const metric = startMetric("/api/games/reorder", "POST");

  try {
    const body = (await request.json()) as { ids?: string[] };
    const ids = body.ids;

    if (!Array.isArray(ids) || ids.length === 0) {
      metric.emit(400);
      return NextResponse.json(
        { error: "ids must be a non-empty array." },
        { status: 400 }
      );
    }

    if (!ids.every((id) => typeof id === "string" && id.trim())) {
      metric.emit(400);
      return NextResponse.json(
        { error: "Each id must be a non-empty string." },
        { status: 400 }
      );
    }

    await reorderGamesOnServer(ids);
    // reorderGamesOnServer calls invalidateGameCache() internally
    metric.invalidated();
    metric.set("count", ids.length);
    return metric.finish(NextResponse.json({ ok: true }));
  } catch (err) {
    metric.emit(500);
    return apiErrorResponse(err, "Failed to reorder games.");
  }
}
