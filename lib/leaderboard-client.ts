import {
  LeaderboardEntry,
  LeaderboardResponse,
} from "@/types";

export async function fetchLeaderboardData(
  gameId: string,
  opts?: {
    walletAddress?: string;
    playerName?: string;
    playerId?: string;
    chainId?: number;
  }
): Promise<LeaderboardResponse> {
  const params = new URLSearchParams();
  if (opts?.walletAddress) params.set("wallet", opts.walletAddress);
  if (opts?.playerName) params.set("name", opts.playerName);
  if (opts?.playerId) params.set("playerId", opts.playerId);
  if (typeof opts?.chainId === "number" && Number.isFinite(opts.chainId)) {
    params.set("chainId", String(opts.chainId));
  }
  const qs = params.toString();

  const res = await fetch(
    `/api/games/${gameId}/leaderboard${qs ? `?${qs}` : ""}`,
    { cache: "no-store" }
  );
  const data = (await res.json()) as LeaderboardResponse & { error?: string };

  if (!res.ok) {
    throw new Error(data.error ?? "Could not load leaderboard.");
  }

  return data;
}

export async function getLeaderboard(
  gameId: string
): Promise<LeaderboardEntry[]> {
  const data = await fetchLeaderboardData(gameId);
  return data.entries ?? [];
}

export async function getUserBestScore(
  gameId: string,
  opts: { walletAddress?: string; playerName?: string; playerId?: string }
): Promise<number> {
  const data = await fetchLeaderboardData(gameId, opts);
  return data.personalBest ?? 0;
}

/** Free personal-best save (progress node only). */
export async function savePersonalBest(
  gameId: string,
  entry: LeaderboardEntry & { playerId?: string }
): Promise<number> {
  const res = await fetch(`/api/games/${gameId}/leaderboard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  });

  const data = (await res.json()) as { personalBest?: number; error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? "Could not save score.");
  }

  return data.personalBest ?? entry.score;
}

/** Paid public leaderboard submit. */
export async function submitPaidScore(
  gameId: string,
  params: {
    score: number;
    walletAddress: string;
    txHash: string;
    name?: string;
    tokenAddress?: string;
    ecosystem?: string;
    chainId?: number;
    playSessionId?: string;
  }
): Promise<{ submittedBest: number }> {
  const res = await fetch(`/api/games/${gameId}/leaderboard/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      score: params.score,
      walletAddress: params.walletAddress,
      txHash: params.txHash,
      name: params.name,
      tokenAddress: params.tokenAddress,
      ecosystem: params.ecosystem,
      chainId: params.chainId,
      playSessionId: params.playSessionId,
    }),
  });

  const data = (await res.json()) as {
    submittedBest?: number;
    error?: string;
    code?: string;
  };

  if (!res.ok) {
    const err = new Error(data.error ?? "Could not submit score.") as Error & {
      code?: string;
    };
    err.code = data.code;
    throw err;
  }

  return { submittedBest: data.submittedBest ?? params.score };
}

/** @deprecated Use savePersonalBest for free saves or submitPaidScore for public board. */
export async function submitScore(
  gameId: string,
  entry: LeaderboardEntry
): Promise<number> {
  return savePersonalBest(gameId, entry);
}
