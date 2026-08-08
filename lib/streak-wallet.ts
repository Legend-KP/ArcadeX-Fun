/**
 * Shared wallet helpers for streak/shuffle APIs across EVM + Vara.
 */
import {
  isEvmAddress,
  isVaraAddress,
  normalizeEvmAddress,
  normalizeVaraAddress,
} from "@/lib/player-identity";
import { isVaraRewardsChainId } from "@/lib/vara-rewards";

export function isStreakWalletAddress(
  chainId: number | null | undefined,
  value: string | null | undefined
): boolean {
  if (isVaraRewardsChainId(chainId)) {
    return isVaraAddress(value);
  }
  return isEvmAddress(value);
}

export function normalizeStreakWalletAddress(
  chainId: number | null | undefined,
  address: string
): string {
  if (isVaraRewardsChainId(chainId)) {
    return normalizeVaraAddress(address);
  }
  return normalizeEvmAddress(address);
}
