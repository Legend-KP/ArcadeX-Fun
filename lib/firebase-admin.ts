import { SignJWT, importPKCS8 } from "jose";
import { getDeployEnv } from "@/lib/deploy-env";

export type FirebaseServiceAccountCreds = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

const FIREBASE_SCOPES = [
  // Firestore
  "https://www.googleapis.com/auth/datastore",
  // RTDB REST requires BOTH of these or writes return 401 Unauthorized
  "https://www.googleapis.com/auth/firebase.database",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

/** Refresh a few minutes before Google's ~3600s expiry. */
const TOKEN_EXPIRY_SAFETY_MS = 5 * 60 * 1000;

type CachedToken = {
  accessToken: string;
  expiresAtMs: number;
};

const tokenCache = new Map<string, CachedToken>();
/** Shared in-flight mint so concurrent requests only refresh once per account. */
const inflightTokens = new Map<string, Promise<string>>();
/** Cached PKCS8 keys — avoid re-parsing the private key on every refresh. */
const keyCache = new Map<
  string,
  CryptoKey | Awaited<ReturnType<typeof importPKCS8>>
>();

export function getProjectId(): string {
  return (
    process.env.FIREBASE_PROJECT_ID ??
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
    ""
  );
}

export function getServiceAccount() {
  const projectId = getProjectId();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Server Firebase credentials missing. Add FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY as encrypted secrets in Cloudflare Worker settings, then redeploy."
    );
  }

  return { projectId, clientEmail, privateKey };
}

export function hasServiceAccount(): boolean {
  return Boolean(
    getProjectId() &&
      process.env.FIREBASE_CLIENT_EMAIL?.trim() &&
      process.env.FIREBASE_PRIVATE_KEY?.trim()
  );
}

export function getDatabaseUrl(): string {
  const explicit = process.env.FIREBASE_DATABASE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const projectId = getProjectId();
  if (!projectId) {
    throw new Error(
      "FIREBASE_DATABASE_URL or FIREBASE_PROJECT_ID is required for Realtime Database."
    );
  }

  return `https://${projectId}-default-rtdb.firebaseio.com`;
}

async function getImportedKey(
  privateKey: string
): Promise<CryptoKey | Awaited<ReturnType<typeof importPKCS8>>> {
  // Fingerprint without logging key material.
  const fingerprint = `${privateKey.length}:${privateKey.slice(0, 32)}`;
  const cached = keyCache.get(fingerprint);
  if (cached) return cached;
  const imported = await importPKCS8(privateKey, "RS256");
  keyCache.set(fingerprint, imported);
  return imported;
}

async function mintAccessToken(
  account: FirebaseServiceAccountCreds
): Promise<string> {
  const key = await getImportedKey(account.privateKey);

  const assertion = await new SignJWT({ scope: FIREBASE_SCOPES })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(account.clientEmail)
    .setSubject(account.clientEmail)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    cache: "no-store",
  });

  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };

  if (!res.ok || !data.access_token) {
    throw new Error(data.error ?? "Could not obtain Google access token.");
  }

  const expiresInSec =
    typeof data.expires_in === "number" && data.expires_in > 0
      ? data.expires_in
      : 3600;

  tokenCache.set(account.clientEmail, {
    accessToken: data.access_token,
    expiresAtMs: Date.now() + expiresInSec * 1000,
  });

  console.log(
    JSON.stringify({
      type: "arcadex_oauth_token",
      env: getDeployEnv(),
      event: "minted",
      account: account.clientEmail,
      expiresInSec,
    })
  );

  return data.access_token;
}

/**
 * Returns a Google OAuth access token for a service account, cached until
 * shortly before expiry. Concurrent callers share one in-flight mint per email.
 */
export async function getFirebaseAccessTokenForAccount(
  account: FirebaseServiceAccountCreds
): Promise<string> {
  const cacheKey = account.clientEmail;
  const now = Date.now();
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAtMs - TOKEN_EXPIRY_SAFETY_MS > now) {
    return cached.accessToken;
  }

  const inflight = inflightTokens.get(cacheKey);
  if (inflight) return inflight;

  const promise = mintAccessToken(account)
    .catch((err) => {
      tokenCache.delete(cacheKey);
      throw err;
    })
    .finally(() => {
      inflightTokens.delete(cacheKey);
    });

  inflightTokens.set(cacheKey, promise);
  return promise;
}

/**
 * Shared ArcadeX Fun service-account token (Firestore + default RTDB).
 */
export async function getFirebaseAccessToken(): Promise<string> {
  return getFirebaseAccessTokenForAccount(getServiceAccount());
}

/** Test/helper: drop cached tokens so the next call refreshes. */
export function clearFirebaseAccessTokenCache(): void {
  tokenCache.clear();
  inflightTokens.clear();
}
