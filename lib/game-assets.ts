import { Game } from "@/types";

/** Folder names under public/games/ for each title. */
const LOCAL_GAME_FOLDERS = [
  "basedrop",
  "block-blast",
  "dot-connect",
  "math-run",
  "orbit-flow",
] as const;

/**
 * Flat logo files in public/games/ (not per-folder).
 * Keys are game name/id slugs from slugifyGameName / Firestore id.
 */
const FLAT_LOGO_BY_SLUG: Record<string, string> = {
  "line-link": "/games/line-logo.webp",
  "coin-sort": "/games/coin-logo.webp",
  "arrow-out": "/games/arrowout-logo.webp",
  arrowout: "/games/arrowout-logo.webp",
  "sand-drop": "/games/sanddrop-logo.webp",
  sanddrop: "/games/sanddrop-logo.webp",
  burger: "/games/burger-logo.webp",
  "burger-game": "/games/burger-logo.webp",
  "restaurant-empire": "/games/burger-logo.webp",
  cake: "/games/cake-logo.webp",
  dunk: "/games/Dunk-logo.webp",
  "jelly-jumble": "/games/jelly-logo.webp",
  jelly: "/games/jelly-logo.webp",
  reflector: "/games/reflector-logo.webp",
  goe: "/games/goe-logo.webp",
  "guardians-of-the-earth": "/games/goe-logo.webp",
  "free-fall": "/games/free-logo.webp",
  "infinite-spiral": "/games/spiral-logo.webp",
  tower: "/games/tower-logo.webp",
  "defend-tower": "/games/tower-logo.webp",
  "defend-the-tower": "/games/tower-logo.webp",
  "hungry-hole": "/games/hungry-logo.webp",
  fruit: "/games/fruit-logo.webp",
  "fruit-game": "/games/fruit-logo.webp",
  "fruit-swipe": "/games/fruit-logo.webp",
  "fruite-swipe": "/games/fruit-logo.webp",
};

/** Wide card art in public/thumbnails when the name slug does not match the file. */
const FLAT_THUMB_BY_SLUG: Record<string, string> = {
  reflector: "/thumbnails/reflector.webp",
  goe: "/thumbnails/goe.webp",
  "guardians-of-the-earth": "/thumbnails/goe.webp",
  "free-fall": "/thumbnails/free-fall.webp",
  "infinite-spiral": "/thumbnails/infinite-spiral.webp",
  burger: "/thumbnails/burger-game.webp",
  "burger-game": "/thumbnails/burger-game.webp",
  "restaurant-empire": "/thumbnails/burger-game.webp",
  "defend-tower": "/thumbnails/defend-tower.webp",
  "defend-the-tower": "/thumbnails/defend-tower.webp",
  "hungry-hole": "/thumbnails/hungry-hole.webp",
  fruit: "/thumbnails/fruit-game.webp",
  "fruit-game": "/thumbnails/fruit-game.webp",
  "fruit-swipe": "/thumbnails/fruit-game.webp",
  "fruite-swipe": "/thumbnails/fruit-game.webp",
};

/**
 * Flat fallback images in public/games/.
 * Used when thumbnail/logo remote URLs fail.
 */
const FLAT_FALLBACK_BY_SLUG: Record<string, string> = {
  "jelly-jumble": "/games/jelly-logo.webp",
  jelly: "/games/jelly-logo.webp",
};

export function slugifyGameName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function isFirestoreAutoId(id: string): boolean {
  return /^[a-zA-Z0-9]{15,}$/.test(id) && !id.includes("-");
}

function resolveLocalGameFolder(game: Game): string | null {
  const nameSlug = slugifyGameName(game.name);
  if (LOCAL_GAME_FOLDERS.includes(nameSlug as (typeof LOCAL_GAME_FOLDERS)[number])) {
    return nameSlug;
  }

  const id = game.id.trim().toLowerCase();
  if (id && !isFirestoreAutoId(id)) {
    if (LOCAL_GAME_FOLDERS.includes(id as (typeof LOCAL_GAME_FOLDERS)[number])) {
      return id;
    }
  }

  return null;
}

function resolveFromSlugMap(
  game: Pick<Game, "id" | "name">,
  map: Record<string, string>
): string | null {
  const nameSlug = slugifyGameName(game.name);
  if (map[nameSlug]) return map[nameSlug];

  const id = game.id.trim().toLowerCase();
  if (id && map[id]) return map[id];

  return null;
}

function resolveFlatLogo(game: Game): string | null {
  return resolveFromSlugMap(game, FLAT_LOGO_BY_SLUG);
}

function resolveFlatThumb(game: Game): string | null {
  return resolveFromSlugMap(game, FLAT_THUMB_BY_SLUG);
}

function resolveFlatFallback(game: Game): string | null {
  const nameSlug = slugifyGameName(game.name);
  if (FLAT_FALLBACK_BY_SLUG[nameSlug]) return FLAT_FALLBACK_BY_SLUG[nameSlug];

  const id = game.id.trim().toLowerCase();
  if (id && FLAT_FALLBACK_BY_SLUG[id]) return FLAT_FALLBACK_BY_SLUG[id];

  return null;
}

