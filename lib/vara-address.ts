/**
 * Vara address helpers: accept SS58 or 0x ActorId, normalize both forms.
 * Canonical playerId form: Vara SS58 (prefix 137) when encoding works; otherwise
 * the wallet-provided SS58 (SubWallet often uses generic prefix 42).
 */
import type { HexString } from "@/lib/shop-vara";
import { compactFromU8aLim, hexToU8a, u8aToHex } from "@polkadot/util";
import {
  cryptoWaitReady,
  decodeAddress,
  encodeAddress,
} from "@polkadot/util-crypto";

/** Vara Network SS58 prefix */
export const VARA_SS58_PREFIX = 137;

const ACTOR_ID_RE = /^0x[0-9a-fA-F]{64}$/;
/** Substrate SS58 lengths vary slightly by prefix / format. */
const SS58_RE = /^[1-9A-HJ-NP-Za-km-z]{46,50}$/;
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

let cryptoReadyPromise: Promise<boolean> | null = null;

/** Call before decode/encode on the client (and once on server if needed). */
export function ensureVaraCryptoReady(): Promise<boolean> {
  if (!cryptoReadyPromise) {
    cryptoReadyPromise = cryptoWaitReady();
  }
  return cryptoReadyPromise;
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
    decodeAddress(trimmed);
    return true;
  } catch {
    // Regex match is enough when wasm crypto is not initialized yet (Workers / first paint).
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
    return u8aToHex(decodeAddress(trimmed)).toLowerCase() as HexString;
  } catch {
    throw new Error("Invalid Vara wallet address");
  }
}

/** SS58 (prefix 137) for UI / on-chain display when encoding is available. */
export function toVaraSs58(address: string): string {
  const trimmed = address.trim();
  if (isVaraActorIdHex(trimmed)) {
    try {
      return encodeAddress(hexToU8a(trimmed), VARA_SS58_PREFIX);
    } catch {
      throw new Error("Invalid Vara wallet address");
    }
  }
  if (!SS58_RE.test(trimmed) || isLikelyEvmAddress(trimmed)) {
    throw new Error("Invalid Vara wallet address");
  }
  try {
    return encodeAddress(decodeAddress(trimmed), VARA_SS58_PREFIX);
  } catch {
    // Keep SubWallet / Polkadot.js original SS58 if re-encode is unavailable.
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
