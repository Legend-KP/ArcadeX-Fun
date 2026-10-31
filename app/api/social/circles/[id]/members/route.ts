import { NextResponse } from "next/server";
import { readSessionFromCookies } from "@/lib/auth-session";
import { getCircleForViewer } from "@/lib/circle-invites";
import { listCircleMembers } from "@/lib/circle-content";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`circle-members:${ip}`, 60, 60_000))) {
    return rateLimitResponse();
  }
  const { id } = await context.params;
  const session = await readSessionFromCookies();
  try {
    const found = await getCircleForViewer(id, session?.fid ?? null);
    if (!found) return NextResponse.json({ error: "Circle not found." }, { status: 404 });
    if (found.circle.visibility === "private" && !found.isMember) {
      return NextResponse.json({ error: "This circle is private." }, { status: 403 });
    }
    const members = await listCircleMembers(id);
    return NextResponse.json({ members: members ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load members.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
