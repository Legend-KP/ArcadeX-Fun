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
  cake: "/games/cake-logo.webp",
  dunk: "/games/Dunk-logo.webp",
  "jelly-jumble": "/games/jelly-logo.webp",
  jelly: "/games/jelly-logo.webp",
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

function resolveFlatLogo(game: Game): string | null {
  const nameSlug = slugifyGameName(game.name);
  if (FLAT_LOGO_BY_SLUG[nameSlug]) return FLAT_LOGO_BY_SLUG[nameSlug];

  const id = game.id.trim().toLowerCase();
  if (id && FLAT_LOGO_BY_SLUG[id]) return FLAT_LOGO_BY_SLUG[id];

  return null;
}

function resolveFlatFallback(game: Game): string | null {
  const nameSlug = slugifyGameName(game.name);
  if (FLAT_FALLBACK_BY_SLUG[nameSlug]) return FLAT_FALLBACK_BY_SLUG[nameSlug];

  const id = game.id.trim().toLowerCase();
  if (id && FLAT_FALLBACK_BY_SLUG[id]) return FLAT_FALLBACK_BY_SLUG[id];

  return null;
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
