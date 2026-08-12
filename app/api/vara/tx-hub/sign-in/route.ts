import { NextResponse } from "next/server";
import { readSessionFromCookies } from "@/lib/auth-session";
import {
  recordVaraTxHubSignInOnServer,
  VaraTxHubSignInError,
} from "@/lib/rtdb-server";
import { isValidVaraExtrinsicHash } from "@/lib/shop-vara";
import { playPurpose } from "@/lib/vara-tx-hub";
import { verifyVaraTxHubSignIn } from "@/lib/vara-tx-hub-server";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { getTxVerifyCache, setTxVerifyCache } from "@/lib/tx-verify-cache";

export const dynamic = "force-dynamic";

/**
 * Verify a free ArcadeXTxHub sign_in extrinsic and record it (replay map).
 * Called after Start Game on-chain sign-in, before spark spend.
 */
export async function POST(request: Request) {
  try {
    const session = await readSessionFromCookies();
    if (!session || session.ecosystem !== "vara") {
      return NextResponse.json(
        { error: "Sign in with a Vara wallet first.", code: "NO_SESSION" },
        { status: 401 }
      );
    }

    const ip = getClientIp(request);
    if (
      !(await checkRateLimit(
        `vara-txhub-signin:player:${session.playerId}`,
        10,
        60_000
      )) ||
      !(await checkRateLimit(`vara-txhub-signin:ip:${ip}`, 20, 60_000))
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

    if (!isValidVaraExtrinsicHash(txHash)) {
      return NextResponse.json(
        { error: "A valid transaction hash is required.", code: "INVALID_TX" },
        { status: 400 }
      );
    }

    const cacheKey = `vara-txhub:${txHash.toLowerCase()}:${session.address}:${gameId}`;
    type Verified = Awaited<ReturnType<typeof verifyVaraTxHubSignIn>>;
    let verified = getTxVerifyCache<Verified>(cacheKey);
    if (!verified) {
      verified = await verifyVaraTxHubSignIn({
        txHash,
        expectedFrom: session.address,
        gameId,
      });
      setTxVerifyCache(cacheKey, verified);
    }

    const { reused } = await recordVaraTxHubSignInOnServer({
      walletAddress: session.address,
      txHash,
      gameId,
      purpose: verified.purpose,
    });

    return NextResponse.json({
      ok: true,
      reused,
      purpose: verified.purpose,
      playPurpose: playPurpose(gameId),
      programId: verified.programId,
      txHash: txHash.toLowerCase(),
    });
  } catch (err) {
    if (err instanceof VaraTxHubSignInError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.code === "TX_ALREADY_USED" ? 409 : 400 }
      );
    }

    const message =
      err instanceof Error ? err.message : "Failed to verify Vara sign-in.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
