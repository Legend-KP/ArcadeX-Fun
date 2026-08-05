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
import { disconnectSlushWallet } from "@/lib/sui-wallet-client";
import { disconnectPetraWallet } from "@/lib/aptos-wallet-client";
import { disconnectMovementWallet } from "@/lib/movement-wallet-client";
import dynamic from "next/dynamic";
import OnboardingModal from "@/components/OnboardingModal";
import DailyCheckInModal from "@/components/DailyCheckInModal";
import DailyShuffleModal from "@/components/DailyShuffleModal";
import { isArcadeXRewardsConfigured } from "@/lib/arcadex-rewards";
import { fetchDailyPlayConfig } from "@/lib/daily-play-config-client";
import type { DailyPlayMode } from "@/lib/daily-play-mode";
import {
  fetchStreakStatus,
  type StreakStatus,
} from "@/lib/streak-client";
import { PRIMARY_EVM_CHAIN_ID } from "@/lib/chains";
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

const ConnectWalletModal = dynamic(
  () => import("@/components/ConnectWalletModal"),
  { ssr: false }
);

interface PlayerProfileContextValue {
  playerId: string;
  profile: PlayerProfile | null;
  playerName: string;
  walletAddress: string;
  ecosystem: WalletEcosystem | null;
  chainId?: number;
  isReady: boolean;
  isAuthenticated: boolean;
  streakStatus: StreakStatus | null;
  refreshStreakStatus: () => Promise<void>;
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
  const [showDailyPlay, setShowDailyPlay] = useState(false);
  const [dailyPlayMode, setDailyPlayMode] = useState<DailyPlayMode>("streak");
  const [streakStatus, setStreakStatus] = useState<StreakStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const maybePromptDailyPlay = useCallback(
    async (session: {
      address: string;
      ecosystem: WalletEcosystem;
      chainId?: number;
    }) => {
      if (
        session.ecosystem !== "evm" ||
        !isArcadeXRewardsConfigured()
      ) {
        setShowDailyPlay(false);
        setStreakStatus(null);
        return;
      }

      // Prefer Base; still load status if SIWE chainId is missing/stale so the
      // check-in modal can prompt a network switch via the wallet.
      const sessionChainId =
        session.chainId == null ? undefined : Number(session.chainId);
      if (
        sessionChainId != null &&
        Number.isFinite(sessionChainId) &&
        sessionChainId !== PRIMARY_EVM_CHAIN_ID
      ) {
        // Non-Base EVM session: skip daily ceremony (wallet must reconnect on Base).
        setShowDailyPlay(false);
        setStreakStatus(null);
        return;
      }

      try {
        const config = await fetchDailyPlayConfig({ fresh: true });
        setDailyPlayMode(config.mode);
        const status = await fetchStreakStatus(session.address, config.campaignId, {
          fresh: true,
        });
        setStreakStatus(status);
        setShowDailyPlay(Boolean(status.canCheckIn));
      } catch (err) {
        // Status RPC can flake — still show the ceremony for Base EVM so new
        // users are not dropped after onboarding with no daily streak UI.
        console.warn("[daily-play] status fetch failed; showing modal anyway", err);
        setStreakStatus(null);
        setShowDailyPlay(true);
      }
    },
    []
  );

  const refreshStreakStatus = useCallback(async () => {
    if (
      ecosystem !== "evm" ||
      !walletAddress ||
      !isArcadeXRewardsConfigured()
    ) {
      setStreakStatus(null);
      return;
    }
    try {
      const config = await fetchDailyPlayConfig();
      setDailyPlayMode(config.mode);
      const status = await fetchStreakStatus(walletAddress, config.campaignId, {
        fresh: true,
      });
      setStreakStatus(status);
    } catch {
      // ignore
    }
  }, [ecosystem, walletAddress]);

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
        await maybePromptDailyPlay(session);
      }
    },
    [maybePromptDailyPlay]
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

        // Prefer a fresh session after profile save so chainId/ecosystem match
        // the auth cookie (React state can be stale right after first sign-in).
        const session = await fetchAuthSession().catch(() => null);
        await maybePromptDailyPlay({
          address: session?.address ?? walletAddress,
          ecosystem: session?.ecosystem ?? ecosystem,
          chainId: session?.chainId ?? chainId,
        });
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not save your profile."
        );
      } finally {
        setSaving(false);
      }
    },
    [playerId, walletAddress, ecosystem, chainId, maybePromptDailyPlay]
  );

  const handleDailyPlayComplete = useCallback(async () => {
    setShowDailyPlay(false);
    await refreshStreakStatus();
  }, [refreshStreakStatus]);

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
    try {
      await disconnectSlushWallet();
    } catch {
      // ignore
    }
    try {
      await disconnectPetraWallet();
    } catch {
      // ignore
    }
    try {
      await disconnectMovementWallet();
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
    setShowDailyPlay(false);
    setStreakStatus(null);
    setShowConnect(true);
  }, [disconnectAsync]);

  const value = useMemo(
    () => ({
      playerId,
      profile,
      playerName: profile?.name ?? "",
      walletAddress,
      ecosystem,
      chainId,
      isReady,
      isAuthenticated,
      streakStatus,
      refreshStreakStatus,
      openConnect: () => setShowConnect(true),
      logout,
    }),
    [
      playerId,
      profile,
      walletAddress,
      ecosystem,
      chainId,
      isReady,
      isAuthenticated,
      streakStatus,
      refreshStreakStatus,
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
        open={showOnboarding && !showDailyPlay}
        saving={saving}
        error={error}
        defaultName={profile?.name ?? ""}
        defaultEmail={profile?.email ?? ""}
        onSubmit={handleOnboardingSubmit}
      />
      <DailyCheckInModal
        open={showDailyPlay && dailyPlayMode !== "shuffle"}
        walletAddress={walletAddress}
        status={streakStatus}
        onComplete={handleDailyPlayComplete}
      />
      <DailyShuffleModal
        open={showDailyPlay && dailyPlayMode === "shuffle"}
        walletAddress={walletAddress}
        status={streakStatus}
        onComplete={handleDailyPlayComplete}
      />
    </PlayerProfileContext.Provider>
  );
}
