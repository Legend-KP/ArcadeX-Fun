"use client";

import type { Address, Hash, Hex } from "viem";
import { getAddress } from "viem";
import { avalanche, base } from "@/lib/chains";
import { createEvmWalletClient } from "@/lib/evm-wallet-client";
import {
  ARCADEX_REWARDS_ABI,
  getArcadeXRewardsAddress,
  getStreakCampaignIdForChain,
  isArcadeXRewardsConfiguredForChain,
  isAvalancheRewardsChainId,
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
 * Wallet write of ArcadeXRewards.checkIn (Base or Avalanche)
 * (campaigns without eligibility use deadline=0, signature=0x).
 *
 * Returns the tx hash even when local receipt polling flakes — `/api/streak/sync`
 * re-verifies on the server so a confirmed check-in still unlocks the app.
 */
export async function checkInOnChain(
  campaignId?: number,
  opts?: {
    deadline?: bigint;
    signature?: Hex;
    chainId?: number;
    /** Session wallet — MetaMask must be this account or sync will reject the tx. */
    expectedWallet?: string;
  }
): Promise<{ txHash: Hash }> {
  const chainId = opts?.chainId;
  if (!isArcadeXRewardsConfiguredForChain(chainId)) {
    throw new Error("ArcadeXRewards is not configured yet.");
  }

  const chain = isAvalancheRewardsChainId(chainId) ? avalanche : base;
  const walletClient = createEvmWalletClient(chain);
  if (!walletClient) {
    throw new Error("Connect your wallet to check in.");
  }

  const [account] = await walletClient.getAddresses();
  if (!account) {
    throw new Error("No wallet account available.");
  }

  if (opts?.expectedWallet) {
    try {
      if (getAddress(account) !== getAddress(opts.expectedWallet as Address)) {
        throw new Error(
          `MetaMask is on ${account.slice(0, 6)}…${account.slice(-4)}, but you signed in as ${opts.expectedWallet.slice(0, 6)}…${opts.expectedWallet.slice(-4)}. Switch MetaMask to your signed-in account, then try again.`
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("MetaMask is on")) {
        throw err;
      }
      // Invalid expectedWallet — server sync still enforces match.
    }
  }

  const resolvedCampaignId =
    campaignId ?? getStreakCampaignIdForChain(chainId);

  // Campaigns without requireEligibility ignore these (pass 0 / 0x).
  const deadline = opts?.deadline ?? BigInt(0);
  const signature = opts?.signature ?? ("0x" as Hex);

  let hash: Hash;
  try {
    hash = await walletClient.writeContract({
      account,
      chain,
      address: getArcadeXRewardsAddress(chainId),
      abi: ARCADEX_REWARDS_ABI,
      functionName: "checkIn",
      args: [BigInt(resolvedCampaignId), deadline, signature],
    });
  } catch (err) {
    const submitted = extractSubmittedTxHash(err);
    if (!submitted) throw err;
    hash = submitted;
  }

  // Do not block the UI on public-RPC receipt polling. Sync verifies on-chain.
  return { txHash: hash };
}
