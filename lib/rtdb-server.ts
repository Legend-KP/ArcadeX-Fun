import {
  GameProgress,
  LEADERBOARD_MAX_ENTRIES,
  LeaderboardEntry,
  PlayerProfile,
  StoredGameProgress,
} from "@/types";
import { getDatabaseUrl } from "./firebase-admin";
import {
  isValidAddress,
  normalizeAddress,
  parsePlayerId,
  resolvePlayerId,
  WalletEcosystem,
} from "@/lib/player-identity";

type StoredUser = Omit<PlayerProfile, "id">;
type LeaderboardMap = Record<string, LeaderboardEntry>;

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
    return toPlayerProfile(resolved, stored)!;
  }

  return existing;
}

// ─── Game play counts ──────────────────────────────────────────────────────────

export async function fetchAllGamePlayCounts(): Promise<Record<string, number>> {
  const data = await readPath<Record<string, number>>("gamePlays");
  if (!data) return {};

  const counts: Record<string, number> = {};
  for (const [gameId, value] of Object.entries(data)) {
    counts[gameId] = typeof value === "number" ? value : 0;
  }
  return counts;
}

export async function fetchGamePlayCount(gameId: string): Promise<number> {
  const count = await readPath<number>(`gamePlays/${gameId}`);
  return typeof count === "number" ? count : 0;
}

export async function incrementGamePlayCount(gameId: string): Promise<number> {
  const current = await fetchGamePlayCount(gameId);
  const next = current + 1;
  await writePath(`gamePlays/${gameId}`, next);
  return next;
}

// ─── Leaderboard ─────────────────────────────────────────────────────────────

export async function fetchLeaderboardFromServer(
  gameId: string,
  limit = LEADERBOARD_MAX_ENTRIES
): Promise<LeaderboardEntry[]> {
  const map = await readPath<LeaderboardMap>(`leaderboards/${gameId}`);
  return deduplicateLeaderboardEntries(mapToLeaderboardEntries(map))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
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

export async function submitLeaderboardEntryOnServer(
  gameId: string,
  entry: LeaderboardEntry
): Promise<void> {
  const wallet = entry.walletAddress?.trim();
  const payload: LeaderboardEntry = {
    name: entry.name,
    score: entry.score,
    ...(wallet ? { walletAddress: wallet } : {}),
    createdAt: entry.createdAt ?? Date.now(),
  };

  const map = await readPath<LeaderboardMap>(`leaderboards/${gameId}`);
  const userKey = leaderboardUserKey(payload);
  const existingBest = deduplicateLeaderboardEntries(
    mapToLeaderboardEntries(map)
  ).find((e) => leaderboardUserKey(e) === userKey);

  if (existingBest && existingBest.score >= payload.score) {
    return;
  }

  await writePath(`leaderboards/${gameId}/${leaderboardStorageKey(payload)}`, payload);
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
 * Resolves progress for API / bootstrap. Score games use max(user `s`, leaderboard best)
 * and sync leaderboard → user node when the leaderboard is ahead.
 */
export async function resolveGameProgressFromServer(
  playerId: string,
  gameId: string,
  hasLeaderboard: boolean,
  opts?: { playerName?: string }
): Promise<GameProgress> {
  const resolved = resolvePlayerId(playerId);
  if (!resolved) return {};

  const stored = await fetchGameProgressFromServer(resolved, gameId);

  if (!hasLeaderboard) {
    return storedProgressToGameProgress(stored, false);
  }

  const userScore = stored?.s ?? 0;
  const parsed = parsePlayerId(resolved);
  const walletForLookup = parsed?.address ?? resolved;
  const leaderboardBest = await fetchUserBestScoreFromServer(gameId, {
    walletAddress: walletForLookup,
    playerName: opts?.playerName,
  });

  if (userScore > leaderboardBest) {
    await syncLeaderboardFromScoreOnServer(gameId, resolved, userScore, {
      playerName: opts?.playerName,
    });
  }

  const score = Math.max(userScore, leaderboardBest);

  if (score > userScore) {
    await saveGameProgressOnServer(resolved, gameId, score, true, {
      playerName: opts?.playerName,
    });
  }

  return score > 0 ? { score } : storedProgressToGameProgress(stored, true);
}

function resolveLeaderboardPlayerName(
  wallet: string,
  playerName?: string,
  profileName?: string
): string {
  const trimmed = playerName?.trim() || profileName?.trim();
  if (trimmed) return trimmed;
  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

async function syncLeaderboardFromScoreOnServer(
  gameId: string,
  playerId: string,
  score: number,
  opts?: { playerName?: string }
): Promise<void> {
  const profile = await fetchUserFromServer(playerId);
  const parsed = parsePlayerId(resolvePlayerId(playerId) ?? playerId);
  const wallet = parsed?.address ?? playerId;
  await submitLeaderboardEntryOnServer(gameId, {
    name: resolveLeaderboardPlayerName(
      wallet,
      opts?.playerName,
      profile?.name
    ),
    score,
    walletAddress: wallet,
  });
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

  if (hasLeaderboard) {
    await syncLeaderboardFromScoreOnServer(gameId, resolved, value, opts);
  }

  if (value <= currentValue) {
    return storedProgressToGameProgress(current, hasLeaderboard);
  }

  await patchPath(gameProgressPath(resolved, gameId), { [field]: value });

  const updated: StoredGameProgress = { ...current, [field]: value };
  return storedProgressToGameProgress(updated, hasLeaderboard);
}
