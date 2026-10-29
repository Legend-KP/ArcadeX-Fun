import { NextResponse } from "next/server";
import { readSessionFromCookies } from "@/lib/auth-session";
import { listDiscoverCircles } from "@/lib/circle-invites";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`circles-discover:${ip}`, 60, 60_000))) {
    return rateLimitResponse();
  }
  const session = await readSessionFromCookies();
  if (!session?.fid) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  try {
    const circles = await listDiscoverCircles(session.fid);
    return NextResponse.json(
      { circles },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load circles.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
