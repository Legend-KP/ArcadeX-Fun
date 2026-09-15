import type { EIP1193Provider } from "viem";

export type InjectedProvider = EIP1193Provider & {
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
  isRabby?: boolean;
  isRonin?: boolean;
  isTrust?: boolean;
  isTrustWallet?: boolean;
  providers?: InjectedProvider[];
};

type BrowserWindow = Window & {
  ethereum?: InjectedProvider;
  ronin?: { provider?: InjectedProvider };
  trustWallet?: InjectedProvider;
  trustwallet?: InjectedProvider;
};

function browserWindow(
  source?: object | undefined
): BrowserWindow | undefined {
  if (source) return source as BrowserWindow;
  if (typeof window === "undefined") return undefined;
  return window as BrowserWindow;
}

function uniqueProviders(providers: InjectedProvider[]): InjectedProvider[] {
  const seen = new Set<InjectedProvider>();
  const unique: InjectedProvider[] = [];
  for (const provider of providers) {
    if (!provider || seen.has(provider)) continue;
    seen.add(provider);
    unique.push(provider);
  }
  return unique;
}

function ethereumProviders(win?: BrowserWindow): InjectedProvider[] {
  const ethereum = win?.ethereum;
  if (!ethereum) return [];
  if (ethereum.providers?.length) return ethereum.providers;
  return [ethereum];
}

/** Ronin Wallet injects `window.ronin.provider` (and may also set window.ethereum). */
export function getRoninInjectedProvider(
  win?: object
): InjectedProvider | undefined {
  const source = browserWindow(win);
  if (source?.ronin?.provider) return source.ronin.provider;
  return ethereumProviders(source).find((provider) => provider.isRonin);
}

export function getRabbyInjectedProvider(
  win?: object
): InjectedProvider | undefined {
  return ethereumProviders(browserWindow(win)).find(
    (provider) => provider.isRabby
  );
}

export function getTrustInjectedProvider(
  win?: object
): InjectedProvider | undefined {
  const source = browserWindow(win);
  if (source?.trustWallet) return source.trustWallet;
  if (source?.trustwallet) return source.trustwallet;
  return ethereumProviders(source).find(
    (provider) => provider.isTrust || provider.isTrustWallet
  );
}

/** All known injected EIP-1193 providers, including Ronin/Trust globals. */
export function collectInjectedProviders(): InjectedProvider[] {
  const source = browserWindow();
  if (!source) return [];

  const ronin = getRoninInjectedProvider(source);
  const trust = getTrustInjectedProvider(source);

  return uniqueProviders([
    ...(ronin ? [ronin] : []),
    ...(trust ? [trust] : []),
    ...ethereumProviders(source),
  ]);
}
