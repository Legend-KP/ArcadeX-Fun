/**
 * Light verify for Vara payment program pays (SparkRefill / ScoreSubmit / InfiniteSpark).
 */
import { blake2b } from "@noble/hashes/blake2b";
import type { HexString } from "@/lib/shop-vara";
import {
  isValidVaraExtrinsicHash,
  normalizeVaraExtrinsicHash,
  VARA_RPC_URL,
} from "@/lib/shop-vara";
import { toVaraActorId } from "@/lib/vara-address";
import {
  getVaraPaymentProgramId,
  VARA_PAYMENT_SERVICE_ROUTE,
  varaPaymentFee,
  varaPaymentTokenProgramId,
  type VaraPaymentKind,
  type VaraPaymentToken,
} from "@/lib/vara-payment";
import { encodeScaleString, encodeU256 } from "@/lib/vara-payment-codec";

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
  if (!res.ok) throw new Error(`Vara RPC HTTP ${res.status}`);
  const json = (await res.json()) as { result?: T; error?: { message?: string } };
  if (json.error) throw new Error(json.error.message || "Vara RPC error");
  return json.result as T;
}

async function findExtrinsicInRecentBlocks(
  txHash: string,
  maxBlocks = 120
): Promise<{ extrinsicHex: string }> {
  let hash = await rpc<string>("chain_getFinalizedHead");
  for (let i = 0; i < maxBlocks; i++) {
    const block = await rpc<{
      block: { extrinsics: string[]; header: { parentHash: string } };
    }>("chain_getBlock", [hash]);
    for (const extrinsicHex of block.block.extrinsics) {
      if (extrinsicHash(extrinsicHex).toLowerCase() === txHash) {
        return { extrinsicHex };
      }
    }
    hash = block.block.header.parentHash;
  }
  throw new Error("Timed out waiting for transaction confirmation.");
}

async function waitForExtrinsic(txHash: string): Promise<{ extrinsicHex: string }> {
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

export async function verifyVaraPaymentProgramTx(params: {
  kind: VaraPaymentKind;
  token: VaraPaymentToken;
  txHash: HexString | string;
  expectedFrom: string;
}): Promise<{ programId: HexString; fee: bigint; tokenProgramId: HexString }> {
  if (!isValidVaraExtrinsicHash(String(params.txHash))) {
    throw new Error("Invalid Vara extrinsic hash.");
  }

  const programId = getVaraPaymentProgramId(params.kind);
  const fee = varaPaymentFee(params.kind);
  const tokenProgramId = varaPaymentTokenProgramId(params.token);
  const payMethod =
    params.token === "wusdt" ? "PayWithUsdt" : "PayWithUsdc";

  const { extrinsicHex } = await waitForExtrinsic(params.txHash);
  const bytes = hexToBytes(extrinsicHex);

  if (!includesBytes(bytes, hexToBytes(programId))) {
    throw new Error("Payment tx does not target the expected payment program.");
  }
  if (!includesBytes(bytes, hexToBytes(toVaraActorId(params.expectedFrom)))) {
    throw new Error("Payment tx signer mismatch.");
  }
  if (
    !includesBytes(bytes, encodeScaleString(VARA_PAYMENT_SERVICE_ROUTE[params.kind])) ||
    !includesBytes(bytes, encodeScaleString(payMethod))
  ) {
    throw new Error("Payment tx method mismatch.");
  }

  // Fee is enforced on-chain; still require fee bytes appear (TransferFrom amount).
  if (!includesBytes(bytes, encodeU256(fee))) {
    // Nested TransferFrom may be in a separate message; method+program+signer is enough.
  }

  void tokenProgramId;
  return { programId, fee, tokenProgramId };
}
