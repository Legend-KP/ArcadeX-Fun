import { NextResponse } from "next/server";
import { readSessionFromCookies } from "@/lib/auth-session";
import { fetchSocialProfileByPlayerId } from "@/lib/farcaster/social-db";
import { signerErrorResponse } from "@/lib/farcaster/signer/http";
import { publishCast } from "@/lib/farcaster/signer/publish";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import { cleanPostBody, createTextPost, setPostHubHash } from "@/lib/social-board";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`farcaster:cast-route:${ip}`, 20, 60_000))) {
    return rateLimitResponse();
  }

  const session = await readSessionFromCookies();
  if (!session?.fid) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  let payload: { body?: string };
  try {
    payload = (await request.json()) as { body?: string };
  } catch {
    return NextResponse.json({ error: "Send a text cast." }, { status: 400 });
  }

  const body = cleanPostBody(typeof payload.body === "string" ? payload.body : "");
  if (!body) {
    return NextResponse.json(
      { error: "Write a text cast up to 280 characters." },
      { status: 400 }
    );
  }

  try {
    const cast = await publishCast({
      fid: session.fid,
      playerId: session.playerId,
      text: body,
      ip,
    });
    if (!cast) {
      return NextResponse.json(
        {
          error: "Approve a cast-only Farcaster signer before posting to your profile.",
          code: "approval_required",
        },
        { status: 409 }
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
    await setPostHubHash(post.id, cast.hash);
    return NextResponse.json({ cast, post: { ...post, hubHash: cast.hash } });
  } catch (error) {
    return signerErrorResponse(error);
  }
}
