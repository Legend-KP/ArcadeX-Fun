"use client";

import type { StreakStatus } from "@/lib/streak-client";

const STORAGE_KEY = "arcadex_streak_status_v3";

/** Client-side cache — skip /api/streak/status when still fresh. */
export const STREAK_CLIENT_CACHE_MS = 5 * 60 * 1000;

type CachedStreak = {
  wallet: string;
  campaignId: number;
  chainId: number;
  status: StreakStatus;
  fetchedAt: number;
};

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof sessionStorage !== "undefined";
}

function dropLegacyCaches(): void {
  sessionStorage.removeItem("arcadex_streak_status_v1");
  sessionStorage.removeItem("arcadex_streak_status_v2");
}

export function readCachedStreakStatus(
  wallet: string,
  campaignId?: number,
  chainId?: number
): StreakStatus | null {
  if (!canUseStorage()) return null;

  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      dropLegacyCaches();
      return null;
    }

    const parsed = JSON.parse(raw) as CachedStreak;
    if (parsed.wallet.toLowerCase() !== wallet.toLowerCase()) return null;
    if (
      typeof campaignId === "number" &&
      Number(parsed.campaignId) !== Number(campaignId)
    ) {
      return null;
    }
    if (
      typeof chainId === "number" &&
      Number.isFinite(chainId) &&
      Number(parsed.chainId) !== Number(chainId)
    ) {
      return null;
    }
    if (Date.now() - parsed.fetchedAt > STREAK_CLIENT_CACHE_MS) return null;

    return parsed.status;
  } catch {
    return null;
  }
}

export function writeCachedStreakStatus(
  wallet: string,
  status: StreakStatus,
  chainId?: number | null
): void {
  if (!canUseStorage()) return;

  try {
    const payload: CachedStreak = {
      wallet: wallet.toLowerCase(),
      campaignId: Number(status.campaignId),
      chainId: chainId == null ? 0 : Number(chainId),
      status,
      fetchedAt: Date.now(),
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    dropLegacyCaches();
  } catch {
    // Storage quota or private mode
  }
}

export function clearCachedStreakStatus(): void {
  if (!canUseStorage()) return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
    dropLegacyCaches();
  } catch {
    // Ignore
  }
}

/** Use cache when user already checked in; always refetch when check-in is due. */
export function shouldUseCachedStreakStatus(status: StreakStatus): boolean {
  return !status.canCheckIn;
}
