import { randomBytes } from "crypto";
import { rtdbDelete, rtdbRead, rtdbWrite } from "@/lib/rtdb-rest";

const NONCE_TTL_MS = 10 * 60 * 1000;

export function createAuthNonce(): string {
  return randomBytes(16).toString("hex");
}

export async function storeAuthNonce(nonce: string): Promise<void> {
  await rtdbWrite(
    `authNonces/${nonce}`,
    { createdAt: Date.now() },
    { silent: true }
  );
}

export async function consumeAuthNonce(nonce: string): Promise<boolean> {
  const data = await rtdbRead<{ createdAt?: number }>(`authNonces/${nonce}`);
  if (!data?.createdAt) return false;
  if (Date.now() - data.createdAt > NONCE_TTL_MS) {
    await rtdbDelete(`authNonces/${nonce}`, { silent: true }).catch(() => {});
    return false;
  }

  await rtdbDelete(`authNonces/${nonce}`, { silent: true });
  return true;
}
