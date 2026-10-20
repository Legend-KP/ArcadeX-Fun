import { fetchLeaderboardData } from "@/lib/leaderboard-client";
import { gameAssetCandidates } from "@/lib/game-assets";
import { Game, gameHasLeaderboard } from "@/types";

export type ScoreCast = {
  id: string;
  playerName: string;
  score: number;
  gameId: string;
  gameName: string;
  thumbnail: string;
  createdAt: number;
  walletAddress?: string;
};

export async function loadScoreCasts(games: Game[]): Promise<ScoreCast[]> {
  const ranked = games.filter((game) => gameHasLeaderboard(game));
  const batches = await Promise.all(
    ranked.map(async (game) => {
      try {
        const data = await fetchLeaderboardData(game.id);
        const thumbnail =
          gameAssetCandidates(game, "thumbnail")[0] ||
          game.thumbnail ||
          gameAssetCandidates(game, "logo")[0] ||
          "";
        return (data.entries ?? []).map((entry) => ({
          id: `${game.id}:${entry.walletAddress ?? entry.name}:${entry.score}:${entry.createdAt ?? 0}`,
          playerName: entry.name,
          score: entry.score,
          gameId: game.id,
          gameName: game.name,
          thumbnail,
          createdAt: entry.createdAt ?? 0,
          walletAddress: entry.walletAddress,
        }));
      } catch {
        return [] as ScoreCast[];
      }
    })
  );

  return batches
    .flat()
    .sort((a, b) => b.createdAt - a.createdAt || b.score - a.score);
}
