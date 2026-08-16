import { GameProgress } from "@/types";

export interface GameProgressResponse {
  progress: GameProgress;
  hasLeaderboard: boolean;
}

export async function getGameProgress(
  gameId: string,
  playerId: string,
  opts?: { playerName?: string }
): Promise<GameProgressResponse> {
  const params = new URLSearchParams({ playerId });
  if (opts?.playerName?.trim()) {
    params.set("name", opts.playerName.trim());
  }
  const res = await fetch(`/api/games/${gameId}/progress?${params}`, {
    cache: "no-store",
    credentials: "include",
  });
  const data = (await res.json()) as GameProgressResponse & { error?: string };

  if (!res.ok) {
    throw new Error(data.error ?? "Could not load game progress.");
  }

  return {
    progress: data.progress ?? {},
    hasLeaderboard: data.hasLeaderboard ?? true,
  };
}

export async function saveGameProgress(
  gameId: string,
  playerId: string,
  value: number,
  opts?: { playerName?: string; playSessionId?: string }
): Promise<GameProgressResponse & { success: boolean }> {
  const res = await fetch(`/api/games/${gameId}/progress`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      playerId,
      value,
      score: value,
      ...(opts?.playerName?.trim()
        ? { playerName: opts.playerName.trim() }
        : {}),
      ...(opts?.playSessionId?.trim()
        ? { playSessionId: opts.playSessionId.trim() }
        : {}),
    }),
  });

  const data = (await res.json()) as GameProgressResponse & {
    success?: boolean;
    error?: string;
  };

  if (!res.ok) {
    throw new Error(data.error ?? "Could not save game progress.");
  }

  return {
    success: data.success ?? true,
    progress: data.progress ?? {},
    hasLeaderboard: data.hasLeaderboard ?? true,
  };
}
