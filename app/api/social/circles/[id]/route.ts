import { NextResponse } from "next/server";
import { readSessionFromCookies } from "@/lib/auth-session";
import { getCircleForViewer } from "@/lib/circle-invites";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`circle-read:${ip}`, 60, 60_000))) {
    return rateLimitResponse();
  }
  const { id } = await context.params;
  if (!id || id.length > 80) {
    return NextResponse.json({ error: "Circle not found." }, { status: 404 });
  }
  const session = await readSessionFromCookies();
  try {
    const found = await getCircleForViewer(id, session?.fid ?? null);
    if (!found) {
      return NextResponse.json({ error: "Circle not found." }, { status: 404 });
    }
    const locked = found.circle.visibility === "private" && !found.isMember;
    return NextResponse.json({
      circle: found.circle,
      isMember: found.isMember,
      isCreator: found.isCreator,
      locked,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load the circle.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
