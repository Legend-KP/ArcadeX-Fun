import {
  getChainKeyForEvmChainId,
  getChainRegistryEntry,
} from "@/lib/chain-registry";
import { getEvmChainById, primaryEvmChain } from "@/lib/chains";
import { WalletEcosystem } from "@/lib/player-identity";

export const WALLET_ECOSYSTEMS: readonly WalletEcosystem[] = [
  "evm",
  "starknet",
  "sui",
  "aptos",
  "movement",
  "stellar",
  "vara",
] as const;

export function isWalletEcosystem(value: string): value is WalletEcosystem {
  return (WALLET_ECOSYSTEMS as readonly string[]).includes(value);
}

const ECOSYSTEM_LABELS: Record<WalletEcosystem, string> = {
  evm: "EVM",
  starknet: "Starknet",
  sui: "Sui",
  aptos: "Aptos",
  movement: "Movement",
  stellar: "Stellar",
  vara: "Vara",
};

export function getEcosystemLabel(ecosystem: WalletEcosystem): string {
  return ECOSYSTEM_LABELS[ecosystem];
}

/** Human-readable network the user signed in on (e.g. Base, Avalanche, Vara). */
export function getConnectedChainLabel(
  ecosystem: WalletEcosystem | null | undefined,
  chainId?: number
): string {
  if (!ecosystem) return "Wallet";
  if (ecosystem === "evm") {
    if (chainId != null && Number.isFinite(chainId)) {
      const key = getChainKeyForEvmChainId(chainId);
      if (key) return getChainRegistryEntry(key).name;
      const chain = getEvmChainById(chainId);
      if (chain) return chain.name;
    }
    return primaryEvmChain.name;
  }
  return getEcosystemLabel(ecosystem);
}
