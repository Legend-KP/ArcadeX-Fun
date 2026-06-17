import { getAddress, isAddress } from "viem";

export type WalletEcosystem = "evm" | "starknet";

const STARKNET_ADDRESS_RE = /^0x[0-9a-fA-F]{1,64}$/;

export function isEvmAddress(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  return isAddress(value.trim());
}

export function isStarknetAddress(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  return STARKNET_ADDRESS_RE.test(value.trim());
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

export function normalizeAddress(
  ecosystem: WalletEcosystem,
  address: string
): string {
  return ecosystem === "evm"
    ? normalizeEvmAddress(address)
    : normalizeStarknetAddress(address);
}

export function isValidAddress(
  ecosystem: WalletEcosystem,
  address: string | null | undefined
): boolean {
  return ecosystem === "evm"
    ? isEvmAddress(address)
    : isStarknetAddress(address);
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

  if (ecosystem !== "evm" && ecosystem !== "starknet") return null;
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

/** Resolve API / storage id — accepts namespaced id or raw EVM address (legacy). */
export function resolvePlayerId(id: string): string | null {
  const parsed = tryParsePlayerId(id);
  if (parsed) return buildPlayerId(parsed.ecosystem, parsed.address);

  if (isEvmAddress(id)) {
    return buildPlayerId("evm", id);
  }

  return null;
}

export function truncateAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 2) return address;
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}
