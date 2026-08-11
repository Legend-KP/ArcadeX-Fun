/**
 * Shared Realtime Database REST client.
 *
 * - Prefers OAuth Bearer access tokens (cached via firebase-admin).
 * - Falls back to legacy database secret only when no service account is configured.
 * - Never puts OAuth tokens in query strings (avoids URL log leakage).
 * - Supports print=silent, shallow, orderBy/limit query params, and timeouts.
 * - Optional `connection` routes to shared vs per-chain RTDB projects.
 */

import {
  clearFirebaseAccessTokenCache,
  getDatabaseUrl,
  getFirebaseAccessToken,
  getFirebaseAccessTokenForAccount,
  hasServiceAccount,
} from "@/lib/firebase-admin";
import {
  logFirebaseRequest,
  sanitizeFirebasePath,
  type FirebaseOp,
} from "@/lib/firebase-log";
import {
  getSharedRtdbConnection,
  type RtdbConnection,
} from "@/lib/rtdb-resolver";

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

export type RtdbCallOptions = {
  query?: RtdbQuery;
  /** When omitted, uses shared ArcadeX Fun RTDB. */
  connection?: RtdbConnection;
};

function resolveConnection(connection?: RtdbConnection): RtdbConnection {
  if (connection) return connection;
  try {
    return getSharedRtdbConnection();
  } catch {
    return {
      label: "shared",
      databaseUrl: getDatabaseUrl(),
      serviceAccount: hasServiceAccount()
        ? {
            projectId:
              process.env.FIREBASE_PROJECT_ID?.trim() ||
              process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() ||
              "",
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL?.trim() || "",
            privateKey:
              process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n") || "",
          }
        : null,
      databaseSecret: process.env.FIREBASE_DATABASE_SECRET?.trim() || undefined,
    };
  }
}

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

async function buildAuth(
  connection: RtdbConnection,
  opts?: { preferSecret?: boolean }
): Promise<{
  header?: Record<string, string>;
  query?: string;
  mode: "oauth" | "secret";
}> {
  const secret = connection.databaseSecret?.trim();
  const account = connection.serviceAccount;

  if (!opts?.preferSecret && account?.clientEmail && account.privateKey) {
    try {
      const token =
        connection.label === "shared" && hasServiceAccount()
          ? await getFirebaseAccessToken()
          : await getFirebaseAccessTokenForAccount(account);
      return {
        header: { Authorization: `Bearer ${token}` },
        mode: "oauth",
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/invalid[_\s-]?grant/i.test(message)) {
        throw new Error(
          `${message} (RTDB: ${connection.label}). Check FIREBASE_PRIVATE_KEY${
            connection.label === "shared" ? "" : `_${connection.label.toUpperCase()}`
          }.`
        );
      }
      throw err;
    }
  }

  if (secret) {
    return {
      query: `auth=${encodeURIComponent(secret)}`,
      mode: "secret",
    };
  }

  throw new Error(
    `Firebase RTDB auth missing for ${connection.label}. Configure service account env vars (preferred) or FIREBASE_DATABASE_SECRET for shared.`
  );
}

function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal) {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

function buildUrl(
  connection: RtdbConnection,
  path: string,
  auth: { query?: string },
  query?: RtdbQuery
): string {
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
  return `${connection.databaseUrl.replace(/\/$/, "")}/${encodeRtdbPath(path)}.json${qs ? `?${qs}` : ""}`;
}

export async function rtdbRequest(
  path: string,
  init?: RequestInit & RtdbCallOptions
): Promise<Response> {
  const started = Date.now();
  const method = (init?.method ?? "GET").toUpperCase();
  const query = init?.query;
  const connection = resolveConnection(init?.connection);
  const timeoutMs = query?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pathCategory = sanitizeFirebasePath(path);
  const op: FirebaseOp =
    query?.orderBy || query?.shallow ? "query" : methodToOp(method);

  const run = async (preferSecret: boolean) => {
    const auth = await buildAuth(connection, { preferSecret });
    const url = buildUrl(connection, path, auth, query);
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
    return { res, mode: auth.mode };
  };

  try {
    let { res, mode } = await run(false);

    // OAuth without userinfo.email (or bad SA) returns 401 — fall back to legacy secret once (shared only).
    if (
      res.status === 401 &&
      mode === "oauth" &&
      connection.databaseSecret?.trim()
    ) {
      clearFirebaseAccessTokenCache();
      console.warn(
        JSON.stringify({
          type: "arcadex_rtdb_auth_fallback",
          reason: "oauth_401",
          pathCategory,
          connection: connection.label,
        })
      );
      ({ res, mode } = await run(true));
    }

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
  query?: RtdbQuery,
  connection?: RtdbConnection
): Promise<T | null> {
  const res = await rtdbRequest(path, { method: "GET", query, connection });
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
  opts?: { silent?: boolean; timeoutMs?: number; connection?: RtdbConnection }
): Promise<void> {
  const res = await rtdbRequest(path, {
    method: "PUT",
    body: JSON.stringify(data),
    query: { silent: opts?.silent ?? true, timeoutMs: opts?.timeoutMs },
    connection: opts?.connection,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Realtime Database write failed (${res.status}): ${text}`);
  }
}

export async function rtdbPatch(
  path: string,
  data: unknown,
  opts?: { silent?: boolean; timeoutMs?: number; connection?: RtdbConnection }
): Promise<void> {
  const res = await rtdbRequest(path, {
    method: "PATCH",
    body: JSON.stringify(data),
    query: { silent: opts?.silent ?? true, timeoutMs: opts?.timeoutMs },
    connection: opts?.connection,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Realtime Database patch failed (${res.status}): ${text}`);
  }
}

export async function rtdbDelete(
  path: string,
  opts?: { silent?: boolean; timeoutMs?: number; connection?: RtdbConnection }
): Promise<void> {
  const res = await rtdbRequest(path, {
    method: "DELETE",
    query: { silent: opts?.silent ?? true, timeoutMs: opts?.timeoutMs },
    connection: opts?.connection,
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`Realtime Database delete failed (${res.status}): ${text}`);
  }
}

/** GET with ETag for conditional writes (REST transactions). */
export async function rtdbReadWithEtag<T>(
  path: string,
  opts?: { timeoutMs?: number; connection?: RtdbConnection }
): Promise<{ data: T | null; etag: string }> {
  const res = await rtdbRequest(path, {
    method: "GET",
    headers: { "X-Firebase-ETag": "true" },
    query: { timeoutMs: opts?.timeoutMs },
    connection: opts?.connection,
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
  opts?: { silent?: boolean; timeoutMs?: number; connection?: RtdbConnection }
): Promise<"ok" | "conflict"> {
  const res = await rtdbRequest(path, {
    method: "PUT",
    headers: { "if-match": etag },
    body: JSON.stringify(data),
    query: { silent: opts?.silent ?? true, timeoutMs: opts?.timeoutMs },
    connection: opts?.connection,
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
  opts?: { timeoutMs?: number; connection?: RtdbConnection }
): Promise<string[]> {
  const data = await rtdbRead<Record<string, boolean> | null>(
    path,
    {
      shallow: true,
      timeoutMs: opts?.timeoutMs,
    },
    opts?.connection
  );
  if (!data || typeof data !== "object") return [];
  return Object.keys(data);
}
