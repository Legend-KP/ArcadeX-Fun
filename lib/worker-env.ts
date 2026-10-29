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

/** Wraps data keys only. The binding must not log the DEK or the signer seed. */
export type FarcasterHsmBinding = {
  wrap(input: {
    keyName: string;
    dekB64: string;
    aad: string;
  }): Promise<{ ivB64: string; wrappedDekB64: string }>;
  unwrap(input: {
    keyName: string;
    ivB64: string;
    wrappedDekB64: string;
    aad: string;
  }): Promise<{ dekB64: string }>;
};

export type D1DatabaseBinding = {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T = unknown>(): Promise<T | null>;
      run(): Promise<unknown>;
      all<T = unknown>(): Promise<{ results: T[] }>;
    };
  };
};

export type WorkerEnv = {
  RATE_LIMIT_KV?: KvLike;
  NEXT_INC_CACHE_KV?: KvLike;
  RATE_LIMIT_TIGHT?: RateLimitBinding;
  RATE_LIMIT_OPEN?: RateLimitBinding;
  SHUFFLE_BUDGET_DO?: ShuffleBudgetNamespace;
  /** Farcaster / social identity (profiles, usernames, email OTP). */
  ARCADEX_SOCIAL_DB?: D1DatabaseBinding;
  /**
   * Envelope ciphertext for Farcaster cast signers.
   * Never point this at ARCADEX_SOCIAL_DB or RATE_LIMIT_KV.
   */
  FARCASTER_SIGNER_VAULT?: KvLike;
  /** Optional HSM/KMS binding. Used only when FARCASTER_HSM_KEY_NAME is set. */
  FARCASTER_HSM?: FarcasterHsmBinding;
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
