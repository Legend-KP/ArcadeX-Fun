import {
  createWalletClient,
  custom,
  type EIP1193Provider,
  type WalletClient,
} from "viem";
import { base } from "@/lib/chains";

type InjectedProvider = EIP1193Provider & {
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
};

declare global {
  interface Window {
    ethereum?: InjectedProvider;
  }
}

export function getInjectedProvider(): InjectedProvider | null {
  if (typeof window === "undefined" || !window.ethereum) return null;
  return window.ethereum;
}

/** Wallet client on Base via the injected provider (MetaMask / Coinbase / etc.). */
export function createEvmWalletClient(): WalletClient | null {
  const provider = getInjectedProvider();
  if (!provider) return null;

  return createWalletClient({
    chain: base,
    transport: custom(provider),
  });
}
