import { NextResponse } from "next/server";
import { readSessionFromCookies } from "@/lib/auth-session";
import { fetchSocialProfileByPlayerId } from "@/lib/farcaster/social-db";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { cleanPostBody, createTextPost, listTextPosts } from "@/lib/social-board";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`social-posts-read:${ip}`, 60, 60_000))) {
    return rateLimitResponse();
  }

  const session = await readSessionFromCookies();
  if (!session?.fid) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  try {
    const posts = await listTextPosts();
    return NextResponse.json({ posts });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load posts.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const session = await readSessionFromCookies();
  if (!session?.fid) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  if (!(await checkRateLimit(`social-posts-write:${session.fid}:${ip}`, 12, 60_000))) {
    return rateLimitResponse();
  }

  let payload: { body?: string };
  try {
    payload = (await request.json()) as { body?: string };
  } catch {
    return NextResponse.json({ error: "Send a text post." }, { status: 400 });
  }

  const body = cleanPostBody(typeof payload.body === "string" ? payload.body : "");
  if (!body) {
    return NextResponse.json(
      { error: "Write a text post up to 280 characters." },
      { status: 400 }
    );
  }

  try {
    const profile = await fetchSocialProfileByPlayerId(session.playerId).catch(
      () => null
    );
    const authorName =
      profile?.displayName ||
      profile?.username ||
      profile?.fname ||
      "Player";
    const post = await createTextPost({
      fid: session.fid,
      playerId: session.playerId,
      authorName,
      pfpUrl: profile?.pfpUrl ?? null,
      body,
    });
    return NextResponse.json({ post });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not publish.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
