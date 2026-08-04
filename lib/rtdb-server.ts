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
import { getDatabaseUrl } from "./firebase-admin";
import {
  cachedFetchAllPlayCounts,
  bumpCachedPlayCount,
  cachedFetchLeaderboardTop,
  invalidateLeaderboardTopCache,
  cachedFetchContestLeaderboardTop,
  invalidateContestLeaderboardTopCache,
} from "@/lib/rtdb-cache";
import {
  isValidAddress,
  normalizeAddress,
  parsePlayerId,
  resolvePlayerId,
  WalletEcosystem,
} from "@/lib/player-identity";
import {
  computeSparkSnapshot,
  defaultSparkState,
  coerceSparkState,
  normalizeSparkState,
} from "@/lib/spark";
import { INFINITE_SPARKS_MS, type ShopProductId } from "@/lib/shop";
import { isWalletAddress, normalizeWalletAddress } from "@/lib/wallet-address";
import { SHUFFLE_DAILY_USDC_BUDGET_MICRO } from "@/lib/shuffle-outcomes";

type StoredUser = Omit<PlayerProfile, "id">;
type LeaderboardMap = Record<string, LeaderboardEntry>;

const RTDB_TRANSACTION_MAX_RETRIES = 8;

function getRtdbAuthQuery(): string {
  const secret = process.env.FIREBASE_DATABASE_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "FIREBASE_DATABASE_SECRET is missing. Add it to Cloudflare Worker secrets (Firebase Console → Realtime Database → Secrets)."
    );
  }
  return `auth=${encodeURIComponent(secret)}`;
}

/** Encode each path segment for RTDB REST (wallet keys, game ids, etc.). */
function encodeRtdbPath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
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

async function rtdbFetch(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const auth = getRtdbAuthQuery();
  const url = `${getDatabaseUrl()}/${encodeRtdbPath(path)}.json?${auth}`;

  return fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });
}

async function readPath<T>(path: string): Promise<T | null> {
  const res = await rtdbFetch(path);
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Realtime Database read failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as T | null;
  return data ?? null;
}

async function writePath(path: string, data: unknown): Promise<void> {
  const res = await rtdbFetch(path, {
    method: "PUT",
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Realtime Database write failed (${res.status}): ${text}`);
  }
}

async function patchPath(path: string, data: unknown): Promise<void> {
  const res = await rtdbFetch(path, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Realtime Database patch failed (${res.status}): ${text}`);
  }
}

async function deletePath(path: string): Promise<void> {
  const res = await rtdbFetch(path, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`Realtime Database delete failed (${res.status}): ${text}`);
  }
}

/** GET with ETag for conditional writes (REST transactions). */
async function readPathWithEtag<T>(
  path: string
): Promise<{ data: T | null; etag: string }> {
  const res = await rtdbFetch(path, {
    headers: { "X-Firebase-ETag": "true" },
  });
  if (res.status === 404) {
    return { data: null, etag: res.headers.get("ETag") ?? '""' };
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Realtime Database read failed (${res.status}): ${text}`);
  }

  const etag = res.headers.get("ETag");
  if (!etag) {
    throw new Error("Realtime Database ETag missing for transaction read.");
  }

  const data = (await res.json()) as T | null;
  return { data: data ?? null, etag };
}

async function writePathIfMatch(
  path: string,
  data: unknown,
  etag: string
): Promise<"ok" | "conflict"> {
  const res = await rtdbFetch(path, {
    method: "PUT",
    headers: { "if-match": etag },
    body: JSON.stringify(data),
  });

  if (res.status === 412) return "conflict";
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Realtime Database write failed (${res.status}): ${text}`);
  }
  return "ok";
}

/**
 * Conditional write with automatic retry (RTDB REST transaction via ETag).
 * Return `undefined` from `updateFn` to abort without writing.
 */
