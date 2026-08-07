import {

  createWalletClient,

  custom,

  type Chain,

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



/** Wallet client via the injected provider (MetaMask / Coinbase / etc.). */

export function createEvmWalletClient(

  chain: Chain = base

): WalletClient | null {

  const provider = getInjectedProvider();

  if (!provider) return null;



  return createWalletClient({

    chain,

    transport: custom(provider),

  });

}


