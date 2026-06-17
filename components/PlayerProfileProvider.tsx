"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useDisconnect } from "wagmi";
import { disconnect as disconnectStarknet } from "starknetkit";
import dynamic from "next/dynamic";
import OnboardingModal from "@/components/OnboardingModal";

const ConnectWalletModal = dynamic(
  () => import("@/components/ConnectWalletModal"),
  { ssr: false }
);
import {
  bootstrapPlayerProfile,
  fetchAuthSession,
  fetchPlayerProfile,
  logoutSession,
  savePlayerProfile,
} from "@/lib/player-profile-client";
import {
  clearCachedPlayerName,
  clearCachedSession,
  setCachedSession,
} from "@/lib/player-id";
import { WalletEcosystem } from "@/lib/player-identity";
import { PlayerProfile } from "@/types";

interface PlayerProfileContextValue {
  playerId: string;
  profile: PlayerProfile | null;
  playerName: string;
  walletAddress: string;
  ecosystem: WalletEcosystem | null;
  isReady: boolean;
  isAuthenticated: boolean;
  openConnect: () => void;
  logout: () => Promise<void>;
}

const PlayerProfileContext = createContext<PlayerProfileContextValue | null>(
  null
);

export function usePlayerProfile(): PlayerProfileContextValue {
  const ctx = useContext(PlayerProfileContext);
  if (!ctx) {
    throw new Error("usePlayerProfile must be used within PlayerProfileProvider");
  }
  return ctx;
}

function hasPlayerName(profile: PlayerProfile | null): boolean {
  return Boolean(profile?.name?.trim());
}

export default function PlayerProfileProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { disconnectAsync } = useDisconnect();
  const [playerId, setPlayerId] = useState("");
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [walletAddress, setWalletAddress] = useState("");
  const [ecosystem, setEcosystem] = useState<WalletEcosystem | null>(null);
  const [chainId, setChainId] = useState<number | undefined>();
  const [isReady, setIsReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showConnect, setShowConnect] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadProfileForSession = useCallback(
    async (session: {
      playerId: string;
      address: string;
      ecosystem: WalletEcosystem;
      chainId?: number;
    }) => {
      setPlayerId(session.playerId);
      setWalletAddress(session.address);
      setEcosystem(session.ecosystem);
      setChainId(session.chainId);
      setCachedSession(session.ecosystem, session.address, session.playerId);
      setIsAuthenticated(true);

      let user = await bootstrapPlayerProfile(session.playerId, {
        walletAddress: session.address,
        ecosystem: session.ecosystem,
        chainId: session.chainId,
      });

      if (!hasPlayerName(user)) {
        const fresh = await fetchPlayerProfile(session.playerId);
        if (fresh) user = fresh;
      }

      setProfile(user);

      if (!hasPlayerName(user)) {
        clearCachedPlayerName();
        setShowOnboarding(true);
      } else {
        setShowOnboarding(false);
      }
    },
    []
  );

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setError("");
      try {
        const session = await fetchAuthSession();
        if (cancelled) return;

        if (!session) {
          setIsAuthenticated(false);
          setShowConnect(true);
          return;
        }

        await loadProfileForSession(session);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : "Could not load your profile. Please try again."
        );
        setShowConnect(true);
      } finally {
        if (!cancelled) setIsReady(true);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [loadProfileForSession]);

  const handleSignedIn = useCallback(async () => {
    setShowConnect(false);
    setError("");
    try {
      const session = await fetchAuthSession();
      if (!session) {
        throw new Error("Sign-in did not complete.");
      }
      await loadProfileForSession(session);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not complete sign-in."
      );
      setShowConnect(true);
    }
  }, [loadProfileForSession]);

  const handleOnboardingSubmit = useCallback(
    async (data: { name: string; email?: string }) => {
      if (!playerId || !walletAddress || !ecosystem) return;

      setSaving(true);
      setError("");

      try {
        const saved = await savePlayerProfile(playerId, data.name, {
          email: data.email,
          walletAddress,
          ecosystem,
          chainId,
        });

        setProfile(saved);
        setShowOnboarding(false);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not save your profile."
        );
      } finally {
        setSaving(false);
      }
    },
    [playerId, walletAddress, ecosystem, chainId]
  );

  const logout = useCallback(async () => {
    try {
      await disconnectAsync();
    } catch {
      // ignore
    }
    try {
      await disconnectStarknet();
    } catch {
      // ignore
    }
    await logoutSession();
    clearCachedSession();
    setPlayerId("");
    setProfile(null);
    setWalletAddress("");
    setEcosystem(null);
    setChainId(undefined);
    setIsAuthenticated(false);
    setShowOnboarding(false);
    setShowConnect(true);
  }, [disconnectAsync]);

  const value = useMemo(
    () => ({
      playerId,
      profile,
      playerName: profile?.name ?? "",
      walletAddress,
      ecosystem,
      isReady,
      isAuthenticated,
      openConnect: () => setShowConnect(true),
      logout,
    }),
    [
      playerId,
      profile,
      walletAddress,
      ecosystem,
      isReady,
      isAuthenticated,
      logout,
    ]
  );

  return (
    <PlayerProfileContext.Provider value={value}>
      {children}
      <ConnectWalletModal
        open={showConnect}
        error={error}
        onSignedIn={handleSignedIn}
      />
      <OnboardingModal
        open={showOnboarding}
        saving={saving}
        error={error}
        defaultName={profile?.name ?? ""}
        defaultEmail={profile?.email ?? ""}
        onSubmit={handleOnboardingSubmit}
      />
    </PlayerProfileContext.Provider>
  );
}
