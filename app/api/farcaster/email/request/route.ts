import { NextResponse } from "next/server";
import { createHash, randomInt, randomUUID } from "crypto";
import { readSessionFromCookies } from "@/lib/auth-session";
import { requireSocialDb, upsertSocialProfile } from "@/lib/farcaster/social-db";
import { assertTurnstile } from "@/lib/farcaster/turnstile";
import { sendResendEmail } from "@/lib/resend";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTP_TTL_MS = 10 * 60 * 1000;

function hashOtp(code: string, playerId: string): string {
  return createHash("sha256")
    .update(`${playerId}:${code}`)
    .digest("hex");
}

/**
 * P2 scaffold: request email OTP (Resend). Requires FIDded session.
 */
export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    if (!(await checkRateLimit(`farcaster:otp-req:${ip}`, 5, 60 * 60 * 1000))) {
      return rateLimitResponse();
    }

    const session = await readSessionFromCookies();
    if (!session?.fid) {
      return NextResponse.json(
        { error: "Sign in with Farcaster first." },
        { status: 401 }
      );
    }

    const body = (await request.json()) as {
      email?: string;
      turnstileToken?: string;
    };
    await assertTurnstile(body.turnstileToken, ip);
    const email = body.email?.trim().toLowerCase() ?? "";
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json(
        { error: "Please enter a valid email address." },
        { status: 400 }
      );
    }

    if (!process.env.RESEND_API_KEY?.trim()) {
      return NextResponse.json(
        { error: "RESEND_API_KEY is not configured." },
        { status: 500 }
      );
    }

    const code = String(randomInt(100000, 999999));
    const codeHash = hashOtp(code, session.playerId);
    const now = Date.now();
    const id = randomUUID();

    const db = await requireSocialDb();
    await db
      .prepare("DELETE FROM email_verification WHERE player_id = ?")
      .bind(session.playerId)
      .run();
    await db
      .prepare(
        `INSERT INTO email_verification
          (id, player_id, email, code_hash, attempts, expires_at, created_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`
      )
      .bind(id, session.playerId, email, codeHash, now + OTP_TTL_MS, now)
      .run();

    await upsertSocialProfile({
      playerId: session.playerId,
      email,
      emailVerifiedAt: null,
      fid: session.fid,
      primaryWallet: session.address,
      ecosystem: session.ecosystem,
      chainId: session.chainId ?? 10,
    });

    await sendResendEmail({
      to: email,
      subject: "Your ArcadeX verification code",
      text: `Your ArcadeX code is ${code}. It expires in 10 minutes.`,
    });

    return NextResponse.json({ ok: true, expiresInSeconds: 600 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to send verification email.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
