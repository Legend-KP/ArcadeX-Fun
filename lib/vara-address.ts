/**
 * Legacy Vara address helpers (SS58 / ActorId) for existing RTDB playerIds.
 * No @polkadot packages — lite SS58 only. Vara connect/play is disabled.
 */
import {
  decodeSs58Address,
  encodeSs58Address,
} from "@/lib/vara-ss58-lite";

export type HexString = `0x${string}`;

/** Vara Network SS58 prefix */
export const VARA_SS58_PREFIX = 137;

const ACTOR_ID_RE = /^0x[0-9a-fA-F]{64}$/;
const SS58_RE = /^[1-9A-HJ-NP-Za-km-z]{46,50}$/;
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function hexToU8a(value: string): Uint8Array {
  const hex = value.startsWith("0x") ? value.slice(2) : value;
  if (hex.length % 2 !== 0) throw new Error("Invalid hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function u8aToHex(bytes: Uint8Array): HexString {
  let hex = "0x";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return hex as HexString;
}

/** No-op — kept for existing callers. */
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

export function normalizeVaraCanonicalAddress(address: string): string {
  return toVaraSs58(address);
}
