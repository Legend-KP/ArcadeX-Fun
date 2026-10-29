import { NextResponse } from "next/server";
import { readSessionFromCookies } from "@/lib/auth-session";
import { joinPublicCircle } from "@/lib/circle-invites";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const ip = getClientIp(request);
  const session = await readSessionFromCookies();
  if (!session?.fid) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  if (!(await checkRateLimit(`circle-join:${session.fid}:${ip}`, 20, 60_000))) {
    return rateLimitResponse();
  }
  const { id } = await context.params;
  try {
    const result = await joinPublicCircle({
      circleId: id,
      fid: session.fid,
      playerId: session.playerId,
    });
    if (result === "missing") {
      return NextResponse.json({ error: "Circle not found." }, { status: 404 });
    }
    if (result === "private") {
      return NextResponse.json({ error: "This circle is invite-only." }, { status: 403 });
    }
    return NextResponse.json({ ok: true, joined: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not join this circle.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
