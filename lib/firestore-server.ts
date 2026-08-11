import { sortGames } from "@/lib/games-sort";
import {
  removeGameGatingFromRtdb,
  syncGatingAfterMutation,
} from "@/lib/game-gating";
import { Game } from "@/types";
import {
  getFirebaseAccessToken,
  getProjectId,
  getServiceAccount,
} from "@/lib/firebase-admin";
import {
  cachedFetchGameList,
  cachedFetchGameDoc,
  invalidateGameCache,
  isFirestoreOutageError,
} from "@/lib/game-cache";
import {
  logFirebaseRequest,
  sanitizeFirebasePath,
} from "@/lib/firebase-log";

type FirestoreValue = {
  stringValue?: string;
  booleanValue?: boolean;
  integerValue?: string;
  doubleValue?: number;
};

export type FirestoreDocument = {
  name: string;
  fields: Record<string, FirestoreValue>;
};

const FIRESTORE_TIMEOUT_MS = 12_000;

function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal) {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

function parseField(value: FirestoreValue | undefined): unknown {
  if (!value) return undefined;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.integerValue !== undefined) return Number(value.integerValue);
  if (value.doubleValue !== undefined) return value.doubleValue;
  return undefined;
}

function docToGame(doc: FirestoreDocument): Game {
  const id = doc.name.split("/").pop() ?? "";
  const fields = doc.fields;
  return {
    id,
    name: String(parseField(fields.name) ?? ""),
    thumbnail: String(parseField(fields.thumbnail) ?? ""),
    logo: parseField(fields.logo) as string | undefined,
    url: String(parseField(fields.url) ?? ""),
    plays: String(parseField(fields.plays) ?? "0"),
    fallbackImage: String(
      parseField(fields.fallbackImage) ?? parseField(fields.emoji) ?? ""
    ),
    active: parseField(fields.active) !== false,
    live: parseField(fields.live) !== false,
    hasLeaderboard: parseField(fields.hasLeaderboard) !== false,
    order:
      parseField(fields.order) !== undefined
        ? Number(parseField(fields.order))
        : undefined,
    createdAt: Number(parseField(fields.createdAt) ?? 0),
    contestTask: parseField(fields.contestTask) as string | undefined,
    contestLive: parseField(fields.contestLive) as boolean | undefined,
    contestStartedAt: parseField(fields.contestStartedAt) as number | undefined,
    contestEndsAt: parseField(fields.contestEndsAt) as number | undefined,
    contestDurationDays: parseField(fields.contestDurationDays) as
      | Game["contestDurationDays"]
      | undefined,
  };
}

export async function firestoreFetch(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const started = Date.now();
  const { projectId } = getServiceAccount();
  const token = await getFirebaseAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`;
  const method = (init?.method ?? "GET").toUpperCase();
  const operation =
    method === "GET"
      ? "get"
      : method === "PATCH"
        ? "patch"
        : method === "POST"
          ? "post"
          : method === "DELETE"
            ? "delete"
            : "get";

  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
      cache: "no-store",
      signal: init?.signal ?? timeoutSignal(FIRESTORE_TIMEOUT_MS),
    });

    const lenHeader = res.headers.get("content-length");
    const responseBytes = lenHeader ? Number(lenHeader) : undefined;

    logFirebaseRequest({
      database: "firestore",
      operation,
      pathCategory: sanitizeFirebasePath(path.split("?")[0] ?? path),
      durationMs: Date.now() - started,
      responseBytes: Number.isFinite(responseBytes) ? responseBytes : undefined,
      status: res.status,
    });

    return res;
  } catch (err) {
    logFirebaseRequest({
      database: "firestore",
      operation,
      pathCategory: sanitizeFirebasePath(path.split("?")[0] ?? path),
      durationMs: Date.now() - started,
      status: "error",
    });
    // Re-throw with message that game-cache can classify.
    if (err instanceof Error) throw err;
    throw new Error(String(err));
  }
}

async function listDocuments(path: string): Promise<FirestoreDocument[]> {
  const res = await firestoreFetch(path);
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Firestore request failed (${res.status}): ${text}`);
    // Annotate for circuit breaker classification.
    if (!isFirestoreOutageError(err)) {
      // still throw — just don't treat as outage upstream
    }
    throw err;
  }

  const data = (await res.json()) as { documents?: FirestoreDocument[] };
  return data.documents ?? [];
}

