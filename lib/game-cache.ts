/**
 * In-memory Firestore game cache with circuit breaker.
 *
 * Cloudflare Workers use a single isolate per request, so this cache lives for
 * the duration of one Worker invocation. When the Worker is kept warm between
 * requests the module-level variables persist, giving effective TTL-based
 * caching without any external store.
 *
 * Circuit breaker: after 3 consecutive Firestore failures the breaker opens
 * for 30 s, serving stale data and preventing quota hammering during outages.
 */

import { Game } from "@/types";

// ─── TTLs ────────────────────────────────────────────────────────────────────

const LIST_TTL_MS = 60_000;       // 60 s for the full game list
const DOC_TTL_MS = 300_000;       // 5 min for individual game docs
const CB_FAILURE_THRESHOLD = 3;   // open after N consecutive failures
const CB_OPEN_DURATION_MS = 30_000; // stay open for 30 s

// ─── Types ───────────────────────────────────────────────────────────────────

interface ListEntry {
  games: Game[];
  fetchedAt: number;
}

interface DocEntry {
  game: Game | null;
  fetchedAt: number;
}

// ─── State ───────────────────────────────────────────────────────────────────

let listEntry: ListEntry | null = null;
let staleListFallback: Game[] | null = null;

const docEntries = new Map<string, DocEntry>();
const staleDocFallback = new Map<string, Game | null>();

let cbFailures = 0;
let cbOpenedAt = 0;

// ─── Circuit breaker helpers ──────────────────────────────────────────────────

function circuitIsOpen(): boolean {
  if (cbFailures < CB_FAILURE_THRESHOLD) return false;
  return Date.now() - cbOpenedAt < CB_OPEN_DURATION_MS;
}

function recordSuccess(): void {
  cbFailures = 0;
  cbOpenedAt = 0;
}

function recordFailure(): void {
  cbFailures += 1;
  if (cbFailures >= CB_FAILURE_THRESHOLD) {
    cbOpenedAt = Date.now();
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Wraps a function that fetches the full game list from Firestore.
 * Returns cached data when fresh, stale data when the circuit is open.
 */
export async function cachedFetchGameList(
  fetcher: () => Promise<Game[]>
): Promise<Game[]> {
  const now = Date.now();

  if (listEntry && now - listEntry.fetchedAt < LIST_TTL_MS) {
    return listEntry.games;
  }

  if (circuitIsOpen()) {
    if (staleListFallback !== null) return staleListFallback;
    // circuit open but no stale data yet — let it through once
  }

  try {
    const games = await fetcher();
    recordSuccess();
    listEntry = { games, fetchedAt: now };
    staleListFallback = games;
    return games;
  } catch (err) {
    recordFailure();
    if (staleListFallback !== null) return staleListFallback;
    throw err;
  }
}

/**
 * Wraps a function that fetches a single game doc from Firestore.
 */
export async function cachedFetchGameDoc(
  id: string,
  fetcher: () => Promise<Game | null>
): Promise<Game | null> {
  const now = Date.now();
  const entry = docEntries.get(id);

  if (entry && now - entry.fetchedAt < DOC_TTL_MS) {
    return entry.game;
  }

  if (circuitIsOpen()) {
    const stale = staleDocFallback.get(id);
    if (stale !== undefined) return stale;
  }

  try {
    const game = await fetcher();
    recordSuccess();
    docEntries.set(id, { game, fetchedAt: now });
    staleDocFallback.set(id, game);
    return game;
  } catch (err) {
    recordFailure();
    const stale = staleDocFallback.get(id);
    if (stale !== undefined) return stale;
    throw err;
  }
}

/**
 * Invalidate the list cache and optionally one doc cache entry.
 * Call after any admin create / update / delete / reorder.
 */
export function invalidateGameCache(gameId?: string): void {
  listEntry = null;
  if (gameId) {
    docEntries.delete(gameId);
  } else {
    docEntries.clear();
  }
}

/** Expose cache health for metrics. */
export function getGameCacheStats() {
  return {
    listCached: listEntry !== null,
    listAgeMs: listEntry ? Date.now() - listEntry.fetchedAt : null,
    docsCached: docEntries.size,
    cbFailures,
    cbOpen: circuitIsOpen(),
  };
}
