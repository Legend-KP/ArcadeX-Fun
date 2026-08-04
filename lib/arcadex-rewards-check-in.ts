"use client";

import type { Hash, Hex } from "viem";
import { base } from "@/lib/chains";
import { waitForBaseTransactionReceipt } from "@/lib/base-public-client";
import { createEvmWalletClient } from "@/lib/evm-wallet-client";
import {
  ARCADEX_REWARDS_ABI,
  ARCADEX_REWARDS_CONTRACT_ADDRESS,
  DEFAULT_STREAK_CAMPAIGN_ID,
  isArcadeXRewardsConfigured,
} from "@/lib/arcadex-rewards";

/**
 * Wallet write of ArcadeXRewards.checkIn on Base
 * (campaigns without eligibility use deadline=0, signature=0x).
 *
 * Returns the tx hash even when local receipt polling flakes — `/api/streak/sync`
 * re-verifies on the server so a Basescan-confirmed check-in still unlocks the app.
 */
export async function checkInOnChain(
  campaignId: number = DEFAULT_STREAK_CAMPAIGN_ID,
  opts?: { deadline?: bigint; signature?: Hex }
): Promise<{ txHash: Hash }> {
  if (!isArcadeXRewardsConfigured()) {
    throw new Error("ArcadeXRewards is not configured yet.");
  }

  const walletClient = createEvmWalletClient();
  if (!walletClient) {
    throw new Error("Connect your wallet to check in.");
  }

  const [account] = await walletClient.getAddresses();
  if (!account) {
    throw new Error("No wallet account available.");
  }

  // Campaigns without requireEligibility ignore these (pass 0 / 0x).
  const deadline = opts?.deadline ?? BigInt(0);
  const signature = opts?.signature ?? ("0x" as Hex);

  const hash = await walletClient.writeContract({
    account,
    chain: base,
    address: ARCADEX_REWARDS_CONTRACT_ADDRESS,
    abi: ARCADEX_REWARDS_ABI,
    functionName: "checkIn",
    args: [BigInt(campaignId), deadline, signature],
  });

  try {
    const receipt = await waitForBaseTransactionReceipt(hash);
    if (receipt.status !== "success") {
      throw new Error("Check-in transaction failed.");
    }
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes("Check-in transaction failed.")
    ) {
      throw err;
    }
    // Tx was submitted — sync endpoint verifies the receipt server-side.
  }

  return { txHash: hash };
}
