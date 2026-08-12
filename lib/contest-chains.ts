import {
  chainKeyToDefaultChainId,
  isRtdbChainKey,
  resolveRtdbChainKey,
} from "@/lib/rtdb-resolver";
import type { WalletEcosystem } from "@/lib/player-identity";
import {
  gameHasContestLive,
  getContestStatus,
  type ChainContestState,
  type ContestChainKey,
  type ContestStatus,
  type Game,
} from "@/types";

export const CONTEST_CHAIN_KEYS: ContestChainKey[] = [
  "base",
  "avalanche",
  "vara",
];

export const CONTEST_CHAIN_LABELS: Record<ContestChainKey, string> = {
  base: "Base",
  avalanche: "Avalanche",
  vara: "Vara",
};

const CONTEST_FIELD_SUFFIXES = [
  "contestTask",
  "contestLive",
  "contestStartedAt",
  "contestEndsAt",
  "contestDurationDays",
] as const;

type ContestFieldSuffix = (typeof CONTEST_FIELD_SUFFIXES)[number];

export function isContestChainKey(
  value: string | null | undefined
): value is ContestChainKey {
  return value === "base" || value === "avalanche" || value === "vara";
}

export function contestFieldPath(
  chainKey: ContestChainKey,
  field: ContestFieldSuffix
): string {
  return `${chainKey}_${field}`;
}

export function legacyContestFromGame(game: Game): ChainContestState {
  return {
    ...(game.contestTask ? { contestTask: game.contestTask } : {}),
    ...(game.contestLive !== undefined ? { contestLive: game.contestLive } : {}),
    ...(typeof game.contestStartedAt === "number"
      ? { contestStartedAt: game.contestStartedAt }
      : {}),
    ...(typeof game.contestEndsAt === "number"
      ? { contestEndsAt: game.contestEndsAt }
      : {}),
    ...(typeof game.contestDurationDays === "number"
      ? { contestDurationDays: game.contestDurationDays }
      : {}),
  };
}

function hasContestData(state: ChainContestState | undefined): boolean {
  if (!state) return false;
  return (
    Boolean(state.contestTask) ||
    typeof state.contestStartedAt === "number" ||
    typeof state.contestEndsAt === "number" ||
    typeof state.contestDurationDays === "number" ||
    state.contestLive !== undefined
  );
}

/** Resolve contest fields for one chain (Base falls back to legacy top-level). */
export function getChainContestState(
  game: Game,
  chainKey: ContestChainKey
): ChainContestState {
  const fromMap = game.chainContests?.[chainKey];
  if (hasContestData(fromMap)) return { ...fromMap };

  if (chainKey === "base") {
    return legacyContestFromGame(game);
  }

  return {};
}

/** Overlay chain contest onto top-level contest* fields for status helpers / UI. */
export function applyContestForChain(
  game: Game,
  chainKey: ContestChainKey
): Game {
  const contest = getChainContestState(game, chainKey);
  return {
    ...game,
    contestTask: contest.contestTask,
    contestLive: contest.contestLive,
    contestStartedAt: contest.contestStartedAt,
    contestEndsAt: contest.contestEndsAt,
    contestDurationDays: contest.contestDurationDays,
  };
}

/** Whether this game has an active contest on a specific chain. */
export function gameHasContestLiveForChain(
  game: Game,
  chainKey: ContestChainKey,
  now = Date.now()
): boolean {
  return gameHasContestLive(applyContestForChain(game, chainKey), now);
}

/** Chain-scoped contest live check from the player's connected chain. */
export function gameHasContestLiveForSession(
  game: Game,
  opts: {
    chainId?: number | null;
    ecosystem?: WalletEcosystem | null;
    chainKey?: string | null;
    /** When true, hide contest UI until a chain/ecosystem is known. */
    requireChain?: boolean;
  },
  now = Date.now()
): boolean {
  if (
    opts.requireChain &&
    opts.chainId == null &&
    !opts.ecosystem &&
    !opts.chainKey
  ) {
    return false;
  }
  const chainKey = resolveContestChainKey(opts);
  return gameHasContestLiveForChain(game, chainKey, now);
}

export function resolveContestChainKey(opts: {
  chainId?: number | null;
  ecosystem?: WalletEcosystem | null;
  chainKey?: string | null;
}): ContestChainKey {
  if (opts.chainKey && isContestChainKey(opts.chainKey)) {
    return opts.chainKey;
  }

  const mapped = resolveRtdbChainKey({
    chainId: opts.chainId,
    ecosystem: opts.ecosystem ?? undefined,
  });
  if (mapped && isRtdbChainKey(mapped) && isContestChainKey(mapped)) {
    return mapped;
  }

  if (opts.ecosystem === "vara") return "vara";
  if (opts.ecosystem === "evm") return "base";
  return "base";
}

