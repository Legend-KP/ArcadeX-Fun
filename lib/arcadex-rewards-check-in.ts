"use client";

import type { Address, Hash, Hex } from "viem";
import { avalanche, base } from "@/lib/chains";
import {
  resolveEvmAccountForSession,
  WalletSessionMismatchError,
} from "@/lib/evm-session-wallet";
import {
  ARCADEX_REWARDS_ABI,
  getArcadeXRewardsAddress,
  getStreakCampaignIdForChain,
  isArcadeXRewardsConfiguredForChain,
  isAvalancheRewardsChainId,
} from "@/lib/arcadex-rewards";
import { isVaraRewardsChainId } from "@/lib/vara-rewards";
import { extractSubmittedTxHash } from "@/lib/tx-hash";

/**
 * Wallet write of ArcadeXRewards.checkIn (Base, Avalanche, or Vara)
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

  if (isVaraRewardsChainId(chainId)) {
    if (!opts?.expectedWallet) {
      throw new Error("Vara check-in requires expectedWallet.");
    }
    const { checkInOnVara } = await import("@/lib/vara-rewards-client");
    const { txHash } = await checkInOnVara({
      walletAddress: opts.expectedWallet,
      campaignId: campaignId ?? getStreakCampaignIdForChain(chainId),
    });
    return { txHash: txHash as Hash };
  }

  const chain = isAvalancheRewardsChainId(chainId) ? avalanche : base;

  let account: Address;
  let walletClient;
  try {
    const resolved = await resolveEvmAccountForSession(
      chain,
      opts?.expectedWallet
    );
    account = resolved.account;
    walletClient = resolved.walletClient;
  } catch (err) {
    if (err instanceof WalletSessionMismatchError) {
      throw err;
    }
    throw new Error(
      err instanceof Error
        ? err.message
        : "No wallet account available. Unlock your wallet, connect this site, pick your signed-in account, then try again."
    );
  }

  // Ensure wallet is on Base / Avalanche before checkIn (avoids wrong-chain txs).
  try {
    await walletClient.switchChain({ id: chain.id });
  } catch (err) {
    const message = err instanceof Error ? err.message.toLowerCase() : "";
    if (
      message.includes("rejected") ||
      message.includes("denied") ||
      message.includes("user refused")
    ) {
      throw new Error(
        `Switch MetaMask to ${chain.name} to complete daily check-in.`
      );
    }
    // Some wallets auto-prompt on writeContract; continue and let write fail clearly.
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
