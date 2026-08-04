/**
 * Lightweight Vara payment verification for Cloudflare Workers.
 * Uses public HTTP RPC (no @polkadot/api / @gear-js) so the Worker stays
 * under the free 3 MiB limit. Full Gear UX runs in the browser.
 */
import { blake2b } from "@noble/hashes/blake2b";
import type { HexString } from "@/lib/shop-vara";
import {
  normalizeVaraExtrinsicHash,
  VARA_SHOP_RECIPIENT_ADDRESS,
  VARA_RPC_URL,
} from "@/lib/shop-vara";
import {
  SHOP_PRODUCTS,
  shopPriceToAmount,
  SHOP_TOKEN_DECIMALS,
  type ShopProductId,
} from "@/lib/shop";
import { toVaraActorId } from "@/lib/vara-address";

const RECEIPT_POLL_MS = 400;
const RECEIPT_MAX_WAIT_MS = 60_000;
const HTTP_RPC = VARA_RPC_URL.replace(/^wss:/, "https:").replace(/^ws:/, "http:");

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;
}

function extrinsicHash(extrinsicHex: string): string {
  return bytesToHex(blake2b(hexToBytes(extrinsicHex), { dkLen: 32 }));
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

async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(HTTP_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) {
    throw new Error(`Vara RPC HTTP ${res.status}`);
  }
  const json = (await res.json()) as { result?: T; error?: { message?: string } };
  if (json.error) {
    throw new Error(json.error.message || "Vara RPC error");
  }
  return json.result as T;
}

async function findExtrinsicInRecentBlocks(
  txHash: string,
  maxBlocks = 120
): Promise<{ blockHash: string; extrinsicHex: string }> {
  let hash = await rpc<string>("chain_getFinalizedHead");

  for (let i = 0; i < maxBlocks; i++) {
    const block = await rpc<{
      block: { extrinsics: string[]; header: { parentHash: string } };
    }>("chain_getBlock", [hash]);

    for (const extrinsicHex of block.block.extrinsics) {
      if (extrinsicHash(extrinsicHex).toLowerCase() === txHash) {
        return { blockHash: hash, extrinsicHex };
      }
    }

    hash = block.block.header.parentHash;
  }

  throw new Error("Timed out waiting for transaction confirmation.");
}

async function waitForExtrinsic(txHash: string): Promise<{
  blockHash: string;
  extrinsicHex: string;
}> {
  const deadline = Date.now() + RECEIPT_MAX_WAIT_MS;
  const normalized = normalizeVaraExtrinsicHash(txHash);

  while (Date.now() < deadline) {
    try {
      return await findExtrinsicInRecentBlocks(normalized, 12);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (!message.includes("Timed out waiting")) throw err;
    }
    await new Promise((r) => setTimeout(r, RECEIPT_POLL_MS));
  }

  throw new Error("Timed out waiting for transaction confirmation.");
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

  const { extrinsicHex } = await waitForExtrinsic(params.txHash);
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
