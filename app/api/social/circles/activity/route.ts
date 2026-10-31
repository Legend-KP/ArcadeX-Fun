import { NextResponse } from "next/server";
import { readSessionFromCookies } from "@/lib/auth-session";
import { listJoinedCircleActivity } from "@/lib/circle-content";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`circle-activity:${ip}`, 60, 60_000))) {
    return rateLimitResponse();
  }
  const session = await readSessionFromCookies();
  if (!session?.fid) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  try {
    const activity = await listJoinedCircleActivity(session.fid);
    return NextResponse.json(activity);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load circle activity.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
