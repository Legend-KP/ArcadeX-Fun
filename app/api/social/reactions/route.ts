import { NextResponse } from "next/server";
import { readSessionFromCookies } from "@/lib/auth-session";
import { fetchSocialProfileByPlayerId } from "@/lib/farcaster/social-db";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import {
  addComment,
  listComments,
  summarizeReactions,
  toggleLike,
  toggleShare,
} from "@/lib/social-reactions";

export const dynamic = "force-dynamic";

function cleanPostId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (!id || id.length > 300) return null;
  return id;
}

export async function POST(request: Request) {
  const session = await readSessionFromCookies();
  if (!session?.fid) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const ip = getClientIp(request);
  if (!(await checkRateLimit(`social-reactions:${session.fid}:${ip}`, 60, 60_000))) {
    return rateLimitResponse();
  }

  let payload: { action?: string; id?: string; ids?: string[]; body?: string };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Send a reaction." }, { status: 400 });
  }

  try {
    if (payload.action === "list") {
      const ids = Array.isArray(payload.ids) ? payload.ids : [];
      const reactions = await summarizeReactions(ids, session.fid);
      return NextResponse.json({ reactions });
    }

    const id = cleanPostId(payload.id);
    if (!id) {
      return NextResponse.json({ error: "Missing post." }, { status: 400 });
    }

    if (payload.action === "like") {
      const reaction = await toggleLike(id, session.fid);
      return NextResponse.json({ reaction });
    }

    if (payload.action === "share") {
      const reaction = await toggleShare(id, session.fid);
      return NextResponse.json({ reaction });
    }

    if (payload.action === "comments") {
      const comments = await listComments(id);
      return NextResponse.json({ comments });
    }

    if (payload.action === "comment") {
      const profile = await fetchSocialProfileByPlayerId(session.playerId).catch(
        () => null
      );
      const comment = await addComment({
        postId: id,
        fid: session.fid,
        authorName:
          profile?.displayName || profile?.username || profile?.fname || "Player",
        authorHandle: profile?.username || profile?.fname || null,
        body: typeof payload.body === "string" ? payload.body : "",
      });
      const reactions = await summarizeReactions([id], session.fid);
      return NextResponse.json({ comment, reaction: reactions[id] });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not update the post.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
