/**
 * Vara address helpers: accept SS58 or 0x ActorId, normalize both forms.
 * Canonical storage form for playerId is lowercase 0x ActorId (32 bytes).
 */
import type { HexString } from "@/lib/shop-vara";
import { compactFromU8aLim, hexToU8a, u8aToHex } from "@polkadot/util";
import { decodeAddress, encodeAddress } from "@polkadot/util-crypto";

/** Vara Network SS58 prefix */
export const VARA_SS58_PREFIX = 137;

const ACTOR_ID_RE = /^0x[0-9a-fA-F]{64}$/;
const SS58_RE = /^[1-9A-HJ-NP-Za-km-z]{47,48}$/;

export function isVaraActorIdHex(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  return ACTOR_ID_RE.test(value.trim());
}

export function isVaraSs58Address(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  if (!SS58_RE.test(value.trim())) return false;
  try {
    decodeAddress(value.trim());
    return true;
  } catch {
    return false;
  }
}

export function isVaraWalletAddress(value: string | null | undefined): boolean {
  return isVaraActorIdHex(value) || isVaraSs58Address(value);
}

/** Canonical ActorId hex (lowercase 0x + 64 hex chars). */
export function toVaraActorId(address: string): HexString {
  const trimmed = address.trim();
  if (isVaraActorIdHex(trimmed)) {
    return trimmed.toLowerCase() as HexString;
  }
  if (!isVaraSs58Address(trimmed)) {
    throw new Error("Invalid Vara wallet address");
  }
  return u8aToHex(decodeAddress(trimmed)).toLowerCase() as HexString;
}

/** SS58 (prefix 137) for UI / wallet display. */
export function toVaraSs58(address: string): string {
  const actorId = toVaraActorId(address);
  return encodeAddress(hexToU8a(actorId), VARA_SS58_PREFIX);
}

export function normalizeVaraAddressPair(address: string): {
  actorId: HexString;
  ss58: string;
} {
  const actorId = toVaraActorId(address);
  return { actorId, ss58: toVaraSs58(actorId) };
}

/**
 * Canonical form for RTDB / playerId: lowercase ActorId hex.
 * Accepts either SS58 or 0x input.
 */
export function normalizeVaraCanonicalAddress(address: string): HexString {
  return toVaraActorId(address);
}

export function getVftPayloadDataOffset(payloadHex: HexString): number {
  const payload = hexToU8a(payloadHex);
  const [serviceOffset, serviceSize] = compactFromU8aLim(payload);
  const fnStart = serviceOffset + serviceSize;
  const [fnOffset, fnSize] = compactFromU8aLim(payload.subarray(fnStart));
  return fnStart + fnOffset + fnSize;
}
