/**
 * Lightweight ArcadeXTxHub sign_in verification for Cloudflare Workers.
 * Byte-scans the extrinsic for program id, purpose, signer, and SignIn route.
 */
import type { HexString } from "@/lib/shop-vara";
import {
  isValidVaraExtrinsicHash,
  normalizeVaraExtrinsicHash,
  VARA_RPC_URL,
} from "@/lib/shop-vara";
import { toVaraActorId } from "@/lib/vara-address";
import {
  assertVaraTxHubConfigured,
  playPurpose,
  purposeBytes,
  VARA_TX_HUB_SERVICE,
  VARA_TX_HUB_SIGN_IN_METHOD,
} from "@/lib/vara-tx-hub";
import { encodeTxHubSignInPayload } from "@/lib/vara-tx-hub-codec";
import { blake2b } from "@noble/hashes/blake2b";
import { compactToU8a, stringToU8a, u8aConcat } from "@polkadot/util";

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

function encodeScaleString(value: string): Uint8Array {
  const bytes = stringToU8a(value);
  return u8aConcat(compactToU8a(bytes.length), bytes);
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

export async function verifyVaraTxHubSignIn(params: {
  txHash: HexString | string;
  expectedFrom: string;
  gameId: string;
}): Promise<{ purpose: HexString; programId: HexString }> {
  const programIdHex = assertVaraTxHubConfigured();

  if (!isValidVaraExtrinsicHash(String(params.txHash))) {
    throw new Error("Invalid Vara extrinsic hash.");
  }

  const purpose = playPurpose(params.gameId);
  const expectedPayload = hexToBytes(encodeTxHubSignInPayload(purpose));
  const { extrinsicHex } = await waitForExtrinsic(params.txHash);
  const bytes = hexToBytes(extrinsicHex);

  const programId = hexToBytes(programIdHex.toLowerCase());
  if (!includesBytes(bytes, programId)) {
    throw new Error("Sign-in transaction does not target ArcadeXTxHub.");
  }

  const signerId = hexToBytes(toVaraActorId(params.expectedFrom));
  if (!includesBytes(bytes, signerId)) {
    throw new Error("Sign-in transaction signer mismatch.");
  }

  if (!includesBytes(bytes, purposeBytes(purpose))) {
    throw new Error("Sign-in transaction purpose mismatch.");
  }

  // Prefer full payload match; fall back to route prefixes (gas/encoding variants).
  if (!includesBytes(bytes, expectedPayload)) {
    const service = encodeScaleString(VARA_TX_HUB_SERVICE);
    const method = encodeScaleString(VARA_TX_HUB_SIGN_IN_METHOD);
    if (!includesBytes(bytes, service) || !includesBytes(bytes, method)) {
      throw new Error("Sign-in transaction method mismatch.");
    }
  }

  return {
    purpose,
    programId: programIdHex,
  };
}
