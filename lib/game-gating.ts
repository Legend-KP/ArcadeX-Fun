import type { Game } from "@/types";
import { getDatabaseUrl } from "@/lib/firebase-admin";

export interface GameGatingFlags {
  active: boolean;
  live: boolean;
  hasLeaderboard: boolean;
  contestTask?: string;
  contestStartedAt?: number;
  contestEndsAt?: number;
  contestDurationDays?: number;
  contestLive?: boolean;
}

function getRtdbAuthQuery(): string {
  const secret = process.env.FIREBASE_DATABASE_SECRET?.trim();
  if (!secret) {
    throw new Error("FIREBASE_DATABASE_SECRET is missing.");
  }
  return `auth=${encodeURIComponent(secret)}`;
}

function encodeRtdbPath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function writeGating(path: string, data: GameGatingFlags): Promise<void> {
  const url = `${getDatabaseUrl()}/${encodeRtdbPath(path)}.json?${getRtdbAuthQuery()}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`RTDB gating sync failed (${res.status}): ${text}`);
  }
}

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
  };
}

export async function syncGameGatingFlagsToRtdb(game: Game): Promise<void> {
  await writeGating(`gameGating/${game.id}`, gameToGatingFlags(game));
}

export async function removeGameGatingFromRtdb(gameId: string): Promise<void> {
  const url = `${getDatabaseUrl()}/${encodeRtdbPath(`gameGating/${gameId}`)}.json?${getRtdbAuthQuery()}`;
  await fetch(url, { method: "DELETE", cache: "no-store" });
}

let gatingCache: Map<string, { data: GameGatingFlags; fetchedAt: number }> =
  new Map();
const GATING_TTL_MS = 45_000;

export async function fetchGameGatingFromRtdb(
  gameId: string
): Promise<GameGatingFlags | null> {
  const cached = gatingCache.get(gameId);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < GATING_TTL_MS) {
    return cached.data;
  }

  const url = `${getDatabaseUrl()}/${encodeRtdbPath(`gameGating/${gameId}`)}.json?${getRtdbAuthQuery()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) return null;

  const data = (await res.json()) as GameGatingFlags | null;
  if (!data) return null;

  gatingCache.set(gameId, { data, fetchedAt: now });
  return data;
}

export function invalidateGameFlagsCache(gameId?: string): void {
  if (gameId) {
    gatingCache.delete(gameId);
  } else {
    gatingCache = new Map();
  }
}
