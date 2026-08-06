"use client";

import type { Hash, Hex } from "viem";
import { base } from "@/lib/chains";
import { createEvmWalletClient } from "@/lib/evm-wallet-client";
import {
  ARCADEX_REWARDS_ABI,
  ARCADEX_REWARDS_CONTRACT_ADDRESS,
  DEFAULT_STREAK_CAMPAIGN_ID,
  isArcadeXRewardsConfigured,
} from "@/lib/arcadex-rewards";

/** Pull a tx hash out of viem/MetaMask errors when the wallet already broadcast. */
function extractSubmittedTxHash(error: unknown): Hash | null {
  const candidates: unknown[] = [];
  let current: unknown = error;
  for (let i = 0; i < 6 && current; i++) {
    candidates.push(current);
    if (current && typeof current === "object") {
      const obj = current as Record<string, unknown>;
      if ("hash" in obj) candidates.push(obj.hash);
      if ("transactionHash" in obj) candidates.push(obj.transactionHash);
      if ("cause" in obj) current = obj.cause;
      else break;
    } else break;
  }

  for (const value of candidates) {
    if (typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value)) {
      return value as Hash;
    }
  }

  const text =
    error instanceof Error
      ? `${error.message} ${error.cause instanceof Error ? error.cause.message : ""}`
      : String(error);
  const match = text.match(/0x[a-fA-F0-9]{64}/);
  return match ? (match[0] as Hash) : null;
}

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

  let hash: Hash;
  try {
    hash = await walletClient.writeContract({
      account,
      chain: base,
      address: ARCADEX_REWARDS_CONTRACT_ADDRESS,
      abi: ARCADEX_REWARDS_ABI,
      functionName: "checkIn",
      args: [BigInt(campaignId), deadline, signature],
    });
  } catch (err) {
    const submitted = extractSubmittedTxHash(err);
    if (!submitted) throw err;
    hash = submitted;
  }

  // Do not block the UI on public-RPC receipt polling. Sync verifies on-chain.
  return { txHash: hash };
}
