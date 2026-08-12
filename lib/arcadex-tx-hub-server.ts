/**
 * Server-side ArcadeXTxHub.signIn verification (Base).
 */
import {
  decodeEventLog,
  getAddress,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import {
  ARCADEX_TX_HUB_ABI,
  getArcadeXTxHubAddress,
  playPurposeKeccak,
} from "@/lib/arcadex-tx-hub";
import { getPaymentTransactionReceipt } from "@/lib/payment-tx-verify";

export async function verifyArcadeXTxHubSignIn(params: {
  txHash: Hash | string;
  expectedFrom: string;
  gameId: string;
}): Promise<{ purpose: Hex; contractAddress: Address }> {
  const contractAddress = getArcadeXTxHubAddress();
  const expectedPlayer = getAddress(params.expectedFrom as Address);
  const expectedPurpose = playPurposeKeccak(params.gameId).toLowerCase();
  const txHash = params.txHash as Hash;

  const receipt = await getPaymentTransactionReceipt(txHash, 8453);

  if (receipt.status !== "success") {
    throw new Error("Sign-in transaction did not succeed.");
  }

  if (receipt.to?.toLowerCase() !== contractAddress.toLowerCase()) {
    throw new Error("Sign-in transaction does not target ArcadeXTxHub.");
  }

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== contractAddress.toLowerCase()) {
      continue;
    }

    try {
      const decoded = decodeEventLog({
        abi: ARCADEX_TX_HUB_ABI,
        data: log.data,
        topics: log.topics,
      });

      if (decoded.eventName !== "SignedIn") continue;

      const args = decoded.args as unknown as {
        player: Address;
        purpose: Hex;
        timestamp: bigint;
      };

      if (getAddress(args.player) !== expectedPlayer) {
        throw new Error("Sign-in transaction signer mismatch.");
      }

      if (String(args.purpose).toLowerCase() !== expectedPurpose) {
        throw new Error("Sign-in transaction purpose mismatch.");
      }

      return {
        purpose: args.purpose,
        contractAddress,
      };
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes("signer mismatch") ||
          error.message.includes("purpose mismatch"))
      ) {
        throw error;
      }
    }
  }

  throw new Error("SignedIn event not found in transaction.");
}
