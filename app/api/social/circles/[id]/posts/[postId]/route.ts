import { NextResponse } from "next/server";
import { readSessionFromCookies } from "@/lib/auth-session";
import { removeCirclePost } from "@/lib/circle-content";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; postId: string }> }
) {
  const session = await readSessionFromCookies();
  if (!session?.fid) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`circle-post-delete:${session.fid}:${ip}`, 20, 60_000))) {
    return rateLimitResponse();
  }
  const { id, postId } = await context.params;
  try {
    const removed = await removeCirclePost({
      circleId: id,
      postId,
      fid: session.fid,
    });
    if (!removed) {
      return NextResponse.json({ error: "You can't remove that post." }, { status: 403 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not remove the post.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
