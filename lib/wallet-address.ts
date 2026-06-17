import {
  isEvmAddress,
  normalizeEvmAddress,
  resolvePlayerId,
} from "@/lib/player-identity";

/** @deprecated Use isEvmAddress or isValidAddress from player-identity */
export function isWalletAddress(value: string | null | undefined): boolean {
  return isEvmAddress(value);
}

/** @deprecated Use normalizeAddress from player-identity */
export function normalizeWalletAddress(address: string): string {
  return normalizeEvmAddress(address);
}

export function tryNormalizeWalletAddress(
  address: string | null | undefined
): string | null {
  if (!isEvmAddress(address)) return null;
  return normalizeEvmAddress(address!);
}

export function encodeUserId(userId: string): string {
  return encodeURIComponent(userId);
}

export function walletToFirestoreDocId(walletAddress: string): string {
  return normalizeEvmAddress(walletAddress);
}

export { resolvePlayerId };
