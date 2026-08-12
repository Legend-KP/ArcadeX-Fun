import {
  createPublicClient,
  http,
  type Hash,
  type TransactionReceipt,
} from "viem";
import { avalanche } from "@/lib/chains";

const DEFAULT_RPC_URLS = [
  "https://api.avax.network/ext/bc/C/rpc",
  "https://avalanche-c-chain-rpc.publicnode.com",
  "https://avax.meowrpc.com",
  // 1rpc free tier rate-limits hard — keep last as fallback only.
  "https://1rpc.io/avax/c",
] as const;

function getRpcUrls(): string[] {
  const primary =
    process.env.AVALANCHE_RPC_URL?.trim() ||
    process.env.NEXT_PUBLIC_AVALANCHE_RPC_URL?.trim();
  const urls = primary
    ? [primary, ...DEFAULT_RPC_URLS.filter((url) => url !== primary)]
    : [...DEFAULT_RPC_URLS];
  return [...new Set(urls)];
}

const publicClientConfig = {
  chain: avalanche,
  batch: { multicall: false },
  cacheTime: 0,
} as const;

function createHttpClient(rpcUrl: string) {
  return createPublicClient({
    ...publicClientConfig,
    transport: http(rpcUrl, { timeout: 12_000 }),
  });
}

type AvalanchePublicClient = ReturnType<typeof createHttpClient>;

let browserClient: AvalanchePublicClient | null = null;
let rpcClientIndex = 0;

function createRotatingPublicClient(): AvalanchePublicClient {
  const urls = getRpcUrls();
  const url = urls[rpcClientIndex % urls.length] ?? urls[0]!;
  return createHttpClient(url);
}

export function getAvalanchePublicClient(): AvalanchePublicClient {
  if (typeof window !== "undefined") {
    browserClient ??= createRotatingPublicClient();
    return browserClient;
  }
  return createRotatingPublicClient();
}

export function resetAvalanchePublicClient(): void {
  browserClient = null;
  const urls = getRpcUrls();
  if (urls.length > 0) {
    rpcClientIndex = (rpcClientIndex + 1) % urls.length;
  }
}

function collectErrorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const parts: string[] = [error.message];
  let cause: unknown = error.cause;
  while (cause instanceof Error) {
    parts.push(cause.message);
    cause = cause.cause;
  }
  return parts.join(" ");
}

function isTransientRpcError(error: unknown): boolean {
  const message = collectErrorText(error).toLowerCase();
  return (
    message.includes("block is out of range") ||
    message.includes("header not found") ||
    message.includes("invalid block tag") ||
    message.includes("timeout") ||
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("http request failed") ||
    message.includes("429") ||
    message.includes("403") ||
    message.includes("rate limit") ||
    message.includes("over rate limit") ||
    message.includes("usage limit") ||
    message.includes("requested resource not found") ||
    message.includes("520") ||
    message.includes("521") ||
    message.includes("522") ||
    message.includes("523") ||
    message.includes("524") ||
    message.includes("525") ||
    message.includes("503") ||
    message.includes("502")
  );
}

type ReadContractParams = Parameters<AvalanchePublicClient["readContract"]>[0];

const RETRY_DELAYS_MS = [0, 400, 900];

export async function readAvalancheContractWithFailover<T>(
  params: ReadContractParams
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_DELAYS_MS[attempt])
      );
      resetAvalanchePublicClient();
    }

    try {
      return (await getAvalanchePublicClient().readContract({
        ...params,
        blockTag: "latest",
      })) as T;
    } catch (error) {
      lastError = error;
      if (!isTransientRpcError(error)) throw error;
    }
  }

  for (const rpcUrl of getRpcUrls()) {
    try {
      return (await createHttpClient(rpcUrl).readContract({
        ...params,
        blockTag: "latest",
      })) as T;
    } catch (error) {
      lastError = error;
      if (!isTransientRpcError(error)) throw error;
    }
  }

  throw lastError;
}

const RECEIPT_RETRY_DELAYS_MS = [0, 500, 1200, 2500, 4000];

function isTransientReceiptError(error: unknown): boolean {
  const message = collectErrorText(error).toLowerCase();
  return (
    isTransientRpcError(error) ||
    message.includes("could not be found") ||
    message.includes("not found") ||
    message.includes("timed out") ||
    message.includes("wait for transaction")
  );
}

export async function waitForAvalancheTransactionReceipt(
  hash: Hash,
  opts?: { confirmations?: number; timeoutMs?: number }
): Promise<TransactionReceipt> {
  let lastError: unknown;
  const timeout = opts?.timeoutMs ?? 45_000;
  const confirmations = opts?.confirmations ?? 1;
  const attemptTimeout = Math.min(timeout, 12_000);
  const maxAttempts = timeout <= 15_000 ? 3 : RECEIPT_RETRY_DELAYS_MS.length;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, RECEIPT_RETRY_DELAYS_MS[attempt] ?? 1000)
      );
      resetAvalanchePublicClient();
    }

    try {
      return await getAvalanchePublicClient().waitForTransactionReceipt({
        hash,
        confirmations,
        timeout: attemptTimeout,
      });
    } catch (error) {
      lastError = error;
      if (!isTransientReceiptError(error)) throw error;
    }
  }

  for (const rpcUrl of getRpcUrls()) {
    try {
      return await createHttpClient(rpcUrl).waitForTransactionReceipt({
        hash,
        confirmations,
        timeout: Math.min(attemptTimeout, 10_000),
      });
    } catch (error) {
      lastError = error;
      if (!isTransientReceiptError(error)) throw error;
    }
  }

  for (const rpcUrl of getRpcUrls()) {
    try {
      const receipt = await createHttpClient(rpcUrl).getTransactionReceipt({
        hash,
      });
      if (receipt) return receipt;
    } catch (error) {
      lastError = error;
      if (!isTransientReceiptError(error)) throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Could not confirm the transaction on Avalanche.");
}
