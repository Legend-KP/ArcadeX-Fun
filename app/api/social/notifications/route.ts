import { NextResponse } from "next/server";
import { readSessionFromCookies } from "@/lib/auth-session";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import { listInbox } from "@/lib/social-inbox";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`inbox-read:${ip}`, 60, 60_000))) {
    return rateLimitResponse();
  }
  const session = await readSessionFromCookies();
  if (!session?.fid) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  try {
    const inbox = await listInbox(session.fid);
    return NextResponse.json(inbox);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load notifications.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
