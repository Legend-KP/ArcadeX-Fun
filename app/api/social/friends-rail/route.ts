import { NextResponse } from "next/server";
import { readSessionFromCookies } from "@/lib/auth-session";
import { loadFriendsRail } from "@/lib/friends-rail";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`friends-rail:${ip}`, 40, 60_000))) {
    return rateLimitResponse();
  }

  const session = await readSessionFromCookies();
  if (!session?.fid) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  try {
    const rail = await loadFriendsRail(session.fid);
    return NextResponse.json(rail, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load friends.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
