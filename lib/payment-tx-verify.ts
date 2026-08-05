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
  resetBasePublicClient,
  isBlockOutOfRangeError,
  waitForBaseTransactionReceipt,
} from "@/lib/base-public-client";

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

function isTransientReceiptError(error: unknown): boolean {
  const message = collectErrorText(error).toLowerCase();
  return (
    isBlockOutOfRangeError(error) ||
    message.includes("could not be found") ||
    message.includes("not found") ||
    message.includes("timeout") ||
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("503") ||
    message.includes("502")
  );
}

/**
 * Fetch a receipt with long polling + RPC rotation.
 * Wallets often report "submitted" before public RPCs index the tx.
 */
export async function getPaymentTransactionReceipt(
  txHash: Hash
): Promise<TransactionReceipt> {
  try {
    return await waitForBaseTransactionReceipt(txHash, {
      confirmations: 1,
      timeoutMs: 90_000,
    });
  } catch (error) {
    // Final direct reads across rotated RPCs.
    let lastError: unknown = error;
    for (let attempt = 0; attempt < 6; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1_000 + attempt * 750));
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
  let fee: bigint;
  try {
    fee = (await getBasePublicClient().readContract({
      address: contractAddress,
      abi,
      functionName: "fee",
      blockTag: "latest",
    })) as bigint;
  } catch (error) {
    if (isBlockOutOfRangeError(error) || isTransientReceiptError(error)) {
      resetBasePublicClient();
      fee = (await getBasePublicClient().readContract({
        address: contractAddress,
        abi,
        functionName: "fee",
        blockTag: "latest",
      })) as bigint;
    } else {
      throw error;
    }
  }

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
