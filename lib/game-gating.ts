import type { Game } from "@/types";
import {
  rtdbDelete,
  rtdbRead,
  rtdbWrite,
} from "@/lib/rtdb-rest";

export interface GameGatingFlags {
  active: boolean;
  live: boolean;
  hasLeaderboard: boolean;
  contestTask?: string;
  contestStartedAt?: number;
  contestEndsAt?: number;
  contestDurationDays?: number;
  contestLive?: boolean;
  /** Schema / sync marker for reconciliation. */
  updatedAt?: number;
  schemaVersion?: number;
}

const GATING_SCHEMA_VERSION = 1;
const GATING_TTL_MS = 45_000;
/** Short negative cache so missing flags don't hammer RTDB/Firestore. */
const GATING_NEGATIVE_TTL_MS = 15_000;
const SYNC_MAX_RETRIES = 3;

type CacheEntry =
  | { kind: "hit"; data: GameGatingFlags; fetchedAt: number }
  | { kind: "miss"; fetchedAt: number };

let gatingCache = new Map<string, CacheEntry>();
const gatingInflight = new Map<string, Promise<GameGatingFlags | null>>();

export function gameToGatingFlags(game: Game): GameGatingFlags {
  return {
    active: game.active !== false,
    live: game.live !== false,
    hasLeaderboard: game.hasLeaderboard !== false,
    ...(game.contestTask ? { contestTask: game.contestTask } : {}),
    ...(typeof game.contestStartedAt === "number"
      ? { contestStartedAt: game.contestStartedAt }
      : {}),
    ...(typeof game.contestEndsAt === "number"
      ? { contestEndsAt: game.contestEndsAt }
      : {}),
    ...(typeof game.contestDurationDays === "number"
      ? { contestDurationDays: game.contestDurationDays }
      : {}),
    ...(game.contestLive !== undefined ? { contestLive: game.contestLive } : {}),
    updatedAt: Date.now(),
    schemaVersion: GATING_SCHEMA_VERSION,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Firestore mutation succeeded — mirror flags to RTDB with bounded retries.
 * Failures are logged; callers should not fail the admin mutation.
 */
export async function syncGatingAfterMutation(game: Game): Promise<void> {
  const flags = gameToGatingFlags(game);
  let lastError: unknown;

  for (let attempt = 0; attempt < SYNC_MAX_RETRIES; attempt++) {
    try {
      await rtdbWrite(`gameGating/${game.id}`, flags, { silent: true });
      invalidateGameFlagsCache(game.id);
      gatingCache.set(game.id, {
        kind: "hit",
        data: flags,
        fetchedAt: Date.now(),
      });
      return;
    } catch (err) {
      lastError = err;
      await sleep(100 * 2 ** attempt);
    }
  }

  console.error(
    JSON.stringify({
      type: "arcadex_gating_sync_failed",
      gameId: game.id,
      error: lastError instanceof Error ? lastError.message : String(lastError),
    })
  );
}

/** @deprecated Prefer syncGatingAfterMutation */
export async function syncGameGatingFlagsToRtdb(game: Game): Promise<void> {
  await syncGatingAfterMutation(game);
}

export async function removeGameGatingFromRtdb(gameId: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < SYNC_MAX_RETRIES; attempt++) {
    try {
      await rtdbDelete(`gameGating/${gameId}`, { silent: true });
      invalidateGameFlagsCache(gameId);
      gatingCache.set(gameId, { kind: "miss", fetchedAt: Date.now() });
      return;
    } catch (err) {
      lastError = err;
      await sleep(100 * 2 ** attempt);
    }
  }
  console.error(
    JSON.stringify({
      type: "arcadex_gating_delete_failed",
      gameId,
      error: lastError instanceof Error ? lastError.message : String(lastError),
    })
  );
}

export async function fetchGameGatingFromRtdb(
  gameId: string
): Promise<GameGatingFlags | null> {
  const cached = gatingCache.get(gameId);
  const now = Date.now();
  if (cached?.kind === "hit" && now - cached.fetchedAt < GATING_TTL_MS) {
    return cached.data;
  }
  if (
    cached?.kind === "miss" &&
    now - cached.fetchedAt < GATING_NEGATIVE_TTL_MS
  ) {
    return null;
  }

  const inflight = gatingInflight.get(gameId);
  if (inflight) return inflight;

  const promise = (async () => {
    try {
      const data = await rtdbRead<GameGatingFlags>(`gameGating/${gameId}`);
      if (!data) {
        gatingCache.set(gameId, { kind: "miss", fetchedAt: Date.now() });
        return null;
      }
      gatingCache.set(gameId, {
        kind: "hit",
        data,
        fetchedAt: Date.now(),
      });
      return data;
    } catch {
      // Distinguish outage from miss: do not negative-cache on transport errors.
      return null;
    } finally {
      gatingInflight.delete(gameId);
    }
  })();

  gatingInflight.set(gameId, promise);
  return promise;
}

/**
 * Hot-path gating resolution:
 * 1. RTDB gameGating/{gameId}
 * 2. On miss → at most one Firestore lookup (coalesced), best-effort backfill
 */
export async function resolveGameGating(
  gameId: string,
  fetchGameFromFirestore: (id: string) => Promise<Game | null>
): Promise<GameGatingFlags | null> {
  const fromRtdb = await fetchGameGatingFromRtdb(gameId);
  if (fromRtdb) return fromRtdb;

  const game = await fetchGameFromFirestore(gameId);
  if (!game) {
    gatingCache.set(gameId, { kind: "miss", fetchedAt: Date.now() });
    return null;
  }

  const flags = gameToGatingFlags(game);
  gatingCache.set(gameId, {
    kind: "hit",
    data: flags,
    fetchedAt: Date.now(),
  });

  // Best-effort backfill — do not block the response on RTDB write.
  void syncGatingAfterMutation(game).catch(() => {});

  return flags;
}

export function invalidateGameFlagsCache(gameId?: string): void {
  if (gameId) {
    gatingCache.delete(gameId);
  } else {
    gatingCache = new Map();
  }
}

export type GatingReconcileReport = {
  missingInRtdb: string[];
  orphanInRtdb: string[];
  mismatched: Array<{
    gameId: string;
    field: string;
    firestore: unknown;
    rtdb: unknown;
  }>;
  repaired: string[];
};

/**
 * Admin-only: compare Firestore games against RTDB gating flags.
 * Does not run on player-facing requests.
 */
export async function reconcileGameGating(opts: {
  listGames: () => Promise<Game[]>;
  listRtdbKeys: () => Promise<string[]>;
  repair?: boolean;
}): Promise<GatingReconcileReport> {
  const games = await opts.listGames();
  const rtdbKeys = await opts.listRtdbKeys();
  const gameIds = new Set(games.map((g) => g.id));
  const rtdbKeySet = new Set(rtdbKeys);

  const report: GatingReconcileReport = {
    missingInRtdb: [],
    orphanInRtdb: [],
    mismatched: [],
    repaired: [],
  };

  for (const key of rtdbKeys) {
    if (!gameIds.has(key)) {
      report.orphanInRtdb.push(key);
    }
  }

  for (const game of games) {
    const expected = gameToGatingFlags(game);
    if (!rtdbKeySet.has(game.id)) {
      report.missingInRtdb.push(game.id);
      if (opts.repair) {
        await syncGatingAfterMutation(game);
        report.repaired.push(game.id);
      }
      continue;
    }

    const actual = await rtdbRead<GameGatingFlags>(`gameGating/${game.id}`);
    if (!actual) {
      report.missingInRtdb.push(game.id);
      if (opts.repair) {
        await syncGatingAfterMutation(game);
        report.repaired.push(game.id);
      }
      continue;
    }

    for (const field of ["active", "live", "hasLeaderboard"] as const) {
      if (Boolean(actual[field]) !== Boolean(expected[field])) {
        report.mismatched.push({
          gameId: game.id,
          field,
          firestore: expected[field],
          rtdb: actual[field],
        });
      }
    }

    if (
      opts.repair &&
      report.mismatched.some((m) => m.gameId === game.id)
    ) {
      await syncGatingAfterMutation(game);
      report.repaired.push(game.id);
    }
  }

  return report;
}
