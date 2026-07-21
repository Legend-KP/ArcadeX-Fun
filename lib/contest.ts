import type { ContestDurationDays, ContestStatus, Game } from "@/types";
import { getContestStatus } from "@/types";

export const CONTEST_DURATION_OPTIONS: ContestDurationDays[] = [1, 2, 4, 7];

const DAY_MS = 86_400_000;

export function contestDurationToMs(days: ContestDurationDays): number {
  return days * DAY_MS;
}

export function computeContestEndsAt(
  startedAt: number,
  durationDays: ContestDurationDays
): number {
  return startedAt + contestDurationToMs(durationDays);
}

export function formatContestCountdown(ms: number): string {
  if (ms <= 0) return "0s";

  const totalSeconds = Math.ceil(ms / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours > 0 || days > 0) parts.push(`${minutes}m`);
  if (days === 0) parts.push(`${seconds}s`);

  return parts.join(" ");
}

export function getContestLabel(
  game: Pick<Game, "contestStartedAt" | "contestEndsAt">,
  now = Date.now()
): string {
  const status = getContestStatus(game, now);
  if (status === "live") return "Contest live";
  if (status === "ended") return "Contest ended";
  return "No contest";
}

export function buildContestStartPayload(params: {
  task: string;
  durationDays: ContestDurationDays;
  now?: number;
}): Pick<
  Game,
  | "contestTask"
  | "contestStartedAt"
  | "contestEndsAt"
  | "contestDurationDays"
  | "contestLive"
> {
  const now = params.now ?? Date.now();
  const startedAt = now;
  return {
    contestTask: params.task.trim(),
    contestStartedAt: startedAt,
    contestEndsAt: computeContestEndsAt(startedAt, params.durationDays),
    contestDurationDays: params.durationDays,
    contestLive: true,
  };
}

export function buildContestEditPayload(params: {
  task: string;
  durationDays: ContestDurationDays;
  startedAt: number;
}): Pick<Game, "contestTask" | "contestEndsAt" | "contestDurationDays"> {
  return {
    contestTask: params.task.trim(),
    contestDurationDays: params.durationDays,
    contestEndsAt: computeContestEndsAt(params.startedAt, params.durationDays),
  };
}

export function contestStatusLabel(status: ContestStatus | null): string {
  if (status === "live") return "Contest live";
  if (status === "ended") return "Contest ended";
  return "No contest";
}
