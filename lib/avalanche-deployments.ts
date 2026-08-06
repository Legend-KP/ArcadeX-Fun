import type { Address } from "viem";
import { envAddress } from "@/lib/base-deployments";

/**
 * Canonical Avalanche C-Chain (43114) deployments / shop config.
 * Wallet-to-wallet shop USDC goes to shopRecipient; streak uses arcadeXRewards.
 */
export const AVALANCHE_MAINNET_DEPLOYMENTS = {
  usdc: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
  shopRecipient: "0x4ed3105AEFA2Df36D411037f0f084638E1991710",
  arcadeXRewards: "0x978270D917D64da5DeD8030b05b3013642CD29DA",
  streakCampaignId: 1,
  shuffleCampaignId: 2,
} as const satisfies Record<string, string | number>;

export function avalancheEnvAddress(
  envValue: string | undefined,
  fallback: string
): Address {
  return envAddress(envValue, fallback);
}
