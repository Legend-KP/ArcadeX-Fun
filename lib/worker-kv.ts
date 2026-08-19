/** Shared Cloudflare KV access (RATE_LIMIT_KV binding). */

import { getWorkerEnv, type KvLike } from "@/lib/worker-env";

export async function getWorkerKv(): Promise<KvLike | null> {
  const env = await getWorkerEnv();
  return env?.RATE_LIMIT_KV ?? null;
}
