/**
 * Serve repeat public GETs and document shells before OpenNext boots.
 * OpenNext SSR is the bulk of billed Workers CPU. A colo Cache API hit
 * skips that runtime.
 *
 * API keys match lib/edge-cache.ts (`origin + pathname`).
 * Document keys include the Worker version id so a deploy cannot serve
 * HTML that points at the previous build's hashed assets.
 */

type VersionEnv = {
  CF_VERSION_METADATA?: { id?: string };
};

type WaitCtx = {
  waitUntil(promise: Promise<unknown>): void;
};

const DOCUMENT_PATH =
  /^\/(?:|social|profile|circles|game\/[^/]+|circle\/[^/]+|invite\/[^/]+|post\/[^/]+|fid\/[^/]+|u\/[^/]+)$/;

function cacheStorage(): Cache | null {
  try {
    const cachesApi = (
      globalThis as unknown as { caches?: { default?: Cache } }
    ).caches;
    return cachesApi?.default ?? null;
  } catch {
    return null;
  }
}

function hasAdminCredential(request: Request): boolean {
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ") && auth.slice(7).trim()) return true;
  return Boolean(request.headers.get("x-admin-password")?.trim());
}

/** Public JSON that does not vary by cookie. Null when this request must hit Next. */
export function publicApiCacheUrl(request: Request): string | null {
  if (request.method !== "GET") return null;
  if (hasAdminCredential(request)) return null;
  const url = new URL(request.url);
  if (url.search) return null;
  const path = url.pathname;
  if (
    path === "/api/games" ||
    path === "/api/chains" ||
    path === "/api/daily-play-config"
  ) {
    return `${url.origin}${path}`;
  }
  if (/^\/api\/games\/[^/]+$/.test(path)) {
    return `${url.origin}${path}`;
  }
  return null;
}

function isDocumentGet(request: Request): boolean {
  if (request.method !== "GET") return false;
  if (request.headers.get("rsc")) return false;
  if (request.headers.get("next-router-prefetch")) return false;
  if (request.headers.get("next-router-state-tree")) return false;
  const dest = request.headers.get("sec-fetch-dest");
  if (dest && dest !== "document") return false;
  const accept = request.headers.get("accept") ?? "";
  if (!accept.includes("text/html")) return false;
  const path = new URL(request.url).pathname;
  return DOCUMENT_PATH.test(path);
}

function documentCacheUrl(request: Request, version: string): string | null {
  if (!isDocumentGet(request)) return null;
  const url = new URL(request.url);
  return `${url.origin}${url.pathname}?__arcadex_doc=${encodeURIComponent(version)}`;
}

async function matchCache(cacheUrl: string): Promise<Response | null> {
  const cache = cacheStorage();
  if (!cache) return null;
  try {
    const hit = await cache.match(new Request(cacheUrl, { method: "GET" }));
    return hit ?? null;
  } catch {
    return null;
  }
}

export async function maybeServeHotCache(
  request: Request,
  env: VersionEnv
): Promise<Response | null> {
  const apiUrl = publicApiCacheUrl(request);
  if (apiUrl) return matchCache(apiUrl);

  const version = env.CF_VERSION_METADATA?.id;
  if (!version) return null;
  const docUrl = documentCacheUrl(request, version);
  if (!docUrl) return null;
  return matchCache(docUrl);
}

export function maybeStoreHotCache(
  request: Request,
  response: Response,
  env: VersionEnv,
  ctx: WaitCtx
): void {
  const version = env.CF_VERSION_METADATA?.id;
  if (!version) return;
  const docUrl = documentCacheUrl(request, version);
  if (!docUrl) return;
  if (response.status !== 200) return;
  if (response.headers.has("set-cookie")) return;
  if (response.headers.get("content-encoding")) return;
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("text/html")) return;

  const cache = cacheStorage();
  if (!cache) return;

  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "public, s-maxage=120");
  headers.delete("set-cookie");
  const stored = new Response(response.clone().body, {
    status: 200,
    statusText: response.statusText,
    headers,
  });

  const task = cache
    .put(new Request(docUrl, { method: "GET" }), stored)
    .catch(() => undefined);
  try {
    ctx.waitUntil(task);
  } catch {
    void task;
  }
}
