import { NextResponse } from "next/server";
import {
  getStreakCampaignIdForChain,
  isArcadeXRewardsConfiguredForChain,
} from "@/lib/arcadex-rewards";
import { verifyCheckInTx } from "@/lib/arcadex-rewards-verify";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import {
  recordCheckInTxOnServer,
  StreakSyncError,
  grantStreakInfiniteSparkOnServer,
  StreakRewardError,
} from "@/lib/rtdb-server";
import {
  isStreakWalletAddress,
  normalizeStreakWalletAddress,
} from "@/lib/streak-wallet";
import { invalidateStreakProgressCache } from "@/lib/streak-progress-cache";
import { createWalletSessionToken } from "@/lib/wallet-session";
import { PRIMARY_EVM_CHAIN_ID } from "@/lib/chains";
import type { Hash } from "viem";

export const dynamic = "force-dynamic";

const SESSION_TTL_SEC = 24 * 60 * 60;

/**
 * Verify an on-chain checkIn tx, bind a session JWT to that wallet, and
 * auto-grant Infinite Spark if the same tx emitted MilestoneReached.
 */
export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`streak-sync:${ip}`, 30, 60_000))) {
    return rateLimitResponse();
  }

  try {
    const body = (await request.json()) as {
      walletAddress?: string;
      txHash?: string;
      campaignId?: number;
      chainId?: number;
    };

    const rawWallet = body.walletAddress?.trim() ?? "";
    const txHash = body.txHash?.trim() ?? "";
    const chainId =
      typeof body.chainId === "number" && Number.isFinite(body.chainId)
        ? body.chainId
        : PRIMARY_EVM_CHAIN_ID;
    const campaignId =
      typeof body.campaignId === "number" && Number.isFinite(body.campaignId)
        ? body.campaignId
        : getStreakCampaignIdForChain(chainId);

    if (!isArcadeXRewardsConfiguredForChain(chainId)) {
      return NextResponse.json(
        { error: "Streak rewards are not configured yet.", code: "NOT_CONFIGURED" },
        { status: 503 }
      );
    }

    if (!rawWallet || !isStreakWalletAddress(chainId, rawWallet)) {
      return NextResponse.json(
        { error: "walletAddress is required.", code: "NO_WALLET" },
        { status: 400 }
      );
    }

    if (!txHash || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
      return NextResponse.json(
        { error: "txHash is required.", code: "INVALID_TX" },
        { status: 400 }
      );
    }

    const wallet = normalizeStreakWalletAddress(chainId, rawWallet);

    let verified;
    try {
      verified = await verifyCheckInTx(
        wallet,
        txHash as Hash,
        campaignId,
        chainId
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Invalid check-in transaction.";
      return NextResponse.json(
        { error: message, code: "INVALID_TX" },
        { status: 400 }
      );
    }

    await recordCheckInTxOnServer(wallet, txHash, verified.day, campaignId);
    await invalidateStreakProgressCache(wallet, campaignId, chainId);

    const token = await createWalletSessionToken(wallet);

    let reward: {
      granted: boolean;
      sparks?: unknown;
      state?: unknown;
    } | null = null;

    if (verified.milestone) {
      try {
        const result = await grantStreakInfiniteSparkOnServer(
          wallet,
          txHash,
          campaignId,
          chainId
        );
        reward = {
          granted: result.granted,
          sparks: result.sparks,
          state: result.state,
        };
      } catch (err) {
        if (err instanceof StreakRewardError) {
          return NextResponse.json(
            { error: err.message, code: err.code },
            { status: err.code === "TX_ALREADY_USED" ? 409 : 400 }
          );
        }
        throw err;
      }
    }

    return NextResponse.json({
      ok: true,
      walletAddress: wallet,
      day: verified.day,
      campaignId,
      chainId,
      milestone: Boolean(verified.milestone),
      token,
      expiresIn: SESSION_TTL_SEC,
      reward,
    });
  } catch (err) {
    if (err instanceof StreakSyncError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.code === "TX_ALREADY_USED" ? 409 : 400 }
      );
    }

    const message =
      err instanceof Error ? err.message : "Failed to sync check-in.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
