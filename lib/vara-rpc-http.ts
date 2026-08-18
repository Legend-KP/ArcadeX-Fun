/**
 * HTTP JSON-RPC for Vara with the same failover idea as Avalanche C-Chain.
 * Signing still uses the websocket URL in shop-vara; this is for reads/verify.
 */
import { VARA_RPC_URL } from "@/lib/shop-vara";

const DEFAULT_HTTP_RPC_URLS = [
  "https://rpc.vara.network",
  "https://archive-rpc.vara.network",
] as const;

const RPC_TIMEOUT_MS = 12_000;

function toHttpRpcUrl(url: string): string {
  return url.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");
}

export function getVaraHttpRpcUrls(): string[] {
  const primary = toHttpRpcUrl(VARA_RPC_URL.trim());
  const urls = primary
    ? [primary, ...DEFAULT_HTTP_RPC_URLS.filter((url) => url !== primary)]
    : [...DEFAULT_HTTP_RPC_URLS];
  return [...new Set(urls)];
}

let rpcUrlIndex = 0;

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

function isTransientVaraRpcError(error: unknown): boolean {
  const message = collectErrorText(error).toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("http request failed") ||
    message.includes("429") ||
    message.includes("403") ||
    message.includes("rate limit") ||
    message.includes("over rate limit") ||
    message.includes("520") ||
    message.includes("521") ||
    message.includes("522") ||
    message.includes("523") ||
    message.includes("524") ||
    message.includes("525") ||
    message.includes("503") ||
    message.includes("502") ||
    message.includes("500")
  );
}

async function rpcOnce<T>(
  url: string,
  method: string,
  params: unknown[]
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Vara RPC HTTP ${res.status}`);
  const json = (await res.json()) as {
    result?: T;
    error?: { message?: string; data?: string };
  };
  if (json.error) {
    throw new Error(json.error.message || json.error.data || "Vara RPC error");
  }
  return json.result as T;
}

export async function varaJsonRpc<T>(
  method: string,
  params: unknown[] = []
): Promise<T> {
  const urls = getVaraHttpRpcUrls();
  let lastError: unknown;
  const start = rpcUrlIndex % urls.length;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[(start + i) % urls.length];
    if (!url) continue;
    try {
      const result = await rpcOnce<T>(url, method, params);
      rpcUrlIndex = (start + i) % urls.length;
      return result;
    } catch (error) {
      lastError = error;
      if (!isTransientVaraRpcError(error)) throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Could not reach Vara RPC.");
}
