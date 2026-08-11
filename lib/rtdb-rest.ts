/**
 * Shared Realtime Database REST client.
 *
 * - Prefers OAuth Bearer access tokens (cached via firebase-admin).
 * - Falls back to legacy database secret only when no service account is configured.
 * - Never puts OAuth tokens in query strings (avoids URL log leakage).
 * - Supports print=silent, shallow, orderBy/limit query params, and timeouts.
 */

import {
  getDatabaseUrl,
  getFirebaseAccessToken,
  hasServiceAccount,
} from "@/lib/firebase-admin";
import {
  logFirebaseRequest,
  sanitizeFirebasePath,
  type FirebaseOp,
} from "@/lib/firebase-log";

const DEFAULT_TIMEOUT_MS = 12_000;

export type RtdbQuery = {
  orderBy?: string;
  limitToFirst?: number;
  limitToLast?: number;
  startAt?: string | number | boolean;
  endAt?: string | number | boolean;
  equalTo?: string | number | boolean;
  shallow?: boolean;
  /** Suppress response body on writes (saves download bandwidth). */
  silent?: boolean;
  timeoutMs?: number;
};

function encodeRtdbPath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function methodToOp(method: string): FirebaseOp {
  switch (method.toUpperCase()) {
    case "GET":
      return "get";
    case "PATCH":
      return "patch";
    case "PUT":
      return "put";
    case "DELETE":
      return "delete";
    case "POST":
      return "post";
    default:
      return "get";
  }
}

function appendQueryValue(
  params: URLSearchParams,
  key: string,
  value: string | number | boolean
): void {
  if (typeof value === "string") {
    // RTDB REST expects JSON-encoded string values for orderBy / equalTo etc.
    params.set(key, JSON.stringify(value));
  } else {
    params.set(key, String(value));
  }
}

async function buildAuth(): Promise<{
  header?: Record<string, string>;
  query?: string;
}> {
  if (hasServiceAccount()) {
    const token = await getFirebaseAccessToken();
    return { header: { Authorization: `Bearer ${token}` } };
  }

  const secret = process.env.FIREBASE_DATABASE_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "Firebase RTDB auth missing. Configure FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY (preferred) or FIREBASE_DATABASE_SECRET."
    );
  }
  return { query: `auth=${encodeURIComponent(secret)}` };
}

function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal) {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

export async function rtdbRequest(
  path: string,
  init?: RequestInit & { query?: RtdbQuery }
): Promise<Response> {
  const started = Date.now();
  const method = (init?.method ?? "GET").toUpperCase();
  const query = init?.query;
  const timeoutMs = query?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pathCategory = sanitizeFirebasePath(path);
  const op: FirebaseOp =
    query?.orderBy || query?.shallow ? "query" : methodToOp(method);

  const auth = await buildAuth();
  const params = new URLSearchParams();
  if (auth.query) {
    const eq = auth.query.indexOf("=");
    if (eq > 0) {
      params.set(
        auth.query.slice(0, eq),
        decodeURIComponent(auth.query.slice(eq + 1))
      );
    }
  }

  if (query?.orderBy !== undefined) {
    appendQueryValue(params, "orderBy", query.orderBy);
  }
  if (typeof query?.limitToFirst === "number") {
    params.set("limitToFirst", String(query.limitToFirst));
  }
  if (typeof query?.limitToLast === "number") {
    params.set("limitToLast", String(query.limitToLast));
  }
  if (query?.startAt !== undefined) {
    appendQueryValue(params, "startAt", query.startAt);
  }
  if (query?.endAt !== undefined) {
    appendQueryValue(params, "endAt", query.endAt);
  }
  if (query?.equalTo !== undefined) {
    appendQueryValue(params, "equalTo", query.equalTo);
  }
  if (query?.shallow) {
    params.set("shallow", "true");
  }
  if (query?.silent) {
    params.set("print", "silent");
  }

  const qs = params.toString();
  const url = `${getDatabaseUrl()}/${encodeRtdbPath(path)}.json${qs ? `?${qs}` : ""}`;

  try {
    const res = await fetch(url, {
      ...init,
      method,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...auth.header,
        ...init?.headers,
      },
      cache: "no-store",
      signal: init?.signal ?? timeoutSignal(timeoutMs),
    });

    // Clone-safe byte estimate from Content-Length when present.
    const lenHeader = res.headers.get("content-length");
    const responseBytes = lenHeader ? Number(lenHeader) : undefined;

    logFirebaseRequest({
      database: "rtdb",
      operation: op,
      pathCategory,
      durationMs: Date.now() - started,
      responseBytes: Number.isFinite(responseBytes) ? responseBytes : undefined,
      status: res.status,
    });

    return res;
  } catch (err) {
    logFirebaseRequest({
      database: "rtdb",
      operation: op,
      pathCategory,
      durationMs: Date.now() - started,
      status: "error",
    });
    throw err;
  }
}

