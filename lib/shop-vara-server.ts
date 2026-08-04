/**
 * Vara shop payment verification is disabled on the Cloudflare Worker build
 * to stay under the free 3 MiB size limit (@polkadot/api + @gear-js/api type
 * metadata alone exceed the budget). Client Vara UX remains; server verify
 * returns a clear error. Use Base USDC or Sui for shop payments on this deploy.
 */
import type { Hash } from "viem";
import type { ShopProductId } from "@/lib/shop";

export async function verifyVaraShopPaymentTx(_params: {
  txHash: Hash;
  productId: ShopProductId;
  tokenProgramId: string;
  expectedFrom: string;
  overrideAmount?: bigint;
}): Promise<void> {
  throw new Error(
    "Vara shop payments are temporarily unavailable on this deployment. Pay with Base USDC or Sui instead."
  );
}