async function runRtdbTransaction<T>(
  path: string,
  updateFn: (current: T | null) => T | undefined,
  maxRetries = RTDB_TRANSACTION_MAX_RETRIES
): Promise<{ committed: boolean; snapshot: T | null }> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { data, etag } = await readPathWithEtag<T>(path);
    const next = updateFn(data);
    if (next === undefined) {
      return { committed: false, snapshot: data };
    }

    const result = await writePathIfMatch(path, next, etag);
    if (result === "ok") {
      return { committed: true, snapshot: next };
    }
  }

  throw new Error("Realtime Database transaction failed after max retries.");
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
  buildRecord: () => T
): Promise<GuardClaimResult<T>> {
  let createdRecord: T | null = null;
  let existsRecord: T | null = null;
  let conflictOther = false;

  const { committed, snapshot } = await runRtdbTransaction<T>(path, (current) => {
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
  });

  if (createdRecord && committed) {
    return { status: "created", record: createdRecord };
  }
  if (existsRecord) {
    return { status: "exists", record: existsRecord };
  }
  if (conflictOther) {
    return { status: "conflict_other_wallet" };
  }

  const existing = snapshot ?? (await readPath<T>(path));
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
  id: string
): Promise<PlayerProfile | null> {
  const resolved = resolvePlayerId(id);
  if (!resolved) return null;

  const data = await readPath<StoredUser>(profilePath(resolved));
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

  const existing = await fetchUserFromServer(fields.playerId);
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

  await writePath(profilePath(fields.playerId), stored);
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
  const existing = await fetchUserFromServer(resolved);

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
    await writePath(profilePath(resolved), stored);
    await writePath(sparksPath(resolved), defaultSparkState());
    return toPlayerProfile(resolved, stored)!;
  }

  await ensureSparkStateOnServer(resolved);
  return existing;
}

// ─── Game play counts ──────────────────────────────────────────────────────────

export async function fetchAllGamePlayCounts(): Promise<Record<string, number>> {
  return cachedFetchAllPlayCounts(async () => {
    const data = await readPath<Record<string, number>>("gamePlays");
    if (!data) return {};

    const counts: Record<string, number> = {};
    for (const [gameId, value] of Object.entries(data)) {
      counts[gameId] = typeof value === "number" ? value : 0;
    }
    return counts;
  });
}

export async function fetchGamePlayCount(gameId: string): Promise<number> {
  const count = await readPath<number>(`gamePlays/${gameId}`);
  return typeof count === "number" ? count : 0;
}

