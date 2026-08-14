import {
  createPublicClient,
  http,
  type Hash,
  type TransactionReceipt,
} from "viem";
import { base } from "@/lib/chains";

const DEFAULT_RPC_URLS = [
  "https://mainnet.base.org",
  "https://base.drpc.org",
  "https://base.meowrpc.com",
  "https://base.publicnode.com",
] as const;

const FLAKY_RPC_HINTS = ["llamarpc", "1rpc.io"] as const;

function isFlakyRpcUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return FLAKY_RPC_HINTS.some((hint) => lower.includes(hint));
}

function getRpcUrls(): string[] {
  const primary =
    process.env.BASE_RPC_URL?.trim() ||
    process.env.NEXT_PUBLIC_BASE_RPC_URL?.trim();

  const defaults = [...DEFAULT_RPC_URLS];
  const urls = primary ? [primary, ...defaults.filter((url) => url !== primary)] : defaults;

  // Never prefer known-flaky public RPCs (Cloudflare 521 / outages).
  const stable = urls.filter((url) => !isFlakyRpcUrl(url));
  const flaky = urls.filter((url) => isFlakyRpcUrl(url));
  return [...new Set([...stable, ...flaky])];
}

const publicClientConfig = {
  chain: base,
  batch: { multicall: false },
  cacheTime: 0,
} as const;

function createHttpClient(rpcUrl: string, timeoutMs = 12_000) {
  return createPublicClient({
    ...publicClientConfig,
    transport: http(rpcUrl, { timeout: timeoutMs }),
  });
}

type BasePublicClient = ReturnType<typeof createHttpClient>;

let browserClient: BasePublicClient | null = null;
let rpcClientIndex = 0;

function createRotatingPublicClient(): BasePublicClient {
  const urls = getRpcUrls();
  const url = urls[rpcClientIndex % urls.length] ?? urls[0]!;
  return createHttpClient(url);
}

export function getBasePublicClient(): BasePublicClient {
  if (typeof window !== "undefined") {
    browserClient ??= createRotatingPublicClient();
    return browserClient;
  }
  // Workers: no singleton — always honor the rotating index so failover works.
  return createRotatingPublicClient();
}

export function resetBasePublicClient(): void {
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

export function isBlockOutOfRangeError(error: unknown): boolean {
  const message = collectErrorText(error).toLowerCase();
  return (
    message.includes("block is out of range") ||
    message.includes("header not found") ||
    message.includes("invalid block tag")
  );
}

function isTransientRpcError(error: unknown): boolean {
  const message = collectErrorText(error).toLowerCase();
  return (
    isBlockOutOfRangeError(error) ||
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
    message.includes("missing or invalid parameters") ||
    message.includes("invalid parameters") ||
    message.includes("520") ||
    message.includes("521") ||
    message.includes("522") ||
    message.includes("523") ||
    message.includes("525") ||
    message.includes("503") ||
    message.includes("502") ||
    message.includes("524") ||
    message.includes("cloudflare")
  );
}

function isUserRejectedError(error: unknown): boolean {
  const message = collectErrorText(error).toLowerCase();
  return (
    message.includes("user rejected") ||
    message.includes("user denied") ||
    message.includes("rejected the request") ||
    message.includes("request rejected") ||
    message.includes("4001")
  );
}

function isTransactionFailureError(error: unknown): boolean {
  const message = collectErrorText(error).toLowerCase();
  return (
    message.includes("transaction receipt") ||
    message.includes("could not be found") ||
    message.includes("not mined") ||
    message.includes("execution reverted") ||
    message.includes("transaction failed") ||
    message.includes("version: viem")
  );
}

export function formatChainError(error: unknown): string {
  if (isUserRejectedError(error)) {
    return "You cancelled the wallet request. Approve it in MetaMask to check in.";
  }

  if (error instanceof Error) {
    if (
      error.message.includes("Insufficient balance") ||
      error.message.includes("Connect your wallet") ||
      error.message.includes("No wallet") ||
      error.message.includes("approval failed") ||
      error.message.includes("payment failed")
    ) {
      return error.message;
    }
  }

  if (isTransactionFailureError(error)) {
    return "Transaction failed. Please try again.";
  }

  if (isTransientRpcError(error)) {
    return "The network is temporarily unavailable. Please wait a moment and try again.";
  }

  if (error instanceof Error) {
    if (
      error.message.includes("RPC Request failed") ||
      error.message.includes("Request body") ||
      error.message.length > 160
    ) {
      return "Could not reach the Base network. Please try again.";
    }
    return error.message;
  }

  return "Something went wrong. Please try again.";
}

type ReadContractParams = Parameters<BasePublicClient["readContract"]>[0];

const RETRY_DELAYS_MS = [0, 300, 700, 1200];

/** Read with RPC rotation — public Base endpoints rate-limit Workers hard. */
export async function readBaseContractWithFailover<T>(
  params: ReadContractParams
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_DELAYS_MS[attempt])
      );
      resetBasePublicClient();
    }

    try {
      return (await getBasePublicClient().readContract({
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

export async function readBaseContract(
  params: ReadContractParams
): Promise<bigint> {
  return readBaseContractWithFailover<bigint>(params);
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

/**
 * Fast receipt lookup across Base RPCs — used by shop / score-submit verify.
 * Avoids long waitForTransactionReceipt sweeps that stall Workers for minutes
 * when a public RPC is returning Cloudflare 521.
 */
export async function getBaseTransactionReceiptFast(
  hash: Hash
): Promise<TransactionReceipt> {
  let lastError: unknown;
  const urls = getRpcUrls();

  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, 350 + attempt * 250)
      );
    }

    for (const rpcUrl of urls) {
      try {
        const receipt = await createHttpClient(rpcUrl, 5_000).getTransactionReceipt({
          hash,
        });
        if (receipt) return receipt;
      } catch (error) {
        lastError = error;
        if (!isTransientReceiptError(error)) throw error;
        // Try next RPC immediately on 521 / timeout / not found.
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(
        "Payment is still confirming on Base. Wait a moment, then tap Confirm payment."
      );
}

export async function waitForBaseTransactionReceipt(
  hash: Hash,
  opts?: { confirmations?: number; timeoutMs?: number }
): Promise<TransactionReceipt> {
  let lastError: unknown;
  const timeout = opts?.timeoutMs ?? 45_000;
  const confirmations = opts?.confirmations ?? 1;
  // Keep total wait bounded: short per-attempt timeouts when caller wants speed.
  const attemptTimeout = Math.min(timeout, 12_000);
  const maxAttempts = timeout <= 15_000 ? 3 : RECEIPT_RETRY_DELAYS_MS.length;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, RECEIPT_RETRY_DELAYS_MS[attempt] ?? 1000)
      );
      resetBasePublicClient();
    }

    try {
      return await getBasePublicClient().waitForTransactionReceipt({
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
    : new Error("Could not confirm the transaction on Base.");
}
