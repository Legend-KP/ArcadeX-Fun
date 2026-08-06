import {
  decodeEventLog,
  getAddress,
  type Address,
  type Hash,
  type Abi,
  type TransactionReceipt,
} from "viem";
import {
  getBasePublicClient,
  readBaseContractWithFailover,
  resetBasePublicClient,
  isBlockOutOfRangeError,
  waitForBaseTransactionReceipt,
} from "@/lib/base-public-client";
import {
  getAvalanchePublicClient,
  resetAvalanchePublicClient,
  waitForAvalancheTransactionReceipt,
} from "@/lib/avalanche-public-client";
import { isAvalancheRewardsChainId } from "@/lib/arcadex-rewards";

function collectErrorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const parts: string[] = [error.message];
  let cause: unknown = error.cause;
  while (cause instanceof Error) {
    parts.push(cause.message);
    cause = cause.cause;
  }
  return parts.join(" ");
}

export function isPaymentStillConfirmingError(error: unknown): boolean {
  const message = collectErrorText(error).toLowerCase();
  return (
    isBlockOutOfRangeError(error) ||
    message.includes("could not be found") ||
    message.includes("not be found") ||
    message.includes("not mined") ||
    message.includes("still confirming") ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("transaction receipt") ||
    message.includes("rate limit") ||
    message.includes("over rate limit") ||
    message.includes("missing or invalid parameters") ||
    message.includes("invalid parameters") ||
    message.includes("429") ||
    message.includes("503") ||
    message.includes("502") ||
    message.includes("network") ||
    message.includes("fetch failed")
  );
}

function isTransientReceiptError(error: unknown): boolean {
  return isPaymentStillConfirmingError(error);
}

/**
 * Fetch a receipt with polling + RPC rotation.
 * Prefer getTransactionReceipt over long waitForTransactionReceipt so public
 * RPC rate limits cannot stall Spark Refill / Infinite Spark confirmation.
 */
export async function getPaymentTransactionReceipt(
  txHash: Hash,
  chainId?: number | null
): Promise<TransactionReceipt> {
  if (isAvalancheRewardsChainId(chainId)) {
    let lastError: unknown;

    try {
      return await waitForAvalancheTransactionReceipt(txHash, {
        confirmations: 1,
        timeoutMs: 12_000,
      });
    } catch (error) {
      lastError = error;
      if (!isTransientReceiptError(error)) throw error;
    }

    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 800 + attempt * 400));
      resetAvalanchePublicClient();
      try {
        const receipt = await getAvalanchePublicClient().getTransactionReceipt({
          hash: txHash,
        });
        if (receipt) return receipt;
      } catch (err) {
        lastError = err;
        if (!isTransientReceiptError(err)) throw err;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(
          "Payment is still confirming on Avalanche. Wait a moment, then tap Confirm payment."
        );
  }

  let lastError: unknown;

  // Fast path: short wait on rotating public clients.
  try {
    return await waitForBaseTransactionReceipt(txHash, {
      confirmations: 1,
      timeoutMs: 12_000,
    });
  } catch (error) {
    lastError = error;
    if (!isTransientReceiptError(error)) throw error;
  }

  // Poll getTransactionReceipt across RPCs — cheaper than long eth_getLogs waits.
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 800 + attempt * 400));
    resetBasePublicClient();
    try {
      const receipt = await getBasePublicClient().getTransactionReceipt({
        hash: txHash,
      });
      if (receipt) return receipt;
    } catch (err) {
      lastError = err;
      if (!isTransientReceiptError(err)) throw err;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(
        "Payment is still confirming on Base. Wait a moment, then tap Confirm payment."
      );
}

export type StablePaymentToken = "USDC";

export interface VerifiedStablePayment {
  player: Address;
  token: StablePaymentToken;
  amount: bigint;
}

/**
 * Verify an EntryPaid payment tx against a SparkRefill-style contract.
 * Uses latest fee (not historical block) so pruned RPCs cannot fail the credit.
 */
export async function verifyEntryPaidPaymentTx(options: {
  walletAddress: string;
  txHash: Hash;
  contractAddress: Address;
  abi: Abi;
  usdcAddress: Address;
  contractLabel: string;
}): Promise<VerifiedStablePayment> {
  const { walletAddress, txHash, contractAddress, abi, usdcAddress, contractLabel } =
    options;

  const expectedPlayer = getAddress(walletAddress);
  const receipt = await getPaymentTransactionReceipt(txHash);

  if (receipt.status !== "success") {
    throw new Error("Transaction did not succeed.");
  }

  if (receipt.to?.toLowerCase() !== contractAddress.toLowerCase()) {
    throw new Error(`Transaction was not sent to ${contractLabel}.`);
  }

  // Prefer latest fee — historical block reads are slow / fail on many RPCs.
  const fee = await readBaseContractWithFailover<bigint>({
    address: contractAddress,
    abi,
    functionName: "fee",
  });

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== contractAddress.toLowerCase()) {
      continue;
    }

    try {
      const decoded = decodeEventLog({
        abi,
        data: log.data,
        topics: log.topics,
      });

      if (decoded.eventName !== "EntryPaid") continue;

      const args = decoded.args as unknown as {
        player: Address;
        token: Address;
        amount: bigint;
      };
      const { player, token, amount } = args;

      if (getAddress(player) !== expectedPlayer) {
        throw new Error("Payment wallet does not match your account.");
      }

      if (token.toLowerCase() !== usdcAddress.toLowerCase()) {
        throw new Error("Payment token is not USDC.");
      }

      if (amount < fee) {
        throw new Error("Payment amount is below the contract fee.");
      }

      return { player: expectedPlayer, token: "USDC", amount };
    } catch (error) {
      if (error instanceof Error && error.message.includes("Payment wallet")) {
        throw error;
      }
      if (error instanceof Error && error.message.includes("Payment token")) {
        throw error;
      }
      if (error instanceof Error && error.message.includes("Payment amount")) {
        throw error;
      }
    }
  }

  throw new Error("EntryPaid event not found in transaction.");
}
