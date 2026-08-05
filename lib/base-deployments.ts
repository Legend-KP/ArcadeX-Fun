import type { Address } from "viem";

/**
 * Canonical Base mainnet (8453) deployments.
 * Used as fallbacks when NEXT_PUBLIC_* is missing from the client bundle
 * (Cloudflare dashboard vars alone do not rewrite already-built browser JS).
 */
export const BASE_MAINNET_DEPLOYMENTS = {
  usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  shopRecipient: "0x11015f39Ac7389201aEc778Be8e3D84f2aF44A70",
  arcadeXRewards: "0xa3ff9C5f592e2891279b83f9017C00733A3F19fC",
  sparkRefill: "0xfB01e841E1bF81b44048b9a219f55F7f3BAF7E0C",
  infiniteSpark: "0xe179550c0b745591ae0113d97eB072129e14F75f",
  scoreSubmit: "0xf0E45525FCC4716eFa65f24318b1Ea1A8f567333",
  streakCampaignId: 1,
  shuffleCampaignId: 2,
} as const satisfies Record<string, string | number>;

export function envAddress(
  envValue: string | undefined,
  fallback: string
): Address {
  const trimmed = envValue?.trim();
  if (
    trimmed &&
    trimmed !== "0x0000000000000000000000000000000000000000"
  ) {
    return trimmed as Address;
  }
  return fallback as Address;
}
