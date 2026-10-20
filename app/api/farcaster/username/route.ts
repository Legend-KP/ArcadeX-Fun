import { NextResponse } from "next/server";
import { readSessionFromCookies } from "@/lib/auth-session";
import {
  fetchSocialProfileByUsername,
  requireSocialDb,
  setUsernameSkipped,
  upsertSocialProfile,
} from "@/lib/farcaster/social-db";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** ArcadeX handle — separate from Farcaster fname. */
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

/**
 * P3 scaffold: claim or clear ArcadeX username (D1 registry).
 */
export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    if (!(await checkRateLimit(`farcaster:username:${ip}`, 10, 60 * 60 * 1000))) {
      return rateLimitResponse();
    }

    const session = await readSessionFromCookies();
    if (!session?.fid) {
      return NextResponse.json(
        { error: "Sign in with Farcaster first." },
        { status: 401 }
      );
    }

    const body = (await request.json()) as { username?: string | null };
    const raw = body.username?.trim().toLowerCase() ?? "";

    // Empty / null = skip / clear optional username.
    if (!raw) {
      const db = await requireSocialDb();
      await db
        .prepare("DELETE FROM usernames WHERE player_id = ?")
        .bind(session.playerId)
        .run();
      await setUsernameSkipped(session.playerId, true);
      const profile = await upsertSocialProfile({
        playerId: session.playerId,
        username: null,
        fid: session.fid,
        primaryWallet: session.address,
      });
      return NextResponse.json({ ok: true, profile, skipped: true });
    }

    if (!USERNAME_RE.test(raw)) {
      return NextResponse.json(
        {
          error:
            "Username must be 3–20 characters: lowercase letters, numbers, underscore.",
        },
        { status: 400 }
      );
    }

    const taken = await fetchSocialProfileByUsername(raw);
    if (taken && taken.playerId !== session.playerId) {
      return NextResponse.json(
        { error: "Username is taken." },
        { status: 409 }
      );
    }

    const db = await requireSocialDb();
    const now = Date.now();
    await setUsernameSkipped(session.playerId, false);
    await db
      .prepare("DELETE FROM usernames WHERE player_id = ?")
      .bind(session.playerId)
      .run();
    await db
      .prepare(
        `INSERT INTO usernames (username, player_id, created_at)
         VALUES (?, ?, ?)`
      )
      .bind(raw, session.playerId, now)
      .run();

    const profile = await upsertSocialProfile({
      playerId: session.playerId,
      username: raw,
      fid: session.fid,
      primaryWallet: session.address,
    });

    return NextResponse.json({ ok: true, profile });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to set username.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
