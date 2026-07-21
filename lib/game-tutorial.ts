import { Game } from "@/types";
import { slugifyGameName } from "@/lib/game-assets";

/** Tutorial image filenames under public/tutorials/ */
const TUTORIAL_BY_SLUG: Record<string, string> = {
  "coin-sort": "COIN SORT.webp",
  "dot-connect": "DOT-CONNECT.webp",
  "math-run": "MATH-RUN.webp",
  "orbit-flow": "ORBIT-FLOW.webp",
  "line-link": "LINE-LINK.webp",
  "block-blast": "BLOCK-BLAST.webp",
  basedrop: "BASE-DROP.webp",
  "base-drop": "BASE-DROP.webp",
};

const SEEN_PREFIX = "arcadex_tutorial_seen_";

function tutorialSlugForGame(game: Pick<Game, "id" | "name">): string | null {
  const nameSlug = slugifyGameName(game.name);
  if (TUTORIAL_BY_SLUG[nameSlug]) return nameSlug;

  const id = game.id.trim().toLowerCase();
  if (id && TUTORIAL_BY_SLUG[id]) return id;

  const upperName = game.name.trim().toUpperCase().replace(/\s+/g, "-");
  const upperKey = Object.keys(TUTORIAL_BY_SLUG).find(
    (key) => TUTORIAL_BY_SLUG[key]?.replace(".webp", "") === upperName
  );
  if (upperKey) return upperKey;

  return null;
}

export function hasTutorial(game: Pick<Game, "id" | "name">): boolean {
  return tutorialSlugForGame(game) !== null;
}

export function getTutorialImageUrl(game: Pick<Game, "id" | "name">): string | null {
  const slug = tutorialSlugForGame(game);
  if (!slug) return null;
  const file = TUTORIAL_BY_SLUG[slug];
  return `/tutorials/${encodeURI(file)}`;
}

export function hasSeenTutorial(gameId: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(`${SEEN_PREFIX}${gameId}`) === "1";
  } catch {
    return true;
  }
}

export function markTutorialSeen(gameId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(`${SEEN_PREFIX}${gameId}`, "1");
  } catch {
    // ignore quota / private mode
  }
}
