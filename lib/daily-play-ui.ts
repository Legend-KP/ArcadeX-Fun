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

/** Block explorer URL for a daily check-in transaction hash. */
export function getDailyCheckInTxExplorerUrl(
  chainId: number | null | undefined,
  txHash: string
): string | null {
  if (!txHash || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) return null;
  if (isVaraRewardsChainId(chainId)) {
    return `https://vara.subscan.io/extrinsic/${txHash}`;
  }
  if (isAvalancheRewardsChainId(chainId)) {
    return `https://snowtrace.io/tx/${txHash}`;
  }
  return `https://basescan.org/tx/${txHash}`;
}

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
