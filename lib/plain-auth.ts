import { buildAuthPlainMessage } from "@/lib/auth-message";

export function buildPlainAuthMessage(nonce: string): string {
  return buildAuthPlainMessage(nonce);
}

export function isPlainAuthMessageValid(message: string, nonce: string): boolean {
  if (!message.startsWith("Sign in to ArcadeX\nNonce: ")) {
    return false;
  }
  return message.includes(`Nonce: ${nonce}`);
}
