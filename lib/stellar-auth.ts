import { buildPlainAuthMessage, isPlainAuthMessageValid } from "@/lib/plain-auth";

export function buildStellarAuthMessage(nonce: string): string {
  return buildPlainAuthMessage(nonce);
}

export function isStellarAuthMessageValid(message: string, nonce: string): boolean {
  return isPlainAuthMessageValid(message, nonce);
}
