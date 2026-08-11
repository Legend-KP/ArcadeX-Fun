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
import OnboardingModal from "@/components/OnboardingModal";
import DailyCheckInModal from "@/components/DailyCheckInModal";
import DailyShuffleModal from "@/components/DailyShuffleModal";
import DailyStreakSuccessModal, {
  type DailyStreakSuccess,
} from "@/components/DailyStreakSuccessModal";
import ConnectWalletModal from "@/components/ConnectWalletModal";
import {
  isArcadeXRewardsConfiguredForChain,
  isAvalancheRewardsChainId,
  getStreakCampaignIdForChain,
} from "@/lib/arcadex-rewards";
import { VARA_CHAIN_ID, isVaraArcadeXRewardsConfigured } from "@/lib/vara-rewards";
import { fetchDailyPlayConfig } from "@/lib/daily-play-config-client";
import type { DailyPlayMode } from "@/lib/daily-play-mode";
import {
  fetchStreakStatus,
  refreshSessionFromCheckIn,
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
  const [streakSuccess, setStreakSuccess] = useState<DailyStreakSuccess | null>(
    null
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const maybePromptDailyPlay = useCallback(
    async (session: {
      address: string;
      ecosystem: WalletEcosystem;
      chainId?: number;
    }) => {
      const sessionChainId =
        session.chainId == null ? undefined : Number(session.chainId);

      // Daily ceremony: Base + Avalanche EVM, or Vara when Rewards program is live.
      const isVaraSession = session.ecosystem === "vara";
      const resolvedChainId = isVaraSession
        ? VARA_CHAIN_ID
        : sessionChainId ?? PRIMARY_EVM_CHAIN_ID;

      if (isVaraSession) {
        if (!isVaraArcadeXRewardsConfigured()) {
          setShowDailyPlay(false);
          setStreakStatus(null);
          return;
        }
      } else if (
        session.ecosystem !== "evm" ||
        !isArcadeXRewardsConfiguredForChain(resolvedChainId)
      ) {
        setShowDailyPlay(false);
        setStreakStatus(null);
        return;
      } else if (
        sessionChainId != null &&
        Number.isFinite(sessionChainId) &&
        sessionChainId !== PRIMARY_EVM_CHAIN_ID &&
        !isAvalancheRewardsChainId(sessionChainId)
      ) {
        setShowDailyPlay(false);
        setStreakStatus(null);
        return;
      }

      try {
        // Prefer cache after connect — fresh RPC is reserved for check-in / recover.
        const config = await fetchDailyPlayConfig();
        setDailyPlayMode(config.mode);
        const campaignId =
          config.mode === "shuffle"
            ? config.campaignId
            : getStreakCampaignIdForChain(resolvedChainId);
        const status = await fetchStreakStatus(session.address, campaignId, {
          chainId: resolvedChainId,
        });
        setStreakStatus(status);

        // Already checked in today on this chain — mint session, skip popup.
        if (!status.canCheckIn && status.lastCheckInAt > 0) {
          try {
            await refreshSessionFromCheckIn(
              session.address,
              campaignId,
              resolvedChainId
            );
          } catch (err) {
            console.warn("[daily-play] session mint from check-in failed", err);
          }
          setShowDailyPlay(false);
          return;
        }

        setShowDailyPlay(true);
      } catch (err) {
        // Status unknown — still prompt so the user can check in / recover.
        console.warn("[daily-play] status fetch failed", err);
        setStreakStatus(null);
        setShowDailyPlay(true);
      }
    },
    []
  );

  const refreshStreakStatus = useCallback(async () => {
    const isVara = ecosystem === "vara";
    const onSupportedChain =
      isVara ||
      chainId === PRIMARY_EVM_CHAIN_ID ||
      isAvalancheRewardsChainId(chainId);
    const resolvedChainId = isVara ? VARA_CHAIN_ID : chainId;
    if (
      (!isVara && ecosystem !== "evm") ||
      !onSupportedChain ||
      !walletAddress ||
      !isArcadeXRewardsConfiguredForChain(resolvedChainId)
    ) {
      setStreakStatus(null);
      return;
    }
    try {
      const config = await fetchDailyPlayConfig();
      setDailyPlayMode(config.mode);
      const campaignId =
        config.mode === "shuffle"
          ? config.campaignId
          : getStreakCampaignIdForChain(resolvedChainId);
      const status = await fetchStreakStatus(walletAddress, campaignId, {
        fresh: true,
        chainId: resolvedChainId,
      });
      setStreakStatus(status);
    } catch {
      setStreakStatus(null);
    }
  }, [ecosystem, chainId, walletAddress]);

  const resetToConnect = useCallback(async () => {
    await logoutSession().catch(() => undefined);
    clearCachedSession();
    clearCachedPlayerName();
    setPlayerId("");
    setProfile(null);
    setWalletAddress("");
    setEcosystem(null);
    setChainId(undefined);
    setIsAuthenticated(false);
    setShowOnboarding(false);
    setShowDailyPlay(false);
    setStreakStatus(null);
    setStreakSuccess(null);
    setShowConnect(true);
  }, []);

  const loadProfileForSession = useCallback(
    async (
      session: {
        playerId: string;
        address: string;
        ecosystem: WalletEcosystem;
        chainId?: number;
      },
      opts?: {
        /** Cold reopen: incomplete profiles must reconnect (name panel is post-sign-in only). */
        fromColdStart?: boolean;
      }
    ) => {
      setPlayerId(session.playerId);
      setWalletAddress(session.address);
      setEcosystem(session.ecosystem);
      setChainId(session.chainId);
      setCachedSession(session.ecosystem, session.address, session.playerId);
      setIsAuthenticated(true);
      // Wallet is connected — never keep the connect modal open under onboarding.
      setShowConnect(false);

      let user = await bootstrapPlayerProfile(session.playerId, {
        walletAddress: session.address,
        ecosystem: session.ecosystem,
        chainId: session.chainId,
      });

      // Only re-read when bootstrap left the name empty (race / cache miss).
      if (!hasPlayerName(user)) {
        const fresh = await fetchPlayerProfile(session.playerId, {
          chainId: session.chainId,
          ecosystem: session.ecosystem,
        });
        if (fresh) user = fresh;
      }

      setProfile(user);

      if (!hasPlayerName(user)) {
        if (opts?.fromColdStart) {
          // Abandoned / incomplete signup — do not reopen the name panel.
          // Always start from network → wallet connect on a fresh visit.
          await resetToConnect();
          return;
        }
        // New user right after wallet sign-in — collect name.
        clearCachedPlayerName();
        setShowDailyPlay(false);
        setShowOnboarding(true);
      } else {
        // Registered — close connect ASAP; daily play runs in the background.
        setShowOnboarding(false);
        void maybePromptDailyPlay(session);
      }
    },
    [maybePromptDailyPlay, resetToConnect]
  );

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setError("");
      try {
        const session = await fetchAuthSession();
        if (cancelled) return;

        if (!session) {
          // Step 1: choose network → connect wallet (no profile / streak yet).
          setIsAuthenticated(false);
          setShowOnboarding(false);
          setShowDailyPlay(false);
          setShowConnect(true);
          return;
        }

        await loadProfileForSession(session, { fromColdStart: true });
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : "Could not load your profile. Please try again."
        );
        setShowOnboarding(false);
        setShowDailyPlay(false);
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

  const handleSignedIn = useCallback(
    async (signedInSession?: {
      playerId: string;
      address: string;
      ecosystem: WalletEcosystem;
      chainId?: number;
    }) => {
      setError("");
      try {
        const session = signedInSession ?? (await fetchAuthSession());
        if (!session) {
          throw new Error("Sign-in did not complete.");
        }
        // loadProfileForSession closes connect, then opens onboarding or daily.
        await loadProfileForSession(session);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not complete sign-in."
        );
        setShowOnboarding(false);
        setShowDailyPlay(false);
        setShowConnect(true);
      }
    },
    [loadProfileForSession]
  );

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

  const handleDailyPlayComplete = useCallback(
    async (result?: {
      day: number;
      milestone: boolean;
      infiniteSparkGranted: boolean;
    }) => {
      setShowDailyPlay(false);
      if (result && dailyPlayMode !== "shuffle") {
        setStreakSuccess({
          day: result.day,
          milestone: result.milestone,
          infiniteSparkGranted: result.infiniteSparkGranted,
          requiredDays: streakStatus?.campaign.requiredDays ?? 7,
        });
      }
      await refreshStreakStatus();
    },
    [dailyPlayMode, streakStatus?.campaign.requiredDays, refreshStreakStatus]
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
    await resetToConnect();
  }, [disconnectAsync, resetToConnect]);

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
      openConnect: () => {
        setShowOnboarding(false);
        setShowDailyPlay(false);
        setShowConnect(true);
      },
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

  // Strict order: connect (network → wallet) → onboarding (new) → daily (if needed).
  const connectOpen = showConnect;
  const onboardingOpen =
    showOnboarding && !showConnect && isAuthenticated && Boolean(walletAddress);
  const dailyOpen =
    showDailyPlay && !showConnect && !showOnboarding && isAuthenticated;

  return (
    <PlayerProfileContext.Provider value={value}>
      {children}
      <ConnectWalletModal
        open={connectOpen}
        error={error}
        onSignedIn={handleSignedIn}
      />
      <OnboardingModal
        open={onboardingOpen}
        saving={saving}
        error={error}
        defaultName={profile?.name ?? ""}
        defaultEmail={profile?.email ?? ""}
        onSubmit={handleOnboardingSubmit}
        onChangeWallet={async () => {
          setShowOnboarding(false);
          await logout();
        }}
      />
      <DailyCheckInModal
        open={dailyOpen && dailyPlayMode !== "shuffle"}
        walletAddress={walletAddress}
        chainId={
          ecosystem === "vara"
            ? VARA_CHAIN_ID
            : chainId ??
              (ecosystem === "evm" ? PRIMARY_EVM_CHAIN_ID : undefined)
        }
        status={streakStatus}
        onComplete={handleDailyPlayComplete}
      />
      <DailyShuffleModal
        open={dailyOpen && dailyPlayMode === "shuffle"}
        walletAddress={walletAddress}
        chainId={
          ecosystem === "vara"
            ? VARA_CHAIN_ID
            : chainId ??
              (ecosystem === "evm" ? PRIMARY_EVM_CHAIN_ID : undefined)
        }
        status={streakStatus}
        onComplete={handleDailyPlayComplete}
      />
      <DailyStreakSuccessModal
        open={Boolean(streakSuccess)}
        result={streakSuccess}
        onClose={() => setStreakSuccess(null)}
      />
    </PlayerProfileContext.Provider>
  );
}
