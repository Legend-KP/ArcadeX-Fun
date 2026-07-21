/**
 * In-memory RTDB cache for hot-path reads.
 *
 * Covers two main use cases:
 *  1. All game play counts — read once per home-page load, cached 45 s.
 *  2. Leaderboard top-N mirror — per-game, cached 30 s.
 *
 * Like game-cache.ts this lives in Worker module scope and persists across
 * warm-instance requests.
 */

import { LeaderboardEntry } from "@/types";

// ─── TTLs ────────────────────────────────────────────────────────────────────

const PLAY_COUNTS_TTL_MS = 45_000;
const LEADERBOARD_TOP_TTL_MS = 30_000;

// ─── State ───────────────────────────────────────────────────────────────────

interface PlayCountsEntry {
  counts: Record<string, number>;
  fetchedAt: number;
}

interface LeaderboardTopEntry {
  entries: LeaderboardEntry[];
  fetchedAt: number;
}

let playCountsEntry: PlayCountsEntry | null = null;

const leaderboardTopCache = new Map<string, LeaderboardTopEntry>();

// ─── Play counts ─────────────────────────────────────────────────────────────

export async function cachedFetchAllPlayCounts(
  fetcher: () => Promise<Record<string, number>>
): Promise<Record<string, number>> {
  const now = Date.now();

  if (playCountsEntry && now - playCountsEntry.fetchedAt < PLAY_COUNTS_TTL_MS) {
    return playCountsEntry.counts;
  }

  const counts = await fetcher();
  playCountsEntry = { counts, fetchedAt: now };
  return counts;
}

/**
 * Bump a single game's count in the cached entry without re-fetching all.
 * Call immediately after an atomic increment so the UI sees the new count.
 */
export function bumpCachedPlayCount(gameId: string, by = 1): void {
  if (!playCountsEntry) return;
  const current = playCountsEntry.counts[gameId] ?? 0;
  playCountsEntry.counts = {
    ...playCountsEntry.counts,
    [gameId]: current + by,
  };
}

export function invalidatePlayCountsCache(): void {
  playCountsEntry = null;
}

// ─── Leaderboard top mirror ───────────────────────────────────────────────────

export async function cachedFetchLeaderboardTop(
  gameId: string,
  fetcher: () => Promise<LeaderboardEntry[]>
): Promise<LeaderboardEntry[]> {
  const now = Date.now();
  const entry = leaderboardTopCache.get(gameId);

  if (entry && now - entry.fetchedAt < LEADERBOARD_TOP_TTL_MS) {
    return entry.entries;
  }

  const entries = await fetcher();
  leaderboardTopCache.set(gameId, { entries, fetchedAt: now });
  return entries;
}

export function invalidateLeaderboardTopCache(gameId: string): void {
  leaderboardTopCache.delete(gameId);
}

/** Expose stats for metrics logging. */
export function getRtdbCacheStats() {
  return {
    playCountsCached: playCountsEntry !== null,
    playCountsAgeMs: playCountsEntry ? Date.now() - playCountsEntry.fetchedAt : null,
    leaderboardTopCached: leaderboardTopCache.size,
  };
}
