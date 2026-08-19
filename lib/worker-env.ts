/**
 * Cloudflare Worker bindings via OpenNext. Missing in `next dev`.
 */

export type KvLike = {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number }
  ): Promise<void>;
  delete?(key: string): Promise<void>;
};

export type RateLimitBinding = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

export type DurableObjectIdLike = {
  toString(): string;
};

export type ShuffleBudgetStub = {
  remaining(
    budgetMicro: number,
    nowMs: number
  ): Promise<{ remainingMicro: number }>;
  reserve(opts: {
    amountMicro: number;
    reservationKey: string;
    expiresAtMs: number;
    nowMs: number;
    budgetMicro: number;
  }): Promise<{ ok: boolean; remainingMicro: number }>;
  confirm(opts: {
    amountMicro: number;
    reservationKey: string;
    nowMs: number;
  }): Promise<void>;
};

export type ShuffleBudgetNamespace = {
  idFromName(name: string): DurableObjectIdLike;
  get(id: DurableObjectIdLike): ShuffleBudgetStub;
};

export type WorkerEnv = {
  RATE_LIMIT_KV?: KvLike;
  NEXT_INC_CACHE_KV?: KvLike;
  RATE_LIMIT_TIGHT?: RateLimitBinding;
  RATE_LIMIT_OPEN?: RateLimitBinding;
  SHUFFLE_BUDGET_DO?: ShuffleBudgetNamespace;
};

export type WorkerExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
};

type CloudflareContext = {
  env: WorkerEnv;
  ctx?: WorkerExecutionContext;
};

export async function getWorkerContext(): Promise<CloudflareContext | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const ctx = await getCloudflareContext({ async: true });
    return {
      env: (ctx.env ?? {}) as WorkerEnv,
      ctx: ctx.ctx as WorkerExecutionContext | undefined,
    };
  } catch {
    return null;
  }
}

export async function getWorkerEnv(): Promise<WorkerEnv | null> {
  const ctx = await getWorkerContext();
  return ctx?.env ?? null;
}
