/**
 * ArcadeXRewards lite on Vara — program IDs, campaign defaults, chain sentinel.
 */
import type { HexString } from "@/lib/shop-vara";
import {
  VARA_MAINNET_DEPLOYMENTS,
  envProgramId,
} from "@/lib/vara-deployments";

/**
 * Synthetic chain id for streak/shuffle API routing (Vara has no EVM chainId).
 * Matches SS58 prefix 137 so it is memorable and collision-free with EVM ids.
 */
export const VARA_CHAIN_ID = 137;

export const VARA_REWARDS_EXPLORER_TX_URL =
  "https://vara.subscan.io/extrinsic";

export const VARA_ARCADEX_REWARDS_PROGRAM_ID: HexString = envProgramId(
  process.env.NEXT_PUBLIC_VARA_ARCADEX_REWARDS_PROGRAM,
  (VARA_MAINNET_DEPLOYMENTS.arcadeXRewardsProgramId ||
    "0x0000000000000000000000000000000000000000000000000000000000000000") as HexString
);

export const VARA_REWARDS_SERVICE = "ArcadeXRewards";
export const VARA_REWARDS_CHECK_IN_METHOD = "CheckIn";
export const VARA_REWARDS_SPIN_METHOD = "Spin";

export const VARA_STREAK_CAMPAIGN_ID = Number(
  process.env.NEXT_PUBLIC_VARA_STREAK_CAMPAIGN_ID?.trim() ||
    String(VARA_MAINNET_DEPLOYMENTS.streakCampaignId ?? 1)
);

export const VARA_SHUFFLE_CAMPAIGN_ID = Number(
  process.env.NEXT_PUBLIC_VARA_SHUFFLE_CAMPAIGN_ID?.trim() ||
    String(VARA_MAINNET_DEPLOYMENTS.shuffleCampaignId ?? 2)
);

export const VARA_CAMPAIGN_TYPE_STREAK = 0;
export const VARA_CAMPAIGN_TYPE_SHUFFLE = 1;
export const VARA_REWARD_OFFCHAIN = 0;

export function isVaraRewardsChainId(chainId?: number | null): boolean {
  return Number(chainId) === VARA_CHAIN_ID;
}

export function isVaraArcadeXRewardsConfigured(): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(VARA_ARCADEX_REWARDS_PROGRAM_ID) &&
    !/^0x0{64}$/i.test(VARA_ARCADEX_REWARDS_PROGRAM_ID);
}

export function assertVaraArcadeXRewardsConfigured(): HexString {
  if (!isVaraArcadeXRewardsConfigured()) {
    throw new Error(
      "Vara ArcadeXRewards program is not configured. Set NEXT_PUBLIC_VARA_ARCADEX_REWARDS_PROGRAM."
    );
  }
  return VARA_ARCADEX_REWARDS_PROGRAM_ID;
}
