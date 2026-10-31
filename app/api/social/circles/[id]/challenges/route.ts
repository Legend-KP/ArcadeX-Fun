import { NextResponse } from "next/server";
import { readSessionFromCookies } from "@/lib/auth-session";
import { fetchSocialProfileByPlayerId } from "@/lib/farcaster/social-db";
import { getCircleForViewer } from "@/lib/circle-invites";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import {
  createChallenge,
  findChallengeTarget,
  listChallengesForCircle,
} from "@/lib/social-challenges-server";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`circle-challenges-read:${ip}`, 60, 60_000))) {
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
    const challenges = await listChallengesForCircle(id);
    return NextResponse.json({ challenges });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load challenges.";
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
  if (!(await checkRateLimit(`circle-challenges-write:${session.fid}:${ip}`, 12, 60_000))) {
    return rateLimitResponse();
  }
  const { id } = await context.params;
  let payload: { target?: string; gameId?: string; gameName?: string; expiryHours?: number };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Send a challenge." }, { status: 400 });
  }
  const targetRaw = typeof payload.target === "string" ? payload.target.trim() : "";
  const gameId = typeof payload.gameId === "string" ? payload.gameId.trim() : "";
  const gameName = typeof payload.gameName === "string" ? payload.gameName.trim() : "";
  const expiryHours = payload.expiryHours === 72 ? 72 : payload.expiryHours === 24 ? 24 : 0;
  if (!targetRaw || !gameId || !gameName || !expiryHours || /[.#$[\]/]/.test(gameId)) {
    return NextResponse.json({ error: "Pick a member, a game, and 24 or 72 hours." }, { status: 400 });
  }
  try {
    const found = await getCircleForViewer(id, session.fid);
    if (!found) return NextResponse.json({ error: "Circle not found." }, { status: 404 });
    if (!found.isMember) {
      return NextResponse.json({ error: "Join this circle before challenging." }, { status: 403 });
    }
    const target = await findChallengeTarget(targetRaw);
    if (!target?.fid) {
      return NextResponse.json({ error: "That player is not on ArcadeX." }, { status: 404 });
    }
    if (target.fid === session.fid) {
      return NextResponse.json({ error: "You can't challenge yourself." }, { status: 400 });
    }
    const profile = await fetchSocialProfileByPlayerId(session.playerId).catch(() => null);
    const challenge = await createChallenge({
      challengerFid: session.fid,
      challengerName: profile?.displayName || profile?.username || profile?.fname || "Player",
      challengerPlayerId: session.playerId,
      target,
      targetLabel: target.username || targetRaw.replace(/^@/, ""),
      gameId,
      gameName: gameName.slice(0, 80),
      expiryHours,
      circleId: id,
    });
    return NextResponse.json({ challenge });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not send the challenge.";
    const status = message.includes("have to be in this circle") ? 400 : 503;
    return NextResponse.json({ error: message }, { status });
  }
}
