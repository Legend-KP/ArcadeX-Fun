"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  CHAIN_REGISTRY,
  getDefaultChainSettings,
  isShopPaymentsEnabled,
  isWalletOptionEnabled,
  mergeChainSettings,
} from "@/lib/chain-registry";
import type { ChainFeatures, ChainKey, ChainSettingsResponse } from "@/types";
import type { WalletOption } from "@/lib/chain-registry";
import type { WalletEcosystem } from "@/types";

interface ChainSettingsContextValue {
  loading: boolean;
  settings: Record<ChainKey, ChainFeatures>;
  refresh: () => Promise<void>;
  isWalletOptionEnabled: (option: WalletOption) => boolean;
  isShopPaymentsEnabled: (
    ecosystem: WalletEcosystem,
    chainId?: number
  ) => boolean;
}

const ChainSettingsContext = createContext<ChainSettingsContextValue | null>(
  null
);

export function useChainSettings(): ChainSettingsContextValue {
  const ctx = useContext(ChainSettingsContext);
  if (!ctx) {
    throw new Error(
      "useChainSettings must be used within ChainSettingsProvider"
    );
  }
  return ctx;
}

export default function ChainSettingsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState(getDefaultChainSettings());

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/chains", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as ChainSettingsResponse;
      setSettings(mergeChainSettings(data.settings));
    } catch {
      // Keep defaults when settings cannot be loaded.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({
      loading,
      settings,
      refresh,
      isWalletOptionEnabled: (option: WalletOption) =>
        isWalletOptionEnabled(option, settings),
      isShopPaymentsEnabled: (
        ecosystem: WalletEcosystem,
        chainId?: number
      ) => isShopPaymentsEnabled(settings, ecosystem, chainId),
    }),
    [loading, settings, refresh]
  );

  return (
    <ChainSettingsContext.Provider value={value}>
      {children}
    </ChainSettingsContext.Provider>
  );
}

export { CHAIN_REGISTRY };
