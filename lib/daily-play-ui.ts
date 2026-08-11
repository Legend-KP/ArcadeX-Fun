import {
  AVALANCHE_CHAIN_ID,
  isAvalancheRewardsChainId,
} from "@/lib/arcadex-rewards";
import { PRIMARY_EVM_CHAIN_ID } from "@/lib/chains";
import {
  isVaraRewardsChainId,
  VARA_CHAIN_ID,
} from "@/lib/vara-rewards";

export type DailyPlayNetworkCopy = {
  chainId: number;
  label: string;
  explorerName: string;
  gasHint: string;
};

/** UI copy for the daily streak / shuffle ceremony on each rewards network. */
export function getDailyPlayNetworkCopy(
  chainId?: number | null
): DailyPlayNetworkCopy {
  if (isVaraRewardsChainId(chainId)) {
    return {
      chainId: VARA_CHAIN_ID,
      label: "Vara",
      explorerName: "Subscan",
      gasHint: "Approve in SubWallet (VARA for gas)",
    };
  }
  if (isAvalancheRewardsChainId(chainId)) {
    return {
      chainId: AVALANCHE_CHAIN_ID,
      label: "Avalanche",
      explorerName: "Snowtrace",
      gasHint: "Non-fee check-in · AVAX for gas",
    };
  }
  return {
    chainId: PRIMARY_EVM_CHAIN_ID,
    label: "Base",
    explorerName: "Basescan",
    gasHint: "Non-fee check-in · ETH for gas",
  };
}
