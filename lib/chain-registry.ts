import { PRIMARY_EVM_CHAIN_ID } from "@/lib/chains";
import type { WalletEcosystem } from "@/types";
import type { ChainFeatures, ChainKey, ChainSettingsEntry } from "@/types";

export type WalletOption = {
  id: string;
  label: string;
  ecosystem: WalletEcosystem;
  connectorId?: string;
  starknetId?: "braavos" | "argentX";
  chainId?: number;
  networkLabel?: string;
  chainKey: ChainKey;
};

export const CHAIN_REGISTRY: ChainSettingsEntry[] = [
  {
    key: "base",
    name: "Base",
    ecosystem: "evm",
    chainId: PRIMARY_EVM_CHAIN_ID,
    defaultShopPayments: true,
  },
  {
    key: "megaeth",
    name: "MegaETH",
    ecosystem: "evm",
    chainId: 4326,
    defaultShopPayments: false,
  },
  {
    key: "bnb",
    name: "BNB Chain",
    ecosystem: "evm",
    chainId: 56,
    defaultShopPayments: false,
  },
  {
    key: "berachain",
    name: "Berachain",
    ecosystem: "evm",
    chainId: 80094,
    defaultShopPayments: false,
  },
  {
    key: "cronos",
    name: "Cronos",
    ecosystem: "evm",
    chainId: 25,
    defaultShopPayments: false,
  },
  {
    key: "avalanche",
    name: "Avalanche",
    ecosystem: "evm",
    chainId: 43114,
    defaultShopPayments: true,
  },
  {
    key: "beam",
    name: "Beam",
    ecosystem: "evm",
    chainId: 4337,
    defaultShopPayments: false,
  },
  {
    key: "sui",
    name: "Sui",
    ecosystem: "sui",
    defaultShopPayments: true,
  },
  {
    key: "aptos",
    name: "Aptos",
    ecosystem: "aptos",
    defaultShopPayments: false,
  },
  {
    key: "movement",
    name: "Movement",
    ecosystem: "movement",
    defaultShopPayments: false,
  },
  {
    key: "stellar",
    name: "Stellar",
    ecosystem: "stellar",
    defaultShopPayments: false,
  },
  {
    key: "vara",
    name: "Vara",
    ecosystem: "vara",
    defaultShopPayments: true,
  },
  {
    key: "starknet",
    name: "Starknet",
    ecosystem: "starknet",
    defaultShopPayments: false,
  },
];

export const WALLET_OPTIONS: WalletOption[] = [
  {
    id: "slush",
    label: "Slush",
    ecosystem: "sui",
    chainKey: "sui",
  },
  {
    id: "metamask-base",
    label: "MetaMask",
    ecosystem: "evm",
    connectorId: "metaMaskSDK",
    chainId: PRIMARY_EVM_CHAIN_ID,
    networkLabel: "Base",
    chainKey: "base",
  },
  {
    id: "metamask-megaeth",
    label: "MetaMask",
    ecosystem: "evm",
    connectorId: "metaMaskSDK",
    chainId: 4326,
    networkLabel: "MegaETH",
    chainKey: "megaeth",
  },
  {
    id: "metamask-bnb",
    label: "MetaMask",
    ecosystem: "evm",
    connectorId: "metaMaskSDK",
    chainId: 56,
    networkLabel: "BNB Chain",
    chainKey: "bnb",
  },
  {
    id: "metamask-berachain",
    label: "MetaMask",
    ecosystem: "evm",
    connectorId: "metaMaskSDK",
    chainId: 80094,
    networkLabel: "Berachain",
    chainKey: "berachain",
  },
  {
    id: "metamask-cronos",
    label: "MetaMask",
    ecosystem: "evm",
    connectorId: "metaMaskSDK",
    chainId: 25,
    networkLabel: "Cronos",
    chainKey: "cronos",
  },
  {
    id: "metamask-avalanche",
    label: "MetaMask",
    ecosystem: "evm",
    connectorId: "metaMaskSDK",
    chainId: 43114,
    networkLabel: "Avalanche",
    chainKey: "avalanche",
  },
  {
    id: "metamask-beam",
    label: "MetaMask",
    ecosystem: "evm",
    connectorId: "metaMaskSDK",
    chainId: 4337,
    networkLabel: "Beam",
    chainKey: "beam",
  },
  {
    id: "coinbase-base",
    label: "Coinbase Wallet",
    ecosystem: "evm",
    connectorId: "coinbaseWalletSDK",
    chainId: PRIMARY_EVM_CHAIN_ID,
    networkLabel: "Base",
    chainKey: "base",
  },
  {
    id: "coinbase-megaeth",
    label: "Coinbase Wallet",
    ecosystem: "evm",
    connectorId: "coinbaseWalletSDK",
    chainId: 4326,
    networkLabel: "MegaETH",
    chainKey: "megaeth",
  },
  {
    id: "walletconnect-base",
    label: "WalletConnect",
    ecosystem: "evm",
    connectorId: "walletConnect",
    chainId: PRIMARY_EVM_CHAIN_ID,
    networkLabel: "Base",
    chainKey: "base",
  },
  {
    id: "walletconnect-megaeth",
    label: "WalletConnect",
    ecosystem: "evm",
    connectorId: "walletConnect",
    chainId: 4326,
    networkLabel: "MegaETH",
    chainKey: "megaeth",
  },
  {
    id: "petra",
    label: "Petra",
    ecosystem: "aptos",
    chainKey: "aptos",
  },
  {
    id: "nightly",
    label: "Nightly",
    ecosystem: "movement",
    chainKey: "movement",
  },
  {
    id: "freighter",
    label: "Freighter",
    ecosystem: "stellar",
    chainKey: "stellar",
  },
  {
    id: "polkadot",
    label: "Vara Network",
    ecosystem: "vara",
    chainKey: "vara",
  },
  {
    id: "braavos",
    label: "Braavos",
    ecosystem: "starknet",
    starknetId: "braavos",
    chainKey: "starknet",
  },
  {
    id: "argent",
    label: "Ready Wallet",
    ecosystem: "starknet",
    starknetId: "argentX",
    chainKey: "starknet",
  },
];