export async function incrementGamePlayCount(gameId: string): Promise<number> {
  // Atomic server-side increment — no read-modify-write race.
  const auth = getRtdbAuthQuery();
  const url = `${getDatabaseUrl()}/${encodeRtdbPath(`gamePlays/${gameId}`)}.json?${auth}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ".sv": { increment: 1 } }),
    cache: "no-store",
  });

  if (!res.ok) {
    // Fallback: read-then-write if the server-value syntax isn't supported
    const current = await fetchGamePlayCount(gameId);
    const next = current + 1;
    await writePath(`gamePlays/${gameId}`, next);
    bumpCachedPlayCount(gameId);
    return next;
  }

  // Bump the in-memory cache without a full re-fetch
  bumpCachedPlayCount(gameId);

  const body = (await res.json()) as number | null;
  return typeof body === "number" ? body : 0;
}

// ─── Leaderboard ─────────────────────────────────────────────────────────────

export async function fetchLeaderboardFromServer(
  gameId: string,
  limit = LEADERBOARD_MAX_ENTRIES
): Promise<LeaderboardEntry[]> {
  return cachedFetchLeaderboardTop(gameId, async () => {
    const map = await readPath<LeaderboardMap>(`leaderboards/${gameId}`);
    return deduplicateLeaderboardEntries(mapToLeaderboardEntries(map))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  });
}

export async function fetchUserBestScoreFromServer(
  gameId: string,
  opts: { walletAddress?: string; playerName?: string }
): Promise<number> {
  const map = await readPath<LeaderboardMap>(`leaderboards/${gameId}`);
  const entries = deduplicateLeaderboardEntries(mapToLeaderboardEntries(map));

  const wallet = opts.walletAddress?.trim().toLowerCase();
  const name = opts.playerName?.trim().toLowerCase();
  if (!wallet && !name) return 0;

  let best = 0;
  for (const entry of entries) {
    const entryWallet = entry.walletAddress?.trim().toLowerCase();
    const matchesWallet = Boolean(wallet && entryWallet === wallet);
    const matchesName = Boolean(
      name && entry.name.trim().toLowerCase() === name
    );
    if (matchesWallet || matchesName) {
      best = Math.max(best, entry.score);
    }
  }

  return best;
}

export async function fetchUserSubmittedBestFromServer(
  gameId: string,
  opts: { walletAddress?: string; playerName?: string }
): Promise<number> {
  return fetchUserBestScoreFromServer(gameId, opts);
}

export async function fetchPersonalBestFromServer(
  playerId: string,
  gameId: string
): Promise<number> {
  const stored = await fetchGameProgressFromServer(playerId, gameId);
  return stored?.s ?? 0;
}

export async function fetchContestLeaderboardFromServer(
  gameId: string,
  contestStartedAt: number,
  limit = CONTEST_TOP_MAX_ENTRIES
): Promise<LeaderboardEntry[]> {
  return cachedFetchContestLeaderboardTop(
    gameId,
    contestStartedAt,
    async () => {
      const map = await readPath<LeaderboardMap>(
        `contestLeaderboards/${gameId}/${contestStartedAt}`
      );
      return deduplicateLeaderboardEntries(mapToLeaderboardEntries(map))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    }
  );
}

async function writeLeaderboardEntry(
  basePath: string,
  entry: LeaderboardEntry,
  invalidate: () => void
): Promise<boolean> {
  const wallet = entry.walletAddress?.trim();
  const payload: LeaderboardEntry = {
    name: entry.name,
    score: entry.score,
    ...(wallet ? { walletAddress: wallet } : {}),
    createdAt: entry.createdAt ?? Date.now(),
  };

  const map = await readPath<LeaderboardMap>(basePath);
  const userKey = leaderboardUserKey(payload);
  const existingBest = deduplicateLeaderboardEntries(
    mapToLeaderboardEntries(map)
  ).find((e) => leaderboardUserKey(e) === userKey);

  if (existingBest && existingBest.score >= payload.score) {
    return false;
  }

  await writePath(
    `${basePath}/${leaderboardStorageKey(payload)}`,
    payload
  );
  invalidate();
  return true;
}

export async function submitLeaderboardEntryOnServer(
  gameId: string,
  entry: LeaderboardEntry
): Promise<void> {
  await writeLeaderboardEntry(
    `leaderboards/${gameId}`,
    entry,
    () => invalidateLeaderboardTopCache(gameId)
  );
}

export async function submitContestLeaderboardEntryOnServer(
  gameId: string,
  contestStartedAt: number,
  entry: LeaderboardEntry
): Promise<void> {
  await writeLeaderboardEntry(
    `contestLeaderboards/${gameId}/${contestStartedAt}`,
    entry,
    () => invalidateContestLeaderboardTopCache(gameId, contestStartedAt)
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

export async function submitPublicScoreOnServer(params: {
  gameId: string;
  entry: LeaderboardEntry;
  txHash: string;
  ecosystem?: ShopPurchaseEcosystem;
  contestStartedAt?: number;
}): Promise<{ submittedBest: number }> {
  const ecosystem = params.ecosystem ?? "evm";
  const txKey = normalizeShopTxKey(ecosystem, params.txHash);
  const processedPath = processedScoreSubmitTxPath(ecosystem, txKey);

  const existing = await readPath<{ gameId: string; walletAddress?: string }>(
    processedPath
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
    await writePath(processedPath, {
      gameId: params.gameId,
      walletAddress: params.entry.walletAddress?.trim(),
      processedAt: Date.now(),
    });
  }

  await submitLeaderboardEntryOnServer(params.gameId, params.entry);

  if (typeof params.contestStartedAt === "number") {
    await submitContestLeaderboardEntryOnServer(
      params.gameId,
      params.contestStartedAt,
      params.entry
    );
  }

  const submittedBest = await fetchUserSubmittedBestFromServer(params.gameId, {
    walletAddress: params.entry.walletAddress,
    playerName: params.entry.name,
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
  gameId: string
): Promise<StoredGameProgress | null> {
  if (!resolvePlayerId(playerId)) return null;
  return readPath<StoredGameProgress>(gameProgressPath(playerId, gameId));
}

/**
 * Resolves progress for API / bootstrap from the user node only.
 * Public leaderboard scores are separate (paid submit).
 */
export async function resolveGameProgressFromServer(
  playerId: string,
  gameId: string,
  hasLeaderboard: boolean
): Promise<GameProgress> {
  const resolved = resolvePlayerId(playerId);
  if (!resolved) return {};

  const stored = await fetchGameProgressFromServer(resolved, gameId);
  return storedProgressToGameProgress(stored, hasLeaderboard);
}

export async function saveGameProgressOnServer(
  playerId: string,
  gameId: string,
  value: number,
  hasLeaderboard: boolean,
  opts?: { playerName?: string }
): Promise<GameProgress> {
  const resolved = resolvePlayerId(playerId);
  if (!resolved) {
    throw new Error("A valid player id is required.");
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("value must be a non-negative number.");
  }

  const current = await fetchGameProgressFromServer(resolved, gameId);
  const field: "s" | "l" = hasLeaderboard ? "s" : "l";
  const currentValue = hasLeaderboard ? (current?.s ?? 0) : (current?.l ?? 0);

  if (value <= currentValue) {
    return storedProgressToGameProgress(current, hasLeaderboard);
  }

  await patchPath(gameProgressPath(resolved, gameId), { [field]: value });

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
  playerId: string
): Promise<StoredSparkState | null> {
  if (!resolvePlayerId(playerId)) return null;
  return readPath<StoredSparkState>(sparksPath(playerId));
}

export async function ensureSparkStateOnServer(
  playerId: string
): Promise<StoredSparkState> {
  const resolved = resolvePlayerId(playerId);
  if (!resolved) {
    throw new Error("A valid player id is required.");
  }

  const existing = await readPath<unknown>(sparksPath(resolved));
  if (existing) {
    return coerceSparkState(existing);
  }

  const initial = defaultSparkState();
  await writePath(sparksPath(resolved), initial);
  return initial;
}

export async function getSparkSnapshotOnServer(
  playerId: string,
  now = Date.now()
): Promise<{ state: StoredSparkState; sparks: SparkSnapshot }> {
  const state = await ensureSparkStateOnServer(playerId);
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
  now = Date.now()
): Promise<{
  state: StoredSparkState;
  sparks: SparkSnapshot;
  spent: boolean;
}> {
  const resolved = resolvePlayerId(playerId);
  if (!resolved) {
    throw new Error("A valid player id is required.");
  }

  const raw = await ensureSparkStateOnServer(resolved);
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

  await writePath(sparksPath(resolved), nextState);

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
  now = Date.now()
): Promise<{ state: StoredSparkState; sparks: SparkSnapshot }> {
  const resolved = resolvePlayerId(playerId);
  if (!resolved) {
    throw new Error("A valid player id is required.");
  }

  const txKey = normalizeShopTxKey(ecosystem, txHash);

  const processedPath = processedShopTxPath(ecosystem, txKey);
  const existing = await readPath<{
    playerId: string;
    productId: ShopProductId;
  }>(processedPath);

  if (existing) {
    if (existing.playerId !== resolved || existing.productId !== productId) {
      throw new ShopPurchaseError(
        "This transaction was already used.",
        "TX_ALREADY_USED"
      );
    }

    return getSparkSnapshotOnServer(resolved, now);
  }

  const raw = await ensureSparkStateOnServer(resolved);
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

  await writePath(sparksPath(resolved), nextState);
  await writePath(processedPath, {
    playerId: resolved,
    productId,
    processedAt: now,
  });

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
  txHash: string
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
  const normalizedTxHash = txHash.trim().toLowerCase();

  if (!/^0x[0-9a-f]{64}$/.test(normalizedTxHash)) {
    throw new InfiniteSparkActivationError(
      "A valid transaction hash is required.",
      "INVALID_TX"
    );
  }

  const guardPath = sparkPaymentPath(normalizedTxHash);
  const existingPayment = await readPath<{ wallet?: string }>(guardPath);

  if (existingPayment?.wallet) {
    const recordedWallet = normalizeWalletAddress(existingPayment.wallet);
    if (recordedWallet !== wallet) {
      throw new InfiniteSparkActivationError(
        "This payment was already used by another wallet.",
        "TX_ALREADY_USED"
      );
    }

    const snapshot = await getSparkSnapshotOnServer(playerId);
    return { ...snapshot, activated: false };
  }

  const { verifyInfiniteSparkPaymentTx } = await import(
    "@/lib/infinite-spark-verify"
  );
  await verifyInfiniteSparkPaymentTx(wallet, normalizedTxHash as Hash);

  const now = Date.now();
  const state = normalizeSparkState(
    await ensureSparkStateOnServer(playerId),
    now
  );
  const baseUntil =
    state.infiniteUntil && state.infiniteUntil > now
      ? state.infiniteUntil
      : now;
  const infiniteUntil = baseUntil + INFINITE_SPARKS_MS;

  const claim = await claimGuardRecord(guardPath, wallet, () => ({
    wallet,
    activatedAt: now,
    infiniteUntil,
  }));

  if (claim.status === "conflict_other_wallet") {
    throw new InfiniteSparkActivationError(
      "This payment was already used by another wallet.",
      "TX_ALREADY_USED"
    );
  }

  if (claim.status === "exists") {
    const snapshot = await getSparkSnapshotOnServer(playerId);
    return { ...snapshot, activated: false };
  }

  const nextState: StoredSparkState = {
    ...state,
    infiniteUntil,
  };

  try {
    await writePath(sparksPath(playerId), nextState);
  } catch (err) {
    await deletePath(guardPath).catch(() => {});
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
  txHash: string
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
  const normalizedTxHash = txHash.trim().toLowerCase();

  if (!/^0x[0-9a-f]{64}$/.test(normalizedTxHash)) {
    throw new SparkRefillActivationError(
      "A valid transaction hash is required.",
      "INVALID_TX"
    );
  }

  const guardPath = sparkPaymentPath(normalizedTxHash);
  const existingPayment = await readPath<{ wallet?: string; type?: string }>(
    guardPath
  );

  if (existingPayment?.wallet) {
    const recordedWallet = normalizeWalletAddress(existingPayment.wallet);
    if (recordedWallet !== wallet) {
      throw new SparkRefillActivationError(
        "This payment was already used by another wallet.",
        "TX_ALREADY_USED"
      );
    }

    const snapshot = await getSparkSnapshotOnServer(playerId);
    return { ...snapshot, refilled: false };
  }

  const { verifySparkRefillPaymentTx } = await import(
    "@/lib/spark-refill-verify"
  );
  await verifySparkRefillPaymentTx(wallet, normalizedTxHash as Hash);

  const now = Date.now();
  const state = normalizeSparkState(
    await ensureSparkStateOnServer(playerId),
    now
  );

  const claim = await claimGuardRecord(guardPath, wallet, () => ({
    wallet,
    type: "refill",
    activatedAt: now,
  }));

  if (claim.status === "conflict_other_wallet") {
    throw new SparkRefillActivationError(
      "This payment was already used by another wallet.",
      "TX_ALREADY_USED"
    );
  }

  if (claim.status === "exists") {
    const snapshot = await getSparkSnapshotOnServer(playerId);
    return { ...snapshot, refilled: false };
  }

  const nextState: StoredSparkState = {
    ...state,
    slots: Array.from({ length: state.max }, () => null),
  };

  try {
    await writePath(sparksPath(playerId), nextState);
  } catch (err) {
    await deletePath(guardPath).catch(() => {});
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
  if (!isWalletAddress(walletAddress)) {
    throw new StreakSyncError("A valid wallet address is required.", "NO_WALLET");
  }

  const wallet = normalizeWalletAddress(walletAddress);
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

/**
 * Grants Infinite Spark after a verified on-chain MilestoneReached for OFFCHAIN campaigns.
 */
export async function grantStreakInfiniteSparkOnServer(
  walletAddress: string,
  txHash: string,
  campaignId: number
): Promise<{
  state: StoredSparkState;
  sparks: SparkSnapshot;
  granted: boolean;
}> {
  if (!isWalletAddress(walletAddress)) {
    throw new StreakRewardError(
      "A valid wallet address is required.",
      "NO_WALLET"
    );
  }

  const wallet = normalizeWalletAddress(walletAddress);
  const playerId = walletToPlayerId(wallet);
  const normalizedTxHash = txHash.trim().toLowerCase();

  if (!/^0x[0-9a-f]{64}$/.test(normalizedTxHash)) {
    throw new StreakRewardError(
      "A valid transaction hash is required.",
      "INVALID_TX"
    );
  }

  const guardPath = streakGrantPath(normalizedTxHash);
  const existingGrant = await readPath<{ wallet?: string }>(guardPath);

  if (existingGrant?.wallet) {
    const recorded = normalizeWalletAddress(existingGrant.wallet);
    if (recorded !== wallet) {
      throw new StreakRewardError(
        "This reward was already used by another wallet.",
        "TX_ALREADY_USED"
      );
    }

    const snapshot = await getSparkSnapshotOnServer(playerId);
    return { ...snapshot, granted: false };
  }

  const { verifyOffchainMilestoneTx } = await import(
    "@/lib/arcadex-rewards-verify"
  );

  try {
    await verifyOffchainMilestoneTx(
      wallet,
      normalizedTxHash as Hash,
      campaignId
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Invalid milestone transaction.";
    throw new StreakRewardError(message, "NO_MILESTONE");
  }

  await recordCheckInTxOnServer(wallet, normalizedTxHash, 0, campaignId);

  const now = Date.now();
  const state = normalizeSparkState(
    await ensureSparkStateOnServer(playerId),
    now
  );
  const baseUntil =
    state.infiniteUntil && state.infiniteUntil > now
      ? state.infiniteUntil
      : now;
  const infiniteUntil = baseUntil + INFINITE_SPARKS_MS;

  const claim = await claimGuardRecord(guardPath, wallet, () => ({
    wallet,
    campaignId,
    grantedAt: now,
    infiniteUntil,
    reward: "INFINITE_SPARK_24H",
  }));

  if (claim.status === "conflict_other_wallet") {
    throw new StreakRewardError(
      "This reward was already used by another wallet.",
      "TX_ALREADY_USED"
    );
  }

  if (claim.status === "exists") {
    const snapshot = await getSparkSnapshotOnServer(playerId);
    return { ...snapshot, granted: false };
  }

  const nextState: StoredSparkState = {
    ...state,
    infiniteUntil,
  };

  try {
    await writePath(sparksPath(playerId), nextState);
  } catch (err) {
    await deletePath(guardPath).catch(() => {});
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
  return `${normalizeWalletAddress(walletAddress)}_${campaignId}_${nonce}`;
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
  const wallet = normalizeWalletAddress(walletAddress);
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
  const wallet = normalizeWalletAddress(walletAddress);
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
  if (!isWalletAddress(walletAddress)) {
    throw new StreakSyncError("A valid wallet address is required.", "NO_WALLET");
  }

  const wallet = normalizeWalletAddress(walletAddress);
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
  txHash: string
): Promise<{
  state: StoredSparkState;
  sparks: SparkSnapshot;
  granted: boolean;
}> {
  if (!isWalletAddress(walletAddress)) {
    throw new StreakRewardError(
      "A valid wallet address is required.",
      "NO_WALLET"
    );
  }

  const wallet = normalizeWalletAddress(walletAddress);
  const playerId = walletToPlayerId(wallet);
  const normalizedTxHash = txHash.trim().toLowerCase();
  const guardPath = shuffleGrantPath(normalizedTxHash);
  const existingGrant = await readPath<{ wallet?: string }>(guardPath);

  if (existingGrant?.wallet) {
    const recorded = normalizeWalletAddress(existingGrant.wallet);
    if (recorded !== wallet) {
      throw new StreakRewardError(
        "This reward was already used by another wallet.",
        "TX_ALREADY_USED"
      );
    }
    const snapshot = await getSparkSnapshotOnServer(playerId);
    return { ...snapshot, granted: false };
  }

  const now = Date.now();
  const state = normalizeSparkState(
    await ensureSparkStateOnServer(playerId),
    now
  );
  const baseUntil =
    state.infiniteUntil && state.infiniteUntil > now
      ? state.infiniteUntil
      : now;
  const infiniteUntil = baseUntil + INFINITE_SPARKS_MS;

  const claim = await claimGuardRecord(guardPath, wallet, () => ({
    wallet,
    grantedAt: now,
    infiniteUntil,
    reward: "INFINITE_SPARK_24H",
    source: "shuffle",
  }));

  if (claim.status === "conflict_other_wallet") {
    throw new StreakRewardError(
      "This reward was already used by another wallet.",
      "TX_ALREADY_USED"
    );
  }

  if (claim.status === "exists") {
    const snapshot = await getSparkSnapshotOnServer(playerId);
    return { ...snapshot, granted: false };
  }

  const nextState: StoredSparkState = {
    ...state,
    infiniteUntil,
  };

  try {
    await writePath(sparksPath(playerId), nextState);
  } catch (err) {
    await deletePath(guardPath).catch(() => {});
    throw err;
  }

  return {
    state: nextState,
    sparks: computeSparkSnapshot(nextState, now),
    granted: true,
  };
}
