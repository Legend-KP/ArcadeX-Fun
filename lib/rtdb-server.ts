import type { Hash } from "viem";
import {
  GameProgress,
  CONTEST_TOP_MAX_ENTRIES,
  LEADERBOARD_MAX_ENTRIES,
  LeaderboardEntry,
  PlayerProfile,
  SparkSnapshot,
  StoredGameProgress,
  StoredSparkState,
} from "@/types";
import {
  cachedFetchAllPlayCounts,
  bumpCachedPlayCount,
  cachedFetchLeaderboardTop,
  invalidateLeaderboardTopCache,
  cachedFetchContestLeaderboardTop,
  invalidateContestLeaderboardTopCache,
} from "@/lib/rtdb-cache";
import {
  rtdbDelete,
  rtdbPatch,
  rtdbRead,
  rtdbReadWithEtag,
  rtdbRequest,
  rtdbWrite,
  rtdbWriteIfMatch,
} from "@/lib/rtdb-rest";
import { getLeaderboardRtdbConnection, getPlayerRtdbConnection, type RtdbConnection } from "@/lib/rtdb-resolver";
import {
  isEvmAddress,
  isValidAddress,
  isVaraAddress,
  normalizeAddress,
  normalizeEvmAddress,
  normalizeVaraAddress,
  parsePlayerId,
  resolvePlayerId,
  type WalletEcosystem,
} from "@/lib/player-identity";
import {
  computeSparkSnapshot,
  defaultSparkState,
  coerceSparkState,
  normalizeSparkState,
} from "@/lib/spark";
import { INFINITE_SPARKS_MS, type ShopProductId } from "@/lib/shop";
import { isWalletAddress, normalizeWalletAddress } from "@/lib/wallet-address";
import { toVaraActorId, toVaraSs58 } from "@/lib/vara-address";
import { SHUFFLE_DAILY_USDC_BUDGET_MICRO } from "@/lib/shuffle-outcomes";

/** Absolute max a client/API may request for leaderboard downloads. */
export const LEADERBOARD_ABSOLUTE_MAX = 50;

/** EVM checksum or Vara SS58 — for streak/shuffle RTDB keys. */
function normalizeRewardsWallet(walletAddress: string): string {
  const trimmed = walletAddress.trim();
  if (isEvmAddress(trimmed)) return normalizeEvmAddress(trimmed);
  if (isVaraAddress(trimmed)) return normalizeVaraAddress(trimmed);
  throw new Error("Invalid wallet address");
}

function isRewardsWallet(walletAddress: string | null | undefined): boolean {
  return isEvmAddress(walletAddress) || isVaraAddress(walletAddress);
}

type StoredUser = Omit<PlayerProfile, "id">;
type LeaderboardMap = Record<string, LeaderboardEntry>;

const RTDB_TRANSACTION_MAX_RETRIES = 8;

function clampLeaderboardLimit(limit: number, fallback: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return fallback;
  return Math.min(Math.floor(limit), LEADERBOARD_ABSOLUTE_MAX);
}

function profilePath(playerId: string): string {
  const resolved = resolvePlayerId(playerId);
  if (!resolved) {
    throw new Error("User profile requires a valid player id.");
  }
  return `users/${resolved}`;
}

function resolvePlayerFields(
  id: string,
  walletAddress?: string,
  ecosystem?: WalletEcosystem
): { playerId: string; address: string; ecosystem: WalletEcosystem } | null {
  const fromId = resolvePlayerId(id);
  if (fromId) {
    const parsed = parsePlayerId(fromId)!;
    return {
      playerId: fromId,
      address: parsed.address,
      ecosystem: parsed.ecosystem,
    };
  }

  if (walletAddress && ecosystem && isValidAddress(ecosystem, walletAddress)) {
    const address = normalizeAddress(ecosystem, walletAddress);
    return {
      playerId: `${ecosystem}:${address}`,
      address,
      ecosystem,
    };
  }

  return null;
}

async function readPath<T>(
  path: string,
  connection?: RtdbConnection
): Promise<T | null> {
  return rtdbRead<T>(path, undefined, connection);
}

async function writePath(
  path: string,
  data: unknown,
  connection?: RtdbConnection
): Promise<void> {
  await rtdbWrite(path, data, { silent: true, connection });
}

async function patchPath(
  path: string,
  data: unknown,
  connection?: RtdbConnection
): Promise<void> {
  await rtdbPatch(path, data, { silent: true, connection });
}

async function deletePath(
  path: string,
  connection?: RtdbConnection
): Promise<void> {
  await rtdbDelete(path, { silent: true, connection });
}

/** GET with ETag for conditional writes (REST transactions). */
async function readPathWithEtag<T>(
  path: string,
  connection?: RtdbConnection
): Promise<{ data: T | null; etag: string }> {
  return rtdbReadWithEtag<T>(path, { connection });
}

async function writePathIfMatch(
  path: string,
  data: unknown,
  etag: string,
  connection?: RtdbConnection
): Promise<"ok" | "conflict"> {
  return rtdbWriteIfMatch(path, data, etag, { connection });
}

/**
 * Conditional write with automatic retry (RTDB REST transaction via ETag).
 * Return `undefined` from `updateFn` to abort without writing.
 */
async function runRtdbTransaction<T>(
  path: string,
  updateFn: (current: T | null) => T | undefined,
  maxRetries = RTDB_TRANSACTION_MAX_RETRIES,
  connection?: RtdbConnection
): Promise<{ committed: boolean; snapshot: T | null }> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { data, etag } = await readPathWithEtag<T>(path, connection);
    const next = updateFn(data);
    if (next === undefined) {
      return { committed: false, snapshot: data };
    }

    const result = await writePathIfMatch(path, next, etag, connection);
    if (result === "ok") {
      return { committed: true, snapshot: next };
    }
  }

  throw new Error("Realtime Database transaction failed after max retries.");
}

export type PlayerChainScope = {
  chainId?: number | null;
  ecosystem?: WalletEcosystem | null;
};

function playerConnection(scope?: PlayerChainScope): RtdbConnection {
  return getPlayerRtdbConnection({
    chainId: scope?.chainId,
    ecosystem: scope?.ecosystem,
  });
}

type GuardRecord = { wallet?: string } & Record<string, unknown>;

type GuardClaimResult<T extends GuardRecord> =
  | { status: "created"; record: T }
  | { status: "exists"; record: T }
  | { status: "conflict_other_wallet" };

/**
 * Atomically claim a one-time payment/reward guard.
 * Only one concurrent caller can create the marker for a given tx hash.
 */
async function claimGuardRecord<T extends GuardRecord>(
  path: string,
  wallet: string,
  buildRecord: () => T,
  connection?: RtdbConnection
): Promise<GuardClaimResult<T>> {
  let createdRecord: T | null = null;
  let existsRecord: T | null = null;
  let conflictOther = false;

  const { committed, snapshot } = await runRtdbTransaction<T>(
    path,
    (current) => {
      if (current?.wallet) {
        const recorded = normalizeWalletAddress(String(current.wallet));
        if (recorded === wallet) {
          existsRecord = current;
          return undefined;
        }
        conflictOther = true;
        return undefined;
      }

      const record = buildRecord();
      createdRecord = record;
      return record;
    },
    RTDB_TRANSACTION_MAX_RETRIES,
    connection
  );

  if (createdRecord && committed) {
    return { status: "created", record: createdRecord };
  }
  if (existsRecord) {
    return { status: "exists", record: existsRecord };
  }
  if (conflictOther) {
    return { status: "conflict_other_wallet" };
  }

  const existing = snapshot ?? (await readPath<T>(path, connection));
  if (existing?.wallet) {
    const recorded = normalizeWalletAddress(String(existing.wallet));
    if (recorded === wallet) {
      return { status: "exists", record: existing };
    }
    return { status: "conflict_other_wallet" };
  }

  throw new Error("Failed to claim payment guard.");
}

