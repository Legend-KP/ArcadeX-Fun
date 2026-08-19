/**
 * Colocated Cache API (caches.default) so catalog and public leaderboards
 * are shared across Worker isolates in a colo. No-op in `next dev`.
 *
 * Do not cache personalized or cookie-authenticated bodies. Strip CORS and
 * Set-Cookie before put so a cached copy can be re-wrapped per request.
 */

import { getWorkerContext } from "@/lib/worker-env";

function getCacheStorage(): Cache | null {
  try {
    const cachesApi = (
      globalThis as unknown as { caches?: { default?: Cache } }
    ).caches;
    return cachesApi?.default ?? null;
  } catch {
    return null;
  }
}

function cacheRequest(cacheKeyUrl: string): Request {
  return new Request(cacheKeyUrl, { method: "GET" });
}

function stripHopByHop(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  for (const key of [...headers.keys()]) {
    const lower = key.toLowerCase();
    if (lower === "set-cookie" || lower.startsWith("access-control-")) {
      headers.delete(key);
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function matchPublicGetCache(
  cacheKeyUrl: string
): Promise<Response | null> {
  const cache = getCacheStorage();
  if (!cache) return null;
  try {
    const hit = await cache.match(cacheRequest(cacheKeyUrl));
    return hit ?? null;
  } catch (err) {
    console.warn(
      "[ArcadeX] Cache API match failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

async function putPublicGetCache(
  cacheKeyUrl: string,
  response: Response
): Promise<void> {
  const cache = getCacheStorage();
  if (!cache) return;
  if (response.status !== 200) return;

  const cacheControl = response.headers.get("Cache-Control") ?? "";
  if (
    /private|no-store|no-cache/i.test(cacheControl) ||
    !/s-maxage|max-age/i.test(cacheControl)
  ) {
    return;
  }

  try {
    await cache.put(cacheRequest(cacheKeyUrl), stripHopByHop(response));
  } catch (err) {
    console.warn(
      "[ArcadeX] Cache API put failed:",
      err instanceof Error ? err.message : err
    );
  }
}

/** Store a public GET response without blocking the caller. */
export function schedulePublicGetCache(
  cacheKeyUrl: string,
  response: Response
): void {
  const copy = response.clone();
  const task = putPublicGetCache(cacheKeyUrl, copy);
  void getWorkerContext()
    .then((ctx) => {
      if (ctx?.ctx?.waitUntil) {
        ctx.ctx.waitUntil(task);
        return;
      }
      return task;
    })
    .catch(() => task);
}

export function publicCatalogCacheKey(request: Request): string {
  const url = new URL(request.url);
  return `${url.origin}${url.pathname}`;
}

export function publicLeaderboardCacheKey(opts: {
  request: Request;
  gameId: string;
  chainId?: number;
  ecosystem?: string;
}): string {
  const url = new URL(opts.request.url);
  const key = new URL(`${url.origin}${url.pathname}`);
  key.searchParams.set("g", opts.gameId);
  if (typeof opts.chainId === "number" && Number.isFinite(opts.chainId)) {
    key.searchParams.set("chainId", String(opts.chainId));
  }
  if (opts.ecosystem) {
    key.searchParams.set("eco", opts.ecosystem);
  }
  return key.toString();
}