const CHAIN_KEYS = CHAIN_REGISTRY.map((chain) => chain.key);

export function getDefaultChainFeatures(
  entry: ChainSettingsEntry
): ChainFeatures {
  return {
    walletConnect: true,
    shopPayments: entry.defaultShopPayments,
  };
}

export function getDefaultChainSettings(): Record<ChainKey, ChainFeatures> {
  const settings = {} as Record<ChainKey, ChainFeatures>;
  for (const entry of CHAIN_REGISTRY) {
    settings[entry.key] = getDefaultChainFeatures(entry);
  }
  return settings;
}

export function mergeChainSettings(
  stored: Partial<Record<ChainKey, Partial<ChainFeatures>>> | null | undefined
): Record<ChainKey, ChainFeatures> {
  const merged = getDefaultChainSettings();
  if (!stored) return merged;

  for (const key of CHAIN_KEYS) {
    const patch = stored[key];
    if (!patch) continue;
    merged[key] = {
      walletConnect:
        patch.walletConnect !== undefined
          ? patch.walletConnect !== false
          : merged[key].walletConnect,
      shopPayments:
        patch.shopPayments !== undefined
          ? patch.shopPayments !== false
          : merged[key].shopPayments,
    };
  }

  return merged;
}

export function chainHasWalletConnect(
  settings: Record<ChainKey, ChainFeatures>,
  key: ChainKey
): boolean {
  return settings[key]?.walletConnect !== false;
}

export function isWalletOptionEnabled(
  option: WalletOption,
  settings: Record<ChainKey, ChainFeatures>
): boolean {
  return chainHasWalletConnect(settings, option.chainKey);
}

export function getChainKeyForEvmChainId(
  chainId: number
): ChainKey | undefined {
  return CHAIN_REGISTRY.find(
    (entry) => entry.ecosystem === "evm" && entry.chainId === chainId
  )?.key;
}

export function chainSupportsShopPaymentsConfig(
  entry: ChainSettingsEntry
): boolean {
  return (
    entry.ecosystem === "evm" ||
    entry.ecosystem === "sui" ||
    entry.ecosystem === "vara"
  );
}

export function isShopPaymentsEnabled(
  settings: Record<ChainKey, ChainFeatures>,
  ecosystem: WalletEcosystem,
  chainId?: number
): boolean {
  if (ecosystem === "sui") {
    return settings.sui?.shopPayments !== false;
  }

  if (ecosystem === "evm") {
    const key = chainId ? getChainKeyForEvmChainId(chainId) : "base";
    // Unknown EVM chainId (e.g. SIWE on Ethereum) — still allow Base shop UI;
    // SparkShopPaymentModal will ask the user to switch to Base.
    if (!key) {
      return settings.base?.shopPayments !== false;
    }
    // Avalanche shop is on by default for this rollout; Firestore Off still wins.
    return settings[key]?.shopPayments !== false;
  }

  if (ecosystem === "vara") {
    return settings.vara?.shopPayments !== false;
  }

  return false;
}

export function getChainRegistryEntry(key: ChainKey): ChainSettingsEntry {
  const entry = CHAIN_REGISTRY.find((chain) => chain.key === key);
  if (!entry) {
    throw new Error(`Unknown chain key: ${key}`);
  }
  return entry;
}
