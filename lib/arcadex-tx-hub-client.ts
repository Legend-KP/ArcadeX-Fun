"use client";

import type { Address, Hash, Hex } from "viem";
import { base } from "@/lib/chains";
import {
  ARCADEX_TX_HUB_ABI,
  getArcadeXTxHubAddress,
  playPurposeKeccak,
} from "@/lib/arcadex-tx-hub";
import {
  resolveEvmAccountForSession,
  WalletSessionMismatchError,
} from "@/lib/evm-session-wallet";
import { extractSubmittedTxHash } from "@/lib/tx-hash";

/**
 * Free on-chain ArcadeXTxHub.signIn for Start Game on Base.
 * Returns the transaction hash (receipt verified server-side).
 */
export async function signInOnArcadeXTxHub(params: {
  fromAddress: string;
  gameId: string;
  onStatus?: (message: string) => void;
}): Promise<Hash> {
  const contractAddress = getArcadeXTxHubAddress();
  const purpose = playPurposeKeccak(params.gameId);

  params.onStatus?.("Connecting wallet…");

  let account: Address;
  let walletClient;
  try {
    const resolved = await resolveEvmAccountForSession(
      base,
      params.fromAddress
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

  try {
    await walletClient.switchChain({ id: base.id });
  } catch (err) {
    const message = err instanceof Error ? err.message.toLowerCase() : "";
    if (
      message.includes("rejected") ||
      message.includes("denied") ||
      message.includes("user refused")
    ) {
      throw new Error("Switch MetaMask to Base to complete free play sign-in.");
    }
  }

  params.onStatus?.("Approve free play sign-in in your wallet…");

  let hash: Hash;
  try {
    hash = await walletClient.writeContract({
      account,
      chain: base,
      address: contractAddress,
      abi: ARCADEX_TX_HUB_ABI,
      functionName: "signIn",
      args: [purpose as Hex],
    });
  } catch (err) {
    const submitted = extractSubmittedTxHash(err);
    if (!submitted) throw err;
    hash = submitted;
  }

  return hash;
}
