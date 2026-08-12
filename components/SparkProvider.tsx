"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import {
  fetchSparkData,
  spendSpark,
  SparkClientError,
} from "@/lib/spark-client";
import {
  computeSparkSnapshot,
  mockSparkSnapshot,
  normalizeSparkState,
} from "@/lib/spark";
import { SparkSnapshot, StoredSparkState } from "@/types";

interface SparkContextValue {
  sparks: SparkSnapshot;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  spendForGame: (opts: {
    gameId: string;
    playGate?: { message: string; signature: string };
  }) => Promise<{ playSessionId: string }>;
}

const SparkContext = createContext<SparkContextValue | null>(null);

export function useSparks(): SparkContextValue {
  const ctx = useContext(SparkContext);
  if (!ctx) {
    throw new Error("useSparks must be used within SparkProvider");
  }
  return ctx;
}

export default function SparkProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { playerId, isReady, isAuthenticated, chainId, ecosystem } =
    usePlayerProfile();
  const [storedState, setStoredState] = useState<StoredSparkState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    if (!playerId || !isAuthenticated) return;

    setLoading(true);
    setError("");

    try {
      const data = await fetchSparkData(playerId, {
        chainId,
        ecosystem: ecosystem ?? undefined,
      });
      setStoredState(data.state);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load Sparks."
      );
    } finally {
      setLoading(false);
    }
  }, [playerId, isAuthenticated, chainId, ecosystem]);

  useEffect(() => {
    if (!isReady) return;

    if (!playerId || !isAuthenticated) {
      setStoredState(null);
      setError("");
      setLoading(false);
      return;
    }

    void refresh();
  }, [isReady, playerId, isAuthenticated, chainId, ecosystem, refresh]);

  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const sparks = useMemo(() => {
    if (!playerId || !isAuthenticated || !storedState) {
      return mockSparkSnapshot();
    }

    const normalized = normalizeSparkState(storedState, tick);
    return computeSparkSnapshot(normalized, tick);
  }, [playerId, isAuthenticated, storedState, tick]);

  const spendForGame = useCallback(
    async (opts: {
      gameId: string;
      playGate?: { message: string; signature: string };
    }) => {
      if (!playerId || !isAuthenticated) {
        throw new SparkClientError(
          "Connect your wallet to play.",
          "NO_WALLET",
          400
        );
      }

      const data = await spendSpark(playerId, {
        chainId,
        ecosystem: ecosystem ?? undefined,
        gameId: opts.gameId,
        playGate: opts.playGate,
      });
      setStoredState(data.state);

      const playSessionId = data.playSessionId?.trim() ?? "";
      if (!playSessionId) {
        throw new SparkClientError(
          "Play session was not created. Try starting again.",
          "NO_PLAY_SESSION",
          500
        );
      }

      return { playSessionId };
    },
    [playerId, isAuthenticated, chainId, ecosystem]
  );

  const value = useMemo(
    () => ({
      sparks,
      loading,
      error,
      refresh,
      spendForGame,
    }),
    [sparks, loading, error, refresh, spendForGame]
  );

  return (
    <SparkContext.Provider value={value}>{children}</SparkContext.Provider>
  );
}
