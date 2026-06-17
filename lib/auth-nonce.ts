import { randomBytes } from "crypto";
import { getDatabaseUrl } from "@/lib/firebase-admin";

const NONCE_TTL_MS = 10 * 60 * 1000;

function getRtdbAuthQuery(): string {
  const secret = process.env.FIREBASE_DATABASE_SECRET?.trim();
  if (!secret) {
    throw new Error("FIREBASE_DATABASE_SECRET is missing.");
  }
  return `auth=${encodeURIComponent(secret)}`;
}

export function createAuthNonce(): string {
  return randomBytes(16).toString("hex");
}

export async function storeAuthNonce(nonce: string): Promise<void> {
  const auth = getRtdbAuthQuery();
  const url = `${getDatabaseUrl()}/authNonces/${encodeURIComponent(nonce)}.json?${auth}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ createdAt: Date.now() }),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to store auth nonce (${res.status}): ${text}`);
  }
}

export async function consumeAuthNonce(nonce: string): Promise<boolean> {
  const auth = getRtdbAuthQuery();
  const encoded = encodeURIComponent(nonce);
  const readUrl = `${getDatabaseUrl()}/authNonces/${encoded}.json?${auth}`;
  const readRes = await fetch(readUrl, { cache: "no-store" });

  if (readRes.status === 404) return false;
  if (!readRes.ok) return false;

  const data = (await readRes.json()) as { createdAt?: number } | null;
  if (!data?.createdAt) return false;
  if (Date.now() - data.createdAt > NONCE_TTL_MS) return false;

  const deleteUrl = `${getDatabaseUrl()}/authNonces/${encoded}.json?${auth}`;
  await fetch(deleteUrl, { method: "DELETE", cache: "no-store" });
  return true;
}
