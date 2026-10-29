import { NextResponse } from "next/server";
import { readSessionFromCookies } from "@/lib/auth-session";
import { revokeInviteLink } from "@/lib/circle-invites";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; linkId: string }> }
) {
  const ip = getClientIp(request);
  const session = await readSessionFromCookies();
  if (!session?.fid) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  if (!(await checkRateLimit(`circle-invites-revoke:${session.fid}:${ip}`, 20, 60_000))) {
    return rateLimitResponse();
  }
  const { id, linkId } = await context.params;
  try {
    const revoked = await revokeInviteLink(id, linkId, session.fid);
    if (!revoked) {
      return NextResponse.json({ error: "Invite link not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not revoke the invite.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
