import { NextResponse } from "next/server";
import { readSessionFromCookies } from "@/lib/auth-session";
import { fetchSocialProfileByPlayerId } from "@/lib/farcaster/social-db";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { cleanPostBody, createTextPost } from "@/lib/social-board";
import {
  attachChallengeResult,
  getChallenge,
  setChallengeStatus,
} from "@/lib/social-challenges-server";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await readSessionFromCookies();
  if (!session?.fid) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const ip = getClientIp(request);
  if (
    !(await checkRateLimit(`social-challenge-action:${session.fid}:${ip}`, 20, 60_000))
  ) {
    return rateLimitResponse();
  }

  const { id } = await context.params;
  if (!id || id.length > 80) {
    return NextResponse.json({ error: "Unknown challenge." }, { status: 400 });
  }

  let payload: { action?: string; text?: string };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Send an action." }, { status: 400 });
  }

  try {
    const current = await getChallenge(id);
    if (!current) {
      return NextResponse.json({ error: "Challenge not found." }, { status: 404 });
    }

    if (payload.action === "accept" || payload.action === "decline") {
      if (current.targetFid !== session.fid) {
        return NextResponse.json(
          { error: "Only the challenged player can respond." },
          { status: 403 }
        );
      }
      const challenge = await setChallengeStatus(id, session.fid, payload.action === "accept" ? "accepted" : "declined");
      if (!challenge || challenge.status === "pending") {
        return NextResponse.json(
          { error: "This challenge is no longer waiting." },
          { status: 409 }
        );
      }
      return NextResponse.json({ challenge });
    }

    if (payload.action === "result") {
      if (current.challengerFid !== session.fid && current.targetFid !== session.fid) {
        return NextResponse.json({ error: "You are not in this challenge." }, { status: 403 });
      }
      if (current.status !== "accepted") {
        return NextResponse.json(
          { error: "Accept the challenge before posting a result." },
          { status: 400 }
        );
      }
      if (current.resultPostId) {
        return NextResponse.json(
          { error: "A result was already posted." },
          { status: 409 }
        );
      }
      const body = cleanPostBody(typeof payload.text === "string" ? payload.text : "");
      if (!body) {
        return NextResponse.json(
          { error: "Write a result up to 280 characters." },
          { status: 400 }
        );
      }
      const profile = await fetchSocialProfileByPlayerId(session.playerId).catch(() => null);
      const post = await createTextPost({
        fid: session.fid,
        playerId: session.playerId,
        authorName: profile?.displayName || profile?.username || profile?.fname || "Player",
        authorHandle: profile?.username || profile?.fname || null,
        pfpUrl: profile?.pfpUrl ?? null,
        body,
      });
      const saved = await attachChallengeResult(id, session.fid, post.id);
      if (!saved) {
        return NextResponse.json(
          { error: "A result was already posted." },
          { status: 409 }
        );
      }
      const challenge = await getChallenge(id);
      return NextResponse.json({ challenge, post });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not update the challenge.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
