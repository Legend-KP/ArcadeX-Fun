export const LEADERBOARD_MAX_ENTRIES = 25;
export const CONTEST_TOP_MAX_ENTRIES = 10;

export type ContestDurationDays = 1 | 2 | 4 | 7;
export type ContestStatus = "live" | "ended";

export interface LeaderboardEntry {
  name: string;
  score: number;
  walletAddress?: string;
  createdAt?: number;
}

export interface ContestLeaderboardPayload {
  status: ContestStatus;
  task: string;
  startedAt: number;
  endsAt: number;
  durationDays: ContestDurationDays;
  entries: LeaderboardEntry[];
}

export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  personalBest?: number;
  submittedBest?: number;
  canSubmit?: boolean;
  contest?: ContestLeaderboardPayload | null;
}

export type WalletEcosystem =
  | "evm"
  | "starknet"
  | "sui"
  | "aptos"
  | "movement"
  | "stellar"
  | "vara";

export interface PlayerProfile {
  id: string;
  name: string;
  email?: string;
  walletAddress?: string;
  ecosystem?: WalletEcosystem;
  chainId?: number;
  createdAt: number;
  updatedAt: number;
}

export interface Game {
  id: string;
  name: string;
  thumbnail: string;   // image URL
  logo?: string;       // square 1:1 logo URL (menu screen)
  url: string;         // Unity WebGL URL
  plays: string;       // display string e.g. "1.2m"
  fallbackImage: string; // image URL when thumbnail/logo are missing
  active: boolean;
  /** When false, the game is visible but shows "Coming Soon" and cannot be played. Defaults to true. */
  live?: boolean;
  /** When false, leaderboard UI, RTDB paths, and score APIs are disabled. Defaults to true. */
  hasLeaderboard?: boolean;
  /** Lower numbers appear first on the home page. Set via admin drag-and-drop. */
  order?: number;
  createdAt: number;
  /** Contest task description shown in leaderboard UI */
  contestTask?: string;
  /** Legacy flag — use contestEndsAt for live status */
  contestLive?: boolean;
  contestStartedAt?: number;
  contestEndsAt?: number;
  contestDurationDays?: ContestDurationDays;
}

export function gameHasLeaderboard(game: Pick<Game, "hasLeaderboard">): boolean {
  return game.hasLeaderboard !== false;
}

export function gameIsLive(game: Pick<Game, "live">): boolean {
  return game.live !== false;
}

export function gameHasContestLive(
  game: Pick<Game, "contestEndsAt">,
  now = Date.now()
): boolean {
  return typeof game.contestEndsAt === "number" && game.contestEndsAt > now;
}

export function getContestStatus(
  game: Pick<Game, "contestStartedAt" | "contestEndsAt">,
  now = Date.now()
): ContestStatus | null {
  if (
    typeof game.contestStartedAt !== "number" ||
    typeof game.contestEndsAt !== "number"
  ) {
    return null;
  }
  return game.contestEndsAt > now ? "live" : "ended";
}

export type ChainKey =
  | "megaeth"
  | "bnb"
  | "berachain"
  | "cronos"
  | "beam"
  | "sui"
  | "aptos"
  | "movement"
  | "stellar"
  | "vara"
  | "starknet";

export interface ChainFeatures {
  walletConnect: boolean;
  shopPayments: boolean;
}

export interface ChainSettingsEntry {
  key: ChainKey;
  name: string;
  ecosystem: WalletEcosystem;
  chainId?: number;
  defaultShopPayments: boolean;
}

export interface ChainSettingsResponse {
  chains: ChainSettingsEntry[];
  settings: Record<ChainKey, ChainFeatures>;
}

/**
 * Raw RTDB shape at `users/{wallet}/games/{gameId}`.
 * Score games store `s`; level games store `l`. No timestamp field.
 */
export interface StoredGameProgress {
  /** High score (when hasLeaderboard is true) */
  s?: number;
  /** Current level (when hasLeaderboard is false) */
  l?: number;
}

/** API / client-facing game progress */
export interface GameProgress {
  score?: number;
  level?: number;
}

export interface StoredSparkState {
  max: number;
  regenMs: number;
  slots: (number | null)[];
  infiniteUntil?: number;
}

export interface SparkSlotView {
  index: number;
  status: "ready" | "regenerating";
  fillPercent: number;
  timeRemainingMs: number;
}

export interface SparkSnapshot {
  max: number;
  available: number;
  fillPercent: number;
  timeToFullMs: number;
  timeToNextMs: number;
  slots: SparkSlotView[];
  regeneratingCount: number;
  hasInfinite: boolean;
  infiniteUntil?: number;
}
