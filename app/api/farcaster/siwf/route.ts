import { NextResponse } from "next/server";
import {
  createSessionToken,
  sessionCookieOptions,
} from "@/lib/auth-session";
import { verifySiwfMessage } from "@/lib/farcaster/siwf";
import { custodyOf } from "@/lib/farcaster/id-registry";
import { fetchNeynarUserByFid } from "@/lib/farcaster/neynar";
import { upsertSocialProfile } from "@/lib/farcaster/social-db";
import { buildPlayerId } from "@/lib/player-identity";
import {
  getClientIp,
  rateLimitResponse,
  checkRateLimit,
} from "@/lib/rate-limit";
import { getWorkerKv } from "@/lib/worker-kv";

export const dynamic = "force-dynamic";

function getAppOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) {
    return configured.startsWith("http")
      ? configured
      : `https://${configured}`;
  }
  return new URL(request.url).origin;
}

/**
 * Path A: existing FID → SIWF → ArcadeX session + D1 profile upsert.
 */
export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    if (!(await checkRateLimit(`farcaster:siwf:${ip}`, 20, 60_000))) {
      return rateLimitResponse();
    }

    const body = (await request.json()) as {
      message?: string;
      signature?: string;
      nonce?: string;
    };

    const { message, signature, nonce } = body;
    if (!message || !signature || !nonce) {
      return NextResponse.json(
        { error: "message, signature, and nonce are required." },
        { status: 400 }
      );
    }

    // Auth Kit issues the SIWF nonce; block replay via KV when available.
    const kv = await getWorkerKv();
    const nonceKey = `siwf:nonce:${nonce}`;
    if (kv) {
      const used = await kv.get(nonceKey);
      if (used) {
        return NextResponse.json(
          { error: "Sign-in nonce already used." },
          { status: 400 }
        );
      }
    }

    const origin = getAppOrigin(request);
    const domain = new URL(origin).host;

    const verified = await verifySiwfMessage({
      domain,
      nonce,
      message,
      signature,
    });

    if (kv) {
      await kv.put(nonceKey, "1", { expirationTtl: 60 * 60 });
    }

    // Prefer on-chain custody; SIWF may be signed by an auth address.
    const onchainCustody = await custodyOf(verified.fid);
    const custody = onchainCustody ?? verified.custody;

    const playerId = buildPlayerId("evm", custody);
    let neynarUser = null;
    try {
      neynarUser = await fetchNeynarUserByFid(verified.fid);
    } catch {
      // Neynar hydrate is best-effort for Path A.
    }

    const profile = await upsertSocialProfile({
      playerId,
      fid: verified.fid,
      primaryWallet: custody,
      custodyAddress: custody,
      fname: neynarUser?.username ?? null,
      displayName: neynarUser?.display_name ?? null,
      pfpUrl: neynarUser?.pfp_url ?? null,
      ecosystem: "evm",
      chainId: 10,
    });

    const token = await createSessionToken({
      playerId,
      address: custody,
      ecosystem: "evm",
      chainId: 10,
      fid: verified.fid,
    });

    const response = NextResponse.json({
      ok: true,
      fid: verified.fid,
      playerId,
      profile,
    });
    response.cookies.set(sessionCookieOptions(token));
    return response;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Farcaster sign-in failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
