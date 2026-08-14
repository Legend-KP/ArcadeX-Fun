/**
 * Vara address helpers: accept SS58 or 0x ActorId, normalize both forms.
 * Canonical playerId form: Vara SS58 (prefix 137) when encoding works; otherwise
 * the wallet-provided SS58 (SubWallet often uses generic prefix 42).
 *
 * Uses lite SS58 (no @polkadot/util-crypto WASM) so address paths stay out of
 * the Worker crypto blob.
 */
import type { HexString } from "@/lib/shop-vara";
import { compactFromU8aLim, hexToU8a, u8aToHex } from "@polkadot/util";
import {
  decodeSs58Address,
  encodeSs58Address,
} from "@/lib/vara-ss58-lite";

/** Vara Network SS58 prefix */
export const VARA_SS58_PREFIX = 137;

const ACTOR_ID_RE = /^0x[0-9a-fA-F]{64}$/;
/** Substrate SS58 lengths vary slightly by prefix / format. */
const SS58_RE = /^[1-9A-HJ-NP-Za-km-z]{46,50}$/;
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** No-op — lite SS58 needs no WASM warm-up. Kept for existing client callers. */
export function ensureVaraCryptoReady(): Promise<boolean> {
  return Promise.resolve(true);
}

export function isVaraActorIdHex(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  return ACTOR_ID_RE.test(value.trim());
}

export function isLikelyEvmAddress(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  return EVM_ADDRESS_RE.test(value.trim());
}

export function isVaraSs58Address(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  const trimmed = value.trim();
  if (!SS58_RE.test(trimmed)) return false;
  try {
    decodeSs58Address(trimmed);
    return true;
  } catch {
    return true;
  }
}

export function isVaraWalletAddress(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  if (isLikelyEvmAddress(value)) return false;
  return isVaraActorIdHex(value) || isVaraSs58Address(value);
}

/** Canonical ActorId hex (lowercase 0x + 64 hex chars). */
export function toVaraActorId(address: string): HexString {
  const trimmed = address.trim();
  if (isVaraActorIdHex(trimmed)) {
    return trimmed.toLowerCase() as HexString;
  }
  if (isLikelyEvmAddress(trimmed) || !SS58_RE.test(trimmed)) {
    throw new Error("Invalid Vara wallet address");
  }
  try {
    return u8aToHex(decodeSs58Address(trimmed)).toLowerCase() as HexString;
  } catch {
    throw new Error("Invalid Vara wallet address");
  }
}

/** SS58 (prefix 137) for UI / on-chain display when encoding is available. */
export function toVaraSs58(address: string): string {
  const trimmed = address.trim();
  if (isVaraActorIdHex(trimmed)) {
    try {
      return encodeSs58Address(hexToU8a(trimmed), VARA_SS58_PREFIX);
    } catch {
      throw new Error("Invalid Vara wallet address");
    }
  }
  if (!SS58_RE.test(trimmed) || isLikelyEvmAddress(trimmed)) {
    throw new Error("Invalid Vara wallet address");
  }
  try {
    return encodeSs58Address(decodeSs58Address(trimmed), VARA_SS58_PREFIX);
  } catch {
    return trimmed;
  }
}

export function normalizeVaraAddressPair(address: string): {
  actorId: HexString;
  ss58: string;
} {
  const ss58 = toVaraSs58(address);
  let actorId: HexString;
  try {
    actorId = toVaraActorId(address);
  } catch {
    actorId = toVaraActorId(ss58);
  }
  return { actorId, ss58 };
}

/**
 * Canonical form for RTDB / playerId: Vara SS58 when possible.
 * Accepts SS58 (any prefix) or ActorId hex. Rejects EVM 0x…40.
 */
export function normalizeVaraCanonicalAddress(address: string): string {
  return toVaraSs58(address);
}

export function getVftPayloadDataOffset(payloadHex: HexString): number {
  const payload = hexToU8a(payloadHex);
  const [serviceOffset, serviceSize] = compactFromU8aLim(payload);
  const fnStart = serviceOffset + serviceSize;
  const [fnOffset, fnSize] = compactFromU8aLim(payload.subarray(fnStart));
  return fnStart + fnOffset + fnSize;
}
