/**
 * In-memory RTDB cache for hot-path reads.
 *
 * Covers:
 *  1. All game play counts — longer TTL; approximate counts are fine for catalog.
 *  2. Leaderboard top-N mirror — per-game, short TTL.
 *
 * Concurrent cache misses coalesce into one upstream fetch per key.
 */

import { LeaderboardEntry } from "@/types";

// ─── TTLs ────────────────────────────────────────────────────────────────────

/** Catalog can tolerate slightly stale play counts (reduces RTDB bandwidth). */
const PLAY_COUNTS_TTL_MS = 90_000;
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
let playCountsInflight: Promise<Record<string, number>> | null = null;

const leaderboardTopCache = new Map<string, LeaderboardTopEntry>();
const leaderboardTopInflight = new Map<string, Promise<LeaderboardEntry[]>>();

// ─── Play counts ─────────────────────────────────────────────────────────────

export async function cachedFetchAllPlayCounts(
  fetcher: () => Promise<Record<string, number>>
): Promise<Record<string, number>> {
  const now = Date.now();

  if (playCountsEntry && now - playCountsEntry.fetchedAt < PLAY_COUNTS_TTL_MS) {
    return playCountsEntry.counts;
  }

  if (playCountsInflight) return playCountsInflight;

  playCountsInflight = (async () => {
    try {
      const counts = await fetcher();
      playCountsEntry = { counts, fetchedAt: Date.now() };
      return counts;
    } finally {
      playCountsInflight = null;
    }
  })();

  return playCountsInflight;
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

export function getPlayCountsCacheAgeMs(): number | null {
  return playCountsEntry ? Date.now() - playCountsEntry.fetchedAt : null;
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

  const inflight = leaderboardTopInflight.get(gameId);
  if (inflight) return inflight;

  const promise = (async () => {
    try {
      const entries = await fetcher();
      leaderboardTopCache.set(gameId, { entries, fetchedAt: Date.now() });
      return entries;
    } finally {
      leaderboardTopInflight.delete(gameId);
    }
  })();

  leaderboardTopInflight.set(gameId, promise);
  return promise;
}

export function invalidateLeaderboardTopCache(gameId: string): void {
  leaderboardTopCache.delete(gameId);
}

// ─── Contest leaderboard top mirror ──────────────────────────────────────────

const contestLeaderboardTopCache = new Map<string, LeaderboardTopEntry>();
const contestLeaderboardTopInflight = new Map<
  string,
  Promise<LeaderboardEntry[]>
>();

function contestCacheKey(gameId: string, startedAt: number): string {
  return `${gameId}:${startedAt}`;
}

export async function cachedFetchContestLeaderboardTop(
  gameId: string,
  contestStartedAt: number,
  fetcher: () => Promise<LeaderboardEntry[]>
): Promise<LeaderboardEntry[]> {
  const now = Date.now();
  const key = contestCacheKey(gameId, contestStartedAt);
  const entry = contestLeaderboardTopCache.get(key);

  if (entry && now - entry.fetchedAt < LEADERBOARD_TOP_TTL_MS) {
    return entry.entries;
  }

  const inflight = contestLeaderboardTopInflight.get(key);
  if (inflight) return inflight;

  const promise = (async () => {
    try {
      const entries = await fetcher();
      contestLeaderboardTopCache.set(key, { entries, fetchedAt: Date.now() });
      return entries;
    } finally {
      contestLeaderboardTopInflight.delete(key);
    }
  })();

  contestLeaderboardTopInflight.set(key, promise);
  return promise;
}

export function invalidateContestLeaderboardTopCache(
  gameId: string,
  contestStartedAt: number
): void {
  contestLeaderboardTopCache.delete(contestCacheKey(gameId, contestStartedAt));
}

/** Expose stats for metrics logging. */
export function getRtdbCacheStats() {
  return {
    playCountsCached: playCountsEntry !== null,
    playCountsAgeMs: playCountsEntry
      ? Date.now() - playCountsEntry.fetchedAt
      : null,
    leaderboardTopCached: leaderboardTopCache.size,
  };
}
