import { isPlainAuthMessageValid } from "@/lib/plain-auth";

export function isVaraAuthMessageValid(message: string, nonce: string): boolean {
  return isPlainAuthMessageValid(message, nonce);
}
