import { Game } from "@/types";

/** Sort games for display: explicit `order` first, then newest `createdAt`. */
export function sortGames(games: Game[]): Game[] {
  return [...games].sort((a, b) => {
    const aOrder = a.order ?? Number.MAX_SAFE_INTEGER;
    const bOrder = b.order ?? Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return (b.createdAt ?? 0) - (a.createdAt ?? 0);
  });
}
