/**
 * Lightweight Vara payment verification for Cloudflare Workers.
 * Uses public HTTP RPC (no @polkadot/api / @gear-js) so the Worker stays
 * under the free 3 MiB limit. Full Gear UX runs in the browser.
 */
import type { HexString } from "@/lib/shop-vara";
import {
  VARA_SHOP_RECIPIENT_ADDRESS,
} from "@/lib/shop-vara";
import {
  SHOP_PRODUCTS,
  shopPriceToAmount,
  SHOP_TOKEN_DECIMALS,
  type ShopProductId,
} from "@/lib/shop";
import { toVaraActorId } from "@/lib/vara-address";
import { findVaraExtrinsic } from "@/lib/vara-extrinsic-lookup";

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function u256ToBytesLE(value: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let v = value;
  for (let i = 0; i < 32; i++) {
    out[i] = Number(v & BigInt(0xff));
    v >>= BigInt(8);
  }
  return out;
}

function includesBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

export async function verifyVaraShopPaymentTx(params: {
  txHash: HexString | string;
  productId: ShopProductId;
  tokenProgramId: HexString | string;
  expectedFrom: string;
  overrideAmount?: bigint;
}): Promise<void> {
  if (!VARA_SHOP_RECIPIENT_ADDRESS) {
    throw new Error("Vara shop recipient is not configured.");
  }

  const { extrinsicHex } = await findVaraExtrinsic(params.txHash);
  const bytes = hexToBytes(extrinsicHex);

  const programId = hexToBytes(params.tokenProgramId.toLowerCase());
  const recipient = hexToBytes(toVaraActorId(VARA_SHOP_RECIPIENT_ADDRESS));
  const product = SHOP_PRODUCTS[params.productId];
  const requiredAmount =
    params.overrideAmount ??
    shopPriceToAmount(product.priceUsd, SHOP_TOKEN_DECIMALS);
  const amountBytes = u256ToBytesLE(requiredAmount);

  // gear.sendMessage + VFT Transfer encode program id, recipient, and amount
  // into the signed extrinsic body. Presence of all three in a finalized
  // extrinsic with the expected hash is sufficient for shop settlement.
  if (!includesBytes(bytes, programId)) {
    throw new Error("Payment transaction does not match the expected transfer.");
  }
  if (!includesBytes(bytes, recipient)) {
    throw new Error("Payment transaction does not match the expected transfer.");
  }
  if (!includesBytes(bytes, amountBytes)) {
    throw new Error("Payment transaction does not match the expected transfer.");
  }

  // Signer address (SS58) also appears as AccountId bytes in the extrinsic.
  const signerId = hexToBytes(toVaraActorId(params.expectedFrom));
  if (!includesBytes(bytes, signerId)) {
    throw new Error("Payment transaction does not match the expected transfer.");
  }
}
