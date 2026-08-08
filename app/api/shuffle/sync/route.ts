import { NextResponse } from "next/server";
import type { Hash } from "viem";
import {
  REWARD_OFFCHAIN,
  REWARD_USDC,
  isArcadeXRewardsConfigured,
  isArcadeXRewardsConfiguredForChain,
} from "@/lib/arcadex-rewards";
import { verifySpinTx } from "@/lib/arcadex-rewards-verify";
import { DEFAULT_SHUFFLE_CAMPAIGN_ID } from "@/lib/daily-play-mode";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import {
  confirmShuffleUsdcBudget,
  getShufflePending,
  grantShuffleInfiniteSparkOnServer,
  markShufflePendingConsumed,
  recordSpinTxOnServer,
  shuffleUsdcReservationKey,
  StreakRewardError,
  StreakSyncError,
} from "@/lib/rtdb-server";
import { usdcToMicro } from "@/lib/shuffle-outcomes";
import { invalidateStreakProgressCache } from "@/lib/streak-progress-cache";
import {
  isStreakWalletAddress,
  normalizeStreakWalletAddress,
} from "@/lib/streak-wallet";
import { createWalletSessionToken } from "@/lib/wallet-session";
import {
  isVaraArcadeXRewardsConfigured,
  isVaraRewardsChainId,
  VARA_SHUFFLE_CAMPAIGN_ID,
} from "@/lib/vara-rewards";
import { verifyVaraShuffleSpinSignature } from "@/lib/vara-shuffle-sign";
import { PRIMARY_EVM_CHAIN_ID } from "@/lib/chains";

export const dynamic = "force-dynamic";

const SESSION_TTL_SEC = 24 * 60 * 60;

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`shuffle-sync:${ip}`, 30, 60_000))) {
    return rateLimitResponse();
  }

  try {
    const body = (await request.json()) as {
      walletAddress?: string;
      txHash?: string;
      campaignId?: number;
      nonce?: number;
      chainId?: number;
    };

    const chainId =
      typeof body.chainId === "number" && Number.isFinite(body.chainId)
        ? body.chainId
        : PRIMARY_EVM_CHAIN_ID;

    const configured = isVaraRewardsChainId(chainId)
      ? isVaraArcadeXRewardsConfigured()
      : isArcadeXRewardsConfiguredForChain(chainId) ||
        isArcadeXRewardsConfigured();

    if (!configured) {
      return NextResponse.json(
        { error: "Rewards contract not configured.", code: "NOT_CONFIGURED" },
        { status: 503 }
      );
    }

    const rawWallet = body.walletAddress?.trim() ?? "";
    const txHash = body.txHash?.trim() ?? "";
    const defaultCampaign = isVaraRewardsChainId(chainId)
      ? VARA_SHUFFLE_CAMPAIGN_ID
      : DEFAULT_SHUFFLE_CAMPAIGN_ID;
    const campaignId =
      typeof body.campaignId === "number" && Number.isFinite(body.campaignId)
        ? body.campaignId
        : defaultCampaign;
    const nonce =
      typeof body.nonce === "number" && Number.isFinite(body.nonce)
        ? body.nonce
        : -1;

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
    if (nonce < 0) {
      return NextResponse.json(
        { error: "nonce is required.", code: "INVALID_NONCE" },
        { status: 400 }
      );
    }

    const wallet = normalizeStreakWalletAddress(chainId, rawWallet);
    const pending = await getShufflePending(wallet, campaignId, nonce);
    if (!pending) {
      return NextResponse.json(
        { error: "No pending shuffle for this nonce.", code: "NO_PENDING" },
        { status: 400 }
      );
    }

    if (isVaraRewardsChainId(chainId)) {
      const ok = await verifyVaraShuffleSpinSignature({
        player: wallet,
        campaignId,
        rewardMode: pending.rewardMode,
        rewardAmount: BigInt(pending.rewardAmount),
        nonce,
        deadline: pending.deadline,
        signature: pending.signature,
      });
      if (!ok) {
        return NextResponse.json(
          { error: "Invalid spin signature.", code: "INVALID_SIG" },
          { status: 400 }
        );
      }
    }

    let verified;
    try {
      verified = await verifySpinTx(
        wallet,
        txHash as Hash,
        campaignId,
        chainId,
        isVaraRewardsChainId(chainId)
          ? {
              rewardMode: pending.rewardMode,
              rewardAmount: pending.rewardAmount,
              nonce,
              deadline: pending.deadline,
              signature: pending.signature,
            }
          : undefined
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Invalid spin transaction.";
      return NextResponse.json(
        { error: message, code: "INVALID_TX" },
        { status: 400 }
      );
    }

    if (Number(verified.rewardMode) !== pending.rewardMode) {
      return NextResponse.json(
        { error: "On-chain reward does not match prepared outcome.", code: "MISMATCH" },
        { status: 400 }
      );
    }
    if (verified.rewardAmount.toString() !== pending.rewardAmount) {
      return NextResponse.json(
        { error: "On-chain amount does not match prepared outcome.", code: "MISMATCH" },
        { status: 400 }
      );
    }

    await recordSpinTxOnServer(wallet, txHash, campaignId, pending.outcomeId);
    await markShufflePendingConsumed(wallet, campaignId, nonce, txHash);
    await invalidateStreakProgressCache(wallet, campaignId, chainId);

    const token = await createWalletSessionToken(wallet);

    let infiniteSparkGranted = false;
    let reward: { granted: boolean; sparks?: unknown; state?: unknown } | null =
      null;

    if (
      pending.outcomeType === "spark" &&
      Number(verified.rewardMode) === REWARD_OFFCHAIN
    ) {
      try {
        const result = await grantShuffleInfiniteSparkOnServer(wallet, txHash);
        infiniteSparkGranted = result.granted || Boolean(result.state.infiniteUntil);
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

    if (
      !isVaraRewardsChainId(chainId) &&
      pending.outcomeType === "usdc" &&
      Number(verified.rewardMode) === REWARD_USDC
    ) {
      const amountMicro =
        pending.displayAmount != null
          ? usdcToMicro(pending.displayAmount)
          : Number(verified.rewardAmount);
      await confirmShuffleUsdcBudget({
        amountMicro,
        reservationKey: shuffleUsdcReservationKey(wallet, campaignId, nonce),
      });
    }

    const needsClaim =
      !isVaraRewardsChainId(chainId) &&
      pending.outcomeType === "usdc" &&
      Number(verified.rewardMode) === REWARD_USDC;

    return NextResponse.json({
      ok: true,
      walletAddress: wallet,
      campaignId,
      chainId,
      nonce,
      token,
      expiresIn: SESSION_TTL_SEC,
      outcome: {
        id: pending.outcomeId,
        type: pending.outcomeType,
        amount: pending.displayAmount,
      },
      needsClaim,
      infiniteSparkGranted,
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
      err instanceof Error ? err.message : "Failed to sync shuffle.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
