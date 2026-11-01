import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { WalletEcosystem } from "@/lib/player-identity";
import { isWalletEcosystem } from "@/lib/wallet-ecosystems";

export const SESSION_COOKIE = "arcadex_session";
const SESSION_TTL = "30d";

export interface SessionPayload {
  playerId: string;
  address: string;
  ecosystem: WalletEcosystem;
  chainId?: number;
  /** Present after SIWF or sponsored FID mint. */
  fid?: number;
}

const SESSION_VERIFY_TTL_MS = 60_000;
const SESSION_VERIFY_MAX = 400;

let hmacKeyPromise: Promise<CryptoKey> | null = null;
const verifiedSessions = new Map<
  string,
  { payload: SessionPayload; exp: number }
>();

function missingAuthSecret(): Error {
  return new Error(
    "AUTH_SECRET is missing. Add it as a Cloudflare Worker secret and redeploy. Do not reuse FIREBASE_DATABASE_SECRET."
  );
}

/** Import the HMAC key once per isolate. jose re-imports a raw secret on every call. */
function getHmacKey(): Promise<CryptoKey> {
  if (hmacKeyPromise) return hmacKeyPromise;
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) return Promise.reject(missingAuthSecret());
  hmacKeyPromise = crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  return hmacKeyPromise;
}

export async function createSessionToken(
  payload: SessionPayload
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(await getHmacKey());
}

export async function verifySessionToken(
  token: string
): Promise<SessionPayload | null> {
  const now = Date.now();
  const cached = verifiedSessions.get(token);
  if (cached && cached.exp > now) return { ...cached.payload };

  try {
    const { payload } = await jwtVerify(token, await getHmacKey());
    const playerId = payload.playerId;
    const address = payload.address;
    const ecosystem = payload.ecosystem;

    if (
      typeof playerId !== "string" ||
      typeof address !== "string" ||
      typeof ecosystem !== "string" ||
      !isWalletEcosystem(ecosystem)
    ) {
      return null;
    }

    const session: SessionPayload = {
      playerId,
      address,
      ecosystem,
      chainId:
        typeof payload.chainId === "number" ? payload.chainId : undefined,
      fid: typeof payload.fid === "number" ? payload.fid : undefined,
    };
    verifiedSessions.set(token, {
      payload: session,
      exp: now + SESSION_VERIFY_TTL_MS,
    });
    if (verifiedSessions.size > SESSION_VERIFY_MAX) {
      const oldest = verifiedSessions.keys().next().value;
      if (oldest !== undefined) verifiedSessions.delete(oldest);
    }
    return session;
  } catch {
    return null;
  }
}

export async function readSessionFromCookies(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export function sessionCookieOptions(token: string) {
  const secure = process.env.NODE_ENV === "production";
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  };
}
