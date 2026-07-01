import { isPlainAuthMessageValid } from "@/lib/plain-auth";
import {
  AptosSignMessageOutput,
  verifyAptosSignMessage,
} from "@/lib/aptos-auth";

export function isMovementAuthMessageValid(message: string, nonce: string): boolean {
  return isPlainAuthMessageValid(message, nonce);
}

export function verifyMovementSignMessage(output: AptosSignMessageOutput): boolean {
  return verifyAptosSignMessage(output);
}
