import { defineChain } from "viem";

export const base = defineChain({
  id: 8453,
  name: "Base",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://mainnet.base.org"] },
  },
});

export const arbitrum = defineChain({
  id: 42161,
  name: "Arbitrum One",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://arb1.arbitrum.io/rpc"] },
  },
});

export const megaeth = defineChain({
  id: 4326,
  name: "MegaETH",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://mainnet.megaeth.com/rpc"] },
  },
  blockExplorers: {
    default: { name: "MegaETH Explorer", url: "https://mega.etherscan.io" },
  },
});

export const abstract = defineChain({
  id: 2741,
  name: "Abstract",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://api.mainnet.abs.xyz"] },
  },
  blockExplorers: {
    default: { name: "Abscan", url: "https://abscan.org" },
  },
});

export const bnb = defineChain({
  id: 56,
  name: "BNB Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://bsc-dataseed.binance.org"] },
  },
  blockExplorers: {
    default: { name: "BscScan", url: "https://bscscan.com" },
  },
});

export const berachain = defineChain({
  id: 80094,
  name: "Berachain",
  nativeCurrency: { name: "BERA", symbol: "BERA", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.berachain.com"] },
  },
  blockExplorers: {
    default: { name: "Berascan", url: "https://berascan.com" },
  },
});

export const cronos = defineChain({
  id: 25,
  name: "Cronos",
  nativeCurrency: { name: "CRO", symbol: "CRO", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://evm.cronos.org"] },
  },
  blockExplorers: {
    default: { name: "Cronoscan", url: "https://cronoscan.com" },
  },
});

export const avalanche = defineChain({
  id: 43114,
  name: "Avalanche",
  nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://api.avax.network/ext/bc/C/rpc"] },
  },
  blockExplorers: {
    default: { name: "Snowtrace", url: "https://snowtrace.io" },
  },
});

export const beam = defineChain({
  id: 4337,
  name: "Beam",
  nativeCurrency: { name: "Beam", symbol: "BEAM", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://build.onbeam.com/rpc"] },
  },
  blockExplorers: {
    default: { name: "Beam Explorer", url: "https://subnets.avax.network/beam" },
  },
});

export const primaryEvmChain = base;
export const PRIMARY_EVM_CHAIN_ID = base.id;

/** Native Circle USDC on Base mainnet (6 decimals). */
export const BASE_USDC_ADDRESS =
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

export const supportedEvmChains = [
  base,
  megaeth,
  arbitrum,
  abstract,
  bnb,
  berachain,
  cronos,
  avalanche,
  beam,
] as const;

export function getEvmChainById(chainId: number) {
  return supportedEvmChains.find((chain) => chain.id === chainId);
}

export function isSupportedEvmChainId(chainId: number): boolean {
  return supportedEvmChains.some((chain) => chain.id === chainId);
}
