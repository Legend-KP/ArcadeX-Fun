/**
 * In-memory Firestore game cache with circuit breaker + request coalescing.
 *
 * Cloudflare Workers reuse warm isolates, so module-level state persists across
 * requests on the same isolate. Treat this as a performance bonus — not a
 * shared global cache across all instances. Public catalog responses should
 * also set CDN Cache-Control headers.
 *
 * Circuit breaker: after 3 consecutive Firestore failures the breaker opens
 * for 30 s (stale data), then half-opens for a single probe.
 */

import { Game } from "@/types";

// ─── TTLs ────────────────────────────────────────────────────────────────────

const LIST_TTL_MS = 60_000; // 60 s for the full game list
const DOC_TTL_MS = 300_000; // 5 min for individual game docs
const CB_FAILURE_THRESHOLD = 3;
const CB_OPEN_DURATION_MS = 30_000;

// ─── Types ───────────────────────────────────────────────────────────────────

interface ListEntry {
  games: Game[];
  fetchedAt: number;
}

interface DocEntry {
  game: Game | null;
  fetchedAt: number;
}

type CircuitState = "closed" | "open" | "half-open";

// ─── State ───────────────────────────────────────────────────────────────────

let listEntry: ListEntry | null = null;
let staleListFallback: Game[] | null = null;
let listInflight: Promise<Game[]> | null = null;

const docEntries = new Map<string, DocEntry>();
const staleDocFallback = new Map<string, Game | null>();
const docInflight = new Map<string, Promise<Game | null>>();

let cbFailures = 0;
let cbOpenedAt = 0;
let cbHalfOpenProbe = false;

// ─── Circuit breaker helpers ──────────────────────────────────────────────────

function circuitState(): CircuitState {
  if (cbFailures < CB_FAILURE_THRESHOLD) return "closed";
  if (Date.now() - cbOpenedAt < CB_OPEN_DURATION_MS) return "open";
  return "half-open";
}

function circuitIsOpen(): boolean {
  return circuitState() === "open";
}

function recordSuccess(): void {
  cbFailures = 0;
  cbOpenedAt = 0;
  cbHalfOpenProbe = false;
}

function recordFailure(): void {
  cbFailures += 1;
  if (cbFailures >= CB_FAILURE_THRESHOLD) {
    cbOpenedAt = Date.now();
    cbHalfOpenProbe = false;
  }
}

/** Client errors must not open the breaker — only transport / 5xx outages. */
export function isFirestoreOutageError(err: unknown): boolean {
  if (!(err instanceof Error)) return true;
  const msg = err.message;
  if (/\b(400|401|403|404)\b/.test(msg)) return false;
  return true;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Wraps a function that fetches the full game list from Firestore.
 * Returns cached data when fresh, stale data when the circuit is open.
 * Concurrent misses coalesce into one upstream request.
 */
export async function cachedFetchGameList(
  fetcher: () => Promise<Game[]>
): Promise<Game[]> {
  const now = Date.now();

  if (listEntry && now - listEntry.fetchedAt < LIST_TTL_MS) {
    return listEntry.games;
  }

  const state = circuitState();
  if (state === "open") {
    if (staleListFallback !== null) return staleListFallback;
  }

  if (state === "half-open" && cbHalfOpenProbe) {
    if (staleListFallback !== null) return staleListFallback;
  }

  if (listInflight) return listInflight;

  if (state === "half-open") {
    cbHalfOpenProbe = true;
  }

  listInflight = (async () => {
    try {
      const games = await fetcher();
      recordSuccess();
      listEntry = { games, fetchedAt: Date.now() };
      staleListFallback = games;
      return games;
    } catch (err) {
      if (isFirestoreOutageError(err)) {
        recordFailure();
      }
      if (staleListFallback !== null) return staleListFallback;
      throw err;
    } finally {
      listInflight = null;
      cbHalfOpenProbe = false;
    }
  })();

  return listInflight;
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

  const state = circuitState();
  if (state === "open") {
    const stale = staleDocFallback.get(id);
    if (stale !== undefined) return stale;
  }

  const existingInflight = docInflight.get(id);
  if (existingInflight) return existingInflight;

  const promise = (async () => {
    try {
      const game = await fetcher();
      recordSuccess();
      docEntries.set(id, { game, fetchedAt: Date.now() });
      staleDocFallback.set(id, game);
      return game;
    } catch (err) {
      if (isFirestoreOutageError(err)) {
        recordFailure();
      }
      const stale = staleDocFallback.get(id);
      if (stale !== undefined) return stale;
      throw err;
    } finally {
      docInflight.delete(id);
    }
  })();

  docInflight.set(id, promise);
  return promise;
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
    cbState: circuitState(),
  };
}
