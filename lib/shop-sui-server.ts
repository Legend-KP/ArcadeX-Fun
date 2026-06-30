import { normalizeSuiAddress } from "@mysten/sui/utils";
import { getSuiRpcClient } from "@/lib/sui-rpc";
import {
  normalizeSuiTxDigest,
  SUI_SHOP_RECIPIENT_ADDRESS,
  SUI_USDC_COIN_TYPE,
} from "@/lib/shop-sui";
import {
  SHOP_PRODUCTS,
  SHOP_TOKEN_DECIMALS,
  shopPriceToAmount,
  type ShopProductId,
} from "@/lib/shop";

const RECEIPT_POLL_MS = 250;
const RECEIPT_MAX_WAIT_MS = 60_000;

function normalizeCoinType(coinType: string): string {
  return coinType.trim().toLowerCase();
}

function getBalanceChangeOwner(owner: unknown): string | null {
  if (!owner || typeof owner !== "object") return null;

  if ("AddressOwner" in owner && typeof owner.AddressOwner === "string") {
    return normalizeSuiAddress(owner.AddressOwner);
  }

  return null;
}

async function waitForSuiTransaction(digest: string) {
  const client = getSuiRpcClient();
  const normalizedDigest = normalizeSuiTxDigest(digest);
  const deadline = Date.now() + RECEIPT_MAX_WAIT_MS;

  while (Date.now() < deadline) {
    try {
      const tx = await client.getTransactionBlock({
        digest: normalizedDigest,
        options: {
          showEffects: true,
          showBalanceChanges: true,
        },
      });

      const status = tx.effects?.status?.status;
      if (status === "success") {
        return tx;
      }

      if (status === "failure") {
        throw new Error("Transaction failed on chain.");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (!message.toLowerCase().includes("not found")) {
        throw err;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, RECEIPT_POLL_MS));
  }

  throw new Error("Timed out waiting for transaction confirmation.");
}

export async function verifySuiShopPaymentTx(params: {
  txDigest: string;
  productId: ShopProductId;
  expectedFrom: string;
}): Promise<void> {
  const product = SHOP_PRODUCTS[params.productId];
  const requiredAmount = shopPriceToAmount(
    product.priceUsd,
    SHOP_TOKEN_DECIMALS
  );
  const recipient = SUI_SHOP_RECIPIENT_ADDRESS;
  const sender = normalizeSuiAddress(params.expectedFrom);
  const coinType = normalizeCoinType(SUI_USDC_COIN_TYPE);

  const tx = await waitForSuiTransaction(params.txDigest);
  const balanceChanges = tx.balanceChanges ?? [];

  let recipientCredit = BigInt(0);

  for (const change of balanceChanges) {
    if (normalizeCoinType(change.coinType) !== coinType) continue;

    const owner = getBalanceChangeOwner(change.owner);
    if (!owner) continue;

    const amount = BigInt(change.amount);
    if (owner === recipient && amount > BigInt(0)) {
      recipientCredit += amount;
    }

    if (owner === sender && amount < BigInt(0) && -amount < requiredAmount) {
      throw new Error("Payment transaction does not match the expected transfer.");
    }
  }

  if (recipientCredit < requiredAmount) {
    throw new Error("Payment transaction does not match the expected transfer.");
  }
}
