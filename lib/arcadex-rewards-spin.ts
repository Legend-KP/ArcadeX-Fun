"use client";

import type { Address, Hash, Hex } from "viem";
import { base } from "@/lib/chains";
import { waitForBaseTransactionReceipt } from "@/lib/base-public-client";
import {
  ARCADEX_REWARDS_ABI,
  ARCADEX_REWARDS_CONTRACT_ADDRESS,
  isArcadeXRewardsConfigured,
} from "@/lib/arcadex-rewards";
import { DEFAULT_SHUFFLE_CAMPAIGN_ID } from "@/lib/daily-play-mode";
import {
  resolveEvmAccountForSession,
  WalletSessionMismatchError,
} from "@/lib/evm-session-wallet";

async function resolveBaseShuffleWallet(expectedWallet?: string) {
  try {
    return await resolveEvmAccountForSession(base, expectedWallet);
  } catch (err) {
    if (err instanceof WalletSessionMismatchError) throw err;
    throw new Error(
      err instanceof Error
        ? err.message
        : "No wallet account available. Unlock your wallet, connect this site, pick your signed-in account, then try again."
    );
  }
}

export async function spinOnChain(opts: {
  campaignId?: number;
  rewardMode: number;
  rewardTarget: Address;
  rewardAmount: bigint;
  nonce: bigint;
  deadline: bigint;
  signature: Hex;
  expectedWallet?: string;
}): Promise<{ txHash: Hash }> {
  if (!isArcadeXRewardsConfigured()) {
    throw new Error("ArcadeXRewards is not configured yet.");
  }

  const { account, walletClient } = await resolveBaseShuffleWallet(
    opts.expectedWallet
  );

  try {
    await walletClient.switchChain({ id: base.id });
  } catch {
    // Some wallets auto-prompt on writeContract.
  }

  const campaignId = opts.campaignId ?? DEFAULT_SHUFFLE_CAMPAIGN_ID;

  const hash = await walletClient.writeContract({
    account,
    chain: base,
    address: ARCADEX_REWARDS_CONTRACT_ADDRESS,
    abi: ARCADEX_REWARDS_ABI,
    functionName: "spin",
    args: [
      BigInt(campaignId),
      opts.rewardMode,
      opts.rewardTarget,
      opts.rewardAmount,
      opts.nonce,
      opts.deadline,
      opts.signature,
    ],
  });

  try {
    const receipt = await waitForBaseTransactionReceipt(hash);
    if (receipt.status !== "success") {
      throw new Error("Shuffle transaction failed.");
    }
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes("Shuffle transaction failed.")
    ) {
      throw err;
    }
    // Submitted — sync re-verifies on the server.
  }

  return { txHash: hash };
}

export async function claimShuffleRewardOnChain(
  campaignId: number = DEFAULT_SHUFFLE_CAMPAIGN_ID,
  expectedWallet?: string
): Promise<{ txHash: Hash }> {
  if (!isArcadeXRewardsConfigured()) {
    throw new Error("ArcadeXRewards is not configured yet.");
  }

  const { account, walletClient } = await resolveBaseShuffleWallet(
    expectedWallet
  );

  try {
    await walletClient.switchChain({ id: base.id });
  } catch {
    // Some wallets auto-prompt on writeContract.
  }

  const hash = await walletClient.writeContract({
    account,
    chain: base,
    address: ARCADEX_REWARDS_CONTRACT_ADDRESS,
    abi: ARCADEX_REWARDS_ABI,
    functionName: "claim",
    args: [BigInt(campaignId)],
  });

  const receipt = await waitForBaseTransactionReceipt(hash);
  if (receipt.status !== "success") {
    throw new Error("Claim transaction failed.");
  }

  return { txHash: hash };
}