export function contestChainId(chainKey: ContestChainKey): number | undefined {
  return chainKeyToDefaultChainId(chainKey);
}

export function anyChainContestStatus(
  game: Game,
  now = Date.now()
): ContestStatus | null {
  let sawEnded = false;
  for (const key of CONTEST_CHAIN_KEYS) {
    const status = getContestStatus(getChainContestState(game, key), now);
    if (status === "live") return "live";
    if (status === "ended") sawEnded = true;
  }
  return sawEnded ? "ended" : null;
}

export function chainContestStatusSummary(
  game: Game,
  now = Date.now()
): string {
  const live = CONTEST_CHAIN_KEYS.filter(
    (key) => getContestStatus(getChainContestState(game, key), now) === "live"
  ).map((key) => CONTEST_CHAIN_LABELS[key]);

  if (live.length > 0) {
    return `Contest live (${live.join(", ")})`;
  }

  const ended = CONTEST_CHAIN_KEYS.filter(
    (key) => getContestStatus(getChainContestState(game, key), now) === "ended"
  );
  if (ended.length > 0) return "Contest ended";
  return "No contest";
}

/** Parse flat Firestore `{chain}_contest*` fields into chainContests. */
export function parseChainContestsFromFields(
  fields: Record<string, unknown>
): Partial<Record<ContestChainKey, ChainContestState>> {
  const result: Partial<Record<ContestChainKey, ChainContestState>> = {};

  for (const chainKey of CONTEST_CHAIN_KEYS) {
    const state: ChainContestState = {};
    const task = fields[contestFieldPath(chainKey, "contestTask")];
    const live = fields[contestFieldPath(chainKey, "contestLive")];
    const startedAt = fields[contestFieldPath(chainKey, "contestStartedAt")];
    const endsAt = fields[contestFieldPath(chainKey, "contestEndsAt")];
    const durationDays = fields[
      contestFieldPath(chainKey, "contestDurationDays")
    ];

    if (typeof task === "string" && task) state.contestTask = task;
    if (typeof live === "boolean") state.contestLive = live;
    if (typeof startedAt === "number" && Number.isFinite(startedAt)) {
      state.contestStartedAt = startedAt;
    }
    if (typeof endsAt === "number" && Number.isFinite(endsAt)) {
      state.contestEndsAt = endsAt;
    }
    if (
      durationDays === 1 ||
      durationDays === 2 ||
      durationDays === 4 ||
      durationDays === 7
    ) {
      state.contestDurationDays = durationDays;
    }

    if (hasContestData(state)) {
      result[chainKey] = state;
    }
  }

  return result;
}

/** Expand a chain contest patch into flat Firestore field updates. */
export function expandChainContestPatch(
  chainKey: ContestChainKey,
  contest: ChainContestState
): Record<string, string | number | boolean> {
  const patch: Record<string, string | number | boolean> = {};

  if (contest.contestTask !== undefined) {
    patch[contestFieldPath(chainKey, "contestTask")] = contest.contestTask;
  }
  if (contest.contestLive !== undefined) {
    patch[contestFieldPath(chainKey, "contestLive")] = contest.contestLive;
  }
  if (typeof contest.contestStartedAt === "number") {
    patch[contestFieldPath(chainKey, "contestStartedAt")] =
      contest.contestStartedAt;
  }
  if (typeof contest.contestEndsAt === "number") {
    patch[contestFieldPath(chainKey, "contestEndsAt")] = contest.contestEndsAt;
  }
  if (typeof contest.contestDurationDays === "number") {
    patch[contestFieldPath(chainKey, "contestDurationDays")] =
      contest.contestDurationDays;
  }

  // Keep legacy top-level fields in sync for Base (older clients / gating).
  if (chainKey === "base") {
    if (contest.contestTask !== undefined) patch.contestTask = contest.contestTask;
    if (contest.contestLive !== undefined) patch.contestLive = contest.contestLive;
    if (typeof contest.contestStartedAt === "number") {
      patch.contestStartedAt = contest.contestStartedAt;
    }
    if (typeof contest.contestEndsAt === "number") {
      patch.contestEndsAt = contest.contestEndsAt;
    }
    if (typeof contest.contestDurationDays === "number") {
      patch.contestDurationDays = contest.contestDurationDays;
    }
  }

  return patch;
}