/**
 * Games that have both /thumbnails/{slug}.webm and .mp4.
 * Cards outside this set stay on the static WebP (no 404 probes).
 */
export const LOCAL_PREVIEW_VIDEO_FOLDERS = new Set([
  "basedrop",
  "block-blast",
  "burger-game",
  "coin-sort",
  "dot-connect",
  "free-fall",
  "fruit-game",
  "goe",
  "hungry-hole",
  "infinite-spiral",
  "jelly-jumble",
  "line-link",
  "orbit-flow",
  "reflector",
]);

/** Catalog name/id slugs that don't match the thumbnail filename. */
const PREVIEW_VIDEO_ALIAS: Record<string, string> = {
  "base-drop": "basedrop",
  burger: "burger-game",
  "burger-life": "burger-game",
  "restaurant-empire": "burger-game",
  fruit: "fruit-game",
  "fruit-swipe": "fruit-game",
  "fruite-swipe": "fruit-game",
  "guardians-of-the-earth": "goe",
  jelly: "jelly-jumble",
};

export type GameVideoSources = {
  webm: string;
  mp4: string;
  poster: string;
};

/** Allowlisted preview folder for a catalog game, or null when it should stay an image. */
export function resolvePreviewVideoFolder(
  game: Pick<Game, "id" | "name">
): string | null {
  const nameSlug = slugifyGameName(game.name);
  const fromName = PREVIEW_VIDEO_ALIAS[nameSlug] ?? nameSlug;
  if (LOCAL_PREVIEW_VIDEO_FOLDERS.has(fromName)) return fromName;

  const id = game.id.trim().toLowerCase();
  if (id && !isFirestoreAutoId(id)) {
    const fromId = PREVIEW_VIDEO_ALIAS[id] ?? id;
    if (LOCAL_PREVIEW_VIDEO_FOLDERS.has(fromId)) return fromId;
  }

  return null;
}

/** Static preview clips. Null means the card should keep the WebP only. */
export function gameVideoSources(
  game: Pick<Game, "id" | "name">
): GameVideoSources | null {
  const folder = resolvePreviewVideoFolder(game);
  if (!folder) return null;
  return {
    webm: `/thumbnails/${folder}.webm`,
    mp4: `/thumbnails/${folder}.mp4`,
    poster: `/thumbnails/${folder}.webp`,
  };
}

function pushLocalGameAssets(
  push: (url?: string) => void,
  folder: string,
  kind: "logo" | "thumbnail"
) {
  if (kind === "thumbnail") {
    push(`/thumbnails/${folder}.webp`);
  }

  push(`/games/${folder}/logo.webp`);
  push(`/games/${folder}/logo.png`);
  push(`/games/${folder}/thumbnail.webp`);
  push(`/games/${folder}/thumbnail.png`);
}

/** Local / remote asset URLs to try, in priority order. */
export function gameAssetCandidates(
  game: Game,
  kind: "logo" | "thumbnail"
): string[] {
  const field = kind === "logo" ? game.logo : game.thumbnail;
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (url?: string) => {
    if (!url?.trim() || seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };

  const localFolder = resolveLocalGameFolder(game);

  // Prefer bundled assets so they show even when remote URLs fail.
  if (kind === "logo") {
    push(resolveFlatLogo(game) ?? undefined);
  } else {
    push(resolveFlatThumb(game) ?? undefined);
  }

  if (localFolder) {
    pushLocalGameAssets(push, localFolder, kind);
  }

  push(field);

  if (kind === "logo" && game.thumbnail?.trim()) {
    push(game.thumbnail);
  }

  if (localFolder) {
    return out;
  }

  const nameSlug = slugifyGameName(game.name);
  if (nameSlug) {
    pushLocalGameAssets(push, nameSlug, kind);
  }

  const id = game.id.trim().toLowerCase();
  if (id && !isFirestoreAutoId(id)) {
    pushLocalGameAssets(push, id, kind);
  }

  return out;
}

/** Fallback image URLs when thumbnail and logo are unavailable. */
export function gameFallbackCandidates(game: Game): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (url?: string) => {
    if (!url?.trim() || seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };

  // Prefer bundled flat fallback so remote/empty fallbackImage does not blank the menu.
  push(resolveFlatFallback(game) ?? undefined);
  push(game.fallbackImage);

  const localFolder = resolveLocalGameFolder(game);
  if (localFolder) {
    push(`/games/${localFolder}/fallback.webp`);
    push(`/games/${localFolder}/fallback.png`);
  }

  const nameSlug = slugifyGameName(game.name);
  if (nameSlug && nameSlug !== localFolder) {
    push(`/games/${nameSlug}/fallback.webp`);
    push(`/games/${nameSlug}/fallback.png`);
  }

  return out;
}
