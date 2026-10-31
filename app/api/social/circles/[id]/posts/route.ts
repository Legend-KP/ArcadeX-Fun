import { NextResponse } from "next/server";
import { readSessionFromCookies } from "@/lib/auth-session";
import { fetchSocialProfileByPlayerId } from "@/lib/farcaster/social-db";
import { getCircleForViewer } from "@/lib/circle-invites";
import { createCirclePost, listCirclePosts } from "@/lib/circle-content";
import { moderationFailure } from "@/lib/moderation";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`circle-posts-read:${ip}`, 60, 60_000))) {
    return rateLimitResponse();
  }
  const { id } = await context.params;
  const session = await readSessionFromCookies();
  try {
    const found = await getCircleForViewer(id, session?.fid ?? null);
    if (!found) return NextResponse.json({ error: "Circle not found." }, { status: 404 });
    const posts = await listCirclePosts(id, found.isMember, found.circle.visibility);
    if (!posts) {
      return NextResponse.json({ error: "This circle is private." }, { status: 403 });
    }
    return NextResponse.json({ posts });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load posts.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await readSessionFromCookies();
  if (!session?.fid) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`circle-posts-write:${session.fid}:${ip}`, 20, 60_000))) {
    return rateLimitResponse();
  }
  const { id } = await context.params;
  let payload: { body?: string };
  try {
    payload = (await request.json()) as { body?: string };
  } catch {
    return NextResponse.json({ error: "Write a post." }, { status: 400 });
  }
  try {
    const profile = await fetchSocialProfileByPlayerId(session.playerId).catch(() => null);
    const post = await createCirclePost({
      circleId: id,
      fid: session.fid,
      playerId: session.playerId,
      authorName: profile?.displayName || profile?.username || profile?.fname || "Player",
      authorHandle: profile?.username || profile?.fname || null,
      pfpUrl: profile?.pfpUrl ?? null,
      body: typeof payload.body === "string" ? payload.body : "",
    });
    return NextResponse.json({ post });
  } catch (err) {
    const blocked = moderationFailure(err);
    if (blocked) return NextResponse.json({ error: blocked }, { status: 400 });
    const message = err instanceof Error ? err.message : "Could not post.";
    const status = message.includes("Join this circle") ? 403 : 503;
    return NextResponse.json({ error: message }, { status });
  }
}
