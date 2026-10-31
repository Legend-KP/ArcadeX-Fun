import { NextResponse } from "next/server";
import { readSessionFromCookies } from "@/lib/auth-session";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { getTextPost, removeOwnPost } from "@/lib/social-board";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`social-post-read:${ip}`, 60, 60_000))) {
    return rateLimitResponse();
  }

  const { id } = await params;
  try {
    const post = await getTextPost(id);
    if (!post) {
      return NextResponse.json({ error: "Post not found." }, { status: 404 });
    }
    return NextResponse.json({ post });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load the post.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await readSessionFromCookies();
  if (!session?.fid) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`social-post-delete:${session.fid}:${ip}`, 20, 60_000))) {
    return rateLimitResponse();
  }
  const { id } = await params;
  try {
    const removed = await removeOwnPost(id, session.fid);
    if (!removed) {
      return NextResponse.json({ error: "You can't remove that post." }, { status: 403 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not remove the post.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
