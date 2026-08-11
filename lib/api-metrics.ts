/**
 * Structured API metric logging.
 *
 * Emits a single JSON line per request to the Worker log stream.
 * Compatible with Cloudflare Workers observability (tail workers / logpush).
 *
 * Usage:
 *   const m = startMetric("/api/games");
 *   m.cacheHit("list");
 *   return m.finish(response);
 */

import { getDeployEnv } from "@/lib/deploy-env";
import { setFirebaseLogRoute } from "@/lib/firebase-log";

export type CacheLayer =
  | "list"
  | "doc"
  | "playCounts"
  | "leaderboardTop"
  | "progressGet"
  | "progressWrite";

interface MetricRecord {
  type: "arcadex_api_metric";
  env: string;
  endpoint: string;
  method: string;
  startedAt: number;
  durationMs?: number;
  statusCode?: number;
  cacheHit?: boolean;
  cacheLayer?: CacheLayer;
  cacheInvalidated?: boolean;
  responseBytes?: number;
  extra?: Record<string, unknown>;
}

export interface ApiMetric {
  /** Mark a cache hit for the given layer. */
  cacheHit(layer: CacheLayer): void;
  /** Mark a cache miss for the given layer. */
  cacheMiss(layer: CacheLayer): void;
  /** Mark that caches were invalidated (admin mutations). */
  invalidated(): void;
  /** Attach arbitrary extra context. */
  set(key: string, value: unknown): void;
  /** Finalise the metric, emit the log line, and return the response unchanged. */
  finish(response: Response): Response;
  /** Finalise without returning a response (fire-and-forget endpoints). */
  emit(statusCode?: number): void;
}

export function startMetric(endpoint: string, method = "GET"): ApiMetric {
  setFirebaseLogRoute(endpoint);

  const record: MetricRecord = {
    type: "arcadex_api_metric",
    env: getDeployEnv(),
    endpoint,
    method,
    startedAt: Date.now(),
  };

  return {
    cacheHit(layer: CacheLayer) {
      record.cacheHit = true;
      record.cacheLayer = layer;
    },
    cacheMiss(layer: CacheLayer) {
      record.cacheHit = false;
      record.cacheLayer = layer;
    },
    invalidated() {
      record.cacheInvalidated = true;
    },
    set(key: string, value: unknown) {
      record.extra = { ...record.extra, [key]: value };
    },
    finish(response: Response): Response {
      record.durationMs = Date.now() - record.startedAt;
      record.statusCode = response.status;
      const len = response.headers.get("content-length");
      if (len) {
        const n = Number(len);
        if (Number.isFinite(n)) record.responseBytes = n;
      }
      console.log(JSON.stringify(record));
      setFirebaseLogRoute(undefined);
      return response;
    },
    emit(statusCode = 200) {
      record.durationMs = Date.now() - record.startedAt;
      record.statusCode = statusCode;
      console.log(JSON.stringify(record));
      setFirebaseLogRoute(undefined);
    },
  };
}
