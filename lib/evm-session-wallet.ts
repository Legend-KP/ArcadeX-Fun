"use client";

import {
  createWalletClient,
  custom,
  getAddress,
  type Address,
  type Chain,
  type EIP1193Provider,
  type WalletClient,
} from "viem";
import { base } from "@/lib/chains";
import { getCachedWalletConnectorId } from "@/lib/player-id";

type InjectedProvider = EIP1193Provider & {
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
  isRabby?: boolean;
};

declare global {
  interface Window {
    ethereum?: InjectedProvider & { providers?: InjectedProvider[] };
  }
}

export class WalletSessionMismatchError extends Error {
  readonly activeAddress: string;
  readonly expectedAddress: string;

  constructor(activeAddress: string, expectedAddress: string) {
    const active = formatWalletAddress(activeAddress);
    const expected = formatWalletAddress(expectedAddress);
    super(
      `Your browser wallet is on ${active}, but you signed in as ${expected}. ` +
        "Switch to your signed-in account in your wallet extension, or disconnect and reconnect your wallet."
    );
    this.name = "WalletSessionMismatchError";
    this.activeAddress = activeAddress;
    this.expectedAddress = expectedAddress;
  }
}

export function formatWalletAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function isWalletSessionMismatchError(
  error: unknown
): error is WalletSessionMismatchError {
  return error instanceof WalletSessionMismatchError;
}

export function isWalletMismatchMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("signed in as") ||
    lower.includes("browser wallet is on") ||
    lower.includes("metamask is on")
  );
}

function normalizeAddress(address: string): Address {
  return getAddress(address as Address);
}

function providerMatchesConnector(
  provider: InjectedProvider,
  connectorId: string | null
): boolean {
  if (!connectorId) return false;
  const id = connectorId.toLowerCase();
  if (id.includes("metamask")) {
    return Boolean(provider.isMetaMask) && !provider.isCoinbaseWallet;
  }
  if (id.includes("coinbase")) {
    return Boolean(provider.isCoinbaseWallet);
  }
  if (id.includes("rabby")) {
    return Boolean(provider.isRabby);
  }
  return false;
}

/** All injected EIP-1193 providers (MetaMask, Coinbase, Rabby, etc.). */
export function getInjectedProviders(): InjectedProvider[] {
  if (typeof window === "undefined" || !window.ethereum) return [];
  const multi = window.ethereum.providers;
  if (multi?.length) return multi;
  return [window.ethereum];
}

export function getPreferredInjectedProvider(): InjectedProvider | null {
  const providers = getInjectedProviders();
  if (!providers.length) return null;

  const cachedConnectorId = getCachedWalletConnectorId();
  if (cachedConnectorId) {
    const match = providers.find((provider) =>
      providerMatchesConnector(provider, cachedConnectorId)
    );
    if (match) return match;
  }

  const metamask = providers.find(
    (provider) => provider.isMetaMask && !provider.isCoinbaseWallet
  );
  if (metamask) return metamask;

  return providers[0] ?? null;
}

export function createInjectedWalletClient(
  chain: Chain = base,
  provider: InjectedProvider
): WalletClient {
  return createWalletClient({
    chain,
    transport: custom(provider),
  });
}

async function readProviderAccounts(
  provider: InjectedProvider,
  chain: Chain
): Promise<Address[]> {
  const client = createInjectedWalletClient(chain, provider);
  try {
    const accounts = await client.getAddresses();
    if (accounts.length) return accounts.map((account) => normalizeAddress(account));
  } catch {
    // fall through
  }
  return [];
}

async function requestProviderAccounts(
  provider: InjectedProvider,
  chain: Chain
): Promise<Address[]> {
  const client = createInjectedWalletClient(chain, provider);
  try {
    const accounts = await client.requestAddresses();
    return accounts.map((account) => normalizeAddress(account));
  } catch {
    return [];
  }
}

/**
 * Resolve the wallet account that matches the signed-in session.
 * Scans every injected provider so Coinbase/Rabby cannot shadow MetaMask.
 */
export async function resolveEvmAccountForSession(
  chain: Chain,
  expectedWallet?: string
): Promise<{ account: Address; walletClient: WalletClient }> {
  const providers = getInjectedProviders();
  if (!providers.length) {
    throw new Error(
      "No browser wallet found. Install MetaMask (or another EVM wallet), unlock it, then try again."
    );
  }

  const expected = expectedWallet
    ? normalizeAddress(expectedWallet)
    : null;

  const cachedConnectorId = getCachedWalletConnectorId();
  const orderedProviders = [...providers].sort((a, b) => {
    const aMatch = providerMatchesConnector(a, cachedConnectorId) ? 1 : 0;
    const bMatch = providerMatchesConnector(b, cachedConnectorId) ? 1 : 0;
    return bMatch - aMatch;
  });

  let fallbackAccount: Address | null = null;
  let fallbackClient: WalletClient | null = null;

  for (const provider of orderedProviders) {
    const walletClient = createInjectedWalletClient(chain, provider);
    const accounts = await readProviderAccounts(provider, chain);

    for (const account of accounts) {
      if (!fallbackAccount) {
        fallbackAccount = account;
        fallbackClient = walletClient;
      }
      if (!expected || account === expected) {
        return { account, walletClient };
      }
    }
  }

  // Re-prompt connection on the preferred provider(s).
  for (const provider of orderedProviders) {
    const walletClient = createInjectedWalletClient(chain, provider);
    const accounts = await requestProviderAccounts(provider, chain);
    for (const account of accounts) {
      if (!expected || account === expected) {
        return { account, walletClient };
      }
      if (!fallbackAccount) {
        fallbackAccount = account;
        fallbackClient = walletClient;
      }
    }
  }

  if (!fallbackAccount || !fallbackClient) {
    throw new Error(
      "No wallet account available. Unlock your wallet, connect this site, pick your signed-in account, then try again."
    );
  }

  if (expected) {
    throw new WalletSessionMismatchError(fallbackAccount, expected);
  }

  return { account: fallbackAccount, walletClient: fallbackClient };
}
