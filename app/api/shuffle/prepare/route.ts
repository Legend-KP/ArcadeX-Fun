import { NextResponse } from "next/server";
import { getAddress, type Address, type Hex } from "viem";
import {
  isArcadeXRewardsConfigured,
  isArcadeXRewardsConfiguredForChain,
  REWARD_OFFCHAIN,
} from "@/lib/arcadex-rewards";
import {
  readSpinNonce,
  readStreakProgress,
} from "@/lib/arcadex-rewards-verify";
import { DEFAULT_SHUFFLE_CAMPAIGN_ID } from "@/lib/daily-play-mode";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import {
  getShufflePending,
  getShuffleUsdcBudgetRemainingMicro,
  reserveShuffleUsdcBudget,
  saveShufflePending,
  shuffleUsdcReservationKey,
  type ShufflePendingRecord,
} from "@/lib/rtdb-server";
import {
  getShuffleTheaterCards,
  microToUsdc,
  outcomeToOnChainReward,
  pickShuffleOutcome,
  usdcToMicro,
} from "@/lib/shuffle-outcomes";
import { signShuffleSpin } from "@/lib/shuffle-sign";
import { signVaraShuffleSpin } from "@/lib/vara-shuffle-sign";
import {
  isStreakWalletAddress,
  normalizeStreakWalletAddress,
} from "@/lib/streak-wallet";
import {
  isVaraArcadeXRewardsConfigured,
  isVaraRewardsChainId,
  VARA_CHAIN_ID,
  VARA_REWARD_OFFCHAIN,
  VARA_SHUFFLE_CAMPAIGN_ID,
} from "@/lib/vara-rewards";
import { PRIMARY_EVM_CHAIN_ID } from "@/lib/chains";

export const dynamic = "force-dynamic";

const SIGNATURE_TTL_SEC = 10 * 60;

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`shuffle-prepare:${ip}`, 30, 60_000))) {
    return rateLimitResponse();
  }

  try {
    const body = (await request.json()) as {
      walletAddress?: string;
      campaignId?: number;
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
    const defaultCampaign = isVaraRewardsChainId(chainId)
      ? VARA_SHUFFLE_CAMPAIGN_ID
      : DEFAULT_SHUFFLE_CAMPAIGN_ID;
    const campaignId =
      typeof body.campaignId === "number" && Number.isFinite(body.campaignId)
        ? body.campaignId
        : defaultCampaign;

    if (!rawWallet || !isStreakWalletAddress(chainId, rawWallet)) {
      return NextResponse.json(
        { error: "walletAddress is required.", code: "NO_WALLET" },
        { status: 400 }
      );
    }

    const wallet = normalizeStreakWalletAddress(chainId, rawWallet);
    if (!(await checkRateLimit(`shuffle-prepare-wallet:${wallet}`, 12, 60_000))) {
      return rateLimitResponse();
    }

    const progress = await readStreakProgress(wallet, campaignId, chainId);
    if (!progress.campaign.active || progress.campaign.cancelled) {
      return NextResponse.json(
        { error: "Shuffle campaign is not active.", code: "INACTIVE" },
        { status: 400 }
      );
    }
    if (Number(progress.campaign.campaignType) !== 1) {
      return NextResponse.json(
        {
          error: "Campaign is not a SHUFFLE campaign. Configure campaign 2 on-chain.",
          code: "WRONG_TYPE",
        },
        { status: 400 }
      );
    }
    if (!progress.canCheckIn) {
      return NextResponse.json(
        {
          error: "Already shuffled today. Come back after the daily interval.",
          code: "TOO_SOON",
        },
        { status: 409 }
      );
    }

    const nonceBig = await readSpinNonce(wallet, campaignId, chainId);
    const nonce = Number(nonceBig);

    const existing = await getShufflePending(wallet, campaignId, nonce);
    const nowSec = Math.floor(Date.now() / 1000);
    if (
      existing &&
      !existing.consumedAt &&
      existing.deadline > nowSec + 30 &&
      existing.signature
    ) {
      return NextResponse.json(formatPrepareResponse(existing));
    }

    // Vara lite: off-chain only (no USDC claim path).
    const remainingMicro = isVaraRewardsChainId(chainId)
      ? 0
      : await getShuffleUsdcBudgetRemainingMicro();
    let outcome = pickShuffleOutcome({
      remainingUsdc: microToUsdc(remainingMicro),
    });

    const reservationKey = shuffleUsdcReservationKey(wallet, campaignId, nonce);
    const deadline = BigInt(nowSec + SIGNATURE_TTL_SEC);

    if (outcome.type === "usdc" && outcome.amount != null) {
      if (isVaraRewardsChainId(chainId)) {
        outcome = pickShuffleOutcome({ remainingUsdc: 0 });
      } else {
        const amountMicro = usdcToMicro(outcome.amount);
        const reserved = await reserveShuffleUsdcBudget({
          amountMicro,
          reservationKey,
          expiresAtMs: Number(deadline) * 1000,
        });

        if (!reserved.ok) {
          outcome = pickShuffleOutcome({ remainingUsdc: 0 });
        }
      }
    }

    const onChain = outcomeToOnChainReward(outcome);
    if (isVaraRewardsChainId(chainId) && onChain.rewardMode !== VARA_REWARD_OFFCHAIN) {
      // Force spark/none into OFFCHAIN encoding.
      onChain.rewardMode = REWARD_OFFCHAIN;
      onChain.rewardTarget =
        "0x0000000000000000000000000000000000000000" as Address;
    }

    let signature: Hex;
    if (isVaraRewardsChainId(chainId)) {
      signature = await signVaraShuffleSpin({
        player: wallet,
        campaignId,
        rewardMode: onChain.rewardMode,
        rewardAmount: onChain.rewardAmount,
        nonce: nonceBig,
        deadline,
      });
    } else {
      const player = getAddress(wallet) as Address;
      signature = await signShuffleSpin({
        player,
        campaignId,
        rewardMode: onChain.rewardMode,
        rewardTarget: onChain.rewardTarget,
        rewardAmount: onChain.rewardAmount,
        nonce: nonceBig,
        deadline,
      });
    }

    const record: ShufflePendingRecord = {
      wallet,
      campaignId,
      nonce,
      outcomeId: outcome.id,
      outcomeType: outcome.type,
      displayAmount: outcome.amount,
      rewardMode: onChain.rewardMode,
      rewardTarget: onChain.rewardTarget,
      rewardAmount: onChain.rewardAmount.toString(),
      deadline: Number(deadline),
      signature,
      createdAt: Date.now(),
    };

    await saveShufflePending(record);

    return NextResponse.json({
      ...formatPrepareResponse(record),
      chainId: isVaraRewardsChainId(chainId) ? VARA_CHAIN_ID : chainId,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to prepare shuffle.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function formatPrepareResponse(record: ShufflePendingRecord) {
  return {
    ok: true,
    campaignId: record.campaignId,
    nonce: record.nonce,
    deadline: record.deadline,
    signature: record.signature as Hex,
    rewardMode: record.rewardMode,
    rewardTarget: record.rewardTarget,
    rewardAmount: record.rewardAmount,
    outcome: {
      id: record.outcomeId,
      type: record.outcomeType,
      amount: record.displayAmount,
    },
    theater: getShuffleTheaterCards(),
  };
}
