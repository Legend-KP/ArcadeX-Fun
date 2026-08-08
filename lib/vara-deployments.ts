import type { HexString } from "@/lib/shop-vara";

/**
 * Canonical Vara mainnet deployments.
 * Used as fallbacks when NEXT_PUBLIC_* is missing from the client bundle
 * (Cloudflare dashboard vars alone do not rewrite already-built browser JS).
 */
export const VARA_MAINNET_DEPLOYMENTS = {
  txHubProgramId:
    "0xa9a4530247fde6fa0839602d419086c9a643b766fc186b7fd0f7d637e776e16c" as HexString,
  txHubCodeId:
    "0x65ce4e85f8afd2b58a88f3f15423527d422f59b4bfcc50ab2761c4b9fdb12235" as HexString,
  sparkRefillProgramId:
    "0xfb4259a1f3b1e4998c6d014a78ff675f3c3f92fc8a4c7ce84eed096725802b5c" as HexString,
  sparkRefillCodeId:
    "0x74f24e3baba33420681a09035149d141fbb772226f5ee37e20b9b2b970ee99d7" as HexString,
  scoreSubmitProgramId:
    "0x21ec0adbdda70da6f4f752bf177cc0274cd6436a405b88906de2dcca757d3cfc" as HexString,
  infiniteSparkProgramId:
    "0x5ca7be0ecd8c43d41362917fd38b0c986caf165535550211a6c68a1a4d3f8cbf" as HexString,
  infiniteSparkCodeId:
    "0x549ce32e9f9888bc2a08ba109d24fe9309110a0f8f71fa93106b83080f7312ab" as HexString,
  /** Filled after Gear IDEA deploy of ArcadeXRewards lite. */
  arcadeXRewardsProgramId:
    "0x0000000000000000000000000000000000000000000000000000000000000000" as HexString,
  arcadeXRewardsCodeId:
    "0x0000000000000000000000000000000000000000000000000000000000000000" as HexString,
  streakCampaignId: 1,
  shuffleCampaignId: 2,
  wUsdc:
    "0xd1de816d7dce6439504552686ab333e5b7302b1549763656b30af1f8a5871b6a" as HexString,
  wUsdt:
    "0x4255ff4a87a4c13dc39f74ace8c4948bbef2f75fb639d66639a1cfcc99e6243e" as HexString,
  rpcUrl: "wss://rpc.vara.network",
} as const;

export function envProgramId(
  envValue: string | undefined,
  fallback: HexString
): HexString {
  const trimmed = envValue?.trim();
  if (trimmed && /^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
    return trimmed.toLowerCase() as HexString;
  }
  return fallback;
}