export async function rtdbRead<T>(
  path: string,
  query?: RtdbQuery
): Promise<T | null> {
  const res = await rtdbRequest(path, { method: "GET", query });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Realtime Database read failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as T | null;
  return data ?? null;
}

export async function rtdbWrite(
  path: string,
  data: unknown,
  opts?: { silent?: boolean; timeoutMs?: number }
): Promise<void> {
  const res = await rtdbRequest(path, {
    method: "PUT",
    body: JSON.stringify(data),
    query: { silent: opts?.silent ?? true, timeoutMs: opts?.timeoutMs },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Realtime Database write failed (${res.status}): ${text}`);
  }
}

export async function rtdbPatch(
  path: string,
  data: unknown,
  opts?: { silent?: boolean; timeoutMs?: number }
): Promise<void> {
  const res = await rtdbRequest(path, {
    method: "PATCH",
    body: JSON.stringify(data),
    query: { silent: opts?.silent ?? true, timeoutMs: opts?.timeoutMs },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Realtime Database patch failed (${res.status}): ${text}`);
  }
}

export async function rtdbDelete(
  path: string,
  opts?: { silent?: boolean; timeoutMs?: number }
): Promise<void> {
  const res = await rtdbRequest(path, {
    method: "DELETE",
    query: { silent: opts?.silent ?? true, timeoutMs: opts?.timeoutMs },
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`Realtime Database delete failed (${res.status}): ${text}`);
  }
}

/** GET with ETag for conditional writes (REST transactions). */
export async function rtdbReadWithEtag<T>(
  path: string,
  opts?: { timeoutMs?: number }
): Promise<{ data: T | null; etag: string }> {
  const res = await rtdbRequest(path, {
    method: "GET",
    headers: { "X-Firebase-ETag": "true" },
    query: { timeoutMs: opts?.timeoutMs },
  });
  if (res.status === 404) {
    return { data: null, etag: res.headers.get("ETag") ?? '""' };
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Realtime Database read failed (${res.status}): ${text}`);
  }
  const etag = res.headers.get("ETag");
  if (!etag) {
    throw new Error("Realtime Database ETag missing for transaction read.");
  }
  const data = (await res.json()) as T | null;
  return { data: data ?? null, etag };
}

export async function rtdbWriteIfMatch(
  path: string,
  data: unknown,
  etag: string,
  opts?: { silent?: boolean; timeoutMs?: number }
): Promise<"ok" | "conflict"> {
  const res = await rtdbRequest(path, {
    method: "PUT",
    headers: { "if-match": etag },
    body: JSON.stringify(data),
    query: { silent: opts?.silent ?? true, timeoutMs: opts?.timeoutMs },
  });
  if (res.status === 412) return "conflict";
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Realtime Database write failed (${res.status}): ${text}`);
  }
  return "ok";
}

/** Shallow read — returns immediate child keys only. */
export async function rtdbShallowKeys(
  path: string,
  opts?: { timeoutMs?: number }
): Promise<string[]> {
  const data = await rtdbRead<Record<string, boolean> | null>(path, {
    shallow: true,
    timeoutMs: opts?.timeoutMs,
  });
  if (!data || typeof data !== "object") return [];
  return Object.keys(data);
}
