"use client";

import type { Address, Hex } from "viem";
import {
  claimShuffleRewardOnChain,
  spinOnChain,
} from "@/lib/arcadex-rewards-spin";
import { DEFAULT_SHUFFLE_CAMPAIGN_ID } from "@/lib/daily-play-mode";
import {
  clearCachedStreakStatus,
} from "@/lib/streak-client-cache";
import {
  fetchStreakStatus,
  isAlreadyCheckedInError,
  refreshSessionFromCheckIn,
  type StreakStatus,
} from "@/lib/streak-client";
import { setWalletSessionToken } from "@/lib/wallet-session-client";

export type ShuffleTheaterCard = {
  id: string;
  type: "usdc" | "spark" | "none";
  amount: number | null;
  label: string;
  sub: string;
  glyph: string;
  rarity: string;
};

export type ShufflePrepareResult = {
  ok: boolean;
  campaignId: number;
  nonce: number;
  deadline: number;
  signature: Hex;
  rewardMode: number;
  rewardTarget: Address;
  rewardAmount: string;
  outcome: {
    id: string;
    type: "usdc" | "spark" | "none";
    amount: number | null;
  };
  theater: ShuffleTheaterCard[];
};

export type ShuffleSyncResult = {
  ok: boolean;
  walletAddress: string;
  campaignId: number;
  nonce: number;
  token: string;
  expiresIn: number;
  outcome: {
    id: string;
    type: "usdc" | "spark" | "none";
    amount: number | null;
  };
  needsClaim: boolean;
  infiniteSparkGranted: boolean;
  reward: { granted: boolean } | null;
};

export async function prepareDailyShuffle(
  walletAddress: string,
  campaignId: number = DEFAULT_SHUFFLE_CAMPAIGN_ID,
  chainId?: number | null
): Promise<ShufflePrepareResult> {
  const res = await fetch("/api/shuffle/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      walletAddress,
      campaignId,
      ...(chainId != null ? { chainId } : {}),
    }),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as ShufflePrepareResult & {
    error?: string;
    code?: string;
    chainId?: number;
  };
  if (!res.ok || !data.signature) {
    throw new Error(data.error ?? "Could not prepare today's shuffle.");
  }
  return data;
}

export async function syncShuffleSpin(opts: {
  walletAddress: string;
  txHash: string;
  campaignId: number;
  nonce: number;
  chainId?: number | null;
}): Promise<ShuffleSyncResult> {
  const res = await fetch("/api/shuffle/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as ShuffleSyncResult & {
    error?: string;
  };
  if (!res.ok || !data.token) {
    throw new Error(data.error ?? "Could not sync shuffle.");
  }
  setWalletSessionToken(data.token);
  clearCachedStreakStatus();
  return data;
}

/**
 * Primary wallet sign-in when NEXT_PUBLIC_DAILY_PLAY_MODE=shuffle:
 * prepare → spin() → sync JWT (+ optional Infinite Spark).
 */
export async function performDailyShuffle(
  walletAddress: string,
  campaignId: number = DEFAULT_SHUFFLE_CAMPAIGN_ID,
  chainId?: number | null
): Promise<{
  prepare: ShufflePrepareResult;
  sync: ShuffleSyncResult;
  txHash: string;
}> {
  const { isVaraRewardsChainId } = await import("@/lib/vara-rewards");
  try {
    const prepare = await prepareDailyShuffle(
      walletAddress,
      campaignId,
      chainId
    );
    let txHash: string;
    if (isVaraRewardsChainId(chainId)) {
      const { spinOnVara } = await import("@/lib/vara-rewards-client");
      const submitted = await spinOnVara({
        walletAddress,
        campaignId: prepare.campaignId,
        rewardMode: prepare.rewardMode,
        rewardAmount: BigInt(prepare.rewardAmount),
        nonce: prepare.nonce,
        deadline: prepare.deadline,
        signature: prepare.signature,
      });
      txHash = submitted.txHash;
    } else {
      const submitted = await spinOnChain({
        campaignId: prepare.campaignId,
        rewardMode: prepare.rewardMode,
        rewardTarget: prepare.rewardTarget,
        rewardAmount: BigInt(prepare.rewardAmount),
        nonce: BigInt(prepare.nonce),
        deadline: BigInt(prepare.deadline),
        signature: prepare.signature,
        expectedWallet: walletAddress,
      });
      txHash = submitted.txHash;
    }
    const sync = await syncShuffleSpin({
      walletAddress,
      txHash,
      campaignId: prepare.campaignId,
      nonce: prepare.nonce,
      chainId,
    });
    return { prepare, sync, txHash };
  } catch (err) {
    if (isAlreadyCheckedInError(err)) {
      await refreshSessionFromCheckIn(walletAddress, campaignId, chainId);
      throw err;
    }

    try {
      const status = await fetchStreakStatus(walletAddress, campaignId, {
        fresh: true,
        chainId,
      });
      if (!status.canCheckIn && status.lastCheckInAt > 0) {
        await refreshSessionFromCheckIn(walletAddress, campaignId, chainId);
      }
    } catch {
      // fall through
    }
    throw err;
  }
}

export async function claimDailyShuffleReward(
  campaignId: number = DEFAULT_SHUFFLE_CAMPAIGN_ID,
  expectedWallet?: string
) {
  return claimShuffleRewardOnChain(campaignId, expectedWallet);
}

export type { StreakStatus };