function encodeFields(
  data: Record<string, string | number | boolean>
): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string") fields[key] = { stringValue: value };
    else if (typeof value === "boolean") fields[key] = { booleanValue: value };
    else if (Number.isInteger(value)) fields[key] = { integerValue: String(value) };
    else fields[key] = { doubleValue: value };
  }
  return fields;
}

export function isGameVisible(game: Game): boolean {
  return game.active !== false;
}

/** Public catalog fields only — strip anything admin-only if added later. */
export function toPublicGame(game: Game): Game {
  return {
    id: game.id,
    name: game.name,
    thumbnail: game.thumbnail,
    logo: game.logo,
    url: game.url,
    plays: game.plays,
    fallbackImage: game.fallbackImage,
    active: game.active,
    live: game.live,
    hasLeaderboard: game.hasLeaderboard,
    order: game.order,
    createdAt: game.createdAt,
    contestTask: game.contestTask,
    contestLive: game.contestLive,
    contestStartedAt: game.contestStartedAt,
    contestEndsAt: game.contestEndsAt,
    contestDurationDays: game.contestDurationDays,
  };
}

export async function fetchGamesFromServer(): Promise<Game[]> {
  return cachedFetchGameList(async () => {
    const docs = await listDocuments("games");
    return sortGames(docs.map(docToGame));
  });
}

export async function fetchGameFromServer(id: string): Promise<Game | null> {
  return cachedFetchGameDoc(id, async () => {
    const res = await firestoreFetch(`games/${id}`);
    if (res.status === 404) return null;
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Firestore request failed (${res.status}): ${text}`);
    }
    return docToGame((await res.json()) as FirestoreDocument);
  });
}

export { invalidateGameCache };

export async function createGameOnServer(
  data: Omit<Game, "id" | "createdAt">
): Promise<string> {
  const existing = sortGames((await listDocuments("games")).map(docToGame));
  const hasCustomOrder = existing.some((game) => game.order != null);
  const payload: Record<string, string | number | boolean> = {
    ...data,
    createdAt: Date.now(),
  };
  if (hasCustomOrder) {
    const maxOrder = existing.reduce(
      (max, game) => Math.max(max, game.order ?? -1),
      -1
    );
    payload.order = maxOrder + 1;
  }

  const res = await firestoreFetch("games", {
    method: "POST",
    body: JSON.stringify({
      fields: encodeFields(payload),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firestore create failed (${res.status}): ${text}`);
  }

  const doc = (await res.json()) as FirestoreDocument;
  const newId = doc.name.split("/").pop() ?? "";
  invalidateGameCache();
  const game = await fetchGameFromServer(newId);
  if (game) {
    await syncGatingAfterMutation(game);
  }
  return newId;
}

export async function updateGameOnServer(
  id: string,
  data: Partial<Omit<Game, "id">>
): Promise<void> {
  const keys = Object.keys(data);
  if (keys.length === 0) return;

  const mask = keys.map((key) => `updateMask.fieldPaths=${key}`).join("&");
  const res = await firestoreFetch(`games/${id}?${mask}`, {
    method: "PATCH",
    body: JSON.stringify({
      fields: encodeFields(data as Record<string, string | number | boolean>),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firestore update failed (${res.status}): ${text}`);
  }

  invalidateGameCache(id);
  const game = await fetchGameFromServer(id);
  if (game) {
    await syncGatingAfterMutation(game);
  }
}

export async function reorderGamesOnServer(ids: string[]): Promise<void> {
  await Promise.all(
    ids.map((id, index) => updateGameOnServer(id, { order: index }))
  );
  invalidateGameCache();
}

export async function deleteGameOnServer(id: string): Promise<void> {
  const res = await firestoreFetch(`games/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`Firestore delete failed (${res.status}): ${text}`);
  }
  invalidateGameCache(id);
  await removeGameGatingFromRtdb(id);
}

// Re-export project id helper for other modules.
export { getProjectId };
