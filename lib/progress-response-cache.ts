/**
 * Short-lived GET progress response cache.
 *
 * Unity bootstraps can poll GET /api/games/[id]/progress rapidly.
 * This cache deduplicates identical requests within an 8-second window
 * per (playerId, gameId) key, eliminating redundant RTDB reads.
 */

import { GameProgress } from "@/types";

const CACHE_TTL_MS = 8_000;

interface CacheEntry {
  progress: GameProgress;
  hasLeaderboard: boolean;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(playerId: string, gameId: string): string {
  return `${playerId}::${gameId}`;
}

export async function cachedGetProgress(
  playerId: string,
  gameId: string,
  fetcher: () => Promise<{ progress: GameProgress; hasLeaderboard: boolean }>
): Promise<{ progress: GameProgress; hasLeaderboard: boolean }> {
  const key = cacheKey(playerId, gameId);
  const now = Date.now();
  const entry = cache.get(key);

  if (entry && now - entry.fetchedAt < CACHE_TTL_MS) {
    return { progress: entry.progress, hasLeaderboard: entry.hasLeaderboard };
  }

  const result = await fetcher();
  cache.set(key, { ...result, fetchedAt: now });
  return result;
}

/**
 * Invalidate a cached progress entry after a write so the next read
 * reflects the new value without waiting for TTL expiry.
 */
export function invalidateProgressCache(playerId: string, gameId: string): void {
  cache.delete(cacheKey(playerId, gameId));
}
