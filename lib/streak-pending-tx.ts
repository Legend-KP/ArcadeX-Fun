"use client";

const STORAGE_KEY = "arcadex_streak_pending_tx_v1";
const MAX_AGE_MS = 48 * 60 * 60 * 1000;

export type PendingCheckInTx = {
  walletAddress: string;
  txHash: string;
  campaignId: number;
  chainId: number;
  savedAt: number;
};

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function savePendingCheckInTx(entry: PendingCheckInTx): void {
  if (!canUseStorage()) return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...entry,
        walletAddress: entry.walletAddress.toLowerCase(),
        savedAt: Date.now(),
      })
    );
  } catch {
    // Private mode / quota
  }
}

export function readPendingCheckInTx(
  walletAddress: string,
  chainId: number,
  campaignId: number
): PendingCheckInTx | null {
  if (!canUseStorage()) return null;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as PendingCheckInTx;
    if (parsed.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
      return null;
    }
    if (Number(parsed.chainId) !== Number(chainId)) return null;
    if (Number(parsed.campaignId) !== Number(campaignId)) return null;
    if (!parsed.txHash || !/^0x[a-fA-F0-9]{64}$/.test(parsed.txHash)) {
      return null;
    }
    if (Date.now() - Number(parsed.savedAt) > MAX_AGE_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingCheckInTx(): void {
  if (!canUseStorage()) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore
  }
}
