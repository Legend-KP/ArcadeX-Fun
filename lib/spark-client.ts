import { SparkSnapshot, StoredSparkState } from "@/types";

export interface SparkApiResponse {
  state: StoredSparkState;
  sparks: SparkSnapshot;
  spent?: boolean;
}

export class SparkClientError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "SparkClientError";
  }
}

export async function fetchSparkData(
  playerId: string,
  opts?: { chainId?: number; ecosystem?: string }
): Promise<SparkApiResponse> {
  const params = new URLSearchParams({ playerId });
  if (typeof opts?.chainId === "number" && Number.isFinite(opts.chainId)) {
    params.set("chainId", String(opts.chainId));
  }
  if (opts?.ecosystem) params.set("ecosystem", opts.ecosystem);

  const res = await fetch(`/api/sparks?${params.toString()}`, {
    cache: "no-store",
  });

  const data = (await res.json()) as SparkApiResponse & {
    error?: string;
    code?: string;
  };

  if (!res.ok) {
    throw new SparkClientError(
      data.error ?? "Could not load Sparks.",
      data.code,
      res.status
    );
  }

  return data;
}

export async function spendSpark(
  playerId: string,
  opts?: {
    chainId?: number;
    ecosystem?: string;
    gameId?: string;
    playGate?: { message: string; signature: string };
  }
): Promise<SparkApiResponse & { playSessionId?: string }> {
  const res = await fetch("/api/sparks/spend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      playerId,
      chainId: opts?.chainId,
      ecosystem: opts?.ecosystem,
      gameId: opts?.gameId,
      playGate: opts?.playGate,
    }),
  });

  const data = (await res.json()) as SparkApiResponse & {
    playSessionId?: string;
    error?: string;
    code?: string;
  };

  if (!res.ok) {
    throw new SparkClientError(
      data.error ?? "Could not spend Spark.",
      data.code,
      res.status
    );
  }

  return data;
}

export async function purchaseSparkItem(params: {
  playerId: string;
  productId: string;
  txHash: string;
  tokenAddress?: string;
}): Promise<SparkApiResponse> {
  const res = await fetch("/api/sparks/purchase", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  const data = (await res.json()) as SparkApiResponse & {
    error?: string;
    code?: string;
  };

  if (!res.ok) {
    throw new SparkClientError(
      data.error ?? "Could not complete purchase.",
      data.code,
      res.status
    );
  }

  return data;
}
