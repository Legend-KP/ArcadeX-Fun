import { NextResponse } from "next/server";
import { readSessionFromCookies } from "@/lib/auth-session";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import { markInboxRead } from "@/lib/social-inbox";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await readSessionFromCookies();
  if (!session?.fid) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`inbox-read-mark:${session.fid}:${ip}`, 60, 60_000))) {
    return rateLimitResponse();
  }
  const { id } = await context.params;
  if (!id || id.length > 80) {
    return NextResponse.json({ error: "Unknown notification." }, { status: 400 });
  }
  let scope: "direct" | "broadcast" = "direct";
  try {
    const payload = (await request.json()) as { scope?: string };
    if (payload.scope === "broadcast") scope = "broadcast";
  } catch {
    scope = "direct";
  }
  try {
    await markInboxRead(session.fid, id, scope);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not update the notification.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
