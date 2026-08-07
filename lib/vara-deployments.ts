import type { HexString } from "@/lib/shop-vara";

/**
 * Canonical Vara mainnet deployments.
 * Used as fallbacks when NEXT_PUBLIC_* is missing from the client bundle
 * (Cloudflare dashboard vars alone do not rewrite already-built browser JS).
 */
export const VARA_MAINNET_DEPLOYMENTS = {
  txHubProgramId:
    "0xa9a4530247fde6fa0839602d419086c9a643b766fc186b7fd0f7d637e776e16c" as HexString,
  codeId:
    "0x65ce4e85f8afd2b58a88f3f15423527d422f59b4bfcc50ab2761c4b9fdb12235" as HexString,
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
