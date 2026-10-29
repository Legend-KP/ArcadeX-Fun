import { NextResponse } from "next/server";
import { readSessionFromCookies } from "@/lib/auth-session";
import { suggestPlayers } from "@/lib/player-suggest";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`player-suggest:${ip}`, 60, 60_000))) {
    return rateLimitResponse();
  }

  const session = await readSessionFromCookies();
  if (!session?.fid) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!q || q.length > 40) {
    return NextResponse.json({ players: [] });
  }

  try {
    const players = await suggestPlayers(q, session.fid);
    return NextResponse.json(
      { players },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not search players.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
