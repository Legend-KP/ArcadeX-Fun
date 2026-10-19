import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { readSessionFromCookies } from "@/lib/auth-session";
import { requireSocialDb, upsertSocialProfile } from "@/lib/farcaster/social-db";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

function hashOtp(code: string, playerId: string): string {
  return createHash("sha256")
    .update(`${playerId}:${code}`)
    .digest("hex");
}

/**
 * P2 scaffold: verify email OTP and mark D1 profile verified.
 */
export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    if (!(await checkRateLimit(`farcaster:otp-verify:${ip}`, 20, 60 * 60 * 1000))) {
      return rateLimitResponse();
    }

    const session = await readSessionFromCookies();
    if (!session?.fid) {
      return NextResponse.json(
        { error: "Sign in with Farcaster first." },
        { status: 401 }
      );
    }

    const body = (await request.json()) as { code?: string };
    const code = body.code?.trim() ?? "";
    if (!/^\d{6}$/.test(code)) {
      return NextResponse.json(
        { error: "Enter the 6-digit code." },
        { status: 400 }
      );
    }

    const db = await requireSocialDb();
    const row = await db
      .prepare(
        `SELECT id, email, code_hash, attempts, expires_at
         FROM email_verification
         WHERE player_id = ?
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .bind(session.playerId)
      .first<{
        id: string;
        email: string;
        code_hash: string;
        attempts: number;
        expires_at: number;
      }>();

    if (!row) {
      return NextResponse.json(
        { error: "No pending verification. Request a new code." },
        { status: 400 }
      );
    }

    if (Date.now() > row.expires_at) {
      await db
        .prepare("DELETE FROM email_verification WHERE id = ?")
        .bind(row.id)
        .run();
      return NextResponse.json(
        { error: "Code expired. Request a new one." },
        { status: 400 }
      );
    }

    if (row.attempts >= 5) {
      return NextResponse.json(
        { error: "Too many attempts. Request a new code." },
        { status: 429 }
      );
    }

    const expected = hashOtp(code, session.playerId);
    if (expected !== row.code_hash) {
      await db
        .prepare(
          "UPDATE email_verification SET attempts = attempts + 1 WHERE id = ?"
        )
        .bind(row.id)
        .run();
      return NextResponse.json({ error: "Incorrect code." }, { status: 400 });
    }

    const now = Date.now();
    const profile = await upsertSocialProfile({
      playerId: session.playerId,
      email: row.email,
      emailVerifiedAt: now,
      fid: session.fid,
      primaryWallet: session.address,
      ecosystem: session.ecosystem,
      chainId: session.chainId ?? 10,
    });

    await db
      .prepare("DELETE FROM email_verification WHERE player_id = ?")
      .bind(session.playerId)
      .run();

    return NextResponse.json({ ok: true, profile });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Email verification failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
