import {
  decodeEventLog,
  getAddress,
  type Hash,
} from "viem";
import {
  getAvalanchePublicClient,
  resetAvalanchePublicClient,
  waitForAvalancheTransactionReceipt,
} from "@/lib/avalanche-public-client";
import { isPaymentStillConfirmingError } from "@/lib/payment-tx-verify";
import { erc20Abi, type ShopProductId } from "@/lib/shop";
import {
  AVALANCHE_SHOP_RECIPIENT_ADDRESS,
  AVALANCHE_SHOP_TOKEN_DECIMALS,
  avalancheShopAmountForProduct,
  findAvalancheShopPaymentToken,
} from "@/lib/shop-avalanche";
import { scoreSubmitPriceToAmount } from "@/lib/score-submit";

async function getAvalanchePaymentReceipt(txHash: Hash) {
  let lastError: unknown;

  try {
    return await waitForAvalancheTransactionReceipt(txHash, {
      confirmations: 1,
      timeoutMs: 12_000,
    });
  } catch (error) {
    lastError = error;
    if (!isPaymentStillConfirmingError(error)) throw error;
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
      if (!isPaymentStillConfirmingError(err)) throw err;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(
        "Payment is still confirming on Avalanche. Wait a moment, then tap Confirm payment."
      );
}

/**
 * Verify a wallet→wallet USDC Transfer on Avalanche C-Chain
 * to the ArcadeX shop recipient for the expected amount.
 */
export async function verifyAvalancheShopPaymentTx(params: {
  txHash: Hash;
  productId: ShopProductId;
  tokenAddress: `0x${string}`;
  expectedFrom: string;
  overrideAmount?: bigint;
}): Promise<void> {
  const token = findAvalancheShopPaymentToken(params.tokenAddress);
  if (!token) {
    throw new Error("Unsupported Avalanche payment token.");
  }

  const receipt = await getAvalanchePaymentReceipt(params.txHash);

  if (receipt.status !== "success") {
    throw new Error("Transaction failed on Avalanche.");
  }

  const requiredAmount =
    params.overrideAmount ?? avalancheShopAmountForProduct(params.productId);
  const recipient = getAddress(AVALANCHE_SHOP_RECIPIENT_ADDRESS);
  const from = getAddress(params.expectedFrom);
  const tokenAddress = getAddress(token.address);

  let matched = false;

  for (const log of receipt.logs) {
    if (getAddress(log.address) !== tokenAddress) continue;

    try {
      const decoded = decodeEventLog({
        abi: erc20Abi,
        data: log.data,
        topics: log.topics,
        eventName: "Transfer",
      });

      if (
        getAddress(decoded.args.from) === from &&
        getAddress(decoded.args.to) === recipient &&
        decoded.args.value >= requiredAmount
      ) {
        matched = true;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!matched) {
    throw new Error(
      "Payment transaction does not match the expected Avalanche USDC transfer."
    );
  }
}

export async function verifyAvalancheScoreSubmitPayment(params: {
  txHash: Hash;
  tokenAddress: `0x${string}`;
  expectedFrom: string;
}): Promise<void> {
  await verifyAvalancheShopPaymentTx({
    txHash: params.txHash,
    productId: "spark-refill",
    tokenAddress: params.tokenAddress,
    expectedFrom: params.expectedFrom,
    overrideAmount: scoreSubmitPriceToAmount(),
  });
}

export { AVALANCHE_SHOP_TOKEN_DECIMALS };
