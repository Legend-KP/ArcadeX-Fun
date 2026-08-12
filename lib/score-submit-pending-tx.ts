"use client";

const STORAGE_KEY = "arcadex_score_submit_pending_v1";
const MAX_AGE_MS = 2 * 60 * 60 * 1000;

export type PendingScoreSubmitTx = {
  gameId: string;
  score: number;
  walletAddress: string;
  txHash: string;
  tokenAddress: string;
  chainId?: number;
  ecosystem: "evm" | "vara" | "sui";
  playerName?: string;
  savedAt: number;
};

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function savePendingScoreSubmitTx(entry: PendingScoreSubmitTx): void {
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

export function readPendingScoreSubmitTx(
  gameId: string,
  walletAddress: string
): PendingScoreSubmitTx | null {
  if (!canUseStorage()) return null;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as PendingScoreSubmitTx;
    if (parsed.gameId !== gameId) return null;
    if (parsed.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
      return null;
    }
    if (!parsed.txHash) return null;
    if (Date.now() - Number(parsed.savedAt) > MAX_AGE_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingScoreSubmitTx(): void {
  if (!canUseStorage()) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore
  }
}
