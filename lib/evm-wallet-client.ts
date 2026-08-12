import { type Chain, type WalletClient } from "viem";
import { base } from "@/lib/chains";
import {
  createInjectedWalletClient,
  getPreferredInjectedProvider,
} from "@/lib/evm-session-wallet";

/** Wallet client via the injected provider (MetaMask / Coinbase / etc.). */
export function createEvmWalletClient(
  chain: Chain = base
): WalletClient | null {
  const provider = getPreferredInjectedProvider();
  if (!provider) return null;
  return createInjectedWalletClient(chain, provider);
}


