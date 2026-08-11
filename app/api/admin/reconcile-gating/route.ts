import { NextResponse } from "next/server";
import {
  unauthorizedResponse,
  verifyAdminRequest,
} from "@/lib/admin-auth";
import { fetchGamesFromServer } from "@/lib/firestore-server";
import { reconcileGameGating } from "@/lib/game-gating";
import { rtdbShallowKeys } from "@/lib/rtdb-rest";
import { startMetric } from "@/lib/api-metrics";

export const dynamic = "force-dynamic";

/**
 * Admin-only: compare Firestore games ↔ RTDB gameGating flags.
 * POST { "repair": true } to backfill / fix mismatches.
 */
export async function POST(request: Request) {
  if (!verifyAdminRequest(request)) return unauthorizedResponse();

  const metric = startMetric("/api/admin/reconcile-gating", "POST");

  try {
    const body = (await request.json().catch(() => ({}))) as {
      repair?: boolean;
    };

    const report = await reconcileGameGating({
      listGames: fetchGamesFromServer,
      listRtdbKeys: () => rtdbShallowKeys("gameGating"),
      repair: body.repair === true,
    });

    metric.set("missing", report.missingInRtdb.length);
    metric.set("orphans", report.orphanInRtdb.length);
    metric.set("mismatched", report.mismatched.length);
    metric.set("repaired", report.repaired.length);

    return metric.finish(
      NextResponse.json(report, {
        headers: { "Cache-Control": "private, no-store" },
      })
    );
  } catch (err) {
    metric.emit(500);
    const message =
      err instanceof Error ? err.message : "Reconciliation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
