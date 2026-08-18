/**
 * Bounded Vara extrinsic lookup for Cloudflare Workers.
 *
 * Never poll for long inside a Worker — each chain_getBlock is a subrequest.
 * Free plan caps at 50 external subrequests/invocation; paid defaults to 10k.
 * Client already waits until in-block; if the tx is not in the recent window,
 * throw "still confirming" so the client can retry the API.
 */
import { blake2b } from "@noble/hashes/blake2b";
import { normalizeVaraExtrinsicHash } from "@/lib/shop-vara";
import { varaJsonRpc } from "@/lib/vara-rpc-http";

/** Keep under Workers Free external subrequest budget (50), leaving room for RTDB. */
const MAX_BLOCKS_TO_SCAN = 24;

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

async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  return varaJsonRpc<T>(method, params);
}

/**
 * One-shot walk from best head (includes in-block, not-yet-finalized txs).
 * ~1 + MAX_BLOCKS_TO_SCAN RPC calls max.
 */
export async function findVaraExtrinsic(txHash: string): Promise<{
  blockHash: string;
  extrinsicHex: string;
}> {
  const normalized = normalizeVaraExtrinsicHash(txHash);

  // Prefer best head so in-block txs are visible before finalization.
  let hash =
    (await rpc<string | null>("chain_getHead").catch(() => null)) ??
    (await rpc<string>("chain_getFinalizedHead"));

  for (let i = 0; i < MAX_BLOCKS_TO_SCAN; i++) {
    const block = await rpc<{
      block: { extrinsics: string[]; header: { parentHash: string } };
    }>("chain_getBlock", [hash]);

    for (const extrinsicHex of block.block.extrinsics) {
      if (extrinsicHash(extrinsicHex).toLowerCase() === normalized) {
        return { blockHash: hash, extrinsicHex };
      }
    }

    hash = block.block.header.parentHash;
  }

  throw new Error(
    "Payment is still confirming on Vara. Wait a moment, then tap Confirm again."
  );
}
