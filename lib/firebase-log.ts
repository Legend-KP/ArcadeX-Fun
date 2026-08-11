import { getDeployEnv } from "@/lib/deploy-env";

export type FirebaseDb = "firestore" | "rtdb";
export type FirebaseOp = "get" | "query" | "patch" | "put" | "delete" | "post";

export interface FirebaseRequestLog {
  type: "arcadex_firebase";
  env: string;
  route?: string;
  database: FirebaseDb;
  operation: FirebaseOp;
  /** Sanitized path category — never include wallet/tx secrets. */
  pathCategory: string;
  durationMs: number;
  responseBytes?: number;
  status: number | "error";
  cacheStatus?: "hit" | "miss" | "bypass" | "coalesced";
}

/** Collapse dynamic RTDB/Firestore segments into stable categories for logs. */
export function sanitizeFirebasePath(path: string): string {
  return path
    .replace(/\/+/g, "/")
    .replace(/^\/|\/$/g, "")
    .split("/")
    .map((segment, index, parts) => {
      const lower = segment.toLowerCase();
      // Keep structural roots; redact ids / wallets / hashes.
      if (
        index === 0 ||
        [
          "users",
          "games",
          "sparks",
          "leaderboards",
          "contestleaderboards",
          "gameplays",
          "gamegating",
          "shop",
          "processedtxs",
          "sparkpayments",
          "scoresubmit",
          "checkintxs",
          "streakgrants",
          "authnonces",
          "shufflepending",
          "spintxs",
          "shufflegrants",
          "shuffledailybudget",
          "vara",
          "txhub",
          "signins",
        ].includes(lower)
      ) {
        return segment;
      }
      // Keep numeric contest season keys as "*".
      if (/^\d+$/.test(segment)) return "*";
      // Keep short known field names.
      if (segment.length <= 12 && /^[a-zA-Z_]+$/.test(segment)) {
        // Still redact if previous part is users (wallet/player id).
        if (parts[index - 1]?.toLowerCase() === "users") return "{id}";
        return segment;
      }
      return "{id}";
    })
    .join("/");
}

let currentRoute: string | undefined;

/** Bind the active API route for nested Firebase logs (request-scoped best effort). */
export function setFirebaseLogRoute(route: string | undefined): void {
  currentRoute = route;
}

export function logFirebaseRequest(
  partial: Omit<FirebaseRequestLog, "type" | "env" | "route"> & {
    route?: string;
  }
): void {
  const record: FirebaseRequestLog = {
    type: "arcadex_firebase",
    env: getDeployEnv(),
    route: partial.route ?? currentRoute,
    database: partial.database,
    operation: partial.operation,
    pathCategory: partial.pathCategory,
    durationMs: partial.durationMs,
    responseBytes: partial.responseBytes,
    status: partial.status,
    cacheStatus: partial.cacheStatus,
  };
  console.log(JSON.stringify(record));
}
