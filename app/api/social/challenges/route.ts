import { NextResponse } from "next/server";
import { readSessionFromCookies } from "@/lib/auth-session";
import { fetchSocialProfileByPlayerId } from "@/lib/farcaster/social-db";
import { sendResendEmail } from "@/lib/resend";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import {
  createChallenge,
  findChallengeTarget,
  listChallengesForFid,
} from "@/lib/social-challenges-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`social-challenges-read:${ip}`, 60, 60_000))) {
    return rateLimitResponse();
  }

  const session = await readSessionFromCookies();
  if (!session?.fid) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  try {
    const challenges = await listChallengesForFid(session.fid);
    return NextResponse.json({ challenges });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load challenges.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const session = await readSessionFromCookies();
  if (!session?.fid) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  if (
    !(await checkRateLimit(`social-challenges-write:${session.fid}:${ip}`, 12, 60_000))
  ) {
    return rateLimitResponse();
  }

  let payload: {
    target?: string;
    gameId?: string;
    gameName?: string;
    expiryHours?: number;
  };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Send a challenge." }, { status: 400 });
  }

  const targetRaw = typeof payload.target === "string" ? payload.target.trim() : "";
  const gameId = typeof payload.gameId === "string" ? payload.gameId.trim() : "";
  const gameName = typeof payload.gameName === "string" ? payload.gameName.trim() : "";
  const expiryHours = payload.expiryHours === 72 ? 72 : payload.expiryHours === 24 ? 24 : 0;

  if (!targetRaw || targetRaw.length > 64) {
    return NextResponse.json(
      { error: "Enter their username or FID." },
      { status: 400 }
    );
  }
  if (!gameId || gameId.length > 128 || /[.#$[\]/]/.test(gameId) || !gameName) {
    return NextResponse.json({ error: "Pick a game." }, { status: 400 });
  }
  if (!expiryHours) {
    return NextResponse.json({ error: "Pick 24 or 72 hours." }, { status: 400 });
  }

  try {
    const target = await findChallengeTarget(targetRaw);
    if (!target?.fid) {
      return NextResponse.json(
        { error: "No ArcadeX player with that username or FID." },
        { status: 404 }
      );
    }
    if (target.fid === session.fid) {
      return NextResponse.json(
        { error: "You can't challenge yourself." },
        { status: 400 }
      );
    }

    const profile = await fetchSocialProfileByPlayerId(session.playerId).catch(
      () => null
    );
    const challengerName =
      profile?.displayName || profile?.username || profile?.fname || "Player";
    const label = targetRaw.replace(/^@/, "");
    const challenge = await createChallenge({
      challengerFid: session.fid,
      challengerName,
      challengerPlayerId: session.playerId,
      target,
      targetLabel: target.username || label,
      gameId,
      gameName: gameName.slice(0, 80),
      expiryHours,
    });

    const invitedEmail = target.email?.trim();
    if (invitedEmail && target.emailVerifiedAt) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
      const challengesUrl = appUrl
        ? `${appUrl.replace(/\/$/, "")}/?section=challenges`
        : "";
      const who = profile?.username
        ? `${challengerName} (@${profile.username})`
        : challengerName;
      try {
        await sendResendEmail({
          to: invitedEmail,
          subject: `${challengerName} challenged you to ${challenge.gameName}`,
          text: [
            `${who} challenged you to ${challenge.gameName} on ArcadeX.`,
            `After you accept, you have ${challenge.expiryHours} hours to finish.`,
            challengesUrl
              ? `Open the challenge: ${challengesUrl}`
              : "Open ArcadeX and check Challenges.",
          ].join("\n\n"),
        });
      } catch (err) {
        console.error(
          "Challenge invite email failed:",
          err instanceof Error ? err.message : err
        );
      }
    }

    return NextResponse.json({ challenge });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not send the challenge.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
