/**
 * Progress write coalescing.
 *
 * Unity's MINIPAY_SAVE_PROGRESS can fire multiple times per second.
 * This module debounces saves per (playerId, gameId): within a 2-second window
 * only the highest value is written, and all callers awaiting that window
 * receive the same result.
 *
 * Because Cloudflare Workers handle one request per isolate invocation this
 * primarily helps when a single game session sends rapid POST /api/games/[id]/progress
 * calls (e.g. from multiple Unity bootstrap retries or quick-save loops).
 */

import { GameProgress } from "@/types";

const COALESCE_WINDOW_MS = 2_000;

interface PendingWrite {
  maxValue: number;
  hasLeaderboard: boolean;
  playerName?: string;
  resolvers: Array<(progress: GameProgress) => void>;
  rejecters: Array<(err: unknown) => void>;
  timer: ReturnType<typeof setTimeout>;
  flushFn: () => Promise<void>;
}

const pending = new Map<string, PendingWrite>();

function coalesceKey(playerId: string, gameId: string): string {
  return `${playerId}::${gameId}`;
}

/**
 * Coalesce a progress save into a 2-second debounce window.
 *
 * @param playerId   Namespaced player id (e.g. "evm:0x...")
 * @param gameId     Game id string
 * @param value      Score or level to persist
 * @param hasLeaderboard  Whether this is a score game
 * @param opts       Optional player name for leaderboard sync
 * @param writer     The actual async function that writes to RTDB
 */
export function coalesceProgressWrite(
  playerId: string,
  gameId: string,
  value: number,
  hasLeaderboard: boolean,
  opts: { playerName?: string },
  writer: (
    v: number,
    hasLeaderboard: boolean,
    opts: { playerName?: string }
  ) => Promise<GameProgress>
): Promise<GameProgress> {
  const key = coalesceKey(playerId, gameId);

  return new Promise<GameProgress>((resolve, reject) => {
    const existing = pending.get(key);

    if (existing) {
      // Absorb into existing window — keep the highest value
      if (value > existing.maxValue) {
        existing.maxValue = value;
      }
      if (opts.playerName && !existing.playerName) {
        existing.playerName = opts.playerName;
      }
      existing.resolvers.push(resolve);
      existing.rejecters.push(reject);
      return;
    }

    // Start a new debounce window
    const entry: PendingWrite = {
      maxValue: value,
      hasLeaderboard,
      playerName: opts.playerName,
      resolvers: [resolve],
      rejecters: [reject],
      // populated below
      timer: undefined as unknown as ReturnType<typeof setTimeout>,
      flushFn: undefined as unknown as () => Promise<void>,
    };

    entry.flushFn = async () => {
      pending.delete(key);
      try {
        const result = await writer(entry.maxValue, entry.hasLeaderboard, {
          playerName: entry.playerName,
        });
        for (const res of entry.resolvers) res(result);
      } catch (err) {
        for (const rej of entry.rejecters) rej(err);
      }
    };

    entry.timer = setTimeout(() => void entry.flushFn(), COALESCE_WINDOW_MS);
    pending.set(key, entry);
  });
}
