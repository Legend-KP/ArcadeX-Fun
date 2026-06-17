import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { WalletEcosystem } from "@/lib/player-identity";

export const SESSION_COOKIE = "arcadex_session";
const SESSION_TTL = "7d";

export interface SessionPayload {
  playerId: string;
  address: string;
  ecosystem: WalletEcosystem;
  chainId?: number;
}

function getAuthSecret(): Uint8Array {
  const secret =
    process.env.AUTH_SECRET?.trim() ||
    process.env.FIREBASE_DATABASE_SECRET?.trim();

  if (!secret) {
    throw new Error(
      "AUTH_SECRET is missing. Add it to your environment variables."
    );
  }

  return new TextEncoder().encode(secret);
}

export async function createSessionToken(
  payload: SessionPayload
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(getAuthSecret());
}

export async function verifySessionToken(
  token: string
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getAuthSecret());
    const playerId = payload.playerId;
    const address = payload.address;
    const ecosystem = payload.ecosystem;

    if (
      typeof playerId !== "string" ||
      typeof address !== "string" ||
      (ecosystem !== "evm" && ecosystem !== "starknet")
    ) {
      return null;
    }

    return {
      playerId,
      address,
      ecosystem,
      chainId:
        typeof payload.chainId === "number" ? payload.chainId : undefined,
    };
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
    maxAge: 60 * 60 * 24 * 7,
  };
}
