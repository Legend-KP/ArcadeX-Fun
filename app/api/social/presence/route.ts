import { NextResponse } from "next/server";
import { readSessionFromCookies } from "@/lib/auth-session";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import { touchPresence } from "@/lib/social-inbox";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await readSessionFromCookies();
  if (!session?.fid) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`presence:${session.fid}:${ip}`, 40, 60_000))) {
    return rateLimitResponse();
  }
  try {
    await touchPresence(session.fid);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not update presence.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
