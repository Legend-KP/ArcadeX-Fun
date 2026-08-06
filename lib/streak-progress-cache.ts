import { readStreakProgress } from "@/lib/arcadex-rewards-verify";
import { getWorkerKv } from "@/lib/worker-kv";
import { PRIMARY_EVM_CHAIN_ID } from "@/lib/chains";

/** On-chain streak reads are expensive — cache per wallet to cut Worker CPU. */
export const STREAK_PROGRESS_CACHE_MS = 5 * 60 * 1000;
const KV_TTL_SEC = 300;

export type StreakProgress = Awaited<ReturnType<typeof readStreakProgress>>;

type CacheEntry = { value: StreakProgress; expiresAt: number };

const memoryCache = new Map<string, CacheEntry>();

function cacheKey(
  wallet: string,
  campaignId: number,
  chainId?: number | null
): string {
  const chain = chainId == null ? PRIMARY_EVM_CHAIN_ID : Number(chainId);
  return `${chain}:${wallet.toLowerCase()}:${campaignId}`;
}

export async function getStreakProgressCached(
  wallet: string,
  campaignId: number,
  opts?: { fresh?: boolean; chainId?: number | null }
): Promise<StreakProgress> {
  const chainId = opts?.chainId;
  const key = cacheKey(wallet, campaignId, chainId);
  const now = Date.now();

  if (!opts?.fresh) {
    const mem = memoryCache.get(key);
    if (mem && now < mem.expiresAt) {
      return mem.value;
    }

    const kv = await getWorkerKv();
    if (kv) {
      try {
        const raw = await kv.get(`streak:${key}`);
        if (raw) {
          const parsed = JSON.parse(raw) as CacheEntry;
          if (parsed.expiresAt > now) {
            memoryCache.set(key, parsed);
            return parsed.value;
          }
        }
      } catch {
        // Ignore corrupt cache entries
      }
    }
  } else {
    memoryCache.delete(key);
  }

  const value = await readStreakProgress(wallet, campaignId, chainId);
  const entry: CacheEntry = {
    value,
    expiresAt: now + STREAK_PROGRESS_CACHE_MS,
  };
  memoryCache.set(key, entry);

  const kv = await getWorkerKv();
  if (kv) {
    try {
      await kv.put(`streak:${key}`, JSON.stringify(entry), {
        expirationTtl: KV_TTL_SEC,
      });
    } catch {
      // Cache write is best-effort
    }
  }

  return value;
}

export async function invalidateStreakProgressCache(
  wallet: string,
  campaignId: number,
  chainId?: number | null
): Promise<void> {
  const key = cacheKey(wallet, campaignId, chainId);
  memoryCache.delete(key);

  const kv = await getWorkerKv();
  if (kv?.delete) {
    try {
      await kv.delete(`streak:${key}`);
    } catch {
      // Best-effort
    }
  }
}
