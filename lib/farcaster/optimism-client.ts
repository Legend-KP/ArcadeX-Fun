import { createPublicClient, http } from "viem";
import { optimism } from "viem/chains";

const DEFAULT_OP_RPC_URLS = [
  "https://mainnet.optimism.io",
  "https://optimism.publicnode.com",
  "https://optimism.drpc.org",
] as const;

function getOptimismRpcUrls(): string[] {
  const primary =
    process.env.OPTIMISM_RPC_URL?.trim() ||
    process.env.OP_MAINNET_RPC_URL?.trim() ||
    process.env.NEXT_PUBLIC_OPTIMISM_RPC_URL?.trim();

  const urls = primary
    ? [primary, ...DEFAULT_OP_RPC_URLS.filter((u) => u !== primary)]
    : [...DEFAULT_OP_RPC_URLS];

  return Array.from(new Set(urls));
}

export function getOptimismPublicClient(rpcUrl?: string) {
  const url = rpcUrl ?? getOptimismRpcUrls()[0]!;
  return createPublicClient({
    chain: optimism,
    transport: http(url, { timeout: 12_000 }),
  });
}

export function listOptimismRpcUrls(): string[] {
  return getOptimismRpcUrls();
}
