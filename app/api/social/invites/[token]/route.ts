import { NextResponse } from "next/server";
import { readSessionFromCookies } from "@/lib/auth-session";
import { acceptInvite, previewInvite } from "@/lib/circle-invites";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const INVALID = "This invite is no longer valid.";

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`invite-preview:${ip}`, 60, 60_000))) {
    return rateLimitResponse();
  }
  const { token } = await context.params;
  const session = await readSessionFromCookies();
  try {
    const preview = await previewInvite(token, session?.fid ?? null);
    if (!preview.valid) {
      return NextResponse.json({ valid: false });
    }
    return NextResponse.json({
      valid: true,
      signedIn: Boolean(session?.fid),
      member: preview.member,
      inviterName: preview.inviterName,
      circle: {
        id: preview.circle.id,
        name: preview.circle.name,
        description: preview.circle.description,
        visibility: preview.circle.visibility,
        memberCount: preview.circle.memberCount,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not open this invite.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  const ip = getClientIp(request);
  const session = await readSessionFromCookies();
  if (!session?.fid) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  if (!(await checkRateLimit(`invite-accept:${session.fid}:${ip}`, 20, 60 * 60_000))) {
    return rateLimitResponse();
  }

  let action = "accept";
  try {
    const payload = (await request.json()) as { action?: string };
    if (payload.action === "decline") action = "decline";
  } catch {
    action = "accept";
  }

  if (action === "decline") {
    return NextResponse.json({ ok: true, declined: true });
  }

  const { token } = await context.params;
  try {
    const result = await acceptInvite({
      token,
      fid: session.fid,
      playerId: session.playerId,
    });
    if (!result.ok) {
      return NextResponse.json({ error: INVALID }, { status: 400 });
    }
    return NextResponse.json({
      ok: true,
      circleId: result.circleId,
      alreadyMember: result.alreadyMember,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not join this circle.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