/** Map Base/EVM wallet → Fun player id (`evm:0x…`) for spark storage. */
function walletToPlayerId(walletAddress: string): string {
  const playerId = resolvePlayerId(walletAddress);
  if (!playerId) {
    throw new Error("A valid wallet address is required.");
  }
  return playerId;
}

function toPlayerProfile(id: string, data: StoredUser | null): PlayerProfile | null {
  if (!data) return null;
  return { id, ...data };
}

function mapToLeaderboardEntries(map: LeaderboardMap | null): LeaderboardEntry[] {
  if (!map) return [];
  return Object.values(map);
}

/** Stable identity for deduping — wallet preferred, name fallback. */
function leaderboardUserKey(entry: LeaderboardEntry): string {
  if (entry.walletAddress?.trim()) {
    return `wallet:${entry.walletAddress.trim().toLowerCase()}`;
  }
  return `name:${entry.name.trim().toLowerCase()}`;
}

/** RTDB-safe key for per-user storage (wallet or sanitized name). */
function leaderboardStorageKey(entry: LeaderboardEntry): string {
  if (entry.walletAddress?.trim()) {
    return entry.walletAddress.trim().replace(/[.#$[\]/]/g, "_");
  }
  return `name_${entry.name.trim().toLowerCase().replace(/[.#$[\]/]/g, "_")}`;
}

function deduplicateLeaderboardEntries(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  const best = new Map<string, LeaderboardEntry>();
  for (const entry of entries) {
    const key = leaderboardUserKey(entry);
    const current = best.get(key);
    if (!current || entry.score > current.score) {
      best.set(key, entry);
    }
  }
  return Array.from(best.values());
}

// ─── Users ───────────────────────────────────────────────────────────────────

export async function fetchUserFromServer(
  id: string,
  scope?: PlayerChainScope
): Promise<PlayerProfile | null> {
  const resolved = resolvePlayerId(id);
  if (!resolved) return null;

  const connection = playerConnection({
    chainId: scope?.chainId,
    ecosystem: scope?.ecosystem ?? parsePlayerId(resolved)?.ecosystem,
  });
  const data = await readPath<StoredUser>(profilePath(resolved), connection);
  if (!data) return null;
  return toPlayerProfile(resolved, data);
}

export async function upsertUserOnServer(
  id: string,
  data: {
    name: string;
    walletAddress?: string;
    email?: string;
    ecosystem?: WalletEcosystem;
    chainId?: number;
  }
): Promise<PlayerProfile> {
  const fields = resolvePlayerFields(id, data.walletAddress, data.ecosystem);
  if (!fields) {
    throw new Error("A valid player id or wallet address is required.");
  }

  const scope: PlayerChainScope = {
    chainId: data.chainId,
    ecosystem: fields.ecosystem,
  };
  const connection = playerConnection(scope);

  const existing = await fetchUserFromServer(fields.playerId, scope);
  const now = Date.now();
  const email = data.email?.trim() || existing?.email;

  const stored: StoredUser = {
    name: data.name.trim(),
    walletAddress: fields.address,
    ecosystem: fields.ecosystem,
    ...(email ? { email } : {}),
    ...(typeof data.chainId === "number" ? { chainId: data.chainId } : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await writePath(profilePath(fields.playerId), stored, connection);
  return toPlayerProfile(fields.playerId, stored)!;
}

export async function bootstrapUserOnServer(
  playerId: string,
  opts?: { ecosystem?: WalletEcosystem; chainId?: number }
): Promise<PlayerProfile> {
  const resolved = resolvePlayerId(playerId);
  if (!resolved) {
    throw new Error("bootstrap requires a valid player id.");
  }

  const parsed = parsePlayerId(resolved)!;
  const scope: PlayerChainScope = {
    chainId: opts?.chainId,
    ecosystem: opts?.ecosystem ?? parsed.ecosystem,
  };
  const connection = playerConnection(scope);
  const existing = await fetchUserFromServer(resolved, scope);

  if (!existing) {
    const now = Date.now();
    const stored: StoredUser = {
      name: "",
      walletAddress: parsed.address,
      ecosystem: opts?.ecosystem ?? parsed.ecosystem,
      ...(typeof opts?.chainId === "number" ? { chainId: opts.chainId } : {}),
      createdAt: now,
      updatedAt: now,
    };
    await writePath(profilePath(resolved), stored, connection);
    await writePath(sparksPath(resolved), defaultSparkState(), connection);
    return toPlayerProfile(resolved, stored)!;
  }

  await ensureSparkStateOnServer(resolved, scope);
  return existing;
}

// ─── Game play counts ──────────────────────────────────────────────────────────

/** Normalize a play-count leaf (number, or legacy push-map from mistaken POSTs). */
function coercePlayCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  if (value && typeof value === "object") {
    // Legacy bug: POST created push children like { "-Nxxx": 1, ... }
    let total = 0;
    for (const child of Object.values(value as Record<string, unknown>)) {
      if (typeof child === "number" && Number.isFinite(child)) {
        total += Math.max(0, Math.floor(child));
      } else {
        total += 1;
      }
    }
    return total;
  }
  return 0;
}

export async function fetchAllGamePlayCounts(): Promise<Record<string, number>> {
  return cachedFetchAllPlayCounts(async () => {
    // Aggregate counts only — leaves are numbers (or legacy maps coerced below).
    const data = await readPath<Record<string, unknown>>("gamePlays");
    if (!data) return {};

    const counts: Record<string, number> = {};
    for (const [gameId, value] of Object.entries(data)) {
      counts[gameId] = coercePlayCount(value);
    }
    return counts;
  });
}

export async function fetchGamePlayCount(gameId: string): Promise<number> {
  const count = await readPath<unknown>(`gamePlays/${gameId}`);
  return coercePlayCount(count);
}

export async function incrementGamePlayCount(gameId: string): Promise<number> {
  // Repair legacy push-map nodes (created by mistaken POST increments) into a number.
  const existing = await readPath<unknown>(`gamePlays/${gameId}`);
  if (existing && typeof existing === "object") {
    const repaired = coercePlayCount(existing);
    await writePath(`gamePlays/${gameId}`, repaired);
  }

  // Atomic server-side increment at the leaf. Keep the response body so we
  // avoid a follow-up GET for the new count.
  const res = await rtdbRequest(`gamePlays/${gameId}`, {
    method: "PUT",
    body: JSON.stringify({ ".sv": { increment: 1 } }),
  });

  if (!res.ok) {
    const { committed, snapshot } = await runRtdbTransaction<number>(
      `gamePlays/${gameId}`,
      (current) => coercePlayCount(current) + 1
    );
    bumpCachedPlayCount(gameId);
    return committed ? (snapshot ?? 0) : await fetchGamePlayCount(gameId);
  }

  bumpCachedPlayCount(gameId);
  const body = (await res.json()) as number | null;
  return typeof body === "number" ? body : await fetchGamePlayCount(gameId);
}

// ─── Leaderboard ─────────────────────────────────────────────────────────────

export type LeaderboardChainScope = {
  chainId?: number | null;
  ecosystem?: WalletEcosystem | null;
};

function leaderboardConnection(scope?: LeaderboardChainScope): RtdbConnection {
  return getLeaderboardRtdbConnection({
    chainId: scope?.chainId,
    ecosystem: scope?.ecosystem,
  });
}

async function fetchLeaderboardTopQuery(
  basePath: string,
  limit: number,
  connection: RtdbConnection
): Promise<LeaderboardEntry[]> {
  const clamped = clampLeaderboardLimit(limit, LEADERBOARD_MAX_ENTRIES);
  try {
    // Indexed orderBy + limitToLast downloads only the top-N subtree.
    const map = await rtdbRead<LeaderboardMap>(
      basePath,
      {
        orderBy: "score",
        limitToLast: clamped,
      },
      connection
    );
    return deduplicateLeaderboardEntries(mapToLeaderboardEntries(map))
      .sort((a, b) => b.score - a.score)
      .slice(0, clamped);
  } catch (err) {
    // Fallback while .indexOn("score") is rolling out — still clamp in memory.
    console.warn(
      JSON.stringify({
        type: "arcadex_leaderboard_query_fallback",
        path: basePath,
        connection: connection.label,
        error: err instanceof Error ? err.message : String(err),
      })
    );
    const map = await rtdbRead<LeaderboardMap>(basePath, undefined, connection);
    return deduplicateLeaderboardEntries(mapToLeaderboardEntries(map))
      .sort((a, b) => b.score - a.score)
      .slice(0, clamped);
  }
}

export async function fetchLeaderboardFromServer(
  gameId: string,
  limit = LEADERBOARD_MAX_ENTRIES,
  scope?: LeaderboardChainScope
): Promise<LeaderboardEntry[]> {
  const clamped = clampLeaderboardLimit(limit, LEADERBOARD_MAX_ENTRIES);
  const connection = leaderboardConnection(scope);
  return cachedFetchLeaderboardTop(
    gameId,
    async () =>
      fetchLeaderboardTopQuery(`leaderboards/${gameId}`, clamped, connection),
    connection.label
  );
}

function leaderboardLookupKey(opts: {
  walletAddress?: string;
  playerName?: string;
}): string | null {
  const wallet = opts.walletAddress?.trim();
  if (wallet) {
    return wallet.replace(/[.#$[\]/]/g, "_");
  }
  const name = opts.playerName?.trim();
  if (name) {
    return `name_${name.toLowerCase().replace(/[.#$[\]/]/g, "_")}`;
  }
  return null;
}

export async function fetchUserBestScoreFromServer(
  gameId: string,
  opts: {
    walletAddress?: string;
    playerName?: string;
    chainId?: number | null;
    ecosystem?: WalletEcosystem | null;
  }
): Promise<number> {
  // Path-scoped read — never download the full leaderboard for one player.
  const key = leaderboardLookupKey(opts);
  if (!key) return 0;

  const connection = leaderboardConnection(opts);
  const entry = await rtdbRead<LeaderboardEntry>(
    `leaderboards/${gameId}/${key}`,
    undefined,
    connection
  );
  if (entry && typeof entry.score === "number") {
    return entry.score;
  }

  // Legacy name-key mismatch: only if wallet was provided, try a second key shape.
  // Do not fall back to a full-board scan.
  return 0;
}

export async function fetchUserSubmittedBestFromServer(
  gameId: string,
  opts: {
    walletAddress?: string;
    playerName?: string;
    chainId?: number | null;
    ecosystem?: WalletEcosystem | null;
  }
): Promise<number> {
  return fetchUserBestScoreFromServer(gameId, opts);
}

export async function fetchPersonalBestFromServer(
  playerId: string,
  gameId: string,
  scope?: PlayerChainScope
): Promise<number> {
  const stored = await fetchGameProgressFromServer(playerId, gameId, scope);
  return stored?.s ?? 0;
}

export async function fetchContestLeaderboardFromServer(
  gameId: string,
  contestStartedAt: number,
  limit = CONTEST_TOP_MAX_ENTRIES,
  scope?: LeaderboardChainScope
): Promise<LeaderboardEntry[]> {
  const clamped = clampLeaderboardLimit(limit, CONTEST_TOP_MAX_ENTRIES);
  const connection = leaderboardConnection(scope);
  return cachedFetchContestLeaderboardTop(
    gameId,
    contestStartedAt,
    async () =>
      fetchLeaderboardTopQuery(
        `contestLeaderboards/${gameId}/${contestStartedAt}`,
        clamped,
        connection
      ),
    connection.label
  );
}

async function writeLeaderboardEntry(
  basePath: string,
  entry: LeaderboardEntry,
  invalidate: () => void,
  connection: RtdbConnection
): Promise<boolean> {
  const wallet = entry.walletAddress?.trim();
  const payload: LeaderboardEntry = {
    name: entry.name,
    score: entry.score,
    ...(wallet ? { walletAddress: wallet } : {}),
    createdAt: entry.createdAt ?? Date.now(),
  };

  const storageKey = leaderboardStorageKey(payload);
  const entryPath = `${basePath}/${storageKey}`;

  // Path-scoped compare — do not download the entire leaderboard map.
  const existing = await rtdbRead<LeaderboardEntry>(
    entryPath,
    undefined,
    connection
  );
  if (existing && typeof existing.score === "number" && existing.score >= payload.score) {
    return false;
  }

  await rtdbWrite(entryPath, payload, { silent: true, connection });
  invalidate();
  return true;
}

export async function submitLeaderboardEntryOnServer(
  gameId: string,
  entry: LeaderboardEntry,
  scope?: LeaderboardChainScope
): Promise<void> {
  const connection = leaderboardConnection(scope);
  await writeLeaderboardEntry(
    `leaderboards/${gameId}`,
    entry,
    () => invalidateLeaderboardTopCache(gameId, connection.label),
    connection
  );
}

export async function submitContestLeaderboardEntryOnServer(
  gameId: string,
  contestStartedAt: number,
  entry: LeaderboardEntry,
  scope?: LeaderboardChainScope
): Promise<void> {
  const connection = leaderboardConnection(scope);
  await writeLeaderboardEntry(
    `contestLeaderboards/${gameId}/${contestStartedAt}`,
    entry,
    () =>
      invalidateContestLeaderboardTopCache(
        gameId,
        contestStartedAt,
        connection.label
      ),
    connection
  );
}

function processedScoreSubmitTxPath(
  ecosystem: ShopPurchaseEcosystem,
  txKey: string
): string {
  if (ecosystem === "evm") {
    return `scoreSubmit/processedTxs/${txKey}`;
  }
  return `scoreSubmit/processedTxs/${ecosystem}/${txKey}`;
}

/** Fast path for client retries — skip on-chain verify when tx was already accepted. */
export async function isScoreSubmitTxProcessed(params: {
  txHash: string;
  gameId: string;
  walletAddress: string;
  ecosystem?: ShopPurchaseEcosystem;
  chainId?: number | null;
}): Promise<boolean> {
  const ecosystem = params.ecosystem ?? "evm";
  let txKey: string;
  try {
    txKey = normalizeShopTxKey(ecosystem, params.txHash);
  } catch {
    return false;
  }
  const connection = leaderboardConnection({
    chainId: params.chainId,
    ecosystem,
  });
  const existing = await rtdbRead<{ gameId: string; walletAddress?: string }>(
    processedScoreSubmitTxPath(ecosystem, txKey),
    undefined,
    connection
  );
  if (!existing) return false;
  if (existing.gameId !== params.gameId) return false;
  if (
    existing.walletAddress &&
    existing.walletAddress !== params.walletAddress.trim()
  ) {
    return false;
  }
  return true;
}

export async function submitPublicScoreOnServer(params: {
  gameId: string;
  entry: LeaderboardEntry;
  txHash: string;
  ecosystem?: ShopPurchaseEcosystem;
  contestStartedAt?: number;
  chainId?: number | null;
}): Promise<{ submittedBest: number }> {
  const ecosystem = params.ecosystem ?? "evm";
  const txKey = normalizeShopTxKey(ecosystem, params.txHash);
  const processedPath = processedScoreSubmitTxPath(ecosystem, txKey);
  const scope: LeaderboardChainScope = {
    chainId: params.chainId,
    ecosystem,
  };
  const connection = leaderboardConnection(scope);

  const existing = await rtdbRead<{ gameId: string; walletAddress?: string }>(
    processedPath,
    undefined,
    connection
  );
  if (existing) {
    if (
      existing.gameId !== params.gameId ||
      (existing.walletAddress &&
        params.entry.walletAddress &&
        existing.walletAddress !== params.entry.walletAddress.trim())
    ) {
      throw new ShopPurchaseError(
        "This transaction was already used.",
        "TX_ALREADY_USED"
      );
    }
  } else {
    await rtdbWrite(
      processedPath,
      {
        gameId: params.gameId,
        walletAddress: params.entry.walletAddress?.trim(),
        processedAt: Date.now(),
      },
      { silent: true, connection }
    );
  }

  await submitLeaderboardEntryOnServer(params.gameId, params.entry, scope);

  if (typeof params.contestStartedAt === "number") {
    await submitContestLeaderboardEntryOnServer(
      params.gameId,
      params.contestStartedAt,
      params.entry,
      scope
    );
  }

  const submittedBest = await fetchUserSubmittedBestFromServer(params.gameId, {
    walletAddress: params.entry.walletAddress,
    playerName: params.entry.name,
    chainId: params.chainId,
    ecosystem,
  });

  return { submittedBest };
}

// ─── Per-user game progress ───────────────────────────────────────────────────

function gameProgressPath(playerId: string, gameId: string): string {
  const resolved = resolvePlayerId(playerId);
  if (!resolved) {
    throw new Error("A valid player id is required.");
  }
  return `users/${resolved}/games/${gameId}`;
}

export function storedProgressToGameProgress(
  stored: StoredGameProgress | null,
  hasLeaderboard: boolean
): GameProgress {
  if (!stored) return {};
  if (hasLeaderboard) {
    return stored.s !== undefined ? { score: stored.s } : {};
  }
  return stored.l !== undefined ? { level: stored.l } : {};
}

export async function fetchGameProgressFromServer(
  playerId: string,
  gameId: string,
  scope?: PlayerChainScope
): Promise<StoredGameProgress | null> {
  const resolved = resolvePlayerId(playerId);
  if (!resolved) return null;
  const connection = playerConnection({
    chainId: scope?.chainId,
    ecosystem: scope?.ecosystem ?? parsePlayerId(resolved)?.ecosystem,
  });
  return readPath<StoredGameProgress>(
    gameProgressPath(playerId, gameId),
    connection
  );
}

/**
 * Resolves progress for API / bootstrap from the user node only.
 * Public leaderboard scores are separate (paid submit).
 */
export async function resolveGameProgressFromServer(
  playerId: string,
  gameId: string,
  hasLeaderboard: boolean,
  scope?: PlayerChainScope
): Promise<GameProgress> {
  const resolved = resolvePlayerId(playerId);
  if (!resolved) return {};

  const stored = await fetchGameProgressFromServer(resolved, gameId, scope);
  return storedProgressToGameProgress(stored, hasLeaderboard);
}

export async function saveGameProgressOnServer(
  playerId: string,
  gameId: string,
  value: number,
  hasLeaderboard: boolean,
  opts?: { playerName?: string; chainId?: number | null; ecosystem?: WalletEcosystem | null }
): Promise<GameProgress> {
  const resolved = resolvePlayerId(playerId);
  if (!resolved) {
    throw new Error("A valid player id is required.");
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("value must be a non-negative number.");
  }

  const scope: PlayerChainScope = {
    chainId: opts?.chainId,
    ecosystem: opts?.ecosystem ?? parsePlayerId(resolved)?.ecosystem,
  };
  const connection = playerConnection(scope);

  const current = await fetchGameProgressFromServer(resolved, gameId, scope);
  const field: "s" | "l" = hasLeaderboard ? "s" : "l";
  const currentValue = hasLeaderboard ? (current?.s ?? 0) : (current?.l ?? 0);

  if (value <= currentValue) {
    return storedProgressToGameProgress(current, hasLeaderboard);
  }

  await patchPath(gameProgressPath(resolved, gameId), { [field]: value }, connection);

  const updated: StoredGameProgress = { ...current, [field]: value };
  return storedProgressToGameProgress(updated, hasLeaderboard);
}

// ─── Sparks ───────────────────────────────────────────────────────────────────

function sparksPath(playerId: string): string {
  const resolved = resolvePlayerId(playerId);
  if (!resolved) {
    throw new Error("A valid player id is required.");
  }
  return `users/${resolved}/sparks`;
}

export async function fetchSparkStateFromServer(
  playerId: string,
  scope?: PlayerChainScope
): Promise<StoredSparkState | null> {
  const resolved = resolvePlayerId(playerId);
  if (!resolved) return null;
  const connection = playerConnection({
    chainId: scope?.chainId,
    ecosystem: scope?.ecosystem ?? parsePlayerId(resolved)?.ecosystem,
  });
  return readPath<StoredSparkState>(sparksPath(playerId), connection);
}

export async function ensureSparkStateOnServer(
  playerId: string,
  scope?: PlayerChainScope
): Promise<StoredSparkState> {
  const resolved = resolvePlayerId(playerId);
  if (!resolved) {
    throw new Error("A valid player id is required.");
  }

  const connection = playerConnection({
    chainId: scope?.chainId,
    ecosystem: scope?.ecosystem ?? parsePlayerId(resolved)?.ecosystem,
  });

  const existing = await readPath<unknown>(sparksPath(resolved), connection);
  if (existing) {
    return coerceSparkState(existing);
  }

  const initial = defaultSparkState();
  await writePath(sparksPath(resolved), initial, connection);
  return initial;
}

export async function getSparkSnapshotOnServer(
  playerId: string,
  now = Date.now(),
  scope?: PlayerChainScope
): Promise<{ state: StoredSparkState; sparks: SparkSnapshot }> {
  const state = await ensureSparkStateOnServer(playerId, scope);
  const normalized = normalizeSparkState(state, now);
  return {
    state: normalized,
    sparks: computeSparkSnapshot(normalized, now),
  };
}

export class NoSparksError extends Error {
  readonly code = "NO_SPARKS";

  constructor() {
    super("No Sparks available.");
    this.name = "NoSparksError";
  }
}

export async function spendSparkOnServer(
  playerId: string,
  now = Date.now(),
  scope?: PlayerChainScope
): Promise<{
  state: StoredSparkState;
  sparks: SparkSnapshot;
  spent: boolean;
}> {
  const resolved = resolvePlayerId(playerId);
  if (!resolved) {
    throw new Error("A valid player id is required.");
  }

  const resolvedScope: PlayerChainScope = {
    chainId: scope?.chainId,
    ecosystem: scope?.ecosystem ?? parsePlayerId(resolved)?.ecosystem,
  };
  const connection = playerConnection(resolvedScope);

  const raw = await ensureSparkStateOnServer(resolved, resolvedScope);
  const state = normalizeSparkState(raw, now);

  if (typeof state.infiniteUntil === "number" && state.infiniteUntil > now) {
    return {
      state,
      sparks: computeSparkSnapshot(state, now),
      spent: false,
    };
  }

  const readyIndex = state.slots.findIndex(
    (slot) => slot === null || slot <= now
  );

  if (readyIndex < 0) {
    throw new NoSparksError();
  }

  const nextSlots = [...state.slots];
  nextSlots[readyIndex] = now + state.regenMs;

  const nextState: StoredSparkState = {
    ...state,
    slots: nextSlots,
  };

  await writePath(sparksPath(resolved), nextState, connection);

  return {
    state: nextState,
    sparks: computeSparkSnapshot(nextState, now),
    spent: true,
  };
}

function processedShopTxPath(ecosystem: ShopPurchaseEcosystem, txKey: string): string {
  if (ecosystem === "evm") {
    return `shop/processedTxs/${txKey}`;
  }

  return `shop/processedTxs/${ecosystem}/${txKey}`;
}

type ShopPurchaseEcosystem = "evm" | "sui" | "vara";

export class ShopPurchaseError extends Error {
  constructor(
    message: string,
    readonly code?: string
  ) {
    super(message);
    this.name = "ShopPurchaseError";
  }
}

function normalizeShopTxKey(
  ecosystem: ShopPurchaseEcosystem,
  txHash: string
): string {
  const trimmed = txHash.trim();
  if (ecosystem === "evm" || ecosystem === "vara") {
    const key = trimmed.toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(key)) {
      throw new ShopPurchaseError("Invalid transaction hash.", "INVALID_TX");
    }
    return key;
  }

  if (!/^[1-9A-HJ-NP-Za-km-z]{43,90}$/.test(trimmed)) {
    throw new ShopPurchaseError("Invalid transaction digest.", "INVALID_TX");
  }

  return trimmed;
}

export async function applyShopPurchaseOnServer(
  playerId: string,
  productId: ShopProductId,
  txHash: string,
  ecosystem: ShopPurchaseEcosystem = "evm",
  now = Date.now(),
  scope?: PlayerChainScope
): Promise<{ state: StoredSparkState; sparks: SparkSnapshot }> {
  const resolved = resolvePlayerId(playerId);
  if (!resolved) {
    throw new Error("A valid player id is required.");
  }

  const resolvedScope: PlayerChainScope = {
    chainId: scope?.chainId,
    ecosystem: scope?.ecosystem ?? ecosystem,
  };
  const connection = playerConnection(resolvedScope);

  const txKey = normalizeShopTxKey(ecosystem, txHash);

  const processedPath = processedShopTxPath(ecosystem, txKey);
  const existing = await readPath<{
    playerId: string;
    productId: ShopProductId;
  }>(processedPath, connection);

  if (existing) {
    if (existing.playerId !== resolved || existing.productId !== productId) {
      throw new ShopPurchaseError(
        "This transaction was already used.",
        "TX_ALREADY_USED"
      );
    }

    return getSparkSnapshotOnServer(resolved, now, resolvedScope);
  }

  const raw = await ensureSparkStateOnServer(resolved, resolvedScope);
  const state = normalizeSparkState(raw, now);

  let nextState: StoredSparkState;

  if (productId === "spark-refill") {
    nextState = {
      ...state,
      slots: Array.from({ length: state.max }, () => null),
    };
  } else {
    const base =
      typeof state.infiniteUntil === "number" && state.infiniteUntil > now
        ? state.infiniteUntil
        : now;

    nextState = {
      ...state,
      infiniteUntil: base + INFINITE_SPARKS_MS,
    };
  }

  await writePath(sparksPath(resolved), nextState, connection);
  await writePath(
    processedPath,
    {
      playerId: resolved,
      productId,
      processedAt: now,
    },
    connection
  );

  return {
    state: nextState,
    sparks: computeSparkSnapshot(nextState, now),
  };
}

// ─── Contract payment activations (Infinite Spark / Refill) ───────────────────

function sparkPaymentPath(txHash: string): string {
  return `sparkPayments/${txHash.toLowerCase()}`;
}

export class InfiniteSparkActivationError extends Error {
  constructor(
    message: string,
    public readonly code: "NO_WALLET" | "INVALID_TX" | "TX_ALREADY_USED"
  ) {
    super(message);
    this.name = "InfiniteSparkActivationError";
  }
}

export class SparkRefillActivationError extends Error {
  constructor(
    message: string,
    public readonly code: "NO_WALLET" | "INVALID_TX" | "TX_ALREADY_USED"
  ) {
    super(message);
    this.name = "SparkRefillActivationError";
  }
}

export async function activateInfiniteSparkOnServer(
  walletAddress: string,
  txHash: string,
  scope?: PlayerChainScope
): Promise<{
  state: StoredSparkState;
  sparks: SparkSnapshot;
  activated: boolean;
}> {
  if (!isWalletAddress(walletAddress)) {
    throw new InfiniteSparkActivationError(
      "A valid wallet address is required.",
      "NO_WALLET"
    );
  }

  const wallet = normalizeWalletAddress(walletAddress);
  const playerId = walletToPlayerId(wallet);
  const resolvedScope: PlayerChainScope = {
    chainId: scope?.chainId,
    ecosystem: scope?.ecosystem ?? "evm",
  };
  const connection = playerConnection(resolvedScope);
  const normalizedTxHash = txHash.trim().toLowerCase();

  if (!/^0x[0-9a-f]{64}$/.test(normalizedTxHash)) {
    throw new InfiniteSparkActivationError(
      "A valid transaction hash is required.",
      "INVALID_TX"
    );
  }

  const guardPath = sparkPaymentPath(normalizedTxHash);
  const existingPayment = await readPath<{ wallet?: string }>(
    guardPath,
    connection
  );

  if (existingPayment?.wallet) {
    const recordedWallet = normalizeWalletAddress(existingPayment.wallet);
    if (recordedWallet !== wallet) {
      throw new InfiniteSparkActivationError(
        "This payment was already used by another wallet.",
        "TX_ALREADY_USED"
      );
    }

    const snapshot = await getSparkSnapshotOnServer(
      playerId,
      Date.now(),
      resolvedScope
    );
    return { ...snapshot, activated: false };
  }

  const { verifyInfiniteSparkPaymentTx } = await import(
    "@/lib/infinite-spark-verify"
  );
  await verifyInfiniteSparkPaymentTx(wallet, normalizedTxHash as Hash);

  const now = Date.now();
  const state = normalizeSparkState(
    await ensureSparkStateOnServer(playerId, resolvedScope),
    now
  );
  const baseUntil =
    state.infiniteUntil && state.infiniteUntil > now
      ? state.infiniteUntil
      : now;
  const infiniteUntil = baseUntil + INFINITE_SPARKS_MS;

  const claim = await claimGuardRecord(
    guardPath,
    wallet,
    () => ({
      wallet,
      activatedAt: now,
      infiniteUntil,
    }),
    connection
  );

  if (claim.status === "conflict_other_wallet") {
    throw new InfiniteSparkActivationError(
      "This payment was already used by another wallet.",
      "TX_ALREADY_USED"
    );
  }

  if (claim.status === "exists") {
    const snapshot = await getSparkSnapshotOnServer(
      playerId,
      Date.now(),
      resolvedScope
    );
    return { ...snapshot, activated: false };
  }

  const nextState: StoredSparkState = {
    ...state,
    infiniteUntil,
  };

  try {
    await writePath(sparksPath(playerId), nextState, connection);
  } catch (err) {
    await deletePath(guardPath, connection).catch(() => {});
    throw err;
  }

  return {
    state: nextState,
    sparks: computeSparkSnapshot(nextState, now),
    activated: true,
  };
}

export async function activateSparkRefillOnServer(
  walletAddress: string,
  txHash: string,
  scope?: PlayerChainScope
): Promise<{
  state: StoredSparkState;
  sparks: SparkSnapshot;
  refilled: boolean;
}> {
  if (!isWalletAddress(walletAddress)) {
    throw new SparkRefillActivationError(
      "A valid wallet address is required.",
      "NO_WALLET"
    );
  }

  const wallet = normalizeWalletAddress(walletAddress);
  const playerId = walletToPlayerId(wallet);
  const resolvedScope: PlayerChainScope = {
    chainId: scope?.chainId,
    ecosystem: scope?.ecosystem ?? "evm",
  };
  const connection = playerConnection(resolvedScope);
  const normalizedTxHash = txHash.trim().toLowerCase();

  if (!/^0x[0-9a-f]{64}$/.test(normalizedTxHash)) {
    throw new SparkRefillActivationError(
      "A valid transaction hash is required.",
      "INVALID_TX"
    );
  }

  const guardPath = sparkPaymentPath(normalizedTxHash);
  const existingPayment = await readPath<{ wallet?: string; type?: string }>(
    guardPath,
    connection
  );

  if (existingPayment?.wallet) {
    const recordedWallet = normalizeWalletAddress(existingPayment.wallet);
    if (recordedWallet !== wallet) {
      throw new SparkRefillActivationError(
        "This payment was already used by another wallet.",
        "TX_ALREADY_USED"
      );
    }

    const snapshot = await getSparkSnapshotOnServer(
      playerId,
      Date.now(),
      resolvedScope
    );
    return { ...snapshot, refilled: false };
  }

  const { verifySparkRefillPaymentTx } = await import(
    "@/lib/spark-refill-verify"
  );
  await verifySparkRefillPaymentTx(wallet, normalizedTxHash as Hash);

  const now = Date.now();
  const state = normalizeSparkState(
    await ensureSparkStateOnServer(playerId, resolvedScope),
    now
  );

  const claim = await claimGuardRecord(
    guardPath,
    wallet,
    () => ({
      wallet,
      type: "refill",
      activatedAt: now,
    }),
    connection
  );

  if (claim.status === "conflict_other_wallet") {
    throw new SparkRefillActivationError(
      "This payment was already used by another wallet.",
      "TX_ALREADY_USED"
    );
  }

  if (claim.status === "exists") {
    const snapshot = await getSparkSnapshotOnServer(
      playerId,
      Date.now(),
      resolvedScope
    );
    return { ...snapshot, refilled: false };
  }

  const nextState: StoredSparkState = {
    ...state,
    slots: Array.from({ length: state.max }, () => null),
  };

  try {
    await writePath(sparksPath(playerId), nextState, connection);
  } catch (err) {
    await deletePath(guardPath, connection).catch(() => {});
    throw err;
  }

  return {
    state: nextState,
    sparks: computeSparkSnapshot(nextState, now),
    refilled: true,
  };
}

// ─── Streak check-in + off-chain rewards ───────────────────────────────────────

function checkInTxPath(txHash: string): string {
  return `checkInTxs/${txHash.toLowerCase()}`;
}

function streakGrantPath(txHash: string): string {
  return `streakGrants/${txHash.toLowerCase()}`;
}

export class StreakSyncError extends Error {
  constructor(
    message: string,
    public readonly code: "NO_WALLET" | "INVALID_TX" | "TX_ALREADY_USED"
  ) {
    super(message);
    this.name = "StreakSyncError";
  }
}

export class StreakRewardError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "NO_WALLET"
      | "INVALID_TX"
      | "TX_ALREADY_USED"
      | "NO_MILESTONE"
  ) {
    super(message);
    this.name = "StreakRewardError";
  }
}

export async function recordCheckInTxOnServer(
  walletAddress: string,
  txHash: string,
  day: number,
  campaignId: number
): Promise<{ reused: boolean }> {
  if (!isRewardsWallet(walletAddress)) {
    throw new StreakSyncError("A valid wallet address is required.", "NO_WALLET");
  }
  const wallet = normalizeRewardsWallet(walletAddress);
  const normalizedTxHash = txHash.trim().toLowerCase();

  if (!/^0x[0-9a-f]{64}$/.test(normalizedTxHash)) {
    throw new StreakSyncError(
      "A valid transaction hash is required.",
      "INVALID_TX"
    );
  }

  const claim = await claimGuardRecord(
    checkInTxPath(normalizedTxHash),
    wallet,
    () => ({
      wallet,
      campaignId,
      day,
      syncedAt: Date.now(),
    })
  );

  if (claim.status === "conflict_other_wallet") {
    throw new StreakSyncError(
      "This check-in was already used by another wallet.",
      "TX_ALREADY_USED"
    );
  }

  return { reused: claim.status === "exists" };
}

export class VaraTxHubSignInError extends Error {
  constructor(
    message: string,
    readonly code?: "INVALID_TX" | "TX_ALREADY_USED" | "NO_WALLET"
  ) {
    super(message);
    this.name = "VaraTxHubSignInError";
  }
}

function varaTxHubSignInPath(txHash: string): string {
  return `vara/txHub/signIns/${txHash}`;
}

export class BaseTxHubSignInError extends Error {
  constructor(
    message: string,
    readonly code?: "INVALID_TX" | "TX_ALREADY_USED" | "NO_WALLET"
  ) {
    super(message);
    this.name = "BaseTxHubSignInError";
  }
}

function baseTxHubSignInPath(txHash: string): string {
  return `txHub/signIns/${txHash.toLowerCase()}`;
}

/** Replay-protect free ArcadeXTxHub.signIn txs on Base. */
export async function recordBaseTxHubSignInOnServer(params: {
  walletAddress: string;
  txHash: string;
  gameId: string;
  purpose: string;
  chainId?: number | null;
}): Promise<{ reused: boolean }> {
  if (!isRewardsWallet(params.walletAddress)) {
    throw new BaseTxHubSignInError(
      "A valid wallet address is required.",
      "NO_WALLET"
    );
  }

  const wallet = normalizeRewardsWallet(params.walletAddress);
  const normalizedTxHash = params.txHash.trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(normalizedTxHash)) {
    throw new BaseTxHubSignInError(
      "A valid transaction hash is required.",
      "INVALID_TX"
    );
  }

  const connection = getPlayerRtdbConnection({
    chainId: params.chainId ?? 8453,
    ecosystem: "evm",
  });

  const claim = await claimGuardRecord(
    baseTxHubSignInPath(normalizedTxHash),
    wallet,
    () => ({
      wallet,
      gameId: params.gameId.trim(),
      purpose: params.purpose.trim().toLowerCase(),
      syncedAt: Date.now(),
    }),
    connection
  );

  if (claim.status === "conflict_other_wallet") {
    throw new BaseTxHubSignInError(
      "This transaction was already used.",
      "TX_ALREADY_USED"
    );
  }

  return { reused: claim.status === "exists" };
}

/** Replay-protect free ArcadeXTxHub sign_in extrinsics. */
export async function recordVaraTxHubSignInOnServer(params: {
  walletAddress: string;
  txHash: string;
  gameId: string;
  purpose: string;
}): Promise<{ reused: boolean }> {
  let actorId: string;
  let ss58: string;
  try {
    actorId = toVaraActorId(params.walletAddress);
    ss58 = toVaraSs58(params.walletAddress);
  } catch {
    throw new VaraTxHubSignInError(
      "A valid Vara wallet address is required.",
      "NO_WALLET"
    );
  }

  const normalizedTxHash = params.txHash.trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(normalizedTxHash)) {
    throw new VaraTxHubSignInError(
      "A valid transaction hash is required.",
      "INVALID_TX"
    );
  }

  type SignInRecord = {
    wallet: string;
    actorId: string;
    gameId: string;
    purpose: string;
    syncedAt: number;
  };

  let reused = false;
  let conflict = false;

  const { committed } = await runRtdbTransaction<SignInRecord>(
    varaTxHubSignInPath(normalizedTxHash),
    (current) => {
      if (current?.actorId || current?.wallet) {
        let existing = (current.actorId || "").toLowerCase();
        if (!existing && current.wallet) {
          try {
            existing = toVaraActorId(String(current.wallet));
          } catch {
            existing = "";
          }
        }
        if (existing === actorId) {
          reused = true;
          return undefined;
        }
        conflict = true;
        return undefined;
      }

      return {
        wallet: ss58,
        actorId,
        gameId: params.gameId.trim(),
        purpose: params.purpose.trim().toLowerCase(),
        syncedAt: Date.now(),
      };
    }
  );

  if (conflict) {
    throw new VaraTxHubSignInError(
      "This transaction was already used.",
      "TX_ALREADY_USED"
    );
  }

  return { reused: reused || !committed };
}

