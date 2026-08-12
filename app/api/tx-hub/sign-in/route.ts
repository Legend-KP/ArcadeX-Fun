import { NextResponse } from "next/server";
import { readSessionFromCookies } from "@/lib/auth-session";
import {
  recordBaseTxHubSignInOnServer,
  BaseTxHubSignInError,
} from "@/lib/rtdb-server";
import {
  isArcadeXTxHubConfigured,
  playPurposeKeccak,
} from "@/lib/arcadex-tx-hub";
import { verifyArcadeXTxHubSignIn } from "@/lib/arcadex-tx-hub-server";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { getTxVerifyCache, setTxVerifyCache } from "@/lib/tx-verify-cache";
import type { Hash } from "viem";

export const dynamic = "force-dynamic";

/**
 * Verify a free ArcadeXTxHub.signIn tx on Base and record it (replay map).
 * Called after Start Game on-chain sign-in, before spark spend.
 */
export async function POST(request: Request) {
  try {
    if (!isArcadeXTxHubConfigured()) {
      return NextResponse.json(
        { error: "ArcadeXTxHub is not configured.", code: "NOT_CONFIGURED" },
        { status: 503 }
      );
    }

    const session = await readSessionFromCookies();
    if (!session || session.ecosystem !== "evm") {
      return NextResponse.json(
        { error: "Sign in with a Base wallet first.", code: "NO_SESSION" },
        { status: 401 }
      );
    }

    const ip = getClientIp(request);
    if (
      !(await checkRateLimit(
        `txhub-signin:player:${session.playerId}`,
        10,
        60_000
      )) ||
      !(await checkRateLimit(`txhub-signin:ip:${ip}`, 20, 60_000))
    ) {
      return rateLimitResponse();
    }

    const body = (await request.json()) as {
      txHash?: string;
      gameId?: string;
    };

    const txHash = body.txHash?.trim() ?? "";
    const gameId = body.gameId?.trim() ?? "";

    if (!gameId) {
      return NextResponse.json(
        { error: "gameId is required.", code: "INVALID_GAME" },
        { status: 400 }
      );
    }

    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      return NextResponse.json(
        { error: "A valid transaction hash is required.", code: "INVALID_TX" },
        { status: 400 }
      );
    }

    const cacheKey = `base-txhub:${txHash.toLowerCase()}:${session.address.toLowerCase()}:${gameId}`;
    type Verified = Awaited<ReturnType<typeof verifyArcadeXTxHubSignIn>>;
    let verified = getTxVerifyCache<Verified>(cacheKey);
    if (!verified) {
      verified = await verifyArcadeXTxHubSignIn({
        txHash: txHash as Hash,
        expectedFrom: session.address,
        gameId,
      });
      setTxVerifyCache(cacheKey, verified);
    }

    const { reused } = await recordBaseTxHubSignInOnServer({
      walletAddress: session.address,
      txHash,
      gameId,
      purpose: verified.purpose,
      chainId: session.chainId ?? 8453,
    });

    return NextResponse.json({
      ok: true,
      reused,
      purpose: verified.purpose,
      playPurpose: playPurposeKeccak(gameId),
      contractAddress: verified.contractAddress,
      txHash: txHash.toLowerCase(),
    });
  } catch (err) {
    if (err instanceof BaseTxHubSignInError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.code === "TX_ALREADY_USED" ? 409 : 400 }
      );
    }

    const message =
      err instanceof Error ? err.message : "Failed to verify Base sign-in.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
