import { NextResponse } from "next/server";
import { readSessionFromCookies } from "@/lib/auth-session";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { checkInFidStreak, readFidStreak } from "@/lib/social-board";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`fid-streak-read:${ip}`, 60, 60_000))) {
    return rateLimitResponse();
  }

  const session = await readSessionFromCookies();
  if (!session?.fid) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  try {
    const streak = await readFidStreak(session.fid);
    return NextResponse.json({ streak });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load streak.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const session = await readSessionFromCookies();
  if (!session?.fid) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  if (!(await checkRateLimit(`fid-streak-write:${session.fid}:${ip}`, 10, 60_000))) {
    return rateLimitResponse();
  }

  try {
    const streak = await checkInFidStreak(session.fid, session.playerId);
    return NextResponse.json({ streak });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not check in.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
