import { NextResponse } from "next/server";
import { readSessionFromCookies } from "@/lib/auth-session";
import { requestCircleJoin } from "@/lib/circle-invites";
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
  if (!(await checkRateLimit(`circle-request:${session.fid}:${ip}`, 20, 60_000))) {
    return rateLimitResponse();
  }
  const { id } = await context.params;
  try {
    const result = await requestCircleJoin({
      circleId: id,
      fid: session.fid,
      playerId: session.playerId,
    });
    if (result === "missing") {
      return NextResponse.json({ error: "Circle not found." }, { status: 404 });
    }
    if (result === "public") {
      return NextResponse.json({ error: "This circle is public. Join it directly." }, { status: 400 });
    }
    return NextResponse.json({ ok: true, requested: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not send the request.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
