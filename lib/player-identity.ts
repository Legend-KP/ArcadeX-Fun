import { getAddress, isAddress } from "viem";
import { isValidSuiAddress, normalizeSuiAddress } from "@mysten/sui/utils";
import {
  isVaraWalletAddress,
  normalizeVaraAddressPair,
  toVaraSs58,
} from "@/lib/vara-address";

export type WalletEcosystem =
  | "evm"
  | "starknet"
  | "sui"
  | "aptos"
  | "movement"
  | "stellar"
  | "vara";

const STARKNET_ADDRESS_RE = /^0x[0-9a-fA-F]{1,64}$/;
const APTOS_ADDRESS_RE = /^0x[0-9a-fA-F]{1,64}$/;
const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;

export function isEvmAddress(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  return isAddress(value.trim());
}

export function isStarknetAddress(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  return STARKNET_ADDRESS_RE.test(value.trim());
}

export function isSuiAddress(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  return isValidSuiAddress(value.trim());
}

export function isAptosAddress(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  return APTOS_ADDRESS_RE.test(value.trim());
}

export function isMovementAddress(value: string | null | undefined): boolean {
  return isAptosAddress(value);
}

export function isStellarAddress(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  return STELLAR_ADDRESS_RE.test(value.trim());
}

export function isVaraAddress(value: string | null | undefined): boolean {
  return isVaraWalletAddress(value);
}

export function normalizeEvmAddress(address: string): string {
  const trimmed = address.trim();
  if (!isAddress(trimmed)) {
    throw new Error("Invalid EVM wallet address");
  }
  return getAddress(trimmed);
}

export function normalizeStarknetAddress(address: string): string {
  const trimmed = address.trim();
  if (!isStarknetAddress(trimmed)) {
    throw new Error("Invalid Starknet wallet address");
  }
  return trimmed.toLowerCase();
}

export function normalizeSuiWalletAddress(address: string): string {
  const trimmed = address.trim();
  if (!isValidSuiAddress(trimmed)) {
    throw new Error("Invalid Sui wallet address");
  }
  return normalizeSuiAddress(trimmed);
}

export function normalizeAptosAddress(address: string): string {
  const trimmed = address.trim();
  if (!isAptosAddress(trimmed)) {
    throw new Error("Invalid Aptos wallet address");
  }
  return trimmed.toLowerCase();
}

export function normalizeMovementAddress(address: string): string {
  const trimmed = address.trim();
  if (!isMovementAddress(trimmed)) {
    throw new Error("Invalid Movement wallet address");
  }
  return trimmed.toLowerCase();
}

export function normalizeStellarAddress(address: string): string {
  const trimmed = address.trim();
  if (!isStellarAddress(trimmed)) {
    throw new Error("Invalid Stellar wallet address");
  }
  return trimmed;
}

/**
 * Canonical Vara address for playerId / RTDB: SS58 (prefix 137).
 * Accepts SS58 or ActorId hex; always re-encodes to Vara SS58.
 * Use `normalizeVaraAddressPair` when you also need the ActorId hex.
 */
export function normalizeVaraAddress(address: string): string {
  const trimmed = address.trim();
  if (!isVaraAddress(trimmed)) {
    throw new Error("Invalid Vara wallet address");
  }
  return toVaraSs58(trimmed);
}

export { normalizeVaraAddressPair };

export function normalizeAddress(
  ecosystem: WalletEcosystem,
  address: string
): string {
  switch (ecosystem) {
    case "evm":
      return normalizeEvmAddress(address);
    case "starknet":
      return normalizeStarknetAddress(address);
    case "sui":
      return normalizeSuiWalletAddress(address);
    case "aptos":
      return normalizeAptosAddress(address);
    case "movement":
      return normalizeMovementAddress(address);
    case "stellar":
      return normalizeStellarAddress(address);
    case "vara":
      return normalizeVaraAddress(address);
  }
}

export function isValidAddress(
  ecosystem: WalletEcosystem,
  address: string | null | undefined
): boolean {
  switch (ecosystem) {
    case "evm":
      return isEvmAddress(address);
    case "starknet":
      return isStarknetAddress(address);
    case "sui":
      return isSuiAddress(address);
    case "aptos":
      return isAptosAddress(address);
    case "movement":
      return isMovementAddress(address);
    case "stellar":
      return isStellarAddress(address);
    case "vara":
      return isVaraAddress(address);
  }
}

export function buildPlayerId(
  ecosystem: WalletEcosystem,
  address: string
): string {
  return `${ecosystem}:${normalizeAddress(ecosystem, address)}`;
}

export function parsePlayerId(
  id: string
): { ecosystem: WalletEcosystem; address: string } | null {
  const trimmed = id.trim();
  const colon = trimmed.indexOf(":");
  if (colon <= 0) return null;

  const ecosystem = trimmed.slice(0, colon) as WalletEcosystem;
  const address = trimmed.slice(colon + 1);

  if (!isValidAddress(ecosystem, address)) return null;

  return {
    ecosystem,
    address: normalizeAddress(ecosystem, address),
  };
}

export function tryParsePlayerId(
  id: string
): { ecosystem: WalletEcosystem; address: string } | null {
  try {
    return parsePlayerId(id);
  } catch {
    return null;
  }
}

/** Resolve API / storage id — accepts namespaced id or raw EVM/Vara address. */
export function resolvePlayerId(id: string): string | null {
  const parsed = tryParsePlayerId(id);
  if (parsed) return buildPlayerId(parsed.ecosystem, parsed.address);

  if (isEvmAddress(id)) {
    return buildPlayerId("evm", id);
  }
  if (isVaraAddress(id)) {
    return buildPlayerId("vara", id);
  }

  return null;
}

export function truncateAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 2) return address;
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}
