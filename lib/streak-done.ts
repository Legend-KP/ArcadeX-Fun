"use client";

import { isPlausibleEvmTxHash } from "@/lib/tx-hash";

const STORAGE_KEY = "arcadex_streak_done_v1";

/** Skip re-prompting for most of the day even if RPC still lags. */
const DEFAULT_VALID_MS = 20 * 60 * 60 * 1000;
const MAX_AGE_MS = 48 * 60 * 60 * 1000;

export type CompletedCheckIn = {
  walletAddress: string;
  txHash?: string;
  campaignId: number;
  chainId: number;
  completedAt: number;
  validUntil: number;
  day?: number;
};

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function utcDayKey(ms: number = Date.now()): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function saveCompletedCheckIn(
  entry: Omit<CompletedCheckIn, "completedAt" | "validUntil"> & {
    completedAt?: number;
    validUntil?: number;
    minIntervalSeconds?: number;
  }
): void {
  if (!canUseStorage()) return;
  try {
    const completedAt = entry.completedAt ?? Date.now();
    const intervalMs =
      typeof entry.minIntervalSeconds === "number" &&
      Number.isFinite(entry.minIntervalSeconds) &&
      entry.minIntervalSeconds > 0
        ? Math.min(entry.minIntervalSeconds * 1000, DEFAULT_VALID_MS)
        : DEFAULT_VALID_MS;
    const payload: CompletedCheckIn = {
      walletAddress: entry.walletAddress.toLowerCase(),
      txHash: isPlausibleEvmTxHash(entry.txHash) ? entry.txHash : undefined,
      campaignId: Number(entry.campaignId),
      chainId: Number(entry.chainId),
      completedAt,
      validUntil: entry.validUntil ?? completedAt + intervalMs,
      day: entry.day,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Private mode / quota
  }
}

export function readCompletedCheckIn(
  walletAddress: string,
  chainId: number,
  campaignId: number
): CompletedCheckIn | null {
  if (!canUseStorage()) return null;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as CompletedCheckIn;
    if (parsed.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
      return null;
    }
    if (Number(parsed.chainId) !== Number(chainId)) return null;
    if (Number(parsed.campaignId) !== Number(campaignId)) return null;
    if (Date.now() - Number(parsed.completedAt) > MAX_AGE_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    if (Date.now() > Number(parsed.validUntil)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

/** True when this wallet already finished today's ceremony on this chain. */
export function hasCompletedCheckInToday(
  walletAddress: string,
  chainId: number,
  campaignId: number
): boolean {
  return Boolean(readCompletedCheckIn(walletAddress, chainId, campaignId));
}

export function clearCompletedCheckIn(): void {
  if (!canUseStorage()) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore
  }
}