/**
 * Grants Infinite Spark after a verified on-chain MilestoneReached for OFFCHAIN campaigns.
 */
export async function grantStreakInfiniteSparkOnServer(
  walletAddress: string,
  txHash: string,
  campaignId: number,
  chainId?: number | null
): Promise<{
  state: StoredSparkState;
  sparks: SparkSnapshot;
  granted: boolean;
}> {
  if (!isRewardsWallet(walletAddress)) {
    throw new StreakRewardError(
      "A valid wallet address is required.",
      "NO_WALLET"
    );
  }

  const wallet = normalizeRewardsWallet(walletAddress);
  const playerId = walletToPlayerId(wallet);
  const resolvedScope: PlayerChainScope = {
    chainId,
    ecosystem: "evm",
  };
  const connection = playerConnection(resolvedScope);
  const normalizedTxHash = txHash.trim().toLowerCase();

  if (!/^0x[0-9a-f]{64}$/.test(normalizedTxHash)) {
    throw new StreakRewardError(
      "A valid transaction hash is required.",
      "INVALID_TX"
    );
  }

  const guardPath = streakGrantPath(normalizedTxHash);
  const existingGrant = await readPath<{ wallet?: string }>(
    guardPath,
    connection
  );

  if (existingGrant?.wallet) {
    const recorded = normalizeRewardsWallet(existingGrant.wallet);
    if (recorded !== wallet) {
      throw new StreakRewardError(
        "This reward was already used by another wallet.",
        "TX_ALREADY_USED"
      );
    }

    const snapshot = await getSparkSnapshotOnServer(
      playerId,
      Date.now(),
      resolvedScope
    );
    return { ...snapshot, granted: false };
  }

  const { verifyOffchainMilestoneTx } = await import(
    "@/lib/arcadex-rewards-verify"
  );

  try {
    await verifyOffchainMilestoneTx(
      wallet,
      normalizedTxHash as Hash,
      campaignId,
      chainId
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Invalid milestone transaction.";
    throw new StreakRewardError(message, "NO_MILESTONE");
  }

  await recordCheckInTxOnServer(wallet, normalizedTxHash, 0, campaignId);

  const now = Date.now();
  const state = normalizeSparkState(
    await ensureSparkStateOnServer(playerId, resolvedScope),
    now
  );
  const baseUntil =
    state.infiniteUntil && state.infiniteUntil > now
      ? state.infiniteUntil
      : now;
  const infiniteUntil = baseUntil + INFINITE_SPARKS_MS;

  const claim = await claimGuardRecord(
    guardPath,
    wallet,
    () => ({
      wallet,
      campaignId,
      grantedAt: now,
      infiniteUntil,
      reward: "INFINITE_SPARK_24H",
    }),
    connection
  );

  if (claim.status === "conflict_other_wallet") {
    throw new StreakRewardError(
      "This reward was already used by another wallet.",
      "TX_ALREADY_USED"
    );
  }

  if (claim.status === "exists") {
    const snapshot = await getSparkSnapshotOnServer(
      playerId,
      Date.now(),
      resolvedScope
    );
    return { ...snapshot, granted: false };
  }

  const nextState: StoredSparkState = {
    ...state,
    infiniteUntil,
  };

  try {
    await writePath(sparksPath(playerId), nextState, connection);
  } catch (err) {
    await deletePath(guardPath, connection).catch(() => {});
    throw err;
  }

  return {
    state: nextState,
    sparks: computeSparkSnapshot(nextState, now),
    granted: true,
  };
}

// ─── Daily shuffle pending + USDC budget ───────────────────────────────────────

export type ShufflePendingRecord = {
  wallet: string;
  campaignId: number;
  nonce: number;
  outcomeId: string;
  outcomeType: "usdc" | "spark" | "none";
  displayAmount: number | null;
  rewardMode: number;
  rewardTarget: string;
  rewardAmount: string;
  deadline: number;
  signature: string;
  createdAt: number;
  consumedAt?: number;
  txHash?: string;
};

function shufflePendingPath(
  wallet: string,
  campaignId: number,
  nonce: number
): string {
  return `shufflePending/${wallet.toLowerCase()}/${campaignId}/${nonce}`;
}

function spinTxPath(txHash: string): string {
  return `spinTxs/${txHash.toLowerCase()}`;
}

function shuffleGrantPath(txHash: string): string {
  return `shuffleGrants/${txHash.toLowerCase()}`;
}

function shuffleDailyBudgetPath(dayKey: string): string {
  return `shuffleDailyBudget/${dayKey}`;
}

/** UTC calendar day used for the hard daily USDC spend ceiling. */
export function shuffleUtcDayKey(nowMs: number = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

type ShuffleUsdcReservation = {
  amountMicro: number;
  expiresAt: number;
};

type ShuffleDailyBudgetRecord = {
  /** Confirmed on-chain USDC payouts for the day (micro-USDC). */
  spentMicro?: number;
  /** Pending signed outcomes not yet synced (micro-USDC), keyed by wallet_nonce. */
  reservations?: Record<string, ShuffleUsdcReservation>;
  /** Keys already moved into spentMicro (idempotent sync). */
  confirmed?: Record<string, number>;
};

function pruneExpiredReservations(
  reservations: Record<string, ShuffleUsdcReservation> | undefined,
  nowMs: number
): Record<string, ShuffleUsdcReservation> {
  if (!reservations) return {};
  const next: Record<string, ShuffleUsdcReservation> = {};
  for (const [key, value] of Object.entries(reservations)) {
    if (
      value &&
      typeof value.amountMicro === "number" &&
      typeof value.expiresAt === "number" &&
      value.expiresAt > nowMs &&
      value.amountMicro > 0
    ) {
      next[key] = value;
    }
  }
  return next;
}

function sumReservedMicro(
  reservations: Record<string, ShuffleUsdcReservation>
): number {
  let sum = 0;
  for (const value of Object.values(reservations)) {
    sum += value.amountMicro;
  }
  return sum;
}

export function shuffleUsdcReservationKey(
  walletAddress: string,
  campaignId: number,
  nonce: number
): string {
  return `${normalizeRewardsWallet(walletAddress)}_${campaignId}_${nonce}`;
}

/** @deprecated Use shuffleUsdcReservationKey */
export const shuffleUsdtReservationKey = shuffleUsdcReservationKey;

export async function getShuffleUsdcBudgetRemainingMicro(
  nowMs: number = Date.now()
): Promise<number> {
  const dayKey = shuffleUtcDayKey(nowMs);
  const data = await readPath<ShuffleDailyBudgetRecord>(
    shuffleDailyBudgetPath(dayKey)
  );
  const reservations = pruneExpiredReservations(data?.reservations, nowMs);
  const spent = typeof data?.spentMicro === "number" ? data.spentMicro : 0;
  const reserved = sumReservedMicro(reservations);
  return Math.max(0, SHUFFLE_DAILY_USDC_BUDGET_MICRO - spent - reserved);
}

/** @deprecated Use getShuffleUsdcBudgetRemainingMicro */
export const getShuffleUsdtBudgetRemainingMicro =
  getShuffleUsdcBudgetRemainingMicro;

/**
 * Atomically reserve USDC against today's hard budget before signing a spin.
 * Expired reservations are dropped on write. Returns false if amount cannot fit.
 */
export async function reserveShuffleUsdcBudget(opts: {
  amountMicro: number;
  reservationKey: string;
  expiresAtMs: number;
  nowMs?: number;
}): Promise<
  { ok: true; remainingMicro: number } | { ok: false; remainingMicro: number }
> {
  const nowMs = opts.nowMs ?? Date.now();
  const dayKey = shuffleUtcDayKey(nowMs);
  const path = shuffleDailyBudgetPath(dayKey);
  let remainingMicro = 0;

  const { committed, snapshot } =
    await runRtdbTransaction<ShuffleDailyBudgetRecord>(path, (current) => {
      const reservations = pruneExpiredReservations(
        current?.reservations,
        nowMs
      );
      const confirmed = current?.confirmed ?? {};
      const spent =
        typeof current?.spentMicro === "number" ? current.spentMicro : 0;
      const existing = reservations[opts.reservationKey];
      if (existing && existing.amountMicro === opts.amountMicro) {
        remainingMicro = Math.max(
          0,
          SHUFFLE_DAILY_USDC_BUDGET_MICRO -
            spent -
            sumReservedMicro(reservations)
        );
        return {
          spentMicro: spent,
          reservations: {
            ...reservations,
            [opts.reservationKey]: {
              amountMicro: opts.amountMicro,
              expiresAt: opts.expiresAtMs,
            },
          },
          confirmed,
        };
      }

      if (existing) {
        delete reservations[opts.reservationKey];
      }

      const reserved = sumReservedMicro(reservations);
      remainingMicro = Math.max(
        0,
        SHUFFLE_DAILY_USDC_BUDGET_MICRO - spent - reserved
      );
      if (opts.amountMicro > remainingMicro) {
        return undefined;
      }

      reservations[opts.reservationKey] = {
        amountMicro: opts.amountMicro,
        expiresAt: opts.expiresAtMs,
      };
      remainingMicro -= opts.amountMicro;
      return {
        spentMicro: spent,
        reservations,
        confirmed,
      };
    });

  if (!committed) {
    const spent =
      typeof snapshot?.spentMicro === "number" ? snapshot.spentMicro : 0;
    const reserved = sumReservedMicro(
      pruneExpiredReservations(snapshot?.reservations, nowMs)
    );
    return {
      ok: false,
      remainingMicro: Math.max(
        0,
        SHUFFLE_DAILY_USDC_BUDGET_MICRO - spent - reserved
      ),
    };
  }

  return { ok: true, remainingMicro };
}

/** @deprecated Use reserveShuffleUsdcBudget */
export const reserveShuffleUsdtBudget = reserveShuffleUsdcBudget;

/** Move a reservation into confirmed spend after on-chain sync. */
export async function confirmShuffleUsdcBudget(opts: {
  amountMicro: number;
  reservationKey: string;
  nowMs?: number;
}): Promise<void> {
  const nowMs = opts.nowMs ?? Date.now();
  const dayKey = shuffleUtcDayKey(nowMs);
  const path = shuffleDailyBudgetPath(dayKey);

  await runRtdbTransaction<ShuffleDailyBudgetRecord>(path, (current) => {
    const reservations = pruneExpiredReservations(current?.reservations, nowMs);
    const confirmed = { ...(current?.confirmed ?? {}) };
    const spent =
      typeof current?.spentMicro === "number" ? current.spentMicro : 0;

    if (typeof confirmed[opts.reservationKey] === "number") {
      delete reservations[opts.reservationKey];
      return {
        spentMicro: spent,
        reservations,
        confirmed,
      };
    }

    const existing = reservations[opts.reservationKey];
    delete reservations[opts.reservationKey];
    const addMicro = existing?.amountMicro ?? opts.amountMicro;
    confirmed[opts.reservationKey] = addMicro;

    return {
      spentMicro: spent + addMicro,
      reservations,
      confirmed,
    };
  });
}

/** @deprecated Use confirmShuffleUsdcBudget */
export const confirmShuffleUsdtBudget = confirmShuffleUsdcBudget;

export async function saveShufflePending(
  record: ShufflePendingRecord
): Promise<void> {
  await writePath(
    shufflePendingPath(record.wallet, record.campaignId, record.nonce),
    record
  );
}

export async function getShufflePending(
  walletAddress: string,
  campaignId: number,
  nonce: number
): Promise<ShufflePendingRecord | null> {
  const wallet = normalizeRewardsWallet(walletAddress);
  return readPath<ShufflePendingRecord>(
    shufflePendingPath(wallet, campaignId, nonce)
  );
}

export async function markShufflePendingConsumed(
  walletAddress: string,
  campaignId: number,
  nonce: number,
  txHash: string
): Promise<void> {
  const wallet = normalizeRewardsWallet(walletAddress);
  const path = shufflePendingPath(wallet, campaignId, nonce);
  const existing = await readPath<ShufflePendingRecord>(path);
  if (!existing) return;
  await patchPath(path, {
    consumedAt: Date.now(),
    txHash: txHash.toLowerCase(),
  });
}

export async function recordSpinTxOnServer(
  walletAddress: string,
  txHash: string,
  campaignId: number,
  outcomeId: string
): Promise<{ reused: boolean }> {
  if (!isRewardsWallet(walletAddress)) {
    throw new StreakSyncError("A valid wallet address is required.", "NO_WALLET");
  }

  const wallet = normalizeRewardsWallet(walletAddress);
  const normalizedTxHash = txHash.trim().toLowerCase();

  if (!/^0x[0-9a-f]{64}$/.test(normalizedTxHash)) {
    throw new StreakSyncError(
      "A valid transaction hash is required.",
      "INVALID_TX"
    );
  }

  const claim = await claimGuardRecord(
    spinTxPath(normalizedTxHash),
    wallet,
    () => ({
      wallet,
      campaignId,
      outcomeId,
      syncedAt: Date.now(),
    })
  );

  if (claim.status === "conflict_other_wallet") {
    throw new StreakSyncError(
      "This spin was already used by another wallet.",
      "TX_ALREADY_USED"
    );
  }

  return { reused: claim.status === "exists" };
}

export async function grantShuffleInfiniteSparkOnServer(
  walletAddress: string,
  txHash: string,
  scope?: PlayerChainScope
): Promise<{
  state: StoredSparkState;
  sparks: SparkSnapshot;
  granted: boolean;
}> {
  if (!isRewardsWallet(walletAddress)) {
    throw new StreakRewardError(
      "A valid wallet address is required.",
      "NO_WALLET"
    );
  }

  const wallet = normalizeRewardsWallet(walletAddress);
  const playerId = walletToPlayerId(wallet);
  const resolvedScope: PlayerChainScope = {
    chainId: scope?.chainId,
    ecosystem: scope?.ecosystem ?? "evm",
  };
  const connection = playerConnection(resolvedScope);
  const normalizedTxHash = txHash.trim().toLowerCase();
  const guardPath = shuffleGrantPath(normalizedTxHash);
  const existingGrant = await readPath<{ wallet?: string }>(
    guardPath,
    connection
  );

  if (existingGrant?.wallet) {
    const recorded = normalizeRewardsWallet(existingGrant.wallet);
    if (recorded !== wallet) {
      throw new StreakRewardError(
        "This reward was already used by another wallet.",
        "TX_ALREADY_USED"
      );
    }
    const snapshot = await getSparkSnapshotOnServer(
      playerId,
      Date.now(),
      resolvedScope
    );
    return { ...snapshot, granted: false };
  }

  const now = Date.now();
  const state = normalizeSparkState(
    await ensureSparkStateOnServer(playerId, resolvedScope),
    now
  );
  const baseUntil =
    state.infiniteUntil && state.infiniteUntil > now
      ? state.infiniteUntil
      : now;
  const infiniteUntil = baseUntil + INFINITE_SPARKS_MS;

  const claim = await claimGuardRecord(
    guardPath,
    wallet,
    () => ({
      wallet,
      grantedAt: now,
      infiniteUntil,
      reward: "INFINITE_SPARK_24H",
      source: "shuffle",
    }),
    connection
  );

  if (claim.status === "conflict_other_wallet") {
    throw new StreakRewardError(
      "This reward was already used by another wallet.",
      "TX_ALREADY_USED"
    );
  }

  if (claim.status === "exists") {
    const snapshot = await getSparkSnapshotOnServer(
      playerId,
      Date.now(),
      resolvedScope
    );
    return { ...snapshot, granted: false };
  }

  const nextState: StoredSparkState = {
    ...state,
    infiniteUntil,
  };

  try {
    await writePath(sparksPath(playerId), nextState, connection);
  } catch (err) {
    await deletePath(guardPath, connection).catch(() => {});
    throw err;
  }

  return {
    state: nextState,
    sparks: computeSparkSnapshot(nextState, now),
    granted: true,
  };
}
