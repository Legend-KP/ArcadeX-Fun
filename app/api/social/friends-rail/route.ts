import { NextResponse } from "next/server";
import { readSessionFromCookies } from "@/lib/auth-session";
import { loadFriendsRail } from "@/lib/friends-rail";
import { ttlMemo } from "@/lib/ttl-memo";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const cachedRail = ttlMemo<Awaited<ReturnType<typeof loadFriendsRail>>>(30_000);

export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`friends-rail:${ip}`, 40, 60_000))) {
    return rateLimitResponse();
  }

  const session = await readSessionFromCookies();
  const fid = session?.fid;
  if (!fid) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  try {
    const rail = await cachedRail(String(fid), () => loadFriendsRail(fid));
    return NextResponse.json(rail, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load friends.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
