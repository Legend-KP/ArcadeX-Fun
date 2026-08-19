/**
 * Rate limiting: Cloudflare Rate Limit binding (atomic per colo) first,
 * then Workers KV (global, get-then-put) for the exact per-route cap.
 * Memory fallback is `next dev` / misconfig only.
 */

import { getWorkerEnv, type RateLimitBinding } from "@/lib/worker-env";
import { getWorkerKv } from "@/lib/worker-kv";

type RateBucket = { count: number; resetAt: number };

const memoryBuckets = new Map<string, RateBucket>();

type KvLike = NonNullable<Awaited<ReturnType<typeof getWorkerKv>>>;

let warnedMissingKv = false;
let warnedMissingLimiter = false;

async function getRateLimitKv(): Promise<KvLike | null> {
  const kv = await getWorkerKv();
  if (kv) return kv;

  if (process.env.NODE_ENV === "production" && !warnedMissingKv) {
    warnedMissingKv = true;
    console.warn(
      "[ArcadeX] RATE_LIMIT_KV binding missing — rate limits are per-isolate only. Create the namespace, put its id in wrangler.jsonc, and redeploy."
    );
  }

  return null;
}

export function getClientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

function memoryCheck(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = memoryBuckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    memoryBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (bucket.count >= limit) {
    return false;
  }

  bucket.count += 1;
  return true;
}

async function kvCheck(
  kv: KvLike,
  key: string,
  limit: number,
  windowMs: number
): Promise<boolean> {
  const now = Date.now();
  const windowId = Math.floor(now / windowMs);
  const kvKey = `rl:${key}:${windowId}`;
  const ttlSec = Math.max(60, Math.ceil(windowMs / 1000) + 5);

  const raw = await kv.get(kvKey);
  const count = raw ? Number(raw) : 0;
  if (!Number.isFinite(count)) {
    await kv.put(kvKey, "1", { expirationTtl: ttlSec });
    return true;
  }

  if (count >= limit) {
    return false;
  }

  await kv.put(kvKey, String(count + 1), { expirationTtl: ttlSec });
  return true;
}

async function getAtomicLimiter(
  limit: number
): Promise<RateLimitBinding | null> {
  const env = await getWorkerEnv();
  if (!env) return null;

  const limiter =
    limit <= 40 ? env.RATE_LIMIT_TIGHT ?? null : env.RATE_LIMIT_OPEN ?? null;

  if (!limiter && process.env.NODE_ENV === "production" && !warnedMissingLimiter) {
    warnedMissingLimiter = true;
    console.warn(
      "[ArcadeX] Rate Limit bindings missing — per-route caps are KV-only (not atomic across isolates)."
    );
  }

  return limiter;
}

/**
 * Returns true if the request is allowed.
 * Atomic colo limiter first; KV for the exact route cap; memory last.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<boolean> {
  const limiter = await getAtomicLimiter(limit);
  if (limiter) {
    try {
      const { success } = await limiter.limit({ key });
      if (!success) return false;
    } catch (err) {
      console.warn(
        "[ArcadeX] Rate Limit binding error; continuing with KV:",
        err instanceof Error ? err.message : err
      );
    }
  }

  const kv = await getRateLimitKv();
  if (kv) {
    try {
      return await kvCheck(kv, key, limit, windowMs);
    } catch (err) {
      console.warn(
        "[ArcadeX] KV rate-limit error; falling back to memory:",
        err instanceof Error ? err.message : err
      );
    }
  }

  return memoryCheck(key, limit, windowMs);
}

/** Returns false if any key in the group is over limit. */
export async function checkRateLimitGroup(
  keys: string[],
  limit: number,
  windowMs: number
): Promise<boolean> {
  for (const key of keys) {
    if (!(await checkRateLimit(key, limit, windowMs))) {
      return false;
    }
  }
  return true;
}

export function rateLimitResponse(): Response {
  return Response.json(
    { error: "Too many requests. Please try again later." },
    { status: 429 }
  );
}
