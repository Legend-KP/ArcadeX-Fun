import { NextResponse } from "next/server";
import { incrementGamePlayCount } from "@/lib/rtdb-server";
import { fetchGameFromServer, isGameVisible } from "@/lib/firestore-server";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { startMetric } from "@/lib/api-metrics";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const metric = startMetric("/api/games/[id]/play", "POST");
  try {
    const { id } = await params;
    if (!id || id.length > 128 || /[.#$[\]/]/.test(id)) {
      metric.emit(400);
      return NextResponse.json({ error: "Invalid game id." }, { status: 400 });
    }

    const ip = getClientIp(request);
    if (
      !(await checkRateLimit(`play:ip:${ip}`, 60, 60_000)) ||
      !(await checkRateLimit(`play:game:${id}:${ip}`, 20, 60_000))
    ) {
      metric.emit(429);
      return rateLimitResponse();
    }

    const game = await fetchGameFromServer(id);

    if (!game || !isGameVisible(game)) {
      metric.emit(404);
      return NextResponse.json({ error: "Game not found." }, { status: 404 });
    }

    const count = await incrementGamePlayCount(id);
    return metric.finish(
      NextResponse.json(
        { count },
        { headers: { "Cache-Control": "no-store" } }
      )
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to record play.";
    metric.emit(500);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
