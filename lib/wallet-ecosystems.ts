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
