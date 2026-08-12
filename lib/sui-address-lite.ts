/**
 * Lightweight Sui address helpers — avoids pulling `@mysten/sui` into the
 * Cloudflare Worker via every API that uses player-identity.
 */

const SUI_HEX_RE = /^(0x)?[0-9a-fA-F]{1,64}$/;

export function isValidSuiAddress(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  return SUI_HEX_RE.test(value.trim());
}

/** Normalize to canonical `0x` + 64 lowercase hex digits. */
export function normalizeSuiAddress(address: string): string {
  const trimmed = address.trim();
  if (!SUI_HEX_RE.test(trimmed)) {
    throw new Error("Invalid Sui wallet address");
  }
  const hex = (
    trimmed.startsWith("0x") || trimmed.startsWith("0X")
      ? trimmed.slice(2)
      : trimmed
  ).toLowerCase();
  return `0x${hex.padStart(64, "0")}`;
}
