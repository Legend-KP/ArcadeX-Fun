import {
  decodeEventLog,
  getAddress,
  type Hash,
} from "viem";
import {
  getPaymentTransactionReceipt,
  isPaymentStillConfirmingError,
} from "@/lib/payment-tx-verify";
import { verifySparkRefillPaymentTx } from "@/lib/spark-refill-verify";
import { verifyInfiniteSparkPaymentTx } from "@/lib/infinite-spark-verify";
import {
  isInfiniteSparkConfigured,
} from "@/lib/infinite-spark";
import {
  isSparkRefillConfigured,
} from "@/lib/spark-refill";
import {
  erc20Abi,
  findShopPaymentToken,
  SHOP_PRODUCTS,
  SHOP_RECIPIENT_ADDRESS,
  SHOP_TOKEN_DECIMALS,
  shopPriceToAmount,
  type ShopProductId,
} from "@/lib/shop";

/**
 * Verify a Base shop payment.
 * Prefers EntryPaid from SparkRefill / InfiniteSpark (current UI path).
 * Falls back to legacy USDC transfer → shop recipient for older txs.
 */
export async function verifyShopPaymentTx(params: {
  txHash: Hash;
  productId: ShopProductId;
  tokenAddress: `0x${string}`;
  expectedFrom: string;
  overrideAmount?: bigint;
  /** Skip EntryPaid contract checks — used by legacy score-submit transfer path. */
  legacyTransferOnly?: boolean;
}): Promise<void> {
  const token = findShopPaymentToken(params.tokenAddress);
  if (!token) {
    throw new Error("Unsupported payment token.");
  }

  if (!params.legacyTransferOnly) {
    if (params.productId === "spark-refill" && isSparkRefillConfigured()) {
      try {
        await verifySparkRefillPaymentTx(params.expectedFrom, params.txHash);
        return;
      } catch (err) {
        // Receipt not indexed yet — bubble up so the client can retry.
        if (isPaymentStillConfirmingError(err)) throw err;
        // Fall through to legacy transfer verification.
      }
    }

    if (params.productId === "infinite-24h" && isInfiniteSparkConfigured()) {
      try {
        await verifyInfiniteSparkPaymentTx(params.expectedFrom, params.txHash);
        return;
      } catch (err) {
        if (isPaymentStillConfirmingError(err)) throw err;
        // Fall through to legacy transfer verification.
      }
    }
  }

  const receipt = await getPaymentTransactionReceipt(params.txHash);

  if (receipt.status !== "success") {
    throw new Error("Transaction failed on chain.");
  }

  const product = SHOP_PRODUCTS[params.productId];
  const requiredAmount =
    params.overrideAmount ??
    shopPriceToAmount(product.priceUsd, SHOP_TOKEN_DECIMALS);
  const recipient = getAddress(SHOP_RECIPIENT_ADDRESS);
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
    throw new Error("Payment transaction does not match the expected transfer.");
  }
}
