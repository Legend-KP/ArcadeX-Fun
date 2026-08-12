"use client";

const STORAGE_KEY = "arcadex_streak_broken_seen_v1";

type SeenEntry = {
  walletAddress: string;
  chainId: number;
  campaignId: number;
  /** On-chain lastCheckInAt — unique per broken streak episode. */
  lastCheckInAt: number;
};

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function readAll(): SeenEntry[] {
  if (!canUseStorage()) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SeenEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(entries: SeenEntry[]): void {
  if (!canUseStorage()) return;
  try {
    // Keep recent entries only — avoid unbounded growth.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-40)));
  } catch {
    // Private mode / quota
  }
}

/** True when we've already shown the broken-streak ceremony for this episode. */
export function hasSeenStreakBroken(opts: {
  walletAddress: string;
  chainId: number;
  campaignId: number;
  lastCheckInAt: number;
}): boolean {
  const wallet = opts.walletAddress.toLowerCase();
  return readAll().some(
    (e) =>
      e.walletAddress === wallet &&
      Number(e.chainId) === Number(opts.chainId) &&
      Number(e.campaignId) === Number(opts.campaignId) &&
      Number(e.lastCheckInAt) === Number(opts.lastCheckInAt)
  );
}

export function markStreakBrokenSeen(opts: {
  walletAddress: string;
  chainId: number;
  campaignId: number;
  lastCheckInAt: number;
}): void {
  const wallet = opts.walletAddress.toLowerCase();
  const next: SeenEntry = {
    walletAddress: wallet,
    chainId: Number(opts.chainId),
    campaignId: Number(opts.campaignId),
    lastCheckInAt: Number(opts.lastCheckInAt),
  };
  const rest = readAll().filter(
    (e) =>
      !(
        e.walletAddress === wallet &&
        Number(e.chainId) === next.chainId &&
        Number(e.campaignId) === next.campaignId &&
        Number(e.lastCheckInAt) === next.lastCheckInAt
      )
  );
  writeAll([...rest, next]);
}
